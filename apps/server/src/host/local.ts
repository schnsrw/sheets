import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type {
  FileId,
  FileInfo,
  HostIntegration,
  PutFileOptions,
} from './integration.js';
import { VersionMismatchError, newVersion } from './integration.js';

/**
 * Filesystem-backed workbook storage. Simplest persistent option —
 * bind-mount a host directory at `CASUAL_LOCAL_PATH` (default
 * `/data`) and workbooks survive container restarts.
 *
 * Layout under the root:
 *   <root>/
 *     <fileId>.xlsx        — workbook bytes
 *     <fileId>.meta.json   — { baseFileName, version, lastModifiedIso }
 *
 * Two-file shape (not a single envelope) so operators can grab the
 * `.xlsx` files directly via shell if they ever want to bypass the
 * server. The meta sidecar is small and easily reconstructable.
 */
export class LocalHost implements HostIntegration {
  readonly label: string;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.label = `local:${this.root}`;
  }

  private xlsxPath(fileId: FileId): string {
    return join(this.root, this.safeName(fileId) + '.xlsx');
  }
  private metaPath(fileId: FileId): string {
    return join(this.root, this.safeName(fileId) + '.meta.json');
  }
  private safeName(fileId: FileId): string {
    // Defence-in-depth — never let path separators or `..` leak into
    // the on-disk filename. fileIds are server-issued so this should
    // already be safe, but cheap insurance.
    return fileId.replace(/[^A-Za-z0-9._-]/g, '_');
  }

  private async readMeta(fileId: FileId): Promise<FileInfo | null> {
    try {
      const raw = await readFile(this.metaPath(fileId), 'utf8');
      return JSON.parse(raw) as FileInfo;
    } catch {
      return null;
    }
  }

  private async writeMeta(fileId: FileId, info: FileInfo): Promise<void> {
    await writeFile(this.metaPath(fileId), JSON.stringify(info), 'utf8');
  }

  async getFile(fileId: FileId): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.xlsxPath(fileId));
      return new Uint8Array(buf);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
  }

  async putFile(
    fileId: FileId,
    bytes: Uint8Array,
    opts: PutFileOptions = {},
  ): Promise<string> {
    await mkdir(this.root, { recursive: true });
    const existing = await this.readMeta(fileId);
    if (opts.ifMatchVersion && existing && existing.version !== opts.ifMatchVersion) {
      throw new VersionMismatchError(
        fileId,
        opts.ifMatchVersion,
        existing.version,
      );
    }
    const version = newVersion();
    const info: FileInfo = {
      baseFileName: opts.fileName ?? existing?.baseFileName ?? `${fileId}.xlsx`,
      size: bytes.byteLength,
      version,
      lastModifiedIso: new Date().toISOString(),
    };
    await writeFile(this.xlsxPath(fileId), bytes);
    await this.writeMeta(fileId, info);
    return version;
  }

  async checkFileInfo(fileId: FileId): Promise<FileInfo | null> {
    // Read the persisted meta first; if it's missing but the .xlsx
    // exists (e.g. operator dropped a file in by hand), synthesize
    // info from `stat()`. Forgives by-hand operations.
    const meta = await this.readMeta(fileId);
    if (meta) return meta;
    try {
      const st = await stat(this.xlsxPath(fileId));
      return {
        baseFileName: `${fileId}.xlsx`,
        size: st.size,
        version: String(st.mtimeMs),
        lastModifiedIso: new Date(st.mtime).toISOString(),
      };
    } catch {
      return null;
    }
  }

  async listFiles(): Promise<FileId[]> {
    try {
      const entries = await readdir(this.root);
      return entries
        .filter((e) => e.endsWith('.xlsx'))
        .map((e) => e.slice(0, -'.xlsx'.length));
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'ENOENT') return [];
      throw err;
    }
  }

  async deleteFile(fileId: FileId): Promise<void> {
    await unlink(this.xlsxPath(fileId)).catch(() => {});
    await unlink(this.metaPath(fileId)).catch(() => {});
  }

  async healthcheck(): Promise<string | null> {
    try {
      await mkdir(this.root, { recursive: true });
      const probe = join(this.root, '.casual-probe');
      await writeFile(probe, '');
      await unlink(probe);
      return null;
    } catch (err) {
      return `local storage root not writable: ${(err as Error).message}`;
    }
  }
}
