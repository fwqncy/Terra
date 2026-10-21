import { Point } from './primitives/point.js';
import { Segment } from './primitives/segment.js';

/** An undirected road (or lane, or airway) network. */
export class Graph {
  /** @param {Point[]} points @param {Segment[]} segments */
  constructor(points = [], segments = []) {
    this.points = points;
    this.segments = segments;
  }

  static load(info) {
    const points = info.points.map((p) => new Point(p.x, p.y));
    const segments = info.segments.map(
      (s) => new Segment(points.find((p) => p.equals(s.p1)), points.find((p) => p.equals(s.p2)), s.oneWay),
    );
    return new Graph(points, segments);
  }

  /** Loads the compact flat-array format produced by tools/build-geodata.mjs. */
  static fromCompact({ points, segments }) {
    const pts = [];
    for (let i = 0; i < points.length; i += 2) pts.push(new Point(points[i], points[i + 1]));
    const segs = [];
    for (let i = 0; i < segments.length; i += 2) segs.push(new Segment(pts[segments[i]], pts[segments[i + 1]]));
    return new Graph(pts, segs);
  }

  toCompact() {
    const index = new Map(this.points.map((p, i) => [p, i]));
    return {
      points: this.points.flatMap((p) => [Math.round(p.x), Math.round(p.y)]),
      segments: this.segments.flatMap((s) => [index.get(s.p1), index.get(s.p2)]),
    };
  }

  hash() {
    return JSON.stringify(this.toCompact());
  }

  addPoint(point) {
    this.points.push(point);
  }

  containsPoint(point) {
    return this.points.find((p) => p.equals(point));
  }

  tryAddPoint(point) {
    if (!this.containsPoint(point)) {
      this.addPoint(point);
      return true;
    }
    return false;
  }

  removePoint(point) {
    for (const seg of this.getSegmentsWithPoint(point)) this.removeSegment(seg);
    this.points.splice(this.points.indexOf(point), 1);
  }

  addSegment(seg) {
    this.segments.push(seg);
  }

  containsSegment(seg) {
    return this.segments.find((s) => s.equals(seg));
  }

  tryAddSegment(seg) {
    if (!this.containsSegment(seg) && !seg.p1.equals(seg.p2)) {
      this.addSegment(seg);
      return true;
    }
    return false;
  }

  removeSegment(seg) {
    this.segments.splice(this.segments.indexOf(seg), 1);
  }

  getSegmentsWithPoint(point) {
    return this.segments.filter((s) => s.includes(point));
  }

  getNeighbours(point) {
    const out = [];
    for (const s of this.segments) {
      if (s.p1 === point) out.push(s.p2);
      else if (s.p2 === point) out.push(s.p1);
    }
    return out;
  }

  /** Dijkstra over the graph. Returns the list of points from start to end, or [] when unreachable. */
  getShortestPath(start, end) {
    if (!start || !end) return [];
    const dist = new Map(this.points.map((p) => [p, Infinity]));
    const prev = new Map();
    const adj = new Map(this.points.map((p) => [p, []]));
    for (const s of this.segments) {
      const len = s.length();
      adj.get(s.p1)?.push([s.p2, len]);
      if (!s.oneWay) adj.get(s.p2)?.push([s.p1, len]);
    }
    dist.set(start, 0);
    const open = new Set(this.points);
    while (open.size) {
      let cur = null;
      let best = Infinity;
      for (const p of open) {
        const d = dist.get(p);
        if (d < best) {
          best = d;
          cur = p;
        }
      }
      if (!cur || cur === end) break;
      open.delete(cur);
      for (const [nb, len] of adj.get(cur)) {
        const alt = best + len;
        if (alt < dist.get(nb)) {
          dist.set(nb, alt);
          prev.set(nb, cur);
        }
      }
    }
    if (dist.get(end) === Infinity) return [];
    const path = [end];
    let cur = end;
    while (prev.has(cur)) {
      cur = prev.get(cur);
      path.unshift(cur);
    }
    return path;
  }

  dispose() {
    this.points.length = 0;
    this.segments.length = 0;
  }

  draw(ctx, { color = '#000', width = 2, pointColor = '#000', pointSize = 18, ink = null } = {}) {
    for (const seg of this.segments) seg.draw(ctx, { color, width });
    for (const point of this.points) point.draw(ctx, { color: pointColor, size: pointSize, ink });
  }
}
