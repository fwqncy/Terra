import { getCircleIntersection, getIntersection, lerp } from '../math/utils.js';

const scratch = [];

/**
 * Ray sensors. Readings are 0 (nothing in range) .. 1 (touching), matching the
 * network input convention. Works for any agent with {x, y, angle}.
 */
export class Sensor {
  constructor({ rayCount = 5, rayLength = 150, raySpread = Math.PI / 2, rayOffset = 0 } = {}) {
    this.rayCount = rayCount;
    this.rayLength = rayLength;
    this.raySpread = raySpread;
    this.rayOffset = rayOffset;
    /** @type {{x:number,y:number}[][]} */
    this.rays = [];
    /** @type {({x:number,y:number,offset:number}|null)[]} */
    this.readings = [];
  }

  /**
   * @param {{x:number,y:number,angle:number}} agent
   * @param {{grid?: import('../math/segment-grid.js').SegmentGrid, segments?: any[], polygons?: {x:number,y:number}[][], circles?: {x:number,y:number,r:number}[]}} world
   */
  update(agent, world) {
    this.#castRays(agent);
    this.readings = this.rays.map((ray) => this.#getReading(ray, world));
  }

  values() {
    return this.readings.map((r) => (r ? 1 - r.offset : 0));
  }

  #getReading(ray, { grid, segments, polygons, circles }) {
    const [a, b] = ray;
    let best = null;
    const consider = (hit) => {
      if (hit && (!best || hit.offset < best.offset)) best = hit;
    };
    if (grid) {
      const cand = grid.query(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), scratch);
      for (const s of cand) consider(getIntersection(a, b, s.p1, s.p2));
    }
    if (segments) for (const s of segments) consider(getIntersection(a, b, s.p1, s.p2));
    if (polygons) {
      for (const poly of polygons) {
        for (let j = 0; j < poly.length; j++) consider(getIntersection(a, b, poly[j], poly[(j + 1) % poly.length]));
      }
    }
    if (circles) for (const c of circles) consider(getCircleIntersection(a, b, c, c.r));
    return best;
  }

  #castRays(agent) {
    this.rays = [];
    for (let i = 0; i < this.rayCount; i++) {
      const rayAngle =
        lerp(this.raySpread / 2, -this.raySpread / 2, this.rayCount === 1 ? 0.5 : i / (this.rayCount - 1)) +
        agent.angle +
        this.rayOffset;
      const start = { x: agent.x, y: agent.y };
      const end = { x: agent.x - Math.sin(rayAngle) * this.rayLength, y: agent.y - Math.cos(rayAngle) * this.rayLength };
      this.rays.push([start, end]);
    }
  }

  draw(ctx, { color = '#F2C14E', hitColor = '#111', width = 2 } = {}) {
    for (let i = 0; i < this.rays.length; i++) {
      const [start, end] = this.rays[i];
      const hit = this.readings[i] ?? end;
      ctx.beginPath();
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(hit.x, hit.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = hitColor;
      ctx.moveTo(hit.x, hit.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }
}
