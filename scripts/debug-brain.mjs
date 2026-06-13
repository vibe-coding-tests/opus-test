// Dump attacker bot decision state after N sim-seconds. Dev-only.
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

await page.goto(`${BASE}/?auto=1&map=dust2&team=order&char=harry&diff=normal`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game && window.__game.state, null, { timeout: 20000 });
await page.evaluate(() => window.__game.particles.setQuality(0.2));

const out = await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 1200; i++) g.update(0.025); // 30s: freeze + 25s of live
  const rows = [];
  for (const p of g.players) {
    if (!p.bot || p.team !== g.attackingTeam) continue;
    const b = p.bot;
    rows.push({
      name: p.name, char: p.char.id, pos: [+p.pos.x.toFixed(1), +p.pos.z.toFixed(1)],
      role: b.role?.squadRole ?? null, group: b.role?.group ?? null,
      viaIdx: b.role?.viaIdx, via: b.role?.via?.length, type: b.role?.type,
      order: b.order ? (b.order.type + (b.order.site ? ':' + b.order.site : '')) : null,
      execIn: b.execAt ? +(b.execAt - g.time).toFixed(1) : 0,
      move: [+p.ctrl.moveX.toFixed(2), +p.ctrl.moveZ.toFixed(2)],
      path: b.path ? b.path.length : null, pathIdx: b.pathIdx,
      goal: b.pathGoal ? [+b.pathGoal.x.toFixed(0), +b.pathGoal.z.toFixed(0)] : null,
      detour: !!b.detour, target: b.target?.name ?? null, visT: +b.visT.toFixed(2),
      goSlow: +(b.goSlowUntil - g.time).toFixed(1), retreat: +b.retreating.toFixed(2),
      stuckT: +b.stuckT.toFixed(2), hp: Math.round(p.health), alive: p.alive,
      freeze: +p.freezeT.toFixed(2), disarm: +p.disarmT.toFixed(2), blind: +p.blindT.toFixed(2),
      time: +g.time.toFixed(1), roundT: +g.roundT.toFixed(1),
    });
  }
  // squad coordinator snapshot: strategy, economy, roles, learned adaptation
  const squadDump = (s) => ({
    team: s.team, attacking: s.attacking(), strat: s.strat, posture: s.posture,
    site: s.site, executed: s.executed, leader: s.leader()?.name ?? null,
    confidence: +s.confidence.toFixed(2), reads: s.reads,
    roles: s.aliveBots().map((p) => `${p.char.id}:${p.bot.role?.squadRole}@${p.bot.role?.site || p.bot.role?.holdKey || '?'}`),
  });
  return { round: g.roundNum, attacking: g.attackingTeam, bots: rows, squads: { order: squadDump(g.squads.order), death: squadDump(g.squads.death) } };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
