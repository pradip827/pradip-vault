import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { VaultService } from '../../core/services/vault.service';
import { StorageService } from '../../core/services/storage.service';
import { CryptoService } from '../../core/services/crypto.service';
import { BackupService } from '../../core/services/backup.service';
import { AutoLockService } from '../../core/services/autolock.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { PwaService } from '../../core/services/pwa.service';

describe('SettingsComponent (Vault Settings & Encrypted Backup UI)', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let vaultService: VaultService;
  let toastService: ToastService;
  let pwaService: PwaService;

  beforeEach(async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        VaultService,
        StorageService,
        CryptoService,
        BackupService,
        AutoLockService,
        ThemeService,
        ToastService,
        PwaService
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    vaultService = TestBed.inject(VaultService);
    toastService = TestBed.inject(ToastService);
    pwaService = TestBed.inject(PwaService);
    fixture.detectChanges();
  });

  it('should create the settings component', () => {
    expect(component).toBeTruthy();
  });

  it('should prevent export and show warning if vault is locked', () => {
    expect(vaultService.isLocked()).toBe(true);
    component.handleExport();
    expect(component.isExportModalOpen()).toBe(false);
  });

  it('should open export modal if vault is unlocked', async () => {
    await vaultService.createVault('Settings Test Vault', 'ValidMasterPassword123!');
    expect(vaultService.isLocked()).toBe(false);

    component.handleExport();
    expect(component.isExportModalOpen()).toBe(true);
  });

  it('should open import modal and reset import state', () => {
    expect(component.isImportModalOpen()).toBe(false);
    component.handleImport();

    expect(component.isImportModalOpen()).toBe(true);
    expect(component.importStep()).toBe('select_file');
    expect(component.importFileName()).toBe('');
    expect(component.parsedBackup()).toBeNull();
  });

  it('should close import modal and reset state', () => {
    component.handleImport();
    expect(component.isImportModalOpen()).toBe(true);

    component.closeImportModal();
    expect(component.isImportModalOpen()).toBe(false);
    expect(component.importStep()).toBe('select_file');
  });

  it('should update auto-lock timeout preference', () => {
    const mockEvent = {
      target: { value: '15' }
    } as unknown as Event;

    component.handleTimeoutChange(mockEvent);
    expect(component.autoLockService.timeoutMinutes()).toBe(15);
  });

  it('should toggle lock on tab hidden preference', () => {
    const mockEvent = {
      target: { checked: true }
    } as unknown as Event;

    component.handleTabHiddenToggle(mockEvent);
    expect(component.autoLockService.lockOnTabHidden()).toBe(true);
  });

  it('should open drive config modal when connect is clicked without client ID', async () => {
    await component.syncService.setGoogleClientId('');
    expect(component.isDriveConfigOpen()).toBe(false);

    await component.handleDriveConnect();
    expect(component.isDriveConfigOpen()).toBe(true);
  });

  it('should save Google Client ID via drive config modal', async () => {
    component.openDriveConfig();
    expect(component.isDriveConfigOpen()).toBe(true);

    component.tempClientId.set('123456-abcdef.apps.googleusercontent.com');
    await component.saveDriveConfig();

    expect(component.isDriveConfigOpen()).toBe(false);
    expect(component.syncService.googleClientId()).toBe('123456-abcdef.apps.googleusercontent.com');
  });

  it('should handle check for update and notify user via toast', async () => {
    const toastSuccessSpy = vi.spyOn(toastService, 'success');
    vi.spyOn(pwaService, 'checkForUpdate').mockResolvedValue(false);

    await component.handleCheckUpdate();
    expect(toastSuccessSpy).toHaveBeenCalledWith(expect.stringContaining('latest version'));

    const toastInfoSpy = vi.spyOn(toastService, 'info');
    vi.spyOn(pwaService, 'checkForUpdate').mockResolvedValue(true);

    await component.handleCheckUpdate();
    expect(toastInfoSpy).toHaveBeenCalledWith(expect.stringContaining('new update is available'));
  });
});
