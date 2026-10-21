// Generates api/Terra.Api.Tests/Fixtures/parity.json from the browser engine.
// The .NET tests assert the C# simulator and economy reproduce these numbers exactly.
// usage: node tools/parity-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { LogisticsSim } = await import(path.join(root, 'web/src/engine/logistics/simulator.js'));
const E = await import(path.join(root, 'web/src/engine/idle/economy.js'));

const NOW = Date.UTC(2026, 9, 20, 2, 0, 0);
const sim = new LogisticsSim({ seed: 2032, now: NOW, warmupHours: 72 });
sim.advance(30, 1);
const snap = sim.snapshot();

const states = [
  { name: 'starter', state: { ...E.initialState(NOW - 3 * 3600_000), generators: { bike: 3, van: 2 } } },
  {
    name: 'mid-game',
    state: {
      ...E.initialState(NOW - 20 * 60_000),
      generators: { bike: 20, van: 15, ute: 10, truck: 4, drone: 1 },
      upgrades: ['panniers', 'parcel-tetris', 'lidar', 'night-shift', 'green-diesel'],
      achievements: ['first-delivery', 'gen-10'],
      facilities: { EFD: 3, ACR: 1, YTL: 2, BNEC: 1, PBNE: 1 },
      tokens: 2,
    },
  },
  {
    name: 'late-game',
    state: {
      ...E.initialState(NOW - 30 * 3600_000),
      generators: { bike: 50, van: 40, ute: 30, truck: 25, drone: 20, plane: 10, ship: 5, terminal: 1 },
      upgrades: ['lidar', 'slim-dusty', 'neural-dispatch', 'olympics', 'mezzanine', 'autopilot', 'twin-lift', 'jet-stream', 'magpie-radar'],
      achievements: ['first-delivery', 'gen-10', 'millionaire', 'clicker'],
      facilities: { EFD: 5, ACR: 4, YTL: 3, BNEC: 2, PBNE: 5 },
      tokens: 9,
      frenzyUntil: NOW + 10_000,
      frenzyMult: 7,
    },
  },
];

const fixture = {
  generatedBy: 'tools/parity-fixtures.mjs',
  now: NOW,
  logistics: {
    seed: 2032,
    warmupHours: 72,
    advanceMinutes: 30,
    time: sim.time,
    shipmentCount: sim.shipments.length,
    firstShipments: sim.shipments.slice(0, 5).map((s) => ({ id: s.id, mode: s.mode, destination: s.destination, carrier: s.carrier, customer: s.customer, priority: s.priority, weightKg: s.weightKg, costAud: s.costAud, co2Kg: s.co2Kg, status: s.status, etaAt: s.etaAt })),
    kpis: snap.kpis,
    seriesTotals: snap.series.reduce((a, b) => ({ road: a.road + b.road, air: a.air + b.air, sea: a.sea + b.sea, onTime: a.onTime + b.onTime, late: a.late + b.late }), { road: 0, air: 0, sea: 0, onTime: 0, late: 0 }),
    topLanes: snap.lanes.slice(0, 5).map((l) => ({ lane: l.lane, volume: l.volume })),
    hubs: snap.hubs.map((h) => ({ id: h.id, occupancy: h.occupancy })),
    departures: snap.departures.slice(0, 5).map((d) => d.id),
  },
  economy: states.map(({ name, state }) => {
    const s = E.normalizeState(state, NOW);
    s.frenzyUntil = state.frenzyUntil ?? 0;
    s.frenzyMult = state.frenzyMult ?? 1;
    return { name, state: s, cps: E.coinsPerSecond(s, NOW), offline: E.offlineEarnings(s, NOW) };
  }),
};

const out = path.join(root, 'api/Terra.Api.Tests/Fixtures/parity.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(fixture, null, 2));
console.log(`wrote ${path.relative(root, out)}: ${fixture.logistics.shipmentCount} shipments, OTD ${fixture.logistics.kpis.otd.toFixed(4)}`);
