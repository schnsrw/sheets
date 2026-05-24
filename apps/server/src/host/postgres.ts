import type {
  FileId,
  FileInfo,
  HostIntegration,
  PutFileOptions,
} from './integration.js';
import { VersionMismatchError, newVersion } from './integration.js';

/**
 * Postgres-backed workbook storage. Single `casual_workbooks` table
 * with a `bytea` payload column + metadata. Familiar to most teams,
 * transactional, easy to back up via `pg_dump`.
 *
 * Schema (auto-created on first connect via `ensureSchema()`):
 *
 *   CREATE TABLE IF NOT EXISTS casual_workbooks (
 *     file_id           text PRIMARY KEY,
 *     base_file_name    text NOT NULL,
 *     payload           bytea NOT NULL,
 *     version           text NOT NULL,
 *     last_modified     timestamptz NOT NULL DEFAULT now()
 *   );
 *
 * `pg` is dynamically imported so the in-memory / local / s3
 * backends don't pay the dep load cost.
 */
export interface PostgresHostConfig {
  url: string;
  /** Optional schema name (default: public). */
  schema?: string;
}

type PgClientCtor = new (config: { connectionString: string }) => {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

interface PgModule {
  Client: PgClientCtor;
}

export class PostgresHost implements HostIntegration {
  readonly label: string;
  private clientPromise: Promise<InstanceType<PgClientCtor>> | null = null;
  private schemaEnsured = false;
  private readonly table: string;

  constructor(private readonly cfg: PostgresHostConfig) {
    // Best-effort host label without leaking credentials.
    try {
      const u = new URL(cfg.url);
      this.label = `postgres://${u.host}${u.pathname}`;
    } catch {
      this.label = 'postgres://(invalid url)';
    }
    this.table = `${cfg.schema ?? 'public'}.casual_workbooks`;
  }

  private async ensureClient(): Promise<InstanceType<PgClientCtor>> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod = (await import('pg')) as unknown as { default: PgModule } | PgModule;
        const Client = ('default' in mod ? mod.default.Client : mod.Client) as PgClientCtor;
        const client = new Client({ connectionString: this.cfg.url });
        await client.connect();
        return client;
      })();
    }
    const client = await this.clientPromise;
    if (!this.schemaEnsured) {
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.table} (
        file_id        text PRIMARY KEY,
        base_file_name text NOT NULL,
        payload        bytea NOT NULL,
        version        text NOT NULL,
        last_modified  timestamptz NOT NULL DEFAULT now()
      )`);
      this.schemaEnsured = true;
    }
    return client;
  }

  async getFile(fileId: FileId): Promise<Uint8Array | null> {
    const client = await this.ensureClient();
    const res = await client.query(
      `SELECT payload FROM ${this.table} WHERE file_id = $1`,
      [fileId],
    );
    if (res.rows.length === 0) return null;
    const payload = res.rows[0].payload as Buffer | Uint8Array;
    return payload instanceof Uint8Array
      ? payload
      : new Uint8Array(payload as ArrayBufferLike);
  }

  async putFile(
    fileId: FileId,
    bytes: Uint8Array,
    opts: PutFileOptions = {},
  ): Promise<string> {
    const client = await this.ensureClient();
    if (opts.ifMatchVersion) {
      const existing = await client.query(
        `SELECT version FROM ${this.table} WHERE file_id = $1`,
        [fileId],
      );
      if (existing.rows.length > 0) {
        const actual = existing.rows[0].version as string;
        if (actual !== opts.ifMatchVersion) {
          throw new VersionMismatchError(
            fileId,
            opts.ifMatchVersion,
            actual,
          );
        }
      }
    }
    const version = newVersion();
    const fileName =
      opts.fileName ??
      (await this.lookupFilename(fileId)) ??
      `${fileId}.xlsx`;
    await client.query(
      `INSERT INTO ${this.table} (file_id, base_file_name, payload, version, last_modified)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (file_id) DO UPDATE
       SET base_file_name = EXCLUDED.base_file_name,
           payload        = EXCLUDED.payload,
           version        = EXCLUDED.version,
           last_modified  = now()`,
      [fileId, fileName, Buffer.from(bytes), version],
    );
    return version;
  }

  private async lookupFilename(fileId: FileId): Promise<string | null> {
    const client = await this.ensureClient();
    const res = await client.query(
      `SELECT base_file_name FROM ${this.table} WHERE file_id = $1`,
      [fileId],
    );
    return res.rows.length > 0 ? (res.rows[0].base_file_name as string) : null;
  }

  async checkFileInfo(fileId: FileId): Promise<FileInfo | null> {
    const client = await this.ensureClient();
    const res = await client.query(
      `SELECT base_file_name, octet_length(payload) AS size, version, last_modified
       FROM ${this.table} WHERE file_id = $1`,
      [fileId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      baseFileName: r.base_file_name as string,
      size: Number(r.size),
      version: r.version as string,
      lastModifiedIso:
        r.last_modified instanceof Date
          ? r.last_modified.toISOString()
          : String(r.last_modified ?? ''),
    };
  }

  async listFiles(): Promise<FileId[]> {
    const client = await this.ensureClient();
    const res = await client.query(`SELECT file_id FROM ${this.table} ORDER BY last_modified DESC`);
    return res.rows.map((r) => r.file_id as string);
  }

  async deleteFile(fileId: FileId): Promise<void> {
    const client = await this.ensureClient();
    await client.query(`DELETE FROM ${this.table} WHERE file_id = $1`, [fileId]);
  }

  async healthcheck(): Promise<string | null> {
    try {
      const client = await this.ensureClient();
      await client.query('SELECT 1');
      return null;
    } catch (err) {
      return `Postgres unreachable: ${(err as Error).message}`;
    }
  }

  async close(): Promise<void> {
    if (!this.clientPromise) return;
    try {
      const client = await this.clientPromise;
      await client.end();
    } catch {
      // best-effort
    }
    this.clientPromise = null;
  }
}
