// Rebuilds the engine's geography from open data:
//   • city road networks from OpenStreetMap (Overpass API) → web/src/engine/data/maps/*.js
//   • South-West Pacific coastlines from Natural Earth 1:10m → web/src/engine/data/coast.js
// usage: cd tools && npm install && node build-geodata.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.TERRA_GEO_OUT ?? path.join(root, 'web/src/engine/data');
const geoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terra-geo-'));
fs.mkdirSync(path.join(outDir, 'maps'), { recursive: true });

// south, west, north, east
const CITIES = {
  brisbane: '-27.4775,153.0185,-27.4620,153.0350',
  goldcoast: '-28.0060,153.4180,-27.9890,153.4330',
  sydney: '-33.8760,151.2020,-33.8620,151.2130',
  melbourne: '-37.8195,144.9540,-37.8075,144.9730',
};
const HIGHWAYS = 'primary|secondary|tertiary|residential|unclassified|primary_link|secondary_link|tertiary_link|living_street|trunk';

for (const [key, bbox] of Object.entries(CITIES)) {
  const query = `[out:json][timeout:90];way["highway"~"^(${HIGHWAYS})$"](${bbox});(._;>;);out body;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'TerraSim/1.0 (open-source portfolio project)' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass ${key}: ${res.status}`);
  fs.writeFileSync(path.join(geoDir, `${key}.osm.json`), await res.text());
  console.log(`downloaded ${key}`);
  await new Promise((r) => setTimeout(r, 3000)); // be polite to the public Overpass server
}
const atlas = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-10m.json');
fs.writeFileSync(path.join(geoDir, 'land-10m.json'), await atlas.text());

function writeModule(file, banner, data) {
  fs.writeFileSync(file, `${banner}\nexport default ${JSON.stringify(data)};\n`);
}

const UNITS_PER_METRE = 6;

function processRoads(key, title, region) {
  const raw = JSON.parse(fs.readFileSync(path.join(geoDir, `${key}.osm.json`), 'utf8'));
  const nodes = new Map();
  const ways = [];
  for (const el of raw.elements) {
    if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lon: el.lon });
    else if (el.type === 'way') ways.push(el);
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const n of nodes.values()) {
    minLat = Math.min(minLat, n.lat); maxLat = Math.max(maxLat, n.lat);
    minLon = Math.min(minLon, n.lon); maxLon = Math.max(maxLon, n.lon);
  }
  const lat0 = (minLat + maxLat) / 2, lon0 = (minLon + maxLon) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180) * UNITS_PER_METRE;
  const ky = 110540 * UNITS_PER_METRE;

  // graph as adjacency on node ids
  const pos = new Map();
  const adj = new Map();
  const edgeName = new Map();
  const key2 = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const link = (a, b, name) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
    if (name && !edgeName.has(key2(a, b))) edgeName.set(key2(a, b), name);
  };
  for (const w of ways) {
    const name = w.tags?.name ?? '';
    for (let i = 1; i < w.nodes.length; i++) link(w.nodes[i - 1], w.nodes[i], name);
  }
  for (const id of adj.keys()) {
    const n = nodes.get(id);
    pos.set(id, { x: (n.lon - lon0) * kx, y: (lat0 - n.lat) * ky });
  }
  const dist = (a, b) => Math.hypot(pos.get(a).x - pos.get(b).x, pos.get(a).y - pos.get(b).y);

  const removeNode = (id) => {
    for (const nb of adj.get(id) ?? []) adj.get(nb)?.delete(id);
    adj.delete(id);
  };
  const mergeInto = (keep, drop) => {
    for (const nb of [...adj.get(drop)]) {
      if (nb !== keep) link(keep, nb, edgeName.get(key2(drop, nb)));
    }
    removeNode(drop);
  };

  // 1) cluster nearby nodes (dual carriageway junctions, tiny offsets)
  const MERGE = 14 * UNITS_PER_METRE;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, nbs] of adj) {
      for (const b of nbs) {
        if (dist(a, b) < MERGE) {
          const pa = pos.get(a), pb = pos.get(b);
          pos.set(a, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
          mergeInto(a, b);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  // 2) drop degree-2 nodes on near-straight runs
  const turn = (a, m, b) => {
    const pa = pos.get(a), pm = pos.get(m), pb = pos.get(b);
    const a1 = Math.atan2(pm.y - pa.y, pm.x - pa.x);
    const a2 = Math.atan2(pb.y - pm.y, pb.x - pm.x);
    let d = Math.abs(a1 - a2);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d;
  };
  changed = true;
  while (changed) {
    changed = false;
    for (const [m, nbs] of adj) {
      if (nbs.size !== 2) continue;
      const [a, b] = [...nbs];
      if (adj.get(a).has(b)) continue;
      if (turn(a, m, b) < (14 * Math.PI) / 180 && dist(a, b) < 320 * UNITS_PER_METRE) {
        const name = edgeName.get(key2(a, m)) || edgeName.get(key2(m, b));
        removeNode(m);
        link(a, b, name);
        changed = true;
      }
    }
  }
  // 3) prune short dead-end stubs (repeat)
  changed = true;
  while (changed) {
    changed = false;
    for (const [id, nbs] of adj) {
      if (nbs.size === 0) { adj.delete(id); changed = true; continue; }
      if (nbs.size === 1 && dist(id, [...nbs][0]) < 40 * UNITS_PER_METRE) { removeNode(id); changed = true; }
    }
  }
  // 4) keep the largest connected component
  const seen = new Set();
  let best = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      for (const nb of adj.get(c)) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
    if (comp.length > best.length) best = comp;
  }
  const keep = new Set(best);

  // centre & emit
  let cx = 0, cy = 0;
  for (const id of keep) { cx += pos.get(id).x; cy += pos.get(id).y; }
  cx /= keep.size; cy /= keep.size;
  const index = new Map();
  const points = [];
  for (const id of keep) {
    index.set(id, points.length / 2);
    points.push(Math.round(pos.get(id).x - cx), Math.round(pos.get(id).y - cy));
  }
  const names = [];
  const nameIdx = new Map();
  const segments = [];
  const segNames = [];
  const done = new Set();
  for (const a of keep) {
    for (const b of adj.get(a)) {
      if (!keep.has(b)) continue;
      const k = key2(a, b);
      if (done.has(k)) continue;
      done.add(k);
      segments.push(index.get(a), index.get(b));
      const n = edgeName.get(k) ?? '';
      if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); }
      segNames.push(nameIdx.get(n));
    }
  }
  const out = {
    id: key, title, region,
    attribution: '© OpenStreetMap contributors (ODbL)',
    unitsPerMetre: UNITS_PER_METRE,
    origin: { lat: +lat0.toFixed(6), lon: +lon0.toFixed(6) },
    points, segments, names, segNames,
  };
  writeModule(path.join(outDir, 'maps', `${key}.js`), '// Generated from OpenStreetMap via Overpass. © OpenStreetMap contributors, ODbL.', out);
  console.log(`${key}: ${points.length / 2} points, ${segments.length / 2} segments`);
}

processRoads('brisbane', 'Brisbane CBD', 'Queensland');
processRoads('goldcoast', 'Surfers Paradise', 'Gold Coast, Queensland');
processRoads('sydney', 'Sydney CBD', 'New South Wales');
processRoads('melbourne', 'Melbourne Hoddle Grid', 'Victoria');

// ---------- coastlines ----------
const topo = JSON.parse(fs.readFileSync(path.join(geoDir, 'land-10m.json'), 'utf8'));
const land = feature(topo, topo.objects.land);
const BOX = { w: 105, e: 192, s: -50, n: 1 };
const BAY = { w: 152.85, e: 153.65, s: -28.25, n: -26.75 };
const inBay = (p) => p[0] > BAY.w && p[0] < BAY.e && p[1] > BAY.s && p[1] < BAY.n;

function clip(ring) {
  const edges = [
    (p) => p[0] >= BOX.w, (p) => p[0] <= BOX.e, (p) => p[1] >= BOX.s, (p) => p[1] <= BOX.n,
  ];
  const cut = [
    (a, b) => [BOX.w, a[1] + ((BOX.w - a[0]) * (b[1] - a[1])) / (b[0] - a[0])],
    (a, b) => [BOX.e, a[1] + ((BOX.e - a[0]) * (b[1] - a[1])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((BOX.s - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), BOX.s],
    (a, b) => [a[0] + ((BOX.n - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), BOX.n],
  ];
  let out = ring;
  for (let e = 0; e < 4; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const ci = edges[e](cur), pi = edges[e](prev);
      if (ci) { if (!pi) out.push(cut[e](prev, cur)); out.push(cur); }
      else if (pi) out.push(cut[e](prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
function dp(pts, tolFn) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-9
        ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
        : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > tolFn(pts[idx])) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (r) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s / 2);
};
const rings = [];
let total = 0;
for (const f of land.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const outer = poly[0].map(([lon, lat]) => [lon < -100 ? lon + 360 : lon, lat]);
    const clipped = clip(outer);
    if (clipped.length < 3) continue;
    const bay = clipped.some(inBay);
    const a = area(clipped);
    if (!bay && a < 0.004) continue;
    if (bay && a < 0.00015) continue;
    const simp = dp(clipped, (p) => (inBay(p) ? 0.0025 : 0.03));
    if (simp.length < 3) continue;
    const flat = [];
    for (const [x, y] of simp) flat.push(+x.toFixed(4), +y.toFixed(4));
    rings.push(flat);
    total += simp.length;
  }
}
writeModule(path.join(outDir, 'coast.js'), '// Generated from Natural Earth 1:10m land (public domain), clipped to the South-West Pacific.', {
  attribution: 'Made with Natural Earth (public domain)',
  bbox: BOX, rings,
});
console.log(`coast: ${rings.length} rings, ${total} points; bay rings: ${rings.filter((r) => inBay([r[0], r[1]])).length}`);
