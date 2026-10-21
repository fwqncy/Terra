export class Point {
  /** @param {number} x @param {number} y */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  equals(point) {
    return this.x === point.x && this.y === point.y;
  }

  draw(ctx, { size = 18, color = '#000', outline = false, fill = false, ink = null } = {}) {
    const rad = size / 2;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(this.x, this.y, rad, 0, Math.PI * 2);
    ctx.fill();
    if (ink) {
      ctx.lineWidth = Math.max(2, size * 0.12);
      ctx.strokeStyle = ink;
      ctx.stroke();
    }
    if (outline) {
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = typeof outline === 'string' ? outline : '#fff';
      ctx.arc(this.x, this.y, rad * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (fill) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, rad * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = typeof fill === 'string' ? fill : '#fff';
      ctx.fill();
    }
  }
}
