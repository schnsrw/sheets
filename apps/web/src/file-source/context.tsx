import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createBrowserFileSource } from './browser-file-source';
import { selectFileSource } from './select';
import type { FileSource } from './types';

/**
 * React surface for the active `FileSource`. Today the boot probe
 * always returns the browser source; Phase C lights up the personal
 * source when `__COLLAB_BUILD__` + `/auth/me` say so, Phase D adds the
 * WOPI URL-token path.
 *
 * Provider is mounted high in `App.tsx` so the File menu, the home
 * screen, and `file-actions` share the same instance — keeping the
 * IDB connection in `BrowserFileSource` to a single live-feed.
 */

const FileSourceContext = createContext<FileSource | null>(null);

export function FileSourceProvider({ children }: { children: ReactNode }) {
  // Memoised so the source is stable across renders — important for
  // `subscribeRecent` callers that compare identity.
  const source = useMemo<FileSource>(() => selectFileSource(), []);
  return <FileSourceContext.Provider value={source}>{children}</FileSourceContext.Provider>;
}

export function useFileSource(): FileSource {
  const value = useContext(FileSourceContext);
  if (!value) {
    // Defensive: callers below the provider never get null. If they do,
    // someone forgot to wrap in `FileSourceProvider`.
    return createBrowserFileSource();
  }
  return value;
}
