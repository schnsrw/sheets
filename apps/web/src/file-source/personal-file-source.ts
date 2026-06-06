import { xlsxToWorkbookData } from '../xlsx';
import type { FileSource, OpenedWorkbook, RecentEntry, SaveOptions, SaveResult } from './types';

/**
 * Server-backed `FileSource` for the personal-mode docker (Mode 3
 * of #49). Talks to the `/files/*` routes added in Phase C Batch 2;
 * the byte payload still lives in the configured HostIntegration
 * backend (local / s3 / postgres), the session cookie tags along.
 *
 * Phase C minimum viable shape:
 *
 *   - listRecent      — GET /files
 *   - openRecent      — GET /files/:id → parse via xlsxToWorkbookData
 *   - forgetRecent    — DELETE /files/:id
 *   - save            — POST /files (multipart upload as a new
 *                       entry). In-place "Save" against an existing
 *                       id + If-Match etag for the conflict modal
 *                       lands in a follow-up — for v1 every Save is
 *                       a new entry in My Files, so users never lose
 *                       data to a race.
 *   - subscribeRecent — `ticker` callback registry the file-actions
 *                       layer pokes after a successful save, so the
 *                       home-screen recents strip refreshes.
 *
 * Network errors surface as plain `Error`s and propagate to the
 * caller (`MenuBar.exportAs` wraps Save in a toast.error). 401
 * responses are treated as "session expired" — caller resets the
 * AuthState so the gate re-renders the login view.
 */

type Ticker = {
  tick: () => void;
  subscribe: (cb: () => void) => () => void;
};

function createTicker(): Ticker {
  const subs = new Set<() => void>();
  return {
    tick: () => {
      for (const fn of subs) {
        try {
          fn();
        } catch (err) {
          console.warn('[personal-file-source] subscriber threw', err);
        }
      }
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

type ServerFileMeta = {
  id: string;
  name: string;
  size: number;
  etag: string;
  createdAt: number;
  modifiedAt: number;
};

const COMMON: RequestInit = { credentials: 'include' };

export function createPersonalFileSource(label = 'My files'): FileSource {
  const ticker = createTicker();

  const guardOk = async (res: Response, op: string): Promise<void> => {
    if (res.ok) return;
    // 401: caller should reset auth (gate re-renders). We throw a
    // typed Error so the caller can `instanceof PersonalAuthExpired`
    // if it wants to, without coupling to status codes.
    if (res.status === 401) throw new PersonalAuthExpired();
    let body: { error?: string } | null = null;
    try {
      body = (await res.json()) as { error?: string };
    } catch {
      /* not json */
    }
    throw new Error(`${op}: HTTP ${res.status}${body?.error ? ` (${body.error})` : ''}`);
  };

  return {
    kind: 'personal',
    label,

    async listRecent(): Promise<RecentEntry[]> {
      const res = await fetch('/files', { ...COMMON });
      await guardOk(res, 'list files');
      const body = (await res.json()) as { files: ServerFileMeta[] };
      return body.files.map((f) => ({
        id: f.id,
        name: f.name,
        // Server side has no `sourceFormat` concept — every personal
        // file goes in / comes out as xlsx (the format we control).
        sourceFormat: 'xlsx',
        size: f.size,
        modifiedAt: f.modifiedAt,
      }));
    },

    subscribeRecent(cb) {
      return ticker.subscribe(cb);
    },

    async openRecent(id): Promise<OpenedWorkbook> {
      const res = await fetch(`/files/${encodeURIComponent(id)}`, { ...COMMON });
      await guardOk(res, 'open file');
      const buf = await res.arrayBuffer();
      const data = await xlsxToWorkbookData(buf);
      return { data, sourceFormat: 'xlsx' };
    },

    async forgetRecent(id): Promise<void> {
      const res = await fetch(`/files/${encodeURIComponent(id)}`, {
        ...COMMON,
        method: 'DELETE',
      });
      await guardOk(res, 'delete file');
      ticker.tick();
    },

    async save(bytes: Blob, opts: SaveOptions): Promise<SaveResult> {
      const form = new FormData();
      form.append('file', bytes, opts.filename);
      form.append('name', opts.filename);
      const res = await fetch('/files', { ...COMMON, method: 'POST', body: form });
      await guardOk(res, 'save file');
      const body = (await res.json()) as { file: ServerFileMeta };
      ticker.tick();
      return { kind: 'server', path: body.file.name };
    },
  };
}

/** Thrown by any `/files/*` call when the server returns 401. The
 *  caller (typically the AuthProvider) refreshes the state so the
 *  gate re-renders the login view. */
export class PersonalAuthExpired extends Error {
  constructor() {
    super('session expired');
    this.name = 'PersonalAuthExpired';
  }
}
