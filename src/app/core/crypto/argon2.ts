import { argon2id } from 'hash-wasm';
import { KdfParameters, KDF_SECURITY_FLOOR, KDF_SECURITY_CEILING, DEFAULT_CRYPTO_CONFIG } from './crypto.types';
import { wipeBuffer } from '../security/zeroizer';

/**
 * Derives a 256-bit symmetric Vault Encryption Key (VEK) using Argon2id (RFC 9106)
 * via WebAssembly (hash-wasm).
 *
 * @param password The master password string or UTF-8 byte array.
 * @param salt The 16-byte cryptographically secure salt.
 * @param customParams Optional KDF configuration overriding defaults (subject to security floors and ceilings).
 * @returns 32-byte (256-bit) raw key bytes as Uint8Array.
 * @throws If any parameter is invalid, out of bounds, NaN, Infinity, or non-integer.
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

  // ---- Type validation: reject NaN, Infinity, non-integer, non-number BEFORE any Argon2 work ----
  // This prevents malicious untrusted envelopes from triggering expensive allocations.
  const assertSafePositiveInteger = (value: unknown, name: string): void => {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
      throw new Error(
        `Argon2id ${name} must be a finite positive integer; got: ${value}`
      );
    }
  };

  assertSafePositiveInteger(params.memory, 'memory');
  assertSafePositiveInteger(params.iterations, 'iterations');
  assertSafePositiveInteger(params.parallelism, 'parallelism');
  assertSafePositiveInteger(params.keyLength, 'keyLength');

  // ---- Security floor: reject parameters below minimum ----
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

  if (params.parallelism < KDF_SECURITY_FLOOR.MIN_PARALLELISM) {
    throw new Error(
      `Argon2id parallelism (${params.parallelism}) is below minimum (${KDF_SECURITY_FLOOR.MIN_PARALLELISM}).`
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

  // ---- Security ceiling: reject resource-exhaustion parameters from untrusted envelopes ----
  // Validated BEFORE any Argon2 memory allocation to prevent DoS/OOM attacks.
  if (params.memory > KDF_SECURITY_CEILING.MAX_MEMORY_KIB) {
    throw new Error(
      `Argon2id memory (${params.memory} KiB) exceeds maximum allowed (${KDF_SECURITY_CEILING.MAX_MEMORY_KIB} KiB = 512 MiB). Refusing to allocate.`
    );
  }

  if (params.iterations > KDF_SECURITY_CEILING.MAX_ITERATIONS) {
    throw new Error(
      `Argon2id iterations (${params.iterations}) exceeds maximum allowed (${KDF_SECURITY_CEILING.MAX_ITERATIONS}).`
    );
  }

  if (params.parallelism > KDF_SECURITY_CEILING.MAX_PARALLELISM) {
    throw new Error(
      `Argon2id parallelism (${params.parallelism}) exceeds maximum allowed (${KDF_SECURITY_CEILING.MAX_PARALLELISM}).`
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
