import { getNearestPoint } from '../math/utils.js';
import { Segment } from '../primitives/segment.js';
import { withAlpha } from '../render/comic.js';

/**
 * Build roads (or sea lanes, or airways) point by point.
 * Click: add/select a point (auto-connects from the previous selection).
 * Drag: move a point. Right-click: deselect, or delete the hovered point.
 * Keyboard: Escape deselects, Delete/Backspace removes the selection.
 */
export class GraphEditor {
  /**
   * @param {import('../viewport.js').Viewport} viewport
   * @param {import('../graph.js').Graph} graph
   * @param {{onChange?:() => void, snap?:number, pointSize?:number, screenSize?:boolean,
   *          canRemove?:(p:any) => boolean, canMove?:(p:any) => boolean}} [opts]
   *   screenSize: keep points a constant size on screen (charts that zoom across orders of magnitude)
   */
  constructor(viewport, graph, { onChange, snap = 12, pointSize = 18, screenSize = false, canRemove = () => true, canMove = () => true } = {}) {
    this.viewport = viewport;
    this.canvas = viewport.canvas;
    this.graph = graph;
    this.onChange = onChange;
    this.snap = snap;
    this.pointSize = pointSize;
    this.screenSize = screenSize;
    this.canRemove = canRemove;
    this.canMove = canMove;
    this.selected = null;
    this.hovered = null;
    this.dragging = false;
    this.moved = false;
    this.mouse = null;
    this.enabled = false;
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.h = {
      down: (e) => this.#down(e),
      move: (e) => this.#move(e),
      up: () => this.#up(),
      ctx: (e) => e.preventDefault(),
      key: (e) => this.#key(e),
    };
    this.canvas.addEventListener('pointerdown', this.h.down);
    this.canvas.addEventListener('pointermove', this.h.move);
    window.addEventListener('pointerup', this.h.up);
    this.canvas.addEventListener('contextmenu', this.h.ctx);
    this.canvas.addEventListener('keydown', this.h.key);
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.canvas.removeEventListener('pointerdown', this.h.down);
    this.canvas.removeEventListener('pointermove', this.h.move);
    window.removeEventListener('pointerup', this.h.up);
    this.canvas.removeEventListener('contextmenu', this.h.ctx);
    this.canvas.removeEventListener('keydown', this.h.key);
    this.selected = null;
    this.hovered = null;
  }

  #down(evt) {
    if (this.viewport.isPanning || this.viewport.spaceDown || this.viewport.panMode) return;
    const mouse = this.viewport.getMouse(evt);
    if (evt.button === 2) {
      if (this.selected) this.selected = null;
      else if (this.hovered) this.#remove(this.hovered);
      return;
    }
    if (evt.button !== 0) return;
    if (this.hovered) {
      this.#select(this.hovered);
      this.dragging = true;
      this.moved = false;
      return;
    }
    this.graph.addPoint(mouse);
    this.#select(mouse);
    this.hovered = mouse;
    this.onChange?.();
  }

  #move(evt) {
    this.mouse = this.viewport.getMouse(evt);
    this.hovered = getNearestPoint(this.mouse, this.graph.points, this.snap * this.viewport.zoom);
    if (this.dragging && this.selected && this.canMove(this.selected)) {
      this.selected.x = this.mouse.x;
      this.selected.y = this.mouse.y;
      this.moved = true;
    }
  }

  #up() {
    if (this.dragging && this.moved) this.onChange?.();
    this.dragging = false;
  }

  #key(e) {
    if (e.key === 'Escape') this.selected = null;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      e.preventDefault();
      this.#remove(this.selected);
    }
  }

  #select(point) {
    if (this.selected && this.selected !== point) {
      if (this.graph.tryAddSegment(new Segment(this.selected, point))) this.onChange?.();
    }
    this.selected = point;
  }

  #remove(point) {
    if (!this.canRemove(point)) return;
    this.graph.removePoint(point);
    this.hovered = null;
    if (this.selected === point) this.selected = null;
    this.onChange?.();
  }

  dispose() {
    this.disable();
  }

  /** @param {CanvasRenderingContext2D} ctx @param {import('../render/comic.js').Palette} palette */
  display(ctx, palette) {
    const z = this.viewport.zoom;
    const size = this.screenSize ? this.pointSize * z : this.pointSize * Math.max(1, z * 0.6);
    const lineW = this.screenSize ? 2 * z : 3 * Math.max(1, z * 0.5);
    for (const seg of this.graph.segments) seg.draw(ctx, { color: withAlpha(palette.light, 0.9), width: lineW });
    for (const p of this.graph.points) p.draw(ctx, { color: palette.primary, size, ink: palette.mode === 'dark' ? palette.light : palette.ink });
    if (this.hovered) this.hovered.draw(ctx, { color: palette.warn, size, fill: true, ink: palette.ink });
    if (this.selected) {
      const intent = this.hovered ?? this.mouse;
      if (intent) new Segment(this.selected, intent).draw(ctx, { color: palette.warn, width: lineW, dash: [6 * z, 6 * z] });
      this.selected.draw(ctx, { color: palette.warn, size: size * 1.1, outline: palette.ink, ink: palette.ink });
    }
  }
}
