import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { VaultService } from './vault.service';
import { StorageService } from './storage.service';
import { CryptoService } from './crypto.service';
import { GoogleDriveService } from './google-drive.service';
import { ToastService } from './toast.service';
import { DecryptedVault, VaultEntry, CustomField } from '../models/vault.model';
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

    // Restore connection state if session token is still valid
    if (this.googleDrive.getAccessToken()) {
      this.isConnected.set(true);
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

      const remoteRevision = remoteFileInfo.revision ?? 1;

      // Rollback protection: prevent replacing existing local vault with an older revision
      const metadata = await this.storage.getMetadata();
      if (metadata.highestKnownRevision > 0 && remoteRevision < metadata.highestKnownRevision) {
        throw new Error(
          `Rollback detected: Remote revision (${remoteRevision}) is older than ` +
          `highest known revision (${metadata.highestKnownRevision}). ` +
          `Refusing to download older vault from Google Drive.`
        );
      }

      const remoteContent = await this.googleDrive.downloadVaultFile(token, remoteFileInfo.id);
      const remoteEnvelope = JSON.parse(remoteContent) as EncryptedVaultEnvelope;

      // Save encrypted envelope to local IndexedDB
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
   * Downloads the remote vault envelope from Google Drive with rollback protection.
   * Alias for pullVaultFromDrive().
   */
  public async downloadFromDrive(): Promise<boolean> {
    return this.pullVaultFromDrive();
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

      // ---- Rollback protection: revision-only check ----
      // highestKnownRevision is the monotonically increasing watermark stored in IndexedDB.
      // It MUST NOT move backwards regardless of remote revision or entry count.
      // Entry count MUST NOT participate in rollback detection — an attacker can trivially
      // forge an envelope with any entry count at a lower revision.
      const metadata = await this.storage.getMetadata();
      if (remoteVault.revision < metadata.highestKnownRevision) {
        throw new Error(
          `Rollback detected: Remote revision (${remoteVault.revision}) is older than ` +
          `highest known revision (${metadata.highestKnownRevision}). ` +
          `Refusing to process. If this is a legitimate restore, use "Overwrite Remote" from the primary device.`
        );
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

  // ---------------------------------------------------------------------------
  // Canonical helpers
  // ---------------------------------------------------------------------------

  /**
   * Extracts a stable credential origin from a website URL.
   * Returns scheme://host:port (normalized, lowercased), omitting path/query/fragment.
   * Returns null if the URL is empty or cannot be parsed to a valid origin.
   */
  private normalizeOrigin(url: string): string | null {
    if (!url?.trim()) return null;
    try {
      const parsed = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
      // parsed.origin gives "scheme://host" or "scheme://host:port"
      const origin = parsed.origin.toLowerCase();
      // Reject opaque origins (e.g. "null" for file:// or data: URLs)
      return origin === 'null' ? null : origin;
    } catch {
      return null;
    }
  }

  /**
   * Produces a canonical duplicate-detection signature for a VaultEntry.
   *
   * Identity is defined as: normalizeOrigin(website) + '|' + username.trim().toLowerCase()
   *
   * Rules:
   * - Returns null if the entry has no valid parseable website origin.
   *   Entries without a reliable origin (secure notes, identity cards, etc.) are NEVER
   *   collapsed by signature — they are always preserved independently.
   * - Password, title, category, and notes are NOT part of the identity.
   * - This means: same website + same username = same logical credential (high confidence).
   *   Different website OR different username = distinct credential.
   */
  private getEntrySig(e: VaultEntry): string | null {
    const origin = this.normalizeOrigin(e.website);
    if (!origin) return null; // no reliable identity → preserve both
    return `${origin}|${(e.username || '').trim().toLowerCase()}`;
  }

  /**
   * Produces a deterministic canonical representation of a CustomField array.
   *
   * Custom field ordering is NOT semantically meaningful — users may reorder fields
   * without changing the logical credential. Fields are sorted by their stable `id`
   * before serialization to ensure:
   *   - Semantically equivalent fields in any order → same canonical string → no spurious conflict.
   *   - Different field content → different canonical string → conflict correctly detected.
   */
  private canonicalCustomFields(fields?: CustomField[]): string {
    return JSON.stringify(
      (fields ?? []).slice().sort((a, b) => a.id.localeCompare(b.id))
    );
  }

  /**
   * Returns true if any semantically relevant field of two VaultEntry records differs.
   * Compares substantive user-editable credential fields:
   *   - title, username, password, website, notes, favorite, category
   *   - totpSecret (optional), createdAt
   *   - customFields: compared canonically (sorted by id, order-insensitive)
   *
   * INTENTIONAL EXCLUSION OF `updatedAt`:
   *   `updatedAt` is intentionally excluded from content equality comparison.
   *   Rationale:
   *   1. Content vs. Metadata: `hasChanged()` detects whether actual credential data was modified
   *      relative to a common base. Touching or re-encrypting an entry updates its timestamp but
   *      must not trigger false positive credential modifications or resurrect deleted entries.
   *   2. Conflict Resolution Tiebreaker: When concurrent modifications occur, `updatedAt` serves as
   *      the deterministic timestamp tiebreaker (tL vs tR). If `updatedAt` were treated as content,
   *      identical content saved with different timestamps would trigger duplicate conflict copies.
   *   3. Idempotent Merging: When local and remote have identical credential content,
   *      `!this.hasChanged(l, r)` identifies them as equivalent and collapses them cleanly,
   *      regardless of any timestamp skew.
   */
  private hasChanged(e1?: VaultEntry, e2?: VaultEntry): boolean {
    if (!e1 || !e2) return true;
    return (
      e1.title !== e2.title ||
      e1.password !== e2.password ||
      e1.username !== e2.username ||
      e1.website !== e2.website ||
      e1.notes !== e2.notes ||
      e1.favorite !== e2.favorite ||
      e1.category !== e2.category ||
      e1.totpSecret !== e2.totpSecret ||
      e1.createdAt !== e2.createdAt ||
      this.canonicalCustomFields(e1.customFields) !== this.canonicalCustomFields(e2.customFields)
    );
  }

  // ---------------------------------------------------------------------------
  // 3-Way Merge Engine
  // ---------------------------------------------------------------------------

  /**
   * Deterministic 3-Way Merge Algorithm.
   * Compares Base (B), Local (L), and Remote (R) to generate a lossless Merged (M) vault.
   *
   * DATA PRESERVATION INVARIANT:
   *   No legitimate concurrent credential change may silently disappear.
   *   If identity cannot be established with high confidence, BOTH entries are preserved.
   *
   * Merge semantics per entry:
   *   L == B  → accept R (remote changed)
   *   R == B  → accept L (local changed)
   *   L == R  → accept either (both identical)
   *   L != B && R != B && L != R  → conflict: preserve local, add conflict copy of remote
   *
   * Duplicate identity for cross-device new entries:
   *   Identity = normalizeOrigin(website) + '|' + username.trim().lower()
   *   Entries without a valid website origin are NEVER merged by identity.
   *   Password, title, category, notes are NOT part of identity.
   *
   * Iteration order guarantee:
   *   allIds is populated local-first, so local entries are always processed before
   *   remote entries of the same ID. This makes sig-based cross-ID detection deterministic
   *   without requiring a second pass: when a local-only new entry matches a remote sig,
   *   it marks the remote entry's ID as consumed; when the remote ID is later visited,
   *   the addedIds guard skips it cleanly.
   */
  public mergeThreeWay(
    base: DecryptedVault | null,
    local: DecryptedVault,
    remote: DecryptedVault
  ): { vault: DecryptedVault; added: number; updated: number; deleted: number; conflicts: number } {

    // ---- Build separate ID maps and sig maps ----
    // ID maps: primary lookup for known entries
    // Sig maps: secondary lookup for cross-device duplicate detection (new entries only)
    const baseIdMap = new Map<string, VaultEntry>();
    const baseSigMap = new Map<string, VaultEntry>();
    if (base) {
      base.entries.forEach(e => {
        baseIdMap.set(e.id, e);
        const sig = this.getEntrySig(e);
        if (sig) baseSigMap.set(sig, e);
      });
    }

    const localIdMap = new Map<string, VaultEntry>();
    const localSigMap = new Map<string, VaultEntry>();
    local.entries.forEach(e => {
      localIdMap.set(e.id, e);
      const sig = this.getEntrySig(e);
      if (sig) localSigMap.set(sig, e);
    });

    const remoteIdMap = new Map<string, VaultEntry>();
    const remoteSigMap = new Map<string, VaultEntry>();
    remote.entries.forEach(e => {
      remoteIdMap.set(e.id, e);
      const sig = this.getEntrySig(e);
      if (sig) remoteSigMap.set(sig, e);
    });

    // ---- Gather all unique entry IDs ----
    // Local IDs are inserted first — this guarantees that when we process a local-only
    // new entry and find a remote sig match, the remote ID has not yet been visited.
    const allIds = new Set<string>();
    local.entries.forEach(e => allIds.add(e.id));
    remote.entries.forEach(e => allIds.add(e.id));
    if (base) {
      base.entries.forEach(e => allIds.add(e.id));
    }

    const mergedEntries: VaultEntry[] = [];
    // addedIds tracks ALL IDs (original and generated) that have been committed to
    // mergedEntries, preventing double-adds and enabling sig-match consumption.
    const addedIds = new Set<string>();

    let added = 0;
    let updated = 0;
    let deleted = 0;
    let conflicts = 0;

    for (const id of allIds) {
      // Guard: skip entries already committed via sig-match from a prior iteration
      if (addedIds.has(id)) continue;

      const b = baseIdMap.get(id);
      const l = localIdMap.get(id);
      const r = remoteIdMap.get(id);

      if (b) {
        // ---- Entry existed in Base: standard three-way merge by ID ----
        if (!l && !r) {
          // Deleted in both local and remote
          deleted++;
          continue;
        }

        if (!l && r) {
          // Deleted locally
          if (!this.hasChanged(b, r)) {
            // Remote did not modify it → deletion confirmed
            deleted++;
          } else {
            // Remote modified it concurrently → keep remote update to prevent lost update
            mergedEntries.push({ ...r });
            addedIds.add(r.id);
            updated++;
          }
          continue;
        }

        if (l && !r) {
          // Deleted remotely
          if (!this.hasChanged(b, l)) {
            // Local did not modify it → deletion confirmed
            deleted++;
          } else {
            // Local modified it concurrently → keep local update
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
            updated++;
          }
          continue;
        }

        if (l && r) {
          // Present in both local and remote
          const localModified = this.hasChanged(b, l);
          const remoteModified = this.hasChanged(b, r);

          if (!localModified && !remoteModified) {
            // Neither modified → keep local (canonical)
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
          } else if (localModified && !remoteModified) {
            // Only local modified → accept local
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
            updated++;
          } else if (!localModified && remoteModified) {
            // Only remote modified → accept remote
            mergedEntries.push({ ...r });
            addedIds.add(r.id);
            updated++;
          } else {
            // Both modified concurrently → tiebreak by updatedAt timestamp
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
              if (!this.hasChanged(l, r)) {
                mergedEntries.push({ ...l });
                addedIds.add(l.id);
              } else {
                // Ambiguous collision: DATA PRESERVATION INVARIANT — preserve local,
                // add conflict copy of remote. No credential data is silently discarded.
                mergedEntries.push({ ...l });
                addedIds.add(l.id);

                const conflictId = crypto.randomUUID();
                const conflictCopy: VaultEntry = {
                  ...r,
                  id: conflictId,
                  title: `${r.title} (Sync Conflict)`,
                  notes: `${r.notes ? r.notes + '\n\n' : ''}[Sync Conflict: Concurrently modified on remote device]`
                };
                mergedEntries.push(conflictCopy);
                addedIds.add(conflictId);
                conflicts++;
              }
            }
          }
        }
      } else {
        // ---- Entry NOT in Base: newly created on one or both sides ----
        if (l && !r) {
          // Only in local — check if remote independently created same logical credential
          const sig = this.getEntrySig(l);
          const remoteSigMatch = sig ? remoteSigMap.get(sig) : undefined;

          if (remoteSigMatch && !addedIds.has(remoteSigMatch.id)) {
            // High-confidence same credential created independently on both sides:
            // same website origin + same username.
            // Tiebreak by updatedAt; winner represents the merged credential.
            // The loser's ID is consumed (marked in addedIds) to prevent double-add
            // when the remote's ID is later visited in the allIds iteration.
            const tL = new Date(l.updatedAt || 0).getTime();
            const tR = new Date(remoteSigMatch.updatedAt || 0).getTime();
            if (tL >= tR) {
              mergedEntries.push({ ...l });
              addedIds.add(l.id);
            } else {
              mergedEntries.push({ ...remoteSigMatch });
              addedIds.add(remoteSigMatch.id);
            }
            // Consume both IDs regardless of which won
            addedIds.add(l.id);
            addedIds.add(remoteSigMatch.id);
            added++;
          } else {
            // Pure local addition — no reliable remote match
            mergedEntries.push({ ...l });
            addedIds.add(l.id);
            added++;
          }
        } else if (!l && r) {
          // Only in remote — check if local independently created same logical credential.
          // Because local IDs are inserted into allIds first, if there was a local sig
          // match, it would already have been processed in the l&&!r branch above,
          // consuming this remote ID via addedIds. Reaching here means either:
          //   (a) no local sig match exists, or
          //   (b) the local sig match was processed first and already set addedIds.has(r.id).
          // Case (b) is already handled by the guard at the top of the loop.
          // Therefore: reaching here always means pure remote addition.
          mergedEntries.push({ ...r });
          addedIds.add(r.id);
          added++;
        } else if (l && r) {
          // Same ID, present on both sides, not in base.
          // Concurrent creation with identical UUID (same-device, UUID collision, or
          // independent creation that happened to generate the same ID).
          // Tiebreak by updatedAt; if identical content, accept either.
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

  /**
   * Returns true if vault v2 differs from vault v1 in any way that requires re-encryption.
   * Compares all fields of every VaultEntry including totpSecret, customFields, and createdAt.
   */
  private vaultHasChanges(v1: DecryptedVault, v2: DecryptedVault): boolean {
    if (v1.entries.length !== v2.entries.length) return true;
    if (v1.revision !== v2.revision) return true;

    const map = new Map<string, VaultEntry>();
    v1.entries.forEach(e => map.set(e.id, e));

    for (const e2 of v2.entries) {
      const e1 = map.get(e2.id);
      if (!e1) return true;
      if (this.hasChanged(e1, e2)) return true;
    }

    return false;
  }
}
