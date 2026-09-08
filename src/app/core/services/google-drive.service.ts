import { Injectable, signal } from '@angular/core';

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const VAULT_SYNC_FILENAME = 'vault.zerovault';

export interface DriveVaultFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  revision?: number;
}

declare const google: any;

@Injectable({
  providedIn: 'root'
})
export class GoogleDriveService {
  private activeAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  public readonly isTokenValid = signal<boolean>(false);

  /**
   * Returns current access token if valid and unexpired.
   */
  public getAccessToken(): string | null {
    if (this.activeAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.activeAccessToken;
    }
    return null;
  }

  /**
   * Explicitly sets access token (e.g. from tests, OAuth redirect, or mock).
   */
  public setAccessToken(token: string, expiresInSeconds: number = 3600): void {
    this.activeAccessToken = token;
    this.tokenExpiresAt = Date.now() + (expiresInSeconds * 1000) - 60000; // 1m buffer
    this.isTokenValid.set(true);
  }

  /**
   * Clears in-memory OAuth tokens.
   */
  public clearTokens(): void {
    this.activeAccessToken = null;
    this.tokenExpiresAt = 0;
    this.isTokenValid.set(false);
  }

  /**
   * Requests an OAuth 2.0 access token using Google Identity Services (GIS).
   */
  public async requestOAuthToken(clientId: string): Promise<string> {
    if (!clientId || !clientId.trim()) {
      throw new Error('Google OAuth Client ID is required to connect.');
    }

    // Load GIS script if needed
    await this.ensureGisScriptLoaded();

    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      throw new Error('Google Identity Services SDK is not available.');
    }

    return new Promise<string>((resolve, reject) => {
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId.trim(),
          scope: DRIVE_SCOPE,
          callback: (response: any) => {
            if (response.error) {
              reject(new Error(`Google OAuth error: ${response.error_description || response.error}`));
              return;
            }

            if (response.access_token) {
              const expiresIn = response.expires_in ? parseInt(response.expires_in, 10) : 3600;
              this.setAccessToken(response.access_token, expiresIn);
              resolve(response.access_token);
            } else {
              reject(new Error('No access token returned by Google OAuth.'));
            }
          }
        });

        client.requestAccessToken();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to initialize Google OAuth: ${msg}`));
      }
    });
  }

  /**
   * Ensures the Google Identity Services client script is loaded in the DOM.
   */
  private async ensureGisScriptLoaded(): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (typeof google !== 'undefined' && google.accounts?.oauth2) return;

    const existing = document.getElementById('google-gis-script');
    if (existing) {
      return new Promise<void>((resolve) => {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => resolve());
      });
    }

    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.id = 'google-gis-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services library.'));
      document.head.appendChild(script);
    });
  }

  /**
   * Searches for the encrypted vault file in Google Drive's appDataFolder.
   */
  public async searchVaultFile(accessToken: string): Promise<DriveVaultFileInfo | null> {
    const url = `${DRIVE_API_BASE}/files?spaces=appDataFolder&q=(name='${VAULT_SYNC_FILENAME}' or name='vault.pradipvault') and trashed=false&fields=files(id,name,modifiedTime,properties)`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    if (!data.files || data.files.length === 0) {
      return null;
    }

    const file = data.files[0];
    const revision = file.properties?.revision ? parseInt(file.properties.revision, 10) : undefined;

    return {
      id: file.id,
      name: file.name,
      modifiedTime: file.modifiedTime,
      revision
    };
  }

  /**
   * Downloads the raw encrypted envelope string from Google Drive.
   */
  public async downloadVaultFile(accessToken: string, fileId: string): Promise<string> {
    const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to download remote vault (${res.status}): ${errText}`);
    }

    return await res.text();
  }

  /**
   * Uploads a new encrypted envelope file to appDataFolder via multipart POST.
   */
  public async uploadVaultFile(accessToken: string, envelopeJson: string, revision: number): Promise<{ id: string }> {
    const boundary = '-------ZeroVaultMultipartBoundary' + Math.random().toString(36).substring(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: VAULT_SYNC_FILENAME,
      parents: ['appDataFolder'],
      properties: {
        revision: revision.toString(),
        app: 'ZeroVault'
      }
    };

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      envelopeJson +
      closeDelimiter;

    const url = `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to upload vault to Google Drive (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return { id: data.id };
  }

  /**
   * Updates an existing remote encrypted envelope file in appDataFolder.
   */
  public async updateVaultFile(accessToken: string, fileId: string, envelopeJson: string, revision: number): Promise<void> {
    const boundary = '-------ZeroVaultMultipartBoundary' + Math.random().toString(36).substring(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      properties: {
        revision: revision.toString(),
        app: 'ZeroVault'
      }
    };

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      envelopeJson +
      closeDelimiter;

    const url = `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=multipart`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to update vault in Google Drive (${res.status}): ${errText}`);
    }
  }
}
