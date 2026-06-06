import { useEffect, useRef, useState } from 'react';
import { Icon } from '../shell/Icon';
import { useAuth, useCurrentUser } from './auth-context';
import { logout } from './api';

/**
 * Title-bar account menu — only renders when a personal-mode
 * session is live (Mode 3 / authenticated). Avatar circle with the
 * first letter of the username; click opens a small popover with
 * the username + Sign out. Phase C-follow-up: "Change password"
 * and "Delete account" land here once the modal is built.
 *
 * Hidden entirely on Mode 1 / Mode 2 / unauthenticated states so
 * the existing chrome layout is unchanged outside of the
 * standalone deploy.
 */

export function AccountMenu() {
  const user = useCurrentUser();
  const { setUnauthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const initial = user.username.charAt(0).toUpperCase();
  const onLogout = async () => {
    setOpen(false);
    await logout();
    setUnauthenticated();
  };

  return (
    <div className="account-menu" ref={ref} data-testid="account-menu">
      <button
        type="button"
        className="account-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Signed in as ${user.username}`}
        onClick={() => setOpen((v) => !v)}
        data-testid="account-menu-trigger"
      >
        <span aria-hidden>{initial}</span>
      </button>
      {open && (
        <div role="menu" className="account-menu__popover">
          <div className="account-menu__header">
            <div className="account-menu__name">{user.username}</div>
            <div className="account-menu__role">{user.isAdmin ? 'Admin' : 'User'}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="account-menu__item"
            onClick={() => void onLogout()}
            data-testid="account-menu-signout"
          >
            <Icon name="logout" size="sm" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
