import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useUniverAPI } from '../use-univer';
import { startBridge, type BridgeHandle } from './bridge';

/**
 * Mounts the Yjs ↔ Univer bridge when:
 *   1. the URL carries a room id (`/r/:roomId` or `?room=:roomId`), AND
 *   2. the build was made with `VITE_COLLAB_ENABLED=1` (the Docker image),
 *      or the host is running an explicit `__COLLAB_WS_URL__` override.
 *
 * The GitHub Pages deploy at `sheet.schnsrw.live` is built WITHOUT the
 * flag so co-editing is unavailable there — visitors who land on a
 * `/r/:roomId` URL see a small banner pointing them to the self-host
 * docs instead. Co-editing only ships through the Docker image.
 */
export function CollabDriver() {
  const api = useUniverAPI();
  const handleRef = useRef<BridgeHandle | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [needsSelfHost, setNeedsSelfHost] = useState(false);

  useEffect(() => {
    if (!api) return;
    const roomId = readRoomFromLocation();
    if (!roomId) return;

    if (!isCollabEnabled()) {
      setNeedsSelfHost(true);
      console.info(
        '[collab] /r/%s requested but this build has VITE_COLLAB_ENABLED unset — self-host with Docker to enable',
        roomId,
      );
      return;
    }

    const url = wsUrl();
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url, name: roomId, document: doc });
    const handle = startBridge(api, doc);

    docRef.current = doc;
    providerRef.current = provider;
    handleRef.current = handle;

    console.info('[collab] joined room', roomId, 'via', url);

    return () => {
      handle.dispose();
      provider.destroy();
      doc.destroy();
      handleRef.current = null;
      providerRef.current = null;
      docRef.current = null;
    };
  }, [api]);

  return needsSelfHost ? <SelfHostBanner /> : null;
}

/**
 * Notice shown when someone opens a `/r/:roomId` URL on a build that
 * doesn't ship co-editing (i.e. the public GitHub Pages demo). Points
 * them at the self-host instructions on the apex site.
 */
function SelfHostBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="collab-banner" data-testid="collab-banner" role="status">
      <div className="collab-banner__body">
        <strong>Co-editing requires self-hosting.</strong>{' '}
        The hosted demo at <code>sheet.schnsrw.live</code> is single-user. Run
        Casual Sheets with Docker to get rooms — <a href="https://schnsrw.live/#work" rel="noopener">how to self-host →</a>
      </div>
      <button
        type="button"
        className="collab-banner__close"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}

function isCollabEnabled(): boolean {
  // Window override wins (tests / runtime experiments). Otherwise read the
  // build-time flag — Vite folds env vars at build time, so this becomes
  // a literal `true` / `false` in the bundle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (window as any).__COLLAB_WS_URL__ === 'string') return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flag = (import.meta.env as any).VITE_COLLAB_ENABLED as string | undefined;
  return flag === '1' || flag === 'true';
}

function readRoomFromLocation(): string | null {
  // /r/<id> takes precedence; falls back to ?room=<id> for query-style links.
  const path = window.location.pathname.match(/^\/r\/([\w-]{4,})\/?$/);
  if (path) return path[1];
  const params = new URLSearchParams(window.location.search);
  const q = params.get('room');
  return q && q.length >= 4 ? q : null;
}

function wsUrl(): string {
  // Two override paths so dev / tests / containers can point the bridge
  // at a different host without rebuilding Vite:
  //   - `window.__COLLAB_WS_URL__`  — set via Playwright `addInitScript`,
  //     also handy for runtime browser experimentation.
  //   - `import.meta.env.VITE_COLLAB_WS_URL` — baked at build time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const winOverride = (window as any).__COLLAB_WS_URL__ as string | undefined;
  if (typeof winOverride === 'string' && winOverride) return winOverride;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const envOverride = (import.meta.env as any).VITE_COLLAB_WS_URL as string | undefined;
  if (envOverride) return envOverride;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/yjs`;
}
