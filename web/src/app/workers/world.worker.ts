/// <reference lib="webworker" />
import { Graph } from '../../engine/graph.js';
import { World } from '../../engine/world.js';

/** Generates roads, buildings, trees and lane guides off the main thread. */
addEventListener('message', ({ data }: MessageEvent<{ id: number; graph: { points: number[]; segments: number[] }; settings?: Record<string, number> }>) => {
  try {
    const started = performance.now();
    const world = new World(Graph.fromCompact(data.graph), data.settings).generate();
    postMessage({ id: data.id, geometry: world.exportGeometry(), ms: Math.round(performance.now() - started) });
  } catch (e) {
    postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) });
  }
});
