import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EMISSIONS } from '../../../../engine/logistics/catalog.js';
import { fmt } from '../../../core/format';
import { GameService } from '../../../core/game.service';
import { LogisticsService } from '../../../core/logistics.service';
import { ThemeService } from '../../../core/theme.service';
import { LineChart } from '../../../shared/charts/line-chart';
import { Icon } from '../../../shared/icon';
import { KpiTile } from '../../../shared/kpi-tile';

type Mode = 'road' | 'air' | 'sea';

@Component({
  selector: 'app-sustainability-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, KpiTile, LineChart],
  template: `
    <div class="tiles">
      <app-kpi-tile class="hero-tile" [hero]="true" label="CO₂ emitted (24 h)" [value]="fmt.kg(k().co2Kg24h)" [trend]="trend()" />
      <app-kpi-tile label="Intensity" [value]="fmt.whole(k().co2PerTkm * 1000) + ' g/tkm'" />
      <app-kpi-tile label="Tonne-km moved" [value]="fmt.compact(totalTkm())" />
      <app-kpi-tile label="Renewable diesel" [value]="green() ? 'On' : 'Off'" [status]="green() ? 'good' : 'warning'" [statusText]="green() ? '−20% road & sea CO₂' : 'Buy it in the Depot'" />
      <app-kpi-tile label="Air share of CO₂" [value]="fmt.pct(airShare())" [status]="airShare() > 0.7 ? 'serious' : 'good'" [statusText]="airShare() > 0.7 ? 'Air-heavy' : 'Balanced'" />
    </div>

    <div class="grid" style="margin-top: 14px">
      <section class="card c7" aria-labelledby="co2-title">
        <h2 id="co2-title">CO₂ per hour <span class="sub">kg CO₂e · last {{ hours() }}&nbsp;h</span></h2>
        <app-line-chart [series]="series()" [labels]="labels()" [height]="220" [area]="true" [yFormat]="kgFmt" xTitle="Hour (AEST)" ariaLabel="Kilograms of CO2 emitted per hour" />
      </section>

      <section class="card c5" aria-labelledby="int-title">
        <h2 id="int-title">Emission factors <span class="sub">g CO₂e per tonne-km</span></h2>
        <ul class="hbar-list">
          @for (m of factors(); track m.id) {
            <li>
              <span class="hbar-label"><span class="swatch" [style.background]="m.color"></span>{{ m.label }}</span>
              <span class="hbar-track"><span class="hbar" style="display: block" [style.width.%]="m.pct * 100" [style.background]="m.color"></span></span>
              <span class="hbar-value">{{ fmt.whole(m.value) }}&nbsp;g</span>
            </li>
          }
        </ul>
        <p class="muted-small" style="margin-top: 12px">Air freight emits about 38× more per tonne-km than a container ship. Factors are typical published averages.</p>
      </section>

      <section class="card c12 whatif" aria-labelledby="shift-title">
        <h2 id="shift-title"><app-icon name="leaf" />Mode-shift what-if</h2>
        <div class="shift">
          <div class="field">
            <label for="shift">Move air freight to sea <output class="tabular">{{ fmt.pct(shift()) }}</output></label>
            <input id="shift" type="range" min="0" max="1" step="0.05" [value]="shift()" (input)="shift.set(+$any($event.target).value)" />
            <p class="hint">Applies to the last 24&nbsp;h of air tonne-km. Ships take roughly 4× longer to the islands, so this suits non-urgent cargo.</p>
          </div>
          <dl class="tabular result">
            <div><dt>CO₂ saved</dt><dd>{{ fmt.kg(saved()) }}</dd></div>
            <div><dt>New 24&nbsp;h total</dt><dd>{{ fmt.kg(k().co2Kg24h - saved()) }}</dd></div>
            <div><dt>Reduction</dt><dd>{{ fmt.pct(k().co2Kg24h ? saved() / k().co2Kg24h : 0) }}</dd></div>
            <div><dt>Equivalent to</dt><dd>{{ fmt.whole(saved() / 0.17) }}&nbsp;km in a petrol car</dd></div>
          </dl>
        </div>
        @if (!green()) {
          <a class="btn btn--sm" routerLink="/depot" [queryParams]="{ tab: 'upgrades' }">Buy Renewable Diesel</a>
        }
      </section>
    </div>
  `,
  styleUrl: './tab.css',
  styles: `
    .shift { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 24px; align-items: start; margin-bottom: 12px; }
    .result { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 0; }
    .result div { padding: 12px; border-radius: var(--r-2); background: var(--bg-raised); border: 1.5px solid var(--border); }
    .result dt { font-size: 12px; font-weight: 700; color: var(--text-3); }
    .result dd { margin: 0; font-size: 20px; font-weight: 850; }
    @media (max-width: 900px) { .shift { grid-template-columns: 1fr; } .result { grid-template-columns: repeat(2, 1fr); } }
  `,
})
export class SustainabilityTab {
  readonly hours = input(24);
  readonly mode = input<Mode | null>(null);
  private readonly logistics = inject(LogisticsService);
  private readonly game = inject(GameService);
  private readonly theme = inject(ThemeService);
  protected readonly fmt = fmt;
  protected readonly kgFmt = (n: number) => `${fmt.one(n / 1000)}\u00A0t`;
  protected readonly shift = signal(0.3);

  protected readonly k = computed(() => this.logistics.snapshot().kpis);
  private readonly stats = computed(() => this.logistics.snapshot().modeStats as unknown as Record<Mode, { tkm: number; co2Kg: number }>);
  private readonly window = computed(() => this.logistics.snapshot().series.slice(-this.hours()));
  protected readonly labels = computed(() => this.window().map((b) => fmt.time(b.t)));
  protected readonly series = computed(() => [{ id: 'co2', label: 'CO₂', color: 'var(--series-sea)', values: this.window().map((b) => b.co2) }]);
  protected readonly trend = computed(() => this.window().map((b) => b.co2).slice(-24));
  protected readonly green = computed(() => this.game.state().upgrades.includes('green-diesel'));
  protected readonly totalTkm = computed(() => Object.values(this.stats()).reduce((s, m) => s + m.tkm, 0));
  protected readonly airShare = computed(() => {
    const total = Object.values(this.stats()).reduce((s, m) => s + m.co2Kg, 0);
    return total ? this.stats().air.co2Kg / total : 0;
  });
  protected readonly saved = computed(() => this.stats().air.tkm * this.shift() * (EMISSIONS.air - EMISSIONS.sea));
  protected readonly factors = computed(() => {
    const s = this.theme.series();
    const max = EMISSIONS.air;
    return (['air', 'road', 'sea'] as Mode[]).map((m) => ({ id: m, label: m === 'road' ? 'Road' : m === 'air' ? 'Air' : 'Sea', value: EMISSIONS[m] * 1000, pct: EMISSIONS[m] / max, color: s[m] }));
  });
}
