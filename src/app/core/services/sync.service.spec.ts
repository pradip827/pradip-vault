import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SyncService } from './sync.service';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { GoogleDriveService } from './google-drive.service';
import { ToastService } from './toast.service';
import { DecryptedVault, VaultEntry, CustomField } from '../models/vault.model';
import { EncryptedVaultEnvelope } from '../crypto/crypto.types';

// ============================================================
// TEST HELPERS
// ============================================================

const t0 = '2026-09-08T10:00:00.000Z';
const t1 = '2026-09-08T11:00:00.000Z';
const t2 = '2026-09-08T12:00:00.000Z';

const makeEntry = (id: string, overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  id,
  category: 'login',
  title: 'Test Entry',
  website: 'https://example.com',
  username: 'user@example.com',
  password: 'base-password',
  notes: '',
  favorite: false,
  createdAt: t0,
  updatedAt: t0,
  ...overrides
});

const makeVault = (revision: number, entries: VaultEntry[], overrides: Partial<DecryptedVault> = {}): DecryptedVault => ({
  schemaVersion: 1,
  vaultId: 'v1',
  vaultName: 'Test Vault',
  revision,
  createdAt: t0,
  updatedAt: t0,
  categories: ['login'],
  entries,
  ...overrides
});

// ============================================================
// SUITE
// ============================================================

describe('SyncService — Security & Data-Integrity Remediation', () => {
  let syncService: SyncService;
  let storageService: StorageService;
  let googleDriveService: GoogleDriveService;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SyncService, VaultService, StorageService,
        CryptoService, GoogleDriveService, ToastService
      ]
    });
    syncService = TestBed.inject(SyncService);
    storageService = TestBed.inject(StorageService);
    googleDriveService = TestBed.inject(GoogleDriveService);
    await storageService.deleteVault();
    await storageService.clearSyncData();
  });

  // ----------------------------------------------------------
  // Basic regression tests (from original spec)
  // ----------------------------------------------------------

  describe('Basic 3-Way Merge (regression)', () => {
    it('should initialize with disconnected state', () => {
      expect(syncService.isConnected()).toBe(false);
      expect(syncService.isSyncing()).toBe(false);
      expect(syncService.syncStatus()).toBe('idle');
    });

    it('should persist Google Client ID', async () => {
      await syncService.setGoogleClientId('test-client-id.apps.googleusercontent.com');
      expect(syncService.googleClientId()).toBe('test-client-id.apps.googleusercontent.com');
      const meta = await storageService.loadSyncMetadata();
      expect(meta?.googleClientId).toBe('test-client-id.apps.googleusercontent.com');
    });

    it('should disconnect and reset connection state', () => {
      googleDriveService.setAccessToken('mock-token');
      syncService.isConnected.set(true);
      syncService.disconnect();
      expect(syncService.isConnected()).toBe(false);
      expect(googleDriveService.getAccessToken()).toBeNull();
    });

    it('should fast-forward local additions when not in base and not in remote', () => {
      const base = makeVault(1, [makeEntry('e1')]);
      const local = makeVault(2, [makeEntry('e1'), makeEntry('e2', { website: 'https://other.com', updatedAt: t1 })]);
      const remote = makeVault(1, [makeEntry('e1')]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.added).toBe(1);
      expect(res.vault.entries.length).toBe(2);
      expect(res.vault.entries.some(e => e.id === 'e2')).toBe(true);
      expect(res.vault.revision).toBe(3);
    });

    it('should pull remote additions when not in base and not in local', () => {
      const base = makeVault(1, [makeEntry('e1')]);
      const local = makeVault(1, [makeEntry('e1')]);
      const remote = makeVault(3, [makeEntry('e1'), makeEntry('e3', { website: 'https://slack.com', updatedAt: t1 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.added).toBe(1);
      expect(res.vault.entries.some(e => e.id === 'e3')).toBe(true);
      expect(res.vault.revision).toBe(4);
    });

    it('should propagate local edit when remote is unchanged from base', () => {
      const base = makeVault(1, [makeEntry('e1', { password: 'old-pass' })]);
      const local = makeVault(2, [makeEntry('e1', { password: 'new-local-pass', updatedAt: t1 })]);
      const remote = makeVault(1, [makeEntry('e1', { password: 'old-pass' })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.updated).toBe(1);
      expect(res.vault.entries[0].password).toBe('new-local-pass');
    });

    it('should propagate remote edit when local is unchanged from base', () => {
      const base = makeVault(1, [makeEntry('e1', { password: 'old-pass' })]);
      const local = makeVault(1, [makeEntry('e1', { password: 'old-pass' })]);
      const remote = makeVault(2, [makeEntry('e1', { password: 'new-remote-pass', updatedAt: t1 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.updated).toBe(1);
      expect(res.vault.entries[0].password).toBe('new-remote-pass');
    });

    it('should resolve concurrent modifications by newer timestamp', () => {
      const base = makeVault(1, [makeEntry('e1', { password: 'base-pass' })]);
      const local = makeVault(2, [makeEntry('e1', { password: 'local-pass-t1', updatedAt: t1 })]);
      const remote = makeVault(3, [makeEntry('e1', { password: 'remote-pass-t2', updatedAt: t2 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.vault.entries[0].password).toBe('remote-pass-t2');
      expect(res.conflicts).toBe(0);
    });

    it('should create conflict copy on exact-timestamp collision', () => {
      const base = makeVault(1, [makeEntry('e1', { password: 'base-pass' })]);
      const local = makeVault(2, [makeEntry('e1', { password: 'local-secret', updatedAt: t1 })]);
      const remote = makeVault(2, [makeEntry('e1', { password: 'remote-secret', updatedAt: t1 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.conflicts).toBe(1);
      expect(res.vault.entries.length).toBe(2);
      const primary = res.vault.entries.find(e => e.id === 'e1');
      expect(primary?.password).toBe('local-secret');
      const conflict = res.vault.entries.find(e => e.title.includes('Sync Conflict'));
      expect(conflict).toBeDefined();
      expect(conflict?.password).toBe('remote-secret');
    });

    it('should propagate local deletion when remote unchanged', () => {
      const base = makeVault(1, [makeEntry('e1')]);
      const local = makeVault(2, []);
      const remote = makeVault(1, [makeEntry('e1')]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.deleted).toBe(1);
      expect(res.vault.entries.length).toBe(0);
    });

    it('should keep remote update if deleted locally while remote modified', () => {
      const base = makeVault(1, [makeEntry('e1', { password: 'old-pass' })]);
      const local = makeVault(2, []);
      const remote = makeVault(3, [makeEntry('e1', { password: 'new-pass', updatedAt: t1 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.vault.entries.length).toBe(1);
      expect(res.vault.entries[0].password).toBe('new-pass');
    });

    it('should force-push and overwrite remote vault', async () => {
      const vaultService = TestBed.inject(VaultService);
      await vaultService.createVault('Test Vault', 'StrongMasterPass123!');
      vi.spyOn(googleDriveService, 'getAccessToken').mockReturnValue('mock-token');
      vi.spyOn(googleDriveService, 'searchVaultFile').mockResolvedValue({
        id: 'remote-file-id-999', name: 'vault.zerovault', revision: 1, modifiedTime: t0
      });
      const updateSpy = vi.spyOn(googleDriveService, 'updateVaultFile').mockResolvedValue();
      await syncService.overwriteRemoteVault();
      expect(updateSpy).toHaveBeenCalledWith('mock-token', 'remote-file-id-999', expect.any(String), expect.any(Number));
      expect(syncService.syncStatus()).toBe('synced');
    });
  });

  // ----------------------------------------------------------
  // Rollback protection tests
  // ----------------------------------------------------------

  describe('Rollback Protection — revision-only, state transitions', () => {
    it('accepts equal revision (revision=10 same as HKR=10)', () => {
      const base = makeVault(10, [makeEntry('e1')]);
      const local = makeVault(10, [makeEntry('e1')]);
      const remote = makeVault(10, [makeEntry('e1')]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.vault.revision).toBe(11);
    });

    it('accepts higher revision (revision=11 > HKR=10)', () => {
      const base = makeVault(10, [makeEntry('e1')]);
      const local = makeVault(10, [makeEntry('e1')]);
      const remote = makeVault(11, [makeEntry('e1'), makeEntry('e2', { website: 'https://new.com' })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.vault.revision).toBe(12);
      expect(res.added).toBe(1);
    });

    it('conflict IDs use crypto.randomUUID (not Math.random)', () => {
      const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const base = makeVault(1, [makeEntry('e1', { password: 'base-pass' })]);
      const local = makeVault(2, [makeEntry('e1', { password: 'local-pass', updatedAt: t1 })]);
      const remote = makeVault(2, [makeEntry('e1', { password: 'remote-pass', updatedAt: t1 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      const conflict = res.vault.entries.find(e => e.title.includes('Sync Conflict'));
      expect(conflict?.id).toMatch(UUID_V4_RE);
      expect(conflict?.id).not.toMatch(/^conflict-/);
    });

    it('conflict IDs are unique across repeated merges', () => {
      const base = makeVault(1, [makeEntry('e1', { password: 'base-pass' })]);
      const local = makeVault(2, [makeEntry('e1', { password: 'local-pass', updatedAt: t1 })]);
      const remote = makeVault(2, [makeEntry('e1', { password: 'remote-pass', updatedAt: t1 })]);
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const res = syncService.mergeThreeWay(base, local, remote);
        const conflict = res.vault.entries.find(e => e.title.includes('Sync Conflict'));
        if (conflict) ids.add(conflict.id);
      }
      expect(ids.size).toBe(50);
    });
  });

  // ----------------------------------------------------------
  // Complete field coverage in hasChanged
  // ----------------------------------------------------------

  describe('Full VaultEntry field coverage in merge', () => {
    it('detects totpSecret change from local', () => {
      const base = makeVault(1, [makeEntry('e1', { totpSecret: 'BASE_TOTP' })]);
      const local = makeVault(2, [makeEntry('e1', { totpSecret: 'NEW_TOTP', updatedAt: t1 })]);
      const remote = makeVault(1, [makeEntry('e1', { totpSecret: 'BASE_TOTP' })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.updated).toBe(1);
      expect(res.vault.entries[0].totpSecret).toBe('NEW_TOTP');
    });

    it('detects concurrent TOTP changes — newer timestamp wins', () => {
      const base = makeVault(1, [makeEntry('e1', { totpSecret: 'BASE_TOTP' })]);
      const local = makeVault(2, [makeEntry('e1', { totpSecret: 'LOCAL_TOTP', updatedAt: t2 })]);
      const remote = makeVault(2, [makeEntry('e1', { totpSecret: 'REMOTE_TOTP', updatedAt: t1 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.vault.entries[0].totpSecret).toBe('LOCAL_TOTP');
      expect(res.conflicts).toBe(0);
    });

    it('detects createdAt change from local', () => {
      const base = makeVault(1, [makeEntry('e1', { createdAt: t0 })]);
      const local = makeVault(2, [makeEntry('e1', { createdAt: t1, updatedAt: t1 })]);
      const remote = makeVault(1, [makeEntry('e1', { createdAt: t0 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.updated).toBe(1);
      expect(res.vault.entries[0].createdAt).toBe(t1);
    });

    it('detects customFields value change', () => {
      const base = makeVault(1, [makeEntry('e1', { customFields: [{ id: 'cf1', name: 'Key', value: 'old', isSecret: true }] })]);
      const local = makeVault(2, [makeEntry('e1', { customFields: [{ id: 'cf1', name: 'Key', value: 'new', isSecret: true }], updatedAt: t1 })]);
      const remote = makeVault(1, [makeEntry('e1', { customFields: [{ id: 'cf1', name: 'Key', value: 'old', isSecret: true }] })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.updated).toBe(1);
      expect(res.vault.entries[0].customFields![0].value).toBe('new');
    });

    it('does NOT treat customFields reordering as a change (order is not meaningful)', () => {
      const cf1: CustomField = { id: 'cf1', name: 'API Key', value: 'key', isSecret: true };
      const cf2: CustomField = { id: 'cf2', name: 'Secret', value: 'secret', isSecret: false };
      const base = makeVault(1, [makeEntry('e1', { customFields: [cf1, cf2] })]);
      const local = makeVault(2, [makeEntry('e1', { customFields: [cf2, cf1] })]);  // reversed order
      const remote = makeVault(1, [makeEntry('e1', { customFields: [cf1, cf2] })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      // Semantically identical — no update counted
      expect(res.updated).toBe(0);
      expect(res.conflicts).toBe(0);
    });

    it('detects concurrent customFields conflict at exact same timestamp', () => {
      const base = makeVault(1, [makeEntry('e1', { customFields: [{ id: 'cf1', name: 'Token', value: 'old', isSecret: false }] })]);
      const local = makeVault(2, [makeEntry('e1', { customFields: [{ id: 'cf1', name: 'Token', value: 'local-new', isSecret: false }], updatedAt: t1 })]);
      const remote = makeVault(2, [makeEntry('e1', { customFields: [{ id: 'cf1', name: 'Token', value: 'remote-new', isSecret: false }], updatedAt: t1 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.conflicts).toBe(1);
      expect(res.vault.entries.length).toBe(2);
    });

    it('detects favorite field change', () => {
      const base = makeVault(1, [makeEntry('e1', { favorite: false })]);
      const local = makeVault(2, [makeEntry('e1', { favorite: true, updatedAt: t1 })]);
      const remote = makeVault(1, [makeEntry('e1', { favorite: false })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.updated).toBe(1);
      expect(res.vault.entries[0].favorite).toBe(true);
    });

    it('detects category change', () => {
      const base = makeVault(1, [makeEntry('e1', { category: 'login' })]);
      const local = makeVault(2, [makeEntry('e1', { category: 'secure_note', updatedAt: t1 })]);
      const remote = makeVault(1, [makeEntry('e1', { category: 'login' })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.updated).toBe(1);
      expect(res.vault.entries[0].category).toBe('secure_note');
    });

    it('intentionally excludes updatedAt from hasChanged: timestamp-only difference is not a content change', () => {
      // Base entry at t0
      const base = makeVault(1, [makeEntry('e1', { updatedAt: t0 })]);
      // Local has identical credential content, but newer updatedAt t1
      const local = makeVault(2, [makeEntry('e1', { updatedAt: t1 })]);
      // Remote unchanged at t0
      const remote = makeVault(1, [makeEntry('e1', { updatedAt: t0 })]);

      const res = syncService.mergeThreeWay(base, local, remote);
      // Because credential content is identical, no update is recorded and no conflict copy generated
      expect(res.updated).toBe(0);
      expect(res.conflicts).toBe(0);
      expect(res.vault.entries.length).toBe(1);
    });

    it('intentionally excludes updatedAt from hasChanged: local deletion is confirmed when remote only updated timestamp', () => {
      // Base entry at t0
      const base = makeVault(1, [makeEntry('e1', { password: 'secret', updatedAt: t0 })]);
      // Local deleted the entry
      const local = makeVault(2, []);
      // Remote only touched updatedAt, without modifying any credential fields
      const remote = makeVault(1, [makeEntry('e1', { password: 'secret', updatedAt: t1 })]);

      const res = syncService.mergeThreeWay(base, local, remote);
      // Deletion is confirmed because remote content did not change; entry does not resurrect
      expect(res.deleted).toBe(1);
      expect(res.vault.entries.length).toBe(0);
    });

    it('intentionally excludes updatedAt from hasChanged: identical edits across devices with different timestamps do not conflict', () => {
      // Both devices independently changed password to the exact same value, but at different timestamps
      const base = makeVault(1, [makeEntry('e1', { password: 'old-pass', updatedAt: t0 })]);
      const local = makeVault(2, [makeEntry('e1', { password: 'new-pass', updatedAt: t1 })]);
      const remote = makeVault(2, [makeEntry('e1', { password: 'new-pass', updatedAt: t2 })]);

      const res = syncService.mergeThreeWay(base, local, remote);
      // Content is identical across local and remote → accepted without creating duplicate conflict copies
      expect(res.conflicts).toBe(0);
      expect(res.vault.entries.length).toBe(1);
      expect(res.vault.entries[0].password).toBe('new-pass');
    });
  });

  // ----------------------------------------------------------
  // Duplicate identity semantics
  // ----------------------------------------------------------

  describe('Duplicate Identity — origin + username, preserve-both fallback', () => {
    it('same origin + same username = same logical credential (local wins on t2 > t1)', () => {
      const local = makeVault(2, [makeEntry('uuid-local', {
        title: 'GitHub',
        website: 'https://github.com',
        username: 'alex@example.com',
        password: 'local-password',
        updatedAt: t2
      })]);
      const remote = makeVault(2, [makeEntry('uuid-remote', {
        title: 'GitHub Work',
        website: 'https://github.com',
        username: 'alex@example.com',
        password: 'remote-password',
        updatedAt: t1
      })]);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(1);
      expect(res.vault.entries[0].password).toBe('local-password');
    });

    it('different origin + same username = two distinct credentials (BOTH preserved)', () => {
      const local = makeVault(2, [makeEntry('uuid-local', {
        website: 'https://github.com',
        username: 'alex@example.com',
        password: 'github-password',
      })]);
      const remote = makeVault(2, [makeEntry('uuid-remote', {
        website: 'https://gitlab.com',
        username: 'alex@example.com',
        password: 'gitlab-password',
      })]);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(2);
      expect(res.vault.entries.some(e => e.password === 'github-password')).toBe(true);
      expect(res.vault.entries.some(e => e.password === 'gitlab-password')).toBe(true);
    });

    it('same title + different origin does NOT cause merging', () => {
      const local = makeVault(2, [makeEntry('uuid-local', {
        title: 'GitHub',
        website: 'https://github.com',
        username: 'alex@example.com',
        password: 'github-password',
      })]);
      const remote = makeVault(2, [makeEntry('uuid-remote', {
        title: 'GitHub',
        website: 'https://gitlab.com',
        username: 'bob@example.com',
        password: 'gitlab-password',
      })]);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(2);
    });

    it('same username alone (different websites) does NOT cause merging', () => {
      const local = makeVault(2, [makeEntry('uuid-local', {
        website: 'https://github.com',
        username: 'shared@example.com',
        password: 'github-password',
      })]);
      const remote = makeVault(2, [makeEntry('uuid-remote', {
        website: 'https://stripe.com',
        username: 'shared@example.com',
        password: 'stripe-password',
      })]);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(2);
    });

    it('same category alone does NOT cause merging', () => {
      const local = makeVault(2, [makeEntry('uuid-local', {
        category: 'login',
        website: 'https://github.com',
        username: 'alice',
        password: 'github-password',
      })]);
      const remote = makeVault(2, [makeEntry('uuid-remote', {
        category: 'login',
        website: 'https://gitlab.com',
        username: 'bob',
        password: 'gitlab-password',
      })]);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(2);
    });

    it('entries with no website (secure notes) are ALWAYS preserved independently', () => {
      const local = makeVault(2, [makeEntry('uuid-local', {
        category: 'secure_note',
        title: 'My Secret',
        website: '',
        username: '',
        password: 'local-secret',
      })]);
      const remote = makeVault(2, [makeEntry('uuid-remote', {
        category: 'secure_note',
        title: 'My Secret',
        website: '',
        username: '',
        password: 'remote-secret',
      })]);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(2);
      expect(res.vault.entries.some(e => e.password === 'local-secret')).toBe(true);
      expect(res.vault.entries.some(e => e.password === 'remote-secret')).toBe(true);
    });

    it('URL path differences do NOT create different origins (same origin)', () => {
      // github.com/user/repo and github.com/login both normalize to https://github.com
      const local = makeVault(2, [makeEntry('uuid-local', {
        website: 'https://github.com/user/repo',
        username: 'alex@example.com',
        password: 'local-password',
        updatedAt: t2
      })]);
      const remote = makeVault(2, [makeEntry('uuid-remote', {
        website: 'https://github.com/login',
        username: 'alex@example.com',
        password: 'remote-password',
        updatedAt: t1
      })]);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(1);
      expect(res.vault.entries[0].password).toBe('local-password');
    });

    it('subdomain differences create different identities (preserved independently)', () => {
      const local = makeVault(2, [makeEntry('uuid-local', {
        website: 'https://login.github.com',
        username: 'alex@example.com',
        password: 'subdomain-password',
      })]);
      const remote = makeVault(2, [makeEntry('uuid-remote', {
        website: 'https://github.com',
        username: 'alex@example.com',
        password: 'main-password',
      })]);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(2);
    });
  });

  // ----------------------------------------------------------
  // Data Preservation Invariant
  // ----------------------------------------------------------

  describe('Data Preservation Invariant — no silent data loss', () => {
    it('preserves all VaultEntry fields through a clean no-op merge', () => {
      const fullEntry = makeEntry('e1', {
        category: 'login',
        title: 'My Service',
        website: 'https://example.com',
        username: 'user@example.com',
        password: 'super-secret',
        notes: 'This is a note',
        favorite: true,
        totpSecret: 'JBSWY3DPEHPK3PXP',
        createdAt: t0,
        updatedAt: t1,
        customFields: [
          { id: 'cf1', name: 'API Key', value: 'mykey', isSecret: true },
          { id: 'cf2', name: 'Recovery', value: 'recovcode', isSecret: false }
        ]
      });
      const base = makeVault(1, [fullEntry]);
      const local = makeVault(1, [fullEntry]);
      const remote = makeVault(1, [fullEntry]);
      const res = syncService.mergeThreeWay(base, local, remote);
      const m = res.vault.entries[0];
      expect(m.id).toBe('e1');
      expect(m.category).toBe('login');
      expect(m.title).toBe('My Service');
      expect(m.website).toBe('https://example.com');
      expect(m.username).toBe('user@example.com');
      expect(m.password).toBe('super-secret');
      expect(m.notes).toBe('This is a note');
      expect(m.favorite).toBe(true);
      expect(m.totpSecret).toBe('JBSWY3DPEHPK3PXP');
      expect(m.createdAt).toBe(t0);
      expect(m.customFields).toHaveLength(2);
      expect(m.customFields![0].value).toBe('mykey');
      expect(m.customFields![1].value).toBe('recovcode');
    });

    it('conflict copy preserves ALL original remote fields', () => {
      const remoteEntry = makeEntry('e1', {
        password: 'remote-secret',
        totpSecret: 'REMOTE_TOTP',
        notes: 'Remote notes',
        favorite: true,
        customFields: [{ id: 'cf1', name: 'Token', value: 'remote-token', isSecret: true }],
        updatedAt: t1
      });
      const base = makeVault(1, [makeEntry('e1', { password: 'base-pass' })]);
      const local = makeVault(2, [makeEntry('e1', { password: 'local-secret', updatedAt: t1 })]);
      const remote = makeVault(2, [remoteEntry]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.conflicts).toBe(1);
      const conflict = res.vault.entries.find(e => e.title.includes('Sync Conflict'));
      expect(conflict!.password).toBe('remote-secret');
      expect(conflict!.totpSecret).toBe('REMOTE_TOTP');
      expect(conflict!.favorite).toBe(true);
      expect(conflict!.customFields![0].value).toBe('remote-token');
    });

    it('local deletion + remote modification keeps remote (prevents lost update)', () => {
      const base = makeVault(1, [makeEntry('e1', { password: 'old-pass', totpSecret: 'OLD_TOTP' })]);
      const local = makeVault(2, []);
      const remote = makeVault(3, [makeEntry('e1', { password: 'updated-pass', totpSecret: 'NEW_TOTP', updatedAt: t1 })]);
      const res = syncService.mergeThreeWay(base, local, remote);
      expect(res.vault.entries.length).toBe(1);
      expect(res.vault.entries[0].password).toBe('updated-pass');
      expect(res.vault.entries[0].totpSecret).toBe('NEW_TOTP');
    });

    it('concurrent creation from both sides — all entries preserved (no silent loss)', () => {
      const localEntries = [
        makeEntry('local-1', { website: 'https://github.com', username: 'alice' }),
        makeEntry('local-2', { website: 'https://gitlab.com', username: 'alice' }),
      ];
      const remoteEntries = [
        makeEntry('remote-1', { website: 'https://bitbucket.com', username: 'alice' }),
        makeEntry('remote-2', { website: 'https://jira.com', username: 'alice' }),
        makeEntry('remote-3', { website: 'https://confluence.com', username: 'alice' }),
      ];
      const local = makeVault(2, localEntries);
      const remote = makeVault(2, remoteEntries);
      const res = syncService.mergeThreeWay(null, local, remote);
      expect(res.vault.entries.length).toBe(5);
    });
  });

  // ----------------------------------------------------------
  // Google Drive Download Rollback Protection
  // ----------------------------------------------------------

  describe('downloadFromDrive / pullVaultFromDrive Rollback Protection', () => {
    const mockEnvelope: EncryptedVaultEnvelope = {
      formatVersion: 1,
      kdf: {
        algorithm: 'Argon2id',
        params: { memory: 65536, iterations: 3, parallelism: 1, keyLength: 32 },
        salt: 'dGVzdHNhbHQxMjM0NTY3OA'
      },
      encryption: {
        cipher: 'AES-256-GCM',
        iv: 'dGVzdGl2MTIzNA',
        tagLength: 128
      },
      ciphertext: 'bW9ja2NpcGhlcnRleHQ'
    };

    beforeEach(async () => {
      googleDriveService.setAccessToken('valid-mock-token');
    });

    it('should refuse to download an older remote revision if local highestKnownRevision is higher (rollback protection)', async () => {
      // Local vault is already at revision 5
      await storageService.saveVaultEnvelope(mockEnvelope, 5);
      const meta = await storageService.getMetadata();
      expect(meta.highestKnownRevision).toBe(5);

      // Remote file in Drive has older revision 2
      vi.spyOn(googleDriveService, 'searchVaultFile').mockResolvedValue({
        id: 'remote-file-id',
        name: 'vault.zerovault',
        modifiedTime: new Date().toISOString(),
        revision: 2
      });
      const downloadSpy = vi.spyOn(googleDriveService, 'downloadVaultFile');

      // Attempting pullVaultFromDrive must fail with rollback error
      await expect(syncService.pullVaultFromDrive()).rejects.toThrow(
        /Rollback detected: Remote revision \(2\) is older than highest known revision \(5\)/
      );

      // Verify remote content was never even downloaded or saved over local storage
      expect(downloadSpy).not.toHaveBeenCalled();
      const metaAfter = await storageService.getMetadata();
      expect(metaAfter.highestKnownRevision).toBe(5);
    });

    it('downloadFromDrive alias should also enforce rollback protection identically', async () => {
      await storageService.saveVaultEnvelope(mockEnvelope, 10);

      vi.spyOn(googleDriveService, 'searchVaultFile').mockResolvedValue({
        id: 'remote-file-id',
        name: 'vault.zerovault',
        modifiedTime: new Date().toISOString(),
        revision: 3
      });

      await expect(syncService.downloadFromDrive()).rejects.toThrow(/Rollback detected/);
    });

    it('should successfully download when remote revision is equal to or newer than highestKnownRevision', async () => {
      await storageService.saveVaultEnvelope(mockEnvelope, 5);

      vi.spyOn(googleDriveService, 'searchVaultFile').mockResolvedValue({
        id: 'remote-file-id',
        name: 'vault.zerovault',
        modifiedTime: new Date().toISOString(),
        revision: 6
      });
      vi.spyOn(googleDriveService, 'downloadVaultFile').mockResolvedValue(JSON.stringify(mockEnvelope));

      const success = await syncService.downloadFromDrive();
      expect(success).toBe(true);

      const meta = await storageService.getMetadata();
      expect(meta.highestKnownRevision).toBe(6);
      expect(syncService.syncStatus()).toBe('synced');
    });

    it('should successfully download onto a fresh device with no existing vault (highestKnownRevision = 0)', async () => {
      // Fresh state (deleteVault already ran in beforeEach)
      const meta = await storageService.getMetadata();
      expect(meta.highestKnownRevision).toBe(0);

      vi.spyOn(googleDriveService, 'searchVaultFile').mockResolvedValue({
        id: 'remote-file-id',
        name: 'vault.zerovault',
        modifiedTime: new Date().toISOString(),
        revision: 1
      });
      vi.spyOn(googleDriveService, 'downloadVaultFile').mockResolvedValue(JSON.stringify(mockEnvelope));

      const success = await syncService.pullVaultFromDrive();
      expect(success).toBe(true);

      const metaAfter = await storageService.getMetadata();
      expect(metaAfter.highestKnownRevision).toBe(1);
    });
  });
});

