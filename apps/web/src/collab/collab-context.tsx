import { createContext, useContext } from 'react';

export type CollabStatus = 'off' | 'connecting' | 'live' | 'offline' | 'denied';
export type CollabRole = 'view' | 'write';
/**
 * `in-sync`   — local Y.Doc state vector matches every visible peer.
 *               Common steady state.
 * `syncing`   — one or more peers disagree, but the disagreement is
 *               fresh (< 15 s). Normal during active editing.
 * `diverged`  — disagreement has persisted past the grace window.
 *               Surfaces as a warning pill so the user knows their
 *               edits and their peers' edits may not match. Refresh
 *               usually recovers.
 */
export type SyncHealth = 'in-sync' | 'syncing' | 'diverged';

export type CollabCtxValue = {
  /** True when the active build was made with VITE_COLLAB_ENABLED. */
  enabled: boolean;
  /** Current room id, or null when not in a room. */
  roomId: string | null;
  /** WebSocket transport status. `off` when no room is joined; `denied`
   *  when the server rejected the password / auth. */
  status: CollabStatus;
  /** Effective role for this client in the active room. Defaults to
   *  `write` outside a room (the local single-user editor). */
  role: CollabRole;
  /** Aggregate Yjs sync health across visible peers. Only meaningful
   *  when `status === 'live'`; falls back to `in-sync` otherwise. */
  syncHealth: SyncHealth;
};

export const CollabContext = createContext<CollabCtxValue>({
  enabled: false,
  roomId: null,
  status: 'off',
  role: 'write',
  syncHealth: 'in-sync',
});

export function useCollab(): CollabCtxValue {
  return useContext(CollabContext);
}
