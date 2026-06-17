# Co-editing — design

Real-time collaborative editing layered on top of the single-user editor.
Available in the self-hosted Docker image; the GitHub Pages demo at `sheet.casualoffice.org` stays single-user.

---

## Goals

- Two browsers editing the same sheet see each other's edits within ≈250 ms.
- Anonymous sessions — anyone with the room URL can edit. No accounts.
- Password-protected rooms with role-based access (edit / view-only).
- In-memory only by default; optional Redis persistence (7-day TTL) for sessions that survive restarts.
- Single Docker image (`casualoffice/sheets`) — one command to self-host.

## Out of scope

- Persistence beyond room lifecycle (no Postgres, no S3, no WOPI).
- Auth / per-user accounts.
- Multi-room load balancing / horizontal scaling — single process, in-memory.

---

## Stack

| Concern | Pick |
| --- | --- |
| Sync transport | Yjs (CRDT) + Hocuspocus WebSocket server |
| HTTP / WebSocket | Fastify + `@hocuspocus/server` |
| Persistence | Redis (optional, 7-day TTL on Y.Doc binary updates) |
| Distribution | Single multi-stage Dockerfile, Node 22 Alpine |

---

## Architecture

```
┌────────────────────────── Browser ───────────────────────────┐
│                                                              │
│  Casual Sheets (built static bundle)                         │
│  ├── Univer OSS — grid + formulas + rendering                │
│  ├── Yjs ↔ Univer bridge (apps/web/src/collab/bridge.ts)    │
│  │     subscribe → ICommandService.onMutationExecutedForCollab│
│  │     apply remote → executeCommand(…, { fromCollab: true })│
│  ├── CollabDriver.tsx — join/leave/reconnect state machine   │
│  ├── PresenceLayer.tsx — peer cursor overlay                 │
│  ├── AvatarStack.tsx — title-bar presence                    │
│  ├── HistoryPanel.tsx — per-room op log                      │
│  └── y-websocket-provider → wss://host/yjs                   │
│                                                              │
└────────────────────────────┬─────────────────────────────────┘
                             │ WebSocket /yjs
                             ▼
┌────────────────────── Node server ───────────────────────────┐
│                                                              │
│  Fastify (HTTP)                                              │
│  ├── GET  /                    serves the built web app      │
│  ├── GET  /r/:roomId           same SPA, room context        │
│  ├── POST /api/rooms           create room {password?, seed?}│
│  ├── GET  /api/rooms/:id/info  {needsPassword, hasSeed, …}  │
│  ├── POST /api/rooms/:id/seed  xlsx upload                   │
│  ├── GET  /api/rooms/:id/seed  download seed                 │
│  ├── POST /api/rooms/:id/snapshot  gzip snapshot upload      │
│  ├── GET  /api/rooms/:id/snapshot  joiner fast-path          │
│  └── GET  /health              liveness                      │
│                                                              │
│  Hocuspocus (WebSocket /yjs)                                 │
│  ├── Room registry Map<roomId, RoomState>                    │
│  ├── Password gate: SHA-256, close code 4401 on fail         │
│  ├── Op-log compaction on requestIdleCallback (Stage 6)      │
│  └── GC: throwaway rooms evicted after TTL; seeded/password  │
│          rooms kept indefinitely (or until Redis TTL expires) │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Yjs document schema

One `Y.Doc` per room. Structure mirrors `IWorkbookData`:

```
Y.Doc
├─ Y.Map "meta"         { id, name, sheetOrder[], locale, appVersion }
├─ Y.Map "styles"       { [styleId]: IStyleData }
├─ Y.Map "sheets"
│   └─ Y.Map [sheetId]
│       ├─ Y.Map "meta"       { name, tabColor, hidden, zoom, freeze… }
│       ├─ Y.Map "cells"      { "r:c": ICellData }
│       ├─ Y.Array "merges"
│       ├─ Y.Map "rowData"    { [row]: IRowData }
│       └─ Y.Map "columnData" { [col]: IColumnData }
├─ Y.Map "resources"    plugin-defined payloads
│   ├─ "SHEET_CONDITIONAL_FORMAT_PLUGIN"
│   ├─ "DATA_VALIDATION_PLUGIN"
│   ├─ "DRAWING_PLUGIN"
│   └─ "CASUAL_SHEETS_CHARTS"
└─ Y.Map "defined-names"  { [name]: IDefinedNameData }
```

**Conflict semantics:** last-writer-wins on Y.Map leaves — acceptable Excel semantics.

**What we don't sync:** computed formula results (`v` on a cell with `f`). Each client computes locally. Keeps payload small and avoids `RAND()` / `NOW()` divergence.

---

## Bridge contract

### Local edit → Yjs

1. Subscribe to `ICommandService.onMutationExecutedForCollab` — fires for `CommandType.MUTATION` only, including `syncOnly` mutations. See `vendor/univer/packages/core/src/services/command/command.service.ts:404`.
2. Translate mutation `id` to Y.Doc operations. Coalesce per microtask via `doc.transact` — one paste / sort / fill = one Yjs encode = one WS frame.
3. Wrap in `doc.transact(…, ORIGIN_LOCAL)` so the remote listener skips our own updates.

### Remote update → Univer

1. `doc.on('update', …)` with `origin !== ORIGIN_LOCAL` filter.
2. Decode mutation(s) from the Y.Doc diff.
3. `deepRewriteUnitId` to patch the local unit ID throughout the params tree.
4. `cs.syncExecuteCommand(id, params, { fromCollab: true })` — the `fromCollab` flag prevents the `onMutationExecutedForCollab` hook from re-broadcasting (echo-loop prevention).

### Echo-loop prevention

Two independent layers, both required:

- **Yjs origin**: local mutations go through `doc.transact(fn, ORIGIN_LOCAL)`. Listener checks `origin !== ORIGIN_LOCAL`.
- **Univer fromCollab**: remote commands carry `{ fromCollab: true }`. `onMutationExecutedForCollab` skips these.

If either breaks, a single edit ping-pongs until the formula engine saturates. Echo regression is covered by `tests/e2e/coedit.spec.ts`.

---

## Presence

Peer state is routed via **Yjs Awareness** (separate from the document — doesn't affect undo/redo):

```ts
provider.awareness.setLocalStateField('cursor', { sheetId, row, col })
provider.awareness.setLocalStateField('selection', { sheetId, range })
provider.awareness.setLocalStateField('liveEdit', { sheetId, row, col, value })
provider.awareness.setLocalStateField('user', { name, color, lastSeen })
```

`PresenceLayer.tsx` renders a `<canvas>` overlay that paints each peer's selection rect, cursor, and name label. Cursor positions are recomputed on scroll and on zoom changes so they stay pinned to the correct cell in frozen panes.

`AvatarStack.tsx` in the title bar shows up to 4 peer initials + a `+N` overflow chip. Tooltips show "Active now" or "Last seen Ns ago".

`LiveEditGhost.tsx` renders character-by-character preview in the peer's current edit cell.

---

## Security

- **Password gate**: `POST /api/rooms` accepts `{ password }`. Hashed with SHA-256 + constant-time compare. Failing the WS upgrade returns close code `4401`; the client routes this to a retry prompt.
- **View-only enforcement**: Hocuspocus tags the session role. On the client, `CollabDriver` sets `WorkbookEditablePermission = false` on the Univer workbook, blocking all mutations at the engine layer — not just the UI.
- **Known gap**: the server itself does not reject mutations from view-only WebSocket connections. A client that bypasses the Univer permission gate could still push ops. Server-side enforcement is tracked as a P0 for the next cycle.

---

## Room lifecycle

| Event | What happens |
| --- | --- |
| `POST /api/rooms` | New `Y.Doc`, optionally seeded from xlsx. Returns `{ roomId }`. |
| WS connect `/yjs?room=X&p=<pw>` | Hocuspocus joins the Y.Doc; replays state to the joiner. |
| Last client disconnects | Room marked idle; timer starts. |
| Idle > `ROOM_TTL_MIN` | Throwaway rooms (no password, no seed) evicted. Password/seeded rooms kept. |
| Redis configured | Y.Doc binary updates persisted; survives server restart. |
| Redis TTL expires | Room data purged after 7 days of inactivity. |

---

## Joiner fast-path

When the owner shares a room, the client uploads a gzipped `IWorkbookData` snapshot to `POST /api/rooms/:id/snapshot`. Joiners fetch it from `GET /api/rooms/:id/snapshot` (immutable-cached) and install it directly — skipping the xlsx parse entirely. Any ops that arrived after the snapshot was taken are replayed by the Yjs provider on connect.

---

## Op-log compaction (Stage 6)

Long-lived rooms accumulate Y.Doc binary updates. The server schedules a compaction pass (full snapshot re-encode + update-log discard) on `requestIdleCallback` when the room is active but quiet. Compacted state is written back to Redis if persistence is enabled. This keeps memory bounded for multi-hour sessions.

---

## Self-host

```sh
# Quick start — in-memory, no persistence:
docker run --rm -p 3000:3000 casualoffice/sheets:latest

# With Redis — rooms survive restarts:
docker compose up -d
```

See [`docs/DOCKERHUB.md`](./DOCKERHUB.md) for the full compose snippet and configuration reference.
