import { getNearestSegment } from '../math/utils.js';
import { MARKING_TYPES } from '../markings/markings.js';

/**
 * Places road markings that snap to lanes (or to road centre lines for crossings).
 * Start and Target are unique: placing a new one replaces the old.
 */
export class MarkingEditor {
  /**
   * @param {import('../viewport.js').Viewport} viewport
   * @param {import('../world.js').World} world
   * @param {keyof typeof MARKING_TYPES} type
   * @param {{onChange?:() => void}} [opts]
   */
  constructor(viewport, world, type, { onChange } = {}) {
    this.viewport = viewport;
    this.canvas = viewport.canvas;
    this.world = world;
    this.type = type;
    this.onChange = onChange;
    this.intent = null;
    this.enabled = false;
  }

  get targetSegments() {
    return this.type === 'crossing' ? this.world.graph.segments : this.world.laneGuides;
  }

  createMarking(center, dir) {
    const w = this.world.roadWidth;
    const Ctor = MARKING_TYPES[this.type];
    if (this.type === 'crossing') return new Ctor(center, dir, w, w / 2);
    return new Ctor(center, dir, w / 2, w / 2);
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.h = {
      down: (e) => this.#down(e),
      move: (e) => this.#move(e),
      ctx: (e) => e.preventDefault(),
    };
    this.canvas.addEventListener('pointerdown', this.h.down);
    this.canvas.addEventListener('pointermove', this.h.move);
    this.canvas.addEventListener('contextmenu', this.h.ctx);
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.canvas.removeEventListener('pointerdown', this.h.down);
    this.canvas.removeEventListener('pointermove', this.h.move);
    this.canvas.removeEventListener('contextmenu', this.h.ctx);
    this.intent = null;
  }

  #move(evt) {
    const mouse = this.viewport.getMouse(evt);
    const seg = getNearestSegment(mouse, this.targetSegments, 14 * this.viewport.zoom);
    if (!seg) {
      this.intent = null;
      return;
    }
    const proj = seg.projectPoint(mouse);
    this.intent = proj.offset >= 0 && proj.offset <= 1 ? this.createMarking(proj.point, seg.directionVector()) : null;
  }

  #down(evt) {
    if (this.viewport.isPanning || this.viewport.spaceDown || this.viewport.panMode) return;
    if (evt.button === 0 && this.intent) {
      if (this.type === 'start' || this.type === 'target') {
        this.world.markings = this.world.markings.filter((m) => m.type !== this.type);
      }
      this.world.markings.push(this.intent);
      this.intent = null;
      this.world.markingsChanged();
      this.onChange?.();
    }
    if (evt.button === 2) {
      const mouse = this.viewport.getMouse(evt);
      const idx = this.world.markings.findIndex((m) => m.poly.containsPoint(mouse));
      if (idx >= 0) {
        this.world.markings.splice(idx, 1);
        this.world.markingsChanged();
        this.onChange?.();
      }
    }
  }

  dispose() {
    this.disable();
  }

  display(ctx, palette) {
    if (!this.intent) return;
    ctx.globalAlpha = 0.7;
    this.intent.draw(ctx, palette);
    ctx.globalAlpha = 1;
  }
}
