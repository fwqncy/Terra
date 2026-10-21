/** Colour maths for the theme engine (hex ⇄ rgb ⇄ hsv/hsl, mixing, WCAG contrast). */

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

export function isHex(value: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

export function normalizeHex(value: string): string {
  const v = value.trim().replace(/^#?/, '#');
  return rgbToHex(hexToRgb(v));
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Moves `fg` towards white or black (whichever helps) until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  // head for whichever extreme can reach the target (mid-greys favour black)
  const target = contrast('#000000', bg) >= contrast('#FFFFFF', bg) ? '#000000' : '#FFFFFF';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

/** Best readable ink on a fill: one of the candidates, or black/white. */
export function onColor(fill: string, candidates: string[] = []): string {
  const all = [...candidates, '#FFFFFF', '#0C0A08'];
  return all.reduce((best, c) => (contrast(c, fill) > contrast(best, fill) ? c : best), all[0]);
}

export function rgbToHsv([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [(h + 360) % 360, s * 100, l * 100];
}

/**
 * APCA (Accessible Perceptual Contrast Algorithm, 0.0.98G constants) lightness contrast, Lc.
 * Positive for dark text on light backgrounds, negative for light on dark. |Lc| ≥ 75 suits body text.
 */
export function apca(textHex: string, bgHex: string): number {
  const toY = (hex: string) => {
    const [r, g, b] = hexToRgb(hex).map((c) => (c / 255) ** 2.4);
    return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  };
  const clamp = (y: number) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  const yt = clamp(toY(textHex));
  const yb = clamp(toY(bgHex));
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** Moves `fg` towards black or white until its APCA |Lc| on `bg` reaches `minLc`. */
export function ensureApca(fg: string, bg: string, minLc: number): string {
  if (Math.abs(apca(fg, bg)) >= minLc) return fg;
  const target = Math.abs(apca('#000000', bg)) > Math.abs(apca('#FFFFFF', bg)) ? '#000000' : '#FFFFFF';
  for (let t = 0.04; t <= 1; t += 0.04) {
    const c = mix(fg, target, t);
    if (Math.abs(apca(c, bg)) >= minLc) return c;
  }
  return target;
}

/** Adjusts a fill colour until `text` on it reaches `minLc` (keeps the hue, shifts lightness). */
export function fillForText(fill: string, text: string, minLc: number): string {
  if (Math.abs(apca(text, fill)) >= minLc) return fill;
  const textIsLight = luminance(text) > 0.4;
  const target = textIsLight ? '#000000' : '#FFFFFF';
  for (let t = 0.04; t <= 0.9; t += 0.04) {
    const c = mix(fill, target, t);
    if (Math.abs(apca(text, c)) >= minLc) return c;
  }
  return mix(fill, target, 0.9);
}
