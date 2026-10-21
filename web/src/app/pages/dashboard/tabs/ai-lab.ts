import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ACHIEVEMENTS } from '../../../../engine/idle/economy.js';
import { ApiService, LeaderRow } from '../../../core/api.service';
import { BrainStore } from '../../../core/brain-store.service';
import { fmt, formatCoins } from '../../../core/format';
import { GameService } from '../../../core/game.service';
import { ThemeService } from '../../../core/theme.service';
import { BarChart } from '../../../shared/charts/bar-chart';
import { Icon } from '../../../shared/icon';
import { KpiTile } from '../../../shared/kpi-tile';

@Component({
  selector: 'app-ai-lab-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, KpiTile, BarChart],
  template: `
    <div class="tiles">
      <app-kpi-tile class="hero-tile" [hero]="true" label="AI deliveries" [value]="fmt.whole(game.deliveries())" />
      <app-kpi-tile label="Generations trained" [value]="fmt.whole(st().stats.generations)" />
      <app-kpi-tile label="Crashes survived" [value]="fmt.whole(st().stats.crashes)" />
      <app-kpi-tile label="Roads built" [value]="fmt.whole(st().stats.segmentsBuilt)" />
      <app-kpi-tile label="Destinations reached" [value]="fmt.whole(st().stats.destinations.length)" />
    </div>

    <div class="grid" style="margin-top: 14px">
      <section class="card c5" aria-labelledby="del-title">
        <h2 id="del-title">Deliveries by mode</h2>
        <app-bar-chart [series]="deliverySeries()" [categories]="['Road', 'Air', 'Sea']" [height]="200" xTitle="Mode" ariaLabel="AI deliveries by mode" [yFormat]="whole" />
      </section>

      <section class="card c7" aria-labelledby="brains-title">
        <h2 id="brains-title">Brain library <span class="sub">{{ brains.brains().length }} saved · {{ api.online() ? 'synced to NoSQL' : 'local only' }}</span></h2>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Brain library table" style="max-height: 300px">
          <table class="table">
            <caption class="sr-only">Saved neural networks</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Domain</th><th scope="col" class="num">Generation</th><th scope="col" class="num">Fitness</th><th scope="col">Saved</th></tr></thead>
            <tbody>
              @for (b of brains.brains(); track b.id) {
                <tr>
                  <th scope="row" class="plain">{{ b.name }}</th>
                  <td>{{ b.domain }}</td>
                  <td class="num">{{ b.generation }}</td>
                  <td class="num">{{ fmt.compact(b.fitness) }}</td>
                  <td class="tabular">{{ fmt.date(b.savedAt) }}@if (b.remote) {<span class="badge" style="margin-left: 6px">cloud</span>}</td>
                </tr>
              } @empty {
                <tr><td colspan="5"><div class="empty"><strong>No saved brains yet.</strong><a class="btn btn--sm" routerLink="/city" [queryParams]="{ mode: 'train' }">Train One</a></div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card c6" aria-labelledby="lb-title">
        <h2 id="lb-title"><app-icon name="trophy" />Leaderboard <span class="sub">{{ board().source }}</span></h2>
        <ol class="board">
          @for (r of board().rows; track r.rank) {
            <li [class.me]="r.name === api.playerName()">
              <span class="rank tabular">{{ r.rank }}</span>
              <span class="who">{{ r.name }}</span>
              <span class="tabular">{{ formatCoins(r.lifetime) }}</span>
              <span class="subtle tabular">{{ fmt.whole(r.deliveries) }} deliveries</span>
            </li>
          }
        </ol>
        @if (!api.online()) {
          <p class="muted-small">Start the .NET API to compete on the shared SQL Server leaderboard (also shown on the WordPress site via the Terra plugin).</p>
        }
      </section>

      <section class="card c6" aria-labelledby="ach-title">
        <h2 id="ach-title">Achievements <span class="sub">{{ st().achievements.length }}/{{ achievements.length }} · +{{ st().achievements.length }}% earnings</span></h2>
        <ul class="achievements">
          @for (a of achievements; track a.id) {
            <li [class.got]="st().achievements.includes(a.id)">
              <app-icon [name]="st().achievements.includes(a.id) ? 'trophy' : 'lock'" />
              <span><strong>{{ a.name }}</strong><small>{{ a.blurb }}</small></span>
            </li>
          }
        </ul>
      </section>
    </div>
  `,
  styleUrl: './tab.css',
  styles: `
    .plain { position: static; background: none; color: var(--text); font-size: 14px; text-transform: none; letter-spacing: 0; font-weight: 700; }
    .board { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .board li { display: grid; grid-template-columns: 32px 1fr auto auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: var(--r-2); background: var(--bg-raised); border: 1.5px solid var(--border); font-size: 14px; }
    .board li.me { background: var(--highlight); color: var(--on-highlight); border-color: var(--ink-line); }
    .board li.me .subtle { color: inherit; opacity: 0.75; }
    .rank { font-weight: 900; font-size: 18px; }
    .who { font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .achievements { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 0; padding: 0; list-style: none; }
    .achievements li { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: var(--r-2); border: 1.5px dashed var(--border-strong); color: var(--text-3); }
    .achievements li.got { border-style: solid; color: var(--text); background: var(--bg-raised); }
    .achievements strong { display: block; font-size: 14px; }
    .achievements small { font-size: 12px; }
    @media (max-width: 640px) { .achievements { grid-template-columns: 1fr; } }
  `,
})
export class AiLabTab {
  protected readonly game = inject(GameService);
  protected readonly brains = inject(BrainStore);
  protected readonly api = inject(ApiService);
  private readonly theme = inject(ThemeService);
  protected readonly fmt = fmt;
  protected readonly formatCoins = formatCoins;
  protected readonly whole = (n: number) => fmt.whole(n);
  protected readonly achievements = ACHIEVEMENTS;
  protected readonly st = this.game.state;
  private readonly remote = signal<LeaderRow[] | null>(null);

  protected readonly deliverySeries = computed(() => {
    const d = this.st().stats.deliveries;
    const s = this.theme.series();
    // one series, coloured per bar would re-encode the category; keep slot 1 and label the axis
    return [{ id: 'deliveries', label: 'Deliveries', color: s.road, values: [d.road, d.air, d.sea] }];
  });

  protected readonly board = computed(() => {
    const remote = this.remote();
    if (remote?.length) return { source: 'SQL Server · all players', rows: remote };
    const s = this.st();
    return { source: 'This browser', rows: [{ rank: 1, name: this.api.playerName(), lifetime: s.lifetimeAllTime, deliveries: this.game.deliveries(), tokens: s.tokens }] };
  });

  constructor() {
    if (this.api.online()) {
      this.api
        .get<LeaderRow[]>('/leaderboard?take=10')
        .then((rows) => this.remote.set(rows))
        .catch(() => undefined);
    }
  }
}
