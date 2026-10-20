import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Socket } from '../../services/socket';
import { GameState } from '../../services/game-state';
import { DEFAULT_DURATION_SECONDS, DEFAULT_REFRESH_MS } from '../../models/game.models';

type Mode = 'menu' | 'create' | 'join';

@Component({
  imports: [FormsModule],
  selector: 'app-home',
  styleUrl: './home.css',
  templateUrl: './home.html',
})
export class Home {
  private readonly socketService = inject(Socket);
  private readonly gameState = inject(GameState);
  private readonly router = inject(Router);

  readonly mode = signal<Mode>('menu');
  readonly name = signal('');
  readonly joinRoomId = signal('');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  showCreate() {
    this.error.set(null);
    this.mode.set('create');
  }

  showJoin() {
    this.error.set(null);
    this.mode.set('join');
  }

  backToMenu() {
    this.error.set(null);
    this.mode.set('menu');
  }

  async createRoom() {
    const name = this.name().trim();
    if (!name) {
      this.error.set('Enter a username first.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    const res = await this.socketService.createRoom(name);
    this.busy.set(false);

    if (res.error) {
      this.error.set(res.error);
      return;
    }

    this.gameState.roomId.set(res.roomId);
    this.gameState.players.set(res.players);
    this.gameState.phase.set('waiting');
    this.router.navigate(['/room', res.roomId]);
  }

  async joinRoom() {
    const name = this.name().trim();
    const roomId = this.joinRoomId().trim().toUpperCase();
    if (!name) {
      this.error.set('Enter a username first.');
      return;
    }
    if (!roomId) {
      this.error.set('Enter a room ID.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    const res = await this.socketService.joinRoom(roomId, name);
    this.busy.set(false);

    if (res.error) {
      this.error.set(res.error);
      return;
    }

    this.gameState.roomId.set(res.roomId);
    this.gameState.players.set(res.players);
    this.gameState.phase.set('waiting');
    this.router.navigate(['/room', res.roomId]);
  }

  async playSolo() {
    this.busy.set(true);
    this.error.set(null);
    const name = this.name().trim() || 'Player 1';
    const res = await this.socketService.createRoom(name, true);

    if (res.error) {
      this.busy.set(false);
      this.error.set(res.error);
      return;
    }

    this.gameState.roomId.set(res.roomId);
    this.gameState.players.set(res.players);
    this.socketService.startGame(res.roomId, DEFAULT_DURATION_SECONDS, DEFAULT_REFRESH_MS);
    this.busy.set(false);
    this.router.navigate(['/room', res.roomId]);
  }
}
