import { argon2id } from 'hash-wasm';
import { KdfParameters, KDF_SECURITY_FLOOR, DEFAULT_CRYPTO_CONFIG } from './crypto.types';
import { wipeBuffer } from '../security/zeroizer';

/**
 * Derives a 256-bit symmetric Vault Encryption Key (VEK) using Argon2id (RFC 9106)
 * via WebAssembly (hash-wasm).
 *
 * @param password The master password string or UTF-8 byte array.
 * @param salt The 16-byte cryptographically secure salt.
 * @param customParams Optional KDF configuration overriding defaults (subject to security floors).
 * @returns 32-byte (256-bit) raw key bytes as Uint8Array.
 */
export async function deriveKeyArgon2id(
  password: string | Uint8Array,
  salt: Uint8Array,
  customParams?: Partial<KdfParameters>
): Promise<Uint8Array> {
  const params: KdfParameters = {
    ...DEFAULT_CRYPTO_CONFIG.kdf.params,
    ...customParams
  };

  // Enforce strict security floors
  if (params.memory < KDF_SECURITY_FLOOR.MIN_MEMORY_KIB) {
    throw new Error(
      `Argon2id memory (${params.memory} KiB) is below minimum security floor (${KDF_SECURITY_FLOOR.MIN_MEMORY_KIB} KiB).`
    );
  }

  if (params.iterations < KDF_SECURITY_FLOOR.MIN_ITERATIONS) {
    throw new Error(
      `Argon2id iterations (${params.iterations}) is below minimum security floor (${KDF_SECURITY_FLOOR.MIN_ITERATIONS}).`
    );
  }

  if (salt.length < KDF_SECURITY_FLOOR.MIN_SALT_BYTES) {
    throw new Error(
      `Argon2id salt length (${salt.length} bytes) is below minimum security floor (${KDF_SECURITY_FLOOR.MIN_SALT_BYTES} bytes).`
    );
  }

  if (params.keyLength !== KDF_SECURITY_FLOOR.KEY_LENGTH_BYTES) {
    throw new Error(
      `Argon2id keyLength must be exactly ${KDF_SECURITY_FLOOR.KEY_LENGTH_BYTES} bytes (256 bits).`
    );
  }

  // Convert string password to Uint8Array UTF-8 buffer if needed
  let passwordBuffer: Uint8Array | null = null;
  if (typeof password === 'string') {
    passwordBuffer = new TextEncoder().encode(password);
  } else {
    passwordBuffer = password;
  }

  try {
    const rawKey = await argon2id({
      password: passwordBuffer,
      salt: salt,
      parallelism: params.parallelism,
      iterations: params.iterations,
      memorySize: params.memory,
      hashLength: params.keyLength,
      outputType: 'binary'
    });

    return rawKey;
  } finally {
    // Best-effort cleanup of temporary password buffer if allocated locally
    if (typeof password === 'string' && passwordBuffer) {
      wipeBuffer(passwordBuffer);
    }
  }
}
