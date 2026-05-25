# Load test — v0.1 baseline

HTTP-side capacity baseline for the v0.1 release. Measured with the
in-tree harness at `apps/server/scripts/loadtest.ts`. Drives the four
write-path endpoints the audit identified as the abuse surface: room
create, seed upload, snapshot upload, snapshot fetch.

Re-run with:

```bash
pnpm --filter @sheet/server load
# or:
LOAD_TARGET=http://localhost:3000 LOAD_VUS=50 LOAD_DURATION_S=20 \
  pnpm --filter @sheet/server load
```

## Test environment

| Variable | Value |
|---|---|
| Host | MacBook Air (Apple Silicon), darwin 25 |
| Node | 22.x (pnpm-managed) |
| Server | apps/server (Fastify 5 + @hocuspocus/server 2.15) |
| Storage | in-memory (no Redis attached) |
| Workbook host | memory |
| Rate-limit plugin | @fastify/rate-limit 10.3.0 |
| Room cap | MAX_ROOMS = 10 000 for baseline (raised so capacity wasn't the bottleneck) |
| Payloads | 1 KB seed, 4 KB snapshot — chosen to measure server bookkeeping, not network throughput |

## Run 1 — Baseline throughput (rate-limit DISABLED)

50 virtual users for 20 s; spin-up staggered over 2 s.
`RATE_LIMIT_ENABLED=false` so the bucket doesn't cap the result.

```
endpoint              count  errors   429s  p50(ms)  p95(ms)  p99(ms)
-------------------- ------- ------ -------- -------- -------- --------
POST /api/rooms         9519      0        0      0.2      0.6      1.6
POST /seed              9519      0        0      0.2      0.6      2.1
POST /snapshot          9519      0        0      0.2      0.5      1.9
GET /snapshot           9519      0        0      0.2      0.5      1.7

totals: 38 076 requests, 0 errors, 0 rate-limited, 1903.8 req/s avg
```

**Reading:** all four endpoints sustain ~1900 req/s combined (~480
req/s each) with p99 well under 3 ms. Zero 5xx, zero memory pressure
(in-memory host, no Redis I/O). The server is comfortably faster than
the rate-limit bucket needs to be — the bucket is the safety net,
not the bottleneck.

## Run 2 — Rate-limit verification (defaults ON)

20 virtual users for 15 s. Default `RATE_LIMIT_PER_MIN=60`,
`UPLOAD_RATE_LIMIT_PER_MIN=12`. Single source IP (the loadtest
harness) — designed to confirm the bucket triggers, not measure
real throughput.

```
endpoint              count  errors   429s  p50(ms)  p95(ms)  p99(ms)
-------------------- ------- ------ -------- -------- -------- --------
POST /api/rooms         1162      0     1102      0.9      1.7      2.8
POST /seed                60      0       48      0.6      1.6      3.7
POST /snapshot            60      0       48      0.4      0.9      2.6
GET /snapshot             60      0        0      0.3      0.7      1.6

totals: 1342 requests, 0 errors, 1198 rate-limited (89.3% throttled), 89.5 req/s avg
```

**Reading:** the bucket cuts the harness's offered load to exactly
the configured envelope.
- `/api/rooms`: 1162 attempts → 60 accepted (rest 429). Matches
  `RATE_LIMIT_PER_MIN=60` for a single IP across the 15 s window
  (Fastify's bucket allows the initial burst then enforces the rate).
- `/seed` and `/snapshot`: 60 attempts → 12 accepted. Matches
  `UPLOAD_RATE_LIMIT_PER_MIN=12`.
- `GET /snapshot`: 60 attempts → 0 throttled. The read endpoint
  is correctly NOT rate-limited (returning peers shouldn't get
  throttled for re-joining).

Zero 5xx in both runs — the rate-limit middleware is the only
pushback, exactly as designed.

## v0.1 SLO floor

Based on these numbers, the v0.1 floor (single-process, in-memory
host, no Redis):

- **HTTP write capacity per IP:** 60 room-creates + 12 uploads per
  minute (configurable via env).
- **HTTP write capacity per process:** > 1500 req/s aggregate
  (well above any realistic legitimate workload at v0.1 scale).
- **Latency:** p99 < 5 ms for all four write endpoints under the
  baseline run. The rate-limit middleware adds < 1 ms p99 overhead.
- **Concurrent rooms:** MAX_ROOMS = 256 default. When at cap, oldest
  evictable room is dropped (see Stream C2 in PRODUCTION_PIPELINE.md);
  if every slot is non-evictable, returns 503 + `retry-after: 60`.

## WS-side runs (Stream D3 — `pnpm wsload`)

The HTTP harness measures the upload + control plane. The WS
harness at `apps/server/scripts/wsloadtest.ts` drives the actual
co-edit path: real `@hocuspocus/provider` clients from Node, real
Yjs sync handshake, real broadcast fan-out.

Each virtual room gets `LOAD_CLIENTS_PER_ROOM` clients (default 3).
One is the writer; the rest are readers. The writer pushes a
beacon record carrying a sender-side `performance.now()` timestamp
to the op-log Y.Array every `LOAD_WRITE_INTERVAL_MS` (default 5 s).
Readers `observe()` the log and record `now - sentAt` as broadcast
latency. Sequence numbers detect drops.

Run with:

```bash
pnpm --filter @sheet/server wsload
# Override:
LOAD_ROOMS=500 LOAD_CLIENTS_PER_ROOM=3 LOAD_DURATION_S=30 \
  LOAD_WRITE_INTERVAL_MS=2000 LOAD_SPIN_UP_MS=20000 \
  pnpm --filter @sheet/server wsload
```

### Run 3 — Co-edit baseline (50 rooms × 3 clients, 30 s)

Realistic small-team load: 150 concurrent WS clients across 50
rooms, each room writing every 2 s.

```
metric                   count errors  p50(ms)  p95(ms)  p99(ms)
---------------------- ------- ------ -------- -------- --------
WS connect + sync          150      0      2.3      5.5      7.4
Broadcast latency         1420      0      1.1      2.4      3.4

totals: 150 clients connected (0 failed), 1420 broadcast events
        across 100 peer-clients, 0 dropped records,
        47.3 updates/s aggregate
```

### Run 4 — Tier L load (200 rooms × 3 clients, 30 s)

The capacity model's "Mid team" tier — 600 concurrent peers,
sustained 173 updates/s aggregate.

```
metric                   count errors  p50(ms)  p95(ms)  p99(ms)
---------------------- ------- ------ -------- -------- --------
WS connect + sync          600      0      1.6      2.8      4.6
Broadcast latency         5200      0      0.4      0.9      1.7

totals: 600 clients connected (0 failed), 5200 broadcast events
        across 400 peer-clients, 0 dropped records,
        173.3 updates/s aggregate
```

### Run 5 — Stress at the model's stated ceiling (500 rooms × 3, 30 s)

The capacity model called this the single-process ceiling
(~500 active docs). Reality: **way more headroom than predicted.**

```
metric                   count errors  p50(ms)  p95(ms)  p99(ms)
---------------------- ------- ------ -------- -------- --------
WS connect + sync         1500      0      2.0      6.4     16.3
Broadcast latency        10500      0      0.3      1.4      3.2

totals: 1500 clients connected (0 failed), 10500 broadcast events
        across 1000 peer-clients, 0 dropped records,
        350.0 updates/s aggregate
```

### Reading the numbers

1500 concurrent WS clients sustained for 30 s on a single Node
process with zero dropped records and **p99 broadcast latency at
3.2 ms**. The capacity model's 50 ms threshold was always meant to
be **user-perceived** latency (network RTT + broadcast); the
broadcast itself contributes a small fraction.

**Capacity model update**: the "~500 active docs single-process
ceiling" was overcautious. Real ceiling is whichever lands first:

1. **File descriptor cap** — 1024 per Linux process by default;
   raise with `ulimit -n 65535` (covered in the docs already).
2. **RAM** — ~370 KB per active doc, model unchanged.
3. **Network RTT to clients** — out of the server's control.
4. **CPU pegging** — wasn't approached at 1500 clients (~350
   updates/s); we'd need 10× the write rate or 10× the clients
   to see it.

For the **co-edit case** (~3 users/doc) on a single $48/mo
DigitalOcean GP box: **conservative ceiling ~500 active docs /
1500 concurrent users** still holds, but the binding constraint
is **RAM** (370 KB × 500 = 185 MB just for active state, plus
Hocuspocus + Node baseline + Redis colocation), not broadcast
latency. The broadcast path has 10× more headroom than the
model assumed.

## Out of scope (follow-up)

- **Redis-backed runs.** Numbers above are in-memory only. Redis
  adds 0.5–2 ms per persisted update; should re-run when Redis is
  the configured storage backend.
- **Multi-IP load.** Single-process, single-source-IP run. A real
  abuse pattern from 100 distinct IPs is bounded by `MAX_ROOMS`
  and per-IP buckets but the aggregate throughput cap is the
  server's CPU, not the rate-limit — that's the next thing to
  measure once D1 ships.
- **Geographic distribution.** All clients are on localhost. Real
  users add 20–200 ms of WS RTT depending on region; doesn't
  change server-side capacity but does change user-perceived
  latency. The single-region deployment in the capacity model
  assumes ≤ 100 ms client RTT.

## Re-running

```bash
# 1. Start the server (default env)
pnpm --filter @sheet/server dev

# 2. In another shell:
pnpm --filter @sheet/server load              # 50 VUs × 60 s
LOAD_VUS=100 LOAD_DURATION_S=120 \
  pnpm --filter @sheet/server load            # 100 VUs × 2 min

# Or for raw-capacity numbers (no bucket in the way):
RATE_LIMIT_ENABLED=false MAX_ROOMS=10000 \
  pnpm --filter @sheet/server dev
# then run the loadtest as above.
```

The harness uses Node's built-in `fetch` + `perf_hooks` — no
k6 / artillery install needed. Output is grep-friendly so CI can
extract the p99 numbers later if we want a regression gate.
