import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Socket } from '../../services/socket';
import { GameState } from '../../services/game-state';
import {
  DEFAULT_DURATION_SECONDS,
  DEFAULT_REFRESH_MS,
  DURATION_OPTIONS,
  MAX_PLAYERS,
  SPEED_OPTIONS,
} from '../../models/game.models';
import { ordinal } from '../../utils/ordinal';

@Component({
  imports: [],
  selector: 'app-game-room',
  styleUrl: './game-room.css',
  templateUrl: './game-room.html',
})
export class GameRoom implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly socketService = inject(Socket);
  readonly gameState = inject(GameState);

  readonly shakeActive = signal(false);
  readonly floatingTap = signal<{ index: number; text: string; color: string } | null>(null);
  private shakeTimeout?: ReturnType<typeof setTimeout>;
  private floatTimeout?: ReturnType<typeof setTimeout>;

  readonly maxPlayers = MAX_PLAYERS;
  readonly durationOptions = DURATION_OPTIONS;
  readonly speedOptions = SPEED_OPTIONS;

  // Host-only draft settings, picked before starting; default to the standard match.
  readonly selectedDuration = signal(DEFAULT_DURATION_SECONDS);
  readonly selectedRefreshMs = signal(DEFAULT_REFRESH_MS);

  readonly roomId = computed(() => this.gameState.roomId());
  readonly players = this.gameState.players;
  readonly leaderboard = this.gameState.leaderboard;
  readonly grid = this.gameState.grid;
  readonly timeLeft = this.gameState.timeLeft;
  readonly phase = this.gameState.phase;
  readonly me = this.gameState.me;
  readonly isHost = this.gameState.isHost;
  readonly canStart = this.gameState.canStart;

  readonly comboTierLabel = computed(() => {
    const combo = this.me()?.combo ?? 0;
    if (combo >= 10) return 'GOLD x5';
    if (combo >= 6) return 'SILVER x3';
    if (combo >= 3) return 'BRONZE x2';
    return '—';
  });

  // Standard competition ranking: players with an equal score share the same rank.
  readonly myRank = computed(() => {
    const myScore = this.me()?.score;
    if (myScore === undefined) return null;
    const higherCount = this.leaderboard().filter((p) => p.score > myScore).length;
    return higherCount + 1;
  });

  readonly myRankLabel = computed(() => {
    const rank = this.myRank();
    return rank === null ? '' : ordinal(rank);
  });

  readonly didIWin = computed(() => this.myRank() === 1);

  constructor() {
    effect(() => {
      const tap = this.gameState.lastTap();
      if (!tap) return;

      if (tap.hitPurple) {
        this.shakeActive.set(true);
        clearTimeout(this.shakeTimeout);
        this.shakeTimeout = setTimeout(() => this.shakeActive.set(false), 400);
        this.floatingTap.set({ index: tap.index, text: `-50`, color: 'var(--purple)' });
      } else {
        const multiplierLabel = tap.multiplier > 1 ? ` x${tap.multiplier}` : '';
        this.floatingTap.set({ index: tap.index, text: `+${tap.pointsAwarded}${multiplierLabel}`, color: 'var(--neon-green)' });
      }

      clearTimeout(this.floatTimeout);
      this.floatTimeout = setTimeout(() => this.floatingTap.set(null), 700);
    });
  }

  ngOnInit() {
    const routeRoomId = this.route.snapshot.paramMap.get('roomId');
    if (!routeRoomId || this.gameState.roomId() !== routeRoomId) {
      this.router.navigate(['/']);
    }
  }

  ngOnDestroy() {
    clearTimeout(this.shakeTimeout);
    clearTimeout(this.floatTimeout);
  }

  startGame() {
    this.socketService.startGame(this.roomId(), this.selectedDuration(), this.selectedRefreshMs());
  }

  tapTile(index: number) {
    if (this.phase() !== 'playing') return;
    this.socketService.tapTile(this.roomId(), index);
  }

  copyRoomId() {
    navigator.clipboard?.writeText(this.roomId());
  }

  playAgain() {
    this.socketService.disconnect();
    this.gameState.reset();
    this.router.navigate(['/']);
  }
}
