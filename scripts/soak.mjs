// Headless smoke + soak test suite. Dev-only; not part of the game.
// Usage: node scripts/soak.mjs [baseUrl]   (default http://localhost:5174)
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5174';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();

const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const realErrors = () => errs.filter((e) => !/pointer lock/i.test(e) && !/favicon/.test(e));

const log = (...a) => console.log('[soak]', ...a);
// make harness crashes visible even when stdout is piped/filtered
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => {
    console.log(`[soak] FAIL — harness crash (${ev}): ${e?.message || e}`);
    console.log(e?.stack || '');
    process.exit(1);
  });
}
let failures = 0;
const check = (ok, label) => {
  log((ok ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!ok) failures++;
};

async function load(qs) {
  errs.length = 0;
  await page.goto(`${BASE}/?auto=1&${qs}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__game.state, null, { timeout: 45000 });
  await page.evaluate(() => window.__game.particles.setQuality(0.3));
}

// Advance the simulation faster than realtime (rendering stays on rAF).
async function fastForward(gameSeconds) {
  await page.evaluate((secs) => {
    const g = window.__game;
    const steps = Math.ceil(secs / 0.025);
    for (let i = 0; i < steps && !g.over; i++) g.update(0.025);
  }, gameSeconds);
}

// ---------------------------------------------------------------- 1. maps ---
for (const map of ['dust2', 'dust', 'inferno', 'aztec', 'mirage', 'nuke', 'hall', 'dungeons', 'astronomy', 'quidditch', 'hogsmeade', 'chamber', 'diagon', 'gringotts', 'ministry']) {
  await load(`map=${map}&team=order&char=harry&diff=normal`);
  await fastForward(15);
  const info = await page.evaluate(() => {
    const g = window.__game;
    return {
      state: g.state, players: g.players.length, navNodes: g.world.nav.nodes.length,
      nan: g.players.filter((p) => !Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).length,
    };
  });
  const bad = realErrors();
  check(info.players === 10 && info.navNodes > 200 && info.nan === 0 && bad.length === 0,
    `map ${map} (state=${info.state} nav=${info.navNodes} nan=${info.nan} errors=${bad.length})`);
  if (bad.length) log('   errors:', bad.slice(0, 3));
}

// ------------------------------------------------------- 2. defuse by bots ---
await load('map=dust2&team=death&char=bellatrix&diff=normal');
await fastForward(8); // into live
const defuseResult = await page.evaluate(async () => {
  const g = window.__game;
  // force a planted relic at site A; defenders (order) should converge and dispel
  const r = g.relic, z = g.world.zones.siteA;
  const gy = g.world.groundY(z.cx, z.cz, 10);
  if (r.carrier) { r.carrier.hasRelic = false; r.carrier = null; }
  r.state = 'planted'; r.site = 'A'; r.fuseT = 34; r.warned = false;
  r.planter = g.players.find((p) => p.team === g.attackingTeam);
  r.pos.set(z.cx, Number.isFinite(gy) ? gy : 0, z.cz);
  g.effects.plantRelic(r.pos.clone());
  // give defenders a fighting chance: remove attackers from the fight entirely
  for (const p of g.players) {
    if (p.alive && p.bot && p.team === g.attackingTeam) {
      p.bot.update = () => {};
      p.pos.set(g.world.spawns.death[0].x, 0.1, g.world.spawns.death[0].z);
    }
  }
  let outcome = null, maxProg = 0;
  for (let i = 0; i < 55 / 0.025 && !outcome; i++) {
    g.update(0.025);
    maxProg = Math.max(maxProg, r.defuseProgress || 0);
    if (r.state === 'defused') outcome = 'defused';
    if (r.state === 'exploded') outcome = 'exploded';
  }
  const defendersAlive = g.players.filter((p) => p.alive && p.team !== g.attackingTeam).length;
  return { outcome, defuser: r.defuser?.name || null, maxProg: +maxProg.toFixed(1), defendersAlive };
});
check(defuseResult.outcome === 'defused',
  `bot defuse (outcome=${defuseResult.outcome} by=${defuseResult.defuser} maxProg=${defuseResult.maxProg}s defAlive=${defuseResult.defendersAlive})`);

// --------------------------------------------------- 3. full match + lock ---
await load('map=dust2&team=order&char=harry&diff=normal');
await page.evaluate(() => {
  const inp = window.__game.input;
  window.__lockCalls = 0;
  const orig = inp.lock.bind(inp);
  inp.lock = () => { window.__lockCalls++; return orig(); };
});
let matchInfo = null;
for (let i = 0; i < 80; i++) {
  await fastForward(30);
  matchInfo = await page.evaluate(() => {
    const g = window.__game;
    return {
      over: g.over, state: g.state, round: g.roundNum, score: { ...g.score },
      attacking: g.attackingTeam, halftime: !!g.halftimeDone,
      history: g.roundHistory.map((h) => h.winner + ':' + h.reason),
      nan: g.players.filter((p) => !Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).map((p) => p.name),
      money: g.players.map((p) => p.money), lockCalls: window.__lockCalls,
    };
  });
  if (matchInfo.over) break;
}
const reasons = new Set(matchInfo.history.map((h) => h.split(':')[1]));
check(matchInfo.over, `match completes (rounds=${matchInfo.history.length} score=${matchInfo.score.order}:${matchInfo.score.death})`);
const sweep = matchInfo.history.length <= 8 && Math.max(matchInfo.score.order, matchInfo.score.death) >= 8;
check(matchInfo.halftime || sweep, `halftime swap happened (attacking now=${matchInfo.attacking}${sweep ? ', swept pre-half' : ''})`);
check(matchInfo.nan.length === 0, `no NaN positions (${matchInfo.nan.join(',') || 'clean'})`);
check(matchInfo.lockCalls < 60, `pointer-lock not spammed (${matchInfo.lockCalls} calls)`);
log('   round outcomes:', matchInfo.history.join(' '));
log('   outcome kinds seen:', [...reasons].join(', '));
const matchErrs = realErrors();
check(matchErrs.length === 0, `no console errors over full match (${matchErrs.length})`);
if (matchErrs.length) log('   errors:', matchErrs.slice(0, 5));

// ------------------------------------------------------------------- 4. dm ---
await load('mode=dm&map=inferno&char=hermione&diff=normal');
await fastForward(75);
// dm respawns use real setTimeout: give them a beat
await page.waitForTimeout(3500);
const dm = await page.evaluate(() => {
  const g = window.__game;
  return {
    mode: g.mode, kills: g.players.reduce((s, p) => s + p.kills, 0),
    respawned: g.players.filter((p) => p.deaths > 0 && p.alive).length,
    nan: g.players.filter((p) => !Number.isFinite(p.pos.x + p.pos.y + p.pos.z)).length,
  };
});
check(dm.kills > 3 && dm.respawned > 0 && dm.nan === 0, `deathmatch (kills=${dm.kills} respawned=${dm.respawned} nan=${dm.nan})`);
const dmErrs = realErrors();
check(dmErrs.length === 0, `no console errors in dm (${dmErrs.length})`);
if (dmErrs.length) log('   errors:', dmErrs.slice(0, 5));

// -------------------------------------------------------- 5. on-hit effects ---
await load('map=dust2&team=order&char=harry&diff=normal');
await fastForward(8); // into live
const fx = await page.evaluate(async () => {
  const { SPELLS } = await import('/src/data.js');
  const g = window.__game;
  const h = g.human;
  const res = {};
  const step = (s) => { for (let i = 0; i < Math.ceil(s / 0.025); i++) g.update(0.025); };

  // freeze all bot brains: we want lab conditions (clear held inputs too)
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  const victim = g.players.find((p) => p.team !== h.team && p.alive);
  const sp = g.world.spawns.order[0];
  const gy = g.world.groundY(sp.x, sp.z, 30);
  h.pos.set(sp.x, gy + 0.05, sp.z); h.vel.set(0, 0, 0);
  victim.pos.set(sp.x + 4, gy + 0.05, sp.z); victim.vel.set(0, 0, 0);
  victim.health = victim.stats.hp;

  // A) stupefy: knockback + stagger + body flash
  g.spells.boltHit({ spell: SPELLS.stupefy, owner: h, traveled: 4, vx: 46, vy: 0, vz: 0 }, victim, 'chest', victim.eyePos());
  res.stagger = victim.staggerT > 0;
  res.knockback = victim.vel.x > 1;
  res.bodyFlash = victim.rig.flashT > 0;

  // B) expelliarmus: wand flies out, settles, then returns at timer end
  victim.applyDisarm(2.0, g, { x: 1, y: 0, z: 0 });
  res.wandSpawned = !!victim.wandProp;
  step(1.2);
  res.wandSettled = victim.wandProp?.settled === true;
  step(1.2);
  res.wandReturned = victim.disarmT === 0 && !victim.wandProp;

  // C) incendio: ignites + burnT ticks
  g.effects.spawnFire(victim.pos.clone(), SPELLS.incendio, h);
  const hpBefore = victim.health;
  step(0.5);
  res.burning = victim.burnT > 0 && victim.health < hpBefore;

  // D) avada: instant death + rigid ragdoll corpse
  victim.pos.x += 8; victim.vel.set(0, 0, 0); // out of the fire
  step(0.8);
  victim.health = victim.stats.hp; victim.bleeds.length = 0;
  g.spells.boltHit({ spell: SPELLS.avada, owner: h, traveled: 4, vx: 82, vy: 0, vz: 0 }, victim, 'chest', victim.eyePos());
  res.avadaKills = !victim.alive;
  res.corpseLaunched = !!victim.rig.corpse;
  step(2.5);
  res.corpseSettled = victim.rig.corpse?.landed === true;

  // E) bombarda blast: distance-scaled shove
  const v2 = g.players.find((p) => p.team !== h.team && p.alive);
  const center = v2.pos.clone(); center.x += 0.6; center.y += 0.5;
  g.explosion(center, SPELLS.bombarda.radius, 40, h, SPELLS.bombarda);
  res.blastShove = Math.hypot(v2.vel.x, v2.vel.z) > 2;
  res.blastStagger = v2.staggerT > 0;

  // F) crucio slow plumbing + muffle API don't throw headless
  v2.slowT = 1.5;
  g.audio.setMuffle(0.8, 1.0);
  step(0.5);
  res.slowed = v2.alive ? v2.speedMult() < 0.75 : true;
  return res;
});
for (const [k, v] of Object.entries(fx)) check(v === true, `on-hit: ${k}`);
const fxErrs = realErrors();
check(fxErrs.length === 0, `no console errors in fx scenario (${fxErrs.length})`);
if (fxErrs.length) log('   errors:', fxErrs.slice(0, 5));

// ------------------------------------------- 6. defensive battle interactions ---
await load('map=dust2&team=order&char=harry&diff=normal');
await fastForward(8); // into live
const def = await page.evaluate(async () => {
  const { SPELLS } = await import('/src/data.js');
  const g = window.__game;
  const h = g.human;
  const res = {};
  const step = (s) => { for (let i = 0; i < Math.ceil(s / 0.025); i++) g.update(0.025); };
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    g.spells.cancelCharge(p); // a frozen bot must not release a charged curse mid-test
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  g.spells.clear(); // no stray projectiles in the lab
  const enemy = g.players.find((p) => p.team !== h.team && p.alive);
  const sp = g.world.spawns.order[0];
  const gy = g.world.groundY(sp.x, sp.z, 30);
  // park bystanders well clear of the firing line
  g.players.forEach((p, i) => {
    if (p !== h && p !== enemy) { p.pos.set(sp.x - 40, gy + 0.05, sp.z - 40 - i * 2); p.vel.set(0, 0, 0); }
  });
  h.pos.set(sp.x, gy + 0.05, sp.z); h.vel.set(0, 0, 0); h.health = h.stats.hp;
  enemy.pos.set(sp.x + 6, gy + 0.05, sp.z); enemy.vel.set(0, 0, 0); enemy.health = enemy.stats.hp;
  const mkBolt = (owner, spell, x, y, z, vx) => {
    const fx = g.effects.acquireBolt(spell);
    fx.group.position.set(x, y, z);
    g.spells.projectiles.push({ x, y, z, vx, vy: 0, vz: 0, spell, owner, life: 5, traveled: 0, gravity: 0, fx });
  };

  // A) petrificus: full body-bind — frozen solid, then a hard hit shatters it
  g.spells.boltHit({ spell: SPELLS.petrificus, owner: h, traveled: 5, vx: 40, vy: 0, vz: 0 }, enemy, false, enemy.eyePos());
  res.petrified = enemy.freezeT > 0;
  enemy.ctrl.moveX = 1; // statue tries to walk
  const ex = enemy.pos.x;
  step(0.4);
  res.frozenStill = Math.abs(enemy.pos.x - ex) < 0.05 && enemy.freezeT > 0;
  g.damage(enemy, h, 25, SPELLS.stupefy, false, null, true);
  res.bindShattered = enemy.freezeT === 0;
  enemy.ctrl.moveX = 0;

  // B) patronus ward: blocks enemy bolts, lets friendly fire through, expires
  enemy.health = enemy.stats.hp; h.health = h.stats.hp;
  const wardPos = h.pos.clone(); wardPos.x += 3;
  const yaw = Math.atan2(enemy.pos.x - h.pos.x, enemy.pos.z - h.pos.z); // normal faces the enemy
  g.effects.spawnWard(wardPos, yaw, h, SPELLS.patronum);
  mkBolt(enemy, SPELLS.stupefy, enemy.pos.x - 1, gy + 1.5, enemy.pos.z, -46);
  step(0.5);
  res.wardBlocksEnemy = h.health === h.stats.hp && g.spells.projectiles.length === 0;
  const hpE = enemy.health;
  mkBolt(h, SPELLS.stupefy, h.pos.x + 1, gy + 1.4, h.pos.z, 46);
  step(0.5);
  res.wardPassesFriendly = enemy.health < hpE;
  step(6.0);
  res.wardExpires = g.effects.wards.length === 0;

  // C) protego perfect block: shield raised at the last instant reflects the bolt
  // (the bot parries — the human's altHeld is cleared each frame without pointer lock;
  // bots only reflect on a deliberate parry read, so declare the intent)
  enemy.health = enemy.stats.hp; h.health = h.stats.hp;
  enemy.bot.parryIntent = true;
  enemy.bot.shieldUntil = Infinity; // hold the read open for the whole lab check
  enemy.ctrl.altHeld = true;
  step(0.05); // shield snaps up — shieldOnAt = now
  mkBolt(h, SPELLS.stupefy, h.pos.x + 1, gy + 1.45, h.pos.z, 46);
  step(0.1);
  res.parryReflected = g.spells.projectiles.some((pr) => pr.owner === enemy);
  step(0.5);
  res.parryPunishes = h.health < h.stats.hp && enemy.health === enemy.stats.hp;
  enemy.ctrl.altHeld = false;
  g.spells.stopShield(enemy);

  // D) finite incantatem: one keypress dispels every affliction
  h.equip.finite = 1;
  h.burnT = 3; h.slowT = 1.5;
  h.bleeds.push({ t: 3, dps: 4, attacker: enemy, spell: SPELLS.sectum });
  h.useEquip('finite');
  res.cleansed = h.burnT === 0 && h.slowT === 0 && h.bleeds.length === 0 && h.equip.finite === 0;

  // E) the new kit is purchasable through the real buy flow
  h.money = 5000;
  const prevState = g.state;
  g.state = 'freeze';
  res.buyPetrificus = g.buy(h, 'spell', 'petrificus') === true && h.charges.petrificus === 1;
  res.buyPatronum = g.buy(h, 'spell', 'patronum') === true && h.charges.patronum === 1;
  res.buyFinite = g.buy(h, 'equip', 'finite') === true && h.equip.finite > 0;
  g.state = prevState;
  return res;
});
for (const [k, v] of Object.entries(def)) check(v === true, `defense: ${k}`);
const defErrs = realErrors();
check(defErrs.length === 0, `no console errors in defense scenario (${defErrs.length})`);
if (defErrs.length) log('   errors:', defErrs.slice(0, 5));

// -------------------- 7. v2: clashes, interactions, disciplines, AI flavor ---
await load('map=dust2&team=order&char=harry&diff=legend&disc=warden');
await fastForward(11);
const v2 = await page.evaluate(async () => {
  const { SPELLS, DISCIPLINES } = await import('/src/data.js');
  const g = window.__game;
  const res = {};
  const h = g.human;
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    g.spells.cancelCharge(p);
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  g.spells.clear();
  const sp0 = g.world.spawns.order[0];
  const gy = g.world.groundY(sp0.x, sp0.z, 30);
  const enemy = g.players.find((p) => p.team !== h.team && p.alive);
  const mate = g.players.find((p) => p.team === h.team && p !== h && p.alive);
  const step = (secs) => { for (let i = 0; i < Math.ceil(secs / 0.016); i++) g.update(0.016); };
  const mkBolt = (owner, spell, x, y, z, vx) => {
    const fx = g.effects.acquireBolt(spell);
    fx.group.position.set(x, y, z);
    g.spells.projectiles.push({ x, y, z, vx, vy: 0, vz: 0, spell, owner, life: 5, traveled: 0, gravity: 0, fx });
  };
  // park everyone away from the lab so stray bodies don't eat bolts
  enemy.pos.set(sp0.x, gy + 0.05, sp0.z - 20); enemy.vel.set(0, 0, 0);
  mate.pos.set(sp0.x, gy + 0.05, sp0.z - 24); mate.vel.set(0, 0, 0);
  h.pos.set(sp0.x, gy + 0.05, sp0.z + 8); h.vel.set(0, 0, 0);

  // A) equal bolts annihilate
  mkBolt(mate, SPELLS.stupefy, sp0.x - 5, gy + 1.5, sp0.z, 46);
  mkBolt(enemy, SPELLS.stupefy, sp0.x + 5, gy + 1.5, sp0.z, -46);
  step(0.4);
  res.clashAnnihilates = g.spells.projectiles.length === 0;
  // B) avada burns through a stupefy
  mkBolt(mate, SPELLS.stupefy, sp0.x - 5, gy + 1.5, sp0.z, 46);
  mkBolt(enemy, SPELLS.avada, sp0.x + 5, gy + 1.5, sp0.z, -82);
  step(0.12);
  res.avadaBurnsThrough = g.spells.projectiles.length === 1 && g.spells.projectiles[0].spell.id === 'avada';
  g.spells.clear();
  // C) fumos snuffs out incendio
  const fpos = h.pos.clone(); fpos.set(sp0.x, gy + 0.05, sp0.z);
  g.effects.spawnFire(fpos, SPELLS.incendio, enemy);
  const burning = g.effects.fires.some((f) => f.t > 1);
  const dpos = h.pos.clone(); dpos.set(sp0.x + 1, gy + 0.05, sp0.z);
  g.effects.douseFires(dpos, SPELLS.fumos.radius);
  step(0.2);
  res.smokeDousesFire = burning && !g.effects.fires.some((f) => f.t > 1);
  // D) water puts out a burning wizard
  h.burnT = 4;
  h.body.inWater = true;
  step(0.05);
  res.waterStopsBurn = h.burnT === 0;
  h.body.inWater = false;
  // E) disciplines: warden drains slower, phantom runs faster, duelist bolts fly faster
  res.humanIsWarden = h.disc?.id === 'warden';
  const duelist = DISCIPLINES.find((d) => d.id === 'duelist');
  const drainNormal = SPELLS.protego.drain;
  res.wardenDrain = (h.disc.drainMult ?? 1) < 1 && drainNormal * h.disc.drainMult < drainNormal;
  const base = h.speedMult();
  h.disc = DISCIPLINES.find((d) => d.id === 'phantom');
  res.phantomFaster = h.speedMult() > base;
  h.disc = duelist;
  g.spells.cancelCharge(h);
  h.mana = 100; h.nextCastAt = 0;
  const before = g.spells.projectiles.length;
  g.spells.fire(h, SPELLS.stupefy);
  const pr = g.spells.projectiles[g.spells.projectiles.length - 1];
  res.duelistBoltFaster = g.spells.projectiles.length === before + 1 &&
    Math.hypot(pr.vx, pr.vy, pr.vz) > SPELLS.stupefy.speed * 1.05;
  g.spells.clear();
  // F) AI flavor: personalities + per-bot skill jitter exist and differ
  const bots = g.players.filter((p) => p.bot);
  res.botsHavePersonality = bots.every((p) => p.bot.ai && typeof p.bot.ai.aggro === 'number' && p.disc);
  const aims = new Set(bots.map((p) => p.bot.skill.settle.toFixed(4)));
  res.skillJitter = aims.size > 1;
  // G) bellatrix-template bots hunt close, voldemort-template snipes far
  const bella = bots.find((p) => p.char.id === 'bellatrix');
  const voldy = bots.find((p) => p.char.id === 'voldemort');
  res.styleSpread = (!bella || bella.bot.ai.range <= 8) && (!voldy || voldy.bot.ai.range >= 25);
  return res;
});
for (const [k, v] of Object.entries(v2)) check(v === true, `v2: ${k}`);
const v2Errs = realErrors();
check(v2Errs.length === 0, `no console errors in v2 scenario (${v2Errs.length})`);
if (v2Errs.length) log('   errors:', v2Errs.slice(0, 5));

// ------------------------------------------------ 8. locational hit zones ---
await load('map=dust2&team=order&char=harry&diff=normal');
await fastForward(8);
const zones = await page.evaluate(async () => {
  const { SPELLS } = await import('/src/data.js');
  const g = window.__game;
  const res = {};
  const h = g.human;
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    g.spells.cancelCharge(p);
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  g.spells.clear();
  const sp0 = g.world.spawns.order[0];
  const gy = g.world.groundY(sp0.x, sp0.z, 30);
  const victim = g.players.find((p) => p.team !== h.team && p.alive);
  const step = (secs) => { for (let i = 0; i < Math.ceil(secs / 0.016); i++) g.update(0.016); };
  // park everyone clear of the firing line
  for (const p of g.players) if (p !== victim && p !== h) { p.pos.set(sp0.x, gy + 0.05, sp0.z - 24); p.vel.set(0, 0, 0); }
  h.pos.set(sp0.x + 6, gy + 0.05, sp0.z); h.vel.set(0, 0, 0);
  victim.pos.set(sp0.x, gy + 0.05, sp0.z); victim.vel.set(0, 0, 0);
  victim.yaw = -Math.PI / 2; // face the shooter so arms hang along ±z

  // no leftover dots or ground fire from the live warmup may skew the ratios
  g.effects.fires.length = 0;
  const H = victim.body.height;
  const eye = victim.eyePos();
  const shoot = (y, zOff = 0) => {
    victim.health = victim.stats.hp;
    victim.bleeds.length = 0; victim.slowT = 0; victim.staggerT = 0;
    victim.burnT = 0; victim.freezeT = 0; victim.vestHP = 0; victim.equip.vest = 0;
    victim.pos.set(sp0.x, gy + 0.05, sp0.z); victim.vel.set(0, 0, 0);
    const fx = g.effects.acquireBolt(SPELLS.stupefy);
    fx.group.position.set(sp0.x + 6, y, sp0.z + zOff);
    g.spells.projectiles.push({ x: sp0.x + 6, y, z: sp0.z + zOff, vx: -46, vy: 0, vz: 0, spell: SPELLS.stupefy, owner: h, life: 5, traveled: 0, gravity: 0, fx });
    step(0.35);
    return victim.stats.hp - victim.health;
  };
  const base = victim.pos.y;
  const dLeg = shoot(base + H * 0.28);
  const legTagged = victim.slowT > 0;
  const dStomach = shoot(base + H * 0.52);
  const dChest = shoot(base + H * 0.74);
  const dArm = shoot(base + H * 0.74, 0.33);
  const dHead = shoot(eye.y + 0.1);
  const near = (a, b) => Math.abs(a - b) < 0.04;
  res.chestLands = dChest > 5;
  res.legMult = near(dLeg / dChest, 0.7);
  res.stomachMult = near(dStomach / dChest, 1.15);
  res.armMult = near(dArm / dChest, 0.85);
  res.headMult = near(dHead / dChest, 2.0);
  res.legTagsMovement = legTagged;
  res.ratios = `leg=${(dLeg / dChest).toFixed(2)} stomach=${(dStomach / dChest).toFixed(2)} arm=${(dArm / dChest).toFixed(2)} head=${(dHead / dChest).toFixed(2)}`;
  return res;
});
const zoneRatios = zones.ratios; delete zones.ratios;
for (const [k, v] of Object.entries(zones)) check(v === true, `hitzones: ${k}`);
log('   zone ratios:', zoneRatios);
const zoneErrs = realErrors();
check(zoneErrs.length === 0, `no console errors in hitzone scenario (${zoneErrs.length})`);
if (zoneErrs.length) log('   errors:', zoneErrs.slice(0, 5));

// --------------- 9. v3: recoil, zoom, walk, flight, items, drops, summons ---
await load('map=dust2&team=order&char=harry&diff=normal');
await fastForward(8);
const v3 = await page.evaluate(async () => {
  const { SPELLS } = await import('/src/data.js');
  const g = window.__game;
  const res = {};
  const h = g.human;
  const step = (secs) => { for (let i = 0; i < Math.ceil(secs / 0.016); i++) g.update(0.016); };
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    g.spells.cancelCharge(p);
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false, walkHeld: false });
  }
  g.spells.clear();
  // headless: without pointer lock the game zeroes the human ctrl each frame,
  // so pretend the pointer is locked and drive the ctrl struct directly
  g.handleHumanInput = () => {};
  g.input.locked = true;
  const sp0 = g.world.spawns.order[0];
  const gy = g.world.groundY(sp0.x, sp0.z, 30);
  const park = (p, x, z) => { p.pos.set(x, gy + 0.05, z); p.vel.set(0, 0, 0); };
  const enemies = g.players.filter((p) => p.team !== h.team);
  const mates = g.players.filter((p) => p.team === h.team && p !== h);
  g.players.forEach((p, i) => { if (p !== h) park(p, sp0.x - 30, sp0.z - 30 - i * 2); });
  park(h, sp0.x, sp0.z);
  h.yaw = 0; h.pitch = 0;

  // A) recoil: rapid casting kicks the view punch up and blooms the spread;
  // the punch decays back (CS-style) instead of permanently walking the pitch
  h.mana = 200;
  const baseSpread = g.spells.spreadFor(h, SPELLS.stupefy);
  const p0 = h.pitch;
  for (let i = 0; i < 4; i++) { g.spells.fire(h, SPELLS.stupefy); step(0.05); }
  res.recoilKicks = h.punchPitch > 0.02;
  res.bloomGrows = g.spells.spreadFor(h, SPELLS.stupefy) > baseSpread * 1.5;
  step(1.5);
  res.recoilRecovers = h.punchPitch < 0.01 && Math.abs(h.pitch - p0) < 1e-6;
  res.bloomSettles = g.spells.spreadFor(h, SPELLS.stupefy) < baseSpread * 1.2;
  g.spells.clear();

  // B) zoom: charging Avada narrows the FOV, releasing restores it
  h.owned.add('avada');
  h.curSpell = 'avada'; h.mana = 200;
  h.ctrl.castHeld = true;
  step(1.0);
  res.zoomIn = g.fovCur < g.baseFov - 8 && !!h.charge;
  h.ctrl.castHeld = false;
  step(1.0);
  res.zoomOut = g.fovCur > g.baseFov - 3;
  g.spells.clear();
  h.curSpell = h.slot1();

  // C) walking is silent, running is heard
  const enemy = enemies[0];
  park(enemy, sp0.x + 8, sp0.z);
  const mem = g.teamMemory[enemy.team];
  mem.clear();
  Object.assign(h.ctrl, { moveX: 1, moveZ: 0, walkHeld: false });
  step(1.5);
  res.runHeard = mem.size > 0;
  mem.clear();
  park(h, sp0.x, sp0.z);
  h.ctrl.walkHeld = true;
  step(1.5);
  res.walkSilent = mem.size === 0;
  res.walkSlower = h.walking === true;
  Object.assign(h.ctrl, { moveX: 0, walkHeld: false });
  park(enemy, sp0.x - 30, sp0.z - 30);

  // D) broom flight: mounting and holding jump gains altitude, fuel runs dry
  h.equip.broom = 1;
  h.useEquip('broom');
  const y0 = h.pos.y;
  h.ctrl.jump = true;
  step(1.2);
  res.flightClimbs = h.flying && h.pos.y > y0 + 1.2;
  step(1.6);
  res.flightExpires = !h.flying;
  h.ctrl.jump = false;
  step(1.5); // fall back down
  park(h, sp0.x, sp0.z);

  // E) vest soaks 30%; felix cheats death once; portkey channels home
  const dummy = enemies[1];
  park(dummy, sp0.x + 4, sp0.z);
  dummy.health = 100; dummy.vestHP = 0; dummy.equip.vest = 0;
  g.damage(dummy, h, 30, SPELLS.stupefy, false);
  const noVest = 100 - dummy.health;
  dummy.health = 100; dummy.equip.vest = 1; dummy.vestHP = 60;
  g.damage(dummy, h, 30, SPELLS.stupefy, false);
  const withVest = 100 - dummy.health;
  res.vestSoaks = Math.abs(withVest / noVest - 0.7) < 0.03;
  dummy.health = 20; dummy.equip.felix = 1;
  g.damage(dummy, h, 999, SPELLS.stupefy, false);
  res.felixSaves = dummy.alive && dummy.health === 1 && dummy.equip.felix === 0;
  g.damage(dummy, h, 999, SPELLS.stupefy, false);
  res.felixOnlyOnce = !dummy.alive;

  h.equip.portkey = 1;
  h.spawnPos.set(sp0.x, gy + 0.05, sp0.z);
  park(h, sp0.x + 20, sp0.z + 6);
  h.useEquip('portkey');
  step(0.6);
  g.damage(h, enemies[2], 5, SPELLS.stupefy, false); // interrupt!
  res.portkeyInterrupted = h.portkeyT === 0 && h.equip.portkey === 1;
  step(0.1);
  h.useEquip('portkey');
  step(1.6);
  res.portkeyTeleports = Math.hypot(h.pos.x - sp0.x, h.pos.z - sp0.z) < 1 && h.equip.portkey === 0;
  h.health = h.stats.hp;

  // F) death drops: wand + utility, auto-loot and E-loot
  const victim2 = enemies[2];
  park(victim2, sp0.x + 5, sp0.z);
  const { wandById } = await import('/src/data.js');
  // give the human a holly up front so the training-wand auto-swap path
  // can't grab the dropped wand while we test the grenade walk-over
  h.wand = wandById('holly');
  victim2.wand = wandById('walnut');
  victim2.charges.bombarda = 1; victim2.owned.add('bombarda');
  victim2.health = 1; victim2.alive = true;
  g.damage(victim2, h, 50, SPELLS.stupefy, false);
  const wandDrop = g.drops.find((d) => d.kind === 'wand');
  const nadeDrop = g.drops.find((d) => d.kind === 'spell');
  res.dropsSpawn = !!wandDrop && !!nadeDrop;
  // auto-scavenge the grenade by walking over it
  h.charges.bombarda = 0; h.owned.delete('bombarda');
  park(h, nadeDrop.x, nadeDrop.z);
  step(0.2);
  res.nadeScavenged = (h.charges.bombarda || 0) > 0;
  // a wand needs a deliberate E press
  park(h, wandDrop.x, wandDrop.z);
  step(0.2);
  const wandBefore = h.wand.id;
  res.wandNotAutoTaken = h.wand.id === wandBefore;
  h.ctrl.useHeld = true;
  step(0.2);
  h.ctrl.useHeld = false;
  res.wandLooted = h.wand.id === 'walnut' && wandBefore !== 'walnut';
  res.oldWandLeftBehind = g.drops.some((d) => d.kind === 'wand' && d.id === wandBefore);

  // G) serpensortia: hunts, bites, and can be shot down
  const prey = enemies[3];
  park(prey, sp0.x + 9, sp0.z);
  prey.health = 100;
  h.owned.add('serpensortia'); h.charges.serpensortia = 1; h.mana = 200;
  park(h, sp0.x, sp0.z);
  g.spells.fire(h, SPELLS.serpensortia);
  res.snakeSpawns = g.summons.length === 1;
  step(3.0);
  res.snakeBites = prey.health < 100 && prey.slowT >= 0 && g.summons.length === 0;
  // enemy snake is shootable
  const foe = enemies[0];
  park(foe, sp0.x + 40, sp0.z + 40);
  foe.owned.add('serpensortia'); foe.charges.serpensortia = 1; foe.mana = 200;
  g.spells.fire(foe, SPELLS.serpensortia);
  const snake = g.summons[0];
  if (snake) { snake.x = sp0.x + 6; snake.z = sp0.z; snake.target = null; snake.retargetT = 99; }
  const fx = g.effects.acquireBolt(SPELLS.stupefy);
  fx.group.position.set(sp0.x, snake.y + 0.2, sp0.z);
  g.spells.projectiles.push({ x: sp0.x, y: snake.y + 0.2, z: snake.z, vx: 46, vy: 0, vz: 0, spell: SPELLS.stupefy, owner: h, life: 5, traveled: 0, gravity: 0, fx });
  step(0.5);
  res.snakeShootable = snake.hp < 30;
  step(2);

  // H) AI awareness: a visible corpse plants the killer's position in team memory
  const watcher = mates[0];
  const fallen = mates[1];
  park(watcher, sp0.x, sp0.z + 2);
  park(fallen, sp0.x + 4, sp0.z + 2);
  g.recentDeaths.push({ team: h.team, x: fallen.pos.x, y: fallen.pos.y, z: fallen.pos.z, killerX: sp0.x + 30, killerZ: sp0.z, t: g.time });
  watcher.bot.seenCorpses.clear();
  g.teamMemory[h.team].clear();
  watcher.bot.noticeCorpses();
  res.corpseNoticed = [...g.teamMemory[h.team].keys()].some((k) => String(k).startsWith('corpse'));
  // losing a target starts a search sweep at the last-seen spot
  const seeker = mates[2].bot;
  seeker.target = enemies[1];
  seeker.target.alive = true;
  seeker.hadTargetT = g.time;
  seeker.search = null;
  seeker.visT = 0;
  // simulate the loss branch directly: think() with no visible enemy
  seeker.pickTarget = () => null; // deterministic: nobody in sight
  park(mates[2], sp0.x - 10, sp0.z - 40);
  seeker.think();
  res.searchStarts = !!seeker.search;
  return res;
});
for (const [k, v] of Object.entries(v3)) check(v === true, `v3: ${k}`);
const v3Errs = realErrors();
check(v3Errs.length === 0, `no console errors in v3 scenario (${v3Errs.length})`);
if (v3Errs.length) log('   errors:', v3Errs.slice(0, 5));

// -------------------------------------------- 10. pause menu + spectating ---
await load('map=dust2&team=order&char=harry&diff=normal');
await fastForward(8);
const pauseRes = await page.evaluate(() => {
  const g = window.__game;
  const res = {};
  // losing pointer lock mid-game (what the browser does on Esc) → pause menu.
  // simulate the full transition: lock engages, then Esc rips it away
  g.input.onLockChange(true);
  g.input.onLockChange(false);
  res.lockLossPauses = g.paused === true;
  res.pausePanelShown = document.querySelector('.panel-title')?.textContent === 'PAUSED';
  // Esc while the pause panel is up → resume
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
  res.escResumes = g.paused === false;
  return res;
});
const spectRes = await page.evaluate(() => {
  const g = window.__game;
  const res = {};
  const h = g.human;
  // freeze the bots so the round can't end while we ride the death cam
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    g.spells.cancelCharge(p);
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  // die, run past the death-cam, and confirm the camera rides a living teammate
  g.kill(h, g.players.find((p) => p.team !== h.team), null, false);
  res.buyClosedOnDeath = !g.hud.buyOpen;
  for (let i = 0; i < 200; i++) g.update(0.025); // 5s ≫ 2.2s death cam
  const mate = g.players.find((p) => p.alive && p.team === h.team);
  const cam = g.camera.position;
  res.cameraOnTeammate = !!mate && cam.distanceTo(mate.eyePos()) < 2.5;
  res.spectateLabel = !document.querySelector('.spectate').classList.contains('hidden');
  res.fpWandHidden = h.fp ? h.fp.group.visible === false : true;
  res.diag = `alive=${h.alive} state=${g.state} deathCamT=${g.deathCamT.toFixed(1)} paused=${g.paused} dist=${mate ? cam.distanceTo(mate.eyePos()).toFixed(2) : 'nomate'} spect=${document.querySelector('.spectate')?.className}`;
  // clicking cycles the spectate target
  const before = g.spectIdx;
  g.cycleSpectate(1);
  res.spectateCycles = g.players.filter((p) => p.alive && p.team === h.team).length < 2 || g.spectIdx !== before;
  return res;
});
const spectDiag = spectRes.diag; delete spectRes.diag;
log('   spect diag:', spectDiag);
for (const [k, v] of Object.entries({ ...pauseRes, ...spectRes })) check(v === true, `ui: ${k}`);
const uiErrs = realErrors();
check(uiErrs.length === 0, `no console errors in pause/spectate scenario (${uiErrs.length})`);
if (uiErrs.length) log('   errors:', uiErrs.slice(0, 5));

// ------------------------------- 11. environment: breakables, torches, nav ---
await load('map=dust2&team=order&char=harry&diff=normal');
await fastForward(8);
const env1 = await page.evaluate(() => {
  const g = window.__game;
  const h = g.human;
  const res = {};
  const step = (s) => { for (let i = 0; i < Math.ceil(s / 0.025); i++) g.update(0.025); };
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    g.spells.cancelCharge(p);
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  g.spells.clear();

  const crates = g.env.breakables.filter((b) => b.kind === 'crate');
  const barrels = g.env.breakables.filter((b) => b.kind === 'barrel');
  res.cratesExist = crates.length > 10;
  res.barrelsExist = barrels.length >= 4;

  // A) a crate dies to damage: collider out of the world, mesh hidden
  const crate = crates[0];
  const boxesBefore = g.world.boxes.length;
  g.env.hitBreakable(crate, 999, h);
  res.crateBreaks = crate.dead === true && crate.mesh.visible === false;
  res.colliderRemoved = g.world.boxes.length === boxesBefore - 1;

  // B) a barrel detonates after a beat and hurts whoever hugs it
  const barrel = barrels.find((b) => !b.dead);
  const victim = g.players.find((p) => p.team !== h.team && p.alive);
  victim.pos.set(barrel.x - 1.1, barrel.y + 0.05, barrel.z);
  victim.vel.set(0, 0, 0);
  victim.health = victim.stats.hp; victim.vestHP = 0; victim.equip.vest = 0;
  g.env.hitBreakable(barrel, 999, h);
  res.barrelFuseLit = g.env.pendingBooms.length > 0;
  step(0.6);
  res.barrelBooms = barrel.mesh.visible === false;
  res.barrelHurts = victim.health < victim.stats.hp;

  // C) the debounced nav rebuild actually runs after the dust settles
  step(1.0);
  res.navRebuilt = g.env.navDirtyT <= 0;

  // D) torches snuff out in a blast radius and relight on demand
  const tc = g.env.torches[0];
  g.env.extinguish(tc);
  res.torchOut = tc.lit === false && tc.light.visible === false;
  g.env.relight(tc);
  res.torchRelit = tc.lit === true && tc.light.visible === true;

  // E) round reset restores every breakable
  g.env.onRoundStart();
  res.roundRestores = g.env.breakables.every((b) => !b.dead && b.mesh.visible) &&
    g.world.boxes.length === boxesBefore;
  return res;
});
for (const [k, v] of Object.entries(env1)) check(v === true, `env: ${k}`);
const env1Errs = realErrors();
check(env1Errs.length === 0, `no console errors in env scenario (${env1Errs.length})`);
if (env1Errs.length) log('   errors:', env1Errs.slice(0, 5));

// ------------------------- 12. set pieces: bell, dragon, snitch, ambient life ---
await load('map=hogsmeade&team=order&char=harry&diff=normal');
await fastForward(8);
const env2 = await page.evaluate(() => {
  const g = window.__game;
  const h = g.human;
  const res = {};
  const step = (s) => { for (let i = 0; i < Math.ceil(s / 0.025); i++) g.update(0.025); };
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    g.spells.cancelCharge(p);
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }

  // A) the village bell rings and tips off the other team
  const bell = g.env.bells[0];
  res.bellExists = !!bell;
  const enemyTeam = h.team === 'order' ? 'death' : 'order';
  g.teamMemory[enemyTeam].clear();
  g.env.ringBell(bell, h);
  step(0.2);
  res.bellSwings = bell.swingT > 0.1 && bell.swingT < 1;
  res.bellTellsEnemy = g.teamMemory[enemyTeam].size > 0;

  // B) the dragon takes an insult personally
  const dr = g.env.dragon;
  res.dragonFlies = !!dr && dr.grp.position.y > 4;
  if (dr) {
    dr.cdUntil = 0; // lab: skip the round-start grace period
    g.env.provoke(h);
    res.dragonDives = dr.state === 'dive';
    let firesSeen = 0;
    for (let i = 0; i < 480 && dr.state !== 'circle'; i++) {
      g.update(0.025);
      firesSeen = Math.max(firesSeen, g.effects.fires.length);
    }
    res.dragonBreathesFire = firesSeen > 0;
    res.dragonCalmsDown = dr.state === 'circle';
  }

  // C) ambient life exists on this theme (birds and an owl on snow maps)
  res.ambientLife = g.env.birds.length > 0;
  step(0.5);
  return res;
});
for (const [k, v] of Object.entries(env2)) check(v === true, `setpiece: ${k}`);
const env2Errs = realErrors();
check(env2Errs.length === 0, `no console errors in set-piece scenario (${env2Errs.length})`);
if (env2Errs.length) log('   errors:', env2Errs.slice(0, 5));

// ----------------------------------- 13. snitch + AI difficulty axes spread ---
await load('map=quidditch&team=order&char=harry&diff=normal');
await fastForward(8);
const env3 = await page.evaluate(async () => {
  const { aiProfile, DIFFICULTIES } = await import('/src/data.js');
  const g = window.__game;
  const h = g.human;
  const res = {};

  // A) catching the snitch pays out and parks it for the round
  const sn = g.env.snitch;
  res.snitchExists = !!sn;
  if (sn) {
    const gold = h.money;
    g.env.catchSnitch(h);
    res.snitchPays = h.money > gold;
    res.snitchParked = sn.caught === true && sn.grp.visible === false;
  }

  // B) the difficulty axes actually spread the brain parameters
  const prof = (id) => aiProfile(DIFFICULTIES.find((d) => d.id === id).axes);
  const easy = prof('easy'), legend = prof('legend');
  res.reflexSpread = easy.reactMean > legend.reactMean * 2;
  res.aimSpread = easy.trackErr > legend.trackErr * 2;
  res.senseSpread = legend.sightDist > easy.sightDist * 1.5;
  res.iqSpread = legend.util > easy.util * 2;
  // custom axes map monotonically
  const lowRf = aiProfile({ reflex: 10, aim: 50, sense: 50, iq: 50 });
  const hiRf = aiProfile({ reflex: 90, aim: 50, sense: 50, iq: 50 });
  res.customAxes = lowRf.reactMean > hiRf.reactMean && lowRf.turnSpeed < hiRf.turnSpeed;
  // every bot got the live profile
  res.botsUseProfile = g.players.filter((p) => p.bot).every((p) => Number.isFinite(p.bot.skill.reactMean));
  return res;
});
for (const [k, v] of Object.entries(env3)) check(v === true, `brain: ${k}`);
const env3Errs = realErrors();
check(env3Errs.length === 0, `no console errors in snitch/axes scenario (${env3Errs.length})`);
if (env3Errs.length) log('   errors:', env3Errs.slice(0, 5));

// ------------------------------------- 14. hexes: Silencio + Impedimenta ---
await load('map=diagon&team=order&char=harry&diff=normal');
await fastForward(8);
const hex = await page.evaluate(async () => {
  const { SPELLS } = await import('/src/data.js');
  const g = window.__game;
  const h = g.human;
  const res = {};
  const step = (s) => { for (let i = 0; i < Math.ceil(s / 0.025); i++) g.update(0.025); };
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    g.spells.cancelCharge(p);
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  g.spells.clear();
  const foe = g.players.find((p) => p.team !== h.team && p.alive);
  const sp = g.world.spawns.order[0];
  const gy = g.world.groundY(sp.x, sp.z, 30);
  g.players.forEach((p, i) => {
    if (p !== h && p !== foe) { p.pos.set(sp.x - 30, gy + 0.05, sp.z - 30 - i * 2); p.vel.set(0, 0, 0); }
  });
  h.pos.set(sp.x, gy + 0.05, sp.z); h.vel.set(0, 0, 0);
  foe.pos.set(sp.x + 6, gy + 0.05, sp.z); foe.vel.set(0, 0, 0);
  foe.health = foe.stats.hp; foe.mana = foe.stats.mana; foe.nextCastAt = 0;

  // A) silencio: cancels a charge, blocks casting AND the shield, then wears off
  foe.charge = { t: 0.2, total: 1.0 };
  g.spells.boltHit({ spell: SPELLS.silencio, owner: h, traveled: 5, vx: 40, vy: 0, vz: 0 }, foe, false, foe.eyePos());
  res.silenceLands = foe.silenceT > 1.5;
  res.silenceCancelsCharge = !foe.charge;
  res.silenceBlocksCast = !g.spells.canFire(foe, SPELLS.stupefy);
  foe.ctrl.altHeld = true;
  step(0.2);
  res.silenceBlocksShield = !foe.shielding;
  foe.ctrl.altHeld = false;
  foe.silenceT = 0.01;
  step(0.1);
  foe.nextCastAt = 0; foe.mana = foe.stats.mana;
  res.silenceWearsOff = g.spells.canFire(foe, SPELLS.stupefy);

  // B) impedimenta: heavy snare — slower than the crucio slow, no jumping — and
  // Finite Incantatem clears it
  const preMult = foe.speedMult();
  g.spells.boltHit({ spell: SPELLS.impedimenta, owner: h, traveled: 5, vx: 40, vy: 0, vz: 0 }, foe, false, foe.eyePos());
  res.snareLands = foe.snareT > 1.5;
  res.snareSlowsHard = foe.speedMult() < preMult * 0.6;
  foe.equip.finite = 1;
  foe.useEquip('finite');
  res.finiteClearsSnare = foe.snareT === 0 && foe.equip.finite === 0;

  // C) the buy menu sells them and slot 3 cycles through every owned hex
  h.money = 5000;
  g.state = 'freeze'; // open the buy window for the lab
  res.buysImpedimenta = g.buy(h, 'spell', 'impedimenta') && (h.charges.impedimenta || 0) > 0;
  res.buysSilencio = g.buy(h, 'spell', 'silencio') && (h.charges.silencio || 0) > 0;
  const seen = new Set();
  h.curSpell = 'expelliarmus';
  for (let i = 0; i < 4; i++) { h.selectSlot(3); seen.add(h.curSpell); }
  res.slot3Cycles = seen.has('impedimenta') && seen.has('silencio') && seen.has('expelliarmus');
  return res;
});
for (const [k, v] of Object.entries(hex)) check(v === true, `hex: ${k}`);
const hexErrs = realErrors();
check(hexErrs.length === 0, `no console errors in hex scenario (${hexErrs.length})`);
if (hexErrs.length) log('   errors:', hexErrs.slice(0, 5));

// ----------------------- 15. scoreboard stats + champion identity ---
await load('map=dust2&team=order&char=harry&diff=normal');
await fastForward(8);
const sbx = await page.evaluate(async () => {
  const { SPELLS, CHARACTERS } = await import('/src/data.js');
  const g = window.__game;
  const h = g.human;
  const res = {};
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  // A) assists + headshot kills land in the books
  const foe = g.players.find((p) => p.team !== h.team && p.alive);
  const helper = g.players.find((p) => p.team === h.team && p !== h);
  foe.health = 100; foe.equip.vest = 0; foe.equip.felix = 0;
  g.damage(foe, helper, 40, SPELLS.stupefy, false, null, true);
  g.damage(foe, h, 200, SPELLS.stupefy, true, null, true);
  res.assistCredited = helper.assists === 1;
  res.hsKillCredited = h.hsK === 1 && h.kills >= 1;
  // B) the scoreboard renders the full stat line + round history strip
  g.roundHistory.push({ winner: 'order', reason: 'elim' }, { winner: 'death', reason: 'explode' });
  h.mvps = 2; h.plants = 1;
  g.hud.renderScoreboard();
  const html = g.hud.scoreboardEl.innerHTML;
  res.sbColumns = html.includes('>HS<') && html.includes('>OBJ<') && html.includes('★');
  res.sbStrip = g.hud.scoreboardEl.querySelectorAll('.sb-strip .strip-cell').length === 2;
  res.sbStars = html.includes('★★');
  // C) every champion: signature spell + accent + distinct silhouette flags
  res.favsValid = CHARACTERS.every((c) => c.fav && SPELLS[c.fav] && c.skin.accent !== undefined);
  res.favsVaried = new Set(CHARACTERS.map((c) => c.fav)).size >= 6;
  // D) rich bots actually pick up their favorite
  g.state = 'freeze'; // buy window + zone bypass (same as hex scenario)
  // (skip the bot step A just killed — the dead can't shop)
  const bot = g.players.find((p) => p.bot && p.alive && p.team !== h.team);
  let bought = false;
  for (let i = 0; i < 12 && !bought; i++) {
    bot.money = 9000;
    bot.bot.buy();
    bought = bot.owned.has(bot.char.fav);
  }
  res.botBuysFav = bought;
  return res;
});
for (const [k, v] of Object.entries(sbx)) check(v === true, `score: ${k}`);
const sbxErrs = realErrors();
check(sbxErrs.length === 0, `no console errors in scoreboard scenario (${sbxErrs.length})`);
if (sbxErrs.length) log('   errors:', sbxErrs.slice(0, 5));

// ----------------------- 16. roster picks + new character perks ---
await load('map=dust2&team=order&char=dumbledore&squad=ginny,neville,mcgonagall&foes=greyback,umbridge,lucius,wormtail,bellatrix&diff=normal');
await fastForward(8);
const roster = await page.evaluate(async () => {
  const { SPELLS } = await import('/src/data.js');
  const g = window.__game;
  const h = g.human;
  const res = {};
  const byChar = (id) => g.players.find((p) => p.charId === id);
  for (const p of g.players) if (p.bot) {
    p.bot.update = () => {};
    Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false });
  }
  // A) hand-picked lineups honored, on the right sides
  res.squadHonored = ['ginny', 'neville', 'mcgonagall'].every((id) => byChar(id)?.team === 'order');
  res.foesHonored = ['greyback', 'umbridge', 'lucius', 'wormtail', 'bellatrix'].every((id) => byChar(id)?.team === 'death');
  res.autoFilled = g.teamPlayers('order').length === 5 && g.teamPlayers('death').length === 5;
  res.noDupes = new Set(g.players.map((p) => p.charId)).size === g.players.length;

  // B) Dumbledore: cheaper shield drain + wider parry window vs a baseline
  const gb = byChar('greyback'), um = byChar('umbridge'), lu = byChar('lucius'), wt = byChar('wormtail');
  const base = byChar('bellatrix');
  h.mana = 100; g.spells.updateShield(h, true, 1.0);
  const dumbleDrain = 100 - h.mana;
  g.spells.stopShield(h);
  base.mana = 100; g.spells.updateShield(base, true, 1.0);
  const baseDrain = 100 - base.mana;
  g.spells.stopShield(base);
  res.greaterGoodDrain = dumbleDrain < baseDrain * 0.7;

  // C) Greyback: a kill feeds him HP and a speed surge
  gb.health = 60;
  const before = gb.speedMult();
  const victim = byChar('ginny');
  victim.health = 5; victim.equip.felix = 0; victim.equip.vest = 0;
  g.damage(victim, gb, 50, SPELLS.stupefy, false, null, true);
  res.hungerHeals = gb.health >= 90;
  res.hungerHastes = gb.feralT > 0 && gb.speedMult() > before * 1.1;

  // D) Umbridge: hex hit brands the victim on her team's radar
  const tgt = byChar('neville');
  g.spells.boltHit({ spell: SPELLS.silencio, owner: um, traveled: 5, vx: 40, vy: 0, vz: 0 }, tgt, false, tgt.eyePos());
  res.surveillanceTags = tgt.taggedT > 3 && tgt.taggedBy === 'death';
  res.silencioStronger = tgt.silenceT > SPELLS.silencio.silence * 1.2;
  g.update(0.025);
  res.surveillancePings = (g.time - (g.teamMemory.death.get(tgt.id)?.t ?? -99)) < 1;

  // E) McGonagall: longer petrify + hex charge cap of 2
  const mg = byChar('mcgonagall');
  const tgt2 = byChar('lucius');
  g.spells.boltHit({ spell: SPELLS.petrificus, owner: mg, traveled: 5, vx: 40, vy: 0, vz: 0 }, tgt2, false, tgt2.eyePos());
  res.transfigHolds = tgt2.freezeT > SPELLS.petrificus.freeze * 1.2;
  res.hexPockets = mg.chargeCap(SPELLS.petrificus) === 2 && h.chargeCap(SPELLS.petrificus) === 1;

  // F) Neville: cornered courage — more damage out, less in
  const nev = byChar('neville');
  nev.health = nev.stats.hp; // healthy: baseline
  const healthyPow = nev.effPower();
  nev.health = nev.stats.hp * 0.3; // cornered
  res.courageDamage = nev.effPower() > healthyPow * 1.2;
  const hpBefore = nev.health;
  g.damage(nev, base, 20, SPELLS.stupefy, false, null, true);
  res.courageTanks = (hpBefore - nev.health) < 19;

  // G) Wormtail: silent feet + free cloak each round; Ginny: free Impedimenta
  res.ratCloaked = wt.equip.cloak >= 1;
  const gin = byChar('ginny');
  res.batBogey = (gin.charges.impedimenta || 0) >= 1;

  // H) Lucius: kill pays +150 to him and +50 to living squadmates
  const lm0 = lu.money, um0 = um.money;
  const mark = byChar('mcgonagall');
  mark.health = 5; mark.equip.felix = 0; mark.equip.vest = 0;
  g.damage(mark, lu, 50, SPELLS.stupefy, false, null, true);
  res.galleonsKill = lu.money - lm0 >= SPELLS.stupefy.killReward + 150;
  res.galleonsTrickle = um.money - um0 === 50;

  // I) recoil follows the crosshair: punched view = projectile direction
  h.punchPitch = 0.1; h.punchYaw = 0.05;
  const look = h.lookDir(), aim = h.aimDir();
  res.aimFollowsPunch = aim.y > look.y + 0.05;
  h.punchPitch = 0; h.punchYaw = 0;
  res.aimMatchesRest = h.aimDir().distanceTo(h.lookDir()) < 1e-9;

  // J) Protego eats enemy bolts but lets squadmate bolts fly through
  const flyThrough = (shielder, owner) => {
    const sp = g.world.spawns.order[0];
    const gy = g.world.groundY(sp.x, sp.z, 5);
    shielder.pos.set(sp.x, gy + 0.05, sp.z); shielder.vel.set(0, 0, 0);
    shielder.shielding = true; shielder.mana = 100;
    g.effects.ensureShield(shielder);
    const eye = shielder.eyePos();
    const fx = g.effects.acquireBolt(SPELLS.stupefy);
    const pr = {
      x: eye.x - 4, y: eye.y - 0.25, z: eye.z, vx: 60, vy: 0, vz: 0,
      spell: SPELLS.stupefy, owner, life: 0.5, traveled: 0, gravity: 0, fx,
    };
    g.spells.projectiles.push(pr);
    for (let i = 0; i < 12; i++) g.spells.update(0.016);
    shielder.shielding = false;
    return pr.traveled > 5 || pr.x > eye.x + 1; // made it past the shield bubble
  };
  // (lucius shields: he's still alive — ginny fell to Greyback's hunger above)
  res.shieldPassesFriendly = flyThrough(lu, um) === true;   // death-side teammates
  res.shieldBlocksEnemy = flyThrough(lu, nev) === false;    // order enemy
  return res;
});
for (const [k, v] of Object.entries(roster)) check(v === true, `roster: ${k}`);
const rosterErrs = realErrors();
check(rosterErrs.length === 0, `no console errors in roster scenario (${rosterErrs.length})`);
if (rosterErrs.length) log('   errors:', rosterErrs.slice(0, 5));

// ------------------- 17. comms bus, player commands, pings, squad brain ---
await load('map=dust2&team=order&char=harry&diff=hard&squad=ginny,hermione,ron,neville&foes=bellatrix,greyback,draco,lucius,voldemort');
const squad = await page.evaluate(() => {
  const g = window.__game;
  const res = {};
  const human = g.human;

  // tally every line the comms bus actually emits this scenario
  const cats = {};
  const origEmit = g.comms.emit.bind(g.comms);
  g.comms.emit = (m) => { const r = origEmit(m); if (r) cats[m.cat] = (cats[m.cat] || 0) + 1; return r; };
  const step = (s) => { for (let i = 0; i < Math.ceil(s / 0.025); i++) g.update(0.025); };

  // A) the squad coordinator hands out complementary roles + a sane posture
  step(8); // through freeze into live; planRound has run for both teams
  const att = g.squads[g.attackingTeam];
  const def = g.squads[g.defendingTeam()];
  const rolesOf = (s) => new Set(s.aliveBots().map((p) => p.bot.role?.squadRole));
  res.rolesAssigned = att.aliveBots().every((p) => !!p.bot.role?.squadRole) &&
    def.aliveBots().every((p) => !!p.bot.role?.squadRole);
  res.rolesComplementary = rolesOf(att).size >= 3;
  res.postureValid = ['save', 'force', 'full'].includes(att.posture) && ['save', 'force', 'full'].includes(def.posture);

  // B) procedural voice doesn't throw headless and a teammate line hits the feed
  let voiceOk = true;
  try { g.audio.voice(g.players[0], 'urgent', g.players[0].pos, 0.5); } catch (e) { voiceOk = false; }
  res.voiceNoThrow = voiceOk;
  const mateSpk = g.aliveOf(human.team).find((p) => p.bot) || human;
  const feedBefore = document.querySelectorAll('.comms-row').length;
  g.comms.say(mateSpk, 'contact', { scope: 'team', pos: mateSpk.pos, text: 'Contact mid!', force: true });
  res.feedRenders = document.querySelectorAll('.comms-row').length > feedBefore;

  // C) a player command reaches the bots as an order, compliance is personality-gated
  human.alive = true; human.health = human.stats.hp;
  for (const p of g.aliveOf(human.team)) if (p.bot) p.bot.order = null;
  g.command('goA');
  const ordered = g.aliveOf(human.team).filter((p) => p.bot && p.bot.order && p.bot.order.type === 'go');
  res.orderApplied = ordered.length > 0;
  res.orderCompliance = ordered.some((p) => p.bot.order.obey === true);

  // D) report-in makes the squad leader answer through the bus
  let reported = false;
  const origSay = g.comms.say.bind(g.comms);
  g.comms.say = (sp, cat, o) => { if (cat === 'report') reported = true; return origSay(sp, cat, o); };
  g.command('report');
  res.reportAnswers = reported;
  g.comms.say = origSay;

  // E) a ping marks the world and alerts a nearby teammate
  const beforePings = g.pings.length;
  g.ping();
  res.pingDrops = g.pings.length > beforePings;
  const foe = g.aliveOf(g.defendingTeam())[0];
  const near = g.aliveOf(human.team).find((p) => p.bot);
  near.bot.heard = null;
  near.bot.onPing({ x: foe.pos.x, y: foe.pos.y, z: foe.pos.z, t: g.time, kind: 'enemy' });
  res.pingAlerts = !!near.bot.heard;

  // F) synchronized execute: the squad commits the main group together (execAt)
  att.executed = false;
  for (const p of att.aliveBots()) p.bot.execAt = 0;
  g.roundT = 40; // clock pressure forces the commit
  for (let i = 0; i < 3; i++) { att.reactT = 0; att.update(0.05); }
  res.executeFires = att.posture === 'save' || (att.executed && att.aliveBots().some((p) => p.bot.execAt > 0));

  // G) cover-node selection always returns a spot that truly breaks LOS
  let coverWrong = 0, coverFound = 0;
  for (const p of g.aliveOf('order').concat(g.aliveOf('death'))) {
    if (!p.bot) continue;
    const threat = { x: p.pos.x + 8, y: p.pos.y, z: p.pos.z, t: g.time };
    p.bot.coverPos = null; p.bot.coverT = 0;
    const cover = p.bot.seekCover([threat]);
    if (!cover) continue;
    coverFound++;
    if (g.world.segmentClear(cover.x, cover.y + 1.1, cover.z, threat.x, threat.y + 1.1, threat.z)) coverWrong++;
  }
  res.coverBreaksLOS = coverWrong === 0;

  // H) adaptation: a resolved round drifts both squads' confidence
  const oc0 = g.squads.order.confidence, dc0 = g.squads.death.confidence;
  g.endRound(g.defendingTeam(), 'time');
  res.confidenceDrifts = g.squads.order.confidence !== oc0 && g.squads.death.confidence !== dc0;

  g.comms.emit = origEmit;
  res.cats = `coverFound=${coverFound} ` + Object.entries(cats).map(([k, v]) => `${k}:${v}`).join(' ');
  return res;
});
const squadCats = squad.cats; delete squad.cats;
for (const [k, v] of Object.entries(squad)) check(v === true, `squad: ${k}`);
log('   comms + cover:', squadCats);
const squadErrs = realErrors();
check(squadErrs.length === 0, `no console errors in squad scenario (${squadErrs.length})`);
if (squadErrs.length) log('   errors:', squadErrs.slice(0, 5));

await browser.close();
log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
