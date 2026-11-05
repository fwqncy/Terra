// Runs the app's own Bootcamp episode code (sim/bootcamp.js runEpisode) on exported trainer routes.
// Plain relative imports, so the same file runs in Node and in a browser page.
import { runEpisode } from '../../web/src/engine/sim/bootcamp.js';
import { Route } from '../../web/src/engine/route.js';
import { SegmentGrid } from '../../web/src/engine/math/segment-grid.js';
import { NeuralNetwork } from '../../web/src/engine/ai/network.js';

/** Rebuilds the engine's corridor objects from an exported task. */
export function corridorOf(task, gridCell) {
  const borders = [];
  for (let i = 0; i < task.borders.length; i += 4) {
    borders.push({ p1: { x: task.borders[i], y: task.borders[i + 1] }, p2: { x: task.borders[i + 2], y: task.borders[i + 3] } });
  }
  return { route: new Route(task.route.map(([x, y]) => ({ x, y }))), grid: new SegmentGrid(borders, gridCell) };
}

/** A Start marking whose heading is the exported start angle (angleFromDirection inverts it). */
function startOf(task) {
  const a = task.start.angle;
  return { center: { x: task.start.x, y: task.start.y }, directionVector: { x: -Math.sin(a), y: -Math.cos(a) } };
}

/**
 * @param {any} worldDoc exported world (terra-trainer-world v1)
 * @param {any[]} brains JS brain objects
 * @returns {{seconds:number, scores:number[][]}} scores[brain][task]
 */
export function bench(worldDoc, brains) {
  const prepared = worldDoc.tasks.map((t) => ({ corridor: corridorOf(t, worldDoc.gridCell), start: startOf(t) }));
  const scores = brains.map(() => []);
  const t0 = performance.now();
  for (const p of prepared) {
    const s = runEpisode(p.corridor, p.start, brains.map((b) => NeuralNetwork.clone(b)), { roadWidth: worldDoc.roadWidth });
    s.forEach((v, i) => scores[i].push(v));
  }
  return { seconds: (performance.now() - t0) / 1000, scores };
}
