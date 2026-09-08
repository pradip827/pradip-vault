import { generateIV } from './entropy';

/**
 * Helper to ensure typed arrays conform strictly to Web Crypto BufferSource.
 */
function toBufferSource(data: Uint8Array): BufferSource {
  return data as unknown as BufferSource;
}

/**
 * Imports 256-bit raw key bytes into a non-extractable Web Crypto CryptoKey.
 */
export async function importAesKey(rawKeyBytes: Uint8Array): Promise<CryptoKey> {
  if (rawKeyBytes.byteLength !== 32) {
    throw new Error(`Invalid key length: ${rawKeyBytes.byteLength} bytes. Expected 32 bytes (256 bits).`);
  }

  return await crypto.subtle.importKey(
    'raw',
    toBufferSource(rawKeyBytes),
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a plaintext byte array using AES-256-GCM with a 128-bit authentication tag
 * and Additional Authenticated Data (AAD).
 *
 * @param plaintext The raw bytes to encrypt.
 * @param keyBytes The 32-byte symmetric key.
 * @param aad The canonical header AAD bytes to authenticate against tampering.
 * @param customIv Optional 12-byte IV (generated via CSPRNG if omitted).
 * @returns Object containing the concatenated ciphertext + 128-bit tag and the 12-byte IV.
 */
export async function encryptAesGcm(
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
  aad: Uint8Array,
  customIv?: Uint8Array
): Promise<{ ciphertextWithTag: Uint8Array; iv: Uint8Array }> {
  const iv = customIv ?? generateIV();
  if (iv.byteLength !== 12) {
    throw new Error(`Invalid IV length: ${iv.byteLength} bytes. Expected 12 bytes (96 bits).`);
  }

  const cryptoKey = await importAesKey(keyBytes);

  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toBufferSource(iv),
      additionalData: toBufferSource(aad),
      tagLength: 128
    },
    cryptoKey,
    toBufferSource(plaintext)
  );

  return {
    ciphertextWithTag: new Uint8Array(cipherBuffer),
    iv
  };
}

/**
 * Decrypts and verifies an AES-256-GCM ciphertext using the provided key and AAD.
 *
 * If the master key is incorrect or if the ciphertext, IV, salt, or AAD
 * has been tampered with, Web Crypto's AES-GCM tag verification fails and
 * throws an OperationError. This function catches that failure and returns
 * a clean, generic error without leaking timing or internal crypto details.
 *
 * @param ciphertextWithTag Ciphertext buffer ending with the 16-byte authentication tag.
 * @param keyBytes 32-byte symmetric key.
 * @param aad Canonical Additional Authenticated Data matching encryption header.
 * @param iv 12-byte initialization vector.
 * @returns Decrypted plaintext byte array.
 */
export async function decryptAesGcm(
  ciphertextWithTag: Uint8Array,
  keyBytes: Uint8Array,
  aad: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  if (iv.byteLength !== 12) {
    throw new Error('Decryption failed: Incorrect master password or corrupted vault.');
  }

  if (ciphertextWithTag.byteLength < 16) {
    throw new Error('Decryption failed: Incorrect master password or corrupted vault.');
  }

  const cryptoKey = await importAesKey(keyBytes);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toBufferSource(iv),
        additionalData: toBufferSource(aad),
        tagLength: 128
      },
      cryptoKey,
      toBufferSource(ciphertextWithTag)
    );

    return new Uint8Array(decryptedBuffer);
  } catch (err) {
    // Constant, generic failure message to prevent oracle or differentiation attacks
    throw new Error('Decryption failed: Incorrect master password or corrupted vault.');
  }
}
