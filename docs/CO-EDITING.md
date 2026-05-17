# Co-editing — design

> Phase 2 — real-time collaborative editing layered on top of the Phase 1
> single-user editor. Shipped as a self-hosted Docker image; the GitHub
> Pages build at `sheet.schnsrw.live` stays single-user.

## Goals (v1)

- Two browsers editing the same sheet see each other's edits within ≈250 ms.
- Anonymous sessions — anyone with the room URL can edit. No accounts.
- In-memory only — no DB, no autosave. State dies with the room (after a
  grace period when the last client leaves).
- Single Docker image (`schnsrw/casual-sheets`) — one command to self-host.

## Out of scope (v1)

- Persistence beyond the room lifecycle (no Postgres, no S3, no WOPI).
- Auth / sharing UI / per-user permissions.
- Awareness presence (cursors, name badges) — Phase 3.
- Multi-room load balancing / horizontal scaling. v1 = one process, in-memory.

## Stack

| Concern             | Pick                                                     |
| ------------------- | -------------------------------------------------------- |
| Sync transport      | Yjs (CRDT) + Hocuspocus WebSocket server                 |
| HTTP / WebSocket    | Fastify + `@hocuspocus/server`                           |
| Workbook conversion | ExcelJS (same as the existing client xlsx I/O)           |
| Distribution        | Single multi-stage Dockerfile, Node 22 alpine runtime    |

Yjs is the canonical CRDT for collaborative documents; Hocuspocus is the
well-maintained reference server. Both are MIT-licensed.

## Architecture

```
┌──────────────────────── Browser ─────────────────────────┐
│                                                          │
│  Casual Sheets (built static bundle)                     │
│  ├── Univer OSS — grid + formulas + rendering            │
│  ├── Yjs ↔ Univer bridge (apps/web/src/collab/)         │
│  │     subscribe → ICommandService.onMutationExecutedForCollab │
│  │     apply remote → executeCommand(…, { fromCollab: true })  │
│  └── y-websocket-provider → wss://host/yjs               │
│                                                          │
└──────────────────────────┬───────────────────────────────┘
                           │ WebSocket
                           ▼
┌──────────────────────── Node server ─────────────────────┐
│                                                          │
│  Fastify (HTTP)                                          │
│  ├── GET  /                — serves the built web app    │
│  ├── GET  /r/:roomId       — same SPA, room context      │
│  ├── POST /api/rooms       — create empty / from xlsx    │
│  ├── GET  /api/rooms/:id/download — serialize → xlsx     │
│  └── GET  /health          — liveness                    │
│                                                          │
│  Hocuspocus (WebSocket)                                  │
│  ├── ws  /yjs              — Yjs sync protocol           │
│  ├── room registry (Map<roomId, RoomState>)              │
│  └── idle GC: free room after N minutes with 0 clients   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

One process, one image. The server both serves the built frontend and
handles WebSocket sync. Self-host with:

```sh
docker run -p 3000:3000 schnsrw/casual-sheets:latest
# open http://localhost:3000
```

## Yjs document schema

Per workbook, one `Y.Doc` is structured as:

```ts
// Top-level
doc.getMap('meta')                 // { name, createdAt, lastEditedAt }
doc.getMap('sheets')               // sheetId → Y.Map<SheetData>

// Per sheet (Y.Map<SheetData>)
sheet.get('name')          → Y.Text     // sheet name (mutable)
sheet.get('cellData')      → Y.Map      // rowKey → Y.Map (colKey → Y.Map<CellData>)
sheet.get('mergeData')     → Y.Array    // IRange[]
sheet.get('columnData')    → Y.Map      // colKey → { w, hd }
sheet.get('rowData')       → Y.Map      // rowKey → { h, hd }

// Per cell (Y.Map<CellData>)
cell.get('v') → primitive | null    // value
cell.get('f') → string | null       // formula
cell.get('s') → string | null       // style id
cell.get('p') → Y.Map | null        // rich-text body (hyperlinks, etc.)
```

**Why a row-keyed `Y.Map` instead of a flat `Y.Map<"row,col", Cell>`**: row /
column inserts shift thousands of cells in a single Univer mutation. Keying
by row lets us insert/move a single Y.Map entry instead of N cell-level
operations. Trades off slightly more nesting on cell reads.

**What we DON'T sync**:

- Computed formula results (`v` on a cell with `f`). Each client computes
  locally — keeps the Yjs payload small and avoids `RAND()` / `NOW()`
  non-determinism per PLAN.md §"The hard part".
- Selection / cursor / scroll position. Belongs in **awareness** (Phase 3),
  not in the doc itself.
- Plugin extras that already live in `IWorkbookData.resources` (tables,
  hyperlinks, outline groups) — Phase 2.1.

## Bridge contract (Univer ↔ Yjs)

Two directions, both load-bearing.

### Local edit → Yjs

1. Subscribe to `ICommandService.onMutationExecutedForCollab` (per
   [`CLAUDE.md`](../CLAUDE.md)). This is the only hook that fires for
   `CommandType.MUTATION` and includes `syncOnly` mutations.
2. Discriminate on mutation `id`:
   - `sheet.mutation.set-range-values` → write cells into Y.Map.
   - `sheet.mutation.move-rows` / `move-cols` / `insert-row` / etc. →
     reshape `cellData` map.
   - `sheet.mutation.set-row-hidden` / `set-col-hidden` → patch row/col data.
3. Wrap each in a `doc.transact(…, ORIGIN_LOCAL)` block so the remote
   listener can skip our own edits.

### Remote update → Univer

1. Subscribe to `doc.on('update', …)` with `origin !== ORIGIN_LOCAL` filter.
2. Diff the changed `Y.Map` paths against the last-applied snapshot.
3. For each change, dispatch the equivalent Univer command **with
   `IExecutionOptions.fromCollab = true`** (per
   [`CLAUDE.md`](../CLAUDE.md)) so the `onMutationExecutedForCollab` hook
   doesn't re-broadcast.

### Echo-loop prevention

Two layers, both required:

- **Yjs origin**: every local mutation goes through `doc.transact(fn,
  ORIGIN_LOCAL)`. The update listener checks `origin !== ORIGIN_LOCAL`
  before applying.
- **Univer fromCollab**: remote-applied commands carry `fromCollab: true`
  in the execution options. Univer's `onMutationExecutedForCollab` skips
  these per its built-in filter.

If either layer breaks, a single edit ping-pongs until the formula engine
chokes. Test against echo regression on every bridge change.

## Room lifecycle

| Event                       | What happens                                      |
| --------------------------- | ------------------------------------------------- |
| `POST /api/rooms`           | New `Y.Doc`, seeded (empty or from uploaded xlsx). Returns `{ roomId }`. |
| WS connect to `/yjs?room=X` | Hocuspocus joins the room's Y.Doc, replays state. |
| Last client disconnects     | Room marked idle. Timer starts.                   |
| Idle > `ROOM_TTL_MIN` (5)   | Room evicted, Y.Doc freed.                        |
| Server restart              | All rooms lost. Re-upload to recover.             |

Limits enforced at upload time:

- File size cap: 25 MB (Fastify multipart limit).
- Cell count cap: 50 000 used cells (rejects "fix-my-50-row-sheet" oddities
  early, not at edit time when the engine has already chewed through them).

## Self-host

### Build the image locally

```sh
docker build -t schnsrw/casual-sheets:dev .
```

### Run

```sh
docker run --rm -p 3000:3000 schnsrw/casual-sheets:dev
# open http://localhost:3000
```

### Compose (development with hot reload)

```sh
docker compose up
# - web hot-reloads on localhost:5273 (Vite)
# - server hot-reloads on localhost:3000 (tsx watch)
# - WS at ws://localhost:3000/yjs
```

### Compose (production)

```sh
docker compose -f docker-compose.prod.yml up -d
# single combined image, serves on :3000
```

## Test plan

1. **Spike — one-cell sync.** Two Playwright contexts open the same
   `/r/:roomId`. Edit A1 in context 1. Within 1 s, A1 shows the new value
   in context 2. Lock down with `tests/e2e/coedit.spec.ts`.
2. **Echo-loop guard.** Same setup. Edit A1 ten times rapidly. Both
   contexts agree on the final value AND total Yjs update count ≤ 10 + 2
   (small slack for awareness chatter). Catches "remote update re-broadcasts
   as local" regressions.
3. **Room teardown.** Create a room, close both contexts, wait
   `ROOM_TTL_MIN` + a beat, reconnect with the same id, expect a fresh
   empty document. Confirms idle GC.
4. **xlsx round-trip through a room.** Upload .xlsx, open the returned
   roomId, download, compare cell values to the original. Confirms the
   Yjs schema lossless-converts to/from Univer's `IWorkbookData`.

## Open decisions (revisit after the spike)

1. **Formula `v` strategy.** Drop computed values from sync entirely, or
   sync the writer's value and let readers re-compute on next edit? The
   first is simpler; the second avoids a flash of stale value on slow
   formula engines.
2. **Style sharing.** Cells reference `styles[styleId]`. When two clients
   add the same style independently, we get two different IDs. Either:
   merge equivalent styles client-side, or accept the duplication (cheap
   on memory, no semantic problem).
3. **Conflict UX.** Last-writer-wins is fine for cell values. Worth
   surfacing in the UI when a user's edit is silently overridden?
   Probably "no" for v1 — adds chrome without clear value.

These are intentionally left open until the spike tells us what hurts in
practice.
