import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * Line / (stacked) area chart in SVG. 2px lines, hairline grid, one y-axis,
 * crosshair tooltip on pointer AND keyboard (←/→), legend + end labels, and a table view.
 */
@Component({
  selector: 'app-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      @if (series().length > 1) {
        <ul class="legend" aria-label="Legend">
          @for (s of series(); track s.id) {
            <li><span class="key" [style.background]="s.color"></span>{{ s.label }}</li>
          }
        </ul>
      }
      <button class="btn btn--ghost btn--sm table-toggle" type="button" [attr.aria-pressed]="showTable()" (click)="showTable.update((v) => !v)">
        {{ showTable() ? 'View chart' : 'View as table' }}
      </button>
    </div>

    @if (!showTable()) {
      <div class="plot" [style.height.px]="height()">
        <svg
          [attr.width]="w()"
          [attr.height]="height()"
          role="img"
          [attr.aria-label]="ariaLabel()"
          tabindex="0"
          (pointermove)="onMove($event)"
          (pointerleave)="hover.set(null)"
          (keydown)="onKey($event)"
          (blur)="hover.set(null)"
        >
          @for (t of yTicks(); track t.v) {
            <line class="grid" [attr.x1]="pad.l" [attr.x2]="w() - pad.r" [attr.y1]="t.y" [attr.y2]="t.y" />
            <text class="tick" [attr.x]="pad.l - 8" [attr.y]="t.y + 4" text-anchor="end">{{ t.label }}</text>
          }
          <line class="axis" [attr.x1]="pad.l" [attr.x2]="w() - pad.r" [attr.y1]="y0()" [attr.y2]="y0()" />
          @for (t of xTicks(); track t.i) {
            <text class="tick" [attr.x]="t.x" [attr.y]="height() - 6" text-anchor="middle">{{ t.label }}</text>
          }
          @for (p of paths(); track p.id) {
            @if (area()) {
              <path [attr.d]="p.area" [attr.fill]="p.color" fill-opacity="0.12" stroke="none" />
            }
            <path [attr.d]="p.line" fill="none" [attr.stroke]="p.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            @if (p.end) {
              <circle [attr.cx]="p.end.x" [attr.cy]="p.end.y" r="4" [attr.fill]="p.color" class="ring" />
            }
          }
          @if (hover(); as h) {
            <line class="cross" [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="pad.t" [attr.y2]="y0()" />
            @for (d of h.dots; track d.id) {
              <circle [attr.cx]="h.x" [attr.cy]="d.y" r="4" [attr.fill]="d.color" class="ring" />
            }
          }
        </svg>
        @if (hover(); as h) {
          <div class="tip" role="status" [style.left.px]="h.tipX" [style.top.px]="pad.t">
            <div class="tip-title">{{ h.label }}</div>
            @for (d of h.rows; track d.id) {
              <div class="tip-row"><span class="tip-key" [style.background]="d.color"></span><strong class="tabular">{{ d.value }}</strong><span>{{ d.label }}</span></div>
            }
          </div>
        }
      </div>
    } @else {
      <div class="table-wrap" tabindex="0" role="region" [attr.aria-label]="ariaLabel() + ' (table)'" [style.max-height.px]="height() + 40">
        <table class="table">
          <caption class="sr-only">{{ ariaLabel() }}</caption>
          <thead>
            <tr><th scope="col">{{ xTitle() }}</th>@for (s of series(); track s.id) {<th scope="col" class="num">{{ s.label }}</th>}</tr>
          </thead>
          <tbody>
            @for (l of labels(); track $index; let i = $index) {
              <tr><th scope="row">{{ l }}</th>@for (s of series(); track s.id) {<td class="num">{{ fmtVal(s.values[i]) }}</td>}</tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styleUrl: './charts.css',
})
export class LineChart {
  readonly series = input.required<LineSeries[]>();
  readonly labels = input.required<string[]>();
  readonly height = input(220);
  readonly area = input(false);
  readonly stacked = input(false);
  readonly yFormat = input<(n: number) => string>((n) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n));
  readonly ariaLabel = input('Line chart');
  readonly xTitle = input('Time');
  readonly yMin = input<number | null>(0);

  protected readonly pad = { t: 12, r: 16, b: 26, l: 46 };
  protected readonly w = signal(600);
  protected readonly showTable = signal(false);
  protected readonly hover = signal<{ x: number; tipX: number; label: string; dots: { id: string; y: number; color: string }[]; rows: { id: string; label: string; value: string; color: string }[] } | null>(null);
  private idx = -1;

  /** Cumulative values when stacked; raw otherwise. */
  private readonly layers = computed(() => {
    const s = this.series();
    if (!this.stacked()) return s.map((x) => ({ ...x, top: x.values, base: x.values.map(() => 0) }));
    const n = this.labels().length;
    const acc = new Array(n).fill(0);
    return s.map((x) => {
      const base = acc.slice();
      const top = x.values.map((v, i) => (acc[i] += v ?? 0));
      return { ...x, top, base };
    });
  });

  private readonly domain = computed(() => {
    let max = -Infinity;
    let min = Infinity;
    for (const l of this.layers()) for (const v of l.top) if (v != null) (max = Math.max(max, v)), (min = Math.min(min, v));
    if (!Number.isFinite(max)) return [0, 1];
    const lo = this.yMin() ?? min;
    const hi = max === lo ? lo + 1 : max;
    const step = niceStep((hi - lo) / 4);
    return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
  });

  protected readonly y0 = computed(() => this.height() - this.pad.b);

  private x(i: number): number {
    const n = Math.max(1, this.labels().length - 1);
    return this.pad.l + (i / n) * (this.w() - this.pad.l - this.pad.r);
  }

  private y(v: number): number {
    const [lo, hi] = this.domain();
    return this.pad.t + (1 - (v - lo) / (hi - lo || 1)) * (this.height() - this.pad.t - this.pad.b);
  }

  protected readonly yTicks = computed(() => {
    const [lo, hi] = this.domain();
    const step = (hi - lo) / 4;
    return Array.from({ length: 5 }, (_, i) => {
      const v = lo + step * i;
      return { v, y: this.y(v), label: this.yFormat()(v) };
    });
  });

  protected readonly xTicks = computed(() => {
    const l = this.labels();
    const count = Math.min(l.length, Math.max(2, Math.floor(this.w() / 110)));
    const out: { i: number; x: number; label: string }[] = [];
    for (let k = 0; k < count; k++) {
      const i = Math.round((k / Math.max(1, count - 1)) * (l.length - 1));
      if (!out.some((o) => o.i === i)) out.push({ i, x: this.x(i), label: l[i] ?? '' });
    }
    return out;
  });

  protected readonly paths = computed(() =>
    this.layers().map((s) => {
      let line = '';
      let started = false;
      let end: { x: number; y: number } | null = null;
      for (let i = 0; i < s.top.length; i++) {
        const v = s.top[i];
        if (v == null) {
          started = false;
          continue;
        }
        const px = this.x(i);
        const py = this.y(v);
        line += `${started ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
        started = true;
        end = { x: px, y: py };
      }
      let area = '';
      if (this.area() && s.top.length) {
        const pts = s.top.map((v, i) => `${this.x(i).toFixed(1)},${this.y(v ?? 0).toFixed(1)}`);
        const basePts = s.base.map((v, i) => `${this.x(i).toFixed(1)},${this.y(v ?? 0).toFixed(1)}`).reverse();
        area = `M${pts.join('L')}L${basePts.join('L')}Z`;
      }
      return { id: s.id, color: s.color, line, area, end };
    }),
  );

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([e]) => this.w.set(Math.max(240, Math.floor(e.contentRect.width))));
      ro.observe(el);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  protected fmtVal(v: number | null | undefined): string {
    return v == null ? '—' : this.yFormat()(v);
  }

  protected onMove(e: PointerEvent): void {
    const svg = e.currentTarget as SVGElement;
    const rect = svg.getBoundingClientRect();
    const n = this.labels().length;
    if (!n) return;
    const t = (e.clientX - rect.left - this.pad.l) / (this.w() - this.pad.l - this.pad.r);
    this.show(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  }

  protected onKey(e: KeyboardEvent): void {
    const n = this.labels().length;
    if (!n) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const start = this.idx < 0 ? n - 1 : this.idx;
      this.show(Math.max(0, Math.min(n - 1, start + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') {
      this.hover.set(null);
    }
  }

  private show(i: number): void {
    this.idx = i;
    const x = this.x(i);
    const layers = this.layers();
    this.hover.set({
      x,
      tipX: x > this.w() * 0.62 ? x - 180 : x + 12,
      label: this.labels()[i] ?? '',
      dots: layers.filter((s) => s.top[i] != null).map((s) => ({ id: s.id, y: this.y(s.top[i] as number), color: s.color })),
      rows: this.series().map((s) => ({ id: s.id, label: s.label, color: s.color, value: this.fmtVal(s.values[i]) })),
    });
  }
}

export function niceStep(raw: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
