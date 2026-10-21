import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, viewChild } from '@angular/core';
import { NeuralNetwork } from '../../engine/ai/network.js';
import { FACTORY_BRAINS } from '../../engine/data/brains.js';
import { MotorwaySim } from '../../engine/sim/motorway-sim.js';
import { ThemeService } from '../core/theme.service';

/** A tiny live motorway: the factory brain weaving through M1 traffic. Pauses off-screen. */
@Component({
  selector: 'app-mini-motorway',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #cv role="img" [attr.aria-label]="label()"></canvas>`,
  styles: `:host { display: block; position: relative; } canvas { width: 100%; height: 100%; }`,
})
export class MiniMotorway {
  readonly label = input('A self-driving ute overtaking traffic on the M1 motorway');
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private readonly theme = inject(ThemeService);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const canvas = this.cv().nativeElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const sim = new MotorwaySim({ populationSize: 8, mutation: 0.05, brain: NeuralNetwork.clone(FACTORY_BRAINS.motorway), seed: 3 });
      sim.start();
      let raf = 0;
      let visible = false;
      let time = 0;
      const frame = () => {
        raf = 0;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        const reduced = this.theme.reducedMotion();
        if (!reduced) {
          sim.step();
          sim.step();
        }
        time += 1 / 60;
        const leader = sim.leader();
        const scale = Math.min(1.1, w / 360);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = this.theme.palette().bg;
        ctx.fillRect(0, 0, w, h);
        ctx.translate(w / 2, h * 0.72);
        ctx.scale(scale, scale);
        ctx.translate(0, -(leader?.y ?? 0));
        const view = { minX: -400, maxX: 400, minY: (leader?.y ?? 0) - h / scale, maxY: (leader?.y ?? 0) + h / scale };
        sim.draw(ctx, this.theme.palette(), view, { time });
        if (visible && !reduced) raf = requestAnimationFrame(frame);
      };
      const io = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible && !raf) raf = requestAnimationFrame(frame);
      });
      io.observe(canvas);
      raf = requestAnimationFrame(frame);
      destroyRef.onDestroy(() => {
        io.disconnect();
        cancelAnimationFrame(raf);
        sim.stop();
      });
    });
  }
}
