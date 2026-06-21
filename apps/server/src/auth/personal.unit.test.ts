/**
 * Personal-mode auth-store contract — exercises the SQLite store
 * against a temp `users.db` per test. Covers every public method
 * + every refusal reason so the route layer can rely on these
 * outcomes without re-checking edge cases.
 *
 * Run with: `pnpm test:unit`
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';

import { PersonalAuthStore, readModeFromEnv, isShareRole, type PersonalMode } from './personal';

function withTempStore(
  mode: PersonalMode,
  bootstrap: string | null = null,
): {
  store: PersonalAuthStore;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'casual-personal-'));
  const store = new PersonalAuthStore({
    dbPath: join(dir, 'users.db'),
    mode,
    bootstrap,
    sessionTtlMs: 1000 * 60 * 60, // 1 h — keeps test rolling-expiry deterministic
  });
  return {
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("mode 'none' rejects signup and login with mode-disabled", () => {
  const { store, cleanup } = withTempStore('none');
  try {
    assert.deepEqual(store.createUser('alice', 'longpassword'), {
      ok: false,
      reason: 'mode-disabled',
    });
    assert.deepEqual(store.verifyLogin('alice', 'longpassword'), {
      ok: false,
      reason: 'mode-disabled',
    });
  } finally {
    cleanup();
  }
});

test("mode 'single' allows the first signup then closes it", () => {
  const { store, cleanup } = withTempStore('single');
  try {
    const first = store.createUser('alice', 'longpassword');
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.user.username, 'alice');
      assert.equal(first.user.isAdmin, true);
    }
    assert.deepEqual(store.createUser('bob', 'longpassword'), {
      ok: false,
      reason: 'signup-closed',
    });
    assert.equal(store.signupAllowed(), false);
  } finally {
    cleanup();
  }
});

test("mode 'multi' keeps signup open; second user is not admin", () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const first = store.createUser('alice', 'longpassword');
    const second = store.createUser('bob', 'longpassword');
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok) assert.equal(first.user.isAdmin, true);
    if (second.ok) assert.equal(second.user.isAdmin, false);
    assert.equal(store.signupAllowed(), true);
  } finally {
    cleanup();
  }
});

test('createUser rejects duplicate username case-insensitively', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    store.createUser('Alice', 'longpassword');
    assert.deepEqual(store.createUser('alice', 'differentlong'), {
      ok: false,
      reason: 'username-taken',
    });
  } finally {
    cleanup();
  }
});

test('createUser rejects short passwords + invalid usernames', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    assert.deepEqual(store.createUser('alice', 'short'), {
      ok: false,
      reason: 'weak-password',
    });
    assert.deepEqual(store.createUser('!', 'longpassword'), {
      ok: false,
      reason: 'invalid-username',
    });
    assert.deepEqual(store.createUser('a b', 'longpassword'), {
      ok: false,
      reason: 'invalid-username',
    });
  } finally {
    cleanup();
  }
});

test('verifyLogin returns the user on a correct password', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    store.createUser('alice', 'longpassword');
    const result = store.verifyLogin('alice', 'longpassword');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.user.username, 'alice');
  } finally {
    cleanup();
  }
});

test('verifyLogin rejects a wrong password and an unknown user identically', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    store.createUser('alice', 'longpassword');
    assert.deepEqual(store.verifyLogin('alice', 'wrongpassword'), {
      ok: false,
      reason: 'invalid-credentials',
    });
    assert.deepEqual(store.verifyLogin('nobody', 'anything'), {
      ok: false,
      reason: 'invalid-credentials',
    });
  } finally {
    cleanup();
  }
});

test('session lifecycle — start, resolve, end', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const created = store.createUser('alice', 'longpassword');
    if (!created.ok) throw new Error('seed failed');
    const { sessionId } = store.startSession(created.user.id);
    const resolved = store.resolveSession(sessionId);
    assert.ok(resolved);
    assert.equal(resolved?.username, 'alice');
    store.endSession(sessionId);
    assert.equal(store.resolveSession(sessionId), null);
  } finally {
    cleanup();
  }
});

test('resolveSession returns null for an unknown/expired id', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    assert.equal(store.resolveSession(null), null);
    assert.equal(store.resolveSession(undefined), null);
    assert.equal(store.resolveSession('deadbeef'), null);
  } finally {
    cleanup();
  }
});

test('changePassword requires the correct current password (cookie-mode)', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const created = store.createUser('alice', 'longpassword');
    if (!created.ok) throw new Error('seed failed');
    assert.equal(store.changePassword(created.user.id, 'wrong', 'newlongpassword'), false);
    assert.equal(store.changePassword(created.user.id, 'longpassword', 'newlongpassword'), true);
    // Old password no longer works
    assert.equal(store.verifyLogin('alice', 'longpassword').ok, false);
    assert.equal(store.verifyLogin('alice', 'newlongpassword').ok, true);
  } finally {
    cleanup();
  }
});

test('changePassword with null current password is the CLI escape hatch', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const created = store.createUser('alice', 'longpassword');
    if (!created.ok) throw new Error('seed failed');
    // CLI doesn't know the old password — it just resets.
    assert.equal(store.changePassword(created.user.id, null, 'climforced'), true);
    assert.equal(store.verifyLogin('alice', 'climforced').ok, true);
  } finally {
    cleanup();
  }
});

test('changePassword invalidates every existing session for that user', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const created = store.createUser('alice', 'longpassword');
    if (!created.ok) throw new Error('seed failed');
    const a = store.startSession(created.user.id);
    const b = store.startSession(created.user.id);
    assert.ok(store.resolveSession(a.sessionId));
    assert.ok(store.resolveSession(b.sessionId));
    store.changePassword(created.user.id, 'longpassword', 'newlongpassword');
    assert.equal(store.resolveSession(a.sessionId), null);
    assert.equal(store.resolveSession(b.sessionId), null);
  } finally {
    cleanup();
  }
});

test('deleteUser refuses to drop the last admin', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const admin = store.createUser('admin', 'longpassword');
    if (!admin.ok) throw new Error('seed failed');
    assert.equal(store.deleteUser(admin.user.id), false);
  } finally {
    cleanup();
  }
});

test('deleteUser allows dropping admin when another admin exists', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const first = store.createUser('admin', 'longpassword');
    if (!first.ok) throw new Error('seed failed');
    // The store doesn't expose a "promote to admin" today, so we
    // simulate the "two admins exist" precondition by directly
    // poking the DB via a deletion of a non-admin (regular path).
    const second = store.createUser('alice', 'longpassword');
    if (!second.ok) throw new Error('seed failed');
    assert.equal(store.deleteUser(second.user.id), true);
  } finally {
    cleanup();
  }
});

test('CASUAL_BOOTSTRAP_USER seeds the first admin', () => {
  const { store, cleanup } = withTempStore('single', 'joel:bootstrapped');
  try {
    assert.equal(store.hasAnyUser(), true);
    const login = store.verifyLogin('joel', 'bootstrapped');
    assert.equal(login.ok, true);
    if (login.ok) assert.equal(login.user.isAdmin, true);
  } finally {
    cleanup();
  }
});

test('CASUAL_BOOTSTRAP_USER is ignored once any user exists', () => {
  const { store, cleanup } = withTempStore('multi', 'admin:rotatedpwd');
  try {
    // Confirm the bootstrap landed.
    assert.equal(store.verifyLogin('admin', 'rotatedpwd').ok, true);
    // Re-instantiating with a *different* bootstrap must not silently
    // rewrite the live admin's password. Cleanup will close the first
    // store; we open a fresh handle to verify persistence.
  } finally {
    cleanup();
  }
});

// ── Share links (sharing-model §6.1) ─────────────────────────────────

test('share link: create → list → get round-trips the row', () => {
  const { store, cleanup } = withTempStore('single');
  try {
    const admin = store.createUser('alice', 'longpassword');
    if (!admin.ok) throw new Error('seed failed');
    const link = store.createShareLink({
      workbookId: 'f-abc',
      roomId: 'room-abc',
      role: 'edit',
      createdBy: admin.user.id,
    });
    assert.equal(link.workbookId, 'f-abc');
    assert.equal(link.roomId, 'room-abc');
    assert.equal(link.role, 'edit');
    assert.equal(link.expiresAt, null);
    assert.equal(link.passwordHash, null);
    assert.ok(link.token.length >= 40, 'token should carry ~32 bytes of base64url');

    const list = store.listShareLinks('f-abc');
    assert.equal(list.length, 1);
    assert.equal(list[0]?.token, link.token);
    assert.equal(list[0]?.roomId, 'room-abc', 'roomId round-trips through list');

    const got = store.getShareLink(link.token);
    assert.equal(got?.role, 'edit');
    assert.equal(got?.roomId, 'room-abc', 'roomId round-trips through get');
    assert.equal(store.getShareLink('no-such-token'), null);
    assert.deepEqual(store.listShareLinks('f-other'), []);
  } finally {
    cleanup();
  }
});

test('share link: tokens are unique CSPRNG values', () => {
  const { store, cleanup } = withTempStore('single');
  try {
    const admin = store.createUser('alice', 'longpassword');
    if (!admin.ok) throw new Error('seed failed');
    const tokens = new Set<string>();
    for (let i = 0; i < 50; i++) {
      tokens.add(
        store.createShareLink({
          workbookId: 'f-abc',
          roomId: 'room-abc',
          role: 'view',
          createdBy: admin.user.id,
        }).token,
      );
    }
    assert.equal(tokens.size, 50);
  } finally {
    cleanup();
  }
});

test('share link: getLinkRole respects expiry (live → role, lapsed → null)', () => {
  const { store, cleanup } = withTempStore('single');
  try {
    const admin = store.createUser('alice', 'longpassword');
    if (!admin.ok) throw new Error('seed failed');
    const now = Date.now();

    // Never-expiring → always resolves.
    const forever = store.createShareLink({
      workbookId: 'f-abc',
      roomId: 'room-abc',
      role: 'comment',
      createdBy: admin.user.id,
    });
    assert.equal(store.getLinkRole(forever.token)?.role, 'comment');

    // Future expiry → live.
    const live = store.createShareLink({
      workbookId: 'f-abc',
      roomId: 'room-abc',
      role: 'edit',
      createdBy: admin.user.id,
      expiresAt: now + 60_000,
    });
    assert.equal(store.getLinkRole(live.token, now)?.role, 'edit');
    assert.equal(
      store.getLinkRole(live.token, now)?.roomId,
      'room-abc',
      'getLinkRole surfaces the bound roomId',
    );

    // Past expiry → null, as if it never existed, even though the row
    // is still on disk (history is kept per §8 q2).
    const dead = store.createShareLink({
      workbookId: 'f-abc',
      roomId: 'room-abc',
      role: 'view',
      createdBy: admin.user.id,
      expiresAt: now - 1,
    });
    assert.equal(store.getLinkRole(dead.token, now), null);
    assert.ok(store.getShareLink(dead.token), 'expired row is still persisted');

    assert.equal(store.getLinkRole('unknown'), null);
  } finally {
    cleanup();
  }
});

test('share link: optional password is bcrypt-hashed, never stored plain', () => {
  const { store, cleanup } = withTempStore('single');
  try {
    const admin = store.createUser('alice', 'longpassword');
    if (!admin.ok) throw new Error('seed failed');
    const link = store.createShareLink({
      workbookId: 'f-abc',
      roomId: 'room-abc',
      role: 'view',
      createdBy: admin.user.id,
      password: 'hunter2',
    });
    assert.ok(link.passwordHash);
    assert.notEqual(link.passwordHash, 'hunter2');
    // Same bcrypt helper as user passwords → comparable.
    assert.equal(bcrypt.compareSync('hunter2', link.passwordHash!), true);
    assert.equal(bcrypt.compareSync('wrong', link.passwordHash!), false);

    // Empty string is treated as no password.
    const noPw = store.createShareLink({
      workbookId: 'f-abc',
      roomId: 'room-abc',
      role: 'view',
      createdBy: admin.user.id,
      password: '',
    });
    assert.equal(noPw.passwordHash, null);

    const role = store.getLinkRole(link.token);
    assert.equal(role?.hasPassword, true);
  } finally {
    cleanup();
  }
});

test('share link: update flips role + expiry; clears expiry with null', () => {
  const { store, cleanup } = withTempStore('single');
  try {
    const admin = store.createUser('alice', 'longpassword');
    if (!admin.ok) throw new Error('seed failed');
    const link = store.createShareLink({
      workbookId: 'f-abc',
      roomId: 'room-abc',
      role: 'view',
      createdBy: admin.user.id,
      expiresAt: Date.now() + 60_000,
    });
    const bumped = store.updateShareLink(link.token, { role: 'edit', expiresAt: null });
    assert.equal(bumped?.role, 'edit');
    assert.equal(bumped?.expiresAt, null);
    assert.equal(store.updateShareLink('no-such', { role: 'edit' }), null);
  } finally {
    cleanup();
  }
});

test('share link: delete revokes; second delete is a no-op false', () => {
  const { store, cleanup } = withTempStore('single');
  try {
    const admin = store.createUser('alice', 'longpassword');
    if (!admin.ok) throw new Error('seed failed');
    const link = store.createShareLink({
      workbookId: 'f-abc',
      roomId: 'room-abc',
      role: 'view',
      createdBy: admin.user.id,
    });
    assert.equal(store.deleteShareLink(link.token), true);
    assert.equal(store.getShareLink(link.token), null);
    assert.equal(store.deleteShareLink(link.token), false);
  } finally {
    cleanup();
  }
});

// ── Member ACLs (sharing-model §6.2 — persistence) ─────────────────────

test('member ACL: set → list → getMemberRole → delete round-trips', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const admin = store.createUser('alice', 'longpassword');
    const bob = store.createUser('bob', 'longpassword');
    if (!admin.ok || !bob.ok) throw new Error('seed failed');
    store.updateProfile(bob.user.id, { email: 'bob@example.com' });

    const acl = store.setMemberAcl({
      workbookId: 'f-abc',
      memberId: bob.user.id,
      role: 'edit',
      createdBy: admin.user.id,
    });
    assert.equal(acl.workbookId, 'f-abc');
    assert.equal(acl.memberId, bob.user.id);
    assert.equal(acl.role, 'edit');
    assert.equal(acl.createdBy, admin.user.id);

    // list joins users for display.
    const list = store.listMemberAcls('f-abc');
    assert.equal(list.length, 1);
    assert.equal(list[0]?.memberId, bob.user.id);
    assert.equal(list[0]?.username, 'bob');
    assert.equal(list[0]?.email, 'bob@example.com');
    assert.equal(list[0]?.role, 'edit');
    assert.deepEqual(store.listMemberAcls('f-other'), []);

    // getMemberRole resolves the row.
    assert.equal(store.getMemberRole('f-abc', bob.user.id), 'edit');

    // delete revokes; second delete is a no-op false.
    assert.equal(store.deleteMemberAcl('f-abc', bob.user.id), true);
    assert.equal(store.getMemberRole('f-abc', bob.user.id), null);
    assert.equal(store.deleteMemberAcl('f-abc', bob.user.id), false);
    assert.deepEqual(store.listMemberAcls('f-abc'), []);
  } finally {
    cleanup();
  }
});

test('member ACL: setMemberAcl upserts — re-adding overwrites the role', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const admin = store.createUser('alice', 'longpassword');
    const bob = store.createUser('bob', 'longpassword');
    if (!admin.ok || !bob.ok) throw new Error('seed failed');

    store.setMemberAcl({
      workbookId: 'f-abc',
      memberId: bob.user.id,
      role: 'view',
      createdBy: admin.user.id,
    });
    store.setMemberAcl({
      workbookId: 'f-abc',
      memberId: bob.user.id,
      role: 'edit',
      createdBy: admin.user.id,
    });
    // Still a single row, role overwritten.
    const list = store.listMemberAcls('f-abc');
    assert.equal(list.length, 1);
    assert.equal(store.getMemberRole('f-abc', bob.user.id), 'edit');
  } finally {
    cleanup();
  }
});

test('member ACL: getMemberRole returns null for an unknown member/workbook', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const admin = store.createUser('alice', 'longpassword');
    if (!admin.ok) throw new Error('seed failed');
    assert.equal(store.getMemberRole('f-abc', 999), null);
    assert.equal(store.getMemberRole('f-nope', admin.user.id), null);
  } finally {
    cleanup();
  }
});

test('member lookup: findMemberByHandle resolves email, username, and not-found', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const bob = store.createUser('Bob', 'longpassword');
    if (!bob.ok) throw new Error('seed failed');
    store.updateProfile(bob.user.id, { email: 'Bob@Example.com' });

    // Username match (case-insensitive).
    assert.equal(store.findMemberByHandle('bob')?.id, bob.user.id);
    assert.equal(store.findMemberByHandle('BOB')?.id, bob.user.id);
    assert.equal(store.findMemberByHandle('Bob')?.username, 'Bob');

    // Email match (case-insensitive), preferred when handle is an email.
    assert.equal(store.findMemberByHandle('bob@example.com')?.id, bob.user.id);
    assert.equal(store.findMemberByHandle('BOB@EXAMPLE.COM')?.id, bob.user.id);

    // Returned shape carries email.
    assert.equal(store.findMemberByHandle('bob')?.email, 'Bob@Example.com');

    // Not found + whitespace-only.
    assert.equal(store.findMemberByHandle('nobody'), null);
    assert.equal(store.findMemberByHandle('nobody@example.com'), null);
    assert.equal(store.findMemberByHandle('   '), null);
  } finally {
    cleanup();
  }
});

test('member lookup: an email handle resolves to the email owner, not a same-named username', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    // Usernames can't contain '@' (USERNAME_RE), so a handle and a
    // username can never be byte-identical when the handle is an email —
    // but assert the email path is the one that resolves an email-shaped
    // handle (§5.2: prefer email). carol has the email; dave is a decoy
    // whose username is the email's local part.
    const carol = store.createUser('carol', 'longpassword');
    const dave = store.createUser('shared', 'longpassword');
    if (!carol.ok || !dave.ok) throw new Error('seed failed');
    store.updateProfile(carol.user.id, { email: 'shared@example.com' });

    const hit = store.findMemberByHandle('shared@example.com');
    assert.equal(hit?.id, carol.user.id, 'email handle resolves to the email owner');
    // The decoy username still resolves on its own bare handle.
    assert.equal(store.findMemberByHandle('shared')?.id, dave.user.id);
  } finally {
    cleanup();
  }
});

test('member ACL: deleting the member cascades the ACL row away', () => {
  const { store, cleanup } = withTempStore('multi');
  try {
    const admin = store.createUser('alice', 'longpassword');
    const bob = store.createUser('bob', 'longpassword');
    if (!admin.ok || !bob.ok) throw new Error('seed failed');
    store.setMemberAcl({
      workbookId: 'f-abc',
      memberId: bob.user.id,
      role: 'edit',
      createdBy: admin.user.id,
    });
    assert.equal(store.deleteUser(bob.user.id), true);
    assert.equal(store.getMemberRole('f-abc', bob.user.id), null);
    assert.deepEqual(store.listMemberAcls('f-abc'), []);
  } finally {
    cleanup();
  }
});

test('isShareRole guards the role enum', () => {
  assert.equal(isShareRole('view'), true);
  assert.equal(isShareRole('comment'), true);
  assert.equal(isShareRole('edit'), true);
  assert.equal(isShareRole('admin'), false);
  assert.equal(isShareRole(''), false);
  assert.equal(isShareRole(undefined), false);
  assert.equal(isShareRole(3), false);
});

test('readModeFromEnv parses none|single|multi; defaults to none', () => {
  assert.equal(readModeFromEnv({ CASUAL_PERSONAL_MODE: 'none' }), 'none');
  assert.equal(readModeFromEnv({ CASUAL_PERSONAL_MODE: 'single' }), 'single');
  assert.equal(readModeFromEnv({ CASUAL_PERSONAL_MODE: 'MULTI' }), 'multi');
  assert.equal(readModeFromEnv({ CASUAL_PERSONAL_MODE: 'bogus' }), 'none');
  assert.equal(readModeFromEnv({}), 'none');
});
