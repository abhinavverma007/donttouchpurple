// A pool bigger than MAX_PLAYERS (10) so a full room can always get 10
// distinct vehicles, with some left over for variety between games.
const VEHICLE_EMOJIS = [
  '🚗', '🚕', '🚙', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜',
  '🏎️', '🚲', '🛵', '🏍️', '🚁', '✈️', '🚀', '🚢', '⛵', '🚂',
];

// Picks a random vehicle not already in use in this room, so no two players
// ever share one. Falls back to any vehicle if the pool is somehow exhausted
// (can't happen while MAX_PLAYERS <= VEHICLE_EMOJIS.length, but a graceful
// fallback beats a crash if that ever changes).
function pickAvatar(usedAvatars = []) {
  const used = new Set(usedAvatars);
  const available = VEHICLE_EMOJIS.filter((v) => !used.has(v));
  const pool = available.length > 0 ? available : VEHICLE_EMOJIS;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { VEHICLE_EMOJIS, pickAvatar };
