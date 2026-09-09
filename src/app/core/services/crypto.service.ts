import { Injectable } from '@angular/core';
import {
  EncryptedVaultEnvelope,
  KdfParameters,
  WorkerRequest,
  WorkerResponse,
  EncryptedSessionData,
  DecryptedSessionData
} from '../crypto/crypto.types';

// Also import direct functions for direct execution / fallback / test environments
import { deriveKeyArgon2id } from '../crypto/argon2';
import { encryptAesGcm, decryptAesGcm } from '../crypto/aes';
import { generateSalt, generateIV } from '../crypto/entropy';
import { encodeBase64Url, decodeBase64Url, constructEnvelopeAAD } from '../crypto/serializer';
import { wipeBuffers } from '../security/zeroizer';
import { DEFAULT_CRYPTO_CONFIG, EnvelopeHeader } from '../crypto/crypto.types';

export interface VaultSessionContext {
  sessionKey: Uint8Array;
  salt: Uint8Array;
  kdfParams: KdfParameters;
}

export interface EncryptedVaultSessionResult extends VaultSessionContext {
  envelope: EncryptedVaultEnvelope;
}

export interface DecryptedVaultSessionResult extends VaultSessionContext {
  plaintextUtf8: string;
}

@Injectable({
  providedIn: 'root'
})
export class CryptoService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();

  /**
   * Lazily initializes or returns the active Web Worker instance.
   */
  private getWorker(): Worker {
    if (!this.worker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(
          new URL('../crypto/crypto.worker', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = ({ data }: { data: WorkerResponse<any> }) => {
          const pending = this.pendingRequests.get(data.id);
          if (pending) {
            this.pendingRequests.delete(data.id);
            if (data.success) {
              pending.resolve(data.data);
            } else {
              pending.reject(new Error(data.error));
            }
          }
        };

        this.worker.onerror = (err) => {
          // Reject all pending on worker catastrophic error
          for (const [id, pending] of this.pendingRequests.entries()) {
            pending.reject(new Error(`Crypto worker encountered an error: ${err.message}`));
          }
          this.pendingRequests.clear();
          this.terminateWorker();
        };
      } catch (e) {
        // Fallback to direct thread if Worker instantiation is restricted
        this.worker = null;
      }
    }

    if (!this.worker) {
      throw new Error('Web Worker not available in this environment.');
    }

    return this.worker;
  }

  /**
   * Encrypts a plaintext UTF-8 vault string using a master password into an authenticated envelope.
   */
  public async encryptVault(
    plaintextUtf8: string,
    masterPassword: string,
    customParams?: Partial<KdfParameters>
  ): Promise<EncryptedVaultEnvelope> {
    const res = await this.encryptVaultWithSession(plaintextUtf8, masterPassword, customParams);
    return res.envelope;
  }

  /**
   * Decrypts an authenticated vault envelope using a master password.
   */
  public async decryptVault(
    envelope: EncryptedVaultEnvelope,
    masterPassword: string
  ): Promise<string> {
    const res = await this.decryptVaultWithSession(envelope, masterPassword);
    return res.plaintextUtf8;
  }

  /**
   * Encrypts vault and captures the derived session key for subsequent fast in-memory re-encryptions.
   */
  public async encryptVaultWithSession(
    plaintextUtf8: string,
    masterPassword: string,
    customParams?: Partial<KdfParameters>
  ): Promise<EncryptedVaultSessionResult> {
    try {
      const worker = this.getWorker();
      const id = crypto.randomUUID();

      const workerRes = await new Promise<EncryptedSessionData>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
        const request: WorkerRequest = {
          id,
          action: 'ENCRYPT_VAULT',
          payload: { plaintextUtf8, masterPassword, customParams }
        };
        worker.postMessage(request);
      });

      return {
        envelope: workerRes.envelope,
        sessionKey: decodeBase64Url(workerRes.sessionKeyBase64Url),
        salt: decodeBase64Url(workerRes.saltBase64Url),
        kdfParams: workerRes.kdfParams
      };
    } catch {
      return await this.encryptVaultWithSessionDirect(plaintextUtf8, masterPassword, customParams);
    }
  }

  /**
   * Decrypts vault and captures the derived session key for subsequent fast in-memory re-encryptions.
   */
  public async decryptVaultWithSession(
    envelope: EncryptedVaultEnvelope,
    masterPassword: string
  ): Promise<DecryptedVaultSessionResult> {
    try {
      const worker = this.getWorker();
      const id = crypto.randomUUID();

      const workerRes = await new Promise<DecryptedSessionData>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
        const request: WorkerRequest = {
          id,
          action: 'DECRYPT_VAULT',
          payload: { envelope, masterPassword }
        };
        worker.postMessage(request);
      });

      return {
        plaintextUtf8: workerRes.plaintextUtf8,
        sessionKey: decodeBase64Url(workerRes.sessionKeyBase64Url),
        salt: decodeBase64Url(workerRes.saltBase64Url),
        kdfParams: workerRes.kdfParams
      };
    } catch {
      return await this.decryptVaultWithSessionDirect(envelope, masterPassword);
    }
  }

  /**
   * Re-encrypts an updated vault payload using the active in-memory session key (< 1ms).
   * Generates a fresh random 12-byte IV per encryption and binds the public envelope header via AAD.
   */
  public async encryptVaultWithKey(
    plaintextUtf8: string,
    sessionKey: Uint8Array,
    salt: Uint8Array,
    kdfParams: KdfParameters
  ): Promise<EncryptedVaultEnvelope> {
    try {
      const worker = this.getWorker();
      const id = crypto.randomUUID();

      return await new Promise<EncryptedVaultEnvelope>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
        const request: WorkerRequest = {
          id,
          action: 'ENCRYPT_VAULT_WITH_KEY',
          payload: {
            plaintextUtf8,
            sessionKeyBase64Url: encodeBase64Url(sessionKey),
            saltBase64Url: encodeBase64Url(salt),
            kdfParams
          }
        };
        worker.postMessage(request);
      });
    } catch {
      return await this.encryptVaultWithKeyDirect(plaintextUtf8, sessionKey, salt, kdfParams);
    }
  }

  /**
   * Decrypts an authenticated vault envelope using the active in-memory session key.
   */
  public async decryptVaultWithKey(
    envelope: EncryptedVaultEnvelope,
    sessionKey: Uint8Array
  ): Promise<string> {
    try {
      const worker = this.getWorker();
      const id = crypto.randomUUID();

      return await new Promise<string>((resolve, reject) => {
        this.pendingRequests.set(id, { resolve, reject });
        const request: WorkerRequest = {
          id,
          action: 'DECRYPT_VAULT_WITH_KEY',
          payload: {
            envelope,
            sessionKeyBase64Url: encodeBase64Url(sessionKey)
          }
        };
        worker.postMessage(request);
      });
    } catch {
      return await this.decryptVaultWithKeyDirect(envelope, sessionKey);
    }
  }

  /**
   * Explicitly terminates the Web Worker on vault lock.
   * Releases WebAssembly linear memory and worker V8 context back to the OS.
   */
  public terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }

  public isWorkerActive(): boolean {
    return this.worker !== null;
  }

  // --- Direct In-Thread Implementations (for Testing & Environments without Worker Support) ---

  public async encryptVaultDirect(
    plaintextUtf8: string,
    masterPassword: string,
    customParams?: Partial<KdfParameters>
  ): Promise<EncryptedVaultEnvelope> {
    const res = await this.encryptVaultWithSessionDirect(plaintextUtf8, masterPassword, customParams);
    return res.envelope;
  }

  public async encryptVaultWithSessionDirect(
    plaintextUtf8: string,
    masterPassword: string,
    customParams?: Partial<KdfParameters>
  ): Promise<EncryptedVaultSessionResult> {
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

    // Copy session key bytes before wiping scratch buffers
    const sessionKey = new Uint8Array(keyBytes);

    wipeBuffers(plaintextBytes, keyBytes, iv, ciphertextWithTag);

    return {
      envelope,
      sessionKey,
      salt: new Uint8Array(salt),
      kdfParams: header.kdf.params
    };
  }

  public async decryptVaultDirect(
    envelope: EncryptedVaultEnvelope,
    masterPassword: string
  ): Promise<string> {
    const res = await this.decryptVaultWithSessionDirect(envelope, masterPassword);
    return res.plaintextUtf8;
  }

  public async decryptVaultWithSessionDirect(
    envelope: EncryptedVaultEnvelope,
    masterPassword: string
  ): Promise<DecryptedVaultSessionResult> {
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

    const aad = constructEnvelopeAAD(envelope);
    const keyBytes = await deriveKeyArgon2id(masterPassword, salt, envelope.kdf.params);

    const decryptedBytes = await decryptAesGcm(ciphertextWithTag, keyBytes, aad, iv);
    const plaintextUtf8 = new TextDecoder().decode(decryptedBytes);

    const sessionKey = new Uint8Array(keyBytes);

    wipeBuffers(keyBytes, decryptedBytes, iv, ciphertextWithTag);

    return {
      plaintextUtf8,
      sessionKey,
      salt: new Uint8Array(salt),
      kdfParams: envelope.kdf.params
    };
  }

  public async encryptVaultWithKeyDirect(
    plaintextUtf8: string,
    sessionKey: Uint8Array,
    salt: Uint8Array,
    kdfParams: KdfParameters
  ): Promise<EncryptedVaultEnvelope> {
    const iv = generateIV();

    const header: EnvelopeHeader = {
      formatVersion: 1,
      kdf: {
        algorithm: 'Argon2id',
        params: kdfParams,
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

    const { ciphertextWithTag } = await encryptAesGcm(plaintextBytes, sessionKey, aad, iv);

    const envelope: EncryptedVaultEnvelope = {
      ...header,
      ciphertext: encodeBase64Url(ciphertextWithTag)
    };

    wipeBuffers(plaintextBytes, iv, ciphertextWithTag);

    return envelope;
  }

  public async decryptVaultWithKeyDirect(
    envelope: EncryptedVaultEnvelope,
    sessionKey: Uint8Array
  ): Promise<string> {
    if (envelope.formatVersion !== 1) {
      throw new Error('Unsupported vault envelope format version.');
    }

    if (envelope.encryption.cipher !== 'AES-256-GCM') {
      throw new Error(`Unsupported cipher algorithm: ${envelope.encryption.cipher}`);
    }

    const iv = decodeBase64Url(envelope.encryption.iv);
    const ciphertextWithTag = decodeBase64Url(envelope.ciphertext);
    const aad = constructEnvelopeAAD(envelope);

    const decryptedBytes = await decryptAesGcm(ciphertextWithTag, sessionKey, aad, iv);
    const plaintextUtf8 = new TextDecoder().decode(decryptedBytes);

    wipeBuffers(decryptedBytes, iv, ciphertextWithTag);

    return plaintextUtf8;
  }
}
