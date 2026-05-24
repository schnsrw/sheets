import type { HostIntegration } from './integration.js';
import { LocalHost } from './local.js';
import { MemoryHost } from './memory.js';
import { PostgresHost } from './postgres.js';
import { S3Host } from './s3.js';

export type { FileId, FileInfo, HostIntegration, PutFileOptions } from './integration.js';
export { VersionMismatchError, newVersion } from './integration.js';

/**
 * Pick the workbook storage backend based on `CASUAL_STORAGE`:
 *
 *   - `memory` (default) — in-process Map; vanishes on restart
 *   - `local`  — filesystem under `CASUAL_LOCAL_PATH` (default `/data`)
 *   - `s3`     — S3-compatible: AWS, MinIO, R2, B2 — needs the
 *                CASUAL_S3_* set
 *   - `postgres` — needs `CASUAL_PG_URL`
 *
 * Full reference in `docs/ENV.md`.
 */
export async function createHost(): Promise<HostIntegration> {
  const choice = (process.env.CASUAL_STORAGE ?? 'memory').toLowerCase();

  if (choice === 'memory') {
    return new MemoryHost();
  }

  if (choice === 'local') {
    const root = process.env.CASUAL_LOCAL_PATH ?? '/data';
    return new LocalHost(root);
  }

  if (choice === 's3') {
    const bucket = required('CASUAL_S3_BUCKET');
    return new S3Host({
      endpoint: process.env.CASUAL_S3_ENDPOINT,
      region: process.env.CASUAL_S3_REGION ?? 'us-east-1',
      bucket,
      accessKey: process.env.CASUAL_S3_ACCESS_KEY,
      secretKey: process.env.CASUAL_S3_SECRET_KEY,
      forcePathStyle:
        (process.env.CASUAL_S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true',
      keyPrefix: process.env.CASUAL_S3_KEY_PREFIX,
    });
  }

  if (choice === 'postgres' || choice === 'pg') {
    return new PostgresHost({ url: required('CASUAL_PG_URL') });
  }

  throw new Error(
    `Unknown CASUAL_STORAGE=${choice} (expected memory | local | s3 | postgres)`,
  );
}

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var ${key}`);
  }
  return v;
}
