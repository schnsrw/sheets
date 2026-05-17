/**
 * In-memory room registry. v1 — single process, no DB, no persistence
 * across restarts. See docs/CO-EDITING.md §"Room lifecycle".
 */

type RoomState = {
  id: string;
  /** Number of currently connected websocket clients. */
  clients: number;
  /** Wall-clock ms when client count last hit zero. -1 while connected. */
  idleSince: number;
  /** Optional initial snapshot (e.g. from xlsx upload) — Hocuspocus seeds
   *  the Y.Doc with this on first connect. */
  seed?: Uint8Array;
  /** ISO timestamp the room was created. */
  createdAt: string;
};

const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MIN ?? 5) * 60_000;
const GC_INTERVAL_MS = 30_000;

export class RoomRegistry {
  private rooms = new Map<string, RoomState>();
  private gc: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.gc) return;
    this.gc = setInterval(() => this.collect(), GC_INTERVAL_MS);
    this.gc.unref?.();
  }

  stop(): void {
    if (!this.gc) return;
    clearInterval(this.gc);
    this.gc = null;
  }

  /** Create a fresh room; returns its id. */
  create(seed?: Uint8Array): string {
    const id = makeRoomId();
    this.rooms.set(id, {
      id,
      clients: 0,
      idleSince: Date.now(),
      seed,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  get(id: string): RoomState | undefined {
    return this.rooms.get(id);
  }

  /** Idempotently mark a client joining the room. */
  onConnect(id: string): RoomState {
    const room = this.rooms.get(id) ?? {
      id,
      clients: 0,
      idleSince: Date.now(),
      createdAt: new Date().toISOString(),
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
    }));
  }

  /** Evict rooms idle longer than ROOM_TTL_MS. */
  private collect(): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.idleSince > 0 && now - room.idleSince > ROOM_TTL_MS) {
        this.rooms.delete(id);
      }
    }
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
