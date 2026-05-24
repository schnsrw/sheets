/**
 * Auth claim shape — what a Casual Sheets access token can carry.
 *
 * Mirrors the WOPI access-token model: every request to /wopi/files/*
 * is self-authorising via a signed JWT, the server validates the
 * signature + claims, and per-route handlers enforce permissions.
 *
 * Two shapes share the model:
 *   - `AccessClaims` — what's encoded inside the JWT after signing.
 *   - `AuthContext` — what handlers consume via `req.auth`. Includes
 *     the original token (for re-issue) + a computed snapshot of
 *     "can the user do X" for ergonomic route checks.
 *
 * Token-less requests (when `CASUAL_JWT_SECRET` is unset OR when a
 * route is explicitly opt-out) get an `AuthContext` with `role:
 * 'anonymous'` + every permission flag false. Routes pick whether to
 * accept anonymous; the WOPI route block rejects it when the env is
 * set.
 */

export type Role = 'admin' | 'editor' | 'commenter' | 'viewer' | 'anonymous';

/** Permission flags. Coarse-grained and intentionally limited — the
 *  client uses them to drive UI gating; the server enforces them on
 *  the corresponding routes. */
export interface Permissions {
  /** May call GetFile + CheckFileInfo. */
  read: boolean;
  /** May call PutFile (and, in v0.2+, send mutating WOPI ops). */
  write: boolean;
  /** May attach comments / notes. v0.2 — included now so the JWT
   *  shape doesn't shift later. */
  comment: boolean;
  /** May download the workbook as a file. Distinct from `read`
   *  because an in-browser viewer can read without exporting. */
  download: boolean;
  /** May create / revoke share links + tokens for the same file. */
  share: boolean;
  /** May reach admin-only routes (file listing, delete, panel). */
  admin: boolean;
}

/** Feature-toggle flags. The client reads these and hides any UI it
 *  doesn't have access to; the server doesn't currently enforce them
 *  (every WOPI op composes from `permissions`), but they live in the
 *  claim so feature-gating travels with the token. */
export interface Features {
  /** Insert + format charts. */
  charts: boolean;
  /** Insert + edit pivot tables. */
  pivots: boolean;
  /** Conditional formatting + data validation rules. */
  conditionalFormatting: boolean;
  /** External / shareable links. */
  sharing: boolean;
  /** Workbook download as .xlsx / .ods / .csv. */
  exportFiles: boolean;
  /** Real-time co-editing for THIS session. (Token can revoke
   *  collab even though the deployment supports it — useful for
   *  view-only renderers.) */
  collab: boolean;
  /** Inline AI features when wired (v0.3+). */
  ai: boolean;
}

/** Signed JWT payload. */
export interface AccessClaims {
  /** Standard subject — username, email, or stable user id. */
  sub: string;
  /** File the token is bound to. WOPI routes verify the URL :id
   *  matches this claim — a token issued for file A can never be
   *  used to access file B. */
  file_id: string;
  /** Effective role. Permissions are derived from role unless
   *  `permissions` overrides specific flags. */
  role: Role;
  /** Specific permission flags. Optional — derived from role when
   *  absent. */
  permissions?: Partial<Permissions>;
  /** Feature toggles for THIS session. Optional — derived from
   *  defaults when absent. */
  features?: Partial<Features>;
  /** True when the resource still requires the legacy
   *  `x-room-password` gate on top of the JWT. Used during the
   *  v0.1 migration where some rooms exist without backing files. */
  password_required?: boolean;
  /** Display name shown in presence / cursor labels. Falls back to
   *  `sub` when absent. */
  display_name?: string;
  /** Audience — usually the deployment's public origin. Optional. */
  aud?: string;
  /** Standard JWT issued-at + expiry. */
  iat?: number;
  exp?: number;
  /** Optional issuer — useful when a downstream host service mints
   *  tokens on behalf of an internal SSO. */
  iss?: string;
}

/** What handlers consume via `req.auth`. */
export interface AuthContext {
  claims: AccessClaims | null;
  /** Raw verified JWT (or null when token-less). Re-issuable. */
  token: string | null;
  /** Resolved permissions: claims.permissions overlaid on the role's
   *  default permission map. Anonymous = all false. */
  permissions: Permissions;
  /** Resolved features: claims.features overlaid on the deployment's
   *  feature defaults. */
  features: Features;
  /** Convenience predicate — true when the token's `file_id`
   *  matches the requested URL :id. WOPI middleware sets this. */
  fileIdMatches: (fileId: string) => boolean;
}

/** Default permission map by role. Tokens override on a per-flag
 *  basis via `claims.permissions`. */
export const ROLE_PERMISSIONS: Record<Role, Permissions> = {
  admin:     { read: true,  write: true,  comment: true,  download: true,  share: true,  admin: true  },
  editor:    { read: true,  write: true,  comment: true,  download: true,  share: false, admin: false },
  commenter: { read: true,  write: false, comment: true,  download: true,  share: false, admin: false },
  viewer:    { read: true,  write: false, comment: false, download: true,  share: false, admin: false },
  anonymous: { read: false, write: false, comment: false, download: false, share: false, admin: false },
};

/** Default feature flags. Conservative defaults; deployments override
 *  via the admin panel (v0.1) or the token claim. */
export const DEFAULT_FEATURES: Features = {
  charts: true,
  pivots: true,
  conditionalFormatting: true,
  sharing: true,
  exportFiles: true,
  collab: true,
  ai: false,
};

/** Resolve a Role + optional override map into a final `Permissions`. */
export function resolvePermissions(
  role: Role,
  override: Partial<Permissions> | undefined,
): Permissions {
  const base = ROLE_PERMISSIONS[role];
  return { ...base, ...(override ?? {}) };
}

/** Resolve features from a token override + deployment default. */
export function resolveFeatures(
  override: Partial<Features> | undefined,
  defaults: Features = DEFAULT_FEATURES,
): Features {
  return { ...defaults, ...(override ?? {}) };
}

/** Anonymous fallback context — used when no token is present and the
 *  route allows anonymous. WOPI routes deny anonymous when the
 *  deployment has CASUAL_JWT_SECRET configured. */
export function anonymousAuth(): AuthContext {
  return {
    claims: null,
    token: null,
    permissions: ROLE_PERMISSIONS.anonymous,
    features: DEFAULT_FEATURES,
    fileIdMatches: () => false,
  };
}
