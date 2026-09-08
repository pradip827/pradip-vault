import { Component, input, output, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export type ModalSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (isOpen()) {
      <div class="modal-backdrop" (click)="handleBackdropClick($event)">
        <div class="modal-card modal-{{ size() }}" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div class="modal-title-group">
              @if (title()) {
                <h2 class="modal-title">{{ title() }}</h2>
              }
              @if (description()) {
                <p class="modal-description">{{ description() }}</p>
              }
            </div>
            <button
              type="button"
              class="modal-close-btn"
              (click)="onClose()"
              aria-label="Close modal"
            >
              <app-icon name="close" [size]="18" />
            </button>
          </div>

          <div class="modal-body">
            <ng-content></ng-content>
          </div>

          <div class="modal-footer">
            <ng-content select="[footer]"></ng-content>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      animation: fadeIn var(--transition-fast);
    }

    .modal-card {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-height: calc(100vh - 2rem);
      background: var(--bg-surface);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
      animation: scaleUp var(--transition-normal);
    }

    .modal-sm {
      max-width: 400px;
    }

    .modal-md {
      max-width: 540px;
    }

    .modal-lg {
      max-width: 720px;
    }

    .modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
      gap: 1rem;
    }

    .modal-title-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .modal-title {
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--text-primary);
      margin: 0;
    }

    .modal-description {
      font-size: 0.8125rem;
      color: var(--text-secondary);
      margin: 0;
    }

    .modal-close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      transition: all var(--transition-fast);
      flex-shrink: 0;
    }

    .modal-close-btn:hover {
      background: var(--bg-surface-hover);
      color: var(--text-primary);
    }

    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
    }

    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-surface-elevated);
    }

    .modal-footer:empty {
      display: none;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleUp {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
  `]
})
export class ModalComponent {
  public readonly isOpen = input<boolean>(false);
  public readonly title = input<string>('');
  public readonly description = input<string>('');
  public readonly size = input<ModalSize>('md');

  public readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  public handleEscape(): void {
    if (this.isOpen()) {
      this.onClose();
    }
  }

  public handleBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.onClose();
    }
  }

  public onClose(): void {
    this.closed.emit();
  }
}
