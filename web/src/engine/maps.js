/** City maps. Data modules load lazily so each city is its own chunk. */
export const CITY_MAPS = [
  { id: 'brisbane', title: 'Brisbane CBD', region: 'Queensland', load: () => import('./data/maps/brisbane.js') },
  { id: 'goldcoast', title: 'Surfers Paradise', region: 'Gold Coast, Queensland', load: () => import('./data/maps/goldcoast.js') },
  { id: 'sydney', title: 'Sydney CBD', region: 'New South Wales', load: () => import('./data/maps/sydney.js') },
  { id: 'melbourne', title: 'Melbourne Hoddle Grid', region: 'Victoria', load: () => import('./data/maps/melbourne.js') },
  {
    id: 'sandbox',
    title: 'Blank Sandbox',
    region: 'Build your own',
    load: async () => ({ default: { id: 'sandbox', title: 'Blank Sandbox', points: [], segments: [], names: [], segNames: [] } }),
  },
];

/** Parses an Overpass API JSON export into the compact graph format (for "Import OSM"). */
export function osmToCompact(osm, unitsPerMetre = 6) {
  const nodes = new Map();
  const ways = [];
  for (const el of osm?.elements ?? []) {
    if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) nodes.set(el.id, el);
    else if (el.type === 'way' && el.tags?.highway && Array.isArray(el.nodes)) ways.push(el);
  }
  if (!nodes.size || !ways.length) throw new Error('No roads found. Export ways tagged "highway" with their nodes (out body; >;).');
  const used = new Set(ways.flatMap((w) => w.nodes).filter((id) => nodes.has(id)));
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const id of used) {
    const n = nodes.get(id);
    minLat = Math.min(minLat, n.lat);
    maxLat = Math.max(maxLat, n.lat);
    minLon = Math.min(minLon, n.lon);
    maxLon = Math.max(maxLon, n.lon);
  }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = (minLon + maxLon) / 2;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180) * unitsPerMetre;
  const ky = 110_540 * unitsPerMetre;
  const index = new Map();
  const points = [];
  for (const id of used) {
    const n = nodes.get(id);
    index.set(id, points.length / 2);
    points.push(Math.round((n.lon - lon0) * kx), Math.round((lat0 - n.lat) * ky));
  }
  const seen = new Set();
  const segments = [];
  for (const w of ways) {
    for (let i = 1; i < w.nodes.length; i++) {
      const a = index.get(w.nodes[i - 1]);
      const b = index.get(w.nodes[i]);
      if (a === undefined || b === undefined || a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      segments.push(a, b);
    }
  }
  if (points.length / 2 > 3000) throw new Error('That export is too large. Keep it under 3,000 intersections (a few city blocks).');
  return { points, segments };
}
