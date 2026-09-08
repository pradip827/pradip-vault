import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../components/common/button/button.component';
import { BadgeComponent } from '../../components/common/badge/badge.component';
import { IconComponent } from '../../components/common/icon/icon.component';
import { VaultService } from '../../core/services/vault.service';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, ButtonComponent, BadgeComponent, IconComponent],
  template: `
    <div class="welcome-container">
      <div class="welcome-hero">
        <div class="hero-emblem-wrap">
          <img src="icons/icon.svg" alt="ZeroVault Emblem" class="hero-emblem" />
        </div>

        <div class="hero-badge-wrap">
          <app-badge variant="accent" size="md">
            <app-icon name="shield" [size]="14" />
            Zero-Knowledge Cryptography
          </app-badge>
        </div>

        <h1 class="hero-title">
          ZeroVault
        </h1>

        <p class="hero-subtitle">
          Your personal, client-side encrypted password manager. Keys are derived locally via Argon2id and authenticated with AES-256-GCM. No servers. No telemetry.
        </p>

        <div class="hero-cta-group">
          @if (vaultService.hasExistingVault()) {
            <app-button variant="primary" size="lg" (clicked)="navigateTo('/unlock')">
              <app-icon name="unlock" [size]="18" />
              Unlock Your Vault
            </app-button>
            <app-button variant="secondary" size="lg" (clicked)="navigateTo('/dashboard')">
              <app-icon name="shield" [size]="18" />
              Open Dashboard
            </app-button>
          } @else {
            <app-button variant="primary" size="lg" (clicked)="navigateTo('/create-vault')">
              <app-icon name="plus" [size]="18" />
              Create Master Vault
            </app-button>
            <app-button variant="secondary" size="lg" (clicked)="navigateTo('/unlock')">
              <app-icon name="unlock" [size]="18" />
              Unlock Existing
            </app-button>
          }
        </div>
      </div>

      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon feature-crypto">
            <app-icon name="key" [size]="24" />
          </div>
          <h3 class="feature-title">End-to-End Encrypted</h3>
          <p class="feature-desc">
            All passwords, usernames, and notes are encrypted in the browser with AES-256-GCM. Unencrypted data never leaves your device.
          </p>
        </div>

        <div class="feature-card">
          <div class="feature-icon feature-argon">
            <app-icon name="lock" [size]="24" />
          </div>
          <h3 class="feature-title">Argon2id Key Derivation</h3>
          <p class="feature-desc">
            Memory-hard key derivation executed in WebAssembly resists modern GPU and ASIC offline brute-force attacks.
          </p>
        </div>

        <div class="feature-card">
          <div class="feature-icon feature-offline">
            <app-icon name="smartphone" [size]="24" />
          </div>
          <h3 class="feature-title">Web, PWA & Android</h3>
          <p class="feature-desc">
            Install as a PWA or run natively on Android via Capacitor. Works 100% offline using secure browser IndexedDB.
          </p>
        </div>

        <div class="feature-card">
          <div class="feature-icon feature-sync">
            <app-icon name="cloud" [size]="24" />
          </div>
          <h3 class="feature-title">Google Drive Sync</h3>
          <p class="feature-desc">
            Optionally sync encrypted vault blobs to your personal Google Drive AppData folder with automated 3-way conflict resolution.
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .welcome-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3.5rem;
      padding: 2rem 0;
      max-width: 960px;
      margin: 0 auto;
      text-align: center;
    }

    .welcome-hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
      max-width: 680px;
    }

    .hero-emblem-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: -0.25rem;
    }

    .hero-emblem {
      width: 80px;
      height: 80px;
      filter: drop-shadow(0 0 24px rgba(56, 189, 248, 0.4));
      border-radius: 20px;
    }

    .hero-badge-wrap {
      display: inline-flex;
    }

    .hero-title {
      font-size: 2.75rem;
      font-weight: 800;
      letter-spacing: -0.035em;
      line-height: 1.15;
      background: linear-gradient(135deg, #ffffff 40%, var(--accent-primary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .hero-subtitle {
      font-size: 1.125rem;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    .hero-cta-group {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-top: 1rem;
      flex-wrap: wrap;
      justify-content: center;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
      width: 100%;
      text-align: left;
    }

    .feature-card {
      padding: 1.75rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      transition: all var(--transition-normal);
    }

    .feature-card:hover {
      border-color: var(--border-medium);
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }

    .feature-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: var(--radius-md);
      margin-bottom: 1.25rem;
    }

    .feature-crypto {
      background: rgba(59, 130, 246, 0.15);
      color: var(--accent-primary);
    }

    .feature-argon {
      background: rgba(16, 185, 129, 0.15);
      color: var(--status-success);
    }

    .feature-offline {
      background: rgba(245, 158, 11, 0.15);
      color: var(--status-warning);
    }

    .feature-sync {
      background: rgba(14, 165, 233, 0.15);
      color: var(--status-info);
    }

    .feature-title {
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 0.5rem;
    }

    .feature-desc {
      font-size: 0.875rem;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    @media (max-width: 640px) {
      .hero-title {
        font-size: 2.25rem;
      }
      .features-grid {
        grid-template-columns: 1fr;
      }
      .hero-cta-group {
        flex-direction: column;
        width: 100%;
      }
      .hero-cta-group app-button {
        width: 100%;
      }
    }
  `]
})
export class WelcomeComponent {
  public readonly router = inject(Router);
  public readonly vaultService = inject(VaultService);

  public navigateTo(path: string): void {
    this.router.navigate([path]);
  }
}
