// The in-browser genetic algorithm (ai/trainer.js + sim/bootcamp.js), run in Node on the same routes as
// Terra Trainer, logging the same columns so trainer/py can compare them.
// usage: node tools/ga-baseline.mjs [--generations 150] [--population 64] [--seed 9] [--out trainer/runs/<stamp>-browser-ga]
import fs from 'node:fs';
import path from 'node:path';
import {
  CAR_SENSOR, Car, MAPS, NeuralNetwork, bootcamp, createRng, loadWorld, root, runEpisode, suggestTasks,
} from './lib/trainer-world.mjs';

const { Trainer } = await import(path.join(root, 'web/src/engine/ai/trainer.js'));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const generations = Number(arg('generations', 150));
const populationSize = Number(arg('population', 64));
const seed = Number(arg('seed', 9));
const ROUTES = 10;
const HOLDOUT = 2;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = path.resolve(root, arg('out', `trainer/runs/${stamp}-browser-ga`));

// Same routes as tools/export-trainer-worlds.mjs (same seeds, same split).
const train = [];
const holdout = [];
for (const id of MAPS) {
  const world = await loadWorld(id);
  suggestTasks(world, ROUTES, 1).forEach((t, i) => (i >= ROUTES - HOLDOUT ? holdout : train).push({ map: id, world, ...t }));
}

/** bootcamp() as written, with the elite also scored on every route each generation. */
function run(gens, onGeneration) {
  const rng = createRng(seed);
  const trainer = new Trainer({ populationSize, mutation: 0.12, random: rng.next, best: null });
  for (let g = 0; g < gens; g++) {
    const t0 = performance.now();
    const brains = trainer.nextBrains().map((b) => b ?? new Car({ x: 0, y: 0, sensor: CAR_SENSOR, random: rng.next }).brain);
    const totals = new Array(brains.length).fill(0);
    for (const t of train) runEpisode(t.corridor, t.start, brains, { roadWidth: t.world.roadWidth }).forEach((s, i) => (totals[i] += s));
    const fitness = totals.map((s) => s / train.length);
    trainer.evaluate(brains.map((b, i) => ({ brain: b, fitness: fitness[i], arrived: false, damaged: false })));
    onGeneration?.({ g, brains, fitness, trainer, seconds: (performance.now() - t0) / 1000 });
  }
  return trainer;
}

// Guard: this loop must be the app's bootcamp() exactly (same elite after a few generations).
const check = run(2);
const real = bootcamp(train.map((t) => ({ world: t.world, start: t.start, target: t.target })), { generations: 2, populationSize, seed });
if (JSON.stringify(check.best) !== JSON.stringify(real.best)) throw new Error('baseline loop drifted from bootcamp()');

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ algo: 'browser-ga', generations, population: populationSize, seed, mutation: 0.12, train_tasks: train.length, holdout_tasks: holdout.length, runtime: `node ${process.version}` }, null, 2));
const rows = ['generation,pop_best,pop_mean,train_score,holdout_score,train_arrived,holdout_arrived,best_train_score,episodes,car_steps,seconds,wall'];
const eps = ['generation,task_id,map,holdout,score,arrived'];
const t0 = performance.now();
const final = run(generations, ({ g, fitness, trainer, seconds }) => {
  const evalSet = [...train, ...holdout];
  const scores = evalSet.map((t) => runEpisode(t.corridor, t.start, [NeuralNetwork.clone(trainer.best)], { roadWidth: t.world.roadWidth })[0]);
  const tr = scores.slice(0, train.length);
  const ho = scores.slice(train.length);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  evalSet.forEach((t, i) => eps.push([g + 1, `${t.map}-${t.seed}`, t.map, i >= train.length, scores[i], scores[i] >= 1].join(',')));
  rows.push([g + 1, Math.max(...fitness), mean(fitness), mean(tr), mean(ho), tr.filter((s) => s >= 1).length, ho.filter((s) => s >= 1).length,
    trainer.bestFitness, fitness.length * train.length + evalSet.length, '', seconds.toFixed(4), ((performance.now() - t0) / 1000).toFixed(4)].join(','));
  if ((g + 1) % 10 === 0 || g === 0) console.log(`gen ${g + 1}: elite train ${mean(tr).toFixed(3)} (${tr.filter((s) => s >= 1).length}/${train.length}) holdout ${mean(ho).toFixed(3)} · ${seconds.toFixed(1)} s/gen`);
});
fs.writeFileSync(path.join(out, 'generations.csv'), rows.join('\n') + '\n');
fs.writeFileSync(path.join(out, 'episodes.csv'), eps.join('\n') + '\n');
fs.writeFileSync(path.join(out, 'best-brain.json'), JSON.stringify({ name: `Browser GA g${generations}`, domain: 'city', generation: generations, fitness: final.bestFitness, network: final.best }));
console.log(`wrote ${path.relative(root, out)} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
