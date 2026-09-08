/// <reference lib="webworker" />

import {
  WorkerRequest,
  EncryptedVaultEnvelope,
  EnvelopeHeader,
  DEFAULT_CRYPTO_CONFIG,
  EncryptedSessionData,
  DecryptedSessionData
} from './crypto.types';
import { deriveKeyArgon2id } from './argon2';
import { encryptAesGcm, decryptAesGcm } from './aes';
import { generateSalt, generateIV } from './entropy';
import { encodeBase64Url, decodeBase64Url, constructEnvelopeAAD } from './serializer';
import { wipeBuffer, wipeBuffers } from '../security/zeroizer';

addEventListener('message', async ({ data }: { data: WorkerRequest }) => {
  const { id, action } = data;

  try {
    switch (action) {
      case 'DERIVE_KEY': {
        const { masterPassword, saltBase64Url, params } = data.payload;
        const salt = decodeBase64Url(saltBase64Url);
        const rawKey = await deriveKeyArgon2id(masterPassword, salt, params);

        const keyBase64Url = encodeBase64Url(rawKey);
        wipeBuffer(rawKey);
        wipeBuffer(salt);

        postMessage({ id, success: true, data: keyBase64Url });
        break;
      }

      case 'ENCRYPT_VAULT': {
        const { plaintextUtf8, masterPassword, customParams } = data.payload;

        const salt = generateSalt();
        const iv = generateIV();

        const keyBytes = await deriveKeyArgon2id(masterPassword, salt, customParams);

        const header: EnvelopeHeader = {
          formatVersion: 1,
          kdf: {
            algorithm: 'Argon2id',
            params: {
              ...DEFAULT_CRYPTO_CONFIG.kdf.params,
              ...customParams
            },
            salt: encodeBase64Url(salt)
          },
          encryption: {
            cipher: 'AES-256-GCM',
            iv: encodeBase64Url(iv),
            tagLength: 128
          }
        };

        const aad = constructEnvelopeAAD(header);
        const plaintextBytes = new TextEncoder().encode(plaintextUtf8);

        const { ciphertextWithTag } = await encryptAesGcm(plaintextBytes, keyBytes, aad, iv);

        const envelope: EncryptedVaultEnvelope = {
          ...header,
          ciphertext: encodeBase64Url(ciphertextWithTag)
        };

        const sessionKeyBase64Url = encodeBase64Url(keyBytes);

        // Clean up sensitive memory buffers
        wipeBuffers(plaintextBytes, keyBytes, salt, iv, ciphertextWithTag);

        const result: EncryptedSessionData = {
          envelope,
          sessionKeyBase64Url,
          saltBase64Url: header.kdf.salt,
          kdfParams: header.kdf.params
        };

        postMessage({ id, success: true, data: result });
        break;
      }

      case 'DECRYPT_VAULT': {
        const { envelope, masterPassword } = data.payload;

        // Basic envelope schema verification
        if (envelope.formatVersion !== 1) {
          throw new Error('Unsupported vault envelope format version.');
        }

        if (envelope.kdf.algorithm !== 'Argon2id') {
          throw new Error(`Unsupported KDF algorithm: ${envelope.kdf.algorithm}`);
        }

        if (envelope.encryption.cipher !== 'AES-256-GCM') {
          throw new Error(`Unsupported cipher algorithm: ${envelope.encryption.cipher}`);
        }

        const salt = decodeBase64Url(envelope.kdf.salt);
        const iv = decodeBase64Url(envelope.encryption.iv);
        const ciphertextWithTag = decodeBase64Url(envelope.ciphertext);

        // Reconstruct exact AAD from public header
        const aad = constructEnvelopeAAD(envelope);

        // Derive key using envelope's own KDF parameters
        const keyBytes = await deriveKeyArgon2id(masterPassword, salt, envelope.kdf.params);

        // Authenticated AES-GCM decryption
        const decryptedBytes = await decryptAesGcm(ciphertextWithTag, keyBytes, aad, iv);

        const plaintextUtf8 = new TextDecoder().decode(decryptedBytes);
        const sessionKeyBase64Url = encodeBase64Url(keyBytes);

        // Clean up sensitive memory buffers
        wipeBuffers(keyBytes, decryptedBytes, salt, iv, ciphertextWithTag);

        const result: DecryptedSessionData = {
          plaintextUtf8,
          sessionKeyBase64Url,
          saltBase64Url: envelope.kdf.salt,
          kdfParams: envelope.kdf.params
        };

        postMessage({ id, success: true, data: result });
        break;
      }

      case 'ENCRYPT_VAULT_WITH_KEY': {
        const { plaintextUtf8, sessionKeyBase64Url, saltBase64Url, kdfParams } = data.payload;

        const keyBytes = decodeBase64Url(sessionKeyBase64Url);
        const iv = generateIV();

        const header: EnvelopeHeader = {
          formatVersion: 1,
          kdf: {
            algorithm: 'Argon2id',
            params: kdfParams,
            salt: saltBase64Url
          },
          encryption: {
            cipher: 'AES-256-GCM',
            iv: encodeBase64Url(iv),
            tagLength: 128
          }
        };

        const aad = constructEnvelopeAAD(header);
        const plaintextBytes = new TextEncoder().encode(plaintextUtf8);

        const { ciphertextWithTag } = await encryptAesGcm(plaintextBytes, keyBytes, aad, iv);

        const envelope: EncryptedVaultEnvelope = {
          ...header,
          ciphertext: encodeBase64Url(ciphertextWithTag)
        };

        wipeBuffers(plaintextBytes, keyBytes, iv, ciphertextWithTag);

        postMessage({ id, success: true, data: envelope });
        break;
      }

      case 'DECRYPT_VAULT_WITH_KEY': {
        const { envelope, sessionKeyBase64Url } = data.payload;

        if (envelope.formatVersion !== 1) {
          throw new Error('Unsupported vault envelope format version.');
        }

        if (envelope.encryption.cipher !== 'AES-256-GCM') {
          throw new Error(`Unsupported cipher algorithm: ${envelope.encryption.cipher}`);
        }

        const keyBytes = decodeBase64Url(sessionKeyBase64Url);
        const iv = decodeBase64Url(envelope.encryption.iv);
        const ciphertextWithTag = decodeBase64Url(envelope.ciphertext);
        const aad = constructEnvelopeAAD(envelope);

        const decryptedBytes = await decryptAesGcm(ciphertextWithTag, keyBytes, aad, iv);
        const plaintextUtf8 = new TextDecoder().decode(decryptedBytes);

        wipeBuffers(keyBytes, decryptedBytes, iv, ciphertextWithTag);

        postMessage({ id, success: true, data: plaintextUtf8 });
        break;
      }

      default:
        throw new Error(`Unknown worker action: ${(data as unknown as { action: string }).action}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Cryptographic operation failed.';
    postMessage({ id, success: false, error: message });
  }
});
