import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();

console.log("SERVER ONLINE");

app.use(cors({
  origin: "*"
}));

app.use(express.json());


const rooms = {};



// HEALTH CHECK
app.get("/", (req,res)=>{
  res.json({
    status:"Durak Server Online"
  });
});




// PUBLIC ROOMS
app.get("/api/online/public",(req,res)=>{

  res.json(
    Object.values(rooms)
    .filter(r=>r.players.length < 2)
  );

});





// CREATE ROOM
app.post("/api/online/create",(req,res)=>{


  const roomId =
    crypto.randomUUID()
    .slice(0,6)
    .toUpperCase();


  const playerId =
    crypto.randomUUID();



  const playerToken =
    crypto.randomUUID();



  const room = {

    id: roomId,

    players:[
      {
        id:playerId,
        token:playerToken,
        name:req.body.name || "Player"
      }
    ],


    status:"waiting"

  };



  rooms[roomId]=room;



  res.json({

    room,

    playerToken

  });


});








// QUICK JOIN
app.post("/api/online/quick",(req,res)=>{


  let room =
    Object.values(rooms)
    .find(r=>r.players.length===1);



  const playerToken =
    crypto.randomUUID();



  if(!room){


    const roomId =
      crypto.randomUUID()
      .slice(0,6)
      .toUpperCase();



    room={

      id:roomId,

      players:[],

      status:"waiting"

    };


    rooms[roomId]=room;


  }



  room.players.push({

    id:crypto.randomUUID(),

    token:playerToken,

    name:req.body.name || "Player"

  });



  if(room.players.length===2){

    room.status="playing";

  }



  res.json({

    room,

    playerToken

  });


});








// JOIN BY CODE
app.post("/api/online/join",(req,res)=>{


 const room =
 rooms[req.body.roomId];



 if(!room){

  return res.status(404)
  .json({
    error:"ROOM_NOT_FOUND"
  });

 }



 const playerToken =
 crypto.randomUUID();



 room.players.push({

   id:crypto.randomUUID(),

   token:playerToken,

   name:req.body.name || "Player"

 });



 if(room.players.length===2){

   room.status="playing";

 }



 res.json({

   room,

   playerToken

 });


});








// ROOM INFO
app.get("/api/online/room/:id",(req,res)=>{


 const room =
 rooms[req.params.id];



 if(!room){

  return res.status(404)
  .json({
    error:"ROOM_NOT_FOUND"
  });

 }



 res.json(room);


});








const server =
app.listen(

 process.env.PORT || 3000,

 ()=>{

 console.log(
 "Durak server started"
 );

});







// WEBSOCKET

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


 socket.on(
 "message",
 msg=>{

 console.log(
 "WS:",
 msg.toString()
 );

 });


});
