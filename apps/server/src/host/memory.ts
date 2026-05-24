import type {
  FileId,
  FileInfo,
  HostIntegration,
  PutFileOptions,
} from './integration.js';
import { VersionMismatchError, newVersion } from './integration.js';

/**
 * In-process workbook storage. Default backend — preserves the v0.0.x
 * "no DB, no disk" shape so `docker run -p 3000:3000 schnsrw/casual-
 * sheets:latest` still spins up without external dependencies.
 *
 * Trade-off: workbooks vanish on restart. Fine for quick-try and for
 * the GitHub Pages single-user demo; not fine for production. Switch
 * to local / s3 / postgres for persistence.
 */
export class MemoryHost implements HostIntegration {
  readonly label = 'memory';
  private files = new Map<
    FileId,
    { bytes: Uint8Array; info: FileInfo }
  >();

  async getFile(fileId: FileId): Promise<Uint8Array | null> {
    return this.files.get(fileId)?.bytes ?? null;
  }

  async putFile(
    fileId: FileId,
    bytes: Uint8Array,
    opts: PutFileOptions = {},
  ): Promise<string> {
    const existing = this.files.get(fileId);
    if (opts.ifMatchVersion && existing && existing.info.version !== opts.ifMatchVersion) {
      throw new VersionMismatchError(
        fileId,
        opts.ifMatchVersion,
        existing.info.version,
      );
    }
    const version = newVersion();
    this.files.set(fileId, {
      bytes,
      info: {
        baseFileName: opts.fileName ?? existing?.info.baseFileName ?? `${fileId}.xlsx`,
        size: bytes.byteLength,
        version,
        lastModifiedIso: new Date().toISOString(),
      },
    });
    return version;
  }

  async checkFileInfo(fileId: FileId): Promise<FileInfo | null> {
    return this.files.get(fileId)?.info ?? null;
  }

  async listFiles(): Promise<FileId[]> {
    return Array.from(this.files.keys());
  }

  async deleteFile(fileId: FileId): Promise<void> {
    this.files.delete(fileId);
  }

  async close(): Promise<void> {
    this.files.clear();
  }

  async healthcheck(): Promise<string | null> {
    return null;
  }
}
