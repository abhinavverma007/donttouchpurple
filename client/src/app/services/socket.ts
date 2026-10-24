import { Service, inject } from '@angular/core';
import { io, Socket as IOSocket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { GameState } from './game-state';
import { GridTile, Player, TapResult, TileColor } from '../models/game.models';

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

@Service()
export class Socket {
  private readonly gameState = inject(GameState);
  private socket: IOSocket | null = null;

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
    });

    socket.on('playerJoined', ({ players }: { players: Player[] }) => {
      this.gameState.players.set(players);
    });

    socket.on('playerLeft', ({ players }: { players: Player[] }) => {
      this.gameState.players.set(players);
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

    socket.on('scoreUpdate', ({ players, tap }: { players: Player[]; tap: TapResult }) => {
      this.gameState.players.set(players);
      this.gameState.lastTap.set(tap);
    });

    socket.on('gameOver', ({ players }: { players: Player[] }) => {
      this.gameState.players.set(players);
      this.gameState.phase.set('finished');
    });

    socket.on('roomReset', ({ players }: { players: Player[] }) => {
      this.gameState.players.set(players);
      this.gameState.grid.set([]);
      this.gameState.lastTap.set(null);
      this.gameState.phase.set('waiting');
    });
  }

  createRoom(name: string, solo = false): Promise<CreateRoomResponse> {
    const socket = this.ensureConnected();
    this.gameState.playerName.set(name);
    return new Promise((resolve) => {
      socket.emit('createRoom', { name, solo }, (res: CreateRoomResponse) => resolve(res));
    });
  }

  joinRoom(roomId: string, name: string): Promise<JoinRoomResponse> {
    const socket = this.ensureConnected();
    this.gameState.playerName.set(name);
    return new Promise((resolve) => {
      socket.emit('joinRoom', { roomId, name }, (res: JoinRoomResponse) => resolve(res));
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

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
