const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
const MAX_PLAYERS = 10;
const MIN_PLAYERS_TO_START = 2;

const rooms = {};

function generateRoomId() {
  let id;
  do {
    id = Array.from({ length: 5 }, () => ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]).join('');
  } while (rooms[id]);
  return id;
}

// Each player gets their own `grid`/`previousLit`/`gridInterval` - with 2+
// players all racing for a single shared tile, the lowest-latency player wins
// almost every round and everyone else scores nothing (confirmed live with 6
// players: one player won ~90% of rounds, three others scored zero in 30s).
// Independent per-player boards make it a fair "same rules, parallel boards"
// race instead of a latency contest. Only match-wide state (duration, danger
// color, refresh speed, the countdown timer) stays on the room itself.
// `sessionId` is a client-generated id that survives a reconnect even though
// `socketId` doesn't - it's how a dropped player reclaims their seat (score,
// combo, host status) instead of a network blip silently ending their match.
function newPlayer(name, sessionId) {
  return {
    name,
    score: 0,
    combo: 0,
    grid: [],
    previousLit: null,
    gridInterval: null,
    sessionId,
    pendingRecovery: false,
    recoveryTimeout: null,
  };
}

function createRoom(hostSocketId, hostName, isSolo = false, sessionId) {
  const roomId = generateRoomId();
  rooms[roomId] = {
    id: roomId,
    hostId: hostSocketId,
    isSolo: !!isSolo,
    players: {
      [hostSocketId]: newPlayer(hostName, sessionId),
    },
    gameState: 'waiting', // waiting | playing | finished
    timeLeft: 60,
    timerInterval: null,
  };
  return rooms[roomId];
}

function getRoom(roomId) {
  return rooms[roomId];
}

function joinRoom(roomId, socketId, name, sessionId) {
  const room = rooms[roomId];
  if (!room) return { error: 'Room not found' };
  if (room.isSolo) return { error: 'Room not found' };
  if (room.gameState !== 'waiting') return { error: 'Game already in progress' };
  if (Object.keys(room.players).length >= MAX_PLAYERS) return { error: 'Room is full' };

  room.players[socketId] = newPlayer(name, sessionId);
  return { room };
}

// Every room this socket currently has a player entry in - normally exactly
// one. Used instead of trusting a single cached roomId so a stray
// double-membership is never silently missed.
function findRoomsForSocket(socketId) {
  return Object.keys(rooms)
    .map((roomId) => ({ roomId, room: rooms[roomId] }))
    .filter(({ room }) => !!room.players[socketId]);
}

// Reclaims a seat held open for reconnection: finds the stale player entry
// (still keyed by their old, now-dead socket id) by sessionId, re-keys it to
// the new connection, and cancels the pending removal. Score, combo, and host
// status all survive the gap untouched.
function recoverPlayerSession(room, sessionId, newSocketId) {
  const oldSocketId = Object.keys(room.players).find(
    (id) => room.players[id].sessionId === sessionId && room.players[id].pendingRecovery,
  );
  if (!oldSocketId) return null;

  const player = room.players[oldSocketId];
  clearTimeout(player.recoveryTimeout);
  player.recoveryTimeout = null;
  player.pendingRecovery = false;

  delete room.players[oldSocketId];
  room.players[newSocketId] = player;
  if (room.hostId === oldSocketId) room.hostId = newSocketId;

  return { player, oldSocketId };
}

// A socket should only ever be a player in one room, but this scans and
// cleans up *every* room it's found in (not just the first) so a stray
// double-membership can never leak a room - and its running intervals -
// forever.
function removePlayer(socketId) {
  const affected = [];

  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    if (!room.players[socketId]) continue;

    if (room.players[socketId].gridInterval) clearInterval(room.players[socketId].gridInterval);
    if (room.players[socketId].recoveryTimeout) clearTimeout(room.players[socketId].recoveryTimeout);
    delete room.players[socketId];

    if (Object.keys(room.players).length === 0) {
      clearRoomIntervals(room);
      delete rooms[roomId];
      affected.push({ roomId, roomDeleted: true });
      continue;
    }

    if (room.hostId === socketId) {
      room.hostId = Object.keys(room.players)[0];
    }
    affected.push({ roomId, roomDeleted: false, room });
  }

  return affected;
}

// "Play Again" reuses the same room instead of tearing it down: everyone's
// score/combo resets and the room goes back to 'waiting' so the host can
// tweak settings and start a fresh round, without players having to
// re-share the room code.
function resetRoomForNewRound(room) {
  clearRoomIntervals(room);
  for (const player of Object.values(room.players)) {
    player.score = 0;
    player.combo = 0;
    player.grid = [];
    player.previousLit = null;
  }
  room.gameState = 'waiting';
}

function clearRoomIntervals(room) {
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timerInterval = null;
  for (const player of Object.values(room.players)) {
    if (player.gridInterval) clearInterval(player.gridInterval);
    player.gridInterval = null;
  }
}

function serializePlayers(room) {
  return Object.entries(room.players).map(([socketId, p]) => ({
    socketId,
    name: p.name,
    score: p.score,
    combo: p.combo,
    isHost: socketId === room.hostId,
  }));
}

module.exports = {
  rooms,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  findRoomsForSocket,
  recoverPlayerSession,
  clearRoomIntervals,
  resetRoomForNewRound,
  serializePlayers,
};
