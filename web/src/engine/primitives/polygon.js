import { average, bboxOf, bboxOverlap, getIntersection } from '../math/utils.js';
import { Point } from './point.js';
import { Segment } from './segment.js';

export class Polygon {
  /** @param {Point[]} points */
  constructor(points) {
    this.points = points;
    this.segments = [];
    for (let i = 1; i <= points.length; i++) {
      this.segments.push(new Segment(points[i - 1], points[i % points.length]));
    }
    this.bbox = bboxOf(points);
  }

  static load(info) {
    return new Polygon(info.points.map((p) => new Point(p.x, p.y)));
  }

  /**
   * Union of many polygons, returned as the outline segments.
   * Bounding boxes prune the O(n^2) pair tests so real city graphs stay fast.
   * @param {Polygon[]} polys
   */
  static union(polys) {
    Polygon.multiBreak(polys);
    const kept = [];
    for (let i = 0; i < polys.length; i++) {
      for (const seg of polys[i].segments) {
        let keep = true;
        const mid = average(seg.p1, seg.p2);
        for (let j = 0; j < polys.length; j++) {
          if (i === j) continue;
          const b = polys[j].bbox;
          if (mid.x < b.minX || mid.x > b.maxX || mid.y < b.minY || mid.y > b.maxY) continue;
          if (polys[j].containsPoint(mid)) {
            keep = false;
            break;
          }
        }
        if (keep) kept.push(seg);
      }
    }
    return kept;
  }

  static multiBreak(polys) {
    for (let i = 0; i < polys.length - 1; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        if (bboxOverlap(polys[i].bbox, polys[j].bbox, 1)) Polygon.break(polys[i], polys[j]);
      }
    }
  }

  static break(poly1, poly2) {
    const segs1 = poly1.segments;
    const segs2 = poly2.segments;
    for (let i = 0; i < segs1.length; i++) {
      for (let j = 0; j < segs2.length; j++) {
        const int = getIntersection(segs1[i].p1, segs1[i].p2, segs2[j].p1, segs2[j].p2);
        if (int && int.offset !== 1 && int.offset !== 0) {
          const point = new Point(int.x, int.y);
          let aux = segs1[i].p2;
          segs1[i].p2 = point;
          segs1.splice(i + 1, 0, new Segment(point, aux));
          aux = segs2[j].p2;
          segs2[j].p2 = point;
          segs2.splice(j + 1, 0, new Segment(point, aux));
        }
      }
    }
  }

  distanceToPoint(point) {
    return Math.min(...this.segments.map((s) => s.distanceToPoint(point)));
  }

  distanceToPoly(poly) {
    return Math.min(...this.points.map((p) => poly.distanceToPoint(p)));
  }

  intersectsPoly(poly) {
    if (!bboxOverlap(this.bbox, poly.bbox)) return false;
    for (const s1 of this.segments) {
      for (const s2 of poly.segments) {
        if (getIntersection(s1.p1, s1.p2, s2.p1, s2.p2)) return true;
      }
    }
    return false;
  }

  containsSegment(seg) {
    return this.containsPoint(average(seg.p1, seg.p2));
  }

  /** Even-odd ray casting. */
  containsPoint(point) {
    let inside = false;
    for (const seg of this.segments) {
      const a = seg.p1;
      const b = seg.p2;
      if (a.y > point.y !== b.y > point.y) {
        const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
        if (point.x < x) inside = !inside;
      }
    }
    return inside;
  }

  drawSegments(ctx) {
    for (const seg of this.segments) seg.draw(ctx, { color: '#f0f', width: 4 });
  }

  draw(ctx, { stroke = 'blue', lineWidth = 2, fill = 'rgba(0,0,255,0.3)', join = 'miter', dash = [] } = {}) {
    if (!this.points.length) return;
    ctx.beginPath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = join;
    ctx.setLineDash(dash);
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke && lineWidth > 0) ctx.stroke();
    ctx.lineJoin = 'miter';
    ctx.setLineDash([]);
  }
}
