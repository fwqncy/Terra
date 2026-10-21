// City Lab in 3D: the same generated world and the live self-driving cars, rendered with three.js.
// Drag to orbit, right-drag (or two fingers) to pan, scroll or pinch to zoom: OrbitControls, like the Ops floor.
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ComicPost, Label, THREE, html, mixHex, toon, toonGradient, useEffect, useFrame, useMemo, useRef, useThree } from './kit.js';

/** World units → scene units. A road (100 units) is one scene unit wide. */
const S = 0.01;
const MAX_CARS = 240;
const MAX_RAYS = 16;
/** Camera distance the view eases into when it starts trailing the leader. */
const CHASE_DISTANCE = 13;

const ROOF = { queenslander: 'tin', terrace: 'gable', brutalist: 'flat', glass: 'flat', pop: 'gable' };
const TONE = { queenslander: 0.15, terrace: 0.25, brutalist: 0.55, glass: 0.1, pop: 0.35 };

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const unitHip = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
const unitCrown = new THREE.IcosahedronGeometry(0.5, 1);
const unitTrunk = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0);

const toonMat = (color = '#ffffff') => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });

function useDisposable(factory, deps) {
  const value = useMemo(factory, deps);
  useEffect(() => () => value?.dispose?.(), [value]);
  return value;
}

/** Road envelopes (flat [x,y,…] polygons) merged into one ground-hugging mesh. */
function polygonsGeometry(polys, y) {
  const parts = [];
  for (const flat of polys) {
    if (flat.length < 6) continue;
    const shape = new THREE.Shape();
    shape.moveTo(flat[0] * S, -flat[1] * S);
    for (let i = 2; i < flat.length; i += 2) shape.lineTo(flat[i] * S, -flat[i + 1] * S);
    shape.closePath();
    // (x, -y) in the shape plane → (x, 0, y) on the ground, facing up
    parts.push(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, y, 0));
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

/** Flat [x1,y1,x2,y2,…] segments → line-segment geometry with per-segment dash distances. */
function segmentsGeometry(flat, y) {
  const n = flat.length / 4;
  const pos = new Float32Array(n * 6);
  const dist = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x1, y1, x2, y2] = [flat[i * 4] * S, flat[i * 4 + 1] * S, flat[i * 4 + 2] * S, flat[i * 4 + 3] * S];
    pos.set([x1, y, y1, x2, y, y2], i * 6);
    dist[i * 2 + 1] = Math.hypot(x2 - x1, y2 - y1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('lineDistance', new THREE.BufferAttribute(dist, 1));
  return g;
}

function Roads({ geo, palette: c }) {
  const dark = c.mode === 'dark';
  const roadColor = dark ? mixHex(c.deep, c.ink, 0.15) : mixHex(c.accent, c.ink, 0.35);
  const ink = dark ? '#0c0a08' : c.ink;
  const surface = useDisposable(() => polygonsGeometry(geo.envelopes, 0.01), [geo.envelopes]);
  const borders = useDisposable(() => segmentsGeometry(geo.roadBorders, 0.03), [geo.roadBorders]);
  const dashes = useDisposable(() => segmentsGeometry(geo.segments, 0.025), [geo.segments]);
  const surfaceMat = useDisposable(() => toonMat(roadColor), [roadColor]);
  const borderMat = useDisposable(() => new THREE.LineBasicMaterial({ color: ink }), [ink]);
  const dashMat = useDisposable(() => new THREE.LineDashedMaterial({ color: c.light, dashSize: 0.12, gapSize: 0.14, transparent: true, opacity: 0.85 }), [c.light]);
  return html`
    ${surface ? html`<mesh geometry=${surface} material=${surfaceMat} />` : null}
    <lineSegments geometry=${borders} material=${borderMat} />
    <lineSegments geometry=${dashes} material=${dashMat} />
  `;
}

/** Buildings and their roofs as two instanced meshes, each box turned to face its street. */
function Buildings({ geo, palette: c, homeStyle }) {
  const walls = useRef();
  const roofs = useRef();
  const roof = ROOF[homeStyle] ?? 'tin';
  const list = geo.buildings;
  const wallMat = useDisposable(() => toonMat(), []);
  const roofMat = useDisposable(() => toonMat(), []);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const tone = TONE[homeStyle] ?? 0.2;
    const glass = homeStyle === 'glass';
    const lit = glass ? mixHex(c.primary, c.light, 0.25) : mixHex(c.light, c.accent, tone);
    const shade = glass ? mixHex(c.primary, c.ink, 0.35) : mixHex(c.accent, c.deep, 0.35 + tone * 0.5);
    const roofColor = roof === 'tin' ? mixHex(c.light, '#9aa3a8', 0.55) : roof === 'flat' ? mixHex(c.deep, c.ink, 0.3) : c.danger;
    list.forEach((b, i) => {
      const p = b.p;
      // Envelope order: p0→p1 crosses the lot, p1→p2 runs along the street frontage.
      const ex = p[4] - p[2];
      const ey = p[5] - p[3];
      const len = Math.hypot(ex, ey);
      const wid = Math.hypot(p[2] - p[0], p[3] - p[1]);
      // a touch taller than life (the roads are wider than life too) but low enough to see the cars
      const h = b.h * S * (roof === 'flat' ? 0.62 : 0.32);
      dummy.position.set(((p[0] + p[2] + p[4] + p[6]) / 4) * S, 0, ((p[1] + p[3] + p[5] + p[7]) / 4) * S);
      dummy.rotation.set(0, -Math.atan2(ey, ex), 0);
      dummy.scale.set(len * S, h, wid * S);
      dummy.updateMatrix();
      walls.current.setMatrixAt(i, dummy.matrix);
      walls.current.setColorAt(i, col.set(i % 3 === 0 ? shade : lit));
      dummy.position.y = h;
      // pitched roofs cover the footprint; flat roofs get a small rooftop plant room
      if (roof === 'flat') dummy.scale.set(0.24, 0.16, 0.24);
      else dummy.scale.set(len * S, Math.min(len, wid) * S * 0.38, wid * S);
      dummy.updateMatrix();
      roofs.current.setMatrixAt(i, dummy.matrix);
      roofs.current.setColorAt(i, col.set(roofColor));
    });
    for (const mesh of [walls.current, roofs.current]) {
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [list, homeStyle, c]);

  const n = Math.max(1, list.length);
  return html`
    <instancedMesh key=${'w' + n} ref=${walls} args=${[unitBox, wallMat, n]} />
    <instancedMesh key=${'r' + n + roof} ref=${roofs} args=${[roof === 'flat' ? unitBox : unitHip, roofMat, n]} />
  `;
}

function Trees({ geo, palette: c }) {
  const crowns = useRef();
  const trunks = useRef();
  const leaf = mixHex(c.accent, '#3f7f5a', 0.5);
  const crownMat = useDisposable(() => toonMat(leaf), [leaf]);
  const trunkMat = useMemo(() => toon('#4a3426'), []);
  useEffect(() => {
    const dummy = new THREE.Object3D();
    geo.trees.forEach(([x, y, size, height], i) => {
      const s = size * S * 0.85;
      const h = height * S;
      dummy.position.set(x * S, h * 0.6, y * S);
      dummy.rotation.set(0, i, 0);
      dummy.scale.set(s, h * 0.75, s);
      dummy.updateMatrix();
      crowns.current.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0;
      dummy.scale.set(s * 0.14, h * 0.45, s * 0.14);
      dummy.updateMatrix();
      trunks.current.setMatrixAt(i, dummy.matrix);
    });
    for (const mesh of [crowns.current, trunks.current]) {
      mesh.count = geo.trees.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [geo.trees]);
  const n = Math.max(1, geo.trees.length);
  return html`
    <instancedMesh key=${'c' + n} ref=${crowns} args=${[unitCrown, crownMat, n]} />
    <instancedMesh key=${'t' + n} ref=${trunks} args=${[unitTrunk, trunkMat, n]} />
  `;
}

function Markings({ geo, palette: c }) {
  return geo.markings.map((m, i) =>
    m.type === 'start'
      ? html`<group key=${'s' + i} position=${[m.x * S, 0, m.y * S]}>
          <mesh material=${toon('#2b2b2b')} position=${[0, 0.6, 0]}><cylinderGeometry args=${[0.03, 0.03, 1.2, 6]} /></mesh>
          <mesh material=${toon(c.warn)} position=${[0.22, 1.05, 0]}><boxGeometry args=${[0.42, 0.26, 0.04]} /></mesh>
          <${Label} text="START" position=${[0, 1.6, 0]} scale=${0.9} />
        </group>`
      : html`<group key=${'t' + i} position=${[m.x * S, 0, m.y * S]}>
          ${[0.5, 0.36, 0.22].map(
            (r, j) => html`<mesh key=${j} rotation=${[-Math.PI / 2, 0, 0]} position=${[0, 0.035 + j * 0.004, 0]} material=${toon(j % 2 ? c.light : c.danger)}><ringGeometry args=${[r - 0.12, r, 32]} /></mesh>`,
          )}
          <mesh material=${toon(c.danger)} position=${[0, 0.9, 0]}><cylinderGeometry args=${[0.05, 0.05, 1.8, 8]} /></mesh>
          <${Label} text="TARGET" position=${[0, 2.1, 0]} scale=${0.9} bg="#F4F1EA" />
        </group>`,
  );
}

/** The planned Start → Target path as a translucent ribbon on the road. */
function RouteRibbon({ route, palette: c }) {
  const geo = useDisposable(() => {
    if (!route || route.length < 2) return null;
    const path = new THREE.CurvePath();
    for (let i = 1; i < route.length; i++) {
      path.add(new THREE.LineCurve3(new THREE.Vector3(route[i - 1][0] * S, 0, route[i - 1][1] * S), new THREE.Vector3(route[i][0] * S, 0, route[i][1] * S)));
    }
    const samples = path.getSpacedPoints(Math.min(4000, Math.max(32, Math.round(path.getLength() * 4))));
    const positions = [];
    const index = [];
    const dir = new THREE.Vector3();
    for (let i = 0; i < samples.length; i++) {
      dir.subVectors(samples[Math.min(samples.length - 1, i + 1)], samples[Math.max(0, i - 1)]).setY(0).normalize();
      const sx = -dir.z * 0.42;
      const sz = dir.x * 0.42;
      const p = samples[i];
      positions.push(p.x + sx, 0.02, p.z + sz, p.x - sx, 0.02, p.z - sz);
      if (i < samples.length - 1) index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(index);
    return g;
  }, [route]);
  // accent, not primary: the default car body is primary and must stand out on the route
  const mat = useDisposable(() => new THREE.MeshBasicMaterial({ color: c.accent, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }), [c.accent]);
  return geo ? html`<mesh geometry=${geo} material=${mat} />` : null;
}

function skinColor(skin, c) {
  return { minit: mixHex(c.light, '#ffffff', 0.5), taxi: '#F2C14E', kombi: c.danger, ink: '#F4F1EA', holo: '#7AE0FF' }[skin] ?? c.primary;
}

/**
 * Live cars from the running simulation: instanced bodies and cabins, plus the leader's tag and sensor rays.
 * `store.getFrame()` returns {cars:[{x,y,a,s}], leader:{x,y}|null, tag:'LEADER'|'COURIER', rays:[x1,y1,x2,y2,…]}
 * in world units; s is 0 driving, 1 followed (leader or courier), 2 crashed or stalled, 3 arrived.
 */
function Cars({ store, palette: c, skin }) {
  const bodies = useRef();
  const cabins = useRef();
  const leaderTag = useRef();
  const bodyMat = useDisposable(() => toonMat(), []);
  const cabinMat = useMemo(() => toon('#8fa6b8'), []);
  const rayGeo = useDisposable(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_RAYS * 6), 3));
    return g;
  }, []);
  const rayMat = useDisposable(() => new THREE.LineBasicMaterial({ color: c.warn }), [c.warn]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => {
    const normal = skinColor(skin, c);
    return [normal, normal === c.warn ? c.light : c.warn, '#4d4f55', c.success].map((x) => new THREE.Color(x));
  }, [skin, c]);

  useFrame(() => {
    const frame = store.getFrame?.();
    const cars = frame?.cars ?? [];
    const n = Math.min(MAX_CARS, cars.length);
    for (let i = 0; i < n; i++) {
      const car = cars[i];
      // the engine's heading points the car along (-sin a, -cos a): rotation.y = a turns local -Z onto it
      // drawn 15% over life size so they read at a distance
      dummy.position.set(car.x * S, 0.03, car.y * S);
      dummy.rotation.set(0, car.a, 0);
      dummy.scale.set(0.35, 0.16, 0.58);
      dummy.updateMatrix();
      bodies.current.setMatrixAt(i, dummy.matrix);
      bodies.current.setColorAt(i, colors[car.s] ?? colors[0]);
      dummy.position.y = 0.19;
      dummy.translateZ(0.06);
      dummy.scale.set(0.28, 0.11, 0.28);
      dummy.updateMatrix();
      cabins.current.setMatrixAt(i, dummy.matrix);
    }
    bodies.current.count = cabins.current.count = n;
    bodies.current.instanceMatrix.needsUpdate = true;
    cabins.current.instanceMatrix.needsUpdate = true;
    if (bodies.current.instanceColor) bodies.current.instanceColor.needsUpdate = true;

    const leader = frame?.leader ?? null;
    store.leader = leader;
    leaderTag.current.visible = !!leader;
    if (leader) {
      leaderTag.current.position.set(leader.x * S, 0, leader.y * S);
      const courier = frame.tag === 'COURIER';
      leaderTag.current.children[0].visible = !courier;
      leaderTag.current.children[1].visible = courier;
    }

    const r = frame?.rays ?? [];
    const arr = rayGeo.attributes.position.array;
    const segs = Math.min(MAX_RAYS, r.length / 4);
    for (let i = 0; i < segs; i++) {
      arr[i * 6] = r[i * 4] * S;
      arr[i * 6 + 1] = 0.12;
      arr[i * 6 + 2] = r[i * 4 + 1] * S;
      arr[i * 6 + 3] = r[i * 4 + 2] * S;
      arr[i * 6 + 4] = 0.12;
      arr[i * 6 + 5] = r[i * 4 + 3] * S;
    }
    rayGeo.setDrawRange(0, segs * 2);
    rayGeo.attributes.position.needsUpdate = true;
  });

  return html`
    <instancedMesh ref=${bodies} args=${[unitBox, bodyMat, MAX_CARS]} frustumCulled=${false} />
    <instancedMesh ref=${cabins} args=${[unitBox, cabinMat, MAX_CARS]} frustumCulled=${false} />
    <lineSegments geometry=${rayGeo} material=${rayMat} frustumCulled=${false} />
    <group ref=${leaderTag} visible=${false}>
      <${Label} text="LEADER" position=${[0, 1.4, 0]} scale=${0.7} />
      <${Label} text="COURIER" position=${[0, 1.4, 0]} scale=${0.7} />
    </group>
  `;
}

/** Orbit camera: frames the route, can trail the leading car, and re-frames on demand. */
function Controls({ store, focus, reducedMotion }) {
  const { camera, gl } = useThree();
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI * 0.47;
    c.minDistance = 1.5;
    c.screenSpacePanning = false;
    c.keyPanSpeed = 18;
    gl.domElement.tabIndex = 0;
    gl.domElement.setAttribute('aria-label', '3D city view. Drag to orbit, right-drag to pan, scroll to zoom. Arrow keys pan.');
    c.listenToKeyEvents(gl.domElement);
    c.addEventListener('start', () => (store.dragging = true));
    c.addEventListener('end', () => (store.dragging = false));
    return c;
  }, [camera, gl]);
  useEffect(() => {
    store.controls = controls;
    store.camera = camera;
    return () => {
      controls.stopListenToKeyEvents();
      controls.dispose();
    };
  }, [controls]);
  useEffect(() => {
    controls.enableDamping = !reducedMotion;
  }, [controls, reducedMotion]);
  // re-frame only when the framed area really changes, not on every geometry refresh
  const key = `${focus.x.toFixed(1)}:${focus.z.toFixed(1)}:${focus.radius.toFixed(1)}`;
  useEffect(() => {
    store.focus = focus;
    store.reset = true;
    controls.maxDistance = Math.max(80, focus.radius * 5);
  }, [key]);

  useFrame(() => {
    if (store.reset && store.focus) {
      store.reset = false;
      const { x, z, radius } = store.focus;
      const d = Math.max(6, radius * 1.2);
      controls.target.set(x, 0, z);
      camera.position.set(x + d * 0.42, d * 0.95, z + d * 0.6);
    }
    // when training starts, swoop in to a chase distance once; after that the zoom is the user's
    if (store.follow && store.leader) {
      if (!store.chased) {
        store.chased = true;
        store.easing = reducedMotion ? 1 : 45;
      }
    } else {
      store.chased = false;
    }
    if (store.easing > 0 && store.dragging) {
      store.easing = 0; // grabbing the view cancels the swoop where it is
    } else if (store.easing > 0) {
      store.easing--;
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(store.easing === 0 ? CHASE_DISTANCE : THREE.MathUtils.lerp(offset.length(), CHASE_DISTANCE, 0.1));
      camera.position.copy(controls.target).add(offset);
    }
    if (store.follow && store.leader && !store.dragging) {
      const k = reducedMotion ? 1 : 0.06;
      const dx = (store.leader.x * S - controls.target.x) * k;
      const dz = (store.leader.y * S - controls.target.z) * k;
      controls.target.x += dx;
      controls.target.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
    }
    controls.update();
  });
  return null;
}

/** Area to frame: the route, else Start/Target, else the whole road network. */
function frameOf(geo) {
  let pts = geo.route?.length >= 2 ? geo.route : geo.markings.map((m) => [m.x, m.y]);
  if (pts.length < 2) {
    pts = [];
    for (let i = 0; i < geo.segments.length; i += 2) pts.push([geo.segments[i], geo.segments[i + 1]]);
  }
  if (!pts.length) return { x: 0, z: 0, radius: 12 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: ((minX + maxX) / 2) * S, z: ((minY + maxY) / 2) * S, radius: (Math.max(maxX - minX, maxY - minY) / 2) * S + 4 };
}

function Scene({ geo, palette: c, homeStyle, skin, store, halftone, reducedMotion }) {
  const ground = c.mode === 'dark' ? mixHex(c.ink, c.deep, 0.22) : mixHex(c.light, '#ffffff', 0.35);
  const focus = useMemo(() => frameOf(geo), [geo]);
  const fogNear = Math.max(60, focus.radius * 3);
  return html`
    <color attach="background" args=${[ground]} />
    <fog attach="fog" args=${[ground, fogNear, fogNear * 3.5]} />
    <hemisphereLight args=${[c.light, c.deep, 1.1]} />
    <directionalLight position=${[30, 60, 20]} intensity=${2.1} />
    <${Controls} store=${store} focus=${focus} reducedMotion=${reducedMotion} />
    <mesh rotation=${[-Math.PI / 2, 0, 0]} material=${toon(ground)} position=${[focus.x, -0.01, focus.z]}><planeGeometry args=${[4000, 4000]} /></mesh>
    <${Roads} geo=${geo} palette=${c} />
    <${RouteRibbon} route=${geo.route} palette=${c} />
    <${Buildings} geo=${geo} palette=${c} homeStyle=${homeStyle} />
    <${Trees} geo=${geo} palette=${c} />
    <${Markings} geo=${geo} palette=${c} />
    <${Cars} store=${store} palette=${c} skin=${skin} />
    <${ComicPost} ink="#0c0a08" shadow=${c.ink} halftone=${halftone} />
  `;
}

/**
 * @param {HTMLElement} el
 * @param {{geometry:any, palette:any, homeStyle:string, skin:string, halftone?:boolean, reducedMotion?:boolean,
 *          follow?:boolean, hidden?:boolean, getFrame:()=>any, onReady?:()=>void}} props
 */
export function mount(el, props) {
  const store = { getFrame: props.getFrame, follow: !!props.follow, leader: null, controls: null, camera: null, focus: null, reset: true, dragging: false, chased: false, easing: 0 };
  const root = createRoot(el);
  let current = { ...props };
  const render = () =>
    root.render(html`
      <${Canvas}
        dpr=${[1, 1.75]}
        flat
        frameloop=${current.hidden ? 'never' : 'always'}
        camera=${{ fov: 38, near: 0.2, far: 1500, position: [20, 20, 20] }}
        gl=${{ antialias: false, powerPreference: 'high-performance' }}
        onCreated=${() => current.onReady?.()}
      >
        <${Scene}
          geo=${current.geometry}
          palette=${current.palette}
          homeStyle=${current.homeStyle}
          skin=${current.skin}
          store=${store}
          halftone=${current.halftone !== false}
          reducedMotion=${!!current.reducedMotion}
        />
      <//>
    `);
  render();
  return {
    update(next) {
      if ('getFrame' in next) store.getFrame = next.getFrame;
      if ('follow' in next) store.follow = !!next.follow;
      const visual = ['geometry', 'palette', 'homeStyle', 'skin', 'halftone', 'hidden', 'reducedMotion'].some((k) => k in next && next[k] !== current[k]);
      current = { ...current, ...next };
      if (visual) render();
    },
    /** factor < 1 moves the camera closer, > 1 further away. */
    zoom(factor) {
      const { controls, camera } = store;
      if (!controls || !camera) return;
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
      offset.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length())));
      camera.position.copy(controls.target).add(offset);
    },
    resetView() {
      store.reset = true;
    },
    unmount() {
      root.unmount();
    },
  };
}
