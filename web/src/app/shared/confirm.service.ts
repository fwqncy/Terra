import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  resolve: (ok: boolean) => void;
}

/** Promise-based confirmation for destructive actions (rendered by <app-confirm-host>). */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly request = signal<ConfirmRequest | null>(null);

  ask(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => this.request.set({ ...opts, resolve }));
  }

  settle(ok: boolean): void {
    const r = this.request();
    this.request.set(null);
    r?.resolve(ok);
  }
}
