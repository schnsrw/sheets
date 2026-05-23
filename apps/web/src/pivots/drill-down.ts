import type { FUniver } from '@univerjs/core/facade';
import type { PivotModel } from './types';
import { computePivot, type PivotCell, type SourceMatrix } from './compute';

/**
 * "Drill down" — given a click on a pivot result cell, return the
 * source records that contributed to it. Excel calls this "show
 * details" and dumps them into a fresh worksheet; we render them in a
 * popup instead (less disruption + no sheet sprawl).
 *
 * The clicked-cell → key-path mapping is sourced from the same
 * `rowMeta` that `computePivot` produced when the output was last
 * written — re-running compute on click is cheap (small grids) and
 * keeps the walk logic in one place.
 *
 * Drilling on the header row returns null. Drilling on a subtotal row
 * (multi-row pivots only) returns every record under the partial key
 * prefix. Drilling on a leaf returns the records that share the full
 * composite key path. Drilling on Grand Total returns every filtered
 * record.
 */

export type DrillDownResult = {
  /** Header labels matching the source columns. */
  headers: string[];
  /** Each contributing record, as a flat array of cell values. */
  rows: PivotCell[][];
  /** Friendly summary string, e.g. `Region = "North"` or
   *  `Grand Total · 12 rows`. Used as the dialog title. */
  summary: string;
};

/** Locate the pivot whose output rectangle contains `(row, col)` on
 *  the given sheet. Pivots without a recorded `lastOutputExtent` (old
 *  payloads from before P1 wrote it) are skipped — we can't bound
 *  their output without re-running compute. */
export function findPivotAtCell(
  pivots: PivotModel[],
  sheetId: string,
  row: number,
  col: number,
): PivotModel | null {
  for (const p of pivots) {
    if (p.targetSheetId !== sheetId) continue;
    const ext = p.lastOutputExtent;
    if (!ext) continue;
    const r0 = p.target.row;
    const c0 = p.target.column;
    if (row >= r0 && row < r0 + ext.rows && col >= c0 && col < c0 + ext.cols) {
      return p;
    }
  }
  return null;
}

/**
 * Compute the contributing rows for a click at absolute (row, col) on
 * the given pivot. Returns null if the click resolves to a non-
 * meaningful cell (the header row, or coordinates outside the pivot's
 * known extent).
 */
export function computeDrillDown(
  api: FUniver,
  pivot: PivotModel,
  row: number,
  col: number,
): DrillDownResult | null {
  // `col` is currently unused — drilling on any column within a row
  // returns the same set of contributing source records. Reserved
  // for a future per-value-field projection that only includes the
  // clicked value column.
  void col;
  const wb = api.getActiveWorkbook();
  if (!wb) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheets = wb.getSheets() as any[];
  const sourceWs = sheets.find((s) => s.getSheetId?.() === pivot.sourceSheetId);
  if (!sourceWs) return null;

  const source = readSource(sourceWs, pivot.source);
  const offsetRow = row - pivot.target.row;
  const ext = pivot.lastOutputExtent;
  if (!ext) return null;
  if (offsetRow < 0 || offsetRow >= ext.rows) return null;

  // Same filter pass compute uses — drill rows must match what's
  // visible in the pivot above.
  const filters = pivot.filters ?? [];
  const filtered = filters.length === 0
    ? source.records
    : source.records.filter((rec) => {
        for (const f of filters) {
          const allowed = new Set(f.allowedValues);
          const v = rec[f.column];
          const key = v == null ? '' : String(v);
          if (!allowed.has(key)) return false;
        }
        return true;
      });

  // Re-run compute to get the rowMeta. Cheap (output grids are tiny)
  // and avoids duplicating the bucket-and-walk logic here.
  const { rowMeta } = computePivot(source, pivot);
  const meta = rowMeta[offsetRow];
  if (!meta) return null;

  switch (meta.kind) {
    case 'header':
      return null;
    case 'grand-total':
      return {
        headers: source.headers,
        rows: filtered,
        summary: `Grand Total · ${filtered.length} rows`,
      };
    case 'subtotal':
    case 'leaf': {
      // Filter to records matching every row-field value along the
      // path. For a single-row pivot the path is one entry — same as
      // the pre-compact behavior. For multi-row the path narrows
      // progressively as the depth increases.
      const records = filtered.filter((rec) =>
        meta.keyPath.every((key, i) => {
          const col = pivot.rows[i]?.column;
          if (col == null) return false;
          const v = rec[col];
          return (v == null ? '' : String(v)) === key;
        }),
      );
      const labels = meta.keyPath.map((key, i) => {
        const fieldName = source.headers[pivot.rows[i]?.column ?? -1] ?? 'value';
        return `${fieldName} = "${key || '(blank)'}"`;
      });
      return {
        headers: source.headers,
        rows: records,
        summary: `${labels.join(' · ')} · ${records.length} rows`,
      };
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readSource(ws: any, src: PivotModel['source']): SourceMatrix {
  const headers: string[] = [];
  for (let c = src.startColumn; c <= src.endColumn; c++) {
    const v = ws.getRange(src.startRow, c).getValue();
    headers.push(v == null ? '' : String(v));
  }
  const records: Array<Array<string | number | null>> = [];
  for (let r = src.startRow + 1; r <= src.endRow; r++) {
    const row: Array<string | number | null> = [];
    let anyValue = false;
    for (let c = src.startColumn; c <= src.endColumn; c++) {
      const v = ws.getRange(r, c).getValue();
      if (v == null || v === '') row.push(null);
      else if (typeof v === 'number' || typeof v === 'string') {
        row.push(v);
        anyValue = true;
      } else if (typeof v === 'boolean') {
        row.push(v ? 1 : 0);
        anyValue = true;
      } else {
        row.push(String(v));
        anyValue = true;
      }
    }
    if (anyValue) records.push(row);
  }
  return { headers, records };
}
