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
  score: number;
  combo: number;
  isHost: boolean;
}

export type ComboTier = 'none' | 'bronze' | 'silver' | 'gold';

export interface TapResult {
  index: number;
  color: TileColor;
  hitPurple: boolean;
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

export const DEFAULT_REFRESH_MS = 800;
export interface SpeedOption {
  label: string;
  refreshMs: number;
}
export const SPEED_OPTIONS: SpeedOption[] = [
  { label: 'Normal', refreshMs: 800 },
  { label: 'Fast', refreshMs: 500 },
  { label: 'Very Fast', refreshMs: 300 },
];
