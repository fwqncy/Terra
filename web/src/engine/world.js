import { Graph } from './graph.js';
import { Building } from './items/building.js';
import { Tree } from './items/tree.js';
import { Light, Start, Target, loadMarking } from './markings/markings.js';
import { createRng } from './math/rng.js';
import { add, distance, getNearestPoint, getNearestSegment, lerp, lerp2D, normalize, scale, subtract } from './math/utils.js';
import { SegmentGrid } from './math/segment-grid.js';
import { Envelope } from './primitives/envelope.js';
import { Point } from './primitives/point.js';
import { Polygon } from './primitives/polygon.js';
import { Segment } from './primitives/segment.js';
import { mix, withAlpha } from './render/comic.js';
import { Route } from './route.js';

export const WORLD_DEFAULTS = {
  roadWidth: 100,
  roadRoundness: 8,
  buildingWidth: 150,
  buildingMinLength: 150,
  spacing: 50,
  treeSize: 160,
  maxTrees: 420,
  seed: 7,
};

/** Coarse bucket grid for polygons (tree placement checks). */
class PolyGrid {
  constructor(polys, cell = 400) {
    this.cell = cell;
    this.map = new Map();
    polys.forEach((poly) => {
      const b = poly.bbox;
      for (let x = Math.floor(b.minX / cell); x <= Math.floor(b.maxX / cell); x++) {
        for (let y = Math.floor(b.minY / cell); y <= Math.floor(b.maxY / cell); y++) {
          const k = `${x},${y}`;
          if (!this.map.has(k)) this.map.set(k, []);
          this.map.get(k).push(poly);
        }
      }
    });
  }

  near(p, radius) {
    const out = new Set();
    const c = this.cell;
    for (let x = Math.floor((p.x - radius) / c); x <= Math.floor((p.x + radius) / c); x++) {
      for (let y = Math.floor((p.y - radius) / c); y <= Math.floor((p.y + radius) / c); y++) {
        for (const poly of this.map.get(`${x},${y}`) ?? []) out.add(poly);
      }
    }
    return out;
  }
}

export class World {
  /** @param {Graph} graph */
  constructor(graph, settings = {}) {
    this.graph = graph;
    this.settings = { ...WORLD_DEFAULTS, ...settings };
    /** @type {Envelope[]} */
    this.envelopes = [];
    /** @type {Segment[]} */
    this.roadBorders = [];
    /** @type {Building[]} */
    this.buildings = [];
    /** @type {Tree[]} */
    this.trees = [];
    /** @type {Segment[]} */
    this.laneGuides = [];
    /** @type {import('./markings/markings.js').Marking[]} */
    this.markings = [];
    this.frameCount = 0;
    this.borderGrid = new SegmentGrid([], 300);
    this.lightGroups = null;
    this.itemCache = null;
  }

  get roadWidth() {
    return this.settings.roadWidth;
  }

  generate() {
    const s = this.settings;
    this.envelopes = this.graph.segments.map((seg) => new Envelope(seg, s.roadWidth, s.roadRoundness));
    this.roadBorders = Polygon.union(this.envelopes.map((e) => e.poly));
    this.buildings = this.#generateBuildings();
    this.trees = this.#generateTrees();
    this.laneGuides = this.#generateLaneGuides();
    this.#index();
    return this;
  }

  #index() {
    this.borderGrid = new SegmentGrid(this.roadBorders, 300);
    this.itemCache = null;
    this.lightGroups = null;
  }

  /** Serializable geometry produced by `generate()` (sent back from the web worker). */
  exportGeometry() {
    const flatSegs = (segs) => segs.flatMap((s) => [s.p1.x, s.p1.y, s.p2.x, s.p2.y]);
    return {
      envelopes: this.envelopes.map((e) => e.poly.points.flatMap((p) => [p.x, p.y])),
      roadBorders: flatSegs(this.roadBorders),
      laneGuides: flatSegs(this.laneGuides),
      buildings: this.buildings.map((b) => ({ p: b.base.points.flatMap((p) => [p.x, p.y]), h: b.height })),
      trees: this.trees.map((t) => [t.center.x, t.center.y, t.size, t.height]),
    };
  }

  importGeometry(geo) {
    const toPts = (flat) => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push(new Point(flat[i], flat[i + 1]));
      return pts;
    };
    const toSegs = (flat) => {
      const segs = [];
      for (let i = 0; i < flat.length; i += 4) segs.push(new Segment(new Point(flat[i], flat[i + 1]), new Point(flat[i + 2], flat[i + 3])));
      return segs;
    };
    this.envelopes = geo.envelopes.map((flat) => ({ poly: new Polygon(toPts(flat)) }));
    this.roadBorders = toSegs(geo.roadBorders);
    this.laneGuides = toSegs(geo.laneGuides);
    this.buildings = geo.buildings.map((b) => new Building(new Polygon(toPts(b.p)), b.h));
    this.trees = geo.trees.map(([x, y, size, h]) => new Tree(new Point(x, y), size, h));
    this.#index();
    return this;
  }

  #generateLaneGuides() {
    const s = this.settings;
    const tmp = this.graph.segments.map((seg) => new Envelope(seg, s.roadWidth / 2, s.roadRoundness));
    return Polygon.union(tmp.map((e) => e.poly));
  }

  #generateBuildings() {
    const s = this.settings;
    const rng = createRng(s.seed);
    const tmp = this.graph.segments.map((seg) => new Envelope(seg, s.roadWidth + s.buildingWidth + s.spacing * 2, s.roadRoundness));
    const guides = Polygon.union(tmp.map((e) => e.poly)).filter((seg) => seg.length() >= s.buildingMinLength);

    const supports = [];
    for (const seg of guides) {
      const len = seg.length() + s.spacing;
      const count = Math.floor(len / (s.buildingMinLength + s.spacing));
      if (count < 1) continue;
      const bLen = len / count - s.spacing;
      const dir = seg.directionVector();
      let q1 = seg.p1;
      let q2 = add(q1, scale(dir, bLen));
      supports.push(new Segment(q1, q2));
      for (let i = 2; i <= count; i++) {
        q1 = add(q2, scale(dir, s.spacing));
        q2 = add(q1, scale(dir, bLen));
        supports.push(new Segment(q1, q2));
      }
    }
    const bases = supports.map((seg) => new Envelope(seg, s.buildingWidth).poly);
    const eps = 0.001;
    for (let i = 0; i < bases.length - 1; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const a = bases[i].bbox;
        const b = bases[j].bbox;
        if (a.minX - s.spacing > b.maxX || a.maxX + s.spacing < b.minX || a.minY - s.spacing > b.maxY || a.maxY + s.spacing < b.minY) continue;
        if (bases[i].intersectsPoly(bases[j]) || bases[i].distanceToPoly(bases[j]) < s.spacing - eps) {
          bases.splice(j, 1);
          j--;
        }
      }
    }
    return bases.map((b) => new Building(b, Math.round(rng.range(170, 420))));
  }

  #generateTrees() {
    const s = this.settings;
    const rng = createRng(s.seed * 31 + 3);
    const illegal = [...this.buildings.map((b) => b.base), ...this.envelopes.map((e) => e.poly)];
    if (!illegal.length) return [];
    const grid = new PolyGrid(illegal);
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const poly of illegal) {
      left = Math.min(left, poly.bbox.minX);
      right = Math.max(right, poly.bbox.maxX);
      top = Math.min(top, poly.bbox.minY);
      bottom = Math.max(bottom, poly.bbox.maxY);
    }
    const trees = [];
    const treeGrid = new Map();
    const tkey = (x, y) => `${Math.floor(x / s.treeSize)},${Math.floor(y / s.treeSize)}`;
    let tries = 0;
    while (tries < 120 && trees.length < s.maxTrees) {
      tries++;
      const p = new Point(lerp(left, right, rng.next()), lerp(top, bottom, rng.next()));
      const near = grid.near(p, s.treeSize * 2);
      if (!near.size) continue;
      let keep = true;
      let close = false;
      for (const poly of near) {
        if (poly.containsPoint(p)) {
          keep = false;
          break;
        }
        const d = poly.distanceToPoint(p);
        if (d < s.treeSize / 2) {
          keep = false;
          break;
        }
        if (d < s.treeSize * 2) close = true;
      }
      if (!keep || !close) continue;
      const cx = Math.floor(p.x / s.treeSize);
      const cy = Math.floor(p.y / s.treeSize);
      for (let dx = -1; dx <= 1 && keep; dx++) {
        for (let dy = -1; dy <= 1 && keep; dy++) {
          for (const t of treeGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (distance(t.center, p) < s.treeSize) {
              keep = false;
              break;
            }
          }
        }
      }
      if (!keep) continue;
      const tree = new Tree(p, s.treeSize, Math.round(rng.range(160, 240)));
      trees.push(tree);
      const k = tkey(p.x, p.y);
      if (!treeGrid.has(k)) treeGrid.set(k, []);
      treeGrid.get(k).push(tree);
      tries = 0;
    }
    return trees;
  }

  /**
   * Shortest-path corridor between two locations (usually Start → Target markings).
   * Cars train inside this corridor so they learn the route, not the whole city.
   * @returns {{borders: Segment[], grid: SegmentGrid, route: Route, skeleton: Segment[]} | null}
   */
  generateCorridor(start, end, startDir = null) {
    if (!this.graph.segments.length) return null;
    const startSeg = getNearestSegment(start, this.graph.segments);
    const endSeg = getNearestSegment(end, this.graph.segments);
    const projStart = startSeg.projectPoint(start).point;
    const projEnd = endSeg.projectPoint(end).point;
    // Leave the start only in its direction of travel: no spawning into the corridor's end cap.
    const ahead = (p) => !startDir || (p.x - projStart.x) * startDir.x + (p.y - projStart.y) * startDir.y > 0;
    const tmpSegs = [];
    for (const p of [startSeg.p1, startSeg.p2]) if (ahead(p)) tmpSegs.push(new Segment(projStart, p, true));
    if (!tmpSegs.length) tmpSegs.push(new Segment(projStart, startSeg.p1), new Segment(projStart, startSeg.p2));
    tmpSegs.push(new Segment(endSeg.p1, projEnd), new Segment(projEnd, endSeg.p2));
    if (startSeg.equals(endSeg) && ahead(projEnd)) tmpSegs.push(new Segment(projStart, projEnd, true));
    const tmpGraph = new Graph([...this.graph.points, projStart, projEnd], [...this.graph.segments, ...tmpSegs]);
    const path = tmpGraph.getShortestPath(projStart, projEnd);
    if (path.length < 2) return null;
    const skeleton = [];
    for (let i = 1; i < path.length; i++) skeleton.push(new Segment(path[i - 1], path[i]));
    const env = skeleton.map((seg) => new Envelope(seg, this.settings.roadWidth, this.settings.roadRoundness));
    const borders = Polygon.union(env.map((e) => e.poly));
    return { borders, grid: new SegmentGrid(borders, 300), route: new Route(path), skeleton, envelopes: env };
  }

  /** Lane centre for left-hand traffic: a quarter road width to the left of the centre line. */
  laneOffset(point, dir) {
    const q = this.settings.roadWidth / 4;
    return new Point(point.x + dir.y * q, point.y - dir.x * q);
  }

  /**
   * Picks a drivable Start/Target pair whose route length falls in [min, max].
   * @param {{next:()=>number, pick:<T>(a:T[])=>T}} rng
   */
  suggestRoute(rng, { min = 1800, max = 5200 } = {}) {
    const pts = this.graph.points;
    const w = this.settings.roadWidth;
    for (let attempt = 0; attempt < 250 && pts.length > 1; attempt++) {
      const a = rng.pick(pts);
      const b = rng.pick(pts);
      if (a === b) continue;
      const path = this.graph.getShortestPath(a, b);
      if (path.length < 3) continue;
      const route = new Route(path);
      if (route.length < min || route.length > max) continue;
      const [p0, p1] = path;
      const q0 = path[path.length - 2];
      const q1 = path[path.length - 1];
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < w * 2.5 || Math.hypot(q1.x - q0.x, q1.y - q0.y) < w * 2.5) continue;
      const d0 = normalize(subtract(p1, p0));
      const d1 = normalize(subtract(q1, q0));
      const s = this.laneOffset(lerp2D(p0, p1, 0.3), d0);
      const t = this.laneOffset(lerp2D(q0, q1, 0.7), d1);
      return { start: new Start(s, d0, w / 2, w / 2), target: new Target(t, d1, w / 2, w / 2), length: route.length };
    }
    return null;
  }

  setRoute(route) {
    this.markings = this.markings.filter((m) => m.type !== 'start' && m.type !== 'target');
    this.markings.push(route.start, route.target);
    this.markingsChanged();
  }

  // ---------- traffic lights ----------

  #intersections() {
    return this.graph.points.filter((p) => this.graph.getSegmentsWithPoint(p).length > 2);
  }

  updateLights() {
    if (!this.lightGroups) {
      const lights = this.markings.filter((m) => m instanceof Light);
      const centres = this.#intersections();
      const groups = new Map();
      for (const light of lights) {
        const p = getNearestPoint(light.center, centres) ?? light.center;
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(light);
      }
      this.lightGroups = [...groups.values()];
    }
    const green = 3;
    const yellow = 1;
    const tick = Math.floor(this.frameCount / 60);
    for (const lights of this.lightGroups) {
      const cycle = lights.length * (green + yellow);
      const t = tick % cycle;
      const idx = Math.floor(t / (green + yellow));
      const state = t % (green + yellow) < green ? 'green' : 'yellow';
      lights.forEach((l, i) => (l.state = i === idx ? state : 'red'));
    }
    this.frameCount++;
  }

  redLightBorders() {
    return this.markings.filter((m) => m instanceof Light && m.state === 'red').map((m) => m.border);
  }

  markingsChanged() {
    this.lightGroups = null;
  }

  // ---------- persistence ----------

  toJSON() {
    return {
      version: 1,
      settings: this.settings,
      graph: this.graph.toCompact(),
      markings: this.markings.map((m) => m.toJSON()),
    };
  }

  static fromJSON(info) {
    const world = new World(Graph.fromCompact(info.graph), info.settings);
    world.markings = (info.markings ?? []).map(loadMarking).filter(Boolean);
    return world;
  }

  // ---------- drawing ----------

  #items() {
    if (!this.itemCache) {
      this.itemCache = [
        ...this.buildings.map((b) => {
          const c = b.base.points.reduce((acc, p) => ({ x: acc.x + p.x / b.base.points.length, y: acc.y + p.y / b.base.points.length }), { x: 0, y: 0 });
          return { kind: 'b', item: b, c, bbox: b.base.bbox };
        }),
        ...this.trees.map((t) => ({ kind: 't', item: t, c: t.center, bbox: t.base.bbox })),
      ];
    }
    return this.itemCache;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number}} viewPoint
   * @param {import('./render/comic.js').Palette} palette
   * @param {{minX:number,minY:number,maxX:number,maxY:number}} view
   * @param {{homeStyle?:string, showItems?:boolean, corridor?:any, dim?:boolean}} [opts]
   */
  draw(ctx, viewPoint, palette, view, { homeStyle = 'queenslander', showItems = true, corridor = null, dim = false } = {}) {
    const visible = (b, pad = 0) => b.minX - pad < view.maxX && b.maxX + pad > view.minX && b.minY - pad < view.maxY && b.maxY + pad > view.minY;
    const road = palette.mode === 'dark' ? mix(palette.deep, palette.ink, 0.15) : mix(palette.accent, palette.ink, 0.35);
    const ink = palette.mode === 'dark' ? '#0c0a08' : palette.ink;

    for (const env of this.envelopes) {
      if (visible(env.poly.bbox)) env.poly.draw(ctx, { fill: road, stroke: road, lineWidth: 15 });
    }
    if (corridor) {
      for (const env of corridor.envelopes) env.poly.draw(ctx, { fill: withAlpha(palette.primary, 0.55), stroke: '', lineWidth: 0 });
    }
    for (const m of this.markings) {
      if (m.type !== 'start' && m.type !== 'target' && visible(m.poly.bbox, 50)) m.draw(ctx, palette);
    }
    for (const seg of this.graph.segments) {
      const b = { minX: Math.min(seg.p1.x, seg.p2.x), maxX: Math.max(seg.p1.x, seg.p2.x), minY: Math.min(seg.p1.y, seg.p2.y), maxY: Math.max(seg.p1.y, seg.p2.y) };
      if (visible(b)) seg.draw(ctx, { color: withAlpha(palette.light, 0.85), width: 4, dash: [12, 14] });
    }
    for (const seg of this.roadBorders) {
      const b = { minX: Math.min(seg.p1.x, seg.p2.x), maxX: Math.max(seg.p1.x, seg.p2.x), minY: Math.min(seg.p1.y, seg.p2.y), maxY: Math.max(seg.p1.y, seg.p2.y) };
      if (visible(b)) seg.draw(ctx, { color: ink, width: 6, cap: 'round' });
    }
    for (const m of this.markings) {
      if ((m.type === 'start' || m.type === 'target') && visible(m.poly.bbox, 50)) m.draw(ctx, palette);
    }
    if (!showItems) return;
    if (dim) ctx.globalAlpha = 0.35;
    const items = this.#items().filter((it) => visible(it.bbox, 250));
    const d2 = (p) => (p.x - viewPoint.x) ** 2 + (p.y - viewPoint.y) ** 2;
    items.sort((a, b) => d2(b.c) - d2(a.c));
    for (const it of items) {
      if (it.kind === 'b') it.item.draw(ctx, viewPoint, palette, homeStyle);
      else it.item.draw(ctx, viewPoint, palette);
    }
    ctx.globalAlpha = 1;
  }
}
