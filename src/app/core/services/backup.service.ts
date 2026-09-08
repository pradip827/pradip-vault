import { Injectable, inject } from '@angular/core';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { ToastService } from './toast.service';
import { VaultBackupFile, EncryptedVaultEnvelope, KDF_SECURITY_FLOOR } from '../crypto/crypto.types';
import { DecryptedVault, VaultEntry } from '../models/vault.model';
import { serializeCanonicalJson, computeSha256Hex, decodeBase64Url } from '../crypto/serializer';

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  total: number;
}

@Injectable({
  providedIn: 'root'
})
export class BackupService {
  private readonly vaultService = inject(VaultService);
  private readonly storage = inject(StorageService);
  private readonly crypto = inject(CryptoService);
  private readonly toast = inject(ToastService);

  /**
   * Generates a fully authenticated, zero-knowledge .zerovault backup file
   * from the active encrypted envelope.
   */
  public async generateBackupFile(): Promise<{ filename: string; blob: Blob; backup: VaultBackupFile }> {
    if (this.vaultService.isLocked()) {
      throw new Error('Vault must be unlocked to export a backup.');
    }

    const envelope = await this.storage.loadVaultEnvelope();
    if (!envelope) {
      throw new Error('No encrypted vault envelope found in local storage.');
    }

    // Compute SHA-256 integrity hash over canonical envelope
    const canonicalEnvelope = serializeCanonicalJson(envelope);
    const checksumSha256 = await computeSha256Hex(canonicalEnvelope);

    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-');
    const filename = `zerovault_backup_${dateStr.substring(0, 19)}.zerovault`;

    const backup: VaultBackupFile = {
      magic: 'ZERO_VAULT_BACKUP',
      version: 1,
      app: 'ZeroVault',
      exportedAt: now.toISOString(),
      checksumSha256,
      envelope
    };

    const jsonString = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });

    return { filename, blob, backup };
  }

  /**
   * Triggers client-side browser download of the generated backup blob.
   */
  public triggerDownload(blob: Blob, filename: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Parses and strictly validates a raw .zerovault file content string.
   * Checks magic identifier, format version, SHA-256 checksum integrity, and KDF security floor.
   */
  public async parseBackupFile(content: string): Promise<VaultBackupFile> {
    if (!content || typeof content !== 'string') {
      throw new Error('Invalid backup file: File content is empty.');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Invalid backup file: Malformed JSON syntax.');
    }

    if (parsed.magic !== 'ZERO_VAULT_BACKUP' && parsed.magic !== 'PRADIP_VAULT_BACKUP') {
      throw new Error('Invalid backup file: Unrecognized magic header. Expected ZERO_VAULT_BACKUP.');
    }

    if (parsed.version !== 1) {
      throw new Error(`Unsupported backup format version: ${parsed.version}.`);
    }

    if (!parsed.envelope || typeof parsed.envelope !== 'object') {
      throw new Error('Invalid backup file: Missing encrypted envelope structure.');
    }

    if (!parsed.checksumSha256 || typeof parsed.checksumSha256 !== 'string') {
      throw new Error('Invalid backup file: Missing integrity checksum.');
    }

    // Verify SHA-256 checksum over canonical envelope representation
    const canonicalEnvelope = serializeCanonicalJson(parsed.envelope);
    const calculatedHash = await computeSha256Hex(canonicalEnvelope);

    if (calculatedHash.toLowerCase() !== parsed.checksumSha256.toLowerCase()) {
      throw new Error('Integrity check failed: Backup file is corrupted or has been modified.');
    }

    // Validate KDF security parameters against minimum floor
    const kdf = parsed.envelope.kdf;
    if (!kdf || kdf.algorithm !== 'Argon2id' || !kdf.params) {
      throw new Error('Invalid backup file: Unsupported KDF algorithm.');
    }

    if (kdf.params.memory < KDF_SECURITY_FLOOR.MIN_MEMORY_KIB) {
      throw new Error(`Insecure KDF parameters: Memory cost (${kdf.params.memory} KiB) is below security floor (${KDF_SECURITY_FLOOR.MIN_MEMORY_KIB} KiB).`);
    }

    if (kdf.params.iterations < KDF_SECURITY_FLOOR.MIN_ITERATIONS) {
      throw new Error(`Insecure KDF parameters: Iteration count (${kdf.params.iterations}) is below security floor (${KDF_SECURITY_FLOOR.MIN_ITERATIONS}).`);
    }

    try {
      const saltBytes = decodeBase64Url(kdf.salt);
      if (saltBytes.length < KDF_SECURITY_FLOOR.MIN_SALT_BYTES) {
        throw new Error('Insecure KDF parameters: Salt length is below 16 bytes.');
      }
    } catch {
      throw new Error('Invalid backup file: Malformed KDF salt.');
    }

    // Validate encryption section
    const enc = parsed.envelope.encryption;
    if (!enc || enc.cipher !== 'AES-256-GCM' || enc.tagLength !== 128) {
      throw new Error('Invalid backup file: Unsupported encryption cipher.');
    }

    if (!parsed.envelope.ciphertext) {
      throw new Error('Invalid backup file: Missing ciphertext payload.');
    }

    return parsed as VaultBackupFile;
  }

  /**
   * Decrypts an authenticated backup file using the provided master password.
   * Throws if password is incorrect or authentication tag fails.
   */
  public async decryptBackup(backup: VaultBackupFile, masterPassword: string): Promise<DecryptedVault> {
    if (!masterPassword) {
      throw new Error('Master password is required to decrypt backup file.');
    }

    try {
      const plaintextUtf8 = await this.crypto.decryptVault(backup.envelope, masterPassword);
      const vault: DecryptedVault = JSON.parse(plaintextUtf8);

      if (vault.schemaVersion !== 1 || !Array.isArray(vault.entries)) {
        throw new Error('Decrypted backup content is not a valid ZeroVault structure.');
      }

      return vault;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('authentication failed') || msg.includes('Tag mismatch') || msg.includes('Ciphertext integrity check failed')) {
        throw new Error('Incorrect master password for this backup file.');
      }
      throw err;
    }
  }

  /**
   * Applies the imported vault data to the active vault based on the chosen strategy.
   * - 'overwrite': Replaces all existing entries with imported entries.
   * - 'merge': Merges entries, retaining newer updatedAt records on conflict and appending new entries.
   */
  public async applyImport(
    importedVault: DecryptedVault,
    strategy: 'merge' | 'overwrite',
    backupEnvelope?: EncryptedVaultEnvelope
  ): Promise<ImportResult> {
    const isLocked = this.vaultService.isLocked();

    // If vault is currently locked or does not exist, restore directly as active envelope
    if (isLocked || !this.vaultService.hasExistingVault()) {
      if (!backupEnvelope) {
        throw new Error('Backup envelope required to restore inactive vault.');
      }

      await this.storage.saveVaultEnvelope(backupEnvelope, importedVault.revision);
      this.vaultService.hasExistingVault.set(true);

      return {
        added: importedVault.entries.length,
        updated: 0,
        skipped: 0,
        total: importedVault.entries.length
      };
    }

    // Vault is unlocked: perform in-memory merge or overwrite and re-encrypt
    let result: ImportResult = { added: 0, updated: 0, skipped: 0, total: 0 };

    await this.vaultService.updateVault(currentVault => {
      if (strategy === 'overwrite') {
        result = {
          added: importedVault.entries.length,
          updated: 0,
          skipped: 0,
          total: importedVault.entries.length
        };
        return {
          ...currentVault,
          entries: [...importedVault.entries]
        };
      }

      // 'merge' strategy
      const existingEntries = [...currentVault.entries];
      const entryMapById = new Map<string, VaultEntry>();
      const entryMapBySig = new Map<string, VaultEntry>();

      const getSig = (e: { title: string; username?: string; category: string }) =>
        `${(e.title || '').trim().toLowerCase()}|${(e.username || '').trim().toLowerCase()}|${e.category}`;

      existingEntries.forEach(e => {
        entryMapById.set(e.id, e);
        entryMapBySig.set(getSig(e), e);
      });

      let added = 0;
      let updated = 0;
      let skipped = 0;

      importedVault.entries.forEach(importedEntry => {
        const matchById = entryMapById.get(importedEntry.id);
        const matchBySig = entryMapBySig.get(getSig(importedEntry));
        const match = matchById || matchBySig;

        if (match) {
          const importTime = new Date(importedEntry.updatedAt || 0).getTime();
          const existingTime = new Date(match.updatedAt || 0).getTime();

          if (importTime > existingTime) {
            // Imported entry is newer -> update existing record
            const idx = existingEntries.findIndex(e => e.id === match.id);
            if (idx !== -1) {
              existingEntries[idx] = { ...importedEntry, id: match.id };
              updated++;
            }
          } else {
            skipped++;
          }
        } else {
          // New entry -> append
          existingEntries.push({ ...importedEntry });
          entryMapById.set(importedEntry.id, importedEntry);
          entryMapBySig.set(getSig(importedEntry), importedEntry);
          added++;
        }
      });

      result = {
        added,
        updated,
        skipped,
        total: existingEntries.length
      };

      return {
        ...currentVault,
        entries: existingEntries
      };
    });

    return result;
  }
}
