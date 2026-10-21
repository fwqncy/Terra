import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, viewChild } from '@angular/core';
import { Building } from '../../engine/items/building.js';
import { Point } from '../../engine/primitives/point.js';
import { Polygon } from '../../engine/primitives/polygon.js';
import { drawCarShape } from '../../engine/render/skins.js';
import { ThemeService } from '../core/theme.service';

/** Live canvas preview of a car skin or home style, drawn by the same engine code as the sim. */
@Component({
  selector: 'app-item-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #cv aria-hidden="true"></canvas>`,
  styles: `:host { display: block; } canvas { width: 100%; height: 100%; display: block; }`,
})
export class ItemPreview {
  readonly kind = input.required<'skin' | 'home'>();
  readonly item = input.required<string>();
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private readonly theme = inject(ThemeService);
  private ready = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.ready = true;
      this.draw(0);
      // holo foil shimmers; everything else is static
      let raf = 0;
      const loop = (t: number) => {
        if (this.item() === 'holo') this.draw(t / 1000);
        raf = requestAnimationFrame(loop);
      };
      if (!this.theme.reducedMotion()) raf = requestAnimationFrame(loop);
      destroyRef.onDestroy(() => cancelAnimationFrame(raf));
    });
    effect(() => {
      this.theme.palette();
      this.item();
      if (this.ready) this.draw(0);
    });
  }

  private draw(time: number): void {
    const canvas = this.cv().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 120;
    const h = canvas.clientHeight || 90;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const palette = this.theme.palette();
    if (this.kind() === 'skin') {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 2.4);
      const s = Math.min(w, h) / 70;
      ctx.scale(s, s);
      drawCarShape(ctx, 30, 50, this.item(), palette, { time });
    } else {
      const base = new Polygon([new Point(-40, -26), new Point(40, -26), new Point(40, 26), new Point(-40, 26)]);
      const b = new Building(base, 120);
      ctx.translate(w / 2, h * 0.62);
      const s = Math.min(w / 140, h / 120);
      ctx.scale(s, s);
      b.draw(ctx, new Point(-70, 140), palette, this.item());
    }
  }
}
