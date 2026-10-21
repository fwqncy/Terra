import { Car } from '../ai/car.js';
import { Trainer } from '../ai/trainer.js';
import { createRng } from '../math/rng.js';
import { lerp } from '../math/utils.js';
import { BurstLayer, CRASH_WORDS, halftonePattern, mix } from '../render/comic.js';

const INFINITY = 1_000_000;

/** A straight multi-lane motorway (the M1 to the Gold Coast). */
export class Road {
  constructor(x, width, laneCount = 3) {
    this.x = x;
    this.width = width;
    this.laneCount = laneCount;
    this.left = x - width / 2;
    this.right = x + width / 2;
    const top = -INFINITY;
    const bottom = INFINITY;
    this.borders = [
      { p1: { x: this.left, y: top }, p2: { x: this.left, y: bottom } },
      { p1: { x: this.right, y: top }, p2: { x: this.right, y: bottom } },
    ];
  }

  getLaneCenter(index) {
    const laneWidth = this.width / this.laneCount;
    return this.left + laneWidth / 2 + Math.min(index, this.laneCount - 1) * laneWidth;
  }

  draw(ctx, palette, view) {
    const top = view.minY - 200;
    const bottom = view.maxY + 200;
    const asphalt = palette.mode === 'dark' ? mix(palette.deep, palette.ink, 0.2) : mix(palette.accent, palette.ink, 0.45);
    // verge
    ctx.fillStyle = mix(palette.accent, palette.deep, 0.55);
    ctx.fillRect(this.left - 140, top, this.width + 280, bottom - top);
    if (palette.halftone) {
      ctx.fillStyle = halftonePattern(ctx, 'rgba(0,0,0,0.25)', { spacing: 9, radius: 1.8 });
      ctx.fillRect(this.left - 140, top, this.width + 280, bottom - top);
    }
    ctx.fillStyle = asphalt;
    ctx.fillRect(this.left, top, this.width, bottom - top);
    ctx.lineWidth = 5;
    ctx.strokeStyle = palette.light;
    for (let i = 1; i < this.laneCount; i++) {
      const x = lerp(this.left, this.right, i / this.laneCount);
      ctx.setLineDash([22, 26]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 7;
    ctx.strokeStyle = palette.mode === 'dark' ? '#0c0a08' : palette.ink;
    for (const b of this.borders) {
      ctx.beginPath();
      ctx.moveTo(b.p1.x, top);
      ctx.lineTo(b.p2.x, bottom);
      ctx.stroke();
    }
    // distance signs every ~1500 units
    const start = Math.floor(top / 1500) * 1500;
    ctx.font = '900 20px "Archivo", system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let y = start; y < bottom; y += 1500) {
      const km = Math.max(0, Math.round(78 + y / 150));
      ctx.fillStyle = '#1f6f4a';
      ctx.strokeStyle = '#0c0a08';
      ctx.lineWidth = 3;
      ctx.fillRect(this.right + 22, y - 30, 104, 56);
      ctx.strokeRect(this.right + 22, y - 30, 104, 56);
      ctx.fillStyle = '#F4F1EA';
      ctx.fillText('M1', this.right + 32, y - 8);
      ctx.font = '700 13px "Archivo", system-ui, sans-serif';
      ctx.fillText(`Gold Coast ${km}`, this.right + 32, y + 14);
      ctx.font = '900 20px "Archivo", system-ui, sans-serif';
    }
  }
}

/**
 * The classic self-driving car trainer: dodge dummy traffic on an endless motorway.
 * Fitness is distance travelled north of the start.
 */
export class MotorwaySim {
  /**
   * @param {{populationSize?:number, mutation?:number, skin?:string, seed?:number,
   *          onEvent?:(e:any)=>void, brain?:any}} [opts]
   */
  constructor({ populationSize = 120, mutation = 0.12, skin = 'ute', seed = 7, onEvent, brain = null } = {}) {
    this.road = new Road(0, 270, 3);
    this.populationSize = populationSize;
    this.skin = skin;
    this.seed = seed;
    this.onEvent = onEvent ?? (() => {});
    this.trainer = new Trainer({ populationSize, mutation, random: createRng(seed).next, best: brain });
    this.bursts = new BurstLayer();
    this.cars = [];
    this.traffic = [];
    this.frame = 0;
    this.bestPassed = 0;
    this.stall = 0;
    this.running = false;
  }

  start() {
    this.running = true;
    this.#spawn();
  }

  stop() {
    this.running = false;
    for (const c of [...this.cars, ...this.traffic]) c.dispose();
    this.cars = [];
    this.traffic = [];
  }

  #spawn() {
    for (const c of [...this.cars, ...this.traffic]) c.dispose();
    const rng = createRng(this.seed); // same traffic every generation keeps scores comparable
    this.traffic = [];
    let y = -60;
    for (let row = 0; row < 60; row++) {
      y -= rng.range(170, 260);
      const lanes = [0, 1, 2].sort(() => rng.next() - 0.5).slice(0, rng.chance(0.35) ? 2 : 1);
      for (const lane of lanes) {
        this.traffic.push(new Car({ x: this.road.getLaneCenter(lane), y, controlType: 'DUMMY', maxSpeed: 2, skin: rng.pick(['taxi', 'kombi', 'minit', 'ink']) }));
      }
    }
    this.cars = this.trainer.nextBrains().map(
      (brain) =>
        new Car({
          x: this.road.getLaneCenter(1),
          y: 100,
          maxSpeed: 3,
          skin: this.skin,
          sensor: { rayCount: 5, rayLength: 160, raySpread: Math.PI / 2 },
          brain: brain ?? undefined,
          random: this.trainer.random,
        }),
    );
    for (const c of this.cars) c.setTarget(c.x, c.y - 1000, 0);
    this.frame = 0;
    this.bestPassed = 0;
    this.stall = 0;
  }

  step() {
    if (!this.running) return;
    this.bursts.update(1 / 60);
    for (const t of this.traffic) t.update({});
    let alive = 0;
    let mostPassed = 0;
    const near = [];
    for (const car of this.cars) {
      if (car.done) continue;
      near.length = 0;
      for (const t of this.traffic) if (Math.abs(t.y - car.y) < 220) near.push(t);
      car.setTarget(this.road.getLaneCenter(1), car.y - 1000, (car.x - this.road.x) / (this.road.width / 2));
      car.update({ segments: this.road.borders, traffic: near });
      car.passed = this.passedCount(car);
      // overtaking is what counts: tailgating at traffic speed earns almost nothing
      car.fitness = car.passed * 1000 + Math.max(0, 100 - car.y) * 0.05;
      if (car.damaged) {
        if (this.cars.indexOf(car) % 9 === 0) this.bursts.add(car.x, car.y, CRASH_WORDS[this.frame % CRASH_WORDS.length], 40);
        continue;
      }
      mostPassed = Math.max(mostPassed, car.passed);
      alive++;
    }
    if (mostPassed > this.bestPassed) {
      this.bestPassed = mostPassed;
      this.stall = 0;
    } else {
      this.stall++;
    }
    this.frame++;
    if (alive === 0 || this.stall > 900 || this.frame > 60 * 90 || mostPassed >= this.traffic.length) {
      const entry = this.trainer.evaluate(this.cars);
      this.onEvent({ type: 'generation', ...entry, passed: this.bestPassed });
      this.#spawn();
    }
  }

  passedCount(car) {
    if (!car) return 0;
    let n = 0;
    for (const t of this.traffic) if (t.y > car.y + car.height) n++;
    return n;
  }

  leader() {
    let best = null;
    for (const c of this.cars) if (!c.damaged && (!best || c.fitness > best.fitness)) best = c;
    return best ?? this.cars.reduce((a, b) => (a && a.fitness > b.fitness ? a : b), null);
  }

  stats() {
    const leader = this.leader();
    return {
      generation: this.trainer.generation,
      population: this.cars.length,
      alive: this.cars.filter((c) => !c.done).length,
      crashed: this.cars.filter((c) => c.damaged).length,
      distance: leader ? Math.max(0, 100 - leader.y) : 0,
      passed: leader?.passed ?? 0,
      trafficCount: this.traffic.length,
      bestFitness: this.trainer.bestFitness,
      history: this.trainer.history,
    };
  }

  /** @param {CanvasRenderingContext2D} ctx @param {any} palette @param {{minX:number,minY:number,maxX:number,maxY:number}} view @param {{time?:number}} [opts] */
  draw(ctx, palette, view, { time = 0 } = {}) {
    this.road.draw(ctx, palette, view);
    for (const t of this.traffic) if (t.y > view.minY - 100 && t.y < view.maxY + 100) t.draw(ctx, palette, { time });
    const leader = this.leader();
    for (const c of this.cars) if (c !== leader && !c.done) c.draw(ctx, palette, { time, alpha: 0.22 });
    leader?.draw(ctx, palette, { time, drawSensor: true });
    this.bursts.draw(ctx, palette);
  }
}
