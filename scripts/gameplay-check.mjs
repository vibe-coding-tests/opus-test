// Focused checks for the gameplay pass: bot difficulty/push, planting,
// movespeed parity, jump height, spectating, and prop collision.
// Dev-only. Usage: node scripts/gameplay-check.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5220';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();

const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const log = (...a) => console.log('[gp]', ...a);
let fails = 0;
const check = (ok, label) => { log((ok ? 'PASS' : 'FAIL') + ' — ' + label); if (!ok) fails++; };

async function load(qs) {
  errs.length = 0;
  await page.goto(`${BASE}/?auto=1&${qs}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__game.state, null, { timeout: 45000 });
  await page.evaluate(() => window.__game.particles.setQuality(0.3));
}
async function ff(secs) {
  await page.evaluate((s) => { const g = window.__game; const n = Math.ceil(s / 0.025); for (let i = 0; i < n && !g.over; i++) g.update(0.025); }, secs);
}

// ---------------------------------------------------- 1. movespeed parity ---
await load('map=dust2&team=order&char=harry&diff=normal');
await ff(8);
const sp = await page.evaluate(() => {
  const g = window.__game;
  // take full ownership of the human: pretend pointer is locked (else the
  // engine zeroes the human's ctrl every frame), silence input + autoplay brain
  g.input.locked = true;
  g.handleHumanInput = () => {};
  const h = g.human; if (h.bot) h.bot.update = () => {};
  const bot = g.players.find((p) => p.alive && p.bot && p.team === h.team && p !== h);
  bot.bot.update = () => {};
  // identical engine conditions: same speed stat, no discipline / modifiers,
  // both standing at the same open spot moving the same way
  bot.stats = { ...bot.stats, speed: h.stats.speed };
  // place both on open, flat spawn ground (well clear of walls/ledges)
  const sps = g.world.spawns[h.team] || g.world.spawns.order || g.world.spawns.death || [];
  const pa = sps[0] || { x: h.pos.x, z: h.pos.z };
  const pb = sps[1] || sps[0] || { x: h.pos.x + 6, z: h.pos.z };
  let si = 0;
  for (const [pl, sp] of [[h, pa], [bot, pb]]) {
    pl.disc = null; pl.flying = false; pl.recharging = 0; pl.slowT = 0; pl.snareT = 0;
    pl.charge = null; pl.body.height = 1.8; pl.feralT = 0; pl.parryBuffT = 0;
    pl.pos.set(sp.x, 2, sp.z); pl.vel.set(0, 0, 0); pl.body.onGround = true; si++;
  }
  // drive each toward the map centre (an open run for several metres)
  const go = (pl) => { const d = Math.hypot(pl.pos.x, pl.pos.z) || 1; pl.ctrl.moveX = -pl.pos.x / d; pl.ctrl.moveZ = -pl.pos.z / d; pl.ctrl.jump = false; pl.ctrl.crouch = false; pl.ctrl.walkHeld = false; pl.ctrl.castHeld = false; };
  for (let i = 0; i < 16; i++) { h.ctrl.moveX = h.ctrl.moveZ = 0; bot.ctrl.moveX = bot.ctrl.moveZ = 0; g.update(0.025); } // settle onto the floor
  let hmax = 0, bmax = 0;
  for (let i = 0; i < 50; i++) { go(h); go(bot); g.update(0.025); hmax = Math.max(hmax, h.horizSpeed); bmax = Math.max(bmax, bot.horizSpeed); }
  return {
    human: +hmax.toFixed(3), bot: +bmax.toFixed(3), base: h.stats.speed,
    dbg: `same=${bot === h} hHasBot=${!!h.bot} botAlive=${bot.alive} botFreeze=${(bot.freezeT || 0).toFixed(2)} botGround=${bot.body.onGround} botMoveZ=${bot.ctrl.moveZ} botVelZ=${bot.vel.z.toFixed(2)} botY=${bot.pos.y.toFixed(2)} hY=${h.pos.y.toFixed(2)}`,
  };
});
log('   ' + sp.dbg);
check(Math.abs(sp.human - sp.bot) < 0.05, `movespeed parity (same char): human=${sp.human} bot=${sp.bot} base=${sp.base}`);

// character spread (informational): slowest vs fastest base speed
const spread = await page.evaluate(() => {
  const g = window.__game;
  const speeds = g.players.map((p) => p.stats.speed);
  return { min: Math.min(...speeds), max: Math.max(...speeds) };
});
log(`   character base-speed spread in lobby: ${spread.min} … ${spread.max}`);

// ---------------------------------------------------------- 2. jump height ---
const jp = await page.evaluate(() => {
  const g = window.__game; g.input.locked = true; g.handleHumanInput = () => {};
  const h = g.human; if (h.bot) h.bot.update = () => {};
  h.flying = false; h.ctrl.crouch = false; h.body.height = 1.8;
  const z = g.world.zones.siteB; const gy = g.world.groundY(z.cx, z.cz, 12);
  h.pos.set(z.cx, Number.isFinite(gy) ? gy : 1, z.cz); h.vel.set(0, 0, 0); h.body.onGround = true;
  for (let i = 0; i < 16; i++) { h.ctrl.moveX = 0; h.ctrl.moveZ = 0; h.ctrl.jump = false; g.update(0.025); }
  const y0 = h.pos.y; let peak = y0;
  h.ctrl.jump = true; g.update(0.025); h.ctrl.jump = false;
  for (let i = 0; i < 80; i++) { h.ctrl.jump = false; g.update(0.025); peak = Math.max(peak, h.pos.y); if (h.body.onGround && i > 6) break; }
  return { rise: +(peak - y0).toFixed(3) };
});
check(jp.rise > 1.12 && jp.rise < 1.45, `jump height ${jp.rise}m (was ~1.02, target ~1.22)`);

// ------------------------------------------------- 3. spectate (overlay) ---
await load('map=dust2&team=order&char=harry&diff=normal');
await ff(8);
const spec = await page.evaluate(() => {
  const g = window.__game; const h = g.human;
  for (const p of g.players) if (p.bot) { p.bot.update = () => {}; Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false }); }
  g.kill(h, g.players.find((p) => p.team !== h.team), null, false);
  const deathShownEarly = !document.querySelector('.death-screen').classList.contains('hidden');
  for (let i = 0; i < 200; i++) g.update(0.025); // 5s >> 2.2s death cam
  const mate = g.players.find((p) => p.alive && p.team === h.team);
  const cam = g.camera.position;
  return {
    deathShownEarly,
    deathHiddenAfter: document.querySelector('.death-screen').classList.contains('hidden'),
    specLabel: !document.querySelector('.spectate').classList.contains('hidden'),
    camOnMate: !!mate && cam.distanceTo(mate.eyePos()) < 2.5,
  };
});
check(spec.deathShownEarly && spec.deathHiddenAfter && spec.specLabel && spec.camOnMate,
  `spectate: deathScreen shows then auto-clears=${spec.deathHiddenAfter}, label=${spec.specLabel}, camOnMate=${spec.camOnMate}`);

// ------------------------------------------------------- 4. prop collision ---
await load('map=ministry&team=order&char=harry&diff=normal');
await ff(6);
const col = await page.evaluate(() => {
  const g = window.__game; g.input.locked = true; g.handleHumanInput = () => {};
  const h = g.human; if (h.bot) h.bot.update = () => {};
  h.flying = false; h.ctrl.crouch = false;
  // fountain plinth is a solid prop at world origin (box y0..1, r≈1.4). Stand on
  // the shallow pool floor (~y0), not the elevated atrium structures above it.
  h.pos.set(4, 0.4, 0); h.vel.set(0, 0, 0); h.body.onGround = true;
  for (let i = 0; i < 14; i++) { h.ctrl.moveX = 0; h.ctrl.moveZ = 0; h.ctrl.jump = false; g.update(0.025); } // settle to pool floor
  let closest = 99, start = Math.hypot(h.pos.x, h.pos.z);
  let minY = 99, maxY = -99;
  for (let i = 0; i < 200; i++) { h.ctrl.moveX = -1; h.ctrl.moveZ = 0; h.ctrl.jump = false; g.update(0.025); closest = Math.min(closest, Math.hypot(h.pos.x, h.pos.z)); minY = Math.min(minY, h.pos.y); maxY = Math.max(maxY, h.pos.y); }
  const gy = h.pos.y;
  const propBoxes = g.world.boxes.filter((b) => b.tag === 'prop').length;
  const nearOrigin = g.world.boxes.filter((b) => b.x0 < 1 && b.x1 > -1 && b.z0 < 1 && b.z1 > -1).map((b) => `[${b.tag} y${b.y0.toFixed(1)}-${b.y1.toFixed(1)}]`).join(',');
  return { closest: +closest.toFixed(2), start: +start.toFixed(2), moved: +(start - closest).toFixed(2), gy: +(Number.isFinite(gy) ? gy : NaN).toFixed(2), pY: `${minY.toFixed(2)}..${maxY.toFixed(2)}`, propBoxes, nearOrigin };
});
log(`   gy=${col.gy} playerY=${col.pY} propBoxes=${col.propBoxes} nearOrigin=${col.nearOrigin}`);
check(col.closest > 1.4 && col.moved > 1.0, `fountain plinth blocks walk-through (walked ${col.moved}m in, stopped at ${col.closest}m from centre; must move yet stay > 1.4)`);

// ------------------------------------------------------ 5. bot plants relic ---
await load('map=dust2&team=death&char=bellatrix&diff=hard');
await ff(8);
const plant = await page.evaluate(() => {
  const g = window.__game; const r = g.relic;
  const site = g.world.zones.siteA; const gy = g.world.groundY(site.cx, site.cz, 12);
  const att = g.attackingTeam;
  const carrier = g.players.find((p) => p.alive && p.bot && p.team === att);
  if (!carrier) return { planted: false, reason: 'no bot attacker' };
  if (r.carrier) r.carrier.hasRelic = false;
  r.state = 'carried'; r.carrier = carrier; carrier.hasRelic = true;
  carrier.bot.role = { type: 'attack', site: 'A', via: [], viaIdx: 0 };
  carrier.pos.set(site.cx + 4, Number.isFinite(gy) ? gy : 0, site.cz + 4);
  // banish defenders so we isolate the plant routine
  const ds = g.world.spawns[g.defendingTeam()] || [];
  let di = 0;
  for (const p of g.players) {
    if (p.team !== att) { if (p.bot) p.bot.update = () => {}; const s = ds[di++ % Math.max(1, ds.length)]; if (s) p.pos.set(s.x, 0.1, s.z); }
  }
  let planted = false;
  for (let i = 0; i < 30 / 0.025 && !planted; i++) { g.update(0.025); if (r.state === 'planted') planted = true; }
  return { planted, prog: +(r.plantProgress || 0).toFixed(1), state: r.state };
});
check(plant.planted, `bot carrier plants the relic (state=${plant.state})`);

// ----------------------------------------- 6. legend attackers PUSH (no freeze) ---
await load('map=dust2&team=order&char=harry&diff=legend');
await ff(6);
const push = await page.evaluate(() => {
  const g = window.__game;
  const att = () => g.players.filter((p) => p.alive && p.bot && p.team === g.attackingTeam);
  const prev = {}; const trav = {};
  for (const p of att()) { prev[p.id] = { x: p.pos.x, z: p.pos.z }; trav[p.id] = 0; }
  for (let i = 0; i < 160 && !g.over; i++) {
    g.update(0.025);
    for (const p of att()) { if (prev[p.id]) { trav[p.id] += Math.hypot(p.pos.x - prev[p.id].x, p.pos.z - prev[p.id].z); prev[p.id] = { x: p.pos.x, z: p.pos.z }; } }
  }
  const vals = Object.values(trav); const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  return { avg: +avg.toFixed(2), n: vals.length };
});
check(push.avg > 2.5, `legend attackers keep moving, don't freeze-snipe (avg travel ${push.avg}m over 4s across ${push.n} bots)`);

log(fails === 0 ? 'ALL GAMEPLAY CHECKS PASSED' : `${fails} CHECK(S) FAILED`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
