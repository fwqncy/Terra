// Landing hero: a comic diorama of Brisbane that the scroll position flies through.
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import {
  ComicPost, Crane, Flyer, Follow, Label, Plane, Queenslander, Ship, Shuttle, StoryBridge, Tower, Tree, Truck, Car,
  THREE, curveFrom, html, mixHex, ribbonGeometry, toon, useFrame, useMemo, useRef, useThree,
} from './kit.js';

// Camera keyframes per chapter: [position, target]
const KEYS = [
  [[30, 25, 32], [3, 0, 3]], // establishing shot
  [[12, 3.6, 13], [5, 1.4, 3]], // street level: the self-driving fleet
  [[42, 15, 34], [24, 0, 17]], // river mouth: the port
  [[-18, 10, 32], [-7, 3, 20]], // the airport and a departing freighter
  [[4, 58, 7], [4, 0, 5]], // top-down: the map you build
];

const smooth = (t) => t * t * (3 - 2 * t);

function CameraRig({ store, reducedMotion }) {
  const { camera } = useThree();
  const pos = useMemo(() => new THREE.Vector3(...KEYS[0][0]), []);
  const look = useMemo(() => new THREE.Vector3(...KEYS[0][1]), []);
  const cur = useMemo(() => new THREE.Vector3(...KEYS[0][1]), []);
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const p = Math.min(0.9999, Math.max(0, store.progress)) * (KEYS.length - 1);
    const i = Math.floor(p);
    const t = smooth(p - i);
    a.fromArray(KEYS[i][0]);
    b.fromArray(KEYS[i + 1][0]);
    pos.lerpVectors(a, b, t);
    // arc up between shots so the camera never flies through towers or cranes
    pos.y += Math.sin(t * Math.PI) * 9;
    a.fromArray(KEYS[i][1]);
    b.fromArray(KEYS[i + 1][1]);
    look.lerpVectors(a, b, t);
    if (!reducedMotion) {
      const time = state.clock.elapsedTime;
      pos.x += Math.sin(time * 0.15) * 1.2 + store.pointer.x * 1.5;
      pos.y += Math.cos(time * 0.2) * 0.4 - store.pointer.y * 0.8;
    }
    const k = reducedMotion ? 1 : 1 - Math.pow(0.0015, dt);
    camera.position.lerp(pos, k);
    cur.lerp(look, k);
    camera.lookAt(cur);
  });
  return null;
}

function Movers({ curve, count, speed, make, y = 0, reducedMotion }) {
  return Array.from({ length: count }, (_, i) => html`<${Follow} key=${i} curve=${curve} offset=${i / count} speed=${speed} y=${y} still=${reducedMotion}>${make(i)}<//>`);
}

function Clouds({ color, still }) {
  const ref = useRef();
  useFrame((_, dt) => {
    if (!still && ref.current) ref.current.position.x = ((ref.current.position.x + dt * 0.6 + 40) % 80) - 40;
  });
  const puffs = [[-10, 14, -6], [6, 16, -14], [18, 13, 4], [-24, 15, 10], [0, 17, 24]];
  return html`<group ref=${ref}>${puffs.map(([x, y, z], i) => html`
    <group key=${i} position=${[x, y, z]}>
      ${[[0, 0, 0, 2.2], [1.8, -0.3, 0.4, 1.6], [-1.7, -0.4, -0.2, 1.5], [0.4, 0.8, 0, 1.4]].map(([a, b, c, s], j) => html`
        <mesh key=${j} position=${[a, b, c]} scale=${[s, s * 0.8, s]} material=${toon(color)}><icosahedronGeometry args=${[1, 1]} /></mesh>
      `)}
    </group>`)}</group>`;
}

function Scene({ palette, store, reducedMotion, halftone }) {
  const c = palette;
  const land = mixHex(c.light, c.accent, 0.35);
  const water = mixHex(c.primary, c.ink, 0.15);
  const road = mixHex(c.ink, c.deep, 0.5);
  const geo = useMemo(() => {
    const river = curveFrom([[-30, 6], [-18, 9], [-7, 9], [-1, 3], [1, -5], [7, -9], [14, -6], [15, 0], [13, 7], [17, 13], [23, 17], [40, 22]]);
    const cbdLoop = curveFrom([[0, -1], [3, -4], [8, -4], [11, -1], [10, 4], [6, 7], [1, 6], [-1, 3]], true);
    const ring = curveFrom([[-6, 4], [-3, 12], [4, 14], [12, 11], [12, 6], [6, 9], [0, 9], [-4, 6]], true);
    const airportRoad = curveFrom([[0, 9], [-4, 14], [-7, 18]]);
    const shipLane = curveFrom([[44, 24], [32, 20], [24, 17], [18, 14], [14, 9]]);
    const flight = curveFrom([[-14, 20, 0.6], [-4, 24, 0.6], [8, 26, 4], [20, 18, 9], [16, -6, 11], [-6, -12, 10], [-24, 2, 8], [-26, 16, 4]], true);
    const runway = curveFrom([[-16, 18], [-2, 25]]);
    return {
      river,
      cbdLoop,
      ring,
      airportRoad,
      shipLane,
      flight,
      riverGeo: ribbonGeometry(river, 3.4, 220, 0.03),
      loopGeo: ribbonGeometry(cbdLoop, 0.9, 160, 0.05),
      ringGeo: ribbonGeometry(ring, 0.9, 160, 0.05),
      airportRoadGeo: ribbonGeometry(airportRoad, 0.9, 60, 0.05),
      runwayGeo: ribbonGeometry(runway, 2.2, 10, 0.06),
    };
  }, []);

  const towers = useMemo(() => {
    const list = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = 1.6; x <= 9; x += 2.1) {
      for (let z = -2.4; z <= 5; z += 2.1) {
        if (rnd() < 0.15) continue;
        const centre = 1 - Math.min(1, Math.hypot(x - 5.5, z - 1.2) / 6);
        list.push({ x, z, h: 1.5 + centre * 7 + rnd() * 2.5, w: 1.2 + rnd() * 0.5, tone: rnd() });
      }
    }
    return list;
  }, []);

  const houses = useMemo(() => {
    const out = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 1.3 - 0.6;
      out.push({ x: 18 + Math.cos(a) * (3 + (i % 3) * 1.6), z: -4 + Math.sin(a) * (5 + (i % 2) * 1.5), r: i * 0.7 });
    }
    for (let i = 0; i < 14; i++) out.push({ x: -10 + (i % 7) * 1.9, z: 0 + Math.floor(i / 7) * 2.3 - 6, r: i });
    return out;
  }, []);

  const trees = useMemo(() => {
    const out = [];
    for (let i = 0; i < 40; i++) {
      const a = i * 2.39996;
      const r = 6 + (i % 9) * 2.2;
      out.push({ x: 4 + Math.cos(a) * r * 1.4, z: 4 + Math.sin(a) * r, s: 0.7 + (i % 4) * 0.15 });
    }
    return out.filter((t) => Math.hypot(t.x - 5, t.z - 1) > 6);
  }, []);

  return html`
    <color attach="background" args=${[c.bg]} />
    <fog attach="fog" args=${[c.bg, 70, 150]} />
    <hemisphereLight args=${[c.light, c.deep, 1.1]} />
    <directionalLight position=${[20, 40, 10]} intensity=${2.2} />
    <${CameraRig} store=${store} reducedMotion=${reducedMotion} />

    <mesh rotation=${[-Math.PI / 2, 0, 0]} material=${toon(land)}><planeGeometry args=${[220, 220]} /></mesh>
    <mesh position=${[48, 0.02, 30]} rotation=${[-Math.PI / 2, 0, 0]} material=${toon(water)}><planeGeometry args=${[60, 60]} /></mesh>
    <mesh geometry=${geo.riverGeo} material=${toon(water)} />
    <mesh geometry=${geo.loopGeo} material=${toon(road)} />
    <mesh geometry=${geo.ringGeo} material=${toon(road)} />
    <mesh geometry=${geo.airportRoadGeo} material=${toon(road)} />

    ${towers.map((t, i) => html`<${Tower} key=${i} position=${[t.x, 0, t.z]} h=${t.h} w=${t.w} d=${t.w} color=${t.tone > 0.66 ? c.primary : t.tone > 0.33 ? mixHex(c.light, '#ffffff', 0.3) : c.accent} roof=${c.deep} />`)}
    <${StoryBridge} position=${[13.6, 0, 4]} rotation=${Math.PI / 2.4} color=${mixHex(c.deep, '#8899aa', 0.5)} length=${6.5} />
    ${houses.map((h, i) => html`<${Queenslander} key=${'h' + i} position=${[h.x, 0, h.z]} rotation=${h.r} wall=${mixHex(c.light, '#ffffff', 0.55)} roof=${i % 3 ? '#9aa3a8' : c.primary} />`)}
    ${trees.map((t, i) => html`<${Tree} key=${'t' + i} position=${[t.x, 0, t.z]} s=${t.s} color=${mixHex(c.accent, '#3f7f5a', 0.45)} />`)}

    ${Movers({ curve: geo.cbdLoop, count: 7, speed: 0.045, reducedMotion, make: (i) => html`<${Car} color=${[c.primary, '#F2C14E', c.light, '#e5484d'][i % 4]} />` })}
    ${Movers({ curve: geo.ring, count: 5, speed: 0.03, reducedMotion, make: (i) => (i % 2 ? html`<${Truck} color=${c.accent} />` : html`<${Car} color=${c.light} />`) })}

    <group position=${[-9, 0, 21.5]}>
      <mesh position=${[-3, 0.9, -4]} material=${toon(mixHex(c.light, '#ffffff', 0.4))}><boxGeometry args=${[6, 1.8, 2.4]} /></mesh>
      <mesh position=${[2.5, 2.2, -4.5]} material=${toon(c.accent)}><cylinderGeometry args=${[0.35, 0.5, 4.4, 8]} /></mesh>
      <mesh position=${[2.5, 4.6, -4.5]} material=${toon(c.primary)}><cylinderGeometry args=${[0.9, 0.7, 0.8, 8]} /></mesh>
    </group>
    <mesh geometry=${geo.runwayGeo} material=${toon('#2b2b2b')} />
    <${Flyer} curve=${geo.flight} still=${reducedMotion}><${Plane} tail=${c.primary} /><//>

    <group position=${[24, 0, 19]}>
      <mesh position=${[0, 0.3, 0]} material=${toon(mixHex(c.light, c.ink, 0.35))}><boxGeometry args=${[8, 0.6, 5]} /></mesh>
      ${[-2.6, 0, 2.6].map((x, i) => html`<${Crane} key=${i} position=${[x, 0.6, -1]} rotation=${0.5} color="#F2C14E" />`)}
      ${[0, 1, 2, 3, 4, 5].map((i) => html`<mesh key=${'c' + i} position=${[-3 + (i % 3) * 1.4, 0.95 + Math.floor(i / 3) * 0.7, 1.4]} material=${toon([c.primary, c.light, c.accent, '#d62839'][i % 4])}><boxGeometry args=${[1.2, 0.65, 0.65]} /></mesh>`)}
    </group>
    <${Shuttle} curve=${geo.shipLane} speed=${0.025} still=${reducedMotion} y=${0.05}><${Ship} hull="#d62839" boxes=${[c.primary, c.light, c.accent]} /><//>

    <${Clouds} color=${mixHex(c.light, '#ffffff', 0.7)} still=${reducedMotion} />
    <${Label} text="CBD" position=${[5.5, 11.5, 1]} scale=${1.4} />
    <${Label} text="STORY BRIDGE" position=${[14, 4.5, 4]} />
    <${Label} text="PORT OF BRISBANE" position=${[24, 6, 19]} />
    <${Label} text="BNE" position=${[-9, 7, 18]} scale=${1.2} />
    <${ComicPost} ink="#0c0a08" shadow=${c.ink} halftone=${halftone} />
  `;
}

export function mount(el, props) {
  const store = { progress: props.progress ?? 0, pointer: { x: 0, y: 0 } };
  const root = createRoot(el);
  let current = { ...props };
  const render = () =>
    root.render(html`
      <${Canvas}
        dpr=${[1, 1.75]}
        flat
        frameloop=${current.paused ? 'never' : 'always'}
        camera=${{ fov: 35, near: 0.5, far: 260, position: KEYS[0][0] }}
        gl=${{ antialias: false, powerPreference: 'high-performance' }}
        onCreated=${() => current.onReady?.()}
      >
        <${Scene} palette=${current.palette} store=${store} reducedMotion=${!!current.reducedMotion} halftone=${current.halftone !== false} />
      <//>
    `);
  render();
  return {
    update(next) {
      if (typeof next.progress === 'number') store.progress = next.progress;
      if (next.pointer) store.pointer = next.pointer;
      const visual = ['palette', 'reducedMotion', 'halftone', 'paused'].some((k) => k in next && next[k] !== current[k]);
      current = { ...current, ...next };
      if (visual) render();
    },
    unmount() {
      root.unmount();
    },
  };
}
