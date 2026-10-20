const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { generateGrid } = require('./colors');
const { applyTap } = require('./gameLogic');
const { resolveGameSettings } = require('./gameSettings');
const {
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  clearRoomIntervals,
  serializePlayers,
  MIN_PLAYERS_TO_START,
} = require('./rooms');

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});

function endGame(io, room) {
  if (room.gameState === 'finished') return;
  clearRoomIntervals(room);
  room.gameState = 'finished';

  const players = serializePlayers(room);
  let winner = null;
  if (players.length > 0) {
    const top = Math.max(...players.map((p) => p.score));
    const leaders = players.filter((p) => p.score === top);
    winner = leaders.length === 1 ? leaders[0].name : 'tie';
  }

  io.to(room.id).emit('gameOver', { players, winner });
}

function relightGrid(io, room) {
  room.grid = generateGrid();
  io.to(room.id).emit('syncGrid', { grid: room.grid });
}

function scheduleGridInterval(io, room) {
  if (room.gridInterval) clearInterval(room.gridInterval);
  room.gridInterval = setInterval(() => relightGrid(io, room), room.refreshMs);
}

function startGameLoop(io, room, settings) {
  room.gameState = 'playing';
  room.durationSeconds = settings.durationSeconds;
  room.refreshMs = settings.refreshMs;
  room.timeLeft = settings.durationSeconds;
  room.grid = generateGrid();

  io.to(room.id).emit('gameStarted', {
    grid: room.grid,
    timeLeft: room.timeLeft,
    durationSeconds: room.durationSeconds,
    refreshMs: room.refreshMs,
  });

  scheduleGridInterval(io, room);

  room.timerInterval = setInterval(() => {
    room.timeLeft -= 1;
    io.to(room.id).emit('timerUpdate', { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) {
      endGame(io, room);
    }
  }, 1000);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, callback) => {
    const room = createRoom(socket.id, name || 'Player 1');
    socket.join(room.id);
    callback?.({ roomId: room.id, players: serializePlayers(room) });
  });

  socket.on('joinRoom', ({ roomId, name }, callback) => {
    const result = joinRoom(roomId, socket.id, name || 'Player 2');
    if (result.error) {
      callback?.({ error: result.error });
      return;
    }

    socket.join(roomId);
    const players = serializePlayers(result.room);
    callback?.({ roomId, players });
    socket.to(roomId).emit('playerJoined', { players });
  });

  socket.on('startGame', ({ roomId, durationSeconds, refreshMs }) => {
    const room = getRoom(roomId);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.gameState !== 'waiting') return;
    if (Object.keys(room.players).length < MIN_PLAYERS_TO_START) return;

    startGameLoop(io, room, resolveGameSettings({ durationSeconds, refreshMs }));
  });

  socket.on('tapTile', ({ roomId, index }) => {
    const room = getRoom(roomId);
    if (!room || room.gameState !== 'playing') return;
    const player = room.players[socket.id];
    if (!player) return;
    if (index < 0 || index >= room.grid.length) return;

    const color = room.grid[index];
    if (color === null) return; // dull tile, nothing to tap

    const result = applyTap(player, color);

    io.to(roomId).emit('scoreUpdate', {
      socketId: socket.id,
      players: serializePlayers(room),
      tap: { index, color, ...result },
    });

    relightGrid(io, room);
    scheduleGridInterval(io, room);
  });

  socket.on('disconnect', () => {
    const result = removePlayer(socket.id);
    if (!result || result.roomDeleted) return;

    io.to(result.roomId).emit('playerLeft', { players: serializePlayers(result.room) });
    const remaining = Object.keys(result.room.players).length;
    if (result.room.gameState === 'playing' && remaining < MIN_PLAYERS_TO_START) {
      endGame(io, result.room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Don't Touch The Purple server listening on port ${PORT}`);
});
