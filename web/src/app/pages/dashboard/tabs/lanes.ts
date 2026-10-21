import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { fmt } from '../../../core/format';
import { LogisticsService } from '../../../core/logistics.service';
import { ThemeService } from '../../../core/theme.service';
import { Icon } from '../../../shared/icon';

type Mode = 'road' | 'air' | 'sea';

@Component({
  selector: 'app-lanes-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="grid">
      <section class="card c5" aria-labelledby="top-title">
        <h2 id="top-title">Busiest lanes <span class="sub">Shipments · last 72&nbsp;h</span></h2>
        <ul class="hbar-list">
          @for (l of top(); track l.lane) {
            <li>
              <span class="hbar-label" [title]="l.lane"><span class="swatch" [style.background]="color(l.mode)"></span>{{ l.destination }}</span>
              <span class="hbar-track"><span class="hbar" style="display: block" [style.width.%]="(l.volume / maxVolume()) * 100" [style.background]="color(l.mode)"></span></span>
              <span class="hbar-value">{{ l.volume }}</span>
            </li>
          } @empty {
            <li class="muted-small">No lanes for this mode yet.</li>
          }
        </ul>
        <p class="muted-small" style="margin-top: 14px">Colour shows the mode (blue road, orange air, green sea); the table has the exact figures.</p>
      </section>

      <section class="card c7" aria-labelledby="lane-title">
        <h2 id="lane-title">Lane performance</h2>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Lane performance table" style="max-height: 520px">
          <table class="table">
            <caption class="sr-only">Lane performance by origin and destination</caption>
            <thead>
              <tr>
                <th scope="col">Lane</th>
                <th scope="col">Mode</th>
                <th scope="col" class="num">Volume</th>
                <th scope="col" class="num">On-time</th>
                <th scope="col" class="num">Avg late</th>
                <th scope="col" class="num">Revenue</th>
                <th scope="col" class="num">CO₂</th>
              </tr>
            </thead>
            <tbody>
              @for (l of rows(); track l.lane) {
                <tr>
                  <th scope="row" class="lane">{{ l.origin }} → {{ l.destination }}</th>
                  <td><span class="row" style="--gap: 6px"><span class="dot" [style.color]="color(l.mode)"></span>{{ l.mode }}</span></td>
                  <td class="num">{{ l.volume }}</td>
                  <td class="num">
                    @if (l.otd === null) {
                      <span class="subtle">—</span>
                    } @else {
                      <span [class]="l.otd < 0.85 ? 'bad' : ''">{{ fmt.pct(l.otd) }}</span>
                      @if (l.otd < 0.85) { <app-icon name="alert" [size]="13" /> }
                    }
                  </td>
                  <td class="num">{{ l.avgDelayH ? fmt.one(l.avgDelayH) + ' h' : '—' }}</td>
                  <td class="num">{{ fmt.aud(l.revenue) }}</td>
                  <td class="num">{{ fmt.kg(l.co2) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="row" style="margin-top: 10px">
          <button class="btn btn--sm btn--ghost" type="button" [attr.aria-pressed]="sortBy() === 'volume'" (click)="sortBy.set('volume')">Sort by volume</button>
          <button class="btn btn--sm btn--ghost" type="button" [attr.aria-pressed]="sortBy() === 'otd'" (click)="sortBy.set('otd')">Worst on-time first</button>
          <button class="btn btn--sm btn--ghost" type="button" [attr.aria-pressed]="sortBy() === 'revenue'" (click)="sortBy.set('revenue')">Sort by revenue</button>
        </div>
      </section>
    </div>
  `,
  styleUrl: './tab.css',
  styles: `.lane { font-weight: 700; text-transform: none; letter-spacing: 0; font-size: 14px; position: static; background: none; color: var(--text); } .bad { color: var(--status-critical); font-weight: 800; }`,
})
export class LanesTab {
  readonly mode = input<Mode | null>(null);
  private readonly logistics = inject(LogisticsService);
  private readonly theme = inject(ThemeService);
  protected readonly fmt = fmt;
  protected readonly sortBy = signal<'volume' | 'otd' | 'revenue'>('volume');

  private readonly lanes = computed(() => this.logistics.snapshot().lanes.filter((l) => !this.mode() || l.mode === this.mode()));
  protected readonly top = computed(() => this.lanes().slice(0, 10));
  protected readonly maxVolume = computed(() => Math.max(1, ...this.top().map((l) => l.volume)));
  protected readonly rows = computed(() => {
    const list = [...this.lanes()];
    const by = this.sortBy();
    if (by === 'otd') list.sort((a, b) => (a.otd ?? 2) - (b.otd ?? 2));
    else if (by === 'revenue') list.sort((a, b) => b.revenue - a.revenue);
    return list.slice(0, 60);
  });

  protected color(m: string): string {
    return this.theme.series()[m as Mode];
  }
}
