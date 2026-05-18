import type { FUniver } from '@univerjs/core/facade';
import { ISheetClipboardService } from '@univerjs/sheets-ui';

/**
 * Excel-paste merge preservation.
 *
 * Univer's HTML clipboard parser reads `colspan` / `rowspan` from
 * pasted `<td>` cells into the cell matrix, but the default
 * `onPasteCells` hook only uses those numbers to *skip* covered
 * cells — it never emits `AddWorksheetMergeMutation`. So a paste of
 * a merged Excel range lands as N separate cells in our grid.
 *
 * This function registers a higher-priority clipboard hook that runs
 * AFTER the default hook (Univer sorts hooks ascending by priority,
 * so a larger number runs later — see the sort at
 * `@univerjs/sheets-ui` ES bundle line ~6228) and walks the
 * destination matrix for any cell with `rowSpan > 1` / `colSpan > 1`,
 * emitting `sheet.mutation.add-worksheet-merge` for each.
 *
 * We register via the FUniver facade's `_injector` rather than as a
 * proper Plugin class because the project's tsconfig doesn't enable
 * `experimentalDecorators` and Univer's Plugin DI uses parameter
 * decorators. The injector reach matches the existing pattern in
 * `apps/web/src/shell/file-actions.ts:179` for `IMessageService`.
 *
 * Returns a disposer the caller can call on teardown.
 */
export function registerPasteMergeHook(api: FUniver): (() => void) | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const injector = (api as any)._injector as
    | { get: (token: unknown) => unknown }
    | undefined;
  if (!injector) return null;
  let clipboard: unknown;
  try {
    clipboard = injector.get(ISheetClipboardService);
  } catch {
    return null;
  }
  const svc = clipboard as
    | {
        addClipboardHook: (hook: ClipboardHook) => { dispose: () => void };
      }
    | undefined;
  if (!svc?.addClipboardHook) return null;

  const onPasteCells: ClipboardHook['onPasteCells'] = (_pasteFrom, pasteTo, data) => {
    const ranges: MergeRange[] = [];
    data.forValue?.((r: number, c: number, cell: SpanCell | null) => {
      const rs = cell?.rowSpan ?? 1;
      const cs = cell?.colSpan ?? 1;
      if (rs <= 1 && cs <= 1) return;
      const rows = pasteTo.range.rows;
      const cols = pasteTo.range.cols;
      const startRow = rows[r];
      const startCol = cols[c];
      if (startRow === undefined || startCol === undefined) return;
      // Discrete ranges allow non-contiguous indices (e.g. filtered
      // destination). Fall back to the contiguous case if the
      // expected index isn't present.
      const endRow = rows[r + rs - 1] ?? startRow + rs - 1;
      const endCol = cols[c + cs - 1] ?? startCol + cs - 1;
      ranges.push({
        startRow,
        endRow,
        startColumn: startCol,
        endColumn: endCol,
      });
    });
    if (ranges.length === 0) return { undos: [], redos: [] };
    const params = {
      unitId: pasteTo.unitId,
      subUnitId: pasteTo.subUnitId,
      ranges,
    };
    return {
      redos: [{ id: 'sheet.mutation.add-worksheet-merge', params }],
      undos: [{ id: 'sheet.mutation.remove-worksheet-merge', params }],
    };
  };

  // Expose the bare callback in dev so e2e specs can exercise its
  // mutation-generation logic without having to drive a real
  // ClipboardEvent (synthetic events don't reach Univer's listener in
  // headless Chromium). Tree-shaken in production via the
  // `import.meta.env.DEV` gate.
  if (import.meta.env.DEV) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__pasteMergeHook__ = onPasteCells;
  }

  const disposable = svc.addClipboardHook({
    id: 'casual-sheets-paste-merges',
    priority: 1000,
    onPasteCells,
  });
  return () => {
    disposable.dispose();
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).__pasteMergeHook__;
    }
  };
}

// Minimal local types for the bits of Univer's clipboard hook we touch.
// Keeps the file independent of @univerjs/sheets-ui type re-exports.
type MergeRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};
type SpanCell = { rowSpan?: number; colSpan?: number };
type DiscreteRange = { rows: number[]; cols: number[] };
type PasteTarget = { range: DiscreteRange; unitId: string; subUnitId: string };
type DataMatrix = {
  forValue?: (
    cb: (r: number, c: number, cell: SpanCell | null) => void,
  ) => unknown;
};
type MutationInfo = { id: string; params: unknown };
type ClipboardHook = {
  id: string;
  priority?: number;
  onPasteCells: (
    pasteFrom: unknown,
    pasteTo: PasteTarget,
    data: DataMatrix,
    payload?: unknown,
  ) => { undos: MutationInfo[]; redos: MutationInfo[] };
};
