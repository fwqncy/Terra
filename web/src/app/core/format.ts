/** Locale-aware formatting (Intl) — the browser's language list decides, never location. */

const locale = typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : 'en-AU';

const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
const compact2 = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
const aud = new Intl.NumberFormat(locale, { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const aud2 = new Intl.NumberFormat(locale, { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Brisbane' });
const dateTime = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Brisbane' });
const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });

export function formatCoins(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (Math.abs(n) < 1000) return n < 10 && n % 1 !== 0 ? one.format(n) : whole.format(Math.floor(n));
  return compact2.format(n);
}

export const fmt = {
  compact: (n: number) => compact.format(n),
  whole: (n: number) => whole.format(n),
  one: (n: number) => one.format(n),
  pct: (n: number) => pct.format(n),
  aud: (n: number) => aud.format(n),
  aud2: (n: number) => aud2.format(n),
  time: (ms: number) => time.format(ms),
  dateTime: (ms: number) => dateTime.format(ms),
  date: (ms: number | string) => date.format(new Date(ms)),
  /** "2 h 5 min" with non-breaking spaces between numbers and units. */
  duration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min`;
    return `${s} s`;
  },
  km: (n: number) => `${whole.format(n)} km`,
  kg: (n: number) => (n >= 10_000 ? `${one.format(n / 1000)} t` : `${whole.format(n)} kg`),
};

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
