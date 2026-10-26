import { Service, inject } from '@angular/core';
import { io, Socket as IOSocket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { GameState } from './game-state';
import { GamePhase, GridTile, Player, TapResult, TileColor } from '../models/game.models';

interface CreateRoomResponse {
  roomId: string;
  players: Player[];
  isSolo?: boolean;
  error?: string;
}

interface JoinRoomResponse {
  roomId: string;
  players: Player[];
  error?: string;
}

interface ResyncResponse {
  error?: string;
  gameState?: GamePhase;
  players?: Player[];
  grid?: GridTile[];
  timeLeft?: number;
  durationSeconds?: number;
  refreshMs?: number;
  dangerColor?: TileColor;
  isSolo?: boolean;
}

export interface VoiceSignalMessage {
  from: string;
  signal: unknown;
}

interface VoiceJoinResponse {
  error?: string;
  peers?: string[];
}

// Survives a dropped connection even though socket.id doesn't, so a
// reconnecting client can prove to the server "I'm the same player who just
// got cut off" and reclaim their seat instead of the server treating them as
// a stranger. sessionStorage (not localStorage) is deliberate: a new tab is a
// new session, but a refresh or a brief network drop within the same tab
// isn't.
function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem('dtp_session_id');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem('dtp_session_id', fresh);
    return fresh;
  } catch {
    return crypto.randomUUID(); // storage unavailable - still works for this connection's lifetime
  }
}

@Service()
export class Socket {
  private readonly gameState = inject(GameState);
  private socket: IOSocket | null = null;
  private readonly sessionId = getSessionId();
  private hasConnectedBefore = false;
  private voiceSignalHandler: ((msg: VoiceSignalMessage) => void) | null = null;

  private ensureConnected(): IOSocket {
    if (!this.socket) {
      this.socket = io(environment.serverUrl, { autoConnect: true });
      this.registerListeners(this.socket);
    }
    return this.socket;
  }

  private registerListeners(socket: IOSocket) {
    socket.on('connect', () => {
      this.gameState.mySocketId.set(socket.id ?? '');
      if (this.hasConnectedBefore) {
        this.attemptResync();
      } else {
        this.hasConnectedBefore = true;
      }
    });

    // 'io client disconnect' is our own explicit Leave/disconnect() call -
    // nothing to reconnect to, so no "reconnecting" banner for that one.
    // Everything else (dropped wifi, backgrounded tab, mobile data handoff)
    // gets one, since Socket.io will keep retrying in the background anyway.
    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      this.gameState.connectionStatus.set('reconnecting');
    });

    socket.on('config', ({ voiceChatEnabled }: { voiceChatEnabled: boolean }) => {
      this.gameState.voiceChatEnabled.set(voiceChatEnabled);
    });

    socket.on('voicePeerJoined', ({ socketId }: { socketId: string }) => {
      this.gameState.voicePeerIds.update((ids) => new Set(ids).add(socketId));
    });

    socket.on('voicePeerLeft', ({ socketId }: { socketId: string }) => {
      this.gameState.voicePeerIds.update((ids) => {
        const next = new Set(ids);
        next.delete(socketId);
        return next;
      });
    });

    socket.on('voiceSignal', (msg: VoiceSignalMessage) => {
      this.voiceSignalHandler?.(msg);
    });

    socket.on('playerJoined', ({ players }: { players: Player[] }) => {
      this.gameState.players.set(players);
    });

    socket.on('playerLeft', ({ players }: { players: Player[] }) => {
      this.gameState.players.set(players);
    });

    socket.on('playerConnectionLost', ({ socketId }: { socketId: string }) => {
      this.gameState.disconnectedPlayerIds.update((ids) => new Set(ids).add(socketId));
    });

    socket.on('playerReconnected', ({ previousSocketId, players }: { previousSocketId: string; players: Player[] }) => {
      this.gameState.players.set(players);
      this.gameState.disconnectedPlayerIds.update((ids) => {
        const next = new Set(ids);
        next.delete(previousSocketId);
        return next;
      });
    });

    socket.on(
      'gameStarted',
      ({
        grid,
        timeLeft,
        durationSeconds,
        refreshMs,
        dangerColor,
        isSolo,
      }: {
        grid: GridTile[];
        timeLeft: number;
        durationSeconds: number;
        refreshMs: number;
        dangerColor: TileColor;
        isSolo: boolean;
      }) => {
        this.gameState.grid.set(grid);
        this.gameState.timeLeft.set(timeLeft);
        this.gameState.durationSeconds.set(durationSeconds);
        this.gameState.refreshMs.set(refreshMs);
        this.gameState.dangerColor.set(dangerColor);
        this.gameState.isSolo.set(isSolo);
        this.gameState.phase.set('playing');
      },
    );

    socket.on('syncGrid', ({ grid }: { grid: GridTile[] }) => {
      this.gameState.grid.set(grid);
    });

    socket.on('timerUpdate', ({ timeLeft }: { timeLeft: number }) => {
      this.gameState.timeLeft.set(timeLeft);
    });

    socket.on(
      'scoreUpdate',
      ({ socketId, players, tap }: { socketId: string; players: Player[]; tap: Omit<TapResult, 'socketId'> }) => {
        this.gameState.players.set(players);
        this.gameState.lastTap.set({ ...tap, socketId });
      },
    );

    socket.on('gameOver', ({ players }: { players: Player[] }) => {
      this.gameState.players.set(players);
      this.gameState.disconnectedPlayerIds.set(new Set());
      this.gameState.phase.set('finished');
    });

    socket.on('roomReset', ({ players }: { players: Player[] }) => {
      this.gameState.players.set(players);
      this.gameState.disconnectedPlayerIds.set(new Set());
      this.gameState.grid.set([]);
      this.gameState.lastTap.set(null);
      this.gameState.phase.set('waiting');
    });
  }

  // Called whenever the socket reconnects after the very first connection -
  // asks the server to restore whatever room/score/grid state this tab had
  // before the drop.
  private attemptResync() {
    const roomId = this.gameState.roomId();
    if (!roomId) {
      this.gameState.connectionStatus.set('online');
      return;
    }
    this.performResync(roomId);
  }

  // Public entry point for a page LOAD landing directly on a /room/:id URL
  // with no live app state at all - a reload mid-match wipes every Angular
  // signal, including gameState.roomId, so the room id has to come from the
  // URL instead. sessionId survives in sessionStorage across the reload, so
  // if the server is still holding this seat open (the same grace window a
  // network drop gets), the match resumes instead of just being abandoned.
  // Returns whether the session actually resumed.
  resumeSession(roomId: string): Promise<boolean> {
    return this.performResync(roomId);
  }

  // If too much time has passed (or there's nothing to recover), the match
  // is gone for good and the caller is responsible for sending the player
  // back home.
  private async performResync(roomId: string): Promise<boolean> {
    const res = await this.resync(roomId);
    if (res.error) {
      this.gameState.errorMessage.set('Your match ended while you were disconnected.');
      this.gameState.reset();
      return false;
    }

    this.gameState.roomId.set(roomId);
    this.gameState.players.set(res.players ?? []);
    if (res.gameState) this.gameState.phase.set(res.gameState);
    if (res.grid) this.gameState.grid.set(res.grid);
    if (res.timeLeft !== undefined) this.gameState.timeLeft.set(res.timeLeft);
    if (res.durationSeconds !== undefined) this.gameState.durationSeconds.set(res.durationSeconds);
    if (res.refreshMs !== undefined) this.gameState.refreshMs.set(res.refreshMs);
    if (res.dangerColor) this.gameState.dangerColor.set(res.dangerColor);
    if (res.isSolo !== undefined) this.gameState.isSolo.set(res.isSolo);
    this.gameState.connectionStatus.set('online');
    return true;
  }

  private resync(roomId: string): Promise<ResyncResponse> {
    const socket = this.ensureConnected();
    return new Promise((resolve) => {
      socket.emit('resync', { roomId, sessionId: this.sessionId }, (res: ResyncResponse) => resolve(res));
    });
  }

  createRoom(name: string, solo = false): Promise<CreateRoomResponse> {
    const socket = this.ensureConnected();
    this.gameState.playerName.set(name);
    return new Promise((resolve) => {
      socket.emit('createRoom', { name, solo, sessionId: this.sessionId }, (res: CreateRoomResponse) => resolve(res));
    });
  }

  joinRoom(roomId: string, name: string): Promise<JoinRoomResponse> {
    const socket = this.ensureConnected();
    this.gameState.playerName.set(name);
    return new Promise((resolve) => {
      socket.emit('joinRoom', { roomId, name, sessionId: this.sessionId }, (res: JoinRoomResponse) => resolve(res));
    });
  }

  startGame(roomId: string, durationSeconds: number, refreshMs: number, dangerColor: TileColor) {
    this.socket?.emit('startGame', { roomId, durationSeconds, refreshMs, dangerColor });
  }

  tapTile(roomId: string, index: number) {
    this.socket?.emit('tapTile', { roomId, index });
  }

  playAgain(roomId: string) {
    this.socket?.emit('playAgain', { roomId });
  }

  // Registers the Voice service's handler for incoming WebRTC signaling
  // messages. Stored as a plain field rather than a socket.io listener owned
  // by Voice directly, keeping this service the single thing that ever talks
  // to socket.io-client (consistent with how every other event here works).
  onVoiceSignal(handler: (msg: VoiceSignalMessage) => void) {
    this.voiceSignalHandler = handler;
  }

  joinVoiceChannel(roomId: string): Promise<VoiceJoinResponse> {
    const socket = this.ensureConnected();
    return new Promise((resolve) => {
      socket.emit('voiceJoin', { roomId }, (res: VoiceJoinResponse) => resolve(res));
    });
  }

  leaveVoiceChannel(roomId: string) {
    this.socket?.emit('voiceLeave', { roomId });
  }

  emitVoiceSignal(roomId: string, to: string, signal: unknown) {
    this.socket?.emit('voiceSignal', { roomId, to, signal });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
