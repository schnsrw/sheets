import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { RoomRegistry } from './rooms.js';
import { attachHocuspocus } from './yjs.js';
import { createStorage } from './storage.js';
import { createHost } from './host/index.js';
import { registerWopiRoutes } from './wopi.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
// Cap on multipart + raw-binary uploads — bounds the seed/snapshot
// path. If you raise this, also bump the web client's VITE_MAX_OPEN_MB
// so the share dialog doesn't get rejected here after the user picked
// a workbook the browser said it could open.
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 100);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const app = Fastify({ logger: true, bodyLimit: MAX_UPLOAD_BYTES });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

// Accept raw binary uploads (used by /api/rooms/:id/snapshot for the
// gzipped IWorkbookData cache). Cap matches the multipart limit so a
// single content-type isn't an end-run around the size guard.
app.addContentTypeParser(
  'application/gzip',
  { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
  (_req, body, done) => done(null, body),
);
app.addContentTypeParser(
  'application/octet-stream',
  { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
  (_req, body, done) => done(null, body),
);

// Serve the built web bundle if present (production / docker). In dev the
// web app lives on a separate Vite server on :5273 and this path is empty.
const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');
const servesWeb = existsSync(join(webDist, 'index.html'));
if (servesWeb) {
  await app.register(staticPlugin, {
    root: webDist,
    prefix: '/',
    // `decorateReply: true` (the default) gives us `reply.sendFile()` —
    // required by the SPA fallback below so `/r/<roomId>` reloads serve
    // index.html instead of 500'ing.
    wildcard: false,
  });
  app.log.info(`serving built web app from ${webDist}`);
} else {
  app.log.info(`web/dist not built — run 'pnpm --filter @sheet/web build' or use compose`);
}

// Persistence backend created first so the room registry can use it
// as the eviction callback — when a room is GC'd, we also drop its
// persisted Y.Doc bytes so Redis doesn't accumulate orphans the
// in-memory registry has forgotten about.
const storage = await createStorage();
app.log.info(
  `doc storage: ${process.env.REDIS_URL ? `redis (${process.env.REDIS_URL})` : 'in-memory'}`,
);

// Workbook FILE storage — separate concern from Y.Doc update storage
// above (rooms vs files). Drives the WOPI /wopi/files/:id routes and
// the admin-panel storage page in v0.1.0.
const host = await createHost();
app.log.info(`workbook host: ${host.label}`);
registerWopiRoutes(app, host);

const rooms = new RoomRegistry();
rooms.start((evictedId) => {
  // Fire-and-forget — storage.delete is best-effort, a failure just
  // means the blob waits out Redis's 7-day TTL. We don't want a
  // backend hiccup to stall the GC loop.
  storage.delete(evictedId).catch((err) => {
    app.log.warn({ err, roomId: evictedId }, 'storage delete failed for evicted room');
  });
});
app.addHook('onClose', async () => rooms.stop());

app.get('/health', async () => ({
  ok: true,
  ts: Date.now(),
  rooms: rooms.snapshot().length,
}));

/**
 * Create a fresh room. Body is optional JSON `{ password?: string }`.
 * Empty Y.Doc to start — the room creator's client seeds it (via xlsx
 * open or fresh edits) which then propagates through the op-log bridge
 * to anyone who joins. Keeps the server out of the workbook parsing
 * business; everything goes through the same code path on the client.
 */
app.post('/api/rooms', async (req) => {
  const body = (req.body ?? {}) as { password?: unknown };
  const password =
    typeof body.password === 'string' && body.password.length > 0
      ? body.password
      : undefined;
  const id = rooms.create({ password });
  return { roomId: id, needsPassword: Boolean(password) };
});

/**
 * Pre-flight check for a join URL. Lets the client decide whether to
 * prompt for a password before opening the WebSocket. Returns 404 when
 * the room doesn't exist so a bad link surfaces immediately.
 */
app.get<{ Params: { id: string } }>('/api/rooms/:id/info', async (req, reply) => {
  const room = rooms.get(req.params.id);
  if (!room) return reply.code(404).send({ error: 'room_not_found' });
  return {
    id: room.id,
    needsPassword: room.passwordHash !== null,
    hasSeed: Boolean(room.xlsxSeed),
    /** True when the server has a pre-parsed snapshot. Joiners that see
     *  this can skip the xlsx parser entirely and apply the snapshot
     *  directly — multi-second win on big workbooks. */
    hasSnapshot: Boolean(room.snapshotGz),
    clients: room.clients,
  };
});

/**
 * Upload an xlsx file as the room's starting workbook. Joiners GET the
 * same bytes via /seed and import them locally before the op-log bridge
 * takes over — that's how content the owner had before creating the room
 * reaches peers (the op log only carries *future* mutations).
 *
 * No auth: the owner is the only client who knows the freshly-minted
 * roomId at this instant. A misuse window of "another tab races to
 * overwrite the seed before the owner uploads" is theoretical and not
 * worth more machinery in a self-hosted v1.
 */
app.post<{ Params: { id: string } }>('/api/rooms/:id/seed', async (req, reply) => {
  const room = rooms.get(req.params.id);
  if (!room) return reply.code(404).send({ error: 'room_not_found' });
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'no_file' });
  const buf = await file.toBuffer();
  rooms.setXlsxSeed(req.params.id, new Uint8Array(buf));
  return { ok: true, bytes: buf.byteLength };
});

/**
 * Serve the room's xlsx starting workbook. Joiners apply this locally
 * before the bridge runs so they begin from the same state as the owner.
 *
 * Gated by the room password (header `x-room-password`) when the room
 * is password-protected. Without this gate, anyone with the room URL
 * could fetch the contents — making the password a UI illusion rather
 * than an actual access control.
 */
app.get<{ Params: { id: string } }>('/api/rooms/:id/seed', async (req, reply) => {
  const room = rooms.get(req.params.id);
  if (!room?.xlsxSeed) return reply.code(404).send({ error: 'no_seed' });
  if (!checkRoomPassword(req, room.id)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  reply.header(
    'content-type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  reply.header('cache-control', 'no-store');
  return reply.send(Buffer.from(room.xlsxSeed));
});

/**
 * Constant-time password check for a room request. The password rides
 * the `x-room-password` header — preferable to a query string because
 * it stays out of access logs and browser history. Falls back to the
 * `?p=` query param so clients with restricted header control (e.g.
 * EventSource) can still authenticate.
 *
 * Returns true for open (no-password) rooms.
 */
function checkRoomPassword(req: { headers: Record<string, unknown>; query?: unknown }, roomId: string): boolean {
  const headerVal = req.headers['x-room-password'];
  const headerPw = typeof headerVal === 'string' ? headerVal : undefined;
  const queryPw =
    typeof req.query === 'object' && req.query !== null
      ? (req.query as { p?: unknown }).p
      : undefined;
  const password = typeof headerPw === 'string' ? headerPw : typeof queryPw === 'string' ? queryPw : undefined;
  return rooms.passwordOk(roomId, password ?? null);
}

/**
 * Upload a pre-parsed gzipped `IWorkbookData` snapshot for the room.
 * Owner-side: serialize the in-memory workbook (no ExcelJS), gzip,
 * upload — joiners then skip parsing entirely. Body is the raw gzipped
 * bytes (no multipart envelope), keeping the upload tiny.
 */
app.post<{ Params: { id: string } }>('/api/rooms/:id/snapshot', async (req, reply) => {
  const room = rooms.get(req.params.id);
  if (!room) return reply.code(404).send({ error: 'room_not_found' });
  // Fastify gives us the raw body when content-type isn't JSON/form;
  // ensure we got bytes.
  const body = req.body as unknown;
  let bytes: Uint8Array | null = null;
  if (body instanceof Buffer) bytes = new Uint8Array(body);
  else if (body instanceof Uint8Array) bytes = body;
  if (!bytes || bytes.byteLength === 0) {
    return reply.code(400).send({ error: 'empty_body' });
  }
  rooms.setSnapshotGz(req.params.id, bytes);
  return { ok: true, bytes: bytes.byteLength };
});

/**
 * Serve the room's pre-parsed gzipped snapshot. Cache-able forever —
 * the snapshot bytes for a given room id never change outside of an
 * owner re-upload, which is rare. Browser disk cache hits make the
 * second-and-Nth joiner load nearly free.
 */
app.get<{ Params: { id: string } }>('/api/rooms/:id/snapshot', async (req, reply) => {
  const room = rooms.get(req.params.id);
  if (!room?.snapshotGz) return reply.code(404).send({ error: 'no_snapshot' });
  if (!checkRoomPassword(req, room.id)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  reply.header('content-type', 'application/json');
  reply.header('content-encoding', 'gzip');
  // Private — the password gates access, so each protected response
  // must NOT be served from a shared / proxy cache. Browser disk cache
  // still kicks in (immutable) so warm re-joins stay fast.
  reply.header('cache-control', room.passwordHash ? 'private, max-age=3600, immutable' : 'public, max-age=3600, immutable');
  return reply.send(Buffer.from(room.snapshotGz));
});

// Diagnostic: list current rooms (clients, idle time). No auth — fine
// for v1 since the surface is anonymous and self-hosted anyway.
app.get('/api/rooms', async () => ({ rooms: rooms.snapshot() }));

// SPA fallback — any unknown HTML route serves index.html so client-side
// routing (e.g. /r/:roomId) works on reload. Only registered when the
// web bundle is present (production / docker).
if (servesWeb) {
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET') return reply.code(404).send();
    const accept = req.headers.accept ?? '';
    if (!accept.includes('text/html')) return reply.code(404).send();
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: HOST });

// Hocuspocus needs the underlying Node http server for the upgrade
// handler. Fastify exposes it after listen. Storage was created
// earlier (right after the app instance) so the room registry could
// register its eviction callback.
const hocus = attachHocuspocus(app.server, rooms, storage);

const shutdown = async () => {
  app.log.info('shutting down');
  await hocus.close();
  await storage.close();
  if (host.close) await host.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.log.info(`sheet server listening on http://${HOST}:${PORT}`);
app.log.info(`websocket sync on ws://${HOST}:${PORT}/yjs`);
