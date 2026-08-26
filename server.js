import express from "express";
import cors from "cors";

import {
  createSimpleRoom,
  joinSimpleRoom,
  quickSimpleRoom,
  getSimpleRoom,
  simpleAction,
  leaveSimpleRoom,
  listSimpleRooms
} from "./simpleOnline.js";


const app = express();

console.log("SERVER 7490 LOADED");


app.use(cors());
app.use(express.json());


// health check
app.get("/", (req, res) => {
  res.json({
    status: "Durak Server Online"
  });
});


// список публичных комнат
app.get("/api/online/public", async (req, res) => {
  try {
    const rooms = await listSimpleRooms();

    res.json({
      rooms
    });

  } catch (e) {

    res.status(500).json({
      error: e.message
    });

  }
});


// создать комнату
app.post("/api/online/create", async (req, res) => {

  try {

    const result = await createSimpleRoom(
      req.body.name
    );

    res.json(result);

  } catch(e){

    res.status(500).json({
      error:e.message
    });

  }

});


// быстрый поиск
app.post("/api/online/quick", async (req,res)=>{

  try {

    const result = await quickSimpleRoom(
      req.body.name
    );

    res.json(result);

  } catch(e){

    res.status(500).json({
      error:e.message
    });

  }

});


// вход по коду комнаты
app.post("/api/online/join", async(req,res)=>{

  try {

    const result = await joinSimpleRoom(
      req.body.roomId,
      req.body.name
    );

    res.json(result);


  } catch(e){

    res.status(500).json({
      error:e.message
    });

  }

});


// получить состояние игры
app.get("/api/online/room", async(req,res)=>{

  try {

    const roomId = req.query.roomId;
    const token = req.headers.get
      ? req.headers.get("x-player-token")
      : req.headers["x-player-token"];


    const result = await getSimpleRoom(
      roomId,
      token
    );


    res.json(result);


  } catch(e){

    res.status(500).json({
      error:e.message
    });

  }

});


// действие игрока
app.post("/api/online/action", async(req,res)=>{

  try {

    const token =
      req.headers["x-player-token"];


    const result = await simpleAction(
      req.body.roomId,
      token,
      req.body.action,
      req.body.cardId,
      req.body.revision
    );


    res.json(result);


  } catch(e){

    res.status(500).json({
      error:e.message
    });

  }

});


// выход
app.post("/api/online/leave", async(req,res)=>{

  try {

    const result = await leaveSimpleRoom(
      req.body.roomId,
      req.headers["x-player-token"]
    );

    res.json(result);


  } catch(e){

    res.status(500).json({
      error:e.message
    });

  }

});


// запуск
const PORT = process.env.PORT || 3000;


app.listen(PORT,()=>{

 console.log(
  "Durak server started on port",
  PORT
 );

});
