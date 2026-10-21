import { createRng } from '../math/rng.js';
import {
  AIR_DESTINATIONS, CARRIERS, CUSTOMERS, DELAY_P_PER_HOUR, DELAY_REASONS, EMISSIONS, FIXED_AUD, HANDLING_H, HUBS,
  MODES, RATE_AUD_TKM, ROAD_DESTINATIONS, SEA_DESTINATIONS, SPAWN_PER_HOUR, SPEED_KMH,
} from './catalog.js';

const H = 3_600_000;
const DESTS = { road: ROAD_DESTINATIONS, air: AIR_DESTINATIONS, sea: SEA_DESTINATIONS };
const SLACK_H = { road: 3, air: 8, sea: 36 };
const PRIORITY_COST = { Standard: 1, Express: 1.35, Critical: 1.8 };

/**
 * @typedef {'road'|'air'|'sea'} Mode
 * @typedef {{id:string, mode:Mode, origin:string, destination:string, destinationName:string, carrier:string, customer:string,
 *   priority:'Standard'|'Express'|'Critical', weightKg:number, units:number, unitType:string, distanceKm:number,
 *   createdAt:number, departAt:number, etaAt:number, slaAt:number, deliveredAt:number|null, status:string,
 *   progress:number, costAud:number, co2Kg:number, delayReason:string|null, delayUntil?:number, onTime?:boolean, expedited?:boolean}} Shipment
 */

/**
 * Deterministic logistics simulation for the Brisbane network. Runs fully in the browser
 * (offline mode) and mirrors the .NET API's server-side simulator contract.
 */
export class LogisticsSim {
  constructor({ seed = 2032, now = Date.now(), warmupHours = 72, fleet = { road: 1, air: 1, sea: 1 } } = {}) {
    this.rng = createRng(seed);
    this.time = now - warmupHours * H;
    this.fleet = { ...fleet };
    /** @type {Shipment[]} */
    this.shipments = [];
    this.seq = 240_000;
    this.buckets = new Map();
    this.events = [];
    this.listeners = new Set();
    this.greenFactor = 1;
    this.warming = true;
    this.advance(warmupHours * 60, 5);
    this.warming = false;
  }

  /** Fleet multipliers come from the Depot: more vehicles, more shipments. */
  setFleet(fleet) {
    this.fleet = { road: Math.max(0.5, fleet.road), air: Math.max(0.5, fleet.air), sea: Math.max(0.5, fleet.sea) };
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit(type, s, message, severity = 'info') {
    const e = { id: `${type}-${s.id}-${this.time}`, at: this.time, type, shipmentId: s.id, mode: s.mode, message, severity };
    this.events.push(e);
    if (this.events.length > 250) this.events.shift();
    if (!this.warming) for (const fn of this.listeners) fn(e);
  }

  #bucket(t) {
    const k = Math.floor(t / H);
    let b = this.buckets.get(k);
    if (!b) {
      b = { t: k * H, created: { road: 0, air: 0, sea: 0 }, delivered: { road: 0, air: 0, sea: 0 }, onTime: 0, late: 0, co2: 0, revenue: 0, delays: 0 };
      this.buckets.set(k, b);
      for (const old of this.buckets.keys()) if (old < k - 24 * 8) this.buckets.delete(old);
    }
    return b;
  }

  #create(mode) {
    const r = this.rng;
    const dest = r.pick(DESTS[mode]);
    const origin = mode === 'road' ? r.pick(['EFD', 'ACR', 'YTL']) : mode === 'air' ? 'BNEC' : 'PBNE';
    const priority = r.chance(0.07) ? 'Critical' : r.chance(0.26) ? 'Express' : 'Standard';
    const weightKg = Math.round(mode === 'sea' ? r.range(4_000, 26_000) : mode === 'air' ? r.range(40, 2_400) : r.range(80, 12_000));
    const unitType = mode === 'sea' ? 'TEU' : mode === 'air' ? 'ULD' : 'pallets';
    const units = Math.max(1, Math.ceil(weightKg / (mode === 'sea' ? 14_000 : mode === 'air' ? 1_000 : 500)));
    const speedFactor = priority === 'Critical' ? 0.85 : priority === 'Express' ? 0.92 : 1;
    const transitH = (dest.km / SPEED_KMH[mode] + HANDLING_H[mode]) * speedFactor;
    const departAt = this.time + r.range(0.3, mode === 'sea' ? 18 : 5) * H;
    const etaAt = departAt + transitH * H;
    const slaAt = etaAt + SLACK_H[mode] * (priority === 'Critical' ? 0.4 : 1) * H;
    const tkm = (weightKg / 1000) * dest.km;
    /** @type {Shipment} */
    const s = {
      id: `TRA-${++this.seq}`,
      mode,
      origin,
      destination: dest.id,
      destinationName: dest.name,
      carrier: r.pick(CARRIERS[mode]),
      customer: r.pick(CUSTOMERS),
      priority,
      weightKg,
      units,
      unitType,
      distanceKm: dest.km,
      createdAt: this.time,
      departAt,
      etaAt,
      slaAt,
      deliveredAt: null,
      status: 'Booked',
      progress: 0,
      costAud: Math.round((FIXED_AUD[mode] + tkm * RATE_AUD_TKM[mode]) * PRIORITY_COST[priority]),
      co2Kg: Math.round(tkm * EMISSIONS[mode] * this.greenFactor * 10) / 10,
      delayReason: null,
    };
    this.shipments.push(s);
    this.#bucket(this.time).created[mode]++;
    return s;
  }

  /** Advances the simulation by `minutes` simulated minutes, in `step`-minute increments. */
  advance(minutes, step = 1) {
    let left = minutes;
    while (left > 0) {
      const dt = Math.min(step, left);
      left -= dt;
      this.time += dt * 60_000;
      this.#stepOnce(dt);
    }
  }

  /** Real-time driver: `speed` simulated minutes per real second. */
  tick(realSeconds, speed = 2) {
    this.advance(realSeconds * speed, 1);
  }

  #stepOnce(dtMin) {
    const r = this.rng;
    for (const mode of MODES) {
      const rate = (SPAWN_PER_HOUR[mode] * this.fleet[mode] * dtMin) / 60;
      let n = Math.floor(rate);
      if (r.next() < rate - n) n++;
      // diurnal rhythm: busier during the Brisbane working day
      const hour = new Date(this.time).getUTCHours() + 10;
      if ((hour % 24 < 6 || hour % 24 > 21) && r.next() < 0.6) n = 0;
      for (let i = 0; i < n; i++) this.#create(mode);
    }
    for (const s of this.shipments) {
      if (s.status === 'Delivered') continue;
      if (s.status === 'Booked') {
        if (this.time >= s.departAt) s.status = 'In Transit';
        else continue;
      }
      if (s.status === 'Exception') {
        if (this.time >= (s.delayUntil ?? 0)) {
          s.status = 'In Transit';
          this.#emit('resolved', s, `${s.id} exception resolved, back in transit`, 'info');
        }
        continue;
      }
      if (s.status === 'Delayed' && this.time >= (s.delayUntil ?? 0)) s.status = 'In Transit';
      if (s.status === 'In Transit') {
        if (r.next() < (DELAY_P_PER_HOUR[s.mode] * dtMin) / 60) {
          const hours = s.mode === 'sea' ? r.range(10, 60) : s.mode === 'air' ? r.range(2, 12) : r.range(0.5, 5);
          s.status = 'Delayed';
          s.delayReason = r.pick(DELAY_REASONS[s.mode]);
          s.delayUntil = this.time + hours * H;
          s.etaAt += hours * H;
          this.#bucket(this.time).delays++;
          this.#emit('delayed', s, `${s.id} to ${s.destinationName} delayed ${Math.round(hours)} h: ${s.delayReason}`, s.priority === 'Critical' ? 'critical' : 'warning');
        } else if (r.next() < (0.0006 * dtMin) / 60) {
          s.status = 'Exception';
          s.delayReason = r.pick(['Damaged packaging', 'Address unknown', 'Documents missing']);
          s.delayUntil = this.time + r.range(6, 24) * H;
          s.etaAt = Math.max(s.etaAt, s.delayUntil + 2 * H);
          this.#emit('exception', s, `${s.id} exception: ${s.delayReason}`, 'critical');
        }
      }
      s.progress = Math.min(1, Math.max(0, (this.time - s.departAt) / Math.max(1, s.etaAt - s.departAt)));
      if (s.status === 'In Transit' && s.mode !== 'road' && s.progress > 0.93) s.status = 'At Hub';
      if ((s.status === 'In Transit' || s.status === 'At Hub') && this.time >= s.etaAt) {
        s.status = 'Delivered';
        s.deliveredAt = this.time;
        s.progress = 1;
        s.onTime = s.deliveredAt <= s.slaAt;
        const b = this.#bucket(this.time);
        b.delivered[s.mode]++;
        b[s.onTime ? 'onTime' : 'late']++;
        b.co2 += s.co2Kg;
        b.revenue += s.costAud;
        if (!s.onTime && s.priority !== 'Standard') this.#emit('late', s, `${s.id} (${s.priority}) delivered late to ${s.destinationName}`, 'warning');
      }
    }
    // prune delivered shipments older than 7 days
    if (this.shipments.length > 2_500) {
      const cutoff = this.time - 7 * 24 * H;
      this.shipments = this.shipments.filter((s) => s.status !== 'Delivered' || (s.deliveredAt ?? 0) > cutoff);
    }
  }

  expedite(id) {
    const s = this.shipments.find((x) => x.id === id);
    if (!s || s.status === 'Delivered') return null;
    if (!s.expedited) {
      s.expedited = true;
      s.priority = s.priority === 'Standard' ? 'Express' : 'Critical';
      const remaining = Math.max(0, s.etaAt - this.time);
      s.etaAt = this.time + remaining * 0.7;
      s.costAud = Math.round(s.costAud * 1.25);
      if (s.status === 'Delayed') s.delayUntil = Math.min(s.delayUntil ?? this.time, this.time + H);
      this.#emit('expedited', s, `${s.id} expedited — new ETA brought forward`, 'info');
    }
    return s;
  }

  /** Dashboard snapshot: KPIs, series and breakdowns over the last 24 simulated hours. */
  snapshot() {
    const now = this.time;
    const since = now - 24 * H;
    const delivered = this.shipments.filter((s) => s.deliveredAt && s.deliveredAt > since);
    const active = this.shipments.filter((s) => s.status !== 'Delivered');
    const onTime = delivered.filter((s) => s.onTime).length;
    const byMode = (list, mode) => list.filter((s) => s.mode === mode);
    const avgTransit = (mode) => {
      const list = byMode(delivered, mode);
      if (!list.length) return 0;
      return list.reduce((sum, s) => sum + ((s.deliveredAt ?? 0) - s.departAt) / H, 0) / list.length;
    };
    const tonneKm = delivered.reduce((sum, s) => sum + (s.weightKg / 1000) * s.distanceKm, 0);
    const co2 = delivered.reduce((sum, s) => sum + s.co2Kg, 0);
    const revenue = delivered.reduce((sum, s) => sum + s.costAud, 0);
    const weight = delivered.reduce((sum, s) => sum + s.weightKg, 0);
    const capacity = { road: 110 * this.fleet.road, air: 50 * this.fleet.air, sea: 100 * this.fleet.sea };
    const inTransit = (mode) => active.filter((s) => s.mode === mode && s.status !== 'Booked').length;

    const series = [];
    for (let k = Math.floor(now / H) - 47; k <= Math.floor(now / H); k++) {
      const b = this.buckets.get(k);
      series.push({
        t: k * H,
        road: b?.delivered.road ?? 0,
        air: b?.delivered.air ?? 0,
        sea: b?.delivered.sea ?? 0,
        onTime: b?.onTime ?? 0,
        late: b?.late ?? 0,
        co2: Math.round(b?.co2 ?? 0),
        revenue: Math.round(b?.revenue ?? 0),
        created: (b?.created.road ?? 0) + (b?.created.air ?? 0) + (b?.created.sea ?? 0),
      });
    }

    const laneMap = new Map();
    for (const s of this.shipments.filter((x) => x.createdAt > now - 72 * H)) {
      const key = `${s.origin}→${s.destination}`;
      let l = laneMap.get(key);
      if (!l) laneMap.set(key, (l = { lane: key, origin: s.origin, destination: s.destinationName, mode: s.mode, volume: 0, delivered: 0, onTime: 0, delayH: 0, revenue: 0, co2: 0 }));
      l.volume++;
      l.revenue += s.costAud;
      l.co2 += s.co2Kg;
      if (s.deliveredAt) {
        l.delivered++;
        if (s.onTime) l.onTime++;
        l.delayH += Math.max(0, ((s.deliveredAt ?? 0) - s.slaAt) / H);
      }
    }
    const lanes = [...laneMap.values()]
      .map((l) => ({ ...l, otd: l.delivered ? l.onTime / l.delivered : null, avgDelayH: l.delivered ? l.delayH / l.delivered : 0 }))
      .sort((a, b) => b.volume - a.volume);

    const carrierMap = new Map();
    for (const s of this.shipments.filter((x) => x.createdAt > now - 72 * H)) {
      let c = carrierMap.get(s.carrier);
      if (!c) carrierMap.set(s.carrier, (c = { carrier: s.carrier, mode: s.mode, volume: 0, delivered: 0, onTime: 0, cost: 0, tkm: 0, co2: 0 }));
      c.volume++;
      c.cost += s.costAud;
      c.tkm += (s.weightKg / 1000) * s.distanceKm;
      c.co2 += s.co2Kg;
      if (s.deliveredAt) {
        c.delivered++;
        if (s.onTime) c.onTime++;
      }
    }
    const carriers = [...carrierMap.values()].map((c) => ({
      ...c,
      otd: c.delivered ? c.onTime / c.delivered : null,
      costPerTkm: c.tkm ? c.cost / c.tkm : 0,
      co2PerTkm: c.tkm ? c.co2 / c.tkm : 0,
    }));

    const hubs = HUBS.map((h, i) => {
      const wave = Math.sin(now / (H * 9) + i * 1.7) * 0.14 + Math.sin(now / (H * 2.3) + i) * 0.05;
      const pressure = active.filter((s) => s.origin === h.id).length / (h.kind === 'warehouse' ? 120 : 30);
      const occupancy = Math.max(0.12, Math.min(0.99, 0.52 + wave + Math.min(0.3, pressure * 0.15)));
      return { ...h, occupancy, dockDoorsBusy: Math.round(occupancy * (h.kind === 'warehouse' ? 24 : 10)), dockDoors: h.kind === 'warehouse' ? 24 : 10 };
    });

    const departures = this.shipments
      .filter((s) => s.status === 'Booked' && s.departAt < now + 12 * H)
      .sort((a, b) => a.departAt - b.departAt)
      .slice(0, 24);

    return {
      now,
      kpis: {
        otd: delivered.length ? onTime / delivered.length : 1,
        delivered24h: delivered.length,
        inTransit: active.filter((s) => s.status === 'In Transit' || s.status === 'At Hub').length,
        booked: active.filter((s) => s.status === 'Booked').length,
        delayed: active.filter((s) => s.status === 'Delayed').length,
        exceptions: active.filter((s) => s.status === 'Exception').length,
        revenue24h: revenue,
        co2Kg24h: Math.round(co2),
        co2PerTkm: tonneKm ? co2 / tonneKm : 0,
        costPerKg: weight ? revenue / weight : 0,
        avgTransitH: { road: avgTransit('road'), air: avgTransit('air'), sea: avgTransit('sea') },
        utilization: {
          road: Math.min(1, inTransit('road') / capacity.road),
          air: Math.min(1, inTransit('air') / capacity.air),
          sea: Math.min(1, inTransit('sea') / capacity.sea),
        },
      },
      modeSplit: {
        road: byMode(delivered, 'road').length,
        air: byMode(delivered, 'air').length,
        sea: byMode(delivered, 'sea').length,
      },
      modeStats: Object.fromEntries(
        MODES.map((m) => {
          const list = byMode(delivered, m);
          const tkm = list.reduce((s, x) => s + (x.weightKg / 1000) * x.distanceKm, 0);
          const co2Kg = list.reduce((s, x) => s + x.co2Kg, 0);
          return [m, { delivered: list.length, tkm, co2Kg, revenue: list.reduce((s, x) => s + x.costAud, 0), onTime: list.filter((x) => x.onTime).length }];
        }),
      ),
      series,
      lanes,
      carriers,
      hubs,
      departures,
      alerts: this.events.slice(-30).reverse(),
    };
  }

  /**
   * Server-style filtered, sorted, paginated query over shipments.
   * @param {{status?:string, mode?:string, q?:string, sort?:keyof Shipment, dir?:'asc'|'desc', page?:number, pageSize?:number}} params
   */
  query({ status = '', mode = '', q = '', sort = 'etaAt', dir = 'asc', page = 1, pageSize = 25 } = {}) {
    const needle = q.trim().toLowerCase();
    let list = this.shipments.filter(
      (s) =>
        (!status || (status === 'Active' ? s.status !== 'Delivered' : s.status === status)) &&
        (!mode || s.mode === mode) &&
        (!needle || `${s.id} ${s.customer} ${s.destinationName} ${s.carrier}`.toLowerCase().includes(needle)),
    );
    const m = dir === 'desc' ? -1 : 1;
    list = list.sort((a, b) => {
      const av = a[sort] ?? 0;
      const bv = b[sort] ?? 0;
      return (av > bv ? 1 : av < bv ? -1 : 0) * m;
    });
    const total = list.length;
    const start = (Math.max(1, page) - 1) * pageSize;
    return { total, page, pageSize, items: list.slice(start, start + pageSize) };
  }
}
