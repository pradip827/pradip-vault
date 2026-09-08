import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from './components/common/icon/icon.component';
import { ButtonComponent } from './components/common/button/button.component';
import { BadgeComponent } from './components/common/badge/badge.component';
import { ToastContainerComponent } from './components/common/toast/toast.component';
import { ThemeService } from './core/services/theme.service';
import { VaultService } from './core/services/vault.service';
import { AutoLockService } from './core/services/autolock.service';
import { ToastService } from './core/services/toast.service';
import { PwaService } from './core/services/pwa.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    ToastContainerComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  public readonly themeService = inject(ThemeService);
  public readonly vaultService = inject(VaultService);
  public readonly autoLockService = inject(AutoLockService);
  public readonly pwaService = inject(PwaService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  public ngOnInit(): void {
    this.pwaService.init();
    this.refreshFavicon();
  }

  private refreshFavicon(): void {
    if (typeof document === 'undefined') return;
    const existing = document.querySelectorAll("link[rel*='icon']");
    existing.forEach((el) => el.remove());

    const svgIcon = document.createElement('link');
    svgIcon.rel = 'icon';
    svgIcon.type = 'image/svg+xml';
    svgIcon.href = `icons/icon.svg?v=${Date.now()}`;
    document.head.appendChild(svgIcon);

    const ico = document.createElement('link');
    ico.rel = 'shortcut icon';
    ico.href = `favicon.ico?v=${Date.now()}`;
    document.head.appendChild(ico);
  }

  public handleManualLock(): void {
    this.vaultService.lockVault();
    this.toast.info('Vault locked. In-memory credentials and worker cleared.');
    this.router.navigate(['/unlock']);
  }
}
