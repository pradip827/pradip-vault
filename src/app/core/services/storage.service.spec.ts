import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService } from './storage.service';
import { EncryptedVaultEnvelope } from '../crypto/crypto.types';

describe('StorageService (IndexedDB Persistence)', () => {
  let service: StorageService;

  const mockEnvelope: EncryptedVaultEnvelope = {
    formatVersion: 1,
    kdf: {
      algorithm: 'Argon2id',
      params: {
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        keyLength: 32
      },
      salt: 'mockSaltBase64Url123'
    },
    encryption: {
      cipher: 'AES-256-GCM',
      iv: 'mockIvBase64Url456',
      tagLength: 128
    },
    ciphertext: 'mockCiphertextBase64Url789'
  };

  beforeEach(async () => {
    service = new StorageService();
    // Clear storage before each test
    await service.deleteVault();
  });

  it('should initially report hasVault as false', async () => {
    const has = await service.hasVault();
    expect(has).toBe(false);

    const loaded = await service.loadVaultEnvelope();
    expect(loaded).toBeNull();
  });

  it('should save and retrieve an encrypted envelope', async () => {
    await service.saveVaultEnvelope(mockEnvelope, 1);

    const has = await service.hasVault();
    expect(has).toBe(true);

    const loaded = await service.loadVaultEnvelope();
    expect(loaded).toEqual(mockEnvelope);
  });

  it('should track highestKnownRevision and prevent revision rollback', async () => {
    await service.saveVaultEnvelope(mockEnvelope, 10);
    let meta = await service.getMetadata();
    expect(meta.highestKnownRevision).toBe(10);

    // Save older revision 5
    await service.saveVaultEnvelope(mockEnvelope, 5);
    meta = await service.getMetadata();
    expect(meta.highestKnownRevision).toBe(10); // Still 10!
  });

  it('should delete the stored vault record', async () => {
    await service.saveVaultEnvelope(mockEnvelope, 1);
    expect(await service.hasVault()).toBe(true);

    await service.deleteVault();
    expect(await service.hasVault()).toBe(false);
    expect(await service.loadVaultEnvelope()).toBeNull();
  });

  it('should save, retrieve, and clear sync base snapshot', async () => {
    expect(await service.loadSyncBase()).toBeNull();

    await service.saveSyncBase(mockEnvelope, 3);
    const base = await service.loadSyncBase();

    expect(base).not.toBeNull();
    expect(base?.revision).toBe(3);
    expect(base?.envelope).toEqual(mockEnvelope);

    await service.clearSyncData();
    expect(await service.loadSyncBase()).toBeNull();
  });

  it('should save, retrieve, and clear sync metadata', async () => {
    expect(await service.loadSyncMetadata()).toBeNull();

    await service.saveSyncMetadata({
      lastSyncedAt: '2026-09-08T12:00:00.000Z',
      remoteFileId: 'drive-file-123',
      remoteRevision: 4,
      googleClientId: 'my-client-id.apps.googleusercontent.com'
    });

    const meta = await service.loadSyncMetadata();
    expect(meta).not.toBeNull();
    expect(meta?.remoteFileId).toBe('drive-file-123');
    expect(meta?.remoteRevision).toBe(4);
    expect(meta?.googleClientId).toBe('my-client-id.apps.googleusercontent.com');

    await service.clearSyncData();
    expect(await service.loadSyncMetadata()).toBeNull();
  });
});
