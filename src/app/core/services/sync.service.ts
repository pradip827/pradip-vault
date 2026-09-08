import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { GoogleDriveService } from './google-drive.service';
import { ToastService } from './toast.service';
import { DecryptedVault, VaultEntry } from '../models/vault.model';
import { EncryptedVaultEnvelope } from '../crypto/crypto.types';

export interface SyncSummary {
  status: 'synced' | 'fast_forward_push' | 'fast_forward_pull' | 'merged';
  added: number;
  updated: number;
  deleted: number;
  conflicts: number;
  localRevision: number;
  remoteRevision: number;
}

@Injectable({
  providedIn: 'root'
})
export class SyncService {
  private readonly vaultService = inject(VaultService);
  private readonly storage = inject(StorageService);
  private readonly crypto = inject(CryptoService);
  private readonly googleDrive = inject(GoogleDriveService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // Runtime Signals
  public readonly isConnected = signal<boolean>(false);
  public readonly isSyncing = signal<boolean>(false);
  public readonly lastSyncTime = signal<string | null>(null);
  public readonly syncStatus = signal<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  public readonly syncError = signal<string | null>(null);
  public readonly googleClientId = signal<string>('');
  public readonly isEnvConfigured = signal<boolean>(false);

  constructor() {
    this.initSyncState();
  }

  private async initSyncState(): Promise<void> {
    try {
      const meta = await this.storage.loadSyncMetadata();
      if (meta) {
        this.lastSyncTime.set(meta.lastSyncedAt);
        if (meta.googleClientId) {
          this.googleClientId.set(meta.googleClientId);
        }
      }
    } catch {
      // Ignore initial storage read restrictions
    }

    // Check for query parameter in URL (e.g. ?google_client_id=... or ?client_id=...)
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const urlParams = new URLSearchParams(window.location.search);
        const queryClientId = urlParams.get('google_client_id') || urlParams.get('client_id');
        if (queryClientId && queryClientId.trim()) {
          const trimmed = queryClientId.trim();
          await this.setGoogleClientId(trimmed);
          this.toast.success('Google Client ID configured from link.');
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState({}, document.title, cleanUrl);
          return;
        }
      }
    } catch {
      // Ignore in non-browser/test contexts
    }

    // If no client ID set locally, fetch from Cloudflare Pages Function (/api/config)
    if (!this.googleClientId()) {
      await this.fetchRemoteConfig();
    }
  }

  /**
   * Fetches the Cloudflare Pages environment configuration.
   */
  public async fetchRemoteConfig(): Promise<void> {
    try {
      if (typeof fetch === 'undefined') return;
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (data && data.googleClientId && typeof data.googleClientId === 'string') {
            const trimmed = data.googleClientId.trim();
            if (trimmed) {
              this.googleClientId.set(trimmed);
              this.isEnvConfigured.set(true);
            }
          }
        }
      }
    } catch {
      // Gracefully ignore network errors or offline
    }
  }

  /**
   * Sets the Google OAuth Client ID and persists it locally.
   */
  public async setGoogleClientId(clientId: string): Promise<void> {
    const trimmed = clientId.trim();
    this.googleClientId.set(trimmed);
    if (!trimmed) {
      this.isEnvConfigured.set(false);
    }
    await this.storage.saveSyncMetadata({ googleClientId: trimmed });
  }

  /**
   * Initiates Google OAuth2 authorization.
   */
  public async connect(): Promise<void> {
    const clientId = this.googleClientId();
    if (!clientId) {
      throw new Error('Google OAuth Client ID is required. Please configure it in settings.');
    }

    try {
      this.syncError.set(null);
      await this.googleDrive.requestOAuthToken(clientId);
      this.isConnected.set(true);
      this.toast.success('Connected to Google Drive.');

      // If no local vault exists on this device/window, check and restore from Drive
      if (!this.vaultService.hasExistingVault()) {
        const token = this.googleDrive.getAccessToken();
        if (token) {
          const fileInfo = await this.googleDrive.searchVaultFile(token);
          if (fileInfo) {
            await this.pullVaultFromDrive();
            this.router.navigate(['/unlock']);
            return;
          }
        }
      } else if (!this.vaultService.isLocked()) {
        // Perform standard sync if vault is already unlocked
        await this.syncNow();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.syncError.set(msg);
      this.isConnected.set(false);
      this.toast.error(msg);
      throw err;
    }
  }

  /**
   * Downloads the remote vault envelope from Google Drive and saves it to local IndexedDB.
   * Useful when restoring a vault on a new device or in an Incognito window where no local vault exists yet.
   */
  public async pullVaultFromDrive(): Promise<boolean> {
    const token = this.googleDrive.getAccessToken();
    if (!token) {
      throw new Error('Google Drive session expired or not connected. Please connect first.');
    }

    this.isSyncing.set(true);
    this.syncStatus.set('syncing');
    this.syncError.set(null);

    try {
      const remoteFileInfo = await this.googleDrive.searchVaultFile(token);
      if (!remoteFileInfo) {
        throw new Error('No vault file found in Google Drive appDataFolder.');
      }

      const remoteContent = await this.googleDrive.downloadVaultFile(token, remoteFileInfo.id);
      const remoteEnvelope = JSON.parse(remoteContent) as EncryptedVaultEnvelope;

      // Save encrypted envelope to local IndexedDB
      const remoteRevision = remoteFileInfo.revision ?? 1;
      await this.storage.saveVaultEnvelope(remoteEnvelope, remoteRevision);
      await this.storage.saveSyncBase(remoteEnvelope, remoteRevision);
      await this.storage.saveSyncMetadata({
        lastSyncedAt: new Date().toISOString(),
        remoteFileId: remoteFileInfo.id,
        remoteRevision
      });

      await this.vaultService.checkExistingVault();
      const nowIso = new Date().toISOString();
      this.lastSyncTime.set(nowIso);
      this.syncStatus.set('synced');
      this.toast.success('Vault downloaded from Google Drive! You can now unlock it with your master password.');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.syncError.set(msg);
      this.syncStatus.set('error');
      this.toast.error(`Download failed: ${msg}`);
      throw err;
    } finally {
      this.isSyncing.set(false);
    }
  }

  /**
   * Disconnects Google Drive session and clears in-memory tokens.
   */
  public disconnect(): void {
    this.googleDrive.clearTokens();
    this.isConnected.set(false);
    this.syncStatus.set('idle');
    this.toast.info('Disconnected from Google Drive.');
  }

  /**
   * Overwrites the remote vault in Google Drive with the local vault envelope.
   * Resolves encryption mismatch or stale remote files by force-pushing local data.
   */
  public async overwriteRemoteVault(): Promise<void> {
    if (this.vaultService.isLocked()) {
      throw new Error('Vault is locked. Unlock vault before syncing.');
    }

    const token = this.googleDrive.getAccessToken();
    if (!token) {
      this.isConnected.set(false);
      throw new Error('Google Drive session expired or not connected. Please connect first.');
    }

    const localVault = this.vaultService.vault();
    const localEnvelope = await this.storage.loadVaultEnvelope();
    if (!localVault || !localEnvelope) {
      throw new Error('Local vault is missing.');
    }

    this.isSyncing.set(true);
    this.syncStatus.set('syncing');
    this.syncError.set(null);

    try {
      const remoteFileInfo = await this.googleDrive.searchVaultFile(token);
      let fileId: string;

      if (remoteFileInfo) {
        fileId = remoteFileInfo.id;
        await this.googleDrive.updateVaultFile(
          token,
          fileId,
          JSON.stringify(localEnvelope),
          localVault.revision
        );
      } else {
        const uploadRes = await this.googleDrive.uploadVaultFile(
          token,
          JSON.stringify(localEnvelope),
          localVault.revision
        );
        fileId = uploadRes.id;
      }

      await this.storage.saveSyncBase(localEnvelope, localVault.revision);
      await this.storage.saveSyncMetadata({
        lastSyncedAt: new Date().toISOString(),
        remoteFileId: fileId,
        remoteRevision: localVault.revision
      });

      const nowIso = new Date().toISOString();
      this.lastSyncTime.set(nowIso);
      this.syncStatus.set('synced');
      this.syncError.set(null);
      this.toast.success('Successfully overwritten Google Drive with local vault!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.syncError.set(msg);
      this.syncStatus.set('error');
      this.toast.error(`Overwrite failed: ${msg}`);
      throw err;
    } finally {
      this.isSyncing.set(false);
    }
  }

  /**
   * Orchestrates the zero-knowledge remote sync cycle with 3-way conflict resolution.
   */
  public async syncNow(): Promise<SyncSummary> {
    if (this.vaultService.isLocked()) {
      throw new Error('Vault is locked. Unlock vault before syncing.');
    }

    const token = this.googleDrive.getAccessToken();
    if (!token) {
      this.isConnected.set(false);
      throw new Error('Google Drive session expired or not connected. Please connect first.');
    }

    this.isSyncing.set(true);
    this.syncStatus.set('syncing');
    this.syncError.set(null);

    try {
      const localVault = this.vaultService.vault();
      if (!localVault) {
        throw new Error('No active local vault to sync.');
      }

      const localEnvelope = await this.storage.loadVaultEnvelope();
      if (!localEnvelope) {
        throw new Error('No local encrypted envelope found.');
      }

      // Step 1: Search for existing remote vault in appDataFolder
      const remoteFileInfo = await this.googleDrive.searchVaultFile(token);

      // Step 2: Handle initial push if remote file does not exist yet
      if (!remoteFileInfo) {
        const uploadRes = await this.googleDrive.uploadVaultFile(
          token,
          JSON.stringify(localEnvelope),
          localVault.revision
        );

        // Store base snapshot
        await this.storage.saveSyncBase(localEnvelope, localVault.revision);
        await this.storage.saveSyncMetadata({
          lastSyncedAt: new Date().toISOString(),
          remoteFileId: uploadRes.id,
          remoteRevision: localVault.revision
        });

        const nowIso = new Date().toISOString();
        this.lastSyncTime.set(nowIso);
        this.syncStatus.set('synced');
        this.toast.success('Initial vault envelope uploaded to Google Drive.');

        return {
          status: 'fast_forward_push',
          added: localVault.entries.length,
          updated: 0,
          deleted: 0,
          conflicts: 0,
          localRevision: localVault.revision,
          remoteRevision: localVault.revision
        };
      }

      // Step 3: Remote file exists -> Download and decrypt
      const remoteContent = await this.googleDrive.downloadVaultFile(token, remoteFileInfo.id);
      const remoteEnvelope = JSON.parse(remoteContent) as EncryptedVaultEnvelope;

      // Fast-path: if remote envelope ciphertext matches local envelope, short-circuit
      let remotePlaintext: string;
      if (localEnvelope.ciphertext === remoteEnvelope.ciphertext) {
        remotePlaintext = JSON.stringify(localVault);
      } else {
        remotePlaintext = await this.decryptEnvelopeForSync(remoteEnvelope);
      }
      const remoteVault = JSON.parse(remotePlaintext) as DecryptedVault;

      // Rollback protection check
      const metadata = await this.storage.getMetadata();
      if (remoteVault.revision < metadata.highestKnownRevision && remoteVault.entries.length < localVault.entries.length) {
        throw new Error(`Rollback detected: Remote revision (${remoteVault.revision}) is older than highest known (${metadata.highestKnownRevision}).`);
      }

      // Step 4: Load Base Snapshot (if any)
      const baseRecord = await this.storage.loadSyncBase();
      let baseVault: DecryptedVault | null = null;
      if (baseRecord) {
        try {
          const basePlaintext = await this.decryptEnvelopeForSync(baseRecord.envelope);
          baseVault = JSON.parse(basePlaintext) as DecryptedVault;
        } catch {
          baseVault = null;
        }
      }

      // Step 5: Perform 3-Way Merge
      const mergeResult = this.mergeThreeWay(baseVault, localVault, remoteVault);
      const mergedVault = mergeResult.vault;

      // Step 6: Determine mutations and persistence
      const localChanged = this.vaultHasChanges(localVault, mergedVault);
      const remoteChanged = this.vaultHasChanges(remoteVault, mergedVault);

      let finalEnvelope = localEnvelope;

      if (localChanged) {
        // Save merged vault locally
        await this.vaultService.updateVault(() => mergedVault);
        finalEnvelope = (await this.storage.loadVaultEnvelope())!;
      }

      if (remoteChanged || localChanged) {
        // Upload updated envelope to Google Drive
        await this.googleDrive.updateVaultFile(
          token,
          remoteFileInfo.id,
          JSON.stringify(finalEnvelope),
          mergedVault.revision
        );
      }

      // Update sync base snapshot to reflect the clean synchronized state
      await this.storage.saveSyncBase(finalEnvelope, mergedVault.revision);
      await this.storage.saveSyncMetadata({
        lastSyncedAt: new Date().toISOString(),
        remoteFileId: remoteFileInfo.id,
        remoteRevision: mergedVault.revision
      });

      const nowIso = new Date().toISOString();
      this.lastSyncTime.set(nowIso);
      this.syncStatus.set('synced');

      let statusType: SyncSummary['status'] = 'synced';
      if (localChanged && !remoteChanged) {
        statusType = 'fast_forward_pull';
      } else if (!localChanged && remoteChanged) {
        statusType = 'fast_forward_push';
      } else if (localChanged && remoteChanged) {
        statusType = 'merged';
      }

      const summary: SyncSummary = {
        status: statusType,
        added: mergeResult.added,
        updated: mergeResult.updated,
        deleted: mergeResult.deleted,
        conflicts: mergeResult.conflicts,
        localRevision: localVault.revision,
        remoteRevision: remoteVault.revision
      };

      if (mergeResult.conflicts > 0) {
        this.toast.warning(`Sync complete with ${mergeResult.conflicts} conflict resolution copies.`);
      } else if (localChanged || remoteChanged) {
        this.toast.success(`Vault synced (${mergeResult.added} added, ${mergeResult.updated} updated).`);
      } else {
        this.toast.info('Vault is already in sync with Google Drive.');
      }

      return summary;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.syncError.set(msg);
      this.syncStatus.set('error');
      this.toast.error(`Sync failed: ${msg}`);
      throw err;
    } finally {
      this.isSyncing.set(false);
    }
  }

  /**
   * Decrypts an envelope during sync using the active session key or current vault credentials.
   */
  private async decryptEnvelopeForSync(envelope: EncryptedVaultEnvelope): Promise<string> {
    const localEnvelope = await this.storage.loadVaultEnvelope();
    if (localEnvelope && localEnvelope.ciphertext === envelope.ciphertext) {
      const local = this.vaultService.vault();
      if (local) {
        return JSON.stringify(local);
      }
    }

    const sessionKey = this.vaultService.getSessionKey();
    if (sessionKey) {
      try {
        return await this.crypto.decryptVaultWithKey(envelope, sessionKey);
      } catch (err) {
        console.warn('Decryption with active session key failed:', err);
      }
    }

    throw new Error('Unable to decrypt remote envelope with active vault credentials.');
  }

  /**
   * Deterministic 3-Way Merge Algorithm.
   * Compares Base (B), Local (L), and Remote (R) to generate a lossless Merged (M) vault.
   */
  public mergeThreeWay(
    base: DecryptedVault | null,
    local: DecryptedVault,
    remote: DecryptedVault
  ): { vault: DecryptedVault; added: number; updated: number; deleted: number; conflicts: number } {
    const getSig = (e: { title: string; username?: string; category: string }) =>
      `${(e.title || '').trim().toLowerCase()}|${(e.username || '').trim().toLowerCase()}|${e.category}`;

    const hasChanged = (e1?: VaultEntry, e2?: VaultEntry): boolean => {
      if (!e1 || !e2) return true;
      return (
        e1.title !== e2.title ||
        e1.password !== e2.password ||
        e1.username !== e2.username ||
        e1.website !== e2.website ||
        e1.notes !== e2.notes ||
        e1.favorite !== e2.favorite ||
        e1.category !== e2.category
      );
    };

    const baseMap = new Map<string, VaultEntry>();
    if (base) {
      base.entries.forEach(e => {
        baseMap.set(e.id, e);
        baseMap.set(getSig(e), e);
      });
    }

    const localMap = new Map<string, VaultEntry>();
    local.entries.forEach(e => {
      localMap.set(e.id, e);
      localMap.set(getSig(e), e);
    });

    const remoteMap = new Map<string, VaultEntry>();
    remote.entries.forEach(e => {
      remoteMap.set(e.id, e);
      remoteMap.set(getSig(e), e);
    });

    // Gather all unique entry keys
    const allKeys = new Set<string>();
    local.entries.forEach(e => allKeys.add(e.id));
    remote.entries.forEach(e => allKeys.add(e.id));
    if (base) {
      base.entries.forEach(e => allKeys.add(e.id));
    }

    const mergedEntries: VaultEntry[] = [];
    const addedIds = new Set<string>();

    let added = 0;
    let updated = 0;
    let deleted = 0;
    let conflicts = 0;

    for (const key of allKeys) {
      const b = baseMap.get(key);
      const l = localMap.get(key);
      const r = remoteMap.get(key);

      if (b) {
        // Entry existed in Base
        if (!l && !r) {
          // Deleted in both local and remote
          deleted++;
          continue;
        }

        if (!l && r) {
          // Deleted locally
          if (!hasChanged(b, r)) {
            // Remote did not modify it -> deletion confirmed
            deleted++;
            continue;
          } else {
            // Remote modified it concurrently -> keep remote update to prevent lost updates
            mergedEntries.push({ ...r });
            addedIds.add(r.id);
            updated++;
            continue;
          }
        }

        if (l && !r) {
          // Deleted remotely
          if (!hasChanged(b, l)) {
            // Local did not modify it -> deletion confirmed
            deleted++;
            continue;
          } else {
            // Local modified it concurrently -> keep local update
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
            updated++;
            continue;
          }
        }

        if (l && r) {
          // Present in both local and remote
          const localModified = hasChanged(b, l);
          const remoteModified = hasChanged(b, r);

          if (!localModified && !remoteModified) {
            // Neither modified -> keep local
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
          } else if (localModified && !remoteModified) {
            // Only local modified
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
            updated++;
          } else if (!localModified && remoteModified) {
            // Only remote modified
            mergedEntries.push({ ...r });
            addedIds.add(r.id);
            updated++;
          } else {
            // Concurrently modified in BOTH local and remote!
            const tL = new Date(l.updatedAt || 0).getTime();
            const tR = new Date(r.updatedAt || 0).getTime();

            if (tL > tR) {
              mergedEntries.push({ ...l });
              addedIds.add(l.id);
              updated++;
            } else if (tR > tL) {
              mergedEntries.push({ ...r });
              addedIds.add(r.id);
              updated++;
            } else {
              // Exact timestamp collision: check content equality
              if (!hasChanged(l, r)) {
                mergedEntries.push({ ...l });
                addedIds.add(l.id);
              } else {
                // Ambiguous collision: preserve local, add conflict copy of remote
                mergedEntries.push({ ...l });
                addedIds.add(l.id);

                const conflictCopy: VaultEntry = {
                  ...r,
                  id: 'conflict-' + Math.random().toString(36).substring(2, 10),
                  title: `${r.title} (Sync Conflict)`,
                  notes: `${r.notes ? r.notes + '\n\n' : ''}[Sync Conflict: Concurrently modified on remote device]`
                };
                mergedEntries.push(conflictCopy);
                addedIds.add(conflictCopy.id);
                conflicts++;
              }
            }
          }
        }
      } else {
        // Entry did NOT exist in Base
        if (l && !r) {
          // Added locally
          if (!addedIds.has(l.id)) {
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
            added++;
          }
        } else if (!l && r) {
          // Added remotely
          if (!addedIds.has(r.id)) {
            mergedEntries.push({ ...r });
            addedIds.add(r.id);
            added++;
          }
        } else if (l && r) {
          // Added independently on both devices
          if (l.id === r.id || getSig(l) === getSig(r)) {
            const tL = new Date(l.updatedAt || 0).getTime();
            const tR = new Date(r.updatedAt || 0).getTime();
            if (tL >= tR) {
              mergedEntries.push({ ...l });
              addedIds.add(l.id);
            } else {
              mergedEntries.push({ ...r });
              addedIds.add(r.id);
            }
            added++;
          } else {
            // Two distinct entries
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
            mergedEntries.push({ ...r });
            addedIds.add(r.id);
            added += 2;
          }
        }
      }
    }

    const newRevision = Math.max(local.revision, remote.revision) + 1;
    const mergedVault: DecryptedVault = {
      ...local,
      revision: newRevision,
      updatedAt: new Date().toISOString(),
      entries: mergedEntries
    };

    return {
      vault: mergedVault,
      added,
      updated,
      deleted,
      conflicts
    };
  }

  private vaultHasChanges(v1: DecryptedVault, v2: DecryptedVault): boolean {
    if (v1.entries.length !== v2.entries.length) return true;
    if (v1.revision !== v2.revision) return true;

    const map = new Map<string, VaultEntry>();
    v1.entries.forEach(e => map.set(e.id, e));

    for (const e2 of v2.entries) {
      const e1 = map.get(e2.id);
      if (!e1) return true;
      if (
        e1.title !== e2.title ||
        e1.password !== e2.password ||
        e1.username !== e2.username ||
        e1.notes !== e2.notes ||
        e1.favorite !== e2.favorite
      ) {
        return true;
      }
    }

    return false;
  }
}
