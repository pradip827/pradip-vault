export type EntryCategory = 'login' | 'secure_note' | 'credit_card' | 'identity' | 'server';

export interface CustomField {
  id: string;
  name: string;
  value: string;
  isSecret: boolean;
}

export interface VaultEntry {
  id: string;                      // UUID v4
  category: EntryCategory;         // Default: 'login'
  title: string;                   // E.g. "GitHub"
  website: string;                 // E.g. "https://github.com"
  username: string;                // E.g. "alex_dev"
  password: string;                // Plaintext credential inside encrypted vault payload
  notes: string;                   // Multiline text/markdown
  favorite: boolean;               // Quick access flag
  totpSecret?: string;             // Optional TOTP seed
  customFields?: CustomField[];    // Extensible key-value pairs
  createdAt: string;               // ISO-8601 UTC
  updatedAt: string;               // ISO-8601 UTC
}

export interface DecryptedVault {
  schemaVersion: 1;                // Internal payload schema version
  vaultId: string;                 // Persistent UUID v4
  vaultName: string;               // User-friendly name
  revision: number;                // Monotonically increasing sequence number (e.g. 1, 2, 3...)
  createdAt: string;               // ISO-8601 UTC
  updatedAt: string;               // ISO-8601 UTC
  categories: string[];            // Custom categories/tags
  entries: VaultEntry[];           // Credential records
}

/**
 * Creates a fresh, empty decrypted vault structure.
 */
export function createEmptyVault(vaultName = 'Personal Vault'): DecryptedVault {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    vaultId: 'vault-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36),
    vaultName: vaultName.trim() || 'Personal Vault',
    revision: 1,
    createdAt: now,
    updatedAt: now,
    categories: ['login', 'secure_note', 'credit_card', 'identity', 'server'],
    entries: []
  };
}
