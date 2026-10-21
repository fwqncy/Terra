import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** 12-ish point trend line for stat tiles: de-emphasised history, accented current point. */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + width() + ' ' + height()" [attr.width]="width()" [attr.height]="height()" aria-hidden="true">
      <path [attr.d]="path()" fill="none" stroke="var(--text-3)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      @if (last(); as l) {
        <circle [attr.cx]="l.x" [attr.cy]="l.y" r="3" [attr.fill]="color()" stroke="var(--surface)" stroke-width="2" />
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; }`,
})
export class Sparkline {
  readonly values = input.required<number[]>();
  readonly width = input(96);
  readonly height = input(28);
  readonly color = input('var(--highlight)');

  private readonly pts = computed(() => {
    const v = this.values();
    if (v.length < 2) return [];
    const min = Math.min(...v);
    const max = Math.max(...v);
    const span = max - min || 1;
    return v.map((y, i) => ({ x: 3 + (i / (v.length - 1)) * (this.width() - 6), y: 3 + (1 - (y - min) / span) * (this.height() - 6) }));
  });
  protected readonly path = computed(() => this.pts().map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''));
  protected readonly last = computed(() => this.pts().at(-1) ?? null);
}
