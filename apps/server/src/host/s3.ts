import type {
  FileId,
  FileInfo,
  HostIntegration,
  PutFileOptions,
} from './integration.js';
import { VersionMismatchError, newVersion } from './integration.js';

/**
 * S3-compatible workbook storage. Works against AWS S3, MinIO,
 * Cloudflare R2, Backblaze B2, Wasabi — anything that speaks the S3
 * API. Each workbook is a single object; metadata rides on
 * `x-amz-meta-*` headers + ETag.
 *
 * `@aws-sdk/client-s3` is dynamically imported so the in-memory /
 * local backends don't pay the dep load cost.
 *
 * Layout:
 *   s3://<bucket>/<keyPrefix><fileId>.xlsx
 *   - x-amz-meta-base-file-name = original filename
 *   - x-amz-meta-version        = opaque version string
 *   - ETag (auto)               = used as the second-line version
 *                                  check on putFile
 */
export interface S3HostConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle?: boolean;
  /** Optional key prefix so multiple deployments can share a bucket. */
  keyPrefix?: string;
}

type S3ClientCtor = new (config: {
  endpoint?: string;
  region: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle?: boolean;
}) => unknown;

interface S3Module {
  S3Client: S3ClientCtor;
  GetObjectCommand: new (params: object) => unknown;
  PutObjectCommand: new (params: object) => unknown;
  HeadObjectCommand: new (params: object) => unknown;
  ListObjectsV2Command: new (params: object) => unknown;
  DeleteObjectCommand: new (params: object) => unknown;
}

export class S3Host implements HostIntegration {
  readonly label: string;
  private clientPromise: Promise<{ client: unknown; mod: S3Module }> | null = null;

  constructor(private readonly cfg: S3HostConfig) {
    this.label = `s3://${cfg.bucket}${cfg.endpoint ? ` (${cfg.endpoint})` : ''}`;
  }

  private async ensureClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod = (await import('@aws-sdk/client-s3')) as unknown as S3Module;
        const client = new mod.S3Client({
          endpoint: this.cfg.endpoint,
          region: this.cfg.region,
          forcePathStyle: this.cfg.forcePathStyle ?? false,
          credentials:
            this.cfg.accessKey && this.cfg.secretKey
              ? {
                  accessKeyId: this.cfg.accessKey,
                  secretAccessKey: this.cfg.secretKey,
                }
              : undefined,
        });
        return { client, mod };
      })();
    }
    return this.clientPromise;
  }

  private keyFor(fileId: FileId): string {
    return `${this.cfg.keyPrefix ?? ''}${fileId}.xlsx`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async send(cmd: unknown): Promise<any> {
    const { client } = await this.ensureClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (client as any).send(cmd);
  }

  async getFile(fileId: FileId): Promise<Uint8Array | null> {
    const { mod } = await this.ensureClient();
    try {
      const res = await this.send(
        new mod.GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.keyFor(fileId) }),
      );
      const body = res.Body;
      if (!body) return null;
      const chunks: Uint8Array[] = [];
      // body is a Node Readable / ReadableStream depending on the SDK
      // version + runtime. Both are async iterable in modern SDKs.
      for await (const chunk of body as AsyncIterable<Uint8Array | Buffer>) {
        chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      }
      // Concat.
      const len = chunks.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(len);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    } catch (err: unknown) {
      if (isS3NoSuchKey(err)) return null;
      throw err;
    }
  }

  async putFile(
    fileId: FileId,
    bytes: Uint8Array,
    opts: PutFileOptions = {},
  ): Promise<string> {
    if (opts.ifMatchVersion) {
      const existing = await this.checkFileInfo(fileId);
      if (existing && existing.version !== opts.ifMatchVersion) {
        throw new VersionMismatchError(
          fileId,
          opts.ifMatchVersion,
          existing.version,
        );
      }
    }
    const { mod } = await this.ensureClient();
    const version = newVersion();
    await this.send(
      new mod.PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: this.keyFor(fileId),
        Body: Buffer.from(bytes),
        ContentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        Metadata: {
          'base-file-name': opts.fileName ?? `${fileId}.xlsx`,
          version,
        },
      }),
    );
    return version;
  }

  async checkFileInfo(fileId: FileId): Promise<FileInfo | null> {
    const { mod } = await this.ensureClient();
    try {
      const res = await this.send(
        new mod.HeadObjectCommand({ Bucket: this.cfg.bucket, Key: this.keyFor(fileId) }),
      );
      return {
        baseFileName:
          res.Metadata?.['base-file-name'] ?? `${fileId}.xlsx`,
        size: res.ContentLength ?? 0,
        version: res.Metadata?.['version'] ?? String(res.ETag ?? ''),
        lastModifiedIso:
          res.LastModified instanceof Date
            ? res.LastModified.toISOString()
            : undefined,
      };
    } catch (err: unknown) {
      if (isS3NoSuchKey(err)) return null;
      throw err;
    }
  }

  async listFiles(): Promise<FileId[]> {
    const { mod } = await this.ensureClient();
    const out: FileId[] = [];
    let continuationToken: string | undefined;
    const prefix = this.cfg.keyPrefix ?? '';
    do {
      const res = await this.send(
        new mod.ListObjectsV2Command({
          Bucket: this.cfg.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        const key = obj.Key as string | undefined;
        if (!key || !key.endsWith('.xlsx')) continue;
        out.push(key.slice(prefix.length, -'.xlsx'.length));
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }

  async deleteFile(fileId: FileId): Promise<void> {
    const { mod } = await this.ensureClient();
    await this.send(
      new mod.DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.keyFor(fileId) }),
    );
  }

  async healthcheck(): Promise<string | null> {
    try {
      // List with empty prefix + max 1 key — cheapest reachability probe.
      const { mod } = await this.ensureClient();
      await this.send(
        new mod.ListObjectsV2Command({
          Bucket: this.cfg.bucket,
          MaxKeys: 1,
        }),
      );
      return null;
    } catch (err) {
      return `S3 unreachable: ${(err as Error).message}`;
    }
  }
}

function isS3NoSuchKey(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'NoSuchKey' ||
    e.name === 'NotFound' ||
    e.Code === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  );
}
