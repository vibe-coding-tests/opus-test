// In-match HUD: crosshair, bars, spell slots, killfeed, radar, scoreboard,
// buy menu, death screen, announcer, damage numbers and indicators.
import * as THREE from 'three';
import { SPELLS, WANDS, EQUIPMENT, TEAM, TEAM_INFO, ROUND, SLOT3, SLOT5, DASH, wandById } from './data.js';
import { el, clamp, fmtTime, fmtKDA, hexCss, lerp } from './utils.js';
import { keyLabel } from './input.js';

const DEG_R = Math.PI / 180;

// Command wheel slices, clockwise from the top. Ids are consumed by Game.command.
export const WHEEL_CMDS = [
  { id: 'push', label: 'Push!' },
  { id: 'goA', label: 'Take A' },
  { id: 'follow', label: 'Follow me' },
  { id: 'report', label: 'Report in' },
  { id: 'fallback', label: 'Fall back' },
  { id: 'goB', label: 'Take B' },
  { id: 'hold', label: 'Hold' },
  { id: 'needhelp', label: 'Need help!' },
];

// ------------------------------------------------------------ spell icons ---
const iconCache = {};
export function spellIcon(kind) {
  if (iconCache[kind]) return iconCache[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  g.lineWidth = 3.4; g.lineCap = 'round'; g.lineJoin = 'round';
  const P = (pts, close = false, fill = false) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (close) g.closePath();
    fill ? g.fill() : g.stroke();
  };
  switch (kind) {
    case 'bolt': P([[28, 6], [16, 26], [24, 26], [18, 42], [34, 20], [25, 20], [32, 6]], true, true); break;
    case 'skull':
      g.beginPath(); g.arc(24, 20, 12, 0, Math.PI * 2); g.fill();
      g.fillRect(18, 28, 12, 10);
      g.fillStyle = '#000';
      g.beginPath(); g.arc(19.5, 19, 3.4, 0, Math.PI * 2); g.arc(28.5, 19, 3.4, 0, Math.PI * 2); g.fill();
      g.fillRect(22.7, 24, 2.6, 4);
      break;
    case 'slash': P([[10, 38], [38, 10]]); P([[18, 38], [40, 16]]); P([[10, 30], [32, 8]]); break;
    case 'swirl':
      g.beginPath(); g.arc(24, 24, 14, 0.3, Math.PI * 1.5); g.stroke();
      g.beginPath(); g.arc(24, 24, 7, Math.PI, Math.PI * 2.6); g.stroke();
      P([[36, 14], [40, 8]]);
      break;
    case 'bomb':
      g.beginPath(); g.arc(22, 28, 12, 0, Math.PI * 2); g.fill();
      P([[30, 18], [36, 10]]);
      g.beginPath(); g.arc(38, 8, 3, 0, Math.PI * 2); g.stroke();
      break;
    case 'sun': {
      g.beginPath(); g.arc(24, 24, 8, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        P([[24 + Math.cos(a) * 12, 24 + Math.sin(a) * 12], [24 + Math.cos(a) * 19, 24 + Math.sin(a) * 19]]);
      }
      break;
    }
    case 'cloud':
      g.beginPath();
      g.arc(17, 28, 8, 0, Math.PI * 2); g.arc(27, 22, 9, 0, Math.PI * 2); g.arc(34, 30, 7, 0, Math.PI * 2);
      g.fill();
      break;
    case 'flame':
      g.beginPath();
      g.moveTo(24, 6); g.quadraticCurveTo(34, 18, 32, 28);
      g.quadraticCurveTo(40, 26, 36, 36); g.quadraticCurveTo(30, 44, 24, 43);
      g.quadraticCurveTo(12, 42, 13, 31); g.quadraticCurveTo(13, 24, 18, 18);
      g.quadraticCurveTo(17, 26, 22, 26); g.quadraticCurveTo(20, 14, 24, 6);
      g.fill();
      break;
    case 'shield': P([[24, 5], [40, 11], [38, 28], [24, 43], [10, 28], [8, 11]], true, true); break;
    case 'potion':
      P([[20, 6], [28, 6]]);
      g.beginPath(); g.moveTo(22, 8); g.lineTo(22, 18); g.quadraticCurveTo(10, 28, 16, 38);
      g.quadraticCurveTo(24, 46, 32, 38); g.quadraticCurveTo(38, 28, 26, 18); g.lineTo(26, 8); g.closePath();
      g.fill();
      break;
    case 'broom': P([[8, 40], [30, 18]]); P([[30, 18], [40, 8], [42, 12], [34, 22]], true, true); P([[8, 40], [14, 42]]); break;
    case 'cloak': P([[24, 4], [40, 16], [36, 44], [24, 38], [12, 44], [8, 16]], true, true); break;
    case 'blink':
      g.beginPath(); g.arc(15, 24, 7, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(36, 24, 7, 0, Math.PI * 2); g.fill();
      P([[22, 24], [29, 24]]);
      break;
    case 'wand': P([[10, 38], [38, 10]]); g.beginPath(); g.arc(38, 10, 3.4, 0, Math.PI * 2); g.fill(); break;
    case 'relic': P([[24, 6], [38, 24], [24, 42], [10, 24]], true, true); break;
    case 'bind': // rigid figure wrapped in binding rings
      g.beginPath(); g.arc(24, 11, 5, 0, Math.PI * 2); g.fill();
      g.fillRect(20, 17, 8, 24);
      g.lineWidth = 2.6;
      P([[14, 22], [34, 22]]); P([[14, 29], [34, 29]]); P([[14, 36], [34, 36]]);
      break;
    case 'stag': // antlered guardian
      P([[24, 44], [24, 24]]);
      P([[24, 26], [14, 16], [12, 6]]); P([[14, 16], [8, 14]]); P([[13, 10], [17, 9]]);
      P([[24, 26], [34, 16], [36, 6]]); P([[34, 16], [40, 14]]); P([[35, 10], [31, 9]]);
      g.beginPath(); g.arc(24, 30, 4.4, 0, Math.PI * 2); g.fill();
      break;
    case 'ward': // dispel: ring with a cancel stroke and radiating ticks
      g.beginPath(); g.arc(24, 24, 11, 0, Math.PI * 2); g.stroke();
      P([[16, 32], [32, 16]]);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        P([[24 + Math.cos(a) * 15, 24 + Math.sin(a) * 15], [24 + Math.cos(a) * 20, 24 + Math.sin(a) * 20]]);
      }
      break;
    case 'snake': // serpent S-curve with tongue
      g.lineWidth = 4.5;
      g.beginPath(); g.moveTo(12, 40); g.bezierCurveTo(34, 36, 10, 22, 26, 14); g.stroke();
      g.beginPath(); g.arc(28, 12, 4.4, 0, Math.PI * 2); g.fill();
      g.lineWidth = 2;
      P([[31, 9], [37, 5]]); P([[37, 5], [40, 7]]); P([[37, 5], [38, 2]]);
      break;
    case 'vest': // sleeveless dragonhide cuirass
      P([[14, 8], [34, 8], [38, 16], [34, 42], [14, 42], [10, 16]], true, true);
      g.fillStyle = '#000';
      g.fillRect(21, 8, 6, 8);
      break;
    case 'luck': // four-leaf shamrock
      for (const [cx, cy] of [[18, 18], [30, 18], [18, 30], [30, 30]]) {
        g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill();
      }
      P([[24, 30], [22, 44]]);
      break;
    case 'portkey': // old boot with motion swooshes
      P([[16, 8], [26, 8], [26, 26], [38, 30], [38, 40], [16, 40]], true, true);
      g.lineWidth = 2.4;
      P([[8, 16], [12, 16]]); P([[6, 24], [11, 24]]); P([[8, 32], [12, 32]]);
      break;
    case 'slow': // snail-paced: heavy spiral dragging a tail
      g.beginPath(); g.arc(20, 26, 10, 0, Math.PI * 1.7); g.stroke();
      g.beginPath(); g.arc(20, 26, 5, Math.PI * 0.4, Math.PI * 1.9); g.stroke();
      P([[28, 34], [40, 34]]); P([[34, 28], [42, 28]]);
      break;
    case 'mute': // crossed-out speech burst
      P([[12, 14], [30, 14], [30, 28], [22, 28], [16, 34], [17, 28], [12, 28]], true, true);
      g.lineWidth = 4;
      P([[8, 42], [40, 8]]);
      break;
    default: g.beginPath(); g.arc(24, 24, 12, 0, Math.PI * 2); g.fill();
  }
  iconCache[kind] = c.toDataURL();
  return iconCache[kind];
}

export class HUD {
  constructor(root, input, settings) {
    this.root = root;
    this.input = input;
    this.settings = settings;
    this.game = null;
    this.buyOpen = false;
    this.dmgNumbers = [];
    this.dmgDirs = [];
    this.noticeT = 0;
    this.announceT = 0;
    this.el = null;
  }

  bind(game) {
    this.game = game;
    this.build();
  }

  unbind() {
    this.game = null;
    this.el?.remove();
    this.el = null;
    this.buyOpen = false;
  }

  build() {
    this.el?.remove();
    const h = el('div', 'hud', this.root);
    this.el = h;

    // crosshair
    this.cross = el('div', 'crosshair', h);
    this.crossParts = {
      t: el('div', 'ch-line ch-t', this.cross), b: el('div', 'ch-line ch-b', this.cross),
      l: el('div', 'ch-line ch-l', this.cross), r: el('div', 'ch-line ch-r', this.cross),
      dot: el('div', 'ch-dot', this.cross),
    };
    this.hitm = el('div', 'hitmarker', this.cross);
    for (const r of [45, -45, 135, -135]) {
      const ln = el('div', 'hm-line', this.hitm);
      ln.style.transform = `rotate(${r}deg) translateY(-9px)`;
    }
    this.applyCrosshair();

    // overlays
    this.blindEl = el('div', 'blind-overlay', h);
    this.painEl = el('div', 'pain-overlay', h);
    this.hitFlashEl = el('div', 'hit-flash', h);
    this.burnEl = el('div', 'vig burn', h);
    this.bleedEl = el('div', 'vig bleed', h);
    this.slowEl = el('div', 'vig slow', h);
    this.stoneEl = el('div', 'vig stone', h);
    this.scopeEl = el('div', 'scope-overlay', h);
    this.hitFlashA = 0;

    // top bar — one glass module: team pips | score · timer · score | team pips
    const top = el('div', 'hud-top', h);
    this.aliveL = el('div', 'alive-count left', top);
    const mid = el('div', 'top-mid', top);
    this.scoreL = el('div', 'score order', mid);
    const timerBox = el('div', 'timer-box', mid);
    this.timerEl = el('div', 'round-timer', timerBox);
    this.roundLabel = el('div', 'round-label', timerBox);
    this.scoreR = el('div', 'score death', mid);
    this.aliveR = el('div', 'alive-count right', top);

    // radar
    this.radarWrap = el('div', 'radar', h);
    this.radarCv = el('canvas', '', this.radarWrap);
    this.radarCv.width = this.radarCv.height = 176;

    // killfeed
    this.feed = el('div', 'killfeed', h);

    // teammate comms feed — radio callouts + voice-bark subtitles
    this.commsFeed = el('div', 'comms-feed', h);

    // bottom left: vitals
    const bl = el('div', 'hud-bl', h);
    const hpRow = el('div', 'bar-row', bl);
    el('div', 'bar-ico', hpRow, '✚');
    const hpBar = el('div', 'bar hp', hpRow);
    this.hpBar = hpBar;
    this.hpGhost = el('div', 'bar-ghost', hpBar); // trailing "you just lost this" chunk
    this.hpFill = el('div', 'bar-fill', hpBar);
    this.hpText = el('div', 'bar-text', hpRow, '100');
    const mpRow = el('div', 'bar-row', bl);
    el('div', 'bar-ico mana', mpRow, '✦');
    const mpBar = el('div', 'bar mana', mpRow);
    this.mpBar = mpBar;
    this.mpFill = el('div', 'bar-fill', mpBar);
    this.mpText = el('div', 'bar-text', mpRow, '100');
    this.moneyEl = el('div', 'money', bl);
    this.statusEl = el('div', 'status-tags', bl);
    // blink dash readiness — the intrinsic mobility cooldown
    this.dashEl = el('div', 'dash-ind', bl);
    el('img', '', this.dashEl).src = spellIcon('blink');
    el('span', 'dash-key', this.dashEl, keyLabel(this.input.binds.dash));
    el('span', 'dash-label', this.dashEl, 'BLINK');
    this.dashCdEl = el('div', 'dash-cd', this.dashEl);

    // bottom right: slots + equipment
    const br = el('div', 'hud-br', h);
    this.equipRow = el('div', 'equip-row', br);
    this.slotRow = el('div', 'slot-row', br);
    this.buildSlots();

    // center widgets
    this.announceEl = el('div', 'announce', h);
    this.announceBig = el('div', 'announce-big', this.announceEl);
    this.announceSub = el('div', 'announce-sub', this.announceEl);
    this.noticeEl = el('div', 'notice', h);
    this.progressWrap = el('div', 'progress hidden', h);
    this.progressLabel = el('div', 'progress-label', this.progressWrap);
    const pbar = el('div', 'progress-bar', this.progressWrap);
    this.progressFill = el('div', 'progress-fill', pbar);
    this.chargeWrap = el('div', 'charge hidden', h);
    this.chargeFill = el('div', 'charge-fill', this.chargeWrap);
    this.spectEl = el('div', 'spectate hidden', h);
    this.buyTimerEl = el('div', 'buy-timer hidden', h);
    this.fpsEl = el('div', 'fps hidden', h);
    this.lootEl = el('div', 'loot-hint hidden', h);
    this.relicChip = el('div', 'relic-chip hidden', h);
    el('img', '', this.relicChip).src = spellIcon('relic');
    el('span', '', this.relicChip, 'CURSED RELIC — hold E at a site');

    this.dmgWrap = el('div', 'dmg-numbers', h);
    this.dirWrap = el('div', 'dmg-dirs', h);

    // kill confirmation card
    this.killCard = el('div', 'kill-card', h);
    this.killCardIco = el('img', 'kc-ico', this.killCard);
    this.killCardName = el('span', 'kc-name', this.killCard);

    // death screen
    this.deathEl = el('div', 'death-screen hidden', h);
    this.deathTitle = el('div', 'death-title', this.deathEl, 'SLAIN');
    this.deathInfo = el('div', 'death-info', this.deathEl);
    this.deathArrow = el('div', 'death-arrow', this.deathEl, '➤');
    this.deathTip = el('div', 'death-tip', this.deathEl, 'Left / Right click to spectate teammates');

    // scoreboard + buy
    this.scoreboardEl = el('div', 'scoreboard hidden', h);
    this.buyEl = el('div', 'buy-menu hidden', h);
    this.buildBuy();
    this.buildWheel();
    this.refreshEquip();
  }

  // ----------------------------------------------------------- command wheel ---
  buildWheel() {
    this.wheelOpen = false;
    this.wheelSel = { x: 0, y: 0 };
    this.wheelIdx = -1;
    this.wheelEl = el('div', 'cmd-wheel hidden', this.el);
    this.wheelHub = el('div', 'cmd-hub', this.wheelEl, 'COMMAND');
    this.wheelSlices = [];
    const R = 132;
    WHEEL_CMDS.forEach((c, i) => {
      const a = (i / WHEEL_CMDS.length) * Math.PI * 2; // 0 = top, clockwise
      const s = el('div', 'cmd-slice', this.wheelEl, c.label);
      s.style.left = `calc(50% + ${Math.sin(a) * R}px)`;
      s.style.top = `calc(50% - ${Math.cos(a) * R}px)`;
      this.wheelSlices.push(s);
    });
  }

  openWheel() {
    if (this.wheelOpen) return;
    this.wheelOpen = true;
    this.wheelSel.x = 0; this.wheelSel.y = 0;
    this.wheelIdx = -1;
    this.wheelEl.classList.remove('hidden');
    this.wheelHub.textContent = 'COMMAND';
    this.wheelSlices.forEach((s) => s.classList.remove('sel'));
    this.game.audio.ui('hover');
  }

  // accumulate locked-pointer deltas into a selection vector; highlight a slice
  wheelMove(dx, dy) {
    if (!this.wheelOpen) return;
    this.wheelSel.x = clamp(this.wheelSel.x + dx, -200, 200);
    this.wheelSel.y = clamp(this.wheelSel.y + dy, -200, 200);
    const mag = Math.hypot(this.wheelSel.x, this.wheelSel.y);
    let idx = -1;
    if (mag > 26) {
      let a = Math.atan2(this.wheelSel.x, -this.wheelSel.y); // 0 = up, clockwise
      if (a < 0) a += Math.PI * 2;
      idx = Math.round(a / (Math.PI * 2 / WHEEL_CMDS.length)) % WHEEL_CMDS.length;
    }
    if (idx !== this.wheelIdx) {
      this.wheelIdx = idx;
      this.wheelSlices.forEach((s, i) => s.classList.toggle('sel', i === idx));
      this.wheelHub.textContent = idx >= 0 ? WHEEL_CMDS[idx].label : 'COMMAND';
      if (idx >= 0) this.game.audio.ui('hover');
    }
  }

  // release: fire the highlighted command (if any) and close
  closeWheel(fire) {
    if (!this.wheelOpen) return;
    this.wheelOpen = false;
    this.wheelEl.classList.add('hidden');
    const idx = this.wheelIdx;
    this.wheelIdx = -1;
    if (idx >= 0 && fire) { this.game.audio.ui('click'); fire(WHEEL_CMDS[idx].id); }
  }

  clearWheel() {
    if (this.wheelOpen) { this.wheelOpen = false; this.wheelEl?.classList.add('hidden'); this.wheelIdx = -1; }
  }

  // ------------------------------------------------------------ crosshair ---
  applyCrosshair(spreadPx = this.lastSpreadPx || 0) {
    const c = this.settings.crosshair;
    if (!this.cross) return;
    this.lastSpreadPx = spreadPx;
    const color = c.color;
    for (const k of ['t', 'b', 'l', 'r']) {
      const e = this.crossParts[k];
      e.style.background = color;
      const len = `${c.size}px`, th = `${c.thickness}px`, gap = c.gap + spreadPx;
      if (k === 't') { e.style.width = th; e.style.height = len; e.style.transform = `translate(-50%, ${-gap - c.size}px)`; }
      if (k === 'b') { e.style.width = th; e.style.height = len; e.style.transform = `translate(-50%, ${gap}px)`; }
      if (k === 'l') { e.style.width = len; e.style.height = th; e.style.transform = `translate(${-gap - c.size}px, -50%)`; }
      if (k === 'r') { e.style.width = len; e.style.height = th; e.style.transform = `translate(${gap}px, -50%)`; }
    }
    this.crossParts.dot.style.background = color;
    this.crossParts.dot.style.display = c.dot ? 'block' : 'none';
    this.crossParts.dot.style.width = this.crossParts.dot.style.height = `${c.thickness + 1}px`;
  }

  // scope vignette while the Killing Curse charges
  setScope(frac) {
    if (!this.scopeEl) return;
    this.scopeEl.style.opacity = frac > 0.02 ? String(0.5 + frac * 0.5) : '0';
  }

  lootHint(text) {
    if (!this.lootEl) return;
    if (text) {
      if (this.lootEl.textContent !== text) this.lootEl.textContent = text;
      this.lootEl.classList.remove('hidden');
    } else this.lootEl.classList.add('hidden');
  }

  hitmarker(isHS) {
    this.hitm.classList.remove('show', 'hs');
    void this.hitm.offsetWidth;
    this.hitm.classList.add('show');
    if (isHS) this.hitm.classList.add('hs');
  }

  // crosshair confirmation pop — quick inward pulse, gold on headshot/kill
  crosshairHit(isHS) {
    if (!this.cross) return;
    this.cross.classList.remove('ch-hit', 'ch-hs');
    void this.cross.offsetWidth;
    this.cross.classList.add(isHS ? 'ch-hs' : 'ch-hit');
  }

  // HP bar flinch — a quick shake + white flash when you take a direct hit
  flinchHP() {
    if (!this.hpBar) return;
    this.hpBar.classList.remove('hit');
    void this.hpBar.offsetWidth;
    this.hpBar.classList.add('hit');
  }

  // kill card: a brief "ELIMINATED — name" with the finishing spell's icon
  killConfirm(victim, spell, isHS) {
    if (!this.killCard) return;
    this.killCardIco.src = spellIcon(spell?.icon || 'bolt');
    this.killCardName.textContent = (victim?.name || '').toUpperCase();
    this.killCard.classList.toggle('hs', !!isHS);
    this.killCard.classList.remove('show');
    void this.killCard.offsetWidth;
    this.killCard.classList.add('show');
    this.crosshairHit(true);
  }

  // ---------------------------------------------------------------- slots ---
  buildSlots() {
    this.slotEls = [];
    this.slotRow.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const s = el('div', 'slot', this.slotRow);
      el('div', 'slot-key', s, String(i));
      const img = el('img', 'slot-ico', s);
      const name = el('div', 'slot-name', s);
      const meta = el('div', 'slot-meta', s);
      const cd = el('div', 'slot-cd', s);
      this.slotEls.push({ root: s, img, name, meta, cd });
    }
    const pr = el('div', 'slot protego', this.slotRow);
    el('div', 'slot-key', pr, 'RMB');
    const img = el('img', 'slot-ico', pr);
    img.src = spellIcon('shield');
    el('div', 'slot-name', pr, 'Protego');
    this.protegoEl = pr;
  }

  slotSpellFor(i) {
    const p = this.game.human;
    if (i === 1) return p.slot1();
    if (i === 2) return p.owned.has('avada') ? 'avada' : null;
    if (i === 3) {
      // show whichever hex is in hand, not just petrificus
      if (SLOT3.includes(p.curSpell)) return p.curSpell;
      return 'expelliarmus';
    }
    if (i === 4) return p.owned.has('bombarda') ? 'bombarda' : null;
    if (i === 5) {
      const opts = SLOT5.filter((id) => p.owned.has(id));
      if (!opts.length) return null;
      if (opts.includes(p.curSpell)) return p.curSpell;
      return opts.find((id) => p.ownsUsable(id)) || opts[0];
    }
    return null;
  }

  refreshEquip() {
    if (!this.game) return;
    const p = this.game.human;
    this.equipRow.innerHTML = '';
    for (const eq of EQUIPMENT) {
      const n = p.equip[eq.id];
      if (n <= 0) continue;
      const chip = el('div', 'equip-chip', this.equipRow);
      el('img', '', chip).src = spellIcon(eq.icon);
      if (eq.action) el('span', 'equip-key', chip, keyLabel(this.input.binds[eq.action]));
      if (eq.id === 'vest') el('span', 'equip-n', chip, `${Math.ceil(p.vestHP)}`);
      else if (eq.max > 1) el('span', 'equip-n', chip, `×${n}`);
    }
  }

  // ----------------------------------------------------------------- feed ---
  killfeed(attacker, victim, spell, isHS, selfKill) {
    const row = el('div', 'feed-row', this.feed);
    if (!selfKill && attacker) {
      el('span', `feed-name ${attacker.team}`, row, attacker.name);
      const ic = el('img', 'feed-ico', row);
      ic.src = spellIcon(spell?.icon || 'bolt');
      if (isHS) el('span', 'feed-hs', row, '◎');
    } else {
      el('span', 'feed-name', row, '☠');
    }
    el('span', `feed-name ${victim.team}`, row, victim.name);
    setTimeout(() => row.classList.add('fade'), 4400);
    setTimeout(() => row.remove(), 5000);
    while (this.feed.children.length > 6) this.feed.firstChild.remove();
  }

  // ------------------------------------------------------------- announcer ---
  announce(big, sub, kind = 'round') {
    this.announceEl.className = `announce show ${kind}`;
    this.announceBig.textContent = big;
    this.announceSub.textContent = sub || '';
    this.announceT = kind === 'round' || kind === 'good' || kind === 'bad' ? 3.6 : 2.2;
  }

  notice(text, kind = '') {
    this.noticeEl.textContent = text;
    this.noticeEl.className = `notice show ${kind}`;
    this.noticeT = 3.2;
  }

  // a teammate callout: stacked, team-colored speaker tag + the spoken line
  comms(name, text, team = '') {
    if (!this.commsFeed) return;
    const row = el('div', 'comms-row', this.commsFeed);
    el('span', `comms-name ${team}`, row, name);
    el('span', 'comms-text', row, text);
    setTimeout(() => row.classList.add('fade'), 5200);
    setTimeout(() => row.remove(), 5800);
    while (this.commsFeed.children.length > 4) this.commsFeed.firstChild.remove();
  }

  progress(label, t) {
    if (label === null || label === undefined) {
      this.progressWrap.classList.add('hidden');
      return;
    }
    this.progressWrap.classList.remove('hidden');
    this.progressLabel.textContent = label;
    this.progressFill.style.width = `${clamp(t, 0, 1) * 100}%`;
  }

  // -------------------------------------------------------- damage feedback ---
  damageNumber(worldPos, amount, isHS) {
    const e = el('div', `dmg-num${isHS ? ' hs' : ''}`, this.dmgWrap, String(amount));
    this.dmgNumbers.push({ el: e, pos: worldPos.clone(), t: 0.75, rise: 0 });
  }

  damageDirection(attackerPos) {
    const e = el('div', 'dmg-dir', this.dirWrap);
    this.dmgDirs.push({ el: e, pos: attackerPos.clone(), t: 1.1 });
  }

  painFlash(a) {
    this.pain = Math.min(1, (this.pain || 0) + a);
  }

  // full-screen blink in the color of whatever spell just hit you
  hitFlash(cssColor, alpha = 0.4) {
    this.hitFlashEl.style.background = `radial-gradient(ellipse at center, transparent 30%, ${cssColor} 130%)`;
    this.hitFlashA = Math.max(this.hitFlashA || 0, alpha);
  }

  // ----------------------------------------------------------- death screen ---
  showDeath(killer, spell) {
    this.deathEl.classList.remove('hidden');
    this.deathKiller = killer;
    if (killer) {
      this.deathInfo.innerHTML = '';
      const line = el('div', '', this.deathInfo);
      el('span', `feed-name ${killer.team}`, line, killer.name);
      el('span', '', line, ` finished you with `);
      el('span', 'death-spell', line, spell?.name || 'magic');
      el('div', 'death-hp', this.deathInfo, `Their health: ${Math.ceil(killer.health)}`);
      this.deathArrow.style.display = 'block';
    } else {
      this.deathInfo.textContent = 'You were consumed by your own magic.';
      this.deathArrow.style.display = 'none';
    }
  }

  closeDeath() {
    this.deathEl.classList.add('hidden');
    this.deathKiller = null;
    this.spectEl.classList.add('hidden');
  }

  spectating(name) {
    this.spectEl.classList.remove('hidden');
    this.spectEl.textContent = `SPECTATING — ${name}`;
  }

  // -------------------------------------------------------------- buy menu ---
  buildBuy() {
    const b = this.buyEl;
    b.innerHTML = '';
    const head = el('div', 'buy-head', b);
    el('div', 'buy-title', head, 'EMPORIUM');
    this.buyMoney = el('div', 'buy-money', head);
    const closeBtn = el('button', 'btn buy-close', head, '✕ Close (B)');
    closeBtn.onclick = () => this.openBuy(false);
    const tabs = el('div', 'buy-tabs', b);
    this.buyBody = el('div', 'buy-body', b);
    this.buyTab = this.buyTab || 'wands';
    for (const [id, label] of [['wands', 'Wands'], ['spells', 'Spells'], ['gear', 'Equipment']]) {
      const t = el('button', `buy-tab${this.buyTab === id ? ' active' : ''}`, tabs, label);
      t.dataset.tab = id;
      t.onclick = () => {
        this.buyTab = id;
        tabs.querySelectorAll('.buy-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === id));
        this.refreshBuy();
      };
    }
    this.refreshBuy();
  }

  statBar(parent, label, frac, cls = '') {
    const row = el('div', 'stat-row', parent);
    el('span', 'stat-label', row, label);
    const bar = el('div', 'stat-bar', row);
    el('div', `stat-fill ${cls}`, bar).style.width = `${clamp(frac, 0.04, 1) * 100}%`;
  }

  refreshBuy() {
    if (!this.game || !this.buyBody) return;
    const p = this.game.human;
    this.buyMoney.textContent = `${Math.round(p.money)} ɢ`;
    const body = this.buyBody;
    body.innerHTML = '';
    const card = (opts) => {
      const c = el('div', `buy-card${opts.disabled ? ' disabled' : ''}${opts.owned ? ' owned' : ''}`, body);
      const top = el('div', 'card-top', c);
      const ic = el('img', 'card-ico', top);
      ic.src = spellIcon(opts.icon);
      const tl = el('div', 'card-titles', top);
      el('div', 'card-name', tl, opts.name);
      el('div', 'card-role', tl, opts.role || '');
      el('div', 'card-price', top, opts.owned ? (opts.ownedLabel || 'OWNED') : opts.price === 0 ? 'FREE' : `${opts.price} ɢ`);
      if (opts.stats) {
        const st = el('div', 'card-stats', c);
        for (const [label, frac, cls] of opts.stats) this.statBar(st, label, frac, cls);
      }
      el('div', 'card-desc', c, opts.desc || '');
      if (!opts.disabled && !opts.owned && opts.onBuy) c.onclick = opts.onBuy;
      return c;
    };

    if (this.buyTab === 'wands') {
      for (const w of WANDS) {
        const price = Math.round(w.price * p.priceMult());
        card({
          icon: 'wand', name: w.name, role: w.id === p.prefWand ? '★ preferred' : 'Wand',
          price, desc: w.desc,
          owned: p.wand.id === w.id, ownedLabel: 'EQUIPPED',
          disabled: p.wand.id !== w.id && p.money < price,
          stats: [
            ['Power', w.power / 1.3, 'pow'],
            ['Cast speed', w.cast / 1.2, 'spd'],
            ['Accuracy', 1.6 - w.spread, 'acc'],
            ['Efficiency', 1.35 - w.manaMult * 0.5, 'eff'],
          ],
          onBuy: () => this.game.buy(p, 'wand', w.id),
        });
      }
    } else if (this.buyTab === 'spells') {
      for (const id of ['stupefy', 'sectum', 'avada', 'expelliarmus', 'petrificus', 'impedimenta', 'silencio', 'bombarda', 'lumos', 'fumos', 'incendio', 'patronum', 'serpensortia', 'protego']) {
        const sp = SPELLS[id];
        if (sp.exclusive && p.charId !== sp.exclusive) continue;
        if (id === 'stupefy' && p.charId === 'snape') continue;
        const price = Math.round(sp.price * p.priceMult());
        const ownedFull = sp.charges ? (p.charges[id] || 0) >= p.chargeCap(sp) : p.owned.has(id);
        card({
          icon: sp.icon, name: sp.name, role: sp.role, price,
          desc: sp.desc,
          owned: sp.price === 0 || ownedFull,
          ownedLabel: sp.charges ? `${p.charges[id] || (sp.price === 0 ? '∞' : 0)}× READY` : 'KNOWN',
          disabled: sp.price > 0 && !ownedFull && p.money < price,
          stats: [
            ['Damage', (sp.dmg || (sp.fire ? sp.fire[1] * 3 : 0)) / 120, 'pow'],
            ['Cast rate', sp.interval ? clamp(0.32 / sp.interval, 0, 1) : 0.4, 'spd'],
            ['Bolt speed', (sp.speed || 0) / 85, 'acc'],
            ['Mana cost', (sp.mana || sp.drain || 0) / 50, 'eff'],
          ],
          onBuy: () => this.game.buy(p, 'spell', id),
        });
      }
    } else {
      for (const eq of EQUIPMENT) {
        const price = Math.round(eq.price * p.equipPriceMult());
        const owned = p.equip[eq.id] >= eq.max;
        card({
          icon: eq.icon, name: eq.name, role: 'Equipment', price,
          desc: eq.desc + (p.equip[eq.id] ? ` (carrying ${p.equip[eq.id]})` : ''),
          owned, ownedLabel: `×${p.equip[eq.id]} MAX`,
          disabled: !owned && p.money < price,
          onBuy: () => this.game.buy(p, 'equip', eq.id),
        });
      }
    }
  }

  openBuy(open) {
    if (open === this.buyOpen) return;
    if (open && this.game.mode === 'dm') return;
    this.buyOpen = open;
    this.buyEl.classList.toggle('hidden', !open);
    if (open) {
      this.refreshBuy();
      this.input.unlock();
    } else if (!this.game.paused && !this.game.over) {
      this.input.lock();
    }
  }

  toggleBuy() {
    const g = this.game;
    const canBuy = g.mode !== 'dm' && (g.state === 'freeze' || (g.state === 'live' && g.buyT > 0));
    if (!this.buyOpen && !canBuy) {
      this.notice('Buy period has ended', 'bad');
      return;
    }
    this.openBuy(!this.buyOpen);
  }

  // ------------------------------------------------------------ scoreboard ---
  renderScoreboard() {
    const g = this.game;
    const sb = this.scoreboardEl;
    sb.innerHTML = '';
    const head = el('div', 'sb-head', sb);
    el('div', 'sb-map', head, `${g.setup.mapId.toUpperCase()} — ${g.mode === 'dm' ? 'DEATHMATCH' : `Round ${g.roundNum}`}`);
    el('div', 'sb-score', head, `${TEAM_INFO.order.short} ${g.score.order} : ${g.score.death} ${TEAM_INFO.death.short}`);
    // round history: one cell per finished round (☠ elim, ⏱ time, ✦ dispel, ✸ detonation)
    if (g.mode !== 'dm' && g.roundHistory.length) {
      const strip = el('div', 'sb-strip', sb);
      const glyph = { elim: '☠', time: '⏱', defuse: '✦', explode: '✸' };
      g.roundHistory.forEach((r, i) => {
        const cell = el('div', `strip-cell ${r.winner}`, strip, glyph[r.reason] || '·');
        cell.title = `Round ${i + 1}`;
      });
    }
    const dm = g.mode === 'dm';
    for (const team of [TEAM.ORDER, TEAM.DEATH]) {
      const sec = el('div', `sb-team ${team}`, sb);
      const role = dm ? '' : (g.attackingTeam === team ? ' — Attacking' : ' — Defending');
      el('div', 'sb-team-name', sec, `${TEAM_INFO[team].name}${role}`);
      const table = el('table', 'sb-table', sec);
      const hr = el('tr', '', el('thead', '', table));
      const headers = dm
        ? ['', 'Player', 'K', 'A', 'D', 'KDA', 'HS', 'DMG']
        : ['', 'Player', 'K', 'A', 'D', 'HS', 'DMG', 'OBJ', '★', 'ɢ'];
      for (const hcell of headers) el('th', '', hr, hcell);
      const tb = el('tbody', '', table);
      const members = g.teamPlayers(team).slice().sort((a, b) => (
        dm
          ? b.kills - a.kills || (b.kills + b.assists) / Math.max(1, b.deaths) - (a.kills + a.assists) / Math.max(1, a.deaths)
          : (b.kills - b.deaths) - (a.kills - a.deaths)
      ) || b.dmgDealt - a.dmgDealt);
      for (const p of members) {
        const tr = el('tr', `${p.alive ? 'alive' : 'dead'}${p.isHuman ? ' me' : ''}`, tb);
        tr.title = p.char.style; // hover a row for the champion's personality
        el('td', 'sb-dot', tr, p.alive ? (p.hasRelic ? '◆' : '●') : '○');
        const nameTd = el('td', 'sb-name', tr);
        el('span', '', nameTd, p.name);
        if (!p.char.name.includes(p.name)) el('span', 'sb-champ', nameTd, p.char.name.split(' ').pop());
        el('td', '', tr, String(p.kills));
        el('td', '', tr, String(p.assists));
        el('td', '', tr, String(p.deaths));
        if (dm) el('td', '', tr, fmtKDA(p));
        el('td', '', tr, String(p.hsK));
        el('td', '', tr, String(Math.round(p.dmgDealt)));
        if (!dm) {
          el('td', '', tr, String(p.plants + p.defuses));
          el('td', 'sb-star', tr, p.mvps ? '★'.repeat(Math.min(p.mvps, 5)) + (p.mvps > 5 ? `+${p.mvps - 5}` : '') : '');
          el('td', 'sb-money', tr, String(Math.round(p.money)));
        }
      }
    }
    el('div', 'sb-hint', sb, dm
      ? 'K kills · A assists · D deaths · KDA (K+A)/D · HS headshot kills'
      : 'K kills · A assists · D deaths · HS headshot kills · OBJ plants+dispels · ★ round MVPs');
  }

  // ----------------------------------------------------------------- radar ---
  drawRadar() {
    const g = this.game;
    const ctx = this.radarCv.getContext('2d');
    const S = this.radarCv.width;
    const me = g.human;
    const view = g.human.alive ? g.human : g.players.find((q) => q.alive && q.team === me.team) || me;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(0, 0, S, S);
    const [px, py] = g.radar.toMap(view.pos.x, view.pos.z);
    const zoom = 1.15;
    ctx.translate(S / 2, S / 2);
    ctx.rotate(view.yaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-px, -py);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(g.radar.canvas, 0, 0);
    ctx.globalAlpha = 1;

    const dot = (x, z, color, r = 3.5) => {
      const [mx, my] = g.radar.toMap(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx, my, r / zoom, 0, Math.PI * 2);
      ctx.fill();
    };
    // teammates
    for (const p of g.players) {
      if (!p.alive || p.team !== me.team || p === view) continue;
      dot(p.pos.x, p.pos.z, p.hasRelic ? '#cc66ff' : TEAM_INFO[me.team].css);
    }
    // enemy memory pings (fade 3s, Luna +2s)
    const linger = me.charId === 'luna' ? 5 : 3;
    for (const m of g.teamMemory[me.team].values()) {
      const age = g.time - m.t;
      if (age > linger || age < 0) continue;
      ctx.globalAlpha = clamp(1 - age / linger, 0, 1);
      dot(m.x, m.z, '#ff4444', 4);
      ctx.globalAlpha = 1;
    }
    // relic
    const r = g.relic;
    if (r && (r.state === 'planted' || r.state === 'dropped')) {
      const pulse = r.state === 'planted' ? 4.5 + Math.sin(g.time * 6) * 1.5 : 4;
      dot(r.pos.x, r.pos.z, '#bb55ff', pulse);
    }
    // player pings (enemy mark = amber, location = cyan), pulsing for ~6s
    if (g.pings) {
      for (const pg of g.pings) {
        const age = g.time - pg.t;
        if (age > 6 || age < 0) continue;
        ctx.globalAlpha = clamp(1 - age / 6, 0, 1);
        dot(pg.x, pg.z, pg.kind === 'enemy' ? '#ffcc44' : '#66e0ff', 4.5 + Math.sin(g.time * 7) * 1.4);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    // self arrow
    ctx.fillStyle = '#fff';
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(150,170,200,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  worldToScreen(v) {
    const cam = this.game.camera;
    const p = v.clone().project(cam);
    if (p.z > 1) return null;
    return [(p.x * 0.5 + 0.5) * window.innerWidth, (-p.y * 0.5 + 0.5) * window.innerHeight];
  }

  // ---------------------------------------------------------------- update ---
  update(dt) {
    const g = this.game;
    if (!g || !this.el) return;
    const p = g.human;
    if (this.wheelOpen && (this.buyOpen || !p.alive)) this.clearWheel();

    // vitals
    const hpFrac = clamp(p.health / p.stats.hp, 0, 1);
    this.hpFill.style.width = `${hpFrac * 100}%`;
    this.hpFill.classList.toggle('low', p.health < 35);
    this.hpText.textContent = String(Math.max(0, Math.ceil(p.health)));
    // ghost bar trails behind: snaps up on heal, drains slowly so the loss reads
    if (this._hpGhost == null || hpFrac >= this._hpGhost) this._hpGhost = hpFrac;
    else this._hpGhost = Math.max(hpFrac, this._hpGhost - dt * 0.45);
    this.hpGhost.style.width = `${this._hpGhost * 100}%`;

    const mpFrac = clamp(p.mana / p.stats.mana, 0, 1);
    this.mpFill.style.width = `${mpFrac * 100}%`;
    this.mpText.textContent = String(Math.floor(p.mana));
    // pulse mana the instant the held spell becomes affordable again
    const curSp = p.curSpell ? SPELLS[p.curSpell] : null;
    const cost = curSp ? g.spells.manaCost(p, curSp) : 0;
    const canCast = p.alive && cost > 0 && p.mana >= cost;
    if (canCast && this._couldCast === false) {
      this.mpBar.classList.remove('afford');
      void this.mpBar.offsetWidth;
      this.mpBar.classList.add('afford');
    }
    this._couldCast = canCast;

    // money count-up with a soft tick when it rises (kills, objective rewards)
    if (g.mode === 'dm') {
      this.moneyEl.textContent = '';
    } else {
      const target = Math.round(p.money);
      if (this._moneyShown == null || g.state !== 'live') {
        this._moneyShown = target;
      } else if (this._moneyShown !== target) {
        if (target > (this._moneyPrev ?? target)) g.audio.ui('cash');
        const step = Math.max(1, Math.ceil(Math.abs(target - this._moneyShown) * Math.min(1, dt * 7)));
        this._moneyShown += Math.sign(target - this._moneyShown) * step;
        if (Math.abs(target - this._moneyShown) < step) this._moneyShown = target;
      }
      this._moneyPrev = target;
      this.moneyEl.textContent = `${this._moneyShown} ɢ`;
    }

    // status tags
    let tags = '';
    if (p.disc) tags += `<span class="tag disc">${p.disc.name.toUpperCase()}</span>`;
    if (p.disarmT > 0) tags += `<span class="tag bad">DISARMED ${p.disarmT.toFixed(1)}</span>`;
    if (p.recharging > 0) tags += `<span class="tag mana">RECHARGING</span>`;
    if (p.cloakT > 0) tags += `<span class="tag">CLOAKED ${p.cloakT.toFixed(0)}</span>`;
    if (p.slowT > 0) tags += `<span class="tag bad">CRUCIO</span>`;
    if (p.burnT > 0) tags += `<span class="tag bad">BURNING</span>`;
    if (p.bleeds.length > 0) tags += `<span class="tag bad">BLEEDING</span>`;
    if (p.freezeT > 0) tags += `<span class="tag bad">PETRIFIED ${p.freezeT.toFixed(1)}</span>`;
    if (p.parryBuffT > 0) tags += `<span class="tag good">FLOW</span>`;
    this.statusEl.innerHTML = tags;

    // blink cooldown indicator
    if (this.dashEl) {
      this.dashEl.style.display = p.alive ? 'inline-flex' : 'none';
      this.dashEl.classList.toggle('ready', p.dashCD <= 0);
      this.dashCdEl.style.height = `${clamp(p.dashCD / DASH.cd, 0, 1) * 100}%`;
    }

    // timer + scores
    if (g.mode === 'dm') {
      this.timerEl.textContent = fmtTime(g.dmTimer);
      this.timerEl.classList.remove('planted');
      this.roundLabel.textContent = 'K/D/A · KDA';
    } else if (g.state === 'freeze') {
      this.timerEl.textContent = fmtTime(g.stateT);
      this.timerEl.classList.remove('planted');
      this.roundLabel.textContent = `Round ${g.roundNum} — buy phase`;
    } else if (g.relic.state === 'planted') {
      this.timerEl.textContent = '⚠';
      this.timerEl.classList.add('planted');
      this.roundLabel.textContent = `Relic planted — site ${g.relic.site}`;
    } else {
      this.timerEl.textContent = fmtTime(g.roundT);
      this.timerEl.classList.remove('planted');
      this.roundLabel.textContent = `Round ${g.roundNum}`;
    }
    if (g.mode === 'dm') {
      this.scoreL.textContent = `${p.kills}/${p.deaths}/${p.assists}`;
      this.scoreR.textContent = fmtKDA(p);
      this.scoreL.title = 'Kills / Deaths / Assists';
      this.scoreR.title = 'KDA';
    } else {
      this.scoreL.textContent = String(g.score.order);
      this.scoreR.textContent = String(g.score.death);
      this.scoreL.title = '';
      this.scoreR.title = '';
    }
    const aOrder = g.aliveOf(TEAM.ORDER).length, aDeath = g.aliveOf(TEAM.DEATH).length;
    this.aliveL.innerHTML = `<b>${TEAM_INFO.order.short}</b> ${'●'.repeat(aOrder)}${'○'.repeat(Math.max(0, g.teamPlayers(TEAM.ORDER).length - aOrder))}`;
    this.aliveR.innerHTML = `${'●'.repeat(aDeath)}${'○'.repeat(Math.max(0, g.teamPlayers(TEAM.DEATH).length - aDeath))} <b>${TEAM_INFO.death.short}</b>`;

    // buy window chip
    if (g.mode !== 'dm' && g.state === 'live' && g.buyT > 0) {
      this.buyTimerEl.classList.remove('hidden');
      this.buyTimerEl.textContent = `Buy: ${Math.ceil(g.buyT)}s (B)`;
    } else this.buyTimerEl.classList.add('hidden');

    // relic chip
    this.relicChip.classList.toggle('hidden', !p.hasRelic);

    // slots
    for (let i = 0; i < 5; i++) {
      const slotEl = this.slotEls[i];
      const id = this.slotSpellFor(i + 1);
      if (!id) {
        slotEl.root.classList.add('empty');
        slotEl.name.textContent = '';
        slotEl.meta.textContent = '';
        slotEl.img.src = '';
        slotEl.img.style.visibility = 'hidden';
        continue;
      }
      const sp = SPELLS[id];
      slotEl.root.classList.remove('empty');
      slotEl.img.style.visibility = 'visible';
      const iconSrc = spellIcon(sp.icon);
      if (slotEl.img.dataset.k !== sp.icon) { slotEl.img.src = iconSrc; slotEl.img.dataset.k = sp.icon; }
      slotEl.name.textContent = sp.name.split(' ')[0];
      // true cost: wand multiplier AND character discounts (Harry, Voldemort…)
      const cost = Math.round(g.spells.manaCost(p, sp));
      slotEl.meta.textContent = sp.charges ? `×${p.charges[id] || 0} · ${cost}✦` : `${cost}✦`;
      slotEl.root.classList.toggle('active', p.curSpell === id);
      slotEl.root.classList.toggle('nomana', p.mana < cost);
      const cdLeft = Math.max(0, p.nextCastAt - g.time);
      const cdFrac = clamp(cdLeft / 1.2, 0, 1);
      slotEl.cd.style.height = `${cdFrac * 100}%`;
      slotEl.root.style.borderColor = p.curSpell === id ? hexCss(sp.color) : '';
    }
    this.protegoEl.classList.toggle('active', p.shielding);

    // charge meter
    if (p.charge) {
      this.chargeWrap.classList.remove('hidden');
      const t = clamp(p.charge.t / p.charge.total, 0, 1);
      this.chargeFill.style.width = `${t * 100}%`;
      this.chargeFill.classList.toggle('ready', t >= 1);
    } else if (p.recharging > 0) {
      this.chargeWrap.classList.remove('hidden');
      this.chargeFill.style.width = `${(1 - p.recharging / p.rechargeDur) * 100}%`;
      this.chargeFill.classList.add('ready');
    } else {
      this.chargeWrap.classList.add('hidden');
      this.chargeFill.classList.remove('ready');
    }

    // overlays
    this.blindEl.style.opacity = clamp(p.alive ? p.blindT / 1.1 : 0, 0, 1);
    this.pain = Math.max(0, (this.pain || 0) - dt * 1.6);
    this.painEl.style.opacity = this.pain * 0.55 + (p.alive && p.health < 30 ? 0.18 : 0);
    this.hitFlashA = Math.max(0, (this.hitFlashA || 0) - dt * 2.4);
    this.hitFlashEl.style.opacity = this.hitFlashA;
    // status vignettes: burning edges glow orange, bleeding pulses red, crucio glows purple
    this.burnEl.style.opacity = p.alive ? clamp(p.burnT / 0.6, 0, 1) * 0.9 : 0;
    this.bleedEl.style.opacity = p.alive && p.bleeds.length > 0 ? 0.5 + Math.sin(g.time * 7) * 0.28 : 0;
    this.slowEl.style.opacity = p.alive && p.slowT > 0 ? clamp(p.slowT / 1.5, 0.4, 1) * (0.8 + Math.sin(g.time * 18) * 0.15) : 0;
    this.stoneEl.style.opacity = p.alive && p.freezeT > 0 ? clamp(p.freezeT / 0.5, 0.5, 1) * 0.85 : 0;

    // announcer / notice decay
    if (this.announceT > 0) {
      this.announceT -= dt;
      if (this.announceT <= 0) this.announceEl.classList.remove('show');
    }
    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this.noticeEl.classList.remove('show');
    }

    // damage numbers
    for (let i = this.dmgNumbers.length - 1; i >= 0; i--) {
      const d = this.dmgNumbers[i];
      d.t -= dt;
      d.rise += dt * 50;
      if (d.t <= 0) { d.el.remove(); this.dmgNumbers.splice(i, 1); continue; }
      const s = this.worldToScreen(d.pos);
      if (!s) { d.el.style.opacity = '0'; continue; }
      d.el.style.opacity = String(clamp(d.t / 0.3, 0, 1));
      d.el.style.transform = `translate(${s[0]}px, ${s[1] - d.rise}px)`;
    }

    // damage direction wedges
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      const d = this.dmgDirs[i];
      d.t -= dt;
      if (d.t <= 0) { d.el.remove(); this.dmgDirs.splice(i, 1); continue; }
      const dx = d.pos.x - g.camera.position.x;
      const dz = d.pos.z - g.camera.position.z;
      const worldAng = Math.atan2(dx, -dz);
      const rel = worldAng + p.yaw;
      d.el.style.opacity = String(clamp(d.t, 0, 1) * 0.9);
      d.el.style.transform = `translate(-50%,-50%) rotate(${rel}rad) translateY(-70px)`;
    }

    // death arrow toward killer
    if (this.deathKiller && !this.deathEl.classList.contains('hidden')) {
      const k = this.deathKiller;
      const dx = k.pos.x - g.camera.position.x;
      const dz = k.pos.z - g.camera.position.z;
      const worldAng = Math.atan2(dx, -dz);
      const rel = worldAng + g.human.yaw;
      this.deathArrow.style.transform = `translateX(-50%) rotate(${rel - Math.PI / 2}rad)`;
    }

    // scoreboard hold
    const sbVisible = this.input.down('scoreboard') || false;
    if (sbVisible && this.scoreboardEl.classList.contains('hidden')) {
      this.renderScoreboard();
      this.scoreboardEl.classList.remove('hidden');
    } else if (!sbVisible && !this.scoreboardEl.classList.contains('hidden')) {
      this.scoreboardEl.classList.add('hidden');
    } else if (sbVisible) {
      this.sbRefreshT = (this.sbRefreshT || 0) - dt;
      if (this.sbRefreshT <= 0) { this.sbRefreshT = 0.5; this.renderScoreboard(); }
    }

    // buy key
    if (this.input.pressed('buy')) this.toggleBuy();

    // crosshair blooms with live spread (movement, air, recoil)
    if (p.alive) {
      const spDef = p.curSpell ? SPELLS[p.curSpell] : null;
      const sp = spDef && spDef.spread && g.spells ? g.spells.spreadFor(p, spDef) : 0;
      const px = clamp((sp / DEG_R) * 2.6, 0, 26);
      if (Math.abs(px - (this.lastSpreadPx || 0)) > 0.4) this.applyCrosshair(px);
    }

    // loot prompt: standing over a fallen wizard's wand
    this.lootHint(p.alive && g.pickupHintFor ? (() => {
      const d = g.pickupHintFor(p);
      return d ? `[${keyLabel(this.input.binds.use)}]  Take ${d.name}` : null;
    })() : null);

    // radar @ ~20Hz
    this.radarT = (this.radarT || 0) - dt;
    if (this.radarT <= 0) {
      this.radarT = 0.05;
      this.drawRadar();
    }

    // fps
    if (this.settings.showFps) {
      this.fpsEl.classList.remove('hidden');
      this.fpsAcc = (this.fpsAcc || 0) + dt;
      this.fpsN = (this.fpsN || 0) + 1;
      if (this.fpsAcc > 0.5) {
        this.fpsEl.textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps · q${this.game.particles.quality.toFixed(2)}`;
        this.fpsAcc = 0; this.fpsN = 0;
      }
    } else this.fpsEl.classList.add('hidden');
  }
}
