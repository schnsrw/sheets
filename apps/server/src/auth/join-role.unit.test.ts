/**
 * Branch-matrix unit test for `resolveJoinRole` — the PURE, security-
 * critical decision behind the collab join handshake (sharing-model
 * §6.1 enforcement). This is the most important test surface in the
 * batch: `yjs.ts` onAuthenticate is a thin adapter over this function,
 * so exercising every branch here is what proves the gate is correct.
 *
 * No DB, no socket — the token lookup + password comparator are
 * injected, so we drive every path deterministically.
 *
 * Run with `pnpm test:unit`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';

import { resolveJoinRole, resolveMemberJoin } from './join-role.js';
import type { ResolveMemberJoinInput } from './join-role.js';
import type { ShareLinkRole, ShareRole } from './personal.js';
import { personalRoomId } from './personal-room.js';

const ROOM = 'room-xyz';

/** Build a ShareLinkRole the injected lookup returns. */
function link(overrides: Partial<ShareLinkRole> = {}): ShareLinkRole {
  return {
    workbookId: 'f-1',
    roomId: ROOM,
    role: 'edit',
    hasPassword: false,
    passwordHash: null,
    expiresAt: null,
    ...overrides,
  };
}

/** A lookup that returns the given link for ANY token (or null). */
const lookupReturns =
  (value: ShareLinkRole | null) =>
  (_token: string): ShareLinkRole | null =>
    value;

test('no token → anonymous fall-through (legacy behaviour preserved)', () => {
  for (const token of [null, '']) {
    const r = resolveJoinRole({
      token,
      documentName: ROOM,
      sharePassword: null,
      lookup: () => {
        throw new Error('lookup must NOT be called when there is no token');
      },
    });
    assert.deepEqual(r, { via: 'anonymous' }, `token=${JSON.stringify(token)}`);
  }
});

test('valid view token → read-only, role view, via share-token', () => {
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: null,
    lookup: lookupReturns(link({ role: 'view' })),
  });
  assert.deepEqual(r, { readOnly: true, role: 'view', via: 'share-token' });
});

test('valid edit token → writable, role edit', () => {
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: null,
    lookup: lookupReturns(link({ role: 'edit' })),
  });
  assert.deepEqual(r, { readOnly: false, role: 'edit', via: 'share-token' });
});

test('comment role collapses to read-only (binary readOnly; fine-grained deferred)', () => {
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: null,
    lookup: lookupReturns(link({ role: 'comment' })),
  });
  assert.deepEqual(r, { readOnly: true, role: 'comment', via: 'share-token' });
});

test('unknown / expired token → reject invalid-token', () => {
  // getLinkRole returns null for both unknown AND expired, so a single
  // null-lookup covers both — the gate can't (and need not) tell them
  // apart.
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: null,
    lookup: lookupReturns(null),
  });
  assert.deepEqual(r, { reject: 'invalid-token' });
});

test('token bound to a different room → reject room-mismatch (replay guard)', () => {
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: null,
    lookup: lookupReturns(link({ roomId: 'some-other-room' })),
  });
  assert.deepEqual(r, { reject: 'room-mismatch' });
});

test('legacy empty-roomId token never matches a real room → reject room-mismatch', () => {
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: null,
    lookup: lookupReturns(link({ roomId: '' })),
  });
  assert.deepEqual(r, { reject: 'room-mismatch' });
});

test('password-gated token, no share password supplied → reject password-required', () => {
  const hash = bcrypt.hashSync('secret', 10);
  for (const sp of [null, '']) {
    const r = resolveJoinRole({
      token: 'tok',
      documentName: ROOM,
      sharePassword: sp,
      lookup: lookupReturns(link({ hasPassword: true, passwordHash: hash })),
    });
    assert.deepEqual(r, { reject: 'password-required' }, `sp=${JSON.stringify(sp)}`);
  }
});

test('password-gated token, wrong share password → reject password-mismatch', () => {
  const hash = bcrypt.hashSync('secret', 10);
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: 'WRONG',
    lookup: lookupReturns(link({ hasPassword: true, passwordHash: hash })),
  });
  assert.deepEqual(r, { reject: 'password-mismatch' });
});

test('password-gated token, correct share password → authorised at the token role', () => {
  const hash = bcrypt.hashSync('secret', 10);
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: 'secret',
    lookup: lookupReturns(link({ role: 'view', hasPassword: true, passwordHash: hash })),
  });
  assert.deepEqual(r, { readOnly: true, role: 'view', via: 'share-token' });
});

test('room check runs BEFORE the password check (wrong room never reveals password validity)', () => {
  // A token bound to another room must reject on room-mismatch even when
  // a correct password is supplied — order matters so we never run the
  // (costly + information-leaking) bcrypt compare for a token that isn't
  // even for this room.
  const hash = bcrypt.hashSync('secret', 10);
  let compareCalled = false;
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: 'secret',
    lookup: lookupReturns(link({ roomId: 'other', hasPassword: true, passwordHash: hash })),
    comparePassword: () => {
      compareCalled = true;
      return true;
    },
  });
  assert.deepEqual(r, { reject: 'room-mismatch' });
  assert.equal(compareCalled, false, 'password comparator must not run for a wrong-room token');
});

test('injected comparator is used (custom hash verification path)', () => {
  const r = resolveJoinRole({
    token: 'tok',
    documentName: ROOM,
    sharePassword: 'anything',
    lookup: lookupReturns(link({ role: 'edit', hasPassword: true, passwordHash: 'opaque' })),
    comparePassword: (plain, hashArg) => plain === 'anything' && hashArg === 'opaque',
  });
  assert.deepEqual(r, { readOnly: false, role: 'edit', via: 'share-token' });
});

// ── resolveMemberJoin — personal-file room (sharing-model §6.2) ─────────
//
// The FULL matrix for the session/member gate. resolveMemberJoin composes
// WITH resolveJoinRole (token path) so we re-prove the token path wins,
// then cover owner / admin / member / reject and the anonymous
// byte-identical fall-through. `yjs.ts` onAuthenticate is a thin adapter
// over this function.

const WORKBOOK = 'f-1';
const PF_ROOM = personalRoomId(WORKBOOK); // 'pf-f-1'

/** Build a resolveMemberJoin input with safe defaults; every callback
 *  throws unless a test overrides it, so an unexpected branch is loud. */
function memberInput(overrides: Partial<ResolveMemberJoinInput> = {}): ResolveMemberJoinInput {
  return {
    documentName: PF_ROOM,
    token: null,
    sharePassword: null,
    session: null,
    lookupLink: () => {
      throw new Error('lookupLink must not be called on the session path');
    },
    isOwner: () => false,
    memberRole: () => null,
    ...overrides,
  };
}

test('member-join: token present → defers to the token path UNCHANGED (token wins)', () => {
  // Even though the session would resolve to owner→edit, a VIEW token
  // present must collapse to the token's role — the token path is
  // authoritative and runs unchanged.
  const r = resolveMemberJoin(
    memberInput({
      documentName: PF_ROOM,
      token: 'tok',
      session: { userId: 7, isAdmin: true }, // would be admin→edit otherwise
      isOwner: () => true, // would be owner→edit otherwise
      lookupLink: lookupReturns(link({ roomId: PF_ROOM, role: 'view' })),
    }),
  );
  assert.deepEqual(r, { readOnly: true, role: 'view', via: 'share-token' });
});

test('member-join: token present but invalid → reject from the token path', () => {
  const r = resolveMemberJoin(
    memberInput({
      token: 'tok',
      session: { userId: 7, isAdmin: true },
      lookupLink: lookupReturns(null),
    }),
  );
  assert.deepEqual(r, { reject: 'invalid-token' });
});

test('member-join: pf- room, no session, no token → reject no-access', () => {
  const r = resolveMemberJoin(memberInput({ session: null }));
  assert.deepEqual(r, { reject: 'no-access' });
});

test('member-join: pf- room, admin session → edit (via admin)', () => {
  const r = resolveMemberJoin(
    memberInput({
      session: { userId: 9, isAdmin: true },
      isOwner: () => {
        throw new Error('admin short-circuits before the owner check');
      },
    }),
  );
  assert.deepEqual(r, { readOnly: false, role: 'edit', via: 'admin' });
});

test('member-join: pf- room, owner session → edit (via owner)', () => {
  let askedFor: [string, number] | null = null;
  const r = resolveMemberJoin(
    memberInput({
      session: { userId: 42, isAdmin: false },
      isOwner: (wb, uid) => {
        askedFor = [wb, uid];
        return true;
      },
    }),
  );
  assert.deepEqual(r, { readOnly: false, role: 'edit', via: 'owner' });
  assert.deepEqual(askedFor, [WORKBOOK, 42], 'isOwner called with reversed workbookId + userId');
});

test('member-join: pf- room, member edit → edit, writable (via member)', () => {
  const r = resolveMemberJoin(
    memberInput({
      session: { userId: 5, isAdmin: false },
      memberRole: () => 'edit',
    }),
  );
  assert.deepEqual(r, { readOnly: false, role: 'edit', via: 'member' });
});

test('member-join: pf- room, member view → read-only (via member)', () => {
  const r = resolveMemberJoin(
    memberInput({
      session: { userId: 5, isAdmin: false },
      memberRole: () => 'view',
    }),
  );
  assert.deepEqual(r, { readOnly: true, role: 'view', via: 'member' });
});

test('member-join: pf- room, member comment → read-only (binary; fine-grained deferred)', () => {
  const r = resolveMemberJoin(
    memberInput({
      session: { userId: 5, isAdmin: false },
      memberRole: () => 'comment',
    }),
  );
  assert.deepEqual(r, { readOnly: true, role: 'comment', via: 'member' });
});

test('member-join: pf- room, logged-in but NO grant (not owner/admin/member) → reject no-access', () => {
  let memberAsked: [string, number] | null = null;
  const r = resolveMemberJoin(
    memberInput({
      session: { userId: 5, isAdmin: false },
      isOwner: () => false,
      memberRole: (wb, uid) => {
        memberAsked = [wb, uid];
        return null;
      },
    }),
  );
  assert.deepEqual(r, { reject: 'no-access' });
  assert.deepEqual(memberAsked, [WORKBOOK, 5], 'memberRole queried with reversed workbookId');
});

test('member-join: non-pf- room, no token → anonymous fall-through UNCHANGED (legacy)', () => {
  // A random anonymous room must NEVER pass through the session gate —
  // even with a logged-in session, the result is the byte-identical
  // anonymous fall-through the adapter applies the legacy ?role= path to.
  for (const session of [null, { userId: 1, isAdmin: true }]) {
    const r = resolveMemberJoin(
      memberInput({
        documentName: 'room-random',
        session,
        // These MUST NOT be consulted for a non-pf- room.
        isOwner: () => {
          throw new Error('isOwner must not run for an anonymous room');
        },
        memberRole: () => {
          throw new Error('memberRole must not run for an anonymous room');
        },
      }),
    );
    assert.deepEqual(r, { via: 'anonymous' }, `session=${JSON.stringify(session)}`);
  }
});

test('member-join: empty-string token is treated as ABSENT (falls to session path)', () => {
  // A `?share=` with no value can't be a capability — it must fall
  // through to the session gate, not the token path.
  const r = resolveMemberJoin(
    memberInput({
      token: '',
      session: { userId: 9, isAdmin: true },
    }),
  );
  assert.deepEqual(r, { readOnly: false, role: 'edit', via: 'admin' });
});

test('member-join: precedence is admin > owner > member (admin beats a lesser member role)', () => {
  // A user who is BOTH admin and a view-member must get edit (admin wins).
  const roles: ShareRole[] = [];
  const r = resolveMemberJoin(
    memberInput({
      session: { userId: 3, isAdmin: true },
      memberRole: () => {
        roles.push('view');
        return 'view';
      },
    }),
  );
  assert.deepEqual(r, { readOnly: false, role: 'edit', via: 'admin' });
  assert.equal(roles.length, 0, 'memberRole must not be consulted once admin matches');
});
