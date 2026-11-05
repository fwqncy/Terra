// Shared helpers for Terra Trainer tools. The browser engine stays the source of truth:
// worlds, corridors and routes are built here with it, then exported for the C++ sim.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const E = path.join(root, 'web/src/engine');
const imp = (p) => import(path.join(E, p));

export const { Graph } = await imp('graph.js');
export const { World } = await imp('world.js');
export const { Car, angleFromDirection } = await imp('ai/car.js');
export const { NeuralNetwork } = await imp('ai/network.js');
export const { CAR_SENSOR, CITY_TURN_RATE } = await imp('sim/city-sim.js');
export const { bootcamp, runEpisode } = await imp('sim/bootcamp.js');
export const { createRng } = await imp('math/rng.js');
export const { getNearestSegment } = await imp('math/utils.js');
export const { FACTORY_BRAINS } = await imp('data/brains.js');

export const MAPS = ['brisbane', 'goldcoast', 'sydney', 'melbourne'];

/** Episode constants, identical to bootcamp.js `runEpisode` defaults. */
export const EPISODE = { maxSpeed: 3.2, lookahead: 160, stallLimit: 220, maxFrames: 60 * 90 };
export const GRID_CELL = 300;

export async function loadWorld(id) {
  const data = (await imp(`data/maps/${id}.js`)).default;
  return new World(Graph.fromCompact(data)).generate();
}

/** Suggested Start/Target pairs from a fixed seed sequence (same generator the app uses). */
export function suggestTasks(world, count, seed0 = 1) {
  const tasks = [];
  for (let seed = seed0; tasks.length < count && seed < seed0 + count * 20; seed++) {
    const r = world.suggestRoute(createRng(seed));
    if (!r) continue;
    const corridor = world.generateCorridor(r.start.center, r.target.center, r.start.directionVector);
    if (corridor) tasks.push({ seed, start: r.start, target: r.target, corridor });
  }
  return tasks;
}

const flatSegs = (segs) => segs.flatMap((s) => [s.p1.x, s.p1.y, s.p2.x, s.p2.y]);

/**
 * One task in the trainer world format. Coordinates keep full double precision (parity needs it).
 * `routeSegments[i]` is the graph segment index under route polyline segment i (for crash hotspots).
 */
export function exportTask(world, task, id) {
  const pts = task.corridor.route.points;
  const routeSegments = [];
  for (let i = 1; i < pts.length; i++) {
    const mid = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
    routeSegments.push(world.graph.segments.indexOf(getNearestSegment(mid, world.graph.segments)));
  }
  return {
    id,
    seed: task.seed,
    start: { x: task.start.center.x, y: task.start.center.y, angle: angleFromDirection(task.start.directionVector) },
    route: pts.map((p) => [p.x, p.y]),
    routeLength: task.corridor.route.length,
    routeSegments,
    borders: flatSegs(task.corridor.borders),
  };
}

export function exportWorld(id, world, tasks, { split = 0 } = {}) {
  return {
    format: 'terra-trainer-world',
    version: 1,
    generatedBy: 'tools/export-trainer-worlds.mjs',
    map: id,
    roadWidth: world.roadWidth,
    gridCell: GRID_CELL,
    episode: EPISODE,
    sensor: { rayCount: CAR_SENSOR.rayCount, rayLength: CAR_SENSOR.rayLength, raySpread: CAR_SENSOR.raySpread },
    car: { width: 30, height: 50, acceleration: 0.2, friction: 0.05, turnRate: CITY_TURN_RATE, maxSpeed: EPISODE.maxSpeed },
    network: [CAR_SENSOR.rayCount + 3, 8, 4],
    graphSegments: flatSegs(world.graph.segments),
    tasks: tasks.map((t, i) => ({ ...exportTask(world, t, `${id}-${i}`), holdout: i >= tasks.length - split })),
  };
}

/**
 * A car driving one task with exactly the loop in bootcamp.js `runEpisode`, one frame at a time,
 * so tools can record every frame. `score()` matches runEpisode's per-car score.
 */
export function makeDriver(task, brain, roadWidth = 100) {
  const { route, grid } = task.corridor;
  const car = new Car({
    x: task.start.center.x,
    y: task.start.center.y,
    angle: angleFromDirection(task.start.directionVector),
    maxSpeed: EPISODE.maxSpeed,
    turnRate: CITY_TURN_RATE,
    sensor: CAR_SENSOR,
    brain,
    controlType: 'AI',
  });
  let last = null;
  return {
    car,
    /** @returns {boolean} false once the car is done */
    step() {
      if (car.done) return false;
      const proj = route.project(car, car.routeHint, 4);
      car.routeHint = proj.index;
      if (proj.progress > car.bestProgress + 0.5) {
        car.bestProgress = proj.progress;
        car.idleFrames = 0;
      } else car.idleFrames++;
      const t = route.pointAt(proj.progress + EPISODE.lookahead);
      car.setTarget(t.x, t.y, ((proj.side ?? 1) * proj.distance) / (roadWidth / 2));
      car.update({ grid });
      last = proj;
      if (car.damaged) return false;
      if (route.length - proj.progress < roadWidth * 0.6) {
        car.arrived = true;
        return false;
      }
      if (car.idleFrames > EPISODE.stallLimit) car.timedOut = true;
      // runEpisode stops its frame loop at maxFrames; the car is left undone and scored on progress
      return !car.done && car.age < EPISODE.maxFrames;
    },
    get proj() {
      return last;
    },
    score() {
      return car.arrived ? 1 + Math.max(0, 1 - car.age / 6000) * 0.25 : car.bestProgress / route.length;
    },
  };
}

/** Random brain from a seeded RNG, built the same way a Car builds one. */
export function randomBrain(seed) {
  return new NeuralNetwork([CAR_SENSOR.rayCount + 3, 8, 4], createRng(seed).next);
}
