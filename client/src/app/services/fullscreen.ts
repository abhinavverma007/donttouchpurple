import { Service, signal } from '@angular/core';

// Wraps the browser Fullscreen API so players can hide tabs/address bar/
// notifications while playing. Chrome (desktop and Android) supports the
// unprefixed standard API used here.
@Service()
export class Fullscreen {
  readonly isSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  readonly isActive = signal(!!document?.fullscreenElement);

  constructor() {
    document.addEventListener('fullscreenchange', () => {
      this.isActive.set(!!document.fullscreenElement);
    });
  }

  async toggle() {
    if (!this.isSupported) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browsers reject this outside a direct user gesture or if denied;
      // isActive just stays whatever it already was.
    }
  }
}
