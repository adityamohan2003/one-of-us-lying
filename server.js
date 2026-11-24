import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const TOPICS = [
  { topic: "Beach", question: "What's something you would normally expect to see there?" },
  { topic: "Cinema", question: "What's something people commonly do there?" },
  { topic: "Airport", question: "What's something you would probably notice there?" },
  { topic: "Wedding", question: "What's something you would expect to happen there?" },
  { topic: "Gym", question: "What's something people often bring there?" },
  { topic: "Restaurant", question: "What's something you might complain about there?" },
  { topic: "School", question: "What's something people usually do there?" },
  { topic: "Football match", question: "What's something you'd expect to hear there?" },
  { topic: "Camping", question: "What's something you would probably need?" },
  { topic: "Hospital", question: "What's something you might see there?" },
  { topic: "Supermarket", question: "What's something people commonly do there?" },
  { topic: "Birthday party", question: "What's something you would expect to happen?" },
  { topic: "Train station", question: "What's something people often do there?" },
  { topic: "Library", question: "What's something you would expect people to do there?" },
  { topic: "Nightclub", question: "What's something you might hear there?" }
];

function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function cleanName(name) {
  return String(name || "").trim().slice(0, 18) || "Player";
}
function roomFor(socket) {
  return socket.data.room ? rooms.get(socket.data.room) : null;
}
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected
  }));
}
function broadcastLobby(room) {
  io.to(room.code).emit("lobby:update", {
    code: room.code,
    hostId: room.hostId,
    players: publicPlayers(room),
    minPlayers: 3
  });
}
function emitRound(room) {
  for (const p of room.players.values()) {
    io.to(p.id).emit("round:start", {
      round: room.round,
      totalRounds: room.totalRounds,
      question: room.question,
      role: p.id === room.impostorId ? "impostor" : "player",
      topic: p.id === room.impostorId ? null : room.topic,
      phase: "answering",
      answerOrder: room.answerOrder
    });
  }
}
function finishVote(room) {
  if (room.phase !== "voting") return;
  const counts = {};
  for (const vote of room.votes.values()) counts[vote] = (counts[vote] || 0) + 1;
  const max = Math.max(...Object.values(counts), 0);
  const leaders = Object.entries(counts).filter(([, n]) => n === max).map(([id]) => id);

  let accusedId = leaders[0] || null;
  let tie = leaders.length > 1;

  // In a tie, no one is eliminated; the impostor gets the survival reward.
  const impostorCaught = !tie && accusedId === room.impostorId;

  for (const p of room.players.values()) {
    if (impostorCaught && p.id !== room.impostorId) p.score += 2;
    if (!impostorCaught && p.id === room.impostorId) p.score += 3;
  }

  room.phase = "reveal";
  room.accusedId = accusedId;
  room.impostorCaught = impostorCaught;
  room.tie = tie;

  io.to(room.code).emit("vote:result", {
    accusedId,
    impostorId: room.impostorId,
    impostorCaught,
    tie,
    players: publicPlayers(room),
    canGuess: impostorCaught
  });
}
function chooseTopic(room) {
  const pool = TOPICS.filter(t => t.topic !== room.lastTopic);
  return pool[Math.floor(Math.random() * pool.length)];
}
function startRound(room) {
  room.round++;
  room.phase = "answering";
  room.votes = new Map();
  room.answers = [];
  room.answerOrder = [...room.players.keys()].sort(() => Math.random() - 0.5);
  const selected = chooseTopic(room);
  room.topic = selected.topic;
  room.question = selected.question;
  room.impostorId = room.answerOrder[Math.floor(Math.random() * room.answerOrder.length)];
  room.lastTopic = room.topic;
  emitRound(room);
}

function createRoom(hostSocket, name) {
  let codeValue;
  do codeValue = code(); while (rooms.has(codeValue));
  const room = {
    code: codeValue,
    hostId: hostSocket.id,
    players: new Map(),
    round: 0,
    totalRounds: 5,
    phase: "lobby",
    votes: new Map(),
    answers: [],
    answerOrder: [],
    topic: null,
    question: null,
    lastTopic: null,
    impostorId: null,
    accusedId: null,
    impostorCaught: false,
    tie: false
  };
  rooms.set(codeValue, room);
  room.players.set(hostSocket.id, {
    id: hostSocket.id, name: cleanName(name), score: 0, connected: true
  });
  hostSocket.data.room = codeValue;
  hostSocket.join(codeValue);
  return room;
}

io.on("connection", socket => {
  socket.on("room:create", ({ name }) => {
    const room = createRoom(socket, name);
    socket.emit("room:created", { code: room.code });
    broadcastLobby(room);
  });

  socket.on("room:join", ({ code: roomCode, name }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room) return socket.emit("error:message", "Room not found.");
    if (room.phase !== "lobby") return socket.emit("error:message", "That game has already started.");
    if (room.players.size >= 8) return socket.emit("error:message", "Room is full.");
    if ([...room.players.values()].some(p => p.name.toLowerCase() === cleanName(name).toLowerCase()))
      return socket.emit("error:message", "That name is already taken.");

    room.players.set(socket.id, { id: socket.id, name: cleanName(name), score: 0, connected: true });
    socket.data.room = room.code;
    socket.join(room.code);
    broadcastLobby(room);
  });

  socket.on("game:start", () => {
    const room = roomFor(socket);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size < 3) return socket.emit("error:message", "At least 3 players are required.");
    startRound(room);
  });

  socket.on("answer:ready", ({ playerId }) => {
    const room = roomFor(socket);
    if (!room || room.phase !== "answering") return;
    if (playerId !== socket.id) return;
    if (!room.answers.includes(socket.id)) room.answers.push(socket.id);

    io.to(room.code).emit("answer:progress", {
      ready: room.answers.length,
      total: room.players.size
    });

    if (room.answers.length === room.players.size) {
      room.phase = "discussion";
      io.to(room.code).emit("phase:discussion", { seconds: 60 });
    }
  });

  socket.on("vote:submit", ({ targetId }) => {
    const room = roomFor(socket);
    if (!room || room.phase !== "voting") return;
    if (!room.players.has(targetId) || room.votes.has(socket.id)) return;
    if (targetId === socket.id) return;
    room.votes.set(socket.id, targetId);
    io.to(socket.id).emit("vote:accepted");
    if (room.votes.size === room.players.size) finishVote(room);
  });

  socket.on("phase:advance", () => {
    const room = roomFor(socket);
    if (!room || room.hostId !== socket.id) return;

    if (room.phase === "discussion") {
      room.phase = "voting";
      io.to(room.code).emit("phase:voting", { players: publicPlayers(room) });
    } else if (room.phase === "reveal") {
      if (room.round >= room.totalRounds) {
        room.phase = "gameover";
        io.to(room.code).emit("game:over", {
          players: publicPlayers(room).sort((a,b) => b.score - a.score)
        });
      } else {
        startRound(room);
      }
    }
  });

  socket.on("impostor:guess", ({ guess }) => {
    const room = roomFor(socket);
    if (!room || room.phase !== "reveal" || !room.impostorCaught || socket.id !== room.impostorId) return;
    const correct = String(guess || "").trim().toLowerCase() === room.topic.toLowerCase();
    if (correct) {
      room.players.get(socket.id).score += 2;
    }
    room.impostorGuess = String(guess || "").trim();
    io.to(room.code).emit("impostor:guessResult", {
      guess: room.impostorGuess,
      correct,
      players: publicPlayers(room)
    });
  });

  socket.on("disconnect", () => {
    const room = roomFor(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) player.connected = false;

    if (room.phase === "lobby") {
      room.players.delete(socket.id);
      if (room.hostId === socket.id) {
        const next = room.players.keys().next().value;
        if (next) room.hostId = next;
      }
      if (room.players.size === 0) rooms.delete(room.code);
      else broadcastLobby(room);
    } else {
      io.to(room.code).emit("player:disconnected", { playerId: socket.id });
    }
  });
});

server.listen(PORT, () => console.log(`One of Us Is Lying running on :${PORT}`));
