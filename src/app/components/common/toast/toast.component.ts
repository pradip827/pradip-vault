import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../../core/services/toast.service';
import { IconComponent, IconName } from '../icon/icon.component';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="toast-viewport" aria-live="polite">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast-item toast-{{ toast.type }}" role="status">
          <div class="toast-icon">
            <app-icon [name]="getIconName(toast.type)" [size]="18" />
          </div>
          <div class="toast-message">{{ toast.message }}</div>
          <button
            type="button"
            class="toast-close"
            (click)="toastService.dismiss(toast.id)"
            aria-label="Dismiss notification"
          >
            <app-icon name="close" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-viewport {
      position: fixed;
      bottom: calc(var(--safe-area-bottom) + 1.5rem);
      right: calc(var(--safe-area-right) + 1.5rem);
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-width: 380px;
      width: calc(100% - 2rem);
      pointer-events: none;
    }

    .toast-item {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      border-radius: var(--radius-md);
      background: var(--bg-surface-glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: var(--shadow-lg);
      border: 1px solid var(--border-medium);
      color: var(--text-primary);
      animation: slideInUp var(--transition-normal);
    }

    .toast-icon {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .toast-success .toast-icon {
      color: var(--status-success);
    }

    .toast-error .toast-icon {
      color: var(--status-error);
    }

    .toast-warning .toast-icon {
      color: var(--status-warning);
    }

    .toast-info .toast-icon {
      color: var(--status-info);
    }

    .toast-message {
      flex: 1;
      font-size: 0.875rem;
      font-weight: 500;
      line-height: 1.4;
      word-break: break-word;
    }

    .toast-close {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: var(--radius-xs);
      color: var(--text-muted);
      transition: all var(--transition-fast);
    }

    .toast-close:hover {
      background: var(--bg-surface-hover);
      color: var(--text-primary);
    }

    @keyframes slideInUp {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.96);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 768px) {
      .toast-viewport {
        bottom: calc(var(--mobile-nav-height) + var(--safe-area-bottom) + 1rem);
        left: 1rem;
        right: 1rem;
        width: auto;
      }
    }
  `]
})
export class ToastContainerComponent {
  public readonly toastService = inject(ToastService);

  public getIconName(type: string): IconName {
    switch (type) {
      case 'success':
        return 'check';
      case 'error':
      case 'warning':
        return 'alert';
      case 'info':
      default:
        return 'shield';
    }
  }
}
