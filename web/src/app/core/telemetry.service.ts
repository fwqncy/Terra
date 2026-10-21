import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

export interface TelemetryEvent {
  type: string;
  mode?: string;
  distance?: number;
  to?: string;
  training?: boolean;
}

/**
 * Batches simulation events and ships them every 30 s (and when the tab hides) to the API,
 * which stores them as NoSQL documents. Nothing is sent while offline; the buffer is capped.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly api = inject(ApiService);
  private buffer: TelemetryEvent[] = [];

  constructor() {
    setInterval(() => void this.flush(), 30_000);
    inject(DOCUMENT).addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
  }

  track(e: TelemetryEvent): void {
    this.buffer.push({ type: e.type, mode: e.mode, distance: e.distance, to: e.to, training: e.training });
    if (this.buffer.length > 400) this.buffer.splice(0, this.buffer.length - 400);
  }

  async flush(): Promise<void> {
    if (!this.buffer.length || !this.api.online()) return;
    const batch = this.buffer.splice(0, 200);
    try {
      await this.api.post('/telemetry', { events: batch });
    } catch {
      // put them back for the next attempt
      this.buffer.unshift(...batch);
    }
  }
}
