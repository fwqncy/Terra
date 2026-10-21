import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ApiService } from '../core/api.service';
import { formatCoins, isMac } from '../core/format';
import { GameService } from '../core/game.service';
import { ThemeService } from '../core/theme.service';
import { Icon } from '../shared/icon';

export const CHAPTERS = [
  { path: '/city', ch: 'Ch. 1', label: 'City', icon: 'road' },
  { path: '/routes', ch: 'Ch. 2', label: 'Routes', icon: 'routes' },
  { path: '/ops', ch: 'Ch. 3', label: 'Ops', icon: 'ops' },
  { path: '/dashboard', ch: 'Ch. 4', label: 'Dashboard', icon: 'chart' },
  { path: '/depot', ch: 'Bonus', label: 'Depot', icon: 'depot' },
];

@Component({
  selector: 'app-top-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon],
  template: `
    <header class="bar">
      <a class="brand" routerLink="/" aria-label="Terra home">
        <span class="mark" aria-hidden="true">T</span>
        <span class="word">Terra</span>
        <span class="issue" aria-hidden="true">No.&nbsp;01</span>
      </a>

      <nav class="chapters" aria-label="Chapters">
        @for (c of chapters; track c.path) {
          <a [routerLink]="c.path" routerLinkActive="is-active" [routerLinkActiveOptions]="{ exact: false }" ariaCurrentWhenActive="page">
            <span class="ch">{{ c.ch }}</span>{{ c.label }}
          </a>
        }
      </nav>

      <div class="tools">
        <a class="coins" routerLink="/depot" [class.frenzy]="game.frenzy()" [attr.aria-label]="'Coins: ' + coins() + '. Open the Depot'">
          <app-icon name="coin" [size]="18" />
          <span class="value">{{ coins() }}</span>
          <span class="rate">+{{ rate() }}/s</span>
          @if (gain(); as g) {
            <span class="gain" aria-hidden="true">+{{ g.text }}</span>
          }
        </a>
        <span class="api" [attr.data-status]="api.status()" [title]="apiTitle()">
          <span class="dot"></span><span class="api-label">{{ apiLabel() }}</span>
        </span>
        <button class="btn btn--ghost btn--icon cmd" type="button" (click)="openPalette.emit()" [attr.aria-label]="'Open command palette (' + shortcut + ')'" [title]="shortcut">
          <app-icon name="command" />
        </button>
        <button class="btn btn--ghost btn--icon" type="button" (click)="theme.toggleMode()" [attr.aria-label]="theme.mode() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
          <app-icon [name]="theme.mode() === 'dark' ? 'sun' : 'moon'" />
        </button>
        <a class="btn btn--ghost btn--icon" routerLink="/settings" aria-label="Settings"><app-icon name="settings" /></a>
        <button class="btn btn--ghost btn--icon menu" type="button" aria-label="Open menu" aria-haspopup="dialog" (click)="drawer.showModal()">
          <app-icon name="menu" />
        </button>
      </div>
    </header>

    <dialog #drawer class="drawer" aria-label="Menu" (click)="$event.target === drawer && drawer.close()">
      <nav class="drawer-nav" aria-label="Chapters">
        <button class="btn btn--ghost btn--icon close" type="button" aria-label="Close menu" (click)="drawer.close()"><app-icon name="x" /></button>
        <a routerLink="/" (click)="drawer.close()">Home</a>
        @for (c of chapters; track c.path) {
          <a [routerLink]="c.path" routerLinkActive="is-active" ariaCurrentWhenActive="page" (click)="drawer.close()">
            <app-icon [name]="c.icon" /> <span class="ch">{{ c.ch }}</span> {{ c.label }}
          </a>
        }
        <a routerLink="/settings" (click)="drawer.close()"><app-icon name="settings" /> Settings</a>
      </nav>
    </dialog>
  `,
  styleUrl: './top-bar.css',
})
export class TopBar {
  protected readonly game = inject(GameService);
  protected readonly api = inject(ApiService);
  protected readonly theme = inject(ThemeService);
  readonly openPalette = output<void>();
  protected readonly chapters = CHAPTERS;
  protected readonly shortcut = isMac() ? '⌘K' : 'Ctrl+K';

  protected readonly coins = computed(() => formatCoins(this.game.state().coins));
  protected readonly rate = computed(() => formatCoins(this.game.cps()));
  protected readonly gain = computed(() => {
    const g = this.game.lastGain();
    if (!g || this.game.now() - g.at > 900 || g.amount < 0.5) return null;
    return { text: formatCoins(g.amount), at: g.at };
  });
  protected readonly apiLabel = computed(() => ({ online: 'API', offline: 'Local', checking: 'API…' })[this.api.status()]);
  protected readonly apiTitle = computed(() =>
    this.api.status() === 'online'
      ? `Connected to the Terra API (SQL ${this.api.health()?.sql ? 'on' : 'off'}, NoSQL ${this.api.health()?.nosql ? 'on' : 'off'})`
      : 'Running locally in your browser. Start the API to sync saves, brains and logistics.',
  );
}
