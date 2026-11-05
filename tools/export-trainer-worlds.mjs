// Exports City Lab maps for the C++ trainer: corridor borders, route polylines and start poses,
// all built by the browser engine (the source of truth).
// usage: node tools/export-trainer-worlds.mjs [--routes 10] [--holdout 2] [--out trainer/worlds]
import fs from 'node:fs';
import path from 'node:path';
import { MAPS, exportWorld, loadWorld, root, suggestTasks } from './lib/trainer-world.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const routes = Number(arg('routes', 10));
const holdout = Number(arg('holdout', 2));
const out = path.resolve(root, arg('out', 'trainer/worlds'));
fs.mkdirSync(out, { recursive: true });

for (const id of MAPS) {
  const t0 = performance.now();
  const world = await loadWorld(id);
  const tasks = suggestTasks(world, routes, 1);
  const doc = exportWorld(id, world, tasks, { split: holdout });
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(doc));
  const km = tasks.reduce((s, t) => s + t.corridor.route.length, 0) / 6000;
  console.log(`${id}: ${tasks.length} routes (${holdout} held out), ${km.toFixed(1)} km of road, ${(performance.now() - t0).toFixed(0)} ms`);
}
