// Match orchestration: round state machine, economy, Cursed Relic objective,
// halftime swaps, MVP, deathmatch, spectating, camera, perf governor.
import * as THREE from 'three';
import { SPELLS, CHARACTERS, BOT_NAMES, TEAM, TEAM_INFO, otherTeam, ECON, ROUND, DIFFICULTIES, FORMATS, GRENADES, EQUIP_EFFECTS, wandById, equipById, charById, aiProfile } from './data.js';
import { MAP_BUILDERS } from './maps/index.js';
import { bakeRadar } from './mapbuilder.js';
import { World } from './world.js';
import { Particles } from './particles.js';
import { Effects } from './effects.js';
import { Environment } from './env.js';
import { SpellSystem } from './spells.js';
import { Player, Rig, FPRig } from './player.js';
import { Bot } from './bot.js';
import { Feedback } from './feedback.js';
import { Comms } from './comms.js';
import { Squad } from './squad.js';
import { clamp, rand, choice, shuffle, yawTo } from './utils.js';

export class Game {
  constructor(app, setup) {
    this.app = app;
    this.setup = setup;
    this.scene = app.scene;
    this.camera = app.camera;
    this.audio = app.audio;
    this.input = app.input;
    this.hud = app.hud;
    this.settings = app.settings;
    this.postfx = app.postfx || null;

    this.mode = setup.mode; // 'relic' | 'dm'
    this.dmBanned = new Set(setup.dmBanned || []);
    this.dmKillTarget = clamp(Number(setup.dmKillTarget) || ROUND.dmKillTarget, 1, 999);
    this.format = FORMATS.find((f) => f.id === (setup.format || 'mr8'));
    // difficulty: preset axes, or the player's own slider mix
    const preset = DIFFICULTIES.find((d) => d.id === setup.difficulty);
    if (setup.difficulty === 'custom') {
      const axes = { reflex: 50, aim: 50, sense: 50, iq: 50, ...(setup.aiCustom || {}) };
      this.difficulty = { id: 'custom', name: 'Custom', axes };
    } else {
      this.difficulty = preset || DIFFICULTIES[1];
    }
    this.aiProfile = aiProfile(this.difficulty.axes);

    // map
    const built = MAP_BUILDERS[setup.mapId](this.scene);
    this.world = built.world;
    this.mapGroup = built.group;
    this.mapMeta = built.meta;
    this.world.buildNav(1.5);
    this.radar = bakeRadar(this.world);

    this.particles = new Particles(this.scene);
    this.effects = new Effects(this.scene, this.particles, this.audio);
    this.effects.world = this.world; // ground queries for dropped wands
    this.spells = new SpellSystem(this);
    this.heartT = 0;
    this.firstBloodDone = false;

    this.time = 0;
    this.frozen = false;
    this.paused = false;
    this.over = false;
    this.state = 'freeze';
    this.stateT = 0;
    this.roundT = 0;
    this.buyT = 0;
    this.roundNum = 0;
    this.score = { order: 0, death: 0 };
    this.lossStreak = { order: 0, death: 0 };
    this.roundHistory = [];
    this.attackingTeam = TEAM.DEATH;
    this.teamMemory = { order: new Map(), death: new Map() };
    this.recentDeaths = []; // {team, x, y, z, killerX, killerZ, t} — bots trade off these
    this.relic = { state: 'idle', carrier: null, pos: new THREE.Vector3(), fuseT: 0, planter: null, plantProgress: 0, defuseProgress: 0, defuser: null, beepT: 0, warned: false };
    this.feedback = new Feedback(this); // trauma shake, camera kicks, bloom swells
    this.comms = new Comms(this); // voice barks + the teammate radio feed
    this.squads = { order: new Squad(this, TEAM.ORDER), death: new Squad(this, TEAM.DEATH) };
    // cinematic time control: hitstop freezes the sim for a beat; slow-mo
    // stretches the marquee moments. Disabled under ?auto so tests stay exact.
    this.timeScale = 1; this.hitstopT = 0; this.slowmoT = 0; this.slowmoScale = 1;
    this.autoMode = (typeof location !== 'undefined' && new URLSearchParams(location.search).has('auto'));
    this.spectIdx = 0;
    this.deathCamT = 0;
    this.specActive = false; // death overlay cleared, now showing the spectate view
    this.summons = [];   // conjured serpents
    this.drops = [];     // lootable items from the fallen
    this.pings = [];     // player ping markers {x,y,z,t,kind}
    this.radioT = 0;     // teammate callout rate limiter
    this.baseFov = this.camera.fov;
    this.fovCur = this.camera.fov;
    this.dmTimer = ROUND.dmTime;
    this.endBanner = null;
    this.fpsAcc = 0; this.fpsN = 0; this.qualT = 0;
    this.humanSeeT = 0;
    this.defuseSound = null;
    this.plantTickT = 0;

    this.env = new Environment(this); // breakables, barrels, dragon, ambient life
    this.buildPlayers();
    this.hud.bind(this);
    this.audio.ambient(this.mapMeta.theme);

    if (this.mode === 'dm') this.startDeathmatch();
    else this.startRound(true);
  }

  // -------------------------------------------------------------- players ---
  buildPlayers() {
    const s = this.setup;
    this.players = [];
    const usedChars = new Set([s.charId]);
    const usedNames = new Set();

    this.human = new Player(this, { name: 'You', charId: s.charId, team: s.team, isHuman: true, prefWand: s.prefWand, discipline: s.discipline });
    this.human.money = ECON.start;
    this.human.fp = new FPRig(this.camera, this.human.char, this.human.team);
    this.players.push(this.human);

    // hand-picked lineups fill first; leftover slots auto-fill with that
    // team's own side, then anyone unused, then named stand-in bots
    const mkBots = (team, count, picks = []) => {
      const queue = picks.filter((id) => charById(id) && !usedChars.has(id));
      for (const id of queue) usedChars.add(id);
      const extras = BOT_NAMES[team].filter(([n]) => !usedNames.has(n));
      for (let i = 0; i < count; i++) {
        let name, charId;
        const pool = CHARACTERS.filter((c) => c.side === team && !usedChars.has(c.id));
        const anyPool = CHARACTERS.filter((c) => !usedChars.has(c.id));
        if (queue.length) {
          charId = queue.shift();
          name = charById(charId).short;
        } else if (pool.length || anyPool.length) {
          const c = (pool.length ? pool : anyPool).shift();
          name = c.short;
          charId = c.id;
          usedChars.add(c.id);
        } else {
          const [n, cid] = extras.shift() || [`Bot${i}`, 'harry'];
          name = n;
          charId = cid;
        }
        usedNames.add(name);
        const p = new Player(this, { name, charId, team });
        p.money = ECON.start;
        p.rig = new Rig(this.scene, p);
        p.bot = new Bot(p, this, this.aiProfile);
        this.players.push(p);
      }
    };
    mkBots(s.team, clamp(s.botsFriendly, 0, 4), s.squad);
    mkBots(otherTeam(s.team), clamp(s.botsEnemy, 0, 5), s.foes);
  }

  teamPlayers(team) { return this.players.filter((p) => p.team === team); }
  aliveOf(team) { return this.players.filter((p) => p.team === team && p.alive); }
  defendingTeam() { return otherTeam(this.attackingTeam); }

  // --------------------------------------------------------------- rounds ---
  startRound(first = false) {
    this.roundNum++;
    this.state = 'freeze';
    this.stateT = ROUND.freeze;
    this.roundT = ROUND.time;
    this.buyT = ROUND.buyWindow + ROUND.freeze;
    this.frozen = true;
    this.endBanner = null;
    this.comms.reset();
    this.pings.length = 0;
    this.spells.clear();
    this.effects.clear();
    this.particles.clear();
    this.clearSummons();
    this.clearDrops();
    this.env.onRoundStart(); // rebuild broken cover, relight torches, reset the snitch
    this.firstBloodDone = false;
    this.teamMemory.order.clear();
    this.teamMemory.death.clear();
    this.relic = { state: 'idle', carrier: null, pos: new THREE.Vector3(), fuseT: 0, planter: null, plantProgress: 0, defuseProgress: 0, defuser: null, beepT: 0, warned: false };
    this.defuseSound?.stop(); this.defuseSound = null;

    // spawn by role: attackers use the map's T spawns ("death"), defenders the CT spawns
    const spawnFor = (team) => this.attackingTeam === team ? this.world.spawns.death : this.world.spawns.order;
    for (const team of [TEAM.ORDER, TEAM.DEATH]) {
      const pts = shuffle(spawnFor(team));
      const members = this.teamPlayers(team);
      members.forEach((p, i) => {
        if (p.lostLoadout) { p.resetLoadout(); p.lostLoadout = false; }
        p.roundPerks(); // character round-start grants (Ginny, Wormtail…)
        const sp = pts[i % pts.length];
        p.spawnAt(sp.x + rand(-0.5, 0.5), sp.z + rand(-0.5, 0.5), sp.yaw, this.world);
        p.roundDmg = 0; p.roundKills = 0; p.objScore = 0;
      });
    }

    // relic carrier among attackers
    const attackers = this.aliveOf(this.attackingTeam);
    if (attackers.length) {
      const carrier = choice(attackers);
      carrier.hasRelic = true;
      this.relic.state = 'carried';
      this.relic.carrier = carrier;
      if (carrier.isHuman) this.hud.notice('You carry the CURSED RELIC — plant it at site A or B (hold E)', 'obj');
    }

    // bot roles + buying — the squad coordinator picks one team plan, hands
    // out complementary roles, and triggers the buy (replacing the old
    // independent per-bot route roll)
    this.recentDeaths.length = 0;
    this.squads[this.attackingTeam].planRound();
    this.squads[this.defendingTeam()].planRound();

    // human UI
    this.hud.closeDeath();
    this.audio.setMuffle(0, 0.1); // clear any lingering flash/blast deafness
    this.hud.announce(`ROUND ${this.roundNum}`, this.roundDescriptor(), 'round');
    this.audio.stinger('round_start');
    if (!first || true) this.hud.openBuy(true);
    const matchPoint = Math.max(this.score.order, this.score.death) === this.format.winTarget - 1;
    if (matchPoint) setTimeout(() => { if (!this.over) { this.hud.announce('MATCH POINT', '', 'warn'); this.audio.stinger('match_point'); } }, 1800);
  }

  roundDescriptor() {
    const att = TEAM_INFO[this.attackingTeam].short;
    return `${att} attack — plant the Cursed Relic at A or B`;
  }

  startDeathmatch() {
    this.state = 'live';
    this.frozen = false;
    this.dmTimer = ROUND.dmTime;
    for (const p of this.players) {
      this.dmLoadout(p);
      this.dmSpawn(p);
    }
    this.hud.announce('DEATHMATCH WARM-UP', `Team deathmatch — first to ${this.dmKillTarget} kills wins`, 'round');
    this.audio.stinger('round_start');
  }

  teamKills(team) {
    return this.teamPlayers(team).reduce((sum, p) => sum + p.kills, 0);
  }

  deathmatchScore() {
    return {
      [TEAM.ORDER]: this.teamKills(TEAM.ORDER),
      [TEAM.DEATH]: this.teamKills(TEAM.DEATH),
    };
  }

  deathmatchWinner(requireTarget = false) {
    const score = this.deathmatchScore();
    const high = Math.max(score[TEAM.ORDER], score[TEAM.DEATH]);
    if (requireTarget && high < this.dmKillTarget) return null;
    if (score[TEAM.ORDER] === score[TEAM.DEATH]) return null;
    return score[TEAM.ORDER] > score[TEAM.DEATH] ? TEAM.ORDER : TEAM.DEATH;
  }

  dmLoadout(p) {
    p.resetLoadout();
    p.roundPerks();
    p.wand = wandById('holly');
    const giveSpell = (id, charges = null) => {
      if (this.dmBanned.has(id)) return;
      p.owned.add(id);
      if (charges != null) p.charges[id] = charges;
    };
    giveSpell('bombarda', 2);
    giveSpell('lumos', 2);
    giveSpell('fumos', 2);
    giveSpell('incendio', 1);
    giveSpell('episkey', 2);
    giveSpell('petrificus', 1);
    giveSpell('impedimenta', 2);
    giveSpell('silencio', 1);
    giveSpell('porcus', 1);
    giveSpell('rictusempra', 2);
    giveSpell('patronum', 1);
    giveSpell('serpensortia', 1);
    giveSpell('avada');
    if (!this.dmBanned.has('potion')) p.equip.potion = 1;
    if (!this.dmBanned.has('finite')) p.equip.finite = 1;
    p.ensureValidSpell();
  }

  dmSpawn(p) {
    const spawnPool = this.world.dmSpawns?.length
      ? this.world.dmSpawns
      : [...(this.world.spawns.death || []), ...(this.world.spawns.order || [])];
    const pts = shuffle(spawnPool);
    for (let tries = 0; tries < pts.length; tries++) {
      const sp = pts[tries];
      let nearest = Infinity;
      for (const q of this.players) {
        if (q !== p && q.alive) nearest = Math.min(nearest, (q.pos.x - sp.x) ** 2 + (q.pos.z - sp.z) ** 2);
      }
      if (nearest > 14 * 14 || tries === pts.length - 1) {
        p.spawnAt(sp.x, sp.z, sp.yaw ?? rand(0, Math.PI * 2), this.world);
        this.dmLoadout(p);
        p.spawnProtT = 3;
        if (p.isHuman) this.hud.notice('Spawn protection — 3s or until you cast', 'info');
        return;
      }
    }
  }

  // -------------------------------------------------------------- economy ---
  buy(p, kind, id) {
    if (this.mode === 'dm') return false;
    const inWindow = this.state === 'freeze' || (this.state === 'live' && this.buyT > 0);
    const zone = this.world.zones.buy[this.attackingTeam === p.team ? 'death' : 'order'];
    const inZone = this.state === 'freeze' || this.world.inRect(zone, p.pos.x, p.pos.z);
    if (!inWindow || !inZone || !p.alive) {
      if (p.isHuman) this.audio.ui('deny');
      return false;
    }
    let price = 0, apply = null;
    if (kind === 'wand') {
      const w = wandById(id);
      if (!w || p.wand.id === id) return false;
      price = w.price;
      apply = () => { p.wand = w; };
    } else if (kind === 'spell') {
      const sp = SPELLS[id];
      if (!sp) return false;
      if (sp.charges && (p.charges[id] || 0) >= p.chargeCap(sp)) return false;
      if (!sp.charges && p.owned.has(id)) return false;
      price = sp.price;
      apply = () => {
        p.owned.add(id);
        if (sp.charges) p.charges[id] = p.chargeCap(sp);
      };
    } else if (kind === 'equip') {
      const eq = equipById(id);
      if (!eq || p.equip[id] >= eq.max) return false;
      price = eq.price;
      apply = () => {
        p.equip[id] = Math.min(eq.max, p.equip[id] + 1);
        if (id === 'vest') p.vestHP = EQUIP_EFFECTS.vest.pool;
      };
    }
    price = Math.round(price * (kind === 'equip' ? p.equipPriceMult() : p.priceMult()));
    if (p.money < price) {
      if (p.isHuman) this.audio.ui('deny');
      return false;
    }
    p.money -= price;
    apply();
    if (p.isHuman) {
      this.audio.ui('buy');
      this.hud.refreshBuy();
      this.hud.refreshEquip();
    }
    return true;
  }

  award(team, amount) {
    for (const p of this.teamPlayers(team)) p.money = clamp(p.money + amount, 0, ECON.cap);
  }

  // --------------------------------------------------------------- combat ---
  damage(victim, attacker, amount, spell, isHS = false, hitPos = null, silent = false) {
    if (!victim.alive || this.over) return;
    if (attacker && attacker !== victim && attacker.team === victim.team) return;
    if (victim.spawnProtT > 0 && attacker && attacker !== victim) {
      if (attacker.isHuman && !silent) this.hud.notice('Target is spawn-protected', 'info');
      return;
    }
    // Neville digs in when cornered: 12% less damage below 35% health
    if (victim.char.id === 'neville' && victim.health <= victim.stats.hp * 0.35) amount *= 0.88;
    // Dragonhide Vest: soaks a portion of each hit until its pool is spent
    if (victim.vestHP > 0 && victim.equip.vest > 0 && amount > 0) {
      const soaked = Math.min(victim.vestHP, amount * EQUIP_EFFECTS.vest.soak);
      amount -= soaked;
      victim.vestHP -= soaked;
      if (victim.vestHP <= 0) {
        victim.equip.vest = 0;
        this.effects.vestBreakFX?.(victim);
        if (victim.isHuman) this.hud.notice('Dragonhide vest destroyed!', 'bad');
      }
      if (victim.isHuman) this.hud.refreshEquip();
    }
    // Felix Felicis: the killing blow misses something vital — once
    if (victim.equip.felix > 0 && victim.health - amount <= 0) {
      victim.equip.felix = 0;
      amount = Math.max(0, victim.health - 1); // leaves exactly 1 HP
      victim.slowT = Math.max(victim.slowT, EQUIP_EFFECTS.felix.slow);
      this.effects.felixFX(victim);
      this.audio.play('parry', { pos: victim.pos, vol: 0.9 });
      if (victim.isHuman) { this.hud.notice('FELIX FELICIS — death itself missed you', 'good'); this.hud.refreshEquip(); }
      else if (attacker?.isHuman) this.hud.notice(`${victim.name} survived on liquid luck!`, 'bad');
    }
    // taking a hit interrupts a portkey channel
    if (victim.portkeyT > 0 && amount > 0) {
      victim.portkeyT = 0;
      if (victim.isHuman) this.hud.notice('Portkey interrupted!', 'bad');
    }
    const dealt = Math.min(victim.health, amount);
    victim.health -= amount;
    victim.flinchT = 0.25;
    // a solid hit shatters the Full Body-Bind
    if (victim.freezeT > 0 && amount >= 18 && spell?.id !== 'petrificus') {
      victim.freezeT = 0;
      this.effects.freezeBreakFX(victim);
      if (victim.isHuman) this.hud.notice('Body-bind shattered!', 'good');
    }
    if (attacker && attacker !== victim) {
      attacker.dmgDealt += dealt;
      attacker.roundDmg += dealt;
      const log = victim.hitLog.get(attacker.id);
      victim.hitLog.set(attacker.id, { dmg: (log?.dmg || 0) + dealt, t: this.time });
      if (attacker.isHuman && !silent) {
        this.hud.hitmarker(isHS);
        this.hud.crosshairHit(isHS);
        this.audio.play(isHS ? 'headshot' : 'hitmarker', { vol: 0.9 });
      }
      if (attacker.isHuman && hitPos) this.hud.damageNumber(hitPos, Math.round(dealt), isHS);
      if (victim.bot) victim.bot.thinkT = Math.min(victim.bot.thinkT, 0.03); // pain wakes bots
      // silent ticks (bleed/burn DOTs) must not live-track the attacker
      // through walls for the whole duration — only direct hits reveal
      if (!silent) this.see(victim.team, attacker);
    }
    if (victim.isHuman) {
      this.hud.painFlash(clamp(amount / 60, 0.15, 0.8));
      let lateral = 0;
      if (attacker && attacker !== victim) {
        this.hud.damageDirection(attacker.pos, victim);
        const f = victim.lookDir(); f.y = 0; f.normalize();
        let dx = attacker.pos.x - victim.pos.x, dz = attacker.pos.z - victim.pos.z;
        const dl = Math.hypot(dx, dz) || 1;
        lateral = (-f.z) * (dx / dl) + f.x * (dz / dl); // >0: hit came from the right
      }
      if (!silent) { this.feedback.hit(amount, lateral); this.hud.flinchHP(amount); }
      this.audio.play('hurt', { vol: 0.7 });
    }
    if (victim.health <= 0) this.kill(victim, attacker || victim, spell, isHS);
  }

  kill(victim, attacker, spell, isHS) {
    victim.health = 0;
    victim.alive = false;
    victim.deaths++;
    victim.lostLoadout = true;
    this.recentDeaths.push({
      team: victim.team, x: victim.pos.x, y: victim.pos.y, z: victim.pos.z,
      killerX: attacker !== victim ? attacker.pos.x : null, killerZ: attacker !== victim ? attacker.pos.z : null,
      killer: attacker !== victim ? attacker : null, name: victim.name,
      t: this.time,
    });
    if (this.recentDeaths.length > 12) this.recentDeaths.shift();
    victim.bleeds.length = 0;
    victim.burnT = 0;
    this.spells.cancelCharge(victim);
    this.spells.stopShield(victim);
    if (victim.wandProp) this.effects.removeWandDrop(victim.wandProp, false);
    victim.freezeT = 0;
    victim.morphT = 0;
    victim.morphId = null;

    // corpse launch from the killing blow (Avada/Bombarda ragdoll hard)
    const lh = victim.lastHit && this.time - victim.lastHit.t < 0.4 ? victim.lastHit : null;
    victim.rig?.die(victim, lh ? { x: lh.x, y: lh.y, z: lh.z, power: lh.power } : null);
    if (spell?.id === 'avada') {
      victim.rig?.flash(0x37ff6e, 0.6); // body flashes green
      this.effects.avadaWisp(victim.pos);
      if (attacker?.isHuman || victim.isHuman) { this.hitstop(0.07); this.slowmo(0.55, 0.4); }
    }
    this.effects.deathBurst(victim, TEAM_INFO[victim.team].color);

    // drop relic
    if (victim.hasRelic) {
      victim.hasRelic = false;
      this.relic.state = 'dropped';
      this.relic.carrier = null;
      this.relic.pos.copy(victim.pos);
      this.effects.plantRelic(this.relic.pos.clone());
      if (this.human.team === this.attackingTeam) this.hud.notice('The Relic was dropped!', 'obj');
    }

    this.spawnDrops(victim);

    const selfKill = attacker === victim;
    if (!selfKill && attacker) {
      attacker.kills++;
      attacker.roundKills++;
      if (isHS) attacker.hsK++;
      // assists: meaningful recent damage from anyone who didn't land the kill
      for (const [pid, rec] of victim.hitLog) {
        if (pid === attacker.id || this.time - rec.t > 6 || rec.dmg < 30) continue;
        const helper = this.players.find((q) => q.id === pid);
        if (helper && helper.team !== victim.team) helper.assists++;
      }
      const reward = spell?.killReward ?? 300;
      if (this.mode !== 'dm') {
        attacker.money = clamp(attacker.money + reward, 0, ECON.cap);
        // Lucius: every kill lines the family vault — and buys loyalty
        if (attacker.char.id === 'lucius') {
          attacker.money = clamp(attacker.money + 125, 0, ECON.cap);
          for (const q of this.teamPlayers(attacker.team)) {
            if (q !== attacker && q.alive) q.money = clamp(q.money + 50, 0, ECON.cap);
          }
          if (attacker.isHuman) this.hud.notice('+125 G — Galleons & Influence', 'good');
        }
      }
      // Greyback feeds on the kill: health back and a burst of speed
      if (attacker.char.id === 'greyback' && attacker.alive) {
        attacker.health = Math.min(attacker.stats.hp, attacker.health + 30);
        attacker.feralT = 3.5;
        this.effects.healFX(attacker);
        if (attacker.isHuman) this.hud.notice('THE HUNGER — +30 HP, speed surge', 'good');
      }
      if (attacker.isHuman) {
        this.audio.ui('kill');
        this.hitstop(0.05);
        this.hud.killConfirm(victim, spell, isHS);
        this.feedback.bloomPulse(0.4);
      } else {
        // a downed foe earns a bark: a revenge line if this victim had just cut
        // down one of the attacker's teammates, otherwise a generic gloat
        const avenged = this.recentDeaths.find((d) => d.killer === victim && d.team === attacker.team && this.time - d.t < 12);
        if (avenged) this.comms.say(attacker, 'revenge', { scope: 'world', pos: attacker.pos, name: avenged.name, chance: 0.8 });
        else this.comms.say(attacker, 'kill', { scope: 'world', pos: attacker.pos, chance: 0.5 });
      }

      if (this.mode !== 'dm') {
        // first blood bounty
        if (!this.firstBloodDone) {
          this.firstBloodDone = true;
          attacker.money = clamp(attacker.money + 150, 0, ECON.cap);
          this.hud.notice(`FIRST BLOOD — ${attacker.name} +150 G`, attacker.team === this.human.team ? 'good' : 'bad');
          this.audio.stinger('firstblood');
        }
        // multi-kill announcer
        const MK = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUAD KILL', 5: 'ACE!' };
        const label = MK[Math.min(5, attacker.roundKills)];
        if (label && attacker.roundKills >= 2) {
          if (attacker.isHuman) {
            this.hud.announce(label, attacker.roundKills >= 5 ? 'The whole team. Alone.' : '', 'good');
            this.audio.stinger(attacker.roundKills >= 5 ? 'ace' : 'multikill');
            if (attacker.roundKills >= 5) this.slowmo(0.8, 0.45);
          } else if (attacker.roundKills >= 3) {
            this.hud.notice(`${attacker.name}: ${label}`, attacker.team === this.human.team ? 'good' : 'bad');
            if (attacker.roundKills >= 5) this.audio.stinger('ace');
          }
        }
      }
    } else {
      victim.kills--; // CS-style suicide penalty
    }
    this.hud.killfeed(attacker, victim, spell, isHS, selfKill);

    if (victim.isHuman) {
      this.deathCamT = 2.2;
      this.spectIdx = 0;
      this.specActive = false;
      this.hud.openBuy(false); // died mid-purchase: close the shop
      this.hud.showDeath(selfKill ? null : attacker, spell);
    }

    if (this.mode === 'dm') {
      const winner = this.deathmatchWinner(true);
      if (winner) {
        this.finishMatch(winner);
        return;
      }
      setTimeout(() => {
        if (!this.over && this.mode === 'dm') {
          this.dmSpawn(victim);
          if (victim.isHuman) this.hud.closeDeath();
        }
      }, ROUND.dmRespawn * 1000);
      return;
    }

    // elimination checks
    if (this.state !== 'live' && this.state !== 'freeze') return;
    const attAlive = this.aliveOf(this.attackingTeam).length;
    const defAlive = this.aliveOf(this.defendingTeam()).length;
    // a kill that ends the round gets a beat of slow-mo when the player is in it
    const clutch = () => { if (this.human.alive || attacker?.isHuman || victim.isHuman) this.slowmo(0.6, 0.4); };
    if (this.relic.state === 'planted') {
      if (defAlive === 0) { clutch(); this.endRound(this.attackingTeam, 'elim'); }
      // attackers can all die; round continues until defuse/explode
    } else {
      if (attAlive === 0) { clutch(); this.endRound(this.defendingTeam(), 'elim'); }
      else if (defAlive === 0) { clutch(); this.endRound(this.attackingTeam, 'elim'); }
    }
  }

  // Color-coded "what hit me" feedback for the human victim.
  victimFeedback(victim, spell) {
    if (!victim.isHuman || !victim.alive) return;
    const css = `#${(spell.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
    switch (spell.id) {
      case 'stupefy':
        this.hud.hitFlash(css, 0.4);
        this.shake(0.55); // screen jolt
        break;
      case 'sectum':
        this.hud.hitFlash('#ff2238', 0.35);
        this.shake(0.3);
        break;
      case 'expelliarmus':
        this.hud.hitFlash(css, 0.5);
        this.shake(0.4);
        break;
      case 'avada':
        this.hud.hitFlash(css, 0.85);
        break;
      case 'petrificus':
        this.hud.hitFlash('#c8d4e0', 0.55); // world greys out as the bind takes hold
        break;
      case 'porcus':
        this.hud.hitFlash('#ff8fc8', 0.55);
        this.shake(0.22);
        break;
      case 'rictusempra':
        this.hud.hitFlash('#ffd24a', 0.42);
        this.shake(0.22);
        break;
      default:
        this.hud.hitFlash(css, 0.3);
        break;
    }
  }

  tryNudge(p, dx, dz) {
    const h = 0.36, x = p.pos.x + dx, z = p.pos.z + dz;
    if (!this.world.overlaps(x - h, p.pos.y + 0.1, z - h, x + h, p.pos.y + p.body.height - 0.05, z + h)) {
      p.pos.x = x; p.pos.z = z;
    }
  }

  explosion(pos, radius, maxDmg, attacker, spell, ignoreTeam = false) {
    this.env?.explosionAt(pos, radius, maxDmg, attacker); // shred cover, chain barrels
    for (const p of this.players) {
      if (!p.alive) continue;
      if (!ignoreTeam && attacker && p !== attacker && p.team === attacker.team) continue;
      const c = p.pos.clone(); c.y += p.body.height * 0.5;
      const d = c.distanceTo(pos);
      if (d > radius + 0.5) continue;
      const feetClear = this.world.segmentClear(pos.x, pos.y, pos.z, p.pos.x, p.pos.y + 0.3, p.pos.z);
      const headClear = this.world.segmentClear(pos.x, pos.y, pos.z, p.pos.x, p.pos.y + p.body.height - 0.1, p.pos.z);
      if (!feetClear && !headClear) continue;
      const prox = clamp(1 - d / radius, 0, 1); // 1 at ground zero
      let dmg = maxDmg * Math.pow(prox, 1.1);
      if (attacker) dmg *= attacker.effPower();
      if (p.char.id === 'ron') dmg *= 0.8;
      if (p.disc?.blastResist) dmg *= p.disc.blastResist;

      // blast knockback scaled by distance; near-center victims are bowled over
      const away = c.clone().sub(pos);
      away.y = Math.max(away.y, 0.2);
      if (away.lengthSq() < 0.01) away.set(0, 1, 0);
      away.normalize();
      p.vel.x += away.x * prox * 8;
      p.vel.z += away.z * prox * 8;
      p.vel.y += prox * 4.2;
      if (prox > 0.55) p.staggerT = Math.max(p.staggerT, 0.55);
      p.lastHit = { x: away.x, y: away.y, z: away.z, power: 2 + prox * 4.5, t: this.time };
      p.rig?.flash(spell?.color ?? 0xff8a2a, 0.25);

      if (p.isHuman) {
        // screen shakes and ears ring
        this.shake(clamp(1.6 - d / radius, 0.3, 1.4));
        this.hud.hitFlash('#ff8a2a', 0.25 + prox * 0.4);
        if (prox > 0.25) {
          this.audio.play('tinnitus', { vol: clamp(prox, 0.25, 0.8) });
          this.audio.setMuffle(prox * 0.85, 1.0 + prox * 1.4);
        }
      }
      this.damage(p, attacker, dmg, spell, false, c);
    }
    this.shakeByDistance(pos, radius * 2.4);
    this.feedback.bloomPulse(0.5);
  }

  flashPlayers(pos, spell) {
    for (const p of this.players) {
      if (!p.alive) continue;
      const eye = p.eyePos();
      const d = eye.distanceTo(pos);
      if (d > 45) continue;
      if (!this.world.segmentClear(pos.x, pos.y, pos.z, eye.x, eye.y, eye.z)) continue;
      const toFlash = pos.clone().sub(eye).normalize();
      const facing = p.lookDir().dot(toFlash);
      const face = facing > 0 ? 0.5 + facing * 0.5 : 0.3;
      let t = spell.flash * face * clamp(1 - d / 50, 0.3, 1);
      if (p.char.id === 'luna') t *= 0.4;
      if (t > p.blindT) {
        p.blindT = t;
        p.blindMax = Math.max(0.8, t);
        if (p.isHuman) {
          if (t > 1.2) this.audio.play('tinnitus', { vol: clamp(t / 3, 0.2, 0.8) });
          if (t > 0.5) this.audio.setMuffle(clamp(t / 2.6, 0.35, 0.9), t); // muffled while blind
        }
      }
    }
  }

  // A sound happened. Each bot hears it individually (its own ears, its own
  // radius); teamed sources also drop a fuzzy ping into team memory. Teamless
  // sources (explosions, breaking crates, bells) alert EVERYONE.
  noise(source, radius) {
    const pos = source.pos;
    if (!pos) return;
    const team = source.team ?? null;
    for (const p of this.players) {
      if (!p.bot || !p.alive || (team && p.team === team)) continue;
      const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      const hear2 = p.bot.skill.hear ** 2 * (radius / 18);
      if (d2 >= hear2) continue;
      // positional error grows with distance — you heard "roughly there"
      const err = 1 + Math.sqrt(d2) * 0.12;
      if (team) {
        this.teamMemory[p.team].set(source.id ?? -1, { x: pos.x + rand(-err, err), y: pos.y, z: pos.z + rand(-err, err), t: this.time, name: source.name });
      }
      p.bot.onNoise(pos, radius, team);
    }
  }

  see(team, enemy) {
    this.teamMemory[team].set(enemy.id, { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z, t: this.time, name: enemy.name });
  }

  // Teammate callout: routed through the comms bus, which adds a voice bark
  // and drops it into the HUD feed (rate-limited there so it stays readable).
  radio(p, text, chance = 1) {
    if (!p || this.over) return;
    this.comms.raw(p, text, { chance });
  }

  // -------------------------------------------------------- player commands ---
  // The radial wheel (Game.handleHumanInput) issues these. Each sets a per-bot
  // order whose compliance is gated by personality, then a teammate speaks an
  // acknowledgement (or a refusal) through the comms bus.
  command(id) {
    const human = this.human;
    const team = human.team;
    if (id === 'report') { this.commandReport(team); this.hud.notice('Order: Report in', 'obj'); return; }
    if (!human.alive) { this.hud.notice('Stay alive to give orders', 'bad'); return; }
    const mates = this.players.filter((p) => p.bot && p.alive && p.team === team);
    const t = this.time;
    const apply = (dur, make) => {
      for (const p of mates) {
        const o = make(p);
        o.until = t + dur;
        o.from = human;
        o.obey = p.bot.orderCompliance(o);
        p.bot.order = o;
        p.bot.thinkT = Math.min(p.bot.thinkT, 0.03); // act on it now
      }
    };
    let label = '';
    switch (id) {
      case 'goA': label = 'Take A'; apply(28, () => ({ type: 'go', site: 'A' })); break;
      case 'goB': label = 'Take B'; apply(28, () => ({ type: 'go', site: 'B' })); break;
      case 'push': label = 'Push — go go go!'; apply(12, () => ({ type: 'push' })); break;
      case 'hold': label = 'Hold positions'; apply(22, (p) => ({ type: 'hold', pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } })); break;
      case 'fallback': {
        label = 'Fall back';
        const sp = this.attackingTeam === team ? this.world.spawns.death : this.world.spawns.order;
        const pt = sp && sp[0] ? sp[0] : human.pos;
        apply(18, () => ({ type: 'fallback', pos: { x: pt.x, y: pt.y, z: pt.z } }));
        break;
      }
      case 'follow': label = 'Follow me'; apply(30, () => ({ type: 'follow', target: human })); break;
      case 'needhelp': label = 'Need help — on me!'; apply(15, () => ({ type: 'rally', pos: { x: human.pos.x, y: human.pos.y, z: human.pos.z } })); break;
      default: return;
    }
    this.hud.notice(`Order: ${label}`, 'obj');
    this.commandAck(mates, id);
  }

  commandAck(mates, id) {
    const obey = mates.filter((p) => p.bot.order && p.bot.order.obey);
    const refuse = mates.filter((p) => p.bot.order && !p.bot.order.obey);
    if (obey.length) this.comms.say(choice(obey), 'ack', { scope: 'team', force: true });
    if (refuse.length && Math.random() < 0.55) this.comms.say(choice(refuse), 'refuse', { scope: 'team', force: true });
  }

  commandReport(team) {
    const mates = this.players.filter((p) => p.bot && p.alive && p.team === team);
    if (!mates.length) { this.hud.notice('No teammates left', 'bad'); return; }
    const spk = mates.reduce((a, b) => (b.bot.ai.team > a.bot.ai.team ? b : a), mates[0]);
    const areas = [...new Set(mates.map((p) => this.areaName(p.pos.x, p.pos.z)))].slice(0, 3);
    const low = mates.filter((p) => p.health < 45).length;
    const txt = `${mates.length} up — ${areas.join(', ')}${low ? `, ${low} hurt` : ''}.`;
    this.comms.say(spk, 'report', { scope: 'team', text: txt, force: true });
  }

  // Player ping: mark whatever the crosshair is on (an enemy, else the wall),
  // call it out, and nudge nearby teammates to look / investigate.
  ping() {
    const p = this.human;
    if (!p.alive) return;
    const eye = p.eyePos();
    const dir = p.lookDir();
    let enemy = null, bestDot = 0.985;
    for (const e of this.players) {
      if (!e.alive || e.team === p.team) continue;
      const ep = e.eyePos();
      const tx = ep.x - eye.x, ty = ep.y - eye.y, tz = ep.z - eye.z;
      const d = Math.hypot(tx, ty, tz);
      if (d < 0.2) continue;
      const dot = (tx * dir.x + ty * dir.y + tz * dir.z) / d;
      if (dot > bestDot && this.world.segmentClear(eye.x, eye.y, eye.z, ep.x, ep.y, ep.z)) { bestDot = dot; enemy = e; }
    }
    let mark;
    if (enemy) {
      this.see(p.team, enemy);
      mark = { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z, t: this.time, kind: 'enemy' };
    } else {
      const hit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 90);
      const tt = hit ? hit.t : 22;
      mark = { x: eye.x + dir.x * tt, y: eye.y + dir.y * tt, z: eye.z + dir.z * tt, t: this.time, kind: 'spot' };
    }
    this.pings.push(mark);
    if (this.pings.length > 6) this.pings.shift();
    const area = this.areaName(mark.x, mark.z);
    const caller = this.aliveOf(p.team).find((q) => q.bot);
    if (caller) {
      this.comms.say(caller, enemy ? 'contact' : 'banter', {
        scope: 'team', pos: caller.pos, area, text: enemy ? `Enemy ${area} — pinged!` : `Watch ${area}.`,
      });
    }
    for (const q of this.aliveOf(p.team)) q.bot?.onPing?.(mark);
    this.audio.play('relic_beep', { pos: mark, vol: 0.5 });
  }

  // Rough callout name for a position — sites, mid, or a spawn.
  areaName(x, z) {
    const zones = this.world.zones;
    for (const key of ['siteA', 'siteB']) {
      const zz = zones[key];
      if (zz && x >= zz.x0 - 4 && x <= zz.x1 + 4 && z >= zz.z0 - 4 && z <= zz.z1 + 4) {
        return key === 'siteA' ? 'site A' : 'site B';
      }
    }
    const spots = [];
    const sa = zones.siteA, sb = zones.siteB;
    if (sa) spots.push(['A approach', sa.cx, sa.cz, 18]);
    if (sb) spots.push(['B approach', sb.cx, sb.cz, 18]);
    const so = this.world.spawns.order?.[0], sd = this.world.spawns.death?.[0];
    if (so) spots.push([this.attackingTeam === TEAM.ORDER ? 'their spawn' : 'our spawn', so.x, so.z, 16]);
    if (sd) spots.push([this.attackingTeam === TEAM.DEATH ? 'their spawn' : 'our spawn', sd.x, sd.z, 16]);
    let best = 'mid', bd = Infinity;
    for (const [name, sx, sz, r] of spots) {
      const d = Math.hypot(x - sx, z - sz);
      if (d < r && d < bd) { best = name; bd = d; }
    }
    return best;
  }

  // ------------------------------------------------------------- summons ---
  spawnSummon(owner, spell) {
    const cfg = spell.summon;
    const dir = owner.lookDir(); dir.y = 0; dir.normalize();
    const x = owner.pos.x + dir.x * 1.2, z = owner.pos.z + dir.z * 1.2;
    const y = this.world.groundY(x, z, owner.pos.y + 1);
    const s = {
      owner, team: owner.team, spell,
      x, y, z, yaw: owner.yaw,
      hp: cfg.hp, life: cfg.life, speed: cfg.speed,
      target: null, retargetT: 0, wiggleT: Math.random() * 9,
      mesh: this.effects.spawnSnakeMesh(),
    };
    s.mesh.position.set(x, y, z);
    this.summons.push(s);
    if (owner.isHuman) this.hud.notice('Serpensortia! Your serpent hunts.', 'good');
  }

  updateSummons(dt) {
    for (let i = this.summons.length - 1; i >= 0; i--) {
      const s = this.summons[i];
      s.life -= dt;
      if (s.life <= 0 || s.hp <= 0 || !s.owner.alive) {
        this.effects.snakeDeathFX(s, s.hp <= 0);
        this.effects.removeSnakeMesh(s.mesh);
        this.summons.splice(i, 1);
        continue;
      }
      // retarget the nearest visible enemy a few times a second
      s.retargetT -= dt;
      if (s.retargetT <= 0) {
        s.retargetT = 0.3;
        let best = null, bd = s.spell.summon.range ** 2;
        for (const e of this.players) {
          if (!e.alive || e.team === s.team) continue;
          const d2 = (e.pos.x - s.x) ** 2 + (e.pos.z - s.z) ** 2;
          if (d2 < bd && this.world.segmentClear(s.x, s.y + 0.3, s.z, e.pos.x, e.pos.y + 0.5, e.pos.z)) {
            best = e; bd = d2;
          }
        }
        s.target = best;
      }
      // slither
      const t = s.target;
      let wantYaw = s.yaw;
      let spd = s.speed * (t ? 1 : 0.35);
      if (t) wantYaw = Math.atan2(t.pos.x - s.x, t.pos.z - s.z);
      else wantYaw += Math.sin(this.time * 0.7 + s.wiggleT) * 0.04;
      const dy = ((wantYaw - s.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      s.yaw += clamp(dy, -4 * dt, 4 * dt);
      const nx = s.x + Math.sin(s.yaw) * spd * dt;
      const nz = s.z + Math.cos(s.yaw) * spd * dt;
      // walls: probe ahead, turn along them
      if (this.world.segmentClear(s.x, s.y + 0.25, s.z, nx + Math.sin(s.yaw) * 0.4, s.y + 0.25, nz + Math.cos(s.yaw) * 0.4)) {
        s.x = nx; s.z = nz;
      } else {
        s.yaw += 2.4 * dt * (Math.sin(s.wiggleT) > 0 ? 1 : -1);
      }
      s.y += clamp(this.world.groundY(s.x, s.z, s.y + 0.8) - s.y, -6 * dt, 6 * dt);
      // strike
      if (t && (t.pos.x - s.x) ** 2 + (t.pos.z - s.z) ** 2 < 1.1 && Math.abs(t.pos.y - s.y) < 1.6) {
        this.audio.play('snake_bite', { pos: t.pos, vol: 0.95 });
        this.damage(t, s.owner, s.spell.summon.bite, s.spell, false, t.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
        if (t.alive) {
          t.slowT = Math.max(t.slowT, s.spell.summon.slow);
          if (t.isHuman) this.hud.notice('Serpent bite — venom slows you!', 'bad');
        }
        s.hp = 0; // the strike spends the serpent
        continue;
      }
      this.effects.animateSnake(s, dt);
    }
  }

  clearSummons() {
    for (const s of this.summons) this.effects.removeSnakeMesh(s.mesh);
    this.summons.length = 0;
  }

  // --------------------------------------------------------------- drops ---
  // The fallen leave their wand and a piece of kit where they died.
  spawnDrops(victim) {
    if (this.mode === 'dm') return;
    const jitter = () => rand(-0.7, 0.7);
    if (victim.wand.price > 0) {
      this.addDrop({ kind: 'wand', id: victim.wand.id, name: victim.wand.name }, victim.pos.x + jitter(), victim.pos.z + jitter());
    }
    // one piece of unused utility
    const nadeId = GRENADES.find((id) => (victim.charges[id] || 0) > 0);
    if (nadeId) {
      this.addDrop({ kind: 'spell', id: nadeId, name: SPELLS[nadeId].name }, victim.pos.x + jitter(), victim.pos.z + jitter());
    } else if (victim.equip.potion > 0) {
      this.addDrop({ kind: 'equip', id: 'potion', name: 'Healing Potion' }, victim.pos.x + jitter(), victim.pos.z + jitter());
    }
  }

  addDrop(item, x, z) {
    if (this.drops.length > 24) return;
    const y = this.world.floorY(x, z, 30);
    const d = { ...item, x, y, z, bobT: Math.random() * 9, mesh: this.effects.spawnDropMesh(item) };
    d.mesh.position.set(x, y + 0.25, z);
    this.drops.push(d);
  }

  updateDrops(dt) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.bobT += dt;
      d.mesh.position.y = d.y + 0.3 + Math.sin(d.bobT * 2.2) * 0.07;
      d.mesh.rotation.y += dt * 1.4;
      let taken = false;
      for (const p of this.players) {
        if (!p.alive || taken) continue;
        const near = (p.pos.x - d.x) ** 2 + (p.pos.z - d.z) ** 2 < 1.4 && Math.abs(p.pos.y - d.y) < 1.8;
        if (!near) continue;
        taken = this.tryPickup(p, d);
      }
      if (taken) {
        this.effects.removeDropMesh(this.drops[i].mesh);
        this.drops.splice(i, 1);
      }
    }
  }

  tryPickup(p, d) {
    if (d.kind === 'wand') {
      const w = wandById(d.id);
      if (!w) return false;
      const better = w.price > p.wand.price;
      // walking over a better wand swaps automatically only from the training wand;
      // otherwise it's a deliberate E-press
      const wants = p.isHuman ? (p.ctrl.useHeld && this.pickupHintFor(p) === d) || p.wand.id === 'training'
        : better;
      if (!wants || p.wand.id === d.id) return false;
      const old = p.wand;
      p.wand = w;
      // leave your old wand behind in exchange
      if (old.price > 0) this.addDrop({ kind: 'wand', id: old.id, name: old.name }, d.x, d.z);
      this.audio.play('wand_pickup', { pos: p.pos, vol: 0.9 });
      if (p.isHuman) this.hud.notice(`Took the ${w.name}`, 'good');
      return true;
    }
    if (d.kind === 'spell') {
      const sp = SPELLS[d.id];
      if ((p.charges[d.id] || 0) >= p.chargeCap(sp)) return false;
      p.owned.add(d.id);
      p.charges[d.id] = (p.charges[d.id] || 0) + 1;
      this.audio.play('wand_pickup', { pos: p.pos, vol: 0.7 });
      if (p.isHuman) { this.hud.notice(`Scavenged ${sp.name}`, 'good'); this.hud.refreshEquip?.(); }
      return true;
    }
    if (d.kind === 'equip') {
      const eq = equipById(d.id);
      if (p.equip[d.id] >= eq.max) return false;
      p.equip[d.id]++;
      this.audio.play('wand_pickup', { pos: p.pos, vol: 0.7 });
      if (p.isHuman) { this.hud.notice(`Scavenged ${eq.name}`, 'good'); this.hud.refreshEquip(); }
      return true;
    }
    return false;
  }

  // nearest lootable wand the human is standing on (for the [E] hint)
  pickupHintFor(p) {
    let best = null, bd = 1.4;
    for (const d of this.drops) {
      if (d.kind !== 'wand' || d.id === p.wand.id) continue;
      const d2 = (p.pos.x - d.x) ** 2 + (p.pos.z - d.z) ** 2;
      if (d2 < bd && Math.abs(p.pos.y - d.y) < 1.8) { bd = d2; best = d; }
    }
    return best;
  }

  clearDrops() {
    for (const d of this.drops) this.effects.removeDropMesh(d.mesh);
    this.drops.length = 0;
  }

  shake(amp) {
    this.feedback.addTrauma(amp * 0.62); // map legacy 0..1.6 amps into trauma
  }

  // Cinematic time. hitstop freezes the whole sim for a beat (impact crunch);
  // slowmo stretches a moment out. Both are no-ops under ?auto and when the
  // player has switched cinematics off, so headless tests stay deterministic.
  hitstop(t) {
    if (this.autoMode || this.settings?.juice === false) return;
    this.hitstopT = Math.max(this.hitstopT, t);
  }

  slowmo(dur, scale = 0.4) {
    if (this.autoMode || this.settings?.juice === false) return;
    if (this.slowmoT <= 0) { this.slowmoScale = scale; this.slowmoT = dur; }
    else { this.slowmoScale = Math.min(this.slowmoScale, scale); this.slowmoT = Math.max(this.slowmoT, dur); }
  }

  shakeByDistance(pos, range) {
    const d = this.camera.position.distanceTo(pos);
    if (d < range) this.shake(clamp(1 - d / range, 0, 1) * 0.9);
  }

  // ------------------------------------------------------------- objective ---
  updateObjective(dt) {
    const r = this.relic;
    if (this.mode === 'dm' || r.state === 'idle') return;

    if (r.state === 'carried' && r.carrier) {
      r.pos.copy(r.carrier.pos);
      if (!r.carrier.alive) { r.state = 'dropped'; r.carrier = null; }
    }

    // pickup dropped relic
    if (r.state === 'dropped') {
      for (const p of this.aliveOf(this.attackingTeam)) {
        if (p.pos.distanceToSquared(r.pos) < 1.4) {
          r.state = 'carried';
          r.carrier = p;
          p.hasRelic = true;
          this.effects.removeRelic();
          if (p.isHuman) this.hud.notice('You picked up the CURSED RELIC', 'obj');
          break;
        }
      }
    }

    // planting
    if (r.state === 'carried' && r.carrier && this.state === 'live') {
      const p = r.carrier;
      const inA = this.world.inRect(this.world.zones.siteA, p.pos.x, p.pos.z);
      const inB = this.world.inRect(this.world.zones.siteB, p.pos.x, p.pos.z);
      if (p.alive && (inA || inB) && p.ctrl.useHeld && p.body.onGround) {
        r.plantProgress += dt;
        p.ctrl.moveX = 0; p.ctrl.moveZ = 0;
        this.plantTickT -= dt;
        if (this.plantTickT <= 0) { this.plantTickT = 0.25; this.audio.play('plant_tick', { pos: p.pos }); }
        if (p.isHuman) this.hud.progress('PLANTING THE RELIC', r.plantProgress / ROUND.plantTime);
        if (r.plantProgress >= ROUND.plantTime) {
          r.state = 'planted';
          r.site = inA ? 'A' : 'B';
          r.planter = p;
          r.fuseT = ROUND.fuse;
          p.hasRelic = false;
          r.carrier = null;
          r.pos.set(p.pos.x, p.pos.y, p.pos.z);
          p.money = clamp(p.money + ECON.plant, 0, ECON.cap);
          p.objScore += 1.2;
          p.plants++;
          this.effects.plantRelic(r.pos.clone());
          this.hud.announce('THE CURSED RELIC HAS BEEN PLANTED', `Site ${r.site} — ${Math.round(ROUND.fuse)}s until detonation`, 'warn');
          this.audio.stinger('planted');
          this.noise({ pos: r.pos, team: this.attackingTeam, id: -2 }, 200);
          for (const q of this.players) if (q.bot && q.team === this.defendingTeam()) this.teamMemory[q.team].set(-2, { x: r.pos.x, y: r.pos.y, z: r.pos.z, t: this.time + 999, name: 'Relic' });
          if (this.human.team === this.defendingTeam()) this.hud.notice(`Relic planted at ${r.site}! Dispel it with Finite Incantatem (hold E)`, 'obj');
        }
      } else {
        if (r.plantProgress > 0 && p.isHuman) this.hud.progress(null);
        r.plantProgress = 0;
      }
    }

    // planted: fuse + defuse
    if (r.state === 'planted') {
      r.fuseT -= dt;
      r.beepT -= dt;
      const urgency = 1 - r.fuseT / ROUND.fuse;
      if (r.beepT <= 0) {
        r.beepT = clamp(1.05 - urgency, 0.13, 1.05);
        this.effects.relicPulse(urgency);
      }
      if (!r.warned && r.fuseT <= 10) {
        r.warned = true;
        this.hud.announce('10 SECONDS', '', 'warn');
        this.audio.stinger('warning10');
      }
      if (r.fuseT <= 0) {
        r.state = 'exploded'; // commit state first: FX must never wedge the round
        this.effects.relicExplode(r.pos.clone().add(new THREE.Vector3(0, 0.8, 0)));
        this.explosion(r.pos.clone(), 13, 240, r.planter, SPELLS.bombarda, true);
        this.endRound(this.attackingTeam, 'explode');
        return;
      }
      // defusing
      let defuser = null;
      for (const p of this.aliveOf(this.defendingTeam())) {
        if (p.ctrl.useHeld && p.pos.distanceToSquared(r.pos) < 3.2) { defuser = p; break; }
      }
      if (defuser) {
        if (r.defuser !== defuser) {
          r.defuseProgress = 0;
          this.defuseSound?.stop();
          this.defuseSound = this.audio.play('defuse_hum', { pos: r.pos, dur: ROUND.defuseTime });
        }
        r.defuser = defuser;
        r.defuseProgress += dt;
        defuser.ctrl.moveX = 0; defuser.ctrl.moveZ = 0;
        this.particles.burst({ pos: r.pos.clone().add(new THREE.Vector3(0, 1, 0)), count: 2, color: 0xffffff, color2: 0x88ddff, speed: 1.5, spread: 0.6, life: 0.4, size: 0.3, gravity: -1, drag: 1 });
        if (defuser.isHuman) this.hud.progress('FINITE INCANTATEM…', r.defuseProgress / ROUND.defuseTime);
        if (r.defuseProgress >= ROUND.defuseTime) {
          r.state = 'defused';
          defuser.money = clamp(defuser.money + ECON.defuse, 0, ECON.cap);
          defuser.objScore += 1.5;
          defuser.defuses++;
          this.defuseSound?.stop(); this.defuseSound = null;
          this.effects.removeRelic();
          this.endRound(this.defendingTeam(), 'defuse');
        }
      } else {
        if (r.defuser) {
          this.defuseSound?.stop(); this.defuseSound = null;
          if (r.defuser.isHuman) this.hud.progress(null);
        }
        r.defuser = null;
        r.defuseProgress = 0;
      }
    }
  }

  // ------------------------------------------------------------ round end ---
  endRound(winner, reason) {
    if (this.state === 'end' || this.over) return;
    this.state = 'end';
    this.stateT = ROUND.endPause;
    this.score[winner]++;
    this.roundHistory.push({ winner, reason });
    this.hud.progress(null);
    this.defuseSound?.stop(); this.defuseSound = null;

    const loser = otherTeam(winner);
    const winAmt = reason === 'explode' ? ECON.winRelic : ECON.winElim;
    this.award(winner, winAmt);
    let lossAmt = ECON.lossBase + ECON.lossStep * this.lossStreak[loser];
    lossAmt = Math.min(lossAmt, ECON.lossMax);
    if (loser === this.attackingTeam && (this.relic.state === 'planted' || this.relic.state === 'defused')) lossAmt += ECON.plantedLossBonus;
    this.award(loser, lossAmt);
    this.lossStreak[loser]++;
    this.lossStreak[winner] = 0;

    // squads digest the round: confidence drifts and defenders learn the site
    if (this.mode !== 'dm' && this.squads) {
      const plantSite = this.relic.site || null;
      this.squads.order.onRoundEnd(winner, reason, plantSite);
      this.squads.death.onRoundEnd(winner, reason, plantSite);
    }

    // MVP
    const cands = this.teamPlayers(winner);
    let mvp = cands[0], best = -1;
    for (const p of cands) {
      const sc = p.roundDmg + p.roundKills * 70 + p.objScore * 130;
      if (sc > best) { best = sc; mvp = p; }
    }
    if (mvp) mvp.mvps++;
    const reasonText = {
      elim: `${TEAM_INFO[winner].name} eliminated the enemy team`,
      time: `${TEAM_INFO[winner].name} held out — time expired`,
      defuse: 'The Cursed Relic was dispelled',
      explode: 'The Cursed Relic detonated',
    }[reason];
    const mvpText = mvp ? `MVP: ${mvp.name} (${Math.round(mvp.roundDmg)} dmg${mvp.objScore > 1 ? ', objective' : ''})` : '';
    const humanWon = this.human.team === winner;
    this.hud.announce(humanWon ? 'ROUND WON' : 'ROUND LOST', `${reasonText}\n${mvpText}`, humanWon ? 'good' : 'bad');
    this.audio.stinger(humanWon ? 'win' : 'lose');
    setTimeout(() => { if (!this.over) this.audio.stinger('mvp'); }, 900);
  }

  finishMatch(winner) {
    this.over = true;
    this.state = 'matchend';
    const humanWon = winner === this.human.team;
    this.audio.stinger(humanWon ? 'victory' : 'defeat');
    this.app.onMatchEnd?.(winner);
  }

  checkMatchState() {
    const f = this.format;
    const { order, death } = this.score;
    if (order >= f.winTarget) return this.finishMatch(TEAM.ORDER);
    if (death >= f.winTarget) return this.finishMatch(TEAM.DEATH);
    const played = order + death;
    if (played >= f.maxRounds) {
      if (order === death && f.tie) return this.finishMatch(null);
      return this.finishMatch(order > death ? TEAM.ORDER : TEAM.DEATH);
    }
    if (played === f.halftimeAfter && !this.halftimeDone) {
      this.halftimeDone = true;
      this.attackingTeam = otherTeam(this.attackingTeam);
      for (const p of this.players) {
        p.money = ECON.start;
        p.resetLoadout();
        p.lostLoadout = false;
      }
      this.lossStreak = { order: 0, death: 0 };
      this.hud.announce('HALFTIME — SIDES SWAP', `${TEAM_INFO[this.attackingTeam].name} now attack`, 'round');
      this.audio.stinger('halftime');
    }
    this.startRound();
  }

  // --------------------------------------------------------------- update ---
  update(dt) {
    if (this.paused || this.over) return;
    const realDt = Math.min(dt, 0.05);

    // perf governor — measures real frame time, independent of slow-mo
    this.fpsAcc += realDt; this.fpsN++;
    this.qualT += realDt;
    if (this.qualT > 2) {
      const avg = this.fpsAcc / this.fpsN;
      const q = this.particles.quality;
      if (avg > 0.0185) this.particles.setQuality(Math.max(0.25, q - 0.2));
      else if (avg < 0.0135 && q < 1) this.particles.setQuality(Math.min(1, q + 0.12));
      this.fpsAcc = 0; this.fpsN = 0; this.qualT = 0;
      // bloom is the first thing to drop under sustained load
      this.postfx?.setGovernor(this.particles.quality <= 0.4);
    }

    this.feedback.update(realDt); // shake/kick springs run on real time


    // cinematic time: a hitstop freezes the sim, then slow-mo eases it back in
    let scale = 1;
    if (this.hitstopT > 0) { this.hitstopT = Math.max(0, this.hitstopT - realDt); scale = 0; }
    else if (this.slowmoT > 0) { this.slowmoT = Math.max(0, this.slowmoT - realDt); scale = this.slowmoScale; }
    this.timeScale = scale;
    dt = realDt * scale;
    this.time += dt;

    // state machine
    if (this.mode === 'dm') {
      this.dmTimer -= dt;
      if (this.dmTimer <= 0) {
        this.finishMatch(this.deathmatchWinner(false));
        return;
      }
    } else if (this.state === 'freeze') {
      this.stateT -= dt;
      this.frozen = true;
      if (this.stateT <= 0) {
        this.state = 'live';
        this.frozen = false;
        this.hud.openBuy(false);
        this.hud.announce('GO!', '', 'go');
        this.audio.stinger('go');
      }
    } else if (this.state === 'live') {
      this.buyT = Math.max(0, this.buyT - dt);
      if (this.relic.state !== 'planted') {
        this.roundT -= dt;
        if (this.roundT <= 0) this.endRound(this.defendingTeam(), 'time');
      }
    } else if (this.state === 'end') {
      this.stateT -= dt;
      if (this.relic.state === 'planted') this.updateObjective(dt); // let it tick down during banner? no: freeze fuse
      if (this.stateT <= 0) {
        this.checkMatchState();
        return;
      }
    }

    // human input
    if (!this.human.alive) this.handleHumanInput(dt);
    else if (this.input.locked && !this.hud.buyOpen) this.handleHumanInput(dt);
    else if (this.human.alive) {
      const c = this.human.ctrl;
      if (!this.input.locked) { c.moveX = 0; c.moveZ = 0; c.castHeld = false; c.altHeld = false; c.jump = false; c.useHeld = false; }
      else this.handleHumanInput(dt, true); // buy menu open: allow movement keys but not casting
    }

    // bots
    for (const p of this.players) if (p.bot && p.alive) p.bot.update(dt);

    // squad coordinator: reactive team calls (synchronized executes, rotations,
    // retakes) on a slow ~2Hz tick, phase-offset per team
    if (this.mode !== 'dm') { this.squads.order.update(dt); this.squads.death.update(dt); }

    // players
    for (const p of this.players) p.update(dt);

    // soft player-vs-player separation (keeps bots from stacking)
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.players.length; j++) {
        const b = this.players[j];
        if (!b.alive || Math.abs(b.pos.y - a.pos.y) > 1.6) continue;
        let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        let d2 = dx * dx + dz * dz;
        const minD = 0.78;
        if (d2 >= minD * minD) continue;
        if (d2 < 1e-6) { dx = Math.sin(i * 2.3 + j); dz = Math.cos(i * 2.3 + j); d2 = 1; }
        const d = Math.sqrt(d2);
        const push = Math.min((minD - d) * 0.5, 0.08);
        const nx = dx / d, nz = dz / d;
        this.tryNudge(a, -nx * push, -nz * push);
        this.tryNudge(b, nx * push, nz * push);
      }
    }

    // systems
    this.spells.update(dt);
    this.spells.updateFires(dt);
    this.env.update(dt);
    this.updateSummons(dt);
    this.updateDrops(dt);
    this.radioT = Math.max(0, this.radioT - dt);
    if (this.state !== 'end') this.updateObjective(dt);
    this.effects.update(dt);
    for (const p of this.players) this.effects.updateShield(p, dt);
    this.particles.update(dt);

    // human sight feeds team memory (radar pings)
    // Umbridge surveillance brands: tagged victims stay pinned on the radar
    for (const p of this.players) {
      if (p.taggedT > 0) {
        p.taggedT -= dt;
        if (p.alive && p.taggedBy != null) this.see(p.taggedBy, p);
      }
    }

    this.humanSeeT -= dt;
    if (this.humanSeeT <= 0 && this.human.alive) {
      this.humanSeeT = 0.25;
      const eye = this.human.eyePos();
      const fwd = this.human.lookDir();
      for (const e of this.players) {
        if (!e.alive || e.team === this.human.team || e.cloakT > 0) continue;
        const ep = e.eyePos();
        const to = ep.clone().sub(eye);
        const d = to.length();
        if (d > 80) continue;
        to.divideScalar(d);
        if (to.dot(fwd) < 0.35) continue;
        if (this.world.segmentClear(eye.x, eye.y, eye.z, ep.x, ep.y, ep.z) && !this.effects.smokeBlocks(eye.x, eye.y, eye.z, ep.x, ep.y, ep.z)) {
          this.see(this.human.team, e);
        }
      }
    }

    // low-health heartbeat
    this.heartT -= dt;
    if (this.human.alive && this.human.health > 0 && this.human.health < 30 && this.heartT <= 0) {
      this.heartT = 0.55 + (this.human.health / 30) * 0.5;
      this.audio.play('heartbeat', { vol: clamp(1 - this.human.health / 30, 0.35, 0.9) });
    }

    this.updateCamera(dt);
    this.audio.updateListener(this.camera.position, new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
    this.hud.update(realDt);
  }

  handleHumanInput(dt, buyOpenMode = false) {
    const p = this.human;
    const input = this.input;
    const c = p.ctrl;
    const m = input.consumeMouse();
    // command wheel: hold to open, mouse aims a slice, release to issue. While
    // open it eats the look so choosing a command doesn't swing the camera.
    const wheelHeld = input.down('commsWheel');
    if (wheelHeld && !this.hud.wheelOpen && p.alive && !buyOpenMode) this.hud.openWheel();
    else if (!wheelHeld && this.hud.wheelOpen) this.hud.closeWheel((id) => this.command(id));
    if (this.hud.wheelOpen) {
      this.hud.wheelMove(m.dx, m.dy);
    } else if (!buyOpenMode) {
      // scoped (Avada charge) lowers sensitivity with the FOV, CS-style
      const sens = this.settings.sens * 0.0022 * (this.fovCur / this.baseFov);
      p.yaw -= m.dx * sens;
      p.pitch = clamp(p.pitch - m.dy * sens, -1.45, 1.45);
    }
    const wheelOpen = this.hud.wheelOpen;
    if (!p.alive) {
      // spectate controls
      if (input.pressed('cast')) this.cycleSpectate(1);
      if (input.pressed('altcast')) this.cycleSpectate(-1);
      if (input.pressed('scoreboard')) { /* hud handles held below */ }
      return;
    }
    const f = p.lookDir(); f.y = 0; f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    let mx = 0, mz = 0;
    if (input.down('forward')) { mx += f.x; mz += f.z; }
    if (input.down('back')) { mx -= f.x; mz -= f.z; }
    if (input.down('right')) { mx += r.x; mz += r.z; }
    if (input.down('left')) { mx -= r.x; mz -= r.z; }
    c.moveX = mx; c.moveZ = mz;
    c.jump = input.pressed('jump') || (input.down('jump') && (p.body.onLadder || p.flying));
    c.crouch = input.down('crouch');
    c.walkHeld = input.down('walk');
    c.useHeld = input.down('use');
    c.climbF = input.down('forward') ? 1 : input.down('back') ? -1 : 0;
    if (!buyOpenMode && !wheelOpen) {
      c.castHeld = input.down('cast');
      c.altHeld = input.down('altcast');
    } else {
      c.castHeld = false; c.altHeld = false;
    }
    if (this.frozen) { c.moveX = 0; c.moveZ = 0; c.jump = false; }

    if (!buyOpenMode && !wheelOpen && !this.frozen && input.pressed('dash')) p.tryDash();
    if (input.pressed('ping') && !wheelOpen) this.ping();

    for (let i = 1; i <= 5; i++) if (input.pressed(`slot${i}`)) p.selectSlot(i);
    if (m.wheel) p.cycleSpell(m.wheel > 0 ? 1 : -1);
    if (input.pressed('recharge')) p.startRecharge();
    if (input.pressed('potion')) p.useEquip('potion');
    if (input.pressed('broom')) p.useEquip('broom');
    if (input.pressed('cloak')) p.useEquip('cloak');
    if (input.pressed('apparate')) p.useEquip('apparate');
    if (input.pressed('finite')) p.useEquip('finite');
    if (input.pressed('portkey')) p.useEquip('portkey');
  }

  cycleSpectate(dir) {
    const mates = this.players.filter((q) => q.alive && q.team === this.human.team);
    const pool = mates.length ? mates : (this.mode === 'dm' ? this.players.filter((q) => q.alive && q !== this.human) : []);
    if (!pool.length) {
      this.hud.spectating('No living teammates');
      return;
    }
    this.deathCamT = 0;
    this.hud.closeDeath();
    this.spectIdx = (this.spectIdx + dir + pool.length) % pool.length;
  }

  updateCamera(dt) {
    const cam = this.camera;
    const p = this.human;
    if (p.fp) p.fp.group.visible = p.alive; // no floating wand while spectating
    let target = null, yaw = p.yaw, pitch = p.pitch;
    if (p.alive) {
      target = p.eyePos();
    } else {
      this.deathCamT -= dt;
      if (this.deathCamT > 0) {
        target = new THREE.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z);
      } else {
        const mates = this.players.filter((q) => q.alive && q.team === p.team);
        const pool = mates.length ? mates : (this.mode === 'dm' ? this.players.filter((q) => q.alive && q !== p) : []);
        if (pool.length) {
          // death cam is over — drop the full-screen "SLAIN" overlay so the
          // spectated teammate is actually visible (it was blurring the view
          // until the player happened to click)
          if (!this.specActive) { this.hud.closeDeath(); this.specActive = true; }
          const s = pool[this.spectIdx % pool.length];
          target = s.eyePos();
          yaw = s.yaw; pitch = s.pitch;
          this.hud.spectating(s.name);
        } else {
          target = new THREE.Vector3(p.pos.x, p.pos.y + 8, p.pos.z + 6);
          pitch = -0.8;
        }
      }
    }
    cam.position.lerp(target, p.alive ? 1 : 0.25);
    if (p.alive) cam.position.copy(target);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = yaw + (p.alive ? p.punchYaw : 0);
    cam.rotation.x = pitch + (p.alive ? p.punchPitch : 0);
    cam.rotation.z = 0;

    // Avada scope: the world narrows as the curse charges
    const sp = SPELLS[p.curSpell];
    const zoomFrac = p.alive && p.charge && sp?.zoom
      ? Math.min(1, p.charge.t / (p.charge.total * 0.7)) : 0;
    const targetFov = this.baseFov * (1 - zoomFrac * (1 - (sp?.zoom ?? 1)));
    this.fovCur += (targetFov - this.fovCur) * Math.min(1, 14 * dt);
    if (Math.abs(this.fovCur - cam.fov) > 0.05) {
      cam.fov = this.fovCur;
      cam.updateProjectionMatrix();
    }
    this.hud.setScope(zoomFrac);
    // trauma shake + camera-feel kicks (landing dip, cast push, hit flinch)
    this.feedback.applyToCamera(cam, p.alive);
  }

  dispose() {
    this.over = true;
    this.audio.stopAmbient();
    this.defuseSound?.stop();
    for (const p of this.players) {
      this.spells.stopShield(p);
      this.spells.cancelCharge(p);
      if (p.fp) this.camera.remove(p.fp.group);
    }
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
      }
    });
    this.scene.clear();
  }
}
