import { describe, it, expect, beforeEach } from 'vitest';
import { deriveKeyArgon2id } from './argon2';
import { encryptAesGcm, decryptAesGcm } from './aes';
import { generateSalt, generateIV, generateRandomBytes, getUnbiasedRandomChar, secureShuffle } from './entropy';
import { encodeBase64Url, decodeBase64Url, serializeCanonicalJson, constructEnvelopeAAD } from './serializer';
import { EncryptedVaultEnvelope, DEFAULT_CRYPTO_CONFIG, KDF_SECURITY_FLOOR } from './crypto.types';
import { CryptoService } from '../services/crypto.service';

describe('Cryptographic Engine & Security Core', () => {
  let cryptoService: CryptoService;

  beforeEach(() => {
    cryptoService = new CryptoService();
  });

  describe('Base64Url Serializer & Canonical JSON', () => {
    it('should encode and decode binary buffers roundtrip without loss', () => {
      const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63, 64]);
      const encoded = encodeBase64Url(original);

      // Base64url must not contain '+', '/', or '='
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');

      const decoded = decodeBase64Url(encoded);
      expect(decoded).toEqual(original);
    });

    it('should serialize JSON keys in lexicographical order (RFC 8785)', () => {
      const unordered = { z: 1, a: 'hello', m: { y: 2, b: 3 } };
      const canonical = serializeCanonicalJson(unordered);
      expect(canonical).toBe('{"a":"hello","m":{"b":3,"y":2},"z":1}');
    });
  });

  describe('Entropy & CSPRNG Utilities', () => {
    it('should generate 10,000 unique IVs with zero collision', () => {
      const set = new Set<string>();
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        const iv = generateIV();
        expect(iv.byteLength).toBe(12);
        const hex = encodeBase64Url(iv);
        set.add(hex);
      }

      expect(set.size).toBe(iterations);
    });

    it('should generate 16-byte random salts', () => {
      const salt = generateSalt();
      expect(salt.byteLength).toBe(16);
    });

    it('should return unbiased random characters from charset using rejection sampling', () => {
      const charset = 'ABCDEFGHI'; // Length 9 (not a divisor of 256)
      const counts: Record<string, number> = {};
      for (const char of charset) counts[char] = 0;

      const samples = 10000;
      for (let i = 0; i < samples; i++) {
        const char = getUnbiasedRandomChar(charset);
        counts[char]++;
      }

      // Verify all characters are represented
      for (const char of charset) {
        expect(counts[char]).toBeGreaterThan(0);
      }
    });

    it('should shuffle arrays using secure Fisher-Yates shuffle', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const copy = [...original];
      secureShuffle(copy);

      // Same elements must be present
      expect(copy.sort((a, b) => a - b)).toEqual(original);
    });
  });

  describe('Argon2id Key Derivation & Security Floors', () => {
    it('should derive a 32-byte key using valid Argon2id parameters', async () => {
      const salt = generateSalt();
      const key = await deriveKeyArgon2id('MySecretMasterPassword123!', salt, {
        memory: 32768, // 32 MiB floor
        iterations: 3
      });

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.byteLength).toBe(32);
    });

    it('should reject memory parameters below the 32 MiB security floor', async () => {
      const salt = generateSalt();
      await expect(
        deriveKeyArgon2id('Password', salt, { memory: 16384, iterations: 3 })
      ).rejects.toThrow(/below minimum security floor/);
    });

    it('should reject iteration parameters below the 3-iteration security floor', async () => {
      const salt = generateSalt();
      await expect(
        deriveKeyArgon2id('Password', salt, { memory: 65536, iterations: 2 })
      ).rejects.toThrow(/below minimum security floor/);
    });

    it('should reject salt lengths below 16 bytes', async () => {
      const shortSalt = new Uint8Array(8);
      await expect(
        deriveKeyArgon2id('Password', shortSalt, { memory: 65536, iterations: 3 })
      ).rejects.toThrow(/below minimum security floor/);
    });
  });

  describe('AES-256-GCM Authenticated Encryption & AAD Tamper Resistance', () => {
    const masterPass = 'SuperSecurePassphrase2026!';
    const testPlaintext = JSON.stringify({
      vaultId: 'uuid-12345',
      entries: [{ id: '1', title: 'GitHub', password: 'SecretPassword987!' }]
    });

    it('should encrypt and decrypt plaintext matching 100% of original bytes', async () => {
      const envelope = await cryptoService.encryptVaultDirect(testPlaintext, masterPass, {
        memory: 32768,
        iterations: 3
      });

      expect(envelope.formatVersion).toBe(1);
      expect(envelope.kdf.algorithm).toBe('Argon2id');
      expect(envelope.encryption.cipher).toBe('AES-256-GCM');
      expect(envelope.ciphertext).toBeDefined();

      const decrypted = await cryptoService.decryptVaultDirect(envelope, masterPass);
      expect(decrypted).toBe(testPlaintext);
    });

    it('should reject decryption when provided an incorrect master password', async () => {
      const envelope = await cryptoService.encryptVaultDirect(testPlaintext, masterPass, {
        memory: 32768,
        iterations: 3
      });

      await expect(
        cryptoService.decryptVaultDirect(envelope, 'IncorrectPassword!')
      ).rejects.toThrow('Decryption failed: Incorrect master password or corrupted vault.');
    });

    it('should detect ciphertext bit-flipping and fail AEAD authentication', async () => {
      const envelope = await cryptoService.encryptVaultDirect(testPlaintext, masterPass, {
        memory: 32768,
        iterations: 3
      });

      // Modify 1 character in the base64url ciphertext
      const originalCipher = envelope.ciphertext;
      const flippedChar = originalCipher[0] === 'A' ? 'B' : 'A';
      const tamperedCipher = flippedChar + originalCipher.substring(1);

      const tamperedEnvelope: EncryptedVaultEnvelope = {
        ...envelope,
        ciphertext: tamperedCipher
      };

      await expect(
        cryptoService.decryptVaultDirect(tamperedEnvelope, masterPass)
      ).rejects.toThrow('Decryption failed: Incorrect master password or corrupted vault.');
    });

    it('should detect tampering in IV and abort decryption', async () => {
      const envelope = await cryptoService.encryptVaultDirect(testPlaintext, masterPass, {
        memory: 32768,
        iterations: 3
      });

      const tamperedEnvelope: EncryptedVaultEnvelope = {
        ...envelope,
        encryption: {
          ...envelope.encryption,
          iv: encodeBase64Url(generateIV()) // Swapped IV
        }
      };

      await expect(
        cryptoService.decryptVaultDirect(tamperedEnvelope, masterPass)
      ).rejects.toThrow('Decryption failed: Incorrect master password or corrupted vault.');
    });

    it('should detect tampering in KDF header metadata via AAD verification', async () => {
      const envelope = await cryptoService.encryptVaultDirect(testPlaintext, masterPass, {
        memory: 32768,
        iterations: 3
      });

      // Attacker attempts to modify memory parameter in header
      const tamperedEnvelope: EncryptedVaultEnvelope = {
        ...envelope,
        kdf: {
          ...envelope.kdf,
          params: {
            ...envelope.kdf.params,
            memory: 65536 // Modified from 32768
          }
        }
      };

      await expect(
        cryptoService.decryptVaultDirect(tamperedEnvelope, masterPass)
      ).rejects.toThrow('Decryption failed: Incorrect master password or corrupted vault.');
    });

    it('should support fast in-memory re-encryption using session key without re-running Argon2id', async () => {
      // 1. Initial unlock/encryption derives session key
      const initial = await cryptoService.encryptVaultWithSessionDirect(testPlaintext, masterPass, {
        memory: 32768,
        iterations: 3
      });

      expect(initial.sessionKey.length).toBe(32);
      expect(initial.salt.length).toBe(16);

      // 2. Perform fast in-memory re-encryption with updated plaintext
      const updatedPlaintext = JSON.stringify({ message: 'Updated credential payload' });
      const newEnvelope = await cryptoService.encryptVaultWithKeyDirect(
        updatedPlaintext,
        initial.sessionKey,
        initial.salt,
        initial.kdfParams
      );

      // New envelope should have a fresh unique IV
      expect(newEnvelope.encryption.iv).not.toBe(initial.envelope.encryption.iv);

      // 3. Verify that decrypting with the master password decrypts the updated plaintext
      const decrypted = await cryptoService.decryptVaultDirect(newEnvelope, masterPass);
      expect(decrypted).toBe(updatedPlaintext);
    });

    it('should support direct decryption of envelope using active session key', async () => {
      const initial = await cryptoService.encryptVaultWithSessionDirect(testPlaintext, masterPass, {
        memory: 32768,
        iterations: 3
      });

      const decrypted = await cryptoService.decryptVaultWithKeyDirect(
        initial.envelope,
        initial.sessionKey
      );
      expect(decrypted).toBe(testPlaintext);
    });
  });
});
