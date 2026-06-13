// Spell VFX entities: bolts, trails, impacts, explosions, smoke, fire, flash,
// shields, relic. Gameplay queries (smoke LOS, fire areas) read this module's lists.
import * as THREE from 'three';
import { rand, choice, makeWand } from './utils.js';

export class Effects {
  constructor(scene, particles, audio) {
    this.scene = scene;
    this.particles = particles;
    this.audio = audio;
    this.smokes = []; // {x,y,z,r,t}
    this.fires = [];  // {x,y,z,r,t,dps,owner,acc,puffT}
    this.wards = [];  // patronus walls {x,y,z,nx,nz,hw,h,team,t,life,mesh}
    this.boltPool = [];
    this.boltLightCount = 0;
    this.wandDrops = []; // physical disarmed wands
    this.parrySlashes = []; // short-lived wand swipes on perfect parries
    this.relicFx = null;
    this.world = null; // set by Game after the map loads (ground queries)
    this.time = 0;
  }

  // ---------------------------------------------------------------- bolts ---
  // core (hot white-ish) + additive shell (spell color) + comet tail +
  // orbiting motes + optional spinning halo ring + a pooled point light on
  // the first few bolts in flight.
  acquireBolt(spell) {
    let b = this.boltPool.pop();
    if (!b) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      group.add(core);
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 14, 10),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      group.add(shell);
      // comet tail streaming behind the bolt (+Z is the travel direction)
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.62, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      tail.rotation.x = -Math.PI / 2; // apex trails behind
      tail.position.z = -0.42;
      group.add(tail);
      // three motes spiralling around the core
      const orbit = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.032, 8, 6),
          new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
          })
        );
        const a = (i / 3) * Math.PI * 2;
        m.position.set(Math.cos(a) * 0.17, Math.sin(a) * 0.17, -0.05 - i * 0.05);
        orbit.add(m);
      }
      group.add(orbit);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.028, 10, 24),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      ring.visible = false;
      group.add(ring);
      this.scene.add(group);
      b = { group, core, shell, tail, orbit, ring, glow: null, light: null };
    }
    b.core.material.color.set(spell.glow);
    b.shell.material.color.set(spell.color);
    b.tail.material.color.set(spell.color);
    for (const m of b.orbit.children) m.material.color.set(spell.glow);
    // spell-specific silhouettes
    const id = spell.id;
    b.tail.visible = true;
    b.orbit.visible = spell.kind !== 'lob';
    if (id === 'sectum') { // cutting blade: flat, wide, scythe-like
      b.core.scale.set(1.7, 0.4, 2.6); b.shell.scale.set(1.5, 0.5, 2.0);
      b.tail.scale.set(1.4, 0.5, 1.2);
    } else if (id === 'avada') { // heavy curse: long, fat, dragging green fire
      b.core.scale.set(1.25, 1.25, 2.8); b.shell.scale.set(1.3, 1.3, 2.2);
      b.tail.scale.set(1.5, 1.5, 1.7);
    } else if (spell.kind === 'lob') { // tumbling charge: round, no streak
      b.core.scale.set(1, 1, 1); b.shell.scale.set(1, 1, 1);
      b.tail.visible = false;
    } else { // darting bolt
      b.core.scale.set(1, 1, 2.4); b.shell.scale.set(1, 1, 1.9);
      b.tail.scale.set(1, 1, 1);
    }
    b.ring.visible = id === 'expelliarmus' || id === 'petrificus';
    if (b.ring.visible) {
      b.ring.material.color.set(spell.glow);
      b.ring.rotation.set(0, 0, Math.random() * Math.PI);
    }
    // light budget: the first few bolts in flight illuminate the world
    if (this.boltLightCount < 5) {
      if (!b.light) b.light = new THREE.PointLight(0xffffff, 0, 7, 1.8);
      b.light.color.set(spell.color);
      b.light.intensity = 6;
      b.group.add(b.light);
      this.boltLightCount++;
      b.hasLight = true;
    } else b.hasLight = false;
    b.glow = this.particles.acquireSprite('glow', spell.color, 0.85);
    if (b.glow) b.group.add(b.glow.sprite), b.glow.sprite.position.set(0, 0, 0);
    b.group.visible = true;
    return b;
  }

  releaseBolt(b) {
    b.group.visible = false;
    if (b.glow) {
      b.group.remove(b.glow.sprite);
      this.particles.releaseSprite(b.glow);
      b.glow = null;
    }
    if (b.hasLight && b.light) {
      b.light.intensity = 0;
      b.group.remove(b.light);
      this.boltLightCount--;
      b.hasLight = false;
    }
    this.boltPool.push(b);
  }

  trailTick(pos, spell, dt) {
    this.particles.burst({
      pos, count: Math.max(1, Math.round(90 * dt)), color: spell.color, color2: spell.glow,
      speed: 0.4, spread: 1, life: 0.22, size: 0.32, gravity: 0, drag: 0, shrink: 1,
    });
  }

  muzzle(pos, spell) {
    this.particles.burst({
      pos, count: 10, color: spell.color, color2: 0xffffff,
      speed: 2.5, spread: 1, life: 0.18, size: 0.3, gravity: 0, drag: 4,
    });
    this.particles.puff('glow', { pos: pos.clone(), life: 0.14, size0: 0.8, size1: 0.15, color: spell.glow, alpha0: 0.9, alpha1: 0, additive: true });
  }

  // converging wisps while a charge spell winds up (everyone can see it coming)
  chargeFX(pos, spell, t) {
    const n = this.particles.quality > 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const off = new THREE.Vector3(rand(-0.6, 0.6), rand(-0.5, 0.6), rand(-0.6, 0.6));
      const from = pos.clone().add(off);
      this.particles.puff('glow', {
        pos: from, vel: off.multiplyScalar(-2.6),
        life: 0.32, size0: 0.22 + t * 0.2, size1: 0.05,
        color: spell.color, alpha0: 0.85, alpha1: 0, additive: true,
      });
    }
  }

  impact(pos, normal, spell, onWorld = true) {
    this.particles.burst({
      pos, count: 16, color: spell.color, color2: spell.glow,
      dirX: normal ? normal.x * 0.8 : 0, dirY: normal ? normal.y * 0.8 + 0.3 : 0.5, dirZ: normal ? normal.z * 0.8 : 0,
      speed: 5, spread: 0.5, life: 0.4, size: 0.4, gravity: 7, drag: 2,
    });
    if (onWorld && normal) this.particles.decal(pos, normal, rand(0.5, 0.8), spell.color === 0xffffff ? 0x888888 : spell.color, 14);
    this.audio.play('impact', { pos, vol: 0.5 });
  }

  fleshImpact(pos, spell) {
    this.particles.burst({
      pos, count: 12, color: spell.color, color2: 0xff2222,
      speed: 3.5, spread: 0.9, life: 0.35, size: 0.35, gravity: 8, drag: 2,
    });
    this.audio.play('impact_flesh', { pos, vol: 0.7 });
  }

  explode(pos, spell) {
    const p = this.particles;
    p.burst({ pos, count: 70, color: 0xffd9a0, color2: spell.color, speed: 13, spread: 1, life: 0.7, size: 0.7, gravity: 9, drag: 2.5 });
    p.burst({ pos, count: 30, color: 0x553322, color2: 0x221108, speed: 7, spread: 1, life: 1.4, size: 1.0, gravity: 2, drag: 1.5, alpha: 0.6 });
    p.puff('flame', { pos, life: 0.35, size0: 1.5, size1: 5.5, color: 0xffaa55, alpha0: 0.95, alpha1: 0, additive: true });
    p.puff('smoke', { pos: pos.clone().add(new THREE.Vector3(0, 0.6, 0)), life: 1.8, size0: 2, size1: 6, color: 0x333333, alpha0: 0.6, alpha1: 0 });
    p.flashLight(pos, 0xffa050, 60, 0.35, 22);
    p.decal(new THREE.Vector3(pos.x, pos.y - 0.1, pos.z), new THREE.Vector3(0, 1, 0), spell.radius * 0.8, 0x111111, 40);
    this.audio.play('explosion', { pos });
  }

  // a wooden crate shatters into planks and dust (burned: charred + embers)
  crateBreakFX(rec, burned = false) {
    const pos = new THREE.Vector3(rec.x, rec.y, rec.z);
    const s = rec.w || 1.2;
    this.particles.burst({
      pos, count: 26, color: burned ? 0x2a1c10 : 0x8a6332, color2: burned ? 0x553322 : 0x5c3c18,
      speed: 5.5, spread: s * 0.55, life: 0.9, size: 0.22, gravity: 12, drag: 1.6,
    });
    this.particles.burst({
      pos, count: 10, color: 0xb89868, color2: 0x7a5a30,
      speed: 3, spread: s * 0.4, life: 1.3, size: 0.34, gravity: 10, drag: 1.2,
    });
    this.particles.puff('smoke', {
      pos, life: 1.0, size0: s * 0.8, size1: s * 2.2,
      color: burned ? 0x221a12 : 0x8a7a5a, alpha0: 0.55, alpha1: 0,
    });
    if (burned) {
      this.particles.burst({ pos, count: 14, color: 0xff8a2a, color2: 0xffc890, speed: 4, spread: s * 0.4, life: 0.6, size: 0.16, gravity: -3, drag: 1.5 });
    }
    this.particles.decal(new THREE.Vector3(rec.x, rec.y - (rec.h || s) / 2 + 0.03, rec.z), new THREE.Vector3(0, 1, 0), s * 0.9, 0x241a0e, 25);
  }

  spawnSmoke(pos, spell) {
    const dur = spell.smoke;
    this.smokes.push({ x: pos.x, y: pos.y + 1.2, z: pos.z, r: spell.radius, t: dur });
    const n = Math.round(16 * Math.max(0.4, this.particles.quality));
    for (let i = 0; i < n; i++) {
      const off = new THREE.Vector3(rand(-1, 1) * spell.radius * 0.7, rand(0.2, 2.2), rand(-1, 1) * spell.radius * 0.7);
      this.particles.puff('smoke', {
        pos: pos.clone().add(off),
        vel: new THREE.Vector3(rand(-0.08, 0.08), rand(0.02, 0.08), rand(-0.08, 0.08)),
        life: dur * rand(0.75, 1), size0: rand(2.2, 3.2), size1: rand(3.4, 4.6),
        color: 0x9aa4b2, alpha0: 0.92, alpha1: 0,
      });
    }
    this.audio.play('smoke', { pos });
  }

  spawnFire(pos, spell, owner) {
    const [dur, dps] = spell.fire;
    this.fires.push({ x: pos.x, y: pos.y, z: pos.z, r: spell.radius, t: dur, dps, owner, acc: 0, puffT: 0 });
    this.particles.decal(new THREE.Vector3(pos.x, pos.y + 0.02, pos.z), new THREE.Vector3(0, 1, 0), spell.radius * 1.1, 0x140a04, dur + 6);
    this.audio.play('fire_ignite', { pos });
  }

  // Fumos snuffs out cursed fire it lands on (CS smoke-vs-molotov rules)
  douseFires(pos, radius) {
    let doused = 0;
    for (const f of this.fires) {
      if (f.t <= 0) continue;
      const d = Math.hypot(pos.x - f.x, pos.z - f.z);
      if (d < radius + f.r && Math.abs(pos.y - f.y) < 3) {
        f.t = Math.min(f.t, 0.05);
        doused++;
        this.steamFX(new THREE.Vector3(f.x, f.y + 0.2, f.z), f.r);
      }
    }
    return doused;
  }

  steamFX(pos, r = 1.2) {
    const n = Math.round(10 * Math.max(0.4, this.particles.quality));
    for (let i = 0; i < n; i++) {
      this.particles.puff('smoke', {
        pos: pos.clone().add(new THREE.Vector3(rand(-r, r) * 0.7, rand(0, 0.5), rand(-r, r) * 0.7)),
        vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1.2, 2.4), rand(-0.2, 0.2)),
        life: rand(0.8, 1.4), size0: 0.8, size1: 1.8, color: 0xdfe8ee, alpha0: 0.7, alpha1: 0,
      });
    }
    this.audio.play('sizzle', { pos, vol: 0.9 });
  }

  flashAt(pos) {
    this.particles.puff('glow', { pos, life: 0.5, size0: 3, size1: 12, color: 0xffffff, alpha0: 1, alpha1: 0, additive: true });
    this.particles.burst({ pos, count: 26, color: 0xffffff, color2: 0xfff0a0, speed: 9, spread: 1, life: 0.5, size: 0.5, gravity: 0, drag: 3 });
    this.particles.flashLight(pos, 0xffffff, 80, 0.5, 30);
    this.audio.play('flash', { pos });
  }

  // --------------------------------------------------------------- shield ---
  ensureShield(player) {
    if (!player.shieldMesh) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1.05, 32, 22),
        new THREE.MeshBasicMaterial({ color: 0x77b8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      m.renderOrder = 6;
      // faint latitude bands give the bubble visible curvature
      const bands = new THREE.Mesh(
        new THREE.SphereGeometry(1.04, 32, 7),
        new THREE.MeshBasicMaterial({
          color: 0x9fd0ff, transparent: true, opacity: 0.1, wireframe: true,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      m.add(bands);
      this.scene.add(m);
      player.shieldMesh = m;
    }
    player.shieldMesh.visible = true;
    return player.shieldMesh;
  }

  updateShield(player, dt) {
    if (!player.shieldMesh) return;
    if (player.shielding && player.alive) {
      const m = this.ensureShield(player);
      m.position.set(player.pos.x, player.pos.y + player.body.height * 0.55, player.pos.z);
      const pulse = 0.2 + Math.sin(this.time * 7) * 0.04 + (player.shieldFlash || 0) * 0.5;
      m.material.opacity = pulse;
      m.scale.setScalar(1 + (player.shieldFlash || 0) * 0.12);
      player.shieldFlash = Math.max(0, (player.shieldFlash || 0) - dt * 4);
    } else {
      player.shieldMesh.visible = false;
    }
  }

  shieldHit(player, pos, dir = null) {
    player.shieldFlash = 1;
    // splash refracting off the bubble: sparks fly along the reflected direction
    let rx = 0, ry = 0.6, rz = 0;
    if (dir) {
      const c = player.eyePos();
      const n = pos.clone().sub(new THREE.Vector3(c.x, c.y - 0.25, c.z)).normalize();
      const d = dir.clone().normalize();
      const refl = d.sub(n.multiplyScalar(2 * d.dot(n)));
      rx = refl.x; ry = refl.y + 0.3; rz = refl.z;
    }
    this.particles.burst({ pos, count: 20, color: 0x88c4ff, color2: 0xffffff, dirX: rx, dirY: ry, dirZ: rz, speed: 6, spread: 0.45, life: 0.4, size: 0.4, gravity: 2, drag: 3 });
    this.particles.puff('ring', { pos, life: 0.3, size0: 0.4, size1: 2.2, color: 0x9fd0ff, alpha0: 0.9, alpha1: 0, additive: true });
    this.audio.play('shield_hit', { pos });
  }

  // ------------------------------------------------------- patronus wards ---
  spawnWard(pos, yaw, owner, spell) {
    const wm = owner.disc?.wardMult ?? 1; // Warden: bigger, longer-lived wall
    const [dur, hw, h] = [spell.ward[0] * wm, spell.ward[1] * wm, spell.ward[2]];
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    const group = new THREE.Group();
    // silver-blue veil — normal blending so it tints the world behind it blue
    const veil = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, h),
      new THREE.MeshBasicMaterial({
        color: 0x7fb4ef, transparent: true, opacity: 0.38,
        depthWrite: false, side: THREE.DoubleSide,
      })
    );
    veil.position.y = h / 2;
    group.add(veil);
    // brighter core band
    const core = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, h * 0.4),
      new THREE.MeshBasicMaterial({
        color: 0x9fd4ff, transparent: true, opacity: 0.25,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    core.position.y = h * 0.45;
    group.add(core);
    // base glow strip
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 0.4),
      new THREE.MeshBasicMaterial({
        color: 0xbfe2ff, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    base.position.y = 0.2;
    group.add(base);
    // rippling vertical streaks — give the veil visible spectral texture
    const streaks = [];
    const nStreaks = 6;
    for (let s = 0; s < nStreaks; s++) {
      const st = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, h * (0.65 + Math.random() * 0.35)),
        new THREE.MeshBasicMaterial({
          color: 0xdfefff, transparent: true, opacity: 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      st.position.set((s / (nStreaks - 1) - 0.5) * 2 * hw * 0.9, h * 0.5, 0);
      st.userData.phase = Math.random() * Math.PI * 2;
      st.userData.drift = rand(-0.4, 0.4);
      group.add(st);
      streaks.push(st);
    }
    group.position.copy(pos);
    group.rotation.y = yaw;
    this.scene.add(group);
    // cool light so the ward tints the surrounding geometry blue
    const light = new THREE.PointLight(0x7fb8ff, 14, hw * 2.5, 1.6);
    light.position.set(pos.x, pos.y + h * 0.6, pos.z);
    this.scene.add(light);
    const ward = {
      x: pos.x, y: pos.y, z: pos.z, nx, nz, hw, h,
      team: owner.team, owner, t: dur, life: dur, mesh: group,
      veil, core, base, streaks, light,
    };
    this.wards.push(ward);
    // conjuration burst
    const c = pos.clone().add(new THREE.Vector3(0, h * 0.5, 0));
    this.particles.burst({ pos: c, count: 30, color: 0xcfe8ff, color2: 0xffffff, speed: 4, spread: 1, life: 0.7, size: 0.5, gravity: -1, drag: 2 });
    this.particles.flashLight(c, 0xcfe8ff, 26, 0.4, 12);
    this.audio.play('ward_up', { pos: c, vol: 1 });
    return ward;
  }

  removeWard(ward) {
    const i = this.wards.indexOf(ward);
    if (i >= 0) this.wards.splice(i, 1);
    this.scene.remove(ward.mesh);
    this.scene.remove(ward.light);
    for (const m of [ward.veil, ward.core, ward.base, ...ward.streaks]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }

  wardBlockFX(pos, ward, spell) {
    this.particles.burst({
      pos, count: 18, color: 0xcfe8ff, color2: spell.color,
      dirX: ward.nx * 0.8, dirY: 0.5, dirZ: ward.nz * 0.8,
      speed: 5, spread: 0.6, life: 0.45, size: 0.4, gravity: 3, drag: 2,
    });
    this.particles.puff('ring', { pos, life: 0.35, size0: 0.4, size1: 2.4, color: 0xeaf6ff, alpha0: 0.9, alpha1: 0, additive: true });
  }

  parryFX(pos, player = null, dir = null) {
    const incoming = dir?.clone ? dir.clone().normalize() : new THREE.Vector3(0, 0, 1);
    let slashDir = new THREE.Vector3(-incoming.z, 0.2, incoming.x);
    if (slashDir.lengthSq() < 0.001) slashDir = new THREE.Vector3(1, 0.2, 0);
    slashDir.normalize();

    const cfg = player?.char?.skin?.wand || {};
    const woodMat = new THREE.MeshLambertMaterial({
      color: cfg.color ?? 0x5a3a1c, transparent: true, opacity: 0.95,
    });
    const gripMat = cfg.grip ? new THREE.MeshLambertMaterial({
      color: cfg.grip, transparent: true, opacity: 0.95,
    }) : null;
    const wand = makeWand(
      { len: (cfg.len ?? 0.5) * 1.25 },
      woodMat,
      gripMat,
      { radialSegs: 10, thick: 1.4 }
    );
    const group = new THREE.Group();
    group.position.copy(pos).add(slashDir.clone().multiplyScalar(-0.15));
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), slashDir);
    group.add(wand);

    const streakMat = new THREE.MeshBasicMaterial({
      color: 0xffd24a, transparent: true, opacity: 0.65,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.25, 8), streakMat);
    group.add(streak);
    this.scene.add(group);
    this.parrySlashes.push({
      group,
      mats: gripMat ? [woodMat, gripMat, streakMat] : [woodMat, streakMat],
      t: 0.22, life: 0.22, dir: slashDir,
    });

    this.particles.puff('glow', { pos, life: 0.28, size0: 1.4, size1: 0.2, color: 0xfff1a0, alpha0: 0.95, alpha1: 0, additive: true });
    this.particles.burst({ pos, count: 26, color: 0xffd24a, color2: 0xffffff, dirX: slashDir.x, dirY: 0.45, dirZ: slashDir.z, speed: 7, spread: 0.55, life: 0.5, size: 0.45, gravity: 2, drag: 3 });
    this.particles.flashLight(pos, 0xffd24a, 30, 0.25, 10);
  }

  // two spells annihilating mid-air: white core, both spell colors thrown out
  clashFX(pos, spA, spB) {
    this.particles.puff('glow', { pos, life: 0.3, size0: 1.6, size1: 0.2, color: 0xffffff, alpha0: 1, alpha1: 0, additive: true });
    this.particles.puff('ring', { pos, life: 0.45, size0: 0.4, size1: 4.2, color: 0xffffff, alpha0: 0.95, alpha1: 0, additive: true });
    this.particles.burst({ pos, count: 16, color: spA.color, color2: spA.glow, speed: 7, spread: 1, life: 0.5, size: 0.42, gravity: 3, drag: 2.5 });
    this.particles.burst({ pos, count: 16, color: spB.color, color2: spB.glow, speed: 7, spread: 1, life: 0.5, size: 0.42, gravity: 3, drag: 2.5 });
    this.particles.flashLight(pos, 0xffffff, 34, 0.22, 12);
    // sharp sparks along the collision axis
    this.particles.burst({ pos, count: 10, color: 0xfff2b0, color2: 0xffffff, speed: 12, spread: 0.4, dirY: 0.6, life: 0.3, size: 0.3, gravity: 6, drag: 1 });
  }

  // a blink: an arcane streak trailing behind the dash direction
  dashFX(player, dx, dz) {
    const base = player.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
    for (let i = 0; i < 6; i++) {
      const p = base.clone().add(new THREE.Vector3(-dx * i * 0.34, 0, -dz * i * 0.34));
      this.particles.puff('glow', {
        pos: p, life: 0.3, size0: Math.max(0.12, 0.78 - i * 0.1), size1: 0.06,
        color: 0x9fd0ff, alpha0: 0.6, alpha1: 0, additive: true,
      });
    }
    this.particles.burst({ pos: base, count: 14, color: 0xbfe0ff, color2: 0xffffff, dirX: -dx, dirY: 0.2, dirZ: -dz, speed: 4.5, spread: 0.5, life: 0.4, size: 0.3, gravity: 0, drag: 3 });
    this.particles.flashLight(base, 0x9fd0ff, 14, 0.16, 8);
  }

  // a bolt whiffing clean through a blinking wizard
  dashDodgeFX(victim) {
    const p = victim.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
    this.particles.puff('ring', { pos: p, life: 0.3, size0: 0.5, size1: 2.2, color: 0xbfe0ff, alpha0: 0.8, alpha1: 0, additive: true });
    this.particles.burst({ pos: p, count: 10, color: 0x9fd0ff, color2: 0xffffff, speed: 3, spread: 1, life: 0.35, size: 0.25, gravity: 0, drag: 3 });
  }

  // a bolt cashing in a combo: shatter (petrified) or crunch (slowed/snared/staggered)
  comboFX(pos, kind) {
    const col = kind === 'shatter' ? 0xdde8f2 : 0xffd24a;
    this.particles.puff('ring', { pos, life: 0.32, size0: 0.4, size1: 2.6, color: col, alpha0: 0.95, alpha1: 0, additive: true });
    this.particles.burst({ pos, count: 18, color: col, color2: 0xffffff, speed: 6.5, spread: 1, life: 0.42, size: 0.35, gravity: 3, drag: 2 });
    this.particles.flashLight(pos, col, 22, 0.2, 10);
  }

  // -------------------------------------------------------- on-hit effects ---
  // Third-person feedback every spectator sees: body flash + colored sparks.
  onHit(victim, spell) {
    victim.rig?.flash(spell.color, 0.22);
  }

  petrifyFX(victim) {
    const p = victim.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.particles.burst({ pos: p, count: 20, color: 0xaeb9c4, color2: 0xe2eef8, speed: 2.5, spread: 1, life: 0.6, size: 0.35, gravity: 5, drag: 2 });
    this.particles.puff('ring', { pos: p, life: 0.35, size0: 0.3, size1: 2.0, color: 0xc8d4e0, alpha0: 0.85, alpha1: 0, additive: true });
    victim.rig?.flash(0xe2eef8, 0.5);
  }

  freezeBreakFX(victim) {
    const p = victim.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.particles.burst({ pos: p, count: 16, color: 0x8a98a8, color2: 0xdde8f2, speed: 4, spread: 1, life: 0.5, size: 0.3, gravity: 7, drag: 1.5 });
    this.audio.play('freeze_break', { pos: p, vol: 0.8 });
  }

  cleanseFX(player) {
    const p = player.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
    this.particles.puff('ring', { pos: p, life: 0.5, size0: 0.4, size1: 3.0, color: 0x9fe8ff, alpha0: 0.9, alpha1: 0, additive: true });
    this.particles.burst({ pos: p, count: 22, color: 0x9fe8ff, color2: 0xffffff, speed: 2.4, dirY: 1.4, spread: 0.7, life: 0.8, size: 0.4, gravity: -2.5, drag: 2 });
    player.rig?.flash(0x9fe8ff, 0.4);
  }

  crucioFX(victim) {
    const p = victim.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
    this.particles.burst({ pos: p, count: 16, color: 0xa050ff, color2: 0xe0c0ff, speed: 3, spread: 1, life: 0.45, size: 0.35, gravity: 0, drag: 2 });
    this.audio.play('crucio', { pos: p, vol: 0.8 });
    victim.rig?.flash(0xa050ff, 0.4);
  }

  snareFX(victim) {
    // jinx lashes round the legs
    const p = victim.pos.clone().add(new THREE.Vector3(0, 0.35, 0));
    this.particles.puff('ring', { pos: p, life: 0.4, size0: 0.3, size1: 1.8, color: 0x58c8ff, alpha0: 0.9, alpha1: 0, additive: true });
    this.particles.burst({ pos: p, count: 14, color: 0x58c8ff, color2: 0xc6ecff, speed: 2.2, spread: 1, life: 0.5, size: 0.3, gravity: 2, drag: 2 });
    victim.rig?.flash(0x58c8ff, 0.35);
  }

  silenceFX(victim) {
    // the voice torn away — a soft implosion at the throat
    const p = victim.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.particles.puff('ring', { pos: p, life: 0.45, size0: 1.4, size1: 0.2, color: 0xc886ff, alpha0: 0.8, alpha1: 0, additive: true });
    this.particles.burst({ pos: p, count: 16, color: 0xc886ff, color2: 0xeed4ff, speed: 1.8, dirY: 0.6, spread: 0.8, life: 0.6, size: 0.3, gravity: -0.5, drag: 2.5 });
    victim.rig?.flash(0xc886ff, 0.45);
  }

  morphFX(victim, kind = 'pig') {
    const p = victim.pos.clone().add(new THREE.Vector3(0, 0.9, 0));
    const color = kind === 'pig' ? 0xff8fc8 : 0xffd6ec;
    this.particles.puff('ring', { pos: p, life: 0.45, size0: 0.35, size1: 2.4, color, alpha0: 0.9, alpha1: 0, additive: true });
    this.particles.burst({ pos: p, count: 24, color, color2: 0xffffff, speed: 3.2, dirY: 1.0, spread: 1, life: 0.75, size: 0.36, gravity: -1, drag: 2 });
    victim.rig?.flash(color, 0.5);
  }

  igniteFX(victim) {
    const p = victim.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.particles.puff('flame', { pos: p, life: 0.4, size0: 0.8, size1: 1.8, color: 0xffa050, alpha0: 0.9, alpha1: 0, additive: true });
    this.audio.play('ignite_player', { pos: p, vol: 0.8 });
  }

  avadaWisp(pos) {
    const p = pos.clone().add(new THREE.Vector3(0, 0.9, 0));
    this.particles.puff('smoke', { pos: p, vel: new THREE.Vector3(0, 0.9, 0), life: 1.8, size0: 0.9, size1: 2.6, color: 0x2faf5e, alpha0: 0.75, alpha1: 0 });
    this.particles.puff('glow', { pos: p, life: 0.5, size0: 1.6, size1: 3.4, color: 0x37ff6e, alpha0: 0.85, alpha1: 0, additive: true });
    this.particles.burst({ pos: p, count: 18, color: 0x37ff6e, color2: 0x0a3318, speed: 2, dirY: 1.4, spread: 0.7, life: 1.0, size: 0.4, gravity: -1.5, drag: 2 });
    this.particles.flashLight(p, 0x37ff6e, 30, 0.3, 12);
  }

  // ----------------------------------------------------- disarmed wand prop ---
  spawnWandDrop(player, dir) {
    this.removeWandDrop(player.wandProp, false);
    const wandCfg = player.char?.skin?.wand;
    const mesh = makeWand(
      { len: wandCfg?.len ?? 0.5 },
      new THREE.MeshLambertMaterial({ color: wandCfg?.color ?? 0x3a2512 }),
      null, { radialSegs: 10 }
    );
    const start = player.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    mesh.position.copy(start);
    this.scene.add(mesh);
    const side = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(2.2);
    const v = dir
      ? new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(3.2).add(side)
      : side.multiplyScalar(1.6);
    const drop = {
      mesh, player,
      vx: v.x, vy: 3.4, vz: v.z,
      spinX: rand(6, 11), spinZ: rand(-8, 8),
      settled: false,
      glow: this.particles.acquireSprite('glow', 0xffb347, 0.55),
    };
    if (drop.glow) drop.glow.sprite.position.copy(start);
    this.wandDrops.push(drop);
    player.wandProp = drop;
    return drop;
  }

  removeWandDrop(drop, sparkle = false) {
    if (!drop) return;
    const i = this.wandDrops.indexOf(drop);
    if (i >= 0) this.wandDrops.splice(i, 1);
    this.scene.remove(drop.mesh);
    drop.mesh.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    if (drop.glow) this.particles.releaseSprite(drop.glow);
    if (drop.player.wandProp === drop) drop.player.wandProp = null;
    if (sparkle) {
      this.particles.burst({ pos: drop.mesh.position, count: 12, color: 0xffb347, color2: 0xffffff, speed: 2, spread: 1, life: 0.4, size: 0.3, gravity: -1, drag: 2 });
      this.audio.play('wand_return', { pos: drop.mesh.position, vol: 0.7 });
    }
  }

  removeParrySlash(slash) {
    if (!slash) return;
    const i = this.parrySlashes.indexOf(slash);
    if (i >= 0) this.parrySlashes.splice(i, 1);
    this.scene.remove(slash.group);
    slash.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }

  // ------------------------------------------------------------- equipment ---
  disarmFX(player) {
    const p = player.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.particles.burst({ pos: p, count: 16, color: 0xffb347, color2: 0xffffff, speed: 5, spread: 1, life: 0.6, size: 0.4, gravity: 6, drag: 2 });
    this.audio.play('disarm', { pos: p });
  }

  healFX(player) {
    const p = player.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.particles.burst({ pos: p, count: 18, color: 0x66ff99, color2: 0xffffff, speed: 2, dirY: 1.2, spread: 0.5, life: 0.8, size: 0.4, gravity: -2, drag: 2 });
    this.audio.play('heal', { pos: p });
  }

  apparateFX(from, to) {
    for (const p of [from, to]) {
      const pp = p.clone().add(new THREE.Vector3(0, 1, 0));
      this.particles.burst({ pos: pp, count: 24, color: 0x9966ff, color2: 0x222244, speed: 4, spread: 1, life: 0.5, size: 0.5, gravity: 0, drag: 3 });
      this.particles.puff('glow', { pos: pp, life: 0.35, size0: 1.8, size1: 0.3, color: 0x8855ff, alpha0: 0.8, alpha1: 0, additive: true });
    }
    this.audio.play('apparate', { pos: to });
  }

  cloakFX(player) {
    const p = player.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.particles.burst({ pos: p, count: 20, color: 0xbbccdd, color2: 0x445566, speed: 1.5, spread: 1, life: 0.7, size: 0.5, gravity: -1, drag: 2 });
    this.audio.play('cloak', { pos: p });
  }

  broomTick(player, dt) {
    this.particles.burst({
      pos: player.pos.clone().add(new THREE.Vector3(0, 0.4, 0)),
      count: Math.max(1, Math.round(40 * dt)), color: 0xcccc88, color2: 0xffffff,
      speed: 1, spread: 0.6, life: 0.4, size: 0.3, gravity: 0, drag: 2,
    });
  }

  deathBurst(player, color) {
    const p = player.pos.clone().add(new THREE.Vector3(0, 1, 0));
    this.particles.burst({ pos: p, count: 26, color, color2: 0x222222, speed: 3.5, spread: 1, life: 0.8, size: 0.5, gravity: 3, drag: 2 });
    this.audio.play('death', { pos: p });
  }

  // ----------------------------------------------------------------- relic ---
  plantRelic(pos) {
    this.removeRelic();
    const group = new THREE.Group();
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45),
      new THREE.MeshBasicMaterial({ color: 0xa040ff })
    );
    crystal.position.y = 0.8;
    crystal.scale.set(0.78, 1.15, 0.78); // elongated shard
    group.add(crystal);
    const shell = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.58),
      new THREE.MeshBasicMaterial({
        color: 0xc788ff, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    shell.position.y = 0.8;
    shell.scale.set(0.78, 1.15, 0.78);
    crystal.userData.shell = shell;
    group.add(shell);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.65, 0.25, 12),
      new THREE.MeshLambertMaterial({ color: 0x222228 })
    );
    base.position.y = 0.12;
    group.add(base);
    const runes = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.025, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0x8a3aff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    runes.rotation.x = -Math.PI / 2;
    runes.position.y = 0.26;
    group.add(runes);
    group.position.copy(pos);
    this.scene.add(group);
    const glow = this.particles.acquireSprite('glow', 0xaa44ff, 2.2);
    if (glow) glow.sprite.position.set(pos.x, pos.y + 0.9, pos.z);
    this.relicFx = { group, crystal, glow, beat: 0 };
    return this.relicFx;
  }

  relicPulse(urgency) {
    if (!this.relicFx) return;
    const p = this.relicFx.group.position;
    this.particles.puff('ring', { pos: new THREE.Vector3(p.x, p.y + 0.5, p.z), life: 0.6, size0: 0.6, size1: 4 + urgency * 3, color: 0xbb55ff, alpha0: 0.8, alpha1: 0, additive: true });
    this.audio.play('relic_beep', { pos: p, vol: 0.8 });
  }

  removeRelic() {
    if (this.relicFx) {
      this.scene.remove(this.relicFx.group);
      if (this.relicFx.glow) this.particles.releaseSprite(this.relicFx.glow);
      this.relicFx = null;
    }
  }

  relicExplode(pos) {
    const p = this.particles;
    p.burst({ pos, count: 110, color: 0xbb66ff, color2: 0x220033, speed: 22, spread: 1, life: 1.3, size: 1.0, gravity: 6, drag: 1.5 });
    p.burst({ pos, count: 60, color: 0xffffff, color2: 0xaa44ff, speed: 14, spread: 1, life: 0.8, size: 0.7, gravity: 0, drag: 2 });
    p.puff('glow', { pos, life: 0.9, size0: 4, size1: 26, color: 0xcc88ff, alpha0: 1, alpha1: 0, additive: true });
    p.puff('smoke', { pos, life: 3.5, size0: 4, size1: 14, color: 0x221133, alpha0: 0.75, alpha1: 0 });
    p.flashLight(pos, 0xaa55ff, 120, 0.8, 40);
    this.audio.play('relic_explode', { pos });
    this.removeRelic();
  }

  // ---------------------------------------------------------------- update ---
  update(dt) {
    this.time += dt;
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= dt;
      if (s.t <= 0) this.smokes.splice(i, 1);
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (f.t <= 0) { this.fires.splice(i, 1); continue; }
      f.puffT -= dt;
      if (f.puffT <= 0) {
        f.puffT = 0.09 / Math.max(0.3, this.particles.quality);
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * f.r * 0.85;
        this.particles.puff('flame', {
          pos: new THREE.Vector3(f.x + Math.cos(a) * rr, f.y + 0.15, f.z + Math.sin(a) * rr),
          vel: new THREE.Vector3(0, rand(0.8, 1.6), 0),
          life: rand(0.4, 0.7), size0: rand(0.7, 1.2), size1: rand(0.2, 0.5),
          color: 0xffa050, alpha0: 0.9, alpha1: 0, additive: true,
        });
        if (Math.random() < 0.3) this.audio.play('fire_tick', { pos: f, vol: 0.5 });
        if (Math.random() < 0.25) this.particles.flashLight(new THREE.Vector3(f.x, f.y + 0.8, f.z), 0xff7733, 14, 0.18, 9);
      }
    }
    // patronus wards: shimmer, drift mist, fade out at the end of their life
    for (let i = this.wards.length - 1; i >= 0; i--) {
      const w = this.wards[i];
      w.t -= dt;
      if (w.t <= 0) { this.removeWard(w); continue; }
      const fade = Math.min(1, w.t / 0.8); // last 0.8s: fade
      const shimmer = 0.75 + Math.sin(this.time * 9 + i) * 0.25;
      w.veil.material.opacity = 0.38 * fade * shimmer;
      w.core.material.opacity = 0.25 * fade * (0.7 + Math.sin(this.time * 13) * 0.3);
      w.base.material.opacity = 0.55 * fade;
      w.light.intensity = 14 * fade * shimmer;
      for (const st of w.streaks) {
        const ph = st.userData.phase;
        st.material.opacity = fade * (0.25 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * 5 + ph)));
        st.position.x += st.userData.drift * dt;
        if (Math.abs(st.position.x) > w.hw * 0.92) st.userData.drift *= -1;
      }
      if (Math.random() < 12 * dt * Math.max(0.3, this.particles.quality)) {
        // silver mist rising off the veil
        const u = (Math.random() - 0.5) * 2 * w.hw;
        this.particles.puff('glow', {
          pos: new THREE.Vector3(w.x - w.nz * u, w.y + Math.random() * w.h * 0.7, w.z + w.nx * u),
          vel: new THREE.Vector3(0, rand(0.5, 1.1), 0),
          life: 0.7, size0: 0.45, size1: 0.1, color: 0xcfe8ff, alpha0: 0.5, alpha1: 0, additive: true,
        });
      }
    }
    if (this.relicFx) {
      const cr = this.relicFx.crystal;
      cr.rotation.y += dt * 2.5;
      cr.position.y = 0.8 + Math.sin(this.time * 3) * 0.08;
      const shell = cr.userData.shell;
      if (shell) {
        shell.rotation.y -= dt * 1.4;
        shell.position.y = cr.position.y;
        shell.material.opacity = 0.2 + Math.sin(this.time * 5) * 0.1;
      }
    }
    for (let i = this.parrySlashes.length - 1; i >= 0; i--) {
      const s = this.parrySlashes[i];
      s.t -= dt;
      const fade = Math.max(0, s.t / s.life);
      s.group.position.addScaledVector(s.dir, dt * 2.4);
      s.group.rotation.z += dt * 10;
      for (const m of s.mats) m.opacity = 0.95 * fade;
      if (s.t <= 0) this.removeParrySlash(s);
    }
    // dropped wands: tumble, land, then glimmer until picked up / returned
    for (const w of this.wandDrops) {
      if (w.settled) {
        if (w.glow) {
          w.glow.sprite.material.opacity = 0.35 + Math.sin(this.time * 6) * 0.2;
          w.glow.sprite.position.set(w.mesh.position.x, w.mesh.position.y + 0.12, w.mesh.position.z);
        }
        continue;
      }
      const m = w.mesh;
      w.vy -= 16 * dt;
      m.position.x += w.vx * dt;
      m.position.y += w.vy * dt;
      m.position.z += w.vz * dt;
      m.rotation.x += w.spinX * dt;
      m.rotation.z += w.spinZ * dt;
      if (w.glow) w.glow.sprite.position.copy(m.position);
      const gy = this.world ? this.world.groundY(m.position.x, m.position.z, m.position.y + 0.6) : 0;
      if (m.position.y <= gy + 0.05 && w.vy <= 0) {
        m.position.y = gy + 0.04;
        m.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
        w.settled = true;
        this.audio.play('wand_drop', { pos: m.position, vol: 0.8 });
      }
    }
  }

  // does the segment pass through smoke?
  smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of this.smokes) {
      if (s.t > 11.3) continue; // still blooming
      // distance from segment to smoke center
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 < 1e-9) continue;
      let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - s.x, py = ay + dy * t - s.y, pz = az + dz * t - s.z;
      if (px * px + py * py + pz * pz < (s.r * 0.85) ** 2) return true;
    }
    return false;
  }

  // -------------------------------------------------------------- serpent ---
  spawnSnakeMesh() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2d7a42 });
    const bellyMat = new THREE.MeshLambertMaterial({ color: 0x77a868 });
    const segs = [];
    for (let i = 0; i < 9; i++) { // longer, smoother body taper
      const r = 0.155 - i * 0.0135;
      const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.05, r), 10, 8), i % 2 ? bellyMat : bodyMat);
      s.position.set(0, 0.14 - i * 0.004, -0.115 * i);
      s.scale.set(1, 0.9, 1.3); // overlapping ovals read as one body
      g.add(s);
      segs.push(s);
    }
    // head: slightly larger, with ember eyes and a flicking tongue
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), bodyMat);
    head.scale.set(1, 0.75, 1.4);
    head.position.set(0, 0.16, 0.17);
    g.add(head);
    for (const sx of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd34d }));
      eye.position.set(sx, 0.215, 0.3);
      g.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), new THREE.MeshBasicMaterial({ color: 0x301505 }));
      pupil.position.set(sx, 0.218, 0.323);
      g.add(pupil);
    }
    const tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 5), new THREE.MeshBasicMaterial({ color: 0xd23a4a }));
    tongue.rotation.x = Math.PI / 2;
    tongue.position.set(0, 0.15, 0.47);
    g.add(tongue);
    g.userData.segs = segs;
    g.userData.tongue = tongue;
    this.scene.add(g);
    return g;
  }

  animateSnake(s, dt) {
    const m = s.mesh;
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.yaw;
    s.wiggleT += dt * 11;
    const segs = m.userData.segs;
    for (let i = 0; i < segs.length; i++) {
      segs[i].position.x = Math.sin(s.wiggleT - i * 0.62) * 0.07 * (1 + i * 0.18);
    }
    // tongue tastes the air
    const tongue = m.userData.tongue;
    if (tongue) tongue.scale.y = 0.4 + Math.abs(Math.sin(s.wiggleT * 0.7)) * 0.9;
    if (Math.random() < dt * 6) {
      this.particles.burst({
        pos: m.position.clone().add(new THREE.Vector3(0, 0.18, 0)),
        count: 1, color: 0x57c878, color2: 0x9fe8b4, speed: 0.5, spread: 0.5, life: 0.35, size: 0.16, gravity: 0, drag: 2,
      });
    }
  }

  snakeDeathFX(s, shot) {
    const p = new THREE.Vector3(s.x, s.y + 0.25, s.z);
    this.particles.puff('glow', { pos: p, life: 0.35, size0: 1.2, size1: 0.2, color: 0x57c878, alpha0: 0.8, alpha1: 0, additive: true });
    this.particles.burst({ pos: p, count: shot ? 16 : 10, color: 0x2d7a42, color2: 0x9fe8b4, speed: 2.6, spread: 1, life: 0.5, size: 0.3, gravity: 2, drag: 2 });
    this.audio.play(shot ? 'freeze_break' : 'smoke', { pos: p, vol: 0.6 });
  }

  removeSnakeMesh(mesh) {
    this.scene.remove(mesh);
    mesh.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }

  // ---------------------------------------------------------------- drops ---
  spawnDropMesh(item) {
    const g = new THREE.Group();
    if (item.kind === 'wand') {
      const stick = makeWand(
        { len: 0.85 },
        new THREE.MeshLambertMaterial({ color: 0x5a3a1c }),
        null, { radialSegs: 10, thick: 1.5 }
      );
      stick.rotation.z = Math.PI / 2.3;
      stick.position.y = 0.1;
      g.add(stick);
    } else if (item.kind === 'spell') {
      const c = (item.id && { bombarda: 0xff8a2a, lumos: 0xffffff, fumos: 0x9fb2c8, incendio: 0xff5a1f, patronum: 0xcfe8ff, serpensortia: 0x3fae5a }[item.id]) || 0xbbbbff;
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: c }));
      orb.position.y = 0.15;
      g.add(orb);
    } else {
      const vial = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.09, 0.16, 4, 12),
        new THREE.MeshLambertMaterial({ color: 0xd2304a, emissive: 0x551019 })
      );
      vial.position.y = 0.15;
      g.add(vial);
      const cork = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.04, 0.05, 8),
        new THREE.MeshLambertMaterial({ color: 0x8a6a42 })
      );
      cork.position.y = 0.305;
      g.add(cork);
    }
    // soft beacon so loot reads at a glance
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 26),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.18;
    g.add(ring);
    this.scene.add(g);
    return g;
  }

  removeDropMesh(mesh) {
    this.scene.remove(mesh);
    mesh.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }

  // ------------------------------------------------------- new equip FX ---
  portkeyFX(player) {
    const p = player.pos.clone().add(new THREE.Vector3(0, 1, 0));
    this.particles.puff('ring', { pos: p, life: 0.6, size0: 0.3, size1: 2.4, color: 0x66ddff, alpha0: 0.85, alpha1: 0, additive: true });
  }

  portkeyTick(player) {
    if (Math.random() > 0.5) return;
    this.particles.burst({
      pos: player.pos.clone().add(new THREE.Vector3(0, 0.4 + Math.random() * 1.2, 0)),
      count: 2, color: 0x66ddff, color2: 0xffffff, speed: 1.2, spread: 1, life: 0.4, size: 0.25, gravity: -2, drag: 2,
    });
  }

  felixFX(player) {
    const p = player.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
    this.particles.puff('glow', { pos: p, life: 0.6, size0: 2.6, size1: 0.4, color: 0xffd34d, alpha0: 0.95, alpha1: 0, additive: true });
    this.particles.burst({ pos: p, count: 30, color: 0xffd34d, color2: 0xfff6cf, speed: 3, dirY: 1.2, spread: 1, life: 0.9, size: 0.4, gravity: -1.5, drag: 2 });
    player.rig?.flash(0xffd34d, 0.5);
  }

  vestBreakFX(player) {
    const p = player.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
    this.particles.burst({ pos: p, count: 14, color: 0x8a6a3a, color2: 0x3a2a14, speed: 2.5, spread: 1, life: 0.6, size: 0.3, gravity: 4, drag: 1.5 });
    this.audio.play('shield_break', { pos: p, vol: 0.6 });
  }

  clear() {
    this.smokes.length = 0;
    this.fires.length = 0;
    for (let i = this.wards.length - 1; i >= 0; i--) this.removeWard(this.wards[i]);
    for (let i = this.wandDrops.length - 1; i >= 0; i--) this.removeWandDrop(this.wandDrops[i], false);
    for (let i = this.parrySlashes.length - 1; i >= 0; i--) this.removeParrySlash(this.parrySlashes[i]);
    this.removeRelic();
  }
}
