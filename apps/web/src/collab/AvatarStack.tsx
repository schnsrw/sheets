import { Tooltip } from '../shell/Tooltip';
import { initials } from './presence';
import { usePresence } from './presence-context';
import { useCollab } from './collab-context';

/**
 * Compact avatar stack rendered in the sheet-tabs strip when joined to a
 * room. Each peer is a colored circle with their initials; tooltip shows
 * the full name. Excludes self. Limits to 4 visible avatars + "+N" pill
 * so a 12-person room doesn't blow out the tab strip.
 */
const VISIBLE = 4;

export function AvatarStack() {
  const { roomId, status } = useCollab();
  const { peers, me } = usePresence();
  if (!roomId || status === 'off') return null;

  // Show self too so the user always sees their own avatar — anchors the
  // colors in their head before peers join. Self goes first.
  const all = me
    ? [{ clientId: -1, name: me.name, color: me.color }, ...peers.map((p) => ({ clientId: p.clientId, name: p.name, color: p.color }))]
    : peers.map((p) => ({ clientId: p.clientId, name: p.name, color: p.color }));

  if (all.length === 0) return null;

  const visible = all.slice(0, VISIBLE);
  const extra = all.length - visible.length;

  return (
    <span className="presence-avatars" data-testid="presence-avatars">
      {visible.map((p) => (
        <Tooltip key={p.clientId} label={p.clientId === -1 ? `${p.name} (you)` : p.name} side="bottom">
          <span
            className="presence-avatar"
            data-testid="presence-avatar"
            style={{ background: p.color }}
            aria-label={p.name}
          >
            {initials(p.name)}
          </span>
        </Tooltip>
      ))}
      {extra > 0 && (
        <Tooltip label={`${extra} more in this room`} side="bottom">
          <span className="presence-avatar presence-avatar--more" data-testid="presence-avatar-more">
            +{extra}
          </span>
        </Tooltip>
      )}
    </span>
  );
}
