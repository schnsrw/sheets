import * as Y from 'yjs';
import type { FUniver } from '@univerjs/core/facade';
import {
  ICommandService,
  type ICommandInfo,
  type IExecutionOptions,
} from '@univerjs/core';

/**
 * Yjs ↔ Univer cell-value bridge — spike grade. See docs/CO-EDITING.md for
 * the full design. v1 covers only `sheet.mutation.set-range-values` —
 * enough to prove the round-trip works for two browsers editing one cell.
 *
 * Echo-loop guard (per CLAUDE.md):
 *   - Local edits go through `doc.transact(fn, ORIGIN)` so the remote
 *     observer can skip our own writes via `tx.origin !== ORIGIN`.
 *   - Remote applications dispatch the Univer command with
 *     `fromCollab: true`. The `onMutationExecutedForCollab` listener
 *     filters those out by inspecting `options?.fromCollab`.
 */

const ORIGIN = 'casual-sheets-local';
const SET_RANGE_VALUES = 'sheet.mutation.set-range-values';

type CellPrimitive = string | number | boolean | null;
type CellPatch = { v?: CellPrimitive; f?: string | null };

type CellRow = Record<string, CellPatch>;
type CellGrid = Record<string, CellRow>;

type SetRangeValuesParams = {
  unitId: string;
  subUnitId: string;
  cellValue: Record<string, Record<string, CellPatch>>;
};

export type BridgeHandle = {
  /** Yjs document. Exposed so callers (tests, devtools) can introspect. */
  doc: Y.Doc;
  /** Stop listening and clean up. */
  dispose: () => void;
};

/**
 * Wire the bridge to an FUniver and a Y.Doc. The doc is expected to be
 * managed by a HocuspocusProvider (or any Y.Doc transport); the bridge
 * itself doesn't care about the network — it just talks to the doc.
 */
export function startBridge(api: FUniver, doc: Y.Doc): BridgeHandle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const injector = (api as any)._injector as
    | { get: (token: unknown) => unknown }
    | undefined;
  if (!injector) {
    throw new Error('[collab] FUniver injector not accessible — Univer too old?');
  }
  const cmdSvc = injector.get(ICommandService) as {
    onMutationExecutedForCollab: (
      l: (info: ICommandInfo, options?: IExecutionOptions) => void,
    ) => { dispose: () => void };
    executeCommand: (id: string, params: unknown, options?: IExecutionOptions) => Promise<unknown>;
  };

  // ── Local → Yjs ──────────────────────────────────────────────────────
  const subDispose = cmdSvc.onMutationExecutedForCollab((info, options) => {
    if (options?.fromCollab) return; // remote-applied; skip
    if (info.id !== SET_RANGE_VALUES) return;
    const params = info.params as SetRangeValuesParams | undefined;
    if (!params?.cellValue) return;
    doc.transact(() => {
      const sheetMap = getOrCreateSheet(doc, params.subUnitId);
      writeCellsToYMap(sheetMap, params.cellValue);
    }, ORIGIN);
  });

  // ── Yjs → Local ──────────────────────────────────────────────────────
  // `observeDeep` on the top-level `sheets` map catches every cell write
  // anywhere in the doc. We batch per subUnit into one set-range-values
  // command so multi-cell remote updates apply in a single mutation.
  const sheetsMap = doc.getMap('sheets') as YMapUnknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const observer = (_events: Array<Y.YEvent<any>>, tx: Y.Transaction) => {
    if (tx.origin === ORIGIN) return; // own write; skip
    void applyRemoteToUniver(api, cmdSvc, sheetsMap);
  };
  sheetsMap.observeDeep(observer);

  return {
    doc,
    dispose: () => {
      subDispose.dispose();
      sheetsMap.unobserveDeep(observer);
    },
  };
}

// Y.Map's generic types fight nested-map composition; the actual shape is:
//   doc.getMap('sheets')      → sheetId → Y.Map
//   sheet[sheetId]            → rowKey  → Y.Map
//   row[rowKey]               → colKey  → Y.Map (the cell)
//   cell[colKey]              → {v,f}   → fields by key
// We use `Y.Map<unknown>` and cast at the boundaries — the bridge is
// runtime-validated by the e2e sync test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type YMapUnknown = Y.Map<any>;

function getOrCreateSheet(doc: Y.Doc, subUnitId: string): YMapUnknown {
  const sheets = doc.getMap('sheets') as YMapUnknown;
  let sheet = sheets.get(subUnitId) as YMapUnknown | undefined;
  if (!sheet) {
    sheet = new Y.Map();
    sheets.set(subUnitId, sheet);
  }
  return sheet;
}

function writeCellsToYMap(
  sheet: YMapUnknown,
  cellValue: SetRangeValuesParams['cellValue'],
): void {
  for (const rKey of Object.keys(cellValue)) {
    let row = sheet.get(rKey) as YMapUnknown | undefined;
    if (!row) {
      row = new Y.Map();
      sheet.set(rKey, row);
    }
    const cells = cellValue[rKey];
    for (const cKey of Object.keys(cells)) {
      const patch = cells[cKey];
      let cellMap = row.get(cKey) as YMapUnknown | undefined;
      if (!cellMap) {
        cellMap = new Y.Map();
        row.set(cKey, cellMap);
      }
      cellMap.set('v', patch?.v ?? null);
      if (patch?.f !== undefined) cellMap.set('f', patch.f);
    }
  }
}

/**
 * Cheap and effective for the spike — re-emit the entire Y.Doc state to
 * Univer as one big set-range-values per subUnit, with fromCollab: true so
 * we don't ping-pong. Univer dedupes no-ops internally; we'll get smarter
 * (per-event diff) once the spike proves the loop.
 */
async function applyRemoteToUniver(
  api: FUniver,
  cmdSvc: {
    executeCommand: (id: string, params: unknown, options?: IExecutionOptions) => Promise<unknown>;
  },
  sheetsMap: YMapUnknown,
): Promise<void> {
  const wb = api.getActiveWorkbook();
  if (!wb) return;
  const unitId = wb.getId();
  sheetsMap.forEach((sheetUntyped, subUnitId) => {
    const sheet = sheetUntyped as YMapUnknown;
    const cellValue: CellGrid = {};
    let anyCells = false;
    sheet.forEach((rowUntyped, rKey) => {
      const row = rowUntyped as YMapUnknown;
      const rowOut: CellRow = {};
      row.forEach((cellUntyped, cKey) => {
        const cell = cellUntyped as YMapUnknown;
        rowOut[cKey] = {
          v: (cell.get('v') ?? null) as CellPrimitive,
          ...(cell.has('f') ? { f: cell.get('f') as string | null } : {}),
        };
        anyCells = true;
      });
      if (Object.keys(rowOut).length > 0) cellValue[rKey] = rowOut;
    });
    if (!anyCells) return;
    void cmdSvc.executeCommand(
      SET_RANGE_VALUES,
      { unitId, subUnitId, cellValue },
      { fromCollab: true },
    );
  });
}
