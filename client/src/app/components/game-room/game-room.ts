import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Socket } from '../../services/socket';
import { GameState } from '../../services/game-state';
import { Audio } from '../../services/audio';
import { Fullscreen } from '../../services/fullscreen';
import {
  COLOR_OPTIONS,
  DEFAULT_DANGER_COLOR,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_REFRESH_MS,
  DURATION_OPTIONS,
  MAX_PLAYERS,
  SPEED_OPTIONS,
  TileColor,
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
  private readonly audio = inject(Audio);
  readonly fullscreen = inject(Fullscreen);
  readonly gameState = inject(GameState);

  readonly shakeActive = signal(false);
  readonly floatingTap = signal<{ index: number; text: string; color: string } | null>(null);
  readonly dangerCallout = signal<string | null>(null);
  private shakeTimeout?: ReturnType<typeof setTimeout>;
  private floatTimeout?: ReturnType<typeof setTimeout>;
  private dangerCalloutTimeout?: ReturnType<typeof setTimeout>;

  readonly maxPlayers = MAX_PLAYERS;
  readonly durationOptions = DURATION_OPTIONS;
  readonly speedOptions = SPEED_OPTIONS;
  readonly colorOptions = COLOR_OPTIONS;
  readonly defaultRefreshMs = DEFAULT_REFRESH_MS;

  // Host-only draft settings, picked before starting; default to the standard match.
  readonly selectedDuration = signal(DEFAULT_DURATION_SECONDS);
  readonly selectedRefreshMs = signal(DEFAULT_REFRESH_MS);
  readonly selectedDangerColor = signal<TileColor>(DEFAULT_DANGER_COLOR);

  readonly roomId = computed(() => this.gameState.roomId());
  readonly players = this.gameState.players;
  readonly leaderboard = this.gameState.leaderboard;
  readonly grid = this.gameState.grid;
  readonly timeLeft = this.gameState.timeLeft;
  readonly phase = this.gameState.phase;
  readonly me = this.gameState.me;
  readonly isHost = this.gameState.isHost;
  readonly canStart = this.gameState.canStart;
  readonly isSolo = this.gameState.isSolo;
  readonly dangerColor = this.gameState.dangerColor;
  readonly dangerColorLabel = computed(
    () => this.colorOptions.find((c) => c.value === this.dangerColor())?.label.toUpperCase() ?? '',
  );

  // Last 10 seconds get an urgent visual treatment to ramp up tension.
  readonly isTimeUrgent = computed(() => this.timeLeft() <= 10 && this.timeLeft() > 0);

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
    // One tick per second during the final countdown, synced to the same
    // server-driven timeLeft signal that drives the visual urgency state.
    effect(() => {
      const seconds = this.timeLeft();
      if (this.phase() === 'playing' && seconds <= 10 && seconds > 0) {
        this.audio.playTick(seconds);
      }
    });

    effect(() => {
      const tap = this.gameState.lastTap();
      if (!tap) return;

      if (tap.hitDanger) {
        this.shakeActive.set(true);
        clearTimeout(this.shakeTimeout);
        this.shakeTimeout = setTimeout(() => this.shakeActive.set(false), 400);
        this.floatingTap.set({ index: tap.index, text: `-50`, color: `var(--${this.gameState.dangerColor()})` });
        this.audio.playBuzz();

        // The buzz/shake alone doesn't say whose mistake it was - everyone in
        // the room needs to see that, not just the player who tapped.
        const isMe = tap.socketId === this.gameState.mySocketId();
        const tapper = this.players().find((p) => p.socketId === tap.socketId);
        this.dangerCallout.set(isMe ? 'YOU' : (tapper?.name ?? 'Someone').toUpperCase());
        clearTimeout(this.dangerCalloutTimeout);
        this.dangerCalloutTimeout = setTimeout(() => this.dangerCallout.set(null), 1200);
      } else {
        const multiplierLabel = tap.multiplier > 1 ? ` x${tap.multiplier}` : '';
        this.floatingTap.set({ index: tap.index, text: `+${tap.pointsAwarded}${multiplierLabel}`, color: 'var(--neon-green)' });
        this.audio.playSuccess(tap.multiplier);
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
    clearTimeout(this.dangerCalloutTimeout);
  }

  startGame() {
    this.socketService.startGame(
      this.roomId(),
      this.selectedDuration(),
      this.selectedRefreshMs(),
      this.selectedDangerColor(),
    );
  }

  tapTile(index: number) {
    if (this.phase() !== 'playing') return;
    this.audio.playClick();
    this.socketService.tapTile(this.roomId(), index);
  }

  copyRoomId() {
    navigator.clipboard?.writeText(this.roomId());
  }

  playAgain() {
    this.fullscreen.enter();
    this.socketService.playAgain(this.roomId());
  }

  leaveRoom() {
    this.socketService.disconnect();
    this.gameState.reset();
    this.router.navigate(['/']);
  }
}
