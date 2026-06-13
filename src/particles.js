// Pooled particle system: GPU points, managed sprites, decals, flash lights.
// Degrades gracefully via quality scalar (auto-tuned by the game from frame times).
import * as THREE from 'three';
import { rand, clamp } from './utils.js';

function radialTex(stops, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const TEX = {};
function buildTextures() {
  TEX.dot = radialTex([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
  TEX.glow = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']], 128);
  TEX.smoke = radialTex([[0, 'rgba(255,255,255,0.85)'], [0.55, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']], 128);
  TEX.flame = radialTex([[0, 'rgba(255,240,200,1)'], [0.35, 'rgba(255,170,60,0.85)'], [0.7, 'rgba(255,80,20,0.35)'], [1, 'rgba(255,60,0,0)']], 128);
  TEX.ring = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 10;
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  TEX.scorch = radialTex([[0, 'rgba(0,0,0,0.85)'], [0.6, 'rgba(10,5,0,0.55)'], [1, 'rgba(0,0,0,0)']], 128);
}

const MAX_POINTS = 4096;
const MAX_SPRITES = 240;
const MAX_DECALS = 48;
const BURST_C1 = new THREE.Color();
const BURST_C2 = new THREE.Color();

export class Particles {
  constructor(scene) {
    if (!TEX.dot) buildTextures();
    this.scene = scene;
    this.quality = 1;

    // ---- GPU points ----
    this.count = 0;
    this.pPos = new Float32Array(MAX_POINTS * 3);
    this.pCol = new Float32Array(MAX_POINTS * 3);
    this.pSize = new Float32Array(MAX_POINTS);
    this.pAlpha = new Float32Array(MAX_POINTS);
    this.vel = new Float32Array(MAX_POINTS * 3);
    this.life = new Float32Array(MAX_POINTS);
    this.maxLife = new Float32Array(MAX_POINTS);
    this.grav = new Float32Array(MAX_POINTS);
    this.drag = new Float32Array(MAX_POINTS);
    this.size0 = new Float32Array(MAX_POINTS);
    this.shrink = new Float32Array(MAX_POINTS);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.dot } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (220.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // ---- sprites ----
    this.sprites = [];
    this.spriteFree = [];
    for (let i = 0; i < MAX_SPRITES; i++) {
      const m = new THREE.SpriteMaterial({ map: TEX.smoke, transparent: true, depthWrite: false, color: 0xffffff });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 4;
      scene.add(s);
      const h = { sprite: s, mat: m, used: false, auto: false, i };
      this.sprites.push(h);
      this.spriteFree.push(h);
    }
    this.autoSprites = [];

    // ---- decals ----
    this.decals = [];
    this.decalIdx = 0;
    const dgeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.MeshBasicMaterial({ map: TEX.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0xffffff });
      const mesh = new THREE.Mesh(dgeo, m);
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.decals.push({ mesh, mat: m, life: 0, max: 1 });
    }

    // ---- pooled flash lights ----
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 1.8);
      l.visible = false;
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, peak: 1 });
    }
  }

  setQuality(q) { this.quality = q; }

  burst({ pos, count = 12, color = 0xffffff, color2, speed = 4, dirX = 0, dirY = 0.5, dirZ = 0, spread = 1, life = 0.5, size = 0.5, gravity = 6, drag = 2, shrink = 1, alpha = 1 }) {
    const n = Math.min(Math.round(count * this.quality), MAX_POINTS - this.count);
    const c1 = BURST_C1.set(color), c2 = color2 !== undefined ? BURST_C2.set(color2) : c1;
    for (let k = 0; k < n; k++) {
      const i = this.count++;
      this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
      const t = Math.random();
      this.pCol[i * 3] = c1.r + (c2.r - c1.r) * t;
      this.pCol[i * 3 + 1] = c1.g + (c2.g - c1.g) * t;
      this.pCol[i * 3 + 2] = c1.b + (c2.b - c1.b) * t;
      const sp = speed * rand(0.4, 1.1);
      this.vel[i * 3] = (dirX + (Math.random() - 0.5) * 2 * spread) * sp;
      this.vel[i * 3 + 1] = (dirY + (Math.random() - 0.5) * 2 * spread) * sp;
      this.vel[i * 3 + 2] = (dirZ + (Math.random() - 0.5) * 2 * spread) * sp;
      this.life[i] = this.maxLife[i] = life * rand(0.6, 1.3);
      this.grav[i] = gravity;
      this.drag[i] = drag;
      this.size0[i] = size * rand(0.7, 1.3);
      this.pSize[i] = this.size0[i];
      this.shrink[i] = shrink;
      this.pAlpha[i] = alpha;
    }
  }

  // managed sprite: auto-animated, auto-released
  puff(tex, { pos, vel = null, life = 1, size0 = 1, size1 = 2, color = 0xffffff, alpha0 = 0.8, alpha1 = 0, additive = false, drift = 0 }) {
    const h = this.spriteFree.pop();
    if (!h) return null;
    h.used = true; h.auto = true;
    h.age = 0; h.life = life;
    h.size0 = size0; h.size1 = size1;
    h.alpha0 = alpha0; h.alpha1 = alpha1;
    h.vx = vel ? vel.x : (Math.random() - 0.5) * drift;
    h.vy = vel ? vel.y : Math.random() * drift * 0.6;
    h.vz = vel ? vel.z : (Math.random() - 0.5) * drift;
    h.mat.map = TEX[tex] || TEX.smoke;
    h.mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    h.mat.color.set(color);
    h.mat.opacity = alpha0;
    h.mat.rotation = Math.random() * Math.PI * 2;
    h.rotV = (Math.random() - 0.5) * 1.2;
    h.sprite.position.copy(pos);
    h.sprite.scale.setScalar(size0);
    h.sprite.visible = true;
    this.autoSprites.push(h);
    return h;
  }

  // manual sprite (e.g. projectile glow) — caller positions it and must release
  acquireSprite(tex, color, size, additive = true, opacity = 1) {
    const h = this.spriteFree.pop();
    if (!h) return null;
    h.used = true; h.auto = false;
    h.mat.map = TEX[tex] || TEX.glow;
    h.mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    h.mat.color.set(color);
    h.mat.opacity = opacity;
    h.mat.rotation = 0;
    h.sprite.scale.setScalar(size);
    h.sprite.visible = true;
    return h;
  }

  releaseSprite(h) {
    if (!h || !h.used) return;
    h.used = false; h.auto = false;
    h.sprite.visible = false;
    this.spriteFree.push(h);
  }

  decal(pos, normal, size = 1, color = 0xffffff, life = 30) {
    const cap = Math.round(MAX_DECALS * clamp(this.quality + 0.25, 0.3, 1));
    this.decalIdx = (this.decalIdx + 1) % cap;
    const d = this.decals[this.decalIdx];
    d.life = d.max = life;
    d.mat.color.set(color);
    d.mat.opacity = 0.9;
    d.mesh.scale.setScalar(size);
    d.mesh.position.set(pos.x + normal.x * 0.02, pos.y + normal.y * 0.02, pos.z + normal.z * 0.02);
    d.mesh.lookAt(pos.x + normal.x, pos.y + normal.y, pos.z + normal.z);
    d.mesh.rotation.z = Math.random() * Math.PI * 2;
    d.mesh.visible = true;
  }

  flashLight(pos, color, intensity = 30, dur = 0.3, dist = 16) {
    let slot = this.lights.find((l) => l.life <= 0);
    if (!slot) slot = this.lights[0];
    slot.life = slot.max = dur;
    slot.peak = intensity * (0.5 + this.quality * 0.5);
    slot.light.color.set(color);
    slot.light.distance = dist;
    slot.light.position.copy(pos);
    slot.light.visible = true;
  }

  update(dt) {
    // points
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count;
        if (i !== last) {
          for (let a = 0; a < 3; a++) {
            this.pPos[i * 3 + a] = this.pPos[last * 3 + a];
            this.pCol[i * 3 + a] = this.pCol[last * 3 + a];
            this.vel[i * 3 + a] = this.vel[last * 3 + a];
          }
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.grav[i] = this.grav[last];
          this.drag[i] = this.drag[last];
          this.size0[i] = this.size0[last];
          this.shrink[i] = this.shrink[last];
          this.pSize[i] = this.pSize[last];
          this.pAlpha[i] = this.pAlpha[last];
        }
        continue;
      }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pPos[i * 3] += this.vel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.pAlpha[i] = Math.min(1, t * 2.5);
      this.pSize[i] = this.size0[i] * (this.shrink[i] ? (0.3 + 0.7 * t) : 1);
      i++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.count);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;

    // auto sprites
    for (let s = this.autoSprites.length - 1; s >= 0; s--) {
      const h = this.autoSprites[s];
      h.age += dt;
      const t = h.age / h.life;
      if (t >= 1) {
        this.autoSprites.splice(s, 1);
        this.releaseSprite(h);
        continue;
      }
      h.sprite.position.x += h.vx * dt;
      h.sprite.position.y += h.vy * dt;
      h.sprite.position.z += h.vz * dt;
      h.sprite.scale.setScalar(h.size0 + (h.size1 - h.size0) * t);
      h.mat.opacity = h.alpha0 + (h.alpha1 - h.alpha0) * t;
      h.mat.rotation += h.rotV * dt;
    }

    // decals
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      if (d.life < 3) d.mat.opacity = 0.9 * (d.life / 3);
    }

    // lights
    for (const l of this.lights) {
      if (l.life <= 0) { l.light.visible = false; continue; }
      l.life -= dt;
      l.light.intensity = l.peak * Math.max(0, l.life / l.max);
      if (l.life <= 0) l.light.visible = false;
    }
  }

  clear() {
    this.count = 0;
    for (const h of this.autoSprites) this.releaseSprite(h);
    this.autoSprites.length = 0;
    for (const d of this.decals) d.mesh.visible = false;
    for (const l of this.lights) { l.life = 0; l.light.visible = false; }
  }
}
