import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import type { PersonalAuthStore, PublicUser } from './personal.js';

/**
 * Fastify routes for the personal-mode auth surface — `POST /auth/signup`,
 * `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
 * `POST /auth/change-password`, `POST /auth/delete-account`.
 *
 * Cookie: `cs_session=<opaque id>`. `HttpOnly` (no JS access),
 * `SameSite=Lax` (allow top-level form posts but block cross-site).
 * `Secure` is added when the request was forwarded over HTTPS, since
 * the dev server runs on plain HTTP at `127.0.0.1:3000`.
 *
 * All write routes go through the global rate limit when enabled;
 * `GET /auth/me` is unbounded since it's polled on every page load.
 */

const COOKIE_NAME = 'cs_session';

export function registerPersonalAuthRoutes(app: FastifyInstance, store: PersonalAuthStore): void {
  // ── POST /auth/signup ───────────────────────────────────────────────
  app.post('/auth/signup', async (req, reply) => {
    if (store.mode === 'none') return reply.code(503).send({ error: 'personal-mode-disabled' });
    if (!store.signupAllowed()) return reply.code(403).send({ error: 'signup-closed' });

    const body = parseCredentials(req.body);
    if (!body) return reply.code(400).send({ error: 'bad-body' });

    const result = store.createUser(body.username, body.password);
    if (!result.ok) {
      const status = result.reason === 'username-taken' ? 409 : 400;
      return reply.code(status).send({ error: result.reason });
    }
    issueSession(reply, store, result.user, isHttps(req));
    return reply.code(201).send({ user: result.user });
  });

  // ── POST /auth/login ────────────────────────────────────────────────
  app.post('/auth/login', async (req, reply) => {
    if (store.mode === 'none') return reply.code(503).send({ error: 'personal-mode-disabled' });

    const body = parseCredentials(req.body);
    if (!body) return reply.code(400).send({ error: 'bad-body' });

    const result = store.verifyLogin(body.username, body.password);
    if (!result.ok) return reply.code(401).send({ error: result.reason });

    issueSession(reply, store, result.user, isHttps(req));
    return reply.send({ user: result.user });
  });

  // ── POST /auth/logout ───────────────────────────────────────────────
  app.post('/auth/logout', async (req, reply) => {
    const sessionId = req.cookies?.[COOKIE_NAME];
    if (sessionId) store.endSession(sessionId);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  // ── GET /auth/me ────────────────────────────────────────────────────
  app.get('/auth/me', async (req, reply) => {
    // 503 when mode is `none` so the web client can distinguish
    // "logged out" (401) from "personal auth is not enabled here"
    // (503) and skip the auth gate entirely in the latter case.
    if (store.mode === 'none') return reply.code(503).send({ error: 'personal-mode-disabled' });
    const user = currentUser(req, store);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.send({ user });
  });

  // ── GET /auth/status ────────────────────────────────────────────────
  // Public probe — the web client hits this on boot to decide which
  // surface to render: signup (first user), login (existing user, not
  // signed in), or the app itself (signed in). Always 200; the body's
  // discriminator carries the state. Distinct from /auth/me so we can
  // tell the client "signup is open" without needing the client to be
  // authenticated first.
  app.get('/auth/status', async (req, reply) => {
    const user = currentUser(req, store);
    return reply.send({
      mode: store.mode,
      signupAllowed: store.signupAllowed(),
      hasAnyUser: store.hasAnyUser(),
      user,
    });
  });

  // ── POST /auth/change-password ──────────────────────────────────────
  app.post('/auth/change-password', async (req, reply) => {
    const user = currentUser(req, store);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });

    const body = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      return reply.code(400).send({ error: 'bad-body' });
    }
    const ok = store.changePassword(user.id, body.currentPassword, body.newPassword);
    if (!ok) return reply.code(400).send({ error: 'rejected' });

    // The store wipes every session for this user — including the one
    // we're answering on. Issue a fresh cookie so the caller isn't
    // logged out by their own password change.
    issueSession(reply, store, user, isHttps(req));
    return reply.code(204).send();
  });

  // ── POST /auth/delete-account ───────────────────────────────────────
  app.post('/auth/delete-account', async (req, reply) => {
    const user = currentUser(req, store);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    const ok = store.deleteUser(user.id);
    if (!ok) return reply.code(409).send({ error: 'last-admin' });
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

function parseCredentials(body: unknown): { username: string; password: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { username?: unknown; password?: unknown };
  if (typeof b.username !== 'string' || typeof b.password !== 'string') return null;
  return { username: b.username.trim(), password: b.password };
}

function issueSession(
  reply: FastifyReply,
  store: PersonalAuthStore,
  user: PublicUser,
  secure: boolean,
): void {
  const { sessionId, expiresAt } = store.startSession(user.id);
  reply.setCookie(COOKIE_NAME, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: new Date(expiresAt),
  });
}

function isHttps(req: FastifyRequest): boolean {
  const xfp = req.headers['x-forwarded-proto'];
  if (typeof xfp === 'string') return xfp.split(',')[0]?.trim() === 'https';
  if (Array.isArray(xfp)) return xfp[0] === 'https';
  return req.protocol === 'https';
}

/** Resolve the request's session cookie to a `PublicUser`, or null. */
export function currentUser(req: FastifyRequest, store: PersonalAuthStore): PublicUser | null {
  const sessionId = req.cookies?.[COOKIE_NAME];
  return store.resolveSession(sessionId);
}

export const PERSONAL_COOKIE_NAME = COOKIE_NAME;
