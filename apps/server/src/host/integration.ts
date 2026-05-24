/**
 * Host integration — workbook FILE persistence.
 *
 * Separate concern from `storage.ts` (which persists Y.Doc updates for
 * room resume across server restarts). This module persists the
 * authoritative `.xlsx` bytes of each workbook so they outlive a room
 * lifecycle.
 *
 * Mirrors the Go `host.Integration` shape in the Casual Editor repo:
 * one small interface, multiple concrete backends behind it. The host
 * "owns persistence" — the WebSocket gateway never touches a disk or
 * a bucket directly.
 *
 * Implementations live alongside this file:
 *   - memory.ts    — in-process Map; default for `docker run` quick try
 *   - local.ts     — filesystem; bind-mount `/data`
 *   - s3.ts        — S3-compatible: AWS, MinIO, R2, B2
 *   - postgres.ts  — single `workbooks` table with `bytea` payload
 *
 * Selected by `CASUAL_STORAGE` env var; see `docs/ENV.md`.
 *
 * The interface is small on purpose — `getFile` + `putFile` +
 * `checkFileInfo` mirror the three core WOPI endpoints
 * (CheckFileInfo / GetFile / PutFile). When/if we need the rest of
 * WOPI (Lock, Unlock, RefreshLock, etc) they slot in here.
 */

/** Stable opaque identifier for a workbook in the host's storage. */
export type FileId = string;

/** Metadata returned by `checkFileInfo`. Maps to WOPI's CheckFileInfo
 *  response shape (https://docs.microsoft.com/openspecs/office_protocols/ms-wopi).
 *  Fields are deliberately minimal — backends that can't fill a field
 *  return `undefined` and the WOPI route handler defaults appropriately. */
export interface FileInfo {
  /** WOPI: `BaseFileName`. Human filename including the .xlsx extension. */
  baseFileName: string;
  /** WOPI: `Size`. Byte length of the persisted file. */
  size: number;
  /** WOPI: `Version`. Opaque version string the host returns. Increments
   *  on each `putFile`. Used by Office to detect external edits. */
  version: string;
  /** WOPI: `OwnerId`. Optional — only set when the host knows the
   *  creator (e.g. via JWT claims in v0.2+ auth). */
  ownerId?: string;
  /** Optional last-modified ISO 8601 timestamp. */
  lastModifiedIso?: string;
}

export interface HostIntegration {
  /** Identifier string for the active backend — surfaced in logs and
   *  the admin panel. e.g. `"memory"`, `"local:/data"`, `"s3://bucket"`. */
  readonly label: string;

  /** Fetch the persisted bytes for `fileId`. Returns `null` when the
   *  file does not exist (so callers can distinguish 404 from error). */
  getFile(fileId: FileId): Promise<Uint8Array | null>;

  /** Persist `bytes` as the new contents of `fileId`. Creates the entry
   *  if missing. Returns the new opaque version string. */
  putFile(fileId: FileId, bytes: Uint8Array, opts?: PutFileOptions): Promise<string>;

  /** Return metadata for `fileId`, or `null` when missing. */
  checkFileInfo(fileId: FileId): Promise<FileInfo | null>;

  /** Optional — list every file id the host knows about. Used by the
   *  admin panel's storage page. Backends without a cheap listing
   *  semantic return `undefined`. */
  listFiles?(): Promise<FileId[]>;

  /** Optional — delete a file. Soft-failure (no throw) when missing. */
  deleteFile?(fileId: FileId): Promise<void>;

  /** Optional — release any pooled connections / streams. Called from
   *  the server shutdown hook. */
  close?(): Promise<void>;

  /** Optional — probe the backend's reachability. Used by the admin
   *  panel's test-connection button. Returns the first problem found
   *  or null when OK. Default impl: round-trip a tiny dummy file. */
  healthcheck?(): Promise<string | null>;
}

export interface PutFileOptions {
  /** Optional override for the `BaseFileName` recorded in metadata. */
  fileName?: string;
  /** Optional `If-Match` constraint — if the existing file's version
   *  doesn't match, throw `VersionMismatchError`. Enables optimistic-
   *  concurrency on the WOPI PutFile endpoint when an `X-WOPI-Lock`
   *  isn't being used. */
  ifMatchVersion?: string;
}

export class VersionMismatchError extends Error {
  constructor(
    public readonly fileId: FileId,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `version mismatch on file ${fileId}: expected ${expected}, got ${actual}`,
    );
    this.name = 'VersionMismatchError';
  }
}

/** Generate a fresh opaque version string. Backends that don't have a
 *  natural version (filesystem, memory) call this on every putFile. */
export function newVersion(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
