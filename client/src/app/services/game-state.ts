import { Service, signal, computed } from '@angular/core';
import {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_REFRESH_MS,
  GamePhase,
  GridTile,
  MIN_PLAYERS_TO_START,
  Player,
  TapResult,
} from '../models/game.models';

@Service()
export class GameState {
  readonly playerName = signal('');
  readonly roomId = signal('');
  readonly mySocketId = signal('');

  readonly phase = signal<GamePhase>('home');
  readonly players = signal<Player[]>([]);
  readonly grid = signal<GridTile[]>([]);
  readonly timeLeft = signal(DEFAULT_DURATION_SECONDS);
  readonly durationSeconds = signal(DEFAULT_DURATION_SECONDS);
  readonly refreshMs = signal(DEFAULT_REFRESH_MS);
  readonly isSolo = signal(false);
  readonly lastTap = signal<TapResult | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly me = computed(() => this.players().find((p) => p.socketId === this.mySocketId()) ?? null);
  readonly isHost = computed(() => this.me()?.isHost ?? false);
  readonly canStart = computed(
    () => this.isHost() && this.players().length >= MIN_PLAYERS_TO_START && this.phase() === 'waiting',
  );
  readonly leaderboard = computed(() => [...this.players()].sort((a, b) => b.score - a.score));

  reset() {
    this.roomId.set('');
    this.phase.set('home');
    this.players.set([]);
    this.grid.set([]);
    this.timeLeft.set(DEFAULT_DURATION_SECONDS);
    this.durationSeconds.set(DEFAULT_DURATION_SECONDS);
    this.refreshMs.set(DEFAULT_REFRESH_MS);
    this.isSolo.set(false);
    this.lastTap.set(null);
    this.errorMessage.set(null);
  }
}
