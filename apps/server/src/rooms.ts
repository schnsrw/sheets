/**
 * In-memory room registry. v1 — single process, no DB, no persistence
 * across restarts. See docs/CO-EDITING.md §"Room lifecycle".
 */

import { createHash, timingSafeEqual } from 'node:crypto';

type RoomState = {
  id: string;
  /** Number of currently connected websocket clients. */
  clients: number;
  /** Wall-clock ms when client count last hit zero. -1 while connected. */
  idleSince: number;
  /** Optional initial snapshot (e.g. from xlsx upload) — Hocuspocus seeds
   *  the Y.Doc with this on first connect. */
  seed?: Uint8Array;
  /** Optional xlsx bytes representing the room's *starting workbook*.
   *  Joiners fetch this once at /api/rooms/:id/seed and import it locally
   *  before the bridge takes over for incremental edits. The op-log alone
   *  doesn't carry pre-existing cells — the owner's "Share current
   *  workbook" flow uploads here so peers see the same starting state. */
  xlsxSeed?: Uint8Array;
  /** Optional gzipped JSON snapshot (`IWorkbookData`) — server-side cache
   *  so joiners skip the multi-second xlsx parse on join. Same content
   *  as `xlsxSeed`, just in a form the client can apply via
   *  `replaceWorkbook` without re-running ExcelJS. Lives alongside the
   *  xlsx (not instead of it) so existing tooling that wants the .xlsx
   *  bytes still has them. */
  snapshotGz?: Uint8Array;
  /** ISO timestamp the room was created. */
  createdAt: string;
  /** SHA-256 hash of the room password, hex-encoded. `null` = open room. */
  passwordHash: string | null;
};

// Default TTL bumped from 5 → 60 min. The old default was short enough
// that a user closing a laptop for coffee came back to a blank sheet.
// Open / empty rooms still get cleaned up, but the window is now wide
// enough for normal-human breaks. Password-protected rooms and rooms
// with a seed / snapshot are kept indefinitely (see `isEvictable`).
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MIN ?? 60) * 60_000;
const GC_INTERVAL_MS = 30_000;

// Hard cap on concurrent rooms per process. Bounds memory under a
// "create rooms in a loop" abuse pattern: even with rate limit on
// /api/rooms, a script running for hours can accumulate thousands of
// rooms otherwise. When we'd exceed the cap, LRU-evict the oldest
// evictable (no password / no seed / no snapshot) room. If every
// slot is held by a non-evictable room, `create()` returns null and
// the HTTP layer maps that to 503.
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 256);

/** Thrown when create() can't free a slot because every room is
 *  non-evictable. Surfaces as 503 service_unavailable at the HTTP layer. */
export class RoomCapacityError extends Error {
  constructor(public readonly cap: number) {
    super(`room registry at capacity (${cap}); all slots non-evictable`);
    this.name = 'RoomCapacityError';
  }
}

export class RoomRegistry {
  private rooms = new Map<string, RoomState>();
  private gc: ReturnType<typeof setInterval> | null = null;
  /** Optional hook called when a room is evicted — used by the server
   *  to also drop the persisted Y.Doc from the storage backend so
   *  Redis doesn't keep stale blobs around for rooms the in-memory
   *  registry has forgotten. */
  private onEvict: ((roomId: string) => void) | null = null;

  start(onEvict?: (roomId: string) => void): void {
    if (this.gc) return;
    this.onEvict = onEvict ?? null;
    this.gc = setInterval(() => this.collect(), GC_INTERVAL_MS);
    this.gc.unref?.();
  }

  stop(): void {
    if (!this.gc) return;
    clearInterval(this.gc);
    this.gc = null;
    this.onEvict = null;
  }

  /**
   * Create a fresh room; returns its id.
   *
   * Enforces MAX_ROOMS by LRU-evicting the oldest *evictable* room
   * when at capacity. Throws RoomCapacityError if every slot is
   * non-evictable (password-protected / has seed / has snapshot) —
   * the HTTP layer maps that to 503.
   */
  create(opts: { password?: string; seed?: Uint8Array } = {}): string {
    if (this.rooms.size >= MAX_ROOMS) {
      const evicted = this.evictLeastRecent();
      if (!evicted) {
        throw new RoomCapacityError(MAX_ROOMS);
      }
    }
    const id = makeRoomId();
    this.rooms.set(id, {
      id,
      clients: 0,
      idleSince: Date.now(),
      seed: opts.seed,
      passwordHash: opts.password ? hashPassword(opts.password) : null,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  /**
   * Drop the oldest evictable room to free a slot. Returns the evicted
   * id, or null if no slot can be freed (every room is protected).
   * Used when create() is at the MAX_ROOMS cap. The same isEvictable()
   * predicate as the TTL collector ensures we never throw away a
   * password-protected room or one with uploaded content.
   */
  private evictLeastRecent(): string | null {
    let oldestId: string | null = null;
    let oldestIdleSince = Infinity;
    for (const [id, room] of this.rooms) {
      if (!this.isEvictable(room)) continue;
      // Treat live-client rooms as least preferred (idleSince === -1
      // wraps to Infinity-ish via the comparison) — but if EVERY
      // evictable room has live clients we still need to pick one to
      // keep create() working. Use a two-pass scheme: prefer idle
      // rooms first, fall back to live ones.
      if (room.idleSince > 0 && room.idleSince < oldestIdleSince) {
        oldestIdleSince = room.idleSince;
        oldestId = id;
      }
    }
    if (!oldestId) {
      // No idle-but-evictable room. Fall back to the oldest live room
      // (by createdAt) among evictable ones. This kills an active
      // session — not great, but better than refusing service entirely
      // because someone parked 256 throwaway open rooms.
      let oldestCreated = '9999-99-99';
      for (const [id, room] of this.rooms) {
        if (!this.isEvictable(room)) continue;
        if (room.createdAt < oldestCreated) {
          oldestCreated = room.createdAt;
          oldestId = id;
        }
      }
    }
    if (!oldestId) return null;
    this.rooms.delete(oldestId);
    this.onEvict?.(oldestId);
    return oldestId;
  }

  get(id: string): RoomState | undefined {
    return this.rooms.get(id);
  }

  /** Attach an xlsx-format starting workbook to a room. Returns false if
   *  the room doesn't exist. Idempotent — re-uploading replaces. */
  setXlsxSeed(id: string, bytes: Uint8Array): boolean {
    const room = this.rooms.get(id);
    if (!room) return false;
    room.xlsxSeed = bytes;
    return true;
  }

  /** Cache the gzipped JSON snapshot for fast-path joiner load. */
  setSnapshotGz(id: string, bytes: Uint8Array): boolean {
    const room = this.rooms.get(id);
    if (!room) return false;
    room.snapshotGz = bytes;
    return true;
  }

  /** Constant-time compare a user-supplied password against the room's hash. */
  passwordOk(id: string, candidate: string | undefined | null): boolean {
    const room = this.rooms.get(id);
    if (!room) return false;
    if (!room.passwordHash) return true; // open room
    if (!candidate) return false;
    const a = Buffer.from(hashPassword(candidate), 'hex');
    const b = Buffer.from(room.passwordHash, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Idempotently mark a client joining the room. */
  onConnect(id: string): RoomState {
    const room = this.rooms.get(id) ?? {
      id,
      clients: 0,
      idleSince: Date.now(),
      createdAt: new Date().toISOString(),
      passwordHash: null,
    };
    room.clients += 1;
    room.idleSince = -1;
    this.rooms.set(id, room);
    return room;
  }

  onDisconnect(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    room.clients = Math.max(0, room.clients - 1);
    if (room.clients === 0) room.idleSince = Date.now();
  }

  /** For diagnostics — returns a snapshot, not a live reference. */
  snapshot() {
    return Array.from(this.rooms.values()).map((r) => ({
      id: r.id,
      clients: r.clients,
      idleSince: r.idleSince,
      createdAt: r.createdAt,
      protected: r.passwordHash !== null,
    }));
  }

  /** Evict idle rooms — but only if they're "throwaway" rooms (no
   *  password, no uploaded seed/snapshot). Anything a user might
   *  reasonably come back to stays around indefinitely so a coffee-break
   *  reconnect doesn't return a blank grid. */
  private collect(): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.idleSince <= 0) continue; // still has live clients
      if (now - room.idleSince <= ROOM_TTL_MS) continue;
      if (!this.isEvictable(room)) continue;
      this.rooms.delete(id);
      this.onEvict?.(id);
    }
  }

  private isEvictable(room: RoomState): boolean {
    // Keep rooms with a password — losing the password would let the
    // next person to navigate to the URL silently take over the room id.
    if (room.passwordHash) return false;
    // Keep rooms with uploaded content. Someone shared this room with
    // a workbook; the persisted state (Y.Doc in Redis) is worth more
    // than the registry slot it occupies.
    if (room.xlsxSeed && room.xlsxSeed.byteLength > 0) return false;
    if (room.snapshotGz && room.snapshotGz.byteLength > 0) return false;
    return true;
  }
}

/** Short room ids that are easy to share in a URL but unguessable enough
 *  for anonymous sessions. Base36, 12 chars ≈ 60 bits of entropy. */
function makeRoomId(): string {
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += Math.floor(Math.random() * 36).toString(36);
  }
  return out;
}

/**
 * Hash a room password before storing. SHA-256 is enough — this is a
 * knowledge-of-secret gate, not an authentication-grade credential
 * (anonymous self-hosted v1 with no accounts). Salting would only help
 * if a memory dump and a rainbow-table attack were realistic threats;
 * neither is in scope.
 */
function hashPassword(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}
