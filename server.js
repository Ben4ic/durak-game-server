import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";


const app = express();

app.use(cors({
  origin: "*"
}));

app.use(express.json());
// AUTH MOCK
app.get("/api/auth/me",(req,res)=>{

  res.json({

    id:"guest",

    username:"Player",

    guest:true

  });

});


console.log("SERVER ONLINE");


// Временное хранилище комнат
const rooms = {};



// =====================
// HEALTH
// =====================

app.get("/", (req,res)=>{

  res.json({
    status:"Durak Server Online"
  });

});




// =====================
// PUBLIC ROOMS
// =====================

app.get("/api/online/public",(req,res)=>{

  res.json(
    Object.values(rooms)
    .filter(room =>
      room.status === "waiting"
    )
  );

});




// =====================
// CREATE ROOM
// =====================

app.post("/api/online/create",(req,res)=>{


  const code =
    crypto.randomUUID()
    .slice(0,6)
    .toUpperCase();



  const playerToken =
    crypto.randomUUID();



  const player = {

    id:
      crypto.randomUUID(),

    username:
      req.body.username || "Player"

  };



  const room = {

    code,

    status:"waiting",

    players:[
      player
    ],

    tokens:{
      [playerToken]: player.id
    }

  };



  rooms[code] = room;



  res.json({

    room,

    playerToken

  });


});






// =====================
// JOIN ROOM
// =====================

app.post("/api/online/join",(req,res)=>{


  const code =
    req.body.code ||
    req.body.room;



  const room =
    rooms[code];



  if(!room){

    return res.status(404)
    .json({

      error:"ROOM_NOT_FOUND"

    });

  }



  const playerToken =
    crypto.randomUUID();



  room.players.push({

    id:
      crypto.randomUUID(),

    username:
      req.body.username || "Player"

  });



  room.tokens[playerToken] =
    room.players[1].id;



  if(room.players.length >= 2){

    room.status="playing";

  }



  res.json({

    room,

    playerToken

  });


});







// =====================
// QUICK JOIN
// =====================

app.post("/api/online/quick",(req,res)=>{


  let room =
    Object.values(rooms)
    .find(r =>
      r.players.length === 1
    );



  if(!room){

    return createRoom(req,res);

  }



  const playerToken =
    crypto.randomUUID();



  room.players.push({

    id:
      crypto.randomUUID(),

    username:
      req.body.username || "Player"

  });



  room.status="playing";



  res.json({

    room,

    playerToken

  });


});






function createRoom(req,res){


 const code =
    crypto.randomUUID()
    .slice(0,6)
    .toUpperCase();



 const playerToken =
    crypto.randomUUID();



 const room = {

    code,

    status:"waiting",

    players:[{

      id:
      crypto.randomUUID(),

      username:
      req.body.username || "Player"

    }],

    tokens:{
      [playerToken]:true
    }

 };



 rooms[code]=room;



 res.json({

    room,

    playerToken

 });

}







// =====================
// GET ROOM
// =====================

app.get("/api/online/room",(req,res)=>{


 const code =
    req.query.code ||
    req.query.room;



 const room =
    rooms[code];



 if(!room){

    return res.status(404)
    .json({

      error:"ROOM_NOT_FOUND"

    });

 }



 res.json(room);


});








// =====================
// LEAVE
// =====================

app.post("/api/online/leave",(req,res)=>{


 const code =
    req.body.code ||
    req.body.room;



 delete rooms[code];


 res.json({

   ok:true

 });


});








// =====================
// ACTION
// =====================

app.post("/api/online/action",(req,res)=>{


 res.json({

   ok:true

 });


});







// =====================
// SERVER
// =====================

const server =
app.listen(

 process.env.PORT || 3000,

 ()=>{

 console.log(
 "Durak server started"
 );

}

);







// =====================
// WEBSOCKET
// =====================

const wss =
new WebSocketServer({
 server
});


wss.on(
"connection",
socket=>{


 console.log(
 "WS connected"
 );


 socket.send(
 JSON.stringify({

 type:"connected"

 })
 );


});
