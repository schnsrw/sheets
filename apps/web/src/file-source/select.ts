import { createBrowserFileSource } from './browser-file-source';
import { createPersonalFileSource } from './personal-file-source';
import type { FileSource, FileSourceKind } from './types';

/**
 * Per-deploy `FileSource` picker.
 *
 * Selection is driven by the React `AuthProvider` — when the auth
 * probe lands `authenticated`, the provider calls
 * `setFileSourceKind('personal')`; when it lands `disabled` or
 * `unauthenticated`, it stays on the browser source. Pre-React
 * call sites in `file-actions` consume the same cached instance via
 * `selectFileSource()`.
 *
 * One cached instance per `kind` keeps the React provider, the
 * non-React file-actions saves, and the live-feed subscribers
 * pointed at a single object — important because the browser
 * source's `LiveRecentFilesFeed` is module-global and a second
 * instance would silently override the first.
 *
 * Phase B: always browser.
 * Phase C: browser by default; provider swaps to personal once the
 *          auth gate reports authenticated.
 * Phase D: wopi when the URL carries a token (separate fast-path).
 */

type Kind = FileSourceKind;

const cache = new Map<Kind, FileSource>();
let activeKind: Kind = 'browser';

function makeFor(kind: Kind): FileSource {
  if (kind === 'personal') return createPersonalFileSource();
  // 'wopi' falls back to browser until Phase D fills the impl in.
  return createBrowserFileSource();
}

export function selectFileSource(): FileSource {
  let src = cache.get(activeKind);
  if (!src) {
    src = makeFor(activeKind);
    cache.set(activeKind, src);
  }
  return src;
}

/** Swap the active source. Called from `AuthProvider` when the
 *  user's auth state crosses an authenticated boundary. */
export function setFileSourceKind(kind: Kind): FileSource {
  activeKind = kind;
  return selectFileSource();
}

/** Test hook — drop every cached instance so a fresh probe runs
 *  next time. Production code should not call this. */
export function __resetFileSourceForTests(): void {
  cache.clear();
  activeKind = 'browser';
}
