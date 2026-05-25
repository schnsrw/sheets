# Capacity model + sizing tiers

System requirements and scaling plan grounded in the v0.1 baseline
numbers (`docs/LOAD_TEST.md`). Assumes the typical workload pattern:
**2–5 users per doc, average 3.**

This is a planning document, not a contract. The HTTP path is
measured; the WebSocket sync path is estimated from the underlying
Yjs / Hocuspocus characteristics + reasonable upper bounds for a
spreadsheet workload (Univer mutations are small — most are
`set-range-values` with 10–100 cells; ~1–4 KB per encoded update).

## TL;DR — sizing one process

| Concurrent | Active docs | Concurrent users | RAM | CPU | Storage (Y.Doc) |
|---|---|---|---|---|---|
| Solo demo | 1–10 | 3–30 | 256 MB | 1 vCPU | in-memory or 50 MB Redis |
| **Small team** | **10–50** | **30–150** | **512 MB–1 GB** | **1–2 vCPU** | **256 MB Redis** |
| Mid team | 50–200 | 150–600 | 2 GB | 2 vCPU | 1 GB Redis |
| Big team (1 process) | 200–500 | 600–1500 | 4 GB | 4 vCPU | 4 GB Redis |
| **Beyond 500 docs** | **shard horizontally** | **—** | **add processes** | **add CPUs** | **Redis cluster** |

The single-process **soft ceiling is ~500 active docs / ~1500 concurrent
WS clients** — past that, latency starts to climb (Yjs broadcast fan-out
is per-room, and the Node event loop is a single core no matter how
big the box). The fix is more processes behind a sticky-room load
balancer, not a bigger machine.

## Workload assumptions

| Param | Value | Why |
|---|---|---|
| Users per doc | 3 (range 2–5) | User-supplied. Matches typical Google-Sheets co-edit pattern (a small team on one workbook). |
| Edit cadence (active user) | 1 update / 5 s | A user typing real content emits a mutation every few keystrokes; Univer batches per cell commit. Spreadsheet cadence is slower than a doc editor. |
| Idle users per doc | 1 of 3 | "Active" means typing right now. Most peers in a co-edit session are reading at any moment. |
| Update payload | 2 KB encoded | Median Univer mutation (10–50 cells set-range-values). Big paste / sort is 20 KB outlier, small style toggle is 200 B. |
| Workbook seed size | 500 KB xlsx | Average. Range 50 KB (small list) to 20 MB (large data warehouse export). |
| Y.Doc op-log growth | ~1 MB / hour / active doc | 1 update / 2 s aggregated × 2 KB. Compaction at 200 ops resets the floor (currently every ~7 min of edits). |
| WS frame fan-out | 1 message → (users − 1) sends | Hocuspocus broadcasts each update to every peer in the room. Per-room cost grows with √users for small N, linearly for large. |

## Per-doc resource cost

Derived from the measured baseline + the Yjs / Hocuspocus
fan-out math:

### Memory

| Component | Per doc | Source |
|---|---|---|
| Y.Doc in RAM | ~50 KB (empty) to ~2 MB (active 1 hr) | Yjs CRDT; bounded by compaction at 200 ops |
| Hocuspocus connection state | ~5 KB per connected user | Awareness + provider session bookkeeping |
| Room registry record | ~1 KB | `RoomState` in `apps/server/src/rooms.ts` |
| **Per-user WS buffer** | **~64 KB** | Default `ws` library send queue per connection |
| **Total per doc (3 users)** | **~250–400 KB steady, peaks 2.5 MB after a big paste** | |

→ **~256 doc-hours sit comfortably in 1 GB of RAM.** A process with
512 MB RAM and `MAX_ROOMS=128` is safe for typical use.

### CPU

| Operation | Cost | Notes |
|---|---|---|
| Receive + broadcast 1 update | ~50 µs | Hocuspocus encode + N × WS send |
| Y.Doc apply (joiner replay) | ~5–50 ms for 100 ops | One-time per join; not steady state |
| Compaction (snapshot) | ~100 ms for 200-op room | Designated writer only; once per 7–60 min per room |
| Idle WS heartbeat | ~negligible | Every 30 s ping |

→ **A single core handles ~20 000 updates/sec broadcast.** At
1 update / 5 s / user × 3 users × 500 docs = 300 updates/sec — uses
~1.5 % of one core. **CPU is not the bottleneck below ~500 active
docs per process.**

### Network

Per active doc with 3 users (1 active + 2 idle):
- Inbound: 1 update / 5 s × 2 KB = 0.4 KB/s
- Outbound: 1 update × (3−1) peers × 2 KB / 5 s = 0.8 KB/s
- Total: ~1.2 KB/s sustained per doc

→ At 500 docs that's **~600 KB/s bandwidth — negligible** on any
modern server. The big spikes are seed/snapshot fetches on join
(500 KB × N joiners) — those benefit from the cache-control:
immutable + 7-day Redis TTL.

### Storage (Redis Y.Doc bytes)

Each doc persists 50 KB–2 MB depending on size + recent compaction.
Assume 500 KB average for sizing:

| Active docs | Redis RAM (Y.Doc only) | + 7-day inactive backlog |
|---|---|---|
| 50 | 25 MB | ~150 MB |
| 200 | 100 MB | ~600 MB |
| 500 | 250 MB | ~1.5 GB |

(Inactive backlog assumes 6× the active set as the rolling 7-day tail.
Real numbers will vary with churn.)

## Per-process capacity ceiling

Single process, 4 GB RAM, 2 vCPU, in-memory storage:

| Limit | Value | Why this and not more |
|---|---|---|
| MAX_ROOMS hard cap | 256 default, raisable to ~2000 before RAM matters | Each empty room is ~1 KB; the cost is in active rooms (250–400 KB each) |
| Concurrent WS clients | ~1500 | Hocuspocus + `ws` library handle this fine on Node 20; past it, send-queue contention starts to appear |
| Active concurrent docs | **~500** (RAM-bound, not CPU) | Measured at 500 rooms × 3 clients: p99 broadcast 3.2 ms (not the predicted 50 ms knee — see WS load test run 5). The real binding constraint at this size is RAM (~370 KB × 500 = 185 MB just for active state) + Hocuspocus + Node baseline + Redis colocation. |
| Edits/sec aggregate | ~1000 sustained | CPU ceiling for the single-threaded broadcast loop |
| Idle (cold) rooms in registry | 2000+ | Bounded only by RAM (1 KB each) and `MAX_ROOMS` env |

## Deployment tiers

### Tier S — Solo / personal (current demo)
- **Users:** 1–30 concurrent, ad-hoc usage
- **Docs:** 1–10 active at any moment
- **Hardware:** 1 vCPU, 256 MB RAM, no Redis (in-memory)
- **Cost:** $5–10/mo (DigitalOcean droplet / Fly machine / Hetzner CX11)
- **Limits:** restart loses state, no horizontal scale
- **Use case:** `doc.schnsrw.live` today

### Tier M — Small team (recommended for v0.1)
- **Users:** 30–150 concurrent
- **Docs:** 10–50 active
- **Hardware:** 1 vCPU, 1 GB RAM + Redis 256 MB
- **Cost:** $15–25/mo (small VPS + managed Redis or Redis on same box)
- **Setup:** docker-compose with REDIS_URL, MAX_ROOMS=128
- **Use case:** Internal team tool, side-project SaaS first 6 mo

### Tier L — Mid team
- **Users:** 150–600 concurrent
- **Docs:** 50–200 active
- **Hardware:** 2 vCPU, 2 GB RAM + Redis 1 GB
- **Cost:** $40–80/mo
- **Setup:** Still single process; add a reverse proxy with trustProxy
  so rate-limit IPs work; MAX_ROOMS=512
- **Use case:** Mid-size org rollout, 50–200 person team

### Tier XL — Big team / multi-tenant
- **Users:** 600–1500 concurrent on one process
- **Docs:** 200–500 active
- **Hardware:** 4 vCPU, 4 GB RAM + Redis 4 GB
- **Cost:** $150–300/mo
- **Setup:** still single Node process — single-thread broadcast is
  fine to ~500 docs; PIN room-to-process for the next tier
- **When to shard:** p99 broadcast latency > 50 ms during peak, OR
  active docs > 500. Add a second process behind a sticky-room load
  balancer (HAProxy / Caddy / Cloudflare with consistent hashing on
  the room id).

### Tier XXL — Horizontal (multi-process)
- **Architecture:** N stateless gateway processes; load balancer
  routes by room id (consistent hash) so every client for room X hits
  process X. Redis is the shared truth so a process restart drops
  zero state.
- **Per-process limits unchanged** — 500 active docs, 1500 WS
  clients. Total capacity = N × those numbers.
- **Cost scales linearly:** 5000 active docs ≈ 10 processes ≈
  20 vCPU + 20 GB RAM + Redis cluster (3–5 nodes).

## Bottlenecks in order

When the system starts to hurt, the order is (updated 2026-05-26
with measured numbers from `docs/LOAD_TEST.md` runs 3–5):

1. **File descriptor cap** — Linux default 1024 per process. Hits
   FIRST in any uncapped deployment. **Fix:** `ulimit -n 65535` in
   the systemd unit or `--ulimit nofile=65535:65535` for Docker.
2. **RAM for active docs** — 370 KB × N active docs. At 8 GB RAM
   minus baseline, you fit ~10 000 active docs before swapping;
   safe operating point is ~5 000.
3. **Redis RAM.** Each Y.Doc grows; 7-day TTL cleans up but heavy
   churn can push you past Redis's working set. **Fix:** Redis
   cluster or lower TTL.
4. **CPU pegging on the broadcast loop.** Measured wasn't approached
   at 1500 concurrent WS clients × 350 updates/s (run 5 in the
   load test doc). **Fix:** shard processes once you actually
   see it; should be > 5 000 active rooms or > 1 000 updates/s.
5. **Network egress.** Doesn't matter below 10k+ docs.
3. **CPU on snapshot writes.** Compaction takes ~100 ms per room
   and runs every 7–60 min. If 500 docs all compact in the same
   second you'll see a CPU spike. **Fix:** the existing
   COMPACT_MIN_INTERVAL_MS=60s already staggers this; raise the
   threshold if needed.
4. **Network egress.** Negligible until very large deployments
   (10k+ docs).
5. **MAX_ROOMS cap.** Not a real bottleneck — raisable to thousands
   for cheap. Set conservatively by default so an under-resourced
   box fails clean instead of OOMing.

## Sizing for the user's "2–5 users per doc" pattern

Substituting that explicitly:

| Concurrent users | Implied active docs (avg 3) | Recommended tier |
|---|---|---|
| 30 | 10 | Tier S |
| 100 | 33 | Tier M |
| 300 | 100 | Tier L |
| 1000 | 333 | Tier XL |
| 3000+ | 1000+ | Tier XXL (sharded) |

**Bottom line:** a single $20/mo VPS comfortably handles a co-edit
workload for a small team (~100 users across ~30 docs). Scaling to
1000 concurrent users is a single $200 box. Past ~1500 concurrent
users on one room shape, the answer is sharding, not a bigger
machine.

## What's NOT modelled here

- **Cold-join cost** (first opening a 20 MB workbook). Dominated by
  the client's xlsx parser, not the server. Server-side cost is the
  one-time snapshot serve (cached + immutable).
- **AGENT or formula-engine compute on the server.** v0.1 keeps all
  formula evaluation on the client; server stays pure transport +
  storage. If we ever add server-side recalc, multiply CPU budget
  by ~5×.
- **Multi-region latency.** All numbers are for clients in the same
  region as the server. Cross-region adds 50–200 ms of WS RTT but
  doesn't change the server's capacity.
- **Cold backup / DR.** Currently relies on Redis persistence +
  AOF; a regional outage drops state newer than the last AOF flush
  (default 1s). Acceptable for v0.1, would need cross-region Redis
  replication for stricter SLAs.

## Worked example — $48 DigitalOcean General Purpose droplet, 1 user / 1 doc

Common question: "What does X dollars of server actually get me?" A
real config to anchor the model:

| Spec | Value |
|---|---|
| Hardware | 4 dedicated vCPU, 8 GB RAM, 180 GB SSD |
| Cost | $48/mo (DigitalOcean General Purpose) |
| Workload | 1 user per doc (single-player editor with cloud persistence — no co-edit fan-out) |

**Headline: ~5 000–8 000 concurrent users on a single Node process,
~10 000–15 000 with Node cluster mode + sticky room-to-worker
routing.**

### Resource budget

| Resource | Budget | Per active user | Ceiling reason |
|---|---|---|---|
| RAM | 6.5 GB (after ~1.5 GB OS + Redis + Node baseline) | ~370 KB (300 KB Y.Doc + 64 KB WS buffer + ~5 KB Hocuspocus session) | Theoretical 17 500 users, but other walls hit first |
| WebSocket file descriptors | needs `ulimit -n 65535` | 1 fd | ~5 000–8 000 per Node process before event-loop lag |
| CPU | 4 dedicated cores | ~negligible | NO broadcast fan-out at 1 user/doc — CPU is not the bottleneck |
| Network | 1 Gbps | ~0.4 KB/s steady | Doesn't matter at this scale |
| Disk | 180 GB SSD | ~0 (Y.Doc lives in Redis RAM) | Massively over-provisioned — actual use < 20 GB |

### Why "1 user/doc" lifts the ceiling vs the 3-user case

With 1 user / 1 doc there's **no Yjs broadcast cost** — the single-
core CPU bottleneck that caps co-edit workloads at ~500 active docs
disappears entirely. The new bottleneck is **WebSocket connection
management on Node's single thread**: at ~5 000 concurrent active
connections, event-loop lag creeps above 50 ms, which feels laggy
for keystroke echo.

### Sizing table for this box

| Concurrent users | What fits |
|---|---|
| 1 000 | ✅ Trivial. Use the box for other things too. |
| 5 000 | ✅ Single process, default config + raised ulimit. |
| 10 000 | ✅ Needs Node cluster mode + sticky routing. |
| 15 000 | ⚠️ Possible but past the comfort zone. Move Redis off the box. |
| 25 000+ | ❌ Need a second app server. |

### Three things that'll bite first

1. **File descriptor limit.** Linux default is 1024. You'll hit a
   wall at exactly 1024 connections looking like mysterious WS
   failures. Set `ulimit -n 65535` in your systemd unit or pass
   `--ulimit nofile=65535:65535` to Docker. Non-negotiable.
2. **Rate limit + corporate NAT.** Default is 60 room-creates/min/IP.
   If 500 users share one office IP they all share one bucket and
   throttle each other. Raise the limit or add authenticated user
   buckets behind the IP bucket.
3. **Redis on same box.** ~5 000 active users × 500 KB Y.Doc avg
   ≈ 2.5 GB Redis. Fine for 8 GB. Past ~8 000 users, move Redis
   to its own droplet.

### When you outgrow this box

Not when CPU/RAM is full — when event-loop p99 latency creeps above
50 ms during peak. At that point you don't need a **bigger** box, you
need a **second** $48 box behind a load balancer doing consistent
hash on room id. Linear scaling from there.

### What this box ISN'T good for

- **3–5 users per doc co-edit** (broadcast fan-out hits the single-
  core ceiling at ~500 active docs regardless of RAM — different
  ceiling, different fix; see Tier table above).
- **High availability.** One box = reboot is downtime. Uptime SLAs
  need ≥ 2 boxes + Redis on its own.

### Bottom line

One $48 droplet realistically serves a 1-user-per-doc workload up to
~5 000 concurrent users without tuning, ~12 000 with cluster mode +
raised ulimit + Redis on the same box. That's a small-SaaS-doing-
first-year-revenue footprint on a single monthly invoice. Storage
cost (180 GB SSD) is the limiting factor on the spec sheet, not
compute — you'll use 5–10× less than you're paying for.

## Re-validating the model

These numbers are estimates anchored to a single measured run. The
right time to re-validate:

1. Once a real workload reaches ~50 concurrent users in production.
2. After any change to compaction thresholds or Hocuspocus version.
3. When adding Redis (the in-memory baseline doesn't include I/O cost).
4. Before tier-bumping a customer's deployment.

Re-run `docs/LOAD_TEST.md` instructions + diff the numbers.
