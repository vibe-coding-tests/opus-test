// Bot AI — a human-like brain in four layers, every layer tuned by the
// difficulty axes (reflex / aim / sense / iq) plus the character's personality:
//
//  PERCEPTION  Targets aren't binary-visible: recognition ACCUMULATES with
//              distance, peripheral vision, motion, light and expectation.
//              A crouched lurker in the corner of the eye takes a beat to
//              register; a sprinting caster dead-center does not. Sounds are
//              heard per-bot and turn heads.
//  REFLEXES    Notice → orient → fire is a pipeline with human latency and
//              variance. Ambushes from behind cost extra. Incoming bolts can
//              trigger a Protego raise (sometimes a perfect parry) or a flinch
//              dodge — after a human-scale delay.
//  AIM         A hand, not an aimbot: the first snap overshoots (flick), error
//              decays toward a wandering tracking error that grows with target
//              speed, own movement and range. Lead is misjudged. Skilled bots
//              counter-strafe to shoot.
//  TACTICS     Objective play, route choice, trades, searches, utility with
//              intent, eco saves when the round is lost, target priority
//              (defuser > carrier > wounded > nearest).
import * as THREE from 'three';
import { SPELLS, WANDS, otherTeam } from './data.js';
import { clamp, rand, choice, DEG, yawTo, angDiff, grand } from './utils.js';

const V = new THREE.Vector3();
const DEFAULT_AI = { aggro: 0.5, range: 16, util: 1, lurk: 0.2, snipe: 0.3, team: 0.5, dodge: 0.7 };

export class Bot {
  constructor(player, game, profile) {
    this.p = player;
    this.game = game;
    this.prof = profile;
    this.ai = { ...DEFAULT_AI, ...(player.char.ai || {}) };
    // per-bot jitter: no two bots on a team play identically
    const j = (v, lo = 0.86, hi = 1.16) => v * rand(lo, hi);
    this.skill = {
      reactMean: j(profile.reactMean), reactStd: profile.reactStd,
      surprise: profile.surprise, shieldReact: j(profile.shieldReact),
      turnSpeed: j(profile.turnSpeed),
      settle: j(profile.settle), flick: profile.flick, trackErr: j(profile.trackErr),
      leadErr: j(profile.leadErr), headBias: profile.headBias, counterStrafe: profile.counterStrafe,
      fovDot: profile.fovDot, sightDist: j(profile.sightDist, 0.92, 1.08),
      noticeMul: j(profile.noticeMul), hear: j(profile.hear), cloakEye: profile.cloakEye,
      memoryT: profile.memoryT,
      iq: clamp(profile.iq * rand(0.88, 1.1), 0, 1),
      util: clamp(profile.util * this.ai.util, 0, 1),
      strafe: clamp(profile.strafe * (0.6 + 0.55 * this.ai.dodge), 0.15, 1.3),
    };
    this.thinkT = rand(0, 0.15);
    this.path = null;
    this.pathIdx = 0;
    this.pathGoal = null;
    this.repathT = 0;
    this.target = null;
    this.visT = 0;          // continuous time-on-target
    this.burstT = 0;
    this.pauseT = 0;
    this.strafeDir = 1;
    this.strafeT = 0;
    this.aimYaw = player.yaw;
    this.aimPitch = 0;
    this.role = { type: 'roam' };
    this.holdSpot = null;
    this.holdFaceYaw = 0;
    this.stuckT = 0;
    this.utilAt = rand(2, 6);   // next time (sim clock) utility may launch
    this.execSpell = null;      // utility cast in flight (held by sim time)
    this.execUntil = 0;
    this.charging = false;
    this.combatSpell = null;    // committed combat pick — held for a short window
    this.combatSpellUntil = 0;  // when that pick is up for re-roll
    this.lastCombatSpell = null;// previous pick, penalized so threats rotate
    this.crouchT = 0;
    this.crouchUntil = 0;   // timed crouch — auto-stands when it expires
    this.wanderT = 0;
    this.peek = null;       // defender forward-peek excursion
    this.peekT = rand(6, 14);
    this.goSlowUntil = 0;   // cautious attackers stagger their push
    this.retreating = 0;
    this.coverPos = null;   // cached cover node when falling back
    this.coverT = 0;        // when to recompute cover
    this.ignoreUntil = 0;   // stale-duel breaker: look away and flank
    this.lastPos = new THREE.Vector3();
    this.seenCorpses = new Set(); // teammate deaths this bot has noticed
    this.search = null;     // last-seen sweep: {x, y, z, until, sweepDir}
    this.hadTargetT = -99;  // when we last had a live target

    // --- the human pipeline ---
    this.aware = new Map(); // enemy.id → recognition 0..1.5 (1 = registered)
    this.orientAt = Infinity;  // when the head starts turning
    this.reactAt = Infinity;   // when the trigger finger is allowed
    this.aimErr = { yaw: 0, pitch: 0 }; // current aim error (flick decays here)
    this.wander = { yaw: 0, pitch: 0 }; // tracking-noise target
    this.errT = 0;
    this.leadBias = grand();
    this.headIntent = false;
    this.shieldAt = Infinity;  // scheduled reflex Protego window
    this.shieldUntil = 0;
    this.parryIntent = false;  // deliberate perfect-block read (reflects only then)
    this.dodgeUntil = 0;
    this.dodgeDir = 1;
    this.threatCd = 0;
    this.heard = null;      // last sound: {x,y,z,t,loud}
    this.saving = false;    // eco: hiding out the round to keep gear
    this.saveSpot = null;
    this.saveEvalT = rand(1, 3);
    this.order = null;      // a player command (game.command) this bot is obeying
    this.orderPush = 0;     // until-time of a "push" order (forces commitment)
    this.execAt = 0;        // squad-synchronized execute time (0 = none)
  }

  // ---------------------------------------------------------------- round ---
  onRoundStart(role) {
    this.role = role;
    this.path = null;
    this.pathGoal = null;
    this.target = null;
    this.detour = null;
    this.visT = 0;
    this.charging = false;
    this.utilAt = this.game.time + rand(3, 9);
    this.execSpell = null;
    this.execUntil = 0;
    this.combatSpell = null;
    this.combatSpellUntil = 0;
    this.lastCombatSpell = null;
    this.peek = null;
    this.peekT = rand(6, 14);
    this.retreating = 0;
    this.coverPos = null;
    this.coverT = 0;
    this.seenCorpses.clear();
    this.search = null;
    this.aware.clear();
    this.orientAt = Infinity;
    this.reactAt = Infinity;
    this.shieldAt = Infinity;
    this.shieldUntil = 0;
    this.parryIntent = false;
    this.dodgeUntil = 0;
    this.heard = null;
    this.saving = false;
    this.saveSpot = null;
    this.order = null;
    this.orderPush = 0;
    this.execAt = 0;
    this.hurtCalled = false; // one low-HP callout per wound, reset on heal/round
    this.executedAt = -99; // site-execute utility: once per push
    // timing variety: cautious wizards let the round breathe before committing;
    // Bellatrix is already running at you
    this.goSlowUntil = role.type === 'attack'
      ? this.game.time + (1 - this.ai.aggro) * rand(2, 8) + this.ai.lurk * rand(0, 5)
      : 0;
    if (role.type === 'defend') {
      this.holdSpot = role.spot;
      this.holdFaceYaw = role.faceYaw;
    }
  }

  buy(force = false) {
    const g = this.game;
    const p = this.p;
    const u = this.skill.util;
    const ai = this.ai;
    // eco discipline: patient wizards save up for a proper buy; smart ones
    // recognize a broke round and full-save. A squad force-buy overrides the
    // floor — everyone spends together to break a losing streak.
    const ecoFloor = 1100 + (1 - ai.aggro) * 1100 + this.skill.iq * 400;
    if (!force && p.money < ecoFloor && p.wand.id === 'training') return;
    // wand upgrade
    if (p.wand.id === 'training') {
      const affordable = WANDS.filter((w) => w.price > 0 && w.price * p.priceMult() <= p.money - 400);
      if (affordable.length) {
        const wanted = p.money > 5200 && Math.random() < 0.5 ? affordable[affordable.length - 1] : choice(affordable);
        g.buy(p, 'wand', wanted.id);
      }
    } else if (p.wand.id === 'holly' && p.money > 5500 && Math.random() < 0.4) {
      g.buy(p, 'wand', 'elder');
    }
    // the Avada: snipers prioritize it, brawlers rarely bother
    if (!p.owned.has('avada') && p.money > 5000 && Math.random() < 0.1 + ai.snipe * 0.65 + (this.role.type === 'defend' ? 0.08 : 0)) {
      g.buy(p, 'spell', 'avada');
    }
    // grenades — support casters stock a full belt; attackers flash entries,
    // defenders hold mollies for the retake (gates sit low on purpose: the
    // wand purchase above already ate the big money, and dry pushes are boring)
    if (Math.random() < u && p.money > 1100) g.buy(p, 'spell', 'bombarda');
    if (Math.random() < u * (this.role.type === 'attack' ? 1.0 : 0.7) && p.money > 900) g.buy(p, 'spell', 'lumos');
    if (Math.random() < u * 0.75 && p.money > 1000) g.buy(p, 'spell', 'fumos');
    if (Math.random() < u * (this.role.type === 'defend' ? 0.65 : 0.4) && p.money > 1400) g.buy(p, 'spell', 'incendio');
    if (Math.random() < u * (ai.team > 0.6 ? 0.65 : 0.3) && p.money > 1300) g.buy(p, 'spell', 'episkey');
    // signature spell: every champion reaches for their favorite first
    const fav = p.char.fav;
    if (fav && SPELLS[fav] && Math.random() < 0.6 && p.money > SPELLS[fav].price * p.priceMult() + 700) {
      g.buy(p, 'spell', fav);
    }
    // tactical hexes
    if (Math.random() < u * 0.5 && p.money > 1500) g.buy(p, 'spell', 'petrificus');
    if (Math.random() < u * 0.45 && p.money > 1300) g.buy(p, 'spell', 'impedimenta');
    if (Math.random() < u * 0.35 + ai.snipe * 0.1 && p.money > 1600) g.buy(p, 'spell', 'silencio');
    if (Math.random() < u * 0.42 && p.money > 1650) g.buy(p, 'spell', 'porcus');
    if (Math.random() < u * 0.5 && p.money > 1350) g.buy(p, 'spell', 'rictusempra');
    if (this.role.type === 'defend' && Math.random() < u * 0.45 && p.money > 1700) g.buy(p, 'spell', 'patronum');
    if (Math.random() < u * 0.4 && p.money > 1900) g.buy(p, 'spell', 'serpensortia');
    // gear by temperament: rushers grab brooms, lurkers love the cloak
    if (Math.random() < 0.55 && p.money > 1300) g.buy(p, 'equip', 'potion');
    if (Math.random() < ai.aggro * 0.45 && p.money > 2000) g.buy(p, 'equip', 'broom');
    if (ai.lurk > 0.45 && Math.random() < ai.lurk * 0.55 && p.money > 2000) g.buy(p, 'equip', 'cloak');
    if ((ai.lurk > 0.45 || ai.aggro < 0.35 || p.disc?.id === 'phantom') && Math.random() < 0.35 && p.money > 1800) g.buy(p, 'equip', 'apparate');
    if (Math.random() < u * 0.5 && p.money > 1200) g.buy(p, 'equip', 'finite');
    // armor: anchors and the rich; luck and escape hatches for the rest
    if (p.equip.vest <= 0 && Math.random() < 0.35 + (1 - ai.aggro) * 0.4 && p.money > 2300) g.buy(p, 'equip', 'vest');
    if (Math.random() < 0.18 && p.money > 4200) g.buy(p, 'equip', 'felix');
    if (ai.lurk > 0.4 && Math.random() < 0.2 && p.money > 2600) g.buy(p, 'equip', 'portkey');
  }

  // ----------------------------------------------------------------- think ---
  update(dt) {
    const p = this.p;
    const g = this.game;
    if (!p.alive) return;
    if (p.freezeT > 0) { // petrified: a statue does nothing
      p.ctrl.moveX = 0; p.ctrl.moveZ = 0;
      p.ctrl.castHeld = false; p.ctrl.altHeld = false; p.ctrl.jump = false;
      return;
    }
    if (p.morphT > 0) {
      p.ctrl.castHeld = false; p.ctrl.altHeld = false;
      this.charging = false;
    }

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.13;
      this.think();
    }

    // a fresh wound past two-thirds draws a hurt callout (once, until patched up)
    const lowHp = p.stats.hp * 0.33;
    if (!this.hurtCalled && p.health <= lowHp) {
      this.hurtCalled = true;
      g.comms.say(p, 'status', { scope: 'team', pos: p.pos, mood: 'hurt', chance: 0.6 });
    } else if (this.hurtCalled && p.health > p.stats.hp * 0.5) {
      this.hurtCalled = false;
    }

    // utility cast in flight: hold spell + trigger on the SIM clock until it
    // leaves the wand, so think()/engage() can't stomp the switch mid-throw
    if (this.execUntil) {
      if (g.time >= this.execUntil || !p.ownsUsable(this.execSpell)) {
        if (p.curSpell === this.execSpell) p.curSpell = p.slot1();
        p.ctrl.castHeld = false;
        this.execSpell = null;
        this.execUntil = 0;
      } else {
        p.curSpell = this.execSpell;
        p.ctrl.castHeld = true;
      }
    }

    // continuous aim smoothing — turn rate is a reflex stat
    const turnSpeed = this.skill.turnSpeed * DEG;
    const dy = angDiff(p.yaw, this.aimYaw);
    const maxStep = turnSpeed * dt;
    p.yaw += clamp(dy, -maxStep, maxStep);
    p.pitch += clamp(this.aimPitch - p.pitch, -maxStep, maxStep);
    p.pitch = clamp(p.pitch, -1.4, 1.4);

    // reflex shield window (frame-accurate so perfect parries can happen)
    if (g.time >= this.shieldAt && g.time < this.shieldUntil && p.mana > 6 && !p.charge && p.disarmT <= 0 && p.silenceT <= 0) {
      p.ctrl.altHeld = true;
      p.ctrl.castHeld = false;
      this.charging = false;
    } else if (this.shieldAt !== Infinity && g.time >= this.shieldUntil) {
      this.shieldAt = Infinity;
      this.parryIntent = false;
      p.ctrl.altHeld = false;
    }

    // fire control for charge spells
    if (this.charging) {
      if (!p.charge && g.time >= p.nextCastAt) p.ctrl.castHeld = true;
      else if (p.charge && p.charge.t >= p.charge.total) {
        // release next frame to fire when aim is settled
        if (Math.abs(dy) < 2.5 * DEG) {
          p.ctrl.castHeld = false;
          this.charging = false;
        }
      } else p.ctrl.castHeld = true;
    }

    // stuck detection: wants to move but isn't (works with or without a path)
    if (p.horizSpeed < 0.35 && (Math.abs(p.ctrl.moveX) > 0.1 || Math.abs(p.ctrl.moveZ) > 0.1)) {
      this.stuckT += dt;
      if (this.stuckT > 0.7) p.ctrl.jump = true;
      if (this.stuckT > 1.8) {
        this.path = null; this.pathGoal = null;
        this.stuckT = 0;
        // sidestep detour so we don't grind against the same wall forever
        const near = g.world.nodesNear(p.pos.x, p.pos.y, p.pos.z, 6).filter((n) => (n.x - p.pos.x) ** 2 + (n.z - p.pos.z) ** 2 > 4);
        if (near.length) {
          const n = choice(near);
          this.detour = { x: n.x, y: n.y, z: n.z, until: g.time + rand(1.0, 1.8) };
        }
      }
    } else {
      this.stuckT = 0;
      p.ctrl.jump = false;
    }
  }

  think() {
    const p = this.p;
    const g = this.game;
    const ctrl = p.ctrl;
    ctrl.moveX = 0; ctrl.moveZ = 0;
    ctrl.useHeld = false;
    ctrl.climbF = 0;
    ctrl.walkHeld = false;
    // crouch is a timed commitment, not a latch — bots used to get stuck
    // crawling forever after their first crouched engagement
    ctrl.crouch = g.time < this.crouchUntil;
    if (g.time >= this.shieldUntil) ctrl.altHeld = false;
    if (g.frozen) { ctrl.castHeld = false; return; }

    // disarmed: sprint to the dropped wand — can't fight without it
    if (p.disarmT > 0 && p.wandProp?.settled) {
      ctrl.castHeld = false;
      const w = p.wandProp.mesh.position;
      this.goTo(w.x, p.pos.y, w.z, 0.4);
      this.faceWalk(w.x, w.z);
      return;
    }

    // PERCEPTION: accumulate recognition, pick the priority target
    let enemy = this.senseEnemies();

    // stale duel breaker: nobody is winning this staring contest — break LOS,
    // take the route, come back from a different angle
    if (enemy && this.visT > 14 && this.ignoreUntil < g.time) {
      const d = enemy.eyePos().distanceTo(p.eyePos());
      if (d > 11) {
        this.ignoreUntil = g.time + 4;
        this.visT = 0;
        this.path = null; this.pathGoal = null;
        enemy = null;
      }
    }
    if (enemy && this.ignoreUntil > g.time && enemy.eyePos().distanceToSquared(p.eyePos()) > 144) {
      enemy = null; // pretending we didn't see them (until they get close)
    }

    if (enemy) {
      // REFLEX: a new engagement schedules the orient → fire pipeline
      if (this.target !== enemy || g.time - this.hadTargetT > 1.2) {
        this.beginReaction(enemy);
      }
      if (this.visT === 0 && g.time - this.hadTargetT > 4) {
        g.radio(p, `Contact — ${g.areaName(enemy.pos.x, enemy.pos.z)}!`, 0.5);
      }
      this.visT += 0.13;
      this.target = enemy;
      this.hadTargetT = g.time;
      this.search = null;
      g.see(p.team, enemy);
    } else {
      // just lost sight of a live target: push to where they were and sweep
      if (this.target && this.target.alive && g.time - this.hadTargetT < 0.4 && !this.search) {
        this.search = {
          x: this.target.pos.x, y: this.target.pos.y, z: this.target.pos.z,
          until: g.time + 3.5 + this.ai.aggro * 2, sweepDir: Math.random() < 0.5 ? 1 : -1,
        };
      }
      this.visT = 0;
      if (!this.charging) {
        ctrl.castHeld = false;
      } else if (!this.target || !this.target.alive || g.time - this.hadTargetT > 0.9) {
        // orphaned Killing Curse: the duel is over — let the charge gutter out
        // instead of firing it into a wall
        g.spells.cancelCharge(p);
        this.charging = false;
        ctrl.castHeld = false;
      }
    }

    // notice fallen teammates: register the body, warn the team, hunt the killer
    this.noticeCorpses();

    // REFLEX: incoming bolts / a charging Killing Curse trigger shield or dodge
    this.threatScan(enemy);

    // a conjured serpent is hunting me — shoot it down or outrun it
    if (this.snakeDefense(enemy)) return;

    // escape fire pools
    const inFire = g.effects.fires.find((f) => (p.pos.x - f.x) ** 2 + (p.pos.z - f.z) ** 2 < (f.r + 0.4) ** 2 && Math.abs(p.pos.y - f.y) < 2.4);
    if (inFire) {
      const away = V.set(p.pos.x - inFire.x, 0, p.pos.z - inFire.z).normalize();
      ctrl.moveX = away.x; ctrl.moveZ = away.z;
      if (!enemy) return;
    }

    // RELIC CARRIER: planting is the mission. Don't get pulled into a long-range
    // duel — only stop for a close, direct threat; otherwise keep pushing to the
    // site so objective() can walk us on and plant it.
    if (enemy && p.hasRelic) {
      const dCarry = enemy.eyePos().distanceTo(p.eyePos());
      if (dCarry > 13 && p.health > 45) {
        this.aimYaw = yawTo(p.eyePos(), enemy.eyePos());
        enemy = null;
      }
    }

    if (enemy) {
      this.engage(enemy);
      return;
    }

    // FLASHED: stagger back from the last known threat, hands over eyes
    if (p.blindT > 0.8) {
      const mem = this.freshMemory();
      if (mem) {
        const away = V.set(p.pos.x - mem.x, 0, p.pos.z - mem.z).normalize();
        ctrl.moveX = away.x; ctrl.moveZ = away.z;
      } else {
        ctrl.moveX = Math.sin(g.time * 2.1 + p.id) * 0.6;
        ctrl.moveZ = Math.cos(g.time * 1.7 + p.id) * 0.6;
      }
      if (this.skill.iq > 0.5 && p.mana > 25 && Math.random() < 0.12) {
        this.shieldAt = g.time;
        this.shieldUntil = g.time + 0.7;
      }
      return;
    }

    // active detour after getting stuck
    if (this.detour) {
      if (g.time > this.detour.until || Math.hypot(p.pos.x - this.detour.x, p.pos.z - this.detour.z) < 1.2) {
        this.detour = null;
      } else {
        this.goTo(this.detour.x, this.detour.y, this.detour.z, 1.0);
        this.faceWalk(this.detour.x, this.detour.z);
        return;
      }
    }

    // a standing player command (follow / hold / fall back / rally) outranks
    // roaming, trades and the default objective — but never an active fight
    if (this.applyOrder()) return;

    // a teammate just died nearby: loyal wizards turn to trade the kill,
    // lurkers note it and keep flanking
    const trade = this.tradeOpportunity();
    if (trade) {
      this.goTo(trade.x, trade.y, trade.z, 2.0);
      this.faceWalk(trade.x, trade.z);
      this.maybeUtility(trade);
      return;
    }

    // hunt the corner where a target slipped away, sweeping the angle
    if (this.search) {
      const s = this.search;
      const close = Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 2.2;
      if (g.time > s.until || (close && g.time > s.until - 1.5)) {
        this.search = null;
      } else {
        this.goTo(s.x, s.y, s.z, 1.2);
        const base = yawTo(p.pos, V.set(s.x, s.y, s.z));
        this.aimYaw = close ? base + Math.sin(g.time * 2.2) * 1.1 * s.sweepDir : base;
        this.aimPitch = 0;
        return;
      }
    }

    const mem = this.freshMemory();
    if (mem && this.role.type !== 'defend' && !p.hasRelic && !this.saving) {
      // lurkers close in on known enemies silently — no footsteps to warn them
      ctrl.walkHeld = this.ai.lurk > 0.45 && Math.hypot(p.pos.x - mem.x, p.pos.z - mem.z) < 26;
      this.goTo(mem.x, mem.y, mem.z, 1.6);
      this.faceWalk(mem.x, mem.z);
      this.maybeUtility(mem);
    } else {
      ctrl.walkHeld = false;
      this.objective();
    }

    // a fresh sound turns the head even while walking
    if (this.heard && g.time - this.heard.t < 1.3) {
      this.aimYaw = yawTo(p.pos, V.set(this.heard.x, p.pos.y, this.heard.z));
      this.aimPitch *= 0.5;
    }

    // housekeeping
    if (p.mana < p.stats.mana * 0.3 && p.recharging <= 0 && !this.execUntil) p.startRecharge();
    if (p.health < 55 && p.equip.potion > 0) p.useEquip('potion');
    if (p.equip.finite > 0 && (p.burnT > 0 || p.bleeds.length > 0 || p.slowT > 0 || p.snareT > 0 || p.morphT > 0)) p.useEquip('finite');
    // lurkers vanish for the flank once the round is rolling
    if (p.equip.cloak > 0 && p.cloakT <= 0 && this.ai.lurk > 0.5 && this.role.type === 'attack' &&
        g.roundT < 90 && g.roundT > 40 && !p.hasRelic) {
      p.useEquip('cloak');
    }
  }

  // -------------------------------------------------------- player commands ---
  // How likely this bot is to obey a given order: loyal team players comply,
  // lurkers and the rat freelance. Calls for help / retreats get more yeses.
  orderCompliance(o) {
    const ai = this.ai;
    let base = 0.45 + ai.team * 0.5 - ai.lurk * 0.3;
    if (o.type === 'rally' || o.type === 'fallback') base += 0.2;
    if (this.p.char.id === 'wormtail') base -= 0.3;
    return Math.random() < clamp(base, 0.08, 0.97);
  }

  // Consume a standing order. Returns true if it fully drove movement this tick
  // (so think() should stop), false if it only nudged state and play continues.
  applyOrder() {
    const o = this.order;
    if (!o) return false;
    const g = this.game, p = this.p, ctrl = p.ctrl;
    if (g.time > o.until) { this.order = null; return false; }
    if (!o.obey || p.hasRelic) return false; // refusers and the carrier do their own thing
    switch (o.type) {
      case 'go': {
        const site = g.world.zones[`site${o.site}`];
        if (this.role?.type === 'defend' && site) {
          const center = { x: site.cx, y: p.pos.y, z: site.cz };
          this.holdSpot = this.pickHoldNear(center, 3, 11);
          this.holdFaceYaw = yawTo(this.holdSpot, center);
        } else if (this.role) {
          this.role.site = o.site; this.role.via = null; this.role.viaIdx = 0; this.holdSpot = null;
        }
        return false;
      }
      case 'push':
        this.goSlowUntil = 0; this.saving = false; this.orderPush = o.until;
        return false;
      case 'hold': {
        const spot = o.pos || this.holdSpot || { x: p.pos.x, y: p.pos.y, z: p.pos.z };
        this.holdSpot = spot;
        this.holdAt(spot, o.face ?? p.yaw);
        return true;
      }
      case 'fallback': {
        this.saving = false;
        const to = o.pos;
        if (Math.hypot(p.pos.x - to.x, p.pos.z - to.z) > 3) { this.goTo(to.x, to.y, to.z, 2); this.faceWalk(to.x, to.z); }
        else { ctrl.moveX = 0; ctrl.moveZ = 0; }
        return true;
      }
      case 'follow': {
        const t = o.target;
        if (!t || !t.alive) { this.order = null; return false; }
        const d = Math.hypot(p.pos.x - t.pos.x, p.pos.z - t.pos.z);
        if (d > 5.5) { this.goTo(t.pos.x, t.pos.y, t.pos.z, 3.5); this.faceWalk(t.pos.x, t.pos.z); }
        else { ctrl.moveX = 0; ctrl.moveZ = 0; this.aimYaw = t.yaw; }
        return true;
      }
      case 'rally': {
        const to = o.pos;
        if (Math.hypot(p.pos.x - to.x, p.pos.z - to.z) > 4) { this.goTo(to.x, to.y, to.z, 2.5); this.faceWalk(to.x, to.z); return true; }
        return false; // arrived — defend the area normally
      }
    }
    return false;
  }

  // A player ping landed: glance at it, and maybe go investigate an enemy mark.
  onPing(mark) {
    const g = this.game, p = this.p;
    if (Math.hypot(mark.x - p.pos.x, mark.z - p.pos.z) > 45) return;
    this.heard = { x: mark.x, y: mark.y, z: mark.z, t: g.time, loud: 14 };
    if (mark.kind === 'enemy' && !this.target && this.role.type !== 'defend' && !this.saving && Math.random() < this.skill.iq) {
      this.search = { x: mark.x, y: mark.y, z: mark.z, until: g.time + 4, sweepDir: Math.random() < 0.5 ? 1 : -1 };
    }
  }

  // ------------------------------------------------------------ perception ---
  // Recognition model: each visible enemy accumulates awareness at a rate set
  // by distance, how central they are in the view, their motion, and whether
  // the bot expected someone there. Crossing 1.0 = "I see him."
  senseEnemies() {
    const p = this.p;
    const g = this.game;
    const sk = this.skill;
    const eye = p.eyePos();
    const fwd = p.lookDir();
    let best = null, bestScore = Infinity;
    for (const e of g.players) {
      if (!e.alive || e.team === p.team) { this.aware.delete(e.id); continue; }
      let aw = this.aware.get(e.id) || 0;
      const ep = e.eyePos();
      const d2 = eye.distanceToSquared(ep);
      const d = Math.sqrt(d2);
      const maxD = e.cloakT > 0 ? sk.cloakEye : sk.sightDist;
      let visible = false;
      if (d2 < maxD * maxD && p.blindT <= 0.75) {
        V.subVectors(ep, eye).divideScalar(d || 1);
        const centr = V.dot(fwd);
        if (centr > sk.fovDot || d < 3.2) {
          const chest = e.pos.y + e.body.height * 0.6;
          const clear = (ty) => g.world.segmentClear(eye.x, eye.y, eye.z, e.pos.x, ty, e.pos.z)
            && !g.effects.smokeBlocks(eye.x, eye.y, eye.z, e.pos.x, ty, e.pos.z);
          if (clear(ep.y) || clear(chest)) {
            visible = true;
            // recognition rate, per second
            let rate = sk.noticeMul * 4.0 / (1 + (d / 17) ** 2);
            rate *= 0.45 + 0.55 * clamp((centr - sk.fovDot) / (1 - sk.fovDot), 0, 1); // periphery is slow
            const flashRead = p.blindT > 0 ? clamp(1 - p.blindT / 0.8, 0.12, 1) : 1;
            rate *= flashRead;                                                        // whiteout makes reacquisition mushy
            if (e.horizSpeed > 2.4 || e.charge || e.bloom > 0.3) rate *= 1.6;          // motion and muzzle flashes pop
            else if (e.crouching) rate *= 0.55;                                        // a still croucher blends in
            if (this.expected(e.pos, 8)) rate *= 3;                                    // "I KNEW someone was there"
            if (d < 7) rate = Math.max(rate, 3.6 * flashRead);                         // in your face
            aw = Math.min(1.5, aw + rate * 0.13);
          }
        }
      }
      if (!visible) aw = Math.max(0, aw - 0.13 * (aw >= 1 ? 0.55 : 1.7)); // confirmed contacts fade slower
      if (aw <= 0) this.aware.delete(e.id);
      else this.aware.set(e.id, aw);

      if (visible && aw >= 1) {
        // target priority: smart bots shoot what MATTERS
        let score = d;
        if (sk.iq > 0.35) {
          if (g.relic.defuser === e) score *= 0.2;
          if (e.hasRelic) score *= 0.55;
          if (e.health < 35) score *= 0.65;
        }
        if (e === this.target) score *= 0.7; // target stickiness
        if (score < bestScore) { bestScore = score; best = e; }
      }
    }
    return best;
  }

  // is there fresh team intel about an enemy near this position?
  expected(pos, r) {
    const mem = this.game.teamMemory[this.p.team];
    for (const m of mem.values()) {
      if (this.game.time - m.t < 3.5 && (m.x - pos.x) ** 2 + (m.z - pos.z) ** 2 < r * r) return true;
    }
    return false;
  }

  // schedule the orient → fire pipeline for a fresh engagement
  beginReaction(enemy) {
    const p = this.p;
    const g = this.game;
    const sk = this.skill;
    const ep = enemy.eyePos();
    const eye = p.eyePos();
    V.subVectors(ep, eye).normalize();
    const centr = V.dot(p.lookDir());
    let rt = Math.max(0.05, sk.reactMean + grand() * sk.reactStd);
    if (centr < 0.15) rt *= sk.surprise;          // jumped from behind/side
    if (this.expected(enemy.pos, 8)) rt *= 0.55;  // pre-aimed and waiting
    if (p.staggerT > 0 || p.slowT > 0) rt *= 1.2; // rattled
    this.orientAt = g.time + rt * 0.35;
    this.reactAt = g.time + rt;
    // the flick: snap overshoots past the target, then settles
    const idealYaw = yawTo(eye, ep);
    const need = angDiff(p.yaw, idealYaw);
    this.aimErr.yaw = need * sk.flick * rand(0.6, 1.3) + grand() * 2.5 * DEG;
    this.aimErr.pitch = grand() * (1 + sk.flick * 4) * DEG;
    this.headIntent = Math.random() < sk.headBias;
    this.leadBias = grand();
  }

  // watch for bolts that are about to hit ME, and for charging Avadas
  threatScan(enemy) {
    const p = this.p;
    const g = this.game;
    const sk = this.skill;
    if (g.time < this.threatCd) return;
    const eye = p.eyePos();
    const cy = eye.y - 0.3;
    for (const pr of g.spells.projectiles) {
      if (pr.owner.team === p.team) continue;
      if (pr.spell.dmg < 15 && !pr.spell.freeze && !pr.spell.disarm && !pr.spell.snare && !pr.spell.silence) continue;
      const sp2 = pr.vx * pr.vx + pr.vy * pr.vy + pr.vz * pr.vz;
      if (sp2 < 1) continue;
      // closest approach to my chest within the next beat
      const dx = eye.x - pr.x, dyy = cy - pr.y, dz = eye.z - pr.z;
      const tStar = (dx * pr.vx + dyy * pr.vy + dz * pr.vz) / sp2;
      if (tStar < 0.08 || tStar > 0.6) continue;
      const mx = pr.x + pr.vx * tStar - eye.x;
      const my = pr.y + pr.vy * tStar - cy;
      const mz = pr.z + pr.vz * tStar - eye.z;
      if (mx * mx + my * my + mz * mz > 1.6 * 1.6) continue;
      this.threatCd = g.time + 1.0;
      if (Math.random() < sk.iq * 0.85 && p.mana > 12 && p.disarmT <= 0) {
        // a PERFECT parry is a deliberate, risky read — rare even for legends.
        // The default reflex is to get the shield up as early as possible,
        // which lands OUTSIDE the parry window and just blocks.
        const parryTry = Math.random() < sk.iq * 0.18 && tStar > SPELLS.protego.parry * 0.8;
        const delay = parryTry
          ? Math.max(0.02, tStar - SPELLS.protego.parry * rand(0.3, 0.8))
          : Math.min(sk.shieldReact * rand(0.45, 0.8), tStar * 0.55);
        if (delay < tStar + 0.15) { // only if the hands are fast enough to matter
          this.shieldAt = g.time + delay;
          this.shieldUntil = this.shieldAt + rand(0.35, 0.75);
          this.parryIntent = parryTry;
        }
      } else {
        this.dodgeUntil = g.time + rand(0.3, 0.5);
        this.dodgeDir = Math.random() < 0.5 ? -1 : 1;
      }
      return;
    }
    // green light gathering at a wand tip means GET OFF THE LINE
    if (enemy?.charge && sk.iq > 0.3 && Math.random() < sk.iq * 0.4) {
      this.dodgeUntil = g.time + rand(0.4, 0.7);
      this.dodgeDir = Math.random() < 0.5 ? -1 : 1;
      this.threatCd = g.time + 1.4;
    }
  }

  // a sound reached this bot's ears (called from game.noise)
  onNoise(pos, radius, team) {
    const g = this.game;
    const p = this.p;
    this.thinkT = Math.min(this.thinkT, 0.06);
    const d = Math.hypot(pos.x - p.pos.x, pos.z - p.pos.z);
    const err = 1 + d * 0.1;
    this.heard = { x: pos.x + rand(-err, err), y: pos.y, z: pos.z + rand(-err, err), t: g.time, loud: radius };
    // big teamless bangs pull roamers in to investigate
    if (!this.target && !team && radius >= 16 && this.role.type !== 'defend' && !this.search &&
        !this.saving && Math.random() < this.skill.iq * 0.6) {
      this.search = { x: this.heard.x, y: this.heard.y, z: this.heard.z, until: g.time + 4, sweepDir: Math.random() < 0.5 ? 1 : -1 };
    }
  }

  tradeOpportunity() {
    const p = this.p;
    if (this.ai.team < 0.35 || p.hasRelic || this.saving) return null;
    for (const d of this.game.recentDeaths) {
      if (d.team !== p.team || this.game.time - d.t > 3) continue;
      const dist = Math.hypot(p.pos.x - d.x, p.pos.z - d.z);
      if (dist > 6 && dist < 22 && Math.random() < this.ai.team) {
        return { x: d.killerX ?? d.x, y: d.y, z: d.killerZ ?? d.z };
      }
    }
    return null;
  }

  // Seeing a teammate's corpse tells the whole team something is wrong there.
  noticeCorpses() {
    const p = this.p;
    const g = this.game;
    const eye = p.eyePos();
    const seeR = this.skill.sightDist * 0.4;
    for (const d of g.recentDeaths) {
      if (d.team !== p.team) continue;
      const age = g.time - d.t;
      if (age > 9 || this.seenCorpses.has(d.t)) continue;
      const dist2 = (p.pos.x - d.x) ** 2 + (p.pos.z - d.z) ** 2;
      if (dist2 > seeR * seeR) continue;
      if (!g.world.segmentClear(eye.x, eye.y, eye.z, d.x, d.y + 0.4, d.z)) continue;
      this.seenCorpses.add(d.t);
      // mark the likely killer position for the whole team
      if (d.killerX != null) {
        g.teamMemory[p.team].set(`corpse${d.t}`, { x: d.killerX, y: d.y, z: d.killerZ, t: g.time, name: 'killer' });
        g.radio(p, `Wizard down near ${g.areaName(d.x, d.z)} — eyes up!`, 0.45);
      }
      this.thinkT = 0.03; // snap alert
    }
  }

  // Serpents are small, fast and venomous: strafe off their line and burn them down.
  snakeDefense(enemy) {
    const p = this.p;
    const g = this.game;
    if (!g.summons.length) return false;
    let snake = null, bd = 13 * 13;
    for (const s of g.summons) {
      if (s.team === p.team || s.hp <= 0) continue;
      const d2 = (p.pos.x - s.x) ** 2 + (p.pos.z - s.z) ** 2;
      if (d2 < bd && (s.target === p || d2 < 8 * 8)) { snake = s; bd = d2; }
    }
    if (!snake) return false;
    // an armed human enemy in sight is still the bigger threat
    if (enemy && enemy.eyePos().distanceToSquared(p.eyePos()) < bd * 2.5) return false;
    const ctrl = p.ctrl;
    const away = V.set(p.pos.x - snake.x, 0, p.pos.z - snake.z).normalize();
    ctrl.moveX = away.x; ctrl.moveZ = away.z;
    this.aimYaw = yawTo(p.eyePos(), V.set(snake.x, snake.y + 0.2, snake.z));
    const dh = Math.hypot(snake.x - p.pos.x, snake.z - p.pos.z);
    this.aimPitch = Math.atan2(snake.y + 0.2 - p.eyePos().y, Math.max(dh, 0.01));
    if (p.curSpell !== p.slot1() && !p.charge) { p.curSpell = p.slot1(); }
    ctrl.castHeld = p.disarmT <= 0;
    return true;
  }

  // -------------------------------------------------------------- combat ---
  engage(enemy) {
    const p = this.p;
    const g = this.game;
    const ctrl = p.ctrl;
    const sk = this.skill;
    const ai = this.ai;
    const eye = p.eyePos();
    const ep = enemy.eyePos();
    const dist = eye.distanceTo(ep);
    const oriented = g.time >= this.orientAt;

    // panic check: cowards bail out of losing duels, berserkers never do
    const panicHp = 14 + 30 * (1 - ai.aggro);
    if (p.health < panicHp && enemy.health > p.health + 12 && ai.aggro < 0.9) {
      this.retreating = 0.9;
    }
    // silenced: the wand is dead weight — break the duel until the voice returns
    if (p.silenceT > 0.15) this.retreating = Math.max(this.retreating, p.silenceT);
    this.retreating = Math.max(0, this.retreating - 0.13);

    // choose spell — a weighted pick, committed for a short window, so a duel
    // shows real variety instead of the same bolt on repeat. Snipers still lean
    // on the Avada and hexers still favor the textbook disable, but everyone
    // rotates their threats so you get hit by different things.
    const want = this.pickCombatSpell(enemy, dist);
    const useAvada = want === 'avada';
    if (p.curSpell !== want && !p.charge && !this.execUntil) { // a utility throw in flight keeps the wand
      p.curSpell = want;
      p.fp?.onSwitch?.();
    }
    const spell = SPELLS[p.curSpell];

    // ---- the hand: flick, settle, track ----
    if (oriented) {
      // lead, misjudged in proportion to skill
      const lead = clamp(dist / spell.speed, 0, 1.2) * (1 + this.leadBias * sk.leadErr);
      const tx = enemy.pos.x + enemy.vel.x * lead;
      const tz = enemy.pos.z + enemy.vel.z * lead;
      const ty = enemy.pos.y + enemy.body.height * (this.headIntent ? 0.92 : 0.62) + enemy.vel.y * lead * 0.5;
      // tracking wander grows with target speed, own movement and range
      this.errT -= 0.13;
      if (this.errT <= 0) {
        this.errT = rand(0.13, 0.28);
        const flash = clamp(p.blindT / 0.8, 0, 1);
        const mag = sk.trackErr * DEG * (0.5
          + clamp(enemy.horizSpeed / 5.4, 0, 1.2) * 0.85
          + clamp(p.horizSpeed / 5.4, 0, 1) * 0.5
          + clamp(dist / 45, 0, 1) * 0.55) * (1 + flash * 5.5);
        this.wander.yaw = grand() * mag;
        this.wander.pitch = grand() * mag * 0.6;
        if (flash > 0) {
          const whiteout = (7 + dist * 0.16) * DEG * flash;
          this.wander.yaw += grand() * whiteout;
          this.wander.pitch += grand() * whiteout * 0.7;
        }
      }
      const flash = clamp(p.blindT / 0.8, 0, 1);
      const decay = Math.exp(-0.13 / (sk.settle * (1 + flash * 2)));
      this.aimErr.yaw = this.aimErr.yaw * decay + this.wander.yaw * (1 - decay);
      this.aimErr.pitch = this.aimErr.pitch * decay + this.wander.pitch * (1 - decay);
      const blind = 1 + flash * 8;
      this.aimYaw = yawTo(eye, V.set(tx, ty, tz)) + this.aimErr.yaw * blind;
      const dh = Math.hypot(tx - eye.x, tz - eye.z);
      this.aimPitch = Math.atan2(ty - eye.y, Math.max(dh, 0.01)) + this.aimErr.pitch * blind;
      if (spell.kind === 'lob') this.aimPitch += clamp(dist * 0.02, 0.08, 0.5);
    }

    // ---- range discipline: close the gap, don't plink across the map ----
    // Snipers reach out; everyone else has a real fighting distance. Beyond it
    // an attacker/roamer PUSHES (pathing through cover) instead of freezing in a
    // long-range staring contest — the thing that made high-skill bots feel
    // passive and statue-like. Defenders hold their angle and wait for range.
    const sniper = useAvada || p.curSpell === 'avada';
    const fireRange = sniper ? 220 : (spell.kind === 'lob' ? 34 : 42);
    const commitRange = sniper ? 220 : ai.range * 1.5 + 6;
    if (dist > commitRange && this.role.type !== 'defend' && this.retreating <= 0 &&
        p.health > 32 && spell.kind !== 'lob' && !p.charge && g.time >= this.dodgeUntil) {
      ctrl.castHeld = false;
      this.charging = false;
      this.aimYaw = yawTo(eye, ep);
      this.aimPitch = clamp(Math.atan2(ep.y - eye.y, Math.max(dist, 0.01)), -0.4, 0.4);
      this.goTo(enemy.pos.x, enemy.pos.y, enemy.pos.z, 4);
      return;
    }

    // ---- the trigger: gated by the reaction pipeline and a fire cone ----
    const ready = oriented && g.time >= this.reactAt && p.blindT <= 0.65;
    const onTarget = Math.abs(angDiff(p.yaw, this.aimYaw)) < 9 * DEG;
    if (!ready) {
      ctrl.castHeld = false;
    } else if (spell.charge) {
      this.charging = true;
      if (dist > 24 && Math.random() < 0.5) this.crouchUntil = Math.max(this.crouchUntil, g.time + 0.4);
    } else {
      // burst discipline: bursts with re-aim pauses between
      this.burstT -= 0.13;
      this.pauseT -= 0.13;
      if (this.pauseT <= 0 && this.burstT <= 0) {
        this.burstT = rand(0.35, 0.9);
        this.pauseT = this.burstT + rand(0.12, 0.6) * (1.25 - sk.strafe);
        this.headIntent = Math.random() < sk.headBias;
        if (Math.random() < 0.35) this.leadBias = grand();
      }
      ctrl.castHeld = this.burstT > 0 && onTarget && p.disarmT <= 0 && dist < fireRange;
    }

    // emergency protego (wardens hold it longer, it costs them less): commit to
    // a held window — a shield that stutters on and off blocks nothing
    if (g.time >= this.shieldUntil) ctrl.altHeld = false;
    const shieldBias = p.disc?.id === 'warden' ? 1.6 : 1;
    if (p.health < 35 && p.mana > 30 && dist < 22 && g.time >= this.shieldUntil &&
        Math.random() < sk.util * 0.12 * shieldBias) {
      this.shieldAt = g.time;
      this.shieldUntil = g.time + rand(0.6, 1.2) * (p.disc?.id === 'warden' ? 1.4 : 1);
      this.parryIntent = false;
      ctrl.castHeld = false;
      this.charging = false;
    }

    // ---- footwork ----
    this.strafeT -= 0.13;
    if (this.strafeT <= 0) {
      this.strafeT = rand(0.35, 1.1);
      this.strafeDir = -this.strafeDir;
      if (Math.random() < 0.25) this.strafeDir = 0; // brief stand
    }
    const toE = V.set(ep.x - eye.x, 0, ep.z - eye.z).normalize();
    const perp = new THREE.Vector3(-toE.z, 0, toE.x);
    let mx = perp.x * this.strafeDir * sk.strafe;
    let mz = perp.z * this.strafeDir * sk.strafe;
    if (this.retreating > 0) {
      // falling back: break for cover that kills the angle if any is close,
      // otherwise sprint straight away while spraying over the shoulder
      const cover = sk.iq > 0.35 ? this.seekCover(this.threatsNow()) : null;
      if (cover) {
        const cx = cover.x - p.pos.x, cz = cover.z - p.pos.z;
        const cl = Math.hypot(cx, cz);
        if (cl > 0.5) { mx = cx / cl; mz = cz / cl; } else { mx -= toE.x; mz -= toE.z; }
      } else { mx -= toE.x; mz -= toE.z; }
      if (p.dashCD <= 0 && p.dashT <= 0 && Math.random() < sk.iq * 0.04) p.tryDash(-toE.x, -toE.z);
      if (p.equip.broom > 0 && !p.flying) p.useEquip('broom');
      // desperate and far from help: rip the emergency portkey
      if (p.equip.portkey > 0 && p.portkeyT <= 0 && p.health < 20 && dist > 12) p.useEquip('portkey');
    } else if (ai.aggro > 0.85) {
      // berserker: always closing — and blinks the gap when it's wide open
      if (dist > ai.range) {
        mx += toE.x * 0.9; mz += toE.z * 0.9;
        if (dist > ai.range + 6 && p.dashCD <= 0 && p.dashT <= 0 && Math.random() < sk.iq * 0.05) p.tryDash(toE.x, toE.z);
      }
    } else {
      const pref = ai.range;
      // attackers can't camp a staring contest: clock pressure or a stale
      // long-range duel forces the commit (this is what breaks mid standoffs)
      const press = (this.role.type === 'attack' && g.mode !== 'dm' &&
        (g.roundT < 50 || this.visT > 10) && g.relic.state !== 'planted') || g.time < this.orderPush;
      if (press) {
        const push = 0.5 + ai.aggro * 0.5;
        mx += toE.x * push; mz += toE.z * push;
      } else if (dist < pref * 0.55) { mx -= toE.x * 0.8; mz -= toE.z * 0.8; }
      else if (dist > pref * 1.6 && !useAvada) {
        const push = 0.3 + ai.aggro * 0.6;
        mx += toE.x * push; mz += toE.z * push;
      } else if (this.role.type === 'attack' && dist > pref) {
        // drift toward preferred range so duels resolve instead of stalling
        const drift = 0.2 + ai.aggro * 0.3;
        mx += toE.x * drift; mz += toE.z * drift;
      }
    }
    // reflex dodge: hard sidestep off an incoming line — skilled wizards
    // commit it with a blink, a hard reactive dodge that can slip the bolt
    if (g.time < this.dodgeUntil) {
      mx = perp.x * this.dodgeDir * 1.25;
      mz = perp.z * this.dodgeDir * 1.25;
      if (p.dashCD <= 0 && p.dashT <= 0 && Math.random() < sk.iq * 0.06) p.tryDash(mx, mz);
    }
    // surprised wizards freeze for the first beat (deer in torchlight)
    if (!oriented) { mx = 0; mz = 0; }
    // counter-strafe: skilled hands stop to shoot straight
    if (sk.counterStrafe && ctrl.castHeld && spell.kind !== 'lob' && this.retreating <= 0 && g.time >= this.dodgeUntil) {
      mx *= 0.12; mz *= 0.12;
    }
    if (p.charge) { mx *= 0.2; mz *= 0.2; }
    ctrl.moveX = mx; ctrl.moveZ = mz;
    this.crouchT -= 0.13;
    if (this.crouchT <= 0) {
      this.crouchT = rand(0.8, 2);
      if (Math.random() < 0.2 * sk.strafe && dist > 14 && this.retreating <= 0) {
        this.crouchUntil = g.time + rand(0.7, 1.5);
      }
    }
    this.path = null; // drop path while fighting
  }

  // Weighted combat spell pick. Every owned, castable spell earns a base weight
  // so fights stay varied; the textbook moment for a hex (a charging Avada, a
  // sprinting target, a turtled shield) stacks a bonus on top. The pick is held
  // for a short window and the previous spell is penalized, so a bot rotates
  // through its kit instead of spamming one bolt the whole duel.
  pickCombatSpell(enemy, dist) {
    const p = this.p;
    const g = this.game;
    const sk = this.skill;
    const ai = this.ai;
    // never interrupt an Avada that's already charging
    if (p.charge && p.curSpell === 'avada') return 'avada';
    const usable = (id) => id === p.slot1() || p.ownsUsable(id);
    const manaOk = (id, buf = 1.15) => p.mana > g.spells.manaCost(p, SPELLS[id]) * buf;
    // hold the current pick for its window unless it has gone unusable (and
    // don't keep charging the Avada once a target has closed point-blank)
    const cur = this.combatSpell;
    if (cur && g.time < this.combatSpellUntil && !this.execUntil &&
        usable(cur) && manaOk(cur, 1.0) && !(cur === 'avada' && dist < 8)) {
      return cur;
    }

    const cand = [];
    const add = (id, w, buf = 1.15) => { if (w > 0 && usable(id) && manaOk(id, buf)) cand.push({ id, w }); };
    // the workhorse bolt — still the most common single choice, but it no longer
    // crowds out the rest of the kit
    add(p.slot1(), 1.3);
    // the Avada: at range only, weighted hard for snipers, a rare flourish for brawlers
    if (dist > 10 + 14 * (1 - ai.snipe)) add('avada', 0.5 + ai.snipe * 2.6, 1.0);
    // body-bind: lock a mid-range target down to set up the kill
    if (enemy.freezeT <= 0 && dist > 6 && dist < 32) {
      add('petrificus', 0.55 + (dist > 8 && dist < 26 ? 0.5 : 0) + sk.util * 0.5);
    }
    // snare: trip a rusher or a runner
    if (enemy.snareT <= 0 && dist > 5 && dist < 26) {
      add('impedimenta', 0.55 + (enemy.horizSpeed > 3 ? 0.8 : 0) + sk.util * 0.45);
    }
    // silence: shut down a charging Avada, a turtled shield, or the defuser
    if (enemy.silenceT <= 0 && dist < 34) {
      const ideal = enemy.charge || (enemy.shielding && dist < 24) || g.relic.defuser === enemy;
      add('silencio', 0.5 + (ideal ? 1.5 : 0) + sk.util * 0.45);
    }
    // polymorph: buy time against a dangerous duelist without fully rooting them
    if (enemy.morphT <= 0 && dist > 5 && dist < 27) {
      const ideal = enemy.curSpell === 'avada' || enemy.health > 55 || enemy.horizSpeed > 3;
      add('porcus', 0.45 + (ideal ? 0.9 : 0) + sk.util * 0.45);
    }
    // tickling hex: cheap slow to set up follow-up damage
    if (enemy.slowT <= 0 && dist > 4 && dist < 25) {
      add('rictusempra', 0.45 + (enemy.horizSpeed > 2.5 ? 0.7 : 0) + sk.util * 0.35);
    }
    // disarm: punish a charge, a shield, or a low-mana scramble (an unlimited
    // bolt, so it carries most of the non-Stupefy variety in a long fight)
    if (enemy.disarmT <= 0 && dist > 4 && dist < 28) {
      const ideal = enemy.charge || enemy.shielding || enemy.curSpell === 'avada' || enemy.mana < 28;
      add('expelliarmus', 0.7 + (ideal ? 1.2 : 0) + sk.util * 0.4);
    }
    // a lobbed shell drops a different kind of threat into brawling range
    if (dist > 9 && dist < 28) add('bombarda', 0.6 + sk.util * 0.45, 1.3);

    if (!cand.length) { this.combatSpell = p.slot1(); return p.slot1(); }
    // don't fire the exact same spell back-to-back — push the rotation along
    if (this.lastCombatSpell) for (const c of cand) if (c.id === this.lastCombatSpell) c.w *= 0.4;

    let total = 0;
    for (const c of cand) total += c.w;
    let r = Math.random() * total;
    let id = cand[cand.length - 1].id;
    for (const c of cand) { if ((r -= c.w) <= 0) { id = c.id; break; } }

    this.lastCombatSpell = this.combatSpell;
    this.combatSpell = id;
    this.combatSpellUntil = g.time + rand(0.5, 1.3);
    return id;
  }

  // CS-style execute: walking onto a contested area, throw the flash/smoke
  // FIRST, then entry. Attackers use it on the push, defenders on the retake.
  siteExecute(tx, tz, prefer) {
    const p = this.p;
    const g = this.game;
    if (g.time - this.executedAt < 22) return; // one piece of utility per push
    if (p.charge || this.execUntil) return;    // don't ruin a cast in progress
    const d = Math.hypot(p.pos.x - tx, p.pos.z - tz);
    if (d < 7 || d > 38) return;
    if (Math.random() > 0.25 + this.skill.util * 0.75) { this.executedAt = g.time - 14; return; } // hesitated — re-check soon
    const usable = (id) => p.ownsUsable(id) && p.mana > SPELLS[id].mana * 1.2;
    const opts = prefer.filter(usable);
    if (!opts.length) return;
    const id = choice(opts); // rotate through the belt instead of always the first
    this.executedAt = g.time;
    const eye = p.eyePos();
    this.charging = false;
    p.recharging = 0; // cancel the reload — the throw comes first
    this.execSpell = id;
    this.execUntil = g.time + 0.35;
    p.curSpell = id;
    this.aimYaw = yawTo(eye, V.set(tx, p.pos.y, tz));
    this.aimPitch = clamp(d * 0.018, 0.18, 0.5);
    p.ctrl.castHeld = true;
    g.radio(p, `Utility out — hitting ${g.areaName(tx, tz)}!`, 0.4);
  }

  maybeUtility(mem) {
    const p = this.p;
    const g = this.game;
    if (g.time < this.utilAt || p.charge || this.execUntil) return;
    this.utilAt = g.time + rand(5, 11);
    if (Math.random() > this.skill.util) return;
    const eye = p.eyePos();
    const d = Math.hypot(mem.x - eye.x, mem.z - eye.z);
    if (d < 8 || d > 38) return;
    const options = ['bombarda', 'lumos', 'fumos', 'incendio'].filter((id) => p.ownsUsable(id) && p.mana > SPELLS[id].mana * 1.3);
    // a serpent flushes a known camper without exposing the caster
    if (d < 24 && p.ownsUsable('serpensortia') && p.mana > SPELLS.serpensortia.mana * 1.2 && Math.random() < 0.5) {
      options.push('serpensortia');
    }
    if (!options.length) return;
    const id = choice(options);
    this.charging = false;
    p.recharging = 0;
    this.execSpell = id;
    this.execUntil = g.time + 0.35;
    p.curSpell = id;
    this.aimYaw = yawTo(eye, V.set(mem.x, mem.y, mem.z));
    this.aimPitch = id === 'serpensortia' ? 0 : clamp(d * 0.018, 0.15, 0.55);
    p.ctrl.castHeld = true;
  }

  freshMemory() {
    const mem = this.game.teamMemory[this.p.team];
    let best = null, bt = this.skill.memoryT;
    for (const m of mem.values()) {
      const age = this.game.time - m.t;
      if (age < bt) { bt = age; best = m; }
    }
    return best;
  }

  // ------------------------------------------------------------ objective ---
  objective() {
    const p = this.p;
    const g = this.game;
    const ctrl = p.ctrl;
    const role = this.role;

    if (g.mode === 'dm') {
      this.wanderT -= 0.13;
      if (!this.pathGoal || this.wanderT <= 0) {
        this.wanderT = rand(8, 16);
        const n = g.world.randomNode();
        this.setGoal(n.x, n.y, n.z);
      }
      this.followPath();
      return;
    }

    // ECO BRAIN: last wizard standing against a stacked field, no objective
    // play left — save the gear, live to buy tomorrow
    this.saveEvalT -= 0.13;
    if (this.saveEvalT <= 0) {
      this.saveEvalT = 2;
      if (!this.saving && this.skill.iq > 0.55 && !p.hasRelic && g.relic.state !== 'planted' && g.roundT < 50) {
        const mates = g.aliveOf(p.team).length;
        const foes = g.aliveOf(otherTeam(p.team)).length;
        if (mates === 1 && foes >= 3 && Math.random() < this.skill.iq) {
          this.saving = true;
          this.saveSpot = null;
          g.radio(p, 'Saving — play for the next round.', 0.6);
        }
      }
    }
    if (this.saving) {
      if (!this.saveSpot) this.saveSpot = this.pickSaveSpot();
      const face = this.saveSpot.face ?? 0;
      ctrl.walkHeld = true; // quiet feet while hiding
      this.holdAt(this.saveSpot, face);
      return;
    }

    const relic = g.relic;
    const isAttacker = g.attackingTeam === p.team;

    if (isAttacker) {
      // planted: defend the relic
      if (relic.state === 'planted') {
        const spot = this.holdSpot || this.pickHoldNear(relic.pos, 6, 13);
        this.holdSpot = spot;
        this.holdAt(spot, yawTo(p.pos, relic.pos) + Math.PI);
        return;
      }
      // dropped relic: nearest attacker fetches
      if (relic.state === 'dropped' && !relic.carrier) {
        const myD = p.pos.distanceToSquared(relic.pos);
        let nearest = true;
        for (const q of g.players) {
          if (q.alive && q !== p && q.team === p.team && !q.isHuman && q.pos.distanceToSquared(relic.pos) < myD) { nearest = false; break; }
        }
        if (nearest) {
          this.goTo(relic.pos.x, relic.pos.y, relic.pos.z, 0.8);
          this.faceWalk(relic.pos.x, relic.pos.z);
          return;
        }
      }
      if (p.hasRelic) {
        // go plant — flash the site first if the belt has something for it
        const site = g.world.zones[`site${role.site || 'A'}`];
        if (site) this.siteExecute(site.cx, site.cz, ['lumos', 'fumos', 'bombarda']);
        if (site && g.world.inRect(site, p.pos.x, p.pos.z)) {
          ctrl.moveX = 0; ctrl.moveZ = 0;
          ctrl.useHeld = true;
          ctrl.crouch = true;
          return;
        }
        // route finished but not on the site yet: walk straight onto it
        const routeDone = !role.via || !role.via.length || (role.viaIdx ?? 0) >= role.via.length;
        if (site && routeDone) {
          this.goTo(site.cx, p.pos.y, site.cz, 1.0);
          this.followPathFace();
          return;
        }
      }
      // late-round commit OR a squad-synchronized execute: stop holding and
      // converge on the target site so the hit lands together, not in a trickle
      if (relic.state === 'carried' && (this.game.roundT < 38 || (this.execAt && g.time >= this.execAt))) {
        const site = g.world.zones[`site${role.site || 'A'}`];
        if (site) {
          this.siteExecute(site.cx, site.cz, ['lumos', 'fumos', 'bombarda']);
          this.holdSpot = null;
          const ox = Math.sin(p.id * 3.7) * 4, oz = Math.cos(p.id * 2.3) * 4; // stable per-bot spread
          this.goTo(site.cx + ox, p.pos.y, site.cz + oz, 2.5);
          this.followPathFace();
          return;
        }
      }
      // push route
      this.followRoute();
    } else {
      // defender
      if (relic.state === 'planted') {
        // retake utility: burn the plant area / flash the holders, THEN walk in
        this.siteExecute(relic.pos.x, relic.pos.z, ['incendio', 'lumos', 'bombarda', 'fumos']);
        // converge & defuse
        const d = Math.hypot(p.pos.x - relic.pos.x, p.pos.z - relic.pos.z);
        if (d < 1.7) {
          ctrl.moveX = 0; ctrl.moveZ = 0;
          ctrl.useHeld = true;
          ctrl.crouch = true;
          this.aimYaw = yawTo(p.eyePos(), relic.pos);
          this.aimPitch = -0.5;
          return;
        }
        this.goTo(relic.pos.x, relic.pos.y, relic.pos.z, 1.2);
        this.faceWalk(relic.pos.x, relic.pos.z);
        if (p.equip.broom > 0 && d > 25) p.useEquip('broom');
        return;
      }
      // hold assigned spot
      if (this.holdSpot) {
        this.holdAt(this.holdSpot, this.holdFaceYaw);
        return;
      }
      this.followRoute();
    }
  }

  // a corner far from every known enemy and far from the action
  pickSaveSpot() {
    const g = this.game;
    const p = this.p;
    const mem = [...g.teamMemory[p.team].values()].filter((m) => g.time - m.t < 12);
    const sites = ['siteA', 'siteB'].map((k) => g.world.zones[k]).filter(Boolean);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const n = g.world.randomNode();
      let score = 0;
      for (const m of mem) score += Math.min(50, Math.hypot(n.x - m.x, n.z - m.z));
      for (const s of sites) score += Math.min(30, Math.hypot(n.x - s.cx, n.z - s.cz)) * 0.4;
      score -= Math.hypot(n.x - p.pos.x, n.z - p.pos.z) * 0.5; // don't sprint across the map to hide
      if (score > bestScore) { bestScore = score; best = n; }
    }
    best = best || g.world.randomNode();
    return { x: best.x, y: best.y, z: best.z, face: yawTo(best, { x: 0, z: 0 }) };
  }

  holdAt(spot, faceYaw) {
    const p = this.p;
    const g = this.game;
    // aggressive holders periodically peek forward off their angle
    if (this.peek) {
      if (g.time > this.peek.until) {
        this.peek = null;
      } else {
        this.goTo(this.peek.x, p.pos.y, this.peek.z, 1.0);
        this.faceWalk(this.peek.x, this.peek.z);
        return;
      }
    }
    const d = Math.hypot(p.pos.x - spot.x, p.pos.z - spot.z);
    if (d > 1.6) {
      this.goTo(spot.x, spot.y ?? p.pos.y, spot.z, 1.2);
      this.faceWalk(spot.x, spot.z);
    } else {
      p.ctrl.moveX = 0; p.ctrl.moveZ = 0;
      this.path = null;
      // scan around the hold angle
      this.aimYaw = faceYaw + Math.sin(this.game.time * 0.7 + this.p.id) * 0.5;
      this.aimPitch = 0;
      p.ctrl.crouch = this.skill.strafe > 0.5 && Math.sin(this.game.time * 0.3 + p.id * 2) > 0.6;
      // restless wizards shoulder-peek toward the choke they're watching
      // (hiding savers never do)
      this.peekT -= 0.13;
      if (this.peekT <= 0 && !this.saving) {
        this.peekT = rand(7, 15) * (1.2 - this.ai.aggro * 0.5);
        if (this.ai.aggro > 0.55 && Math.random() < this.ai.aggro * 0.6) {
          const px = spot.x - Math.sin(faceYaw) * rand(3, 5.5);
          const pz = spot.z - Math.cos(faceYaw) * rand(3, 5.5);
          this.peek = { x: px, z: pz, until: g.time + rand(1.2, 2.2) };
        }
      }
      // raise a guardian wall between us and a known incoming threat
      if (p.ownsUsable('patronum') && p.mana > SPELLS.patronum.mana * 1.2 && !p.charge && !this.execUntil) {
        const mem = this.freshMemory();
        if (mem && Math.hypot(mem.x - p.pos.x, mem.z - p.pos.z) < 30 && this.game.time >= this.utilAt) {
          this.utilAt = this.game.time + rand(10, 18);
          if (Math.random() < this.skill.util) {
            this.charging = false;
            p.recharging = 0;
            this.execSpell = 'patronum';
            this.execUntil = this.game.time + 0.35;
            p.curSpell = 'patronum';
            this.aimYaw = yawTo(p.eyePos(), V.set(mem.x, mem.y, mem.z));
            this.aimPitch = 0.3;
            p.ctrl.castHeld = true;
          }
        }
      }
    }
  }

  // fresh remembered enemy positions (plus a live target) for danger-aware moves
  threatsNow() {
    const g = this.game, p = this.p, out = [];
    const mem = g.teamMemory[p.team];
    if (mem) for (const m of mem.values()) {
      if (m.name === 'Relic') continue; // the bomb isn't shooting at anyone
      if (g.time - m.t < 6) out.push(m);
    }
    if (this.target?.alive) out.push({ x: this.target.pos.x, y: this.target.pos.y, z: this.target.pos.z });
    return out;
  }

  // nearest reachable nav node that breaks line of sight to the known threats
  // and doesn't walk us closer to them — cached briefly to avoid path churn
  seekCover(threats) {
    const g = this.game, p = this.p;
    if (this.coverPos && g.time < this.coverT) return this.coverPos;
    this.coverT = g.time + 0.6;
    if (!threats || !threats.length) { this.coverPos = null; return null; }
    const nodes = g.world.nodesNear(p.pos.x, p.pos.y, p.pos.z, 11);
    let best = null, bestScore = -Infinity;
    for (const n of nodes) {
      const nd = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
      if (nd < 1.5) continue;
      let covered = true, minThreat = Infinity;
      for (const t of threats) {
        const ty = (t.y ?? p.pos.y) + 1.1;
        if (g.world.segmentClear(n.x, n.y + 1.1, n.z, t.x, ty, t.z)) { covered = false; break; }
        minThreat = Math.min(minThreat, Math.hypot(n.x - t.x, n.z - t.z));
      }
      if (!covered) continue;
      const score = minThreat - nd * 0.6; // close cover that keeps the gap
      if (score > bestScore) { bestScore = score; best = n; }
    }
    this.coverPos = best ? { x: best.x, y: best.y, z: best.z } : null;
    return this.coverPos;
  }

  pickHoldNear(pos, rMin, rMax) {
    const nodes = this.game.world.nodesNear(pos.x, pos.y, pos.z, rMax);
    const ok = nodes.filter((n) => Math.hypot(n.x - pos.x, n.z - pos.z) > rMin);
    const pool = ok.length ? ok : nodes;
    if (!pool.length) return { x: pos.x, y: pos.y, z: pos.z };
    // after contact, favour a spot that still holds the angle but sits in cover
    const threats = this.threatsNow();
    if (threats.length) {
      const covered = pool.filter((n) => threats.some((t) =>
        !this.game.world.segmentClear(n.x, n.y + 1.1, n.z, t.x, (t.y ?? n.y) + 1.1, t.z)));
      if (covered.length) { const c = choice(covered); return { x: c.x, y: c.y, z: c.z }; }
    }
    const n = choice(pool);
    return { x: n.x, y: n.y, z: n.z };
  }

  followRoute() {
    const p = this.p;
    const role = this.role;
    if (!role.via || !role.via.length) {
      // fallback wander toward site
      const site = this.game.world.zones[`site${role.site || 'A'}`];
      if (site) {
        this.goTo(site.cx, p.pos.y, site.cz, 2.5);
        this.followPathFace();
      }
      return;
    }
    if (role.viaIdx === undefined) role.viaIdx = 0;
    // staggered execute: cautious attackers pause at the first waypoint while
    // the entry players draw attention (skipped once the clock runs down)
    if (role.viaIdx === 1 && this.game.time < this.goSlowUntil && this.game.roundT > 45 && !p.hasRelic) {
      p.ctrl.moveX = 0; p.ctrl.moveZ = 0;
      this.path = null;
      const [nx, nz] = role.via[Math.min(role.viaIdx, role.via.length - 1)];
      this.aimYaw = yawTo(p.pos, V.set(nx, p.pos.y, nz)) + Math.sin(this.game.time * 0.9 + p.id) * 0.4;
      return;
    }
    // closing on the site: flash/smoke the entry like a real execute
    if (this.role.type === 'attack' && role.viaIdx >= role.via.length - 2 && this.game.roundT > 8) {
      const site = this.game.world.zones[`site${role.site || 'A'}`];
      if (site) this.siteExecute(site.cx, site.cz, ['lumos', 'fumos', 'bombarda']);
    }
    if (role.viaIdx >= role.via.length) {
      // arrived: attackers without relic take a hold spot near site
      const site = this.game.world.zones[`site${role.site || 'A'}`];
      const center = site ? new THREE.Vector3(site.cx, p.pos.y, site.cz) : p.pos;
      if (!this.holdSpot) this.holdSpot = this.pickHoldNear(center, 3, 11);
      this.holdAt(this.holdSpot, yawTo(p.pos, center) + (Math.random() < 0.5 ? 0.6 : -0.6));
      return;
    }
    const [vx, vz] = role.via[role.viaIdx];
    const d = Math.hypot(p.pos.x - vx, p.pos.z - vz);
    if (d < 3.2) {
      role.viaIdx++;
      this.pathGoal = null;
      return;
    }
    this.goTo(vx, p.pos.y, vz, 2.2);
    this.followPathFace();
  }

  // ------------------------------------------------------------- pathing ---
  setGoal(x, y, z) {
    this.pathGoal = { x, y, z };
    this.path = this.game.world.findPath(this.p.pos.x, this.p.pos.y, this.p.pos.z, x, y, z);
    this.pathIdx = 0;
    this.repathT = 3;
  }

  goTo(x, y, z, tol = 1.5) {
    this.repathT -= 0.13;
    if (!this.pathGoal || Math.hypot(this.pathGoal.x - x, this.pathGoal.z - z) > tol + 1 || this.repathT <= 0 || !this.path) {
      this.setGoal(x, y, z);
    }
    this.followPath();
  }

  followPath() {
    const p = this.p;
    const ctrl = p.ctrl;
    if (!this.path || !this.path.length) {
      // straight-line fallback
      if (this.pathGoal) {
        V.set(this.pathGoal.x - p.pos.x, 0, this.pathGoal.z - p.pos.z);
        if (V.lengthSq() > 1) {
          V.normalize();
          ctrl.moveX = V.x; ctrl.moveZ = V.z;
        }
      }
      return;
    }
    // advance waypoints
    while (this.pathIdx < this.path.length) {
      const n = this.path[this.pathIdx];
      const dx = n.x - p.pos.x, dz = n.z - p.pos.z;
      const dy = n.y - p.pos.y;
      if (dx * dx + dz * dz < (n.ladder ? 0.5 : 1.2) && Math.abs(dy) < 1.6) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= this.path.length) {
      this.path = null;
      return;
    }
    const n = this.path[this.pathIdx];
    // lookahead smoothing
    let ti = this.pathIdx;
    if (!n.ladder) {
      for (let k = this.pathIdx + 1; k < Math.min(this.path.length, this.pathIdx + 4); k++) {
        const m = this.path[k];
        if (m.ladder || Math.abs(m.y - p.pos.y) > 0.7) break;
        const eyeY = p.pos.y + 1.1;
        if (this.game.world.segmentClear(p.pos.x, eyeY, p.pos.z, m.x, m.y + 1.1, m.z)) ti = k;
        else break;
      }
    }
    const tn = this.path[ti];
    V.set(tn.x - p.pos.x, 0, tn.z - p.pos.z);
    const d = V.length();
    if (d > 0.05) {
      V.divideScalar(d);
      p.ctrl.moveX = V.x; p.ctrl.moveZ = V.z;
    }
    // ladder traversal
    const next = this.path[Math.min(ti + 1, this.path.length - 1)];
    if (tn.ladder || (next && next.ladder)) {
      const climbingUp = next && next.y > p.pos.y + 0.6;
      const target = tn.ladder ? tn : next;
      if (Math.abs(target.y - p.pos.y) > 0.7 || climbingUp) {
        p.ctrl.climbF = 1;
        this.aimPitch = target.y > p.pos.y ? 0.7 : -0.7;
        this.aimYaw = yawTo(p.pos, V.set(target.x, target.y, target.z));
      }
    }
  }

  followPathFace() {
    const p = this.p;
    // face along path lookahead
    if (this.path && this.pathIdx < this.path.length) {
      const li = Math.min(this.path.length - 1, this.pathIdx + 3);
      const n = this.path[li];
      this.aimYaw = yawTo(p.eyePos(), V.set(n.x, n.y + 1.4, n.z));
      this.aimPitch *= 0.8;
    } else if (Math.abs(p.ctrl.moveX) + Math.abs(p.ctrl.moveZ) > 0.1) {
      this.aimYaw = Math.atan2(-p.ctrl.moveX, -p.ctrl.moveZ);
      this.aimPitch *= 0.8;
    }
  }

  faceWalk(x, z) {
    this.followPathFace();
  }
}
