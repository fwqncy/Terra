import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import * as E from '../../engine/idle/economy.js';
import { ApiService } from './api.service';
import { TelemetryService } from './telemetry.service';
import { ToastService } from './toast.service';
import { formatCoins } from './format';

export type GameState = ReturnType<typeof E.initialState>;
export type SimEvent = { type: string; mode?: 'road' | 'air' | 'sea'; distance?: number; training?: boolean; to?: string; count?: number };

export interface OfflineReport {
  earned: number;
  seconds: number;
  cappedSeconds: number;
  capHours: number;
  rate: number;
}

const SAVE_KEY = 'terra.save.v1';
const TICK_MS = 250;

/**
 * The Depot idle game: passive income from your fleet, clicks, upgrades, cosmetics,
 * offline earnings, golden parcels, achievements and franchising.
 * Pure economy rules live in the engine; this service owns time, persistence and sync.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly doc = inject(DOCUMENT);
  private readonly telemetry = inject(TelemetryService);

  readonly state = signal<GameState>(E.initialState());
  readonly now = signal(Date.now());
  readonly offlineReport = signal<OfflineReport | null>(null);
  readonly golden = signal<{ id: number; expiresAt: number; top: number } | null>(null);
  readonly lastGain = signal<{ amount: number; at: number } | null>(null);

  readonly cps = computed(() => E.coinsPerSecond(this.state(), this.now()));
  readonly clickValue = computed(() => E.clickValue(this.state(), this.now()));
  readonly frenzy = computed(() => this.state().frenzyUntil > this.now());
  readonly deliveries = computed(() => E.totalDeliveries(this.state()));
  readonly equipped = computed(() => this.state().equipped);

  private last = performance.now();
  private lastSave = 0;
  private nextGoldenAt = Date.now() + 60_000;
  private goldenSeq = 0;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
    setInterval(() => this.tick(), TICK_MS);
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'hidden') this.save(true);
    });
    this.doc.defaultView?.addEventListener('pagehide', () => this.save(true));
  }

  // ---------- loop ----------

  private tick(): void {
    const t = performance.now();
    const dt = Math.min(5, (t - this.last) / 1000);
    this.last = t;
    const now = Date.now();
    this.now.set(now);
    this.state.update((s) => E.tick(s, dt, now));
    if (now - this.lastSave > 5000) this.save();
    if (Math.floor(now / 1000) !== Math.floor((now - TICK_MS) / 1000)) this.checkAchievements();
    this.maybeGolden(now);
  }

  private maybeGolden(now: number): void {
    const g = this.golden();
    if (g && now > g.expiresAt) this.golden.set(null);
    if (!g && now > this.nextGoldenAt && this.doc.visibilityState === 'visible') {
      this.golden.set({ id: ++this.goldenSeq, expiresAt: now + 13_000, top: 18 + Math.random() * 55 });
      const mult = E.goldenChanceMultiplier(this.state());
      this.nextGoldenAt = now + ((90 + Math.random() * 150) * 1000) / mult;
    }
  }

  // ---------- actions ----------

  click(): number {
    const before = this.state().coins;
    this.state.update((s) => E.click(s, Date.now()));
    const gained = this.state().coins - before;
    this.lastGain.set({ amount: gained, at: Date.now() });
    return gained;
  }

  buyGenerator(id: string, qty = 1): boolean {
    const r = E.buyGenerator(this.state(), id, qty);
    if (r.ok) {
      this.state.set(r.state);
      this.scheduleSync();
    }
    return r.ok;
  }

  buyUpgrade(id: string): boolean {
    const r = E.buyUpgrade(this.state(), id);
    if (r.ok) {
      this.state.set(r.state);
      const u = E.UPGRADES.find((x) => x.id === id);
      this.toasts.push({ title: `${u?.name ?? 'Upgrade'} installed`, body: u?.blurb, tone: 'good' });
      this.scheduleSync();
    } else if (r.reason) {
      this.toasts.push({ title: 'Not yet', body: r.reason, tone: 'info' });
    }
    return r.ok;
  }

  buyCosmetic(kind: 'skins' | 'homes' | 'maps', id: string): boolean {
    const r = E.buyCosmetic(this.state(), kind, id);
    if (r.ok) {
      this.state.set(r.state);
      const slot = kind === 'skins' ? 'skin' : kind === 'homes' ? 'home' : 'map';
      this.equip(slot, id);
      this.scheduleSync();
    } else if (r.reason) {
      this.toasts.push({ title: 'Not yet', body: r.reason, tone: 'info' });
    }
    return r.ok;
  }

  upgradeFacility(id: string): boolean {
    const r = E.upgradeFacility(this.state(), id);
    if (r.ok) {
      this.state.set(r.state);
      const f = E.FACILITIES.find((x) => x.id === id);
      this.toasts.push({ title: `${f?.name ?? 'Facility'} expanded to level ${r.state.facilities[id]}`, body: 'All earnings +4%.', tone: 'good' });
      this.scheduleSync();
    } else if (r.reason) {
      this.toasts.push({ title: 'Not yet', body: r.reason, tone: 'info' });
    }
    return r.ok;
  }

  /** Active play on the ops floor: a rush order pays 20 s of income, once per 30 s per hub. */
  readonly rushCooldowns = signal<Record<string, number>>({});
  rushOrder(hubId: string): number {
    const now = Date.now();
    if ((this.rushCooldowns()[hubId] ?? 0) > now) return 0;
    const amount = 50 + this.cps() * 20;
    this.state.update((s) => ({ ...s, coins: s.coins + amount, lifetime: s.lifetime + amount, lifetimeAllTime: s.lifetimeAllTime + amount }));
    this.rushCooldowns.update((c) => ({ ...c, [hubId]: now + 30_000 }));
    this.lastGain.set({ amount, at: now });
    return amount;
  }

  equip(slot: 'skin' | 'home' | 'map', id: string): void {
    const r = E.equip(this.state(), slot, id);
    if (r.ok) this.state.set(r.state);
  }

  owns(kind: 'skins' | 'homes' | 'maps', id: string): boolean {
    return this.state().owned[kind].includes(id);
  }

  /** Simulation events (deliveries, crashes, generations) pay out and feed achievements. */
  record(event: SimEvent): number {
    if (event.type !== 'segment') this.telemetry.track(event);
    const before = this.state().coins;
    this.state.update((s) => E.recordEvent(s, event, Date.now()));
    const gained = this.state().coins - before;
    if (gained > 0) this.lastGain.set({ amount: gained, at: Date.now() });
    return gained;
  }

  catchGolden(): void {
    if (!this.golden()) return;
    this.golden.set(null);
    const r = E.catchGolden(this.state(), Date.now());
    this.state.set(r.state);
    if (r.kind === 'frenzy') {
      this.toasts.push({ title: 'Priority surge!', body: 'Everything earns ×7 for 30 seconds.', tone: 'coin' });
    } else {
      this.toasts.push({ title: 'Lucky parcel!', body: `+${formatCoins(r.amount)} coins`, tone: 'coin' });
    }
  }

  franchise(): boolean {
    const r = E.franchise(this.state(), Date.now());
    if (r.ok) {
      this.state.set(r.state);
      this.save(true);
      this.toasts.push({ title: 'Franchise signed', body: `You now hold ${r.state.tokens} franchise tokens: +${r.state.tokens * 2}% on everything, forever.`, tone: 'good' });
    } else if (r.reason) {
      this.toasts.push({ title: 'Not yet', body: r.reason, tone: 'info' });
    }
    return r.ok;
  }

  dismissOffline(): void {
    this.offlineReport.set(null);
  }

  reset(): void {
    this.state.set(E.initialState(Date.now()));
    this.save(true);
  }

  exportSave(): string {
    return JSON.stringify(this.state(), null, 2);
  }

  importSave(json: string): boolean {
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object') return false;
      this.state.set(E.normalizeState(parsed, Date.now()));
      this.save(true);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- persistence ----------

  private load(): void {
    const now = Date.now();
    let raw: unknown = null;
    try {
      const text = localStorage.getItem(SAVE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    const state = E.normalizeState(raw, now);
    if (raw) {
      const r = E.applyOffline(state, now);
      this.state.set(r.state);
      if (r.earned >= 1 && r.seconds > 60) {
        this.offlineReport.set({ earned: r.earned, seconds: r.seconds, cappedSeconds: r.cappedSeconds, capHours: r.capHours, rate: r.rate });
      }
    } else {
      this.state.set(state);
    }
  }

  private save(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastSave < 4000) return;
    this.lastSave = now;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...this.state(), lastSeen: now }));
    } catch {
      /* storage full or blocked: progress continues for this session */
    }
    if (force) this.scheduleSync(0);
  }

  private scheduleSync(delay = 4000): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.sync(), delay);
  }

  /** Pushes the save to the API (SQL Server). The server re-validates offline gains. */
  async sync(): Promise<void> {
    if (!this.api.online()) return;
    try {
      await this.api.put(`/game/${this.api.playerId}`, { name: this.api.playerName(), state: this.state(), clientTime: Date.now() });
    } catch {
      /* stay local; next sync retries */
    }
  }

  private checkAchievements(): void {
    const fresh = E.checkAchievements(this.state());
    if (!fresh.length) return;
    this.state.update((s) => ({ ...s, achievements: [...s.achievements, ...fresh] }));
    for (const id of fresh) {
      const a = E.ACHIEVEMENTS.find((x) => x.id === id);
      if (a) this.toasts.push({ title: `Achievement: ${a.name}`, body: `${a.blurb} +1% earnings.`, tone: 'good' });
    }
  }
}
