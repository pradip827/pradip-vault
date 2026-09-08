import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';

describe('VaultService (Vault Lifecycle & In-Memory Management)', () => {
  let vaultService: VaultService;
  let storageService: StorageService;
  let cryptoService: CryptoService;

  const testMasterPassword = 'MyVaultMasterPassword2026!';
  const testVaultName = 'Secure Personal Vault';

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [VaultService, StorageService, CryptoService]
    });

    vaultService = TestBed.inject(VaultService);
    storageService = TestBed.inject(StorageService);
    cryptoService = TestBed.inject(CryptoService);

    // Reset storage
    await storageService.deleteVault();
  });

  it('should initialize with locked state and no active vault', async () => {
    expect(vaultService.isLocked()).toBe(true);
    expect(vaultService.vault()).toBeNull();
  });

  it('should create and encrypt a new vault, saving it to IndexedDB', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);

    expect(vaultService.isLocked()).toBe(false);
    expect(vaultService.hasExistingVault()).toBe(true);
    expect(vaultService.vault()?.vaultName).toBe(testVaultName);
    expect(vaultService.revision()).toBe(1);

    // Verify envelope is stored in IndexedDB
    const stored = await storageService.loadVaultEnvelope();
    expect(stored).not.toBeNull();
    expect(stored?.kdf.algorithm).toBe('Argon2id');
    expect(stored?.encryption.cipher).toBe('AES-256-GCM');
  });

  it('should lock the vault, clearing decrypted state from memory', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    expect(vaultService.isLocked()).toBe(false);

    vaultService.lockVault();

    expect(vaultService.isLocked()).toBe(true);
    expect(vaultService.vault()).toBeNull();
    expect(vaultService.entries()).toEqual([]);
  });

  it('should unlock an existing vault with the correct master password', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    vaultService.lockVault();

    expect(vaultService.isLocked()).toBe(true);

    await vaultService.unlockVault(testMasterPassword);

    expect(vaultService.isLocked()).toBe(false);
    expect(vaultService.vault()?.vaultName).toBe(testVaultName);
    expect(vaultService.revision()).toBe(1);
  });

  it('should reject unlocking with an incorrect master password', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    vaultService.lockVault();

    await expect(vaultService.unlockVault('WrongPassword123!')).rejects.toThrow(
      'Decryption failed: Incorrect master password or corrupted vault.'
    );

    // Ensure memory remains locked
    expect(vaultService.isLocked()).toBe(true);
    expect(vaultService.vault()).toBeNull();
  });

  it('should increment revision and re-encrypt when saving vault modifications', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    expect(vaultService.revision()).toBe(1);

    await vaultService.saveCurrentVault(testMasterPassword);

    expect(vaultService.revision()).toBe(2);
    const meta = await storageService.getMetadata();
    expect(meta.highestKnownRevision).toBe(2);
  });
});
