import { useCollab } from '../collab/collab-context';
import { Tooltip } from './Tooltip';

/**
 * Small status dot in the sheet-tabs strip showing the collab connection
 * state. Stays out of the way in single-user mode (compact "Solo" pill);
 * becomes a green live indicator with a peer count inside a room.
 *
 * When the divergence detector flags `syncHealth = diverged` (peer Y.Doc
 * state vectors have disagreed with ours for >15 s), we override the
 * "Live" pill with an amber "Out of sync" pill so the user knows their
 * view may differ from peers' before they discover it the hard way.
 *
 * When the transport drops to `offline`, the pill turns amber and
 * shows the number of LOCAL mutations queued waiting for the WS to
 * come back. Yjs writes to the local doc immediately even offline, so
 * those edits aren't lost — but users that don't know that close the
 * tab and lose them. The queue count makes the "your edits are safe"
 * promise visible.
 */
export function CollabIndicator() {
  const { status, roomId, syncHealth, peerCount, queuedLocal } = useCollab();
  const diverged = status === 'live' && syncHealth === 'diverged';
  const effectiveStatus = diverged ? 'diverged' : status;

  // Visible text on the pill. Kept short — the tooltip carries the
  // full context. "Live · 2" reads as "live, with two others"; "Solo"
  // makes the single-user case unambiguous.
  let text: string;
  if (diverged) text = 'Out of sync';
  else if (status === 'live') text = peerCount > 0 ? `Live · ${peerCount}` : 'Live';
  else if (status === 'connecting') text = '…';
  else if (status === 'offline')
    text = queuedLocal > 0 ? `Reconnecting · ${queuedLocal}` : 'Reconnecting…';
  else text = 'Solo';

  // Tooltip — the long-form version of whatever the pill says, plus
  // the roomId for the share-link case.
  let baseLabel: string;
  if (diverged) {
    baseLabel = 'Out of sync with peers — refresh usually recovers';
  } else if (status === 'live') {
    baseLabel =
      peerCount > 0
        ? `Live — co-editing with ${peerCount} ${peerCount === 1 ? 'other peer' : 'other peers'}`
        : 'Live — co-editing on, no one else here yet';
  } else if (status === 'connecting') {
    baseLabel = 'Connecting to room…';
  } else if (status === 'offline') {
    baseLabel =
      queuedLocal > 0
        ? `Reconnecting — ${queuedLocal} of your ${queuedLocal === 1 ? 'change' : 'changes'} queued locally; they'll sync when the connection is back`
        : 'Reconnecting — your edits will sync when the connection is back';
  } else {
    baseLabel = 'Single-user mode';
  }
  const label = roomId ? `${baseLabel} (room ${roomId})` : baseLabel;

  return (
    <Tooltip label={label} side="top">
      <span
        className={`collab-indicator collab-indicator--${effectiveStatus}`}
        data-testid="collab-indicator"
        data-collab-status={effectiveStatus}
        data-sync-health={syncHealth}
        data-peer-count={peerCount}
        data-queued-local={queuedLocal}
        role="status"
        aria-label={label}
      >
        <span className="collab-indicator__dot" aria-hidden="true" />
        <span className="collab-indicator__text">{text}</span>
      </span>
    </Tooltip>
  );
}
