/**
 * Personal-mode auth state shared between the gate, the signup /
 * login views, and the account modal. Matches the `/auth/status`
 * and `/auth/me` response shapes from the server.
 *
 * `kind` is the discriminator the gate switches on:
 *
 *   - 'disabled' — server returned 503 or 404 for /auth/status;
 *     personal mode is off (or we're on the GitHub Pages build).
 *     The gate renders nothing and the app boots normally.
 *   - 'unauthenticated' — server is in `single|multi` mode and the
 *     visitor doesn't have a valid session. The gate shows either
 *     the signup view (when `signupAllowed`) or the login view.
 *   - 'authenticated' — visitor has a live session; render the app
 *     and surface `user` to the account modal.
 *   - 'loading' — initial state before the first probe completes.
 *     The gate renders a thin spinner-card.
 *   - 'unreachable' — fetch failed (network down, server crashed).
 *     The gate shows a small "couldn't reach the server" message
 *     with a Retry button rather than booting the app into an
 *     unknown state.
 */

export type PersonalUser = {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: number;
};

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | {
      kind: 'unauthenticated';
      mode: 'single' | 'multi';
      signupAllowed: boolean;
      hasAnyUser: boolean;
    }
  | {
      kind: 'authenticated';
      user: PersonalUser;
      mode: 'single' | 'multi';
    }
  | { kind: 'unreachable'; message: string };
