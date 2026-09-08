import { Injectable, inject, signal } from '@angular/core';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  private readonly toastService = inject(ToastService);

  // Reactive State Signals
  public readonly isOnline = signal<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  public readonly swRegistered = signal<boolean>(false);
  public readonly swActive = signal<boolean>(false);
  public readonly updateAvailable = signal<boolean>(false);
  public readonly canInstall = signal<boolean>(false);
  public readonly isInstalled = signal<boolean>(false);

  private deferredPrompt: any = null;
  private swRegistration: ServiceWorkerRegistration | null = null;
  private isInitialized = false;

  public init(): void {
    if (this.isInitialized || typeof window === 'undefined') {
      return;
    }
    this.isInitialized = true;

    // 1. Check standalone display mode (installed PWA)
    this.checkStandaloneMode();

    // 2. Connectivity listeners
    window.addEventListener('online', () => {
      this.isOnline.set(true);
      this.toastService.success('Back online.');
    });

    window.addEventListener('offline', () => {
      this.isOnline.set(false);
      this.toastService.warning('Offline mode active. All vault operations remain fully functional.', 5000);
    });

    // 3. Before install prompt listener
    window.addEventListener('beforeinstallprompt', (event: any) => {
      event.preventDefault();
      this.deferredPrompt = event;
      this.canInstall.set(true);
    });

    // 4. App installed listener
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.isInstalled.set(true);
      this.toastService.success('ZeroVault installed successfully!');
    });

    // 5. Register Service Worker
    this.registerServiceWorker();
  }

  private checkStandaloneMode(): void {
    const isStandalone =
      (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
      (typeof navigator !== 'undefined' && (navigator as any)?.standalone === true) ||
      (typeof document !== 'undefined' && typeof document.referrer === 'string' && document.referrer.includes('android-app://'));

    if (isStandalone) {
      this.isInstalled.set(true);
    }
  }

  private registerServiceWorker(): void {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((registration) => {
        this.swRegistration = registration;
        this.swRegistered.set(true);

        if (registration.active) {
          this.swActive.set(true);
        }

        // Check if there is already a waiting worker
        if (registration.waiting) {
          this.updateAvailable.set(true);
        }

        // Listen for new updates
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.updateAvailable.set(true);
              this.toastService.info('An update for ZeroVault is ready. Refresh or tap update in Settings.');
            }
          });
        });
      })
      .catch((error) => {
        console.warn('[PwaService] Service worker registration omitted or failed:', error);
      });

    // Reload or reflect state when controller takes over
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      this.swActive.set(true);
    });
  }

  /**
   * Triggers the native browser install prompt if available
   */
  public async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) {
      return false;
    }

    try {
      this.deferredPrompt.prompt();
      const choice = await this.deferredPrompt.userChoice;
      this.deferredPrompt = null;
      this.canInstall.set(false);
      return choice.outcome === 'accepted';
    } catch {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      return false;
    }
  }

  /**
   * Activates a pending service worker update by posting SKIP_WAITING
   */
  public applyUpdate(): void {
    if (this.swRegistration?.waiting) {
      this.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    window.location.reload();
  }

  /**
   * Manually checks for updates from the service worker registration
   */
  public async checkForUpdate(): Promise<boolean> {
    if (!this.swRegistration) {
      return false;
    }

    try {
      await this.swRegistration.update();
      if (this.swRegistration.waiting) {
        this.updateAvailable.set(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
