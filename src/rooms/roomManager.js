import crypto from "crypto";
import { newOnlineGame, startOnlineGame } from "../game/engine.js";

// ===== In-memory room store =====
// NOTE: this is a single Map living in ONE Node process. That is enough to
// fix the "phone vs phone" bug (both clients now always hit the same
// process + same store), as long as the server runs as a single instance
// with no auto-restart/sleep wiping memory mid-game. Swapping this for
// Redis later (see storage/redis.js) is a drop-in replacement — every
// function below is already async so the call sites won't need to change.

const rooms = new Map(); // code -> Room
const tokenIndex = new Map(); // token -> { code, playerId }

const ROOM_CAPACITY = 2;
const ROOM_TTL_MS = 1000 * 60 * 60; // 1h safety cleanup for abandoned rooms

function genCode() {
  let code;
  do {
    code = crypto.randomUUID().slice(0, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function makePlayer(username) {
  return { id: crypto.randomUUID(), username: (username || "Player").slice(0, 24) };
}

function issueToken(code, playerId) {
  const token = crypto.randomUUID();
  tokenIndex.set(token, { code, playerId });
  return token;
}

function touch(room) {
  room.lastActivity = Date.now();
  return room;
}

function sweep() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      for (const [token, ref] of tokenIndex) {
        if (ref.code === code) tokenIndex.delete(token);
      }
      rooms.delete(code);
    }
  }
}
setInterval(sweep, 5 * 60 * 1000).unref?.();

export function resolveToken(token) {
  const ref = token && tokenIndex.get(token);
  if (!ref) return null;
  const room = rooms.get(ref.code);
  if (!room) return null;
  return { room, playerId: ref.playerId };
}

export function roomSummary(room) {
  return {
    code: room.code,
    host: room.players[0]?.username || "Player",
    players: room.players.length,
    capacity: ROOM_CAPACITY,
    status: room.game.status,
  };
}

export function listPublicRooms() {
  return Array.from(rooms.values())
    .filter((r) => r.game.status === "waiting" && r.players.length < ROOM_CAPACITY)
    .map(roomSummary);
}

export function createRoom(username) {
  const code = genCode();
  const player = makePlayer(username);
  const room = touch({
    code,
    players: [player],
    game: newOnlineGame(code, [player]),
  });
  rooms.set(code, room);
  const token = issueToken(code, player.id);
  return { room, playerToken: token };
}

export function joinRoom(code, username) {
  const room = rooms.get((code || "").toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  if (room.players.length >= ROOM_CAPACITY) throw new Error("ROOM_FULL");
  if (room.game.status !== "waiting") throw new Error("ROOM_NOT_JOINABLE");

  const player = makePlayer(username);
  room.players.push(player);
  room.game.players.push(player);

  if (room.players.length === ROOM_CAPACITY) {
    room.game = startOnlineGame(room.game);
  }
  touch(room);

  const token = issueToken(code, player.id);
  return { room, playerToken: token };
}

export function quickJoin(username) {
  const waiting = Array.from(rooms.values()).find(
    (r) => r.game.status === "waiting" && r.players.length < ROOM_CAPACITY
  );
  if (waiting) return joinRoom(waiting.code, username);
  return createRoom(username);
}

export function leaveRoom(code, playerId) {
  const room = rooms.get((code || "").toUpperCase());
  if (!room) return;
  room.players = room.players.filter((p) => p.id !== playerId);
  for (const [token, ref] of tokenIndex) {
    if (ref.code === room.code && ref.playerId === playerId) tokenIndex.delete(token);
  }
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  // Opponent left mid-game: end the game rather than leave it stuck.
  if (room.game.status === "active") {
    const remaining = room.players[0];
    room.game.status = "finished";
    room.game.winnerId = remaining.id;
    room.game.message = `${remaining.username} wins (opponent left)`;
    room.game.updatedAt = new Date().toISOString();
    room.game.revision = (room.game.revision || 0) + 1;
  }
  touch(room);
}

export function getRoom(code) {
  const room = rooms.get((code || "").toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  return room;
}

export function setGame(room, game) {
  room.game = game;
  touch(room);
}
