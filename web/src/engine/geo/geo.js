import coast from '../data/coast.js';
import { Graph } from '../graph.js';
import { SegmentGrid } from '../math/segment-grid.js';
import { Point } from '../primitives/point.js';
import { Polygon } from '../primitives/polygon.js';
import { Segment } from '../primitives/segment.js';

/** Equirectangular projection centred on Brisbane. 100 units ≈ 1° of latitude (~111 km). */
export const PROJ = { lon0: 153.0, lat0: -27.5, k: 100 };
const COS0 = Math.cos((PROJ.lat0 * Math.PI) / 180);
export const KM_PER_UNIT = 1.112;

export function project(lon, lat) {
  return new Point((lon - PROJ.lon0) * COS0 * PROJ.k, (PROJ.lat0 - lat) * PROJ.k);
}

export function unproject(p) {
  return { lon: p.x / (COS0 * PROJ.k) + PROJ.lon0, lat: PROJ.lat0 - p.y / PROJ.k };
}

/**
 * Ports and airports. Sea coordinates sit just offshore of the berth so ships spawn in water.
 * `tier` gates destinations behind Depot unlocks.
 */
export const PLACES = [
  // airports
  { id: 'BNE', name: 'Brisbane', kind: 'air', lon: 153.117, lat: -27.384, country: 'AU', tier: 0, hub: true },
  { id: 'OOL', name: 'Gold Coast', kind: 'air', lon: 153.505, lat: -28.164, country: 'AU', tier: 0 },
  { id: 'SYD', name: 'Sydney', kind: 'air', lon: 151.177, lat: -33.946, country: 'AU', tier: 0 },
  { id: 'MEL', name: 'Melbourne', kind: 'air', lon: 144.843, lat: -37.67, country: 'AU', tier: 1 },
  { id: 'CNS', name: 'Cairns', kind: 'air', lon: 145.755, lat: -16.886, country: 'AU', tier: 0 },
  { id: 'HTI', name: 'Hamilton Island', kind: 'air', lon: 148.951, lat: -20.358, country: 'AU', tier: 1 },
  { id: 'LDH', name: 'Lord Howe Island', kind: 'air', lon: 159.077, lat: -31.538, country: 'AU', tier: 1 },
  { id: 'NLK', name: 'Norfolk Island', kind: 'air', lon: 167.939, lat: -29.042, country: 'AU', tier: 1 },
  { id: 'AKL', name: 'Auckland', kind: 'air', lon: 174.785, lat: -37.008, country: 'NZ', tier: 1 },
  { id: 'WLG', name: 'Wellington', kind: 'air', lon: 174.805, lat: -41.327, country: 'NZ', tier: 2 },
  { id: 'NOU', name: 'Nouméa', kind: 'air', lon: 166.213, lat: -22.016, country: 'NC', tier: 1 },
  { id: 'VLI', name: 'Port Vila', kind: 'air', lon: 168.32, lat: -17.699, country: 'VU', tier: 2 },
  { id: 'NAN', name: 'Nadi', kind: 'air', lon: 177.443, lat: -17.755, country: 'FJ', tier: 2 },
  { id: 'POM', name: 'Port Moresby', kind: 'air', lon: 147.22, lat: -9.443, country: 'PG', tier: 2 },
  { id: 'HIR', name: 'Honiara', kind: 'air', lon: 160.055, lat: -9.428, country: 'SB', tier: 2 },
  { id: 'DPS', name: 'Denpasar', kind: 'air', lon: 115.167, lat: -8.748, country: 'ID', tier: 3 },
  { id: 'TBU', name: 'Nukuʻalofa', kind: 'air', lon: 184.8, lat: -21.24, country: 'TO', tier: 3 },
  // seaports
  { id: 'PBNE', name: 'Port of Brisbane', kind: 'sea', lon: 153.2, lat: -27.36, country: 'AU', tier: 0, hub: true },
  { id: 'TANG', name: 'Tangalooma', kind: 'sea', lon: 153.345, lat: -27.18, country: 'AU', tier: 0 },
  { id: 'DUNW', name: 'Dunwich', kind: 'sea', lon: 153.38, lat: -27.49, country: 'AU', tier: 0 },
  { id: 'GCSW', name: 'Gold Coast Seaway', kind: 'sea', lon: 153.48, lat: -27.94, country: 'AU', tier: 0 },
  { id: 'SYDP', name: 'Port Jackson', kind: 'sea', lon: 151.33, lat: -33.84, country: 'AU', tier: 1 },
  { id: 'LDHP', name: 'Lord Howe Lagoon', kind: 'sea', lon: 159.0, lat: -31.6, country: 'AU', tier: 1 },
  { id: 'NLKP', name: 'Kingston, Norfolk', kind: 'sea', lon: 167.95, lat: -29.12, country: 'AU', tier: 1 },
  { id: 'NOUP', name: 'Port of Nouméa', kind: 'sea', lon: 166.3, lat: -22.42, country: 'NC', tier: 1 },
  { id: 'AKLP', name: 'Ports of Auckland', kind: 'sea', lon: 174.95, lat: -36.62, country: 'NZ', tier: 1 },
  { id: 'VILP', name: 'Port Vila', kind: 'sea', lon: 168.2, lat: -17.8, country: 'VU', tier: 2 },
  { id: 'SUVA', name: 'Suva', kind: 'sea', lon: 178.43, lat: -18.22, country: 'FJ', tier: 2 },
  { id: 'POMP', name: 'Port Moresby', kind: 'sea', lon: 147.08, lat: -9.6, country: 'PG', tier: 2 },
  { id: 'HONP', name: 'Honiara', kind: 'sea', lon: 159.95, lat: -9.35, country: 'SB', tier: 2 },
];

/** Default sea lanes: waypoints + edges. Unit tests assert none of these cross land. */
export const SEA_WAYPOINTS = {
  B1: [153.25, -27.25],
  B2: [153.29, -27.1],
  B3: [153.3, -26.9],
  B4: [153.65, -26.9],
  BS: [153.3, -27.44],
  E1: [153.8, -27.4],
  E2: [153.7, -27.95],
  S1: [153.8, -28.8],
  S2: [153.5, -30.5],
  S3: [152.9, -32.3],
  S4: [151.65, -33.7],
  C1: [155.5, -25.0],
  N1: [162.0, -23.4],
  N2: [165.9, -22.85],
  V1: [160.5, -19.0],
  V2: [163.5, -18.4],
  V3: [167.2, -18.0],
  F0: [167.6, -23.0],
  F1: [169.5, -21.2],
  F2: [176.0, -19.6],
  M1: [155.0, -20.0],
  M2: [152.5, -14.0],
  M3: [148.6, -10.75],
  M4: [147.3, -9.8],
  H1: [157.5, -14.0],
  H2: [159.3, -10.2],
  H3: [159.5, -9.1],
  T1: [158.0, -30.5],
  T2: [166.0, -33.0],
  T3: [172.8, -33.9],
  T4: [175.35, -35.6],
};

export const SEA_EDGES = [
  ['PBNE', 'B1'], ['B1', 'B2'], ['B2', 'B3'], ['B3', 'B4'], ['B1', 'TANG'], ['B2', 'TANG'],
  ['PBNE', 'BS'], ['BS', 'DUNW'],
  ['B4', 'E1'], ['E1', 'E2'], ['E2', 'GCSW'],
  ['E2', 'S1'], ['S1', 'S2'], ['S2', 'S3'], ['S3', 'S4'], ['S4', 'SYDP'],
  ['B4', 'C1'], ['C1', 'N1'], ['N1', 'N2'], ['N2', 'NOUP'],
  ['C1', 'V1'], ['V1', 'V2'], ['V2', 'V3'], ['V3', 'VILP'],
  ['N2', 'F0'], ['F0', 'F1'], ['F1', 'F2'], ['F2', 'SUVA'],
  ['C1', 'M1'], ['M1', 'M2'], ['M2', 'M3'], ['M3', 'M4'], ['M4', 'POMP'],
  ['M1', 'H1'], ['H1', 'H2'], ['H2', 'H3'], ['H3', 'HONP'],
  ['E1', 'T1'], ['T1', 'LDHP'], ['T1', 'T2'], ['T2', 'NLKP'], ['T2', 'T3'], ['T3', 'T4'], ['T4', 'AKLP'],
];

export const AIR_EDGES = [
  ['BNE', 'OOL'], ['BNE', 'SYD'], ['BNE', 'MEL'], ['BNE', 'CNS'], ['BNE', 'HTI'], ['BNE', 'LDH'], ['BNE', 'NLK'],
  ['BNE', 'AKL'], ['BNE', 'NOU'], ['BNE', 'VLI'], ['BNE', 'NAN'], ['BNE', 'POM'], ['BNE', 'HIR'], ['BNE', 'DPS'],
  ['SYD', 'MEL'], ['AKL', 'WLG'], ['NOU', 'VLI'], ['VLI', 'NAN'], ['NAN', 'TBU'], ['CNS', 'POM'], ['POM', 'HIR'],
  ['AKL', 'TBU'], ['SYD', 'AKL'],
];

/** Builds a lane graph whose points carry their place/waypoint id. */
export function buildLaneGraph(kind) {
  const points = new Map();
  const getPoint = (id) => {
    if (points.has(id)) return points.get(id);
    const place = PLACES.find((p) => p.id === id);
    const ll = place ? [place.lon, place.lat] : SEA_WAYPOINTS[id];
    if (!ll) throw new Error(`Unknown waypoint ${id}`);
    const p = project(ll[0], ll[1]);
    p.id = id;
    p.place = place ?? null;
    points.set(id, p);
    return p;
  };
  const edges = kind === 'sea' ? SEA_EDGES : AIR_EDGES;
  const segments = edges.map(([a, b]) => new Segment(getPoint(a), getPoint(b)));
  for (const place of PLACES) if (place.kind === kind) getPoint(place.id);
  return new Graph([...points.values()], segments);
}

/** Coastline polygons + a segment index for land collision and sensors. */
export class Coastline {
  constructor() {
    this.polygons = coast.rings.map((ring) => {
      const pts = [];
      for (let i = 0; i < ring.length; i += 2) pts.push(project(ring[i], ring[i + 1]));
      return new Polygon(pts);
    });
    const segs = this.polygons.flatMap((p) => p.segments);
    this.grid = new SegmentGrid(segs, 8);
    this.segmentCount = segs.length;
  }

  isLand(p) {
    for (const poly of this.polygons) {
      const b = poly.bbox;
      if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
      if (poly.containsPoint(p)) return true;
    }
    return false;
  }

  /** True when the straight line a→b touches land. */
  crossesLand(a, b) {
    const cand = this.grid.query(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
    for (const s of cand) {
      const d = (b.x - a.x) * (s.p2.y - s.p1.y) - (b.y - a.y) * (s.p2.x - s.p1.x);
      if (Math.abs(d) < 1e-9) continue;
      const t = ((s.p1.x - a.x) * (s.p2.y - s.p1.y) - (s.p1.y - a.y) * (s.p2.x - s.p1.x)) / d;
      const u = ((s.p1.x - a.x) * (b.y - a.y) - (s.p1.y - a.y) * (b.x - a.x)) / d;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
    return false;
  }
}

/** Gives user-drawn waypoints stable ids so lanes can be saved and routed. */
export function ensureIds(graph) {
  let n = 0;
  const used = new Set(graph.points.map((p) => p.id).filter(Boolean));
  for (const p of graph.points) {
    if (p.id) continue;
    while (used.has(`W${++n}`));
    p.id = `W${n}`;
    p.place = null;
    used.add(p.id);
  }
  return graph;
}

export function serializeLanes(graph) {
  ensureIds(graph);
  return {
    points: graph.points.map((p) => ({ id: p.id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
    edges: graph.segments.map((s) => [s.p1.id, s.p2.id]),
  };
}

/** Rebuilds a lane graph from saved data; places always come back where they belong. */
export function loadLanes(kind, data) {
  const base = buildLaneGraph(kind);
  if (!data?.points || !data?.edges) return base;
  const byId = new Map();
  for (const p of base.points) if (p.place) byId.set(p.id, p);
  for (const raw of data.points) {
    if (byId.has(raw.id) || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
    const p = new Point(raw.x, raw.y);
    p.id = String(raw.id);
    p.place = null;
    byId.set(p.id, p);
  }
  const segments = [];
  for (const [a, b] of data.edges) {
    const p1 = byId.get(a);
    const p2 = byId.get(b);
    if (p1 && p2 && p1 !== p2) segments.push(new Segment(p1, p2));
  }
  return new Graph([...byId.values()], segments);
}
