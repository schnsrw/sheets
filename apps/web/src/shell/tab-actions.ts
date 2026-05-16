import type { FUniver } from '@univerjs/core/facade';

/** Imperative dispatchers used by Insert / Formulas / Data tabs. */

function activeRange(api: FUniver) {
  const wb = api.getActiveWorkbook();
  const sheet = wb?.getActiveSheet();
  return sheet?.getActiveRange() ?? null;
}

function activeSheet(api: FUniver) {
  return api.getActiveWorkbook()?.getActiveSheet() ?? null;
}

/* ── Insert tab ─────────────────────────────────────────────────────────── */

export function insertRowAbove(api: FUniver) {
  const range = activeRange(api);
  const sheet = activeSheet(api);
  if (!range || !sheet) return;
  sheet.insertRowBefore(range.getRow());
}

export function insertRowBelow(api: FUniver) {
  const range = activeRange(api);
  const sheet = activeSheet(api);
  if (!range || !sheet) return;
  sheet.insertRowAfter(range.getRow() + range.getHeight() - 1);
}

export function insertColumnLeft(api: FUniver) {
  const range = activeRange(api);
  const sheet = activeSheet(api);
  if (!range || !sheet) return;
  sheet.insertColumnBefore(range.getColumn());
}

export function insertColumnRight(api: FUniver) {
  const range = activeRange(api);
  const sheet = activeSheet(api);
  if (!range || !sheet) return;
  sheet.insertColumnAfter(range.getColumn() + range.getWidth() - 1);
}

export function deleteSelectedRow(api: FUniver) {
  const range = activeRange(api);
  const sheet = activeSheet(api);
  if (!range || !sheet) return;
  sheet.deleteRows(range.getRow(), range.getHeight());
}

export function deleteSelectedColumn(api: FUniver) {
  const range = activeRange(api);
  const sheet = activeSheet(api);
  if (!range || !sheet) return;
  sheet.deleteColumns(range.getColumn(), range.getWidth());
}

export function insertNewSheet(api: FUniver) {
  const wb = api.getActiveWorkbook();
  if (!wb) return;
  wb.insertSheet();
}

/* ── Formulas tab — quick auto-functions ─────────────────────────────────── */

type AutoFn = 'SUM' | 'AVERAGE' | 'COUNT' | 'MIN' | 'MAX';

/**
 * Mimics Excel's AutoSum behavior: if the selection is multi-cell, write the
 * formula in the cell immediately below or right of the selection. Otherwise
 * write the formula in the active cell with no range (user will fill it in).
 */
export function applyAutoFunction(api: FUniver, fn: AutoFn) {
  const sheet = activeSheet(api);
  const range = activeRange(api);
  if (!sheet || !range) return;

  const isMulti = range.getWidth() * range.getHeight() > 1;
  if (isMulti) {
    const targetRow = range.getRow() + range.getHeight();
    const targetCol = range.getColumn();
    const formula = `=${fn}(${range.getA1Notation()})`;
    const target = sheet.getRange(targetRow, targetCol);
    target.setValue({ f: formula });
    target.activate();
  } else {
    const cell = sheet.getRange(range.getRow(), range.getColumn());
    cell.setValue({ f: `=${fn}()` });
  }
}

/* ── Data tab — sort / filter ────────────────────────────────────────────── */

export function sortRange(api: FUniver, ascending: boolean) {
  const range = activeRange(api);
  if (!range) return;
  // sort() comes from sheets-sort facade. Cast for typing — the facade
  // augments FRange at runtime via FUniver.extend().
  const withSort = range as unknown as {
    sort?: (spec: { column: number; ascending: boolean }) => unknown;
  };
  withSort.sort?.({ column: range.getColumn(), ascending });
}

export function toggleFilter(api: FUniver) {
  const sheet = activeSheet(api);
  const range = activeRange(api);
  if (!sheet || !range) return;

  // sheets-filter facade augmentations.
  const sheetWithFilter = sheet as unknown as { getFilter?: () => { remove: () => void } | null };
  const existing = sheetWithFilter.getFilter?.();
  if (existing) {
    existing.remove();
    return;
  }
  const rangeWithCreateFilter = range as unknown as { createFilter?: () => unknown };
  rangeWithCreateFilter.createFilter?.();
}
