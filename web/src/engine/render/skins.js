import { mix } from './comic.js';

/**
 * Car skins are cosmetics unlocked in the Depot. Every skin draws centred on the origin,
 * pointing up (-y is forward), so the same code renders the sim, the shop preview and the minimap.
 */
export const CAR_SKINS = {
  ute: { label: 'Bne Ute', price: 0 },
  minit: { label: 'Mini T', price: 1_500 },
  taxi: { label: 'Black & Gold Cab', price: 6_000 },
  kombi: { label: 'Surf Kombi', price: 25_000 },
  ink: { label: 'Inked Variant #1', price: 120_000 },
  holo: { label: 'Holo Foil', price: 750_000 },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w width
 * @param {number} h length
 * @param {string} skin
 * @param {import('./comic.js').Palette} palette
 * @param {{damaged?:boolean, braking?:boolean, time?:number, tint?:string}} [opts]
 */
export function drawCarShape(ctx, w, h, skin, palette, opts = {}) {
  const ink = '#0c0a08';
  const x = -w / 2;
  const y = -h / 2;
  const t = opts.time ?? 0;
  let body = opts.tint ?? palette.primary;
  let trim = palette.light;
  let glass = mix(palette.ink, palette.primary, 0.35);

  if (opts.damaged) {
    body = '#6b6b6b';
    trim = '#9a9a9a';
  } else if (skin === 'minit') {
    body = mix(palette.light, '#ffffff', 0.5);
    trim = palette.ink;
    glass = '#14141c';
  } else if (skin === 'taxi') {
    body = '#F2C14E';
    trim = '#111';
  } else if (skin === 'kombi') {
    body = palette.danger;
    trim = '#F4EFE1';
  } else if (skin === 'ink') {
    body = '#F4F1EA';
    trim = '#111';
    glass = '#111';
  } else if (skin === 'holo') {
    body = `hsl(${(t * 60) % 360} 85% 62%)`;
    trim = `hsl(${(t * 60 + 140) % 360} 85% 70%)`;
  }

  if (skin === 'ghost') {
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.warn;
    roundRect(ctx, x, y, w, h, w * 0.3);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // drop shadow (comic offset)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, x + 3, y + 4, w, h, w * 0.3);
  ctx.fill();

  // tyres
  ctx.fillStyle = ink;
  for (const ty of [y + h * 0.16, y + h * 0.7]) {
    ctx.fillRect(x - 3, ty, 4, h * 0.16);
    ctx.fillRect(x + w - 1, ty, 4, h * 0.16);
  }

  // body
  roundRect(ctx, x, y, w, h, skin === 'kombi' ? w * 0.18 : w * 0.32);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = ink;
  ctx.stroke();

  if (skin === 'kombi') {
    // two-tone split
    ctx.save();
    roundRect(ctx, x, y, w, h, w * 0.18);
    ctx.clip();
    ctx.fillStyle = trim;
    ctx.fillRect(x, y, w, h * 0.42);
    ctx.restore();
  }
  if (skin === 'ute') {
    // tray
    ctx.fillStyle = mix(body, ink, 0.35);
    ctx.fillRect(x + w * 0.14, y + h * 0.55, w * 0.72, h * 0.38);
    ctx.strokeStyle = trim;
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) {
      const ly = y + h * 0.55 + (h * 0.38 * i) / 4;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.18, ly);
      ctx.lineTo(x + w * 0.82, ly);
      ctx.stroke();
    }
  }
  if (skin === 'ink') {
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2 + i * w * 0.18, y + h * 0.62);
      ctx.lineTo(x + w * 0.1 + i * w * 0.18, y + h * 0.92);
      ctx.stroke();
    }
  }

  // windscreen + rear glass
  ctx.fillStyle = glass;
  roundRect(ctx, x + w * 0.14, y + h * 0.16, w * 0.72, h * 0.2, 3);
  ctx.fill();
  if (skin !== 'ute') {
    roundRect(ctx, x + w * 0.18, y + h * 0.66, w * 0.64, h * 0.12, 3);
    ctx.fill();
  }
  if (skin === 'minit') {
    // glass roof
    roundRect(ctx, x + w * 0.2, y + h * 0.38, w * 0.6, h * 0.26, 4);
    ctx.fill();
  }
  if (skin === 'taxi') {
    ctx.fillStyle = '#111';
    ctx.fillRect(x + w * 0.3, y + h * 0.44, w * 0.4, h * 0.1);
    ctx.fillStyle = '#F2C14E';
    ctx.font = `900 ${h * 0.08}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', 0, y + h * 0.49);
  }

  // headlights
  ctx.fillStyle = '#FFF6C9';
  ctx.fillRect(x + w * 0.1, y + 1, w * 0.18, 3);
  ctx.fillRect(x + w * 0.72, y + 1, w * 0.18, 3);
  // tail lights
  ctx.fillStyle = opts.braking ? '#ff3b3b' : '#8a1f1f';
  ctx.fillRect(x + w * 0.08, y + h - 4, w * 0.2, 3);
  ctx.fillRect(x + w * 0.72, y + h - 4, w * 0.2, 3);
}
