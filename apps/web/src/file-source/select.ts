import { createBrowserFileSource } from './browser-file-source';
import type { FileSource } from './types';

/**
 * One-shot boot probe — picks the right `FileSource` for this deploy.
 *
 * Phase B: always returns the browser source.
 * Phase C: if `__COLLAB_BUILD__` is true and `GET /auth/me` succeeds,
 *          returns a `PersonalFileSource`.
 * Phase D: if a WOPI token is in the URL, returns a `WopiFileSource`.
 *
 * Cached to a singleton so the React provider (`FileSourceProvider`)
 * and the non-React call sites in `file-actions` share one instance.
 * The browser source's `LiveRecentFilesFeed` is a module-level
 * registration; a second instance would silently override the first
 * and stop ticking subscribers from the original. Single instance
 * keeps both paths talking to the same feed + IDB connection.
 */
let cached: FileSource | null = null;

export function selectFileSource(): FileSource {
  if (!cached) cached = createBrowserFileSource();
  return cached;
}

/** Test hook — drop the cached instance so a fresh probe runs next
 *  time. Production code should not call this. */
export function __resetFileSourceForTests(): void {
  cached = null;
}
