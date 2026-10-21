import { Car, angleFromDirection } from '../ai/car.js';
import { NeuralNetwork } from '../ai/network.js';
import { Trainer } from '../ai/trainer.js';
import { createRng } from '../math/rng.js';
import { BurstLayer, CRASH_WORDS, WIN_WORDS } from '../render/comic.js';
import { Route } from '../route.js';

export const CAR_SENSOR = { rayCount: 7, rayLength: 190, raySpread: Math.PI * 0.62 };
export const CITY_TURN_RATE = 0.05;

/**
 * Self-driving cars in a generated World.
 *  - "train": a population learns the Start → Target route inside its corridor.
 *  - "fleet": the best brain is deployed to many cars making deliveries across the whole map.
 */
export class CitySim {
  /**
   * @param {import('../world.js').World} world
   * @param {{populationSize?:number, mutation?:number, skin?:string, maxSpeed?:number, seed?:number,
   *          onEvent?:(e:{type:string, [k:string]:any})=>void, brain?:any}} opts
   */
  constructor(world, { populationSize = 80, mutation = 0.15, skin = 'ute', maxSpeed = 3.2, seed = 42, onEvent, brain = null } = {}) {
    this.world = world;
    this.populationSize = populationSize;
    this.skin = skin;
    this.maxSpeed = maxSpeed;
    this.rng = createRng(seed);
    this.random = this.rng.next;
    this.onEvent = onEvent ?? (() => {});
    this.trainer = new Trainer({ populationSize, mutation, random: this.random, best: brain });
    this.mode = 'idle';
    this.cars = [];
    this.corridor = null;
    this.frame = 0;
    this.lookahead = world.roadWidth * 1.6;
    this.obeyLights = true;
    this.bursts = new BurstLayer();
    this.deliveries = 0;
    this.stallLimit = 220;
    this.maxFrames = 60 * 90;
  }

  get start() {
    return this.world.markings.find((m) => m.type === 'start');
  }

  get target() {
    return this.world.markings.find((m) => m.type === 'target');
  }

  /** @returns {string|null} a reason when training cannot start */
  canTrain() {
    if (this.world.graph.segments.length === 0) return 'Add some roads first.';
    if (!this.start) return 'Place a Start marking on a lane.';
    if (!this.target) return 'Place a Target marking on a lane.';
    return null;
  }

  startTraining() {
    const reason = this.canTrain();
    if (reason) return reason;
    this.corridor = this.world.generateCorridor(this.start.center, this.target.center, this.start.directionVector);
    if (!this.corridor) return 'Start and Target are not connected by road.';
    this.mode = 'train';
    this.#spawnGeneration();
    return null;
  }

  #spawnGeneration() {
    this.disposeCars();
    const s = this.start;
    const angle = angleFromDirection(s.directionVector);
    this.cars = this.trainer.nextBrains().map(
      (brain) =>
        new Car({
          x: s.center.x,
          y: s.center.y,
          angle,
          maxSpeed: this.maxSpeed,
          turnRate: CITY_TURN_RATE,
          sensor: CAR_SENSOR,
          skin: this.skin,
          brain: brain ?? undefined,
          random: this.random,
        }),
    );
    for (const car of this.cars) {
      car.route = this.corridor.route;
      car.progressOffset = 0;
    }
    this.frame = 0;
  }

  /** Deploys the best brain to a fleet of delivery cars on random routes. */
  deployFleet(count = 12) {
    if (!this.trainer.best) return 'Train at least one generation first.';
    if (this.world.graph.points.length < 2) return 'The map needs at least two intersections.';
    this.disposeCars();
    this.mode = 'fleet';
    this.corridor = null;
    this.cars = [];
    for (let i = 0; i < count; i++) {
      const car = this.#fleetCar();
      if (car) this.cars.push(car);
    }
    return null;
  }

  /** A delivery car on a fresh random route, with its own corridor (same conditions it trained in). */
  #fleetCar() {
    const pick = this.world.suggestRoute(this.rng, { min: 1200, max: 7000 });
    if (!pick) return null;
    const corridor = this.world.generateCorridor(pick.start.center, pick.target.center, pick.start.directionVector);
    if (!corridor) return null;
    const car = new Car({
      x: pick.start.center.x,
      y: pick.start.center.y,
      angle: angleFromDirection(pick.start.directionVector),
      maxSpeed: this.maxSpeed,
      turnRate: CITY_TURN_RATE,
      sensor: CAR_SENSOR,
      skin: this.skin,
      brain: NeuralNetwork.clone(this.trainer.best),
    });
    car.route = corridor.route;
    car.corridor = corridor;
    car.target = pick.target;
    return car;
  }

  stop() {
    this.mode = 'idle';
    this.disposeCars();
    this.corridor = null;
  }

  disposeCars() {
    for (const car of this.cars) car.dispose();
    this.cars = [];
  }

  /** Advances one physics frame. */
  step() {
    this.world.updateLights();
    this.bursts.update(1 / 60);
    if (this.mode === 'train') this.#stepTraining();
    else if (this.mode === 'fleet') this.#stepFleet();
  }

  #trackRoute(car) {
    const proj = car.route.project(car, car.routeHint, 4);
    car.routeHint = proj.index;
    const progress = proj.progress;
    if (progress > car.bestProgress + 0.5) {
      car.bestProgress = progress;
      car.idleFrames = 0;
    } else {
      car.idleFrames++;
    }
    const t = car.route.pointAt(progress + this.lookahead);
    car.setTarget(t.x, t.y, ((proj.side ?? 1) * proj.distance) / (this.world.roadWidth / 2));
    return progress;
  }

  #stepTraining() {
    const lights = this.obeyLights ? this.world.redLightBorders() : undefined;
    let alive = 0;
    for (const car of this.cars) {
      if (car.done) continue;
      const progress = this.#trackRoute(car);
      car.update({ grid: this.corridor.grid, segments: lights });
      if (car.damaged) {
        car.fitness = car.bestProgress;
        if (car === this.leader() || this.random() < 0.08) this.bursts.add(car.x, car.y, this.rng.pick(CRASH_WORDS), 46);
        continue;
      }
      if (car.route.length - progress < this.world.roadWidth * 0.6) {
        car.arrived = true;
        car.fitness = car.route.length + Math.max(0, 4000 - car.age);
        this.bursts.add(car.x, car.y, this.rng.pick(WIN_WORDS), 54);
        this.onEvent({ type: 'delivery', mode: 'road', distance: car.route.length, training: true });
        continue;
      }
      if (car.idleFrames > this.stallLimit) car.timedOut = true;
      car.fitness = car.bestProgress;
      alive++;
    }
    this.frame++;
    if (alive === 0 || this.frame > this.maxFrames) {
      const entry = this.trainer.evaluate(this.cars);
      this.onEvent({ type: 'generation', ...entry, routeLength: this.corridor.route.length });
      this.#spawnGeneration();
    }
  }

  #stepFleet() {
    const lights = this.obeyLights ? this.world.redLightBorders() : undefined;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (!car.done) {
        const progress = this.#trackRoute(car);
        car.update({ grid: car.corridor.grid, segments: lights });
        if (car.route.length - progress < this.world.roadWidth * 0.6) {
          car.arrived = true;
          this.deliveries++;
          this.bursts.add(car.x, car.y, 'KA-CHING!', 44);
          this.onEvent({ type: 'delivery', mode: 'road', distance: car.route.length, training: false });
        } else if (car.damaged) {
          this.bursts.add(car.x, car.y, this.rng.pick(CRASH_WORDS), 40);
          this.onEvent({ type: 'crash', mode: 'road' });
        } else if (car.idleFrames > this.stallLimit * 2) {
          car.timedOut = true;
        }
      } else {
        car.respawnIn = (car.respawnIn ?? 90) - 1;
        if (car.respawnIn <= 0) {
          car.dispose();
          this.cars[i] = this.#fleetCar() ?? car;
        }
      }
    }
  }

  /** The car the camera follows: furthest progress among those still driving, else overall best. */
  leader() {
    let alive = null;
    let any = null;
    for (const car of this.cars) {
      if (!any || car.bestProgress > any.bestProgress) any = car;
      if (!car.done && (!alive || car.bestProgress > alive.bestProgress)) alive = car;
    }
    return alive ?? any;
  }

  stats() {
    const alive = this.cars.filter((c) => !c.done).length;
    const crashed = this.cars.filter((c) => c.damaged).length;
    const arrived = this.cars.filter((c) => c.arrived).length;
    const leader = this.leader();
    const routeLength = this.corridor?.route.length ?? 0;
    return {
      mode: this.mode,
      generation: this.trainer.generation,
      population: this.cars.length,
      alive,
      crashed,
      arrived,
      bestFitness: this.trainer.bestFitness,
      leaderProgress: routeLength && leader ? Math.min(1, leader.bestProgress / routeLength) : 0,
      routeLength,
      deliveries: this.deliveries,
      history: this.trainer.history,
    };
  }

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx, palette, { time = 0, showSensors = true } = {}) {
    const leader = this.leader();
    if (this.mode === 'fleet') {
      for (const car of this.cars) {
        car.route.draw(ctx, { color: 'rgba(242,193,78,0.3)', width: 6, dash: [10, 12] });
        car.target?.draw(ctx, palette);
      }
      for (const car of this.cars) car.draw(ctx, palette, { time, drawSensor: false, alpha: car.done ? 0.4 : 1 });
    } else {
      for (const car of this.cars) if (car !== leader) car.draw(ctx, palette, { time, alpha: car.done ? 0.12 : 0.28 });
      leader?.draw(ctx, palette, { time, drawSensor: showSensors });
      if (leader) {
        ctx.save();
        ctx.fillStyle = palette.warn;
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 4;
        ctx.font = '900 22px "Bangers", "Archivo", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeText('LEADER', leader.x, leader.y - 46);
        ctx.fillText('LEADER', leader.x, leader.y - 46);
        ctx.restore();
      }
    }
    this.bursts.draw(ctx, palette);
  }
}

