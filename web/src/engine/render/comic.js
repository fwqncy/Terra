/**
 * Comic-book rendering helpers for 2D canvas: halftone patterns, duotone shading,
 * ink outlines and onomatopoeia bursts. Palettes come from the app theme.
 */

/** @typedef {{ink:string, deep:string, primary:string, accent:string, light:string, bg:string, surface:string, text:string, danger:string, success:string, warn:string, mode:'dark'|'light', halftone:boolean}} Palette */

/** @type {Palette} */
export const DEFAULT_PALETTE = {
  ink: '#24201A',
  deep: '#3F2548',
  primary: '#35369C',
  accent: '#7C679E',
  light: '#C8C793',
  bg: '#24201A',
  surface: '#2E2622',
  text: '#ECEBD2',
  danger: '#E5484D',
  success: '#5BB98B',
  warn: '#F2C14E',
  mode: 'dark',
  halftone: true,
};

const patternCache = new Map();

/** A dot-screen pattern (Ben-Day dots). Cached per colour/density. */
export function halftonePattern(ctx, color, { spacing = 8, radius = 1.6, background = 'transparent' } = {}) {
  const key = `${color}|${spacing}|${radius}|${background}`;
  let pattern = patternCache.get(key);
  if (pattern) return pattern;
  const size = spacing * 2;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const c = canvas.getContext('2d');
  if (background !== 'transparent') {
    c.fillStyle = background;
    c.fillRect(0, 0, size, size);
  }
  c.fillStyle = color;
  for (const [x, y] of [[spacing / 2, spacing / 2], [spacing * 1.5, spacing * 1.5]]) {
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fill();
  }
  pattern = ctx.createPattern(canvas, 'repeat');
  patternCache.set(key, pattern);
  return pattern;
}

export function clearPatternCache() {
  patternCache.clear();
}

/** Parses #rgb / #rrggbb into [r,g,b]. */
export function hexToRgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Mixes two hex colours. */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

export function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Relative luminance 0..1 */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Draws a jagged comic burst with text, e.g. "CRUNCH!". `life` goes 1 → 0. */
export function drawBurst(ctx, x, y, text, { size = 60, life = 1, fill = '#F2C14E', ink = '#111', textColor = '#111', seed = 1 } = {}) {
  const pop = life > 0.8 ? 1 + (1 - life) * 2.5 : 1;
  const r = size * pop;
  const spikes = 12;
  ctx.save();
  ctx.globalAlpha = Math.min(1, life * 2);
  ctx.translate(x, y);
  ctx.rotate(((seed % 7) - 3) * 0.05);
  ctx.beginPath();
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const jitter = 0.78 + (((seed * (i + 3)) % 11) / 11) * 0.22;
    const rr = i % 2 === 0 ? r : r * 0.62 * jitter;
    ctx.lineTo(Math.cos(a) * rr * 1.25, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.06);
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.font = `900 ${Math.round(r * 0.42)}px "Bangers", "Archivo", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.strokeStyle = ink;
  ctx.strokeText(text, 0, 2);
  ctx.fillStyle = textColor;
  ctx.fillText(text, 0, 2);
  ctx.restore();
}

/** Lightweight particle list of bursts managed by the sims. */
export class BurstLayer {
  constructor() {
    this.items = [];
  }

  add(x, y, text, size = 60) {
    this.items.push({ x, y, text, size, life: 1, seed: (Math.random() * 1000) | 0 });
    if (this.items.length > 24) this.items.shift();
  }

  update(dt = 1 / 60) {
    for (const b of this.items) b.life -= dt * 0.9;
    this.items = this.items.filter((b) => b.life > 0);
  }

  draw(ctx, palette, scale = 1) {
    for (const b of this.items) {
      drawBurst(ctx, b.x, b.y, b.text, {
        size: b.size * scale,
        life: b.life,
        fill: palette.warn,
        ink: palette.ink === palette.bg ? '#111' : palette.ink,
        textColor: '#111',
        seed: b.seed,
      });
    }
  }
}

export const CRASH_WORDS = ['CRUNCH!', 'BONK!', 'KRAK!', 'WHAM!', 'SKREE!', 'THUD!'];
export const WIN_WORDS = ['DELIVERED!', 'ZOOM!', 'NAILED IT!', 'KA-CHING!'];
