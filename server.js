import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();

app.use(cors({
  origin: "*"
}));

app.use(express.json());


console.log("SERVER ONLINE");


const rooms = {};


// ================= AUTH =================

app.get("/api/auth/me",(req,res)=>{

 res.json({
  id:"guest",
  username:"Player",
  guest:true
 });

});



// ================= HEALTH =================

app.get("/",(req,res)=>{

 res.json({
  status:"Durak Server Online"
 });

});



// ================= PUBLIC =================

app.get("/api/online/public",(req,res)=>{

 res.json(
  Object.values(rooms)
  .filter(r=>r.status==="waiting")
 );

});




// ================= CREATE =================

app.post("/api/online/create",(req,res)=>{


 const code =
 crypto.randomUUID()
 .slice(0,6)
 .toUpperCase();



 const player = {

  id:crypto.randomUUID(),

  username:
  req.body.username || "Player"

 };


 const token =
 crypto.randomUUID();



 const room = {

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



 res.json({

  room,

  playerToken:token

 });


});






// ================= JOIN =================

app.post("/api/online/join",(req,res)=>{


 const code =
 req.body.code ||
 req.body.room;



 const room =
 rooms[code];



 if(!room){

  return res.status(404).json({

   error:"ROOM_NOT_FOUND"

  });

 }



 if(room.players.length>=2){

  return res.status(400).json({

   error:"ROOM_FULL"

  });

 }



 const player = {

  id:crypto.randomUUID(),

  username:
  req.body.username || "Player"

 };



 const token =
 crypto.randomUUID();



 room.players.push(player);


 room.tokens[token]=player.id;



 if(room.players.length===2){

  room.status="playing";

 }



 res.json({

  room,

  playerToken:token

 });


});







// ================= QUICK =================

app.post("/api/online/quick",(req,res)=>{


 let room =
 Object.values(rooms)
 .find(r=>r.players.length===1);



 if(!room){

  return createRoom(req,res);

 }



 const player={

  id:crypto.randomUUID(),

  username:
  req.body.username || "Player"

 };


 const token =
 crypto.randomUUID();



 room.players.push(player);


 room.tokens[token]=player.id;


 room.status="playing";



 res.json({

  room,

  playerToken:token

 });


});





function createRoom(req,res){


 const code =
 crypto.randomUUID()
 .slice(0,6)
 .toUpperCase();



 const player={

  id:crypto.randomUUID(),

  username:
  req.body.username || "Player"

 };


 const token =
 crypto.randomUUID();



 const room={

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



 res.json({

  room,

  playerToken:token

 });


}








// ================= ROOM =================


// вариант /room?code=ABC123

app.get("/api/online/room",(req,res)=>{


 const code =
 req.query.code ||
 req.query.room;



 return sendRoom(code,res);


});



// вариант /room/ABC123

app.get("/api/online/room/:id",(req,res)=>{


 return sendRoom(
  req.params.id,
  res
 );


});




function sendRoom(code,res){


 const room =
 rooms[code];



 if(!room){

  return res.status(404).json({

   error:"ROOM_NOT_FOUND"

  });

 }



 res.json(room);


}








// ================= LEAVE =================

app.post("/api/online/leave",(req,res)=>{


 const code =
 req.body.code ||
 req.body.room;


 delete rooms[code];


 res.json({

  ok:true

 });


});








// ================= ACTION =================

app.post("/api/online/action",(req,res)=>{


 res.json({

  ok:true

 });


});







// ================= SERVER =================

const server =
app.listen(

 process.env.PORT || 3000,

 ()=>{

 console.log(
 "Durak server started"
 );

}

);






// ================= WS =================


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
