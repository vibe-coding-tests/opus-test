// Player: stats, loadout, movement, equipment, first-person wand rig,
// third-person wizard rig. Bots drive the same controller via p.ctrl.
import * as THREE from 'three';
import { SPELLS, SLOT3, SLOT5, TEAM_INFO, EQUIP_EFFECTS, DASH, wandById, charById, disciplineById } from './data.js';
import { moveBody, EYE_STAND, EYE_CROUCH, STAND_H } from './world.js';
import { clamp, lerp, damp, uid, makeWand } from './utils.js';

export class Player {
  constructor(game, { name, charId, team, isHuman = false, prefWand = 'holly', discipline = null }) {
    this.game = game;
    this.id = uid();
    this.name = name;
    this.charId = charId;
    this.char = charById(charId);
    this.team = team;
    this.isHuman = isHuman;
    this.prefWand = prefWand;
    // discipline (build): humans pick in setup, bots use their playstyle default
    this.disc = disciplineById(discipline || this.char.ai?.disc) || null;

    this.stats = {
      hp: this.char.hp, speed: this.char.speed, power: this.char.power,
      cast: this.char.cast, mana: this.char.mana, regen: this.char.regen,
    };
    this.money = 0;
    this.kills = 0; this.deaths = 0; this.dmgDealt = 0;
    this.assists = 0; this.hsK = 0; this.mvps = 0; this.plants = 0; this.defuses = 0;
    this.roundDmg = 0; this.roundKills = 0; this.objScore = 0;
    this.hitLog = new Map(); // attacker.id → {dmg, t} — assist credit on death

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.body = { pos: this.pos, vel: this.vel, height: STAND_H, onGround: true, ladderCD: 0, inWater: false, airTucked: false };
    this.yaw = 0; this.pitch = 0;
    this.eyeSmooth = EYE_STAND;
    this.horizSpeed = 0;

    this.alive = false;
    this.health = this.stats.hp;
    this.mana = this.stats.mana;

    this.wand = wandById('training');
    this.owned = new Set();
    this.charges = {};
    this.equip = { potion: 0, broom: 0, cloak: 0, apparate: 0 };
    this.resetLoadout();

    this.curSpell = this.slot1();
    this.nextCastAt = 0;
    this.charge = null;
    this.shielding = false;
    this.shieldOnAt = -999; // when the shield was last raised (perfect-block timing)
    this.recharging = 0;
    this.disarmT = 0; this.blindT = 0; this.blindMax = 1; this.slowT = 0;
    this.snareT = 0; this.silenceT = 0;
    this.bleeds = [];
    this.burnT = 0; this.staggerT = 0; this.freezeT = 0;
    this.feralT = 0;      // Greyback post-kill rush
    this.taggedT = 0;     // Umbridge surveillance brand
    this.taggedBy = null;
    this.lastHit = null;  // {x,y,z,power,t} → corpse impulse direction
    this.wandProp = null; // physical wand lying on the ground while disarmed
    this.fxAcc = 0; this.dripAcc = 0;
    this.healT = 0; this.broomT = 0; this.cloakT = 0;
    this.bloom = 0;       // recoil spread, grows per cast and decays
    this.punchPitch = 0;  // camera view-punch (visual recoil, decays)
    this.punchYaw = 0;
    this.spawnProtT = 0;  // deathmatch spawn protection; cancelled by casting
    this.walking = false; // silent walk (Shift)
    this.flying = false;  // broom-mounted
    this.portkeyT = 0;    // emergency portkey channel
    this.vestHP = 0;      // dragonhide armor pool
    this.spawnPos = new THREE.Vector3();
    this.hasRelic = false;
    this.deathInfo = null;
    this.lastAttacker = null;
    this.flinchT = 0;
    this.dashCD = 0;      // blink cooldown
    this.dashT = 0;       // active blink burst (overrides footwork)
    this.dashDirX = 0; this.dashDirZ = 0;
    this.dashIframeT = 0; // brief dodge window mid-blink
    this.parryBuffT = 0;  // flow surge after a perfect parry

    this.ctrl = { moveX: 0, moveZ: 0, jump: false, crouch: false, walkHeld: false, castHeld: false, altHeld: false, climbF: 0 };
    this.rig = null;
    this.fp = null;
    this.footAcc = 0;
  }

  // ------------------------------------------------------------- loadout ---
  slot1() { return this.charId === 'snape' ? 'sectum' : 'stupefy'; }

  resetLoadout() {
    this.wand = wandById('training');
    this.owned = new Set([this.slot1(), 'expelliarmus', 'protego']);
    this.charges = {};
    this.equip = { potion: 0, broom: 0, cloak: 0, apparate: 0, finite: 0, vest: 0, felix: 0, portkey: 0 };
    this.vestHP = 0;
  }

  priceMult() { return this.charId === 'draco' ? 0.85 : 1; }
  equipPriceMult() { return this.priceMult() * (this.disc?.equipDiscount ?? 1); }

  ownsUsable(id) {
    const sp = SPELLS[id];
    if (!sp) return false;
    if (!this.owned.has(id)) return false;
    if (sp.charges) return (this.charges[id] || 0) > 0;
    return true;
  }

  chargeCap(sp) {
    let cap = sp.charges || 0;
    // McGonagall keeps a spare of every hex in her sleeve
    if (cap && this.charId === 'mcgonagall' && sp.slot === 3) cap += 1;
    return cap;
  }

  // damage-side power — Neville hits harder when cornered
  effPower() {
    let pw = this.stats.power;
    if (this.charId === 'neville' && this.alive && this.health <= this.stats.hp * 0.35) pw *= 1.2;
    return pw;
  }

  // round-start perk grants (called on every round spawn)
  roundPerks() {
    if (this.charId === 'ginny') {
      this.owned.add('impedimenta');
      this.charges.impedimenta = Math.max(this.charges.impedimenta || 0, 1);
    } else if (this.charId === 'wormtail') {
      this.equip.cloak = Math.max(this.equip.cloak, 1);
    }
  }

  availableSpells() {
    const out = [this.slot1()];
    if (this.ownsUsable('avada')) out.push('avada');
    out.push('expelliarmus');
    for (const id of SLOT3) if (id !== 'expelliarmus' && this.ownsUsable(id)) out.push(id);
    if (this.ownsUsable('bombarda')) out.push('bombarda');
    for (const id of SLOT5) if (this.ownsUsable(id)) out.push(id);
    return out;
  }

  selectSlot(n) {
    if (n === 1) this.curSpell = this.slot1();
    else if (n === 2 && this.ownsUsable('avada')) this.curSpell = 'avada';
    else if (n === 3) {
      const avail = SLOT3.filter((id) => id === 'expelliarmus' || this.ownsUsable(id));
      const idx = avail.indexOf(this.curSpell);
      this.curSpell = avail[(idx + 1) % avail.length];
    } else if (n === 4 && this.ownsUsable('bombarda')) this.curSpell = 'bombarda';
    else if (n === 5) {
      const avail = SLOT5.filter((id) => this.ownsUsable(id));
      if (!avail.length) return;
      const idx = avail.indexOf(this.curSpell);
      this.curSpell = avail[(idx + 1) % avail.length];
    } else return;
    this.game.spells.cancelCharge(this);
    this.fp?.onSwitch();
  }

  cycleSpell(dir) {
    const list = this.availableSpells();
    let idx = list.indexOf(this.curSpell);
    if (idx < 0) idx = 0;
    this.curSpell = list[(idx + dir + list.length) % list.length];
    this.game.spells.cancelCharge(this);
    this.fp?.onSwitch();
  }

  ensureValidSpell() {
    if (!this.ownsUsable(this.curSpell)) this.curSpell = this.slot1();
  }

  // --------------------------------------------------------------- state ---
  eyeY() { return this.pos.y + this.eyeSmooth; }
  eyePosInto(out) { return out.set(this.pos.x, this.eyeY(), this.pos.z); }
  eyePos() { return this.eyePosInto(new THREE.Vector3()); }
  lookDirInto(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  lookDir() { return this.lookDirInto(new THREE.Vector3()); }

  // where the CROSSHAIR points: true aim plus view punch. Bolts follow the
  // camera so recoil is honest — what you see is where you shoot, and
  // pulling down during a spray actually compensates (bots carry no punch).
  aimDirInto(out) {
    if (!this.punchPitch && !this.punchYaw) return this.lookDirInto(out);
    const yaw = this.yaw + this.punchYaw;
    const pitch = clamp(this.pitch + this.punchPitch, -1.55, 1.55);
    const cp = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  }
  aimDir() { return this.aimDirInto(new THREE.Vector3()); }
  get crouching() { return this.body.height < 1.5; }

  speedMult() {
    let m = this.disc?.speedMult ?? 1;
    if (this.feralT > 0) m *= 1.12; // Greyback fresh off a kill
    if (this.parryBuffT > 0) m *= 1.15; // perfect-parry flow surge
    if (this.crouching) m *= 0.48;
    else if (this.walking) m *= 0.5; // silent walk
    if (this.shielding) m *= SPELLS.protego.speedMult;
    if (this.charge) m *= SPELLS.avada.chargeSlow;
    if (this.slowT > 0) m *= 0.7; // Crucio: 30% slower
    if (this.snareT > 0) m *= 0.55; // Impedimenta: heavy snare
    if (this.recharging > 0) m *= 0.85;
    if (this.flying) m *= EQUIP_EFFECTS.broom.speedMult; // broom
    if (this.body.inWater) m *= 0.62;
    return m;
  }

  applyDisarm(dur, game, dir = null) {
    if (!this.alive) return;
    this.disarmT = Math.max(this.disarmT, dur);
    game.spells.cancelCharge(this);
    game.spells.stopShield(this);
    this.recharging = 0;
    game.effects.disarmFX(this);
    game.effects.spawnWandDrop(this, dir); // wand physically flies out and lands nearby
    this.fp?.onDisarm();
    if (this.isHuman) game.hud.notice('DISARMED! Grab your wand!', 'bad');
  }

  breakCloak() {
    if (this.cloakT > 0) {
      this.cloakT = 0;
      this.game.effects.cloakFX(this);
    }
  }

  applyFreeze(dur, game) {
    if (!this.alive) return;
    this.freezeT = Math.max(this.freezeT, dur);
    game.spells.cancelCharge(this);
    game.spells.stopShield(this);
    this.recharging = 0;
    this.vel.x = 0; this.vel.z = 0;
    game.effects.petrifyFX(this);
    game.audio.play('petrify', { pos: this.pos, vol: 0.9 });
    if (this.isHuman) game.hud.notice('PETRIFIED — body-bind!', 'bad');
  }

  applySnare(dur, game) {
    if (!this.alive) return;
    const fresh = this.snareT <= 0;
    this.snareT = Math.max(this.snareT, dur);
    if (fresh) game.effects.snareFX(this);
    game.audio.play('jinx', { pos: this.pos, vol: 0.85 });
    if (this.isHuman) game.hud.notice('SNARED — Impedimenta!', 'bad');
  }

  applySilence(dur, game) {
    if (!this.alive) return;
    this.silenceT = Math.max(this.silenceT, dur);
    game.spells.cancelCharge(this);
    game.spells.stopShield(this);
    this.recharging = 0;
    game.effects.silenceFX(this);
    game.audio.play('silencio', { pos: this.pos, vol: 0.9 });
    if (this.isHuman) game.hud.notice('SILENCED — you cannot cast!', 'bad');
  }

  hasDebuff() {
    return this.burnT > 0 || this.bleeds.length > 0 || this.slowT > 0 || this.snareT > 0 || this.blindT > 0.3;
  }

  useEquip(action) {
    const g = this.game;
    if (!this.alive) return;
    if (action === 'potion' && this.equip.potion > 0 && this.health < this.stats.hp) {
      this.equip.potion--;
      this.healT = EQUIP_EFFECTS.potion.duration;
      g.effects.healFX(this);
    } else if (action === 'broom') {
      if (this.flying) {
        this.flying = false; this.broomT = 0; // dismount
      } else if (this.equip.broom > 0) {
        this.equip.broom--;
        this.flying = true;
        this.broomT = EQUIP_EFFECTS.broom.duration; // flight fuel
        g.audio.play('broom', { pos: this.pos });
        if (this.isHuman) g.hud.notice('Broom mounted — Space climbs, Ctrl dives', '');
      } else return;
    } else if (action === 'portkey' && this.equip.portkey > 0 && this.portkeyT <= 0) {
      this.portkeyT = EQUIP_EFFECTS.portkey.channel;
      g.effects.portkeyFX(this);
      g.audio.play('charge', { pos: this.pos, dur: EQUIP_EFFECTS.portkey.channel, vol: 0.5 });
      if (this.isHuman) g.hud.notice('Portkey activated — hold on…', '');
    } else if (action === 'cloak' && this.equip.cloak > 0 && this.cloakT <= 0) {
      this.equip.cloak--;
      this.cloakT = EQUIP_EFFECTS.cloak.duration;
      g.effects.cloakFX(this);
    } else if (action === 'apparate' && this.equip.apparate > 0) {
      const dir = this.lookDir();
      dir.y = 0;
      if (dir.lengthSq() < 0.01) return;
      dir.normalize();
      const eye = this.eyePos();
      const blinkDist = EQUIP_EFFECTS.apparate.distance;
      const hit = g.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, blinkDist);
      const dist = hit ? Math.max(0.5, hit.t - 0.7) : blinkDist;
      const tx = this.pos.x + dir.x * dist, tz = this.pos.z + dir.z * dist;
      const gy = g.world.groundY(tx, tz, eye.y + 0.3);
      if (g.world.overlaps(tx - 0.36, gy + 0.05, tz - 0.36, tx + 0.36, gy + 1.85, tz + 0.36)) return;
      const from = this.pos.clone();
      this.equip.apparate--;
      this.pos.set(tx, gy + 0.02, tz);
      this.vel.set(0, 0, 0);
      g.effects.apparateFX(from, this.pos);
      g.noise(this, 16);
    } else if (action === 'finite' && this.equip.finite > 0 && this.hasDebuff() && this.freezeT <= 0) {
      // Finite Incantatem: dispel your own afflictions (not the body-bind — you can't cast inside it)
      this.equip.finite--;
      this.burnT = 0;
      this.bleeds.length = 0;
      this.slowT = 0;
      this.snareT = 0;
      this.blindT = Math.min(this.blindT, 0.25);
      g.effects.cleanseFX(this);
      g.audio.play('cleanse', { pos: this.pos, vol: 0.9 });
      if (this.isHuman) g.hud.notice('Finite Incantatem — afflictions dispelled', 'good');
    } else {
      return;
    }
    if (this.isHuman) g.hud.refreshEquip();
  }

  startRecharge() {
    if (this.recharging > 0 || this.mana >= this.stats.mana - 1 || this.disarmT > 0 || !this.alive) return;
    const dur = this.charId === 'hermione' ? 0.7 : 1.4;
    this.recharging = dur;
    this.rechargeDur = dur;
    this.game.spells.cancelCharge(this);
    this.game.spells.stopShield(this);
    this.game.audio.play('recharge', { pos: this.pos, dur });
    this.fp?.onRecharge(dur);
  }

  // Blink Dash — intrinsic mobility. A short directed burst with a brief dodge
  // window; rooted, petrified, staggered or airborne wizards can't blink.
  tryDash(dirX = null, dirZ = null) {
    const g = this.game;
    if (!this.alive || this.dashCD > 0 || this.dashT > 0) return false;
    if (this.freezeT > 0 || this.staggerT > 0 || this.snareT > 0 || this.flying || this.portkeyT > 0) return false;
    let dx = dirX, dz = dirZ;
    if (dx === null || dz === null) { dx = this.ctrl.moveX; dz = this.ctrl.moveZ; }
    let l = Math.hypot(dx, dz);
    if (l > 0.001) { dx /= l; dz /= l; }
    else { const f = this.lookDir(); dx = f.x; dz = f.z; l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
    this.dashDirX = dx; this.dashDirZ = dz;
    this.dashT = DASH.dur;
    this.dashCD = DASH.cd;
    this.dashIframeT = DASH.iframe;
    this.vel.x = dx * DASH.speed; this.vel.z = dz * DASH.speed;
    if (this.body.onGround) this.vel.y = Math.max(this.vel.y, DASH.hop);
    g.spells.cancelCharge(this); // a blink breaks a charging curse
    g.effects.dashFX(this, dx, dz);
    g.audio.play('dash', { pos: this.pos, vol: this.isHuman ? 0.85 : 0.5 });
    g.noise(this, 10);
    return true;
  }

  // -------------------------------------------------------------- update ---
  update(dt) {
    if (!this.alive) {
      this.rig?.update(dt, this); // corpse keeps animating (ragdoll, fade)
      return;
    }
    const g = this.game;

    // status timers
    const wasDisarmed = this.disarmT > 0;
    this.disarmT = Math.max(0, this.disarmT - dt);
    this.blindT = Math.max(0, this.blindT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.snareT = Math.max(0, this.snareT - dt);
    this.silenceT = Math.max(0, this.silenceT - dt);
    this.flinchT = Math.max(0, this.flinchT - dt);
    this.burnT = Math.max(0, this.burnT - dt);
    this.staggerT = Math.max(0, this.staggerT - dt);
    this.freezeT = Math.max(0, this.freezeT - dt);
    this.feralT = Math.max(0, this.feralT - dt);
    this.dashCD = Math.max(0, this.dashCD - dt);
    this.dashIframeT = Math.max(0, this.dashIframeT - dt);
    this.parryBuffT = Math.max(0, this.parryBuffT - dt);
    // wading puts the flames out
    if (this.burnT > 0 && this.body.inWater) {
      this.burnT = 0;
      this.game.effects.steamFX(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0.6);
      if (this.isHuman) this.game.hud.notice('Flames extinguished', 'good');
    }

    // dropped wand: walk over it to recover early, or it returns when the timer ends
    if (this.wandProp) {
      const w = this.wandProp.mesh.position;
      if (this.disarmT > 0 && this.wandProp.settled &&
          (this.pos.x - w.x) ** 2 + (this.pos.z - w.z) ** 2 < 1.1 && Math.abs(this.pos.y - w.y) < 1.6) {
        this.disarmT = 0;
        g.effects.removeWandDrop(this.wandProp, false);
        g.audio.play('wand_pickup', { pos: this.pos, vol: 0.9 });
        this.fp?.onSwitch();
        if (this.isHuman) g.hud.notice('Wand recovered!', 'good');
      } else if (wasDisarmed && this.disarmT <= 0) {
        g.effects.removeWandDrop(this.wandProp, true); // flies back with a sparkle
        this.fp?.onSwitch();
      }
    }

    // status particle emitters (burning body, blood drips, crucio crackle)
    this.fxAcc += dt;
    if (this.fxAcc > 0.07) {
      this.fxAcc = 0;
      if (this.burnT > 0) {
        for (let i = 0; i < 2; i++) {
          g.particles.puff('flame', {
            pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.55, 0.25 + Math.random() * 1.35, (Math.random() - 0.5) * 0.55)),
            vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.6, (Math.random() - 0.5) * 0.4),
            life: 0.45, size0: 0.6, size1: 0.2,
            color: i ? 0xffc060 : 0xff7028, alpha0: 0.95, alpha1: 0, additive: true,
          });
        }
        if (Math.random() < 0.35) {
          g.particles.burst({
            pos: this.pos.clone().add(new THREE.Vector3(0, 1.0, 0)),
            count: 3, color: 0xffb040, color2: 0xff4400, speed: 1.6, dirY: 1.4, spread: 0.8, life: 0.5, size: 0.3, gravity: -2, drag: 1,
          });
        }
      }
      if (this.slowT > 0 && Math.random() < 0.7) {
        g.particles.burst({
          pos: this.pos.clone().add(new THREE.Vector3(0, 0.6 + Math.random() * 0.9, 0)),
          count: 2, color: 0xa050ff, color2: 0xe0c0ff, speed: 1.6, spread: 1, life: 0.3, size: 0.25, gravity: 0, drag: 1,
        });
      }
      if (this.freezeT > 0 && Math.random() < 0.5) {
        // stone dust crumbling off the statue
        g.particles.burst({
          pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4)),
          count: 2, color: 0xaeb9c4, color2: 0x6e7886, speed: 0.5, spread: 0.7, life: 0.5, size: 0.18, gravity: 5, drag: 1,
        });
      }
      if (this.snareT > 0 && Math.random() < 0.6) {
        // jinx sparks tangling round the ankles
        g.particles.burst({
          pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.15 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5)),
          count: 2, color: 0x58c8ff, color2: 0xc6ecff, speed: 1.2, spread: 1, life: 0.35, size: 0.2, gravity: -1, drag: 1,
        });
      }
      if (this.silenceT > 0 && Math.random() < 0.55) {
        // stolen words: lavender motes drifting from the mouth
        g.particles.burst({
          pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 1.45, (Math.random() - 0.5) * 0.25)),
          count: 2, color: 0xc886ff, color2: 0xeed4ff, speed: 0.7, dirY: 0.8, spread: 0.6, life: 0.5, size: 0.16, gravity: -0.5, drag: 1,
        });
      }
    }
    if (this.bleeds.length > 0) {
      this.dripAcc += dt;
      if (this.dripAcc > 0.16) {
        this.dripAcc = 0;
        g.particles.burst({
          pos: this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3)),
          count: 2, color: 0xc01525, color2: 0x700a12, speed: 0.4, spread: 0.5, life: 0.55, size: 0.22, gravity: 9, drag: 0.5,
        });
      }
    }
    if (this.flying) {
      this.broomT -= dt;
      g.effects.broomTick(this, dt);
      if (this.broomT <= 0 || this.freezeT > 0) { this.flying = false; this.broomT = 0; }
    }
    if (this.portkeyT > 0) {
      this.portkeyT -= dt;
      g.effects.portkeyTick(this);
      if (this.portkeyT <= 0 && this.equip.portkey > 0) {
        this.equip.portkey--;
        const from = this.pos.clone();
        this.pos.set(this.spawnPos.x, this.spawnPos.y + 0.05, this.spawnPos.z);
        this.vel.set(0, 0, 0);
        g.effects.apparateFX(from, this.pos);
        g.audio.play('apparate', { pos: this.pos });
        g.noise(this, 14);
        if (this.isHuman) { g.hud.notice('Portkey — back at spawn', 'good'); g.hud.refreshEquip(); }
      }
    }
    this.bloom = Math.max(0, this.bloom - dt * 6); // recoil settles in ~0.5s
    const punchDecay = Math.exp(-dt * 7); // view punch springs back
    this.punchPitch *= punchDecay;
    this.punchYaw *= punchDecay;
    this.spawnProtT = Math.max(0, this.spawnProtT - dt);
    if (this.cloakT > 0) this.cloakT -= dt;
    if (this.healT > 0) {
      this.healT -= dt;
      this.health = Math.min(this.stats.hp, this.health + EQUIP_EFFECTS.potion.healPerSecond * dt);
    }
    if (this.recharging > 0) {
      this.recharging -= dt;
      this.mana = Math.min(this.stats.mana, this.mana + (this.stats.mana / this.rechargeDur) * dt);
    } else {
      this.mana = Math.min(this.stats.mana, this.mana + this.stats.regen * dt);
    }
    for (let i = this.bleeds.length - 1; i >= 0; i--) {
      const b = this.bleeds[i];
      b.t -= dt;
      g.damage(this, b.attacker, b.dps * dt, b.spell, false, null, true);
      if (b.t <= 0) this.bleeds.splice(i, 1);
      if (!this.alive) return;
    }

    // movement
    const c = this.ctrl;
    this.walking = !!c.walkHeld && !this.flying;
    const speed = this.stats.speed * this.speedMult();
    const wl = Math.hypot(c.moveX, c.moveZ);
    let wx = 0, wz = 0;
    if (wl > 0.001) { wx = (c.moveX / wl) * speed; wz = (c.moveZ / wl) * speed; }
    // blink dash: a hard directed burst that overrides normal footwork
    if (this.dashT > 0) {
      this.dashT = Math.max(0, this.dashT - dt);
      wx = this.dashDirX * DASH.speed; wz = this.dashDirZ * DASH.speed;
    }
    if (this.staggerT > 0 || this.freezeT > 0) { wx = 0; wz = 0; this.dashT = 0; } // staggered or petrified: no walking
    // broom flight: steer with WASD, Space climbs, Ctrl dives, pitch carries
    // you up/down while moving forward
    let flyY = 0;
    if (this.flying) {
      const moving = wl > 0.001;
      flyY = (c.jump ? 5 : 0) - (c.crouch ? 5 : 0) + (moving ? this.lookDir().y * speed * 0.9 : 0);
    }
    const ev = moveBody(g.world, this.body, {
      wx, wz, jump: !this.flying && c.jump && this.staggerT <= 0 && this.freezeT <= 0 && this.snareT <= 0, crouch: c.crouch && !this.flying,
      climbF: c.climbF, pitch: this.pitch, fly: this.flying, flyY,
    }, dt);
    this.horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (ev.landed > 3) g.audio.play('land', { pos: this.pos, vol: clamp(ev.landed / 9, 0.2, 1) });

    // footsteps (crouching or walking is silent — bots can't hear you)
    if (this.body.onGround && this.horizSpeed > 2) {
      this.footAcc += this.horizSpeed * dt;
      if (this.footAcc > 2.6) {
        this.footAcc = 0;
        if (!this.crouching && !this.walking) {
          // Wormtail scurries on rat-soft feet: no audible step, no bot ping
          if (this.charId !== 'wormtail') {
            g.audio.play('footstep', { pos: this.pos, vol: 0.45 });
            g.noise(this, 9);
          }
        }
        if (this.burnT > 0) {
          // burning footprints
          g.particles.decal(this.pos.clone().add(new THREE.Vector3(0, 0.03, 0)), new THREE.Vector3(0, 1, 0), 0.32, 0x180b03, 7);
          g.particles.puff('flame', {
            pos: this.pos.clone().add(new THREE.Vector3(0, 0.12, 0)), vel: new THREE.Vector3(0, 0.8, 0),
            life: 0.5, size0: 0.35, size1: 0.1, color: 0xff8030, alpha0: 0.85, alpha1: 0, additive: true,
          });
        }
      }
    }

    // eye smoothing
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eyeSmooth = damp(this.eyeSmooth, targetEye, 18, dt);

    // casting (a petrified body can do neither)
    g.spells.updateShield(this, c.altHeld && !c.castHeld && this.freezeT <= 0 && this.silenceT <= 0, dt);
    g.spells.handleCastInput(this, c.castHeld && this.freezeT <= 0 && this.silenceT <= 0, dt);
    this.ensureValidSpell();

    // rigs
    this.rig?.update(dt, this);
    if (this.isHuman) this.fp?.update(dt, this);
  }

  onCastAnim(spell) {
    this.fp?.playCast(spell);
    if (this.rig) this.rig.castT = 1;
  }

  spawnAt(x, z, yaw, world) {
    const y = world.floorY(x, z, 30);
    this.pos.set(x, y + 0.05, z);
    this.spawnPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.body.height = STAND_H;
    this.body.onGround = true;
    this.alive = true;
    this.health = this.stats.hp;
    this.mana = this.stats.mana;
    this.charge = null; this.shielding = false; this.recharging = 0;
    this.disarmT = 0; this.blindT = 0; this.slowT = 0;
    this.snareT = 0; this.silenceT = 0;
    this.bleeds.length = 0;
    this.burnT = 0; this.staggerT = 0; this.freezeT = 0; this.lastHit = null;
    this.feralT = 0; this.taggedT = 0; this.taggedBy = null;
    if (this.wandProp) this.game.effects.removeWandDrop(this.wandProp, false);
    this.healT = 0; this.broomT = 0; this.cloakT = 0;
    this.bloom = 0; this.punchPitch = 0; this.punchYaw = 0;
    this.spawnProtT = 0;
    this.dashCD = 0; this.dashT = 0; this.dashIframeT = 0; this.parryBuffT = 0;
    this.flying = false; this.portkeyT = 0; this.walking = false;
    if (this.equip.vest > 0 && this.vestHP <= 0) this.vestHP = EQUIP_EFFECTS.vest.pool; // fresh vest charges on spawn
    this.hasRelic = false;
    this.deathInfo = null;
    this.hitLog.clear();
    this.curSpell = this.slot1();
    this.nextCastAt = 0;
    this.footAcc = 0;
    if (this.rig) {
      this.rig.group.visible = true;
      this.rig.setDead(false);
    }
  }
}

// ------------------------------------------------------------------ rigs ---
const SKIN = 0xd9b08c;
const PALE = 0xe8e4da;
const STONE = new THREE.Color(0x9aa6b2);

// subtle per-champion robe shading applied as an HSL shift on the TEAM color,
// so a borrowed template (e.g. Ginny on the Bellatrix stat block) still reads
// as the right team at a glance
const ROBE_SHIFT = {
  harry: [0, 0, 0], hermione: [0.012, 0.04, 0.015], ron: [-0.015, 0.06, -0.012], luna: [0.035, 0, 0.012],
  snape: [0, -0.25, -0.02], bellatrix: [0.03, -0.08, -0.012], voldemort: [-0.04, -0.18, -0.015], draco: [0.05, -0.12, 0.015],
  dumbledore: [0.06, 0.1, 0.04], mcgonagall: [-0.06, 0.08, -0.01], ginny: [0.02, 0.08, 0.01], neville: [-0.02, 0.03, -0.005],
  lucius: [0, -0.3, 0.02], greyback: [-0.03, -0.15, -0.025], umbridge: [0.09, 0.05, 0.03], wormtail: [0.01, -0.2, -0.01],
};
function robeColorFor(charId, teamRobe) {
  const c = new THREE.Color(teamRobe);
  const s = ROBE_SHIFT[charId];
  if (s) c.offsetHSL(s[0], s[1], s[2]);
  return c;
}
// per-champion body proportions: [width, height]
const BODY_VAR = {
  harry: [1, 1], hermione: [0.94, 0.99], ron: [1.12, 1.02], luna: [0.95, 1],
  snape: [0.97, 1.03], bellatrix: [0.9, 1], voldemort: [0.95, 1.06], draco: [0.96, 1],
  dumbledore: [1.0, 1.07], mcgonagall: [0.92, 1.04], ginny: [0.9, 0.98], neville: [1.14, 1.0],
  lucius: [0.96, 1.05], greyback: [1.2, 1.04], umbridge: [1.1, 0.9], wormtail: [0.98, 0.92],
};

let GLOW_TEX = null;
function glowTex() {
  if (!GLOW_TEX) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    GLOW_TEX = new THREE.CanvasTexture(c);
  }
  return GLOW_TEX;
}

function sigilTexture(team) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = g.fillStyle = team === 'order' ? '#ffb347' : '#49e07d';
  g.lineWidth = 4;
  g.lineCap = 'round';
  if (team === 'order') {
    // phoenix flame
    g.beginPath();
    g.moveTo(32, 8); g.quadraticCurveTo(46, 26, 38, 40); g.quadraticCurveTo(50, 38, 48, 52);
    g.moveTo(32, 8); g.quadraticCurveTo(18, 26, 26, 40); g.quadraticCurveTo(14, 38, 16, 52);
    g.moveTo(32, 16); g.quadraticCurveTo(36, 34, 32, 54); g.stroke();
  } else {
    // dark mark skull
    g.beginPath(); g.arc(32, 26, 14, 0, Math.PI * 2); g.fill();
    g.fillRect(26, 36, 12, 10);
    g.fillStyle = '#10131a';
    g.beginPath(); g.arc(27, 24, 3.4, 0, Math.PI * 2); g.arc(37, 24, 3.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = g.fillStyle = team === 'order' ? '#ffb347' : '#49e07d';
    g.beginPath(); g.moveTo(20, 46); g.quadraticCurveTo(32, 58, 44, 46); g.stroke(); // serpent
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Rig {
  constructor(scene, player) {
    const team = TEAM_INFO[player.team];
    const skin = player.char.skin || {};
    const charId = player.char.id;
    const robeC = robeColorFor(charId, team.robe);
    const [bw, bh] = BODY_VAR[charId] ?? [1, 1];
    const g = new THREE.Group();
    this.mats = [];
    const mat = (color) => {
      const m = new THREE.MeshLambertMaterial({ color });
      this.mats.push(m);
      return m;
    };
    // body subgroup so proportions scale without touching nameplate/blob
    const body = new THREE.Group();
    body.scale.set(bw, bh, bw);
    g.add(body);

    // robe — lathe-turned: flared hem, cinched waist, broad shoulders rolling
    // off into a real neck. ROBE_PTS is [radius, y] bottom→top.
    const ROBE_PTS = [
      [0.44, 0.02], [0.43, 0.06], [0.38, 0.22], [0.33, 0.42], [0.295, 0.62],
      [0.275, 0.80], [0.265, 0.95], [0.27, 1.10], [0.275, 1.25], [0.265, 1.38],
      [0.235, 1.47], [0.18, 1.525], [0.10, 1.555], [0, 1.565],
    ];
    // robe surface radius at height y — decorations sit just proud of this
    const robeR = (y) => {
      for (let i = 1; i < ROBE_PTS.length; i++) {
        if (y <= ROBE_PTS[i][1]) {
          const [r0, y0] = ROBE_PTS[i - 1], [r1, y1] = ROBE_PTS[i];
          return lerp(r0, r1, (y - y0) / (y1 - y0));
        }
      }
      return 0;
    };
    const frontZ = (y, pad = 0.012) => -(robeR(y) + pad);
    const robe = new THREE.Mesh(
      new THREE.LatheGeometry(ROBE_PTS.map(([x, y]) => new THREE.Vector2(x, y)), 16),
      mat(robeC)
    );
    body.add(robe);
    // hem shadow band — grounds the silhouette
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.435, 0.445, 0.05, 16, 1, true), mat(new THREE.Color(robeC).multiplyScalar(0.55)));
    hem.position.y = 0.045;
    body.add(hem);
    const accent = skin.accent ?? team.trim; // house/personal trim color
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.295, 0.085, 16), mat(accent));
    belt.position.y = 0.97;
    body.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.055, 0.02), mat(0xc8a44a));
    buckle.position.set(0, 0.97, -0.297);
    body.add(buckle);
    // front placket: a darker strip down the robe front
    const placket = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.42, 0.016), mat(new THREE.Color(robeC).multiplyScalar(0.7)));
    placket.position.set(0, 1.17, frontZ(1.17));
    placket.rotation.x = 0.04;
    body.add(placket);
    // team sigil on the chest
    const sigil = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.2),
      new THREE.MeshBasicMaterial({ map: sigilTexture(player.team), transparent: true, depthWrite: false })
    );
    sigil.position.set(0, 1.32, frontZ(1.32, 0.014));
    sigil.rotation.y = Math.PI;
    body.add(sigil);
    this.sigil = sigil;
    // rounded epaulettes bridging the shoulder roll and the arm
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(accent));
      pad.position.set(side * 0.275, 1.49, 0);
      pad.rotation.z = side * -0.35;
      pad.scale.set(1.05, 0.85, 1.15);
      body.add(pad);
    }

    // head — higher-poly sphere, slightly oval, on a real neck
    const headC = skin.pale ? PALE : SKIN;
    const skinM = mat(headC);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.1, 10), skinM);
    neck.position.y = 1.555;
    body.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), skinM);
    head.position.y = 1.62;
    head.scale.set(0.94, 1.04, 0.97);
    body.add(head);
    // ears
    if (!skin.mane) {
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), skinM);
        ear.position.set(side * 0.158, 1.625, -0.01);
        ear.scale.set(0.55, 1, 0.8);
        body.add(ear);
      }
    }
    // nose — Voldemort's stays flat (he has slits instead)
    if (!skin.noseSlits) {
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), skinM);
      nose.position.set(0, 1.615, -0.165);
      nose.scale.set(0.8, 1.1, 1.05);
      body.add(nose);
    }
    // eyes — whites + iris; Voldemort gets red slits
    const eyeC = skin.slits ? 0xd02020 : 0x14100c;
    for (const side of [-1, 1]) {
      if (!skin.slits) {
        const white = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), mat(0xf2efe8));
        white.position.set(side * 0.058, 1.647, -0.148);
        white.scale.set(1, 0.85, 0.55);
        body.add(white);
      }
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0155, 8, 6), mat(eyeC));
      eye.position.set(side * 0.058, 1.645, -0.162);
      if (skin.slits) eye.scale.set(0.6, 1.5, 0.5);
      body.add(eye);
      // brow line
      if (!skin.slits) {
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 0.014), mat(skin.hair ?? 0x4a3826));
        brow.position.set(side * 0.058, 1.685, -0.152);
        brow.rotation.z = side * -0.12;
        body.add(brow);
      }
    }
    // hair variants give each champion a silhouette
    if (skin.hair !== null && skin.hair !== undefined) {
      const hairM = mat(skin.hair);
      if (skin.bushy) {
        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), hairM);
        hair.position.set(0, 1.68, 0.04);
        hair.scale.set(1.25, 1.05, 1.25);
        body.add(hair);
      } else if (skin.wild) {
        for (let i = 0; i < 4; i++) {
          const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), hairM);
          tuft.position.set(Math.sin(i * 2.2) * 0.12, 1.7 + (i % 2) * 0.06, 0.05 + Math.cos(i * 1.7) * 0.1);
          body.add(tuft);
        }
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hairM);
        crown.position.y = 1.66;
        body.add(crown);
      } else if (skin.long) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
        cap.position.y = 1.65;
        body.add(cap);
        const fall = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.08), hairM);
        fall.position.set(0, 1.42, 0.16);
        body.add(fall);
      } else if (skin.curtains) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM);
        cap.position.y = 1.63;
        body.add(cap);
        for (const side of [-1, 1]) {
          const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.14), hairM);
          curtain.position.set(side * 0.15, 1.56, -0.04);
          body.add(curtain);
        }
      } else if (skin.slick) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.178, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM);
        cap.position.y = 1.64;
        cap.scale.set(1, 0.7, 1);
        body.add(cap);
      } else if (skin.bun) { // severe bun pulled tight at the crown
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.176, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
        cap.position.y = 1.64;
        body.add(cap);
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), hairM);
        bun.position.set(0, 1.76, 0.12);
        body.add(bun);
      } else if (skin.pony) { // quidditch ponytail, swinging high
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.176, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
        cap.position.y = 1.65;
        body.add(cap);
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.018, 0.34, 10), hairM);
        tail.position.set(0, 1.6, 0.2);
        tail.rotation.x = 0.55;
        body.add(tail);
      } else if (skin.mane) { // shaggy werewolf mane swallowing the head
        for (let i = 0; i < 6; i++) {
          const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), hairM);
          const a = (i / 6) * Math.PI * 2;
          tuft.position.set(Math.sin(a) * 0.13, 1.64 + ((i % 3) - 1) * 0.05, Math.cos(a) * 0.13 + 0.03);
          body.add(tuft);
        }
        for (const side of [-1, 1]) { // sideburns down the jaw
          const burn = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), hairM);
          burn.position.set(side * 0.15, 1.55, -0.04);
          body.add(burn);
        }
      } else if (skin.curls) { // a helmet of tight, smug curls
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.185, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
        cap.position.y = 1.63;
        cap.scale.set(1.1, 0.95, 1.1);
        body.add(cap);
        for (const [cx, cy, cz] of [[-0.09, 1.71, -0.1], [0.09, 1.71, -0.1], [0, 1.74, -0.12]]) {
          const curl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), hairM);
          curl.position.set(cx, cy, cz);
          body.add(curl);
        }
      } else if (skin.balding) { // a thin ring of hair clinging on
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.165, 0.07, 16, 1, true), hairM);
        ring.position.y = 1.62;
        body.add(ring);
      } else {
        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
        hair.position.y = 1.65;
        body.add(hair);
      }
    }
    if (skin.glasses) { // round wire rims
      const rimM = mat(0x16181c);
      for (const side of [-1, 1]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.008, 8, 18), rimM);
        rim.position.set(side * 0.058, 1.642, -0.152);
        body.add(rim);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.12), rimM);
        arm.position.set(side * 0.125, 1.648, -0.085);
        arm.rotation.y = side * 0.45;
        body.add(arm);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.011, 0.012), rimM);
      bridge.position.set(0, 1.648, -0.158);
      body.add(bridge);
    }
    // ---- champion signatures: the silhouette tells you who you're fighting ----
    if (skin.messy) { // unruly tufts poking out of the hairline
      for (const [tx, ty, tz] of [[-0.1, 1.74, 0.06], [0.09, 1.76, -0.02], [0.02, 1.77, 0.1]]) {
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(skin.hair));
        tuft.position.set(tx, ty, tz);
        body.add(tuft);
      }
    }
    if (skin.scar) { // the lightning bolt
      const scar = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.06, 0.012), mat(0xb05438));
      scar.position.set(0.055, 1.705, -0.145);
      scar.rotation.set(-0.35, 0, 0.5);
      body.add(scar);
    }
    if (skin.scarf) { // striped scarf wound round the neck, tail down the front
      skin.scarf.forEach((c, i) => {
        const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.105 + i * 0.02, 0.125 + i * 0.02, 0.055, 14), mat(c));
        wrap.position.y = 1.585 - i * 0.05;
        body.add(wrap);
      });
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.025), mat(skin.scarf[0]));
      tail.position.set(0.1, 1.38, frontZ(1.42));
      tail.rotation.z = -0.08;
      tail.rotation.x = -0.1;
      body.add(tail);
      const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.02), mat(skin.scarf[1] ?? skin.scarf[0]));
      fringe.position.set(0.125, 1.215, frontZ(1.26));
      fringe.rotation.z = -0.08;
      body.add(fringe);
    }
    if (skin.satchel) { // book bag on the hip, strap across the chest
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.19, 0.08), mat(0x5a3c22));
      bag.position.set(-0.3, 1.0, 0.06);
      bag.rotation.y = 0.15;
      body.add(bag);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.014), mat(0x4a3019));
      strap.position.set(-0.07, 1.33, -0.282);
      strap.rotation.z = 0.5;
      body.add(strap);
    }
    if (skin.timeTurner) { // tiny golden hourglass pendant on a chain
      const goldM = mat(0xd6b25a);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.009, 8, 18), goldM);
      ring.position.set(0, 1.42, frontZ(1.42, 0.018));
      body.add(ring);
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.034, 8), goldM);
      glass.position.set(0, 1.42, frontZ(1.42, 0.018));
      body.add(glass);
      for (const side of [-1, 1]) { // chain up to the neck
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6), goldM);
        chain.position.set(side * 0.045, 1.5, frontZ(1.5, 0.012));
        chain.rotation.z = side * 0.45;
        chain.rotation.x = -0.22;
        body.add(chain);
      }
    }
    if (skin.patch) { // hand-me-down robes, lovingly mended
      const patch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.014), mat(0x7a5b33));
      patch.position.set(0.11, 0.78, -0.33);
      patch.rotation.set(0.18, 0, 0.3);
      body.add(patch);
    }
    if (skin.spectrespecs) { // pink-and-blue swirl goggles
      const colors = [0xd886c8, 0x7ab8d8];
      [-1, 1].forEach((side, i) => {
        const lens = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.013, 8, 18), mat(colors[i]));
        lens.position.set(side * 0.058, 1.64, -0.155);
        body.add(lens);
      });
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.014), mat(0xd886c8));
      bridge.position.set(0, 1.645, -0.16);
      body.add(bridge);
    }
    if (skin.radish) { // dirigible plum earrings
      for (const side of [-1, 1]) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.045, 4), mat(0x9aa86a));
        stem.position.set(side * 0.165, 1.585, -0.02);
        body.add(stem);
        const plum = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mat(0xd86038));
        plum.position.set(side * 0.165, 1.553, -0.02);
        body.add(plum);
      }
    }
    if (skin.collar) { // severe high collar hugging the neck to the chin
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.128, 0.13, 14), mat(skin.accent ?? 0x14181c));
      col.position.y = 1.56;
      body.add(col);
    }
    if (skin.buttons) { // a column of tiny buttons down the front
      for (let i = 0; i < 4; i++) {
        const by = 1.44 - i * 0.1;
        const btn = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), mat(0x202024));
        btn.position.set(0, by, frontZ(by, 0.008));
        body.add(btn);
      }
    }
    if (skin.corset) { // black bodice with crossed lacing
      const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.262, 0.292, 0.32, 16), mat(0x17101e));
      bodice.position.y = 1.22;
      body.add(bodice);
      for (const dir of [-1, 1]) {
        const lace = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.3, 0.012), mat(0x6a5a7a));
        lace.position.set(0, 1.22, -0.295);
        lace.rotation.z = dir * 0.65;
        body.add(lace);
      }
    }
    if (skin.locket) { // a stolen silver locket
      const lk = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), mat(0xb8bcc8));
      lk.position.set(0, 1.4, frontZ(1.4, 0.012));
      lk.scale.set(1, 1.25, 0.6);
      body.add(lk);
    }
    if (skin.noseSlits) { // serpentine slits where a nose should be
      for (const side of [-1, 1]) {
        const slit = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.028, 0.008), mat(0x6a4a4a));
        slit.position.set(side * 0.02, 1.612, -0.163);
        slit.rotation.z = side * -0.25;
        body.add(slit);
      }
    }
    if (skin.clasp) { // serpent brooch pinning the robe
      const cl = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.009, 8, 16), mat(0x3f8a4f));
      cl.position.set(0, 1.49, frontZ(1.49, 0.014));
      body.add(cl);
    }
    if (skin.badge) { // prefect badge, polished daily
      const bd = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.075, 0.012), mat(skin.accent ?? 0x1f4d33));
      bd.position.set(-0.1, 1.42, frontZ(1.42, 0.01));
      bd.rotation.x = 0.12;
      body.add(bd);
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.013), mat(0xc0c4cc));
      pin.position.set(-0.1, 1.42, frontZ(1.42, 0.016));
      body.add(pin);
    }
    if (skin.beard) { // the great silver beard, down past the belt
      const beardM = mat(skin.hair ?? 0xdfd9cf);
      // lathe profile: pointed at the bottom, full at the jaw — no open cone rim
      const beardPts = [
        [0, 0], [0.018, 0.04], [0.045, 0.12], [0.07, 0.24],
        [0.088, 0.36], [0.082, 0.46], [0.05, 0.53], [0, 0.56],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      const beard = new THREE.Mesh(new THREE.LatheGeometry(beardPts, 12), beardM);
      beard.position.set(0, 0.94, -0.15); // pointed tip at the belt…
      beard.scale.set(1.3, 1, 0.7); // …full jaw-width up top, tucked under the chin
      beard.rotation.z = 0.02;
      body.add(beard);
      // moustache: two swept halves under the nose, joining beard to face
      for (const side of [-1, 1]) {
        const mo = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.055, 3, 8), beardM);
        mo.position.set(side * 0.042, 1.572, -0.148);
        mo.rotation.z = Math.PI / 2 + side * 0.3;
        body.add(mo);
      }
    }
    if (skin.halfMoon) { // half-moon spectacles on a crooked nose
      for (const side of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 8, 16, Math.PI), mat(0xd6b25a));
        lens.position.set(side * 0.058, 1.635, -0.152);
        lens.rotation.z = Math.PI; // half-moon hangs low
        body.add(lens);
      }
    }
    if (skin.startrim) { // moons and stars stitched into the robe
      for (const [sx, sy] of [[-0.12, 0.7], [0.14, 0.52], [0.04, 0.92], [-0.16, 1.18]]) {
        const star = new THREE.Mesh(new THREE.SphereGeometry(0.016, 7, 5), mat(0xd6b25a));
        // pull in by the lateral offset so the stud sits on the curved surface
        const r = robeR(sy) + 0.01;
        star.position.set(sx, sy, -Math.sqrt(Math.max(0.001, r * r - sx * sx)));
        body.add(star);
      }
    }
    if (skin.squareGlasses) { // square spectacles, eyebrow permanently raised
      for (const side of [-1, 1]) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.055, 0.012), mat(0x2a2622));
        frame.position.set(side * 0.058, 1.64, -0.152);
        body.add(frame);
        const hole = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.034, 0.014), mat(SKIN));
        hole.position.set(side * 0.058, 1.64, -0.153);
        body.add(hole);
      }
    }
    if (skin.tartan) { // tartan sash over one shoulder
      const sash = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.62, 0.02), mat(0x1d5a3a));
      sash.position.set(0.06, 1.3, -0.282);
      sash.rotation.z = 0.55;
      body.add(sash);
      for (let i = 0; i < 3; i++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.03, 0.022), mat(0xb03434));
        stripe.position.set(0.2 - i * 0.14, 1.12 + i * 0.18, -0.283);
        stripe.rotation.z = 0.55;
        body.add(stripe);
      }
    }
    if (skin.pads) { // quidditch keeper pads strapped over the shoulders
      for (const side of [-1, 1]) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.2), mat(0x6b4a2a));
        pad.position.set(side * 0.3, 1.57, 0);
        pad.rotation.z = side * -0.18;
        body.add(pad);
      }
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.015), mat(0x3d2a16));
      strap.position.set(0, 1.47, -0.24);
      body.add(strap);
    }
    if (skin.sprig) { // a potted Mimbulus mimbletonia poking from the robe
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.05, 10), mat(0x8a5a33));
      pot.position.set(0.14, 1.06, -0.295);
      body.add(pot);
      for (const [ox, oy] of [[0, 0.05], [-0.025, 0.035], [0.025, 0.04]]) {
        const bud = new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 5), mat(0x4a7a3a));
        bud.position.set(0.14 + ox, 1.09 + oy, -0.295);
        body.add(bud);
      }
    }
    if (skin.cane) { // the serpent-headed walking cane (wand sheath inside)
      const cane = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.85, 10), mat(0x14110c));
      shaft.position.y = -0.42;
      cane.add(shaft);
      const headK = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0xcfd6da));
      headK.position.y = -0.02;
      headK.scale.set(1, 1.3, 1);
      cane.add(headK);
      cane.position.set(-0.08, 0.9, -0.1);
      this.caneProp = cane;
      body.add(cane);
    }
    if (skin.furTrim) { // fur-collared traveling cloak
      const fur = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.185, 0.12, 14), mat(0xb9b4a8));
      fur.position.y = 1.545;
      body.add(fur);
    }
    if (skin.fur) { // matted pelt across the shoulders
      for (const side of [-1, 1]) {
        const pelt = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0x5a4a36));
        pelt.position.set(side * 0.26, 1.55, 0.02);
        pelt.scale.set(1.2, 0.7, 1.2);
        body.add(pelt);
      }
    }
    if (skin.scarred) { // claw scars raked across the face
      for (let i = 0; i < 3; i++) {
        const scar = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.09, 0.01), mat(0xa05038));
        scar.position.set(-0.07 + i * 0.045, 1.63, -0.155);
        scar.rotation.z = 0.45;
        body.add(scar);
      }
    }
    if (skin.bow) { // the little black velvet bow
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mat(0x1c1418));
      knot.position.set(0, 1.79, 0.02);
      body.add(knot);
      for (const side of [-1, 1]) {
        const loop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.02), mat(0x1c1418));
        loop.position.set(side * 0.045, 1.79, 0.02);
        loop.rotation.z = side * 0.35;
        body.add(loop);
      }
    }
    if (skin.brooch) { // jeweled brooch at the cardigan collar
      const br = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), mat(0xe8c8e0));
      br.position.set(0, 1.45, frontZ(1.45, 0.012));
      br.scale.set(1, 1, 0.5);
      body.add(br);
    }
    if (skin.silverHand) { // Voldemort's gift — a hand of silver
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mat(0xc8ccd6));
      hand.position.set(0, -0.46, 0);
      hand.userData.silver = true;
      // attach after arms are built (see below)
      this.silverHandMesh = hand;
    }
    if (skin.hunched) body.rotation.x = 0.09; // the rat's cower
    // hat (Order) / hood (Death Eaters) — some silhouettes replace them
    if (skin.witchHat) { // McGonagall's tall emerald hat, crooked tip
      const hatM = mat(0x123c28);
      const hatPts = [
        [0.215, 0], [0.2, 0.04], [0.165, 0.13], [0.125, 0.24], [0.09, 0.34],
        [0.055, 0.43], [0.028, 0.5], [0.01, 0.54], [0, 0.56],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      const hat = new THREE.Mesh(new THREE.LatheGeometry(hatPts, 14), hatM);
      hat.position.set(0.02, 1.73, 0);
      hat.rotation.z = 0.2;
      body.add(hat);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), hatM);
      tip.position.set(-0.075, 2.27, 0);
      body.add(tip);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.295, 0.035, 18), hatM);
      brim.position.y = 1.755;
      body.add(brim);
      const bandH = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.213, 0.05, 14), mat(0x0c2a1c));
      bandH.position.set(0.012, 1.79, 0);
      bandH.rotation.z = 0.2;
      body.add(bandH);
    } else if (player.team === 'order') {
      if (!skin.pony && !skin.mane) { // bare heads for the athletes and beasts
        const hatPts = [
          [0.225, 0], [0.21, 0.035], [0.17, 0.11], [0.13, 0.2], [0.09, 0.29],
          [0.05, 0.36], [0.02, 0.41], [0, 0.43],
        ].map(([x, y]) => new THREE.Vector2(x, y));
        const hat = new THREE.Mesh(new THREE.LatheGeometry(hatPts, 14), mat(robeC));
        hat.position.y = 1.73;
        hat.rotation.z = 0.12;
        body.add(hat);
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.035, 18), mat(team.trim));
        brim.position.y = 1.75;
        body.add(brim);
      }
    } else if (!skin.pale && !skin.mane && !skin.curls && !skin.bow) { // no hood over Voldemort's skull, the mane, or the bow
      // draped hood: wide at the shoulders, gathered to a soft point behind the head
      const hoodPts = [
        [0.235, 0], [0.225, 0.06], [0.19, 0.14], [0.15, 0.22], [0.11, 0.29],
        [0.065, 0.34], [0.025, 0.37], [0, 0.38],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      const hood = new THREE.Mesh(new THREE.LatheGeometry(hoodPts, 14), mat(robeC));
      hood.position.y = 1.65;
      hood.rotation.x = -0.12; // tipped back off the brow
      body.add(hood);
    }

    // arms
    const wandCfg = skin.wand || { len: 0.48, color: 0x2e1d10 };
    this.armR = new THREE.Group();
    this.armR.position.set(0.3, 1.45, 0);
    // sleeve: tapered capsule that flares at the cuff, like a real robe sleeve
    const armRMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 4, 10), mat(robeC));
    armRMesh.position.y = -0.2;
    this.armR.add(armRMesh);
    const cuffR = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.092, 0.1, 12, 1, true), mat(new THREE.Color(robeC).multiplyScalar(0.78)));
    cuffR.position.y = -0.38;
    this.armR.add(cuffR);
    // casting hand wrapped around the wand grip
    const handC = skin.silverHand ? 0xc8ccd6 : (skin.pale ? PALE : SKIN);
    if (!this.silverHandMesh) {
      const handR = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), mat(handC));
      handR.scale.set(0.92, 1.05, 1.1);
      handR.position.set(0, -0.45, -0.02);
      this.armR.add(handR);
    }
    // flipped so the lathe's pointed end aims down the cast line
    const wand = makeWand(wandCfg, mat(wandCfg.color), wandCfg.grip ? mat(wandCfg.grip) : null, { radialSegs: 10 });
    wand.position.set(0, -0.46, -0.16);
    wand.rotation.x = Math.PI + Math.PI / 2.4;
    this.armR.add(wand);
    this.wand = wand;
    if (skin.ring) { // the Malfoy signet
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.009, 8, 16), mat(0xc8ccd4));
      ring.position.set(0, -0.4, 0);
      ring.rotation.x = Math.PI / 2;
      this.armR.add(ring);
    }
    if (this.silverHandMesh) this.armR.add(this.silverHandMesh); // Wormtail's silver hand
    if (skin.claws) { // yellowed claws hooking past the sleeve
      for (let i = 0; i < 3; i++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 5), mat(0xc8b890));
        claw.position.set(-0.03 + i * 0.03, -0.46, -0.04);
        claw.rotation.x = -Math.PI / 2.6;
        this.armR.add(claw);
      }
    }
    // charge glow at the wand tip: the whole lobby can see an Avada winding up
    this.chargeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex(), color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.chargeGlow.scale.setScalar(0.001);
    this.chargeGlow.position.set(0, -0.53, -0.4); // on the lathe wand's tip
    this.armR.add(this.chargeGlow);
    body.add(this.armR);

    this.armL = new THREE.Group();
    this.armL.position.set(-0.3, 1.45, 0);
    const armLMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 4, 10), mat(robeC));
    armLMesh.position.y = -0.2;
    this.armL.add(armLMesh);
    const cuffL = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.092, 0.1, 12, 1, true), mat(new THREE.Color(robeC).multiplyScalar(0.78)));
    cuffL.position.y = -0.38;
    this.armL.add(cuffL);
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(skin.pale ? PALE : SKIN));
    handL.scale.set(0.92, 1.1, 1);
    handL.position.y = -0.45;
    this.armL.add(handL);
    body.add(this.armL);

    // legs: trouser capsule + boot
    const mkLeg = (side) => {
      const grp = new THREE.Group();
      grp.position.set(side * 0.12, 0.5, 0);
      const trouser = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.32, 4, 10), mat(0x1a1410));
      trouser.position.y = -0.21;
      grp.add(trouser);
      const boot = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), mat(0x0e0a08));
      boot.scale.set(0.95, 0.55, 1.6);
      boot.position.set(0, -0.46, -0.035);
      grp.add(boot);
      body.add(grp);
      return grp;
    };
    this.legR = mkLeg(1);
    this.legL = mkLeg(-1);

    // relic carried on back
    this.relicMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: 0xa040ff }));
    this.relicMesh.scale.set(0.78, 1.15, 0.78); // matches the planted shard
    this.relicMesh.position.set(0, 1.25, 0.3);
    this.relicMesh.visible = false;
    g.add(this.relicMesh);

    // shadow blob
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    blob.renderOrder = 1;
    this.blob = blob;
    g.add(blob);

    // nameplate
    const cnv = document.createElement('canvas');
    cnv.width = 256; cnv.height = 48;
    const ctx = cnv.getContext('2d');
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = team.css;
    ctx.shadowColor = '#000'; ctx.shadowBlur = 5;
    ctx.fillText(player.name, 128, 24);
    const ntex = new THREE.CanvasTexture(cnv);
    ntex.colorSpace = THREE.SRGBColorSpace;
    const nmat = new THREE.SpriteMaterial({ map: ntex, transparent: true, depthTest: false });
    this.plate = new THREE.Sprite(nmat);
    this.plate.scale.set(1.5, 0.28, 1);
    this.plate.position.y = 2.15;
    this.plate.renderOrder = 9;
    g.add(this.plate);

    this.group = g;
    this.phase = 0;
    this.castT = 0;
    this.deadT = -1;
    this.corpse = null;
    this.flashT = 0; this.flashDur = 0.22;
    this.flashColor = new THREE.Color(0xffffff);
    this._emissiveOn = false;
    this.baseColors = this.mats.map((m) => m.color.clone());
    this._stoneOn = false;
    scene.add(g);
  }

  // brief emissive tint on every body part (on-hit feedback for spectators)
  flash(color, dur = 0.22) {
    this.flashColor.set(color);
    this.flashT = this.flashDur = dur;
  }

  applyFlash(dt) {
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = (this.flashT / this.flashDur) * 0.85;
      for (const m of this.mats) m.emissive.copy(this.flashColor).multiplyScalar(k);
      this._emissiveOn = true;
    } else if (this._emissiveOn) {
      for (const m of this.mats) m.emissive.setRGB(0, 0, 0);
      this._emissiveOn = false;
    }
  }

  setDead(dead) {
    this.deadT = dead ? 0 : -1;
    if (!dead) {
      this.corpse = null;
      this.group.rotation.set(0, 0, 0);
      this.group.position.y = 0;
      this.plate.visible = true;
    }
  }

  update(dt, p) {
    const g = this.group;
    if (this.deadT >= 0) {
      this.deadT += dt;
      this.applyFlash(dt);
      const c = this.corpse;
      if (c) {
        // rigid-body tumble: fly with the killing impulse, spin, land flat
        if (!c.landed) {
          c.vy -= 20 * dt;
          c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
          c.rotZ += c.spinZ * dt;
          c.rotY += c.spinY * dt;
          const gy = p.game.world.groundY(c.x, c.z, c.y + 1.0);
          if (c.y <= gy + 0.02 && c.vy <= 0) {
            c.y = gy + 0.02;
            c.vx *= 0.4; c.vz *= 0.4; c.vy = 0;
            if (Math.hypot(c.vx, c.vz) < 0.6) {
              c.landed = true;
              // settle flat at the nearest equivalent angle (no long unwinds)
              const flat = this.fallDir * Math.PI / 2;
              c.rotTarget = Math.round((c.rotZ - flat) / (Math.PI * 2)) * Math.PI * 2 + flat;
            }
          }
        } else {
          c.rotZ = damp(c.rotZ, c.rotTarget, 10, dt);
        }
        g.position.set(c.x, c.y + Math.min(0.12, this.deadT * 0.3), c.z);
        g.rotation.z = c.rotZ;
        g.rotation.y = c.rotY;
      } else {
        const t = Math.min(1, this.deadT / 0.45);
        g.rotation.z = this.fallDir * t * Math.PI / 2;
        g.position.y = p.pos.y + t * 0.12;
      }
      if (this.deadT > 6) g.visible = false;
      return;
    }
    g.position.set(p.pos.x, p.pos.y, p.pos.z);
    g.rotation.y = p.yaw + Math.PI; // model faces -z; flip so it faces look dir
    if (p.freezeT > 0) {
      // Full Body-Bind: limbs snap rigid like a toppled statue
      this.legR.rotation.x = 0;
      this.legL.rotation.x = 0;
      this.armL.rotation.x = -0.08;
      this.armR.rotation.x = -0.35;
    } else {
      const speedFrac = clamp(p.horizSpeed / 5.4, 0, 1.3);
      this.phase += p.horizSpeed * dt * 1.9;
      const sw = Math.sin(this.phase) * 0.55 * speedFrac;
      this.legR.rotation.x = sw;
      this.legL.rotation.x = -sw;
      this.armL.rotation.x = -sw * 0.6;
      this.castT = Math.max(0, this.castT - dt * 3.5);
      const aim = -p.pitch * 0.7 - 1.25 - this.castT * 0.9;
      this.armR.rotation.x = p.disarmT > 0 ? -0.2 : aim;
    }
    this.wand.visible = p.disarmT <= 0;
    // crouch: squash
    const squash = p.crouching ? 0.72 : 1;
    g.scale.y = damp(g.scale.y, squash, 14, dt);
    this.relicMesh.visible = p.hasRelic;
    if (p.hasRelic) this.relicMesh.rotation.y += dt * 3;
    // charge spell tell: glow swells at the wand tip
    if (p.charge) {
      const t = clamp(p.charge.t / p.charge.total, 0, 1);
      this.chargeGlow.material.color.set(SPELLS[p.curSpell]?.color ?? 0xffffff);
      this.chargeGlow.material.opacity = 0.45 + t * 0.5;
      this.chargeGlow.scale.setScalar(0.25 + t * 0.55 + Math.sin(p.game.time * 18) * 0.05 * t);
    } else if (this.chargeGlow.material.opacity > 0) {
      this.chargeGlow.material.opacity = Math.max(0, this.chargeGlow.material.opacity - dt * 6);
      if (this.chargeGlow.material.opacity <= 0) this.chargeGlow.scale.setScalar(0.001);
    }
    // on-hit body flash
    this.applyFlash(dt);
    // flinch + crucio writhe
    if (p.slowT > 0) {
      g.rotation.x = Math.sin(p.game.time * 26) * 0.09;
      g.rotation.z = Math.sin(p.game.time * 31) * 0.07;
    } else {
      g.rotation.x = p.flinchT > 0 ? Math.sin(p.flinchT * 40) * 0.05 : 0;
      g.rotation.z = 0;
    }
    // petrified: the whole body greys out to stone
    const stone = p.freezeT > 0;
    if (stone !== this._stoneOn) {
      this._stoneOn = stone;
      for (let i = 0; i < this.mats.length; i++) {
        this.mats[i].color.copy(this.baseColors[i]);
        if (stone) this.mats[i].color.lerp(STONE, 0.78);
      }
    }
    // cloak transparency
    const game = p.game;
    let op = 1;
    if (p.cloakT > 0) op = game.human && game.human.team === p.team ? 0.38 : 0.1;
    for (const m of this.mats) {
      m.transparent = op < 1;
      m.opacity = op;
    }
    this.sigil.material.opacity = op;
    this.sigil.material.transparent = true;
    this.plate.visible = game.human && game.human.team === p.team && !p.isHuman;
  }

  // impulse: optional {x,y,z dir, power} from the killing blow → rigid ragdoll
  die(p, impulse = null) {
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    this.setDead(true);
    this.plate.visible = false;
    if (impulse && impulse.power > 0.4) {
      const pw = impulse.power;
      this.corpse = {
        x: p.pos.x, y: p.pos.y, z: p.pos.z,
        vx: impulse.x * pw, vy: Math.max(1.2, impulse.y * pw * 0.5 + pw * 0.55), vz: impulse.z * pw,
        rotZ: 0, rotY: p.yaw + Math.PI, // keep facing at the moment of death
        spinZ: this.fallDir * (1.8 + pw * 0.55), spinY: (Math.random() - 0.5) * pw * 0.5,
        landed: false, rotTarget: this.fallDir * Math.PI / 2,
      };
    }
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}

// First-person wand rig (attached to camera).
export class FPRig {
  constructor(camera, char = null, team = null) {
    const skin = char?.skin || {};
    const wandCfg = skin.wand || { len: 0.5, color: 0x33220f };
    const fpLen = wandCfg.len * 1.25; // FP wands read better slightly long
    const robeC = robeColorFor(char?.id, TEAM_INFO[team || char?.side || 'order'].robe);
    const g = new THREE.Group();
    g.position.set(0.34, -0.34, -0.6);
    const wandMat = new THREE.MeshLambertMaterial({ color: wandCfg.color });
    const gripMat = new THREE.MeshLambertMaterial({ color: wandCfg.grip ?? 0x1c1208 });
    this.wand = new THREE.Group();
    // lathe-turned wand: pommel bulb, ridged grip, carved collar, tapered shaft.
    // First-person is where the wand is scrutinized — full radial detail.
    const tiltX = -Math.PI / 2 + 0.18;
    const lathe = makeWand(wandCfg, wandMat, wandCfg.grip ? gripMat : null, { lengthScale: 1.25, radialSegs: 16, thick: 1.2 });
    lathe.rotation.x = tiltX;
    lathe.position.set(0, 0.02, -0.2);
    this.wand.add(lathe);
    // glowing tip sits exactly on the lathe's point
    const hl = fpLen / 2;
    const tipPos = new THREE.Vector3(0, 0.02 + Math.cos(tiltX) * hl, -0.2 + Math.sin(tiltX) * hl);
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff4455 }));
    this.tip.position.copy(tipPos);
    this.wand.add(this.tip);
    // charge halo around the tip
    this.tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex(), color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.tipGlow.position.copy(tipPos);
    this.tipGlow.scale.setScalar(0.001);
    this.wand.add(this.tipGlow);
    // hand is separate from the wand so it stays visible while disarmed:
    // a real fist — palm, knuckle row curled over the grip, thumb lock
    const handM = new THREE.MeshLambertMaterial({ color: skin.pale ? PALE : SKIN });
    this.hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 9), handM);
    palm.scale.set(1.1, 0.92, 1.3);
    this.hand.add(palm);
    for (let i = 0; i < 4; i++) { // knuckles wrapped across the top
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.011, 9, 7), handM);
      k.position.set(-0.024 + i * 0.016, 0.015, -0.03 - Math.abs(i - 1.5) * 0.004);
      this.hand.add(k);
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.014, 3, 8), handM);
      f.position.set(-0.024 + i * 0.016, 0.002, -0.038);
      f.rotation.x = 1.05; // first finger segment curling down over the grip
      this.hand.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.022, 3, 8), handM);
    thumb.position.set(-0.033, 0.008, 0.008);
    thumb.rotation.set(-0.7, 0.35, -0.85); // locked over the back of the grip
    this.hand.add(thumb);
    this.hand.position.set(0.004, -0.012, -0.055);
    this.hand.rotation.x = 0.18; // knuckles follow the wand's tilt
    g.add(this.hand);
    // robed forearm behind the fist: sleeve + flared cuff + lining
    const sleeveM = new THREE.MeshLambertMaterial({ color: robeC });
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.075, 0.34, 14), sleeveM);
    sleeve.rotation.x = -Math.PI / 2 + 0.55;
    sleeve.position.set(0.02, -0.1, 0.19);
    g.add(sleeve);
    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.068, 0.07, 14, 1, true),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(robeC).multiplyScalar(0.62) })
    );
    cuff.rotation.x = -Math.PI / 2 + 0.55;
    cuff.position.set(0.012, -0.024, 0.052);
    g.add(cuff);
    // angle the wand across the view so it reads as a wand, not a dot
    this.wand.rotation.set(0.1, -0.42, 0.08);
    g.add(this.wand);
    this.group = g;
    camera.add(g);
    this.anim = null;
    this.bobT = 0;
    this.panicT = 0;
    this.swayX = 0; this.swayY = 0;
  }

  playCast(spell) {
    this.anim = { type: spell.kind === 'lob' ? 'lob' : 'flick', t: 0, dur: spell.kind === 'lob' ? 0.45 : 0.22 };
  }

  onSwitch() { this.anim = { type: 'switch', t: 0, dur: 0.25 }; }
  onDisarm() { this.anim = null; this.panicT = 0; }
  onRecharge(dur) { this.anim = { type: 'recharge', t: 0, dur } }

  update(dt, p) {
    const g = this.group;
    const spell = SPELLS[p.curSpell];
    if (spell) this.tip.material.color.set(spell.color);

    // walk bob + idle sway
    this.bobT += dt * (4 + p.horizSpeed * 1.6);
    const speedFrac = clamp(p.horizSpeed / 5.4, 0, 1.2) * (p.body.onGround ? 1 : 0.2);
    const bobX = Math.sin(this.bobT) * 0.012 * speedFrac;
    const bobY = -Math.abs(Math.cos(this.bobT)) * 0.014 * speedFrac + Math.sin(this.bobT * 0.4) * 0.003;

    let px = 0.34 + bobX, py = -0.34 + bobY, pz = -0.6;
    let rx = 0, ry = 0, rz = Math.sin(this.bobT * 0.35) * 0.02;
    let scale = 1;

    if (p.charge) {
      const t = clamp(p.charge.t / p.charge.total, 0, 1);
      pz += t * 0.12;
      px -= t * 0.06;
      rx += t * 0.3;
      scale = 1 + t * 1.6;
      this.tip.material.color.lerp(new THREE.Color(0xffffff), t * 0.4);
      this.tipGlow.material.color.set(spell?.color ?? 0xffffff);
      this.tipGlow.material.opacity = 0.5 + t * 0.45;
      this.tipGlow.scale.setScalar(0.1 + t * 0.3);
    } else if (this.tipGlow.material.opacity > 0) {
      this.tipGlow.material.opacity = Math.max(0, this.tipGlow.material.opacity - dt * 8);
      if (this.tipGlow.material.opacity <= 0) this.tipGlow.scale.setScalar(0.001);
    }
    if (p.shielding) {
      px = 0.12; py = -0.26; pz = -0.5;
      rx = 0.5; ry = 0.7;
    }

    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const t = clamp(a.t / a.dur, 0, 1);
      const k = Math.sin(t * Math.PI);
      if (a.type === 'flick') { rx -= k * 0.55; py += k * 0.05; }
      else if (a.type === 'lob') { rx += k * 1.1; pz += k * 0.1; py += k * 0.12; }
      else if (a.type === 'switch') { py -= (1 - t) * 0.25; rz += (1 - t) * 0.4; }
      else if (a.type === 'recharge') { rz += t * Math.PI * 2 * 1; scale = 1 + k * 0.6; }
      if (t >= 1) this.anim = null;
    }

    // disarmed: wand is gone (it's on the floor) — frantic empty-hand search
    const disarmed = p.disarmT > 0;
    this.wand.visible = !disarmed;
    if (disarmed) {
      this.panicT += dt;
      const w = this.panicT;
      px = 0.3 + Math.sin(w * 13) * 0.07;
      py = -0.3 + Math.abs(Math.sin(w * 9)) * 0.07;
      pz = -0.52;
      rx = 0.35 + Math.sin(w * 11) * 0.25;
      rz = Math.sin(w * 7) * 0.35;
    }

    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz);
    this.tip.scale.setScalar(scale);
  }
}
