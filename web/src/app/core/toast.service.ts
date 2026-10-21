import { Injectable, signal } from '@angular/core';

export type ToastTone = 'info' | 'good' | 'warning' | 'critical' | 'coin';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
  timeout: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  push(t: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }): number {
    const id = ++this.seq;
    const toast: Toast = { timeout: t.action ? 8000 : 4500, ...t, id };
    this.toasts.update((list) => [...list.slice(-4), toast]);
    this.schedule(toast);
    return id;
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Hover/focus pauses dismissal so people can read or act. */
  pause(id: number): void {
    clearTimeout(this.timers.get(id));
  }

  resume(id: number): void {
    const t = this.toasts().find((x) => x.id === id);
    if (t) this.schedule({ ...t, timeout: 2500 });
  }

  private schedule(t: Toast): void {
    clearTimeout(this.timers.get(t.id));
    this.timers.set(t.id, setTimeout(() => this.dismiss(t.id), t.timeout));
  }
}
