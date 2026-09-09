import { Injectable, inject, signal, computed } from '@angular/core';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { DecryptedVault, createEmptyVault } from '../models/vault.model';
import { EncryptedVaultEnvelope, KdfParameters } from '../crypto/crypto.types';
import { wipeBuffer } from '../security/zeroizer';

@Injectable({
  providedIn: 'root'
})
export class VaultService {
  private readonly storage = inject(StorageService);
  private readonly crypto = inject(CryptoService);

  // Volatile in-memory session encryption context (wiped on lock)
  private sessionKey: Uint8Array | null = null;
  private currentSalt: Uint8Array | null = null;
  private currentKdfParams: KdfParameters | null = null;

  // In-memory transient reactive signals
  public readonly isLocked = signal<boolean>(true);
  public readonly hasExistingVault = signal<boolean>(false);
  public readonly isBusy = signal<boolean>(false);
  public readonly busyMessage = signal<string>('');
  public readonly vault = signal<DecryptedVault | null>(null);

  // Computed signals
  public readonly entries = computed(() => this.vault()?.entries ?? []);
  public readonly revision = computed(() => this.vault()?.revision ?? 0);
  public readonly vaultName = computed(() => this.vault()?.vaultName ?? 'ZeroVault');

  private readonly lockCallbacks: Array<() => void> = [];
  private readonly unlockCallbacks: Array<() => void> = [];

  public onLock(callback: () => void): void {
    this.lockCallbacks.push(callback);
  }

  public onUnlock(callback: () => void): void {
    this.unlockCallbacks.push(callback);
  }

  private triggerUnlockHooks(): void {
    for (const cb of this.unlockCallbacks) {
      try { cb(); } catch {}
    }
  }

  private triggerLockHooks(): void {
    for (const cb of this.lockCallbacks) {
      try { cb(); } catch {}
    }
  }

  constructor() {
    this.checkExistingVault();
  }

  /**
   * Checks if an encrypted vault envelope already exists in IndexedDB.
   */
  public async checkExistingVault(): Promise<boolean> {
    try {
      const exists = await this.storage.hasVault();
      this.hasExistingVault.set(exists);
      return exists;
    } catch {
      this.hasExistingVault.set(false);
      return false;
    }
  }

  /**
   * Initializes a brand new vault:
   * 1. Constructs empty DecryptedVault schema in memory.
   * 2. Derives key and encrypts with AES-256-GCM via Web Worker.
   * 3. Stores the encrypted envelope into IndexedDB.
   * 4. Retains decrypted vault and session key in memory and marks vault as unlocked.
   */
  public async createVault(vaultName: string, masterPassword: string): Promise<void> {
    if (!masterPassword || masterPassword.length < 4) {
      throw new Error('Master password must be at least 4 characters long.');
    }

    this.isBusy.set(true);
    this.busyMessage.set('Deriving encryption key via Argon2id (64 MiB)...');

    try {
      const emptyPayload = createEmptyVault(vaultName);
      const jsonPayload = JSON.stringify(emptyPayload);

      const session = await this.crypto.encryptVaultWithSession(jsonPayload, masterPassword);
      await this.storage.saveVaultEnvelope(session.envelope, emptyPayload.revision);

      this.sessionKey = session.sessionKey;
      this.currentSalt = session.salt;
      this.currentKdfParams = session.kdfParams;

      this.vault.set(emptyPayload);
      this.isLocked.set(false);
      this.hasExistingVault.set(true);
      this.triggerUnlockHooks();
    } finally {
      this.isBusy.set(false);
      this.busyMessage.set('');
    }
  }

  /**
   * Unlocks an existing vault:
   * 1. Loads the encrypted envelope from IndexedDB.
   * 2. Re-derives key and decrypts via AES-256-GCM in Web Worker.
   * 3. Retains session key in volatile memory for fast subsequent updates.
   * 4. Validates decrypted payload schema.
   * 5. Populates decrypted vault in memory and marks as unlocked.
   */
  public async unlockVault(masterPassword: string): Promise<void> {
    this.isBusy.set(true);
    this.busyMessage.set('Deriving key and decrypting vault in isolated worker...');

    try {
      const envelope = await this.storage.loadVaultEnvelope();
      if (!envelope) {
        throw new Error('No encrypted vault found in local storage. Create a vault first.');
      }

      const session = await this.crypto.decryptVaultWithSession(envelope, masterPassword);

      let parsed: DecryptedVault;
      try {
        parsed = JSON.parse(session.plaintextUtf8);
      } catch {
        throw new Error('Decryption failed: Corrupted vault payload.');
      }

      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
        throw new Error('Invalid vault payload schema.');
      }

      this.sessionKey = session.sessionKey;
      this.currentSalt = session.salt;
      this.currentKdfParams = session.kdfParams;

      this.vault.set(parsed);
      this.isLocked.set(false);
      this.triggerUnlockHooks();
    } finally {
      this.isBusy.set(false);
      this.busyMessage.set('');
    }
  }

  /**
   * Locks the vault:
   * 1. Explicitly wipes volatile session keys with zeroizer.
   * 2. Nullifies decrypted vault state from Angular Signals.
   * 3. Marks isLocked = true.
   * 4. Terminates the crypto Web Worker to flush WebAssembly memory and V8 context.
   */
  public lockVault(): void {
    if (this.sessionKey) {
      wipeBuffer(this.sessionKey);
      this.sessionKey = null;
    }
    if (this.currentSalt) {
      wipeBuffer(this.currentSalt);
      this.currentSalt = null;
    }
    this.currentKdfParams = null;

    this.vault.set(null);
    this.isLocked.set(true);
    this.crypto.terminateWorker();
    this.triggerLockHooks();
  }

  /**
   * Persists the currently unlocked in-memory vault after modifications:
   * 1. Increments monotonic revision and updates timestamp.
   * 2. Re-encrypts via in-memory session key (< 1ms) or masterPassword if supplied.
   * 3. Saves new encrypted envelope to IndexedDB.
   */
  public async saveCurrentVault(masterPassword?: string): Promise<void> {
    const current = this.vault();
    if (!current || this.isLocked()) {
      throw new Error('Cannot save vault: Vault is locked.');
    }

    this.isBusy.set(true);
    this.busyMessage.set('Encrypting and saving vault...');

    try {
      const updatedVault: DecryptedVault = {
        ...current,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString()
      };

      const json = JSON.stringify(updatedVault);
      let envelope: EncryptedVaultEnvelope;

      if (masterPassword) {
        const session = await this.crypto.encryptVaultWithSession(json, masterPassword);
        envelope = session.envelope;
        this.sessionKey = session.sessionKey;
        this.currentSalt = session.salt;
        this.currentKdfParams = session.kdfParams;
      } else if (this.sessionKey && this.currentSalt && this.currentKdfParams) {
        envelope = await this.crypto.encryptVaultWithKey(
          json,
          this.sessionKey,
          this.currentSalt,
          this.currentKdfParams
        );
      } else {
        throw new Error('No active encryption session key available. Re-authenticate vault.');
      }

      await this.storage.saveVaultEnvelope(envelope, updatedVault.revision);
      this.vault.set(updatedVault);
    } finally {
      this.isBusy.set(false);
      this.busyMessage.set('');
    }
  }

  /**
   * Atomic updater helper: applies a transformation function to the in-memory vault,
   * then re-encrypts and persists the change.
   */
  public async updateVault(updater: (current: DecryptedVault) => DecryptedVault): Promise<void> {
    const current = this.vault();
    if (!current || this.isLocked()) {
      throw new Error('Cannot update vault: Vault is locked.');
    }

    const modified = updater(current);
    this.vault.set(modified);
    await this.saveCurrentVault();
  }

  /**
   * Deletes the local vault record and locks memory.
   */
  public async deleteVault(): Promise<void> {
    this.lockVault();
    await this.storage.deleteVault();
    this.hasExistingVault.set(false);
  }

  /**
   * Returns the active session key buffer for fast peer decryption during sync operations.
   */
  public getSessionKey(): Uint8Array | null {
    return this.sessionKey;
  }
}
