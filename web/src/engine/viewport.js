import { Point } from './primitives/point.js';

/**
 * Pan/zoom camera for a 2D canvas. zoom > 1 means zoomed out (world units per CSS pixel).
 * Mouse wheel zooms toward the cursor; drag pans with the middle button, Space+drag,
 * or any drag when `panMode` is on (touch default). Two-finger pinch zooms.
 * Keyboard (canvas focused): arrows pan, +/- zoom, 0 fits.
 */
export class Viewport {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{zoom?:number, minZoom?:number, maxZoom?:number, offset?:Point|null}} [opts]
   */
  constructor(canvas, { zoom = 1, minZoom = 0.2, maxZoom = 40, offset = null } = {}) {
    this.canvas = canvas;
    this.zoom = zoom;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.offset = offset ?? new Point(0, 0);
    this.panMode = false;
    this.isPanning = false;
    this.spaceDown = false;
    this.pointers = new Map();
    this.pinch = null;
    this.onChange = null;
    this.#bind();
  }

  get width() {
    return this.canvas.clientWidth || this.canvas.width;
  }

  get height() {
    return this.canvas.clientHeight || this.canvas.height;
  }

  get center() {
    return new Point(this.width / 2, this.height / 2);
  }

  /** World position under a pointer/mouse event. */
  getMouse(evt) {
    const rect = this.canvas.getBoundingClientRect();
    return this.screenToWorld(evt.clientX - rect.left, evt.clientY - rect.top);
  }

  screenToWorld(sx, sy) {
    const c = this.center;
    return new Point((sx - c.x) * this.zoom - this.offset.x, (sy - c.y) * this.zoom - this.offset.y);
  }

  worldToScreen(p) {
    const c = this.center;
    return new Point((p.x + this.offset.x) / this.zoom + c.x, (p.y + this.offset.y) / this.zoom + c.y);
  }

  /**
   * Clears and applies the camera transform (handles devicePixelRatio).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [dpr]
   * @param {string|null} [background]
   */
  reset(ctx, dpr = window.devicePixelRatio || 1, background = null) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    const c = this.center;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(c.x, c.y);
    ctx.scale(1 / this.zoom, 1 / this.zoom);
    ctx.translate(this.offset.x, this.offset.y);
  }

  /** World-space rectangle currently on screen. */
  visibleBounds(pad = 0) {
    const a = this.screenToWorld(0, 0);
    const b = this.screenToWorld(this.width, this.height);
    return { minX: a.x - pad, minY: a.y - pad, maxX: b.x + pad, maxY: b.y + pad };
  }

  /** The world point at the centre of the screen (used for fake-3D parallax). */
  viewPoint() {
    return new Point(-this.offset.x, -this.offset.y);
  }

  lookAt(x, y) {
    this.offset.x = -x;
    this.offset.y = -y;
    this.onChange?.();
  }

  zoomBy(factor, sx = this.width / 2, sy = this.height / 2) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const c = this.center;
    this.offset.x = (sx - c.x) * this.zoom - before.x;
    this.offset.y = (sy - c.y) * this.zoom - before.y;
    this.onChange?.();
  }

  /** Fits a world bbox into the canvas. */
  fit(bbox, padding = 40) {
    const w = Math.max(1, bbox.maxX - bbox.minX);
    const h = Math.max(1, bbox.maxY - bbox.minY);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.max(w / Math.max(1, this.width - padding * 2), h / Math.max(1, this.height - padding * 2))));
    this.lookAt((bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2);
  }

  #bind() {
    const c = this.canvas;
    this.handlers = {
      wheel: (e) => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        // trackpad pinch arrives as ctrl+wheel with small deltas
        const intensity = e.ctrlKey ? 0.01 : 0.0015;
        this.zoomBy(Math.exp(e.deltaY * intensity), e.clientX - rect.left, e.clientY - rect.top);
      },
      pointerdown: (e) => {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
          this.isPanning = true;
          return;
        }
        if (e.button === 1 || this.spaceDown || (this.panMode && e.button === 0)) {
          this.isPanning = true;
          c.setPointerCapture?.(e.pointerId);
          e.preventDefault();
        }
      },
      pointermove: (e) => {
        const prev = this.pointers.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY };
        this.pointers.set(e.pointerId, cur);
        if (this.pinch && this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const rect = c.getBoundingClientRect();
          const target = this.pinch.zoom * (this.pinch.dist / Math.max(1, d));
          this.zoomBy(target / this.zoom, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
          return;
        }
        if (this.isPanning) {
          this.offset.x += (cur.x - prev.x) * this.zoom;
          this.offset.y += (cur.y - prev.y) * this.zoom;
          this.onChange?.();
        }
      },
      pointerup: (e) => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size === 0) this.isPanning = false;
      },
      keydown: (e) => {
        if (e.code === 'Space' && document.activeElement === c) {
          this.spaceDown = true;
          e.preventDefault();
          return;
        }
        if (document.activeElement !== c) return;
        const step = 60 * this.zoom;
        const map = {
          ArrowLeft: () => (this.offset.x += step),
          ArrowRight: () => (this.offset.x -= step),
          ArrowUp: () => (this.offset.y += step),
          ArrowDown: () => (this.offset.y -= step),
          Equal: () => this.zoomBy(1 / 1.2),
          NumpadAdd: () => this.zoomBy(1 / 1.2),
          Minus: () => this.zoomBy(1.2),
          NumpadSubtract: () => this.zoomBy(1.2),
        };
        const fn = map[e.code];
        if (fn) {
          e.preventDefault();
          fn();
          this.onChange?.();
        }
      },
      keyup: (e) => {
        if (e.code === 'Space') this.spaceDown = false;
      },
    };
    c.addEventListener('wheel', this.handlers.wheel, { passive: false });
    c.addEventListener('pointerdown', this.handlers.pointerdown);
    window.addEventListener('pointermove', this.handlers.pointermove);
    window.addEventListener('pointerup', this.handlers.pointerup);
    window.addEventListener('pointercancel', this.handlers.pointerup);
    window.addEventListener('keydown', this.handlers.keydown);
    window.addEventListener('keyup', this.handlers.keyup);
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('wheel', this.handlers.wheel);
    c.removeEventListener('pointerdown', this.handlers.pointerdown);
    window.removeEventListener('pointermove', this.handlers.pointermove);
    window.removeEventListener('pointerup', this.handlers.pointerup);
    window.removeEventListener('pointercancel', this.handlers.pointerup);
    window.removeEventListener('keydown', this.handlers.keydown);
    window.removeEventListener('keyup', this.handlers.keyup);
  }
}
