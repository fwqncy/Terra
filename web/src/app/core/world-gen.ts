import type { World } from '../../engine/world.js';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (g: unknown) => void; reject: (e: Error) => void }>();

/** Generates world geometry in a Web Worker (falls back to the main thread). */
export async function generateWorld(world: World): Promise<number> {
  const started = performance.now();
  if (typeof Worker === 'undefined') {
    world.generate();
    return Math.round(performance.now() - started);
  }
  if (!worker) {
    worker = new Worker(new URL('../workers/world.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data);
    };
  }
  const id = ++seq;
  const result = (await new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (g: unknown) => void, reject });
    worker!.postMessage({ id, graph: world.graph.toCompact(), settings: world.settings });
  })) as { geometry: Parameters<World['importGeometry']>[0]; ms: number };
  // Ignore stale results if a newer generation was requested meanwhile.
  if (id !== seq) return -1;
  world.envelopes = [];
  world.importGeometry(result.geometry);
  return result.ms;
}

export function latestGeneration(): number {
  return seq;
}
