import { add, angle, perpendicular, scale, translate } from '../math/utils.js';
import { Envelope } from '../primitives/envelope.js';
import { Point } from '../primitives/point.js';
import { Segment } from '../primitives/segment.js';
import { drawCarShape } from '../render/skins.js';

/** Canvas rotation that turns "up" (-y) into direction `d`. */
export const headingRotation = (d) => Math.atan2(d.x, -d.y);

/** Base class: a rectangle laid along a lane at `center`, facing `directionVector`. */
export class Marking {
  constructor(center, directionVector, width, height) {
    this.center = center;
    this.directionVector = directionVector;
    this.width = width;
    this.height = height;
    this.support = new Segment(
      translate(center, angle(directionVector), height / 2),
      translate(center, angle(directionVector), -height / 2),
    );
    this.poly = new Envelope(this.support, width, 0).poly;
    this.type = 'marking';
    /** @type {Segment[]} segments that block cars (e.g. red lights) */
    this.borders = [];
  }

  toJSON() {
    return {
      type: this.type,
      center: { x: this.center.x, y: this.center.y },
      directionVector: { x: this.directionVector.x, y: this.directionVector.y },
      width: this.width,
      height: this.height,
    };
  }

  draw(ctx, palette) {
    this.poly.draw(ctx, { fill: palette.accent, stroke: palette.ink });
  }

  _text(ctx, text, color, sizeFactor = 0.3) {
    ctx.save();
    ctx.translate(this.center.x, this.center.y);
    ctx.rotate(headingRotation(this.directionVector));
    ctx.scale(1, 3);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `900 ${this.height * sizeFactor}px "Archivo", system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 1);
    ctx.restore();
  }
}

export class Stop extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.border = this.poly.segments[2];
    this.type = 'stop';
  }

  draw(ctx, palette) {
    this.border.draw(ctx, { width: 6, color: palette.light });
    this._text(ctx, 'STOP', palette.light);
  }
}

export class Yield extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.border = this.poly.segments[2];
    this.type = 'yield';
  }

  draw(ctx, palette) {
    this.border.draw(ctx, { width: 6, color: palette.light, dash: [12, 10] });
    this._text(ctx, 'GIVE WAY', palette.light, 0.2);
  }
}

export class Crossing extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.borders = [];
    this.type = 'crossing';
  }

  draw(ctx, palette) {
    const perp = perpendicular(this.directionVector);
    const line = new Segment(add(this.center, scale(perp, this.width / 2)), add(this.center, scale(perp, -this.width / 2)));
    line.draw(ctx, { width: this.height, color: palette.light, dash: [11, 11] });
  }
}

export class Parking extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = 'parking';
  }

  draw(ctx, palette) {
    for (const seg of [this.poly.segments[0], this.poly.segments[2]]) seg.draw(ctx, { width: 5, color: palette.light });
    this._text(ctx, 'P', palette.light, 0.9);
  }
}

export class Start extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = 'start';
  }

  draw(ctx, palette) {
    ctx.save();
    ctx.translate(this.center.x, this.center.y);
    ctx.rotate(headingRotation(this.directionVector));
    ctx.globalAlpha = 0.85;
    drawCarShape(ctx, 30, 50, 'ghost', palette);
    ctx.restore();
    this._text(ctx, 'START', palette.warn, 0.12);
  }
}

export class Target extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, height);
    this.type = 'target';
  }

  draw(ctx, palette) {
    const rings = [this.height * 0.5, this.height * 0.36, this.height * 0.22, this.height * 0.1];
    rings.forEach((r, i) => {
      new Point(this.center.x, this.center.y).draw(ctx, { size: r * 2, color: i % 2 ? palette.light : palette.danger, ink: i === 0 ? palette.ink : null });
    });
  }
}

export class Light extends Marking {
  constructor(center, directionVector, width, height) {
    super(center, directionVector, width, 22);
    this.state = 'off';
    this.border = this.poly.segments[0];
    this.type = 'light';
  }

  draw(ctx, palette) {
    const perp = perpendicular(this.directionVector);
    const line = new Segment(add(this.center, scale(perp, this.width / 2)), add(this.center, scale(perp, -this.width / 2)));
    const green = new Point(line.p1.x + (line.p2.x - line.p1.x) * 0.2, line.p1.y + (line.p2.y - line.p1.y) * 0.2);
    const yellow = new Point(line.p1.x + (line.p2.x - line.p1.x) * 0.5, line.p1.y + (line.p2.y - line.p1.y) * 0.5);
    const red = new Point(line.p1.x + (line.p2.x - line.p1.x) * 0.8, line.p1.y + (line.p2.y - line.p1.y) * 0.8);
    new Segment(red, green).draw(ctx, { width: this.height, cap: 'round', color: '#111' });
    const dim = 'rgba(255,255,255,0.12)';
    green.draw(ctx, { size: this.height * 0.75, color: this.state === 'green' ? palette.success : dim });
    yellow.draw(ctx, { size: this.height * 0.75, color: this.state === 'yellow' ? palette.warn : dim });
    red.draw(ctx, { size: this.height * 0.75, color: this.state === 'red' ? palette.danger : dim });
  }
}

export const MARKING_TYPES = { stop: Stop, yield: Yield, crossing: Crossing, parking: Parking, start: Start, target: Target, light: Light };

export function loadMarking(info) {
  const Ctor = MARKING_TYPES[info.type];
  if (!Ctor) return null;
  return new Ctor(new Point(info.center.x, info.center.y), new Point(info.directionVector.x, info.directionVector.y), info.width, info.height);
}
