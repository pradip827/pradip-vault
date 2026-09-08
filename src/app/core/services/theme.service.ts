import { Injectable, signal, effect } from '@angular/core';

export type AppTheme = 'dark' | 'light';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_STORAGE_KEY = 'zerovault_theme';
  
  // Dark mode is default
  public readonly currentTheme = signal<AppTheme>('dark');

  constructor() {
    // Non-sensitive preference only
    const savedTheme = localStorage.getItem(this.THEME_STORAGE_KEY) as AppTheme | null;
    if (savedTheme === 'light' || savedTheme === 'dark') {
      this.currentTheme.set(savedTheme);
    } else {
      this.currentTheme.set('dark');
    }

    // Effect to synchronize data-theme attribute on document root
    effect(() => {
      const theme = this.currentTheme();
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(this.THEME_STORAGE_KEY, theme);
    });
  }

  public toggleTheme(): void {
    this.currentTheme.update(theme => (theme === 'dark' ? 'light' : 'dark'));
  }

  public setTheme(theme: AppTheme): void {
    this.currentTheme.set(theme);
  }
}
