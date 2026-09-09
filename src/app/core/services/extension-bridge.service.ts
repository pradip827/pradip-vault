import { Injectable, inject } from '@angular/core';
import { VaultService } from './vault.service';

/**
 * Normalizes an arbitrary URL to its strict origin (protocol + hostname + effective port).
 * Returns empty string if invalid or non-http/https.
 */
export function normalizeOrigin(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  // Strictly require explicit absolute http:// or https:// schemes (no silent scheme inference)
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return '';
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return '';
    }
    if (!u.hostname || u.hostname.startsWith('.') || u.hostname.endsWith('.') || (!u.hostname.includes('.') && u.hostname !== 'localhost')) {
      return '';
    }
    return u.origin.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Validates whether credentialUrl and targetUrl belong to the exact same normalized origin.
 * Default credential authorization rule: credential.origin === currentTab.origin
 * Disallows subdomains, cousin domains, and protocol downgrades.
 */
export function isOriginMatch(credentialUrl: string, targetUrl: string): boolean {
  if (!credentialUrl || !targetUrl) return false;
  const credOrigin = normalizeOrigin(credentialUrl);
  const targetOrigin = normalizeOrigin(targetUrl);
  if (!credOrigin || !targetOrigin) return false;
  return credOrigin === targetOrigin;
}

export interface ExtensionAuthSession {
  token: string;
  createdAt: number;
  expiresAt: number;
}

export interface OriginCredentialMetadata {
  id: string;
  title: string;
  username: string;
  website: string;
}

declare const chrome: any;

@Injectable({
  providedIn: 'root'
})
export class ExtensionBridgeService {
  private readonly vaultService = inject(VaultService);

  private activeSession: ExtensionAuthSession | null = null;
  private extensionId: string | null = null;
  private port: any = null;
  private isFramed = false;

  constructor() {
    this.vaultService.onUnlock(() => this.establishSession());
    this.vaultService.onLock(() => this.revokeSession());

    if (typeof window !== 'undefined') {
      // Hostile iframe defense: if framed by any other page, disable extension bridge completely
      this.isFramed = window !== window.top;
      if (this.isFramed) {
        console.warn('[ZeroVault Security] Running in an iframe. Extension bridge is disabled.');
      } else {
        this.initExtensionDiscovery();
      }
    }
  }

  /**
   * Discovers the extension ID securely from the dedicated bridge content script
   * or pre-configured deterministic extension ID.
   */
  public initExtensionDiscovery(): void {
    if (typeof document === 'undefined' || this.isFramed) return;

    // Check data attribute injected by vault-bridge.js
    const detectedId = document.documentElement.dataset['zerovaultExtensionId'];
    if (detectedId) {
      this.extensionId = detectedId;
    }

    // Listen for extension ready event
    window.addEventListener('zerovault-extension-ready', (event: any) => {
      if (event.detail?.extensionId) {
        this.extensionId = event.detail.extensionId;
        // Re-establish session if vault is already unlocked
        if (!this.vaultService.isLocked() && !this.activeSession) {
          this.establishSession();
        }
      }
    });
  }

  public setExtensionId(id: string): void {
    this.extensionId = id;
  }

  public getExtensionId(): string | null {
    return this.extensionId;
  }

  public getActiveSession(): ExtensionAuthSession | null {
    return this.activeSession;
  }

  /**
   * Generates a cryptographically secure 256-bit session token.
   */
  private generateSecureToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Establishes an authenticated session when the Web Vault is unlocked.
   */
  public establishSession(): ExtensionAuthSession | null {
    if (this.isFramed || this.vaultService.isLocked()) {
      return null;
    }

    const token = this.generateSecureToken();
    const now = Date.now();
    this.activeSession = {
      token,
      createdAt: now,
      expiresAt: now + 2 * 60 * 60 * 1000 // 2 hours
    };

    this.connectPortAndRegisterSession();
    return this.activeSession;
  }

  /**
   * Revokes the active session when the vault locks or logs out.
   */
  public revokeSession(): void {
    if (this.port) {
      try {
        this.port.postMessage({
          type: 'REVOKE_AUTH_SESSION',
          sessionToken: this.activeSession?.token
        });
        this.port.disconnect();
      } catch {
        // Port may already be closed
      }
      this.port = null;
    }
    this.activeSession = null;
  }

  /**
   * Establishes a native Chrome IPC Port to the extension service worker.
   */
  private connectPortAndRegisterSession(): void {
    if (!this.extensionId || typeof chrome === 'undefined' || !chrome.runtime?.connect) {
      return;
    }

    try {
      this.port = chrome.runtime.connect(this.extensionId, { name: 'zerovault-authenticated-bridge' });

      this.port.onMessage.addListener((msg: any) => {
        this.handlePortMessage(msg);
      });

      this.port.onDisconnect.addListener(() => {
        this.port = null;
      });

      // Register session with extension service worker
      this.port.postMessage({
        type: 'ESTABLISH_AUTH_SESSION',
        sessionToken: this.activeSession?.token,
        expiresAt: this.activeSession?.expiresAt,
        vaultName: this.vaultService.vaultName()
      });
    } catch (e) {
      console.warn('[ZeroVault Security] Could not connect to extension port:', e);
      this.port = null;
    }
  }

  /**
   * Validates the session token from an incoming request.
   */
  public validateSessionToken(token: string | undefined): boolean {
    if (!token || !this.activeSession) return false;
    if (this.vaultService.isLocked()) return false;
    if (Date.now() > this.activeSession.expiresAt) return false;
    return this.activeSession.token === token;
  }

  /**
   * Handles least-privilege requests from the Extension Service Worker via Port.
   */
  public handlePortMessage(msg: any): void {
    if (!msg || typeof msg !== 'object' || typeof msg.requestId !== 'string' || !msg.requestId || typeof msg.type !== 'string') {
      if (this.port && msg && typeof msg === 'object' && msg.requestId) {
        this.port.postMessage({
          requestId: msg.requestId,
          success: false,
          error: 'Malformed message schema'
        });
      }
      return;
    }

    // Enforce valid session on every incoming request
    if (!this.validateSessionToken(msg.sessionToken)) {
      if (this.port && msg.requestId) {
        this.port.postMessage({
          requestId: msg.requestId,
          success: false,
          error: 'Unauthorized or expired session'
        });
      }
      return;
    }

    switch (msg.type) {
      case 'QUERY_ORIGIN_METADATA': {
        if (typeof msg.origin !== 'string') {
          this.port?.postMessage({
            requestId: msg.requestId,
            success: false,
            error: 'Invalid origin parameter'
          });
          break;
        }
        const matches = this.queryOriginMetadata(msg.origin);
        this.port?.postMessage({
          requestId: msg.requestId,
          success: true,
          matches
        });
        break;
      }

      case 'RETRIEVE_CREDENTIAL_FOR_FILL': {
        if (typeof msg.credentialId !== 'string' || typeof msg.tabOrigin !== 'string') {
          this.port?.postMessage({
            requestId: msg.requestId,
            success: false,
            error: 'Invalid credentialId or tabOrigin parameter'
          });
          break;
        }
        const result = this.retrieveCredentialForFill(msg.credentialId, msg.tabOrigin);
        this.port?.postMessage({
          requestId: msg.requestId,
          ...result
        });
        break;
      }

      case 'SAVE_CREDENTIAL_FROM_EXTENSION': {
        if (!msg.credential || typeof msg.credential !== 'object' || typeof msg.tabOrigin !== 'string') {
          this.port?.postMessage({
            requestId: msg.requestId,
            success: false,
            error: 'Invalid credential or tabOrigin parameter'
          });
          break;
        }
        this.saveCredentialFromExtension(msg.credential, msg.tabOrigin).then((res) => {
          this.port?.postMessage({
            requestId: msg.requestId,
            ...res
          });
        });
        break;
      }

      default:
        this.port?.postMessage({
          requestId: msg.requestId,
          success: false,
          error: 'Unknown request type'
        });
    }
  }

  /**
   * Returns ONLY metadata (NO PASSWORDS) for entries matching the given origin.
   */
  public queryOriginMetadata(targetOrigin: string): OriginCredentialMetadata[] {
    if (this.vaultService.isLocked() || !targetOrigin) {
      return [];
    }

    const entries = this.vaultService.entries();
    const matches = entries.filter((e) => isOriginMatch(e.website, targetOrigin));

    // Least Privilege: Strip passwords completely
    return matches.map((m) => ({
      id: m.id,
      title: m.title || '',
      username: m.username || '',
      website: m.website || ''
    }));
  }

  /**
   * Retrieves ONE credential after verifying the requesting tab's origin matches the credential.
   */
  public retrieveCredentialForFill(
    credentialId: string,
    tabOrigin: string
  ): { success: boolean; credential?: { username: string; password: string }; error?: string } {
    if (this.vaultService.isLocked()) {
      return { success: false, error: 'Vault is locked' };
    }
    if (!credentialId || !tabOrigin) {
      return { success: false, error: 'Missing credentialId or tabOrigin' };
    }

    const entries = this.vaultService.entries();
    const entry = entries.find((e) => e.id === credentialId);
    if (!entry) {
      return { success: false, error: 'Credential not found' };
    }

    // Strict origin verification: ensure tab is actually on the credential's origin
    if (!isOriginMatch(entry.website, tabOrigin)) {
      return {
        success: false,
        error: `Security violation: tab origin "${tabOrigin}" does not match credential website "${entry.website}"`
      };
    }

    // Return ONLY this single credential for autofill
    return {
      success: true,
      credential: {
        username: entry.username || '',
        password: entry.password || ''
      }
    };
  }

  /**
   * Saves or updates a credential received from the extension upon explicit user confirmation.
   */
  public async saveCredentialFromExtension(
    credential: { username: string; password?: string; website: string; title?: string },
    tabOrigin: string
  ): Promise<{ success: boolean; isNew?: boolean; error?: string }> {
    if (this.vaultService.isLocked()) {
      return { success: false, error: 'Vault is locked' };
    }
    if (!credential || !credential.website) {
      return { success: false, error: 'Invalid credential payload' };
    }
    if (!isOriginMatch(credential.website, tabOrigin)) {
      return { success: false, error: 'Origin mismatch on save request' };
    }

    try {
      let isNew = true;
      await this.vaultService.updateVault((vault) => {
        const existingIdx = vault.entries.findIndex(
          (e) => isOriginMatch(e.website, credential.website) &&
                 (e.username || '').toLowerCase() === (credential.username || '').toLowerCase()
        );

        const now = new Date().toISOString();
        if (existingIdx !== -1) {
          isNew = false;
          if (credential.password) {
            vault.entries[existingIdx].password = credential.password;
          }
          vault.entries[existingIdx].updatedAt = now;
        } else {
          vault.entries.push({
            id: crypto.randomUUID(),
            category: 'login',
            title: credential.title || normalizeOrigin(credential.website) || 'Saved Account',
            website: credential.website,
            username: credential.username || '',
            password: credential.password || '',
            notes: 'Saved via ZeroVault Extension',
            favorite: false,
            createdAt: now,
            updatedAt: now
          });
        }
        return vault;
      });

      return { success: true, isNew };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to save credential' };
    }
  }
}
