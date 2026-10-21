import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coastline, PLACES, buildLaneGraph, project, unproject } from '../geo/geo.js';
import { GeoSim } from '../sim/geo-sim.js';

const coast = new Coastline();

test('projection round-trips', () => {
  const p = project(166.44, -22.27);
  const ll = unproject(p);
  assert.ok(Math.abs(ll.lon - 166.44) < 1e-9 && Math.abs(ll.lat + 22.27) < 1e-9);
});

test('Brisbane airport is on land and the Coral Sea is not', () => {
  assert.equal(coast.isLand(project(152.9, -27.5)), true);
  assert.equal(coast.isLand(project(156, -25)), false);
});

test('every seaport sits in open water', () => {
  for (const p of PLACES.filter((x) => x.kind === 'sea')) {
    assert.equal(coast.isLand(project(p.lon, p.lat)), false, `${p.id} is in water`);
  }
});

test('no default sea lane crosses land', () => {
  const g = buildLaneGraph('sea');
  for (const s of g.segments) assert.equal(coast.crossesLand(s.p1, s.p2), false, `${s.p1.id}→${s.p2.id}`);
});

test('every destination is reachable from its hub', () => {
  for (const domain of ['sea', 'air']) {
    const g = buildLaneGraph(domain);
    const hub = g.points.find((p) => p.place?.hub);
    for (const p of g.points.filter((x) => x.place && !x.place.hub)) {
      assert.ok(g.getShortestPath(hub, p).length >= 2, `${domain}: ${hub.id}→${p.id}`);
    }
  }
});

test('ships learn to sail out of Moreton Bay to Tangalooma', () => {
  let arrived = 0;
  const sim = new GeoSim('sea', { coast, graph: buildLaneGraph('sea'), onEvent: (e) => e.type === 'delivery' && arrived++ });
  assert.equal(sim.setRoute('PBNE', 'TANG'), null);
  sim.startTraining();
  while (sim.trainer.generation < 5) sim.step();
  assert.ok(arrived > 0);
});

test('planes reach Auckland around storms', () => {
  let arrived = 0;
  const sim = new GeoSim('air', { coast, graph: buildLaneGraph('air'), onEvent: (e) => e.type === 'delivery' && arrived++ });
  assert.equal(sim.setRoute('BNE', 'AKL'), null);
  sim.startTraining();
  while (sim.trainer.generation < 4) sim.step();
  assert.ok(arrived > 0);
});

test('unreachable routes explain how to fix them', () => {
  const g = buildLaneGraph('sea');
  g.segments = g.segments.filter((s) => s.p2.id !== 'SUVA' && s.p1.id !== 'SUVA');
  const sim = new GeoSim('sea', { coast, graph: g });
  assert.match(sim.setRoute('PBNE', 'SUVA') ?? '', /Chart one/);
});
