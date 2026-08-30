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
import { applyOnlineAction, publicOnlineState, normalizeDeckSize } from "./game/engine.js";
import { broadcastRoom, attachSocket } from "./websocket/socket.js";
import { verifyFromAuthHeader, TelegramAuthError } from "./auth/telegram.js";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Log every request + its outcome. This used to be missing entirely for
// some routes, which is exactly how a silent failure (e.g. an empty {}
// response instead of a real error) became invisible in the logs.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Safety net: if anything anywhere throws outside of a route's own
// try/catch, log it loudly instead of letting it fail silently or crash
// the whole process.
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// ================= HEALTH / AUTH =================

app.get("/", (req, res) => {
  res.json({ status: "Durak Server Online", version: "2.0" });
});

app.get("/api/auth/me", (req, res) => {
  // If the request carries a signed Telegram Mini App identity
  // (Authorization: tma <initData>), verify it and return the real
  // Telegram user. Otherwise fall back to the same anonymous-guest shape
  // the frontend already expects — nothing breaks for a client that
  // doesn't send this header yet.
  try {
    const identity = verifyFromAuthHeader(req.headers["authorization"], process.env.TELEGRAM_BOT_TOKEN);
    if (identity) {
      return res.json({
        user: {
          id: identity.telegramId,
          username: identity.username,
          firstName: identity.firstName,
          lastName: identity.lastName,
          photoUrl: identity.photoUrl,
          guest: false,
        },
      });
    }
  } catch (e) {
    if (e instanceof TelegramAuthError) {
      return res.status(401).json({ error: e.message });
    }
    throw e;
  }
  res.json({ user: { id: "guest", username: "Player", guest: true } });
});

// ================= HELPERS =================

// Room lookups now go through the store (in-memory or Redis — see
// storage/roomStore.js), which is why every route handler below is async
// and awaits these.
async function requireAuth(req, res) {
  const token = req.headers["x-player-token"];
  const resolved = await resolveToken(token);
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

async function getRoomSafe(code) {
  try {
    return await getRoom(code);
  } catch {
    return null;
  }
}

// Centralized error -> HTTP status mapping so every route responds
// consistently instead of each handler guessing a status code.
const ERROR_STATUS = {
  INVALID_TOKEN: 401,
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  ROOM_NOT_JOINABLE: 409,
  GAME_NOT_ACTIVE: 409,
  NOT_IN_GAME: 403,
  UNKNOWN_ACTION: 400,
};

function sendError(res, err) {
  console.error("[error]", err);
  const status = ERROR_STATUS[err.message] || 400;
  res.status(status).json({ error: err.message });
}

// ================= LOBBY =================

app.get("/api/online/public", async (req, res) => {
  try {
    res.json(await listPublicRooms());
  } catch (e) {
    sendError(res, e);
  }
});

app.post("/api/online/create", async (req, res) => {
  try {
    const deckSize = normalizeDeckSize(req.body?.deckSize);
    const { room, playerToken } = await createRoom(req.body?.username, { deckSize });
    res.json({ room: roomSummary(room), playerToken });
    broadcastRoom(room);
  } catch (e) {
    sendError(res, e);
  }
});

app.post("/api/online/join", async (req, res) => {
  try {
    const code = req.body?.code || req.body?.room;
    const { room, playerToken } = await joinRoom(code, req.body?.username);
    res.json({ room: roomSummary(room), playerToken });
    broadcastRoom(room);
  } catch (e) {
    sendError(res, e);
  }
});

app.post("/api/online/quick", async (req, res) => {
  try {
    const deckSize = normalizeDeckSize(req.body?.deckSize);
    const { room, playerToken } = await quickJoin(req.body?.username, { deckSize });
    res.json({ room: roomSummary(room), playerToken });
    broadcastRoom(room);
  } catch (e) {
    sendError(res, e);
  }
});

app.post("/api/online/rejoin", async (req, res) => {
  const resolved = await requireAuth(req, res);
  if (!resolved) return;
  try {
    res.json(roomOrGameView(resolved.room, resolved.playerId));
  } catch (e) {
    sendError(res, e);
  }
});

app.post("/api/online/leave", async (req, res) => {
  try {
    const token = req.headers["x-player-token"];
    const resolved = await resolveToken(token);
    if (resolved) {
      await leaveRoom(resolved.room.code, resolved.playerId, token);
      const stillThere = await getRoomSafe(resolved.room.code);
      if (stillThere) broadcastRoom(stillThere);
    }
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e);
  }
});

// ================= ROOM STATE (polled every ~500ms by the client) =================

app.get("/api/online/room", async (req, res) => {
  const resolved = await requireAuth(req, res);
  if (!resolved) return;
  try {
    res.json(roomOrGameView(resolved.room, resolved.playerId));
  } catch (e) {
    sendError(res, e);
  }
});

// ================= GAME ACTION =================

app.post("/api/online/action", async (req, res) => {
  const resolved = await requireAuth(req, res);
  if (!resolved) return;
  const { room, playerId } = resolved;
  const { action, cardId } = req.body || {};
  try {
    const next = applyOnlineAction(room.game, playerId, action, cardId);
    await setGame(room, next);
    broadcastRoom(room);
    res.json(publicOnlineState(next, playerId));
  } catch (e) {
    sendError(res, e);
  }
});

// ================= SERVER + WS (instant push, polling still works as fallback) =================

// Belt-and-suspenders: catches anything that somehow still slips past every
// route's own try/catch, so the client always gets JSON back instead of a
// mysterious empty body or a raw HTML error page.
app.use((err, req, res, next) => {
  console.error("[unhandled route error]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "INTERNAL_ERROR" });
});

const server = createServer(app);
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => attachSocket(socket, { resolveToken }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Durak server v2 listening on :${PORT}`);
});
