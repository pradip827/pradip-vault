import { Component, output, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { ToastService } from '../../../core/services/toast.service';
import {
  generatePassword,
  generatePassphrase,
  calculatePasswordEntropy,
  PasswordEntropyResult
} from '../../../core/crypto/generator';

@Component({
  selector: 'app-password-generator',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent],
  template: `
    <div class="generator-container">
      <!-- Mode Switcher Tabs -->
      <div class="mode-tabs" role="tablist">
        <button
          type="button"
          class="mode-btn"
          [class.active]="mode() === 'password'"
          (click)="setMode('password')"
          role="tab"
        >
          <app-icon name="key" [size]="14" />
          Random Password
        </button>
        <button
          type="button"
          class="mode-btn"
          [class.active]="mode() === 'passphrase'"
          (click)="setMode('passphrase')"
          role="tab"
        >
          <app-icon name="shield" [size]="14" />
          Memorable Passphrase
        </button>
      </div>

      <!-- Password Display Box -->
      <div class="password-display-box">
        <div class="password-text-wrap">
          <code class="generated-password-text" id="generated-password-display">{{ currentPassword() }}</code>
        </div>
        <div class="display-actions">
          <button
            type="button"
            class="icon-action-btn"
            (click)="copyPassword()"
            title="Copy to clipboard"
            aria-label="Copy to clipboard"
          >
            <app-icon name="copy" [size]="16" />
          </button>
          <button
            type="button"
            class="icon-action-btn"
            (click)="regenerate()"
            title="Generate new password"
            aria-label="Generate new password"
          >
            <app-icon name="refresh" [size]="16" />
          </button>
        </div>
      </div>

      <!-- Strength / Entropy Meter -->
      <div class="strength-meter-wrap">
        <div class="strength-labels">
          <span class="strength-text" [style.color]="strengthColor()">
            {{ entropy().label }} ({{ entropy().bits }} bits of entropy)
          </span>
          <span class="strength-category">{{ mode() === 'passphrase' ? 'Diceware' : 'CSPRNG' }}</span>
        </div>
        <div class="meter-track">
          <div
            class="meter-bar"
            [style.width.%]="strengthPercent()"
            [style.background-color]="strengthColor()"
          ></div>
        </div>
      </div>

      <!-- Controls for Random Password Mode -->
      @if (mode() === 'password') {
        <div class="options-group">
          <div class="slider-row">
            <label for="pwd-len-slider" class="option-label">Password Length</label>
            <span class="slider-val-badge">{{ length() }}</span>
          </div>
          <input
            id="pwd-len-slider"
            type="range"
            min="8"
            max="64"
            step="1"
            class="range-slider"
            [value]="length()"
            (input)="handleLengthChange($event)"
          />

          <div class="checkbox-grid">
            <label class="checkbox-item">
              <input
                type="checkbox"
                [checked]="includeUppercase()"
                (change)="toggleOption('includeUppercase')"
              />
              <span>Uppercase (A-Z)</span>
            </label>

            <label class="checkbox-item">
              <input
                type="checkbox"
                [checked]="includeLowercase()"
                (change)="toggleOption('includeLowercase')"
              />
              <span>Lowercase (a-z)</span>
            </label>

            <label class="checkbox-item">
              <input
                type="checkbox"
                [checked]="includeDigits()"
                (change)="toggleOption('includeDigits')"
              />
              <span>Numbers (0-9)</span>
            </label>

            <label class="checkbox-item">
              <input
                type="checkbox"
                [checked]="includeSymbols()"
                (change)="toggleOption('includeSymbols')"
              />
              <span>Symbols (!@#$)</span>
            </label>

            <label class="checkbox-item col-span-2">
              <input
                type="checkbox"
                [checked]="avoidAmbiguous()"
                (change)="toggleOption('avoidAmbiguous')"
              />
              <span>Avoid Ambiguous (0, O, 1, l, I)</span>
            </label>
          </div>
        </div>
      } @else {
        <!-- Controls for Passphrase Mode -->
        <div class="options-group">
          <div class="slider-row">
            <label for="pass-words-slider" class="option-label">Number of Words</label>
            <span class="slider-val-badge">{{ wordCount() }} words</span>
          </div>
          <input
            id="pass-words-slider"
            type="range"
            min="3"
            max="10"
            step="1"
            class="range-slider"
            [value]="wordCount()"
            (input)="handleWordCountChange($event)"
          />

          <div class="passphrase-controls-row">
            <div class="control-col">
              <label for="pass-sep-select" class="option-label">Separator</label>
              <select
                id="pass-sep-select"
                class="option-select"
                [value]="separator()"
                (change)="handleSeparatorChange($event)"
              >
                <option value="-">Hyphen (-)</option>
                <option value=".">Period (.)</option>
                <option value="_">Underscore (_)</option>
                <option value=" ">Space ( )</option>
              </select>
            </div>

            <div class="control-col">
              <label class="option-label">Formatting</label>
              <label class="checkbox-item align-center">
                <input
                  type="checkbox"
                  [checked]="capitalize()"
                  (change)="toggleCapitalize()"
                />
                <span>Capitalize Words</span>
              </label>
            </div>
          </div>
        </div>
      }

      <!-- Bottom Actions -->
      <div class="generator-actions">
        <app-button variant="secondary" (clicked)="cancel()">Cancel</app-button>
        <app-button variant="primary" (clicked)="usePassword()" id="btn-use-generated-password">
          <app-icon name="check" [size]="14" />
          Use This Password
        </app-button>
      </div>
    </div>
  `,
  styles: [`
    .generator-container {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      width: 100%;
    }

    /* Mode Tabs */
    .mode-tabs {
      display: flex;
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-md);
      padding: 0.25rem;
      gap: 0.25rem;
    }

    .mode-btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.5rem 0.75rem;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 600;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .mode-btn:hover {
      color: var(--text-primary);
    }

    .mode-btn.active {
      background: var(--bg-surface);
      color: var(--text-primary);
      box-shadow: var(--shadow-sm);
    }

    /* Display Box */
    .password-display-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-medium);
      border-radius: var(--radius-lg);
      padding: 0.85rem 1rem;
      box-shadow: var(--shadow-inner);
    }

    .password-text-wrap {
      overflow-x: auto;
      white-space: nowrap;
      scrollbar-width: none;
      flex: 1;
    }

    .password-text-wrap::-webkit-scrollbar {
      display: none;
    }

    .generated-password-text {
      font-family: monospace;
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--accent-primary);
      letter-spacing: 0.05em;
      word-break: break-all;
    }

    .display-actions {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-shrink: 0;
    }

    .icon-action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: var(--radius-md);
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .icon-action-btn:hover {
      color: var(--text-primary);
      border-color: var(--border-medium);
      background: var(--bg-surface-hover);
    }

    /* Strength Meter */
    .strength-meter-wrap {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .strength-labels {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .strength-text {
      transition: color var(--transition-fast);
    }

    .strength-category {
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .meter-track {
      width: 100%;
      height: 6px;
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-full);
      overflow: hidden;
    }

    .meter-bar {
      height: 100%;
      border-radius: var(--radius-full);
      transition: width var(--transition-fast), background-color var(--transition-fast);
    }

    /* Options */
    .options-group {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
    }

    .slider-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .option-label {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .slider-val-badge {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--accent-primary);
      background: var(--accent-subtle);
      padding: 0.15rem 0.5rem;
      border-radius: var(--radius-full);
    }

    .range-slider {
      width: 100%;
      height: 6px;
      background: var(--bg-surface-elevated);
      border-radius: var(--radius-full);
      accent-color: var(--accent-primary);
      cursor: pointer;
      outline: none;
    }

    .checkbox-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.65rem;
    }

    .col-span-2 {
      grid-column: span 2;
    }

    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
    }

    .checkbox-item input {
      accent-color: var(--accent-primary);
      width: 16px;
      height: 16px;
      cursor: pointer;
    }

    .passphrase-controls-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .control-col {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .option-select {
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 0.8125rem;
      padding: 0.5rem 0.75rem;
      outline: none;
      cursor: pointer;
      font-family: inherit;
    }

    .align-center {
      margin-top: 0.5rem;
    }

    /* Actions */
    .generator-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
      padding-top: 0.5rem;
    }
  `]
})
export class PasswordGeneratorComponent {
  private readonly toast = inject(ToastService);

  public readonly passwordSelected = output<string>();
  public readonly cancelled = output<void>();

  // State
  public readonly mode = signal<'password' | 'passphrase'>('password');
  public readonly length = signal<number>(20);
  public readonly includeUppercase = signal<boolean>(true);
  public readonly includeLowercase = signal<boolean>(true);
  public readonly includeDigits = signal<boolean>(true);
  public readonly includeSymbols = signal<boolean>(true);
  public readonly avoidAmbiguous = signal<boolean>(false);

  public readonly wordCount = signal<number>(5);
  public readonly separator = signal<string>('-');
  public readonly capitalize = signal<boolean>(false);

  public readonly currentPassword = signal<string>('');

  // Computed entropy and strength
  public readonly entropy = computed<PasswordEntropyResult>(() =>
    calculatePasswordEntropy(this.currentPassword())
  );

  public readonly strengthPercent = computed<number>(() =>
    Math.min(100, Math.max(10, Math.round((this.entropy().bits / 100) * 100)))
  );

  public readonly strengthColor = computed<string>(() => {
    switch (this.entropy().score) {
      case 'weak':
        return 'var(--status-danger)';
      case 'fair':
        return 'var(--status-warning)';
      case 'good':
        return '#38bdf8'; // Sky blue
      case 'strong':
        return 'var(--status-success)';
      case 'excellent':
      default:
        return '#a855f7'; // Vibrant purple
    }
  });

  constructor() {
    this.regenerate();
  }

  public setMode(newMode: 'password' | 'passphrase'): void {
    this.mode.set(newMode);
    this.regenerate();
  }

  public regenerate(): void {
    if (this.mode() === 'password') {
      const pwd = generatePassword({
        length: this.length(),
        includeUppercase: this.includeUppercase(),
        includeLowercase: this.includeLowercase(),
        includeDigits: this.includeDigits(),
        includeSymbols: this.includeSymbols(),
        avoidAmbiguous: this.avoidAmbiguous()
      });
      this.currentPassword.set(pwd);
    } else {
      const phrase = generatePassphrase({
        wordCount: this.wordCount(),
        separator: this.separator(),
        capitalize: this.capitalize()
      });
      this.currentPassword.set(phrase);
    }
  }

  public handleLengthChange(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.length.set(val);
    this.regenerate();
  }

  public handleWordCountChange(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    this.wordCount.set(val);
    this.regenerate();
  }

  public handleSeparatorChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.separator.set(val);
    this.regenerate();
  }

  public toggleOption(
    opt: 'includeUppercase' | 'includeLowercase' | 'includeDigits' | 'includeSymbols' | 'avoidAmbiguous'
  ): void {
    switch (opt) {
      case 'includeUppercase':
        this.includeUppercase.set(!this.includeUppercase());
        break;
      case 'includeLowercase':
        this.includeLowercase.set(!this.includeLowercase());
        break;
      case 'includeDigits':
        this.includeDigits.set(!this.includeDigits());
        break;
      case 'includeSymbols':
        this.includeSymbols.set(!this.includeSymbols());
        break;
      case 'avoidAmbiguous':
        this.avoidAmbiguous.set(!this.avoidAmbiguous());
        break;
    }
    this.regenerate();
  }

  public toggleCapitalize(): void {
    this.capitalize.set(!this.capitalize());
    this.regenerate();
  }

  public async copyPassword(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.currentPassword());
      this.toast.success('Generated password copied to clipboard');
    } catch {
      this.toast.error('Failed to copy password');
    }
  }

  public usePassword(): void {
    this.passwordSelected.emit(this.currentPassword());
  }

  public cancel(): void {
    this.cancelled.emit();
  }
}
