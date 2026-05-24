import jwt from 'jsonwebtoken';
import type {
  AccessClaims,
  AuthContext,
  Features,
  Permissions,
  Role,
} from './types.js';
import {
  anonymousAuth,
  resolveFeatures,
  resolvePermissions,
} from './types.js';

/**
 * JWT signing + verification.
 *
 * HS256 with a server-side shared secret. The secret comes from
 * `CASUAL_JWT_SECRET`; when unset, JWT auth is disabled entirely and
 * routes fall through to legacy v0.0.x behaviour (anonymous-by-URL).
 *
 * Asymmetric (RS256 / ES256) lands in v0.2 when downstream SSO needs
 * to mint tokens without holding the deployment secret.
 */

export class JwtConfigError extends Error {}
export class TokenInvalidError extends Error {
  constructor(message: string, public readonly statusCode = 401) {
    super(message);
    this.name = 'TokenInvalidError';
  }
}

const ALG = 'HS256';

/** Read the secret once at issuer construction. Throws when unset so
 *  callers know they must guard with `isJwtEnabled()`. */
function readSecret(): string {
  const secret = process.env.CASUAL_JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new JwtConfigError(
      'CASUAL_JWT_SECRET is unset or under 16 chars — JWT auth disabled',
    );
  }
  return secret;
}

/** True when the deployment is configured for JWT auth. Callers that
 *  want strict-auth-required behaviour check this on boot and decide
 *  whether to register the WOPI route guards. */
export function isJwtEnabled(): boolean {
  const secret = process.env.CASUAL_JWT_SECRET;
  return typeof secret === 'string' && secret.length >= 16;
}

/** Mint a token. `ttlSeconds` defaults to 1 hour. */
export function signAccessToken(
  claims: Omit<AccessClaims, 'iat' | 'exp'>,
  opts: { ttlSeconds?: number } = {},
): string {
  const secret = readSecret();
  const ttl = opts.ttlSeconds ?? 60 * 60;
  return jwt.sign(claims, secret, {
    algorithm: ALG,
    expiresIn: ttl,
  });
}

/** Verify + decode a token. Throws `TokenInvalidError` on any failure
 *  (bad signature, expired, wrong algorithm, malformed). */
export function verifyAccessToken(token: string): AccessClaims {
  const secret = readSecret();
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: [ALG],
    }) as AccessClaims;
    if (typeof payload !== 'object' || !payload) {
      throw new TokenInvalidError('token payload not an object');
    }
    if (!payload.sub) throw new TokenInvalidError('missing sub claim');
    if (!payload.file_id) throw new TokenInvalidError('missing file_id claim');
    if (!payload.role) throw new TokenInvalidError('missing role claim');
    return payload;
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    throw new TokenInvalidError(
      `token verify failed: ${(err as Error).message}`,
      err instanceof jwt.TokenExpiredError ? 401 : 401,
    );
  }
}

/** Pull the token off a Fastify request:
 *   1. `Authorization: Bearer <token>` header
 *   2. `?access_token=<token>` query param (standard WOPI)
 *   3. `?token=<token>` short form (used by share links)
 *
 *  Returns `null` when no token is present.
 */
export function extractToken(req: {
  headers: Record<string, unknown>;
  query?: unknown;
}): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1];
  }
  const q = req.query as { access_token?: unknown; token?: unknown } | undefined;
  if (q) {
    if (typeof q.access_token === 'string') return q.access_token;
    if (typeof q.token === 'string') return q.token;
  }
  return null;
}

/** Build an AuthContext from a verified set of claims. */
export function authFromClaims(claims: AccessClaims): AuthContext {
  const role = claims.role as Role;
  const permissions: Permissions = resolvePermissions(role, claims.permissions);
  const features: Features = resolveFeatures(claims.features);
  return {
    claims,
    token: null, // filled in by the middleware that read the token
    permissions,
    features,
    fileIdMatches: (fileId: string) => fileId === claims.file_id,
  };
}

/** Resolve an AuthContext from a Fastify request:
 *   - If JWT not configured → anonymous context.
 *   - If token present + valid → derived context.
 *   - If token present + invalid → throws TokenInvalidError (caller
 *     decides whether to 401 or fall through).
 *   - If no token + JWT configured → throws when caller flags
 *     `required: true`; anonymous otherwise.
 */
export function resolveAuth(
  req: { headers: Record<string, unknown>; query?: unknown },
  opts: { required?: boolean } = {},
): AuthContext {
  if (!isJwtEnabled()) return anonymousAuth();

  const token = extractToken(req);
  if (!token) {
    if (opts.required) {
      throw new TokenInvalidError('access token required', 401);
    }
    return anonymousAuth();
  }
  const claims = verifyAccessToken(token);
  const ctx = authFromClaims(claims);
  ctx.token = token;
  return ctx;
}
