import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";


const app = express();

console.log("SERVER 7490 LOADED");


app.use(cors({
  origin: "*"
}));

app.use(express.json());


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


  const result =
    Object.values(rooms)
    .filter(
      room =>
      room.status === "waiting"
    )
    .map(room=>({

      code: room.code,

      host:
        room.players[0]?.username || "Player",

      players:
        room.players.length,

      capacity:2

    }));


  res.json(result);


});







// =====================
// CREATE ROOM
// =====================

app.post("/api/online/create",(req,res)=>{


  const code =
    crypto.randomUUID()
    .slice(0,6)
    .toUpperCase();



  const playerId =
    crypto.randomUUID();


  const token =
    crypto.randomUUID();



  const room = {


    code,


    status:"waiting",


    players:[

      {

        id:playerId,

        username:
          req.body.username || "Player"

      }

    ],


    tokens:{

      [token]:playerId

    },


    createdAt:
      new Date().toISOString()


  };



  rooms[code]=room;



  res.json({

    room,

    playerToken:token

  });


});









// =====================
// QUICK MATCH
// =====================

app.post("/api/online/quick",(req,res)=>{


  let room =
    Object.values(rooms)
    .find(
      r =>
      r.status==="waiting"
      &&
      r.players.length===1
    );



  const token =
    crypto.randomUUID();



  const player = {

    id:
      crypto.randomUUID(),

    username:
      req.body.username || "Player"

  };



  if(!room){


    const code =
      crypto.randomUUID()
      .slice(0,6)
      .toUpperCase();



    room={

      code,

      status:"waiting",

      players:[
        player
      ],

      tokens:{
        [token]:player.id
      }

    };


    rooms[code]=room;


  }
  else{


    room.players.push(player);


    room.tokens[token]=player.id;


    room.status="active";


  }



  res.json({

    room,

    playerToken:token

  });


});










// =====================
// JOIN ROOM
// =====================

app.post("/api/online/join",(req,res)=>{


  const code =
    req.body.code;


  const room =
    rooms[code];



  if(!room){

    return res.status(404)
    .json({

      error:"ROOM_NOT_FOUND"

    });

  }



  const token =
    crypto.randomUUID();



  const player={


    id:
      crypto.randomUUID(),


    username:
      req.body.username || "Player"


  };



  room.players.push(player);


  room.tokens[token]=player.id;


  if(room.players.length===2){

    room.status="active";

  }



  res.json({

    room,

    playerToken:token

  });


});









// =====================
// GET ROOM
// =====================

app.get("/api/online/room",(req,res)=>{


  const code =
    req.query.code;



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
// ACTION
// =====================

app.post("/api/online/action",(req,res)=>{


  res.json({

    ok:true,

    message:"Action received"

  });


});








// =====================
// LEAVE
// =====================

app.post("/api/online/leave",(req,res)=>{


  const code =
    req.body.code;


  delete rooms[code];


  res.json({

    ok:true

  });


});









// =====================
// START
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
