import { Point } from './primitives/point.js';

/**
 * A polyline with cumulative arc length, used for progress (fitness) and
 * pure-pursuit steering targets for cars, ships and planes alike.
 */
export class Route {
  /** @param {{x:number,y:number}[]} points */
  constructor(points) {
    this.points = points.map((p) => new Point(p.x, p.y));
    this.cumulative = [0];
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.length = this.cumulative[this.cumulative.length - 1] ?? 0;
  }

  get start() {
    return this.points[0];
  }

  get end() {
    return this.points[this.points.length - 1];
  }

  /**
   * Projects a point onto the polyline, searching near a hint segment first.
   * @returns {{progress:number, distance:number, index:number, side?:number}}
   */
  project(p, hint = 0, window = 3) {
    const n = this.points.length;
    if (n < 2) return { progress: 0, distance: 0, index: 0 };
    const from = Math.max(0, hint - window);
    const to = Math.min(n - 2, hint + window);
    let best = { progress: 0, distance: Infinity, index: from };
    for (let i = from; i <= to; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < best.distance) {
        // side: + when the point is to the right of travel (screen coords, y down)
        const side = dx * (p.y - a.y) - dy * (p.x - a.x) > 0 ? 1 : -1;
        best = { progress: this.cumulative[i] + Math.sqrt(len2) * t, distance: d, index: i, side };
      }
    }
    return best;
  }

  /** Point at a given arc length along the route. */
  pointAt(s) {
    if (s <= 0) return this.points[0];
    if (s >= this.length) return this.end;
    let i = 1;
    while (i < this.cumulative.length && this.cumulative[i] < s) i++;
    const a = this.points[i - 1];
    const b = this.points[i];
    const t = (s - this.cumulative[i - 1]) / (this.cumulative[i] - this.cumulative[i - 1] || 1);
    return new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  draw(ctx, { color = '#fff', width = 4, dash = [] } = {}) {
    if (this.points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineJoin = 'round';
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (const p of this.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
