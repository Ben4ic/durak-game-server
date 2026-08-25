import express from "express";
import { WebSocketServer } from "ws";

const app = express();

app.get("/", (req, res) => {
  res.send("Durak Server Online");
});

const server = app.listen(process.env.PORT || 3000, () => {
  console.log("Server started");
});

const wss = new WebSocketServer({ server });

wss.on("connection", socket => {
  console.log("Player connected");

  socket.send(JSON.stringify({
    type: "connected",
    message: "Welcome"
  }));
});
