// Casting, projectiles, hit resolution, AoE effects, Protego shields.
import * as THREE from 'three';
import { SPELLS, HITZONES } from './data.js';
import { segVsSphere } from './world.js';
import { grand, DEG, clamp } from './utils.js';

const HEAD_R = 0.24;

export class SpellSystem {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this._castDir = new THREE.Vector3();
    this._fireDir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._origin = new THREE.Vector3();
  }

  // effective stats helpers ------------------------------------------------
  manaCost(p, spell) {
    let m = spell.mana * p.wand.manaMult;
    if (spell.slot === 3) m *= p.wand.hexMana ?? 1;
    if (p.char.id === 'harry' && spell.id === 'expelliarmus') m *= 0.6;
    if (p.char.id === 'voldemort' && spell.id === 'avada') m *= 0.85;
    return m;
  }

  castInterval(p, spell) {
    let iv = spell.interval / (p.stats.cast * p.wand.cast);
    if (p.char.id === 'harry' && spell.id === 'expelliarmus') iv *= 0.55;
    return iv;
  }

  chargeTime(p, spell) {
    let c = spell.charge / (p.stats.cast * p.wand.cast);
    if (p.char.id === 'voldemort' && spell.id === 'avada') c *= 0.72;
    return c;
  }

  canFire(p, spell) {
    if (!p.alive || p.disarmT > 0 || p.recharging || p.freezeT > 0 || p.silenceT > 0 || p.morphT > 0) return false;
    if (this.game.time < p.nextCastAt) return false;
    if (spell.charges && (p.charges[spell.id] || 0) <= 0) return false;
    if (p.mana < this.manaCost(p, spell)) return false;
    return true;
  }

  // main per-player cast input (held = LMB state)
  handleCastInput(p, held, dt) {
    const spell = SPELLS[p.curSpell];
    if (!spell) return;
    if (!p.alive || p.disarmT > 0 || p.recharging || p.shielding || p.morphT > 0) {
      this.cancelCharge(p);
      return;
    }
    if (spell.charge) {
      if (held) {
        if (!p.charge && this.canFire(p, spell)) {
          p.charge = { t: 0, total: this.chargeTime(p, spell) };
          p.chargeSound = this.game.audio.play('charge', { pos: p.pos, dur: p.charge.total });
        } else if (p.charge) {
          p.charge.t += dt;
          // green wisps spiral into the wand tip — a visible, audible tell
          if (Math.random() < 0.75) {
            this.game.effects.chargeFX(this.castOrigin(p), spell, clamp(p.charge.t / p.charge.total, 0, 1));
          }
        }
      } else if (p.charge) {
        if (p.charge.t >= p.charge.total) this.fire(p, spell);
        this.cancelCharge(p, p.charge.t >= p.charge.total);
      }
    } else if (held && this.canFire(p, spell)) {
      this.fire(p, spell);
    }
  }

  cancelCharge(p, fired = false) {
    if (p.charge) {
      p.charge = null;
      if (p.chargeSound && !fired) p.chargeSound.stop();
      p.chargeSound = null;
    }
  }

  castOrigin(p) {
    const dir = p.aimDirInto(this._castDir);
    const right = this._right.set(-dir.z, 0, dir.x).normalize();
    const cp = p.wand.castPoint || {};
    const origin = p.eyePosInto(this._origin)
      .addScaledVector(dir, cp.fwd ?? 0.5)
      .addScaledVector(right, cp.right ?? 0.16);
    origin.y += cp.up ?? -0.14;
    return origin;
  }

  spreadFor(p, spell) {
    const moveFrac = clamp(p.horizSpeed / 5.4, 0, 1.2);
    let deg = spell.spread[0] + spell.spread[1] * moveFrac;
    if (!p.body.onGround) deg += p.flying ? 3.2 : 2.4; // broom casting is wild
    deg += p.bloom; // recoil bloom from recent casts
    if (!p.isHuman && p.blindT > 0) {
      const flash = clamp(p.blindT / 0.8, 0, 1);
      deg += flash * (8 + p.blindT * 10); // flashed bots can panic-fire, but not accurately
    }
    if (p.crouching) deg *= 0.6;
    return deg * p.wand.spread * DEG;
  }

  fire(p, spell) {
    p.spawnProtT = 0; // deathmatch grace ends the instant you choose violence
    const cost = this.manaCost(p, spell);
    p.mana = Math.max(0, p.mana - cost);
    if (spell.charges) p.charges[spell.id]--;
    p.nextCastAt = this.game.time + this.castInterval(p, spell);
    p.breakCloak?.();

    // summons don't fly — they spawn at the caster's feet and hunt
    if (spell.kind === 'summon') {
      this.game.spawnSummon(p, spell);
      this.game.audio.play('snake_cast', { pos: p.pos, vol: 0.9 });
      p.onCastAnim?.(spell);
      this.game.noise(p, 14);
      return;
    }

    const dir = p.aimDirInto(this._fireDir); // punched view — bolts go where the crosshair points
    const spread = this.spreadFor(p, spell);
    if (spread > 0) {
      const right = this._right.set(-dir.z, 0, dir.x).normalize();
      const up = this._up.crossVectors(right, dir).normalize();
      dir.addScaledVector(right, grand() * spread).addScaledVector(up, grand() * spread).normalize();
    }
    const origin = this.castOrigin(p);

    const lob = spell.kind === 'lob';
    const speed = spell.speed * (spell.kind === 'bolt' ? (p.disc?.boltSpeed ?? 1) : 1);
    const vx = dir.x * speed;
    const vy = dir.y * speed + (lob ? 3.2 : 0);
    const vz = dir.z * speed;

    const fx = this.game.effects.acquireBolt(spell);
    fx.group.position.copy(origin);
    fx.group.lookAt(origin.x + vx, origin.y + vy, origin.z + vz);

    this.projectiles.push({
      x: origin.x, y: origin.y, z: origin.z,
      vx, vy, vz,
      spell, owner: p, life: 5, traveled: 0,
      gravity: lob ? 14 : 0, fx,
    });

    // recoil: spread blooms for everyone; the human's camera kicks with a
    // CS 1.6-style punch that decays — and bolts follow the punched view
    // (aimDir), so the spray climbs exactly like the crosshair does
    if (spell.bloom) p.bloom = Math.min(3.4, p.bloom + spell.bloom);
    if (spell.recoil && p.isHuman) {
      p.punchPitch = Math.min(0.22, p.punchPitch + spell.recoil * (0.8 + Math.random() * 0.4));
      p.punchYaw += (Math.random() - 0.5) * spell.recoil * 0.5;
    }

    // sfx + anims
    const sfxName = spell.kind === 'lob' ? 'throw' : (spell.id === 'avada' ? 'cast_avada' : spell.id === 'sectum' ? 'cast_sectum' : spell.id === 'expelliarmus' ? 'cast_expelliarmus' : 'cast_stupefy');
    this.game.audio.play(sfxName, { pos: origin, vol: p.isHuman ? 0.85 : 0.7 });
    this.game.effects.muzzle(origin, spell);
    p.onCastAnim?.(spell);
    if (p.isHuman) this.game.feedback.cast(spell); // camera push + bloom on heavy casts
    this.game.noise(p, 18); // bots can hear casts
    if (spell.id === 'avada') this.game.particles.flashLight(origin, spell.color, 25, 0.25, 14);
  }

  // Protego: hold RMB
  updateShield(p, holdingAlt, dt) {
    const spell = SPELLS.protego;
    const greaterGood = p.char.id === 'dumbledore' ? 0.65 : 1; // his shield barely sips
    const shieldMult = p.wand.manaMult * (p.disc?.drainMult ?? 1) * greaterGood;
    const startCost = (spell.activate ?? 0) * shieldMult;
    const want = holdingAlt && p.alive && p.disarmT <= 0 && !p.recharging && p.mana >= Math.max(1, startCost) && !p.charge;
    if (want && !p.shielding) {
      p.mana = Math.max(0, p.mana - startCost);
      p.shielding = true;
      p.shieldOnAt = this.game.time;
      p.shieldSound = this.game.audio.play('shield', { pos: p.pos });
      this.game.effects.ensureShield(p);
    } else if (!want && p.shielding) {
      this.stopShield(p);
    }
    if (p.shielding) {
      p.mana -= spell.drain * shieldMult * dt;
      if (p.mana <= 0) {
        p.mana = 0;
        this.stopShield(p, true);
      }
    }
  }

  stopShield(p, broke = false) {
    if (!p.shielding) return;
    p.shielding = false;
    p.shieldSound?.stop();
    p.shieldSound = null;
    if (broke) this.game.audio.play('shield_break', { pos: p.pos });
  }

  // Spell-on-spell: opposing projectiles that cross paths CLASH — both bolts
  // annihilate in a flash. Avada Kedavra burns through lesser bolts. A bolt
  // striking an enemy lob (grenade) detonates it mid-air.
  clashPass(dt) {
    const game = this.game;
    const prs = this.projectiles;
    if (prs.length < 2) return;
    const dead = new Set();
    for (let i = 0; i < prs.length; i++) {
      const a = prs[i];
      if (dead.has(a)) continue;
      for (let j = i + 1; j < prs.length; j++) {
        const b = prs[j];
        if (dead.has(a)) break;
        if (dead.has(b)) continue;
        if (a.owner.team === b.owner.team) continue;
        // quick reject by reachable distance this frame
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const reach = (Math.hypot(a.vx, a.vy, a.vz) + Math.hypot(b.vx, b.vy, b.vz)) * dt + 1.0;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        // sample closest approach across the frame
        let minD2 = Infinity, minT = 0;
        for (let s = 0; s <= 4; s++) {
          const t = (s / 4) * dt;
          const px = (a.x + a.vx * t) - (b.x + b.vx * t);
          const py = (a.y + a.vy * t) - (b.y + b.vy * t);
          const pz = (a.z + a.vz * t) - (b.z + b.vz * t);
          const dd = px * px + py * py + pz * pz;
          if (dd < minD2) { minD2 = dd; minT = t; }
        }
        if (minD2 > 0.55 * 0.55) continue;
        const mid = new THREE.Vector3(
          (a.x + a.vx * minT + b.x + b.vx * minT) / 2,
          (a.y + a.vy * minT + b.y + b.vy * minT) / 2,
          (a.z + a.vz * minT + b.z + b.vz * minT) / 2,
        );
        game.effects.clashFX(mid, a.spell, b.spell);
        game.audio.play('clash', { pos: mid, vol: 1 });
        const aAvada = a.spell.id === 'avada', bAvada = b.spell.id === 'avada';
        const dies = (pr) => {
          if (pr.spell.kind === 'lob') this.detonate(pr, mid, null); // shot out of the sky
          dead.add(pr);
        };
        if (aAvada && !bAvada) dies(b);        // the Killing Curse burns through
        else if (bAvada && !aAvada) dies(a);
        else { dies(a); dies(b); }
        if (a.owner.isHuman || b.owner.isHuman) game.hud.notice('SPELLS CLASH!', 'info');
      }
    }
    if (dead.size) {
      for (let i = prs.length - 1; i >= 0; i--) if (dead.has(prs[i])) this.kill(prs[i], i);
    }
  }

  update(dt) {
    const game = this.game;
    const world = game.world;
    this.clashPass(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      if (pr.life <= 0) { this.kill(pr, i); continue; }
      const ax = pr.x, ay = pr.y, az = pr.z;
      pr.vy -= pr.gravity * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      const bx = pr.x, by = pr.y, bz = pr.z;
      const segLen = Math.hypot(bx - ax, by - ay, bz - az);
      pr.traveled += segLen;

      let bestT = 2, hitKind = null, hitPlayer = null, hitZone = 'chest', hitNormal = null, hitWard = null, hitBox = null, hitEnv = null;

      // world
      const wh = world.raycast(ax, ay, az, bx - ax, by - ay, bz - az, 1);
      if (wh) { bestT = wh.t; hitKind = 'world'; hitNormal = new THREE.Vector3(wh.nx, wh.ny, wh.nz); hitBox = wh.box; }

      // environment set pieces: the dragon, the snitch, bells
      if (game.env) {
        const eh = game.env.segHit(ax, ay, az, bx, by, bz, bestT);
        if (eh) { bestT = eh.t; hitKind = 'env'; hitEnv = eh; hitPlayer = null; }
      }

      // patronus wards stop enemy magic cold
      for (const w of game.effects.wards) {
        if (w.team === pr.owner.team) continue;
        const t = segVsWard(ax, ay, az, bx, by, bz, w);
        if (t >= 0 && t < bestT) {
          bestT = t; hitKind = 'ward'; hitWard = w; hitPlayer = null;
          hitNormal = new THREE.Vector3(w.nx, 0, w.nz);
        }
      }

      // conjured serpents are valid targets — shoot the snake before it reaches you
      let hitSummon = null;
      for (const s of game.summons) {
        if (s.team === pr.owner.team || s.hp <= 0) continue;
        const t = segVsSphere(ax, ay, az, bx, by, bz, s.x, s.y + 0.22, s.z, 0.42);
        if (t >= 0 && t < bestT) {
          bestT = t; hitKind = 'summon'; hitSummon = s; hitPlayer = null;
        }
      }

      // players & shields
      for (const v of game.players) {
        if (!v.alive) continue;
        // shields only stop ENEMY bolts — friendly fire passes through, same
        // as bodies, so a teammate's Protego no longer eats your cast
        if (v.shielding && v.team !== pr.owner.team) {
          const c = v.eyePos();
          const t = segVsSphere(ax, ay, az, bx, by, bz, c.x, c.y - 0.25, c.z, 1.1);
          if (t >= 0 && t < bestT) {
            bestT = t; hitKind = 'shield'; hitPlayer = v; hitZone = 'chest';
          }
        }
        if (v === pr.owner || v.team === pr.owner.team) continue;
        // head sphere first — it pokes above the body box
        const hc = v.eyePos();
        const th = segVsSphere(ax, ay, az, bx, by, bz, hc.x, hc.y + 0.1, hc.z, HEAD_R);
        if (th >= 0 && th < bestT) {
          bestT = th; hitKind = 'player'; hitPlayer = v; hitZone = 'head';
        }
        // body box, resolved into chest / stomach / arm / leg by hit location
        const tb = segAABB(ax, ay, az, bx, by, bz, v);
        if (tb >= 0 && tb < bestT - 1e-4) {
          bestT = tb; hitKind = 'player'; hitPlayer = v;
          hitZone = zoneFor(v, ax + (bx - ax) * tb, ay + (by - ay) * tb, az + (bz - az) * tb);
          // the head sphere sits inside the box top: a bolt that threads it
          // through the upper band is a headshot even though the box face is hit first
          if (th >= 0 && (hitZone === 'chest' || hitZone === 'arm')) hitZone = 'head';
        }
      }

      if (!hitKind) {
        pr.fx.group.position.set(pr.x, pr.y, pr.z);
        pr.fx.group.lookAt(pr.x + pr.vx, pr.y + pr.vy, pr.z + pr.vz);
        if (pr.fx.ring.visible) pr.fx.ring.rotation.z += dt * 13;
        if (pr.fx.orbit?.visible) pr.fx.orbit.rotation.z -= dt * 11; // motes corkscrew
        game.effects.trailTick(pr.fx.group.position, pr.spell, dt);
        // first dip into water: a splash, then the bolt fizzes on
        if (!pr.splashed) {
          const wtr = world.waterAt(pr.x, pr.y, pr.z);
          if (wtr) {
            pr.splashed = true;
            game.effects.steamFX(new THREE.Vector3(pr.x, wtr.y + 0.05, pr.z), 0.5);
          }
        }
        continue;
      }

      const hx = ax + (bx - ax) * bestT, hy = ay + (by - ay) * bestT, hz = az + (bz - az) * bestT;
      const hitPos = new THREE.Vector3(hx, hy, hz);

      if (hitKind === 'shield') {
        const sp = pr.spell;
        const incomingDir = new THREE.Vector3(pr.vx, pr.vy, pr.vz).normalize();
        // PERFECT PARRY: shield raised at the last instant reflects the bolt at its
        // caster. Bots only get the reflect on a deliberate parry read — their
        // reflex blocks shouldn't accidentally fall inside the timing window.
        const parryWin = SPELLS.protego.parry * (hitPlayer.char.id === 'dumbledore' ? 1.35 : 1) +
          (hitPlayer.disc?.parryBonus ?? 0);
        const perfect = sp.kind === 'bolt' &&
          game.time - hitPlayer.shieldOnAt <= parryWin &&
          pr.owner.team !== hitPlayer.team &&
          (!hitPlayer.bot || hitPlayer.bot.parryIntent);
        if (perfect) {
          const caster = pr.owner;
          const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
          const back = caster.alive
            ? new THREE.Vector3(caster.pos.x, caster.pos.y + caster.body.height * 0.55, caster.pos.z).sub(hitPos).normalize()
            : new THREE.Vector3(-pr.vx, -pr.vy, -pr.vz).normalize();
          pr.owner = hitPlayer; // the reflected curse now belongs to the parrier
          pr.reflected = true;  // ...and it comes back angrier
          pr.vx = back.x * speed; pr.vy = back.y * speed; pr.vz = back.z * speed;
          pr.x = hitPos.x + back.x * 1.3; pr.y = hitPos.y + back.y * 1.3; pr.z = hitPos.z + back.z * 1.3;
          pr.traveled = 0; pr.life = 5;
          pr.fx.group.position.set(pr.x, pr.y, pr.z);
          hitPlayer.onParryAnim();
          game.effects.parryFX(hitPos, hitPlayer, incomingDir);
          game.audio.play('parry', { pos: hitPos, vol: 1 });
          // reward the read: refund mana, grant a brief flow surge, make it cinematic
          hitPlayer.mana = Math.min(hitPlayer.stats.mana, hitPlayer.mana + 25);
          hitPlayer.parryBuffT = 2.0;
          if (hitPlayer.isHuman || caster.isHuman) { game.hitstop(0.05); game.slowmo(0.5, 0.35); game.feedback.bloomPulse(0.6); }
          if (hitPlayer.isHuman) game.hud.notice('PERFECT PARRY — curse reflected!', 'good');
          continue; // projectile lives on, flying back
        }
        // The Killing Curse ignores a late Protego. Only the perfect parry above
        // can turn it away.
        if (sp.id === 'avada') {
          this.stopShield(hitPlayer, true);
          this.boltHit(pr, hitPlayer, 'chest', hitPos);
          this.kill(pr, i);
          continue;
        }
        // a held Protego is the answer to rapid bolts, and a blast leans on it hard
        const drain = (sp.kind === 'lob' ? 42 : sp.dmg * SPELLS.protego.drainHit) * hitPlayer.wand.manaMult * (hitPlayer.disc?.drainMult ?? 1);
        hitPlayer.mana -= Math.min(60, drain);
        const boltDir = incomingDir;
        game.effects.shieldHit(hitPlayer, hitPos, boltDir);
        // blocked hits shove the shield-bearer back a touch
        hitPlayer.vel.x += boltDir.x * (sp.kind === 'lob' ? 2.0 : 1.0);
        hitPlayer.vel.z += boltDir.z * (sp.kind === 'lob' ? 2.0 : 1.0);
        if (hitPlayer.mana <= 0) { hitPlayer.mana = 0; this.stopShield(hitPlayer, true); }
        if (pr.spell.kind === 'lob') this.detonate(pr, hitPos, null);
        this.kill(pr, i);
        continue;
      }

      if (hitKind === 'ward') {
        game.effects.wardBlockFX(hitPos, hitWard, pr.spell);
        game.audio.play('ward_block', { pos: hitPos, vol: 0.8 });
        if (pr.spell.kind === 'lob') this.detonate(pr, hitPos, hitNormal);
        this.kill(pr, i);
        continue;
      }

      if (hitKind === 'summon') {
        hitSummon.hp -= pr.spell.dmg >= 200 ? 999 : Math.max(10, pr.spell.dmg);
        game.effects.impact(hitPos, new THREE.Vector3(0, 1, 0), pr.spell, false);
        if (pr.owner.isHuman) game.hud.hitmarker(false);
        if (pr.spell.kind === 'lob') this.detonate(pr, hitPos, null);
        this.kill(pr, i);
        continue;
      }

      if (hitKind === 'env') {
        game.env.onProjectileHit(hitEnv, pr, hitPos);
        if (pr.spell.kind === 'lob') this.detonate(pr, hitPos, null);
        this.kill(pr, i);
        continue;
      }

      if (pr.spell.kind === 'lob') {
        this.detonate(pr, hitPos, hitNormal);
        this.kill(pr, i);
        continue;
      }

      // bolt resolution
      if (hitKind === 'world') {
        game.effects.impact(hitPos, hitNormal, pr.spell, true);
        // bolts chew through breakable cover
        if (hitBox?.breakRec) {
          game.env?.hitBreakable(hitBox.breakRec, pr.spell.dmg * pr.owner.effPower() * pr.owner.wand.power, pr.owner);
        }
      } else if (hitPlayer) {
        this.boltHit(pr, hitPlayer, hitZone, hitPos);
      }
      this.kill(pr, i);
    }
  }

  boltHit(pr, victim, zone, hitPos) {
    const game = this.game;
    const sp = pr.spell;
    const owner = pr.owner;
    // BLINK DODGE: a wizard caught mid-blink slips the bolt entirely — even Avada
    if (victim.dashIframeT > 0 && owner !== victim) {
      game.effects.dashDodgeFX(victim);
      if (victim.isHuman) game.hud.notice('BLINK — dodged!', 'good');
      else if (owner.isHuman) game.hud.notice(`${victim.name} blinked away!`, 'bad');
      return;
    }
    const isHS = zone === 'head';
    let dmg = sp.dmg * owner.effPower() * owner.wand.power;
    if (sp.falloff) {
      const [start, end, minMult] = sp.falloff;
      const t = clamp((pr.traveled - start) / (end - start), 0, 1);
      dmg *= 1 - t * (1 - minMult);
    }
    if (isHS && sp.hs > 1) dmg *= sp.hs;
    else dmg *= HITZONES[zone]?.mult ?? 1;
    // COMBO PAYOFF: a bolt into a controlled enemy bites harder. Read the
    // victim's state BEFORE this hit lands (so a leg shot can't combo off the
    // slow it is about to apply below). Petrified statues SHATTER; staggered/
    // snared/slowed wizards take a crunch — the heart of an arcade rally.
    let comboKind = null, comboMult = 1;
    if (sp.dmg >= 10 && owner !== victim) {
      if (victim.freezeT > 0) { comboKind = 'shatter'; comboMult = 1.5; }
      else if (victim.staggerT > 0) { comboKind = 'crush'; comboMult = 1.3; }
      else if (victim.snareT > 0) { comboKind = 'crush'; comboMult = 1.3; }
      else if (victim.slowT > 0) { comboKind = 'crush'; comboMult = 1.25; }
    }
    if (pr.reflected) comboMult *= 1.4; // a parried curse returns angrier
    dmg *= comboMult;
    if (comboKind) {
      game.effects.comboFX(hitPos, comboKind);
      game.audio.play(comboKind === 'shatter' ? 'freeze_break' : 'combo', { pos: hitPos, vol: 0.85 });
      if (owner.isHuman) {
        game.hud.notice(comboKind === 'shatter' ? 'SHATTER!' : 'COMBO!', 'good');
        game.hitstop(comboKind === 'shatter' ? 0.05 : 0.03);
      }
    }
    // leg tag: clipped legs stumble — brief extra slow (CS tagging), applied
    // after the combo check above so a leg shot doesn't combo off its own slow
    if (zone === 'leg' && sp.dmg >= 15) victim.slowT = Math.max(victim.slowT, 0.3);
    game.effects.fleshImpact(hitPos, sp);

    const dir = new THREE.Vector3(pr.vx, pr.vy, pr.vz).normalize();
    // FEEL it: knockback impulse + stagger, remembered for corpse ragdolls
    if (sp.kb) {
      victim.vel.x += dir.x * sp.kb;
      victim.vel.z += dir.z * sp.kb;
      if (victim.body.onGround) victim.vel.y += sp.kb * 0.22;
    }
    if (sp.stagger) {
      victim.staggerT = Math.max(victim.staggerT, sp.stagger);
      game.audio.play('stagger', { pos: victim.pos, vol: 0.7 });
    }
    victim.lastHit = { x: dir.x, y: dir.y, z: dir.z, power: sp.id === 'avada' ? 5.5 : sp.kb ? sp.kb * 0.5 : 0.8, t: game.time };

    // SEE it: body flash for everyone, color-coded screen hit for the victim
    game.effects.onHit(victim, sp);
    game.victimFeedback(victim, sp);

    if (sp.disarm) victim.applyDisarm(sp.disarm, game, dir);
    // McGonagall's body-binds hold longer
    if (sp.freeze) victim.applyFreeze(sp.freeze * (owner.char.id === 'mcgonagall' ? 1.3 : 1), game);
    const dot = owner.disc?.dotMult ?? 1; // Hexer: afflictions tick harder and longer
    if (sp.snare) victim.applySnare(sp.snare * dot, game);
    if (sp.slow) {
      if (victim.slowT <= 0.25) game.effects.crucioFX(victim);
      victim.slowT = Math.max(victim.slowT, sp.slow * dot);
      if (victim.isHuman) game.hud.notice(`${sp.name.toUpperCase()} — SLOWED!`, 'bad');
    }
    if (sp.morph) victim.applyMorph(sp.morph * dot, sp.morphId, game);
    // Umbridge's decrees stick: longer silences
    if (sp.silence) victim.applySilence(sp.silence * dot * (owner.char.id === 'umbridge' ? 1.35 : 1), game);
    if (sp.bleed) victim.bleeds.push({ t: sp.bleed[1] * dot, dps: sp.bleed[0] * owner.effPower() * dot, attacker: owner, spell: sp });
    // Umbridge: hex hits file a surveillance report — victim pinned on squad radar
    if (owner.char.id === 'umbridge' && sp.slot === 3 && owner.team !== victim.team) {
      victim.taggedT = 4;
      victim.taggedBy = owner.team;
      if (victim.isHuman) game.hud.notice('TRACKED — Ministry surveillance!', 'bad');
    }
    if (owner.char.id === 'bellatrix') {
      if (victim.slowT <= 0.25) game.effects.crucioFX(victim); // fresh application: writhing crackle
      victim.slowT = Math.max(victim.slowT, 1.2 * dot);
      if (victim.isHuman) game.hud.notice('CRUCIO — SLOWED!', 'bad');
    }
    game.damage(victim, owner, dmg, sp, isHS, hitPos);
  }

  detonate(pr, pos, normal) {
    const game = this.game;
    const sp = pr.spell;
    const lobRadius = (r) => r * (pr.owner.wand.lobRadius ?? 1);
    if (sp.id === 'bombarda') {
      game.effects.explode(pos, sp);
      // Ginny's Bat-Bogey Barrage: wider blast
      const radius = lobRadius(sp.radius) * (pr.owner.char.id === 'ginny' ? 1.2 : 1);
      game.explosion(pos, radius, sp.dmg, pr.owner, sp);
      game.noise({ pos }, 40);
    } else if (sp.flash) {
      const fpos = normal ? pos.clone().addScaledVector(normal, 0.4) : pos.clone();
      game.effects.flashAt(fpos);
      game.flashPlayers(fpos, { ...sp, radius: lobRadius(sp.radius) });
      game.noise({ pos }, 30);
    } else if (sp.smoke) {
      game.effects.spawnSmoke(pos, { ...sp, radius: lobRadius(sp.radius) });
      // CS rules: smoke landing on cursed fire snuffs it out
      game.effects.douseFires(pos, lobRadius(sp.radius) + 1.5);
    } else if (sp.ward) {
      // raise the guardian wall where it lands, facing back along the throw
      const yaw = Math.atan2(pr.vx, pr.vz); // wall normal points back at the caster
      const gy = game.world.groundY(pos.x, pos.z, pos.y + 0.3);
      game.effects.spawnWard(new THREE.Vector3(pos.x, gy, pos.z), yaw, pr.owner, sp);
      game.noise({ pos, team: pr.owner.team, id: pr.owner.id }, 22);
    } else if (sp.heal) {
      const radius = lobRadius(sp.radius);
      let healed = 0;
      for (const q of game.players) {
        if (!q.alive || q.team !== pr.owner.team || q.health >= q.stats.hp) continue;
        if (Math.abs(q.pos.y - pos.y) > 2.5) continue;
        const d = Math.hypot(q.pos.x - pos.x, q.pos.z - pos.z);
        if (d > radius) continue;
        const amt = sp.heal * (1 - clamp(d / radius, 0, 0.65));
        q.health = Math.min(q.stats.hp, q.health + amt);
        game.effects.healFX(q);
        healed++;
      }
      if (pr.owner.isHuman) {
        game.hud.notice(healed ? `Episkey — healed ${healed} ally${healed === 1 ? '' : 'ies'}` : 'Episkey found no wounded allies', healed ? 'good' : 'info');
      }
    } else if (sp.fire) {
      // place fire on the ground below the impact — unless it lands in water,
      // where cursed flame dies in a hiss of steam
      const gy = game.world.groundY(pos.x, pos.z, pos.y + 0.2);
      const wtr = game.world.waterAt(pos.x, pos.y, pos.z) || game.world.waterAt(pos.x, gy + 0.1, pos.z);
      if (wtr) {
        game.effects.steamFX(new THREE.Vector3(pos.x, wtr.y + 0.1, pos.z), lobRadius(sp.radius));
      } else {
        game.effects.spawnFire(new THREE.Vector3(pos.x, gy + 0.05, pos.z), { ...sp, radius: lobRadius(sp.radius) }, pr.owner);
      }
      game.noise({ pos }, 25);
    }
  }

  kill(pr, idx) {
    this.game.effects.releaseBolt(pr.fx);
    this.projectiles.splice(idx, 1);
  }

  // fire pool damage ticks (called from game.update)
  updateFires(dt) {
    const game = this.game;
    for (const f of game.effects.fires) {
      for (const p of game.players) {
        if (!p.alive) continue;
        const dx = p.pos.x - f.x, dz = p.pos.z - f.z;
        if (dx * dx + dz * dz < (f.r + 0.35) ** 2 && Math.abs(p.pos.y - f.y) < 2.4) {
          if (p === f.owner || p.team !== f.owner.team) {
            let d = f.dps * dt * f.owner.effPower() * (f.owner.disc?.dotMult ?? 1);
            if (p.char.id === 'ron') d *= 0.8;
            if (p.disc?.blastResist) d *= p.disc.blastResist;
            if (p.burnT <= 0) game.effects.igniteFX(p); // catching fire
            p.burnT = Math.max(p.burnT, 0.8);
            game.damage(p, f.owner, d, SPELLS.incendio, false, null, true);
          }
        }
      }
    }
  }

  clear() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this.kill(this.projectiles[i], i);
  }
}

// Segment vs vertical ward quad (center w.x/y/z, yaw normal w.nx/nz, half-width w.hw, height w.h).
function segVsWard(ax, ay, az, bx, by, bz, w) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const denom = dx * w.nx + dz * w.nz;
  if (Math.abs(denom) < 1e-7) return -1; // parallel
  const t = ((w.x - ax) * w.nx + (w.z - az) * w.nz) / denom;
  if (t < 0 || t > 1) return -1;
  const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
  if (py < w.y - 0.1 || py > w.y + w.h) return -1;
  // lateral offset along the wall's width axis (perpendicular to the normal)
  const u = (px - w.x) * -w.nz + (pz - w.z) * w.nx;
  if (Math.abs(u) > w.hw) return -1;
  return t;
}

// Locate a body-box hit on the victim: leg / stomach / chest / arm.
// Height fractions follow CS 1.6 hitboxes; arms are the outer chest band
// relative to which way the victim is facing.
function zoneFor(v, hx, hy, hz) {
  const frac = clamp((hy - v.pos.y) / v.body.height, 0, 1);
  if (frac < 0.42) return 'leg';
  if (frac < 0.61) return 'stomach';
  // lateral offset along the victim's right axis
  const lateral = (hx - v.pos.x) * Math.cos(v.yaw) - (hz - v.pos.z) * Math.sin(v.yaw);
  return Math.abs(lateral) > 0.26 ? 'arm' : 'chest';
}

function segAABB(ax, ay, az, bx, by, bz, v) {
  const half = 0.38;
  const x0 = v.pos.x - half, x1 = v.pos.x + half;
  const y0 = v.pos.y, y1 = v.pos.y + v.body.height;
  const z0 = v.pos.z - half, z1 = v.pos.z + half;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) { if (ax < x0 || ax > x1) return -1; }
  else {
    let t1 = (x0 - ax) / dx, t2 = (x1 - ax) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (ay < y0 || ay > y1) return -1; }
  else {
    let t1 = (y0 - ay) / dy, t2 = (y1 - ay) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (az < z0 || az > z1) return -1; }
  else {
    let t1 = (z0 - az) / dz, t2 = (z1 - az) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
