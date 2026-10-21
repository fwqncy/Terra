import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeDispatch, escapeHtml, issueNumber, quoteOffline, sanitiseTelemetry, sign } from '../src/lib/handlers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NOW = Date.UTC(2026, 9, 20, 2);

test('the shared economy is byte-identical to the browser engine', () => {
  const engine = path.resolve(here, '../../web/src/engine/idle/economy.js');
  if (!fs.existsSync(engine)) return; // packaged deploys don't ship the web app
  const shared = fs.readFileSync(path.resolve(here, '../src/shared/economy.js'), 'utf8');
  assert.equal(shared.replace(/^\/\/ GENERATED.*\n/, ''), fs.readFileSync(engine, 'utf8'));
});

test('offline quote uses the browser rules (2 h cap at 50%)', () => {
  const r = quoteOffline({ state: { generators: { van: 10 }, lastSeen: NOW - 5 * 3600_000 } }, NOW);
  assert.equal(r.status, 200);
  assert.equal(r.body.capHours, 2);
  assert.equal(r.body.cappedSeconds, 7200);
  assert.ok(Math.abs(r.body.earned - 10 * 7200 * 0.5) < 1e-6);
  assert.equal(quoteOffline({}, NOW).status, 400);
});

test('telemetry is validated, trimmed and capped', () => {
  const r = sanitiseTelemetry({ events: [{ type: 'delivery', mode: 'air', to: 'NANXXXXXXXX', secret: 'x' }, { type: 'hack' }, null] }, 'p1');
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].to, 'NANXXXXX');
  assert.equal(r.events[0].secret, undefined);
  assert.match(sanitiseTelemetry({ events: new Array(501).fill({ type: 'page' }) }).error, /at most/);
  assert.match(sanitiseTelemetry({}).error, /events/);
});

test('daily dispatch summarises the snapshot', () => {
  const snap = {
    kpis: { otd: 0.962, delivered24h: 344, inTransit: 120, delayed: 6, exceptions: 1, co2Kg24h: 132_000, co2PerTkm: 0.19 },
    lanes: [{ origin: 'EFD', destination: 'Gold Coast', volume: 40 }],
    hubs: [{ name: 'Port of Brisbane', occupancy: 0.91 }, { name: 'Eagle Farm DC', occupancy: 0.5 }],
  };
  const d = composeDispatch(snap, 22, new Date(NOW));
  assert.match(d.title, /^Dispatch #22: Right on time: 96\.2%/);
  assert.ok(d.lines.some((l) => l.includes('EFD → Gold Coast')));
  assert.ok(d.lines.some((l) => l.includes('Port of Brisbane at 91.0%')));
  assert.ok(d.html.startsWith('<p><strong>'));
});

test('helpers: HMAC signing, HTML escaping and issue numbers', () => {
  assert.equal(sign('{}', ''), undefined);
  assert.match(sign('{}', 'secret'), /^sha256=[0-9a-f]{64}$/);
  assert.equal(escapeHtml('<b>"&"</b>'), '&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
  assert.equal(issueNumber(new Date(Date.UTC(2026, 8, 30, 12))), 1);
  assert.ok(issueNumber(new Date(NOW)) > 20);
});
