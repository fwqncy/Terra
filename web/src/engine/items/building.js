import { average, getFake3dPoint } from '../math/utils.js';
import { Polygon } from '../primitives/polygon.js';
import { halftonePattern, mix } from '../render/comic.js';

/**
 * Home styles are cosmetics bought in the Depot. Each one changes the roof and shading.
 * @type {Record<string,{label:string, roof:'gable'|'flat'|'tin'|'none', sideTone:number, halftone:boolean, glass?:boolean, stilts?:boolean}>}
 */
export const HOME_STYLES = {
  queenslander: { label: 'Queenslander', roof: 'tin', sideTone: 0.15, halftone: true, stilts: true },
  terrace: { label: 'Gable Terrace', roof: 'gable', sideTone: 0.25, halftone: true },
  brutalist: { label: 'Brutalist Block', roof: 'flat', sideTone: 0.55, halftone: false },
  glass: { label: 'Glass Tower', roof: 'flat', sideTone: 0.1, halftone: false, glass: true },
  pop: { label: 'Halftone Pop', roof: 'gable', sideTone: 0.35, halftone: true },
};

export class Building {
  /** @param {Polygon} poly @param {number} height */
  constructor(poly, height = 200) {
    this.base = poly;
    this.height = height;
  }

  static load(info) {
    return new Building(Polygon.load(info.base), info.height);
  }

  toJSON() {
    return { base: { points: this.base.points.map((p) => ({ x: p.x, y: p.y })) }, height: this.height };
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number}} viewPoint
   * @param {import('../render/comic.js').Palette} palette
   * @param {keyof typeof HOME_STYLES} styleKey
   */
  draw(ctx, viewPoint, palette, styleKey = 'queenslander') {
    const style = HOME_STYLES[styleKey] ?? HOME_STYLES.queenslander;
    const pts = this.base.points;
    const h = style.roof === 'flat' ? this.height * 1.1 : this.height * 0.6;
    const top = pts.map((p) => getFake3dPoint(p, viewPoint, h));
    const ceiling = new Polygon(top);
    const sides = [];
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const side = new Polygon([pts[i], pts[j], top[j], top[i]]);
      // simple lambert against a light from the north-west
      const nx = pts[j].y - pts[i].y;
      const ny = -(pts[j].x - pts[i].x);
      const len = Math.hypot(nx, ny) || 1;
      side.lit = (nx / len) * -0.6 + (ny / len) * -0.8 > 0;
      sides.push(side);
    }
    sides.sort((a, b) => b.distanceToPoint(viewPoint) - a.distanceToPoint(viewPoint));

    const ink = palette.mode === 'dark' ? '#0c0a08' : palette.ink;
    const litFill = style.glass ? mix(palette.primary, palette.light, 0.25) : mix(palette.light, palette.accent, style.sideTone);
    const shadeFill = style.glass ? mix(palette.primary, palette.ink, 0.35) : mix(palette.accent, palette.deep, 0.35 + style.sideTone * 0.5);

    // ground shadow
    this.base.draw(ctx, { fill: 'rgba(0,0,0,0.28)', stroke: 'rgba(0,0,0,0.18)', lineWidth: 18 });
    for (const side of sides) {
      side.draw(ctx, { fill: side.lit ? litFill : shadeFill, stroke: ink, lineWidth: 3, join: 'round' });
      if (!side.lit && style.halftone && palette.halftone) {
        side.draw(ctx, { fill: halftonePattern(ctx, 'rgba(0,0,0,0.35)', { spacing: 7, radius: 1.5 }), stroke: '', lineWidth: 0 });
      }
      if (style.glass) this.#glassStripes(ctx, side, palette);
    }

    if (style.roof === 'flat' || style.roof === 'none') {
      ceiling.draw(ctx, { fill: style.glass ? mix(palette.primary, palette.light, 0.5) : mix(palette.light, palette.deep, 0.12), stroke: ink, lineWidth: 3 });
      if (style.roof === 'flat') {
        // rooftop plant room
        const c = average(average(top[0], top[1]), average(top[2], top[3]));
        ctx.fillStyle = mix(palette.deep, palette.ink, 0.3);
        ctx.fillRect(c.x - 12, c.y - 12, 24, 24);
      }
      return;
    }

    ceiling.draw(ctx, { fill: litFill, stroke: ink, lineWidth: 3 });
    const baseMid = [average(pts[0], pts[1]), average(pts[2], pts[3])];
    const topMid = baseMid.map((p) => getFake3dPoint(p, viewPoint, this.height));
    const roofs = [
      new Polygon([ceiling.points[0], ceiling.points[3], topMid[1], topMid[0]]),
      new Polygon([ceiling.points[2], ceiling.points[1], topMid[0], topMid[1]]),
    ];
    roofs.sort((a, b) => b.distanceToPoint(viewPoint) - a.distanceToPoint(viewPoint));
    const roofColor = style.roof === 'tin' ? mix(palette.light, '#9aa3a8', 0.55) : palette.danger;
    for (const roof of roofs) {
      roof.draw(ctx, { fill: roofColor, stroke: ink, lineWidth: 3, join: 'round' });
      if (style.roof === 'tin') this.#corrugate(ctx, roof, ink);
      if (styleKey === 'pop' && palette.halftone) {
        roof.draw(ctx, { fill: halftonePattern(ctx, 'rgba(255,255,255,0.45)', { spacing: 6, radius: 1.4 }), stroke: '', lineWidth: 0 });
      }
    }
  }

  #corrugate(ctx, roof, ink) {
    const [a, b, c, d] = roof.points;
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let t = 0.15; t < 1; t += 0.17) {
      ctx.moveTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      ctx.lineTo(d.x + (c.x - d.x) * t, d.y + (c.y - d.y) * t);
    }
    ctx.stroke();
    ctx.restore();
  }

  #glassStripes(ctx, side, palette) {
    const [a, b, c, d] = side.points;
    ctx.save();
    ctx.strokeStyle = palette.light;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let t = 0.2; t < 1; t += 0.2) {
      ctx.moveTo(a.x + (d.x - a.x) * t, a.y + (d.y - a.y) * t);
      ctx.lineTo(b.x + (c.x - b.x) * t, b.y + (c.y - b.y) * t);
    }
    ctx.stroke();
    ctx.restore();
  }
}
