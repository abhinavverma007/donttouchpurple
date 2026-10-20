const { PURPLE } = require('./colors');

const BASE_POINTS = 10;
const PURPLE_PENALTY = 50;

const TIERS = [
  { name: 'gold', minCombo: 10, multiplier: 5 },
  { name: 'silver', minCombo: 6, multiplier: 3 },
  { name: 'bronze', minCombo: 3, multiplier: 2 },
];

function tierForCombo(combo) {
  const tier = TIERS.find((t) => combo >= t.minCombo);
  return tier || { name: 'none', multiplier: 1 };
}

// Mutates `player` ({ score, combo }) in place based on the tapped color
// and returns a summary of what happened, for feedback effects on the client.
function applyTap(player, color) {
  if (color === PURPLE) {
    player.combo = 0;
    player.score -= PURPLE_PENALTY;
    return { hitPurple: true, pointsAwarded: -PURPLE_PENALTY, combo: 0, tier: 'none', multiplier: 1 };
  }

  player.combo += 1;
  const tier = tierForCombo(player.combo);
  const pointsAwarded = BASE_POINTS * tier.multiplier;
  player.score += pointsAwarded;

  return { hitPurple: false, pointsAwarded, combo: player.combo, tier: tier.name, multiplier: tier.multiplier };
}

module.exports = { applyTap, tierForCombo, BASE_POINTS, PURPLE_PENALTY };
