/**
 * Runtime loaders for CDN modules (GSAP, three.js, React Three Fiber).
 * They are external to the Angular bundle and resolved by the import map,
 * so failures (offline, blocked CDN) degrade gracefully instead of breaking the app.
 */

export interface Gsap {
  gsap: any;
  ScrollTrigger: any;
}

let gsapPromise: Promise<Gsap> | null = null;

export function loadGsap(): Promise<Gsap> {
  gsapPromise ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([g, st]) => {
    const gsap = g.gsap ?? g.default;
    const ScrollTrigger = st.ScrollTrigger ?? st.default;
    gsap.registerPlugin(ScrollTrigger);
    return { gsap, ScrollTrigger };
  });
  return gsapPromise;
}

export interface IslandHandle {
  update(props: Record<string, unknown>): void;
  unmount(): void;
  /** Camera helpers (City 3D): factor < 1 moves closer. */
  zoom?(factor: number): void;
  resetView?(): void;
}

export interface IslandModule {
  mount(el: HTMLElement, props: Record<string, unknown>): IslandHandle;
}

/** 3D islands are plain-JS React Three Fiber modules (src/islands), code-split per page. */
export function loadIsland(name: 'hero' | 'ops' | 'city3d'): Promise<IslandModule> {
  if (name === 'hero') return import('../../islands/hero.js');
  if (name === 'city3d') return import('../../islands/city3d.js');
  return import('../../islands/ops.js');
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
