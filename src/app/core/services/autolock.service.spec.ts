import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AutoLockService } from './autolock.service';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { ToastService } from './toast.service';

describe('AutoLockService (Inactivity, Tab Visibility & Clipboard Hygiene)', () => {
  let autoLock: AutoLockService;
  let vaultService: VaultService;
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };
  let mockToast: { info: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    localStorage.clear();

    mockRouter = {
      navigate: vi.fn().mockResolvedValue(true)
    };

    mockToast = {
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn()
    };

    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });

    TestBed.configureTestingModule({
      providers: [
        AutoLockService,
        VaultService,
        StorageService,
        CryptoService,
        { provide: Router, useValue: mockRouter },
        { provide: ToastService, useValue: mockToast }
      ]
    });

    vaultService = TestBed.inject(VaultService);
    autoLock = TestBed.inject(AutoLockService);
  });

  afterEach(() => {
    autoLock.stopInactivityTracking();
    autoLock.ngOnDestroy();
    vi.restoreAllMocks();
  });

  it('should initialize with default configurations', () => {
    expect(autoLock.timeoutMinutes()).toBe(5);
    expect(autoLock.lockOnTabHidden()).toBe(false);
    expect(autoLock.clipboardTimeoutSeconds()).toBe(30);
    expect(autoLock.remainingSeconds()).toBe(300);
    expect(autoLock.isClipboardClearingScheduled()).toBe(false);
  });

  it('should format remaining time MM:SS accurately', () => {
    autoLock.remainingSeconds.set(300);
    expect(autoLock.remainingTimeFormatted()).toBe('5:00');

    autoLock.remainingSeconds.set(65);
    expect(autoLock.remainingTimeFormatted()).toBe('1:05');

    autoLock.remainingSeconds.set(9);
    expect(autoLock.remainingTimeFormatted()).toBe('0:09');
  });

  it('should update timeoutMinutes and persist to localStorage', () => {
    autoLock.setTimeoutMinutes(15);
    expect(autoLock.timeoutMinutes()).toBe(15);
    expect(autoLock.remainingSeconds()).toBe(900);
    expect(localStorage.getItem('zerovault_autolock_timeout')).toBe('15');
  });

  it('should clamp timeoutMinutes between 0 and 120', () => {
    autoLock.setTimeoutMinutes(-5);
    expect(autoLock.timeoutMinutes()).toBe(0);

    autoLock.setTimeoutMinutes(300);
    expect(autoLock.timeoutMinutes()).toBe(120);
  });

  it('should update lockOnTabHidden and persist to localStorage', () => {
    autoLock.setLockOnTabHidden(true);
    expect(autoLock.lockOnTabHidden()).toBe(true);
    expect(localStorage.getItem('zerovault_lock_on_hidden')).toBe('true');

    autoLock.setLockOnTabHidden(false);
    expect(autoLock.lockOnTabHidden()).toBe(false);
    expect(localStorage.getItem('zerovault_lock_on_hidden')).toBe('false');
  });

  it('should update clipboardTimeoutSeconds and persist to localStorage', () => {
    autoLock.setClipboardTimeoutSeconds(60);
    expect(autoLock.clipboardTimeoutSeconds()).toBe(60);
    expect(localStorage.getItem('zerovault_clipboard_timeout')).toBe('60');
  });

  it('should trigger lockVault, notify user, and route to /unlock on inactivity', () => {
    const lockSpy = vi.spyOn(vaultService, 'lockVault');

    autoLock.lockDueToInactivity();

    expect(lockSpy).toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith('Vault auto-locked due to inactivity.');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/unlock']);
  });

  it('should trigger lockVault on tab hidden when lockDueToVisibility is invoked', () => {
    const lockSpy = vi.spyOn(vaultService, 'lockVault');

    autoLock.lockDueToVisibility();

    expect(lockSpy).toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith('Vault locked (tab hidden).');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/unlock']);
  });

  it('should trigger lockVault when mobile app enters background', () => {
    const lockSpy = vi.spyOn(vaultService, 'lockVault');

    autoLock.lockDueToBackground();

    expect(lockSpy).toHaveBeenCalled();
    expect(mockToast.info).toHaveBeenCalledWith('Vault locked (app backgrounded).');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/unlock']);
  });

  it('should securely copy text to clipboard and schedule auto-clear countdown', async () => {
    vi.useFakeTimers();
    vaultService.isLocked.set(false);

    await autoLock.copyToClipboard('SuperSecretPassword123!', 'password');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SuperSecretPassword123!');
    expect(mockToast.success).toHaveBeenCalledWith('Copied password (auto-clears in 30s)');
    expect(autoLock.isClipboardClearingScheduled()).toBe(true);
    expect(autoLock.clipboardRemainingSeconds()).toBe(30);

    // Advance by 10s
    await vi.advanceTimersByTimeAsync(10000);
    expect(autoLock.clipboardRemainingSeconds()).toBe(20);

    // Advance remaining 20s to complete clearing
    await vi.advanceTimersByTimeAsync(20000);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
    expect(autoLock.isClipboardClearingScheduled()).toBe(false);

    vi.useRealTimers();
  });

  it('should immediately clear clipboard when executeClipboardClear is called manually', async () => {
    autoLock.scheduleClipboardClear(30);
    expect(autoLock.isClipboardClearingScheduled()).toBe(true);

    await autoLock.executeClipboardClear();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
    expect(mockToast.info).toHaveBeenCalledWith('Clipboard cleared for security');
    expect(autoLock.isClipboardClearingScheduled()).toBe(false);
  });
});
