import { Service } from '@angular/core';

// Synthesized via the Web Audio API — no external sound files needed.
// Mimics the tactile click + success/error chimes of a physical light-up
// reflex board game.
@Service()
export class Audio {
  private ctx: AudioContext | null = null;

  // Lazily created on the first user gesture (a tile tap), since browsers
  // block audio contexts from starting before any user interaction.
  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(freq: number, startOffset: number, duration: number, type: OscillatorType, peakGain: number) {
    const ctx = this.getContext();
    const start = ctx.currentTime + startOffset;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peakGain, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** Short tactile click on every tile press, like a physical arcade button. */
  playClick() {
    try {
      this.tone(520, 0, 0.05, 'square', 0.12);
    } catch {
      // Audio is a nice-to-have; never let it break gameplay.
    }
  }

  /** Bright ascending chime on a successful tap; pitch rises with the combo multiplier. */
  playSuccess(multiplier: number) {
    try {
      const base = 523.25; // C5
      this.tone(base, 0, 0.09, 'sine', 0.15);
      this.tone(base * Math.pow(2, Math.min(multiplier, 5) / 12), 0.06, 0.12, 'sine', 0.15);
    } catch {
      // Audio is a nice-to-have; never let it break gameplay.
    }
  }

  /** Harsh low buzzer for touching purple. */
  playBuzz() {
    try {
      this.tone(110, 0, 0.22, 'sawtooth', 0.14);
      this.tone(98, 0.03, 0.22, 'square', 0.1);
    } catch {
      // Audio is a nice-to-have; never let it break gameplay.
    }
  }
}
