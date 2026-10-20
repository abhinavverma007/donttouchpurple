const SAFE_COLORS = ['neon-green', 'neon-cyan', 'neon-orange', 'neon-pink', 'neon-yellow', 'neon-red', 'neon-blue'];
const PURPLE = 'purple';
const ALL_COLORS = [...SAFE_COLORS, PURPLE];

const GRID_SIZE = 10;

function randomColor() {
  return ALL_COLORS[Math.floor(Math.random() * ALL_COLORS.length)];
}

// Only one tile is ever "lit" (has a color) at a time; the rest are dull (null).
function generateGrid() {
  const grid = new Array(GRID_SIZE).fill(null);
  const litIndex = Math.floor(Math.random() * GRID_SIZE);
  grid[litIndex] = randomColor();
  return grid;
}

module.exports = { SAFE_COLORS, PURPLE, ALL_COLORS, GRID_SIZE, generateGrid };
