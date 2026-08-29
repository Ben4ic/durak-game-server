import crypto from "crypto";
import { newOnlineGame, startOnlineGame } from "../game/engine.js";
import { getStore } from "../storage/roomStore.js";

// ===== Room manager =====
//
// Every function here is async and goes through the store abstraction in
// storage/roomStore.js — never a raw Map, never Redis calls directly. That
// indirection is what makes "rooms survive a server restart" possible: set
// REDIS_URL and this exact same code persists rooms in Redis instead of
// process memory, with zero changes to callers (server.js just awaits
// these the same way either way).
//
// `room.game.players` is the ONLY list of players in a room (no separate
// `room.players` array) — a second, separately-maintained array was a real
// bug risk in an earlier version of this file.

const ROOM_CAPACITY = 2;

async function genCode(store) {
  let code;
  do {
    code = crypto.randomUUID().slice(0, 6).toUpperCase();
  } while (await store.getRoom(code));
  return code;
}

function makePlayer(username) {
  return { id: crypto.randomUUID(), username: (username || "Player").slice(0, 24) };
}

function players(room) {
  return room.game.players;
}

async function issueToken(store, code, playerId) {
  const token = crypto.randomUUID();
  await store.setToken(token, { code, playerId });
  return token;
}

export async function resolveToken(token) {
  if (!token) return null;
  const store = await getStore();
  const ref = await store.getToken(token);
  if (!ref) return null;
  const room = await store.getRoom(ref.code);
  if (!room) {
    // Room is gone (expired / deleted) but the token wasn't cleaned up —
    // don't hand back a dangling reference.
    await store.deleteToken(token);
    return null;
  }
  return { room, playerId: ref.playerId };
}

export function roomSummary(room) {
  const list = players(room);
  return {
    code: room.code,
    host: list[0]?.username || "Player",
    players: list.length,
    capacity: ROOM_CAPACITY,
    status: room.game.status,
    deckSize: room.game.deckSize,
  };
}

export async function listPublicRooms() {
  const store = await getStore();
  const codes = await store.listWaitingCodes();
  const rooms = await Promise.all(codes.map((code) => store.getRoom(code)));
  return rooms
    .filter((r) => r && r.game.status === "waiting" && players(r).length < ROOM_CAPACITY)
    .map(roomSummary);
}

export async function createRoom(username, options = {}) {
  const store = await getStore();
  const code = await genCode(store);
  const player = makePlayer(username);
  const room = { code, game: newOnlineGame(code, [player], options) };
  await store.saveRoom(room);
  const token = await issueToken(store, code, player.id);
  return { room, playerToken: token };
}

export async function joinRoom(code, username) {
  const store = await getStore();
  const player = makePlayer(username);
  const normalizedCode = (code || "").toUpperCase();

  // Routed through withRoom() so the "is there room for one more player"
  // check and the write-back happen atomically even when the store is
  // Redis (see roomStore.js — this is what stops two simultaneous joins
  // from both becoming "player #2" of the same room).
  const outcome = await store.withRoom(normalizedCode, async (room) => {
    if (!room) return { error: "ROOM_NOT_FOUND" };
    if (players(room).length >= ROOM_CAPACITY) return { error: "ROOM_FULL" };
    if (room.game.status !== "waiting") return { error: "ROOM_NOT_JOINABLE" };

    room.game.players.push(player);
    if (players(room).length === ROOM_CAPACITY) {
      room.game = startOnlineGame(room.game);
    }
    return { room };
  });

  if (outcome.error) throw new Error(outcome.error);

  const token = await issueToken(store, outcome.room.code, player.id);
  return { room: outcome.room, playerToken: token };
}

export async function quickJoin(username, options = {}) {
  const store = await getStore();
  const codes = await store.listWaitingCodes();
  for (const code of codes) {
    const room = await store.getRoom(code);
    if (room && room.game.status === "waiting" && players(room).length < ROOM_CAPACITY) {
      try {
        return await joinRoom(code, username);
      } catch (e) {
        // Someone else grabbed the last seat between our check and the
        // join attempt — try the next waiting room instead of failing.
        if (e.message !== "ROOM_FULL" && e.message !== "ROOM_NOT_JOINABLE") throw e;
        continue;
      }
    }
  }
  return createRoom(username, options);
}

// `token` is optional but should always be passed when the caller has it
// (server.js does, from the request header) so it can be revoked
// directly. leaveRoom isn't racy the way joinRoom is — at most 2 players
// can ever leave a room, and a rare concurrent double "leave" click just
// makes the second call a no-op, not a fairness bug — so this is a plain
// read-then-write rather than store.withRoom().
export async function leaveRoom(code, playerId, token) {
  const store = await getStore();
  if (token) await store.deleteToken(token);

  const normalizedCode = (code || "").toUpperCase();
  const room = await store.getRoom(normalizedCode);
  if (!room) return;

  const remaining = players(room).filter((p) => p.id !== playerId);

  if (remaining.length === 0) {
    await store.deleteRoom(normalizedCode);
    return;
  }

  if (room.game.status === "waiting") {
    room.game.players = remaining;
    await store.saveRoom(room);
    return;
  }

  if (room.game.status === "active") {
    const winner = remaining[0];
    room.game.status = "finished";
    room.game.winnerId = winner.id;
    room.game.message = `${winner.username} wins (opponent left)`;
    room.game.updatedAt = new Date().toISOString();
    room.game.revision = (room.game.revision || 0) + 1;
    await store.saveRoom(room);
  }
}

export async function getRoom(code) {
  const store = await getStore();
  const room = await store.getRoom((code || "").toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  return room;
}

export async function setGame(room, game) {
  const store = await getStore();
  room.game = game;
  await store.saveRoom(room);
}
