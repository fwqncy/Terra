import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../idle/economy.js';
import { LogisticsSim } from '../logistics/simulator.js';

const NOW = Date.UTC(2026, 9, 20, 2, 0, 0);

test('generator costs grow 15% per unit and sum geometrically', () => {
  assert.equal(E.generatorCost('bike', 0), 15);
  assert.equal(E.generatorCost('bike', 1), Math.ceil(15 * 1.15));
  assert.equal(E.generatorCost('bike', 0, 2), Math.ceil(15 + 15 * 1.15));
});

test('buying, clicking and ticking', () => {
  let s = E.initialState(NOW);
  assert.equal(E.buyGenerator(s, 'bike').ok, false);
  for (let i = 0; i < 20; i++) s = E.click(s, NOW);
  const r = E.buyGenerator(s, 'bike');
  assert.equal(r.ok, true);
  s = r.state;
  assert.equal(s.generators.bike, 1);
  assert.ok(Math.abs(E.coinsPerSecond(s, NOW) - 0.1) < 1e-9);
  const t = E.tick(s, 10, NOW);
  assert.ok(Math.abs(t.coins - s.coins - 1) < 1e-9);
});

test('upgrades require their prerequisites', () => {
  let s = { ...E.initialState(NOW), coins: 1e6 };
  assert.equal(E.buyUpgrade(s, 'lidar').ok, false);
  s = E.buyGenerator(s, 'ute').state;
  const r = E.buyUpgrade(s, 'lidar');
  assert.equal(r.ok, true);
  assert.equal(E.generatorCps(r.state, 'ute'), 16);
});

test('offline earnings are capped and discounted', () => {
  const s = { ...E.initialState(NOW - 10 * 3600_000), generators: { ...E.initialState().generators, van: 10 } };
  const off = E.offlineEarnings(s, NOW);
  assert.equal(off.capHours, 2);
  assert.equal(off.cappedSeconds, 7200);
  assert.ok(Math.abs(off.earned - 10 * 7200 * 0.5) < 1e-6);
  const applied = E.applyOffline(s, NOW);
  assert.equal(applied.state.lastSeen, NOW);
  assert.equal(applied.state.stats.offlineClaims, 1);
});

test('frenzy multiplies only while active', () => {
  const s = { ...E.initialState(NOW), generators: { ...E.initialState().generators, van: 1 } };
  const g = E.catchGolden(s, NOW, 0.1);
  assert.equal(g.kind, 'frenzy');
  assert.equal(E.coinsPerSecond(g.state, NOW + 1000), 7);
  assert.equal(E.coinsPerSecond(g.state, NOW + 31_000), 1);
});

test('normalizeState repairs hostile saves', () => {
  const s = E.normalizeState({ coins: -5, generators: { bike: 'lots', van: 3 }, upgrades: ['lidar', 'hack'], equipped: { skin: 'holo' }, lastSeen: NOW * 2 }, NOW);
  assert.equal(s.coins, 0);
  assert.equal(s.generators.bike, 0);
  assert.equal(s.generators.van, 3);
  assert.deepEqual(s.upgrades, ['lidar']);
  assert.equal(s.equipped.skin, 'ute');
  assert.equal(s.lastSeen, NOW);
  assert.deepEqual(E.normalizeState('garbage', NOW).coins, 0);
});

test('deliveries pay, record destinations and unlock achievements', () => {
  let s = E.initialState(NOW);
  s = E.recordEvent(s, { type: 'delivery', mode: 'sea', to: 'TANG', training: false }, NOW);
  assert.ok(s.coins >= 25);
  assert.deepEqual(E.checkAchievements(s).sort(), ['bay-pilot', 'first-delivery']);
});

test('franchise resets the run but keeps cosmetics and grants tokens', () => {
  const s = { ...E.initialState(NOW), lifetime: 16e6, lifetimeAllTime: 16e6, coins: 1e6, owned: { skins: ['ute', 'holo'], homes: ['queenslander'], maps: ['brisbane', 'sandbox'] } };
  const r = E.franchise(s, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.state.tokens, 4);
  assert.equal(r.state.coins, 0);
  assert.ok(r.state.owned.skins.includes('holo'));
  assert.ok(E.coinsPerSecond({ ...r.state, generators: { ...r.state.generators, van: 1 } }, NOW) > 1);
});

test('logistics sim is deterministic and produces sane KPIs', () => {
  const a = new LogisticsSim({ seed: 7, now: NOW });
  const b = new LogisticsSim({ seed: 7, now: NOW });
  assert.deepEqual(a.snapshot().kpis, b.snapshot().kpis);
  const k = a.snapshot().kpis;
  assert.ok(k.otd >= 0 && k.otd <= 1);
  assert.ok(k.delivered24h > 50);
  assert.ok(k.inTransit > 0);
  assert.equal(a.snapshot().series.length, 48);
});

test('shipment query filters, sorts and paginates; expedite pulls ETA forward', () => {
  const sim = new LogisticsSim({ seed: 3, now: NOW });
  const page = sim.query({ mode: 'air', status: 'Active', sort: 'etaAt', dir: 'asc', page: 1, pageSize: 5 });
  assert.ok(page.items.length <= 5);
  assert.ok(page.items.every((s) => s.mode === 'air' && s.status !== 'Delivered'));
  for (let i = 1; i < page.items.length; i++) assert.ok(page.items[i - 1].etaAt <= page.items[i].etaAt);
  const target = sim.query({ status: 'In Transit', pageSize: 1 }).items[0];
  const before = target.etaAt;
  sim.expedite(target.id);
  assert.ok(target.etaAt < before);
  assert.equal(target.expedited, true);
});

test('facility upgrades cost 4× per level, cap at 5 and raise earnings', () => {
  let s = { ...E.initialState(NOW), coins: 1e9, generators: { ...E.initialState().generators, van: 1 } };
  const before = E.coinsPerSecond(s, NOW);
  assert.equal(E.facilityCost('EFD', 1), 5_000);
  assert.equal(E.facilityCost('EFD', 2), 20_000);
  for (let i = 0; i < 4; i++) s = E.upgradeFacility(s, 'EFD').state;
  assert.equal(s.facilities.EFD, 5);
  assert.equal(E.upgradeFacility(s, 'EFD').ok, false);
  assert.ok(Math.abs(E.coinsPerSecond(s, NOW) / before - 1.16) < 1e-9);
  assert.equal(E.normalizeState({ facilities: { EFD: 99 } }, NOW).facilities.EFD, 5);
});
