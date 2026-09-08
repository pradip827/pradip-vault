import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  public readonly toasts = signal<ToastMessage[]>([]);

  public show(message: string, type: ToastType = 'info', duration: number = 4000): string {
    const id = 'toast-' + Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { id, message, type, duration };

    this.toasts.update(current => [...current, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }

    return id;
  }

  public success(message: string, duration: number = 4000): string {
    return this.show(message, 'success', duration);
  }

  public error(message: string, duration: number = 5000): string {
    return this.show(message, 'error', duration);
  }

  public danger(message: string, duration: number = 5000): string {
    return this.error(message, duration);
  }

  public warning(message: string, duration: number = 4500): string {
    return this.show(message, 'warning', duration);
  }

  public info(message: string, duration: number = 4000): string {
    return this.show(message, 'info', duration);
  }

  public dismiss(id: string): void {
    this.toasts.update(current => current.filter(t => t.id !== id));
  }
}
