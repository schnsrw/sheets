# Production-readiness pipeline

Tracks the work required to take Casual Sheets from "feature-complete
v0" to a credible v1.0 release. Five streams, ordered by leverage on
**user-trust failure modes** (a corrupted co-edit session destroys
more trust than a missing chart axis label).

The order is deliberate: reliability first (data divergence is the
worst failure), then type safety (prevents the next class of bugs),
then backend hardening (DoS resilience), then measurement (we don't
know our limits), then release.

| Stream | Title                                  | Status      |
|--------|----------------------------------------|-------------|
| A1     | Bridge replay retry + dead-letter      | done        |
| A2     | Surface dead-letter detail in indicator| done        |
| B1     | Typed Univer facade wrapper            | rolling     |
| C1     | Backend rate limit on uploads          | done        |
| C2     | Request size + room eviction caps      | done        |
| D1     | Load test script + baseline numbers    | done        |
| D2     | Capacity model + sizing tiers          | done        |
| E      | Cut v0.2.0 release                     | done        |

**v0.2.0 cut on 2026-05-26.** v0.1.0/v0.1.1 had already been tagged
when this pipeline started; the production-readiness work landed as
the v0.2.0 release. B1 is rolling — the foundation + 5 highest-
traffic files are converted; remaining files are mechanical follow-up
under the v0.2.x patch series.

## Stream A — Co-edit reliability

The Yjs bridge is the highest-risk surface: every silent failure in
the replay loop is a silent divergence between peers. The audit
flagged "no retry, no dead-letter" as the single biggest gap.

### A1 — Replay retry with backoff (in_progress)

**Problem:** `cmdSvc.executeCommand(rec.id, params, { fromCollab: true })`
in the replay loop catches all errors with a single `.warn + tick
counter` path. Lazy-plugin chunk-load failures (transient — network
blip during webpack chunk fetch) get conflated with malformed-mutation
failures (permanent — bad params, unknown command id). The transient
class never gets a second chance and the room silently diverges.

**Approach:**

1. **Classify** errors at the catch site:
   - `ChunkLoadError` / "Loading chunk N failed" / "failed to fetch
     dynamically imported module" → **transient** (retry)
   - everything else → **permanent** (dead-letter immediately)
2. **Retry** transient failures with backoff: 300 ms, 900 ms, 2700 ms
   (three attempts). Out-of-order against later mutations is OK — if
   the original failed, peers might have failed too; recovery is
   best-effort.
3. **Dead-letter** ring buffer (cap 20) of `{ id, params, lastError,
   attempts, firstFailedAt, lastFailedAt, classification }`. Older
   entries evict on overflow. Exposed via `getReplayDeadLetter()` on
   the bridge handle.
4. **Keep** the `replayFailures` counter (existing UI consumes it).
   Only increment on **final** failure (after all retries exhausted
   for transient, immediately for permanent).

**Test plan:** unit-test the classifier + `withRetry` helper directly
(pure functions). E2E coverage via the existing replay tests is
unchanged.

### A2 — Dead-letter detail in `CollabIndicator` (pending)

CollabIndicator currently shows `"N not synced"` with no detail. Add a
click-to-expand panel showing the last 5 dead-letter entries: mutation
id + truncated error message + age. Lets the user (and us, in
production) self-diagnose what's actually failing instead of just
seeing a count.

## Stream B — Type safety

### B1 — Typed Univer facade wrapper (rolling)

`grep -rn "as any" apps/web/src | wc -l` returned 148 at start.
Built `apps/web/src/univer-facade.ts` (~210 lines) with the
surface we actually use: sheetId, isHidden, maxRows, maxColumns,
rangeAt, rangeBox, rangeFromA1, activateRange, dataRangeOrActive,
setActiveSheet, findSheetById, saveWorkbook, activeSheet,
activeRange, injector, viteEnv, viteEnvNumber, windowStringGlobal.

Converted (in commit order):
- shell/tab-actions.ts: 10 → 2 (-8)
- shell/sheet-actions.ts: 1 → 0 (-1)
- shell/flash-fill.ts: 3 → 0 (-3)
- shell/MenuBar.tsx: 7 → 2 (-5)
- collab/CollabDriver.tsx: 6 → 2 (-4)

**Cumulative: 21 caller-side as-any sites eliminated, 23
centralized in the facade.** The 4 sites that remain in
converted files are scoped to single expressions calling Univer
plugin extensions outside the standard FWorkbook/FWorksheet
surface (sheets-ui rendering, Hocuspocus provider, tables
plugin) — TODO-marked for follow-up.

Unconverted files (~127 sites total in ~21 files) are mechanical
follow-up — same patterns, no design work, **doesn't block v0.1**.
Tracked here as a rolling stream.

Pending: ESLint rule scoped to converted files to forbid new
`as any` (prevents regression). Add once 80%+ of caller sites
are converted.

## Stream C — Backend hardening

### C1 — Rate limit on uploads (done)

Shipped: @fastify/rate-limit registered with `global: false` so each
route opts in. POST /api/rooms gets RATE_LIMIT_PER_MIN (default
60/min/IP); POST /api/rooms/:id/seed and POST /api/rooms/:id/snapshot
share UPLOAD_RATE_LIMIT_PER_MIN (default 12/min/IP). Standard 429 +
`retry-after` envelope. `RATE_LIMIT_ENABLED=false` disables the plugin
for load testing / dev. Logs the configured limits on boot.

Keyed by `req.ip` — works under direct exposure. When self-hosted
behind a reverse proxy, enable Fastify's `trustProxy` so the
forwarded IP is used instead of the socket address.

### C2 — Request size + room eviction caps (done)

Request size was already capped by `MAX_UPLOAD_MB` (default 100) on
both the Fastify `bodyLimit` and the multipart `fileSize` limit —
verified no end-run via content-type substitution (raw `application/
gzip` and `application/octet-stream` parsers also get the same cap).

Added: hard cap on concurrent rooms per process via `MAX_ROOMS`
(default 256). When `create()` would push past the cap, the registry
LRU-evicts the oldest **evictable** room (no password / no seed / no
snapshot). If every slot is held by a non-evictable room, `create()`
throws `RoomCapacityError` and the HTTP layer returns 503 + `retry-
after: 60`. Eviction calls the existing `onEvict` hook so the
persisted Y.Doc bytes in Redis get cleaned up too.

Two-pass eviction policy: prefer idle-but-evictable rooms first, fall
back to live-but-evictable (by createdAt) so a malicious "spam open
rooms with one client each" pattern can't permanently lock out
legitimate new users. Tests pin all four code paths.

## Stream D — Load + measurement

### D1 — k6 baseline (pending)

We don't know our scale ceiling. Script: ramp 1 → 100 concurrent
rooms × 2 clients/room sending one update every 2 s. Record p50/p99
broadcast latency, gateway RSS, RSS-per-room. Document numbers in
`docs/LOAD_TEST.md`. Target floor for v0.1: 100 rooms × 2 clients
without p99 > 500 ms or RSS > 1 GB.

## Stream E — v0.2.0 release (done)

Cut on 2026-05-26 once A1, A2, C1, C2, D1, D2 had shipped. The
release bundle:

- Bumped `0.1.1` → `0.2.0` in root + `apps/server` + `apps/web`.
- Started `CHANGELOG.md` (previously missing) — entry for v0.2.0
  + back-fills for v0.1.1 and v0.1.0; older v0.0.x via site +
  GitHub release pages.
- Per-product changelog entries on
  [schnsrw.live/changelog/](https://schnsrw.live/changelog/) —
  back-filled the missing v0.1.1 entry + added v0.2.0.
- Tagged `v0.2.0` + pushed; GitHub release created with the
  v0.2.0 CHANGELOG section as the body.
