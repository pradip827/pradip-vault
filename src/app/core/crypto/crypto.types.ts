export type KdfAlgorithm = 'Argon2id';
export type CipherAlgorithm = 'AES-256-GCM';

export interface KdfParameters {
  memory: number;      // Memory cost in KiB (default: 65536 = 64 MiB)
  iterations: number;  // Time cost / iterations (default: 3)
  parallelism: number; // Parallel threads (default: 1)
  keyLength: number;   // Output key length in bytes (default: 32 = 256 bits)
}

export interface KdfSection {
  algorithm: KdfAlgorithm;
  params: KdfParameters;
  salt: string;        // 16 bytes base64url encoded
}

export interface EncryptionSection {
  cipher: CipherAlgorithm;
  iv: string;          // 12 bytes base64url encoded
  tagLength: number;   // In bits (128)
}

export interface EnvelopeHeader {
  formatVersion: 1;
  kdf: KdfSection;
  encryption: EncryptionSection;
}

export interface EncryptedVaultEnvelope extends EnvelopeHeader {
  ciphertext: string;  // Base64url encoded ciphertext + 128-bit tag
}

export interface VaultBackupFile {
  magic: 'ZERO_VAULT_BACKUP' | 'PRADIP_VAULT_BACKUP';
  version: 1;
  app: 'ZeroVault' | 'Pradip Vault';
  exportedAt: string;
  checksumSha256: string;
  envelope: EncryptedVaultEnvelope;
}

// Minimum security floor parameters (reject anything lower)
export const KDF_SECURITY_FLOOR = {
  MIN_MEMORY_KIB: 32768,  // 32 MiB
  MIN_ITERATIONS: 3,
  MIN_PARALLELISM: 1,
  MIN_SALT_BYTES: 16,
  KEY_LENGTH_BYTES: 32
} as const;

/**
 * Maximum KDF parameter ceiling to prevent resource exhaustion from malicious
 * or untrusted vault envelopes.
 *
 * Rationale (relative to default: memory=64 MiB, t=3, p=1):
 *
 * MAX_MEMORY_KIB = 524288 (512 MiB = 8× default)
 *   At t=3, 512 MiB requires ~1.5 GiB total memory bandwidth. This already
 *   risks OOM on iOS Safari tabs (~1 GiB limit) and takes 10–20s on Android.
 *   Beyond 512 MiB, an attacker can reliably crash mobile tabs. This is the
 *   practical hard ceiling for untrusted input.
 *
 * MAX_ITERATIONS = 16 (~5× default of 3)
 *   At 64 MiB × 16 iterations, unlock takes ~10–15s on low-end mobile devices.
 *   Combined with the memory ceiling, attacker cannot reach unbounded CPU time.
 *
 * MAX_PARALLELISM = 8 (8× default of 1)
 *   Argon2id with p > physical CPU cores wastes memory proportionally without
 *   security benefit. Most mobile CPUs have 4–8 cores. p=8 is the practical
 *   maximum meaningful value for the target device range.
 *
 * All parameters are validated BEFORE argon2id() is invoked so no expensive
 * memory allocation occurs from a malicious envelope.
 */
export const KDF_SECURITY_CEILING = {
  MAX_MEMORY_KIB: 524288,  // 512 MiB — 8× the 64 MiB default
  MAX_ITERATIONS: 16,       // 5× the default of 3
  MAX_PARALLELISM: 8        // 8× the default of 1
} as const;

// Default standard cryptographic configuration
export const DEFAULT_CRYPTO_CONFIG: {
  formatVersion: 1;
  kdf: {
    algorithm: KdfAlgorithm;
    params: KdfParameters;
  };
  encryption: {
    cipher: CipherAlgorithm;
    tagLength: number;
    ivLengthBytes: number;
  };
} = {
  formatVersion: 1,
  kdf: {
    algorithm: 'Argon2id',
    params: {
      memory: 65536,    // 64 MiB
      iterations: 3,
      parallelism: 1,
      keyLength: 32     // 256-bit key
    }
  },
  encryption: {
    cipher: 'AES-256-GCM',
    tagLength: 128,
    ivLengthBytes: 12   // 96-bit nonce
  }
};

// Web Worker IPC Contract
export type WorkerRequestAction =
  | 'DERIVE_KEY'
  | 'ENCRYPT_VAULT'
  | 'DECRYPT_VAULT'
  | 'ENCRYPT_VAULT_WITH_KEY'
  | 'DECRYPT_VAULT_WITH_KEY';

export interface BaseWorkerRequest {
  id: string;
  action: WorkerRequestAction;
}

export interface DeriveKeyRequest extends BaseWorkerRequest {
  action: 'DERIVE_KEY';
  payload: {
    masterPassword: string;
    saltBase64Url: string;
    params?: Partial<KdfParameters>;
  };
}

export interface EncryptVaultRequest extends BaseWorkerRequest {
  action: 'ENCRYPT_VAULT';
  payload: {
    plaintextUtf8: string;
    masterPassword: string;
    customParams?: Partial<KdfParameters>;
  };
}

export interface DecryptVaultRequest extends BaseWorkerRequest {
  action: 'DECRYPT_VAULT';
  payload: {
    envelope: EncryptedVaultEnvelope;
    masterPassword: string;
  };
}

export interface EncryptVaultWithKeyRequest extends BaseWorkerRequest {
  action: 'ENCRYPT_VAULT_WITH_KEY';
  payload: {
    plaintextUtf8: string;
    sessionKeyBase64Url: string;
    saltBase64Url: string;
    kdfParams: KdfParameters;
  };
}

export interface DecryptVaultWithKeyRequest extends BaseWorkerRequest {
  action: 'DECRYPT_VAULT_WITH_KEY';
  payload: {
    envelope: EncryptedVaultEnvelope;
    sessionKeyBase64Url: string;
  };
}

export interface EncryptedSessionData {
  envelope: EncryptedVaultEnvelope;
  sessionKeyBase64Url: string;
  saltBase64Url: string;
  kdfParams: KdfParameters;
}

export interface DecryptedSessionData {
  plaintextUtf8: string;
  sessionKeyBase64Url: string;
  saltBase64Url: string;
  kdfParams: KdfParameters;
}

export type WorkerRequest =
  | DeriveKeyRequest
  | EncryptVaultRequest
  | DecryptVaultRequest
  | EncryptVaultWithKeyRequest
  | DecryptVaultWithKeyRequest;

export interface WorkerResponseSuccess<T> {
  id: string;
  success: true;
  data: T;
}

export interface WorkerResponseError {
  id: string;
  success: false;
  error: string;
}

export type WorkerResponse<T> = WorkerResponseSuccess<T> | WorkerResponseError;
