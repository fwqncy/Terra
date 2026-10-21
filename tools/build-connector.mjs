// Builds the Power Platform custom connector definition from the API's generated OpenAPI 2.0.
// usage: node tools/build-connector.mjs [api-base-url]
//   e.g. node tools/build-connector.mjs http://localhost:5080   (fetches /swagger/v1/swagger-v2.json first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'power-platform/connector');
const generated = path.join(dir, 'openapi-v2.json');

const base = process.argv[2];
if (base) {
  const res = await fetch(`${base.replace(/\/$/, '')}/swagger/v1/swagger-v2.json`);
  if (!res.ok) throw new Error(`Could not fetch OpenAPI from ${base}: ${res.status}`);
  fs.writeFileSync(generated, JSON.stringify(await res.json(), null, 2));
}
const spec = JSON.parse(fs.readFileSync(generated, 'utf8'));

// Operations a maker sees in Power Apps / Power Automate; the rest stay "internal".
const VISIBLE = {
  GetLogisticsSnapshot: { summary: 'Get network snapshot', visibility: 'important' },
  QueryShipments: { summary: 'Find shipments', visibility: 'important' },
  ExpediteShipment: { summary: 'Expedite a shipment', visibility: 'important' },
  GetLeaderboard: { summary: 'Get leaderboard', visibility: 'advanced' },
  GetHealth: { summary: 'Check API health', visibility: 'advanced' },
  ListBrains: { summary: 'List trained brains', visibility: 'advanced' },
};

const titleCase = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

for (const [route, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const meta = VISIBLE[op.operationId];
    op.summary = meta?.summary ?? op.summary ?? titleCase(op.operationId ?? `${method} ${route}`);
    op.description = op.description ?? op.summary;
    op['x-ms-visibility'] = meta?.visibility ?? 'internal';
    for (const p of op.parameters ?? []) {
      p['x-ms-summary'] = p['x-ms-summary'] ?? titleCase(p.name);
      if (p.name === 'status' && route.includes('shipments')) {
        p.enum = ['Active', 'Booked', 'In Transit', 'At Hub', 'Delayed', 'Exception', 'Delivered'];
        p['x-ms-summary'] = 'Status';
      }
      if (p.name === 'mode') {
        p.enum = ['road', 'air', 'sea'];
        p['x-ms-summary'] = 'Mode';
      }
    }
  }
}

const connector = {
  ...spec,
  info: {
    ...spec.info,
    title: 'Terra Logistics',
    description: 'Live Brisbane logistics network from the Terra sim: KPIs, shipments, expediting and the depot leaderboard.',
    'x-ms-api-annotation': { status: 'Preview' },
  },
  host: 'terra-api.azurewebsites.net',
  basePath: '/',
  schemes: ['https'],
  consumes: ['application/json'],
  produces: ['application/json'],
  'x-ms-connector-metadata': [
    { propertyName: 'Website', propertyValue: 'https://terra-web.azurestaticapps.net' },
    { propertyName: 'Categories', propertyValue: 'Productivity;Business Intelligence' },
  ],
};

fs.writeFileSync(path.join(dir, 'apiDefinition.swagger.json'), JSON.stringify(connector, null, 2));
console.log(`apiDefinition.swagger.json: ${Object.keys(connector.paths).length} paths, ${Object.values(VISIBLE).length} maker-visible actions`);
