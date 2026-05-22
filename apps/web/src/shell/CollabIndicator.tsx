import { useCollab } from '../collab/collab-context';
import { Tooltip } from './Tooltip';

const LABELS: Record<string, string> = {
  off: 'Single-user mode',
  connecting: 'Connecting to room…',
  live: 'Live — co-editing on',
  // Wording matters: "Offline" reads as a permanent state and worries
  // users; the bridge actually reconnects automatically and edits queue
  // locally in the meantime. "Reconnecting…" sets the right expectation.
  offline: 'Reconnecting — your edits will sync when the connection is back',
};

/**
 * Small status dot in the sheet-tabs strip showing the collab connection
 * state. Stays out of the way in single-user mode (compact "single-user"
 * pill); becomes a green live indicator inside a room.
 *
 * When the divergence detector flags `syncHealth = diverged` (peer Y.Doc
 * state vectors have disagreed with ours for >15 s), we override the
 * "Live" pill with an amber "Out of sync" pill so the user knows their
 * view may differ from peers' before they discover it the hard way.
 *
 * Clicking nothing yet — pure status surface. A future iteration can
 * make the dot a popover with the share URL + connected-peer count.
 */
export function CollabIndicator() {
  const { status, roomId, syncHealth } = useCollab();
  // Sync-health override only meaningful when we're live. Otherwise
  // show the transport-status label.
  const diverged = status === 'live' && syncHealth === 'diverged';
  const baseLabel = diverged
    ? 'Out of sync with peers — refresh usually recovers'
    : LABELS[status];
  const label = roomId ? `${baseLabel} (room ${roomId})` : baseLabel;
  const effectiveStatus = diverged ? 'diverged' : status;

  return (
    <Tooltip label={label} side="top">
      <span
        className={`collab-indicator collab-indicator--${effectiveStatus}`}
        data-testid="collab-indicator"
        data-collab-status={effectiveStatus}
        data-sync-health={syncHealth}
        role="status"
        aria-label={label}
      >
        <span className="collab-indicator__dot" aria-hidden="true" />
        <span className="collab-indicator__text">
          {diverged
            ? 'Out of sync'
            : status === 'live'
              ? 'Live'
              : status === 'connecting'
                ? '…'
                : status === 'offline'
                  ? 'Reconnecting…'
                  : 'Solo'}
        </span>
      </span>
    </Tooltip>
  );
}
