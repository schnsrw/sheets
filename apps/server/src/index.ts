import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

app.get('/health', async () => ({ ok: true, ts: Date.now() }));

// Placeholders — implemented in Phase 2 when the xlsx ↔ IWorkbookData converter lands.
app.post('/upload', async (_req, reply) => {
  return reply.code(501).send({ error: 'not_implemented', phase: 'phase-2' });
});

app.get('/download/:roomId', async (_req, reply) => {
  return reply.code(501).send({ error: 'not_implemented', phase: 'phase-2' });
});

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    app.log.info(`sheet server listening on http://${HOST}:${PORT}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
