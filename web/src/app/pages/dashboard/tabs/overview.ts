import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { fmt } from '../../../core/format';
import { LogisticsService, Snapshot } from '../../../core/logistics.service';
import { ThemeService } from '../../../core/theme.service';
import { BarChart, BarSeries } from '../../../shared/charts/bar-chart';
import { LineChart } from '../../../shared/charts/line-chart';
import { Icon } from '../../../shared/icon';
import { KpiStatus, KpiTile } from '../../../shared/kpi-tile';

type Mode = 'road' | 'air' | 'sea';
type Bucket = Snapshot['series'][number];
const MODE_LABEL: Record<Mode, string> = { road: 'Road', air: 'Air', sea: 'Sea' };

@Component({
  selector: 'app-overview-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, KpiTile, BarChart, LineChart],
  template: `
    <div class="tiles">
      <app-kpi-tile class="hero-tile" [hero]="true" label="On-time delivery" [value]="otd().text" [change]="otd().change" [trend]="otd().trend" [status]="otd().status" />
      <app-kpi-tile label="Delivered" [value]="fmt.whole(delivered().total)" [trend]="delivered().trend" [change]="delivered().change" />
      <app-kpi-tile label="In transit" [value]="fmt.whole(k().inTransit)" [note]="fmt.whole(k().booked) + ' booked to depart'" />
      <app-kpi-tile label="Delayed" [value]="fmt.whole(k().delayed)" [status]="delayStatus()" />
      <app-kpi-tile label="Exceptions" [value]="fmt.whole(k().exceptions)" [status]="k().exceptions >= 3 ? 'critical' : k().exceptions > 0 ? 'warning' : 'good'" [statusText]="k().exceptions ? 'Needs action' : 'All clear'" />
      <app-kpi-tile label="Revenue (24 h)" [value]="fmt.aud(k().revenue24h)" [trend]="revenueTrend()" />
      <app-kpi-tile label="CO₂ intensity" [value]="fmt.whole(k().co2PerTkm * 1000) + ' g/tkm'" />
      <app-kpi-tile label="Cost per kg" [value]="fmt.aud2(k().costPerKg)" />
    </div>

    <div class="grid" style="margin-top: 14px">
      <section class="card c8" aria-labelledby="tp-title">
        <h2 id="tp-title">Throughput by mode <span class="sub">Deliveries per hour · last {{ hours() }}&nbsp;h</span></h2>
        <app-bar-chart [series]="throughput()" [categories]="labels()" [height]="240" xTitle="Hour (AEST)" ariaLabel="Deliveries per hour by transport mode" [yFormat]="whole" />
      </section>

      <section class="card c4" aria-labelledby="split-title">
        <h2 id="split-title">Mode split <span class="sub">Delivered · 24&nbsp;h</span></h2>
        <ul class="hbar-list">
          @for (m of split(); track m.id) {
            <li>
              <span class="hbar-label"><span class="swatch" [style.background]="m.color"></span>{{ m.label }}</span>
              <span class="hbar-track"><span class="hbar" [style.display]="'block'" [style.width.%]="m.pct * 100" [style.background]="m.color"></span></span>
              <span class="hbar-value">{{ fmt.whole(m.value) }} <span class="subtle">· {{ fmt.pct(m.share) }}</span></span>
            </li>
          }
        </ul>
        <h3 style="margin-top: 22px">Average transit</h3>
        <ul class="hbar-list">
          @for (m of transit(); track m.id) {
            <li>
              <span class="hbar-label"><span class="swatch" [style.background]="m.color"></span>{{ m.label }}</span>
              <span class="hbar-track"><span class="hbar" [style.display]="'block'" [style.width.%]="m.pct * 100" [style.background]="m.color"></span></span>
              <span class="hbar-value">{{ fmt.duration(m.value * 3600) }}</span>
            </li>
          }
        </ul>
      </section>

      <section class="card c6" aria-labelledby="otd-title">
        <h2 id="otd-title">On-time rate by hour <span class="sub">Share of deliveries inside SLA</span></h2>
        <app-line-chart [series]="otdSeries()" [labels]="labels()" [height]="200" [yFormat]="pct" [yMin]="null" xTitle="Hour (AEST)" ariaLabel="Hourly on-time delivery rate" />
      </section>

      <section class="card c6" aria-labelledby="alerts-title">
        <h2 id="alerts-title">Exceptions & alerts <span class="sub">Newest first</span></h2>
        <ul class="alerts" tabindex="0" aria-label="Exceptions and alerts, newest first">
          @for (a of alerts(); track a.id) {
            <li>
              <span class="badge" [class.badge--critical]="a.severity === 'critical'" [class.badge--warning]="a.severity === 'warning'" [class.badge--good]="a.severity === 'info'">
                <app-icon [name]="a.severity === 'info' ? 'info' : 'alert'" />{{ a.severity === 'critical' ? 'Critical' : a.severity === 'warning' ? 'Warning' : 'Info' }}
              </span>
              <span>{{ a.message }}</span>
              <time class="tabular">{{ fmt.dateTime(a.at) }}</time>
            </li>
          } @empty {
            <li><span class="badge badge--good"><app-icon name="check" />Clear</span><span>No alerts. The network is running sweetly.</span></li>
          }
        </ul>
      </section>

      <section class="card c8" aria-labelledby="dock-title">
        <h2 id="dock-title">Dock schedule <span class="sub">Departures in the next 12&nbsp;h</span></h2>
        <div class="gantt-axis" aria-hidden="true">
          @for (t of axis(); track t) {
            <span>{{ t }}</span>
          }
        </div>
        <ul class="gantt">
          @for (d of gantt(); track d.id) {
            <li>
              <span class="gantt-name"><strong class="mono">{{ d.id }}</strong> {{ d.dest }}</span>
              <span class="gantt-track" [attr.aria-label]="d.aria" role="img">
                <span class="gantt-bar" [style.left.%]="d.left" [style.width.%]="d.width" [style.background]="d.color"></span>
              </span>
            </li>
          } @empty {
            <li class="muted-small">Nothing booked in the next 12&nbsp;h.</li>
          }
        </ul>
        <a class="muted-small" routerLink="." [queryParams]="{ tab: 'shipments', status: 'Booked' }">See all booked shipments</a>
      </section>

      <section class="card c4" aria-labelledby="hub-title">
        <h2 id="hub-title">Hub occupancy</h2>
        <div class="meters">
          @for (h of snap().hubs; track h.id) {
            <div class="meter-row">
              <div class="top"><span>{{ h.name }}</span><span class="tabular">{{ fmt.pct(h.occupancy) }}</span></div>
              <div class="meter" [attr.data-level]="h.occupancy > 0.9 ? 'critical' : h.occupancy > 0.75 ? 'warning' : null" role="meter" [attr.aria-label]="h.name + ' occupancy'" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="Math.round(h.occupancy * 100)">
                <span [style.width.%]="h.occupancy * 100"></span>
              </div>
            </div>
          }
        </div>
        <a class="muted-small" routerLink="/ops">Manage hubs on the 3D ops floor</a>
      </section>
    </div>
  `,
  styleUrl: './tab.css',
})
export class OverviewTab {
  readonly hours = input(24);
  readonly mode = input<Mode | null>(null);
  private readonly logistics = inject(LogisticsService);
  private readonly theme = inject(ThemeService);
  protected readonly fmt = fmt;
  protected readonly Math = Math;
  protected readonly whole = (n: number) => fmt.whole(n);
  protected readonly pct = (n: number) => fmt.pct(n);

  protected readonly snap = this.logistics.snapshot;
  protected readonly k = computed(() => this.snap().kpis);
  private readonly window = computed(() => this.snap().series.slice(-this.hours()));
  private readonly prevWindow = computed(() => {
    const s = this.snap().series;
    const h = this.hours();
    return s.length >= h * 2 ? s.slice(-h * 2, -h) : null;
  });
  protected readonly labels = computed(() => this.window().map((b) => fmt.time(b.t)));
  private readonly modes = computed<Mode[]>(() => (this.mode() ? [this.mode()!] : ['road', 'air', 'sea']));

  protected readonly throughput = computed<BarSeries[]>(() => {
    const series = this.theme.series();
    return this.modes().map((m) => ({ id: m, label: MODE_LABEL[m], color: series[m], values: this.window().map((b) => b[m]) }));
  });

  private rate(list: { onTime: number; late: number }[]): number | null {
    const on = list.reduce((s, b) => s + b.onTime, 0);
    const late = list.reduce((s, b) => s + b.late, 0);
    return on + late ? on / (on + late) : null;
  }

  protected readonly otd = computed(() => {
    const now = this.rate(this.window());
    const prev = this.prevWindow() ? this.rate(this.prevWindow()!) : null;
    const value = now ?? this.k().otd;
    const diff = prev === null || now === null ? null : now - prev;
    const status: KpiStatus = value >= 0.95 ? 'good' : value >= 0.9 ? 'warning' : value >= 0.8 ? 'serious' : 'critical';
    return {
      text: fmt.pct(value),
      change: diff === null ? null : { value: diff, text: `${diff >= 0 ? '+' : '−'}${fmt.one(Math.abs(diff) * 100)} pts vs previous ${this.hours()} h`, upIsGood: true },
      trend: this.window().map((b) => (b.onTime + b.late ? b.onTime / (b.onTime + b.late) : null)).filter((v): v is number => v !== null).slice(-24),
      status,
    };
  });

  protected readonly delivered = computed(() => {
    const sum = (list: Bucket[]) => list.reduce((s, b) => s + this.modes().reduce((a, m) => a + b[m], 0), 0);
    const total = sum(this.window());
    const prev = this.prevWindow() ? sum(this.prevWindow()!) : null;
    return {
      total,
      trend: this.window().map((b) => this.modes().reduce((a, m) => a + b[m], 0)).slice(-24),
      change: prev === null ? null : { value: total - prev, text: `${total - prev >= 0 ? '+' : '−'}${fmt.whole(Math.abs(total - prev))} vs previous ${this.hours()} h`, upIsGood: true },
    };
  });

  protected readonly revenueTrend = computed(() => this.window().map((b) => b.revenue).slice(-24));
  protected readonly delayStatus = computed<KpiStatus>(() => (this.k().delayed > 15 ? 'serious' : this.k().delayed > 8 ? 'warning' : 'good'));

  protected readonly otdSeries = computed(() => [
    { id: 'otd', label: 'On-time rate', color: 'var(--series-road)', values: this.window().map((b) => (b.onTime + b.late ? b.onTime / (b.onTime + b.late) : null)) },
  ]);

  protected readonly split = computed(() => {
    const s = this.snap().modeSplit;
    const series = this.theme.series();
    const total = Math.max(1, s.road + s.air + s.sea);
    const max = Math.max(1, s.road, s.air, s.sea);
    return (['road', 'air', 'sea'] as Mode[]).map((m) => ({ id: m, label: MODE_LABEL[m], color: series[m], value: s[m], pct: s[m] / max, share: s[m] / total }));
  });

  protected readonly transit = computed(() => {
    const t = this.k().avgTransitH;
    const series = this.theme.series();
    const max = Math.max(1, t.road, t.air, t.sea);
    return (['road', 'air', 'sea'] as Mode[]).map((m) => ({ id: m, label: MODE_LABEL[m], color: series[m], value: t[m], pct: t[m] / max }));
  });

  protected readonly alerts = computed(() => this.snap().alerts.slice(0, 12));

  protected readonly axis = computed(() => {
    const now = this.snap().now;
    return [0, 3, 6, 9, 12].map((h) => fmt.time(now + h * 3_600_000));
  });

  protected readonly gantt = computed(() => {
    const now = this.snap().now;
    const span = 12 * 3_600_000;
    const series = this.theme.series();
    return this.snap()
      .departures.filter((d) => !this.mode() || d.mode === this.mode())
      .slice(0, 10)
      .map((d) => {
        const left = Math.max(0, (d.departAt - now) / span) * 100;
        const end = Math.min(now + span, d.etaAt);
        const width = Math.max(1, ((end - Math.max(now, d.departAt)) / span) * 100);
        return {
          id: d.id,
          dest: d.destinationName,
          left,
          width: Math.min(width, 100 - left),
          color: series[d.mode as Mode],
          aria: `${d.id} to ${d.destinationName} by ${d.mode}, departs ${fmt.time(d.departAt)}, arrives ${fmt.dateTime(d.etaAt)}`,
        };
      });
  });
}
