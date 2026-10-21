import { Injectable, effect, inject, signal } from '@angular/core';
import { LogisticsSim } from '../../engine/logistics/simulator.js';
import { ApiService } from './api.service';
import { GameService } from './game.service';

export type Snapshot = ReturnType<LogisticsSim['snapshot']>;
export type Shipment = Snapshot['departures'][number];
export type ShipmentPage = { total: number; page: number; pageSize: number; items: Shipment[] };
export type LogisticsEvent = Snapshot['alerts'][number];
export interface ShipmentQuery {
  status?: string;
  mode?: string;
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/**
 * Live logistics data. Runs the deterministic simulator locally (offline mode) or reads the
 * API's SQL-backed simulation when "Source: API" is chosen and the backend is online.
 * Ticks only while something is watching (ref-counted).
 */
@Injectable({ providedIn: 'root' })
export class LogisticsService {
  private readonly api = inject(ApiService);
  private readonly game = inject(GameService);
  private readonly sim = new LogisticsSim({ seed: 2032, now: Date.now() });

  readonly snapshot = signal<Snapshot>(this.sim.snapshot());
  readonly speed = signal(2);
  readonly source = signal<'local' | 'api'>('local');
  readonly lastEvent = signal<LogisticsEvent | null>(null);
  readonly paused = signal(false);
  private watchers = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sim.on((e: LogisticsEvent) => this.lastEvent.set(e));
    // Your Depot fleet drives shipment volume; renewable diesel cuts reported CO2.
    effect(() => {
      const g = this.game.state().generators;
      this.sim.setFleet({
        road: 1 + (g['bike'] * 0.05 + g['van'] * 0.1 + g['ute'] * 0.3 + g['truck'] * 0.6 + g['hyperloop'] * 2) / 4,
        air: 1 + (g['drone'] * 0.2 + g['plane'] * 0.6) / 3,
        sea: 1 + (g['ship'] * 0.7 + g['terminal'] * 1.5) / 3,
      });
      this.sim.greenFactor = this.game.state().upgrades.includes('green-diesel') ? 0.8 : 1;
    });
  }

  /** Start ticking while a view is visible; returns the detach function. */
  attach(): () => void {
    this.watchers++;
    if (!this.timer) this.timer = setInterval(() => void this.step(), 1000);
    return () => {
      this.watchers = Math.max(0, this.watchers - 1);
      if (!this.watchers && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private async step(): Promise<void> {
    if (this.paused()) return;
    if (this.source() === 'api' && this.api.online()) {
      try {
        this.snapshot.set(await this.api.get<Snapshot>('/logistics/snapshot'));
        return;
      } catch {
        this.source.set('local');
      }
    }
    this.sim.tick(1, this.speed());
    this.snapshot.set(this.sim.snapshot());
  }

  async query(params: ShipmentQuery): Promise<ShipmentPage> {
    if (this.source() === 'api' && this.api.online()) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
      return this.api.get<ShipmentPage>(`/logistics/shipments?${qs}`);
    }
    return this.sim.query(params as Parameters<LogisticsSim['query']>[0]) as ShipmentPage;
  }

  /** Optimistic: the local sim updates instantly; the API call reconciles when online. */
  async expedite(id: string): Promise<Shipment | null> {
    const local = this.sim.expedite(id) as Shipment | null;
    this.snapshot.set(this.sim.snapshot());
    if (this.source() === 'api' && this.api.online()) {
      try {
        return await this.api.post<Shipment>(`/logistics/shipments/${encodeURIComponent(id)}/expedite`, {});
      } catch {
        return local;
      }
    }
    return local;
  }
}
