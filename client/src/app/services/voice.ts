import { Service, effect, inject, signal } from '@angular/core';
import { Socket, VoiceSignalMessage } from './socket';
import { GameState } from './game-state';

// Google's public STUN server is free and sufficient for discovering a
// peer's public address; there's no TURN relay configured, so two players
// both behind strict/symmetric NATs (common on some mobile carriers or
// corporate networks) may fail to connect directly - a known, accepted
// limitation rather than a bug, since a reliable TURN relay isn't free to run.
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

interface VoiceSignalPayload {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

@Service()
export class Voice {
  private readonly socketService = inject(Socket);
  private readonly gameState = inject(GameState);

  readonly joined = signal(false);
  readonly muted = signal(false);
  readonly error = signal<string | null>(null);

  private localStream: MediaStream | null = null;
  private readonly peerConnections = new Map<string, RTCPeerConnection>();
  private readonly remoteAudioEls = new Map<string, HTMLAudioElement>();

  constructor() {
    this.socketService.onVoiceSignal((msg) => this.handleSignal(msg));

    // Single source of truth for "who should I still have a connection to" -
    // fires whenever anyone joins/leaves voice (including a full room reset,
    // which empties this set entirely and cleans everything up as a result),
    // regardless of which code path caused the change.
    effect(() => {
      const liveIds = this.gameState.voicePeerIds();
      for (const [peerId, pc] of [...this.peerConnections]) {
        if (!liveIds.has(peerId)) this.teardownPeer(peerId, pc);
      }
    });
  }

  async join(roomId: string): Promise<void> {
    if (this.joined() || !this.gameState.voiceChatEnabled()) return;
    this.error.set(null);

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.error.set('Microphone access was denied or unavailable.');
      return;
    }

    const res = await this.socketService.joinVoiceChannel(roomId);
    if (res.error) {
      this.error.set(res.error);
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      return;
    }

    this.joined.set(true);
    this.muted.set(false);
    this.gameState.voicePeerIds.update((ids) => new Set(ids).add(this.gameState.mySocketId()));

    // The newly-joining peer always initiates the offer to everyone already
    // there, so no two sides race to offer each other for the same pair.
    for (const peerId of res.peers ?? []) {
      await this.callPeer(roomId, peerId);
    }
  }

  leave(roomId: string) {
    if (!this.joined()) return;
    this.socketService.leaveVoiceChannel(roomId);
    this.teardownAll();
    this.joined.set(false);
    this.gameState.voicePeerIds.update((ids) => {
      const next = new Set(ids);
      next.delete(this.gameState.mySocketId());
      return next;
    });
  }

  toggleMute() {
    if (!this.localStream) return;
    const next = !this.muted();
    this.localStream.getAudioTracks().forEach((t) => (t.enabled = !next));
    this.muted.set(next);
  }

  private async callPeer(roomId: string, peerId: string) {
    const pc = this.createPeerConnection(roomId, peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socketService.emitVoiceSignal(roomId, peerId, { type: 'offer', sdp: offer.sdp });
  }

  private async handleSignal({ from, signal }: VoiceSignalMessage) {
    const roomId = this.gameState.roomId();
    const msg = signal as VoiceSignalPayload;

    if (msg.type === 'offer') {
      const pc = this.peerConnections.get(from) ?? this.createPeerConnection(roomId, from);
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socketService.emitVoiceSignal(roomId, from, { type: 'answer', sdp: answer.sdp });
      return;
    }

    const pc = this.peerConnections.get(from);
    if (!pc) return;

    if (msg.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } else if (msg.type === 'ice-candidate' && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch {
        // A candidate arriving before the remote description is set is a
        // normal race under real network jitter, not an error worth surfacing.
      }
    }
  }

  private createPeerConnection(roomId: string, peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socketService.emitVoiceSignal(roomId, peerId, { type: 'ice-candidate', candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      let audio = this.remoteAudioEls.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        this.remoteAudioEls.set(peerId, audio);
      }
      audio.srcObject = e.streams[0];
    };

    this.peerConnections.set(peerId, pc);
    return pc;
  }

  private teardownPeer(peerId: string, pc: RTCPeerConnection) {
    pc.close();
    this.peerConnections.delete(peerId);
    const audio = this.remoteAudioEls.get(peerId);
    if (audio) {
      audio.srcObject = null;
      this.remoteAudioEls.delete(peerId);
    }
  }

  private teardownAll() {
    for (const [peerId, pc] of this.peerConnections) this.teardownPeer(peerId, pc);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }
}
