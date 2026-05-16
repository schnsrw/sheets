# Sheet Service — Plan

Web-based **Excel-equivalent** with real-time co-editing.
Upload `.xlsx` → open in browser → multiple users edit together.

## Scope

### In scope (project scope)
- Look & feel close to **Microsoft Excel / Office** (ribbon UI, Office shortcuts, file-centric flow), not Google Sheets.
- Upload an existing `.xlsx` file → open it in a shared session.
- Multiple users edit the same sheet in real time (cursors, selections, live cell updates).
- In-memory session only (state lives while at least one user is connected; lost when room empties + grace period).
- Download the edited workbook back as `.xlsx` (round-trip).

### Out of scope (for now)
- **Persistence.** No DB, no autosave to disk. WOPI integration comes later.
- **Auth / accounts.** Anonymous sessions identified by room URL.
- **AI features.** Will plug in a self-hosted LLM later through Univer's command bus — not part of this build.
- **Mobile.** Desktop browsers only.
- **Sharing / permissions UI.** Anyone with the room URL can edit.

### Out of scope (forever — accept the gap)
- 100% Excel feature parity. Excel has 30+ years of features; we ship the 80% that matter.
- Pixel-perfect Office UI clone. We aim for "clearly inspired by / familiar to Office users."

---

## Why "Excel-like" changes the build

This is the most important decision. Univer's default UI is closer to Google Sheets — a single toolbar, minimal chrome. Office is a different UX model:

| Aspect | Google Sheets style | Excel / Office style |
|---|---|---|
| Top chrome | Thin toolbar | **Ribbon** with tabs (Home, Insert, Formulas, Data, Review, View) |
| File model | Doc-centric, autosaving | **File-centric**, open / save-as / close |
| Shortcuts | Mac-friendly, web-focused | Excel-canonical (F2, Ctrl+Shift+L, Alt+= etc.) |
| Cell editing | Inline editor | Inline + **formula bar** above grid |
| Right-click | Contextual menu | Contextual menu **+ mini toolbar** |
| Status bar | Minimal | Cell stats (SUM/AVG/COUNT), zoom, view toggles |

Implication: we **keep Univer's engine + grid + formula bar** but **replace its UI shell** with our own ribbon + status bar. Univer is plugin-based, so this is doable — but it's real work (estimated 2–4 weeks of UI alone).

---

## Architecture

```
┌─────────────────────────── Browser ──────────────────────────┐
│                                                              │
│  React app (Vite)                                            │
│  ├── Custom Office-style shell (ribbon, formula bar, status) │
│  ├── Univer OSS  ◄── grid, formulas, rendering              │
│  └── Yjs client  ◄── collab sync                            │
│                                                              │
└──────────────────────────────┬───────────────────────────────┘
                               │ WebSocket (Yjs protocol)
                               ▼
┌──────────────────────── Node server ─────────────────────────┐
│                                                              │
│  Hocuspocus (Yjs server)                                     │
│  ├── In-memory room state (no DB)                           │
│  ├── Awareness (cursors, presence)                          │
│  └── Room lifecycle (gc empty rooms after N min)            │
│                                                              │
│  HTTP endpoints                                              │
│  ├── POST /upload  → parse xlsx → seed Yjs room → return ID │
│  └── GET  /download/:room → serialize current state → xlsx  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Stack picks (no AI):**
- Frontend: Vite + React + TypeScript + Univer OSS
- Collab: Yjs + Hocuspocus server
- xlsx I/O: ExcelJS (Apache-2.0, server-side)
- UI: Tailwind or vanilla CSS; icons via Fluent UI icons (matches Office)
- Hosting later: any Node host + static CDN for frontend

---

## Data flow

### Upload → open
1. User drops `.xlsx` on landing page → `POST /upload`.
2. Server parses with ExcelJS → converts to Univer snapshot JSON.
3. Server creates a Yjs document, seeds it with the snapshot.
4. Server returns `{ roomId }`. Browser navigates to `/r/:roomId`.
5. Univer initializes empty → Yjs sync replays the doc → grid is populated.
6. Subsequent users joining `/r/:roomId` get the live doc state.

### Live editing
- Every Univer cell mutation → command → Yjs update → broadcast → other clients apply → Univer re-renders.
- Awareness (cursor position, selected range, user color) flows separately via Yjs awareness protocol.

### Download
- Any user clicks "Download" → server reads current Yjs state → serialize Univer snapshot → ExcelJS writes `.xlsx` → stream to browser.

### Session lifecycle
- Room created on upload.
- Room destroyed when **0 clients connected for 5 minutes** (configurable).
- No disk persistence. Data dies with the room. Document this clearly in UI.

---

## The hard part: Univer ↔ Yjs bridge

This is the single biggest technical risk. Everything else is plumbing.

**Approach:**
- Subscribe to Univer's `CommandService` to capture every mutating command.
- Translate each command into Yjs operations on a structured `Y.Map` representing the workbook (sheets → rows → cells).
- On Yjs updates from remote, replay them as Univer commands with an "remote" flag so we don't re-broadcast.
- Store cell values, formulas, and styles in Yjs. Computed formula *results* are derived locally — don't sync them.

**Risks:**
- **Formula non-determinism.** `NOW()`, `RAND()`, `TODAY()` produce different values per client. Solution: seeded RNG or one designated "authority" client per session.
- **Conflict semantics.** Two users editing the same cell at the same time — Yjs gives last-writer-wins on Y.Map leaves, which is acceptable for cells.
- **Range operations.** Inserting a row shifts thousands of cells. Need to map this to a single Yjs op (Y.Array insert) instead of N individual cell moves.
- **Styles vs values.** Need to decide on the granularity — are styles per-cell objects in Yjs, or a separate style sheet referenced by cell?

**Mitigation:** build a spike before committing. See "Spikes" below.

---

## What we replace vs reuse from Univer

| Reuse from Univer OSS | Build ourselves |
|---|---|
| Core data model | Office-style ribbon UI |
| Canvas rendering | Status bar with cell stats |
| Formula engine | File menu (Open, Save As, Recent) |
| Formula bar | Upload/download flow |
| Cell editor | Yjs bridge plugin |
| Data validation, conditional formatting, filters, sort | Presence/cursor rendering |
| Find & replace | Session/room manager (backend) |

---

## Phases

### Phase 0 — Spikes (1 week)
Before committing, prove the risky bits work.

- **Spike A: Yjs bridge.** Two browsers, plain Univer, edits in one show up in the other within 200ms. Lowest-fidelity wins — even just text in one cell is enough proof.
- **Spike B: xlsx round-trip.** Take a real xlsx (formulas, formatting, merged cells, a chart). Load via ExcelJS → Univer snapshot → save back. Measure fidelity loss honestly.
- **Spike C: Univer UI override.** Hide Univer's default toolbar, render our own component above the grid, wire one button (Bold) to a Univer command. Confirms we have enough hooks.

If any spike is a wall, the plan changes before we spend months on it.

### Phase 1 — Single-player Excel-flavored editor (3 weeks)
- Vite + React scaffold.
- Univer OSS embedded.
- Custom Office-style ribbon (just Home tab to start — Clipboard, Font, Alignment, Number, Cells, Editing groups).
- Formula bar (use Univer's, restyled).
- Status bar with selection stats.
- File menu: Open (upload xlsx), Save As (download xlsx). No persistence.

**Exit criterion:** a user can upload an xlsx, edit it like Excel, download it. Solo, no collab yet.

### Phase 2 — Real-time co-editing (4–6 weeks)
- Hocuspocus server.
- Yjs bridge plugin (the spike, hardened).
- Room lifecycle (create on upload, gc when empty).
- Sharing: copy room URL, anyone joins.

**Exit criterion:** two browser tabs editing the same sheet, changes visible in < 250ms.

### Phase 3 — Presence + polish (2–3 weeks)
- Other users' cursors and selections on the grid.
- User color assignment, name badges, presence list.
- Visual feedback when remote edits arrive.
- Connection state indicator (connected / reconnecting / offline).
- Handle reconnects gracefully.

**Exit criterion:** demo-able to a stakeholder without caveats.

### Phase 4 — More ribbon tabs + features (open-ended)
- Insert tab (rows/cols, sheets, function picker).
- Formulas tab (function categories, named ranges).
- Data tab (sort, filter, data validation).
- View tab (zoom, freeze panes, gridlines).
- Right-click context menus.
- Excel keyboard shortcuts.

### Phase 5 — Later (post-project-scope)
- WOPI host integration → real file persistence, opens from SharePoint/OneDrive.
- Auth + sharing model.
- Charts (ECharts overlay).
- Pivot tables.
- Self-hosted LLM integration (via Univer command bus — orthogonal to everything above).

---

## Estimates

**Solo dev, full time:**
- Phase 0: 1 week
- Phase 1: 3 weeks
- Phase 2: 4–6 weeks
- Phase 3: 2–3 weeks
- **Demo-ready system: ~3 months**
- Phase 4: another 1–2 months for credible feature breadth

**Risk-adjusted: 4–5 months solo for something you'd show to users.**

---

## Open questions (decide before Phase 1)

1. **UI fidelity target.** Office-inspired (faster) vs near-pixel-perfect Office (much slower)?
2. **xlsx fidelity target.** What's the test workbook we measure round-trip loss against?
3. **Max concurrent editors per room?** Affects whether we need to optimize the Yjs bridge for high op rates.
4. **File size cap on upload?** Univer + Yjs both struggle with very large workbooks (> 100k cells). Pick a reasonable limit (e.g. 50k cells) and reject larger uploads with a clear message.
5. **Browser targets.** Chrome only is fastest. Chrome + Edge + Safari + Firefox is more work (canvas quirks, IME handling).

---

## Immediate next step

Run **Phase 0 spikes** before anything else. Order:

1. Spike C (UI override) — fastest, lowest risk, but confirms we're not blocked on cosmetics.
2. Spike A (Yjs bridge) — the make-or-break one.
3. Spike B (xlsx round-trip) — informs how honest we need to be about fidelity.

After spikes: revisit this plan with what we learned.
