// Playwright visual/collision audit for gameplay maps.
// Usage: PLAYWRIGHT_BROWSERS_PATH=.pw-browsers node scripts/visual-audit.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = path.resolve('artifacts', `playwright-gameplay-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const MAPS = [
  'dust2', 'dust', 'inferno', 'aztec', 'mirage', 'nuke',
  'hall', 'dungeons', 'astronomy', 'quidditch', 'hogsmeade', 'chamber',
  'diagon', 'gringotts', 'ministry',
];

const consoleErrors = [];
const screenshots = [];
const findings = [];
const mapSummaries = [];

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fastForward(page, seconds) {
  await page.evaluate((secs) => {
    const g = window.__game;
    const steps = Math.ceil(secs / 0.025);
    for (let i = 0; i < steps && !g.over; i++) g.update(0.025);
  }, seconds);
}

async function loadMap(page, map) {
  consoleErrors.length = 0;
  await page.goto(`${BASE}/?auto=1&map=${map}&team=order&char=harry&diff=normal`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && window.__game.state, null, { timeout: 45000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.particles.setQuality(0.35);
    g.settings.performanceMode = true;
    for (const p of g.players) {
      if (p.bot) p.bot.update = () => {};
      Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false, crouch: false });
      p.vel.set(0, 0, 0);
    }
    g.spells.clear();
    g.hud.openBuy(false);
  });
  await fastForward(page, 6);
  await page.evaluate(() => window.__game?.hud?.openBuy(false));
}

async function inspectMap(page, map) {
  return page.evaluate((mapId) => {
    const g = window.__game;
    const w = g.world;
    const half = 0.36;
    const standH = 1.8;
    const issues = [];
    const routes = g.mapMeta.routes || {};
    const routePoints = [];

    for (const [kind, entries] of Object.entries(routes)) {
      if (Array.isArray(entries)) {
        for (const route of entries) {
          for (const [x, z] of route.via || []) routePoints.push({ label: `${kind}:${route.name}`, x, z });
        }
      } else if (entries && typeof entries === 'object') {
        for (const [name, pts] of Object.entries(entries)) {
          for (const [x, z] of pts || []) routePoints.push({ label: `${kind}:${name}`, x, z });
        }
      }
    }

    const samples = [];
    for (const [team, arr] of Object.entries(w.spawns)) for (const [i, p] of arr.entries()) samples.push({ label: `${team} spawn ${i + 1}`, x: p.x, z: p.z });
    for (const p of w.dmSpawns) samples.push({ label: 'dm spawn', x: p.x, z: p.z });
    for (const [key, z] of Object.entries(w.zones)) if (key.startsWith('site') && z) samples.push({ label: key, x: z.cx, z: z.cz });
    samples.push(...routePoints);
    for (const [i, water] of w.waters.entries()) samples.push({ label: `water ${i + 1}`, x: (water.x0 + water.x1) / 2, z: (water.z0 + water.z1) / 2 });

    const badClearance = [];
    const badNav = [];
    for (const sample of samples) {
      const y = w.floorY(sample.x, sample.z, 40);
      if (!Number.isFinite(y) || y < -10 || y > 24) {
        badClearance.push({ ...sample, reason: `bad floorY ${y}` });
        continue;
      }
      const bodyHit = w.overlaps(sample.x - half, y + 0.05, sample.z - half, sample.x + half, y + 0.05 + standH, sample.z + half);
      if (bodyHit) badClearance.push({ ...sample, y: +y.toFixed(2), reason: `standing volume overlaps ${bodyHit.tag}` });
      const node = w.nearestNode(sample.x, y, sample.z);
      if (node < 0) badNav.push(sample);
    }
    if (badClearance.length) issues.push({ type: 'collision_clearance', severity: 'high', count: badClearance.length, examples: badClearance.slice(0, 8) });
    if (badNav.length) issues.push({ type: 'nav_missing', severity: 'medium', count: badNav.length, examples: badNav.slice(0, 8) });

    const pathIssues = [];
    const spawn = w.spawns.order[0] || w.spawns.death[0];
    if (spawn) {
      const sy = w.floorY(spawn.x, spawn.z, 40);
      for (const [key, z] of Object.entries(w.zones)) {
        if (!key.startsWith('site') || !z) continue;
        const ty = w.floorY(z.cx, z.cz, 40);
        const path = w.findPath(spawn.x, sy, spawn.z, z.cx, ty, z.cz);
        if (!path || path.length < 2) pathIssues.push({ from: 'order spawn', to: key });
      }
    }
    if (pathIssues.length) issues.push({ type: 'nav_unreachable_site', severity: 'high', count: pathIssues.length, examples: pathIssues });

    const lowCeilings = [];
    for (const box of w.boxes) {
      if (box.tag === 'roof' || box.y0 > 2.4) {
        const cx = (box.x0 + box.x1) / 2;
        const cz = (box.z0 + box.z1) / 2;
        const floor = w.floorY(cx, cz, Math.max(8, box.y0 - 0.05));
        const clearance = box.y0 - floor;
        if (Number.isFinite(clearance) && clearance > 0 && clearance < 1.95) {
          lowCeilings.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), floor: +floor.toFixed(2), roof: +box.y0.toFixed(2), clearance: +clearance.toFixed(2), tag: box.tag });
        }
      }
    }
    if (lowCeilings.length) issues.push({ type: 'low_ceiling_clip_risk', severity: 'medium', count: lowCeilings.length, examples: lowCeilings.slice(0, 8) });

    const finitePlayers = g.players.every((p) => Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.yaw + p.pitch));
    if (!finitePlayers) issues.push({ type: 'non_finite_player_state', severity: 'high', count: 1, examples: [] });

    return {
      mapId,
      theme: g.mapMeta.theme,
      players: g.players.length,
      navNodes: w.nav.nodes.length,
      boxes: w.boxes.length,
      ladders: w.ladders.length,
      waters: w.waters.length,
      issues,
      routes: routePoints.length,
      sites: Object.fromEntries(Object.entries(w.zones).filter(([k]) => k.startsWith('site')).map(([k, v]) => [k, v ? { x: v.cx, z: v.cz } : null])),
    };
  }, map);
}

async function screenshotView(page, map, label, point, target) {
  const file = path.join(OUT, `${String(screenshots.length + 1).padStart(2, '0')}-${map}-${slug(label)}.png`);
  const meta = await page.evaluate(({ point, target }) => {
    const g = window.__game;
    const h = g.human;
    const y = g.world.floorY(point.x, point.z, 40);
    h.pos.set(point.x, y + 0.05, point.z);
    h.spawnPos.copy(h.pos);
    h.vel.set(0, 0, 0);
    h.alive = true;
    h.health = h.stats.hp;
    h.mana = h.stats.mana;
    h.body.height = 1.8;
    h.body.onGround = true;
    h.eyeSmooth = 1.62;
    h.yaw = Math.atan2(-(target.x - point.x), -(target.z - point.z));
    h.pitch = point.pitch ?? -0.06;
    h.punchPitch = 0;
    h.punchYaw = 0;
    for (const p of g.players) {
      if (p !== h) {
        p.vel.set(0, 0, 0);
        Object.assign(p.ctrl, { moveX: 0, moveZ: 0, castHeld: false, altHeld: false, jump: false, crouch: false });
      }
    }
    g.hud.closeDeath();
    g.hud.openBuy(false);
    g.updateCamera(0.016);
    g.postfx?.update?.(0.016);
    return {
      x: +h.pos.x.toFixed(2),
      y: +h.pos.y.toFixed(2),
      z: +h.pos.z.toFixed(2),
      yaw: +h.yaw.toFixed(3),
      pitch: +h.pitch.toFixed(3),
      state: g.state,
    };
  }, { point, target });
  await page.waitForTimeout(80);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ map, label, file, ...meta });
}

async function captureMap(page, map) {
  const viewData = await page.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    const sites = Object.values(w.zones).filter((z) => z && z.letter);
    const death = w.spawns.death[0];
    const order = w.spawns.order[0];
    const routes = [];
    for (const entries of Object.values(g.mapMeta.routes || {})) {
      if (Array.isArray(entries)) {
        for (const route of entries) if (route.via?.length) routes.push({ name: route.name, pts: route.via });
      } else if (entries && typeof entries === 'object') {
        for (const [name, pts] of Object.entries(entries)) if (pts?.length) routes.push({ name, pts });
      }
    }
    const bounds = w.bounds;
    return {
      death,
      order,
      sites: sites.map((z) => ({ label: `site ${z.letter}`, x: z.cx, z: z.cz })),
      routes: routes.map((r) => ({ label: r.name, pts: r.pts })),
      dm: w.dmSpawns,
      bounds,
    };
  });

  const views = [];
  if (viewData.death && viewData.order) views.push({ label: 'attacker spawn lane', point: viewData.death, target: viewData.order });
  for (const site of viewData.sites.slice(0, 2)) {
    const from = viewData.dm.find((p) => Math.hypot(p.x - site.x, p.z - site.z) > 8 && Math.hypot(p.x - site.x, p.z - site.z) < 35) || viewData.order || viewData.death;
    views.push({ label: site.label, point: from, target: site });
  }
  const route = viewData.routes.find((r) => r.pts.length >= 2) || viewData.routes[0];
  if (route) {
    const mid = route.pts[Math.floor(route.pts.length / 2) - 1] || route.pts[0];
    const next = route.pts[Math.floor(route.pts.length / 2)] || route.pts[route.pts.length - 1];
    views.push({ label: `route ${route.label}`, point: { x: mid[0], z: mid[1], pitch: -0.03 }, target: { x: next[0], z: next[1] } });
  }

  for (const view of views.slice(0, 4)) await screenshotView(page, map, view.label, view.point, view.target);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/pointer lock|favicon/i.test(m.text())) consoleErrors.push(m.text());
});

for (const map of MAPS) {
  await loadMap(page, map);
  const summary = await inspectMap(page, map);
  mapSummaries.push(summary);
  for (const issue of summary.issues) findings.push({ map, ...issue });
  if (consoleErrors.length) findings.push({ map, type: 'console_error', severity: 'high', count: consoleErrors.length, examples: consoleErrors.slice(0, 5) });
  await captureMap(page, map);
}

await browser.close();

const report = {
  runAt: new Date().toISOString(),
  baseUrl: BASE,
  outDir: OUT,
  maps: mapSummaries,
  screenshots,
  findings,
};
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  outDir: OUT,
  maps: mapSummaries.length,
  screenshots: screenshots.length,
  findings: findings.length,
  findingTypes: [...new Set(findings.map((f) => f.type))],
}, null, 2));
