/**
 * Uniform grid over segments. Sensors and collision checks only test the
 * segments in cells they touch, which keeps 100+ agents at 60 fps on real maps.
 */
export class SegmentGrid {
  /** @param {{p1:{x:number,y:number},p2:{x:number,y:number}}[]} segments @param {number} cellSize */
  constructor(segments = [], cellSize = 200) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.segments = [];
    this.stamp = 0;
    this.marks = new Uint32Array(0);
    for (const s of segments) this.insert(s);
  }

  #key(cx, cy) {
    return cx * 73856093 ^ cy * 19349663;
  }

  insert(seg) {
    const id = this.segments.length;
    this.segments.push(seg);
    if (this.marks.length < this.segments.length) {
      const next = new Uint32Array(Math.max(64, this.segments.length * 2));
      next.set(this.marks);
      this.marks = next;
    }
    const cs = this.cellSize;
    const x0 = Math.floor(Math.min(seg.p1.x, seg.p2.x) / cs);
    const x1 = Math.floor(Math.max(seg.p1.x, seg.p2.x) / cs);
    const y0 = Math.floor(Math.min(seg.p1.y, seg.p2.y) / cs);
    const y1 = Math.floor(Math.max(seg.p1.y, seg.p2.y) / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.#key(cx, cy);
        let cell = this.cells.get(k);
        if (!cell) this.cells.set(k, (cell = []));
        cell.push(id);
      }
    }
  }

  /** Segments whose cells overlap the box. Each segment is returned once. */
  query(minX, minY, maxX, maxY, out = []) {
    out.length = 0;
    this.stamp = (this.stamp + 1) >>> 0 || 1;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const y0 = Math.floor(minY / cs), y1 = Math.floor(maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get(this.#key(cx, cy));
        if (!cell) continue;
        for (const id of cell) {
          if (this.marks[id] !== this.stamp) {
            this.marks[id] = this.stamp;
            out.push(this.segments[id]);
          }
        }
      }
    }
    return out;
  }

  queryPoints(points, pad = 0, out = []) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return this.query(minX - pad, minY - pad, maxX + pad, maxY + pad, out);
  }
}
