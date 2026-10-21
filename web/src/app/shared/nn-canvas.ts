import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, viewChild } from '@angular/core';
import { drawNetwork } from '../../engine/render/visualizer.js';
import { ThemeService } from '../core/theme.service';

/** Live neural-network view of the leading agent (refreshes ~8×/s). */
@Component({
  selector: 'app-nn-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #cv role="img" [attr.aria-label]="label()"></canvas>`,
  styles: `:host { display: block; } canvas { width: 100%; height: 100%; display: block; }`,
})
export class NnCanvas {
  /** Returns the current network (or null). Polled so the parent never re-renders for it. */
  readonly source = input.required<() => unknown>();
  readonly labels = input<string[]>(['↑', '←', '→', '↓']);
  readonly label = input('Neural network of the leading car: sensor inputs at the bottom, steering outputs at the top');
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private readonly theme = inject(ThemeService);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.cv().nativeElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const draw = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
        if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const net = this.source()();
        if (net) drawNetwork(ctx, net, this.theme.palette(), { width: w, height: h, outputLabels: this.labels() });
      };
      const id = setInterval(draw, 125);
      draw();
      destroyRef.onDestroy(() => clearInterval(id));
    });
  }
}
