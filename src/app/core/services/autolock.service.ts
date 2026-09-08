import { Injectable, inject, signal, effect, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { VaultService } from './vault.service';
import { ToastService } from './toast.service';

const STORAGE_KEY_TIMEOUT = 'zerovault_autolock_timeout';
const STORAGE_KEY_LOCK_ON_HIDDEN = 'zerovault_lock_on_hidden';
const STORAGE_KEY_CLIPBOARD_TIMEOUT = 'zerovault_clipboard_timeout';

@Injectable({
  providedIn: 'root'
})
export class AutoLockService implements OnDestroy {
  private readonly vaultService = inject(VaultService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);

  // Configuration Signals (persisted to localStorage)
  public readonly timeoutMinutes = signal<number>(5);
  public readonly lockOnTabHidden = signal<boolean>(false);
  public readonly clipboardTimeoutSeconds = signal<number>(30);

  // Runtime State Signals
  public readonly remainingSeconds = signal<number>(300);
  public readonly isClipboardClearingScheduled = signal<boolean>(false);
  public readonly clipboardRemainingSeconds = signal<number>(0);

  // Internal Timers & Handlers
  private intervalTimerId: ReturnType<typeof setInterval> | null = null;
  private clipboardTimerId: ReturnType<typeof setTimeout> | null = null;
  private clipboardCountdownId: ReturnType<typeof setInterval> | null = null;
  private lastActivityTimestamp = Date.now();
  private isListeningToEvents = false;

  private readonly boundOnUserActivity = this.onUserActivity.bind(this);
  private readonly boundOnVisibilityChange = this.onVisibilityChange.bind(this);

  constructor() {
    this.loadPreferences();

    // React to vault locked/unlocked state transitions
    let previousState: boolean | undefined = undefined;
    effect(() => {
      const isLocked = this.vaultService.isLocked();
      if (!isLocked) {
        this.startInactivityTracking();
      } else {
        this.stopInactivityTracking();
        if (previousState === false) {
          this.clearClipboardTimer();
        }
      }
      previousState = isLocked;
    });

    this.setupBackgroundListener();
  }

  /**
   * Loads saved preferences from localStorage.
   */
  private loadPreferences(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const savedTimeout = localStorage.getItem(STORAGE_KEY_TIMEOUT);
      if (savedTimeout !== null) {
        const parsed = parseInt(savedTimeout, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          this.timeoutMinutes.set(parsed);
          this.remainingSeconds.set(parsed * 60);
        }
      }

      const savedHidden = localStorage.getItem(STORAGE_KEY_LOCK_ON_HIDDEN);
      if (savedHidden !== null) {
        this.lockOnTabHidden.set(savedHidden === 'true');
      }

      const savedClipTimeout = localStorage.getItem(STORAGE_KEY_CLIPBOARD_TIMEOUT);
      if (savedClipTimeout !== null) {
        const parsed = parseInt(savedClipTimeout, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          this.clipboardTimeoutSeconds.set(parsed);
        }
      }
    } catch {
      // Ignore storage access restrictions
    }
  }

  /**
   * Sets the auto-lock timeout duration in minutes. 0 = never.
   */
  public setTimeoutMinutes(minutes: number): void {
    const val = Math.max(0, Math.min(120, minutes));
    this.timeoutMinutes.set(val);
    this.remainingSeconds.set(val * 60);
    this.resetActivity();

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_TIMEOUT, val.toString());
      } catch {}
    }
  }

  /**
   * Toggles whether the vault locks immediately when the browser tab or app is hidden.
   */
  public setLockOnTabHidden(enabled: boolean): void {
    this.lockOnTabHidden.set(enabled);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_LOCK_ON_HIDDEN, enabled ? 'true' : 'false');
      } catch {}
    }
  }

  /**
   * Sets the clipboard clearing countdown duration in seconds. 0 = never.
   */
  public setClipboardTimeoutSeconds(seconds: number): void {
    const val = Math.max(0, Math.min(120, seconds));
    this.clipboardTimeoutSeconds.set(val);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_CLIPBOARD_TIMEOUT, val.toString());
      } catch {}
    }
  }

  /**
   * Starts user activity listeners and 1-second interval countdown timer.
   */
  public startInactivityTracking(): void {
    this.resetActivity();
    this.attachActivityListeners();

    if (this.intervalTimerId) {
      clearInterval(this.intervalTimerId);
    }

    this.ngZone.runOutsideAngular(() => {
      this.intervalTimerId = setInterval(() => {
        if (this.vaultService.isLocked() || this.timeoutMinutes() === 0) {
          return;
        }

        const elapsed = Math.floor((Date.now() - this.lastActivityTimestamp) / 1000);
        const total = this.timeoutMinutes() * 60;
        const left = Math.max(0, total - elapsed);

        this.ngZone.run(() => {
          this.remainingSeconds.set(left);
          if (left === 0) {
            this.lockDueToInactivity();
          }
        });
      }, 1000);
    });
  }

  /**
   * Stops interval countdown and detaches event listeners.
   */
  public stopInactivityTracking(): void {
    if (this.intervalTimerId) {
      clearInterval(this.intervalTimerId);
      this.intervalTimerId = null;
    }
    this.detachActivityListeners();
  }

  /**
   * Attaches event listeners for user input and interaction.
   */
  private attachActivityListeners(): void {
    if (this.isListeningToEvents || typeof window === 'undefined') return;

    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('mousemove', this.boundOnUserActivity, { passive: true });
      window.addEventListener('keydown', this.boundOnUserActivity, { passive: true });
      window.addEventListener('touchstart', this.boundOnUserActivity, { passive: true });
      window.addEventListener('pointerdown', this.boundOnUserActivity, { passive: true });
      window.addEventListener('click', this.boundOnUserActivity, { passive: true });
      window.addEventListener('scroll', this.boundOnUserActivity, { passive: true });

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
      }
    });

    this.isListeningToEvents = true;
  }

  /**
   * Detaches activity event listeners.
   */
  private detachActivityListeners(): void {
    if (!this.isListeningToEvents || typeof window === 'undefined') return;

    window.removeEventListener('mousemove', this.boundOnUserActivity);
    window.removeEventListener('keydown', this.boundOnUserActivity);
    window.removeEventListener('touchstart', this.boundOnUserActivity);
    window.removeEventListener('pointerdown', this.boundOnUserActivity);
    window.removeEventListener('click', this.boundOnUserActivity);
    window.removeEventListener('scroll', this.boundOnUserActivity);

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);
    }

    this.isListeningToEvents = false;
  }

  /**
   * Throttled user activity handler (at most once every 1s).
   */
  private onUserActivity(): void {
    const now = Date.now();
    if (now - this.lastActivityTimestamp >= 1000) {
      this.lastActivityTimestamp = now;
      this.ngZone.run(() => {
        this.remainingSeconds.set(this.timeoutMinutes() * 60);
      });
    }
  }

  /**
   * Visibility change handler for browser tabs.
   */
  private onVisibilityChange(): void {
    if (typeof document === 'undefined') return;

    if (document.hidden && this.lockOnTabHidden() && !this.vaultService.isLocked()) {
      this.ngZone.run(() => {
        this.lockDueToVisibility();
      });
    }
  }

  /**
   * Capacitor native Android app background lifecycle listener.
   */
  private setupBackgroundListener(): void {
    if (Capacitor.isNativePlatform()) {
      try {
        App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive && !this.vaultService.isLocked()) {
            this.ngZone.run(() => {
              this.lockDueToBackground();
            });
          }
        });
      } catch {
        // App listener unavailable
      }
    }
  }

  /**
   * Explicitly resets the idle activity timer.
   */
  public resetActivity(): void {
    this.lastActivityTimestamp = Date.now();
    this.remainingSeconds.set(this.timeoutMinutes() * 60);
  }

  /**
   * Locks the vault due to user inactivity.
   */
  public lockDueToInactivity(): void {
    this.vaultService.lockVault();
    this.toast.info('Vault auto-locked due to inactivity.');
    this.router.navigate(['/unlock']);
  }

  /**
   * Locks the vault due to tab hiding.
   */
  public lockDueToVisibility(): void {
    this.vaultService.lockVault();
    this.toast.info('Vault locked (tab hidden).');
    this.router.navigate(['/unlock']);
  }

  /**
   * Locks the vault due to mobile app entering background.
   */
  public lockDueToBackground(): void {
    this.vaultService.lockVault();
    this.toast.info('Vault locked (app backgrounded).');
    this.router.navigate(['/unlock']);
  }

  /**
   * Securely copies text to the clipboard and starts an auto-clearing timer.
   */
  public async copyToClipboard(text: string, label: string): Promise<void> {
    try {
      if (Capacitor.isNativePlatform()) {
        await Clipboard.write({ string: text });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }

      const timeout = this.clipboardTimeoutSeconds();
      if (timeout > 0) {
        this.toast.success(`Copied ${label} (auto-clears in ${timeout}s)`);
        this.scheduleClipboardClear(timeout);
      } else {
        this.toast.success(`Copied ${label}`);
      }
    } catch {
      this.toast.error(`Failed to copy ${label} to clipboard`);
    }
  }

  /**
   * Schedules clipboard clearing after the specified countdown.
   */
  public scheduleClipboardClear(durationSeconds: number): void {
    this.clearClipboardTimer();

    this.isClipboardClearingScheduled.set(true);
    this.clipboardRemainingSeconds.set(durationSeconds);

    this.clipboardCountdownId = setInterval(() => {
      const left = this.clipboardRemainingSeconds() - 1;
      this.clipboardRemainingSeconds.set(Math.max(0, left));
      if (left <= 0 && this.clipboardCountdownId) {
        clearInterval(this.clipboardCountdownId);
        this.clipboardCountdownId = null;
      }
    }, 1000);

    this.clipboardTimerId = setTimeout(async () => {
      await this.executeClipboardClear();
    }, durationSeconds * 1000);
  }

  /**
   * Overwrites the clipboard with an empty string.
   */
  public async executeClipboardClear(): Promise<void> {
    try {
      if (Capacitor.isNativePlatform()) {
        await Clipboard.write({ string: '' });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText('');
      }
      this.toast.info('Clipboard cleared for security');
    } catch {
      // Ignore clipboard write restrictions when backgrounded
    } finally {
      this.clearClipboardTimer();
    }
  }

  /**
   * Clears any active clipboard clearing timers.
   */
  private clearClipboardTimer(): void {
    if (this.clipboardTimerId) {
      clearTimeout(this.clipboardTimerId);
      this.clipboardTimerId = null;
    }
    if (this.clipboardCountdownId) {
      clearInterval(this.clipboardCountdownId);
      this.clipboardCountdownId = null;
    }
    this.isClipboardClearingScheduled.set(false);
    this.clipboardRemainingSeconds.set(0);
  }

  /**
   * Formats remaining time into MM:SS for display in UI.
   */
  public remainingTimeFormatted(): string {
    const total = this.remainingSeconds();
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  ngOnDestroy(): void {
    this.stopInactivityTracking();
    this.clearClipboardTimer();
  }
}
