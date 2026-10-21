// Shared React Three Fiber kit: comic post-processing, toon materials and procedural low-poly models.
// Plain JS + htm (no JSX build). React, three and R3F come from the CDN import map.
import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import htm from 'htm';

export const html = htm.bind(React.createElement);
const { useMemo, useRef, useEffect } = React;

// ---------- materials ----------

let gradientMap = null;
/** 3-step cel shading ramp shared by every toon material. */
export function toonGradient() {
  if (!gradientMap) {
    gradientMap = new THREE.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

const matCache = new Map();
export function toon(color) {
  const key = String(color);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    matCache.set(key, m);
  }
  return m;
}

export function mixHex(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

// ---------- comic post-processing ----------

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform vec2 resolution;
uniform vec3 cInk;
uniform vec3 cShadow;
uniform float halftone;
uniform float dotScale;
uniform float edgeStrength;
varying vec2 vUv;

float readDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float viewZ = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
  return viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 px = 1.0 / resolution;
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  float d = readDepth(vUv);
  float dx = readDepth(vUv + vec2(px.x, 0.0)) - readDepth(vUv - vec2(px.x, 0.0));
  float dy = readDepth(vUv + vec2(0.0, px.y)) - readDepth(vUv - vec2(0.0, px.y));
  float depthEdge = smoothstep(0.08, 0.2, length(vec2(dx, dy)) / max(d, 0.0005) * 0.5);
  float lx = luma(texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb) - luma(texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb);
  float ly = luma(texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb) - luma(texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb);
  float lumaEdge = smoothstep(0.1, 0.28, length(vec2(lx, ly)));
  float edge = clamp(max(depthEdge, lumaEdge * 0.8) * edgeStrength, 0.0, 1.0);

  float L = luma(col);
  float a = 0.7854;
  vec2 fc = gl_FragCoord.xy / dotScale;
  vec2 rp = vec2(cos(a) * fc.x - sin(a) * fc.y, sin(a) * fc.x + cos(a) * fc.y);
  vec2 cell = fract(rp) - 0.5;
  float radius = clamp((0.55 - L) * 0.85, 0.0, 0.5);
  float dotMask = 1.0 - smoothstep(radius - 0.07, radius, length(cell));
  vec3 shaded = mix(col, mix(col, cShadow, 0.6), dotMask * halftone);
  gl_FragColor = vec4(mix(shaded, cInk, edge), 1.0);
  #include <colorspace_fragment>
}
`;

/** Takes over rendering: scene → render target → ink outlines + halftone dots. */
export function ComicPost({ ink = '#0c0a08', shadow = '#24201A', halftone = true, edge = 1 }) {
  const { gl, scene, camera, size } = useThree();
  const bundle = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true });
    target.depthTexture = new THREE.DepthTexture(2, 2);
    target.depthTexture.type = THREE.UnsignedIntType;
    const mat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 400 },
        resolution: { value: new THREE.Vector2(2, 2) },
        cInk: { value: new THREE.Color(ink) },
        cShadow: { value: new THREE.Color(shadow) },
        halftone: { value: halftone ? 1 : 0 },
        dotScale: { value: 6 },
        edgeStrength: { value: edge },
      },
    });
    const quadScene = new THREE.Scene();
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return { target, mat, quadScene, quadCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, []);

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    const w = Math.max(2, Math.floor(size.width * dpr));
    const h = Math.max(2, Math.floor(size.height * dpr));
    bundle.target.setSize(w, h);
    bundle.mat.uniforms.resolution.value.set(w, h);
    bundle.mat.uniforms.dotScale.value = 5.5 * dpr;
  }, [size.width, size.height, gl]);

  useEffect(() => {
    const u = bundle.mat.uniforms;
    u.cInk.value.set(ink);
    u.cShadow.value.set(shadow);
    u.halftone.value = halftone ? 1 : 0;
    u.edgeStrength.value = edge;
  }, [ink, shadow, halftone, edge]);

  useEffect(() => () => {
    bundle.target.dispose();
    bundle.mat.dispose();
  }, []);

  useFrame(() => {
    const u = bundle.mat.uniforms;
    gl.setRenderTarget(bundle.target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    u.tDiffuse.value = bundle.target.texture;
    u.tDepth.value = bundle.target.depthTexture;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    gl.render(bundle.quadScene, bundle.quadCam);
  }, 1);
  return null;
}

// ---------- geometry helpers ----------

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const cone = new THREE.ConeGeometry(0.5, 1, 4);
const sphere = new THREE.IcosahedronGeometry(0.5, 1);

/** A flat ribbon following a curve (rivers, roads, runways). */
export function ribbonGeometry(curve, width, segments = 160, y = 0.02) {
  const pts = curve.getSpacedPoints(segments);
  const positions = [];
  const indices = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const n = pts[Math.min(pts.length - 1, i + 1)];
    const q = pts[Math.max(0, i - 1)];
    const dir = new THREE.Vector3().subVectors(n, q).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);
    positions.push(p.x + side.x, y, p.z + side.z, p.x - side.x, y, p.z - side.z);
    if (i < pts.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function curveFrom(points, closed = false) {
  return new THREE.CatmullRomCurve3(points.map(([x, z, y = 0]) => new THREE.Vector3(x, y, z)), closed, 'catmullrom', 0.3);
}

// ---------- models ----------

export function Tower({ position, w = 1.6, d = 1.6, h = 4, color, roof, stripes = '#0c0a08' }) {
  return html`
    <group position=${position}>
      <mesh geometry=${box} material=${toon(color)} position=${[0, h / 2, 0]} scale=${[w, h, d]} />
      <mesh geometry=${box} material=${toon(roof ?? color)} position=${[0, h + 0.15, 0]} scale=${[w * 0.6, 0.3, d * 0.6]} />
      ${Array.from({ length: Math.max(1, Math.floor(h / 0.9)) }, (_, i) => html`
        <mesh key=${i} geometry=${box} material=${toon(stripes)} position=${[0, 0.6 + i * 0.9, d / 2 + 0.01]} scale=${[w * 0.8, 0.12, 0.02]} />
      `)}
    </group>
  `;
}

export function Queenslander({ position, rotation = 0, wall, roof }) {
  return html`
    <group position=${position} rotation=${[0, rotation, 0]}>
      ${[[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.4], [0.5, 0.4]].map(([x, z], i) => html`
        <mesh key=${i} geometry=${box} material=${toon('#2b2b2b')} position=${[x, 0.2, z]} scale=${[0.08, 0.4, 0.08]} />
      `)}
      <mesh geometry=${box} material=${toon(wall)} position=${[0, 0.75, 0]} scale=${[1.3, 0.7, 1.1]} />
      <mesh geometry=${cone} material=${toon(roof)} position=${[0, 1.45, 0]} rotation=${[0, Math.PI / 4, 0]} scale=${[1.95, 0.7, 1.7]} />
      <mesh geometry=${box} material=${toon(roof)} position=${[0, 0.42, 0.62]} scale=${[1.3, 0.05, 0.25]} />
    </group>
  `;
}

export function Tree({ position, color, s = 1 }) {
  return html`
    <group position=${position} scale=${[s, s, s]}>
      <mesh geometry=${cyl} material=${toon('#4a3426')} position=${[0, 0.3, 0]} scale=${[0.15, 0.6, 0.15]} />
      <mesh geometry=${sphere} material=${toon(color)} position=${[0, 0.9, 0]} scale=${[0.9, 0.8, 0.9]} />
    </group>
  `;
}

export function StoryBridge({ position, rotation = 0, color = '#5a6b7a', length = 7 }) {
  const truss = [];
  for (let i = 0; i <= 8; i++) {
    const x = -length / 2 + (i / 8) * length;
    const h = 0.5 + 1.6 * Math.sin((i / 8) * Math.PI) ** 0.6;
    truss.push(html`<mesh key=${'v' + i} geometry=${box} material=${toon(color)} position=${[x, 0.55 + h / 2, 0.45]} scale=${[0.08, h, 0.08]} />`);
    truss.push(html`<mesh key=${'w' + i} geometry=${box} material=${toon(color)} position=${[x, 0.55 + h / 2, -0.45]} scale=${[0.08, h, 0.08]} />`);
  }
  return html`
    <group position=${position} rotation=${[0, rotation, 0]}>
      <mesh geometry=${box} material=${toon('#3a3a3a')} position=${[0, 0.5, 0]} scale=${[length, 0.12, 1]} />
      ${[-length * 0.28, length * 0.28].map((x, i) => html`
        <mesh key=${'p' + i} geometry=${box} material=${toon(color)} position=${[x, 1.05, 0]} scale=${[0.35, 2.2, 1.1]} />
      `)}
      <mesh geometry=${box} material=${toon(color)} position=${[0, 2.1, 0.45]} scale=${[length * 0.75, 0.1, 0.08]} />
      <mesh geometry=${box} material=${toon(color)} position=${[0, 2.1, -0.45]} scale=${[length * 0.75, 0.1, 0.08]} />
      ${truss}
    </group>
  `;
}

export function Car({ color, cabin = '#1b1b25' }) {
  return html`
    <group>
      <mesh geometry=${box} material=${toon(color)} position=${[0, 0.18, 0]} scale=${[0.5, 0.22, 0.9]} />
      <mesh geometry=${box} material=${toon(cabin)} position=${[0, 0.36, -0.05]} scale=${[0.42, 0.16, 0.45]} />
    </group>
  `;
}

export function Truck({ color, trailer = '#e9e5d8' }) {
  return html`
    <group>
      <mesh geometry=${box} material=${toon(color)} position=${[0, 0.32, 0.75]} scale=${[0.6, 0.5, 0.45]} />
      <mesh geometry=${box} material=${toon(trailer)} position=${[0, 0.42, -0.2]} scale=${[0.66, 0.66, 1.4]} />
    </group>
  `;
}

export function Ship({ hull = '#c0392b', boxes = ['#35369C', '#C8C793', '#7C679E'] }) {
  return html`
    <group>
      <mesh geometry=${box} material=${toon(hull)} position=${[0, 0.25, 0]} scale=${[1.2, 0.5, 4]} />
      <mesh geometry=${box} material=${toon('#f4f1ea')} position=${[0, 0.85, -1.5]} scale=${[1, 0.8, 0.6]} />
      ${[-1, -0.3, 0.4, 1.1].map((z, i) => html`
        <mesh key=${i} geometry=${box} material=${toon(boxes[i % boxes.length])} position=${[0, 0.72, z]} scale=${[1.05, 0.45, 0.6]} />
      `)}
    </group>
  `;
}

export function Plane({ color = '#f4f1ea', tail = '#d62839' }) {
  return html`
    <group>
      <mesh geometry=${cyl} material=${toon(color)} rotation=${[Math.PI / 2, 0, 0]} scale=${[0.36, 2.4, 0.36]} />
      <mesh geometry=${box} material=${toon(color)} position=${[0, 0, 0.1]} scale=${[2.8, 0.06, 0.55]} />
      <mesh geometry=${box} material=${toon(tail)} position=${[0, 0.35, -1.05]} scale=${[0.06, 0.6, 0.4]} />
      <mesh geometry=${box} material=${toon(color)} position=${[0, 0.08, -1.05]} scale=${[1, 0.05, 0.3]} />
    </group>
  `;
}

export function Crane({ position, rotation = 0, color = '#F2C14E' }) {
  return html`
    <group position=${position} rotation=${[0, rotation, 0]}>
      ${[[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].map(([x, z], i) => html`
        <mesh key=${i} geometry=${box} material=${toon(color)} position=${[x, 1.4, z]} scale=${[0.14, 2.8, 0.14]} />
      `)}
      <mesh geometry=${box} material=${toon(color)} position=${[0, 2.9, 0.8]} scale=${[1.4, 0.25, 4]} />
      <mesh geometry=${box} material=${toon('#2b2b2b')} position=${[0, 3.2, -0.4]} scale=${[0.8, 0.4, 0.8]} />
    </group>
  `;
}

export function Warehouse({ position, rotation = 0, w = 5, d = 3, wall = '#d9d4c3', roof = '#7C679E', level = 1 }) {
  const teeth = Math.max(2, Math.round(w / 1.2));
  return html`
    <group position=${position} rotation=${[0, rotation, 0]}>
      <mesh geometry=${box} material=${toon(wall)} position=${[0, 0.7, 0]} scale=${[w, 1.4, d]} />
      ${Array.from({ length: teeth }, (_, i) => html`
        <mesh key=${i} geometry=${cone} material=${toon(roof)} position=${[-w / 2 + (i + 0.5) * (w / teeth), 1.65, 0]} rotation=${[0, Math.PI / 4, 0]} scale=${[(w / teeth) * 1.35, 0.5, d * 1.35]} />
      `)}
      ${Array.from({ length: 2 + level }, (_, i) => html`
        <mesh key=${'door' + i} geometry=${box} material=${toon('#2b2b2b')} position=${[-w / 2 + 0.6 + i * 0.9, 0.45, d / 2 + 0.01]} scale=${[0.6, 0.8, 0.02]} />
      `)}
    </group>
  `;
}

/** Constant-speed follower along a closed curve. Models point down -z. */
export function Follow({ curve, offset = 0, speed = 0.03, y = 0, children, still }) {
  const ref = useRef();
  const t = useRef(offset);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    if (!still) t.current = (t.current + dt * speed) % 1;
    curve.getPointAt(t.current, p);
    curve.getPointAt((t.current + 0.003) % 1, q);
    ref.current.position.set(p.x, p.y + y, p.z);
    ref.current.lookAt(q.x, p.y + y, q.z);
  });
  return html`<group ref=${ref}><group rotation=${[0, Math.PI, 0]}>${children}</group></group>`;
}

/** Goes there and back along an open curve (ships to the quay and out again). */
export function Shuttle({ curve, speed = 0.02, offset = 0.2, children, still, y = 0 }) {
  const ref = useRef();
  const t = useRef(offset);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    if (!still) t.current += dt * speed;
    const phase = ((t.current % 2) + 2) % 2;
    const u = phase < 1 ? phase : 2 - phase;
    const dir = phase < 1 ? 1 : -1;
    curve.getPointAt(Math.min(0.999, Math.max(0.001, u)), p);
    curve.getPointAt(Math.min(0.999, Math.max(0.001, u + 0.004 * dir)), q);
    ref.current.position.set(p.x, y, p.z);
    ref.current.lookAt(q.x, y, q.z);
  });
  return html`<group ref=${ref}><group rotation=${[0, Math.PI, 0]}>${children}</group></group>`;
}

/** Banking flight along a closed 3D curve. */
export function Flyer({ curve, speed = 0.035, offset = 0.1, children, still }) {
  const ref = useRef();
  const t = useRef(offset);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    if (!still) t.current = (t.current + dt * speed) % 1;
    curve.getPointAt(t.current, p);
    curve.getPointAt((t.current + 0.004) % 1, q);
    ref.current.position.copy(p);
    ref.current.lookAt(q);
    ref.current.rotateZ(Math.sin(t.current * Math.PI * 2) * 0.25);
  });
  return html`<group ref=${ref}><group rotation=${[0, Math.PI, 0]}>${children}</group></group>`;
}

/** Label sprite drawn with the page's own fonts (comic caption style). */
export function Label({ text, position, scale = 1, bg = '#F2C14E', fg = '#111111' }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = '900 44px Archivo, system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 40;
    c.width = w;
    c.height = 72;
    ctx.fillStyle = bg;
    ctx.strokeStyle = '#0c0a08';
    ctx.lineWidth = 6;
    ctx.fillRect(3, 3, w - 6, 66);
    ctx.strokeRect(3, 3, w - 6, 66);
    ctx.font = '900 44px Archivo, system-ui, sans-serif';
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 20, 38);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.aspect = w / 72;
    return t;
  }, [text, bg, fg]);
  useEffect(() => () => tex.dispose(), [tex]);
  const a = tex.userData.aspect;
  return html`<sprite position=${position} scale=${[a * 0.55 * scale, 0.55 * scale, 1]}><spriteMaterial map=${tex} depthTest=${false} transparent=${true} /></sprite>`;
}

export { THREE, useFrame, useThree, useMemo, useRef, useEffect };
