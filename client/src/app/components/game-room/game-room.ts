import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Socket } from '../../services/socket';
import { GameState } from '../../services/game-state';
import { Audio } from '../../services/audio';
import { Fullscreen } from '../../services/fullscreen';
import { Voice } from '../../services/voice';
import {
  BASE_POINTS,
  COLOR_OPTIONS,
  DEFAULT_DANGER_COLOR,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_REFRESH_MS,
  DURATION_OPTIONS,
  MAX_PLAYERS,
  multiplierForCombo,
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
  readonly voice = inject(Voice);

  readonly shakeActive = signal(false);
  readonly floatingTap = signal<{ index: number; text: string; color: string } | null>(null);
  readonly statusCallout = signal<{ text: string; color: string } | null>(null);
  private shakeTimeout?: ReturnType<typeof setTimeout>;
  private floatTimeout?: ReturnType<typeof setTimeout>;
  private statusCalloutTimeout?: ReturnType<typeof setTimeout>;

  // In the heat of the moment players mash "Play Again" or "Leave" the
  // instant the round ends, before anyone (including themselves) has
  // actually seen the final standings - and since any player can trigger
  // "Play Again", one trigger-happy click wipes the leaderboard for the whole
  // room. A short forced look-time fixes both: both result-screen buttons
  // stay disabled until it elapses.
  private static readonly PLAY_AGAIN_DELAY_SECONDS = 4;
  readonly playAgainUnlockIn = signal(0);
  private playAgainInterval?: ReturnType<typeof setInterval>;

  // A fresh page load (e.g. a reload mid-match) starts with phase() at its
  // default 'home' value while the async session-resume check in ngOnInit is
  // still in flight - without this guard, the "redirect home" effect below
  // would fire on that transient initial value and race ahead of the resume
  // attempt, kicking the player out before resync even gets a chance to
  // prove the match is still recoverable. A signal (not a plain flag) is
  // required here: when resync fails, phase ends up back at 'home' - the same
  // value it started at - so phase() alone never "changes" from the effect's
  // point of view, and only a tracked signal flip reliably re-triggers it.
  private readonly sessionChecked = signal(false);

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
  readonly connectionStatus = this.gameState.connectionStatus;
  readonly disconnectedPlayerIds = this.gameState.disconnectedPlayerIds;
  readonly voiceChatEnabled = this.gameState.voiceChatEnabled;
  readonly voicePeerIds = this.gameState.voicePeerIds;
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

    // Only ever drives OTHER players' feedback now - my own tap's floating
    // number/shake/sound fire immediately and optimistically from tapTile()
    // itself (see showOptimisticTapFeedback), rather than waiting on this
    // round-tripped broadcast. Measured on production: tap-to-scoreUpdate
    // latency runs ~140ms at the median and up to ~380ms at the tail, which a
    // reflex game's players notice; a prediction the server almost always
    // agrees with feels instant regardless of that network variance.
    effect(() => {
      const tap = this.gameState.lastTap();
      if (!tap || tap.socketId === this.gameState.mySocketId()) return;

      const tapper = this.players().find((p) => p.socketId === tap.socketId);
      const label = (tapper?.name ?? 'Someone').toUpperCase();

      if (tap.hitDanger) {
        this.statusCallout.set({ text: `${label} HIT ${this.dangerColorLabel()}!`, color: `var(--${this.gameState.dangerColor()})` });
      } else {
        this.statusCallout.set({ text: `${label} +${tap.pointsAwarded}`, color: 'var(--neon-green)' });
      }
      clearTimeout(this.statusCalloutTimeout);
      this.statusCalloutTimeout = setTimeout(() => this.statusCallout.set(null), 1200);
    });

    effect(() => {
      if (this.phase() === 'finished') {
        this.startPlayAgainCountdown();
      } else {
        this.clearPlayAgainCountdown();
      }
    });

    // A failed resync after reconnecting (session expired, match already
    // over) resets gameState.phase to 'home' out from under this still-mounted
    // component - without this, the player would just stare at a dead,
    // frozen game screen instead of landing back at the home screen.
    effect(() => {
      if (this.sessionChecked() && this.phase() === 'home') {
        this.router.navigate(['/']);
      }
    });
  }

  private startPlayAgainCountdown() {
    this.clearPlayAgainCountdown();
    this.playAgainUnlockIn.set(GameRoom.PLAY_AGAIN_DELAY_SECONDS);
    this.playAgainInterval = setInterval(() => {
      const next = this.playAgainUnlockIn() - 1;
      if (next <= 0) {
        this.clearPlayAgainCountdown();
      } else {
        this.playAgainUnlockIn.set(next);
      }
    }, 1000);
  }

  private clearPlayAgainCountdown() {
    clearInterval(this.playAgainInterval);
    this.playAgainInterval = undefined;
    this.playAgainUnlockIn.set(0);
  }

  async ngOnInit() {
    const routeRoomId = this.route.snapshot.paramMap.get('roomId');
    if (!routeRoomId) {
      this.router.navigate(['/']);
      return;
    }
    if (this.gameState.roomId() === routeRoomId) {
      this.sessionChecked.set(true); // live state already matches - normal in-app navigation into this room
      return;
    }

    // No live state for this room - most likely a reload mid-match, which
    // wipes every Angular signal. The room id survives in the URL itself, so
    // try to resume the session (the server holds a dropped seat open for a
    // grace window, same as a network drop) before giving up on it. Either
    // way, the "redirect home" effect above takes it from here: phase() will
    // be a real in-game value on success, or back at 'home' on failure.
    await this.socketService.resumeSession(routeRoomId);
    this.sessionChecked.set(true);
  }

  ngOnDestroy() {
    clearTimeout(this.shakeTimeout);
    clearTimeout(this.floatTimeout);
    clearTimeout(this.statusCalloutTimeout);
    clearInterval(this.playAgainInterval);

    // Navigating away any way other than the explicit Leave button - browser
    // back/forward, typing a new URL - never called disconnect(), so the
    // player stayed fully connected and fully counted server-side (even
    // still the host, silently blocking everyone else from starting the
    // match) while their own screen had already moved on with no way back.
    // This is treated as a deliberate departure (immediate, no reconnection
    // grace period) same as the Leave button - distinct from an involuntary
    // network drop or a reload, which still get their grace window.
    if (this.gameState.roomId()) {
      this.socketService.disconnect();
      this.gameState.reset();
    }
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

    // The client already has the exact grid the server is holding (it's what
    // renders the tile's color on screen), so a currently-lit tile's outcome
    // is fully predictable without waiting for the round trip. A dull tile
    // might still be within the server's tap-grace window (see
    // server/src/index.js's MAX_TAP_GRACE_MS) - the client has no way to know
    // that, so it just waits for the real result in that one case.
    const color = this.grid()[index];
    if (color) {
      this.showOptimisticTapFeedback(index, color);
    }

    this.socketService.tapTile(this.roomId(), index);
  }

  private showOptimisticTapFeedback(index: number, color: TileColor) {
    const dangerColor = this.gameState.dangerColor();
    if (color === dangerColor) {
      this.shakeActive.set(true);
      clearTimeout(this.shakeTimeout);
      this.shakeTimeout = setTimeout(() => this.shakeActive.set(false), 400);
      this.floatingTap.set({ index, text: '-50', color: `var(--${dangerColor})` });
      this.audio.playBuzz();
      // The danger case also gets the named banner (previously driven by the
      // round-tripped lastTap effect for every tap, self included) - without
      // this, hitting the danger color yourself loses its "YOU HIT PURPLE!"
      // callout entirely now that self-feedback no longer waits on that effect.
      this.statusCallout.set({ text: `YOU HIT ${this.dangerColorLabel()}!`, color: `var(--${dangerColor})` });
      clearTimeout(this.statusCalloutTimeout);
      this.statusCalloutTimeout = setTimeout(() => this.statusCallout.set(null), 1200);
    } else {
      const multiplier = multiplierForCombo((this.me()?.combo ?? 0) + 1);
      const pointsAwarded = BASE_POINTS * multiplier;
      const multiplierLabel = multiplier > 1 ? ` x${multiplier}` : '';
      this.floatingTap.set({ index, text: `+${pointsAwarded}${multiplierLabel}`, color: 'var(--neon-green)' });
      this.audio.playSuccess(multiplier);
    }
    clearTimeout(this.floatTimeout);
    this.floatTimeout = setTimeout(() => this.floatingTap.set(null), 700);
  }

  copyRoomId() {
    navigator.clipboard?.writeText(this.roomId());
  }

  toggleVoice() {
    if (this.voice.joined()) {
      this.voice.leave(this.roomId());
    } else {
      this.voice.join(this.roomId());
    }
  }

  playAgain() {
    if (this.playAgainUnlockIn() > 0) return;
    this.fullscreen.enter();
    this.socketService.playAgain(this.roomId());
  }

  leaveRoom() {
    if (this.playAgainUnlockIn() > 0) return;
    this.socketService.disconnect();
    this.gameState.reset();
    this.router.navigate(['/']);
  }
}
