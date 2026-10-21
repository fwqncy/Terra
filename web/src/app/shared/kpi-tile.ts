import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from './icon';
import { Sparkline } from './charts/sparkline';

export type KpiStatus = 'good' | 'warning' | 'serious' | 'critical' | null;

/** Stat tile: label · value · optional signed delta (vs a named period) · optional trend · optional status (icon + label). */
@Component({
  selector: 'app-kpi-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Sparkline],
  template: `
    <div class="tile" [class.hero]="hero()">
      <div class="label">{{ label() }}</div>
      <div class="value">{{ value() }}</div>
      <div class="foot">
        @if (delta(); as d) {
          <span class="delta" [class.up]="d.dir === 'up'" [class.down]="d.dir === 'down'" [class.good]="d.good" [class.bad]="d.good === false">
            <app-icon [name]="d.dir === 'up' ? 'arrowRight' : d.dir === 'down' ? 'arrowRight' : 'minus'" [size]="13" [class.rot-up]="d.dir === 'up'" [class.rot-down]="d.dir === 'down'" />
            {{ d.text }}
          </span>
        }
        @if (note()) {
          <span class="note">{{ note() }}</span>
        }
        @if (status(); as s) {
          <span class="badge" [class]="'badge badge--' + s"><app-icon [name]="s === 'good' ? 'check' : 'alert'" />{{ statusLabel() }}</span>
        }
        @if (trend().length > 1) {
          <app-sparkline [values]="trend()" [width]="hero() ? 160 : 84" [height]="hero() ? 36 : 24" />
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .tile { display: grid; gap: 4px; height: 100%; padding: 14px 16px; border-radius: var(--r-3); background: var(--surface); border: 2px solid var(--border-strong); }
    [data-mode='light'] .tile { border-color: var(--ink-line); }
    .label { font-size: 13px; font-weight: 700; color: var(--text-2); }
    .value { font-size: 28px; font-weight: 850; letter-spacing: -0.01em; line-height: 1.1; }
    .hero .value { font-size: clamp(48px, 6vw, 72px); font-weight: 900; font-stretch: 80%; }
    .hero { box-shadow: var(--comic-shadow); background-image: radial-gradient(var(--dot) 1.2px, transparent 1.4px); background-size: 8px 8px; }
    .foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 26px; }
    .foot app-sparkline { margin-left: auto; }
    .delta { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 750; color: var(--text-2); }
    .delta.good { color: var(--status-good); }
    .note { font-size: 13px; font-weight: 650; color: var(--text-3); }
    .delta.bad { color: var(--status-critical); }
    .rot-up { transform: rotate(-45deg); }
    .rot-down { transform: rotate(45deg); }
  `,
})
export class KpiTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  /** e.g. { value: 0.023, text: '+2.3 pts vs prev. 24 h', upIsGood: true } */
  readonly change = input<{ value: number; text: string; upIsGood?: boolean } | null>(null);
  readonly trend = input<number[]>([]);
  readonly status = input<KpiStatus>(null);
  readonly statusText = input<string>('');
  readonly hero = input(false);
  /** Neutral context line (not a delta). */
  readonly note = input('');

  protected readonly delta = computed(() => {
    const c = this.change();
    if (!c) return null;
    const dir = Math.abs(c.value) < 1e-9 ? 'flat' : c.value > 0 ? 'up' : 'down';
    const good = dir === 'flat' || c.upIsGood === undefined ? null : (dir === 'up') === c.upIsGood;
    return { dir, good, text: c.text };
  });
  protected readonly statusLabel = computed(() => this.statusText() || ({ good: 'Healthy', warning: 'Watch', serious: 'At risk', critical: 'Critical' } as const)[this.status() ?? 'good']);
}
