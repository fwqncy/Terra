import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Point } from '../primitives/point.js';
import { Segment } from '../primitives/segment.js';
import { Polygon } from '../primitives/polygon.js';
import { Envelope } from '../primitives/envelope.js';
import { Graph } from '../graph.js';
import { getIntersection, getCircleIntersection, wrapAngle } from '../math/utils.js';
import { SegmentGrid } from '../math/segment-grid.js';
import { Route } from '../route.js';

test('segments intersect at the expected point', () => {
  const hit = getIntersection(new Point(0, 0), new Point(10, 10), new Point(0, 10), new Point(10, 0));
  assert.ok(hit);
  assert.equal(Math.round(hit.x), 5);
  assert.equal(Math.round(hit.y), 5);
  assert.equal(getIntersection(new Point(0, 0), new Point(1, 0), new Point(0, 1), new Point(1, 1)), null);
});

test('ray-circle intersection returns nearest offset', () => {
  const hit = getCircleIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 6, y: 0 }, 2);
  assert.ok(hit);
  assert.ok(Math.abs(hit.offset - 0.4) < 1e-9);
  assert.equal(getCircleIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }, 2), null);
});

test('wrapAngle keeps angles within ±π', () => {
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-3 * Math.PI) + Math.PI) < 1e-9);
});

test('polygon contains points with even-odd rule', () => {
  const sq = new Polygon([new Point(0, 0), new Point(10, 0), new Point(10, 10), new Point(0, 10)]);
  assert.equal(sq.containsPoint(new Point(5, 5)), true);
  assert.equal(sq.containsPoint(new Point(15, 5)), false);
});

test('union of two overlapping envelopes removes interior edges', () => {
  const a = new Envelope(new Segment(new Point(0, 0), new Point(100, 0)), 20, 4);
  const b = new Envelope(new Segment(new Point(50, -50), new Point(50, 50)), 20, 4);
  const outline = Polygon.union([a.poly, b.poly]);
  assert.ok(outline.length > 0);
  for (const seg of outline) {
    const mid = new Point((seg.p1.x + seg.p2.x) / 2, (seg.p1.y + seg.p2.y) / 2);
    // nothing on the outline is strictly inside the cross-shaped centre
    assert.ok(!(Math.abs(mid.x - 50) < 8 && Math.abs(mid.y) < 8));
  }
});

test('graph shortest path and point removal', () => {
  const p = [new Point(0, 0), new Point(100, 0), new Point(100, 100), new Point(0, 100)];
  const g = new Graph([...p], [new Segment(p[0], p[1]), new Segment(p[1], p[2]), new Segment(p[2], p[3]), new Segment(p[3], p[0])]);
  assert.deepEqual(g.getShortestPath(p[0], p[1]), [p[0], p[1]]);
  g.removePoint(p[1]);
  assert.deepEqual(g.getShortestPath(p[0], p[2]), [p[0], p[3], p[2]]);
  assert.equal(g.segments.length, 2);
  const round = Graph.fromCompact(g.toCompact());
  assert.equal(round.points.length, 3);
  assert.equal(round.segments.length, 2);
});

test('segment grid returns each candidate once', () => {
  const segs = [new Segment(new Point(0, 0), new Point(1000, 0)), new Segment(new Point(0, 500), new Point(0, 900))];
  const grid = new SegmentGrid(segs, 100);
  const hits = grid.query(-10, -10, 950, 10);
  assert.equal(hits.length, 1);
  assert.equal(grid.query(-10, -10, 10, 1000).length, 2);
});

test('route projects progress, side and point-at', () => {
  const r = new Route([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.equal(r.length, 200);
  const pr = r.project({ x: 50, y: 10 }, 0, 5);
  assert.equal(Math.round(pr.progress), 50);
  assert.equal(pr.side, 1);
  assert.deepEqual({ x: r.pointAt(150).x, y: r.pointAt(150).y }, { x: 100, y: 50 });
});
