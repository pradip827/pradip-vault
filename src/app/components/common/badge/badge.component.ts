import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'accent' | 'outline';
export type BadgeSize = 'sm' | 'md';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span [class]="'badge badge-' + variant() + ' badge-' + size()">
      <ng-content></ng-content>
    </span>
  `,
  styles: [`
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-weight: 600;
      border-radius: var(--radius-sm);
      letter-spacing: 0.025em;
      line-height: 1;
      white-space: nowrap;
      user-select: none;
    }

    /* Sizes */
    .badge-sm {
      padding: 0.2rem 0.45rem;
      font-size: 0.6875rem;
    }

    .badge-md {
      padding: 0.3rem 0.65rem;
      font-size: 0.75rem;
    }

    /* Variants */
    .badge-default {
      background: var(--bg-surface-elevated);
      color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
    }

    .badge-accent {
      background: var(--accent-subtle);
      color: var(--accent-primary);
      border: 1px solid var(--accent-glow);
    }

    .badge-success {
      background: var(--status-success-bg);
      color: var(--status-success);
      border: 1px solid var(--status-success-border);
    }

    .badge-warning {
      background: var(--status-warning-bg);
      color: var(--status-warning);
      border: 1px solid var(--status-warning-border);
    }

    .badge-error {
      background: var(--status-error-bg);
      color: var(--status-error);
      border: 1px solid var(--status-error-border);
    }

    .badge-outline {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border-medium);
    }
  `]
})
export class BadgeComponent {
  public readonly variant = input<BadgeVariant>('default');
  public readonly size = input<BadgeSize>('md');
}
