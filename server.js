import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();

app.use(cors());
app.use(express.json());

const rooms = {};
const clients = new Map();

app.get("/", (req, res) => {
  res.json({
    status: "Durak Server Online"
  });
});


// список комнат
app.get("/api/online/public", (req,res)=>{
  res.json({
    rooms:Object.values(rooms)
      .filter(r=>r.players.length < 2)
  });
});


// создать комнату
app.post("/api/online/create",(req,res)=>{

  const id = crypto.randomUUID().slice(0,6);

  rooms[id]={
    id,
    players:[
      {
        id:crypto.randomUUID(),
        name:req.body.name || "Player"
      }
    ],
    status:"waiting"
  };


  res.json({
    roomId:id
  });

});


// быстрый поиск
app.post("/api/online/quick",(req,res)=>{

  let room =
    Object.values(rooms)
    .find(r=>r.players.length===1);


  if(!room){

    const id = crypto.randomUUID().slice(0,6);

    rooms[id]={
      id,
      players:[
        {
          id:crypto.randomUUID(),
          name:req.body.name || "Player"
        }
      ],
      status:"waiting"
    };


    return res.json({
      roomId:id,
      status:"created"
    });

  }


  room.players.push({
    id:crypto.randomUUID(),
    name:req.body.name || "Player"
  });


  room.status="playing";


  res.json({
    roomId:room.id,
    status:"joined"
  });

});



// вход по ID
app.post("/api/online/join",(req,res)=>{

 const room=rooms[req.body.roomId];


 if(!room)
 return res.status(404).json({
  error:"Room not found"
 });


 room.players.push({
  id:crypto.randomUUID(),
  name:req.body.name || "Player"
 });


 res.json({
  roomId:room.id
 });


});



const server = app.listen(
 process.env.PORT || 3000,
 ()=>{
 console.log("Durak server started");
 });


const wss = new WebSocketServer({
 server
});


wss.on("connection",(socket)=>{

 console.log("WS connected");


 socket.send(JSON.stringify({
  type:"connected"
 }));


 socket.on("message",(msg)=>{

   let data;

   try{
    data=JSON.parse(msg);
   }catch{
    return;
   }


   console.log(data);


 });


});
