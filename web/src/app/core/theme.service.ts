import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { apca, contrast, ensureApca, ensureContrast, fillForText, hexToHsl, hslToHex, mix, onColor, rgba } from './color';

export interface Swatches {
  ink: string;
  deep: string;
  primary: string;
  accent: string;
  light: string;
}

export type SwatchKey = keyof Swatches;
export type ModePref = 'system' | 'light' | 'dark';
export type Harmony = 'duotone' | 'analogous' | 'triadic' | 'mono';

export interface ThemePreset {
  id: string;
  name: string;
  source: string;
  swatches: Swatches;
  preferredMode: 'light' | 'dark';
}

export const SWATCH_LABELS: Record<SwatchKey, string> = {
  ink: 'Ink',
  deep: 'Deep',
  primary: 'Primary',
  accent: 'Accent',
  light: 'Light',
};

export const PRESETS: ThemePreset[] = [
  {
    id: 'nightshift',
    name: 'Nightshift',
    source: 'Default duotone: #24201A · #3F2548 · #35369C · #7C679E · #C8C793',
    swatches: { ink: '#24201A', deep: '#3F2548', primary: '#35369C', accent: '#7C679E', light: '#C8C793' },
    preferredMode: 'dark',
  },
  {
    id: 'dusk',
    name: 'Brooklyn Dusk',
    source: 'Sunset leap over the rooftops: pink sky, cobalt shadows, golden light',
    swatches: { ink: '#1A1433', deep: '#3B2F7A', primary: '#E0569B', accent: '#6E9BEA', light: '#F7D488' },
    preferredMode: 'dark',
  },
  {
    id: 'ink',
    name: 'Ink & Halftone',
    source: 'Black-and-white variant cover with a single spot red',
    swatches: { ink: '#151515', deep: '#2B2B2B', primary: '#D62839', accent: '#2F7F79', light: '#F1EEE6' },
    preferredMode: 'light',
  },
];

/** Validated categorical slots for road/air/sea (see dataviz palette check). Never themed. */
export const SERIES = {
  dark: { road: '#3987E5', air: '#D95926', sea: '#199E70' },
  light: { road: '#2A78D6', air: '#EB6834', sea: '#1BAF7A' },
} as const;

/** Fixed status scale — always paired with an icon and a label. */
export const STATUS = { good: '#0CA30C', warning: '#FAB219', serious: '#EC835A', critical: '#D03B3B' } as const;

export interface CanvasPalette {
  ink: string;
  deep: string;
  primary: string;
  accent: string;
  light: string;
  bg: string;
  surface: string;
  text: string;
  danger: string;
  success: string;
  warn: string;
  mode: 'light' | 'dark';
  halftone: boolean;
}

interface Stored {
  presetId: string;
  custom: Swatches;
  mode: ModePref;
  halftone: boolean;
  motion: 'system' | 'reduce';
}

const KEY = 'terra.theme.v1';

/** Builds a five-swatch palette from one colour, mirroring Nightshift's structure. */
export function harmonize(base: string, harmony: Harmony = 'duotone'): Swatches {
  const [h, s] = hexToHsl(base);
  const sat = Math.max(35, Math.min(70, s));
  switch (harmony) {
    case 'analogous':
      return { ink: hslToHex(h + 10, 18, 10), deep: hslToHex(h - 30, 34, 22), primary: hslToHex(h, sat, 42), accent: hslToHex(h + 30, 30, 55), light: hslToHex(h + 50, 40, 82) };
    case 'triadic':
      return { ink: hslToHex(h, 16, 10), deep: hslToHex(h + 120, 30, 22), primary: hslToHex(h, sat, 44), accent: hslToHex(h + 240, 35, 55), light: hslToHex(h + 120, 35, 80) };
    case 'mono':
      return { ink: hslToHex(h, 20, 9), deep: hslToHex(h, 30, 20), primary: hslToHex(h, sat, 42), accent: hslToHex(h, 25, 58), light: hslToHex(h, 30, 84) };
    default:
      // Nightshift's relationships: warm ink, violet deep, primary, dusty accent, complementary light
      return { ink: hslToHex(h + 157, 16, 12), deep: hslToHex(h + 44, 32, 21), primary: hslToHex(h, sat, 41), accent: hslToHex(h + 24, 22, 51), light: hslToHex(h + 180, 32, 68) };
  }
}

/** Every CSS custom property the app reads, derived from five swatches and a mode. */
export function deriveTokens(sw: Swatches, mode: 'light' | 'dark'): Record<string, string> {
  const dark = mode === 'dark';
  const bg = dark ? sw.ink : mix(sw.light, '#FFFFFF', 0.6);
  const raised = dark ? mix(sw.ink, sw.deep, 0.22) : mix(sw.light, '#FFFFFF', 0.78);
  const surface = dark ? mix(sw.ink, sw.deep, 0.38) : mix(sw.light, '#FFFFFF', 0.88);
  const surface2 = dark ? mix(sw.ink, sw.deep, 0.62) : mix(sw.light, '#FFFFFF', 0.45);
  const surface3 = dark ? mix(sw.deep, sw.accent, 0.3) : mix(sw.light, sw.accent, 0.22);
  // Text tokens must clear both WCAG ratios and APCA Lc targets (body 75, secondary 60, muted 45).
  const baseText = dark ? mix(sw.light, '#FFFFFF', 0.5) : sw.ink;
  const text = ensureApca(ensureContrast(baseText, bg, 12), bg, 75);
  const text2 = ensureApca(ensureContrast(mix(text, bg, 0.28), bg, 7), bg, 60);
  const text3 = ensureApca(ensureContrast(mix(text, bg, 0.45), bg, 4.6), bg, 45);
  const onBrand = onColor(sw.primary, [sw.light, sw.ink]);
  const brand = fillForText(sw.primary, onBrand, 60);
  const link = ensureApca(ensureContrast(dark ? mix(sw.accent, sw.light, 0.35) : sw.primary, bg, 4.6), bg, 60);
  const highlightBase = dark ? sw.light : mix(sw.light, sw.primary, 0.12);
  const highlight = fillForText(highlightBase, onColor(highlightBase, [sw.ink]), 60);
  const inkLine = dark ? '#0C0A08' : sw.ink;
  const focus = ensureContrast(dark ? sw.light : sw.primary, bg, 3.2);
  const hueShadow = mix(sw.ink, '#000000', 0.4);
  const series = SERIES[mode];
  return {
    '--bg': bg,
    '--bg-raised': raised,
    '--surface': surface,
    '--surface-2': surface2,
    '--surface-3': surface3,
    '--text': text,
    '--text-2': text2,
    '--text-3': text3,
    '--border': rgba(dark ? sw.light : sw.ink, dark ? 0.14 : 0.14),
    '--border-strong': rgba(dark ? sw.light : sw.ink, dark ? 0.32 : 0.34),
    '--brand': brand,
    '--brand-hover': mix(brand, dark ? sw.light : sw.ink, 0.14),
    '--on-brand': onBrand,
    '--accent': sw.accent,
    '--on-accent': onColor(sw.accent, [sw.light, sw.ink]),
    '--link': link,
    '--highlight': highlight,
    '--on-highlight': onColor(highlight, [sw.ink]),
    '--deep': sw.deep,
    '--ink-line': inkLine,
    '--focus': focus,
    '--dot': rgba(dark ? sw.light : sw.ink, dark ? 0.07 : 0.09),
    '--dot-strong': rgba(dark ? sw.light : sw.ink, dark ? 0.16 : 0.2),
    '--shadow-1': rgba(hueShadow, dark ? 0.5 : 0.16),
    '--shadow-2': rgba(hueShadow, dark ? 0.35 : 0.1),
    '--swatch-ink': sw.ink,
    '--swatch-deep': sw.deep,
    '--swatch-primary': sw.primary,
    '--swatch-accent': sw.accent,
    '--swatch-light': sw.light,
    '--series-road': series.road,
    '--series-air': series.air,
    '--series-sea': series.sea,
    '--status-good': dark ? STATUS.good : '#006300',
    '--status-warning': STATUS.warning,
    '--status-serious': STATUS.serious,
    '--status-critical': STATUS.critical,
    '--grid': dark ? rgba(sw.light, 0.1) : rgba(sw.ink, 0.1),
  };
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly media = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly motionMedia = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');

  readonly presetId = signal<string>('nightshift');
  readonly custom = signal<Swatches>({ ...PRESETS[0].swatches });
  readonly modePref = signal<ModePref>('dark');
  readonly halftone = signal(true);
  readonly motionPref = signal<'system' | 'reduce'>('system');
  private readonly systemDark = signal(this.media?.matches ?? true);
  private readonly systemReduce = signal(this.motionMedia?.matches ?? false);

  readonly swatches = computed<Swatches>(() => {
    const id = this.presetId();
    return id === 'custom' ? this.custom() : (PRESETS.find((p) => p.id === id) ?? PRESETS[0]).swatches;
  });
  readonly mode = computed<'light' | 'dark'>(() => {
    const pref = this.modePref();
    return pref === 'system' ? (this.systemDark() ? 'dark' : 'light') : pref;
  });
  readonly reducedMotion = computed(() => this.motionPref() === 'reduce' || this.systemReduce());
  readonly tokens = computed(() => deriveTokens(this.swatches(), this.mode()));
  readonly series = computed(() => SERIES[this.mode()]);

  /** Palette for the canvas renderers in the engine. */
  readonly palette = computed<CanvasPalette>(() => {
    const sw = this.swatches();
    const t = this.tokens();
    return {
      ...sw,
      bg: t['--bg'],
      surface: t['--surface'],
      text: t['--text'],
      danger: '#E5484D',
      success: '#5BB98B',
      warn: '#F2C14E',
      mode: this.mode(),
      halftone: this.halftone(),
    };
  });

  constructor() {
    this.load();
    this.media?.addEventListener('change', (e) => this.systemDark.set(e.matches));
    this.motionMedia?.addEventListener('change', (e) => this.systemReduce.set(e.matches));
    effect(() => this.apply());
    effect(() => this.save());
  }

  setPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id);
    this.presetId.set(id);
    if (preset && this.modePref() !== 'system') this.modePref.set(preset.preferredMode);
  }

  setSwatch(key: SwatchKey, hex: string): void {
    if (this.presetId() !== 'custom') {
      this.custom.set({ ...this.swatches() });
      this.presetId.set('custom');
    }
    this.custom.update((s) => ({ ...s, [key]: hex }));
  }

  generate(base: string, harmony: Harmony): void {
    this.custom.set(harmonize(base, harmony));
    this.presetId.set('custom');
  }

  toggleMode(): void {
    this.modePref.set(this.mode() === 'dark' ? 'light' : 'dark');
  }

  /** Lowest text/background contrast in the current theme (shown as a guardrail in Settings). */
  readonly contrastReport = computed(() => {
    const t = this.tokens();
    const row = (label: string, fg: string, bg: string, minLc: number) => {
      const lc = Math.abs(apca(fg, bg));
      return { label, fg, bg, lc, wcag: contrast(fg, bg), pass: lc >= minLc, minLc };
    };
    return [
      row('Body text', t['--text'], t['--bg'], 75),
      row('Secondary text', t['--text-2'], t['--bg'], 60),
      row('Muted text', t['--text-3'], t['--bg'], 45),
      row('Links', t['--link'], t['--bg'], 60),
      row('Primary button', t['--on-brand'], t['--brand'], 60),
      row('Highlight', t['--on-highlight'], t['--highlight'], 60),
    ];
  });

  private apply(): void {
    const root = this.doc.documentElement;
    const tokens = this.tokens();
    const mode = this.mode();
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
    root.style.colorScheme = mode;
    root.dataset['mode'] = mode;
    root.dataset['halftone'] = this.halftone() ? 'on' : 'off';
    root.dataset['motion'] = this.reducedMotion() ? 'reduce' : 'full';
    root.dataset['preset'] = this.presetId();
    const meta = this.doc.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', tokens['--bg']);
    try {
      localStorage.setItem('terra.theme.css', root.style.cssText);
      localStorage.setItem('terra.theme.mode', mode);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Stored>;
      if (s.presetId && (s.presetId === 'custom' || PRESETS.some((p) => p.id === s.presetId))) this.presetId.set(s.presetId);
      if (s.custom && Object.values(s.custom).every((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))) this.custom.set(s.custom);
      if (s.mode === 'system' || s.mode === 'light' || s.mode === 'dark') this.modePref.set(s.mode);
      if (typeof s.halftone === 'boolean') this.halftone.set(s.halftone);
      if (s.motion === 'reduce' || s.motion === 'system') this.motionPref.set(s.motion);
    } catch {
      /* corrupt or unavailable storage: keep defaults */
    }
  }

  private save(): void {
    const data: Stored = {
      presetId: this.presetId(),
      custom: this.custom(),
      mode: this.modePref(),
      halftone: this.halftone(),
      motion: this.motionPref(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
}
