import type { FastifyInstance } from 'fastify';
import type { HostIntegration } from './host/index.js';
import { VersionMismatchError } from './host/index.js';

/**
 * WOPI host endpoints — minimal subset for v0.1.0.
 *
 * Three routes covering the core triad:
 *
 *   GET    /wopi/files/:id             → CheckFileInfo (JSON metadata)
 *   GET    /wopi/files/:id/contents    → GetFile (raw bytes)
 *   POST   /wopi/files/:id/contents    → PutFile (raw bytes; If-Match)
 *
 * The full WOPI spec has 40+ endpoints (Lock, Unlock, RefreshLock,
 * RenameFile, GetShareUrl, …); we ship the subset that lets a workbook
 * persist + reload outside the live-collab session. The rest can land
 * as the integration matures.
 *
 * Auth in v0.1.0 is intentionally lightweight — the same
 * `x-room-password` flow that gates room-snapshot reads also gates
 * WOPI access when set. Without a password, the WOPI surface is open
 * to anyone with the file id, which matches the v0.0.x "anonymous by
 * URL" model. v0.2 adds the WOPI access-token machinery.
 */
export function registerWopiRoutes(
  app: FastifyInstance,
  host: HostIntegration,
): void {
  /** CheckFileInfo: GET /wopi/files/:id
   *
   * Returns JSON metadata. Mirrors the WOPI CheckFileInfo response
   * shape minimally — `BaseFileName`, `Size`, `Version`, `OwnerId`
   * (when known), `LastModifiedTime`. */
  app.get<{ Params: { id: string } }>('/wopi/files/:id', async (req, reply) => {
    const info = await host.checkFileInfo(req.params.id);
    if (!info) return reply.code(404).send({ error: 'file_not_found' });
    return {
      BaseFileName: info.baseFileName,
      Size: info.size,
      Version: info.version,
      OwnerId: info.ownerId,
      LastModifiedTime: info.lastModifiedIso,
    };
  });

  /** GetFile: GET /wopi/files/:id/contents
   *
   * Returns the raw `.xlsx` bytes. */
  app.get<{ Params: { id: string } }>(
    '/wopi/files/:id/contents',
    async (req, reply) => {
      const bytes = await host.getFile(req.params.id);
      if (!bytes) return reply.code(404).send({ error: 'file_not_found' });
      const info = await host.checkFileInfo(req.params.id);
      reply.header(
        'content-type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      if (info?.version) reply.header('X-WOPI-ItemVersion', info.version);
      reply.header('cache-control', 'no-store');
      return reply.send(Buffer.from(bytes));
    },
  );

  /** PutFile: POST /wopi/files/:id/contents
   *
   * Saves new bytes. Honours an optional `X-WOPI-ItemVersion` header
   * as an If-Match constraint (returns 409 on mismatch — the WOPI
   * spec uses 409 for version conflicts). */
  app.post<{ Params: { id: string } }>(
    '/wopi/files/:id/contents',
    async (req, reply) => {
      const body = req.body as unknown;
      let bytes: Uint8Array | null = null;
      if (body instanceof Buffer) bytes = new Uint8Array(body);
      else if (body instanceof Uint8Array) bytes = body;
      if (!bytes || bytes.byteLength === 0) {
        return reply.code(400).send({ error: 'empty_body' });
      }
      const ifMatch = req.headers['x-wopi-itemversion'] as string | undefined;
      try {
        const version = await host.putFile(req.params.id, bytes, {
          ifMatchVersion: ifMatch,
        });
        reply.header('X-WOPI-ItemVersion', version);
        return { ok: true, version, bytes: bytes.byteLength };
      } catch (err) {
        if (err instanceof VersionMismatchError) {
          return reply.code(409).send({
            error: 'version_mismatch',
            expected: err.expected,
            actual: err.actual,
          });
        }
        throw err;
      }
    },
  );

  /** Admin-style listing — used by the admin panel's storage page.
   *  Returns the file ids the host knows about. Optional capability;
   *  backends without cheap listing return undefined and we 405. */
  app.get('/api/files', async (_req, reply) => {
    if (typeof host.listFiles !== 'function') {
      return reply.code(405).send({ error: 'listing_not_supported' });
    }
    const ids = await host.listFiles();
    return { backend: host.label, files: ids };
  });

  /** Operator probe — surfaces in the admin panel's "Test connection"
   *  button. Returns `{ ok: true }` or `{ ok: false, error }`. */
  app.get('/api/files/_health', async () => {
    if (typeof host.healthcheck !== 'function') return { ok: true, backend: host.label };
    const err = await host.healthcheck();
    return err ? { ok: false, backend: host.label, error: err } : { ok: true, backend: host.label };
  });
}
