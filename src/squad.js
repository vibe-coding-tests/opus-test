// Squad coordinator — one per team. Replaces the old independent per-bot route
// roll with a single team plan: a strategy weighted by economy/score/map,
// complementary roles drawn from each champion's `ai`, a synchronized execute
// (bots stage, then hit the site together), and ~2 Hz reactive mid-round calls
// (executes, rotations, retakes). Every callout flows through the comms bus.
// Fully offline and procedural, consistent with the rest of the game.
import { choice, shuffle, rand, clamp, yawTo } from './utils.js';
import { TEAM, otherTeam, pickPlan } from './data.js';

export class Squad {
  constructor(game, team) {
    this.game = game;
    this.team = team;
    this.strat = 'default';
    this.site = 'A';
    this.posture = 'full';
    this.executed = false;
    // phase the two squads' reactive ticks onto different frames
    this.reactT = team === TEAM.ORDER ? 0.25 : 0.75;
    this.lastCallT = -99;
    this.lastRotateT = -99;
    // per-match adaptation: confidence drifts with results (tilt vs. roll),
    // reads tally where the enemy attack keeps landing so defence can stack it
    this.confidence = 0;
    this.reads = { A: 0, B: 0 };
    this.clutchCalled = false;
  }

  bots() { return this.game.players.filter((p) => p.bot && p.team === this.team); }
  aliveBots() { return this.bots().filter((p) => p.alive); }
  attacking() { return this.game.attackingTeam === this.team; }

  leader() {
    const alive = this.aliveBots();
    if (!alive.length) return null;
    return alive.reduce((a, b) => (b.bot.ai.team > a.bot.ai.team ? b : a), alive[0]);
  }

  // --------------------------------------------------------- round planning ---
  planRound() {
    const g = this.game;
    this.executed = false;
    this.clutchCalled = false;
    this.lastCallT = -99;
    this.lastRotateT = -99;
    const all = g.teamPlayers(this.team);
    const avg = all.reduce((s, p) => s + p.money, 0) / Math.max(1, all.length);
    const streak = g.lossStreak[this.team] || 0;
    const top = Math.max(g.score.order, g.score.death);
    const desperate = top >= g.format.winTarget - 1 && g.score[this.team] < g.score[otherTeam(this.team)];
    // pistol rounds (match start + first round after the half) are always played
    const pistol = g.roundNum === 1 || g.roundNum === g.format.halftimeAfter + 1;

    if (pistol) this.posture = 'full';
    else if (avg < 2300) this.posture = (streak >= 2 || desperate) ? 'force' : 'save';
    else this.posture = 'full';

    if (this.attacking()) this.planAttack();
    else this.planDefend();

    // "save" means keep the gold (play the round on what you have); it does NOT
    // mean hide — the last-man eco brain in bot.objective handles that case
    if (this.posture !== 'save') {
      for (const p of this.bots()) p.bot.buy(this.posture === 'force');
    }
    this.announce();
  }

  // Greedily hand out complementary roles from each champion's temperament.
  assignRoles(bots) {
    const pool = bots.slice();
    const take = (scorer) => {
      if (!pool.length) return null;
      let best = pool[0], bs = -Infinity;
      for (const p of pool) { const s = scorer(p.bot.ai); if (s > bs) { bs = s; best = p; } }
      pool.splice(pool.indexOf(best), 1);
      return best;
    };
    const roles = new Map();
    const entry = take((a) => a.aggro * 2 + (1 - a.lurk));
    if (entry) roles.set(entry, 'entry');
    const awp = take((a) => a.snipe * 2 + a.range);
    if (awp) roles.set(awp, 'awp');
    const support = take((a) => a.util * 2 + a.team);
    if (support) roles.set(support, 'support');
    const lurk = take((a) => a.lurk * 2 + (1 - a.team));
    if (lurk) roles.set(lurk, 'lurk');
    for (const p of pool) roles.set(p, this.attacking() ? 'rifle' : 'anchor');
    return roles;
  }

  planAttack() {
    const g = this.game;
    const bots = this.bots();
    const routesAll = g.mapMeta.routes.attack || [];
    const haveB = routesAll.some((r) => r.site === 'B');

    let strat;
    if (this.posture === 'save') strat = 'save';
    else {
      const opts = [['default', 3], ['rushA', 2]];
      if (haveB) opts.push(['rushB', 2]);
      if (haveB && bots.length >= 3) opts.push(['split', 2]);
      if (bots.length >= 3) opts.push(['fake', 1.4]);
      if (this.posture === 'force') { opts.push(['rushA', 2]); if (haveB) opts.push(['rushB', 2]); }
      strat = weighted(opts);
    }
    this.strat = strat;
    this.site = strat === 'rushB' ? 'B'
      : strat === 'rushA' ? 'A'
        : (haveB && Math.random() < 0.45 ? 'B' : 'A');

    const roles = this.assignRoles(bots);
    const routesFor = (site) => routesAll.filter((r) => r.site === site);
    const byLen = (rs) => rs.slice().sort((a, b) => a.via.length - b.via.length);

    // split sends the flankers to the other site
    let flankSite = null;
    const flankSet = new Set();
    if (strat === 'split' && haveB) {
      flankSite = this.site === 'A' ? 'B' : 'A';
      const flankers = bots.filter((p) => roles.get(p) === 'lurk' || roles.get(p) === 'awp');
      (flankers.length ? flankers : bots.slice(0, Math.floor(bots.length / 2))).forEach((p) => flankSet.add(p));
    }

    for (const p of bots) {
      const sr = roles.get(p);
      const onFlank = flankSet.has(p);
      const site = onFlank ? flankSite : this.site;
      const rs = byLen(routesFor(site));
      let r;
      if (!rs.length) r = { site, via: [] };
      else if (sr === 'entry') r = rs[0];
      else if (sr === 'lurk') r = rs[rs.length - 1];
      else if (sr === 'awp') r = rs[Math.floor(rs.length / 2)] || rs[0];
      else r = choice(rs);
      p.bot.onRoundStart({ type: 'attack', site, via: r.via.slice(), viaIdx: 0, squadRole: sr, group: onFlank ? 'flank' : 'main' });
      // entries lead, supports trail, lurkers lag to time the flank; momentum
      // tightens the timings when rolling and loosens them when on tilt
      const slow = clamp(1 - this.confidence * 0.35, 0.55, 1.4);
      if (sr === 'entry') p.bot.goSlowUntil = g.time + rand(0, 1.5) * slow;
      else if (sr === 'support') p.bot.goSlowUntil = g.time + rand(1, 3) * slow;
      else if (sr === 'lurk') p.bot.goSlowUntil = g.time + rand(3, 7) * slow;
      p.bot.execAt = 0;
    }
  }

  planDefend() {
    const g = this.game;
    const bots = this.bots();
    const holds = g.mapMeta.routes.holds || { A: [], B: [], mid: [] };
    const enemySpawn = (g.world.spawns.death[0] || g.world.spawns.order[0]);
    // lean the stack toward whatever site the enemy keeps hitting (a learned read)
    const rA = this.reads.A, rB = this.reads.B;
    let plan;
    if (this.posture === 'save') plan = 'spread';
    else if (rA >= rB + 2) plan = weighted([['stackA', 3.5], ['spread', 2]]);
    else if (rB >= rA + 2) plan = weighted([['stackB', 3.5], ['spread', 2]]);
    else plan = weighted([['spread', 4], ['stackA', 1.5], ['stackB', 1.5]]);
    this.strat = plan;
    const dist = plan === 'stackA' ? ['A', 'A', 'A', 'mid', 'B', 'B']
      : plan === 'stackB' ? ['B', 'B', 'B', 'mid', 'A', 'A']
        : shuffle(['A', 'A', 'B', 'B', 'mid', 'A', 'B']);
    const roles = this.assignRoles(bots);
    let di = 0;
    for (const p of bots) {
      const sr = roles.get(p);
      let key = dist[di++ % dist.length];
      if (sr === 'awp') key = plan === 'stackB' ? 'B' : 'A'; // hold the long angle
      const spots = holds[key] && holds[key].length ? holds[key] : [[g.world.spawns.order[0].x, g.world.spawns.order[0].z]];
      const [hx, hz] = choice(spots);
      const hy = g.world.floorY(hx, hz, 25);
      const faceYaw = enemySpawn ? yawTo({ x: hx, z: hz }, { x: enemySpawn.x, z: enemySpawn.z }) : 0;
      p.bot.onRoundStart({ type: 'defend', spot: { x: hx, y: hy, z: hz }, faceYaw, squadRole: sr, holdKey: key });
      p.bot.execAt = 0;
    }
  }

  announce() {
    const ldr = this.leader();
    if (!ldr) return;
    const g = this.game;
    const rA = this.reads.A, rB = this.reads.B;
    const stacking = this.strat === 'stackA' || this.strat === 'stackB';
    const strongRead = !this.attacking() && stacking && Math.abs(rA - rB) >= 2;
    let text;
    if (strongRead) text = `They keep hitting ${this.strat === 'stackA' ? 'A' : 'B'} — stack it.`;
    else { const map = { spread: 'default', stackA: 'stackA', stackB: 'stackB' }; text = pickPlan(map[this.strat] || this.strat); }
    g.comms.say(ldr, 'plan', { scope: 'team', text, chance: 0.9 });
    // momentum tone: a confident squad talks trash, a tilted one regroups
    if (this.confidence > 0.55) g.comms.say(ldr, 'banter', { scope: 'team', mood: 'smug', chance: 0.4 });
    else if (this.confidence < -0.55) g.comms.say(ldr, 'banter', { scope: 'team', text: 'Tighten up — we need this one.', chance: 0.5 });
  }

  // Called from Game.endRound: drift confidence with the result and remember
  // where the attack landed so the next defensive plan can answer it.
  onRoundEnd(winner, reason, plantSite) {
    const won = winner === this.team;
    this.confidence = clamp(this.confidence * 0.7 + (won ? 0.3 : -0.3), -1, 1);
    if (!this.attacking()) {
      const site = plantSite || this.game.squads[otherTeam(this.team)]?.site;
      if (site === 'A' || site === 'B') this.reads[site] += 1;
    }
  }

  // ------------------------------------------------------- reactive in-round ---
  update(dt) {
    const g = this.game;
    if (g.over || g.state !== 'live') return;
    this.reactT -= dt;
    if (this.reactT > 0) return;
    this.reactT = 0.5; // ~2 Hz
    this.checkClutch();
    if (this.attacking()) this.tickAttack();
    else this.tickDefend();
  }

  // last bot alive against the odds gets a clutch line (once per round)
  checkClutch() {
    if (this.clutchCalled) return;
    const g = this.game;
    const mates = g.aliveOf(this.team);
    const foes = g.aliveOf(otherTeam(this.team)).length;
    if (mates.length === 1 && mates[0].bot && foes >= 2) {
      this.clutchCalled = true;
      g.comms.say(mates[0], 'clutch', { scope: 'team', pos: mates[0].pos, force: true });
    }
  }

  tickAttack() {
    const g = this.game;
    if (this.executed || g.relic.state === 'planted') return;
    if (this.posture === 'save') return; // eco: play it out, don't force a doomed rush
    const main = this.aliveBots().filter((p) => p.bot.role?.group !== 'flank');
    if (!main.length) return;
    const site = g.world.zones[`site${this.site}`];
    if (!site) { this.executed = true; return; }
    const staged = main.filter((p) => {
      const d = Math.hypot(p.pos.x - site.cx, p.pos.z - site.cz);
      const routeDone = (p.bot.role?.viaIdx ?? 0) >= (p.bot.role?.via?.length ?? 0);
      return d < 16 || p.bot.visT > 0 || routeDone;
    });
    const anyContact = main.some((p) => p.bot.visT > 0);
    const ready = staged.length >= Math.ceil(main.length * 0.6);
    if (!(ready || anyContact || g.roundT < 45)) return;
    // the stack is set (or time's short, or we're already fighting): execute
    this.executed = true;
    const ldr = this.leader();
    if (ldr) g.comms.say(ldr, 'objective', { scope: 'team', text: `Execute ${this.site} — go go go!`, force: true });
    let jitter = 0;
    for (const p of main) {
      p.bot.execAt = g.time + jitter;
      p.bot.goSlowUntil = 0;
      p.bot.orderPush = g.time + 14;
      jitter += rand(0.15, 0.7); // a natural stagger, not a single-frame rush
    }
  }

  tickDefend() {
    const g = this.game;
    const me = this.team;
    if (g.relic.state === 'planted') {
      if (g.time - this.lastCallT > 6) {
        this.lastCallT = g.time;
        const ldr = this.leader();
        if (ldr) g.comms.say(ldr, 'objective', { scope: 'team', text: `Planted ${g.relic.site} — retake together!` });
      }
      return;
    }
    if (g.time - this.lastRotateT < 5) return;
    const mem = [...g.teamMemory[me].values()].filter((m) => g.time - m.t < 4);
    if (mem.length < 2) return;
    const zA = g.world.zones.siteA, zB = g.world.zones.siteB;
    const count = { A: 0, B: 0 };
    for (const m of mem) {
      const dA = zA ? Math.hypot(m.x - zA.cx, m.z - zA.cz) : 1e9;
      const dB = zB ? Math.hypot(m.x - zB.cx, m.z - zB.cz) : 1e9;
      if (dA < dB && dA < 30) count.A++;
      else if (dB < 30) count.B++;
    }
    const hot = count.A >= 2 && count.A >= count.B ? 'A' : count.B >= 2 ? 'B' : null;
    if (!hot) return;
    const site = g.world.zones[`site${hot}`];
    if (!site) return;
    const here = this.aliveBots().filter((p) => p.bot.role?.holdKey === hot).length;
    if (here >= count[hot]) return; // enough bodies already
    const rotators = this.aliveBots().filter((p) => p.bot.role?.holdKey !== hot && !p.bot.order && !p.hasRelic);
    if (!rotators.length) return;
    const mover = rotators.sort((a, b) => dist(a, site) - dist(b, site))[0];
    this.lastRotateT = g.time;
    mover.bot.order = { type: 'go', site: hot, until: g.time + 16, obey: true };
    mover.bot.thinkT = 0;
    const ldr = this.leader() || mover;
    g.comms.say(ldr, 'contact', { scope: 'team', text: `They're hitting ${hot} — rotate!`, force: true });
  }
}

function weighted(opts) {
  let tot = 0;
  for (const [, w] of opts) tot += w;
  let r = Math.random() * tot;
  for (const [v, w] of opts) { if ((r -= w) <= 0) return v; }
  return opts[0][0];
}

function dist(p, z) { return Math.hypot(p.pos.x - z.cx, p.pos.z - z.cz); }
