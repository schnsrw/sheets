import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Admin config — the JSON document the admin panel reads + writes.
 *
 * Single source of truth for everything that's user-customisable at
 * runtime: branding, storage backend, networking, room limits, auth
 * provider hooks. Persisted at `CASUAL_ADMIN_CONFIG_PATH` (default
 * `/data/casual-admin.json`).
 *
 * The admin panel UI is auto-rendered from this shape via the
 * matching schema entries in `docs/ENV.md` — every key here also
 * exists as an env var, but admin-panel writes win over env when
 * both are set (env is the bootstrap floor, panel is runtime
 * overrides).
 */

export type WebhookEvent =
  | 'room.created'
  | 'room.dropped'
  | 'file.uploaded'
  | 'file.saved'
  | 'file.deleted'
  | 'user.joined'
  | 'user.left'
  | 'admin.login'
  | 'admin.login_failed';

export const ALL_WEBHOOK_EVENTS: WebhookEvent[] = [
  'room.created',
  'room.dropped',
  'file.uploaded',
  'file.saved',
  'file.deleted',
  'user.joined',
  'user.left',
  'admin.login',
  'admin.login_failed',
];

export interface WebhookSubscription {
  /** Operator-friendly label, surfaced in the admin panel listing. */
  name: string;
  /** Target URL the dispatcher POSTs JSON to. */
  url: string;
  /** Events this subscription receives. Empty array = subscribed to
   *  every event (cheap "send me everything" mode). */
  events: WebhookEvent[];
  /** Optional HMAC-SHA256 secret. When set, every dispatch carries
   *  `X-Casual-Signature: sha256=<hex>` so the receiver can verify
   *  the payload wasn't forged. */
  secret: string;
  enabled: boolean;
}

export interface AdminConfig {
  branding: {
    appName: string;
    /** Hex with leading `#`. Drives `--color-accent` in the client. */
    accentColor: string;
    /** Logo asset URL (absolute or root-relative). When the operator
     *  uploads via the panel, this is set to `/api/branding/logo`. */
    logoUrl: string | null;
  };

  /** Reverse-proxy mount path. Empty = served at `/`. When set
   *  (e.g. `/sheets`), Fastify registers all routes behind this
   *  prefix and the SPA shell + Vite build emit absolute asset URLs
   *  relative to it. Must NOT include a trailing slash. */
  basePath: string;

  storage: {
    backend: 'memory' | 'local' | 's3' | 'postgres';
    local: {
      path: string;
    };
    s3: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKey: string;
      /** Stored verbatim in the JSON. Treat the file as a secret
       *  (mode 0600 on disk; never committed). */
      secretKey: string;
      forcePathStyle: boolean;
      keyPrefix: string;
    };
    postgres: {
      url: string;
    };
  };

  networking: {
    publicOrigin: string;
    /** Comma-separated origins for CORS. Empty = same-origin only. */
    corsOrigins: string;
    trustProxy: string;
    /** Strict-Transport-Security max-age in seconds; 0 disables. */
    hstsMaxAge: number;
  };

  limits: {
    maxRooms: number;
    /** MiB. */
    maxFileSizeMb: number;
    /** Minutes. */
    roomTtlMin: number;
    maxUsersPerRoom: number;
  };

  auth: {
    /** Stub UI in v0.1; backend lands in v0.2. */
    oidc: {
      enabled: boolean;
      issuer: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    };
    saml: {
      enabled: boolean;
      idpMetadataUrl: string;
      spEntityId: string;
    };
    jwt: {
      enabled: boolean;
      /** Issuer claim that admin-minted tokens advertise. Defaults
       *  to the public origin. */
      issuer: string;
      defaultTtlSeconds: number;
    };
  };

  webhooks: WebhookSubscription[];
}

/** Conservative defaults. Loaded when the on-disk config is missing
 *  OR when a partial config is being upgraded. */
export const DEFAULT_ADMIN_CONFIG: AdminConfig = {
  branding: {
    appName: 'Casual Sheets',
    accentColor: '#217346',
    logoUrl: null,
  },
  basePath: '',
  storage: {
    backend: 'memory',
    local: { path: '/data' },
    s3: {
      endpoint: '',
      region: 'us-east-1',
      bucket: '',
      accessKey: '',
      secretKey: '',
      forcePathStyle: false,
      keyPrefix: '',
    },
    postgres: { url: '' },
  },
  networking: {
    publicOrigin: '',
    corsOrigins: '',
    trustProxy: 'loopback',
    hstsMaxAge: 0,
  },
  limits: {
    maxRooms: 1000,
    maxFileSizeMb: 100,
    roomTtlMin: 15,
    maxUsersPerRoom: 50,
  },
  auth: {
    oidc: {
      enabled: false,
      issuer: '',
      clientId: '',
      clientSecret: '',
      redirectUri: '',
    },
    saml: {
      enabled: false,
      idpMetadataUrl: '',
      spEntityId: '',
    },
    jwt: {
      enabled: false,
      issuer: '',
      defaultTtlSeconds: 3600,
    },
  },
  webhooks: [],
};

/** Deep-merge an operator's partial config onto the defaults so older
 *  on-disk JSON survives a schema bump without losing fields. */
export function mergeWithDefaults(partial: unknown): AdminConfig {
  const out = JSON.parse(JSON.stringify(DEFAULT_ADMIN_CONFIG)) as AdminConfig;
  if (!partial || typeof partial !== 'object') return out;
  return deepMerge(out, partial as Record<string, unknown>) as AdminConfig;
}

function deepMerge(target: unknown, source: Record<string, unknown>): unknown {
  if (typeof target !== 'object' || target === null) return source;
  const out = target as Record<string, unknown>;
  for (const [k, v] of Object.entries(source)) {
    const existing = out[k];
    if (
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing) &&
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(existing, v as Record<string, unknown>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** Redact secret-bearing fields before serving the config over the
 *  wire. The admin panel doesn't need to see the verbatim secrets it
 *  set — the write path takes whole fields, and an unchanged secret
 *  field comes back as `***`. */
export function redactSecrets(cfg: AdminConfig): AdminConfig {
  const clone = JSON.parse(JSON.stringify(cfg)) as AdminConfig;
  if (clone.storage.s3.secretKey) clone.storage.s3.secretKey = '***';
  if (clone.auth.oidc.clientSecret) clone.auth.oidc.clientSecret = '***';
  return clone;
}

export class AdminConfigStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AdminConfig> {
    try {
      const raw = await readFile(this.path, 'utf8');
      return mergeWithDefaults(JSON.parse(raw));
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        // First boot — write the defaults so operators can read them
        // back from disk + version-control the file directly if they
        // want config-as-code instead of the panel.
        await this.save(DEFAULT_ADMIN_CONFIG);
        return DEFAULT_ADMIN_CONFIG;
      }
      throw err;
    }
  }

  async save(cfg: AdminConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Atomic-ish write via a temp file. Direct overwrite leaves a
    // window where a crash mid-write produces a truncated JSON.
    const tmp = `${this.path}.tmp-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    const { rename } = await import('node:fs/promises');
    await rename(tmp, this.path);
  }

  /** Apply a partial update — merges with the current on-disk config
   *  + writes back. Returns the new full config. Honours sentinel
   *  string `'***'` on secret fields by keeping the existing value
   *  (admin panel sends `***` for unchanged secret inputs). */
  async patch(update: unknown): Promise<AdminConfig> {
    const current = await this.load();
    const merged = mergeWithDefaults({ ...current, ...(update as object) });
    // Preserve secret fields when the inbound value is the sentinel.
    if (merged.storage.s3.secretKey === '***') {
      merged.storage.s3.secretKey = current.storage.s3.secretKey;
    }
    if (merged.auth.oidc.clientSecret === '***') {
      merged.auth.oidc.clientSecret = current.auth.oidc.clientSecret;
    }
    await this.save(merged);
    return merged;
  }
}
