import { useEffect, useState } from 'react';
import { Icon } from '../shell/Icon';
import type { RecentFile } from '../recent-files/store';

/**
 * One-tap "reopen the file you were in last" prompt, rendered above the
 * template gallery on the home screen. Sister of the autosave banner —
 * autosave handles the *unsaved-changes* case (you closed the tab
 * mid-edit); this handles the *cleanly-closed* case ("you opened this
 * yesterday — open it again?").
 *
 * Gates that keep this from being noise:
 *   - the most-recent entry must be inside REOPEN_WITHIN_MS (7 days)
 *   - the user hasn't dismissed it for this tab (sessionStorage)
 *   - empty if no recent files
 *
 * The autosave banner takes precedence: if there's an unsaved-changes
 * record, App auto-dismisses the home screen entirely, so this banner
 * never gets a chance to render. No coordination needed here.
 */

const REOPEN_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;
const DISMISS_KEY = 'casual-sheets:reopen-banner-dismissed';

export function ReopenBanner({
  recents,
  onOpen,
}: {
  recents: RecentFile[];
  onOpen: (rec: RecentFile) => void;
}) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Reset the dismiss when the recent list changes shape — if the user
  // opens a fresh file in this tab, the most-recent slot becomes new
  // data and the prior dismissal is no longer the right answer.
  const topId = recents[0]?.id ?? null;
  useEffect(() => {
    if (topId == null) return;
    try {
      const stored = sessionStorage.getItem(`${DISMISS_KEY}:id`);
      if (stored !== String(topId)) {
        sessionStorage.removeItem(DISMISS_KEY);
        sessionStorage.setItem(`${DISMISS_KEY}:id`, String(topId));
        setDismissed(false);
      }
    } catch {
      /* sessionStorage blocked — treat every render as fresh, harmless */
    }
  }, [topId]);

  const top = recents[0];
  if (!top || dismissed) return null;
  if (Date.now() - top.openedAt > REOPEN_WITHIN_MS) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sessionStorage blocked — banner still hides for this render */
    }
    setDismissed(true);
  };

  return (
    <div className="home__reopen" role="status" data-testid="home-reopen-banner">
      <span className="home__reopen-icon" aria-hidden>
        <Icon name="history" />
      </span>
      <span className="home__reopen-text">
        Pick up where you left off — <strong>{top.name}</strong>
        <span className="home__reopen-meta">{formatAgo(Date.now() - top.openedAt)}</span>
      </span>
      <button
        type="button"
        className="home__reopen-btn home__reopen-btn--primary"
        onClick={() => onOpen(top)}
        data-testid="home-reopen-open"
      >
        Open
      </button>
      <button
        type="button"
        className="home__reopen-btn"
        onClick={dismiss}
        aria-label="Dismiss"
        data-testid="home-reopen-dismiss"
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return 'moments ago';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
