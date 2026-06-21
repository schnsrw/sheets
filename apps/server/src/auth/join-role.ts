import bcrypt from 'bcryptjs';
import type { ShareRole, ShareLinkRole } from './personal.js';
import { workbookIdForRoom } from './personal-room.js';

/**
 * Pure role-resolution for the collab join handshake (sharing-model
 * §6.1 enforcement). This is the SECURITY-CRITICAL decision: given a
 * (possibly absent) share token and the room being joined, decide
 * whether the connection is allowed and at what privilege.
 *
 * Kept deliberately PURE — no DB handle, no socket, no clock of its
 * own — so the full branch matrix is unit-testable and `onAuthenticate`
 * stays a thin adapter that only does I/O (read token → call this →
 * set `connection.readOnly`). The token lookup is injected as a
 * callback so tests can drive every branch without a SQLite store.
 *
 * Two regimes:
 *
 *   1. NO token present → ANONYMOUS room behaviour, preserved
 *      byte-for-byte from before this batch: the caller honours the
 *      client-supplied `?role=` (view → readOnly) and the room-password
 *      gate runs separately in the HTTP upgrade handler. This function
 *      returns `via: 'anonymous'` and does NOT touch the role — the
 *      adapter applies the legacy `?role=` logic itself.
 *
 *   2. Token present → the server is AUTHORITATIVE. The client `?role=`
 *      is IGNORED entirely. The token must (a) resolve (exist + not
 *      expired), (b) be bound to THIS room, and (c) satisfy its
 *      optional bcrypt password. Any failure REJECTS the connection.
 */

/** Inputs to the join decision. All strings come straight off the WS
 *  query string (untrusted). `lookup` resolves a token to its persisted
 *  role/room/password, respecting expiry, or null. */
export type ResolveJoinRoleInput = {
  /** `?share=<token>` — the capability secret, or null when absent. */
  token: string | null;
  /** The room being joined (Hocuspocus `documentName`). */
  documentName: string;
  /** `?sp=<password>` — the share-link password, a DISTINCT param from
   *  the room `?p=` gate. Null when not supplied. */
  sharePassword: string | null;
  /** Token resolver — `PersonalAuthStore.getLinkRole` in production,
   *  a stub in tests. Returns null for unknown/expired tokens. */
  lookup: (token: string) => ShareLinkRole | null;
  /** Optional bcrypt comparator override (tests). Defaults to
   *  `bcrypt.compareSync`. */
  comparePassword?: (plain: string, hash: string) => boolean;
};

/** Why a token-bearing join was refused. Surfaced for logging only —
 *  the adapter collapses all of these to a single closed connection so
 *  the client can't distinguish "wrong room" from "expired" etc. */
export type JoinRejectReason =
  | 'invalid-token' // unknown or expired
  | 'room-mismatch' // token bound to a different room
  | 'password-required' // token is password-gated, none supplied
  | 'password-mismatch'; // supplied share password didn't verify

export type ResolveJoinRoleResult =
  | {
      /** Token-authorised join. `readOnly` is the authoritative gate
       *  Hocuspocus enforces; `role` carries the fine-grained role for
       *  logging / future comment-mode. */
      readOnly: boolean;
      role: ShareRole;
      via: 'share-token';
    }
  | {
      /** No token — fall through to the legacy anonymous path. The
       *  adapter applies `?role=` + the room-password gate as before. */
      via: 'anonymous';
    }
  | {
      /** Token present but invalid — the connection MUST be refused. */
      reject: JoinRejectReason;
    };

export function resolveJoinRole(input: ResolveJoinRoleInput): ResolveJoinRoleResult {
  const { token, documentName, sharePassword, lookup } = input;
  const compare = input.comparePassword ?? bcrypt.compareSync;

  // ── Regime 1: no token → preserve anonymous behaviour exactly. ──────
  // An empty-string token is treated as absent (a `?share=` with no
  // value can't be a real capability).
  if (token === null || token.length === 0) {
    return { via: 'anonymous' };
  }

  // ── Regime 2: token present → server is authoritative. ──────────────
  const link = lookup(token);
  // Unknown or expired (getLinkRole bakes expiry into the null).
  if (!link) {
    return { reject: 'invalid-token' };
  }
  // Replay guard: the token is bound to a specific room. A legacy row
  // with an empty roomId (see personal.ts migration note) can never
  // match a real documentName, so it rejects here.
  if (link.roomId !== documentName) {
    return { reject: 'room-mismatch' };
  }
  // Optional layered password gate. DISTINCT from the room `?p=` gate —
  // this verifies `?sp=` against the token's own bcrypt hash.
  if (link.passwordHash !== null) {
    if (sharePassword === null || sharePassword.length === 0) {
      return { reject: 'password-required' };
    }
    if (!compare(sharePassword, link.passwordHash)) {
      return { reject: 'password-mismatch' };
    }
  }

  // Authorised. Hocuspocus's readOnly flag is BINARY, so anything short
  // of 'edit' is read-only. NOTE: 'comment' collapses to read-only here
  // — fine-grained comment-mode (permit comment mutations, block cell
  // edits) is a DEFERRED follow-up that needs Univer-permission work in
  // the client's `applyViewOnlyMode`, not this server gate. See
  // docs/SHARING_MODEL.md §3.2.
  return {
    readOnly: link.role !== 'edit',
    role: link.role,
    via: 'share-token',
  };
}

/**
 * Pure role-resolution for a PERSONAL-FILE co-edit room (sharing-model
 * §6.2 enforcement). Composes WITH `resolveJoinRole`: when a `?share=`
 * token is present the token path is authoritative and runs UNCHANGED;
 * otherwise this decides the join from the joiner's SESSION (owner /
 * admin / member ACL) for a deterministic `pf-<workbookId>` room.
 *
 * Like `resolveJoinRole`, kept deliberately PURE — the session lookup,
 * ownership check, and member-role read are all injected callbacks so
 * the full matrix is unit-testable without a SQLite store or a socket.
 *
 * Decision order (security-critical — DO NOT reorder without re-reading
 * the matrix test):
 *
 *   1. `?share=<token>` present → defer to `resolveJoinRole` UNCHANGED.
 *      The token role is authoritative (already room-bound +
 *      password-gated). A member who ALSO holds a token gets exactly
 *      what the token grants — we don't try to merge the two.
 *
 *   2. Else if `documentName` is a `pf-<workbookId>` room:
 *        - no session (anonymous, no token) → REJECT `no-access`.
 *        - session.isAdmin                  → edit.
 *        - isOwner(workbookId, userId)      → edit.
 *        - else memberRole(workbookId, userId):
 *            - a role → that role.
 *            - null   → REJECT `no-access`.
 *
 *   3. Else (non-`pf-` room, no token) → `via: 'anonymous'`. The caller
 *      runs the EXACT legacy `?role=` + room-password path, byte-for-byte
 *      unchanged. Anonymous random rooms NEVER pass through the member
 *      gate.
 *
 * For an authorised non-anonymous member result, `readOnly = role !==
 * 'edit'` — so 'comment' collapses to read-only (binary, like the token
 * path; fine-grained comment-mode is the same DEFERRED follow-up).
 */

/** Inputs to the personal-file join decision. Strings come off the WS
 *  query string / document name (untrusted); the session + lookups are
 *  resolved by the adapter (I/O) and injected here. */
export type ResolveMemberJoinInput = {
  /** Hocuspocus `documentName` — the room being joined. */
  documentName: string;
  /** `?share=<token>` — capability secret, or null when absent. When
   *  present, the token path wins (defers to `resolveJoinRole`). */
  token: string | null;
  /** `?sp=<password>` — share-link password (token path only). */
  sharePassword: string | null;
  /** The authenticated joiner, resolved from the `cs_session` cookie, or
   *  null when anonymous. `isAdmin` grants edit on any personal file
   *  (§4 RequireAdmin). */
  session: { userId: number; isAdmin: boolean } | null;
  /** Token resolver — `PersonalAuthStore.getLinkRole` in production. */
  lookupLink: (token: string) => ShareLinkRole | null;
  /** True when `userId` owns `workbookId` (file registry `ownerId`). */
  isOwner: (workbookId: string, userId: number) => boolean;
  /** The member's ACL role on `workbookId`, or null when no ACL row. */
  memberRole: (workbookId: string, userId: number) => ShareRole | null;
  /** Optional bcrypt comparator override (tests) — forwarded to the
   *  token path. */
  comparePassword?: (plain: string, hash: string) => boolean;
};

/** Why a personal-file session join was refused. Distinct from the
 *  token reject reasons so logs can tell "anonymous on a gated room"
 *  / "logged-in but no grant" apart from token failures. */
export type MemberJoinRejectReason = 'no-access';

export type ResolveMemberJoinResult =
  | {
      /** Authorised via the joiner's session. `via` distinguishes the
       *  privilege source for the audit log. */
      readOnly: boolean;
      role: ShareRole;
      via: 'owner' | 'admin' | 'member';
    }
  // The token-path + anonymous results are the SAME shapes
  // `resolveJoinRole` returns — the adapter handles them identically.
  | { readOnly: boolean; role: ShareRole; via: 'share-token' }
  | { via: 'anonymous' }
  | { reject: JoinRejectReason | MemberJoinRejectReason };

export function resolveMemberJoin(input: ResolveMemberJoinInput): ResolveMemberJoinResult {
  const { documentName, token, sharePassword, session } = input;

  // ── 1. Token present → token path is authoritative, UNCHANGED. ──────
  // An empty-string token is "absent" (matches resolveJoinRole), so it
  // falls through to the session/anonymous logic below rather than
  // hitting the token path.
  if (token !== null && token.length > 0) {
    return resolveJoinRole({
      token,
      documentName,
      sharePassword,
      lookup: input.lookupLink,
      comparePassword: input.comparePassword,
    });
  }

  // ── 2. Personal-file room (deterministic pf-<workbookId>)? ──────────
  const workbookId = workbookIdForRoom(documentName);
  if (workbookId !== null) {
    // Anonymous on a personal room (no token, no session) → reject.
    // A pf- room is NEVER anonymously joinable — that's the whole point
    // of the deterministic id + gate.
    if (session === null) {
      return { reject: 'no-access' };
    }
    // Admin first (cheapest, cross-file) then owner, then member ACL.
    if (session.isAdmin) {
      return { readOnly: false, role: 'edit', via: 'admin' };
    }
    if (input.isOwner(workbookId, session.userId)) {
      return { readOnly: false, role: 'edit', via: 'owner' };
    }
    const role = input.memberRole(workbookId, session.userId);
    if (role === null) {
      return { reject: 'no-access' };
    }
    return { readOnly: role !== 'edit', role, via: 'member' };
  }

  // ── 3. Non-pf- room, no token → legacy anonymous path, unchanged. ───
  return { via: 'anonymous' };
}
