import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";


const app = express();

console.log("SERVER 7490 LOADED");


app.use(cors());
app.use(express.json());



const rooms = {};



// HEALTH CHECK
app.get("/", (req,res)=>{

  res.json({
    status:"Durak Server Online"
  });

});




// PUBLIC ROOMS
// PUBLIC ROOMS
app.get("/api/online/public",(req,res)=>{

  res.json(
    Object.values(rooms)
      .filter(
        r=>r.players.length < 2
      )
  );

});



// CREATE ROOM
app.post("/api/online/create",(req,res)=>{

  const id =
    crypto.randomUUID()
    .slice(0,6)
    .toUpperCase();


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

    roomId:id,

    status:"created"

  });


});





// QUICK JOIN
app.post("/api/online/quick",(req,res)=>{


  let room =
    Object.values(rooms)
    .find(
      r=>r.players.length===1
    );



  if(!room){


    const id =
      crypto.randomUUID()
      .slice(0,6)
      .toUpperCase();



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



 room.players.push({

   id:crypto.randomUUID(),

   name:req.body.name || "Player"

 });



 res.json({

   roomId:room.id,

   status:"joined"

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







// START SERVER

const server =
app.listen(

 process.env.PORT || 3000,

 ()=>{

  console.log(
   "Durak server started"
  );

 }

);





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
      "WS MESSAGE:",
      msg.toString()
    );


  }
 );


});
