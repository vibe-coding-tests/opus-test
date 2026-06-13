import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential approach.
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const choice = (arr) => arr[(Math.random() * arr.length) | 0];
export const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export const angDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Shared scratch vectors (never hold across calls that also use them)
export const TMP = { a: v3(), b: v3(), c: v3(), d: v3(), e: v3() };

export const fmt$ = (n) => `${Math.round(n)}\u20BD`; // galleon glyph stand-in, styled in CSS

export const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtKDA = (p) => ((p.kills + p.assists) / Math.max(1, p.deaths)).toFixed(2);

let _uid = 1;
export const uid = () => _uid++;

// DOM helper: el('div', 'class names', parent, textContent)
export function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  if (text !== undefined) e.textContent = text;
  return e;
}

export function hexCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// Gaussian-ish random in [-1,1], biased to center
export const grand = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;

// Lathe-turned wand prop shared by the rigs, disarm drops, and loot piles:
// pommel bulb, ridged grip, a carved collar, then a long tapering shaft.
// Centered on Y like a CylinderGeometry of the same length, so it drops onto
// the transforms the old cylinder wands used.
export function makeWand(cfg = {}, woodMat, gripMat = null, { lengthScale = 1, radialSegs = 12, thick = 1 } = {}) {
  const L = (cfg.len ?? 0.5) * lengthScale;
  const h = L / 2;
  const pts = [
    [0, 0],            // pommel base (closed)
    [0.016, 0.01],
    [0.0235, 0.07],    // pommel bulb
    [0.019, 0.17],     // pommel neck
    [0.0225, 0.23],    // grip swell
    [0.0195, 0.35],
    [0.0225, 0.42],    // grip ridge
    [0.0185, 0.53],
    [0.021, 0.59],     // collar
    [0.0155, 0.72],
    [0.0125, 1.1],
    [0.0095, 1.5],
    [0.007, 1.8],
    [0.005, 1.97],
    [0, 2],
  ].map(([x, y]) => new THREE.Vector2(x * thick, (y / 2) * L - h));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, radialSegs), woodMat));
  if (gripMat) {
    // a metal band at the collar for silver-gripped wands (Draco, Lucius)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0235 * thick, 0.0245 * thick, L * 0.05, radialSegs), gripMat);
    band.position.y = L * 0.295 - h;
    g.add(band);
  }
  return g;
}
