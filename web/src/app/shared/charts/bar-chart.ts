import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { niceStep } from './line-chart';

export interface BarSeries {
  id: string;
  label: string;
  color: string;
  values: number[];
}

/**
 * Stacked column chart: columns ≤ 24px, 4px rounded data-end, 2px surface gaps between
 * segments, one baseline. Each column is a focusable hit target with a tooltip; table view included.
 */
@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      @if (series().length > 1) {
        <ul class="legend" aria-label="Legend">
          @for (s of series(); track s.id) {
            <li><span class="key key--rect" [style.background]="s.color"></span>{{ s.label }}</li>
          }
        </ul>
      }
      <button class="btn btn--ghost btn--sm table-toggle" type="button" [attr.aria-pressed]="showTable()" (click)="showTable.update((v) => !v)">
        {{ showTable() ? 'View chart' : 'View as table' }}
      </button>
    </div>
    @if (!showTable()) {
      <div class="plot" [style.height.px]="height()">
        <svg [attr.width]="w()" [attr.height]="height()" role="group" [attr.aria-label]="ariaLabel()">
          @for (t of yTicks(); track t.v) {
            <line class="grid" [attr.x1]="pad.l" [attr.x2]="w() - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" />
            <text class="tick" [attr.x]="pad.l - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
          }
          @for (col of columns(); track col.i) {
            <g
              class="col"
              tabindex="0"
              role="img"
              [attr.aria-label]="col.aria"
              [class.is-hover]="hover()?.i === col.i"
              (pointerenter)="hover.set(col)"
              (pointerleave)="hover.set(null)"
              (focus)="hover.set(col)"
              (blur)="hover.set(null)"
            >
              <rect class="hit" [attr.x]="col.hitX" [attr.y]="pad.t" [attr.width]="col.hitW" [attr.height]="y0() - pad.t" />
              @for (seg of col.segs; track seg.id) {
                <path [attr.d]="seg.d" [attr.fill]="seg.color" />
              }
            </g>
            @if (col.showLabel) {
              <text class="tick" [attr.x]="col.cx" [attr.y]="height() - 6" text-anchor="middle">{{ col.label }}</text>
            }
          }
          <line class="axis" [attr.x1]="pad.l" [attr.x2]="w() - pad.r" [attr.y1]="y0()" [attr.y2]="y0()" />
        </svg>
        @if (hover(); as h) {
          <div class="tip" role="status" [style.left.px]="h.cx > w() * 0.62 ? h.cx - 180 : h.cx + 16" [style.top.px]="pad.t">
            <div class="tip-title">{{ h.label }}</div>
            @for (r of h.rows; track r.id) {
              <div class="tip-row"><span class="tip-key tip-key--rect" [style.background]="r.color"></span><strong class="tabular">{{ r.value }}</strong><span>{{ r.label }}</span></div>
            }
            @if (series().length > 1) {
              <div class="tip-row total"><strong class="tabular">{{ yFormat()(h.total) }}</strong><span>Total</span></div>
            }
          </div>
        }
      </div>
    } @else {
      <div class="table-wrap" tabindex="0" role="region" [attr.aria-label]="ariaLabel() + ' (table)'" [style.max-height.px]="height() + 40">
        <table class="table">
          <caption class="sr-only">{{ ariaLabel() }}</caption>
          <thead><tr><th scope="col">{{ xTitle() }}</th>@for (s of series(); track s.id) {<th scope="col" class="num">{{ s.label }}</th>}</tr></thead>
          <tbody>
            @for (c of categories(); track $index; let i = $index) {
              <tr><th scope="row">{{ c }}</th>@for (s of series(); track s.id) {<td class="num">{{ yFormat()(s.values[i] ?? 0) }}</td>}</tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './charts.css',
})
export class BarChart {
  readonly series = input.required<BarSeries[]>();
  readonly categories = input.required<string[]>();
  readonly height = input(220);
  readonly yFormat = input<(n: number) => string>((n) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n));
  readonly ariaLabel = input('Bar chart');
  readonly xTitle = input('Category');

  protected readonly pad = { t: 12, r: 12, b: 26, l: 46 };
  protected readonly w = signal(600);
  protected readonly showTable = signal(false);
  protected readonly hover = signal<ReturnType<BarChart['columns']>[number] | null>(null);
  protected readonly y0 = computed(() => this.height() - this.pad.b);

  private readonly max = computed(() => {
    const n = this.categories().length;
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, this.series().reduce((s, x) => s + (x.values[i] ?? 0), 0));
    const step = niceStep(Math.max(1, m) / 4);
    return Math.ceil(Math.max(1, m) / step) * step;
  });

  private y(v: number): number {
    return this.pad.t + (1 - v / this.max()) * (this.height() - this.pad.t - this.pad.b);
  }

  protected readonly yTicks = computed(() =>
    Array.from({ length: 5 }, (_, i) => {
      const v = (this.max() / 4) * i;
      return { v, y: this.y(v), label: this.yFormat()(v) };
    }),
  );

  protected readonly columns = computed(() => {
    const cats = this.categories();
    const n = Math.max(1, cats.length);
    const band = (this.w() - this.pad.l - this.pad.r) / n;
    const bw = Math.max(3, Math.min(24, band * 0.62));
    const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(this.w() / 70))));
    return cats.map((label, i) => {
      const cx = this.pad.l + band * (i + 0.5);
      let acc = 0;
      const segs: { id: string; color: string; d: string }[] = [];
      const visible = this.series().filter((s) => (s.values[i] ?? 0) > 0);
      visible.forEach((s, k) => {
        const v = s.values[i] ?? 0;
        const yTop = this.y(acc + v);
        const yBot = this.y(acc) - (acc > 0 ? 2 : 0); // 2px surface gap between segments
        acc += v;
        const h = Math.max(0, yBot - yTop);
        const isTop = k === visible.length - 1;
        segs.push({ id: s.id, color: s.color, d: rectPath(cx - bw / 2, yTop, bw, h, isTop ? Math.min(4, h) : 0) });
      });
      const rows = this.series().map((s) => ({ id: s.id, label: s.label, color: s.color, value: this.yFormat()(s.values[i] ?? 0) }));
      return {
        i,
        cx,
        label,
        segs,
        rows,
        total: acc,
        hitX: cx - band / 2,
        hitW: band,
        showLabel: i % labelEvery === 0,
        aria: `${label}: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`,
      };
    });
  });

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([e]) => this.w.set(Math.max(240, Math.floor(e.contentRect.width))));
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }
}

/** Rect with only the top corners rounded (data-end), square at the baseline. */
function rectPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
