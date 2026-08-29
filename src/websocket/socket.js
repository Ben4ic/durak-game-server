import { publicOnlineState } from "../game/engine.js";

// ===== Optional real-time layer =====
// The current frontend works purely by polling GET /api/online/room every
// ~500ms, so nothing here is required for the game to function. This exists
// so Stage 3 (real WebSocket sync) can be turned on later without touching
// the room/game code: a client connects, sends {type:"SUBSCRIBE", token},
// and from then on receives {type:"STATE_UPDATE", game:{...}} pushes
// whenever the room's game changes — instead of (or in addition to) polling.

const socketsByRoom = new Map(); // code -> Set<{socket, playerId}>

export function attachSocket(socket, { resolveToken }) {
  let sub = null;

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "SUBSCRIBE") {
      resolveToken(msg.token).then((resolved) => {
        if (!resolved) {
          socket.send(JSON.stringify({ type: "ERROR", error: "INVALID_TOKEN" }));
          return;
        }
        sub = { code: resolved.room.code, playerId: resolved.playerId };
        if (!socketsByRoom.has(sub.code)) socketsByRoom.set(sub.code, new Set());
        const entry = { socket, playerId: sub.playerId };
        socketsByRoom.get(sub.code).add(entry);
        sendState(resolved.room, sub.playerId, socket);

        socket.on("close", () => {
          socketsByRoom.get(sub.code)?.delete(entry);
        });
      });
    }
  });

  socket.send(JSON.stringify({ type: "CONNECTED" }));
}

function sendState(room, playerId, socket) {
  try {
    const payload =
      room.game.status === "waiting"
        ? { code: room.code, status: "waiting" }
        : publicOnlineState(room.game, playerId);
    socket.send(JSON.stringify({ type: "STATE_UPDATE", game: payload }));
  } catch {
    // player not (yet) part of the game view — ignore
  }
}

export function broadcastRoom(room) {
  const subs = socketsByRoom.get(room.code);
  if (!subs) return;
  for (const { socket, playerId } of subs) {
    if (socket.readyState === 1 /* OPEN */) sendState(room, playerId, socket);
  }
}
