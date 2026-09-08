import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SyncService } from './sync.service';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { GoogleDriveService } from './google-drive.service';
import { ToastService } from './toast.service';
import { DecryptedVault, VaultEntry } from '../models/vault.model';

describe('SyncService (3-Way Conflict Resolution & Zero-Knowledge Remote Sync)', () => {
  let syncService: SyncService;
  let vaultService: VaultService;
  let storageService: StorageService;
  let googleDriveService: GoogleDriveService;

  const t0 = '2026-09-08T10:00:00.000Z'; // Base time
  const t1 = '2026-09-08T11:00:00.000Z'; // Middle time
  const t2 = '2026-09-08T12:00:00.000Z'; // Newer time

  const createMockEntry = (id: string, title: string, pass: string, updatedAt: string): VaultEntry => ({
    id,
    category: 'login',
    title,
    website: 'https://example.com',
    username: 'user',
    password: pass,
    notes: '',
    favorite: false,
    createdAt: t0,
    updatedAt
  });

  beforeEach(async () => {
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [
        SyncService,
        VaultService,
        StorageService,
        CryptoService,
        GoogleDriveService,
        ToastService
      ]
    });

    syncService = TestBed.inject(SyncService);
    vaultService = TestBed.inject(VaultService);
    storageService = TestBed.inject(StorageService);
    googleDriveService = TestBed.inject(GoogleDriveService);

    await storageService.deleteVault();
    await storageService.clearSyncData();
  });

  it('should initialize with disconnected state and default status', () => {
    expect(syncService.isConnected()).toBe(false);
    expect(syncService.isSyncing()).toBe(false);
    expect(syncService.syncStatus()).toBe('idle');
  });

  it('should save and persist Google Client ID', async () => {
    await syncService.setGoogleClientId('test-client-id-12345.apps.googleusercontent.com');
    expect(syncService.googleClientId()).toBe('test-client-id-12345.apps.googleusercontent.com');

    const meta = await storageService.loadSyncMetadata();
    expect(meta?.googleClientId).toBe('test-client-id-12345.apps.googleusercontent.com');
  });

  it('should disconnect and reset connection state', () => {
    googleDriveService.setAccessToken('mock-token');
    syncService.isConnected.set(true);

    syncService.disconnect();
    expect(syncService.isConnected()).toBe(false);
    expect(googleDriveService.getAccessToken()).toBeNull();
  });

  // --- 3-Way Merge Engine Tests ---

  it('should fast-forward local additions when not in base and not in remote', () => {
    const base: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'v1',
      vaultName: 'Vault',
      revision: 1,
      createdAt: t0,
      updatedAt: t0,
      categories: ['login'],
      entries: [createMockEntry('e1', 'GitHub', 'pass1', t0)]
    };

    const local: DecryptedVault = {
      ...base,
      revision: 2,
      entries: [
        createMockEntry('e1', 'GitHub', 'pass1', t0),
        createMockEntry('e2', 'Google', 'pass2', t1) // Added locally
      ]
    };

    const remote: DecryptedVault = { ...base };

    const res = syncService.mergeThreeWay(base, local, remote);
    expect(res.added).toBe(1);
    expect(res.vault.entries.length).toBe(2);
    expect(res.vault.entries.some(e => e.id === 'e2')).toBe(true);
    expect(res.vault.revision).toBe(3); // max(2, 1) + 1
  });

  it('should pull remote additions when not in base and not in local', () => {
    const base: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'v1',
      vaultName: 'Vault',
      revision: 1,
      createdAt: t0,
      updatedAt: t0,
      categories: ['login'],
      entries: [createMockEntry('e1', 'GitHub', 'pass1', t0)]
    };

    const local: DecryptedVault = { ...base };

    const remote: DecryptedVault = {
      ...base,
      revision: 3,
      entries: [
        createMockEntry('e1', 'GitHub', 'pass1', t0),
        createMockEntry('e3', 'Slack', 'pass3', t1) // Added remotely
      ]
    };

    const res = syncService.mergeThreeWay(base, local, remote);
    expect(res.added).toBe(1);
    expect(res.vault.entries.length).toBe(2);
    expect(res.vault.entries.some(e => e.id === 'e3')).toBe(true);
    expect(res.vault.revision).toBe(4); // max(1, 3) + 1
  });

  it('should propagate local edit when remote is unchanged from base', () => {
    const base: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'v1',
      vaultName: 'Vault',
      revision: 1,
      createdAt: t0,
      updatedAt: t0,
      categories: ['login'],
      entries: [createMockEntry('e1', 'GitHub', 'old-pass', t0)]
    };

    const local: DecryptedVault = {
      ...base,
      revision: 2,
      entries: [createMockEntry('e1', 'GitHub', 'new-local-pass', t1)]
    };

    const remote: DecryptedVault = { ...base };

    const res = syncService.mergeThreeWay(base, local, remote);
    expect(res.updated).toBe(1);
    expect(res.vault.entries[0].password).toBe('new-local-pass');
  });

  it('should propagate remote edit when local is unchanged from base', () => {
    const base: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'v1',
      vaultName: 'Vault',
      revision: 1,
      createdAt: t0,
      updatedAt: t0,
      categories: ['login'],
      entries: [createMockEntry('e1', 'GitHub', 'old-pass', t0)]
    };

    const local: DecryptedVault = { ...base };

    const remote: DecryptedVault = {
      ...base,
      revision: 2,
      entries: [createMockEntry('e1', 'GitHub', 'new-remote-pass', t1)]
    };

    const res = syncService.mergeThreeWay(base, local, remote);
    expect(res.updated).toBe(1);
    expect(res.vault.entries[0].password).toBe('new-remote-pass');
  });

  it('should resolve concurrent modifications by choosing newer timestamp', () => {
    const base: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'v1',
      vaultName: 'Vault',
      revision: 1,
      createdAt: t0,
      updatedAt: t0,
      categories: ['login'],
      entries: [createMockEntry('e1', 'GitHub', 'base-pass', t0)]
    };

    // Local modified at t1
    const local: DecryptedVault = {
      ...base,
      revision: 2,
      entries: [createMockEntry('e1', 'GitHub', 'local-pass-t1', t1)]
    };

    // Remote modified at t2 (newer)
    const remote: DecryptedVault = {
      ...base,
      revision: 3,
      entries: [createMockEntry('e1', 'GitHub', 'remote-pass-t2', t2)]
    };

    const res = syncService.mergeThreeWay(base, local, remote);
    expect(res.vault.entries.length).toBe(1);
    expect(res.vault.entries[0].password).toBe('remote-pass-t2'); // t2 won!
    expect(res.conflicts).toBe(0);
  });

  it('should create conflict copy on exact timestamp concurrent collision for zero data loss', () => {
    const base: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'v1',
      vaultName: 'Vault',
      revision: 1,
      createdAt: t0,
      updatedAt: t0,
      categories: ['login'],
      entries: [createMockEntry('e1', 'GitHub', 'base-pass', t0)]
    };

    // Both modified at exact same timestamp t1 with different passwords
    const local: DecryptedVault = {
      ...base,
      revision: 2,
      entries: [createMockEntry('e1', 'GitHub', 'local-secret', t1)]
    };

    const remote: DecryptedVault = {
      ...base,
      revision: 2,
      entries: [createMockEntry('e1', 'GitHub', 'remote-secret', t1)]
    };

    const res = syncService.mergeThreeWay(base, local, remote);
    expect(res.conflicts).toBe(1);
    expect(res.vault.entries.length).toBe(2); // Primary + Conflict copy

    const primary = res.vault.entries.find(e => e.id === 'e1');
    expect(primary?.password).toBe('local-secret');

    const conflict = res.vault.entries.find(e => e.title.includes('Sync Conflict'));
    expect(conflict).toBeDefined();
    expect(conflict?.password).toBe('remote-secret');
  });

  it('should propagate local deletion when remote was not modified since base', () => {
    const base: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'v1',
      vaultName: 'Vault',
      revision: 1,
      createdAt: t0,
      updatedAt: t0,
      categories: ['login'],
      entries: [createMockEntry('e1', 'GitHub', 'pass1', t0)]
    };

    // Local deleted e1
    const local: DecryptedVault = {
      ...base,
      revision: 2,
      entries: []
    };

    const remote: DecryptedVault = { ...base };

    const res = syncService.mergeThreeWay(base, local, remote);
    expect(res.deleted).toBe(1);
    expect(res.vault.entries.length).toBe(0);
  });

  it('should preserve remote modification if deleted locally while remote was updated', () => {
    const base: DecryptedVault = {
      schemaVersion: 1,
      vaultId: 'v1',
      vaultName: 'Vault',
      revision: 1,
      createdAt: t0,
      updatedAt: t0,
      categories: ['login'],
      entries: [createMockEntry('e1', 'GitHub', 'old-pass', t0)]
    };

    // Local deleted e1
    const local: DecryptedVault = {
      ...base,
      revision: 2,
      entries: []
    };

    // Remote modified e1 to new-pass
    const remote: DecryptedVault = {
      ...base,
      revision: 3,
      entries: [createMockEntry('e1', 'GitHub', 'new-pass', t1)]
    };

    const res = syncService.mergeThreeWay(base, local, remote);
    // Remote update preserved to prevent accidental loss
    expect(res.vault.entries.length).toBe(1);
    expect(res.vault.entries[0].password).toBe('new-pass');
  });
});
