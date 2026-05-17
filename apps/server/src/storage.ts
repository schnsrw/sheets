import type Redis from 'ioredis';

/**
 * Y.Doc persistence. Two implementations:
 *
 *   - `InMemoryStorage` (default) — rooms vanish on restart. Matches the
 *     v1 design doc's "in-memory only" stance.
 *   - `RedisStorage` — when REDIS_URL is set, snapshot every change into
 *     Redis as a single binary update blob keyed by room id. Survives
 *     restarts and gives us pub/sub headroom for horizontal scaling later.
 *
 * The interface deliberately stays small (load / save / delete) so swapping
 * in another backend (S3, Postgres bytea) is a single-file change.
 */

export interface DocStorage {
  /** Return the persisted Y.Doc update bytes for `roomId`, or null. */
  load(roomId: string): Promise<Uint8Array | null>;
  /** Persist the full Y.Doc update for `roomId`. Called debounced on change. */
  save(roomId: string, update: Uint8Array): Promise<void>;
  /** Remove the persisted snapshot (room GC, manual delete). */
  delete(roomId: string): Promise<void>;
  /** Close any underlying connections. */
  close(): Promise<void>;
}

export class InMemoryStorage implements DocStorage {
  private store = new Map<string, Uint8Array>();
  async load(roomId: string) {
    return this.store.get(roomId) ?? null;
  }
  async save(roomId: string, update: Uint8Array) {
    this.store.set(roomId, update);
  }
  async delete(roomId: string) {
    this.store.delete(roomId);
  }
  async close() {
    this.store.clear();
  }
}

const KEY_PREFIX = 'casual-sheets:room:';

export class RedisStorage implements DocStorage {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 60 * 60 * 24 * 7, // 7-day idle TTL
  ) {}

  async load(roomId: string): Promise<Uint8Array | null> {
    // Use Buffer-typed getter so we get the raw bytes, not a UTF-8 string.
    const buf = await this.redis.getBuffer(KEY_PREFIX + roomId);
    return buf ? new Uint8Array(buf) : null;
  }

  async save(roomId: string, update: Uint8Array): Promise<void> {
    await this.redis.set(
      KEY_PREFIX + roomId,
      Buffer.from(update),
      'EX',
      this.ttlSec,
    );
  }

  async delete(roomId: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + roomId);
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

/**
 * Pick the storage backend based on environment. Falls back to in-memory
 * if no REDIS_URL is set so `pnpm dev:server` works without Redis.
 */
export async function createStorage(): Promise<DocStorage> {
  const url = process.env.REDIS_URL;
  if (!url) return new InMemoryStorage();
  // Lazy import so the redis client only loads when actually used.
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(url, {
    // Don't crash the whole server if Redis is briefly unreachable —
    // log and retry. The bridge still works in-memory in the meantime.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  redis.on('error', (err) => console.warn('[redis]', err.message));
  return new RedisStorage(redis);
}
