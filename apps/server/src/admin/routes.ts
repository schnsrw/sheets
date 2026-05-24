import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  TokenInvalidError,
  isJwtEnabled,
  resolveAuth,
  signAccessToken,
} from '../auth/index.js';
import {
  AdminConfigStore,
  redactSecrets,
  type AdminConfig,
} from './config.js';

/**
 * Admin panel REST routes.
 *
 * Auth model (env-driven, no DB):
 *
 *   1. Operator sets `CASUAL_ADMIN_USERNAME` + `CASUAL_ADMIN_PASSWORD`
 *      on the container. Both required to enable the panel; if either
 *      is unset, every /api/admin/* route returns 503.
 *   2. The panel POSTs the username + password to /api/admin/login.
 *      Server constant-time-compares against the env values.
 *   3. On success, server mints an admin-role JWT (1-hour TTL by
 *      default; configurable via CASUAL_ADMIN_SESSION_TTL). The panel
 *      stores it client-side + sends it as `Authorization: Bearer`
 *      on every subsequent /api/admin/* call.
 *   4. The same admin JWT can be used against /api/tokens to mint
 *      narrower tokens for end-users (this is how the panel issues
 *      view-only / editor links).
 *
 * The on-disk config (`CASUAL_ADMIN_CONFIG_PATH`, default
 * `/data/casual-admin.json`) is the source of truth for runtime
 * configuration; the panel reads + writes it through these routes.
 * Env vars provide first-boot defaults; panel writes override env
 * (env is bootstrap floor, panel is runtime override).
 */

const ADMIN_SESSION_TTL_DEFAULT = 60 * 60; // 1 h

function isAdminConfigured(): boolean {
  return (
    typeof process.env.CASUAL_ADMIN_USERNAME === 'string' &&
    process.env.CASUAL_ADMIN_USERNAME.length > 0 &&
    typeof process.env.CASUAL_ADMIN_PASSWORD === 'string' &&
    process.env.CASUAL_ADMIN_PASSWORD.length > 0 &&
    isJwtEnabled()
  );
}

/** Constant-time string equality. Pads shorter input to longer so
 *  length difference doesn't leak via the comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a, 'utf8');
  const B = Buffer.from(b, 'utf8');
  if (A.length !== B.length) {
    // Compare A against itself + return false so the timing
    // signature for "wrong length" matches "right length, wrong value".
    timingSafeEqual(A, A);
    return false;
  }
  return timingSafeEqual(A, B);
}

/** Verify the request carries an admin JWT. Returns null on failure
 *  (after sending the reply). On success, returns the AuthContext. */
async function requireAdmin(
  req: FastifyRequest,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reply: any,
) {
  try {
    const ctx = resolveAuth(req, { required: true });
    if (!ctx.permissions.admin) {
      reply.code(403).send({ error: 'admin_required' });
      return null;
    }
    return ctx;
  } catch (err) {
    if (err instanceof TokenInvalidError) {
      reply.code(err.statusCode).send({ error: err.message });
      return null;
    }
    throw err;
  }
}

export function registerAdminRoutes(
  app: FastifyInstance,
  store: AdminConfigStore,
): void {
  const guardConfigured = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reply: any,
  ): boolean => {
    if (!isAdminConfigured()) {
      reply.code(503).send({
        error: 'admin_not_configured',
        hint:
          'Set CASUAL_ADMIN_USERNAME, CASUAL_ADMIN_PASSWORD, and ' +
          'CASUAL_JWT_SECRET (≥ 16 chars) to enable the admin panel',
      });
      return false;
    }
    return true;
  };

  /** Probe whether the admin panel is enabled. Public — used by the
   *  panel's bootstrap to decide whether to render the login form or
   *  the "not configured" message. */
  app.get('/api/admin/status', async () => ({
    configured: isAdminConfigured(),
  }));

  /** Exchange username + password for an admin JWT. */
  app.post<{
    Body: { username?: unknown; password?: unknown };
  }>('/api/admin/login', async (req, reply) => {
    if (!guardConfigured(reply)) return;
    const body = req.body ?? {};
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const expectedUser = process.env.CASUAL_ADMIN_USERNAME!;
    const expectedPass = process.env.CASUAL_ADMIN_PASSWORD!;
    const ok =
      constantTimeEqual(username, expectedUser) &&
      constantTimeEqual(password, expectedPass);
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const ttl = Number(
      process.env.CASUAL_ADMIN_SESSION_TTL ?? ADMIN_SESSION_TTL_DEFAULT,
    );
    const token = signAccessToken(
      {
        sub: username,
        // Admin sessions aren't bound to a single file — use the
        // wildcard sentinel `*` and bypass the per-route file-id
        // check in the issuance endpoint (other admin routes don't
        // enforce file_id).
        file_id: '*',
        role: 'admin',
        display_name: username,
      },
      { ttlSeconds: ttl },
    );
    return {
      token,
      ttl_seconds: ttl,
      username,
    };
  });

  /** Read the current config. Secrets are redacted in the response —
   *  the panel re-sends `***` for unchanged secret inputs and the
   *  patch endpoint preserves the prior verbatim value. */
  app.get('/api/admin/config', async (req, reply) => {
    if (!guardConfigured(reply)) return;
    if (!(await requireAdmin(req, reply))) return;
    const cfg = await store.load();
    return redactSecrets(cfg);
  });

  /** Write a (partial) config. Deep-merges into the existing
   *  on-disk config so the panel can submit one section at a time
   *  without losing the others. */
  app.put<{ Body: Partial<AdminConfig> }>(
    '/api/admin/config',
    async (req, reply) => {
      if (!guardConfigured(reply)) return;
      if (!(await requireAdmin(req, reply))) return;
      const next = await store.patch(req.body);
      return redactSecrets(next);
    },
  );
}
