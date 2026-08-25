import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();

app.use(cors());
app.use(express.json());

const rooms = {};

app.get("/", (req,res)=>{
  res.json({
    status:"Durak Server Online"
  });
});


// получить список комнат
app.get("/api/online/public",(req,res)=>{
  res.json({
    rooms:Object.values(rooms)
  });
});


// быстро найти игру
app.post("/api/online/quick",(req,res)=>{

  let room = Object.values(rooms).find(
    r=>r.players.length < 2
  );


  if(!room){

    const id = crypto.randomUUID();

    room={
      id,
      players:[]
    };

    rooms[id]=room;
  }


  room.players.push({
    id: crypto.randomUUID()
  });


  res.json({
    roomId:room.id,
    players:room.players.length
  });

});


// создать комнату
app.post("/api/online/create",(req,res)=>{

 const id=crypto.randomUUID();

 rooms[id]={
   id,
   players:[]
 };


 res.json({
   roomId:id
 });

});


// войти в комнату
app.post("/api/online/join",(req,res)=>{

 const {roomId}=req.body;


 if(!rooms[roomId]){
   return res.status(404).json({
    error:"Room not found"
   });
 }


 rooms[roomId].players.push({
   id:crypto.randomUUID()
 });


 res.json({
   roomId,
   players:rooms[roomId].players.length
 });

});



const server = app.listen(
 process.env.PORT || 3000,
 ()=>{
 console.log("Durak server started");
 });


const wss=new WebSocketServer({
 server
});


wss.on("connection",socket=>{

 console.log("player connected");


 socket.send(JSON.stringify({
  type:"connected"
 }));


});
