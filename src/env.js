// The living battlefield: breakable cover, exploding barrels, torches that
// snuff out and relight, bells that lure bots, and ambient creatures — capped
// by a circling dragon that strafes the map with fire if you provoke it.
import * as THREE from 'three';
import { segVsSphere } from './world.js';
import { otherTeam, ECON } from './data.js';
import { clamp, rand, choice } from './utils.js';

// pseudo-spells for kill attribution / FX
export const BARREL_SPELL = { id: 'barrel', name: 'Exploding Barrel', icon: 'bomb', color: 0xff8a2a, glow: 0xffc890, radius: 4.8, killReward: 100 };
export const DRAGON_FIRE = { id: 'dragonfire', name: 'Dragonfire', icon: 'flame', color: 0xff5a1f, glow: 0xffae6e, radius: 1.7, fire: [4.5, 13] };
export const BASILISK_GAZE = { id: 'basiliskgaze', name: 'Basilisk Gaze', icon: 'bind', color: 0x66ff99, glow: 0xd5ffe0, killReward: 0 };
export const BASILISK_BITE = { id: 'basiliskbite', name: 'Basilisk Bite', icon: 'snake', color: 0x3fae5a, glow: 0x9fe8b4, killReward: 0 };
export const GOBLIN_STING = { id: 'goblinsting', name: 'Goblin Dagger', icon: 'slash', color: 0xc8a23a, glow: 0xffe8a0, killReward: 0 };
export const BLUDGER_HIT = { id: 'bludger', name: 'Bludger', icon: 'bomb', color: 0x30343a, glow: 0xb8c0c8, killReward: 0 };

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();

// ambient life per theme
const LIFE = {
  dust: { birds: 3 },
  inferno: { birds: 2 },
  aztec: { birds: 4 },
  mirage: { birds: 3 },
  nuke: { birds: 2 },
  castle: { ghosts: 2, candles: 22, dragon: true },
  night: { ghosts: 1, batRoosts: 2, dragon: true },
  snow: { owls: true, birds: 2, dragon: true },
  pitch: { snitch: true, birds: 3, dragon: true },
  sewer: { batRoosts: 3, ghosts: 1 },
  diagon: { owls: true, birds: 3 },              // Eeylops Owl Emporium is two doors down
  bank: { dragon: true, candles: 10, ghosts: 1 },// the Ironbelly circles the marble dome
  ministry: { ghosts: 2, candles: 14 },          // memos long since replaced by spirits
};

function spriteFrom(draw, scale = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(scale, scale, 1);
  return sp;
}

const drawBat = (g) => {
  g.fillStyle = '#0a0a10';
  g.beginPath();
  g.moveTo(32, 36);
  g.quadraticCurveTo(18, 18, 2, 30);
  g.quadraticCurveTo(14, 32, 16, 40);
  g.quadraticCurveTo(26, 36, 32, 44);
  g.quadraticCurveTo(38, 36, 48, 40);
  g.quadraticCurveTo(50, 32, 62, 30);
  g.quadraticCurveTo(46, 18, 32, 36);
  g.fill();
};

const drawBird = (g) => {
  g.strokeStyle = '#16181e';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(8, 36);
  g.quadraticCurveTo(22, 20, 32, 34);
  g.quadraticCurveTo(42, 20, 56, 36);
  g.stroke();
};

export class Environment {
  constructor(game) {
    this.g = game;
    this.world = game.world;
    this.scene = game.scene;
    this.theme = game.mapMeta.theme;
    this.breakables = game.mapMeta.breakables || [];
    this.bells = game.mapMeta.bells || [];
    this.torches = game.mapMeta.torchObjs || [];
    this.pendingBooms = [];
    this.navDirtyT = 0;
    this.time = 0;

    this.birds = [];
    this.ghosts = [];
    this.batRoosts = [];
    this.candles = [];
    this.owl = null;
    this.owlT = rand(14, 26);
    this.snitch = null;
    this.dragon = null;
    this.mapNpcs = [];

    if (this.scene) {
      this.grp = new THREE.Group();
      this.scene.add(this.grp);
      this.buildLife(LIFE[this.theme] || {});
      this.buildMapNPCs(game.mapMeta.npcs || []);
    }
  }

  // ------------------------------------------------------------ breakables ---
  // Bolts/blasts call this with the box's breakRec.
  hitBreakable(rec, dmg, attacker) {
    if (rec.dead || dmg <= 0) return;
    rec.hp -= dmg;
    if (rec.hp > 0) return;
    if (rec.kind === 'barrel') this.queueBoom(rec, attacker);
    else this.breakCrate(rec, attacker);
  }

  breakCrate(rec, attacker, burned = false) {
    if (rec.dead) return;
    rec.dead = true;
    this.world.removeBox(rec.box);
    this.world.finalize();
    if (rec.mesh) rec.mesh.visible = false;
    this.g.effects.crateBreakFX(rec, burned);
    this.g.audio.play('crate_break', { pos: rec, vol: 0.95 });
    this.g.noise({ pos: rec }, 16);
    this.navDirtyT = 0.8;
  }

  queueBoom(rec, attacker, delay = rand(0.07, 0.22)) {
    if (rec.dead) return;
    rec.dead = true; // reserved — no double booms from chained blasts
    this.pendingBooms.push({ rec, attacker, at: this.g.time + delay });
  }

  boom(rec, attacker) {
    this.world.removeBox(rec.box);
    this.world.finalize();
    if (rec.mesh) rec.mesh.visible = false;
    const pos = new THREE.Vector3(rec.x, rec.y + 0.25, rec.z);
    this.g.effects.explode(pos, BARREL_SPELL);
    this.g.explosion(pos, BARREL_SPELL.radius, 80, attacker, BARREL_SPELL);
    this.g.noise({ pos }, 40);
    this.navDirtyT = 0.8;
  }

  // called from game.explosion for every blast (bombarda, barrels, the relic)
  explosionAt(pos, radius, maxDmg, attacker) {
    for (const rec of this.breakables) {
      if (rec.dead) continue;
      const d = Math.hypot(rec.x - pos.x, rec.y - pos.y, rec.z - pos.z);
      if (d > radius + 1) continue;
      this.hitBreakable(rec, maxDmg * (1 - d / (radius + 1.2)), attacker);
    }
    for (const tc of this.torches) {
      if ((tc.x - pos.x) ** 2 + (tc.y - pos.y) ** 2 + (tc.z - pos.z) ** 2 < (radius * 0.9) ** 2) this.extinguish(tc);
    }
    this.onLoudNoise(pos);
  }

  // standing fires gnaw at wooden cover and cook off barrels
  fireTick(dt) {
    const fires = this.g.effects.fires;
    if (!fires.length) return;
    for (const f of fires) {
      for (const rec of this.breakables) {
        if (rec.dead) continue;
        const dx = rec.x - f.x, dz = rec.z - f.z;
        if (dx * dx + dz * dz > (f.r + 0.9) ** 2 || Math.abs(rec.y - f.y) > 2.2) continue;
        rec.burn += dt;
        if (Math.random() < dt * 5 && this.scene) {
          this.g.particles.puff('smoke', {
            pos: new THREE.Vector3(rec.x + rand(-0.3, 0.3), rec.y + (rec.h || 1) * 0.5, rec.z + rand(-0.3, 0.3)),
            vel: new THREE.Vector3(0, rand(0.8, 1.6), 0),
            life: 0.9, size0: 0.4, size1: 1.2, color: 0x2a201a, alpha0: 0.5, alpha1: 0,
          });
        }
        if (rec.burn > (rec.kind === 'barrel' ? 1.1 : 2.4)) {
          if (rec.kind === 'barrel') this.queueBoom(rec, f.owner);
          else this.breakCrate(rec, f.owner, true);
        }
      }
      // cursed fire relights nearby sconces
      for (const tc of this.torches) {
        if (!tc.lit && (tc.x - f.x) ** 2 + (tc.z - f.z) ** 2 < 9 && Math.abs(tc.y - f.y) < 4) this.relight(tc);
      }
    }
  }

  // --------------------------------------------------------------- torches ---
  extinguish(tc) {
    if (!tc.lit) return;
    tc.lit = false;
    tc.relightAt = this.g.time + rand(13, 22);
    if (tc.glow) tc.glow.visible = false;
    if (tc.light) tc.light.visible = false;
    if (this.scene) {
      this.g.particles.puff('smoke', {
        pos: new THREE.Vector3(tc.x, tc.y + 0.15, tc.z), vel: new THREE.Vector3(0, 0.9, 0),
        life: 1.2, size0: 0.3, size1: 1.0, color: 0x444444, alpha0: 0.7, alpha1: 0,
      });
    }
  }

  relight(tc) {
    if (tc.lit) return;
    tc.lit = true;
    if (tc.glow) tc.glow.visible = true;
    if (tc.light) tc.light.visible = true;
  }

  // ----------------------------------------------------------------- bells ---
  ringBell(bell, by) {
    if (this.g.time < bell.cdUntil) return;
    bell.cdUntil = this.g.time + 2.0;
    bell.swingT = 0;
    this.g.audio.play('bell', { pos: bell, vol: 1.1 });
    this.g.noise({ pos: new THREE.Vector3(bell.x, bell.y, bell.z) }, 90);
    // the lure: the ringer's ENEMIES mark the bell and come look
    if (by) this.g.teamMemory[otherTeam(by.team)].set('bell', { x: bell.x, y: bell.y, z: bell.z, t: this.g.time, name: 'bell' });
    this.onLoudNoise(bell);
    if (by?.isHuman) this.g.hud.notice('The bell tolls — they will come looking.', 'info');
  }

  // ------------------------------------------------- projectile interaction ---
  segHit(ax, ay, az, bx, by, bz, maxT) {
    let best = null, bt = maxT;
    const test = (cx, cy, cz, r, kind, obj) => {
      const t = segVsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r);
      if (t >= 0 && t < bt) { bt = t; best = { t, kind, obj }; }
    };
    if (this.dragon) {
      const dp = this.dragon.grp.position;
      test(dp.x, dp.y, dp.z, 3.4, 'dragon', this.dragon);
    }
    if (this.snitch && !this.snitch.caught) {
      const sp = this.snitch.grp.position;
      test(sp.x, sp.y, sp.z, 0.45, 'snitch', this.snitch);
    }
    for (const npc of this.mapNpcs) {
      if (npc.hp <= 0 || npc.disabledT > 0 || !npc.grp?.visible) continue;
      const p = npc.grp.position;
      test(p.x, p.y + (npc.hitY ?? 0.6), p.z, npc.hitR ?? 0.8, 'mapNpc', npc);
    }
    for (const bell of this.bells) test(bell.x, bell.y - 0.25, bell.z, 0.8, 'bell', bell);
    return best;
  }

  onProjectileHit(hit, pr, hitPos) {
    if (hit.kind === 'dragon') {
      this.g.effects.impact(hitPos, new THREE.Vector3(0, -1, 0), pr.spell, false);
      this.provoke(pr.owner);
    } else if (hit.kind === 'snitch') {
      this.catchSnitch(pr.owner);
    } else if (hit.kind === 'mapNpc') {
      this.hitMapNpc(hit.obj, pr, hitPos);
    } else if (hit.kind === 'bell') {
      this.g.particles.burst({ pos: hitPos, count: 10, color: 0xffd060, color2: 0xfff0b0, speed: 4, spread: 0.4, life: 0.4, size: 0.25, gravity: 4, drag: 2 });
      this.ringBell(hit.obj, pr.owner);
    }
  }

  // ---------------------------------------------------------------- dragon ---
  provoke(shooter) {
    const d = this.dragon;
    if (!d) return;
    this.g.audio.play('dragon_roar', { pos: d.grp.position, vol: 1 });
    if (d.state !== 'circle' || this.g.time < d.cdUntil || !shooter?.alive) return;
    // strafe line: through the shooter, along the dragon's approach
    const dp = d.grp.position;
    const dir = V.set(shooter.pos.x - dp.x, 0, shooter.pos.z - dp.z).normalize();
    d.breath = {
      sx: shooter.pos.x - dir.x * 9, sz: shooter.pos.z - dir.z * 9,
      ex: shooter.pos.x + dir.x * 17, ez: shooter.pos.z + dir.z * 17,
      owner: shooter, t: 0, fired: 0,
    };
    d.state = 'dive';
    d.stateT = 0;
    d.from = dp.clone();
    // telegraph: a burning line on the ground
    const b = d.breath;
    const steps = Math.ceil(Math.hypot(b.ex - b.sx, b.ez - b.sz) / 1.6);
    for (let i = 0; i <= steps; i++) {
      const x = b.sx + (b.ex - b.sx) * (i / steps), z = b.sz + (b.ez - b.sz) * (i / steps);
      const gy = this.world.floorY(x, z, 30);
      if (this.world.raycast(x, gy + 1.6, z, 0, 1, 0, 50)) continue; // roofed: safe
      this.g.particles.decal(new THREE.Vector3(x, gy + 0.04, z), new THREE.Vector3(0, 1, 0), 1.1, 0xff3a14, 3.2);
    }
    this.g.hud.notice('THE DRAGON DESCENDS — clear the burning line!', 'bad');
    if (shooter.isHuman) this.g.hud.notice('You have angered the dragon.', 'bad');
  }

  catchSnitch(p) {
    const s = this.snitch;
    if (!s || s.caught) return;
    s.caught = true;
    s.grp.visible = false;
    const pos = s.grp.position.clone();
    this.g.particles.burst({ pos, count: 40, color: 0xffd700, color2: 0xfff4c0, speed: 6, spread: 0.6, life: 0.9, size: 0.3, gravity: -2, drag: 2 });
    this.g.particles.flashLight(pos, 0xffd700, 30, 0.4, 12);
    this.g.audio.play('snitch_catch', { pos, vol: 1 });
    if (this.g.mode !== 'dm') p.money = clamp(p.money + 300, 0, ECON.cap);
    this.g.hud.notice(p.isHuman ? 'You struck the GOLDEN SNITCH! +300 ɢ' : `${p.name} struck the Golden Snitch (+300 ɢ)`, p.team === this.g.human.team ? 'good' : 'bad');
  }

  // ------------------------------------------------------------ round reset ---
  onRoundStart() {
    let dirty = false;
    for (const rec of this.breakables) {
      rec.burn = 0;
      if (!rec.dead) continue;
      rec.dead = false;
      rec.hp = rec.maxHp;
      this.world.restoreBox(rec.box);
      if (rec.mesh) rec.mesh.visible = true;
      dirty = true;
    }
    this.pendingBooms.length = 0;
    this.navDirtyT = 0;
    for (const tc of this.torches) this.relight(tc);
    if (this.snitch) {
      this.snitch.caught = false;
      this.snitch.grp.visible = true;
      this.snitch.retargetT = 0;
    }
    if (this.dragon && this.dragon.state !== 'circle') {
      this.dragon.state = 'circle';
      this.dragon.breath = null;
    }
    for (const npc of this.mapNpcs) this.resetMapNpc(npc);
    if (dirty) {
      this.world.finalize();
      this.world.buildNav(1.5);
    }
  }

  // ---------------------------------------------------------------- update ---
  update(dt) {
    const g = this.g;
    this.time += dt;

    // delayed barrel booms (chain reactions)
    for (let i = this.pendingBooms.length - 1; i >= 0; i--) {
      const pb = this.pendingBooms[i];
      if (g.time >= pb.at) {
        this.pendingBooms.splice(i, 1);
        this.boom(pb.rec, pb.attacker);
      }
    }

    // debounced nav rebuild after cover changes
    if (this.navDirtyT > 0) {
      this.navDirtyT -= dt;
      if (this.navDirtyT <= 0) this.world.buildNav(1.5);
    }

    this.fireTick(dt);

    // torch relights
    for (const tc of this.torches) {
      if (!tc.lit && g.time >= tc.relightAt) this.relight(tc);
    }

    // bell swing
    for (const bell of this.bells) {
      if (!bell.mesh || bell.swingT > 8) continue;
      bell.swingT += dt;
      bell.mesh.rotation.x = Math.sin(bell.swingT * 9) * 0.45 * Math.exp(-bell.swingT * 0.9);
    }

    if (!this.scene) return;
    this.updateDragon(dt);
    this.updateMapNPCs(dt);
    this.updateLife(dt);
  }

  // ------------------------------------------------------------- life build ---
  buildLife(cfg) {
    const B = this.world.bounds;
    const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
    const span = Math.max(B.x1 - B.x0, B.z1 - B.z0);

    if (cfg.dragon) this.buildDragon(cx, cz, span);

    for (let i = 0; i < (cfg.birds || 0); i++) {
      const sp = spriteFrom(drawBird, 1.5);
      this.grp.add(sp);
      this.birds.push({
        sp, cx: cx + rand(-span / 3, span / 3), cz: cz + rand(-span / 3, span / 3),
        r: rand(10, 26), y: rand(26, 40), a: rand(0, Math.PI * 2),
        w: rand(0.1, 0.22), scatterT: 0, flapPh: rand(0, 9),
      });
    }

    const nodes = this.world.nav?.nodes || [];
    const indoor = [];
    const anywhere = [];
    for (let i = 0; i < nodes.length; i += 3) {
      const n = nodes[i];
      anywhere.push(n);
      const roof = this.world.raycast(n.x, n.y + 2, n.z, 0, 1, 0, 30);
      if (roof && roof.y - n.y > 3.4) indoor.push({ n, roofY: roof.y });
    }

    for (let i = 0; i < (cfg.ghosts || 0); i++) {
      const ghost = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.5, 8, 1, true), mat);
      robe.position.y = 0.75;
      ghost.add(robe);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), mat);
      head.position.y = 1.62;
      ghost.add(head);
      const n = anywhere.length ? choice(anywhere) : { x: cx, y: 0, z: cz };
      ghost.position.set(n.x, n.y + 0.4, n.z);
      this.grp.add(ghost);
      this.ghosts.push({ grp: ghost, target: null, ph: rand(0, 9), sighT: rand(10, 30) });
    }

    for (let i = 0; i < (cfg.batRoosts || 0); i++) {
      const spot = indoor.length ? choice(indoor) : null;
      const n = spot ? spot.n : (anywhere.length ? choice(anywhere) : { x: cx, y: 0, z: cz });
      const ry = spot ? Math.min(spot.roofY - 1.0, n.y + 4.5) : n.y + 4.5;
      const roost = { x: n.x, y: ry, z: n.z, bats: [], scatterT: 0 };
      for (let b = 0; b < 5; b++) {
        const sp = spriteFrom(drawBat, 0.55);
        this.grp.add(sp);
        roost.bats.push({ sp, a: rand(0, Math.PI * 2), r: rand(1.2, 2.8), w: rand(2.2, 3.6), ph: rand(0, 9), yo: rand(-0.5, 0.5) });
      }
      this.batRoosts.push(roost);
    }

    if (cfg.candles && indoor.length) {
      const warm = new THREE.MeshBasicMaterial({ color: 0xffe8b0 });
      const wax = new THREE.MeshLambertMaterial({ color: 0xe8e0cc });
      const picks = [];
      for (let i = 0; i < cfg.candles * 3 && picks.length < cfg.candles; i++) {
        const c = choice(indoor);
        if (c.roofY - c.n.y > 4.4) picks.push(c);
      }
      for (const c of picks) {
        const grp = new THREE.Group();
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.34, 6), wax);
        grp.add(stick);
        const flame = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.07), warm);
        flame.position.y = 0.25;
        grp.add(flame);
        grp.position.set(c.n.x + rand(-0.6, 0.6), c.roofY - rand(1.4, 2.6), c.n.z + rand(-0.6, 0.6));
        this.grp.add(grp);
        this.candles.push({ grp, baseY: grp.position.y, ph: rand(0, 9) });
      }
    }

    if (cfg.snitch) {
      const grp = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd700 }));
      grp.add(ball);
      const wingMat = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const wL = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.12), wingMat);
      wL.position.x = -0.27;
      grp.add(wL);
      const wR = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.12), wingMat);
      wR.position.x = 0.27;
      grp.add(wR);
      grp.position.set(cx, 3, cz);
      this.grp.add(grp);
      this.snitch = { grp, wL, wR, caught: false, tx: cx, ty: 3, tz: cz, retargetT: 0 };
    }

    this.owlsOn = !!cfg.owls;
  }

  // ------------------------------------------------------------- map NPCs ---
  buildMapNPCs(configs) {
    for (const cfg of configs) {
      if (cfg.type === 'basilisk') this.buildBasilisk(cfg);
      else if (cfg.type === 'goblin') this.buildGoblin(cfg);
      else if (cfg.type === 'bludger') this.buildBludger(cfg);
    }
  }

  routePoint(pt) {
    const x = pt.x ?? pt[0];
    const z = pt.z ?? pt[1];
    const y = pt.y ?? pt[2] ?? this.world.groundY(x, z, 30);
    return { x, y, z };
  }

  buildBasilisk(cfg) {
    const x = cfg.x ?? 0, z = cfg.z ?? 0;
    const y = cfg.y ?? this.world.groundY(x, z, 30);
    const grp = new THREE.Group();
    const hide = new THREE.MeshLambertMaterial({ color: 0x173828 });
    const belly = new THREE.MeshLambertMaterial({ color: 0x6a7f55 });
    const segs = [];
    for (let i = 0; i < 11; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.58 - i * 0.028, 14, 10), i % 2 ? belly : hide);
      s.position.set(Math.sin(i * 0.9) * 0.18, 0.55 - i * 0.015, -i * 0.42);
      s.scale.set(1.0, 0.62, 1.35);
      grp.add(s);
      segs.push(s);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.68, 18, 12), hide);
    head.position.set(0, 0.68, 0.58);
    head.scale.set(1.0, 0.7, 1.35);
    grp.add(head);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.75, 8), hide);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.62, 1.18);
    grp.add(snout);
    for (const sx of [-0.2, 0.2]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9cff6f }));
      eye.position.set(sx, 0.86, 1.05);
      grp.add(eye);
    }
    grp.position.set(x, y, z);
    grp.rotation.y = cfg.yaw ?? 0;
    grp.userData.segs = segs;
    this.grp.add(grp);
    this.mapNpcs.push({
      type: 'basilisk', cfg, grp, home: { x, y, z }, yaw: cfg.yaw ?? 0,
      hp: cfg.hp ?? 110, maxHp: cfg.hp ?? 110, disabledT: 0,
      hitR: 1.45, hitY: 0.65, range: cfg.range ?? 28,
      gazeCd: rand(2.0, 4.0), gaze: null, biteCd: rand(0.5, 1.5),
      wiggleT: rand(0, 9),
    });
  }

  buildGoblin(cfg) {
    const route = (cfg.route || []).map((p) => this.routePoint(p));
    if (!route.length) {
      const n = this.world.randomNode();
      route.push({ x: n.x, y: n.y, z: n.z });
    }
    const p0 = route[0];
    const grp = new THREE.Group();
    const coat = new THREE.MeshLambertMaterial({ color: 0x4a3820 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xa98b5e });
    const metal = new THREE.MeshLambertMaterial({ color: 0xbfa05a });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 8), coat);
    body.position.y = 0.45;
    grp.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 9), skin);
    head.position.y = 1.0;
    grp.add(head);
    for (const sx of [-0.28, 0.28]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 6), skin);
      ear.position.set(sx, 1.03, 0);
      ear.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      grp.add(ear);
    }
    const dagger = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 6), metal);
    dagger.rotation.x = Math.PI / 2;
    dagger.position.set(0.3, 0.68, 0.16);
    grp.add(dagger);
    grp.position.set(p0.x, p0.y, p0.z);
    this.grp.add(grp);
    this.mapNpcs.push({
      type: 'goblin', cfg, grp, route, routeIdx: 1 % route.length,
      hp: cfg.hp ?? 34, maxHp: cfg.hp ?? 34, disabledT: 0,
      hitR: 0.6, hitY: 0.8, speed: cfg.speed ?? 2.6,
      alarmCd: rand(0.3, 1.4), stabCd: rand(0.5, 1.4), wiggleT: rand(0, 9),
    });
  }

  buildBludger(cfg) {
    const route = (cfg.route || []).map((p) => this.routePoint(p));
    if (!route.length) return;
    const p0 = route[0];
    const grp = new THREE.Group();
    const iron = new THREE.MeshLambertMaterial({ color: 0x20242a });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), iron);
    grp.add(ball);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 6), iron);
      spike.position.set(Math.sin(a) * 0.42, Math.cos(i * 1.7) * 0.18, Math.cos(a) * 0.42);
      spike.lookAt(spike.position.clone().multiplyScalar(2));
      grp.add(spike);
    }
    grp.position.set(p0.x, p0.y, p0.z);
    this.grp.add(grp);
    this.mapNpcs.push({
      type: 'bludger', cfg, grp, route, routeIdx: 1 % route.length,
      hp: 999, maxHp: 999, disabledT: 0, hitR: 0.62, hitY: 0,
      speed: cfg.speed ?? 10.5, hitCd: rand(0.4, 1.2), spin: rand(4, 8),
    });
  }

  resetMapNpc(npc) {
    npc.hp = npc.maxHp;
    npc.disabledT = 0;
    npc.grp.visible = true;
    if (npc.home) {
      npc.grp.position.set(npc.home.x, npc.home.y, npc.home.z);
      npc.grp.rotation.y = npc.yaw ?? 0;
    } else if (npc.route?.length) {
      const p = npc.route[0];
      npc.grp.position.set(p.x, p.y, p.z);
      npc.routeIdx = 1 % npc.route.length;
    }
    npc.gaze = null;
    npc.gazeCd = rand(1.5, 3.5);
    npc.alarmCd = rand(0.4, 1.4);
    npc.stabCd = rand(0.4, 1.4);
    npc.hitCd = rand(0.4, 1.2);
  }

  disableMapNpc(npc, dur, hitPos) {
    npc.hp = 0;
    npc.disabledT = dur;
    npc.grp.visible = false;
    this.g.particles.burst({
      pos: hitPos ?? npc.grp.position,
      count: npc.type === 'bludger' ? 18 : 24,
      color: npc.type === 'goblin' ? 0xc8a23a : npc.type === 'bludger' ? 0x707882 : 0x66ff99,
      color2: 0xffffff, speed: 3.5, spread: 1, life: 0.55, size: 0.32, gravity: 2, drag: 2,
    });
  }

  hitMapNpc(npc, pr, hitPos) {
    this.g.effects.impact(hitPos, new THREE.Vector3(0, 1, 0), pr.spell, false);
    if (pr.owner?.isHuman) this.g.hud.hitmarker(false);
    if (npc.type === 'bludger') {
      npc.routeIdx = (npc.routeIdx + 1) % npc.route.length;
      npc.hitCd = Math.max(npc.hitCd, 0.8);
      npc.speed = Math.min((npc.cfg.speed ?? 10.5) * 1.45, npc.speed + 2.0);
      this.g.audio.play('stagger', { pos: hitPos, vol: 0.8 });
      return;
    }
    const dmg = pr.spell.dmg >= 200 ? 999 : Math.max(10, pr.spell.dmg);
    npc.hp -= dmg;
    npc.disabledT = Math.max(npc.disabledT, npc.type === 'basilisk' ? 0.6 : 0.25);
    this.g.audio.play('impact_flesh', { pos: hitPos, vol: 0.65 });
    if (npc.hp <= 0) {
      this.disableMapNpc(npc, npc.type === 'basilisk' ? 16 : 18, hitPos);
      if (pr.owner?.isHuman) {
        this.g.hud.notice(npc.type === 'basilisk' ? 'The basilisk recoils into the pipes.' : `${npc.cfg.name || 'Goblin'} retreats!`, 'good');
      }
    }
  }

  updateMapNPCs(dt) {
    for (const npc of this.mapNpcs) {
      if (npc.disabledT > 0) {
        npc.disabledT -= dt;
        if (npc.disabledT <= 0 && npc.hp <= 0) this.resetMapNpc(npc);
        continue;
      }
      if (npc.hp <= 0) continue;
      if (npc.type === 'basilisk') this.updateBasilisk(npc, dt);
      else if (npc.type === 'goblin') this.updateGoblin(npc, dt);
      else if (npc.type === 'bludger') this.updateBludger(npc, dt);
    }
  }

  nearestVisiblePlayer(from, range, yOff = 0.8) {
    let best = null, bd = range * range;
    for (const p of this.g.players) {
      if (!p.alive || p.cloakT > 0) continue;
      const d2 = (p.pos.x - from.x) ** 2 + (p.pos.z - from.z) ** 2;
      if (d2 >= bd || Math.abs(p.pos.y - from.y) > 5.5) continue;
      if (!this.world.segmentClear(from.x, from.y + yOff, from.z, p.pos.x, p.pos.y + p.body.height * 0.55, p.pos.z)) continue;
      best = p; bd = d2;
    }
    return best;
  }

  updateBasilisk(npc, dt) {
    const g = this.g;
    const p = npc.grp.position;
    npc.wiggleT += dt * 2.4;
    for (const [i, s] of (npc.grp.userData.segs || []).entries()) s.position.x = Math.sin(npc.wiggleT - i * 0.55) * 0.18;
    npc.biteCd -= dt;
    npc.gazeCd -= dt;
    const target = this.nearestVisiblePlayer(p, npc.range, 0.8);
    if (target) {
      const wantYaw = Math.atan2(target.pos.x - p.x, target.pos.z - p.z);
      const dy = ((wantYaw - npc.grp.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      npc.grp.rotation.y += clamp(dy, -2.4 * dt, 2.4 * dt);
      const d2 = (target.pos.x - p.x) ** 2 + (target.pos.z - p.z) ** 2;
      if (d2 < (npc.cfg.biteRange ?? 2.2) ** 2 && npc.biteCd <= 0) {
        npc.biteCd = 2.6;
        g.audio.play('snake_bite', { pos: target.pos, vol: 1 });
        g.damage(target, null, 18, BASILISK_BITE, false, target.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
        if (target.alive) {
          target.applySnare(1.2, g);
          target.slowT = Math.max(target.slowT, 1.8);
          if (target.isHuman) g.hud.notice('Basilisk venom — move!', 'bad');
        }
      }
      if (!npc.gaze && npc.gazeCd <= 0) {
        npc.gaze = { target, t: 0, warned: false };
        npc.gazeCd = npc.cfg.gazeCd ?? 4.5;
        if (target.isHuman) g.hud.notice('BASILISK GAZE — look away!', 'bad');
      }
    }
    if (!npc.gaze) return;
    const z = npc.gaze;
    z.t += dt;
    const t = z.target;
    if (!t.alive || !this.world.segmentClear(p.x, p.y + 0.8, p.z, t.pos.x, t.pos.y + 0.9, t.pos.z)) {
      npc.gaze = null;
      return;
    }
    if (Math.random() < dt * 22) {
      const a = Math.random();
      const pos = new THREE.Vector3(p.x + (t.pos.x - p.x) * a, p.y + 0.75 + Math.random() * 0.3, p.z + (t.pos.z - p.z) * a);
      g.particles.puff('glow', { pos, life: 0.22, size0: 0.25, size1: 0.05, color: 0x66ff99, alpha0: 0.75, alpha1: 0, additive: true });
    }
    if (z.t < 0.9) return;
    const look = t.lookDir();
    look.y = 0;
    if (look.lengthSq() > 0.001) look.normalize();
    const toBasilisk = V.set(p.x - t.pos.x, 0, p.z - t.pos.z).normalize();
    if (look.dot(toBasilisk) > 0.2) {
      t.applyFreeze(0.85, g);
      if (t.isHuman) g.hud.notice("You met the basilisk's eyes!", 'bad');
    } else {
      t.applySnare(2.4, g);
      t.slowT = Math.max(t.slowT, 2.4);
      if (t.isHuman) g.hud.notice('Basilisk glare grazed you — slowed!', 'bad');
    }
    g.effects.petrifyFX(t);
    npc.gaze = null;
  }

  updateGoblin(npc, dt) {
    const g = this.g;
    const p = npc.grp.position;
    npc.stabCd -= dt;
    npc.alarmCd -= dt;
    npc.wiggleT += dt * 8;
    const target = this.nearestVisiblePlayer(p, npc.cfg.alarmRange ?? 10, 0.7);
    let tx, ty, tz, spd = npc.speed;
    if (target) {
      tx = target.pos.x; ty = target.pos.y; tz = target.pos.z;
      spd *= 1.15;
      const d2 = (target.pos.x - p.x) ** 2 + (target.pos.z - p.z) ** 2;
      if (npc.alarmCd <= 0) {
        npc.alarmCd = 5.0;
        g.audio.play('bell', { pos: p, vol: 0.45 });
        g.noise({ pos: p }, 42);
        if (target.isHuman) g.hud.notice(`${npc.cfg.name || 'Goblin'} raised the alarm!`, 'bad');
      }
      if (d2 < 1.55 ** 2 && npc.stabCd <= 0) {
        npc.stabCd = 2.1;
        g.audio.play('jinx', { pos: target.pos, vol: 0.8 });
        g.damage(target, null, 12, GOBLIN_STING, false, target.pos.clone().add(new THREE.Vector3(0, 0.75, 0)));
        if (target.alive) {
          target.applySnare(0.75, g);
          if (target.isHuman) g.hud.notice('Goblin dagger — snared!', 'bad');
        }
      }
    } else {
      const goal = npc.route[npc.routeIdx];
      tx = goal.x; ty = goal.y; tz = goal.z;
      if ((p.x - tx) ** 2 + (p.z - tz) ** 2 < 0.75 ** 2) npc.routeIdx = (npc.routeIdx + 1) % npc.route.length;
    }
    const dx = tx - p.x, dz = tz - p.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.05) {
      const nx = p.x + (dx / len) * spd * dt;
      const nz = p.z + (dz / len) * spd * dt;
      if (this.world.segmentClear(p.x, p.y + 0.4, p.z, nx, p.y + 0.4, nz)) {
        p.x = nx; p.z = nz;
      } else {
        npc.routeIdx = (npc.routeIdx + 1) % npc.route.length;
      }
      p.y += clamp((ty ?? this.world.groundY(p.x, p.z, p.y + 1)) - p.y, -5 * dt, 5 * dt);
      npc.grp.rotation.y = Math.atan2(dx, dz);
    }
    npc.grp.rotation.z = Math.sin(npc.wiggleT) * 0.035;
  }

  updateBludger(npc, dt) {
    const g = this.g;
    const p = npc.grp.position;
    npc.hitCd -= dt;
    npc.speed += ((npc.cfg.speed ?? 10.5) - npc.speed) * Math.min(1, dt * 0.35);
    const goal = npc.route[npc.routeIdx];
    const dx = goal.x - p.x, dy = goal.y - p.y, dz = goal.z - p.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.8) npc.routeIdx = (npc.routeIdx + 1) % npc.route.length;
    else {
      p.x += (dx / len) * npc.speed * dt;
      p.y += (dy / len) * npc.speed * dt;
      p.z += (dz / len) * npc.speed * dt;
    }
    npc.grp.rotation.x += dt * npc.spin;
    npc.grp.rotation.z -= dt * npc.spin * 0.7;
    if (npc.hitCd > 0) return;
    for (const q of g.players) {
      if (!q.alive || q.spawnProtT > 0) continue;
      const d2 = (q.pos.x - p.x) ** 2 + (q.pos.z - p.z) ** 2;
      if (d2 > 1.25 ** 2 || Math.abs(q.pos.y + 0.9 - p.y) > 2.2) continue;
      const away = V.set(q.pos.x - p.x, 0, q.pos.z - p.z);
      if (away.lengthSq() < 0.01) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      away.normalize();
      q.vel.x += away.x * 5.5;
      q.vel.z += away.z * 5.5;
      q.vel.y = Math.max(q.vel.y, 2.2);
      q.staggerT = Math.max(q.staggerT, 0.45);
      g.audio.play('stagger', { pos: q.pos, vol: 0.9 });
      g.damage(q, null, 16, BLUDGER_HIT, false, q.pos.clone().add(new THREE.Vector3(0, 1.0, 0)));
      if (q.isHuman) g.hud.notice('BLUDGER HIT!', 'bad');
      npc.hitCd = npc.cfg.hitCd ?? 1.9;
      break;
    }
  }

  buildDragon(cx, cz, span) {
    const grp = new THREE.Group();
    const hide = new THREE.MeshLambertMaterial({ color: 0x1c2418 });
    const belly = new THREE.MeshLambertMaterial({ color: 0x3a4030 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 4.4), hide);
    grp.add(body);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 2.6), belly);
    chest.position.set(0, -0.6, 0.4);
    grp.add(chest);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 1.8), hide);
    neck.position.set(0, 0.5, 2.8);
    neck.rotation.x = -0.35;
    grp.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1.3), hide);
    head.position.set(0, 0.95, 3.8);
    grp.add(head);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6), hide);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.85, 4.7);
    grp.add(snout);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.6, 6), hide);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.1, -3.8);
    grp.add(tail);
    const wingGeo = new THREE.PlaneGeometry(5.2, 2.2);
    wingGeo.translate(2.6, 0, 0); // pivot at the shoulder
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x242e1e, side: THREE.DoubleSide });
    const wingL = new THREE.Mesh(wingGeo, wingMat);
    wingL.position.set(0.7, 0.5, 0.4);
    grp.add(wingL);
    const wingR = new THREE.Mesh(wingGeo.clone(), wingMat);
    wingR.rotation.y = Math.PI;
    wingR.position.set(-0.7, 0.5, 0.4);
    grp.add(wingR);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffc23a });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), eyeMat);
      eye.position.set(0.22 * s, 1.1, 4.2);
      grp.add(eye);
    }
    this.grp.add(grp);
    this.dragon = {
      grp, wingL, wingR,
      cx, cz, orbitR: span / 2 + 16, h: 36,
      a: rand(0, Math.PI * 2), state: 'circle', stateT: 0,
      cdUntil: this.g.time + 15, breath: null, from: null, roarT: rand(8, 20),
    };
  }

  updateDragon(dt) {
    const d = this.dragon;
    if (!d) return;
    const g = this.g;
    d.stateT += dt;
    const flap = d.state === 'circle' ? 3.2 : 7;
    d.wingL.rotation.z = 0.2 + Math.sin(this.time * flap) * 0.45;
    d.wingR.rotation.z = -0.2 - Math.sin(this.time * flap) * 0.45;

    const pos = d.grp.position;
    if (d.state === 'circle') {
      d.a += dt * 0.085;
      const x = d.cx + Math.cos(d.a) * d.orbitR;
      const z = d.cz + Math.sin(d.a) * d.orbitR;
      const y = d.h + Math.sin(this.time * 0.3) * 3;
      V.set(x, y, z);
      if (pos.lengthSq() === 0) pos.copy(V);
      pos.lerp(V, Math.min(1, dt * 2));
      // face along the tangent
      V2.set(d.cx + Math.cos(d.a + 0.12) * d.orbitR, y, d.cz + Math.sin(d.a + 0.12) * d.orbitR);
      d.grp.lookAt(V2);
      d.roarT -= dt;
      if (d.roarT <= 0) {
        d.roarT = rand(24, 50);
        g.audio.play('dragon_roar', { pos, vol: 0.45 });
      }
    } else if (d.state === 'dive') {
      const b = d.breath;
      const t = clamp(d.stateT / 1.6, 0, 1);
      const gy = this.world.floorY(b.sx, b.sz, 30);
      V.set(b.sx, gy + 8, b.sz);
      pos.lerpVectors(d.from, V, t * t);
      d.grp.lookAt(b.ex, gy + 7, b.ez);
      if (t >= 1) {
        d.state = 'breath';
        d.stateT = 0;
        g.audio.play('dragon_fire', { pos, vol: 1 });
      }
    } else if (d.state === 'breath') {
      const b = d.breath;
      const t = clamp(d.stateT / 1.5, 0, 1);
      const x = b.sx + (b.ex - b.sx) * t, z = b.sz + (b.ez - b.sz) * t;
      const gy = this.world.floorY(x, z, 30);
      pos.set(x, gy + 7.5, z);
      d.grp.lookAt(b.ex, gy + 6.5, b.ez);
      // pour fire onto every exposed stretch of the line
      const dist = t * Math.hypot(b.ex - b.sx, b.ez - b.sz);
      if (dist - b.fired > 2.0) {
        b.fired = dist;
        if (!this.world.raycast(x, gy + 1.6, z, 0, 1, 0, 50)) {
          g.effects.spawnFire(new THREE.Vector3(x, gy + 0.05, z), DRAGON_FIRE, b.owner);
        }
      }
      // breath cone
      if (Math.random() < 0.9) {
        g.particles.puff('flame', {
          pos: pos.clone().add(new THREE.Vector3(rand(-0.5, 0.5), -1, rand(-0.5, 0.5))),
          vel: new THREE.Vector3(rand(-1, 1), -rand(6, 9), rand(-1, 1)),
          life: 0.5, size0: 0.8, size1: 2.2, color: 0xff7a2a, alpha0: 0.9, alpha1: 0, additive: true,
        });
      }
      if (t >= 1) {
        d.state = 'climb';
        d.stateT = 0;
        d.from = pos.clone();
        d.a = Math.atan2(pos.z - d.cz, pos.x - d.cx);
      }
    } else if (d.state === 'climb') {
      const t = clamp(d.stateT / 2.6, 0, 1);
      const x = d.cx + Math.cos(d.a) * d.orbitR;
      const z = d.cz + Math.sin(d.a) * d.orbitR;
      V.set(x, d.h, z);
      pos.lerpVectors(d.from, V, t);
      d.grp.lookAt(V2.set(x, d.h, z));
      if (t >= 1) {
        d.state = 'circle';
        d.breath = null;
        d.cdUntil = g.time + rand(45, 75);
      }
    }
  }

  onLoudNoise(pos) {
    for (const b of this.birds) {
      if ((b.cx - pos.x) ** 2 + (b.cz - pos.z) ** 2 < 45 * 45) b.scatterT = 7;
    }
    for (const r of this.batRoosts) {
      if ((r.x - pos.x) ** 2 + (r.z - pos.z) ** 2 < 20 * 20) this.scatterBats(r);
    }
  }

  scatterBats(roost) {
    if (roost.scatterT > 0) return;
    roost.scatterT = rand(3.5, 5.5);
    this.g.audio.play('bat', { pos: roost, vol: 0.6 });
  }

  updateLife(dt) {
    const g = this.g;
    // birds: distant circling specks; scatter from loud noise
    for (const b of this.birds) {
      if (b.scatterT > 0) b.scatterT -= dt;
      const sc = b.scatterT > 0;
      b.a += dt * b.w * (sc ? 3.4 : 1);
      const r = b.r * (sc ? 1 + (7 - b.scatterT) * 0.25 : 1);
      b.sp.position.set(b.cx + Math.cos(b.a) * r, b.y + Math.sin(b.a * 2.3) * 2 + (sc ? 4 : 0), b.cz + Math.sin(b.a) * r);
      b.sp.material.rotation = Math.sin(this.time * 7 + b.flapPh) * 0.25;
    }

    // ghosts drift between nav nodes, straight through walls (as ghosts do)
    for (const gh of this.ghosts) {
      const p = gh.grp.position;
      if (!gh.target || p.distanceToSquared(gh.target) < 1.5) {
        const n = this.world.randomNode();
        gh.target = new THREE.Vector3(n.x, n.y + rand(0.3, 1.4), n.z);
      }
      V.subVectors(gh.target, p).normalize().multiplyScalar(1.1 * dt);
      p.add(V);
      p.y += Math.sin(this.time * 1.3 + gh.ph) * 0.004;
      gh.grp.rotation.y = Math.atan2(gh.target.x - p.x, gh.target.z - p.z);
      gh.sighT -= dt;
      if (gh.sighT <= 0) {
        gh.sighT = rand(22, 50);
        g.audio.play('ghost', { pos: p, vol: 0.4 });
      }
    }

    // bats flutter at the roost; scatter wide when spooked (players too close)
    for (const r of this.batRoosts) {
      if (r.scatterT > 0) r.scatterT -= dt;
      else {
        for (const p of g.players) {
          if (p.alive && (p.pos.x - r.x) ** 2 + (p.pos.z - r.z) ** 2 < 5 * 5 && Math.abs(p.pos.y - r.y) < 6) {
            this.scatterBats(r);
            break;
          }
        }
      }
      const sc = r.scatterT > 0;
      for (const bt of r.bats) {
        bt.a += dt * bt.w * (sc ? 2.6 : 1);
        const rr = bt.r * (sc ? 3 : 1);
        bt.sp.position.set(
          r.x + Math.cos(bt.a) * rr,
          r.y + bt.yo + Math.sin(this.time * 3 + bt.ph) * 0.4 + (sc ? 1.2 : 0),
          r.z + Math.sin(bt.a) * rr,
        );
        bt.sp.scale.x = 0.55 * (0.6 + Math.abs(Math.sin(this.time * 11 + bt.ph)) * 0.6);
      }
    }

    // floating candles bob
    for (const c of this.candles) {
      c.grp.position.y = c.baseY + Math.sin(this.time * 0.9 + c.ph) * 0.15;
    }

    // the snitch darts around the pitch
    const s = this.snitch;
    if (s && !s.caught) {
      s.retargetT -= dt;
      const p = s.grp.position;
      if (s.retargetT <= 0 || (p.x - s.tx) ** 2 + (p.y - s.ty) ** 2 + (p.z - s.tz) ** 2 < 1) {
        s.retargetT = rand(1.0, 2.4);
        const B = this.world.bounds;
        s.tx = rand(B.x0 * 0.6, B.x1 * 0.6);
        s.tz = rand(B.z0 * 0.6, B.z1 * 0.6);
        s.ty = this.world.floorY(s.tx, s.tz, 30) + rand(1.4, 6);
      }
      V.set(s.tx - p.x, s.ty - p.y, s.tz - p.z);
      const dlen = V.length();
      if (dlen > 0.01) p.addScaledVector(V.divideScalar(dlen), Math.min(7 * dt, dlen));
      p.y += Math.sin(this.time * 9) * 0.01;
      s.wL.rotation.y = 0.5 + Math.sin(this.time * 26) * 0.7;
      s.wR.rotation.y = -0.5 - Math.sin(this.time * 26) * 0.7;
    }

    // an owl crosses the sky now and then (snowy Hogsmeade)
    if (this.owlsOn) {
      if (!this.owl) {
        this.owlT -= dt;
        if (this.owlT <= 0) {
          this.owlT = rand(20, 40);
          const B = this.world.bounds;
          const fromW = Math.random() < 0.5;
          const sp = spriteFrom(drawBird, 2.4);
          this.grp.add(sp);
          this.owl = {
            sp, t: 0, dur: rand(12, 16),
            x0: fromW ? B.x0 - 10 : B.x1 + 10, x1: fromW ? B.x1 + 10 : B.x0 - 10,
            z0: rand(B.z0, B.z1), z1: rand(B.z0, B.z1), y: rand(14, 20),
          };
          g.audio.play('owl', { pos: { x: this.owl.x0, y: this.owl.y, z: this.owl.z0 }, vol: 0.5 });
        }
      } else {
        const o = this.owl;
        o.t += dt;
        const t = o.t / o.dur;
        o.sp.position.set(o.x0 + (o.x1 - o.x0) * t, o.y + Math.sin(o.t * 2) * 0.8, o.z0 + (o.z1 - o.z0) * t);
        o.sp.material.rotation = Math.sin(o.t * 9) * 0.2;
        if (t >= 1) {
          this.grp.remove(o.sp);
          o.sp.material.map.dispose();
          o.sp.material.dispose();
          this.owl = null;
        }
      }
    }
  }
}
