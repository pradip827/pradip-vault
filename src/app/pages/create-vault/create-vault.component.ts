import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../components/common/button/button.component';
import { InputComponent } from '../../components/common/input/input.component';
import { BadgeComponent } from '../../components/common/badge/badge.component';
import { IconComponent } from '../../components/common/icon/icon.component';
import { ToastService } from '../../core/services/toast.service';
import { VaultService } from '../../core/services/vault.service';

@Component({
  selector: 'app-create-vault',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, InputComponent, BadgeComponent, IconComponent],
  template: `
    <div class="create-vault-wrap">
      <div class="card-box">
        <div class="card-header">
          <div class="header-icon">
            <app-icon name="plus" [size]="22" />
          </div>
          <h2 class="card-title">Create Master Vault</h2>
          <p class="card-subtitle">
            Set up your zero-knowledge encryption key. Your master password is the root key and is never transmitted or stored anywhere.
          </p>
        </div>

        <div class="security-warning-box">
          <div class="warning-icon">
            <app-icon name="alert" [size]="20" />
          </div>
          <div class="warning-text">
            <strong>Zero-Knowledge Alert:</strong> There is no password reset or master recovery key. If you forget your master password, your encrypted vault cannot be decrypted.
          </div>
        </div>

        @if (vaultService.isBusy()) {
          <div class="busy-state">
            <span class="busy-spinner"></span>
            <span class="busy-text">{{ vaultService.busyMessage() }}</span>
          </div>
        }

        <form (ngSubmit)="handleCreate()" class="form-body">
          <app-input
            id="vault-name"
            label="Vault Name"
            placeholder="My Personal Vault"
            [value]="vaultName()"
            (valueChange)="vaultName.set($event)"
            [required]="true"
            [disabled]="vaultService.isBusy()"
          />

          <app-input
            id="master-pass"
            label="Master Password"
            type="password"
            placeholder="Minimum 12 characters recommended"
            [value]="password()"
            (valueChange)="handlePasswordChange($event)"
            [required]="true"
            [disabled]="vaultService.isBusy()"
            helperText="Use a memorable passphrase with words, numbers, and symbols."
          />

          <!-- Live password strength gauge -->
          <div class="strength-meter">
            <div class="strength-header">
              <span class="strength-label">Password Strength</span>
              <app-badge [variant]="strengthBadgeVariant()" size="sm">
                {{ strengthLabel() }}
              </app-badge>
            </div>
            <div class="strength-bar-bg">
              <div
                class="strength-bar-fill"
                [style.width.%]="strengthPercent()"
                [style.background-color]="strengthColor()"
              ></div>
            </div>
          </div>

          <app-input
            id="confirm-pass"
            label="Confirm Master Password"
            type="password"
            placeholder="Re-enter your master password"
            [value]="confirmPassword()"
            (valueChange)="confirmPassword.set($event)"
            [required]="true"
            [disabled]="vaultService.isBusy()"
            [error]="passwordMismatch() ? 'Passwords do not match.' : null"
          />

          @if (errorMessage()) {
            <div class="error-banner">
              <app-icon name="alert" [size]="16" />
              <span>{{ errorMessage() }}</span>
            </div>
          }

          <div class="action-buttons">
            <app-button
              type="button"
              variant="secondary"
              [disabled]="vaultService.isBusy()"
              (clicked)="router.navigate(['/'])"
            >
              Cancel
            </app-button>
            <app-button
              type="submit"
              variant="primary"
              [disabled]="!isValid() || vaultService.isBusy()"
              [loading]="vaultService.isBusy()"
            >
              <app-icon name="check" [size]="16" />
              Initialize Vault
            </app-button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .create-vault-wrap {
      display: flex;
      justify-content: center;
      padding: 1.5rem 0;
      width: 100%;
    }

    .card-box {
      width: 100%;
      max-width: 520px;
      padding: 2rem;
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
      margin-bottom: 1.5rem;
    }

    .header-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
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

    .security-warning-box {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem;
      border-radius: var(--radius-md);
      background: var(--status-warning-bg);
      border: 1px solid var(--status-warning-border);
      color: var(--text-primary);
      margin-bottom: 1.5rem;
    }

    .warning-icon {
      color: var(--status-warning);
      flex-shrink: 0;
      margin-top: 0.1rem;
    }

    .warning-text {
      font-size: 0.8125rem;
      line-height: 1.4;
      color: var(--text-secondary);
    }

    .warning-text strong {
      color: var(--status-warning);
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

    .strength-meter {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .strength-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .strength-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    .strength-bar-bg {
      height: 4px;
      width: 100%;
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-full);
      overflow: hidden;
    }

    .strength-bar-fill {
      height: 100%;
      transition: all var(--transition-normal);
      border-radius: var(--radius-full);
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

    .action-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 540px) {
      .card-box {
        padding: 1.25rem;
        border-radius: var(--radius-lg);
      }
    }
  `]
})
export class CreateVaultComponent {
  public readonly router = inject(Router);
  public readonly vaultService = inject(VaultService);
  private readonly toast = inject(ToastService);

  public readonly vaultName = signal<string>('Personal Vault');
  public readonly password = signal<string>('');
  public readonly confirmPassword = signal<string>('');
  public readonly errorMessage = signal<string | null>(null);

  public handlePasswordChange(pass: string): void {
    this.password.set(pass);
    this.errorMessage.set(null);
  }

  public passwordMismatch(): boolean {
    return this.confirmPassword().length > 0 && this.password() !== this.confirmPassword();
  }

  public strengthPercent(): number {
    const len = this.password().length;
    if (len === 0) return 0;
    if (len < 6) return 25;
    if (len < 10) return 50;
    if (len < 14) return 75;
    return 100;
  }

  public strengthLabel(): string {
    const len = this.password().length;
    if (len === 0) return 'Empty';
    if (len < 6) return 'Weak';
    if (len < 10) return 'Fair';
    if (len < 14) return 'Good';
    return 'Strong';
  }

  public strengthBadgeVariant(): 'default' | 'error' | 'warning' | 'success' {
    const len = this.password().length;
    if (len === 0) return 'default';
    if (len < 6) return 'error';
    if (len < 10) return 'warning';
    return 'success';
  }

  public strengthColor(): string {
    const len = this.password().length;
    if (len === 0) return 'transparent';
    if (len < 6) return 'var(--status-error)';
    if (len < 10) return 'var(--status-warning)';
    if (len < 14) return 'var(--accent-primary)';
    return 'var(--status-success)';
  }

  public isValid(): boolean {
    return (
      this.vaultName().trim().length > 0 &&
      this.password().length >= 4 &&
      this.password() === this.confirmPassword()
    );
  }

  public async handleCreate(): Promise<void> {
    if (!this.isValid() || this.vaultService.isBusy()) return;

    this.errorMessage.set(null);
    try {
      await this.vaultService.createVault(this.vaultName(), this.password());
      this.toast.success('Vault created and encrypted successfully with Argon2id + AES-256-GCM.');
      this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create vault.';
      this.errorMessage.set(msg);
      this.toast.error(msg);
    }
  }
}
