import { PLACES, project } from '../geo/geo.js';
import { halftonePattern, mix, withAlpha } from './comic.js';

/**
 * Comic-style nautical/aeronautical chart: ocean, halftone land with ink coastlines,
 * a 5° graticule, lanes and labelled places. `px` = world units per screen pixel.
 */
/** @param {CanvasRenderingContext2D} ctx @param {any} coast @param {any} palette @param {{minX:number,minY:number,maxX:number,maxY:number}} view @param {number} px @param {{time?:number}} [opts] */
export function drawGeoMap(ctx, coast, palette, view, px, { time = 0 } = {}) {
  const dark = palette.mode === 'dark';
  const ocean = dark ? mix(palette.primary, palette.ink, 0.55) : mix(palette.primary, '#ffffff', 0.72);
  const land = dark ? mix(palette.light, palette.deep, 0.25) : mix(palette.light, '#ffffff', 0.25);
  const ink = dark ? '#0c0a08' : palette.ink;

  ctx.fillStyle = ocean;
  ctx.fillRect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
  if (palette.halftone) {
    ctx.save();
    ctx.scale(px, px);
    ctx.fillStyle = halftonePattern(ctx, withAlpha(dark ? palette.accent : palette.primary, 0.22), { spacing: 10, radius: 1.4 });
    ctx.fillRect(view.minX / px, view.minY / px, (view.maxX - view.minX) / px, (view.maxY - view.minY) / px);
    ctx.restore();
  }

  // graticule
  ctx.save();
  ctx.strokeStyle = withAlpha(palette.light, dark ? 0.12 : 0.5);
  ctx.lineWidth = px;
  ctx.fillStyle = withAlpha(dark ? palette.light : palette.ink, 0.5);
  ctx.font = `600 ${11 * px}px "JetBrains Mono", ui-monospace, monospace`;
  for (let lon = 105; lon <= 190; lon += 5) {
    const a = project(lon, 2);
    const b = project(lon, -50);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (a.x > view.minX && a.x < view.maxX) ctx.fillText(`${lon > 180 ? 360 - lon : lon}°${lon > 180 ? 'W' : 'E'}`, a.x + 4 * px, view.minY + 14 * px);
  }
  for (let lat = 0; lat >= -50; lat -= 5) {
    const a = project(105, lat);
    const b = project(190, lat);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (a.y > view.minY && a.y < view.maxY) ctx.fillText(`${Math.abs(lat)}°S`, view.minX + 6 * px, a.y - 4 * px);
  }
  ctx.restore();

  // land
  for (const poly of coast.polygons) {
    const b = poly.bbox;
    if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) continue;
    poly.draw(ctx, { fill: land, stroke: ink, lineWidth: 2 * px, join: 'round' });
  }
  if (palette.halftone) {
    ctx.save();
    for (const poly of coast.polygons) {
      const b = poly.bbox;
      if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) continue;
      if ((b.maxX - b.minX) / px < 30) continue;
      ctx.beginPath();
      poly.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.scale(px, px);
      ctx.fillStyle = halftonePattern(ctx, withAlpha(palette.deep, 0.28), { spacing: 7, radius: 1.5 });
      ctx.fillRect(b.minX / px, b.minY / px, (b.maxX - b.minX) / px, (b.maxY - b.minY) / px);
      ctx.restore();
    }
    ctx.restore();
  }
}

/**
 * Lanes (sea) or airways (air). Air routes are drawn as gentle arcs for readability.
 * @param {CanvasRenderingContext2D} ctx @param {any} graph @param {any} palette @param {number} px
 * @param {{domain?:string, active?:Set<any>|null}} [opts]
 */
export function drawLanes(ctx, graph, palette, px, { domain = 'sea', active = null } = {}) {
  ctx.save();
  const dark = palette.mode === 'dark';
  for (const seg of graph.segments) {
    const on = active?.has(seg);
    ctx.beginPath();
    ctx.moveTo(seg.p1.x, seg.p1.y);
    if (domain === 'air') {
      const mx = (seg.p1.x + seg.p2.x) / 2;
      const my = (seg.p1.y + seg.p2.y) / 2;
      const dx = seg.p2.x - seg.p1.x;
      const dy = seg.p2.y - seg.p1.y;
      ctx.quadraticCurveTo(mx - dy * 0.08, my + dx * 0.08, seg.p2.x, seg.p2.y);
    } else {
      ctx.lineTo(seg.p2.x, seg.p2.y);
    }
    ctx.lineWidth = (on ? 3 : 1.6) * px;
    ctx.strokeStyle = on ? palette.warn : withAlpha(dark ? palette.light : palette.ink, 0.45);
    ctx.setLineDash(domain === 'sea' ? [6 * px, 5 * px] : [2 * px, 4 * px]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of graph.points) {
    if (p.place) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * px, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(dark ? palette.light : palette.ink, 0.6);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx @param {any} palette @param {number} px
 * @param {{domain?:string, selected?:string[], locked?:Set<string>}} [opts]
 */
export function drawPlaces(ctx, palette, px, { domain = 'sea', selected = [], locked = new Set() } = {}) {
  const dark = palette.mode === 'dark';
  ctx.save();
  ctx.font = `800 ${12 * px}px "Archivo", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const place of PLACES) {
    if (place.kind !== domain) continue;
    const p = project(place.lon, place.lat);
    const sel = selected.includes(place.id);
    const r = (place.hub ? 7 : sel ? 6 : 4.5) * px;
    ctx.beginPath();
    if (domain === 'air') {
      ctx.moveTo(p.x, p.y - r * 1.3);
      ctx.lineTo(p.x + r * 1.1, p.y + r * 0.8);
      ctx.lineTo(p.x - r * 1.1, p.y + r * 0.8);
      ctx.closePath();
    } else {
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.fillStyle = locked.has(place.id) ? '#777' : sel || place.hub ? palette.warn : palette.danger;
    ctx.fill();
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = '#0c0a08';
    ctx.stroke();
    const label = `${place.id}${locked.has(place.id) ? ' 🔒' : ''}`;
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = dark ? '#0c0a08' : '#ffffff';
    ctx.strokeText(label, p.x + r + 4 * px, p.y);
    ctx.fillStyle = dark ? palette.light : palette.ink;
    ctx.fillText(label, p.x + r + 4 * px, p.y);
  }
  ctx.restore();
}
