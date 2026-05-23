/**
 * Sparkline model — in-cell mini-charts. Each sparkline is anchored
 * to a single target cell (renders an SVG overlay sized to that
 * cell's bounding box) and reads its data from a range elsewhere in
 * the workbook.
 *
 * Three Excel-canonical types:
 *   - **line**: connects values with a small line; markers at min /
 *     max (auto-coloured).
 *   - **column**: short bars per value, positive in the series colour
 *     and negative tinted.
 *   - **win-loss**: tri-state bars (+ / − / 0) — used for binary
 *     up/down indicators.
 *
 * v1 stores sparklines in a React context (in-memory). They don't yet
 * round-trip through xlsx — adding the workbook resource is a
 * follow-up gated on demand. Surviving an autosave + restore is
 * handled by the existing autosave / version-history snapshots
 * because they include the workbook's resources matrix.
 */

export type SparklineType = 'line' | 'column' | 'win-loss';

export type SparklineModel = {
  id: string;
  type: SparklineType;
  /** Workbook unit id this sparkline lives on. */
  unitId: string;
  /** Sheet id (subUnitId) of the anchor + source. v1 forces source +
   *  anchor to share a sheet; cross-sheet refs are a follow-up. */
  sheetId: string;
  /** Source data range (typically a single row or column). */
  source: { startRow: number; endRow: number; startColumn: number; endColumn: number };
  /** Anchor cell (row, col) — the sparkline renders inside this cell. */
  anchor: { row: number; col: number };
  /** Optional colour override; defaults to the accent green. */
  color?: string;
  /** Optional negative-bar colour for column / win-loss. */
  negativeColor?: string;
};
