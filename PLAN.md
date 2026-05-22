# Casual Sheets — Plan

Web-based Excel-equivalent with real-time co-editing.
Upload `.xlsx` → open in browser → multiple users edit together, anonymously, no accounts.

---

## Scope

### In scope
- Excel / Office UX: ribbon, formula bar, file-centric workflow.
- Upload `.xlsx` → open in a shared room → download back as `.xlsx`.
- Multi-user co-editing in real time (cursors, selections, live typing).
- In-memory sessions — state lives while at least one user is connected, with a grace-period GC after the last client leaves.
- Optional Redis persistence for sessions that survive server restarts.

### Out of scope (deferred)
- **Persistence / WOPI** — no DB, no autosave to disk, no SharePoint/OneDrive integration.
- **Auth / accounts** — anonymous sessions identified by room URL.
- **AI / LLM features** — the Univer command bus is extensible; plug your own model in later.
- **Mobile** — desktop browsers only.

### Out of scope (forever)
- 100% Excel feature parity — Excel has 30+ years of features; we ship the 80% that matter.
- Pixel-perfect Office clone — "clearly inspired by / familiar to Office users" is the bar.

---

## Phase status

### ✅ Phase 0 — Spikes (complete)
All three technical risks proved out:
- **Spike A (Yjs bridge)** — two browsers, edits visible in < 250 ms.
- **Spike B (xlsx round-trip)** — ExcelJS parse + export with acceptable fidelity.
- **Spike C (UI override)** — Univer default chrome hidden, custom ribbon wired.

### ✅ Phase 1 — Single-user Excel-flavored editor (complete)
- Custom Office-style ribbon: Home, Insert, Formulas, Data, View, Review tabs.
- Formula bar with editable Name Box.
- Status bar: SUM / AVG / COUNT / MIN / MAX, zoom, sheet tabs.
- Full xlsx / ods / csv / tsv open + save, worker-side.
- All major Excel keyboard shortcuts.
- 337 Playwright e2e tests locking the surface.

### ✅ Phase 2 — Real-time co-editing (complete)
- Hocuspocus server + Yjs bridge plugin.
- Room lifecycle: create on upload, GC after TTL.
- Share URL: anyone joins. Password-protected rooms with SHA-256 gate.
- View-only role enforced at the Univer engine layer.
- Redis persistence (optional, 7-day TTL).
- Joiner fast-path: gzip-streamed snapshot, skips xlsx parse.
- Op-log compaction (Stage 6) for long-lived rooms.
- Self-hosted Docker image: web + Hocuspocus + Fastify in one container.

### ✅ Phase 3 — Presence + polish (complete)
- Peer cursors on the grid (scroll-tracked, frozen-pane-aware, zoom-aware).
- Live-typing ghost: characters appear in the peer's cell as they type.
- Presence avatars with "Active now / Last seen Ns ago" tooltips.
- "Waiting to reconnect" banner + faster offline detection.
- Divergence detector: amber "Out of sync" pill when state vectors diverge.
- Session-history side panel: per-room op log, timestamps, revert.

### ✅ Phase 4 — Feature breadth + co-edit fidelity (complete — v0.0.5)
- Charts P1–P5b: insert dialog, 8 chart types, drag/resize, format dialog, collab sync, PNG embed in xlsx.
- Pivot tables P0: group-by + aggregate from Insert menu.
- Conditional formatting, data validation, drawings — all co-edit synced.
- Workbook/worksheet metadata (tab colors, zoom, freeze, sheet visibility) co-edit synced.
- Autosave to IndexedDB with restore banner on reload.
- ODS fidelity: styles, dimensions, freeze, hyperlinks, comments, defined names.
- 30+ additional Excel keyboard shortcuts.

---

## What's next

### P5 — Excel parity + remaining gaps

| Area | What's needed |
| --- | --- |
| Pivot tables | P1: filter fields, drill-down, multiple value aggregations, refresh |
| Charts | Format series individually; trendlines; date-axis handling |
| xlsx round-trip | Complex pivot cache, VBA stub passthrough, more numfmt edge cases |
| Co-edit | Server-side view-only enforcement; multi-range presence fidelity |
| UX | Recent-files / landing page; display-name edit surface post-join |

### P6 — WOPI host integration (deferred)

When persistence is required: add a Hocuspocus persistence adapter (Postgres or S3-backed) and implement the WOPI host contract. The collab layer doesn't change — only the storage backend.

---

## Architecture reference

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full diagram and data flows.

| Concern | Pick |
| --- | --- |
| Grid + formula engine | Univer OSS 0.22.x |
| Frontend | React 18 + Vite + TypeScript strict |
| Collab | Yjs + Hocuspocus over WebSocket |
| xlsx I/O | ExcelJS in Web Workers |
| ods / csv / tsv | `@e965/xlsx` in Web Workers |
| Charts | ECharts overlay anchored to cell ranges |
| Persistence | Redis optional, 7-day TTL |
| Container | Node 22 Alpine, multi-arch (amd64 + arm64) |
| Tests | Playwright (Chromium), 337 e2e tests |
