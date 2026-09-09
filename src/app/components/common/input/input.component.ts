import { Component, input, model, signal, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true
    }
  ],
  template: `
    <div class="input-wrapper" [class.has-error]="!!error()" [class.is-disabled]="disabled()">
      @if (label()) {
        <label class="input-label" [attr.for]="id()">
          {{ label() }}
          @if (required()) {
            <span class="required-indicator">*</span>
          }
        </label>
      }

      <div class="input-control-container">
        <input
          [id]="id()"
          [type]="actualType()"
          [placeholder]="placeholder()"
          [disabled]="disabled()"
          [readonly]="readonly()"
          [autocomplete]="autocomplete()"
          [value]="value()"
          (input)="handleInput($event)"
          (blur)="onTouched()"
          class="input-control"
        />

        @if (type() === 'password') {
          <button
            type="button"
            class="password-toggle-btn"
            (click)="togglePasswordVisibility()"
            [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
            tabindex="-1"
          >
            <app-icon [name]="showPassword() ? 'eye-off' : 'eye'" [size]="16" />
          </button>
        }
      </div>

      @if (error()) {
        <div class="input-error-msg">
          <app-icon name="alert" [size]="14" />
          <span>{{ error() }}</span>
        </div>
      } @else if (helperText()) {
        <div class="input-helper-msg">{{ helperText() }}</div>
      }
    </div>
  `,
  styles: [`
    .input-wrapper {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      width: 100%;
    }

    .input-label {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-secondary);
      user-select: none;
    }

    .required-indicator {
      color: var(--status-error);
      margin-left: 0.15rem;
    }

    .input-control-container {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
    }

    .input-control {
      width: 100%;
      height: 42px;
      padding: 0 0.875rem;
      background: var(--bg-input);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 0.875rem;
      transition: all var(--transition-fast);
      outline: none;
    }

    .input-control:hover:not(:disabled) {
      border-color: var(--border-medium);
    }

    .input-control:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px var(--accent-subtle);
    }

    .input-control:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .has-error .input-control {
      border-color: var(--status-error);
    }

    .has-error .input-control:focus {
      box-shadow: 0 0 0 3px var(--status-error-bg);
    }

    .password-toggle-btn {
      position: absolute;
      right: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      color: var(--text-muted);
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
    }

    .password-toggle-btn:hover {
      color: var(--text-primary);
    }

    .input-error-msg {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: var(--status-error);
      font-weight: 500;
      margin-top: 0.1rem;
    }

    .input-helper-msg {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.1rem;
    }
  `]
})
export class InputComponent implements ControlValueAccessor {
  public readonly id = input<string>('input-' + crypto.randomUUID().replace(/-/g, '').substring(0, 8));
  public readonly label = input<string>('');
  public readonly type = input<'text' | 'password' | 'search' | 'email'>('text');
  public readonly placeholder = input<string>('');
  public readonly error = input<string | null>(null);
  public readonly helperText = input<string>('');
  public readonly disabled = input<boolean>(false);
  public readonly readonly = input<boolean>(false);
  public readonly required = input<boolean>(false);
  public readonly autocomplete = input<string>('off');

  public readonly value = model<string>('');
  public readonly showPassword = signal<boolean>(false);

  public onChange: (val: string) => void = () => {};
  public onTouched: () => void = () => {};

  public actualType(): string {
    if (this.type() === 'password') {
      return this.showPassword() ? 'text' : 'password';
    }
    return this.type();
  }

  public togglePasswordVisibility(): void {
    this.showPassword.update(show => !show);
  }

  public handleInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.value.set(val);
    this.onChange(val);
  }

  public writeValue(val: string): void {
    this.value.set(val ?? '');
  }

  public registerOnChange(fn: (val: string) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState?(isDisabled: boolean): void {
    // Handled via disabled input binding
  }
}
