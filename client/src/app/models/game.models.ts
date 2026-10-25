export type TileColor =
  | 'neon-green'
  | 'neon-cyan'
  | 'neon-orange'
  | 'neon-pink'
  | 'neon-yellow'
  | 'neon-red'
  | 'neon-blue'
  | 'purple';

// A grid slot is `null` when the tile is dull (unlit) - only one slot is ever lit at a time.
export type GridTile = TileColor | null;

export interface Player {
  socketId: string;
  name: string;
  avatar: string;
  score: number;
  combo: number;
  isHost: boolean;
}

export type ComboTier = 'none' | 'bronze' | 'silver' | 'gold';

export interface TapResult {
  socketId: string;
  index: number;
  color: TileColor;
  hitDanger: boolean;
  pointsAwarded: number;
  combo: number;
  tier: ComboTier;
  multiplier: number;
}

export type GamePhase = 'home' | 'waiting' | 'playing' | 'finished';

export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 10;

// Mirrors server/src/gameSettings.js - must match its allowed values and defaults.
export const DEFAULT_DURATION_SECONDS = 60;
export const DURATION_OPTIONS = [30, 60, 90, 120];

// This isn't simple reaction time (~200ms) - it's visual search across 10
// tile positions, color ID, a decide, and a physical tap, which realistically
// needs 400-800ms+ even for an attentive player. Must stay in sync with
// server/src/gameSettings.js - the server silently falls back to its default
// for any value not in its own allow-list.
export const DEFAULT_REFRESH_MS = 1800;
export interface SpeedOption {
  label: string;
  refreshMs: number;
}
export const SPEED_OPTIONS: SpeedOption[] = [
  { label: 'Relaxed', refreshMs: 1800 },
  { label: 'Normal', refreshMs: 1300 },
  { label: 'Fast', refreshMs: 1000 },
  { label: 'Very Fast', refreshMs: 750 },
];

export interface ColorOption {
  value: TileColor;
  label: string;
}
export const DEFAULT_DANGER_COLOR: TileColor = 'purple';
export const COLOR_OPTIONS: ColorOption[] = [
  { value: 'purple', label: 'Purple' },
  { value: 'neon-green', label: 'Green' },
  { value: 'neon-cyan', label: 'Cyan' },
  { value: 'neon-blue', label: 'Blue' },
  { value: 'neon-orange', label: 'Orange' },
  { value: 'neon-yellow', label: 'Yellow' },
  { value: 'neon-red', label: 'Red' },
  { value: 'neon-pink', label: 'Pink' },
];
