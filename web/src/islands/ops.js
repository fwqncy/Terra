// 3D Ops: a strategy-game view of the Brisbane logistics network (warehouses, seaport, airport).
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ComicPost, Crane, Flyer, Follow, Label, Plane, Ship, Shuttle, Tower, Tree, Truck, Warehouse, Car,
  THREE, curveFrom, html, mixHex, ribbonGeometry, toon, useEffect, useFrame, useMemo, useRef, useThree,
} from './kit.js';

/** Facility anchors in world space (x, z). Ids match the logistics catalog. */
export const LAYOUT = {
  EFD: { pos: [-12, 2], kind: 'warehouse' },
  ACR: { pos: [-24, 18], kind: 'warehouse' },
  YTL: { pos: [8, 22], kind: 'warehouse' },
  PBNE: { pos: [30, -2], kind: 'seaport' },
  BNEC: { pos: [0, -24], kind: 'airport' },
};

function Controls({ focus, store }) {
  const { camera, gl } = useThree();
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI * 0.44;
    c.minDistance = 12;
    c.maxDistance = 110;
    c.target.set(2, 0, 2);
    c.screenSpacePanning = false;
    return c;
  }, [camera, gl]);
  const goal = useMemo(() => new THREE.Vector3(2, 0, 2), []);
  useEffect(() => {
    const f = focus && LAYOUT[focus];
    if (f) goal.set(f.pos[0], 0, f.pos[1]);
    store.focusing = !!f;
  }, [focus]);
  useEffect(() => () => controls.dispose(), [controls]);
  useFrame(() => {
    if (store.focusing) {
      controls.target.lerp(goal, 0.08);
      if (controls.target.distanceTo(goal) < 0.05) store.focusing = false;
    }
    controls.update();
  });
  return null;
}

function SelectionRing({ id, color }) {
  const ref = useRef();
  useFrame((state) => {
    if (!ref.current) return;
    const s = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.05;
    ref.current.scale.set(s, s, s);
    ref.current.rotation.z += 0.01;
  });
  const f = LAYOUT[id];
  if (!f) return null;
  const r = f.kind === 'warehouse' ? 4.4 : 7;
  return html`<mesh ref=${ref} position=${[f.pos[0], 0.12, f.pos[1]]} rotation=${[-Math.PI / 2, 0, 0]} material=${toon(color)}><ringGeometry args=${[r, r + 0.5, 48]} /></mesh>`;
}

function OccupancyBar({ x, z, value, color }) {
  const h = Math.max(0.15, value * 5);
  return html`
    <group position=${[x, 0, z]}>
      <mesh position=${[0, 2.5, 0]} material=${toon('#2b2b2b')}><boxGeometry args=${[0.55, 5, 0.55]} /></mesh>
      <mesh position=${[0, h / 2, 0]} material=${toon(color)}><boxGeometry args=${[0.62, h, 0.62]} /></mesh>
    </group>
  `;
}

function DayNight({ store, bg, night }) {
  const { scene } = useThree();
  const sun = useRef();
  const hemi = useRef();
  const day = useMemo(() => new THREE.Color(bg), [bg]);
  const dark = useMemo(() => new THREE.Color(night), [night]);
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    if (!store.paused) store.clock = (store.clock + dt * store.speed * 0.01) % 1;
    const sunUp = Math.max(0, Math.sin(store.clock * Math.PI * 2));
    tmp.copy(dark).lerp(day, 0.25 + sunUp * 0.75);
    scene.background = tmp;
    if (scene.fog) scene.fog.color.copy(tmp);
    if (sun.current) {
      sun.current.intensity = 0.4 + sunUp * 2;
      sun.current.position.set(Math.cos(store.clock * Math.PI * 2) * 40, 10 + sunUp * 40, 20);
    }
    if (hemi.current) hemi.current.intensity = 0.6 + sunUp * 0.6;
  });
  return html`
    <hemisphereLight ref=${hemi} args=${['#fff6dd', '#2a2440', 1]} />
    <directionalLight ref=${sun} position=${[20, 40, 20]} intensity=${2} />
  `;
}

function Facility({ id, children, onSelect, onHover }) {
  return html`
    <group
      onClick=${(e) => {
        e.stopPropagation();
        onSelect?.(id);
      }}
      onPointerOver=${(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
        onHover?.(id);
      }}
      onPointerOut=${() => {
        document.body.style.cursor = '';
        onHover?.(null);
      }}
    >${children}</group>
  `;
}

function Scene({ palette: c, facilities, fleet, selected, focus, store, onSelect, onHover, reducedMotion, halftone }) {
  const land = mixHex(c.light, c.accent, 0.3);
  const water = mixHex(c.primary, c.ink, 0.15);
  const road = mixHex(c.ink, c.deep, 0.45);
  const levels = Object.fromEntries((facilities ?? []).map((f) => [f.id, f]));
  const lvl = (id) => levels[id]?.level ?? 1;
  const occ = (id) => levels[id]?.occupancy ?? 0.5;
  const occColor = (v) => (v > 0.9 ? '#D03B3B' : v > 0.75 ? '#FAB219' : '#3987E5');

  const geo = useMemo(() => {
    const ring = curveFrom([[-12, 6], [-20, 14], [-24, 22], [-14, 26], [4, 26], [12, 20], [22, 8], [26, 0], [20, -6], [8, -12], [2, -18], [-6, -12], [-10, -4]], true);
    const spur = curveFrom([[-12, 6], [-4, 8], [6, 10], [12, 20]]);
    const shipLane = curveFrom([[70, -30], [52, -16], [40, -6], [33, -2]]);
    const shipLane2 = curveFrom([[72, 10], [56, 6], [42, 2], [33, 1]]);
    const runway = curveFrom([[-10, -27], [12, -21]]);
    const flight = curveFrom([[-10, -27, 0.5], [12, -21, 0.5], [30, -18, 6], [36, -36, 12], [0, -46, 14], [-34, -34, 10], [-30, -24, 4], [-20, -28, 1.5]], true);
    const flight2 = curveFrom([[-6, -26, 0.5], [16, -20, 2], [40, -10, 10], [24, -50, 16], [-30, -44, 12], [-26, -28, 3]], true);
    return {
      ring, spur, shipLane, shipLane2, flight, flight2,
      ringGeo: ribbonGeometry(ring, 1.4, 300, 0.05),
      spurGeo: ribbonGeometry(spur, 1.2, 100, 0.05),
      runwayGeo: ribbonGeometry(runway, 3, 8, 0.06),
    };
  }, []);

  const trucks = Math.min(14, 3 + Math.round(fleet?.trucks ?? 0));
  const ships = Math.min(3, 1 + Math.floor((fleet?.ships ?? 0) / 2));
  const planes = Math.min(3, 1 + Math.floor((fleet?.planes ?? 0) / 2));
  const still = reducedMotion;

  const trees = useMemo(() => {
    const out = [];
    for (let i = 0; i < 60; i++) {
      const a = i * 2.39996;
      const r = 14 + (i % 11) * 3.2;
      const x = Math.cos(a) * r * 1.2;
      const z = Math.sin(a) * r;
      if (x > 24 || Object.values(LAYOUT).some((f) => Math.hypot(f.pos[0] - x, f.pos[1] - z) < 8)) continue;
      out.push({ x, z, s: 0.8 + (i % 3) * 0.25 });
    }
    return out;
  }, []);

  return html`
    <color attach="background" args=${[c.bg]} />
    <fog attach="fog" args=${[c.bg, 90, 190]} />
    <${DayNight} store=${store} bg=${mixHex(c.light, '#bcd4ff', 0.35)} night=${mixHex(c.ink, '#0b1030', 0.5)} />
    <${Controls} focus=${focus} store=${store} />

    <mesh rotation=${[-Math.PI / 2, 0, 0]} material=${toon(land)} onClick=${() => onSelect?.(null)}><planeGeometry args=${[260, 260]} /></mesh>
    <mesh position=${[80, 0.03, 0]} rotation=${[-Math.PI / 2, 0, 0]} material=${toon(water)}><planeGeometry args=${[100, 260]} /></mesh>
    <mesh geometry=${geo.ringGeo} material=${toon(road)} />
    <mesh geometry=${geo.spurGeo} material=${toon(road)} />

    ${['EFD', 'ACR', 'YTL'].map((id) => {
      const [x, z] = LAYOUT[id].pos;
      const level = lvl(id);
      return html`
        <${Facility} key=${id} id=${id} onSelect=${onSelect} onHover=${onHover}>
          <${Warehouse} position=${[x, 0, z]} w=${4 + level * 1.4} d=${3.2} wall=${mixHex(c.light, '#ffffff', 0.5)} roof=${c.accent} level=${level} />
          ${level >= 3 ? html`<${Warehouse} position=${[x, 0, z + 4.2]} w=${4} d=${2.6} wall=${mixHex(c.light, '#ffffff', 0.4)} roof=${c.primary} level=${1} />` : null}
          <${OccupancyBar} x=${x - 4 - level * 0.7} z=${z} value=${occ(id)} color=${occColor(occ(id))} />
          <${Label} text=${id} position=${[x, 4.6, z]} scale=${2.6} bg=${selected === id ? '#F2C14E' : '#F4F1EA'} />
        <//>
      `;
    })}

    <${Facility} id="PBNE" onSelect=${onSelect} onHover=${onHover}>
      <group position=${[LAYOUT.PBNE.pos[0], 0, LAYOUT.PBNE.pos[1]]}>
        <mesh position=${[0, 0.4, 0]} material=${toon(mixHex(c.light, c.ink, 0.35))}><boxGeometry args=${[10, 0.8, 16]} /></mesh>
        ${Array.from({ length: 1 + lvl('PBNE') }, (_, i) => html`<${Crane} key=${i} position=${[3.5, 0.8, -5 + i * 3.2]} rotation=${Math.PI / 2} />`)}
        ${Array.from({ length: 12 }, (_, i) => html`<mesh key=${'b' + i} position=${[-3 + (i % 3) * 1.5, 1.15 + Math.floor(i / 6) * 0.7, -5 + (Math.floor(i / 3) % 2) * 2 + Math.floor(i / 6) * 5]} material=${toon([c.primary, c.light, c.accent, '#d62839'][i % 4])}><boxGeometry args=${[1.3, 0.65, 1.8]} /></mesh>`)}
      </group>
      <${OccupancyBar} x=${LAYOUT.PBNE.pos[0] - 7} z=${LAYOUT.PBNE.pos[1] - 6} value=${occ('PBNE')} color=${occColor(occ('PBNE'))} />
      <${Label} text="PORT OF BRISBANE" position=${[LAYOUT.PBNE.pos[0], 6.5, LAYOUT.PBNE.pos[1]]} scale=${2.4} bg=${selected === 'PBNE' ? '#F2C14E' : '#F4F1EA'} />
    <//>
    ${[geo.shipLane, geo.shipLane2].slice(0, ships).map((lane, i) => html`<${Shuttle} key=${'s' + i} curve=${lane} speed=${0.012 + i * 0.004} offset=${i * 0.6} still=${still} y=${0.05}><${Ship} hull=${i % 2 ? '#2f7f79' : '#d62839'} boxes=${[c.primary, c.light, c.accent]} /><//>`)}

    <${Facility} id="BNEC" onSelect=${onSelect} onHover=${onHover}>
      <mesh geometry=${geo.runwayGeo} material=${toon('#2b2b2b')} />
      <group position=${[LAYOUT.BNEC.pos[0], 0, LAYOUT.BNEC.pos[1]]}>
        <mesh position=${[-2, 1.1, 6]} material=${toon(mixHex(c.light, '#ffffff', 0.4))}><boxGeometry args=${[8 + lvl('BNEC') * 2, 2.2, 3]} /></mesh>
        <mesh position=${[6, 2.6, 6]} material=${toon(c.accent)}><cylinderGeometry args=${[0.4, 0.55, 5.2, 8]} /></mesh>
        <mesh position=${[6, 5.5, 6]} material=${toon(c.primary)}><cylinderGeometry args=${[1, 0.8, 0.9, 8]} /></mesh>
      </group>
      <${OccupancyBar} x=${LAYOUT.BNEC.pos[0] - 9} z=${LAYOUT.BNEC.pos[1] + 6} value=${occ('BNEC')} color=${occColor(occ('BNEC'))} />
      <${Label} text="BNE AIRPORT CARGO" position=${[LAYOUT.BNEC.pos[0], 8, LAYOUT.BNEC.pos[1] + 6]} scale=${2.4} bg=${selected === 'BNEC' ? '#F2C14E' : '#F4F1EA'} />
    <//>
    ${[geo.flight, geo.flight2].slice(0, planes).map((f, i) => html`<${Flyer} key=${'p' + i} curve=${f} speed=${0.02 + i * 0.006} offset=${i * 0.45} still=${still}><${Plane} tail=${i % 2 ? c.accent : c.primary} /><//>`)}

    ${Array.from({ length: trucks }, (_, i) => html`<${Follow} key=${'t' + i} curve=${geo.ring} offset=${i / trucks} speed=${0.012 + (i % 3) * 0.003} still=${still}>${i % 3 === 2 ? html`<${Car} color=${c.light} />` : html`<${Truck} color=${i % 2 ? c.primary : '#F2C14E'} />`}<//>`)}
    ${Array.from({ length: Math.ceil(trucks / 3) }, (_, i) => html`<${Follow} key=${'u' + i} curve=${geo.spur} offset=${i / 4} speed=${0.025} still=${still}><${Truck} color=${c.accent} /><//>`)}

    ${trees.map((t, i) => html`<${Tree} key=${'tr' + i} position=${[t.x, 0, t.z]} s=${t.s} color=${mixHex(c.accent, '#3f7f5a', 0.45)} />`)}
    ${[[-40, -6, 5], [-44, -2, 8], [-38, 2, 6.5], [-46, 6, 4]].map(([x, z, h], i) => html`<${Tower} key=${'tw' + i} position=${[x, 0, z]} h=${h} color=${i % 2 ? c.primary : c.accent} roof=${c.deep} />`)}
    ${selected ? html`<${SelectionRing} id=${selected} color="#F2C14E" />` : null}
    <${ComicPost} ink="#0c0a08" shadow=${c.ink} halftone=${halftone} />
  `;
}

export function mount(el, props) {
  const store = { clock: 0.3, speed: props.speed ?? 1, paused: false, focusing: false };
  const root = createRoot(el);
  let current = { ...props };
  const render = () =>
    root.render(html`
      <${Canvas}
        dpr=${[1, 1.75]}
        flat
        frameloop=${current.hidden ? 'never' : 'always'}
        camera=${{ fov: 32, near: 0.5, far: 400, position: [46, 44, 58] }}
        gl=${{ antialias: false, powerPreference: 'high-performance' }}
        onCreated=${() => current.onReady?.()}
        onPointerMissed=${() => current.onSelect?.(null)}
      >
        <${Scene} ...${current} store=${store} />
      <//>
    `);
  render();
  return {
    update(next) {
      if (typeof next.speed === 'number') store.speed = next.speed;
      if (typeof next.paused === 'boolean') store.paused = next.paused;
      current = { ...current, ...next };
      render();
    },
    /** Time of day 0..1 (0.25 = sunrise, 0.5 = noon). */
    clock() {
      return store.clock;
    },
    unmount() {
      document.body.style.cursor = '';
      root.unmount();
    },
  };
}
