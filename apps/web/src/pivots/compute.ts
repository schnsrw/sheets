import type { PivotAggregation, PivotModel } from './types';
import { PIVOT_AGG_LABELS } from './types';

/**
 * Pure compute step — turn raw source records into the laid-out cell
 * grid that gets written into the workbook. No FUniver dependency
 * here so it's trivially testable and so the same routine can run
 * server-side later (e.g. for an "export pivot to CSV" path).
 *
 * Scope as of P1.5:
 *   - 1..N row fields (multi-row uses Excel's compact layout — see
 *     {@link computePivot} below).
 *   - No column field.
 *   - One or more value fields, each gets its own column.
 *   - Filters applied before bucketing (P1).
 *
 * Single-row output (unchanged from P0):
 *
 *     [ row-field | Sum of Sales | Avg of Sales ]
 *     [ North     |          220 |          110 ]
 *     [ South     |          175 |         87.5 ]
 *     [ Grand T.  |          395 |         98.7 ]
 *
 * Multi-row compact layout (rows = [Region, Product], values = [Sum]):
 *
 *     [ Region    | Sum of Sales ]
 *     [ East      |          300 ]   ← outer subtotal on the label row
 *     [   A       |          100 ]   ← inner leaf, indent depth 1
 *     [   B       |          200 ]
 *     [ West      |          150 ]
 *     [   A       |          150 ]
 *     [ Grand T.  |          450 ]
 *
 * Indentation uses leading spaces in the label string (`'  '.repeat
 * (depth)`) — Univer's IStyleData has no first-class indent property,
 * and spaces round-trip losslessly through xlsx.
 */
export type PivotCell = string | number | null;
export type PivotGrid = PivotCell[][];

/** Metadata for each row of the output grid — lets drill-down map a
 *  clicked cell back to the composite key path that produced it
 *  without re-running the bucketing walk. */
export type PivotRowMeta =
  | { kind: 'header' }
  | { kind: 'subtotal'; keyPath: string[]; depth: number }
  | { kind: 'leaf'; keyPath: string[]; depth: number }
  | { kind: 'grand-total' };

export type PivotComputeResult = {
  grid: PivotGrid;
  rowMeta: PivotRowMeta[];
};

/**
 * Raw records read from the workbook source range. Row 0 is the
 * header row, rows 1.. are data. Cell values come in pre-coerced
 * by the caller (`apply.ts` reads them via `getValue()` which already
 * returns the right primitive type).
 */
export type SourceMatrix = {
  headers: string[];
  records: PivotCell[][];
};

export function computePivot(source: SourceMatrix, model: PivotModel): PivotComputeResult {
  if (model.values.length === 0) {
    return { grid: [], rowMeta: [] };
  }

  // P1 — apply filter fields BEFORE bucketing. Each filter restricts
  // records to those whose value in `column` is one of `allowedValues`
  // (string-compared). Empty allowedValues excludes everything; the
  // dialog UI never produces that shape (uses remove-filter), but
  // compute defends against it.
  const filters = model.filters ?? [];
  const passesFilters = (rec: PivotCell[]): boolean => {
    for (const f of filters) {
      const allowed = new Set(f.allowedValues);
      const v = rec[f.column];
      const key = v == null ? '' : String(v);
      if (!allowed.has(key)) return false;
    }
    return true;
  };
  const filteredRecords =
    filters.length > 0 ? source.records.filter(passesFilters) : source.records;

  // Header row — column 0 is the outermost row field name (compact
  // layout uses one label column shared across all row-field levels);
  // subsequent columns are the value-field headers in model order.
  const rowFieldCols = model.rows.map((r) => r.column);
  const hasRowField = rowFieldCols.length > 0;
  const header: PivotCell[] = [];
  if (hasRowField) {
    header.push(source.headers[rowFieldCols[0]] ?? '');
  }
  for (const v of model.values) {
    header.push(`${PIVOT_AGG_LABELS[v.agg]} of ${source.headers[v.column] ?? ''}`);
  }

  const grid: PivotGrid = [header];
  const rowMeta: PivotRowMeta[] = [{ kind: 'header' }];

  if (!hasRowField) {
    // No row field — Grand Total only.
    const total: PivotCell[] = [];
    for (const v of model.values) {
      total.push(aggregate(filteredRecords.map((r) => r[v.column]), v.agg));
    }
    grid.push(total);
    rowMeta.push({ kind: 'grand-total' });
    return { grid, rowMeta };
  }

  // Build the nested bucket tree. Each level keys by the value of the
  // corresponding row field; leaves hold the contributing record list.
  const root = buildTree(filteredRecords, rowFieldCols);

  // Walk the tree in compact-layout order. For each row-field level we
  // emit either a subtotal row (intermediate levels) or a leaf row
  // (innermost level), then recurse into children.
  const walk = (node: TreeNode, keyPath: string[], depth: number): void => {
    // Sort keys ascending — Excel default sort order.
    const keys = [...node.children.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    const isInnermost = depth === rowFieldCols.length - 1;
    for (const key of keys) {
      const child = node.children.get(key)!;
      const path = [...keyPath, key];
      const cells: PivotCell[] = [`${'  '.repeat(depth)}${key}`];
      for (const v of model.values) {
        cells.push(aggregate(child.records.map((r) => r[v.column]), v.agg));
      }
      grid.push(cells);
      rowMeta.push(
        isInnermost
          ? { kind: 'leaf', keyPath: path, depth }
          : { kind: 'subtotal', keyPath: path, depth },
      );
      if (!isInnermost) walk(child, path, depth + 1);
    }
  };
  walk(root, [], 0);

  // Grand Total — aggregates ALL filtered records (regardless of row
  // bucketing depth) so the total always matches the visible records.
  const total: PivotCell[] = ['Grand Total'];
  for (const v of model.values) {
    total.push(aggregate(filteredRecords.map((r) => r[v.column]), v.agg));
  }
  grid.push(total);
  rowMeta.push({ kind: 'grand-total' });

  return { grid, rowMeta };
}

type TreeNode = {
  records: PivotCell[][];
  children: Map<string, TreeNode>;
};

function buildTree(records: PivotCell[][], rowFieldCols: number[]): TreeNode {
  const root: TreeNode = { records: [], children: new Map() };
  for (const rec of records) {
    let node = root;
    node.records.push(rec);
    for (const col of rowFieldCols) {
      const key = rec[col] == null ? '' : String(rec[col]);
      let child = node.children.get(key);
      if (!child) {
        child = { records: [], children: new Map() };
        node.children.set(key, child);
      }
      child.records.push(rec);
      node = child;
    }
  }
  return root;
}

function aggregate(values: PivotCell[], agg: PivotAggregation): PivotCell {
  const nums: number[] = [];
  let nonNull = 0;
  for (const v of values) {
    if (v == null || v === '') continue;
    nonNull++;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) nums.push(n);
  }
  switch (agg) {
    case 'count':
      return nonNull;
    case 'sum':
      return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0);
    case 'average':
      return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return nums.length === 0 ? null : Math.min(...nums);
    case 'max':
      return nums.length === 0 ? null : Math.max(...nums);
  }
}

/** Used by the panel to render a friendly auto-name like
 *  "Sum of Sales by Region" so a freshly inserted pivot has a label
 *  that explains itself. */
export function defaultPivotTitle(source: SourceMatrix, model: PivotModel): string {
  const value = model.values[0];
  if (!value) return 'PivotTable';
  const valuePart = `${PIVOT_AGG_LABELS[value.agg]} of ${source.headers[value.column] ?? 'value'}`;
  const rowFields = model.rows.map((r) => source.headers[r.column] ?? 'group');
  if (rowFields.length === 0) return valuePart;
  return `${valuePart} by ${rowFields.join(' / ')}`;
}
