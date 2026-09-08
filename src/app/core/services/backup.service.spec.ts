import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BackupService } from './backup.service';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { ToastService } from './toast.service';
import { DecryptedVault, VaultEntry } from '../models/vault.model';
import { serializeCanonicalJson, computeSha256Hex } from '../crypto/serializer';
import { VaultBackupFile } from '../crypto/crypto.types';

describe('BackupService (Encrypted Import/Export & Conflict-Free Merging)', () => {
  let backupService: BackupService;
  let vaultService: VaultService;
  let storageService: StorageService;
  let cryptoService: CryptoService;

  const testMasterPassword = 'MyBackupMasterPassword2026!';
  const testVaultName = 'Backup Test Vault';

  beforeEach(async () => {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [
        BackupService,
        VaultService,
        StorageService,
        CryptoService,
        ToastService
      ]
    });

    backupService = TestBed.inject(BackupService);
    vaultService = TestBed.inject(VaultService);
    storageService = TestBed.inject(StorageService);
    cryptoService = TestBed.inject(CryptoService);

    await storageService.deleteVault();
  });

  it('should throw error when attempting to export while vault is locked', async () => {
    expect(vaultService.isLocked()).toBe(true);
    await expect(backupService.generateBackupFile()).rejects.toThrow('Vault must be unlocked to export a backup.');
  });

  it('should generate an authenticated backup file with valid checksum when unlocked', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    expect(vaultService.isLocked()).toBe(false);

    const { filename, blob, backup } = await backupService.generateBackupFile();

    expect(filename).toMatch(/^zerovault_backup_\d{4}-\d{2}-\d{2}.*\.zerovault$/);
    expect(blob.size).toBeGreaterThan(100);
    expect(backup.magic).toBe('ZERO_VAULT_BACKUP');
    expect(backup.version).toBe(1);
    expect(backup.app).toBe('ZeroVault');

    // Verify SHA-256 integrity hash matches canonical envelope
    const canonical = serializeCanonicalJson(backup.envelope);
    const expectedHash = await computeSha256Hex(canonical);
    expect(backup.checksumSha256).toBe(expectedHash);
  });

  it('should parse and strictly validate a valid backup file string', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const { backup } = await backupService.generateBackupFile();
    const json = JSON.stringify(backup);

    const parsed = await backupService.parseBackupFile(json);
    expect(parsed.magic).toBe('ZERO_VAULT_BACKUP');
    expect(parsed.checksumSha256).toBe(backup.checksumSha256);
  });

  it('should reject backup with invalid magic identifier', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const { backup } = await backupService.generateBackupFile();
    const bad = { ...backup, magic: 'INVALID_MAGIC' };

    await expect(backupService.parseBackupFile(JSON.stringify(bad))).rejects.toThrow('Unrecognized magic header');
  });

  it('should reject backup with tampered or mismatched SHA-256 checksum', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const { backup } = await backupService.generateBackupFile();
    const tampered = { ...backup, checksumSha256: 'deadbeef00000000000000000000000000000000000000000000000000000000' };

    await expect(backupService.parseBackupFile(JSON.stringify(tampered))).rejects.toThrow('Integrity check failed');
  });

  it('should reject backup when KDF parameters are below security floor', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const { backup } = await backupService.generateBackupFile();

    const weakened = JSON.parse(JSON.stringify(backup)) as VaultBackupFile;
    weakened.envelope.kdf.params.memory = 1024; // 1 MiB is far below 32 MiB floor
    // Recalculate checksum so it passes checksum check and fails KDF floor check
    weakened.checksumSha256 = await computeSha256Hex(serializeCanonicalJson(weakened.envelope));

    await expect(backupService.parseBackupFile(JSON.stringify(weakened))).rejects.toThrow('Insecure KDF parameters');
  });

  it('should decrypt backup with correct password and reject wrong password', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);
    const { backup } = await backupService.generateBackupFile();

    // Correct password
    const decrypted = await backupService.decryptBackup(backup, testMasterPassword);
    expect(decrypted.vaultName).toBe(testVaultName);
    expect(decrypted.schemaVersion).toBe(1);

    // Incorrect password
    await expect(backupService.decryptBackup(backup, 'WrongPassword123!')).rejects.toThrow('Incorrect master password');
  });

  it('should apply import with overwrite strategy replacing all entries', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);

    // Add initial entry
    await vaultService.updateVault(v => ({
      ...v,
      entries: [
        {
          id: 'old-1',
          category: 'login',
          title: 'Old Entry',
          website: 'https://old.com',
          username: 'olduser',
          password: 'oldpassword',
          notes: '',
          favorite: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }));

    const mockImportedVault: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'imported-vault-id',
      vaultName: 'Imported Vault',
      revision: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      categories: ['login'],
      entries: [
        {
          id: 'new-1',
          category: 'login',
          title: 'New Entry 1',
          website: 'https://new1.com',
          username: 'user1',
          password: 'pass1',
          notes: '',
          favorite: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'new-2',
          category: 'secure_note',
          title: 'Secret Note',
          website: '',
          username: '',
          password: 'secret-content',
          notes: 'important notes',
          favorite: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const result = await backupService.applyImport(mockImportedVault, 'overwrite');
    expect(result.added).toBe(2);
    expect(result.total).toBe(2);

    const activeEntries = vaultService.entries();
    expect(activeEntries.length).toBe(2);
    expect(activeEntries.some(e => e.id === 'old-1')).toBe(false);
    expect(activeEntries.some(e => e.id === 'new-1')).toBe(true);
  });

  it('should apply import with merge strategy resolving duplicates by updatedAt and adding new entries', async () => {
    await vaultService.createVault(testVaultName, testMasterPassword);

    const now = Date.now();
    const olderTime = new Date(now - 100000).toISOString();
    const newerTime = new Date(now + 100000).toISOString();
    const middleTime = new Date(now).toISOString();

    // Vault has:
    // 1. Entry 'dup-1' with middleTime
    // 2. Entry 'dup-2' with newerTime
    // 3. Entry 'unique-existing'
    await vaultService.updateVault(v => ({
      ...v,
      entries: [
        {
          id: 'dup-1',
          category: 'login',
          title: 'GitHub',
          website: 'https://github.com',
          username: 'alex',
          password: 'current-password',
          notes: 'current notes',
          favorite: false,
          createdAt: olderTime,
          updatedAt: middleTime
        },
        {
          id: 'dup-2',
          category: 'login',
          title: 'Google',
          website: 'https://google.com',
          username: 'alex@example.com',
          password: 'newer-local-password',
          notes: 'local is newer',
          favorite: true,
          createdAt: olderTime,
          updatedAt: newerTime
        },
        {
          id: 'unique-existing',
          category: 'secure_note',
          title: 'My Local Note',
          website: '',
          username: '',
          password: 'secret',
          notes: '',
          favorite: false,
          createdAt: middleTime,
          updatedAt: middleTime
        }
      ]
    }));

    // Imported vault has:
    // 1. Match for 'dup-1' with newerTime -> should update!
    // 2. Match for 'dup-2' with olderTime -> should skip!
    // 3. New entry 'brand-new' -> should add!
    const mockImportedVault: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'imported-id',
      vaultName: 'Imported',
      revision: 10,
      createdAt: olderTime,
      updatedAt: newerTime,
      categories: ['login'],
      entries: [
        {
          id: 'dup-1',
          category: 'login',
          title: 'GitHub',
          website: 'https://github.com',
          username: 'alex',
          password: 'updated-imported-password',
          notes: 'updated from backup',
          favorite: true,
          createdAt: olderTime,
          updatedAt: newerTime
        },
        {
          id: 'dup-2',
          category: 'login',
          title: 'Google',
          website: 'https://google.com',
          username: 'alex@example.com',
          password: 'stale-backup-password',
          notes: 'stale',
          favorite: false,
          createdAt: olderTime,
          updatedAt: olderTime
        },
        {
          id: 'brand-new',
          category: 'server',
          title: 'Production Server',
          website: 'ssh://server.com',
          username: 'root',
          password: 'root-password',
          notes: '',
          favorite: false,
          createdAt: middleTime,
          updatedAt: middleTime
        }
      ]
    };

    const result = await backupService.applyImport(mockImportedVault, 'merge');
    expect(result.added).toBe(1);   // brand-new
    expect(result.updated).toBe(1); // dup-1 updated
    expect(result.skipped).toBe(1); // dup-2 skipped because local was newer
    expect(result.total).toBe(4);   // 3 original + 1 added

    const entries = vaultService.entries();
    const github = entries.find(e => e.id === 'dup-1');
    expect(github?.password).toBe('updated-imported-password');
    expect(github?.notes).toBe('updated from backup');

    const google = entries.find(e => e.id === 'dup-2');
    expect(google?.password).toBe('newer-local-password');

    const server = entries.find(e => e.id === 'brand-new');
    expect(server).toBeDefined();
    expect(server?.title).toBe('Production Server');
  });
});
