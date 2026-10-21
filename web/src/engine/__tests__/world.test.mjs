import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../graph.js';
import { World } from '../world.js';
import { CitySim } from '../sim/city-sim.js';
import { MotorwaySim } from '../sim/motorway-sim.js';
import { createRng } from '../math/rng.js';
import { NeuralNetwork } from '../ai/network.js';
import { CITY_MAPS, osmToCompact } from '../maps.js';
import brisbane from '../data/maps/brisbane.js';

test('every bundled city map is a single connected network', async () => {
  for (const map of CITY_MAPS.filter((m) => m.id !== 'sandbox')) {
    const data = (await map.load()).default;
    const g = Graph.fromCompact(data);
    assert.ok(g.points.length > 100, `${map.id} has points`);
    const seen = new Set([g.points[0]]);
    const stack = [g.points[0]];
    while (stack.length) for (const nb of g.getNeighbours(stack.pop())) if (!seen.has(nb)) seen.add(nb), stack.push(nb);
    assert.equal(seen.size, g.points.length, `${map.id} is connected`);
  }
});

test('Brisbane world generates roads, buildings, trees and lane guides', () => {
  const w = new World(Graph.fromCompact(brisbane)).generate();
  assert.ok(w.roadBorders.length > 1000);
  assert.ok(w.buildings.length > 300);
  assert.ok(w.trees.length > 100);
  assert.ok(w.laneGuides.length > 1000);
  // geometry survives the worker round-trip
  const copy = new World(Graph.fromCompact(brisbane)).importGeometry(JSON.parse(JSON.stringify(w.exportGeometry())));
  assert.equal(copy.roadBorders.length, w.roadBorders.length);
  assert.equal(copy.buildings.length, w.buildings.length);
});

test('world save format round-trips markings', () => {
  const w = new World(Graph.fromCompact(brisbane)).generate();
  w.setRoute(w.suggestRoute(createRng(2)));
  const loaded = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(loaded.graph.points.length, w.graph.points.length);
  assert.deepEqual(loaded.markings.map((m) => m.type).sort(), ['start', 'target']);
});

test('self-driving cars learn a real Brisbane route', () => {
  const w = new World(Graph.fromCompact(brisbane)).generate();
  w.setRoute(w.suggestRoute(createRng(2)));
  let firstArrival = null;
  const sim = new CitySim(w, {
    populationSize: 80,
    onEvent: (e) => {
      if (e.type === 'generation' && e.arrived && firstArrival === null) firstArrival = e.generation;
    },
  });
  assert.equal(sim.startTraining(), null);
  while (sim.trainer.generation < 25 && firstArrival === null) sim.step();
  assert.notEqual(firstArrival, null, 'a car reached the target within 25 generations');
  // the trained brain can be deployed to a fleet
  assert.equal(sim.deployFleet(6), null);
  for (let i = 0; i < 600; i++) sim.step();
  assert.equal(sim.mode, 'fleet');
});

test('training refuses to start without markings', () => {
  const w = new World(Graph.fromCompact(brisbane)).generate();
  const sim = new CitySim(w);
  assert.match(sim.startTraining() ?? '', /Start/);
});

test('motorway cars learn to overtake traffic', () => {
  let best = 0;
  const sim = new MotorwaySim({ populationSize: 100, onEvent: (e) => (best = Math.max(best, e.passed)) });
  sim.start();
  while (sim.trainer.generation < 8) sim.step();
  assert.ok(best >= 3, `passed ${best} cars`);
});

test('network mutate(0) is identity, crossover keeps shape, validation rejects junk', () => {
  const net = new NeuralNetwork([5, 6, 4], createRng(1).next);
  const copy = NeuralNetwork.mutate(NeuralNetwork.clone(net), 0);
  assert.deepEqual(copy, JSON.parse(JSON.stringify(net)));
  const child = NeuralNetwork.crossover(net, new NeuralNetwork([5, 6, 4], createRng(2).next), createRng(3).next);
  assert.deepEqual(NeuralNetwork.shape(child), [5, 6, 4]);
  assert.equal(NeuralNetwork.feedForward([1, 0, 0, 1, 0], net).length, 4);
  assert.equal(NeuralNetwork.isValid(JSON.parse(JSON.stringify(net))), true);
  assert.equal(NeuralNetwork.isValid({ levels: [{ inputs: [0], outputs: [0], biases: ['x'], weights: [[1]] }] }), false);
  assert.equal(NeuralNetwork.isValid(null), false);
});

test('OSM import converts highway ways to a compact graph', () => {
  const osm = {
    elements: [
      { type: 'node', id: 1, lat: -27.47, lon: 153.02 },
      { type: 'node', id: 2, lat: -27.471, lon: 153.021 },
      { type: 'node', id: 3, lat: -27.472, lon: 153.02 },
      { type: 'way', id: 9, nodes: [1, 2, 3], tags: { highway: 'residential' } },
    ],
  };
  const c = osmToCompact(osm);
  assert.equal(c.points.length, 6);
  assert.equal(c.segments.length, 4);
  assert.throws(() => osmToCompact({ elements: [] }), /No roads/);
});
