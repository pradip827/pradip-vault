import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../components/common/button/button.component';
import { InputComponent } from '../../components/common/input/input.component';
import { BadgeComponent } from '../../components/common/badge/badge.component';
import { ModalComponent } from '../../components/common/modal/modal.component';
import { IconComponent } from '../../components/common/icon/icon.component';
import { ThemeService } from '../../core/services/theme.service';
import { AutoLockService } from '../../core/services/autolock.service';
import { VaultService } from '../../core/services/vault.service';
import { BackupService } from '../../core/services/backup.service';
import { SyncService } from '../../core/services/sync.service';
import { PwaService } from '../../core/services/pwa.service';
import { ToastService } from '../../core/services/toast.service';
import { VaultBackupFile } from '../../core/crypto/crypto.types';
import { DecryptedVault } from '../../core/models/vault.model';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, InputComponent, BadgeComponent, ModalComponent, IconComponent],
  template: `
    <div class="settings-wrap">
      <div class="settings-header">
        <h2 class="settings-title">Vault Settings</h2>
        <p class="settings-subtitle">Manage security preferences, auto-lock, themes, and encrypted backups.</p>
      </div>

      <div class="settings-grid">
        <!-- Appearance Card -->
        <div class="setting-card">
          <div class="card-icon-title">
            <div class="setting-icon">
              <app-icon [name]="themeService.currentTheme() === 'dark' ? 'moon' : 'sun'" [size]="20" />
            </div>
            <div>
              <h3 class="card-heading">Appearance & Theme</h3>
              <p class="card-desc">Choose between dark mode (default) and light mode.</p>
            </div>
          </div>

          <div class="setting-action-row">
            <span class="action-label">Current Theme: <strong>{{ themeService.currentTheme() | uppercase }}</strong></span>
            <app-button variant="secondary" size="sm" (clicked)="themeService.toggleTheme()">
              <app-icon [name]="themeService.currentTheme() === 'dark' ? 'sun' : 'moon'" [size]="14" />
              Switch to {{ themeService.currentTheme() === 'dark' ? 'Light' : 'Dark' }}
            </app-button>
          </div>
        </div>

        <!-- Auto-Lock Security Card -->
        <div class="setting-card">
          <div class="card-icon-title">
            <div class="setting-icon">
              <app-icon name="lock" [size]="20" />
            </div>
            <div>
              <h3 class="card-heading">Auto-Lock Inactivity Timeout</h3>
              <p class="card-desc">Automatically lock the vault and clear decrypted state from memory after inactivity.</p>
            </div>
          </div>

          <div class="setting-action-row">
            <span class="action-label">Timeout Duration</span>
            <select
              class="setting-select"
              [value]="autoLockService.timeoutMinutes()"
              (change)="handleTimeoutChange($event)"
              id="select-autolock-timeout"
            >
              <option value="1">1 Minute</option>
              <option value="5">5 Minutes (Recommended)</option>
              <option value="15">15 Minutes</option>
              <option value="30">30 Minutes</option>
              <option value="60">60 Minutes</option>
              <option value="0">Never (Insecure)</option>
            </select>
          </div>

          <div class="setting-action-row">
            <div class="toggle-label-wrap">
              <span class="action-label">Lock on Tab Hidden / Minimize</span>
              <span class="toggle-hint">Immediately locks vault when switching browser tabs or backgrounding the app.</span>
            </div>
            <label class="toggle-label">
              <input
                type="checkbox"
                class="toggle-checkbox"
                [checked]="autoLockService.lockOnTabHidden()"
                (change)="handleTabHiddenToggle($event)"
                id="checkbox-lock-hidden"
              />
              <span class="toggle-text">{{ autoLockService.lockOnTabHidden() ? 'Enabled' : 'Disabled' }}</span>
            </label>
          </div>
        </div>

        <!-- Clipboard Security Card -->
        <div class="setting-card">
          <div class="card-icon-title">
            <div class="setting-icon">
              <app-icon name="copy" [size]="20" />
            </div>
            <div>
              <h3 class="card-heading">Clipboard Protection</h3>
              <p class="card-desc">Automatically overwrite copied credentials after a countdown to prevent leakage.</p>
            </div>
          </div>

          <div class="clipboard-warning">
            <app-icon name="alert" [size]="16" />
            <span>Note: Browser clipboard clearing cannot erase operating system clipboard history tools (e.g. Windows Win+V or mobile keyboard histories).</span>
          </div>

          <div class="setting-action-row">
            <span class="action-label">Auto-Clear Countdown</span>
            <select
              class="setting-select"
              [value]="autoLockService.clipboardTimeoutSeconds()"
              (change)="handleClipboardTimeoutChange($event)"
              id="select-clipboard-timeout"
            >
              <option value="10">10 Seconds</option>
              <option value="30">30 Seconds (Recommended)</option>
              <option value="60">60 Seconds</option>
              <option value="120">120 Seconds</option>
              <option value="0">Never (Insecure)</option>
            </select>
          </div>

          @if (autoLockService.isClipboardClearingScheduled()) {
            <div class="clipboard-active-banner">
              <div class="active-badge-wrap">
                <app-badge variant="warning" size="sm">Active</app-badge>
                <span>Clearing in <strong>{{ autoLockService.clipboardRemainingSeconds() }}s</strong></span>
              </div>
              <app-button variant="secondary" size="sm" (clicked)="autoLockService.executeClipboardClear()">
                Clear Now
              </app-button>
            </div>
          }
        </div>

        <!-- Backup / Export Card -->
        <div class="setting-card">
          <div class="card-icon-title">
            <div class="setting-icon">
              <app-icon name="download" [size]="20" />
            </div>
            <div>
              <h3 class="card-heading">Encrypted Backup & Recovery</h3>
              <p class="card-desc">Export or restore your vault as an authenticated <code>.zerovault</code> file.</p>
            </div>
          </div>

          <div class="setting-action-row buttons-group">
            <app-button variant="secondary" size="sm" (clicked)="handleExport()" id="btn-export-vault">
              <app-icon name="download" [size]="14" />
              Export Encrypted Vault
            </app-button>
            <app-button variant="secondary" size="sm" (clicked)="handleImport()" id="btn-import-vault">
              <app-icon name="upload" [size]="14" />
              Import Encrypted Vault
            </app-button>
          </div>
        </div>

        <!-- Cloud Sync (Google Drive) -->
        <div class="setting-card">
          <div class="card-icon-title">
            <div class="setting-icon">
              <app-icon name="cloud" [size]="20" />
            </div>
            <div>
              <h3 class="card-heading">Google Drive Sync</h3>
              <p class="card-desc">Sync encrypted .zerovault envelopes with your personal Google Drive appDataFolder.</p>
            </div>
          </div>

          <div class="setting-action-row">
            <div class="status-indicator">
              <span class="status-dot" [class.connected]="syncService.isConnected()"></span>
              <span class="action-label">
                Status: <strong>{{ syncService.isConnected() ? 'Connected' : 'Disconnected' }}</strong>
              </span>
            </div>

            <div class="buttons-group">
              @if (syncService.isConnected()) {
                @if (vaultService.isLocked()) {
                  <app-button
                    variant="primary"
                    size="sm"
                    [disabled]="syncService.isSyncing()"
                    (clicked)="handlePullFromDrive()"
                    id="btn-pull-drive"
                  >
                    <app-icon name="cloud" [size]="14" />
                    {{ syncService.isSyncing() ? 'Downloading...' : 'Download from Drive' }}
                  </app-button>
                } @else {
                  <app-button
                    variant="primary"
                    size="sm"
                    [disabled]="syncService.isSyncing()"
                    (clicked)="handleSyncNow()"
                    id="btn-sync-now"
                  >
                    <app-icon name="refresh" [size]="14" />
                    {{ syncService.isSyncing() ? 'Syncing...' : 'Sync Now' }}
                  </app-button>
                }
                <app-button variant="outline" size="sm" (clicked)="syncService.disconnect()" id="btn-disconnect-drive">
                  Disconnect
                </app-button>
              } @else {
                <app-button variant="secondary" size="sm" (clicked)="openDriveConfig()" id="btn-configure-drive">
                  <app-icon name="settings" [size]="14" />
                  Configure Client ID
                </app-button>
                <app-button variant="primary" size="sm" (clicked)="handleDriveConnect()" id="btn-connect-drive">
                  <app-icon name="cloud" [size]="14" />
                  Connect Drive
                </app-button>
              }
            </div>
          </div>

          @if (syncService.lastSyncTime()) {
            <div class="sync-meta-row">
              <span class="sync-meta-label">Last Synced:</span>
              <span class="sync-meta-val">{{ syncService.lastSyncTime() | date:'medium' }}</span>
            </div>
          }

          @if (syncService.syncError()) {
            <div class="error-alert">
              <div class="error-msg-row">
                <app-icon name="alert" [size]="16" />
                <span>{{ syncService.syncError() }}</span>
              </div>
              @if (!vaultService.isLocked()) {
                <div class="error-actions-row">
                  <app-button
                    variant="danger"
                    size="sm"
                    [disabled]="syncService.isSyncing()"
                    (clicked)="handleOverwriteRemote()"
                    id="btn-overwrite-remote"
                  >
                    <app-icon name="upload" [size]="14" />
                    Overwrite Remote with Local Vault
                  </app-button>
                </div>
              }
            </div>
          }
        </div>

        <!-- PWA & Offline Availability Card -->
        <div class="setting-card">
          <div class="card-icon-title">
            <div class="setting-icon">
              <app-icon [name]="pwaService.isOnline() ? 'wifi' : 'wifi-off'" [size]="20" />
            </div>
            <div>
              <h3 class="card-heading">PWA & Offline Availability</h3>
              <p class="card-desc">Zero-knowledge offline execution with Service Worker caching and standalone PWA support.</p>
            </div>
          </div>

          <div class="setting-action-row">
            <div>
              <span class="action-label">Network Status</span>
              <p class="toggle-hint">ZeroVault operates 100% offline using local IndexedDB storage.</p>
            </div>
            <app-badge [variant]="pwaService.isOnline() ? 'success' : 'warning'">
              <app-icon [name]="pwaService.isOnline() ? 'wifi' : 'wifi-off'" [size]="12" />
              {{ pwaService.isOnline() ? 'Online' : 'Offline Mode' }}
            </app-badge>
          </div>

          <div class="setting-action-row">
            <div>
              <span class="action-label">Service Worker Cache</span>
              <p class="toggle-hint">Static assets, cryptographic Web Worker, and application shell are cached.</p>
            </div>
            <app-badge [variant]="pwaService.swActive() || pwaService.swRegistered() ? 'success' : 'default'">
              <app-icon name="shield" [size]="12" />
              {{ pwaService.swActive() || pwaService.swRegistered() ? 'Active & Ready' : 'Standby' }}
            </app-badge>
          </div>

          @if (pwaService.canInstall()) {
            <div class="setting-action-row">
              <div>
                <span class="action-label">Install Application</span>
                <p class="toggle-hint">Install ZeroVault as a standalone application on your device.</p>
              </div>
              <app-button variant="primary" size="sm" (clicked)="pwaService.promptInstall()" id="btn-install-pwa">
                <app-icon name="smartphone" [size]="14" />
                Install ZeroVault
              </app-button>
            </div>
          }

          <div class="setting-action-row">
            <div>
              <span class="action-label">Software Updates</span>
              <p class="toggle-hint">{{ pwaService.updateAvailable() ? 'A new version of ZeroVault is ready to apply.' : 'Check for the latest updates on Cloudflare Pages.' }}</p>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
              @if (pwaService.updateAvailable()) {
                <app-button variant="primary" size="sm" (clicked)="pwaService.applyUpdate()" id="btn-apply-update">
                  <app-icon name="refresh" [size]="14" />
                  Apply Update Now
                </app-button>
              } @else {
                <app-button variant="secondary" size="sm" (clicked)="handleCheckUpdate()" id="btn-check-update">
                  <app-icon name="refresh" [size]="14" />
                  Check for Updates
                </app-button>
              }
            </div>
          </div>
        </div>

        <!-- About ZeroVault -->
        <div class="setting-card">
          <div class="card-icon-title">
            <div class="setting-icon">
              <app-icon name="shield" [size]="20" />
            </div>
            <div>
              <h3 class="card-heading">Security Specification</h3>
              <p class="card-desc">Zero-knowledge client-side encryption architecture.</p>
            </div>
          </div>

          <div class="specs-list">
            <div class="spec-item">
              <span class="spec-label">Key Derivation:</span>
              <span class="spec-val">Argon2id (64 MiB, t=3, p=1)</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Symmetric Cipher:</span>
              <span class="spec-val">AES-256-GCM (12-byte IV, 128-bit tag, AAD)</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Backup Integrity:</span>
              <span class="spec-val">SHA-256 Checksum on Canonical Envelope</span>
            </div>
            <div class="spec-item">
              <span class="spec-label">Local Persistence:</span>
              <span class="spec-val">IndexedDB (Encrypted Envelopes Only)</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Export Modal -->
      <app-modal
        [isOpen]="isExportModalOpen()"
        title="Export Encrypted Vault"
        description="Zero-knowledge authenticated backup (.zerovault)"
        size="md"
        (closed)="isExportModalOpen.set(false)"
      >
        <div class="modal-content-box">
          <div class="backup-alert-box">
            <app-icon name="shield" [size]="20" />
            <div>
              <strong>Master Password Protected:</strong>
              <p>This backup is encrypted client-side using Argon2id (64 MiB) and AES-256-GCM with your current master password. It contains zero plaintext credentials.</p>
            </div>
          </div>

          <div class="backup-meta-list">
            <div class="meta-row">
              <span class="meta-label">Vault Name:</span>
              <span class="meta-val">{{ vaultService.vaultName() }}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Total Credentials:</span>
              <span class="meta-val">{{ vaultService.entries().length }} items</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Format:</span>
              <code>.zerovault</code>
            </div>
          </div>
        </div>

        <div footer>
          <app-button variant="secondary" (clicked)="isExportModalOpen.set(false)">Cancel</app-button>
          <app-button variant="primary" (clicked)="confirmExport()" id="btn-confirm-export">
            <app-icon name="download" [size]="14" />
            Download Backup File
          </app-button>
        </div>
      </app-modal>

      <!-- Import Modal -->
      <app-modal
        [isOpen]="isImportModalOpen()"
        title="Import Encrypted Vault"
        description="Restore or merge credentials from a .zerovault backup"
        size="md"
        (closed)="closeImportModal()"
      >
        <div class="modal-content-box">
          @if (importStep() === 'select_file') {
            <div class="dropzone" (click)="fileInput.click()">
              <input #fileInput type="file" accept=".zerovault,.pradipvault,.json,.csv" (change)="onFileSelected($event)" style="display: none" id="backup-file-input" />
              <div class="dropzone-icon">
                <app-icon name="upload" [size]="32" />
              </div>
              <h4>Select backup or CSV file</h4>
              <p>Choose a .zerovault file or Google Password Manager .csv file</p>
            </div>

            @if (importError()) {
              <div class="error-alert">
                <app-icon name="alert" [size]="16" />
                <span>{{ importError() }}</span>
              </div>
            }
          } @else if (importStep() === 'enter_password') {
            <div class="file-summary-card">
              <app-icon name="shield" [size]="20" />
              <div class="file-meta">
                <strong>{{ importFileName() }}</strong>
                <span>Exported: {{ parsedBackup()?.exportedAt | date:'medium' }}</span>
              </div>
              <app-badge variant="success" size="sm">Integrity Verified</app-badge>
            </div>

            <p class="step-hint">Enter the master password used to encrypt this backup:</p>

            <app-input
              label="Backup Master Password"
              type="password"
              placeholder="Enter master password"
              [value]="importPassword()"
              (valueChange)="importPassword.set($event)"
              [required]="true"
              id="input-backup-password"
            />

            @if (importError()) {
              <div class="error-alert">
                <app-icon name="alert" [size]="16" />
                <span>{{ importError() }}</span>
              </div>
            }

            @if (isImportBusy()) {
              <div class="import-busy-row">
                <span class="busy-spinner"></span>
                <span>Deriving Argon2id key and decrypting backup...</span>
              </div>
            }
          } @else if (importStep() === 'preview_and_apply') {
            <div class="preview-box">
              <div class="preview-header">
                <app-icon name="check" [size]="20" />
                <div>
                  <h4>{{ isCsvImport() ? 'Google Passwords Ready' : 'Backup Decrypted Successfully' }}</h4>
                  <p>Found <strong>{{ decryptedImportVault()?.entries?.length || 0 }} credentials</strong> ready to import.</p>
                </div>
              </div>

              @if (!vaultService.isLocked() && vaultService.entries().length > 0) {
                <div class="strategy-selector">
                  <span class="strategy-title">Choose Import Strategy:</span>

                  <label class="strategy-option" [class.selected]="importStrategy() === 'merge'">
                    <input type="radio" name="strategy" value="merge" [checked]="importStrategy() === 'merge'" (change)="importStrategy.set('merge')" />
                    <div class="strategy-text">
                      <strong>Merge with Current Vault (Recommended)</strong>
                      <span>Preserves existing entries; updates items that are newer in the backup; appends new items.</span>
                    </div>
                  </label>

                  <label class="strategy-option" [class.selected]="importStrategy() === 'overwrite'">
                    <input type="radio" name="strategy" value="overwrite" [checked]="importStrategy() === 'overwrite'" (change)="importStrategy.set('overwrite')" />
                    <div class="strategy-text">
                      <strong>Overwrite Entire Vault</strong>
                      <span>Replaces all current credentials with the contents of this backup file.</span>
                    </div>
                  </label>
                </div>
              } @else {
                <div class="restore-note">
                  <app-icon name="shield" [size]="16" />
                  <span>This will restore the backup as your active vault with {{ decryptedImportVault()?.entries?.length || 0 }} credentials.</span>
                </div>
              }
            </div>
          }
        </div>

        <div footer>
          <app-button variant="secondary" (clicked)="closeImportModal()">Cancel</app-button>

          @if (importStep() === 'enter_password') {
            <app-button
              variant="primary"
              (clicked)="verifyAndDecryptBackup()"
              [disabled]="!importPassword().trim() || isImportBusy()"
              id="btn-verify-backup"
            >
              <app-icon name="unlock" [size]="14" />
              Unlock & Verify
            </app-button>
          } @else if (importStep() === 'preview_and_apply') {
            <app-button
              variant="primary"
              (clicked)="executeImport()"
              [disabled]="isImportBusy()"
              id="btn-execute-import"
            >
              <app-icon name="check" [size]="14" />
              Complete Import
            </app-button>
          }
        </div>
      </app-modal>

      <!-- Google Drive Config Modal -->
      <app-modal
        [isOpen]="isDriveConfigOpen()"
        title="Configure Google Drive Sync"
        description="OAuth 2.0 Web Client ID for appDataFolder access"
        size="md"
        (closed)="isDriveConfigOpen.set(false)"
      >
        <div class="modal-content-box">
          <div class="backup-alert-box">
            <app-icon name="shield" [size]="20" />
            <div>
              <strong>Zero-Knowledge Isolation:</strong>
              <p>ZeroVault only requests access to Google Drive's hidden <code>appDataFolder</code>. Only encrypted AES-256-GCM envelopes are synced. Google Drive never sees plaintext passwords.</p>
            </div>
          </div>

          <app-input
            label="Google OAuth 2.0 Client ID"
            placeholder="e.g. 1234567890-abcdef.apps.googleusercontent.com"
            [value]="tempClientId()"
            (valueChange)="tempClientId.set($event)"
            [required]="true"
            id="input-google-client-id"
          />

          <p class="toggle-hint">
            Create a "Web application" OAuth Client ID in Google Cloud Console with authorized JavaScript origins set to your domain.
          </p>
        </div>

        <div footer>
          <app-button variant="secondary" (clicked)="isDriveConfigOpen.set(false)">Cancel</app-button>
          <app-button variant="primary" (clicked)="saveDriveConfig()" id="btn-save-drive-config">
            Save Configuration
          </app-button>
        </div>
      </app-modal>
    </div>
  `,
  styles: [`
    .settings-wrap {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
    }

    .settings-header {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .settings-title {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--text-primary);
    }

    .settings-subtitle {
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .settings-grid {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .setting-card {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1.5rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
    }

    .card-icon-title {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
    }

    .setting-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      background: var(--bg-surface-elevated);
      color: var(--accent-primary);
      flex-shrink: 0;
    }

    .card-heading {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 0.2rem;
    }

    .card-desc {
      font-size: 0.8125rem;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .setting-action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border-subtle);
      gap: 1rem;
      flex-wrap: wrap;
    }

    .toggle-label-wrap {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .toggle-hint {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .toggle-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .toggle-checkbox {
      width: 18px;
      height: 18px;
      accent-color: var(--accent-primary);
      cursor: pointer;
    }

    .buttons-group {
      justify-content: flex-start;
    }

    .action-label {
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .setting-select {
      height: 36px;
      padding: 0 0.75rem;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: 0.8125rem;
      outline: none;
      cursor: pointer;
    }

    .clipboard-warning {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.65rem 0.85rem;
      background: var(--status-warning-bg);
      border: 1px solid var(--status-warning-border);
      border-radius: var(--radius-sm);
      font-size: 0.75rem;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .clipboard-warning app-icon {
      color: var(--status-warning);
      flex-shrink: 0;
    }

    .clipboard-active-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.65rem 1rem;
      background: var(--accent-subtle);
      border: 1px solid var(--accent-glow);
      border-radius: var(--radius-sm);
      font-size: 0.8125rem;
      color: var(--text-primary);
    }

    .active-badge-wrap {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: var(--radius-full);
      background: var(--text-muted);
      transition: all var(--transition-fast);
    }

    .status-dot.connected {
      background: var(--status-success);
      box-shadow: 0 0 8px var(--status-success);
    }

    .sync-meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border-subtle);
      font-size: 0.75rem;
    }

    .sync-meta-label {
      color: var(--text-muted);
    }

    .sync-meta-val {
      color: var(--text-secondary);
      font-weight: 600;
    }

    .specs-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border-subtle);
    }

    .spec-item {
      display: flex;
      justify-content: space-between;
      font-size: 0.8125rem;
    }

    .spec-label {
      color: var(--text-muted);
    }

    .spec-val {
      color: var(--text-primary);
      font-family: monospace;
    }

    code {
      background: var(--bg-surface-elevated);
      padding: 0.1rem 0.3rem;
      border-radius: var(--radius-xs);
      color: var(--accent-primary);
      font-family: monospace;
    }

    /* Modal Content Styles */
    .modal-content-box {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .backup-alert-box {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      background: var(--accent-subtle);
      border: 1px solid var(--accent-glow);
      border-radius: var(--radius-md);
      font-size: 0.8125rem;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .backup-alert-box strong {
      color: var(--text-primary);
      display: block;
      margin-bottom: 0.2rem;
    }

    .backup-alert-box app-icon {
      color: var(--accent-primary);
      flex-shrink: 0;
      margin-top: 0.1rem;
    }

    .backup-meta-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-md);
      border: 1px solid var(--border-subtle);
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.8125rem;
    }

    .meta-label {
      color: var(--text-muted);
    }

    .meta-val {
      color: var(--text-primary);
      font-weight: 600;
    }

    /* Dropzone */
    .dropzone {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 2.5rem 1.5rem;
      border: 2px dashed var(--border-medium);
      border-radius: var(--radius-lg);
      background: var(--bg-surface-elevated);
      cursor: pointer;
      text-align: center;
      transition: all var(--transition-fast);
    }

    .dropzone:hover {
      border-color: var(--accent-primary);
      background: var(--accent-subtle);
    }

    .dropzone-icon {
      color: var(--accent-primary);
    }

    .dropzone h4 {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0;
    }

    .dropzone p {
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin: 0;
    }

    .file-summary-card {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }

    .file-meta {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      flex: 1;
    }

    .file-meta strong {
      font-size: 0.875rem;
      color: var(--text-primary);
    }

    .file-meta span {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .step-hint {
      font-size: 0.8125rem;
      color: var(--text-secondary);
      margin: 0;
    }

    .error-alert {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      padding: 0.65rem 0.85rem;
      background: var(--status-error-bg);
      border: 1px solid var(--status-error-border);
      border-radius: var(--radius-sm);
      font-size: 0.8125rem;
      color: var(--status-error);
    }

    .error-msg-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .error-actions-row {
      display: flex;
      justify-content: flex-end;
    }

    .import-busy-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }

    .busy-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--accent-subtle);
      border-top-color: var(--accent-primary);
      border-radius: var(--radius-full);
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .preview-box {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .preview-header {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      background: var(--accent-subtle);
      border: 1px solid var(--accent-glow);
      border-radius: var(--radius-md);
      color: var(--text-primary);
    }

    .preview-header app-icon {
      color: var(--status-success);
      flex-shrink: 0;
      margin-top: 0.1rem;
    }

    .preview-header h4 {
      margin: 0 0 0.2rem 0;
      font-size: 0.9375rem;
      font-weight: 700;
    }

    .preview-header p {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }

    .strategy-selector {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .strategy-title {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .strategy-option {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .strategy-option input {
      margin-top: 0.2rem;
      cursor: pointer;
    }

    .strategy-option.selected {
      border-color: var(--accent-primary);
      background: var(--accent-subtle);
    }

    .strategy-text {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .strategy-text strong {
      font-size: 0.875rem;
      color: var(--text-primary);
    }

    .strategy-text span {
      font-size: 0.75rem;
      color: var(--text-muted);
      line-height: 1.35;
    }

    .restore-note {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-md);
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }
  `]
})
export class SettingsComponent {
  public readonly themeService = inject(ThemeService);
  public readonly autoLockService = inject(AutoLockService);
  public readonly vaultService = inject(VaultService);
  private readonly backupService = inject(BackupService);
  public readonly syncService = inject(SyncService);
  public readonly pwaService = inject(PwaService);
  private readonly toast = inject(ToastService);
  public readonly router = inject(Router);

  // Modal States
  public readonly isExportModalOpen = signal<boolean>(false);
  public readonly isImportModalOpen = signal<boolean>(false);
  public readonly isDriveConfigOpen = signal<boolean>(false);
  public readonly tempClientId = signal<string>('');

  // Import Process States
  public readonly importStep = signal<'select_file' | 'enter_password' | 'preview_and_apply'>('select_file');
  public readonly importFileName = signal<string>('');
  public readonly parsedBackup = signal<VaultBackupFile | null>(null);
  public readonly decryptedImportVault = signal<DecryptedVault | null>(null);
  public readonly importPassword = signal<string>('');
  public readonly importStrategy = signal<'merge' | 'overwrite'>('merge');
  public readonly isImportBusy = signal<boolean>(false);
  public readonly importError = signal<string>('');
  public readonly isCsvImport = signal<boolean>(false);

  public handleTimeoutChange(event: Event): void {
    const val = parseInt((event.target as HTMLSelectElement).value, 10);
    this.autoLockService.setTimeoutMinutes(val);
    this.toast.info(`Auto-lock timeout updated to ${val === 0 ? 'Never' : val + ' minutes'}`);
  }

  public handleTabHiddenToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.autoLockService.setLockOnTabHidden(checked);
    this.toast.info(`Lock on tab hidden ${checked ? 'enabled' : 'disabled'}`);
  }

  public handleClipboardTimeoutChange(event: Event): void {
    const val = parseInt((event.target as HTMLSelectElement).value, 10);
    this.autoLockService.setClipboardTimeoutSeconds(val);
    this.toast.info(`Clipboard auto-clear updated to ${val === 0 ? 'Never' : val + ' seconds'}`);
  }

  public async handleCheckUpdate(): Promise<void> {
    const hasUpdate = await this.pwaService.checkForUpdate();
    if (hasUpdate) {
      this.toast.info('A new update is available for ZeroVault!');
    } else {
      this.toast.success('You are running the latest version of ZeroVault.');
    }
  }

  public openDriveConfig(): void {
    this.tempClientId.set(this.syncService.googleClientId());
    this.isDriveConfigOpen.set(true);
  }

  public async saveDriveConfig(): Promise<void> {
    const id = this.tempClientId().trim();
    await this.syncService.setGoogleClientId(id);
    this.isDriveConfigOpen.set(false);
    this.toast.success('Google Client ID saved.');
  }

  public async handleDriveConnect(): Promise<void> {
    if (!this.syncService.googleClientId()) {
      this.openDriveConfig();
      return;
    }

    try {
      await this.syncService.connect();
    } catch {
      // Handled by syncService toast
    }
  }

  public async handleSyncNow(): Promise<void> {
    try {
      await this.syncService.syncNow();
    } catch {
      // Handled by syncService toast
    }
  }

  public async handleOverwriteRemote(): Promise<void> {
    try {
      await this.syncService.overwriteRemoteVault();
    } catch {
      // Handled by syncService toast
    }
  }

  public async handlePullFromDrive(): Promise<void> {
    try {
      await this.syncService.pullVaultFromDrive();
      this.router.navigate(['/unlock']);
    } catch {
      // Handled by syncService toast
    }
  }

  public handleExport(): void {
    if (this.vaultService.isLocked()) {
      this.toast.warning('Please unlock your vault before exporting.');
      return;
    }
    this.isExportModalOpen.set(true);
  }

  public async confirmExport(): Promise<void> {
    try {
      const { filename, blob } = await this.backupService.generateBackupFile();
      this.backupService.triggerDownload(blob, filename);
      this.isExportModalOpen.set(false);
      this.toast.success(`Encrypted backup saved: ${filename}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to export backup.';
      this.toast.error(msg);
    }
  }

  public handleImport(): void {
    this.resetImportState();
    this.isImportModalOpen.set(true);
  }

  public closeImportModal(): void {
    this.isImportModalOpen.set(false);
    this.resetImportState();
  }

  private resetImportState(): void {
    this.importStep.set('select_file');
    this.importFileName.set('');
    this.parsedBackup.set(null);
    this.decryptedImportVault.set(null);
    this.importPassword.set('');
    this.importStrategy.set('merge');
    this.isImportBusy.set(false);
    this.importError.set('');
    this.isCsvImport.set(false);
  }

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.importFileName.set(file.name);
    this.importError.set('');

    const isCsv = file.name.toLowerCase().endsWith('.csv');
    this.isCsvImport.set(isCsv);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = reader.result as string;

        if (isCsv) {
          if (this.vaultService.isLocked()) {
            throw new Error('Please unlock your vault before importing passwords from a CSV file.');
          }
          const csvVault = this.backupService.parseGoogleCsv(text);
          this.decryptedImportVault.set(csvVault);
          this.importStep.set('preview_and_apply');
          return;
        }

        const parsed = await this.backupService.parseBackupFile(text);
        this.parsedBackup.set(parsed);
        this.importStep.set('enter_password');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid backup or CSV file.';
        this.importError.set(msg);
      }
    };
    reader.onerror = () => {
      this.importError.set('Failed to read file.');
    };
    reader.readAsText(file);
  }

  public async verifyAndDecryptBackup(): Promise<void> {
    const backup = this.parsedBackup();
    const pwd = this.importPassword().trim();
    if (!backup || !pwd) return;

    this.isImportBusy.set(true);
    this.importError.set('');

    try {
      const decrypted = await this.backupService.decryptBackup(backup, pwd);
      this.decryptedImportVault.set(decrypted);
      this.importStep.set('preview_and_apply');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to decrypt backup.';
      this.importError.set(msg);
    } finally {
      this.isImportBusy.set(false);
    }
  }

  public async executeImport(): Promise<void> {
    const decrypted = this.decryptedImportVault();
    const backup = this.parsedBackup();
    if (!decrypted) return;

    this.isImportBusy.set(true);

    try {
      const result = await this.backupService.applyImport(
        decrypted,
        this.importStrategy(),
        backup?.envelope
      );

      this.closeImportModal();

      if (this.importStrategy() === 'merge') {
        this.toast.success(`Import complete: ${result.added} added, ${result.updated} updated (${result.total} total).`);
      } else {
        this.toast.success(`Restored ${result.total} credentials to your vault.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to apply import.';
      this.toast.error(msg);
    } finally {
      this.isImportBusy.set(false);
    }
  }
}
