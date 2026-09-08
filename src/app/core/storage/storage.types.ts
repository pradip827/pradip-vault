import { EncryptedVaultEnvelope } from '../crypto/crypto.types';

export const VAULT_DB_NAME = 'zerovault_db';
export const VAULT_STORE_NAME = 'vault_store';
export const ACTIVE_VAULT_KEY = 'active_vault';

export const SYNC_STORE_NAME = 'sync_store';
export const SYNC_BASE_KEY = 'sync_base';
export const SYNC_METADATA_KEY = 'sync_metadata';

/**
 * The strictly encrypted record persisted in IndexedDB.
 * Contains ZERO plaintext credentials, usernames, or encryption keys.
 */
export interface StoredVaultRecord {
  id: typeof ACTIVE_VAULT_KEY;
  envelope: EncryptedVaultEnvelope;
  highestKnownRevision: number;
  lastSavedAt: string;
}

export interface VaultStorageMetadata {
  hasVault: boolean;
  highestKnownRevision: number;
  lastSavedAt: string | null;
}

/**
 * The encrypted base snapshot used for 3-way conflict resolution.
 * Preserves zero-knowledge guarantees at rest by encrypting with session key.
 */
export interface StoredSyncBaseRecord {
  id: typeof SYNC_BASE_KEY;
  envelope: EncryptedVaultEnvelope;
  revision: number;
  savedAt: string;
}

export interface SyncMetadataRecord {
  id: typeof SYNC_METADATA_KEY;
  lastSyncedAt: string | null;
  remoteFileId: string | null;
  remoteRevision: number;
  googleClientId: string | null;
}
