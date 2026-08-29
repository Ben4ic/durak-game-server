// ===== Room store abstraction =====
//
// Two implementations behind one interface:
//   - MemoryStore: what roomManager.js used to do directly with a plain
//     Map. Used automatically when REDIS_URL isn't set, so nothing breaks
//     for a deployment that hasn't provisioned Redis yet — same behavior
//     as before (rooms live only as long as the process does).
//   - RedisStore: same interface, backed by Redis, so rooms/games survive
//     a server restart, redeploy, or crash instead of vanishing with the
//     process.
//
// roomManager.js only ever talks to this interface — it never touches Map
// or Redis directly. That's what makes swapping the backend safe, and
// what lets both implementations be exercised by the same tests.

const ROOM_TTL_SECONDS = 60 * 60; // 1h — matches the old in-memory sweep interval

function roomKey(code) {
  return `durak:room:${code}`;
}
function tokenKey(token) {
  return `durak:token:${token}`;
}
function roomTokensKey(code) {
  return `durak:room:${code}:tokens`;
}
const WAITING_SET_KEY = "durak:waiting";

class MemoryStore {
  constructor() {
    this.rooms = new Map();
    this.tokens = new Map();
    this.roomTokens = new Map(); // code -> Set<token>
    this.waiting = new Set();
    this.lastActivity = new Map(); // code -> timestamp
    setInterval(() => this._sweep(), 5 * 60 * 1000).unref?.();
  }

  _sweep() {
    const now = Date.now();
    for (const [code, ts] of this.lastActivity) {
      if (now - ts > ROOM_TTL_SECONDS * 1000) this.deleteRoom(code);
    }
  }

  async getRoom(code) {
    return this.rooms.get(code) || null;
  }

  async saveRoom(room) {
    this.rooms.set(room.code, room);
    this.lastActivity.set(room.code, Date.now());
    if (room.game.status === "waiting") this.waiting.add(room.code);
    else this.waiting.delete(room.code);
  }

  async deleteRoom(code) {
    this.rooms.delete(code);
    this.waiting.delete(code);
    this.lastActivity.delete(code);
    const tokens = this.roomTokens.get(code);
    if (tokens) {
      for (const t of tokens) this.tokens.delete(t);
      this.roomTokens.delete(code);
    }
  }

  async listWaitingCodes() {
    return [...this.waiting];
  }

  async getToken(token) {
    return this.tokens.get(token) || null;
  }

  async setToken(token, ref) {
    this.tokens.set(token, ref);
    if (!this.roomTokens.has(ref.code)) this.roomTokens.set(ref.code, new Set());
    this.roomTokens.get(ref.code).add(token);
  }

  async deleteToken(token) {
    const ref = this.tokens.get(token);
    this.tokens.delete(token);
    if (ref) this.roomTokens.get(ref.code)?.delete(token);
  }

  // Single-process Node has no await between reading `current` and writing
  // the result back, so this is already atomic — no retry loop needed here
  // the way the Redis version below requires (that one has a real network
  // round-trip in between, which opens a genuine race window).
  async withRoom(code, mutate) {
    const current = this.rooms.get(code) || null;
    const result = await mutate(current);
    if (result?.room) await this.saveRoom(result.room);
    return result;
  }
}

export class RedisStore {
  constructor(redis) {
    this.redis = redis;
  }

  async getRoom(code) {
    const raw = await this.redis.get(roomKey(code));
    return raw ? JSON.parse(raw) : null;
  }

  async saveRoom(room) {
    const multi = this.redis.multi();
    multi.set(roomKey(room.code), JSON.stringify(room), "EX", ROOM_TTL_SECONDS);
    if (room.game.status === "waiting") multi.sadd(WAITING_SET_KEY, room.code);
    else multi.srem(WAITING_SET_KEY, room.code);
    await multi.exec();
  }

  async deleteRoom(code) {
    const tokens = await this.redis.smembers(roomTokensKey(code));
    const multi = this.redis.multi();
    multi.del(roomKey(code));
    multi.srem(WAITING_SET_KEY, code);
    multi.del(roomTokensKey(code));
    for (const t of tokens) multi.del(tokenKey(t));
    await multi.exec();
  }

  async listWaitingCodes() {
    // A code can briefly linger here after its room key expires via Redis
    // TTL (set membership doesn't cascade-expire). roomManager already
    // treats a missing getRoom() result as "skip it", which self-heals
    // this on the next listPublicRooms() call.
    return this.redis.smembers(WAITING_SET_KEY);
  }

  async getToken(token) {
    const raw = await this.redis.get(tokenKey(token));
    return raw ? JSON.parse(raw) : null;
  }

  async setToken(token, ref) {
    const multi = this.redis.multi();
    multi.set(tokenKey(token), JSON.stringify(ref), "EX", ROOM_TTL_SECONDS);
    multi.sadd(roomTokensKey(ref.code), token);
    multi.expire(roomTokensKey(ref.code), ROOM_TTL_SECONDS);
    await multi.exec();
  }

  async deleteToken(token) {
    const raw = await this.redis.get(tokenKey(token));
    const ref = raw ? JSON.parse(raw) : null;
    const multi = this.redis.multi();
    multi.del(tokenKey(token));
    if (ref) multi.srem(roomTokensKey(ref.code), token);
    await multi.exec();
  }

  // Optimistic concurrency control: WATCH the room key, read it, let the
  // caller compute what the new value should be, then try to commit with
  // MULTI/EXEC. If another request modified the room in between (EXEC
  // returns null), retry. This is what stops two simultaneous joinRoom
  // calls from both seeing "1 player" and both adding themselves as
  // player #2 — a real correctness bug, not just a cosmetic one, since it
  // would silently break the "exactly 2 players" invariant the whole
  // engine relies on.
  async withRoom(code, mutate, attempts = 5) {
    for (let i = 0; i < attempts; i++) {
      await this.redis.watch(roomKey(code));
      const raw = await this.redis.get(roomKey(code));
      const current = raw ? JSON.parse(raw) : null;
      const result = await mutate(current);

      if (!result?.room) {
        await this.redis.unwatch();
        return result;
      }

      const multi = this.redis.multi();
      multi.set(roomKey(result.room.code), JSON.stringify(result.room), "EX", ROOM_TTL_SECONDS);
      if (result.room.game.status === "waiting") multi.sadd(WAITING_SET_KEY, result.room.code);
      else multi.srem(WAITING_SET_KEY, result.room.code);
      const execResult = await multi.exec();

      if (execResult !== null) return result; // committed successfully
      // else: the key changed under us between WATCH and EXEC — retry
    }
    throw new Error("ROOM_UPDATE_CONFLICT");
  }
}

let storePromise = null;

export function getStore() {
  if (storePromise) return storePromise;

  storePromise = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) {
      console.log(
        "[storage] REDIS_URL not set — using in-memory room store (rooms will NOT survive a restart). " +
          "Set REDIS_URL to persist rooms across deploys/restarts."
      );
      return new MemoryStore();
    }
    try {
      const { default: Redis } = await import("ioredis");
      const redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
      await redis.ping();
      console.log("[storage] connected to Redis — rooms will survive restarts");
      redis.on("error", (err) => console.error("[storage] Redis error:", err.message));
      return new RedisStore(redis);
    } catch (err) {
      console.error(
        "[storage] failed to connect to Redis, falling back to in-memory store:",
        err.message
      );
      return new MemoryStore();
    }
  })();

  return storePromise;
}

// Test-only escape hatch: reset the singleton so a fresh MemoryStore/mock
// can be installed between test cases.
export function _resetStoreForTests(store) {
  storePromise = store ? Promise.resolve(store) : null;
}
