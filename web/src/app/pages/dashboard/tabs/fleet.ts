import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GENERATORS, generatorCps, globalMultiplier } from '../../../../engine/idle/economy.js';
import { fmt, formatCoins } from '../../../core/format';
import { GameService } from '../../../core/game.service';
import { LogisticsService } from '../../../core/logistics.service';
import { ThemeService } from '../../../core/theme.service';
import { Icon } from '../../../shared/icon';

type Mode = 'road' | 'air' | 'sea';

@Component({
  selector: 'app-fleet-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    <div class="grid">
      <section class="card c4" aria-labelledby="util-title">
        <h2 id="util-title">Fleet utilisation <span class="sub">Vehicles busy now</span></h2>
        <div class="meters">
          @for (m of utilization(); track m.id) {
            <div class="meter-row">
              <div class="top"><span class="row" style="--gap: 8px"><span class="swatch" [style.background]="m.color"></span>{{ m.label }}</span><span class="tabular">{{ fmt.pct(m.value) }}</span></div>
              <div class="meter" [attr.data-level]="m.value > 0.92 ? 'critical' : m.value > 0.8 ? 'warning' : null" role="meter" [attr.aria-label]="m.label + ' utilisation'" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="Math.round(m.value * 100)">
                <span [style.width.%]="m.value * 100"></span>
              </div>
            </div>
          }
        </div>
        <p class="muted-small" style="margin-top: 12px">Above 90% means shipments start queuing. Add vehicles in the <a routerLink="/depot">Depot</a> to raise capacity.</p>
      </section>

      <section class="card c8" aria-labelledby="comp-title">
        <h2 id="comp-title">Your fleet <span class="sub">From the Depot · earning {{ formatCoins(game.cps()) }} coins/s</span></h2>
        <div class="table-wrap">
          <table class="table">
            <caption class="sr-only">Fleet composition and earnings</caption>
            <thead><tr><th scope="col">Vehicle</th><th scope="col">Mode</th><th scope="col" class="num">Owned</th><th scope="col" class="num">Coins/s</th><th scope="col" class="num">Share</th></tr></thead>
            <tbody>
              @for (g of fleet(); track g.id) {
                <tr>
                  <th scope="row" class="plain">{{ g.name }}</th>
                  <td>{{ g.mode }}</td>
                  <td class="num">{{ fmt.whole(g.owned) }}</td>
                  <td class="num">{{ formatCoins(g.cps) }}</td>
                  <td class="num">{{ fmt.pct(g.share) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      @for (h of snap().hubs; track h.id) {
        <section class="card c4 hub" [attr.aria-label]="h.name">
          <h3><app-icon [name]="h.kind === 'seaport' ? 'ship' : h.kind === 'airport' ? 'plane' : 'warehouse'" />{{ h.name }}</h3>
          <dl class="hub-stats tabular">
            <div><dt>Occupancy</dt><dd>{{ fmt.pct(h.occupancy) }}</dd></div>
            <div><dt>Docks busy</dt><dd>{{ h.dockDoorsBusy }}/{{ h.dockDoors }}</dd></div>
            <div><dt>Capacity</dt><dd>{{ fmt.whole(h.capacity) }}&nbsp;{{ h.unit }}</dd></div>
          </dl>
          <a class="muted-small" routerLink="/ops" [queryParams]="{ hub: h.id }">Open on the ops floor</a>
        </section>
      }

      <section class="card c12" aria-labelledby="carrier-title">
        <h2 id="carrier-title">Carrier scorecard <span class="sub">Last 72&nbsp;h</span></h2>
        <div class="table-wrap">
          <table class="table">
            <caption class="sr-only">Carrier performance</caption>
            <thead>
              <tr><th scope="col">Carrier</th><th scope="col">Mode</th><th scope="col" class="num">Shipments</th><th scope="col" class="num">On-time</th><th scope="col" class="num">Cost / tkm</th><th scope="col" class="num">CO₂ / tkm</th><th scope="col">Grade</th></tr>
            </thead>
            <tbody>
              @for (c of carriers(); track c.carrier) {
                <tr>
                  <th scope="row" class="plain">{{ c.carrier }}</th>
                  <td><span class="row" style="--gap: 6px"><span class="dot" [style.color]="color(c.mode)"></span>{{ c.mode }}</span></td>
                  <td class="num">{{ c.volume }}</td>
                  <td class="num">{{ c.otd === null ? '—' : fmt.pct(c.otd) }}</td>
                  <td class="num">{{ fmt.aud2(c.costPerTkm) }}</td>
                  <td class="num">{{ fmt.whole(c.co2PerTkm * 1000) }}&nbsp;g</td>
                  <td><span class="badge" [class]="'badge badge--' + c.tone"><app-icon [name]="c.tone === 'good' ? 'check' : 'alert'" />{{ c.grade }}</span></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
  styleUrl: './tab.css',
  styles: `
    .plain { position: static; background: none; color: var(--text); font-size: 14px; text-transform: none; letter-spacing: 0; font-weight: 700; }
    .hub-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 10px; }
    .hub-stats dt { font-size: 12px; color: var(--text-3); font-weight: 700; }
    .hub-stats dd { margin: 0; font-weight: 850; font-size: 18px; }
  `,
})
export class FleetTab {
  protected readonly game = inject(GameService);
  private readonly logistics = inject(LogisticsService);
  private readonly theme = inject(ThemeService);
  protected readonly fmt = fmt;
  protected readonly formatCoins = formatCoins;
  protected readonly Math = Math;
  protected readonly snap = this.logistics.snapshot;

  protected readonly utilization = computed(() => {
    const u = this.snap().kpis.utilization;
    const s = this.theme.series();
    return (['road', 'air', 'sea'] as Mode[]).map((m) => ({ id: m, label: m === 'road' ? 'Road' : m === 'air' ? 'Air' : 'Sea', value: u[m], color: s[m] }));
  });

  protected readonly fleet = computed(() => {
    const st = this.game.state();
    const mult = globalMultiplier(st, this.game.now());
    const total = Math.max(1e-9, this.game.cps());
    return GENERATORS.map((g) => {
      const cps = generatorCps(st, g.id) * mult;
      return { id: g.id, name: g.name, mode: g.mode, owned: st.generators[g.id] ?? 0, cps, share: cps / total };
    }).filter((g) => g.owned > 0 || g.id === 'bike' || g.id === 'van');
  });

  protected readonly carriers = computed(() =>
    this.snap()
      .carriers.map((c) => {
        const otd = c.otd ?? 1;
        const grade = otd >= 0.95 ? 'A' : otd >= 0.9 ? 'B' : otd >= 0.8 ? 'C' : 'D';
        return { ...c, grade: `Grade ${grade}`, tone: grade === 'A' ? 'good' : grade === 'B' ? 'warning' : grade === 'C' ? 'serious' : 'critical' };
      })
      .sort((a, b) => b.volume - a.volume),
  );

  protected color(m: string): string {
    return this.theme.series()[m as Mode];
  }
}
