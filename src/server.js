import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";

import {
  createRoom,
  joinRoom,
  quickJoin,
  leaveRoom,
  listPublicRooms,
  resolveToken,
  getRoom,
  setGame,
  roomSummary,
} from "./rooms/roomManager.js";
import { applyOnlineAction, publicOnlineState } from "./game/engine.js";
import { broadcastRoom, attachSocket } from "./websocket/socket.js";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ================= HEALTH / AUTH =================

app.get("/", (req, res) => {
  res.json({ status: "Durak Server Online", version: "2.0" });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: { id: "guest", username: "Player", guest: true } });
});

// ================= HELPERS =================

function requireAuth(req, res) {
  const token = req.headers["x-player-token"];
  const resolved = resolveToken(token);
  if (!resolved) {
    res.status(401).json({ error: "INVALID_TOKEN" });
    return null;
  }
  return resolved;
}

// A room in "waiting" state has no hand/trump yet: send the light shape the
// lobby polls, otherwise send the full per-player game view.
function roomOrGameView(room, playerId) {
  if (room.game.status === "waiting") {
    return { code: room.code, status: "waiting" };
  }
  return publicOnlineState(room.game, playerId);
}

// ================= LOBBY =================

app.get("/api/online/public", (req, res) => {
  res.json(listPublicRooms());
});

app.post("/api/online/create", (req, res) => {
  const { room, playerToken } = createRoom(req.body?.username);
  res.json({ room: roomSummary(room), playerToken });
  broadcastRoom(room);
});

app.post("/api/online/join", (req, res) => {
  try {
    const code = req.body?.code || req.body?.room;
    const { room, playerToken } = joinRoom(code, req.body?.username);
    res.json({ room: roomSummary(room), playerToken });
    broadcastRoom(room);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post("/api/online/quick", (req, res) => {
  const { room, playerToken } = quickJoin(req.body?.username);
  res.json({ room: roomSummary(room), playerToken });
  broadcastRoom(room);
});

app.post("/api/online/rejoin", (req, res) => {
  const resolved = requireAuth(req, res);
  if (!resolved) return;
  res.json(roomOrGameView(resolved.room, resolved.playerId));
});

app.post("/api/online/leave", (req, res) => {
  const token = req.headers["x-player-token"];
  const resolved = resolveToken(token);
  if (resolved) {
    leaveRoom(resolved.room.code, resolved.playerId);
    const stillThere = getRoomSafe(resolved.room.code);
    if (stillThere) broadcastRoom(stillThere);
  }
  res.json({ ok: true });
});

function getRoomSafe(code) {
  try {
    return getRoom(code);
  } catch {
    return null;
  }
}

// ================= ROOM STATE (polled every ~500ms by the client) =================

app.get("/api/online/room", (req, res) => {
  const resolved = requireAuth(req, res);
  if (!resolved) return;
  try {
    res.json(roomOrGameView(resolved.room, resolved.playerId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ================= GAME ACTION =================

app.post("/api/online/action", (req, res) => {
  const resolved = requireAuth(req, res);
  if (!resolved) return;
  const { room, playerId } = resolved;
  const { action, cardId } = req.body || {};
  try {
    const next = applyOnlineAction(room.game, playerId, action, cardId);
    setGame(room, next);
    broadcastRoom(room);
    res.json(publicOnlineState(next, playerId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ================= SERVER + WS (instant push, polling still works as fallback) =================

const server = createServer(app);
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => attachSocket(socket, { resolveToken }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Durak server v2 listening on :${PORT}`);
});
