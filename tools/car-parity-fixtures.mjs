// Generates trainer/sim-cpp/tests/fixtures/car-parity.json from the browser engine.
// The C++ tests assert the headless car sim reproduces these numbers (same approach as
// tools/parity-fixtures.mjs does for the logistics sim and the .NET port).
// usage: node tools/car-parity-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  CAR_SENSOR, CITY_TURN_RATE, Car, EPISODE, FACTORY_BRAINS, NeuralNetwork, createRng, exportWorld, loadWorld, makeDriver,
  randomBrain, root, runEpisode, suggestTasks,
} from './lib/trainer-world.mjs';

const RECORD_FRAMES = 400;
const r = (v) => Number(v);

// Two Brisbane routes and one Sydney route keep the fixture small but cover two street layouts.
const sources = [
  { id: 'brisbane', count: 2 },
  { id: 'sydney', count: 1 },
];
const worlds = [];
for (const s of sources) {
  const world = await loadWorld(s.id);
  const tasks = suggestTasks(world, s.count, 1);
  worlds.push({ world, tasks, doc: exportWorld(s.id, world, tasks) });
}

const brains = [
  { name: 'factory', network: FACTORY_BRAINS.city },
  { name: 'random-1', network: randomBrain(1) },
  { name: 'random-2', network: randomBrain(2) },
  { name: 'random-3', network: randomBrain(3) },
];

const frameOf = (car, proj) => ({
  x: r(car.x),
  y: r(car.y),
  angle: r(car.angle),
  speed: r(car.speed),
  sensors: car.sensor.values(),
  extras: [...car.extras],
  controls: [car.controls.forward, car.controls.left, car.controls.right, car.controls.reverse].map(Number),
  progress: proj.progress,
  damaged: car.damaged,
});

// ---- full episodes ----
const episodes = [];
for (const [w, { world, tasks, doc }] of worlds.entries()) {
  tasks.forEach((task, t) => {
    const scores = runEpisode(task.corridor, task.start, brains.map((b) => NeuralNetwork.clone(b.network)), { roadWidth: world.roadWidth });
    brains.forEach((b, bi) => {
      const d = makeDriver(task, NeuralNetwork.clone(b.network), world.roadWidth);
      const frames = [];
      while (d.step()) if (frames.length < RECORD_FRAMES) frames.push(frameOf(d.car, d.proj));
      if (frames.length < RECORD_FRAMES) frames.push(frameOf(d.car, d.proj));
      const score = d.score();
      if (Math.abs(score - scores[bi]) > 1e-12) throw new Error(`driver loop drifted from runEpisode on ${doc.tasks[t].id}/${b.name}`);
      episodes.push({
        world: w,
        task: t,
        brain: bi,
        frames,
        final: { age: d.car.age, damaged: d.car.damaged, arrived: d.car.arrived, timedOut: d.car.timedOut, bestProgress: d.car.bestProgress, score },
      });
    });
  });
}

// ---- single steps from arbitrary states (exact to floating point) ----
const rng = createRng(4242);
const steps = [];
const { world: w0, tasks: t0 } = worlds[0];
for (let i = 0; i < 200; i++) {
  const task = t0[i % t0.length];
  const route = task.corridor.route;
  const at = route.pointAt(rng.range(0, route.length));
  const pre = {
    x: at.x + rng.range(-45, 45),
    y: at.y + rng.range(-45, 45),
    angle: rng.range(-Math.PI, Math.PI),
    speed: rng.range(-1.6, 3.2),
    controls: [rng.chance(0.6), rng.chance(0.3), rng.chance(0.3), rng.chance(0.15)].map(Number),
    routeHint: 0,
  };
  const brainIndex = i % brains.length;
  const car = new Car({ x: pre.x, y: pre.y, angle: pre.angle, maxSpeed: EPISODE.maxSpeed, turnRate: CITY_TURN_RATE, sensor: CAR_SENSOR, brain: NeuralNetwork.clone(brains[brainIndex].network) });
  car.speed = pre.speed;
  [car.controls.forward, car.controls.left, car.controls.right, car.controls.reverse] = pre.controls.map(Boolean);
  // a full route scan for the hint, so the projection is well defined from a random place
  const proj = route.project(car, Math.floor(route.points.length / 2), route.points.length);
  const t = route.pointAt(proj.progress + EPISODE.lookahead);
  car.setTarget(t.x, t.y, ((proj.side ?? 1) * proj.distance) / (w0.roadWidth / 2));
  car.update({ grid: task.corridor.grid });
  steps.push({
    task: i % t0.length,
    brain: brainIndex,
    pre,
    projection: { progress: proj.progress, distance: proj.distance, index: proj.index, side: proj.side },
    target: [t.x, t.y],
    post: frameOf(car, proj),
  });
}

const fixture = {
  generatedBy: 'tools/car-parity-fixtures.mjs',
  recordFrames: RECORD_FRAMES,
  worlds: worlds.map((w) => w.doc),
  brains: brains.map((b) => ({ name: b.name, network: b.network })),
  episodes,
  steps,
};
const out = path.join(root, 'trainer/sim-cpp/tests/fixtures/car-parity.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(fixture));
const ends = episodes.map((e) => (e.final.arrived ? 'arrived' : e.final.damaged ? 'crashed' : 'stalled'));
console.log(`wrote ${path.relative(root, out)}: ${episodes.length} episodes (${ends.filter((e) => e === 'arrived').length} arrived, ${ends.filter((e) => e === 'crashed').length} crashed, ${ends.filter((e) => e === 'stalled').length} stalled), ${steps.length} single steps, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
