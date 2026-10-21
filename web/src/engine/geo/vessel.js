import { NeuralNetwork } from '../ai/network.js';
import { Sensor } from '../ai/sensor.js';
import { getIntersection, wrapAngle } from '../math/utils.js';

const scratch = [];

/** Physical profiles. Units: 1 ≈ 1.1 km; speeds are per simulation frame. */
export const VESSELS = {
  ship: {
    label: 'Container ship',
    cruise: 0.85,
    slow: 0.4,
    turnRate: 0.032,
    length: 1.4,
    width: 0.5,
    sensor: { rayCount: 7, rayLength: 14, raySpread: Math.PI * 0.85 },
    arriveWithin: 3,
    laneHalfWidth: 6,
    hidden: 8,
  },
  plane: {
    label: 'Freighter jet',
    cruise: 2.4,
    slow: 1.6,
    turnRate: 0.045,
    length: 1.2,
    width: 1.2,
    sensor: { rayCount: 7, rayLength: 75, raySpread: Math.PI * 0.9 },
    arriveWithin: 8,
    laneHalfWidth: 35,
    hidden: 8,
  },
};

export const VESSEL_EXTRAS = 3; // bearing to route, lateral offset, throttle

/** A ship or plane with ray sensors and a small brain: outputs [left, right, slow]. */
export class Vessel {
  /**
   * @param {{kind:'ship'|'plane', x:number, y:number, angle:number, brain?:any, random?:()=>number}} opts
   */
  constructor({ kind, x, y, angle, brain, random = Math.random }) {
    this.kind = kind;
    this.spec = VESSELS[kind];
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = this.spec.cruise;
    this.damaged = false;
    this.arrived = false;
    this.timedOut = false;
    this.sensor = new Sensor(this.spec.sensor);
    const inputs = this.sensor.rayCount + VESSEL_EXTRAS;
    this.brain = brain && NeuralNetwork.shape(brain)[0] === inputs ? brain : new NeuralNetwork([inputs, this.spec.hidden, 3], random);
    this.extras = [0, 0, 1];
    this.controls = { left: false, right: false, slow: false };
    this.fitness = 0;
    this.bestProgress = 0;
    this.routeHint = 0;
    this.idleFrames = 0;
    this.age = 0;
    this.trail = [];
    this.hull = this.#hull();
  }

  get done() {
    return this.damaged || this.arrived || this.timedOut;
  }

  setTarget(tx, ty, lateral) {
    const fx = -Math.sin(this.angle);
    const fy = -Math.cos(this.angle);
    const vx = tx - this.x;
    const vy = ty - this.y;
    const rel = Math.atan2(fx * vy - fy * vx, fx * vx + fy * vy);
    this.extras[0] = Math.max(-1, Math.min(1, wrapAngle(rel) / (Math.PI / 4)));
    this.extras[1] = Math.max(-1, Math.min(1, lateral));
    this.extras[2] = this.speed / this.spec.cruise;
  }

  /**
   * @param {{grid?: import('../math/segment-grid.js').SegmentGrid, circles?: {x:number,y:number,r:number}[]}} env
   */
  update(env) {
    if (this.done) return;
    const s = this.spec;
    this.speed = this.controls.slow ? s.slow : s.cruise;
    if (this.controls.left) this.angle += s.turnRate;
    if (this.controls.right) this.angle -= s.turnRate;
    this.x -= Math.sin(this.angle) * this.speed;
    this.y -= Math.cos(this.angle) * this.speed;
    this.hull = this.#hull();
    this.age++;
    if (this.age % 6 === 0) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 40) this.trail.shift();
    }
    this.damaged = this.#damage(env);
    this.sensor.update(this, { grid: env.grid, circles: env.circles });
    if (!this.damaged) {
      const out = NeuralNetwork.feedForward(this.sensor.values().concat(this.extras), this.brain);
      this.controls.left = out[0] === 1;
      this.controls.right = out[1] === 1;
      this.controls.slow = out[2] === 1;
    }
  }

  #damage({ grid, circles }) {
    if (circles) {
      for (const c of circles) if ((this.x - c.x) ** 2 + (this.y - c.y) ** 2 < c.r * c.r * 0.8) return true;
    }
    if (grid) {
      const h = this.hull;
      for (const seg of grid.queryPoints(h, 0.5, scratch)) {
        for (let i = 0; i < h.length; i++) if (getIntersection(h[i], h[(i + 1) % h.length], seg.p1, seg.p2)) return true;
      }
    }
    return false;
  }

  #hull() {
    const { length, width } = this.spec;
    const fx = -Math.sin(this.angle);
    const fy = -Math.cos(this.angle);
    const rx = -fy;
    const ry = fx;
    const L = length / 2;
    const W = width / 2;
    return [
      { x: this.x + fx * L, y: this.y + fy * L },
      { x: this.x - fx * L + rx * W, y: this.y - fy * L + ry * W },
      { x: this.x - fx * L - rx * W, y: this.y - fy * L - ry * W },
    ];
  }

  /**
   * Icons keep a constant on-screen size: `px` is world units per screen pixel (viewport zoom).
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx, palette, px, { alpha = 1, leader = false, sensors = false } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (this.trail.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (const p of this.trail) ctx.lineTo(p.x, p.y);
      ctx.lineTo(this.x, this.y);
      ctx.strokeStyle = this.kind === 'plane' ? 'rgba(255,255,255,0.55)' : 'rgba(200,199,147,0.5)';
      ctx.lineWidth = (this.kind === 'plane' ? 2 : 3) * px;
      ctx.setLineDash(this.kind === 'plane' ? [] : [4 * px, 4 * px]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (sensors) this.sensor.draw(ctx, { color: palette.warn, hitColor: 'rgba(0,0,0,0.5)', width: 1.5 * px });
    ctx.translate(this.x, this.y);
    ctx.rotate(-this.angle);
    const size = (leader ? 18 : 13) * px;
    ctx.scale(size / 20, size / 20);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0c0a08';
    const body = this.damaged ? '#777' : leader ? palette.warn : this.kind === 'plane' ? '#F4F1EA' : palette.danger;
    ctx.fillStyle = body;
    ctx.beginPath();
    if (this.kind === 'plane') {
      // fuselage + wings + tail, pointing up
      ctx.moveTo(0, -11);
      ctx.quadraticCurveTo(2.2, -8, 2, -2);
      ctx.lineTo(11, 3);
      ctx.lineTo(11, 5);
      ctx.lineTo(2, 3);
      ctx.lineTo(1.5, 8);
      ctx.lineTo(5, 11);
      ctx.lineTo(5, 12);
      ctx.lineTo(0, 11);
      ctx.lineTo(-5, 12);
      ctx.lineTo(-5, 11);
      ctx.lineTo(-1.5, 8);
      ctx.lineTo(-2, 3);
      ctx.lineTo(-11, 5);
      ctx.lineTo(-11, 3);
      ctx.lineTo(-2, -2);
      ctx.quadraticCurveTo(-2.2, -8, 0, -11);
    } else {
      // hull with containers
      ctx.moveTo(0, -12);
      ctx.quadraticCurveTo(5, -6, 5, 0);
      ctx.lineTo(5, 10);
      ctx.lineTo(-5, 10);
      ctx.lineTo(-5, 0);
      ctx.quadraticCurveTo(-5, -6, 0, -12);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (this.kind === 'ship') {
      const boxes = [palette.primary, palette.light, palette.accent];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = boxes[i];
        ctx.fillRect(-3.5, -3 + i * 4, 7, 3.4);
        ctx.strokeRect(-3.5, -3 + i * 4, 7, 3.4);
      }
    }
    ctx.restore();
  }
}
