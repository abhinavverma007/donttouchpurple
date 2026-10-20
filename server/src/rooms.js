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

function createRoom(hostSocketId, hostName, isSolo = false) {
  const roomId = generateRoomId();
  rooms[roomId] = {
    id: roomId,
    hostId: hostSocketId,
    isSolo: !!isSolo,
    players: {
      [hostSocketId]: { name: hostName, score: 0, combo: 0 },
    },
    gameState: 'waiting', // waiting | playing | finished
    grid: [],
    previousLit: null,
    timeLeft: 60,
    gridInterval: null,
    timerInterval: null,
  };
  return rooms[roomId];
}

function getRoom(roomId) {
  return rooms[roomId];
}

function joinRoom(roomId, socketId, name) {
  const room = rooms[roomId];
  if (!room) return { error: 'Room not found' };
  if (room.isSolo) return { error: 'Room not found' };
  if (room.gameState !== 'waiting') return { error: 'Game already in progress' };
  if (Object.keys(room.players).length >= MAX_PLAYERS) return { error: 'Room is full' };

  room.players[socketId] = { name, score: 0, combo: 0 };
  return { room };
}

function removePlayer(socketId) {
  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    if (room.players[socketId]) {
      delete room.players[socketId];

      if (Object.keys(room.players).length === 0) {
        clearRoomIntervals(room);
        delete rooms[roomId];
        return { roomId, roomDeleted: true };
      }

      if (room.hostId === socketId) {
        room.hostId = Object.keys(room.players)[0];
      }
      return { roomId, roomDeleted: false, room };
    }
  }
  return null;
}

function clearRoomIntervals(room) {
  if (room.gridInterval) clearInterval(room.gridInterval);
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.gridInterval = null;
  room.timerInterval = null;
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
  clearRoomIntervals,
  serializePlayers,
};
