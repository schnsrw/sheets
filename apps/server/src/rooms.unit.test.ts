/**
 * Tests for the room cap + LRU eviction behaviour added by Stream C2
 * of the production-readiness pipeline. The registry is in-memory so
 * these run without standing up a Fastify instance — pure state.
 *
 * Run with: `pnpm test:unit`
 */
import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, test } from 'node:test';

let RoomRegistry: typeof import('./rooms.js').RoomRegistry;
let RoomCapacityError: typeof import('./rooms.js').RoomCapacityError;

beforeEach(async () => {
  // The cap is read from process.env at module-load time, so set it
  // BEFORE the dynamic import. Reset module cache so each test sees a
  // fresh registry class bound to the current env.
  process.env.MAX_ROOMS = '3';
  const mod = await import(`./rooms.js?ts=${Date.now()}`);
  RoomRegistry = mod.RoomRegistry;
  RoomCapacityError = mod.RoomCapacityError;
});

afterEach(() => {
  delete process.env.MAX_ROOMS;
});

test('create() succeeds under cap', () => {
  const reg = new RoomRegistry();
  const a = reg.create();
  const b = reg.create();
  assert.ok(a);
  assert.ok(b);
  assert.equal(reg.snapshot().length, 2);
});

test('create() at cap evicts the oldest IDLE evictable room', async () => {
  const reg = new RoomRegistry();
  const a = reg.create(); // idle from t=0
  await new Promise((r) => setTimeout(r, 5));
  const b = reg.create(); // idle from t=5
  await new Promise((r) => setTimeout(r, 5));
  const c = reg.create(); // idle from t=10
  assert.equal(reg.snapshot().length, 3);
  // Cap is 3; a fourth create() should evict `a` (the oldest idle).
  const d = reg.create();
  assert.ok(d);
  const ids = reg.snapshot().map((r) => r.id);
  assert.equal(ids.length, 3);
  assert.ok(!ids.includes(a), 'oldest idle room should have been evicted');
  assert.ok(ids.includes(b));
  assert.ok(ids.includes(c));
  assert.ok(ids.includes(d));
});

test('create() at cap with ALL rooms non-evictable throws RoomCapacityError', () => {
  const reg = new RoomRegistry();
  // Fill the cap with password-protected (non-evictable) rooms.
  reg.create({ password: 'a' });
  reg.create({ password: 'b' });
  reg.create({ password: 'c' });
  assert.throws(() => reg.create(), RoomCapacityError);
});

test('create() at cap evicts even when only LIVE evictable rooms exist (fallback)', () => {
  const reg = new RoomRegistry();
  const a = reg.create();
  const b = reg.create();
  const c = reg.create();
  // Mark every room as live — no idle eviction candidate exists.
  reg.onConnect(a);
  reg.onConnect(b);
  reg.onConnect(c);
  // The fallback uses createdAt — `a` was created first, so it
  // should get killed. Better to disrupt one live session than refuse
  // service to a fresh user.
  const d = reg.create();
  assert.ok(d);
  const ids = reg.snapshot().map((r) => r.id);
  assert.ok(!ids.includes(a), 'oldest live evictable room should be evicted');
  assert.ok(ids.includes(d));
});

test('eviction calls the onEvict hook (so persisted Y.Doc bytes get cleaned up)', () => {
  const evicted: string[] = [];
  const reg = new RoomRegistry();
  reg.start((id) => evicted.push(id));
  try {
    const a = reg.create();
    reg.create();
    reg.create();
    reg.create(); // triggers eviction of `a`
    assert.deepEqual(evicted, [a]);
  } finally {
    reg.stop();
  }
});

test('password-protected room survives eviction even when idle longest', () => {
  const reg = new RoomRegistry();
  const protectedRoom = reg.create({ password: 'secret' }); // protected, idle
  const open1 = reg.create();
  const open2 = reg.create();
  reg.create(); // triggers eviction
  const ids = reg.snapshot().map((r) => r.id);
  assert.ok(
    ids.includes(protectedRoom),
    'protected room should survive even though it has the oldest idleSince',
  );
  assert.ok(
    !ids.includes(open1),
    'oldest UN-protected room should be the eviction target instead',
  );
  assert.ok(ids.includes(open2));
});
