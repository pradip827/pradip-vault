import { Injectable } from '@angular/core';
import { EncryptedVaultEnvelope } from '../crypto/crypto.types';
import {
  VAULT_DB_NAME,
  VAULT_STORE_NAME,
  ACTIVE_VAULT_KEY,
  SYNC_STORE_NAME,
  SYNC_BASE_KEY,
  SYNC_METADATA_KEY,
  StoredVaultRecord,
  VaultStorageMetadata,
  StoredSyncBaseRecord,
  SyncMetadataRecord
} from '../storage/storage.types';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported in this environment.'));
        return;
      }

      const request = indexedDB.open(VAULT_DB_NAME, 2);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
          db.createObjectStore(VAULT_STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SYNC_STORE_NAME)) {
          db.createObjectStore(SYNC_STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        this.dbPromise = null;
        reject((event.target as IDBOpenDBRequest).error || new Error('Failed to open IndexedDB.'));
      };
    });

    return this.dbPromise;
  }

  /**
   * Persists an encrypted vault envelope into IndexedDB.
   * Enforces rollback protection: refuses to replace a newer stored envelope with an older revision.
   */
  public async saveVaultEnvelope(envelope: EncryptedVaultEnvelope, revision: number): Promise<void> {
    if (!Number.isFinite(revision) || revision < 1) {
      throw new Error(`Invalid vault revision: ${revision}`);
    }

    const db = await this.getDB();
    const existing = await this.loadRecord();

    if (existing && revision < existing.highestKnownRevision) {
      throw new Error(
        `Rollback prevented: Cannot replace stored vault envelope at revision ${existing.highestKnownRevision} with older revision ${revision}.`
      );
    }

    const highestKnownRevision = existing
      ? Math.max(existing.highestKnownRevision, revision)
      : revision;

    const record: StoredVaultRecord = {
      id: ACTIVE_VAULT_KEY,
      envelope,
      highestKnownRevision,
      lastSavedAt: new Date().toISOString()
    };

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to save vault record.'));
    });
  }

  /**
   * Loads the current encrypted vault envelope from IndexedDB.
   * Returns null if no vault exists locally.
   */
  public async loadVaultEnvelope(): Promise<EncryptedVaultEnvelope | null> {
    const record = await this.loadRecord();
    return record ? record.envelope : null;
  }

  /**
   * Checks if an encrypted vault envelope is stored locally.
   */
  public async hasVault(): Promise<boolean> {
    const record = await this.loadRecord();
    return record !== null;
  }

  /**
   * Retrieves non-sensitive storage metadata.
   */
  public async getMetadata(): Promise<VaultStorageMetadata> {
    const record = await this.loadRecord();
    if (!record) {
      return {
        hasVault: false,
        highestKnownRevision: 0,
        lastSavedAt: null
      };
    }

    return {
      hasVault: true,
      highestKnownRevision: record.highestKnownRevision,
      lastSavedAt: record.lastSavedAt
    };
  }

  /**
   * Deletes the local encrypted vault record from IndexedDB.
   */
  public async deleteVault(): Promise<void> {
    const db = await this.getDB();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const request = store.delete(ACTIVE_VAULT_KEY);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to delete vault record.'));
    });
  }

  private async loadRecord(): Promise<StoredVaultRecord | null> {
    const db = await this.getDB();

    return new Promise<StoredVaultRecord | null>((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const request = store.get(ACTIVE_VAULT_KEY);

      request.onsuccess = () => {
        resolve((request.result as StoredVaultRecord) || null);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to read vault record.'));
      };
    });
  }

  // --- Sync Store Operations ---

  /**
   * Persists the encrypted base envelope snapshot for 3-way sync conflict detection.
   */
  public async saveSyncBase(envelope: EncryptedVaultEnvelope, revision: number): Promise<void> {
    const db = await this.getDB();

    const record: StoredSyncBaseRecord = {
      id: SYNC_BASE_KEY,
      envelope,
      revision,
      savedAt: new Date().toISOString()
    };

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SYNC_STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to save sync base snapshot.'));
    });
  }

  /**
   * Loads the encrypted base snapshot envelope.
   */
  public async loadSyncBase(): Promise<StoredSyncBaseRecord | null> {
    const db = await this.getDB();

    return new Promise<StoredSyncBaseRecord | null>((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE_NAME, 'readonly');
      const store = tx.objectStore(SYNC_STORE_NAME);
      const request = store.get(SYNC_BASE_KEY);

      request.onsuccess = () => {
        resolve((request.result as StoredSyncBaseRecord) || null);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to load sync base snapshot.'));
      };
    });
  }

  /**
   * Saves sync metadata (e.g. lastSyncedAt, remoteFileId, remoteRevision, googleClientId).
   */
  public async saveSyncMetadata(metadata: Partial<Omit<SyncMetadataRecord, 'id'>>): Promise<void> {
    const db = await this.getDB();
    const existing = await this.loadSyncMetadata();

    const record: SyncMetadataRecord = {
      id: SYNC_METADATA_KEY,
      lastSyncedAt: metadata.lastSyncedAt !== undefined ? metadata.lastSyncedAt : existing?.lastSyncedAt || null,
      remoteFileId: metadata.remoteFileId !== undefined ? metadata.remoteFileId : existing?.remoteFileId || null,
      remoteRevision: metadata.remoteRevision !== undefined ? metadata.remoteRevision : existing?.remoteRevision || 0,
      googleClientId: metadata.googleClientId !== undefined ? metadata.googleClientId : existing?.googleClientId || null
    };

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SYNC_STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Failed to save sync metadata.'));
    });
  }

  /**
   * Loads sync metadata from IndexedDB.
   */
  public async loadSyncMetadata(): Promise<SyncMetadataRecord | null> {
    const db = await this.getDB();

    return new Promise<SyncMetadataRecord | null>((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE_NAME, 'readonly');
      const store = tx.objectStore(SYNC_STORE_NAME);
      const request = store.get(SYNC_METADATA_KEY);

      request.onsuccess = () => {
        resolve((request.result as SyncMetadataRecord) || null);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to load sync metadata.'));
      };
    });
  }

  /**
   * Clears all sync-related snapshots and metadata from IndexedDB.
   */
  public async clearSyncData(): Promise<void> {
    const db = await this.getDB();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SYNC_STORE_NAME);
      const req1 = store.delete(SYNC_BASE_KEY);
      const req2 = store.delete(SYNC_METADATA_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear sync store.'));
    });
  }
}
