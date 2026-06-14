// Menus: main, match setup (mode/map/team/character/wand/bots), settings with
// keybinds + crosshair editor, pause, lock overlay, match end screen.
import { CHARACTERS, WANDS, EQUIPMENT, EQUIP_EFFECTS, TEAM, TEAM_INFO, MAP_LIST, DIFFICULTIES, FORMATS, DISCIPLINES, SPELLS, ROUND } from './data.js';
import { MAP_BUILDERS } from './maps/index.js';
import { bakeRadar } from './mapbuilder.js';
import { el, clamp, fmtKDA } from './utils.js';
import { BIND_LABELS, keyLabel, DEFAULT_BINDS } from './input.js';
import { spellIcon } from './hud.js';

const mapPreviewCache = {};
function mapPreview(mapId) {
  if (!mapPreviewCache[mapId]) {
    const built = MAP_BUILDERS[mapId](null);
    mapPreviewCache[mapId] = bakeRadar(built.world, 256).canvas;
  }
  return mapPreviewCache[mapId];
}

export class Menus {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // {settings, audio, input, saveSettings, applySettings, startGame, quitToMenu, resumeGame}
    this.el = el('div', 'menus', root);
    this.setup = {
      mode: 'relic', mapId: 'dust2', team: TEAM.ORDER, charId: 'harry', prefWand: 'holly',
      botsFriendly: 4, botsEnemy: 5, difficulty: 'normal', format: 'mr8', discipline: 'duelist',
      aiCustom: { reflex: 50, aim: 50, sense: 50, iq: 50 },
      squad: [], foes: [], dmBanned: [], dmKillTarget: ROUND.dmKillTarget,
      ...(ctx.settings.lastSetup || {}),
    };
    if (!this.setup.aiCustom) this.setup.aiCustom = { reflex: 50, aim: 50, sense: 50, iq: 50 };
    if (!Array.isArray(this.setup.dmBanned)) this.setup.dmBanned = [];
    if (![25, 50, 75, 100].includes(Number(this.setup.dmKillTarget))) this.setup.dmKillTarget = ROUND.dmKillTarget;
    // scrub stale roster picks (old saves, renamed characters, champion overlap)
    const validChar = (id) => CHARACTERS.some((c) => c.id === id);
    this.setup.squad = (this.setup.squad || []).filter((id) => validChar(id) && id !== this.setup.charId);
    this.setup.foes = (this.setup.foes || []).filter((id) => validChar(id) && id !== this.setup.charId && !this.setup.squad.includes(id));
    this.setupStep = 0;
    this.activePanel = null;
    this.settingsFromPause = false;
    this.endState = null;
    this.debugReturn = null;
  }

  click() { this.ctx.audio.ui('click'); }

  rosterCap(key) { return key === 'squad' ? clamp(this.setup.botsFriendly, 0, 4) : clamp(this.setup.botsEnemy, 1, 5); }

  clear() {
    this.el.innerHTML = '';
    this.el.style.display = 'none';
    this.activePanel = null;
  }

  panel(cls) {
    this.el.innerHTML = '';
    this.el.style.display = 'flex';
    const p = el('div', `panel ${cls}`, this.el);
    this.activePanel = cls;
    return p;
  }

  isVisible() {
    return this.el.style.display !== 'none' && !!this.activePanel;
  }

  captureDebugReturn() {
    return {
      panel: this.activePanel,
      setupMode: this.setup.mode,
      settingsFromPause: this.settingsFromPause,
      endState: this.endState,
    };
  }

  restoreDebugReturn(state = this.debugReturn) {
    if (!state) return this.showMain();
    if (state.panel === 'main-menu') return this.showMain();
    if (state.panel === 'help') return this.showHelp();
    if (state.panel === 'setup') return this.showSetup(state.setupMode || this.setup.mode);
    if (state.panel === 'settings') return this.showSettings(!!state.settingsFromPause);
    if (state.panel === 'pause') return this.showPause();
    if (state.panel === 'end-screen' && state.endState) return this.showEnd(state.endState.game, state.endState.winner);
    return this.showMain();
  }

  toggleDebugCheats() {
    if (!this.isVisible()) return false;
    if (this.activePanel === 'debug-cheats') this.restoreDebugReturn();
    else this.showDebugCheats();
    return true;
  }

  showDebugCheats() {
    if (this.activePanel !== 'debug-cheats') this.debugReturn = this.captureDebugReturn();
    const p = this.panel('debug-cheats');
    const game = this.ctx.getGame?.();
    const human = game?.human;
    el('h2', 'panel-title', p, 'DEBUG / CHEATS');
    el('div', 'debug-sub', p, 'Menu-only tools. Press F9 to open or close this panel from any menu.');
    const body = el('div', 'debug-grid', p);
    const status = el('div', 'debug-status', p, '');
    const setStatus = (text) => { status.textContent = text; };
    const mk = (label, sub, fn, disabled = false) => {
      const b = el('button', `main-btn debug-card${disabled ? ' disabled' : ''}`, body);
      el('div', 'mb-label', b, label);
      el('div', 'mb-sub', b, sub);
      if (!disabled) b.onclick = () => { this.click(); fn(); };
      return b;
    };

    if (human) {
      mk('REFILL HEALTH + MANA', 'Restores your current wizard and clears hard debuffs.', () => {
        human.health = human.stats.hp;
        human.mana = human.stats.mana;
        human.disarmT = human.blindT = human.slowT = human.snareT = human.silenceT = 0;
        human.burnT = human.staggerT = human.freezeT = 0;
        human.bleeds.length = 0;
        game.hud.notice('Debug: refilled health and mana', 'good');
        setStatus('Refilled health and mana.');
      });
      mk('GRANT 16K GALLEONS', 'Sets your money to at least 16000 for buy testing.', () => {
        human.money = Math.max(human.money, 16000);
        game.hud.refreshBuy();
        game.hud.notice('Debug: 16000 G granted', 'good');
        setStatus('Granted 16000 Galleons.');
      }, game.mode === 'dm');
      mk('UNLOCK LOADOUT', 'Known spells, max charges, max gear, and your preferred wand.', () => {
        for (const [id, sp] of Object.entries(SPELLS)) {
          if (sp.exclusive && human.charId !== sp.exclusive) continue;
          if (id === 'stupefy' && human.charId === 'snape') continue;
          human.owned.add(id);
          if (sp.charges) human.charges[id] = human.chargeCap(sp);
        }
        for (const eq of EQUIPMENT) {
          human.equip[eq.id] = eq.max;
          if (eq.id === 'vest') human.vestHP = Math.max(human.vestHP, EQUIP_EFFECTS.vest.pool);
        }
        human.wand = WANDS.find((w) => w.id === human.prefWand) || human.wand;
        human.ensureValidSpell();
        game.hud.refreshEquip();
        game.hud.refreshBuy();
        game.hud.notice('Debug: loadout unlocked', 'good');
        setStatus('Unlocked spells, gear, and preferred wand.');
      });
      mk(game.mode === 'dm' ? 'FINISH DEATHMATCH' : 'WIN ROUND', 'Ends the current test in your favor.', () => {
        if (game.mode === 'dm') game.finishMatch(human.team);
        else game.endRound(human.team, 'elim');
        setStatus(game.mode === 'dm' ? 'Finished deathmatch.' : 'Ended round in your favor.');
      }, game.over || game.state === 'end');
    } else {
      mk('NO ACTIVE MATCH', 'Start a match and open the pause menu to use live cheats.', () => {}, true);
      mk('CURRENT SETUP READY', 'Use the normal setup flow; F9 stays available on every menu panel.', () => {}, true);
    }

    const foot = el('div', 'setup-foot', p);
    const back = el('button', 'btn big', foot, '← BACK');
    back.onclick = () => { this.click(); this.restoreDebugReturn(); };
  }

  // -------------------------------------------------------------- main menu ---
  showMain() {
    const p = this.panel('main-menu');
    el('div', 'title-glow', p);
    el('h1', 'game-title', p, 'DUELSTRIKE 1.6');
    el('div', 'game-sub', p, 'Hogwarts duels · Counter-Strike 1.6 rules · fully offline');
    const btns = el('div', 'main-btns', p);
    const mk = (label, sub, fn) => {
      const b = el('button', 'main-btn', btns);
      el('div', 'mb-label', b, label);
      el('div', 'mb-sub', b, sub);
      b.onclick = () => { this.click(); fn(); };
      return b;
    };
    mk('PLAY — CURSED RELIC', 'Round-based 5v5 vs bots. Plant or dispel the Relic.', () => this.showSetup('relic'));
    mk('DEATHMATCH', 'Team kill race. All spells unlocked.', () => this.showSetup('dm'));
    mk('SETTINGS', 'Mouse, keybinds, crosshair, video, audio.', () => this.showSettings(false));
    mk('HOW TO PLAY', 'Controls and the rules of engagement.', () => this.showHelp());
    el('div', 'footer-note', p, 'WASD move · LMB cast · RMB Protego · R recharge · B buy · E plant/defuse · Tab scoreboard');
  }

  showHelp() {
    const p = this.panel('help');
    el('h2', 'panel-title', p, 'HOW TO PLAY');
    const grid = el('div', 'help-grid', p);
    const sec = (title, lines) => {
      const s = el('div', 'help-sec', grid);
      el('h3', '', s, title);
      for (const l of lines) el('div', 'help-line', s, l);
    };
    sec('Objective', [
      'Death Eaters attack: carry the Cursed Relic to site A or B and hold E to plant.',
      'Order defends: eliminate attackers, run the clock, or hold E on a planted Relic to dispel it (Finite Incantatem).',
      'Win rounds by elimination or the objective. First to 8 rounds wins (sides swap at halftime).',
    ]);
    sec('Magic', [
      'Casting drains mana. Press R to recharge fast (your "reload").',
      'All spells are projectiles — lead your targets. Hits are locational: head 2x, stomach 1.15x, arm 0.85x, leg 0.7x (leg hits also stumble the victim).',
      'Spam blooms your spread (watch the crosshair) and kicks your aim up — tap or burst.',
      'Moving while casting adds spread; stand still, walk (Shift) or crouch for accuracy.',
      'Charging Avada Kedavra scopes your view in — a wizard sniper rifle.',
      'Hold RMB for Protego: absorbs enemy spells while draining mana. Raise it at the last instant to PARRY.',
      'Opposing bolts CLASH and annihilate mid-air — but Avada Kedavra burns through.',
      'Bolts detonate enemy grenades in flight. Fumos smothers Incendio. Water cures burning.',
      'Serpensortia conjures a hunting snake — shoot enemy serpents before they strike.',
      'Your own Bombarda and Incendio can hurt you. Friendly fire is off.',
    ]);
    sec('Economy & Loot', [
      'Earn Galleons from kills (Avada Kedavra pays half), round wins, and objective plays.',
      'Press B during the buy period to purchase wands, spells, and equipment.',
      'Dragonhide Vest soaks 30% of hits; Felix Felicis cheats death once; the Portkey channels you home.',
      'The fallen drop their wand and a piece of kit — walk over loot or press E to take a wand.',
      'Survive a round and you keep your wand and gear. Die and you re-equip.',
    ]);
    sec('Controls', [
      'WASD move · Space jump · Ctrl crouch · Shift walk silently (no footstep noise)',
      'LMB cast · RMB Protego · 1-5 / wheel switch spells',
      'Q potion · C broom (hold direction, Space climbs, Ctrl dives) · F cloak · G apparate · V portkey',
      'E use / plant / dispel / loot · Tab scoreboard · Esc menu',
    ]);
    const back = el('button', 'btn big', p, '← BACK');
    back.onclick = () => { this.click(); this.showMain(); };
  }

  // ------------------------------------------------------------ match setup ---
  showSetup(mode) {
    if (this.setup.mode !== mode) this.setupStep = 0;
    this.setup.mode = mode;
    this.setupStep = clamp(this.setupStep ?? 0, 0, 2);
    let refreshRosters = () => {};
    const p = this.panel('setup');
    el('h2', 'panel-title', p, mode === 'dm' ? 'DEATHMATCH SETUP' : 'MATCH SETUP');
    const steps = mode === 'dm'
      ? ['Map', 'Champion', 'Loadout & bans']
      : ['Map', 'Champion & lineups', 'Loadout & rules'];
    const stepRow = el('div', 'setup-steps', p);
    steps.forEach((label, i) => {
      const s = el('button', `setup-step ${i === this.setupStep ? 'active' : ''} ${i < this.setupStep ? 'done' : ''}`, stepRow, `${i + 1}. ${label}`);
      s.onclick = () => { this.click(); this.setupStep = i; this.showSetup(mode); };
    });
    const scroll = el('div', 'setup-scroll', p);

    // --- maps ---
    if (this.setupStep === 0) {
    const mapRows = [];
    const mapGroup = (title, group) => {
      el('h3', 'sec-title', scroll, title);
      const mapRow = el('div', 'card-row maps', scroll);
      mapRows.push(mapRow);
      for (const m of MAP_LIST.filter((m) => m.group === group)) {
        const c = el('div', `sel-card map${this.setup.mapId === m.id ? ' sel' : ''}`, mapRow);
        c.dataset.id = m.id;
        const cv = el('canvas', 'map-preview', c);
        cv.width = cv.height = 160;
        cv.getContext('2d').drawImage(mapPreview(m.id), 0, 0, 160, 160);
        el('div', 'card-name', c, m.name);
        el('div', 'card-sub', c, m.desc);
        c.onclick = () => {
          this.click();
          this.setup.mapId = m.id;
          for (const row of mapRows) {
            row.querySelectorAll('.sel-card').forEach((x) => x.classList.toggle('sel', x.dataset.id === m.id));
          }
        };
      }
    };
    mapGroup('BATTLEGROUND — THE CLASSICS', 'classic');
    mapGroup('BATTLEGROUND — HOGWARTS', 'hogwarts');
    mapGroup('BATTLEGROUND — THE WIZARDING WORLD', 'world');
    }

    // --- team ---
    if (this.setupStep === 1) {
    let teamRow = null;
    if (mode === 'relic') {
      el('h3', 'sec-title', scroll, 'ALLEGIANCE');
      teamRow = el('div', 'card-row teams', scroll);
      for (const t of [TEAM.ORDER, TEAM.DEATH]) {
        const info = TEAM_INFO[t];
        const c = el('div', `sel-card team ${t}${this.setup.team === t ? ' sel' : ''}`, teamRow);
        c.dataset.id = t;
        el('div', 'card-name', c, info.name);
        el('div', 'card-sub', c, t === TEAM.DEATH ? 'Attack first: plant the Cursed Relic.' : 'Defend first: hold sites A and B.');
        c.onclick = () => {
          this.click();
          this.setup.team = t;
          teamRow.querySelectorAll('.sel-card').forEach((x) => x.classList.toggle('sel', x.dataset.id === t));
        };
      }
    }

    // --- characters ---
    el('h3', 'sec-title', scroll, 'CHAMPION (you)');
    const charRow = el('div', 'card-row chars', scroll);
    const statDefs = [
      ['HP', (c) => c.hp / 130], ['Speed', (c) => (c.speed - 4.2) / 1.8], ['Power', (c) => (c.power - 0.7) / 0.65],
      ['Cast', (c) => (c.cast - 0.7) / 0.55], ['Mana', (c) => c.mana / 140], ['Regen', (c) => c.regen / 6.5],
    ];
    for (const ch of CHARACTERS) {
      const c = el('div', `sel-card char${this.setup.charId === ch.id ? ' sel' : ''}`, charRow);
      c.dataset.id = ch.id;
      el('div', 'card-name', c, ch.name);
      el('div', `card-side ${ch.side}`, c, TEAM_INFO[ch.side].short);
      const stats = el('div', 'char-stats', c);
      for (const [label, fn] of statDefs) {
        const row = el('div', 'stat-row', stats);
        el('span', 'stat-label', row, label);
        const bar = el('div', 'stat-bar', row);
        el('div', 'stat-fill', bar).style.width = `${clamp(fn(ch), 0.06, 1) * 100}%`;
      }
      el('div', 'char-perk', c, `★ ${ch.perk}`);
      el('div', 'char-perk-desc', c, ch.perkDesc);
      if (ch.fav && SPELLS[ch.fav]) el('div', 'char-fav', c, `Favors: ${SPELLS[ch.fav].name} — buys it whenever gold allows`);
      el('div', 'char-style', c, `Playstyle: ${ch.style}`);
      c.onclick = () => {
        this.click();
        this.setup.charId = ch.id;
        // your champion can't also be a bot
        this.setup.squad = this.setup.squad.filter((id) => id !== ch.id);
        this.setup.foes = this.setup.foes.filter((id) => id !== ch.id);
        charRow.querySelectorAll('.sel-card').forEach((x) => x.classList.toggle('sel', x.dataset.id === ch.id));
        refreshRosters();
      };
    }

    // --- roster picker: hand-pick teammate & enemy characters ---
    el('h3', 'sec-title', scroll, 'LINEUPS (pick who fights beside you — and who you face)');
    const rosterWrap = el('div', 'rosters', scroll);
    const mkRoster = (key, otherKey, label, hint) => {
      const box = el('div', `roster ${key}`, rosterWrap);
      const head = el('div', 'roster-head', box);
      el('span', 'roster-label', head, label);
      const count = el('span', 'roster-count', head, '');
      el('div', 'roster-hint', box, hint);
      const grid = el('div', 'roster-grid', box);
      const chips = [];
      for (const ch of CHARACTERS) {
        const chip = el('div', 'rchip', grid);
        chip.dataset.id = ch.id;
        el('span', `rchip-side ${ch.side}`, chip);
        el('span', 'rchip-name', chip, ch.short);
        chip.title = `${ch.name} — ${ch.perk}\n${ch.perkDesc}\n${ch.style}`;
        chip.onclick = () => {
          const sel = this.setup[key];
          if (chip.classList.contains('taken')) return;
          this.click();
          const i = sel.indexOf(ch.id);
          if (i >= 0) sel.splice(i, 1);
          else {
            if (sel.length >= this.rosterCap(key)) return;
            sel.push(ch.id);
          }
          refreshRosters();
        };
        chips.push(chip);
      }
      return { chips, count, key, otherKey };
    };
    const squadBox = mkRoster('squad', 'foes', 'YOUR SQUAD', 'Unpicked slots auto-fill with wizards of your allegiance. Click to toggle.');
    const foesBox = mkRoster('foes', 'squad', 'THE OPPOSITION', 'Unpicked slots auto-fill from the enemy side. Click to toggle.');
    refreshRosters = () => {
      for (const box of [squadBox, foesBox]) {
        const sel = this.setup[box.key];
        const other = this.setup[box.otherKey];
        const cap = this.rosterCap(box.key);
        // over-cap trim (slider moved down after picking)
        if (sel.length > cap) sel.length = cap;
        box.count.textContent = `${sel.length}/${cap} picked · ${cap - sel.length} auto`;
        for (const chip of box.chips) {
          const id = chip.dataset.id;
          chip.classList.toggle('sel', sel.includes(id));
          chip.classList.toggle('taken', id === this.setup.charId || other.includes(id));
        }
      }
    };
    refreshRosters();
    }

    // --- discipline (your build for the match) ---
    if (this.setupStep === 2) {
    el('h3', 'sec-title', scroll, 'DISCIPLINE (your school of magic — one passive build)');
    const discRow = el('div', 'card-row discs', scroll);
    for (const d of DISCIPLINES) {
      const c = el('div', `sel-card disc${this.setup.discipline === d.id ? ' sel' : ''}`, discRow);
      c.dataset.id = d.id;
      const head = el('div', 'wand-head', c);
      el('img', 'wand-ico', head).src = spellIcon(d.icon);
      el('div', 'card-name', c, d.name);
      el('div', 'card-sub', c, d.desc);
      c.onclick = () => {
        this.click();
        this.setup.discipline = d.id;
        discRow.querySelectorAll('.sel-card').forEach((x) => x.classList.toggle('sel', x.dataset.id === d.id));
      };
    }

    // --- preferred wand ---
    el('h3', 'sec-title', scroll, 'PREFERRED WAND (you still buy it in-match)');
    const wandRow = el('div', 'card-row wands', scroll);
    for (const w of WANDS) {
      const c = el('div', `sel-card wand${this.setup.prefWand === w.id ? ' sel' : ''}`, wandRow);
      c.dataset.id = w.id;
      const head = el('div', 'wand-head', c);
      el('img', 'wand-ico', head).src = spellIcon('wand');
      el('div', 'card-name', c, w.name);
      el('div', 'card-sub', c, w.price === 0 ? 'Free starter' : `${w.price} ɢ`);
      const stats = el('div', 'char-stats', c);
      const wd = [['Power', (w.power - 0.7) / 0.65], ['Cast', (w.cast - 0.9) / 0.3], ['Accuracy', (1.6 - w.spread) / 1.1], ['Efficiency', (1.35 - w.manaMult * 0.5) / 0.95]];
      for (const [label, frac] of wd) {
        const row = el('div', 'stat-row', stats);
        el('span', 'stat-label', row, label);
        const bar = el('div', 'stat-bar', row);
        el('div', 'stat-fill', bar).style.width = `${clamp(frac, 0.06, 1) * 100}%`;
      }
      c.onclick = () => {
        this.click();
        this.setup.prefWand = w.id;
        wandRow.querySelectorAll('.sel-card').forEach((x) => x.classList.toggle('sel', x.dataset.id === w.id));
      };
    }

    // --- bots & rules ---
    el('h3', 'sec-title', scroll, 'LOBBY SIZE');
    const opts = el('div', 'opts-grid', scroll);
    const slider = (label, key, min, max, fmt = (v) => String(v)) => {
      const row = el('div', 'opt-row', opts);
      el('label', '', row, label);
      const inp = el('input', '', row);
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = 1;
      inp.value = this.setup[key];
      const val = el('span', 'opt-val', row, fmt(this.setup[key]));
      inp.oninput = () => {
        this.setup[key] = Number(inp.value);
        val.textContent = fmt(this.setup[key]);
        refreshRosters(); // roster caps follow the bot counts
      };
    };
    slider('Teammate bots', 'botsFriendly', 0, 4);
    slider('Enemy bots', 'botsEnemy', 1, 5);

    // --- bot brain: preset cards + the four tuning sliders ---
    el('h3', 'sec-title', scroll, 'BOT BRAIN (presets, or tune the four axes yourself)');
    const diffRow = el('div', 'card-row diffs', scroll);
    const diffDesc = el('div', 'diff-desc', scroll, '');
    const axisDefs = [
      ['reflex', 'Reflexes', 'reaction time, turn speed, shield reflexes'],
      ['aim', 'Accuracy', 'flick control, tracking, counter-strafing'],
      ['sense', 'Awareness', 'vision cone and range, hearing, memory'],
      ['iq', 'Tactics', 'utility, trades, saves, target priority'],
    ];
    const axGrid = el('div', 'opts-grid', scroll);
    const axInputs = {};
    const cards = [];
    const refreshDiff = () => {
      const cur = DIFFICULTIES.find((d) => d.id === this.setup.difficulty);
      for (const c of cards) c.classList.toggle('sel', c.dataset.id === this.setup.difficulty);
      diffDesc.textContent = cur ? cur.desc
        : 'Custom brain — your slider mix. Drag any slider to shape how human they are.';
      const axes = cur ? cur.axes : this.setup.aiCustom;
      for (const [key] of axisDefs) {
        axInputs[key].inp.value = axes[key];
        axInputs[key].val.textContent = String(Math.round(axes[key]));
      }
    };
    const mkDiffCard = (id, name, sub) => {
      const c = el('div', 'sel-card diff', diffRow);
      c.dataset.id = id;
      el('div', 'card-name', c, name);
      el('div', 'card-sub', c, sub);
      c.onclick = () => {
        this.click();
        this.setup.difficulty = id;
        refreshDiff();
      };
      cards.push(c);
      return c;
    };
    for (const d of DIFFICULTIES) mkDiffCard(d.id, d.name, `R${d.axes.reflex} · A${d.axes.aim} · S${d.axes.sense} · T${d.axes.iq}`);
    mkDiffCard('custom', 'Custom', 'your own slider mix');
    for (const [key, label, hint] of axisDefs) {
      const row = el('div', 'opt-row', axGrid);
      el('label', '', row, label).title = hint;
      const inp = el('input', '', row);
      inp.type = 'range'; inp.min = 0; inp.max = 100; inp.step = 1;
      const val = el('span', 'opt-val', row, '50');
      axInputs[key] = { inp, val };
      inp.oninput = () => {
        // touching a slider means you're tuning: switch to the custom brain
        if (this.setup.difficulty !== 'custom') {
          const cur = DIFFICULTIES.find((d) => d.id === this.setup.difficulty);
          if (cur) this.setup.aiCustom = { ...cur.axes };
          this.setup.difficulty = 'custom';
        }
        this.setup.aiCustom[key] = Number(inp.value);
        val.textContent = inp.value;
        refreshDiff();
      };
    }
    refreshDiff();

    if (mode === 'relic') {
      const fmtRow = el('div', 'opt-row', opts);
      el('label', '', fmtRow, 'Match length');
      const fmtSel = el('select', '', fmtRow);
      for (const f of FORMATS) {
        const o = el('option', '', fmtSel, f.name);
        o.value = f.id;
      }
      fmtSel.value = this.setup.format;
      fmtSel.onchange = () => { this.setup.format = fmtSel.value; };
    }
    if (mode === 'dm') {
      el('h3', 'sec-title', scroll, 'DEATHMATCH RULES');
      const dmOpts = el('div', 'opts-grid', scroll);
      const targetRow = el('div', 'opt-row', dmOpts);
      el('label', '', targetRow, 'Kill target');
      const targetSel = el('select', '', targetRow);
      for (const n of [25, 50, 75, 100]) {
        const o = el('option', '', targetSel, `${n} team kills`);
        o.value = String(n);
      }
      targetSel.value = String(this.setup.dmKillTarget || ROUND.dmKillTarget);
      targetSel.onchange = () => { this.setup.dmKillTarget = Number(targetSel.value); };

      el('h3', 'sec-title', scroll, 'DEATHMATCH BANS');
      el('div', 'card-sub', scroll, 'Toggle out high-impact spells for balance experiments. Banned spells never appear in the warm-up loadout.');
      const banGrid = el('div', 'ban-grid', scroll);
      const banIds = ['avada', 'bombarda', 'incendio', 'petrificus', 'impedimenta', 'silencio', 'patronum', 'serpensortia', 'episkey'];
      const refreshBans = () => {
        for (const chip of banGrid.querySelectorAll('.ban-chip')) {
          chip.classList.toggle('sel', this.setup.dmBanned.includes(chip.dataset.id));
        }
      };
      for (const id of banIds) {
        const sp = SPELLS[id];
        if (!sp) continue;
        const chip = el('div', 'ban-chip', banGrid);
        chip.dataset.id = id;
        el('img', 'ban-ico', chip).src = spellIcon(sp.icon);
        const txt = el('div', 'ban-copy', chip);
        el('div', 'ban-name', txt, sp.name);
        el('div', 'ban-role', txt, sp.role);
        chip.onclick = () => {
          this.click();
          const i = this.setup.dmBanned.indexOf(id);
          if (i >= 0) this.setup.dmBanned.splice(i, 1);
          else this.setup.dmBanned.push(id);
          refreshBans();
        };
      }
      refreshBans();
    }
    }

    const foot = el('div', 'setup-foot', p);
    const back = el('button', 'btn', foot, '← BACK');
    back.onclick = () => {
      this.click();
      if (this.setupStep > 0) { this.setupStep--; this.showSetup(mode); }
      else this.showMain();
    };
    const controls = el('button', 'btn', foot, 'CUSTOMIZE CONTROLS');
    controls.onclick = () => { this.click(); this.showSettings(false); };
    const finalLabel = mode === 'dm' ? 'ENTER WARM-UP' : 'START MATCH';
    const start = el('button', 'btn big primary', foot, this.setupStep < steps.length - 1 ? 'CONTINUE →' : finalLabel);
    start.onclick = () => {
      this.click();
      if (this.setupStep < steps.length - 1) {
        this.setupStep++;
        this.showSetup(mode);
        return;
      }
      this.ctx.settings.lastSetup = { ...this.setup };
      this.ctx.saveSettings();
      this.clear();
      this.ctx.startGame({ ...this.setup, mode });
    };
  }

  // --------------------------------------------------------------- settings ---
  showSettings(fromPause) {
    this.settingsFromPause = !!fromPause;
    const p = this.panel('settings');
    const s = this.ctx.settings;
    el('h2', 'panel-title', p, 'SETTINGS');
    const scroll = el('div', 'setup-scroll', p);

    const grid = el('div', 'opts-grid wide', scroll);
    const slider = (label, get, set, min, max, step, fmt) => {
      const row = el('div', 'opt-row', grid);
      el('label', '', row, label);
      const inp = el('input', '', row);
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
      inp.value = get();
      const val = el('span', 'opt-val', row, fmt(get()));
      inp.oninput = () => {
        set(Number(inp.value));
        val.textContent = fmt(get());
        this.ctx.applySettings();
      };
    };
    slider('Mouse sensitivity', () => s.sens, (v) => (s.sens = v), 0.2, 4, 0.05, (v) => v.toFixed(2));
    slider('Field of view', () => s.fov, (v) => (s.fov = v), 70, 110, 1, (v) => `${v}°`);
    slider('Volume', () => s.volume, (v) => (s.volume = v), 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    slider('Bot voices', () => s.voiceVolume ?? 0.85, (v) => (s.voiceVolume = v), 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    slider('Bot chatter', () => s.chatter ?? 0.7, (v) => (s.chatter = v), 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    const subRow = el('div', 'opt-row', grid);
    el('label', '', subRow, 'Comms subtitles');
    const subChk = el('input', '', subRow);
    subChk.type = 'checkbox';
    subChk.checked = s.subtitles !== false;
    subChk.onchange = () => { s.subtitles = subChk.checked; this.ctx.applySettings(); this.ctx.saveSettings(); };
    const fpsRow = el('div', 'opt-row', grid);
    el('label', '', fpsRow, 'FPS counter');
    const fpsChk = el('input', '', fpsRow);
    fpsChk.type = 'checkbox';
    fpsChk.checked = s.showFps;
    fpsChk.onchange = () => { s.showFps = fpsChk.checked; this.ctx.applySettings(); };
    const perfRow = el('div', 'opt-row', grid);
    el('label', '', perfRow, 'Performance mode');
    const perfChk = el('input', '', perfRow);
    perfChk.type = 'checkbox';
    perfChk.checked = !!s.performanceMode;
    perfChk.onchange = () => { s.performanceMode = perfChk.checked; this.ctx.applySettings(); this.ctx.saveSettings(); };
    const juiceRow = el('div', 'opt-row', grid);
    el('label', '', juiceRow, 'Cinematic slow-mo');
    const juiceChk = el('input', '', juiceRow);
    juiceChk.type = 'checkbox';
    juiceChk.checked = s.juice !== false;
    juiceChk.onchange = () => { s.juice = juiceChk.checked; this.ctx.applySettings(); this.ctx.saveSettings(); };

    // --- feel & effects (juice + accessibility) ---
    el('h3', 'sec-title', scroll, 'FEEL & EFFECTS');
    const feel = el('div', 'opts-grid wide', scroll);
    const fSlider = (label, get, set, min, max, step, fmt) => {
      const row = el('div', 'opt-row', feel);
      el('label', '', row, label);
      const inp = el('input', '', row);
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
      inp.value = get();
      const val = el('span', 'opt-val', row, fmt(get()));
      inp.oninput = () => { set(Number(inp.value)); val.textContent = fmt(get()); this.ctx.applySettings(); this.ctx.saveSettings(); };
    };
    const fCheck = (label, get, set) => {
      const row = el('div', 'opt-row', feel);
      el('label', '', row, label);
      const chk = el('input', '', row);
      chk.type = 'checkbox';
      chk.checked = get();
      chk.onchange = () => { set(chk.checked); this.ctx.applySettings(); this.ctx.saveSettings(); };
    };
    fCheck('Bloom glow', () => s.bloom !== false, (v) => (s.bloom = v));
    fSlider('Bloom strength', () => s.bloomStrength ?? 1, (v) => (s.bloomStrength = v), 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`);
    fSlider('Screen shake', () => s.shake ?? 1, (v) => (s.shake = v), 0, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
    fCheck('Reduce flashing', () => !!s.reduceFlash, (v) => (s.reduceFlash = v));
    fCheck('Reduce motion', () => !!s.reduceMotion, (v) => (s.reduceMotion = v));

    // crosshair editor
    el('h3', 'sec-title', scroll, 'CROSSHAIR');
    const chWrap = el('div', 'ch-editor', scroll);
    const preview = el('div', 'ch-preview', chWrap);
    const pv = el('div', 'crosshair pv', preview);
    const pvParts = {
      t: el('div', 'ch-line ch-t', pv), b: el('div', 'ch-line ch-b', pv),
      l: el('div', 'ch-line ch-l', pv), r: el('div', 'ch-line ch-r', pv),
      dot: el('div', 'ch-dot', pv),
    };
    const renderPv = () => {
      const c = s.crosshair;
      for (const k of ['t', 'b', 'l', 'r']) {
        const e = pvParts[k];
        e.style.background = c.color;
        const len = `${c.size}px`, th = `${c.thickness}px`, gap = c.gap;
        if (k === 't') { e.style.width = th; e.style.height = len; e.style.transform = `translate(-50%, ${-gap - c.size}px)`; }
        if (k === 'b') { e.style.width = th; e.style.height = len; e.style.transform = `translate(-50%, ${gap}px)`; }
        if (k === 'l') { e.style.width = len; e.style.height = th; e.style.transform = `translate(${-gap - c.size}px, -50%)`; }
        if (k === 'r') { e.style.width = len; e.style.height = th; e.style.transform = `translate(${gap}px, -50%)`; }
      }
      pvParts.dot.style.background = c.color;
      pvParts.dot.style.display = c.dot ? 'block' : 'none';
      pvParts.dot.style.width = pvParts.dot.style.height = `${c.thickness + 1}px`;
    };
    renderPv();
    const chOpts = el('div', 'opts-grid', chWrap);
    const colorRow = el('div', 'opt-row', chOpts);
    el('label', '', colorRow, 'Color');
    const colorInp = el('input', '', colorRow);
    colorInp.type = 'color';
    colorInp.value = s.crosshair.color;
    colorInp.oninput = () => { s.crosshair.color = colorInp.value; renderPv(); this.ctx.applySettings(); };
    const chSlider = (label, key, min, max) => {
      const row = el('div', 'opt-row', chOpts);
      el('label', '', row, label);
      const inp = el('input', '', row);
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = 1;
      inp.value = s.crosshair[key];
      const val = el('span', 'opt-val', row, String(s.crosshair[key]));
      inp.oninput = () => {
        s.crosshair[key] = Number(inp.value);
        val.textContent = String(s.crosshair[key]);
        renderPv();
        this.ctx.applySettings();
      };
    };
    chSlider('Size', 'size', 2, 16);
    chSlider('Gap', 'gap', 0, 14);
    chSlider('Thickness', 'thickness', 1, 6);
    const dotRow = el('div', 'opt-row', chOpts);
    el('label', '', dotRow, 'Center dot');
    const dotChk = el('input', '', dotRow);
    dotChk.type = 'checkbox';
    dotChk.checked = s.crosshair.dot;
    dotChk.onchange = () => { s.crosshair.dot = dotChk.checked; renderPv(); this.ctx.applySettings(); };

    // keybinds
    el('h3', 'sec-title', scroll, 'KEYBINDS (click to rebind, Esc to cancel)');
    const bindGrid = el('div', 'bind-grid', scroll);
    const renderBinds = () => {
      bindGrid.innerHTML = '';
      for (const action of Object.keys(BIND_LABELS)) {
        const row = el('div', 'bind-row', bindGrid);
        el('span', 'bind-label', row, BIND_LABELS[action]);
        const btn = el('button', 'bind-btn', row, keyLabel(this.ctx.input.binds[action]));
        btn.onclick = () => {
          this.click();
          btn.textContent = '…press a key…';
          btn.classList.add('listening');
          this.ctx.input.startRebind(action, () => {
            s.binds = this.ctx.input.serialize();
            this.ctx.saveSettings();
            renderBinds();
          });
        };
      }
    };
    renderBinds();
    const resetB = el('button', 'btn', scroll, 'Reset keybinds to defaults');
    resetB.onclick = () => {
      this.click();
      this.ctx.input.reset();
      s.binds = this.ctx.input.serialize();
      this.ctx.saveSettings();
      renderBinds();
    };

    const foot = el('div', 'setup-foot', p);
    const back = el('button', 'btn big', foot, fromPause ? '← BACK TO PAUSE' : '← BACK');
    back.onclick = () => {
      this.click();
      this.ctx.saveSettings();
      if (fromPause) this.showPause();
      else this.showMain();
    };
  }

  // ------------------------------------------------------------------ pause ---
  showPause() {
    const p = this.panel('pause');
    el('h2', 'panel-title', p, 'PAUSED');
    const btns = el('div', 'main-btns', p);
    const mk = (label, fn) => {
      const b = el('button', 'main-btn slim', btns, label);
      b.onclick = () => { this.click(); fn(); };
    };
    mk('RESUME', () => this.ctx.resumeGame());
    mk('SETTINGS', () => this.showSettings(true));
    mk('FORFEIT — MAIN MENU', () => this.ctx.quitToMenu());
  }

  showLockOverlay(show) {
    if (show && !this.lockEl) {
      this.lockEl = el('div', 'lock-overlay', this.root);
      el('div', 'lock-text', this.lockEl, 'Click to take up your wand');
      this.lockEl.onclick = () => this.ctx.resumeGame();
    } else if (!show && this.lockEl) {
      this.lockEl.remove();
      this.lockEl = null;
    }
  }

  // Loading curtain over the one-time world build / shader-compile hitch.
  // The spinner animates on the compositor, so it keeps moving during the
  // synchronous build that briefly freezes the main thread.
  showLoading(show) {
    if (show && !this.loadEl) {
      this.loadEl = el('div', 'load-overlay', this.root);
      const box = el('div', 'load-box', this.loadEl);
      el('div', 'load-ring', box);
      el('div', 'load-title', box, 'ENTERING THE DUEL');
      el('div', 'load-sub', box, 'conjuring the arena…');
    } else if (!show && this.loadEl) {
      this.loadEl.remove();
      this.loadEl = null;
    }
  }

  // -------------------------------------------------------------- end screen ---
  showEnd(game, winner) {
    this.endState = { game, winner };
    const p = this.panel('end-screen');
    const human = game.human;
    const humanWon = winner === human.team;
    const title = game.mode === 'dm'
      ? 'WARM-UP COMPLETE'
      : winner === null ? 'DRAW' : humanWon ? 'VICTORY' : 'DEFEAT';
    el('h1', `end-title ${winner === null ? '' : humanWon ? 'good' : 'bad'}`, p, title);
    if (game.mode !== 'dm') {
      el('div', 'end-score', p, `${TEAM_INFO.order.short} ${game.score.order} — ${game.score.death} ${TEAM_INFO.death.short}`);
      // round strip
      const strip = el('div', 'round-strip', p);
      const reasonGlyph = { elim: '☠', time: '⏱', defuse: '✦', explode: '✸' };
      game.roundHistory.forEach((r, i) => {
        const cell = el('div', `strip-cell ${r.winner}`, strip, reasonGlyph[r.reason] || '·');
        cell.title = `Round ${i + 1}`;
      });
    } else {
      const score = game.deathmatchScore();
      el('div', 'end-score', p, `${TEAM_INFO.order.short} ${score.order} — ${score.death} ${TEAM_INFO.death.short} · Race to ${game.dmKillTarget}`);
    }
    // match MVP: damage + kills + objective work + round-MVP stars
    const mvpScore = (q) => q.dmgDealt + q.kills * 70 + (q.plants + q.defuses) * 100 + q.mvps * 60;
    let mvp = game.players[0];
    for (const q of game.players) if (mvpScore(q) > mvpScore(mvp)) mvp = q;
    el('div', 'end-mvp', p, `Match MVP: ${mvp.name} — ${mvp.kills} kills, ${Math.round(mvp.dmgDealt)} damage${mvp.mvps ? `, ${mvp.mvps}× round MVP` : ''}`);

    // stats table
    const wrap = el('div', 'end-tables', p);
    for (const team of [TEAM.ORDER, TEAM.DEATH]) {
      const sec = el('div', `sb-team ${team}`, wrap);
      el('div', 'sb-team-name', sec, TEAM_INFO[team].name);
      const table = el('table', 'sb-table', sec);
      const hr = el('tr', '', el('thead', '', table));
      const headers = game.mode === 'dm'
        ? ['Player', 'K', 'A', 'D', 'KDA', 'HS', 'DMG']
        : ['Player', 'K', 'A', 'D', 'HS', 'DMG', 'OBJ', '★'];
      for (const hcell of headers) el('th', '', hr, hcell);
      const tb = el('tbody', '', table);
      const players = game.teamPlayers(team).sort((a, b) => (
        game.mode === 'dm'
          ? b.kills - a.kills || (b.kills + b.assists) / Math.max(1, b.deaths) - (a.kills + a.assists) / Math.max(1, a.deaths)
          : mvpScore(b) - mvpScore(a)
      ));
      for (const q of players) {
        const tr = el('tr', q.isHuman ? 'me' : '', tb);
        const nameTd = el('td', 'sb-name', tr, q.isHuman ? `★ ${q.char.name}` : q.name);
        if (!q.isHuman && !q.char.name.includes(q.name)) el('span', 'sb-champ', nameTd, q.char.name.split(' ').pop());
        el('td', '', tr, String(q.kills));
        el('td', '', tr, String(q.assists));
        el('td', '', tr, String(q.deaths));
        if (game.mode === 'dm') el('td', '', tr, fmtKDA(q));
        el('td', '', tr, String(q.hsK));
        el('td', '', tr, String(Math.round(q.dmgDealt)));
        if (game.mode !== 'dm') {
          el('td', '', tr, String(q.plants + q.defuses));
          el('td', 'sb-star', tr, q.mvps ? '★'.repeat(Math.min(q.mvps, 5)) : '');
        }
      }
    }

    const foot = el('div', 'setup-foot', p);
    const again = el('button', 'btn big primary', foot, 'REMATCH');
    again.onclick = () => {
      this.click();
      this.clear();
      this.ctx.startGame({ ...this.setup });
    };
    const change = el('button', 'btn big', foot, 'CHANGE SETUP');
    change.onclick = () => { this.click(); this.showSetup(this.setup.mode); };
    const home = el('button', 'btn', foot, 'MAIN MENU');
    home.onclick = () => { this.click(); this.showMain(); };
  }
}
