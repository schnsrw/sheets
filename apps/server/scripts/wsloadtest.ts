/**
 * WS-side load harness — Stream D3 of the production pipeline.
 *
 * Drives the Yjs sync path through @hocuspocus/provider from Node.
 * Validates the capacity model's "~500 active docs per process"
 * single-thread broadcast ceiling against actual measurement.
 *
 * What it measures:
 *
 *   1. Connection setup time (TCP + WS handshake + auth submessage
 *      round-trip + initial Yjs sync vector exchange).
 *   2. Broadcast latency — time from a sender appending to the op-log
 *      Y.Array to N-1 peers observing the change. Single-core
 *      Hocuspocus broadcast is the v0.2 bottleneck per the model.
 *   3. Aggregate throughput (updates/sec across all rooms).
 *
 * Usage:
 *
 *   # Default: 20 rooms × 3 clients × 60 s. One writer per room
 *   # emits a fresh op-log entry every 5 seconds.
 *   pnpm --filter @sheet/server wsload
 *
 *   # Custom: ramp to the model's predicted ceiling.
 *   LOAD_ROOMS=100 LOAD_CLIENTS_PER_ROOM=3 LOAD_DURATION_S=120 \
 *     LOAD_WRITE_INTERVAL_MS=5000 \
 *     pnpm --filter @sheet/server wsload
 *
 *   # Quick smoke (5 rooms × 2 clients × 20 s):
 *   LOAD_ROOMS=5 LOAD_CLIENTS_PER_ROOM=2 LOAD_DURATION_S=20 \
 *     pnpm --filter @sheet/server wsload
 *
 * Output: numbers table — same shape as the HTTP harness so a future
 * CI gate can grep p99 numbers from either.
 *
 * Design notes:
 *
 *   - Connects via the public room flow (POST /api/rooms then WS to
 *     /yjs) so we exercise the same path real clients use, including
 *     the Hocuspocus auth submessage handshake.
 *   - One writer per room avoids write conflicts skewing latency;
 *     we want to measure broadcast, not contention.
 *   - Each writer's record carries a `ts` field so peers can compute
 *     receive_time - send_time directly. Doesn't require clock sync
 *     because both timestamps come from the same Node process.
 *   - The harness is the ONLY consumer of the rooms it creates, so
 *     there's no real-user load mixed in — clean numbers.
 *   - Rate-limit MUST be off for the create-rooms phase or the
 *     harness self-throttles. We exit cleanly with an explainer if
 *     the server returns 429.
 */
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';

const TARGET = process.env.LOAD_TARGET ?? 'http://localhost:3000';
const WS_TARGET =
  process.env.LOAD_WS_TARGET ??
  TARGET.replace(/^http/, 'ws').replace(/\/$/, '') + '/yjs';
const ROOMS = Number(process.env.LOAD_ROOMS ?? 20);
const CLIENTS_PER_ROOM = Number(process.env.LOAD_CLIENTS_PER_ROOM ?? 3);
const DURATION_S = Number(process.env.LOAD_DURATION_S ?? 60);
const WRITE_INTERVAL_MS = Number(process.env.LOAD_WRITE_INTERVAL_MS ?? 5_000);
const SPIN_UP_MS = Number(process.env.LOAD_SPIN_UP_MS ?? 5_000);

const LOG_KEY = 'ops'; // must match LOG_KEY in apps/web/src/collab/bridge.ts

interface ConnectMetrics {
  count: number;
  errors: number;
  latencies: number[]; // ms from new HocuspocusProvider() to 'synced' event
}

interface BroadcastMetrics {
  count: number;
  losses: number; // peers that never saw a record their room published
  latencies: number[]; // ms from writer push to peer observe
}

const connect: ConnectMetrics = { count: 0, errors: 0, latencies: [] };
const broadcast: BroadcastMetrics = { count: 0, losses: 0, latencies: [] };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface BeaconRecord {
  // Same shape as bridge's OpRecord but with a `_beacon` discriminator
  // so the real bridge (if it were attached) would ignore it.
  c: string;
  t: number;
  _beacon: true;
  /** Sender-side `performance.now()` at push time. Peers compare
   *  against their own `performance.now()` on observe. */
  sentAt: number;
  /** Per-write sequence so peers can detect dropped records. */
  seq: number;
}

async function createRoom(): Promise<string | null> {
  try {
    const res = await fetch(`${TARGET}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status === 429) {
      console.error(
        '[wsload] /api/rooms returned 429 — set RATE_LIMIT_ENABLED=false on the server, or raise RATE_LIMIT_PER_MIN well above ' +
          ROOMS +
          '.',
      );
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`[wsload] /api/rooms returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { roomId: string };
    return body.roomId;
  } catch (err) {
    console.error('[wsload] failed to create room:', String(err));
    return null;
  }
}

/**
 * One Hocuspocus client. Returns when the WS is fully synced AND the
 * provider has emitted at least one peer-aware tick — i.e. it's
 * ready to participate in the broadcast measurement.
 */
async function startClient(roomId: string): Promise<{
  provider: HocuspocusProvider;
  doc: Y.Doc;
  log: Y.Array<BeaconRecord>;
  clientId: string;
  connectMs: number;
}> {
  const doc = new Y.Doc();
  const log = doc.getArray<BeaconRecord>(LOG_KEY);

  const start = performance.now();
  // Node has no global WebSocket on older versions; inject explicitly
  // so the harness runs on Node 18+ regardless of fetch/ws state.
  const ws = new HocuspocusProviderWebsocket({
    url: WS_TARGET,
    messageReconnectTimeout: 10_000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WebSocketPolyfill: WebSocket as any,
  });

  // Race-safe: pass onSynced via the constructor options instead of
  // attaching with `.on('synced')` after construction. The provider
  // auto-connects on construction and the sync can complete before
  // an after-construction listener attaches — that race left the
  // 0.0.1 harness hanging on smoke runs.
  let resolveSync!: () => void;
  let rejectSync!: (err: Error) => void;
  const synced = new Promise<void>((resolve, reject) => {
    resolveSync = resolve;
    rejectSync = reject;
  });
  const timeout = setTimeout(() => {
    rejectSync(new Error(`sync timeout for room ${roomId}`));
  }, 15_000);

  const provider = new HocuspocusProvider({
    websocketProvider: ws,
    name: roomId,
    document: doc,
    token: 'anon',
    onSynced: () => {
      clearTimeout(timeout);
      resolveSync();
    },
  });

  await synced;
  const connectMs = performance.now() - start;

  return { provider, doc, log, clientId: String(doc.clientID), connectMs };
}

async function runRoom(roomIdx: number, stopAt: number): Promise<void> {
  const roomId = await createRoom();
  if (!roomId) {
    connect.errors += CLIENTS_PER_ROOM;
    return;
  }

  // Spin up all clients in parallel; track each connect latency.
  const clientPromises: Promise<Awaited<ReturnType<typeof startClient>>>[] = [];
  for (let i = 0; i < CLIENTS_PER_ROOM; i += 1) {
    clientPromises.push(startClient(roomId));
  }
  const clients = await Promise.allSettled(clientPromises);
  const ok: Awaited<ReturnType<typeof startClient>>[] = [];
  for (const c of clients) {
    if (c.status === 'fulfilled') {
      ok.push(c.value);
      connect.count += 1;
      connect.latencies.push(c.value.connectMs);
    } else {
      connect.errors += 1;
    }
  }

  if (ok.length < 2) {
    // Can't measure broadcast with fewer than 2 clients — clean up
    // and bail this room.
    for (const c of ok) c.provider.destroy();
    return;
  }

  const writer = ok[0];
  const readers = ok.slice(1);

  // Set up observers BEFORE the writer pushes — peers track the
  // latest sequence they've seen so we can count drops.
  const observed = new Map<string, { lastSeq: number; latencies: number[] }>();
  for (const reader of readers) {
    const rec = { lastSeq: -1, latencies: [] as number[] };
    observed.set(reader.clientId, rec);
    reader.log.observe((event) => {
      const now = performance.now();
      // Only count entries from OUR writer (not the reader's own
      // pushes, of which there are none here, but defensive).
      for (const ev of event.changes.added) {
        for (const item of ev.content.getContent()) {
          const r = item as BeaconRecord;
          if (!r?._beacon || r.c !== writer.clientId) continue;
          rec.latencies.push(now - r.sentAt);
          if (rec.lastSeq + 1 !== r.seq && rec.lastSeq !== -1) {
            // Out-of-order or dropped — count gaps as losses.
            broadcast.losses += r.seq - rec.lastSeq - 1;
          }
          rec.lastSeq = r.seq;
        }
      }
    });
  }

  // Writer loop: push a beacon record every WRITE_INTERVAL_MS until
  // stopAt. Each record carries a sender-side timestamp so peers can
  // compute latency without needing clock sync.
  let seq = 0;
  const writerLoop = (async () => {
    while (performance.now() < stopAt) {
      const rec: BeaconRecord = {
        c: writer.clientId,
        t: Date.now(),
        _beacon: true,
        sentAt: performance.now(),
        seq: seq,
      };
      writer.doc.transact(() => {
        writer.log.push([rec]);
      });
      seq += 1;
      await sleep(WRITE_INTERVAL_MS);
    }
  })();

  await writerLoop;

  // Drain — give peers a brief window to receive the last record(s)
  // before we tear down. Otherwise loss numbers are inflated by
  // in-flight messages.
  await sleep(1_000);

  // Roll up per-reader latencies into the global metric.
  for (const r of observed.values()) {
    for (const lat of r.latencies) {
      broadcast.count += 1;
      broadcast.latencies.push(lat);
    }
  }

  // Tear down.
  for (const c of ok) c.provider.destroy();

  void roomIdx; // kept available for verbose-mode logging if we want it
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function formatRow(label: string, count: number, errors: number, latencies: number[]): string {
  const sorted = [...latencies].sort((a, b) => a - b);
  return [
    label.padEnd(22),
    String(count).padStart(7),
    String(errors).padStart(6),
    percentile(sorted, 50).toFixed(1).padStart(8),
    percentile(sorted, 95).toFixed(1).padStart(8),
    percentile(sorted, 99).toFixed(1).padStart(8),
  ].join(' ');
}

async function main(): Promise<void> {
  console.log(
    `[wsload] target=${TARGET} ws=${WS_TARGET} rooms=${ROOMS} ` +
      `clients/room=${CLIENTS_PER_ROOM} duration=${DURATION_S}s ` +
      `write-interval=${WRITE_INTERVAL_MS}ms`,
  );

  // Health probe so a wrong TARGET fails fast.
  try {
    const h = await fetch(`${TARGET}/health`);
    if (!h.ok) {
      console.error(`[wsload] /health returned ${h.status} — server up?`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[wsload] /health unreachable at ${TARGET}: ${String(err)}`);
    process.exit(1);
  }

  const stopAt = performance.now() + DURATION_S * 1_000;
  const promises: Promise<void>[] = [];
  for (let i = 0; i < ROOMS; i += 1) {
    const delay = (i / ROOMS) * SPIN_UP_MS;
    promises.push(sleep(delay).then(() => runRoom(i, stopAt)));
  }
  await Promise.all(promises);

  // Output.
  console.log('');
  console.log('metric                   count errors  p50(ms)  p95(ms)  p99(ms)');
  console.log('---------------------- ------- ------ -------- -------- --------');
  console.log(formatRow('WS connect + sync', connect.count, connect.errors, connect.latencies));
  console.log(formatRow('Broadcast latency', broadcast.count, broadcast.losses, broadcast.latencies));
  console.log('');
  const sustainedPeers = ROOMS * Math.max(0, CLIENTS_PER_ROOM - 1);
  const updatesPerSec = broadcast.count / DURATION_S;
  console.log(
    `[wsload] totals: ${connect.count} clients connected ` +
      `(${connect.errors} failed), ${broadcast.count} broadcast events ` +
      `received across ${sustainedPeers} peer-clients, ` +
      `${broadcast.losses} dropped records, ` +
      `${updatesPerSec.toFixed(1)} updates/s aggregate.`,
  );
}

void main()
  .then(() => {
    // Hocuspocus providers keep event-loop refs alive (WS heartbeats,
    // reconnect timers) even after destroy() — Node won't exit on its
    // own. Force exit so `pnpm wsload` returns to the shell promptly.
    // Any post-destroy "missing token" warnings from in-flight reconnect
    // attempts are harmless — the numbers are already printed.
    process.exit(0);
  })
  .catch((err) => {
    console.error('[wsload] crashed:', err);
    process.exit(1);
  });
