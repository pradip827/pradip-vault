import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../components/common/button/button.component';
import { InputComponent } from '../../components/common/input/input.component';
import { IconComponent } from '../../components/common/icon/icon.component';
import { ToastService } from '../../core/services/toast.service';
import { VaultService } from '../../core/services/vault.service';

@Component({
  selector: 'app-unlock',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, InputComponent, IconComponent],
  template: `
    <div class="unlock-wrap">
      <div class="card-box">
        <div class="card-header">
          <div class="header-icon">
            <app-icon name="lock" [size]="24" />
          </div>
          <h2 class="card-title">Unlock Vault</h2>
          <p class="card-subtitle">
            Enter your master password to decrypt your credentials into local memory.
          </p>
        </div>

        @if (!vaultService.hasExistingVault()) {
          <div class="no-vault-banner">
            <app-icon name="alert" [size]="20" class="no-vault-icon" />
            <div class="no-vault-content">
              <strong>No Local Vault Found</strong>
              <p>There is currently no encrypted vault stored in this browser.</p>
              <div class="no-vault-btn-row">
                <app-button variant="primary" size="sm" (clicked)="router.navigate(['/create-vault'])">
                  <app-icon name="plus" [size]="14" />
                  Create New Vault
                </app-button>
                <app-button variant="secondary" size="sm" (clicked)="router.navigate(['/settings'])">
                  <app-icon name="cloud" [size]="14" />
                  Restore from Drive / Backup
                </app-button>
              </div>
            </div>
          </div>
        } @else {
          @if (vaultService.isBusy()) {
            <div class="busy-state">
              <span class="busy-spinner"></span>
              <span class="busy-text">{{ vaultService.busyMessage() }}</span>
            </div>
          }

          <form (ngSubmit)="handleUnlock()" class="form-body">
            <app-input
              id="unlock-pass"
              label="Master Password"
              type="password"
              placeholder="Enter your master password"
              [value]="password()"
              (valueChange)="handlePasswordChange($event)"
              [required]="true"
              [disabled]="vaultService.isBusy()"
            />

            @if (errorMessage()) {
              <div class="error-banner">
                <app-icon name="alert" [size]="16" />
                <span>{{ errorMessage() }}</span>
              </div>
            }

            <app-button
              type="submit"
              variant="primary"
              size="lg"
              [fullWidth]="true"
              [disabled]="password().length === 0 || vaultService.isBusy()"
              [loading]="vaultService.isBusy()"
            >
              <app-icon name="unlock" [size]="18" />
              Unlock Vault
            </app-button>
          </form>

          <div class="forgot-notice">
            <div class="forgot-icon">
              <app-icon name="alert" [size]="16" />
            </div>
            <div class="forgot-text">
              <strong>Forgot your master password?</strong> Because ZeroVault is zero-knowledge, lost master passwords cannot be recovered without an exported <code>.zerovault</code> backup.
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .unlock-wrap {
      display: flex;
      justify-content: center;
      padding: 2rem 0;
      width: 100%;
    }

    .card-box {
      width: 100%;
      max-width: 440px;
      padding: 2.25rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
    }

    .card-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0.5rem;
      margin-bottom: 1.75rem;
    }

    .header-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 52px;
      height: 52px;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--accent-primary), #6366f1);
      color: #ffffff;
      box-shadow: var(--shadow-glow);
      margin-bottom: 0.5rem;
    }

    .card-title {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }

    .card-subtitle {
      font-size: 0.875rem;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    .no-vault-banner {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      padding: 1.25rem;
      background: var(--bg-surface-elevated);
      border: 1px dashed var(--border-medium);
      border-radius: var(--radius-md);
    }

    .no-vault-icon {
      color: var(--accent-primary);
      flex-shrink: 0;
      margin-top: 0.15rem;
    }

    .no-vault-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .no-vault-content strong {
      color: var(--text-primary);
    }

    .no-vault-btn-row {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }

    .busy-state {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      background: var(--accent-subtle);
      border: 1px solid var(--accent-glow);
      border-radius: var(--radius-md);
      margin-bottom: 1.25rem;
    }

    .busy-spinner {
      width: 1.125rem;
      height: 1.125rem;
      border: 2px solid var(--accent-glow);
      border-top-color: var(--accent-primary);
      border-radius: var(--radius-full);
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    .busy-text {
      font-size: 0.8125rem;
      color: var(--accent-primary);
      font-weight: 600;
    }

    .form-body {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .error-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--status-error-bg);
      border: 1px solid var(--status-error-border);
      border-radius: var(--radius-md);
      color: var(--status-error);
      font-size: 0.8125rem;
      font-weight: 500;
    }

    .forgot-notice {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      margin-top: 1.75rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--border-subtle);
    }

    .forgot-icon {
      color: var(--text-muted);
      flex-shrink: 0;
      margin-top: 0.15rem;
    }

    .forgot-text {
      font-size: 0.75rem;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .forgot-text strong {
      color: var(--text-secondary);
    }

    code {
      background: var(--bg-surface-elevated);
      padding: 0.1rem 0.3rem;
      border-radius: var(--radius-xs);
      font-family: monospace;
      color: var(--accent-primary);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 480px) {
      .card-box {
        padding: 1.5rem;
        border-radius: var(--radius-lg);
      }
    }
  `]
})
export class UnlockComponent {
  public readonly router = inject(Router);
  public readonly vaultService = inject(VaultService);
  private readonly toast = inject(ToastService);

  public readonly password = signal<string>('');
  public readonly errorMessage = signal<string | null>(null);

  public handlePasswordChange(pass: string): void {
    this.password.set(pass);
    this.errorMessage.set(null);
  }

  public async handleUnlock(): Promise<void> {
    if (this.password().length === 0 || this.vaultService.isBusy()) return;

    this.errorMessage.set(null);
    try {
      await this.vaultService.unlockVault(this.password());
      this.toast.success('Vault decrypted and unlocked into memory.');
      this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Decryption failed: Incorrect master password or corrupted vault.';
      this.errorMessage.set(msg);
      this.toast.error(msg);
    }
  }
}
