import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { HostIntegration } from './host/index.js';
import { VersionMismatchError } from './host/index.js';
import {
  TokenInvalidError,
  authFromClaims,
  isJwtEnabled,
  resolveAuth,
  signAccessToken,
  type AccessClaims,
  type AuthContext,
} from './auth/index.js';

/**
 * WOPI host endpoints — JWT-secured.
 *
 * Three core routes:
 *
 *   GET    /wopi/files/:id             → CheckFileInfo (JSON metadata)
 *   GET    /wopi/files/:id/contents    → GetFile (raw bytes)
 *   POST   /wopi/files/:id/contents    → PutFile (raw bytes; If-Match)
 *
 * Plus admin helpers (listing + healthcheck) and an issuance endpoint
 * for admin-gated token minting.
 *
 * Auth flow (when `CASUAL_JWT_SECRET` is set):
 *   1. Client sends `?access_token=<JWT>` or `Authorization: Bearer …`.
 *   2. Server verifies signature + expiry.
 *   3. Claim `file_id` must equal the URL `:id` — a token issued for
 *      file A can NOT access file B.
 *   4. Per-route permission check: GetFile needs `read`, PutFile
 *      needs `write`, listing needs `admin`.
 *   5. CheckFileInfo response includes role / permissions / features
 *      so the client can drive UI gating from the same source of
 *      truth.
 *
 * Back-compat: when `CASUAL_JWT_SECRET` is unset, WOPI routes are
 * anonymous-by-URL (v0.0.x behaviour). Operators opt-in to auth by
 * setting the secret.
 */
export function registerWopiRoutes(
  app: FastifyInstance,
  host: HostIntegration,
): void {
  /** Pull AuthContext off the request + verify the token's file_id
   *  matches the URL :id. Returns 401/403 reply when invalid; returns
   *  the AuthContext on success. */
  const authFor = (
    req: FastifyRequest,
    fileId: string,
    reply: FastifyRequest['raw'] extends never
      ? never
      : { code: (n: number) => { send: (b: unknown) => unknown } },
  ): AuthContext | null => {
    let ctx: AuthContext;
    try {
      // JWT_REQUIRED env opts in to "deny anonymous on WOPI routes
      // even when CASUAL_JWT_SECRET is set but the request is
      // unauthenticated." On by default once the secret is set.
      ctx = resolveAuth(req, { required: isJwtEnabled() });
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (reply as any).code(err.statusCode).send({ error: err.message });
        return null;
      }
      throw err;
    }
    // Anonymous fall-through is allowed only when JWT is not
    // configured at all.
    if (!isJwtEnabled()) return ctx;

    // Token present — file_id must match.
    if (!ctx.claims) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reply as any).code(401).send({ error: 'token_required' });
      return null;
    }
    if (!ctx.fileIdMatches(fileId)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reply as any).code(403).send({ error: 'file_id_mismatch' });
      return null;
    }
    return ctx;
  };

  // ─── CheckFileInfo ──────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/wopi/files/:id', async (req, reply) => {
    const ctx = authFor(req, req.params.id, reply);
    if (!ctx) return;
    if (isJwtEnabled() && !ctx.permissions.read) {
      return reply.code(403).send({ error: 'read_not_permitted' });
    }
    const info = await host.checkFileInfo(req.params.id);
    if (!info) return reply.code(404).send({ error: 'file_not_found' });
    // Surface role + permissions + features in the response so the
    // client gates UI from the same claims the server enforces from.
    return {
      // ─── WOPI CheckFileInfo standard fields ───
      BaseFileName: info.baseFileName,
      Size: info.size,
      Version: info.version,
      OwnerId: info.ownerId ?? ctx.claims?.sub,
      LastModifiedTime: info.lastModifiedIso,
      UserId: ctx.claims?.sub,
      UserFriendlyName: ctx.claims?.display_name ?? ctx.claims?.sub,
      // ─── WOPI standard permission booleans ───
      ReadOnly: !ctx.permissions.write,
      UserCanWrite: ctx.permissions.write,
      UserCanRename: ctx.permissions.admin,
      UserCanAttend: ctx.permissions.read,
      UserCanPresent: ctx.permissions.admin,
      // ─── Casual extensions — role + features + flags so the
      // client doesn't have to decode the JWT itself. ───
      casualRole: ctx.claims?.role ?? 'anonymous',
      casualPermissions: ctx.permissions,
      casualFeatures: ctx.features,
      casualPasswordRequired: ctx.claims?.password_required ?? false,
    };
  });

  // ─── GetFile ────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/wopi/files/:id/contents',
    async (req, reply) => {
      const ctx = authFor(req, req.params.id, reply);
      if (!ctx) return;
      if (isJwtEnabled() && !ctx.permissions.read) {
        return reply.code(403).send({ error: 'read_not_permitted' });
      }
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

  // ─── PutFile ────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/wopi/files/:id/contents',
    async (req, reply) => {
      const ctx = authFor(req, req.params.id, reply);
      if (!ctx) return;
      if (isJwtEnabled() && !ctx.permissions.write) {
        return reply.code(403).send({ error: 'write_not_permitted' });
      }
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

  // ─── /api/me — self-check for the active token ──────────────────
  app.get('/api/me', async (req, reply) => {
    try {
      const ctx = resolveAuth(req);
      return {
        anonymous: ctx.claims === null,
        role: ctx.claims?.role ?? 'anonymous',
        sub: ctx.claims?.sub,
        displayName: ctx.claims?.display_name ?? ctx.claims?.sub,
        fileId: ctx.claims?.file_id,
        permissions: ctx.permissions,
        features: ctx.features,
        passwordRequired: ctx.claims?.password_required ?? false,
        exp: ctx.claims?.exp,
      };
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  // ─── Admin: file listing ────────────────────────────────────────
  app.get('/api/files', async (req, reply) => {
    if (isJwtEnabled()) {
      let ctx: AuthContext;
      try {
        ctx = resolveAuth(req, { required: true });
      } catch (err) {
        if (err instanceof TokenInvalidError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
      if (!ctx.permissions.admin) {
        return reply.code(403).send({ error: 'admin_required' });
      }
    }
    if (typeof host.listFiles !== 'function') {
      return reply.code(405).send({ error: 'listing_not_supported' });
    }
    const ids = await host.listFiles();
    return { backend: host.label, files: ids };
  });

  // ─── Healthcheck ────────────────────────────────────────────────
  app.get('/api/files/_health', async () => {
    if (typeof host.healthcheck !== 'function')
      return { ok: true, backend: host.label };
    const err = await host.healthcheck();
    return err
      ? { ok: false, backend: host.label, error: err }
      : { ok: true, backend: host.label };
  });

  // ─── Admin: mint an access token ────────────────────────────────
  // POST /api/tokens
  //   body: { sub, file_id, role, permissions?, features?,
  //           password_required?, display_name?, ttl_seconds?, aud?, iss? }
  // Returns: { token, claims }
  //
  // Gated by admin role on the caller's own token. Operators bootstrap
  // by signing an initial admin token out-of-band (e.g. by running
  // `node -e "..."` against the secret) — same shape AWS / GCP use.
  app.post('/api/tokens', async (req, reply) => {
    if (!isJwtEnabled()) {
      return reply.code(503).send({
        error: 'jwt_not_configured',
        hint: 'Set CASUAL_JWT_SECRET (≥ 16 chars) to enable token issuance',
      });
    }
    let ctx: AuthContext;
    try {
      ctx = resolveAuth(req, { required: true });
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
    if (!ctx.permissions.admin) {
      return reply.code(403).send({ error: 'admin_required' });
    }

    const body = req.body as Partial<AccessClaims> & { ttl_seconds?: number };
    if (!body || typeof body.sub !== 'string' || typeof body.file_id !== 'string') {
      return reply.code(400).send({ error: 'sub_and_file_id_required' });
    }
    const role = (body.role ?? 'viewer') as AccessClaims['role'];
    const ttl = typeof body.ttl_seconds === 'number' ? body.ttl_seconds : 60 * 60;
    const claims: Omit<AccessClaims, 'iat' | 'exp'> = {
      sub: body.sub,
      file_id: body.file_id,
      role,
      permissions: body.permissions,
      features: body.features,
      password_required: body.password_required,
      display_name: body.display_name,
      aud: body.aud,
      iss: body.iss,
    };
    const token = signAccessToken(claims, { ttlSeconds: ttl });
    const fullClaims = { ...claims, iat: Math.floor(Date.now() / 1000) } as AccessClaims;
    const summary = authFromClaims(fullClaims);
    return {
      token,
      ttl_seconds: ttl,
      claims: fullClaims,
      resolved_permissions: summary.permissions,
      resolved_features: summary.features,
    };
  });
}
