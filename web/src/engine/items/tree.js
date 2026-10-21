import { getFake3dPoint, lerp, translate } from '../math/utils.js';
import { hashString, createRng } from '../math/rng.js';
import { Polygon } from '../primitives/polygon.js';
import { Point } from '../primitives/point.js';
import { mix } from '../render/comic.js';

const LEVELS = 5;
const SPOKES = 18;

export class Tree {
  constructor(center, size, height = 200) {
    this.center = center;
    this.size = size;
    this.height = height;
    const rng = createRng(hashString(`${Math.round(center.x)}:${Math.round(center.y)}`));
    this.kicks = Array.from({ length: LEVELS }, () => Array.from({ length: SPOKES }, () => rng.range(0.72, 1.12)));
    this.base = this.#level(center, size, 0);
  }

  static load(info) {
    return new Tree(new Point(info.center.x, info.center.y), info.size, info.height);
  }

  toJSON() {
    return { center: { x: this.center.x, y: this.center.y }, size: this.size, height: this.height };
  }

  #level(point, size, level) {
    const rad = size / 2;
    const kicks = this.kicks[level];
    const points = new Array(SPOKES);
    for (let i = 0; i < SPOKES; i++) points[i] = translate(point, (i / SPOKES) * Math.PI * 2, rad * kicks[i]);
    return new Polygon(points);
  }

  draw(ctx, viewPoint, palette) {
    const top = getFake3dPoint(this.center, viewPoint, this.height);
    const ink = palette.mode === 'dark' ? '#0c0a08' : palette.ink;
    const trunk = mix(palette.deep, palette.accent, 0.4);
    for (let level = 0; level < LEVELS; level++) {
      const t = level / (LEVELS - 1);
      const point = new Point(lerp(this.center.x, top.x, t), lerp(this.center.y, top.y, t));
      const poly = this.#level(point, lerp(this.size, 40, t), level);
      poly.draw(ctx, {
        fill: mix(trunk, palette.light, t * 0.75),
        stroke: level === 0 ? ink : 'rgba(0,0,0,0.25)',
        lineWidth: level === 0 ? 3 : 1.5,
        join: 'round',
      });
    }
  }
}
