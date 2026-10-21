import { Car, angleFromDirection } from '../ai/car.js';
import { Trainer } from '../ai/trainer.js';
import { createRng } from '../math/rng.js';
import { CAR_SENSOR, CITY_TURN_RATE } from './city-sim.js';

/**
 * Headless multi-route training ("Bootcamp"). Every brain drives every route each generation
 * and is scored on its average normalised progress, so only generalists survive.
 * Runs without a canvas: in Node for the factory brains, or in a Web Worker in the app.
 */
export function runEpisode(corridor, start, brains, { maxSpeed = 3.2, lookahead = 160, roadWidth = 100, stallLimit = 220, maxFrames = 60 * 90 } = {}) {
  const angle = angleFromDirection(start.directionVector);
  const cars = brains.map((brain) => {
    const c = new Car({ x: start.center.x, y: start.center.y, angle, maxSpeed, turnRate: CITY_TURN_RATE, sensor: CAR_SENSOR, brain, controlType: 'AI' });
    return c;
  });
  const route = corridor.route;
  for (let frame = 0; frame < maxFrames; frame++) {
    let alive = 0;
    for (const car of cars) {
      if (car.done) continue;
      const proj = route.project(car, car.routeHint, 4);
      car.routeHint = proj.index;
      if (proj.progress > car.bestProgress + 0.5) {
        car.bestProgress = proj.progress;
        car.idleFrames = 0;
      } else car.idleFrames++;
      const t = route.pointAt(proj.progress + lookahead);
      car.setTarget(t.x, t.y, ((proj.side ?? 1) * proj.distance) / (roadWidth / 2));
      car.update({ grid: corridor.grid });
      if (car.damaged) continue;
      if (route.length - proj.progress < roadWidth * 0.6) {
        car.arrived = true;
        continue;
      }
      if (car.idleFrames > stallLimit) car.timedOut = true;
      alive++;
    }
    if (!alive) break;
  }
  return cars.map((c) => (c.arrived ? 1 + Math.max(0, 1 - c.age / 6000) * 0.25 : c.bestProgress / route.length));
}

/**
 * @param {{world: import('../world.js').World, start: any, target: any}[]} tasks
 * @param {{generations?:number, populationSize?:number, seed?:number, brain?:any, onGeneration?:(e:any)=>void}} opts
 */
export function bootcamp(tasks, { generations = 40, populationSize = 60, seed = 9, brain = null, onGeneration } = {}) {
  const rng = createRng(seed);
  const trainer = new Trainer({ populationSize, mutation: 0.12, random: rng.next, best: brain });
  const prepared = tasks
    .map((t) => ({ ...t, corridor: t.world.generateCorridor(t.start.center, t.target.center, t.start.directionVector) }))
    .filter((t) => t.corridor);
  for (let g = 0; g < generations; g++) {
    // materialise random brains once so every route sees the same individual
    const brains = trainer.nextBrains().map((b) => b ?? new Car({ x: 0, y: 0, sensor: CAR_SENSOR, random: rng.next }).brain);
    const totals = new Array(brains.length).fill(0);
    let arrivals = 0;
    for (const t of prepared) {
      const scores = runEpisode(t.corridor, t.start, brains, { roadWidth: t.world.roadWidth });
      scores.forEach((s, i) => {
        totals[i] += s;
        if (s >= 1) arrivals++;
      });
    }
    const agents = brains.map((b, i) => ({ brain: b, fitness: totals[i] / prepared.length, arrived: false, damaged: false }));
    const entry = trainer.evaluate(agents);
    onGeneration?.({ ...entry, arrivals, routes: prepared.length });
  }
  return trainer;
}
