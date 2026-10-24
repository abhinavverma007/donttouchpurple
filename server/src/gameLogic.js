const BASE_POINTS = 10;
const DANGER_PENALTY = 50;

const TIERS = [
  { name: 'gold', minCombo: 10, multiplier: 5 },
  { name: 'silver', minCombo: 6, multiplier: 3 },
  { name: 'bronze', minCombo: 3, multiplier: 2 },
];

function tierForCombo(combo) {
  const tier = TIERS.find((t) => combo >= t.minCombo);
  return tier || { name: 'none', multiplier: 1 };
}

// Mutates `player` ({ score, combo }) in place based on the tapped color vs.
// the room's chosen danger color (purple by default, but host-configurable),
// and returns a summary of what happened, for feedback effects on the client.
function applyTap(player, color, dangerColor) {
  if (color === dangerColor) {
    player.combo = 0;
    player.score -= DANGER_PENALTY;
    return { hitDanger: true, pointsAwarded: -DANGER_PENALTY, combo: 0, tier: 'none', multiplier: 1 };
  }

  player.combo += 1;
  const tier = tierForCombo(player.combo);
  const pointsAwarded = BASE_POINTS * tier.multiplier;
  player.score += pointsAwarded;

  return { hitDanger: false, pointsAwarded, combo: player.combo, tier: tier.name, multiplier: tier.multiplier };
}

module.exports = { applyTap, tierForCombo, BASE_POINTS, DANGER_PENALTY };
