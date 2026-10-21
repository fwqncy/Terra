import { createRng } from '../math/rng.js';
import { halftonePattern, withAlpha } from '../render/comic.js';

/**
 * Drifting storm cells (and the odd cyclone) that planes must route around.
 * Reset at the start of every generation so the elite brain faces the same sky.
 */
export class Weather {
  constructor({ seed = 11, count = 10, bounds = { minX: 200, maxX: 2200, minY: -1800, maxY: 1300 }, keepClear = [] } = {}) {
    this.seed = seed;
    this.count = count;
    this.bounds = bounds;
    this.keepClear = keepClear;
    this.reset();
  }

  reset() {
    const rng = createRng(this.seed);
    this.storms = [];
    let guard = 0;
    while (this.storms.length < this.count && guard++ < 500) {
      const cyclone = this.storms.length === 0;
      const r = cyclone ? rng.range(70, 95) : rng.range(25, 60);
      const x = rng.range(this.bounds.minX, this.bounds.maxX);
      const y = rng.range(this.bounds.minY, this.bounds.maxY);
      if (this.keepClear.some((p) => Math.hypot(p.x - x, p.y - y) < r + 90)) continue;
      this.storms.push({ x, y, r, base: r, vx: rng.range(-0.08, 0.08), vy: rng.range(-0.05, 0.12), phase: rng.range(0, 6.28), cyclone });
    }
    this.frame = 0;
  }

  step() {
    this.frame++;
    for (const s of this.storms) {
      s.x += s.vx;
      s.y += s.vy;
      s.r = s.base * (1 + 0.08 * Math.sin(this.frame / 90 + s.phase));
    }
  }

  draw(ctx, palette, px, time = 0) {
    for (const s of this.storms) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(palette.deep, 0.55);
      ctx.fill();
      if (palette.halftone) {
        ctx.fillStyle = halftonePattern(ctx, 'rgba(255,255,255,0.18)', { spacing: 8, radius: 1.6 });
        ctx.fill();
      }
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 5 * px]);
      ctx.strokeStyle = withAlpha(palette.light, 0.8);
      ctx.stroke();
      ctx.setLineDash([]);
      // spiral arms
      ctx.translate(s.x, s.y);
      ctx.rotate(time * (s.cyclone ? -0.8 : -0.35) + s.phase);
      ctx.strokeStyle = withAlpha(palette.light, 0.55);
      ctx.lineWidth = (s.cyclone ? 3 : 2) * px;
      for (let arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        for (let t = 0; t < 1; t += 0.05) {
          const a = arm * ((Math.PI * 2) / 3) + t * 3.2;
          const rr = s.r * 0.15 + t * s.r * 0.75;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.stroke();
      }
      ctx.rotate(-(time * (s.cyclone ? -0.8 : -0.35) + s.phase));
      // lightning bolt glyph
      ctx.scale(px, px);
      ctx.fillStyle = palette.warn;
      ctx.strokeStyle = '#0c0a08';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, -12);
      ctx.lineTo(5, -12);
      ctx.lineTo(1, -2);
      ctx.lineTo(7, -2);
      ctx.lineTo(-5, 13);
      ctx.lineTo(-1, 1);
      ctx.lineTo(-7, 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (s.cyclone) {
        ctx.font = '900 13px "Archivo", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = palette.light;
        ctx.fillText('CYCLONE', 0, 30);
      }
      ctx.restore();
    }
  }
}
