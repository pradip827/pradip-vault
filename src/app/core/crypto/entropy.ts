/**
 * Cryptographically Secure Pseudo-Random Number Generation (CSPRNG) utilities.
 * Uses W3C Web Cryptography API (crypto.getRandomValues).
 *
 * All randomness operations guarantee zero modulo bias via rejection sampling.
 * Math.random() is strictly forbidden.
 */

/**
 * Generates an array of cryptographically secure random bytes.
 */
export function generateRandomBytes(length: number): Uint8Array {
  if (length <= 0 || length > 65536) {
    throw new Error('Requested random byte length out of valid range (1-65536).');
  }
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  return buffer;
}

/**
 * Generates a 16-byte (128-bit) cryptographically random salt for Argon2id.
 */
export function generateSalt(): Uint8Array {
  return generateRandomBytes(16);
}

/**
 * Generates a 12-byte (96-bit) cryptographically random nonce/IV for AES-256-GCM.
 * As recommended by NIST SP 800-38D, 96-bit IVs are ideal for GCM mode.
 */
export function generateIV(): Uint8Array {
  return generateRandomBytes(12);
}

/**
 * Returns an unbiased random character from a given charset using rejection sampling.
 * Eliminates modulo bias completely.
 */
export function getUnbiasedRandomChar(charset: string): string {
  const L = charset.length;
  if (L <= 0 || L > 256) {
    throw new Error(`Invalid charset length: ${L}. Must be between 1 and 256.`);
  }

  // Find largest multiple of L <= 256
  const limit = 256 - (256 % L);
  const buffer = new Uint8Array(1);

  while (true) {
    crypto.getRandomValues(buffer);
    const randByte = buffer[0];
    if (randByte < limit) {
      return charset[randByte % L];
    }
    // Rejected: redraw from CSPRNG
  }
}

/**
 * Shuffles an array in-place using the Fisher-Yates algorithm driven by CSPRNG rejection sampling.
 * Guarantees uniform permutation distribution.
 */
export function secureShuffle<T>(array: T[]): T[] {
  const buffer = new Uint8Array(1);

  for (let i = array.length - 1; i > 0; i--) {
    const range = i + 1;
    const limit = 256 - (256 % range);
    let randIndex: number;

    do {
      crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);

    randIndex = buffer[0] % range;

    // Swap elements
    const temp = array[i];
    array[i] = array[randIndex];
    array[randIndex] = temp;
  }

  return array;
}
