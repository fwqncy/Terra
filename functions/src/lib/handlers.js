// Pure handler logic, kept free of Azure bindings so it is unit-testable with node:test.
import crypto from 'node:crypto';
import { normalizeState, offlineEarnings, coinsPerSecond } from '../shared/economy.js';

const EVENT_TYPES = new Set(['delivery', 'crash', 'generation', 'segment', 'overtakes', 'purchase', 'page']);
const MODES = new Set(['road', 'air', 'sea']);

/** Server-side offline quote with the same rules the browser uses. */
export function quoteOffline(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || !body.state || typeof body.state !== 'object') {
    return { status: 400, body: { title: 'Send { state } with a Terra save.' } };
  }
  const state = normalizeState(body.state, now);
  const off = offlineEarnings(state, now);
  return {
    status: 200,
    body: {
      earned: off.earned,
      seconds: off.seconds,
      cappedSeconds: off.cappedSeconds,
      capHours: off.capHours,
      rate: off.rate,
      coinsPerSecond: coinsPerSecond({ ...state, frenzyUntil: 0 }, now),
      serverTime: now,
    },
  };
}

/** Validates and trims a telemetry batch; unknown fields are dropped. */
export function sanitiseTelemetry(body, player = 'anonymous') {
  const events = Array.isArray(body?.events) ? body.events : null;
  if (!events) return { error: 'Send { events: [...] }.' };
  if (events.length > 500) return { error: 'Send at most 500 events per batch.' };
  const clean = [];
  for (const e of events) {
    if (!e || typeof e !== 'object' || !EVENT_TYPES.has(e.type)) continue;
    clean.push({
      type: e.type,
      mode: MODES.has(e.mode) ? e.mode : undefined,
      distance: Number.isFinite(e.distance) ? Math.round(e.distance) : undefined,
      to: typeof e.to === 'string' ? e.to.slice(0, 8) : undefined,
      training: e.training === true,
      player: String(player).slice(0, 64),
      at: new Date(),
    });
  }
  return { events: clean };
}

/** Turns a logistics snapshot into the daily "Dispatch" issue (text + structured facts). */
export function composeDispatch(snapshot, issue, now = new Date()) {
  const k = snapshot.kpis;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const busiest = snapshot.lanes?.[0];
  const worstHub = [...(snapshot.hubs ?? [])].sort((a, b) => b.occupancy - a.occupancy)[0];
  const date = now.toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'long', day: 'numeric', month: 'long' });
  const headline =
    k.otd >= 0.95 ? `Right on time: ${pct(k.otd)} of deliveries inside SLA` : k.otd >= 0.9 ? `Mostly on time at ${pct(k.otd)}, but watch the delays` : `Rough day: on-time slipped to ${pct(k.otd)}`;
  const lines = [
    `${k.delivered24h.toLocaleString('en-AU')} deliveries in the last 24 hours, ${k.inTransit} in transit and ${k.delayed} delayed.`,
    busiest ? `Busiest lane: ${busiest.origin} → ${busiest.destination} with ${busiest.volume} shipments.` : null,
    worstHub ? `Fullest hub: ${worstHub.name} at ${pct(worstHub.occupancy)}.` : null,
    `CO₂ for the day: ${(k.co2Kg24h / 1000).toFixed(1)} t (${Math.round(k.co2PerTkm * 1000)} g per tonne-km).`,
    k.exceptions ? `${k.exceptions} exception${k.exceptions === 1 ? '' : 's'} need a human.` : 'No open exceptions. Nice.',
  ].filter(Boolean);
  return {
    issue,
    title: `Dispatch #${issue}: ${headline}`,
    date,
    lines,
    html: `<p><strong>${date}</strong></p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul><p>Explore it live on the Terra dashboard.</p>`,
    facts: { otd: k.otd, delivered: k.delivered24h, delayed: k.delayed, exceptions: k.exceptions, co2Kg: k.co2Kg24h },
  };
}

export function sign(body, secret) {
  return secret ? `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}` : undefined;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Days since the first Dispatch (Terra launch day) — the issue number. */
export function issueNumber(now = new Date()) {
  const launch = Date.UTC(2026, 8, 30);
  return Math.max(1, Math.floor((now.getTime() - launch) / 86_400_000) + 1);
}
