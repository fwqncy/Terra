/// <reference lib="webworker" />
import { Graph } from '../../engine/graph.js';
import { createRng } from '../../engine/math/rng.js';
import { bootcamp } from '../../engine/sim/bootcamp.js';
import { World } from '../../engine/world.js';

/**
 * Headless multi-route training in the background: every brain drives several random
 * routes per generation, so the winner generalises across the whole map.
 */
addEventListener('message', ({ data }: MessageEvent<{ graph: { points: number[]; segments: number[] }; generations: number; routes: number; seed: number; brain?: unknown }>) => {
  try {
    const world = new World(Graph.fromCompact(data.graph)).generate();
    const rng = createRng(data.seed);
    const tasks = [];
    for (let i = 0; i < data.routes * 4 && tasks.length < data.routes; i++) {
      const r = world.suggestRoute(rng);
      if (r) tasks.push({ world, start: r.start, target: r.target });
    }
    if (!tasks.length) {
      postMessage({ type: 'error', message: 'This map has no drivable routes yet. Add more roads.' });
      return;
    }
    const trainer = bootcamp(tasks, {
      generations: data.generations,
      populationSize: 50,
      seed: data.seed,
      brain: data.brain ?? null,
      onGeneration: (e: { generation: number; best: number; mean: number; arrivals: number; routes: number }) =>
        postMessage({ type: 'progress', generation: e.generation + 1, total: data.generations, best: e.best, mean: e.mean, arrivals: e.arrivals, routes: e.routes }),
    });
    postMessage({ type: 'done', brain: trainer.best, fitness: trainer.bestFitness, routes: tasks.length });
  } catch (e) {
    postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
});
