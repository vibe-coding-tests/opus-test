// Collision world: AABB boxes, raycasts, CS-style movement, ladders, navgrid + A*.
import * as THREE from 'three';
import { clamp } from './utils.js';

const EPS = 0.001;
export const GRAV = 20;
export const JUMP_V = 6.4;
export const STEP_H = 0.56;
export const PLAYER_HALF = 0.36;
export const STAND_H = 1.8;
export const CROUCH_H = 1.2;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.02;

export class World {
  constructor() {
    this.boxes = [];
    this.ladders = [];
    this.waters = [];
    this.zones = { siteA: null, siteB: null, buy: {} };
    this.spawns = { order: [], death: [] };
    this.bounds = { x0: -10, z0: -10, x1: 10, z1: 10 };
    this.nav = null;
    this._grid = null;
    this._gridCell = 4;
    this._qid = 0;
  }

  addBox(x0, y0, z0, x1, y1, z1, tag) {
    const b = { x0, y0, z0, x1, y1, z1, tag, _q: 0 };
    this.boxes.push(b);
    return b;
  }

  // Detach a box (broken crate/barrel). Caller batches, then calls finalize()
  // to rebuild the lookup grid. The box object survives so it can be restored.
  removeBox(b) {
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  restoreBox(b) {
    if (!this.boxes.includes(b)) this.boxes.push(b);
  }

  finalize() {
    // uniform grid for overlap queries
    const cs = this._gridCell;
    this._grid = new Map();
    for (const b of this.boxes) {
      const ix0 = Math.floor(b.x0 / cs), ix1 = Math.floor(b.x1 / cs);
      const iz0 = Math.floor(b.z0 / cs), iz1 = Math.floor(b.z1 / cs);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const k = ix * 100000 + iz;
        let arr = this._grid.get(k);
        if (!arr) this._grid.set(k, (arr = []));
        arr.push(b);
      }
    }
  }

  *candidates(x0, z0, x1, z1) {
    if (!this._grid) { yield* this.boxes; return; }
    const cs = this._gridCell;
    this._qid++;
    const qid = this._qid;
    const ix0 = Math.floor(x0 / cs), ix1 = Math.floor(x1 / cs);
    const iz0 = Math.floor(z0 / cs), iz1 = Math.floor(z1 / cs);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const arr = this._grid.get(ix * 100000 + iz);
      if (arr) for (const b of arr) {
        if (b._q !== qid) { b._q = qid; yield b; }
      }
    }
  }

  overlaps(x0, y0, z0, x1, y1, z1) {
    for (const b of this.candidates(x0, z0, x1, z1)) {
      if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0 && z0 < b.z1 && z1 > b.z0) return b;
    }
    return null;
  }

  _raycastBox(b, ox, oy, oz, dx, dy, dz, bestT) {
    let tmin = 0, tmax = bestT, axis = -1, sign = 0;
    // X
    if (Math.abs(dx) < 1e-9) { if (ox < b.x0 || ox > b.x1) return null; }
    else {
      const inv = 1 / dx;
      let t1 = (b.x0 - ox) * inv, t2 = (b.x1 - ox) * inv, s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    // Y
    if (Math.abs(dy) < 1e-9) { if (oy < b.y0 || oy > b.y1) return null; }
    else {
      const inv = 1 / dy;
      let t1 = (b.y0 - oy) * inv, t2 = (b.y1 - oy) * inv, s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    // Z
    if (Math.abs(dz) < 1e-9) { if (oz < b.z0 || oz > b.z1) return null; }
    else {
      const inv = 1 / dz;
      let t1 = (b.z0 - oz) * inv, t2 = (b.z1 - oz) * inv, s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (!(tmin < bestT && tmin > 0)) return null;
    return {
      t: tmin,
      nx: axis === 0 ? sign : 0,
      ny: axis === 1 ? sign : 0,
      nz: axis === 2 ? sign : 0,
      box: b,
    };
  }

  _raycastBrute(ox, oy, oz, dx, dy, dz, max) {
    let bestT = max, hit = null, nx = 0, ny = 0, nz = 0;
    for (const b of this.boxes) {
      const h = this._raycastBox(b, ox, oy, oz, dx, dy, dz, bestT);
      if (h) {
        bestT = h.t; hit = h.box; nx = h.nx; ny = h.ny; nz = h.nz;
      }
    }
    if (!hit) return null;
    return { t: bestT, x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT, nx, ny, nz, box: hit };
  }

  // Slab raycast over the uniform grid. dir need not be normalized if max==1 (segment mode).
  raycast(ox, oy, oz, dx, dy, dz, max) {
    if (!this._grid) return this._raycastBrute(ox, oy, oz, dx, dy, dz, max);

    let bestT = max, hit = null, nx = 0, ny = 0, nz = 0;
    const scan = (arr, qid) => {
      if (!arr) return;
      for (const b of arr) {
        if (b._q === qid) continue;
        b._q = qid;
        const h = this._raycastBox(b, ox, oy, oz, dx, dy, dz, bestT);
        if (h) {
          bestT = h.t; hit = h.box; nx = h.nx; ny = h.ny; nz = h.nz;
        }
      }
    };

    const cs = this._gridCell;
    const qid = ++this._qid;
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) {
      const ix = Math.floor(ox / cs), iz = Math.floor(oz / cs);
      scan(this._grid.get(ix * 100000 + iz), qid);
    } else {
      let ix = Math.floor(ox / cs), iz = Math.floor(oz / cs);
      const endX = ox + dx * max, endZ = oz + dz * max;
      const endIx = Math.floor(endX / cs), endIz = Math.floor(endZ / cs);
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
      let tMaxX = stepX ? (((stepX > 0 ? ix + 1 : ix) * cs) - ox) / dx : Infinity;
      let tMaxZ = stepZ ? (((stepZ > 0 ? iz + 1 : iz) * cs) - oz) / dz : Infinity;
      const tDeltaX = stepX ? cs / Math.abs(dx) : Infinity;
      const tDeltaZ = stepZ ? cs / Math.abs(dz) : Infinity;
      const maxSteps = Math.abs(endIx - ix) + Math.abs(endIz - iz) + 4;
      let steps = 0;

      for (;;) {
        scan(this._grid.get(ix * 100000 + iz), qid);
        if ((ix === endIx && iz === endIz) || steps++ > maxSteps) break;
        if (tMaxX <= tMaxZ) {
          if (tMaxX > bestT) break;
          ix += stepX;
          tMaxX += tDeltaX;
        } else {
          if (tMaxZ > bestT) break;
          iz += stepZ;
          tMaxZ += tDeltaZ;
        }
      }
    }

    if (!hit) return null;
    return { t: bestT, x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT, nx, ny, nz, box: hit };
  }

  segmentClear(ax, ay, az, bx, by, bz) {
    return !this.raycast(ax, ay, az, bx - ax, by - ay, bz - az, 1);
  }

  groundY(x, z, fromY) {
    const h = this.raycast(x, fromY, z, 0, -1, 0, 60);
    return h ? h.y : 0;
  }

  // Walkable floor at (x,z): the LOWEST surface with standing clearance above
  // it. Unlike groundY(fromHigh), this lands under roofs instead of on them.
  floorY(x, z, maxY = 40) {
    let best = null;
    for (const b of this.candidates(x - 0.1, z - 0.1, x + 0.1, z + 0.1)) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      const y = b.y1;
      if (y > maxY || y < -6) continue;
      if (best !== null && y >= best) continue;
      if (!this.overlaps(x - 0.3, y + 0.1, z - 0.3, x + 0.3, y + 1.75, z + 0.3)) best = y;
    }
    return best ?? this.groundY(x, z, maxY);
  }

  inRect(rect, x, z) {
    return rect && x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;
  }

  waterAt(x, y, z) {
    for (const w of this.waters) {
      if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && y < w.y) return w;
    }
    return null;
  }

  ladderAt(x0, y0, z0, x1, y1, z1) {
    for (const l of this.ladders) {
      if (x0 < l.x1 && x1 > l.x0 && y0 < l.y1 && y1 > l.y0 && z0 < l.z1 && z1 > l.z0) return l;
    }
    return null;
  }

  // ------------------------------------------------------------- NAVGRID ---
  buildNav(cell = 1.5) {
    const { x0, z0, x1, z1 } = this.bounds;
    const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
    const nodes = [];
    const cellMap = new Map(); // ix*4096+iz → array of node idx
    // clearance starts above step height: anything lower is stepped over by moveBody
    const clear = (x, y, z) => !this.overlaps(x - 0.33, y + 0.6, z - 0.33, x + 0.33, y + 1.72, z + 0.33);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = x0 + (ix + 0.5) * cell, z = z0 + (iz + 0.5) * cell;
        // candidate floor heights
        const tops = [];
        for (const b of this.candidates(x - 0.1, z - 0.1, x + 0.1, z + 0.1)) {
          if (x > b.x0 + 0.04 && x < b.x1 - 0.04 && z > b.z0 + 0.04 && z < b.z1 - 0.04 && b.y1 <= 22 && b.y1 >= -4) tops.push(b.y1);
        }
        tops.sort((a, b) => a - b);
        // cluster near-equal surfaces, keeping the HIGHEST of each cluster —
        // on stairs the cell must stand on the step, not the floor beneath it,
        // or the next step blocks the clearance probe
        const surf = [];
        for (const y of tops) {
          if (surf.length && y - surf[surf.length - 1] < 0.4) surf[surf.length - 1] = y;
          else surf.push(y);
        }
        const idxs = [];
        for (const y of surf) {
          if (clear(x, y, z)) {
            idxs.push(nodes.length);
            nodes.push({ x, y, z, ix, iz, links: [], ladder: 0 });
          }
        }
        if (idxs.length) cellMap.set(ix * 4096 + iz, idxs);
      }
    }
    // links
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const getAt = (ix, iz, y, tol = 1.7) => {
      const arr = cellMap.get(ix * 4096 + iz);
      if (!arr) return -1;
      let best = -1, bd = tol;
      for (const i of arr) {
        const d = Math.abs(nodes[i].y - y);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    // ascending more than a step is only walkable over stairs/ramps:
    // sample ground along the segment and require step-sized risers
    const stairOk = (n, m) => {
      const dy = m.y - n.y;
      if (dy <= 0.58) return true; // flat, small step, or descent (walk-off)
      let prev = n.y;
      const S = 5;
      for (let k = 1; k <= S; k++) {
        const t = k / S;
        const gy = this.groundY(n.x + (m.x - n.x) * t, n.z + (m.z - n.z) * t, Math.max(n.y, m.y) + 1.4);
        if (gy - prev > 0.58) return false;
        prev = Math.max(prev, gy);
      }
      return true;
    };
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (const [dx, dz] of dirs) {
        const j = getAt(n.ix + dx, n.iz + dz, n.y);
        if (j < 0) continue;
        const m = nodes[j];
        if (!stairOk(n, m)) continue;
        const my = Math.max(n.y, m.y);
        // midpoint clearance prevents linking through walls (above step height)
        const mx = (n.x + m.x) / 2, mz = (n.z + m.z) / 2;
        if (!this.overlaps(mx - 0.3, my + 0.6, mz - 0.3, mx + 0.3, my + 1.65, mz + 0.3)) {
          n.links.push(j);
        }
      }
    }
    // diagonals when both orthogonals exist
    const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      for (const [dx, dz] of diag) {
        const a = getAt(n.ix + dx, n.iz, n.y), b = getAt(n.ix, n.iz + dz, n.y);
        if (a < 0 || b < 0 || !n.links.includes(a) || !n.links.includes(b)) continue;
        const j = getAt(n.ix + dx, n.iz + dz, n.y);
        if (j >= 0 && nodes[a].links.includes(j) && nodes[b].links.includes(j)) n.links.push(j);
      }
    }
    // ladder links
    for (const l of this.ladders) {
      const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
      const botP = { x: cx + l.nx * 0.7, y: l.y0, z: cz + l.nz * 0.7 };
      const topP = { x: cx - l.nx * 0.8, y: l.y1, z: cz - l.nz * 0.8 };
      const bi = this._nearestIdx(nodes, botP.x, botP.y, botP.z, 2.6);
      const ti = this._nearestIdx(nodes, topP.x, topP.y, topP.z, 2.6);
      if (bi >= 0 && ti >= 0 && bi !== ti) {
        nodes[bi].links.push(ti); nodes[ti].links.push(bi);
        nodes[bi].ladderTo = ti; nodes[ti].ladderTo = bi;
        l.botNode = bi; l.topNode = ti;
      }
    }
    this.nav = { nodes, cellMap, cell, x0, z0, nx, nz };

    // Site centers must be reachable nav goals: props (e.g. the plant box) can
    // occupy the geometric center, leaving only a linkless node on the box top
    // and breaking every path to the site. Snap each site's cx/cz to the
    // nearest spawn-reachable ground node inside the site rect.
    const seedSp = this.spawns.order?.[0] || this.spawns.death?.[0];
    if (seedSp) {
      const seed = this.nearestNode(seedSp.x, this.floorY(seedSp.x, seedSp.z, 20), seedSp.z);
      if (seed >= 0) {
        const reach = new Set([seed]);
        const q = [seed];
        while (q.length) {
          const i = q.pop();
          for (const j of nodes[i].links) if (!reach.has(j)) { reach.add(j); q.push(j); }
        }
        for (const key of Object.keys(this.zones)) {
          if (!key.startsWith('site')) continue;
          const zz = this.zones[key];
          let best = -1, bd = Infinity;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!reach.has(i)) continue;
            if (n.x < zz.x0 || n.x > zz.x1 || n.z < zz.z0 || n.z > zz.z1) continue;
            const d = (n.x - zz.cx) ** 2 + (n.z - zz.cz) ** 2 + n.y * n.y * 4; // prefer floor over crate tops
            if (d < bd) { bd = d; best = i; }
          }
          if (best >= 0) { zz.cx = nodes[best].x; zz.cz = nodes[best].z; }
        }
      }
    }
    return this.nav;
  }

  _nearestIdx(nodes, x, y, z, maxR) {
    let best = -1, bd = maxR * maxR;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + (n.y - y) ** 2 * 4;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  nearestNode(x, y, z) {
    const nav = this.nav;
    if (!nav) return -1;
    const ix = Math.floor((x - nav.x0) / nav.cell), iz = Math.floor((z - nav.z0) / nav.cell);
    for (let r = 0; r <= 4; r++) {
      let best = -1, bd = Infinity;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const arr = nav.cellMap.get((ix + dx) * 4096 + (iz + dz));
        if (arr) for (const i of arr) {
          const n = nav.nodes[i];
          const d = (n.x - x) ** 2 + (n.z - z) ** 2 + (n.y - y) ** 2 * 3;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return this._nearestIdx(this.nav.nodes, x, y, z, 60);
  }

  randomNode() {
    const n = this.nav.nodes;
    return n[(Math.random() * n.length) | 0];
  }

  nodesNear(x, y, z, r) {
    const out = [];
    for (const n of this.nav.nodes) {
      if ((n.x - x) ** 2 + (n.z - z) ** 2 < r * r && Math.abs(n.y - y) < 3.5) out.push(n);
    }
    return out;
  }

  // A* → array of {x,y,z,ladder} or null
  findPath(sx, sy, sz, ex, ey, ez) {
    const nav = this.nav;
    if (!nav) return null;
    const start = this.nearestNode(sx, sy, sz);
    const goal = this.nearestNode(ex, ey, ez);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: ex, y: ey, z: ez }];
    const nodes = nav.nodes;
    const open = new MinHeap();
    const gScore = new Map(), came = new Map(), closed = new Set();
    gScore.set(start, 0);
    const h = (i) => {
      const n = nodes[i];
      return Math.hypot(n.x - nodes[goal].x, n.z - nodes[goal].z) + Math.abs(n.y - nodes[goal].y) * 2;
    };
    open.push(start, h(start));
    let iter = 0;
    while (open.size && iter++ < 6000) {
      const cur = open.pop();
      if (cur === goal) {
        const path = [];
        let c = goal;
        while (c !== undefined) {
          const n = nodes[c];
          path.push({ x: n.x, y: n.y, z: n.z, ladder: !!n.ladderTo, idx: c });
          c = came.get(c);
        }
        path.reverse();
        return path;
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      const cn = nodes[cur];
      for (const j of cn.links) {
        if (closed.has(j)) continue;
        const m = nodes[j];
        const cost = Math.hypot(m.x - cn.x, m.z - cn.z) + Math.abs(m.y - cn.y) * 1.5;
        const g = gScore.get(cur) + cost;
        if (g < (gScore.get(j) ?? Infinity)) {
          gScore.set(j, g);
          came.set(j, cur);
          open.push(j, g + h(j));
        }
      }
    }
    return null;
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.v[p] <= this.v[i]) break;
      this._swap(i, p); i = p;
    }
  }
  pop() {
    const top = this.k[0];
    const lastK = this.k.pop(), lastV = this.v.pop();
    if (this.k.length) {
      this.k[0] = lastK; this.v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < this.k.length && this.v[l] < this.v[s]) s = l;
        if (r < this.k.length && this.v[r] < this.v[s]) s = r;
        if (s === i) break;
        this._swap(i, s); i = s;
      }
    }
    return top;
  }
  _swap(a, b) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
}

// ------------------------------------------------------------- MOVEMENT ---
// body: {pos:V3 (feet), vel:V3, height, crouching, onGround, ladderCD, inWater}
// ctrl: {wx, wz (target horiz vel), jump, crouch, climbF, pitch}
// returns events {landed, jumped, stepped}
export function moveBody(world, body, ctrl, dt) {
  const ev = { landed: 0, jumped: false };
  const half = PLAYER_HALF;
  const pos = body.pos, vel = body.vel;

  // --- crouch transitions (with air tuck) ---
  const wantH = ctrl.crouch ? CROUCH_H : STAND_H;
  if (wantH < body.height) {
    if (!body.onGround) {
      // tuck legs up in air
      const lift = body.height - wantH - 0.05;
      if (!world.overlaps(pos.x - half, pos.y + lift, pos.z - half, pos.x + half, pos.y + lift + wantH, pos.z + half)) {
        pos.y += lift;
        body.airTucked = true;
      }
    }
    body.height = wantH;
  } else if (wantH > body.height) {
    if (body.airTucked && !body.onGround) {
      const drop = wantH - body.height - 0.05;
      if (!world.overlaps(pos.x - half, pos.y - drop, pos.z - half, pos.x + half, pos.y - drop + wantH, pos.z + half)) {
        pos.y -= drop;
        body.height = wantH;
        body.airTucked = false;
      }
    } else if (!world.overlaps(pos.x - half, pos.y + EPS, pos.z - half, pos.x + half, pos.y + wantH, pos.z + half)) {
      body.height = wantH;
      body.airTucked = false;
    }
  }
  if (body.onGround) body.airTucked = false;

  // --- ladder ---
  body.ladderCD = Math.max(0, (body.ladderCD || 0) - dt);
  const lad = body.ladderCD > 0 ? null
    : world.ladderAt(pos.x - half, pos.y, pos.z - half, pos.x + half, pos.y + body.height, pos.z + half);
  const onLadder = !!lad && (ctrl.climbF !== 0 || !body.onGround);
  body.onLadder = onLadder;

  if (onLadder) {
    const dir = ctrl.pitch < -0.35 ? -1 : 1; // look down → W descends
    vel.y = ctrl.climbF * 4.2 * dir;
    vel.x += (ctrl.wx * 0.35 - vel.x) * Math.min(1, 14 * dt);
    vel.z += (ctrl.wz * 0.35 - vel.z) * Math.min(1, 14 * dt);
    if (ctrl.jump) {
      vel.x = lad.nx * 4.5; vel.z = lad.nz * 4.5; vel.y = 3;
      body.ladderCD = 0.4;
    }
  } else {
    // --- horizontal accel ---
    const k = body.onGround ? 16 : ctrl.fly ? 9 : 2.2;
    vel.x += (ctrl.wx - vel.x) * Math.min(1, k * dt);
    vel.z += (ctrl.wz - vel.z) * Math.min(1, k * dt);
    // --- gravity / jump / broom flight ---
    if (ctrl.fly) {
      vel.y += ((ctrl.flyY ?? 0) - vel.y) * Math.min(1, 9 * dt);
      if (Math.abs(vel.y) > 0.5) body.onGround = false;
    } else {
      vel.y -= GRAV * dt;
      if (ctrl.jump && body.onGround) {
        vel.y = JUMP_V * (body.inWater ? 0.75 : 1);
        body.onGround = false;
        ev.jumped = true;
      }
    }
  }

  // --- integrate: horizontal with step-up ---
  const dx = vel.x * dt, dz = vel.z * dt;
  const sx = pos.x, sy = pos.y, sz = pos.z;
  const move = () => {
    let bx = false, bz = false;
    pos.x += dx;
    for (const b of world.candidates(pos.x - half, pos.z - half, pos.x + half, pos.z + half)) {
      if (pos.x - half < b.x1 && pos.x + half > b.x0 && pos.y < b.y1 && pos.y + body.height > b.y0 && pos.z - half < b.z1 && pos.z + half > b.z0) {
        pos.x = dx > 0 ? b.x0 - half - EPS : b.x1 + half + EPS;
        bx = true;
      }
    }
    pos.z += dz;
    for (const b of world.candidates(pos.x - half, pos.z - half, pos.x + half, pos.z + half)) {
      if (pos.x - half < b.x1 && pos.x + half > b.x0 && pos.y < b.y1 && pos.y + body.height > b.y0 && pos.z - half < b.z1 && pos.z + half > b.z0) {
        pos.z = dz > 0 ? b.z0 - half - EPS : b.z1 + half + EPS;
        bz = true;
      }
    }
    return bx || bz;
  };
  const blocked = move();
  if (blocked && (body.onGround || onLadder)) {
    const ax = pos.x, az = pos.z;
    // retry lifted by step height
    if (!world.overlaps(sx - half, sy + EPS, sz - half, sx + half, sy + STEP_H + body.height, sz + half)) {
      pos.x = sx; pos.z = sz; pos.y = sy + STEP_H;
      move();
      // snap down
      let drop = STEP_H;
      pos.y -= drop;
      for (const b of world.candidates(pos.x - half, pos.z - half, pos.x + half, pos.z + half)) {
        if (pos.x - half < b.x1 && pos.x + half > b.x0 && pos.y < b.y1 && pos.y + body.height > b.y0 && pos.z - half < b.z1 && pos.z + half > b.z0) {
          pos.y = b.y1 + EPS;
        }
      }
      const gain2 = (pos.x - sx) ** 2 + (pos.z - sz) ** 2;
      const old2 = (ax - sx) ** 2 + (az - sz) ** 2;
      if (gain2 <= old2 + 1e-6) { pos.x = ax; pos.z = az; pos.y = sy; }
    }
    if (blocked) { /* velocity dampened naturally next frame */ }
  }
  if (blocked) {
    // kill velocity into walls
    if (Math.abs(pos.x - (sx + dx)) > 1e-4) vel.x = 0;
    if (Math.abs(pos.z - (sz + dz)) > 1e-4) vel.z = 0;
  }

  // --- vertical ---
  const wasGround = body.onGround;
  body.onGround = false;
  pos.y += vel.y * dt;
  for (const b of world.candidates(pos.x - half, pos.z - half, pos.x + half, pos.z + half)) {
    if (pos.x - half < b.x1 && pos.x + half > b.x0 && pos.y < b.y1 && pos.y + body.height > b.y0 && pos.z - half < b.z1 && pos.z + half > b.z0) {
      if (vel.y <= 0 && pos.y < b.y1 && sy >= b.y1 - 0.3) {
        pos.y = b.y1 + EPS;
        if (!wasGround) ev.landed = -vel.y;
        body.onGround = true;
        vel.y = 0;
      } else if (vel.y > 0) {
        pos.y = b.y0 - body.height - EPS;
        vel.y = 0;
      } else {
        // squeezed sideways into geometry: push up gently
        pos.y = b.y1 + EPS;
        body.onGround = true;
        vel.y = 0;
      }
    }
  }
  // ground stickiness probe
  if (!body.onGround && vel.y <= 0.01) {
    if (world.overlaps(pos.x - half, pos.y - 0.06, pos.z - half, pos.x + half, pos.y, pos.z + half)) {
      body.onGround = true;
      if (!wasGround) ev.landed = -vel.y;
      vel.y = 0;
    }
  }
  if (pos.y < -30) { pos.y = 5; vel.set(0, 0, 0); } // failsafe

  body.inWater = !!world.waterAt(pos.x, pos.y + 0.3, pos.z);
  return ev;
}

// segment vs sphere → t in [0,1] or -1
export function segVsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const fx = ax - cx, fy = ay - cy, fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + disc) / (2 * a);
  if (t2 >= 0 && t2 <= 1 && c < 0) return 0; // started inside
  return -1;
}

// segment vs AABB → t or -1
export function segVsAABB(ax, ay, az, bx, by, bz, x0, y0, z0, x1, y1, z1) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let tmin = 0, tmax = 1;
  for (const [o, d, lo, hi] of [[ax, dx, x0, x1], [ay, dy, y0, y1], [az, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
    } else {
      const inv = 1 / d;
      let t1 = (lo - o) * inv, t2 = (hi - o) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

export const eyeHeight = (body) => body.height < 1.5 ? EYE_CROUCH : EYE_STAND;

export { THREE, clamp };
