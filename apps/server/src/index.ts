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

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

// Serve the built web bundle if present (production / docker). In dev the
// web app lives on a separate Vite server on :5273 and this path is empty.
const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');
const servesWeb = existsSync(join(webDist, 'index.html'));
if (servesWeb) {
  await app.register(staticPlugin, {
    root: webDist,
    prefix: '/',
    decorateReply: false,
    wildcard: false,
  });
  app.log.info(`serving built web app from ${webDist}`);
} else {
  app.log.info(`web/dist not built — run 'pnpm --filter @sheet/web build' or use compose`);
}

// In-memory room registry. Starts an interval that GCs idle rooms.
const rooms = new RoomRegistry();
rooms.start();
app.addHook('onClose', async () => rooms.stop());

app.get('/health', async () => ({
  ok: true,
  ts: Date.now(),
  rooms: rooms.snapshot().length,
}));

// Create a fresh room. v1: empty Y.Doc; xlsx-seeded rooms come once we
// wire ExcelJS → Yjs on the server.
app.post('/api/rooms', async () => {
  const id = rooms.create();
  return { roomId: id };
});

// Diagnostic: list current rooms (clients, idle time). No auth — fine
// for v1 since the surface is anonymous and self-hosted anyway.
app.get('/api/rooms', async () => ({ rooms: rooms.snapshot() }));

// Placeholders — implemented once the server-side xlsx ↔ Y.Doc bridge
// lands. For v1 the client uploads through the existing browser parser
// and writes into the live Y.Doc directly.
app.post('/upload', async (_req, reply) => {
  return reply.code(501).send({ error: 'not_implemented', phase: 'phase-2.1' });
});

app.get('/download/:roomId', async (_req, reply) => {
  return reply.code(501).send({ error: 'not_implemented', phase: 'phase-2.1' });
});

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

// Persistence backend: REDIS_URL → Redis, otherwise in-memory.
const storage = await createStorage();
app.log.info(
  `doc storage: ${process.env.REDIS_URL ? `redis (${process.env.REDIS_URL})` : 'in-memory'}`,
);

// Hocuspocus needs the underlying Node http server for the upgrade
// handler. Fastify exposes it after listen.
const hocus = attachHocuspocus(app.server, rooms, storage);

const shutdown = async () => {
  app.log.info('shutting down');
  await hocus.close();
  await storage.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.log.info(`sheet server listening on http://${HOST}:${PORT}`);
app.log.info(`websocket sync on ws://${HOST}:${PORT}/yjs`);
