/**
 * Deterministic personal-file room id (sharing-model §6.2 enforcement).
 *
 * Personal-file co-edit rooms use a deterministic id `pf-<workbookId>`.
 * This lets the join gate reverse a `documentName` back to its workbook
 * with NO mapping table — `workbookIdForRoom` just strips the prefix.
 *
 * Room-id guessability is deliberately FINE here: the deterministic id
 * is not a secret, because the join gate (`resolveMemberJoin`) enforces
 * access — knowing the room id grants nothing without a session that
 * owns / is a member of / is admin over the workbook (or a valid
 * `?share=` token bound to the room).
 *
 * Anonymous rooms keep their random ids (minted by `RoomRegistry`); a
 * non-`pf-` documentName returns null from `workbookIdForRoom`, and the
 * legacy anonymous path stays byte-identical for those.
 *
 * Kept PURE (no I/O) so both directions are trivially unit-testable.
 */

/** The single source of truth for the personal-room prefix. */
const PERSONAL_ROOM_PREFIX = 'pf-';

/** Build the deterministic room id for a personal file's co-edit room.
 *  `workbookId` is the file registry id (e.g. `f-abc123`); the room id
 *  is `pf-f-abc123`. */
export function personalRoomId(workbookId: string): string {
  return PERSONAL_ROOM_PREFIX + workbookId;
}

/** Reverse a `documentName` to its workbook id, or null when the room is
 *  NOT a personal-file room (i.e. an anonymous/random room). Returns null
 *  for a bare `pf-` with no workbook id so an empty workbook can never be
 *  derived. */
export function workbookIdForRoom(documentName: string): string | null {
  if (!documentName.startsWith(PERSONAL_ROOM_PREFIX)) return null;
  const workbookId = documentName.slice(PERSONAL_ROOM_PREFIX.length);
  return workbookId.length > 0 ? workbookId : null;
}
