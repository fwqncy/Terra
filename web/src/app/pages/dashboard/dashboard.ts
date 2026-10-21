import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { fmt } from '../../core/format';
import { LogisticsService } from '../../core/logistics.service';
import { Icon } from '../../shared/icon';
import { AiLabTab } from './tabs/ai-lab';
import { FleetTab } from './tabs/fleet';
import { LanesTab } from './tabs/lanes';
import { OverviewTab } from './tabs/overview';
import { ShipmentsTab } from './tabs/shipments';
import { SustainabilityTab } from './tabs/sustainability';

export const TABS = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'shipments', label: 'Shipments', icon: 'table' },
  { id: 'lanes', label: 'Lanes', icon: 'routes' },
  { id: 'fleet', label: 'Fleet & Hubs', icon: 'warehouse' },
  { id: 'sustainability', label: 'Sustainability', icon: 'leaf' },
  { id: 'ai', label: 'AI Lab', icon: 'brain' },
] as const;

/** Logistics dashboard. Every tab, filter, sort and page lives in the URL. */
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, OverviewTab, ShipmentsTab, LanesTab, FleetTab, SustainabilityTab, AiLabTab],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardPage {
  readonly tab = input<string>();
  readonly range = input<string>();
  readonly mode = input<string>();
  readonly status = input<string>();
  readonly q = input<string>();
  readonly page = input<string>();
  readonly sort = input<string>();
  readonly dir = input<string>();

  protected readonly logistics = inject(LogisticsService);
  protected readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly tabs = TABS;
  protected readonly fmt = fmt;

  protected readonly active = computed(() => (TABS.some((t) => t.id === this.tab()) ? this.tab()! : 'overview'));
  protected readonly hours = computed(() => (this.range() === '12' ? 12 : this.range() === '48' ? 48 : 24));
  protected readonly modeFilter = computed(() => (['road', 'air', 'sea'].includes(this.mode() ?? '') ? (this.mode() as 'road' | 'air' | 'sea') : null));
  protected readonly simTime = computed(() => fmt.dateTime(this.logistics.snapshot().now));

  constructor() {
    inject(DestroyRef).onDestroy(this.logistics.attach());
  }

  /** Writes filter state to the URL (Back/Forward and sharing just work). */
  protected setParam(key: string, value: string | null): void {
    this.setParams({ [key]: value });
  }

  protected setParams(params: Record<string, string | null>): void {
    const clean = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v || null]));
    const resetPage = Object.keys(params).some((k) => k !== 'page');
    void this.router.navigate([], { queryParams: { ...clean, ...(resetPage && !('page' in params) ? { page: null } : {}) }, queryParamsHandling: 'merge' });
  }

  protected setSpeed(v: number): void {
    this.logistics.speed.set(v);
  }

  protected setSource(v: 'local' | 'api'): void {
    this.logistics.source.set(v);
  }
}
