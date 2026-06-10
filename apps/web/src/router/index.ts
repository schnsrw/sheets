/**
 * Tiny path-based router for the personal-mode IA. UX_AUDIT.md §1, §5.
 *
 *   /                          → redirect /home
 *   /home                      → MySpreadsheets list
 *   /templates                 → template gallery
 *   /sheet/<id>                → editor for the saved workbook
 *   /sheet/<id>?share=<token>  → editor as a share-link grantee
 *   /sheet/new                 → editor with a transient draft (no server row yet)
 *   /r/<roomId>                → legacy anonymous collab room (kept; new shares
 *                                 prefer /sheet/<id>?share=...)
 *   /admin                     → admin panel (mounted from main.tsx before this
 *                                 router runs)
 *
 * History API only — no react-router dep. `navigate()` is `pushState` +
 * a custom `cd:navigate` event the `useRoute` hook listens for. Browser
 * back / forward work via the native `popstate` event we also subscribe to.
 *
 * Why a custom event in addition to popstate: the History API mutates the
 * URL synchronously but doesn't fire popstate, so consumers need a way to
 * learn about pushState calls. The `cd:navigate` event closes that gap
 * without making every caller pass a ref to the router state.
 */

const NAVIGATE_EVENT = 'cd:navigate' as const;

export interface Route {
  /** Discriminator for the top-level switch. */
  kind: 'home' | 'templates' | 'sheet' | 'sheet-draft' | 'room' | 'unknown';
  /** Parsed sheet/room id when applicable. Empty for kinds that don't carry one. */
  id: string;
  /** Optional share-link token from `?share=...`. */
  shareToken: string | null;
  /** Raw pathname — useful for telemetry / fallbacks. */
  pathname: string;
  /** Raw search string — useful for legacy ?e2e= / ?disableX= debug knobs. */
  search: string;
}

/** Pure: parse a pathname + search into a Route. */
export function parseRoute(pathname: string, search: string): Route {
  const url = new URLSearchParams(search);
  const shareToken = url.get('share');

  const sheetMatch = /^\/sheet\/(.+)$/.exec(pathname);
  if (sheetMatch) {
    const raw = decodeURIComponent(sheetMatch[1]);
    if (raw === 'new') {
      return { kind: 'sheet-draft', id: '', shareToken, pathname, search };
    }
    return { kind: 'sheet', id: raw, shareToken, pathname, search };
  }

  const roomMatch = /^\/r\/(.+)$/.exec(pathname);
  if (roomMatch) {
    return { kind: 'room', id: decodeURIComponent(roomMatch[1]), shareToken, pathname, search };
  }

  if (pathname === '/templates') {
    return { kind: 'templates', id: '', shareToken, pathname, search };
  }

  // `/` and `/home` both land on the list — but only `/home` is canonical.
  // Callers that hit `/` should redirect via navigate('/home') in their
  // mount effect.
  if (pathname === '/home' || pathname === '/') {
    return { kind: 'home', id: '', shareToken, pathname, search };
  }

  return { kind: 'unknown', id: '', shareToken, pathname, search };
}

/** Push a new URL onto history and emit `cd:navigate` so subscribers
 *  re-read the route. Use this for in-app navigation (logo click,
 *  file row click, "+ New" button, etc.). */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) {
    window.history.replaceState(window.history.state, '', to);
  } else {
    window.history.pushState({}, '', to);
  }
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT));
}

/** Subscribe to route changes. Returns the current route + auto-re-renders
 *  when `navigate()` or browser back/forward fires. */
import { useEffect, useState } from 'react';

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname, window.location.search),
  );

  useEffect(() => {
    function read() {
      setRoute(parseRoute(window.location.pathname, window.location.search));
    }
    window.addEventListener('popstate', read);
    window.addEventListener(NAVIGATE_EVENT, read as EventListener);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener(NAVIGATE_EVENT, read as EventListener);
    };
  }, []);

  // First-load redirect: `/` is not a canonical route; nudge to `/home`
  // so refresh / share / bookmark all converge on one URL.
  useEffect(() => {
    if (route.pathname === '/') {
      navigate('/home', { replace: true });
    }
  }, [route.pathname]);

  return route;
}
