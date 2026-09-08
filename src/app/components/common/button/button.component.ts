import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [type]="type()"
      [disabled]="disabled() || loading()"
      [class]="'btn btn-' + variant() + ' btn-' + size() + (fullWidth() ? ' btn-full' : '') + (loading() ? ' btn-loading' : '')"
      (click)="handleClick($event)"
    >
      @if (loading()) {
        <span class="spinner"></span>
      }
      <span class="btn-content">
        <ng-content></ng-content>
      </span>
    </button>
  `,
  styles: [`
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      border-radius: var(--radius-md);
      font-weight: 600;
      transition: all var(--transition-fast);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      border: 1px solid transparent;
      outline: none;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      filter: grayscale(0.2);
    }

    /* Sizes */
    .btn-sm {
      padding: 0.35rem 0.75rem;
      font-size: 0.75rem;
      height: 32px;
    }

    .btn-md {
      padding: 0.5rem 1.25rem;
      font-size: 0.875rem;
      height: 42px;
    }

    .btn-lg {
      padding: 0.75rem 1.75rem;
      font-size: 1rem;
      height: 48px;
    }

    .btn-full {
      width: 100%;
    }

    /* Variants */
    .btn-primary {
      background: linear-gradient(135deg, var(--accent-primary), #4f46e5);
      color: #ffffff;
      box-shadow: 0 2px 10px var(--accent-glow);
    }

    .btn-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, var(--accent-hover), #4338ca);
      box-shadow: 0 4px 16px var(--accent-glow);
      transform: translateY(-1px);
    }

    .btn-primary:active:not(:disabled) {
      transform: translateY(0);
    }

    .btn-secondary {
      background: var(--bg-surface-elevated);
      color: var(--text-primary);
      border-color: var(--border-medium);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--bg-surface-hover);
      border-color: var(--border-focus);
      color: var(--text-primary);
    }

    .btn-danger {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: #ffffff;
      box-shadow: 0 2px 10px rgba(239, 68, 68, 0.25);
    }

    .btn-danger:hover:not(:disabled) {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
      box-shadow: 0 4px 16px rgba(239, 68, 68, 0.35);
      transform: translateY(-1px);
    }

    .btn-ghost {
      background: transparent;
      color: var(--text-secondary);
    }

    .btn-ghost:hover:not(:disabled) {
      background: var(--bg-surface-hover);
      color: var(--text-primary);
    }

    .btn-outline {
      background: transparent;
      border-color: var(--border-medium);
      color: var(--text-primary);
    }

    .btn-outline:hover:not(:disabled) {
      border-color: var(--accent-primary);
      background: var(--accent-subtle);
      color: var(--accent-primary);
    }

    .spinner {
      width: 1rem;
      height: 1rem;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: currentColor;
      border-radius: var(--radius-full);
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .btn-content {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
  `]
})
export class ButtonComponent {
  public readonly variant = input<ButtonVariant>('primary');
  public readonly size = input<ButtonSize>('md');
  public readonly type = input<'button' | 'submit' | 'reset'>('button');
  public readonly disabled = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly fullWidth = input<boolean>(false);
  
  public readonly clicked = output<MouseEvent>();

  public handleClick(event: MouseEvent): void {
    if (!this.disabled() && !this.loading()) {
      this.clicked.emit(event);
    }
  }
}
