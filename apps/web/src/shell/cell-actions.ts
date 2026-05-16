import type { FUniver } from '@univerjs/core/facade';

/**
 * Commit a string the user typed into the formula bar to the active cell.
 *   - Strings starting with `=` are treated as formulas.
 *   - Numeric strings are coerced to numbers so the cell isn't stored as text.
 *   - Empty string clears the cell.
 */
export function commitToActiveCell(api: FUniver, raw: string) {
  const sheet = api.getActiveWorkbook()?.getActiveSheet();
  const range = sheet?.getActiveRange();
  if (!range) return;
  const cell = sheet!.getRange(range.getRow(), range.getColumn());

  const text = raw.trim();
  if (text === '') {
    cell.setValue({ v: null });
    return;
  }
  if (text.startsWith('=')) {
    cell.setValue({ f: text });
    return;
  }
  // Coerce pure numbers — Univer treats string-typed numbers as text otherwise.
  if (text !== '' && !Number.isNaN(Number(text))) {
    cell.setValue({ v: Number(text) });
    return;
  }
  cell.setValue({ v: text });
}
