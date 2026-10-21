import { NeuralNetwork } from '../ai/network.js';
import { Trainer } from '../ai/trainer.js';
import { PLACES, KM_PER_UNIT } from '../geo/geo.js';
import { Vessel, VESSELS } from '../geo/vessel.js';
import { Weather } from '../geo/weather.js';
import { createRng } from '../math/rng.js';
import { BurstLayer } from '../render/comic.js';
import { Route } from '../route.js';

const SEA_CRASH = ['SCRAPE!', 'RUN AGROUND!', 'KRRRK!'];
const AIR_CRASH = ['BRRZZT!', 'TURBULENCE!', 'KA-BOOM!'];

/**
 * Ships (sea) or planes (air) learning to follow lanes you charted, avoiding land or storms.
 * Modes: "train" (one route, genetic population) and "fleet" (best brain flies/sails every route).
 */
export class GeoSim {
  /**
   * @param {'sea'|'air'} domain
   * @param {{coast: import('../geo/geo.js').Coastline, graph: import('../graph.js').Graph, populationSize?:number,
   *          mutation?:number, seed?:number, onEvent?:(e:any)=>void, brain?:any, storms?:number}} opts
   */
  constructor(domain, { coast, graph, populationSize = 60, mutation = 0.15, seed = 5, onEvent, brain = null, storms = 10 }) {
    this.domain = domain;
    this.kind = domain === 'sea' ? 'ship' : 'plane';
    this.spec = VESSELS[this.kind];
    this.coast = coast;
    this.graph = graph;
    this.rng = createRng(seed);
    this.onEvent = onEvent ?? (() => {});
    this.trainer = new Trainer({ populationSize, mutation, random: this.rng.next, best: brain });
    const hub = graph.points.find((p) => p.place?.hub);
    this.weather = domain === 'air' ? new Weather({ seed: seed + 3, count: storms, keepClear: graph.points.filter((p) => p.place) }) : null;
    this.hub = hub;
    this.agents = [];
    this.route = null;
    this.mode = 'idle';
    this.frame = 0;
    this.bursts = new BurstLayer();
    this.deliveries = 0;
    this.lookahead = domain === 'sea' ? 9 : 40;
    this.stallLimit = domain === 'sea' ? 260 : 220;
  }

  pointById(id) {
    return this.graph.points.find((p) => p.id === id);
  }

  destinations() {
    const kind = this.domain;
    return PLACES.filter((p) => p.kind === kind && !p.hub);
  }

  /** @returns {string|null} error message */
  setRoute(fromId, toId) {
    const from = this.pointById(fromId);
    const to = this.pointById(toId);
    if (!from || !to) return 'Pick an origin and a destination.';
    const path = this.graph.getShortestPath(from, to);
    if (path.length < 2) return `No ${this.domain === 'sea' ? 'sea lane' : 'airway'} connects ${fromId} to ${toId}. Chart one in the editor.`;
    this.route = new Route(path);
    this.routeIds = [fromId, toId];
    this.trainer.reset(this.trainer.best);
    return null;
  }

  get routeKm() {
    return this.route ? this.route.length * KM_PER_UNIT : 0;
  }

  startTraining() {
    if (!this.route) return 'Pick a route first.';
    this.mode = 'train';
    this.#spawn();
    return null;
  }

  #spawn() {
    this.weather?.reset();
    const [a, b] = this.route.points;
    const angle = Math.atan2(-(b.x - a.x), -(b.y - a.y));
    this.agents = this.trainer.nextBrains().map(
      (brain) => new Vessel({ kind: this.kind, x: a.x, y: a.y, angle, brain: brain ?? undefined, random: this.rng.next }),
    );
    for (const v of this.agents) v.route = this.route;
    this.frame = 0;
  }

  deployFleet(count = 8) {
    if (!this.trainer.best) return 'Train at least one generation first.';
    this.mode = 'fleet';
    this.weather?.reset();
    this.agents = [];
    for (let i = 0; i < count; i++) {
      const v = this.#fleetVessel();
      if (v) {
        // stagger departures along their routes so the map fills up straight away
        v.delay = i * 25;
        this.agents.push(v);
      }
    }
    return null;
  }

  #fleetVessel() {
    const options = this.destinations();
    for (let i = 0; i < 10; i++) {
      const dest = this.pointById(this.rng.pick(options).id);
      const outbound = this.rng.chance(0.5);
      const path = outbound ? this.graph.getShortestPath(this.hub, dest) : this.graph.getShortestPath(dest, this.hub);
      if (path.length < 2) continue;
      const route = new Route(path);
      const [a, b] = route.points;
      const v = new Vessel({ kind: this.kind, x: a.x, y: a.y, angle: Math.atan2(-(b.x - a.x), -(b.y - a.y)), brain: NeuralNetwork.clone(this.trainer.best) });
      v.route = route;
      v.label = outbound ? dest.id : this.hub.id;
      return v;
    }
    return null;
  }

  stop() {
    this.mode = 'idle';
    this.agents = [];
  }

  #track(v) {
    const proj = v.route.project(v, v.routeHint, 3);
    v.routeHint = proj.index;
    if (proj.progress > v.bestProgress + 0.05) {
      v.bestProgress = proj.progress;
      v.idleFrames = 0;
    } else {
      v.idleFrames++;
    }
    const t = v.route.pointAt(proj.progress + this.lookahead);
    v.setTarget(t.x, t.y, ((proj.side ?? 1) * proj.distance) / this.spec.laneHalfWidth);
    return proj.progress;
  }

  step() {
    this.bursts.update(1 / 60);
    this.weather?.step();
    if (this.mode === 'idle') return;
    const env = { grid: this.domain === 'sea' ? this.coast.grid : undefined, circles: this.weather?.storms };
    let alive = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const v = this.agents[i];
      if (v.delay > 0) {
        v.delay--;
        alive++;
        continue;
      }
      if (v.done) {
        if (this.mode === 'fleet') {
          v.respawn = (v.respawn ?? 120) - 1;
          if (v.respawn <= 0) this.agents[i] = this.#fleetVessel() ?? v;
        }
        continue;
      }
      const progress = this.#track(v);
      v.update(env);
      if (v.damaged) {
        v.fitness = v.bestProgress;
        if (this.mode === 'fleet' || this.rng.chance(0.1)) this.bursts.add(v.x, v.y, this.rng.pick(this.domain === 'sea' ? SEA_CRASH : AIR_CRASH), 30);
        if (this.mode === 'fleet') this.onEvent({ type: 'crash', mode: this.domain });
        continue;
      }
      if (v.route.length - progress < this.spec.arriveWithin) {
        v.arrived = true;
        v.fitness = v.route.length * 1.5 + Math.max(0, 6000 - v.age) * 0.05;
        this.deliveries++;
        this.bursts.add(v.x, v.y, 'DELIVERED!', 34);
        this.onEvent({ type: 'delivery', mode: this.domain, distance: v.route.length * KM_PER_UNIT, training: this.mode === 'train', to: v.route.end.id });
        continue;
      }
      if (v.idleFrames > this.stallLimit) v.timedOut = true;
      v.fitness = v.bestProgress;
      alive++;
    }
    this.frame++;
    if (this.mode === 'train' && (alive === 0 || this.frame > 60 * 120)) {
      const entry = this.trainer.evaluate(this.agents);
      this.onEvent({ type: 'generation', ...entry, routeLength: this.route.length, domain: this.domain });
      this.#spawn();
    }
  }

  leader() {
    let alive = null;
    let any = null;
    for (const v of this.agents) {
      if (!any || v.bestProgress > any.bestProgress) any = v;
      if (!v.done && (!alive || v.bestProgress > alive.bestProgress)) alive = v;
    }
    return alive ?? any;
  }

  stats() {
    const leader = this.leader();
    return {
      mode: this.mode,
      domain: this.domain,
      generation: this.trainer.generation,
      population: this.agents.length,
      alive: this.agents.filter((v) => !v.done).length,
      crashed: this.agents.filter((v) => v.damaged).length,
      arrived: this.agents.filter((v) => v.arrived).length,
      leaderProgress: this.route && leader ? Math.min(1, leader.bestProgress / this.route.length) : 0,
      routeKm: this.routeKm,
      deliveries: this.deliveries,
      bestFitness: this.trainer.bestFitness,
      history: this.trainer.history,
    };
  }

  draw(ctx, palette, px, { time = 0 } = {}) {
    this.weather?.draw(ctx, palette, px, time);
    if (this.route && this.mode !== 'fleet') this.route.draw(ctx, { color: palette.warn, width: 3 * px, dash: [8 * px, 6 * px] });
    const leader = this.leader();
    for (const v of this.agents) {
      if (v.delay > 0) continue;
      if (this.mode === 'fleet') v.draw(ctx, palette, px, { alpha: v.done ? 0.35 : 1 });
      else if (v !== leader) v.draw(ctx, palette, px, { alpha: v.done ? 0.15 : 0.35 });
    }
    if (leader && this.mode === 'train') leader.draw(ctx, palette, px, { leader: true, sensors: true });
    // bursts keep a constant on-screen size
    this.bursts.draw(ctx, palette, px);
  }
}
