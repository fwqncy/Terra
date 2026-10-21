import { Point } from '../primitives/point.js';

export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const degToRad = (d) => (d * Math.PI) / 180;

export function lerp2D(A, B, t) {
  return new Point(lerp(A.x, B.x, t), lerp(A.y, B.y, t));
}

export function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

export function average(p1, p2) {
  return new Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
}

export function dot(p1, p2) {
  return p1.x * p2.x + p1.y * p2.y;
}

export function add(p1, p2) {
  return new Point(p1.x + p2.x, p1.y + p2.y);
}

export function subtract(p1, p2) {
  return new Point(p1.x - p2.x, p1.y - p2.y);
}

export function scale(p, s) {
  return new Point(p.x * s, p.y * s);
}

export function magnitude(p) {
  return Math.hypot(p.x, p.y);
}

export function normalize(p) {
  const m = magnitude(p) || 1;
  return scale(p, 1 / m);
}

export function perpendicular(p) {
  return new Point(-p.y, p.x);
}

export function translate(loc, angle, offset) {
  return new Point(loc.x + Math.cos(angle) * offset, loc.y + Math.sin(angle) * offset);
}

export function angle(p) {
  return Math.atan2(p.y, p.x);
}

/** Wraps an angle into [-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Intersection of segments AB and CD.
 * @returns {{x:number,y:number,offset:number}|null} offset is the position along AB (0..1)
 */
export function getIntersection(A, B, C, D) {
  const tTop = (D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x);
  const uTop = (C.y - A.y) * (A.x - B.x) - (C.x - A.x) * (A.y - B.y);
  const bottom = (D.y - C.y) * (B.x - A.x) - (D.x - C.x) * (B.y - A.y);
  const eps = 1e-3;
  if (Math.abs(bottom) > eps) {
    const t = tTop / bottom;
    const u = uTop / bottom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t), offset: t };
    }
  }
  return null;
}

/** Ray-circle intersection; returns the nearest offset along AB (0..1) or null. */
export function getCircleIntersection(A, B, center, radius) {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const fx = A.x - center.x;
  const fy = A.y - center.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  const t2 = (-b + s) / (2 * a);
  const t = t1 >= 0 && t1 <= 1 ? t1 : t2 >= 0 && t2 <= 1 ? t2 : c <= 0 ? 0 : null;
  if (t === null) return null;
  return { x: A.x + dx * t, y: A.y + dy * t, offset: t };
}

export function polysIntersect(poly1, poly2) {
  for (let i = 0; i < poly1.length; i++) {
    for (let j = 0; j < poly2.length; j++) {
      if (getIntersection(poly1[i], poly1[(i + 1) % poly1.length], poly2[j], poly2[(j + 1) % poly2.length])) {
        return true;
      }
    }
  }
  return false;
}

export function getNearestPoint(loc, points, threshold = Number.MAX_SAFE_INTEGER) {
  let minDist = Number.MAX_SAFE_INTEGER;
  let nearest = null;
  for (const point of points) {
    const dist = distance(point, loc);
    if (dist < minDist && dist < threshold) {
      minDist = dist;
      nearest = point;
    }
  }
  return nearest;
}

export function getNearestSegment(loc, segments, threshold = Number.MAX_SAFE_INTEGER) {
  let minDist = Number.MAX_SAFE_INTEGER;
  let nearest = null;
  for (const seg of segments) {
    const dist = seg.distanceToPoint(loc);
    if (dist < minDist && dist < threshold) {
      minDist = dist;
      nearest = seg;
    }
  }
  return nearest;
}

/** Projects a point towards a viewpoint to fake a 3D height (used for buildings and trees). */
export function getFake3dPoint(point, viewPoint, height) {
  const dir = normalize(subtract(point, viewPoint));
  const dist = distance(point, viewPoint);
  const scaler = Math.atan(dist / 300) / (Math.PI / 2);
  return add(point, scale(dir, height * scaler));
}

export function bboxOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxOverlap(a, b, pad = 0) {
  return a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minY - pad <= b.maxY && a.maxY + pad >= b.minY;
}
