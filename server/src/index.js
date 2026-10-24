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
  resetRoomForNewRound,
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

  io.to(room.id).emit('gameOver', { players, winner, isSolo: room.isSolo });
}

function notifyRoomPlayerLeft(io, room, roomId) {
  io.to(roomId).emit('playerLeft', { players: serializePlayers(room) });
  const remaining = Object.keys(room.players).length;
  if (room.gameState === 'playing' && remaining < MIN_PLAYERS_TO_START) {
    endGame(io, room);
  }
}

// A socket should only ever be a player in one room at a time. Evicting it
// from anything stale before it creates/joins a new one keeps that
// invariant true, instead of just hoping disconnect eventually cleans up
// after it.
function leaveAllRooms(io, socket) {
  for (const result of removePlayer(socket.id)) {
    socket.leave(result.roomId);
    if (!result.roomDeleted) {
      notifyRoomPlayerLeft(io, result.room, result.roomId);
    }
  }
}

// Render's free tier adds real, noticeable latency on top of ordinary network
// RTT, so a perfectly-timed tap lands just after the server has already
// relit the tile elsewhere more often than on a fast host. `graceInfo` (set
// only when a tile times out naturally, never after someone has already
// legitimately claimed it) lets a late-arriving tap for that exact tile
// still score, once. Capping at `room.refreshMs` rather than half of it is
// still safe even at Very Fast speed: `room.previousLit` is a single slot
// that gets overwritten on every relight regardless of whether its grace
// window technically expired yet, so a tile's real grace window can never
// outlive the next relight either way - the cap just documents that bound
// explicitly instead of relying on that overwrite behavior implicitly.
const MAX_TAP_GRACE_MS = 500;
function relightGrid(io, room, graceInfo = null) {
  const previousIndex = room.grid.findIndex((c) => c !== null);
  room.previousLit = graceInfo;
  room.grid = generateGrid(previousIndex);
  io.to(room.id).emit('syncGrid', { grid: room.grid });
}

function scheduleGridInterval(io, room) {
  if (room.gridInterval) clearInterval(room.gridInterval);
  room.gridInterval = setInterval(() => {
    const litIndex = room.grid.findIndex((c) => c !== null);
    const graceInfo =
      litIndex === -1
        ? null
        : {
            index: litIndex,
            color: room.grid[litIndex],
            expiresAt: Date.now() + Math.min(MAX_TAP_GRACE_MS, room.refreshMs),
          };
    relightGrid(io, room, graceInfo);
  }, room.refreshMs);
}

function startGameLoop(io, room, settings) {
  room.gameState = 'playing';
  room.durationSeconds = settings.durationSeconds;
  room.refreshMs = settings.refreshMs;
  room.dangerColor = settings.dangerColor;
  room.timeLeft = settings.durationSeconds;
  room.grid = generateGrid();

  io.to(room.id).emit('gameStarted', {
    grid: room.grid,
    timeLeft: room.timeLeft,
    durationSeconds: room.durationSeconds,
    refreshMs: room.refreshMs,
    dangerColor: room.dangerColor,
    isSolo: room.isSolo,
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
  socket.on('createRoom', ({ name, solo }, callback) => {
    leaveAllRooms(io, socket);
    const room = createRoom(socket.id, name || 'Player 1', !!solo);
    socket.join(room.id);
    callback?.({ roomId: room.id, players: serializePlayers(room), isSolo: room.isSolo });
  });

  socket.on('joinRoom', ({ roomId, name }, callback) => {
    leaveAllRooms(io, socket);
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

  socket.on('startGame', ({ roomId, durationSeconds, refreshMs, dangerColor }) => {
    const room = getRoom(roomId);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.gameState !== 'waiting') return;
    if (!room.isSolo && Object.keys(room.players).length < MIN_PLAYERS_TO_START) return;

    startGameLoop(io, room, resolveGameSettings({ durationSeconds, refreshMs, dangerColor }));
  });

  socket.on('playAgain', ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return;
    if (!room.players[socket.id]) return;
    if (room.gameState !== 'finished') return;

    resetRoomForNewRound(room);
    io.to(roomId).emit('roomReset', { players: serializePlayers(room) });
  });

  socket.on('tapTile', ({ roomId, index }) => {
    const room = getRoom(roomId);
    if (!room || room.gameState !== 'playing') return;
    const player = room.players[socket.id];
    if (!player) return;
    if (index < 0 || index >= room.grid.length) return;

    let color = room.grid[index];

    if (color === null) {
      const grace = room.previousLit;
      const withinGrace = grace && grace.index === index && Date.now() <= grace.expiresAt;
      if (!withinGrace) return; // genuinely a dull tile, nothing to tap
      color = grace.color;
      room.previousLit = null; // consume it so only the first late tap scores
    }

    const result = applyTap(player, color, room.dangerColor);

    io.to(roomId).emit('scoreUpdate', {
      socketId: socket.id,
      players: serializePlayers(room),
      tap: { index, color, ...result },
    });

    relightGrid(io, room);
    scheduleGridInterval(io, room);
  });

  socket.on('disconnect', () => {
    for (const result of removePlayer(socket.id)) {
      if (!result.roomDeleted) {
        notifyRoomPlayerLeft(io, result.room, result.roomId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Don't Touch The Purple server listening on port ${PORT}`);
});
