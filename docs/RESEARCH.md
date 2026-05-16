# Research — Univer 0.22.x

Technical brief on Univer OSS, distilled to what we need to build a collaborative Excel-equivalent on top of it. All file path references are to the vendored clone at `vendor/univer/`.

## 1. Project shape

- **License:** Apache-2.0 (OSS core). DreamNum sells a Pro line (collab, xlsx I/O, charts, pivots, history) that is **not** in this repo.
- **Tree:** pnpm monorepo, 61 packages, TypeScript. We care about `@univerjs/core`, `@univerjs/engine-render`, `@univerjs/engine-formula`, `@univerjs/sheets`, `@univerjs/sheets-ui`, `@univerjs/sheets-formula`, `@univerjs/ui`, and a few sheet feature plugins (`sheets-data-validation`, `sheets-conditional-formatting`, `sheets-filter`, `sheets-sort`, `sheets-hyper-link`).
- **Headless support:** first-class. Same packages run in Node, minus `engine-render` and `*-ui`. See `vendor/univer/docs/ISOMOPHIC.md` and `vendor/univer/examples/src/node/`.

## 2. Runtime architecture

DI-first, plugin-composed. Root is the `Univer` class (`vendor/univer/packages/core/src/univer.ts:1`) owning a single custom `Injector` and a `PluginService` that runs plugins through lifecycle stages:

```
Starting → Ready → Rendered → Steady
```

A **unit** (Workbook / Document / Slide) is created via `univer.createUnit(UniverInstanceType.UNIVER_SHEET, snapshot)` and tracked by `IUniverInstanceService`.

### Three execution primitives

Defined in `vendor/univer/packages/core/src/services/command/command.service.ts:38`:

| Primitive | What it does | Mutates state? | Synced for collab? |
|---|---|---|---|
| `COMMAND` | High-level intent (e.g. "delete row") | No, orchestrates | No |
| `MUTATION` | The only thing that mutates persisted snapshot state | **Yes** | **Yes — this is the wire format** |
| `OPERATION` | Transient/UI state (scroll, selection) | No | No |

**Flow of a UI edit:** click → menu item → `commandService.executeCommand('sheet.command.set-range-values', params)` → COMMAND handler synthesizes one or more `sheet.mutation.*` mutations (+ inverse mutations for undo) → mutations mutate the Workbook model in place → renderer listens to `onCommandExecuted` and repaints.

Hooks fire `beforeCommandExecutionListeners` (before) and `_commandExecutedListeners` (after); see `command.service.ts:440-458`.

## 3. The collab hook (critical)

`ICommandService` interface at `vendor/univer/packages/core/src/services/command/command.service.ts:207` exposes three listener APIs:

- `beforeCommandExecuted(listener)` — `:378`. All three types.
- `onCommandExecuted(listener)` — `:391`. After, except `syncOnly` mutations.
- **`onMutationExecutedForCollab(listener)` — `:404`. The one we use.** Fires only for `CommandType.MUTATION` and *includes* `syncOnly` mutations — which is exactly how Univer's own commercial collab pushes a mutation to peers without re-executing locally.

### `IExecutionOptions` carries collab signaling

`command.service.ts:187`:

```ts
interface IExecutionOptions {
  onlyLocal?: boolean;     // don't broadcast
  fromCollab?: boolean;    // applied from peer — don't re-broadcast (echo guard)
  fromChangeset?: boolean; // from snapshot load
  syncOnly?: boolean;      // broadcast but don't execute locally
}
```

Mutations also carry `params.trigger` set to the originating COMMAND id (`command.service.ts:497-507`), so we can attribute mutations to their source intent for UI feedback ("Alice deleted row 3").

### Wire pattern

```ts
const cs = injector.get(ICommandService);
cs.onMutationExecutedForCollab((info, options) => {
  if (options?.fromCollab || options?.onlyLocal) return;
  ws.send({ id: info.id, params: info.params, trigger: info.params?.trigger });
});

// On receipt from peer:
cs.syncExecuteCommand(msg.id, msg.params, { fromCollab: true });
```

Watch for `params.__splitChunk__` on large mutations (`command.service.ts:108-123`) — paste-large-range and copy-worksheet are transmitted in chunks. Our collab layer must preserve and reassemble them, not flatten.

## 4. Snapshot format — `IWorkbookData`

Defined in `vendor/univer/packages/core/src/sheets/typedef.ts:29-83`.

```ts
interface IWorkbookData {
  id: string;
  rev?: number;
  name: string;
  appVersion: string;
  locale: LocaleType;
  styles: Record<string, IStyleData | null>;   // interned style table
  sheetOrder: string[];                         // tab order, sheet ids
  sheets: { [sheetId: string]: Partial<IWorksheetData> };
  defaultStyle?: IStyleData | string;
  resources?: IResources;                       // plugin-owned data (see below)
  custom?: Record<string, any>;
}
```

`IWorksheetData` (`typedef.ts:88-157`): `id`, `name`, `tabColor`, `hidden`, `freeze`, `rowCount`, `columnCount`, `mergeData: IRange[]`, `cellData: IObjectMatrixPrimitiveType<ICellData>` (sparse `{[row]: {[col]: ICellData}}`), `rowData`, `columnData`, `defaultColumnWidth`, `defaultRowHeight`, `showGridlines`, `rightToLeft`.

`ICellData` (`typedef.ts:239-283`):

```ts
interface ICellData {
  v?: string | number | boolean;    // value
  t?: CellValueType;                // 1 str, 2 num, 3 bool, 4 force-str
  f?: string;                       // formula, e.g. "=SUM(A1:B4)"
  si?: string;                      // shared/array formula group id
  ref?: string;                     // array formula range
  s?: string | IStyleData;          // style id ref OR inline style
  p?: IDocumentData;                // rich text content
  custom?: Record<string, any>;
}
```

### Resources (plugin-owned slots)

`vendor/univer/packages/core/src/services/resource-manager/type.ts:22`. Named ranges, data validation, conditional formatting, comments, hyperlinks, drawings, filters, sort — **all live under `resources` as `Array<{id?, name, data: string}>`**. Each plugin owns its slot and serializes JSON into `data`. To preserve everything across save/load, **register every plugin whose resources are present in the snapshot**, or you'll silently drop data.

### Save / load

- Load: pass `IWorkbookData` to `createUnit(UniverInstanceType.UNIVER_SHEET, snapshot)` or `FUniver.createWorkbook(snapshot)`.
- Save: `FWorkbook.save()` returns `IWorkbookData` (`vendor/univer/packages/sheets/src/facade/f-workbook.ts:167`), backed by `IResourceLoaderService.saveUnit(unitId)`.

### xlsx I/O is NOT in OSS

Confirmed. DreamNum's commercial `@univerjs-pro/exchange-client` does it. For us this means: write a bidirectional converter between `IWorkbookData` and xlsx using **ExcelJS** in our backend. Plan for fidelity loss on edge features (some formatting, some formula features, drawings, charts).

## 5. Embedding in React + Vite

Univer owns its DOM container directly — there's no `<UniverComponent />`. The React pattern is a mount effect into a ref. Minimal browser bootstrap:

```tsx
import { useEffect, useRef } from 'react';
import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { defaultTheme } from '@univerjs/themes';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverUIPlugin } from '@univerjs/ui';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import '@univerjs/sheets/facade';
import '@univerjs/sheets-ui/facade';
import '@univerjs/ui/facade';

export function SheetMount({ snapshot }: { snapshot: IWorkbookData }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const univer = new Univer({
      theme: defaultTheme,
      locale: LocaleType.EN_US,
      logLevel: LogLevel.WARN,
    });
    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, {
      container: ref.current,
      header: false, toolbar: false, footer: false,
      headerMenu: false, contextMenu: false,         // hide all native chrome
    });
    univer.registerPlugin(UniverDocsPlugin);
    univer.registerPlugin(UniverDocsUIPlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsUIPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, snapshot);
    const api = FUniver.newAPI(univer);
    return () => univer.dispose();
  }, []);
  return <div ref={ref} style={{ height: '100vh' }} />;
}
```

**Note:** the `'@univerjs/*/facade'` side-effect imports are *required* — each calls `FUniver.extend(...)` to attach methods. Forget them, and `api.getActiveWorkbook()` etc. won't exist.

## 6. Facade API surface

`FUniver` is at `vendor/univer/packages/core/src/facade/f-univer.ts:46`. `FUniver.newAPI(univer)` returns the root. Each `@univerjs/*/facade` side-effect import grows the surface via `FUniver.extend(...)` (`f-univer.ts:73`).

Useful methods we'll touch:

- `api.createWorkbook(IWorkbookData, opts)` / `api.getActiveWorkbook()` → `FWorkbook`
- `FWorkbook.save()` → `IWorkbookData` (`vendor/univer/packages/sheets/src/facade/f-workbook.ts:167`)
- `FWorkbook.getSheets()`, `getActiveSheet()`, `setName()`, `undo()`, `redo()`
- `FWorksheet.getRange(...)`, `insertRow`, `setColumnWidth`, freezes, merges
- `FRange.setValue({v, f, s, p})`, `setBackground`, `getCellData`, `getValues`
- Events: `api.addEvent(api.Event.CommandExecuted, cb)` — newer event registry (older `onCommandExecuted` is deprecated, `f-univer.ts:386`)

## 7. UI customization — hiding the native chrome

`UniverUIPlugin` config (`vendor/univer/packages/ui/src/controllers/ui/ui.controller.ts:22-62`, `vendor/univer/packages/ui/src/config/config.ts:25`):

```ts
{ container, header?: boolean, toolbar?: boolean, ribbonType?: 'collapsed'|'simple'|'classic',
  footer?: boolean, contextMenu?: boolean, headerMenu?: boolean, menu?: MenuConfig,
  customFontFamily?, popupRootId?, avatarFallback? }
```

To hide everything and render our own ribbon: `{ header: false, toolbar: false, footer: false, headerMenu: false, contextMenu: false }`. You **still must register `UniverUIPlugin`** — it provides the canvas, popup root, and keyboard scaffold; you cannot omit it for sheets.

Finer-grained menu customization is via `IMenuManagerService` (`vendor/univer/packages/ui/src/services/menu/menu-manager.service.ts:62`). Tree keyed by `MenuManagerPosition.RIBBON → RibbonPosition.START/INSERT/FORMULAS/...`. We don't need this for a fully custom ribbon — we'll build our React ribbon outside the Univer container and wire buttons to `api.executeCommand('sheet.command.*', params)`.

## 8. Headless / Node usage

`vendor/univer/examples/src/node/sdk/index.ts:42` shows `createUniverOnNode()` — registers `engine-formula`, `sheets`, `sheets-formula`, `sheets-data-validation`, `sheets-conditional-formatting`, `sheets-filter`, `sheets-sort`, `sheets-hyper-link`, `docs`, `drawing`. **No `engine-render`, no `*-ui`, no `UniverUIPlugin`.**

`vendor/univer/examples/src/node/cases/basic.ts:34` shows the calc-await pattern:

```ts
const api = FUniver.newAPI(createUniverOnNode());
const wb = api.createWorkbook({});
wb.getActiveSheet().getRange('A1').setValue({ f: '=SUM(B1:B10)' });
await awaitTime(500);                       // wait for async formula calc
const snapshot = wb.save();
```

Use this plugin set as our known-safe Node baseline. For workers, `UniverRPCNodeMainPlugin` (Node) / `UniverRPCMainThreadPlugin` (browser worker) split formula calc off the main thread.

## 9. Gotchas (version 0.22.x)

| Gotcha | Why it matters | Mitigation |
|---|---|---|
| **Plugin version mismatch throws** (`#6653`, from 0.17) | Strict version check between all `@univerjs/*` plugins | Pin every `@univerjs/*` to the same exact version |
| **`IWorkbookData` shape not stable across minors** | CHANGELOG shows mutation params + resource layouts changing | Pin version; write a migration layer if/when we upgrade |
| **Formula calc is async** when offloaded to worker | `setValue({f:...})` returns before `v` is computed | `await` calc before snapshotting (node example does `awaitTime(500)`) |
| **`document` not defined in Node** (`#6834, #6835`) | Some plugins assume browser | Stick to the `examples/src/node/sdk/index.ts` plugin set on the server |
| **`__splitChunk__` flag** on big mutations | Paste-large-range / copy-worksheet split into pieces | Collab layer must preserve the flag, not flatten chunks |
| **Cross-worksheet copy/paste bugs** in 0.18–0.19 | Regression risk if we pin to an older minor | Pin to latest stable (≥0.22) |
| **Defined name perf** | Heavy named-range workbooks were slow pre-0.22 | Less of a problem on 0.22+ but worth benchmarking |
| **Skeleton dispose race** pre-0.18 | Crash accessing worksheet after skeleton dispose | Avoid by pinning ≥0.22 |
| **xlsx I/O is Pro-only** | We must write it ourselves | ExcelJS in backend, accept fidelity loss |
| **Collab transport is Pro-only** | Same — we build it | Yjs + `onMutationExecutedForCollab` |

## 10. Quick file reference

| Concept | File |
|---|---|
| Root Univer class, IUniverConfig | `vendor/univer/packages/core/src/univer.ts:1` |
| ICommandService, collab hook | `vendor/univer/packages/core/src/services/command/command.service.ts:207, 404` |
| IWorkbookData / IWorksheetData / ICellData | `vendor/univer/packages/core/src/sheets/typedef.ts:29, 88, 239` |
| FUniver | `vendor/univer/packages/core/src/facade/f-univer.ts:46` |
| FWorkbook.save() | `vendor/univer/packages/sheets/src/facade/f-workbook.ts:167` |
| UI hide-chrome config | `vendor/univer/packages/ui/src/controllers/ui/ui.controller.ts:22` |
| Menu manager | `vendor/univer/packages/ui/src/services/menu/menu-manager.service.ts:62` |
| Headless Node bootstrap | `vendor/univer/examples/src/node/sdk/index.ts:42` |
| Browser bootstrap reference | `vendor/univer/examples/src/sheets/main.ts:100` |
| Version-by-version gotcha log | `vendor/univer/CHANGELOG.md` |
