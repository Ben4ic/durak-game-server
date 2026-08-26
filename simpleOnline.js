import crypto from "crypto";

const rooms = {};

function generateCode() {
  return crypto.randomUUID().slice(0, 6).toUpperCase();
}

export async function createSimpleRoom(username) {
  const id = generateCode();

  rooms[id] = {
    code: id,
    status: "waiting",
    players: [
      {
        id: crypto.randomUUID(),
        username: username || "Player"
      }
    ]
  };

  return {
    room: rooms[id],
    playerToken: rooms[id].players[0].id
  };
}


export async function joinSimpleRoom(code, username) {

  const room = rooms[code];

  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }

  room.players.push({
    id: crypto.randomUUID(),
    username: username || "Player"
  });

  room.status = "active";

  return {
    room,
    playerToken: room.players[1].id
  };
}


export async function quickSimpleRoom(username) {

  const waiting = Object.values(rooms)
    .find(r => r.status === "waiting");


  if (waiting) {

    waiting.players.push({
      id: crypto.randomUUID(),
      username: username || "Player"
    });

    waiting.status = "active";

    return {
      room: waiting,
      playerToken: waiting.players[1].id
    };
  }


  return createSimpleRoom(username);
}



export async function getSimpleRoom(code) {

  const room = rooms[code];

  if (!room) {
    throw new Error("ROOM_NOT_FOUND");
  }

  return room;
}



export async function listSimpleRooms() {

  return Object.values(rooms)
    .filter(r => r.status === "waiting")
    .map(r => ({
      code:r.code,
      host:r.players[0].username,
      players:r.players.length,
      capacity:2
    }));
}



export async function simpleAction() {

  return {
    ok:true
  };

}



export async function leaveSimpleRoom(code) {

  delete rooms[code];

  return {
    ok:true
  };

}
