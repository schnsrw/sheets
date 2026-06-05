import { useEffect, useState } from 'react';
import { useFileSource } from './context';
import type { RecentEntry } from './types';

/**
 * Reactive recent-files list scoped to the active `FileSource`.
 *
 * Mirrors the older `useLiveRecentFiles` hook but routes through the
 * source so Mode 3 and Mode 2 can swap in their own listing (server
 * fetch + push notification) without touching this hook or the
 * components that consume it.
 *
 * Resubscribes when the source identity changes — Phase C will swap
 * the source on auth changes, and consumers should see the new list
 * without a remount.
 */

export function useRecentFiles(): RecentEntry[] {
  const source = useFileSource();
  const [list, setList] = useState<RecentEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void source.listRecent().then((next) => {
        if (!cancelled) setList(next);
      });
    };
    refresh();
    const unsub = source.subscribeRecent(refresh);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [source]);

  return list;
}
