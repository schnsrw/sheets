# Architecture

System architecture for the sheet service. Focus: how *our* code is laid out and how the pieces talk. For Univer internals see [`RESEARCH.md`](./RESEARCH.md).

## Top-down diagram

```
┌─────────────────────────────── Browser ───────────────────────────────┐
│                                                                       │
│  React app (Vite, TypeScript)                                         │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Office-style shell  (our React)                                │ │
│  │  ├─ Title bar / file menu (Open, Download)                      │ │
│  │  ├─ Ribbon tabs (Home → Insert → Formulas → Data → Review → View)│ │
│  │  ├─ Formula bar (Univer's, restyled)                            │ │
│  │  ├─ ┌───────────────────────────────────────────────────────┐   │ │
│  │  │  │  Univer canvas (grid + cell editor + popups)           │   │ │
│  │  │  │  ↑ commands via FUniver / api.executeCommand          │   │ │
│  │  │  └───────────────────────────────────────────────────────┘   │ │
│  │  └─ Status bar (cell stats, zoom, presence avatars)             │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│         │                                       ▲                     │
│         │ ICommandService                       │ syncExecuteCommand  │
│         │ .onMutationExecutedForCollab          │ ({fromCollab:true}) │
│         ▼                                       │                     │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  collab-bridge plugin (our Univer plugin)                       │ │
│  │  ├─ Outgoing: capture mutation → Yjs update                     │ │
│  │  └─ Incoming: Yjs update → syncExecuteCommand(.., fromCollab)   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│         │                                       ▲                     │
│         │  Y.Doc updates                        │  Y.Doc updates      │
│         ▼                                       │                     │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Yjs client + y-websocket provider                              │ │
│  │  ├─ Y.Doc structured to mirror IWorkbookData                    │ │
│  │  └─ Awareness (cursor, selection, user)                         │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────┬──────────────────────────────────────┘
                                 │ WebSocket (Yjs protocol)
                                 ▼
┌─────────────────────────── Node server ───────────────────────────────┐
│                                                                       │
│  Hocuspocus server                                                    │
│  ├─ In-memory rooms (no DB)                                           │
│  ├─ Awareness routing                                                 │
│  └─ Room gc: empty + 5min grace → discard                             │
│                                                                       │
│  HTTP endpoints (Fastify or express)                                  │
│  ├─ POST /upload    .xlsx → IWorkbookData → seed Yjs room → {roomId}  │
│  └─ GET  /download/:room  Y.Doc → IWorkbookData → .xlsx               │
│                                                                       │
│  xlsx ↔ IWorkbookData converter (server-side)                         │
│  ├─ Headless Univer (no engine-render, no *-ui)                       │
│  └─ ExcelJS for the actual xlsx parsing / writing                     │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Frontend app — `apps/web/` (planned)

Vite + React + TypeScript. Single-page app, routes:

- `/` — landing, upload dropzone.
- `/r/:roomId` — editor.

Owns: Office-style chrome, Univer mount, Yjs client, collab-bridge plugin.

### 2. Collab-bridge plugin — `packages/collab-bridge/` (planned)

A standard Univer plugin (registered with `univer.registerPlugin(...)`). Single responsibility: keep Univer ↔ Y.Doc in sync.

**Outgoing path:**

```ts
const cs = injector.get(ICommandService);
cs.onMutationExecutedForCollab((info, options) => {
  if (options?.fromCollab || options?.onlyLocal) return;
  applyMutationToYDoc(yDoc, info);   // translate to Y.Map / Y.Array ops
});
```

**Incoming path:**

```ts
yDoc.on('update', (update, origin) => {
  if (origin === 'local') return;
  const mutations = ydocUpdateToMutations(update, yDoc);
  for (const m of mutations) {
    cs.syncExecuteCommand(m.id, m.params, { fromCollab: true });
  }
});
```

**Yjs document shape** mirrors `IWorkbookData`:

```
Y.Doc
├─ Y.Map "meta"        { id, name, sheetOrder[], appVersion }
├─ Y.Map "styles"      { [styleId]: IStyleData }
├─ Y.Map "sheets"
│   └─ Y.Map [sheetId]
│       ├─ Y.Map "meta"      { name, freeze, rowCount, ... }
│       ├─ Y.Map "cells"     { "r:c": { v, t, f, s, ... } }
│       ├─ Y.Array "merges"
│       ├─ Y.Map "rowData"
│       └─ Y.Map "columnData"
└─ Y.Map "resources"   { [pluginKey]: <plugin-defined> }
```

Cells stored as `"r:c" → ICellData` is the conflict-resolution unit. Last-writer-wins on a cell is acceptable Excel-like semantics.

### 3. Office-style shell — `apps/web/src/shell/` (planned)

Pure React, no Univer dependency except for issuing commands. Components:

- `<TitleBar>` — filename, breadcrumbs, presence avatars right-aligned.
- `<Ribbon>` — tabs, groups, buttons. Phase 1 ships Home tab only.
- `<FormulaBar>` — wraps Univer's formula bar element OR renders our own and posts to Univer commands.
- `<StatusBar>` — cell stats (SUM/AVG/COUNT) from current selection, zoom, sheet tabs.

All buttons dispatch via the Facade API:

```ts
api.executeCommand('sheet.command.set-style', { ... });
```

Styling: Fluent UI icons + Tailwind (TBD — confirm before Phase 1).

### 4. Server — `apps/server/` (planned)

Single Node process. Two responsibilities:

**A. Hocuspocus collab server.** Hosts rooms, routes Yjs updates and awareness. In-memory only. Rooms gc after 5 min empty.

**B. HTTP endpoints.**

- `POST /upload` — multipart xlsx upload. Parse with ExcelJS, convert to `IWorkbookData` (seed with headless Univer to compute formulas if needed), create Hocuspocus room with that as the initial Y.Doc state, return `{ roomId }`.
- `GET /download/:roomId` — read current Y.Doc, materialize back to `IWorkbookData`, hand to ExcelJS to write xlsx, stream response.

### 5. xlsx converter — `packages/xlsx-converter/` (planned)

Pure conversion functions, shared between server upload and download paths. Bidirectional, lossy at the edges.

```ts
xlsxToWorkbookData(buffer: Buffer): Promise<IWorkbookData>
workbookDataToXlsx(data: IWorkbookData): Promise<Buffer>
```

Internally uses ExcelJS. What we map: cells (value, formula, type, basic style), styles (font, fill, border, alignment, numfmt), merges, named ranges, sheet structure (order, names, hidden). What we accept losing initially: charts, drawings, pivot tables, advanced formatting, data validation edge cases.

## Data flow — three paths

### Path A: Upload → open

1. Browser: user drops `file.xlsx` on landing page.
2. Browser: `POST /upload` with multipart body.
3. Server: ExcelJS parses → `xlsx-converter` produces `IWorkbookData`.
4. Server: spin up headless Univer, `createWorkbook(data)`, await any async formula calc, `wb.save()` → canonical `IWorkbookData` (this normalizes formula results and resource shapes).
5. Server: create Hocuspocus room, seed Y.Doc with the canonical snapshot.
6. Server: respond `{ roomId }`.
7. Browser: navigate to `/r/:roomId`. Editor mounts. Yjs syncs the seeded doc into the local Univer instance.

### Path B: Live edit

1. User edits cell A1 in Browser X.
2. Univer dispatches `sheet.command.set-range-values` → mutation `sheet.mutation.set-range-values`.
3. `collab-bridge` observes via `onMutationExecutedForCollab`, applies to local Y.Doc.
4. y-websocket provider sends Y.Doc update over WS to server.
5. Server broadcasts to peers.
6. Browser Y receives, applies update to its Y.Doc.
7. `collab-bridge` in Browser Y observes Y.Doc change, replays as `syncExecuteCommand(.., { fromCollab: true })`.
8. Univer in Browser Y re-renders.

End-to-end latency target: < 250 ms LAN, < 500 ms WAN.

### Path C: Download

1. User clicks Download in any browser.
2. Browser: `GET /download/:roomId`.
3. Server: reads current Y.Doc state, materializes `IWorkbookData`.
4. Server: optionally rehydrates in headless Univer to recompute formulas to canonical values.
5. Server: `xlsx-converter.workbookDataToXlsx(data)` → buffer → stream as response.

## Repo layout (planned, when code begins)

```
.
├── README.md
├── CLAUDE.md
├── PLAN.md
├── docs/{ARCHITECTURE,RESEARCH}.md
├── package.json                ← pnpm workspace root
├── pnpm-workspace.yaml
├── apps/
│   ├── web/                    ← Vite + React frontend
│   └── server/                 ← Node + Hocuspocus + HTTP
├── packages/
│   ├── collab-bridge/          ← Univer plugin, browser-only
│   ├── xlsx-converter/         ← bidirectional, isomorphic
│   └── shared/                 ← types shared across web + server
└── vendor/univer/              ← READ-ONLY clone; never in workspace
```

Build orchestrator: pnpm + turbo (decide before Phase 1 begins).

## Key design decisions and rationale

| Decision | Why |
|---|---|
| Univer OSS, not Pro | OSS license, no vendor lock, full control over the stack. |
| Yjs over OT/ShareDB | Operates without a central authority for resolution; well-trodden patterns; awareness protocol included. |
| Build collab via `onMutationExecutedForCollab`, not by intercepting UI events | This is the hook Univer exposes for exactly this purpose. UI-level interception misses programmatic edits, formula recalc-triggered cell changes, and undo/redo. |
| Hocuspocus over raw y-websocket | Auth hooks, persistence adapters, lifecycle events. We don't use persistence now but we'll want it later. |
| In-memory only, no DB | Project scope. WOPI integration deferred. Simplifies massively. |
| Office-style ribbon ourselves, not Univer's toolbar | Univer's default UI is Sheets-style; replacing it is unavoidable for our UX target. |
| ExcelJS, not SheetJS | Apache-2.0 license, broadly compatible. SheetJS Community has stricter licensing on some features. |
| Headless Univer for server-side xlsx round-trip | Server uses the same data model and formula engine as the browser, eliminating an entire class of "the server got a different result than the browser" bugs. |
| No persistence layer | Out of scope. Adding later means adding a Hocuspocus persistence adapter — the collab layer doesn't change. |

## Risks tracked

| Risk | Severity | Spike |
|---|---|---|
| Univer ↔ Yjs bridge complexity is higher than expected | **High** — gates the whole project | Spike A in `PLAN.md` |
| ExcelJS round-trip loses too much fidelity for real xlsx files | Medium | Spike B in `PLAN.md` |
| Hiding Univer's chrome leaves visible gaps or breaks something | Low | Spike C in `PLAN.md` |
| Formula non-determinism (`NOW()`, `RAND()`) breaks convergence | Medium | Address in collab-bridge: seeded RNG or designated authority client |
| Univer 0.x version churn breaks our snapshot assumptions | Medium | Pin version; CHANGELOG check before any upgrade |
| Large workbook (> 50k cells) overwhelms Yjs document | Medium | Enforce upload cap; benchmark before Phase 2 close |

## What's missing from this doc

Filled in as we go:

- Exact ribbon contents per tab (Phase 1 covers Home only).
- Permission/auth model (deferred — see CLAUDE.md).
- Persistence adapter design (deferred until WOPI work begins).
- Deployment topology (deferred until something runs).
