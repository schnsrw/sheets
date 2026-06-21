/**
 * Unit test for the deterministic personal-file room helpers
 * (`personalRoomId` / `workbookIdForRoom`). Both are PURE string
 * functions — the round-trip + the non-pf- null contract are the whole
 * surface, but they're security-load-bearing: `workbookIdForRoom` is how
 * the join gate reverses a `documentName` back to a workbook, and a
 * mistake (e.g. treating a random anonymous room as a pf- room) would
 * route an anonymous room through the member gate.
 *
 * Run with `pnpm test:unit`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { personalRoomId, workbookIdForRoom } from './personal-room.js';

test('personalRoomId prefixes the workbook id with pf-', () => {
  assert.equal(personalRoomId('f-abc123'), 'pf-f-abc123');
  assert.equal(personalRoomId('x'), 'pf-x');
});

test('round-trips: workbookIdForRoom(personalRoomId(id)) === id', () => {
  for (const id of ['f-abc123', 'f-0', 'f-deadbeef', 'weird-id-with-dashes']) {
    assert.equal(workbookIdForRoom(personalRoomId(id)), id, `round-trip failed for ${id}`);
  }
});

test('workbookIdForRoom returns null for a non-pf- (anonymous/random) room', () => {
  for (const room of ['room-xyz', 'abc123', 'p-not-pf', 'PF-uppercase', '']) {
    assert.equal(workbookIdForRoom(room), null, `expected null for ${JSON.stringify(room)}`);
  }
});

test('workbookIdForRoom returns null for a bare pf- with no workbook id', () => {
  // A bare prefix must NOT derive an empty workbook id — that would let
  // the gate ask "is userId owner of ''" / "member of ''".
  assert.equal(workbookIdForRoom('pf-'), null);
});

test('workbookIdForRoom preserves a workbook id that itself contains "pf-"', () => {
  // Only the FIRST prefix is stripped; the remainder is the literal id.
  assert.equal(workbookIdForRoom('pf-pf-x'), 'pf-x');
});
