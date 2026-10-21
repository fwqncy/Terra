import { getIntersection, polysIntersect, wrapAngle } from '../math/utils.js';
import { drawCarShape } from '../render/skins.js';
import { Controls } from './controls.js';
import { NeuralNetwork } from './network.js';
import { Sensor } from './sensor.js';

const scratch = [];

/** Heading (car angle) that points the car along direction vector d. */
export const angleFromDirection = (d) => Math.atan2(-d.x, -d.y);

export const CAR_INPUT_EXTRAS = 3; // bearing to route, normalised speed, lateral offset from centre line

export class Car {
  /**
   * @param {{x:number,y:number,width?:number,height?:number,controlType?:'KEYS'|'AI'|'DUMMY',angle?:number,maxSpeed?:number,
   *          sensor?:ConstructorParameters<typeof Sensor>[0], hidden?:number, skin?:string, brain?:any, random?:()=>number}} opts
   */
  constructor({ x, y, width = 30, height = 50, controlType = 'AI', angle = 0, maxSpeed = 3, turnRate = 0.03, sensor, hidden = 8, skin = 'ute', brain, random = Math.random }) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.angle = angle;
    this.speed = 0;
    this.acceleration = 0.2;
    this.maxSpeed = maxSpeed;
    this.turnRate = turnRate;
    this.friction = 0.05;
    this.damaged = false;
    this.arrived = false;
    this.timedOut = false;
    this.skin = skin;
    this.useBrain = controlType === 'AI';
    this.controlType = controlType;
    this.extras = [0, 0, 0];
    this.fitness = 0;
    this.bestProgress = 0;
    this.routeHint = 0;
    this.idleFrames = 0;
    this.age = 0;
    if (controlType !== 'DUMMY') {
      this.sensor = new Sensor(sensor);
      const inputs = this.sensor.rayCount + CAR_INPUT_EXTRAS;
      this.brain = brain && NeuralNetwork.shape(brain)[0] === inputs ? brain : new NeuralNetwork([inputs, hidden, 4], random);
    }
    this.controls = new Controls(controlType);
    this.polygon = this.#createPolygon();
  }

  get done() {
    return this.damaged || this.arrived || this.timedOut;
  }

  /**
   * @param {{grid?: import('../math/segment-grid.js').SegmentGrid, segments?: any[], traffic?: Car[]}} env
   */
  update(env) {
    if (!this.done) {
      this.#move();
      this.polygon = this.#createPolygon();
      this.damaged = this.#assessDamage(env);
      this.age++;
    }
    if (this.sensor) {
      this.sensor.update(this, {
        grid: env.grid,
        segments: env.segments,
        polygons: env.traffic?.map((c) => c.polygon),
      });
      if (this.useBrain && !this.done) {
        const inputs = this.sensor.values().concat(this.extras);
        const out = NeuralNetwork.feedForward(inputs, this.brain);
        this.controls.forward = out[0] === 1;
        this.controls.left = out[1] === 1;
        this.controls.right = out[2] === 1;
        this.controls.reverse = out[3] === 1;
      }
    }
  }

  /**
   * Feeds the pure-pursuit target into the extra network inputs.
   * @param {number} lateral signed offset from the route centre line, -1..1 of the half-width
   */
  setTarget(tx, ty, lateral = 0) {
    const fx = -Math.sin(this.angle);
    const fy = -Math.cos(this.angle);
    const vx = tx - this.x;
    const vy = ty - this.y;
    const rel = Math.atan2(fx * vy - fy * vx, fx * vx + fy * vy);
    // saturate at ±45° so small heading errors still register next to the sensors
    this.extras[0] = Math.max(-1, Math.min(1, wrapAngle(rel) / (Math.PI / 4)));
    this.extras[1] = this.speed / this.maxSpeed;
    this.extras[2] = Math.max(-1, Math.min(1, lateral));
  }

  #assessDamage({ grid, segments, traffic }) {
    const poly = this.polygon;
    const check = (s) => {
      for (let i = 0; i < poly.length; i++) {
        if (getIntersection(poly[i], poly[(i + 1) % poly.length], s.p1, s.p2)) return true;
      }
      return false;
    };
    if (grid) {
      for (const s of grid.queryPoints(poly, 2, scratch)) if (check(s)) return true;
    }
    if (segments) for (const s of segments) if (check(s)) return true;
    if (traffic) for (const car of traffic) if (polysIntersect(poly, car.polygon)) return true;
    return false;
  }

  #createPolygon() {
    const rad = Math.hypot(this.width, this.height) / 2;
    const alpha = Math.atan2(this.width, this.height);
    const a = this.angle;
    return [
      { x: this.x - Math.sin(a - alpha) * rad, y: this.y - Math.cos(a - alpha) * rad },
      { x: this.x - Math.sin(a + alpha) * rad, y: this.y - Math.cos(a + alpha) * rad },
      { x: this.x - Math.sin(Math.PI + a - alpha) * rad, y: this.y - Math.cos(Math.PI + a - alpha) * rad },
      { x: this.x - Math.sin(Math.PI + a + alpha) * rad, y: this.y - Math.cos(Math.PI + a + alpha) * rad },
    ];
  }

  #move() {
    const c = this.controls;
    if (c.forward) this.speed += this.acceleration;
    if (c.reverse) this.speed -= this.acceleration;
    if (this.speed > this.maxSpeed) this.speed = this.maxSpeed;
    if (this.speed < -this.maxSpeed / 2) this.speed = -this.maxSpeed / 2;
    if (this.speed > 0) this.speed -= this.friction;
    if (this.speed < 0) this.speed += this.friction;
    if (Math.abs(this.speed) < this.friction) this.speed = 0;
    if (this.speed !== 0) {
      const flip = this.speed > 0 ? 1 : -1;
      if (c.left) this.angle += this.turnRate * flip;
      if (c.right) this.angle -= this.turnRate * flip;
    }
    this.x -= Math.sin(this.angle) * this.speed;
    this.y -= Math.cos(this.angle) * this.speed;
  }

  dispose() {
    this.controls.dispose();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../render/comic.js').Palette} palette
   */
  draw(ctx, palette, { drawSensor = false, time = 0, tint, alpha = 1 } = {}) {
    if (drawSensor && this.sensor) this.sensor.draw(ctx, { color: palette.warn, hitColor: 'rgba(0,0,0,0.6)', width: 2 });
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(-this.angle);
    drawCarShape(ctx, this.width, this.height, this.skin, palette, {
      damaged: this.damaged,
      braking: this.controls.reverse,
      time,
      tint,
    });
    ctx.restore();
  }
}
