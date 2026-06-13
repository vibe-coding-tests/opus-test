// Boot: renderer, settings persistence, menu/game lifecycle, main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Menus } from './menus.js';
import { Game } from './game.js';

const DEFAULT_SETTINGS = {
  sens: 1.0,
  fov: 90, // horizontal FOV, CS-style
  volume: 0.7,
  voiceVolume: 0.85, // bot voice barks, relative to master
  subtitles: true,   // show teammate callouts in the comms feed
  chatter: 0.7,      // 0..1 density of low-priority bot chatter
  showFps: false,
  juice: true, // cinematic hitstop + slow-mo on the big moments
  performanceMode: false,
  // --- Feel layer (juice / spectacle / accessibility) ---
  bloom: true,        // glow post-processing on emissive magic
  bloomStrength: 1.0, // 0..2 user multiplier on top of the base bloom
  shake: 1.0,         // screen-shake intensity (0 = off, 1.5 = max)
  reduceFlash: false, // cap strobe/flash + bloom swells (photosensitivity)
  reduceMotion: false, // tone down camera kicks / count-ups
  crosshair: { color: '#7dffa0', size: 7, gap: 4, thickness: 2, dot: false },
  binds: null,
  lastSetup: null,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('wizardstrike_settings');
    if (raw) {
      const s = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...s, crosshair: { ...DEFAULT_SETTINGS.crosshair, ...(s.crosshair || {}) } };
    }
  } catch { /* fresh */ }
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

const settings = loadSettings();

// ----------------------------------------------------------------- renderer ---
const appEl = document.getElementById('app');
const uiEl = document.getElementById('ui');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
function applyRenderScale() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.performanceMode ? 1.0 : 1.35));
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.resize();
}
renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic response: glows bloom, darks stay rich
renderer.toneMappingExposure = 1.18;
appEl.appendChild(renderer.domElement);

let scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 600);
scene.add(camera);

// ------------------------------------------------------------- post-processing ---
// Thresholded bloom turns the additive spell cores / charge tips / fire / wards
// into real glow. Tone mapping moves to the OutputPass so it's applied once after
// bloom. The Feel settings + the game's quality governor can switch it off.
const postfx = {
  composer: null, renderPass: null, bloom: null, output: null,
  enabled: settings.bloom !== false,
  govOff: false,        // forced off by the perf governor under load
  base: 0.85,           // base bloom strength
  swell: 0,             // transient event swell (Avada, parry, blast)
  build() {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.base, 0.6, 0.82, // strength, radius, threshold (only bright magic blooms)
    );
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.resize();
  },
  setScene(sc) { if (this.renderPass) this.renderPass.scene = sc; },
  on() { return this.enabled && !this.govOff && this.composer; },
  pulse(a) { if (this.on()) this.swell = Math.min(2.2, this.swell + a); },
  setGovernor(off) { this.govOff = off; },
  apply() { this.enabled = settings.bloom !== false; },
  resize() {
    if (!this.composer) return;
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloom?.setSize(window.innerWidth, window.innerHeight);
  },
  update(dt) {
    this.swell = Math.max(0, this.swell - dt * 3.2);
    if (this.bloom) this.bloom.strength = (this.base + this.swell) * (settings.bloomStrength ?? 1);
  },
  render() {
    if (this.on()) this.composer.render();
    else renderer.render(scene, camera);
  },
};
postfx.build();
applyRenderScale();

function applyFov() {
  // settings.fov is horizontal: convert to vertical for the current aspect
  const h = (settings.fov * Math.PI) / 180;
  const v = 2 * Math.atan(Math.tan(h / 2) / camera.aspect);
  camera.fov = (v * 180) / Math.PI;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => {
  applyRenderScale();
  camera.aspect = window.innerWidth / window.innerHeight;
  applyFov();
});
camera.aspect = window.innerWidth / window.innerHeight;
applyFov();

// ------------------------------------------------------------------ systems ---
const audio = new AudioEngine();
audio.setVolume(settings.volume);
const input = new Input();
input.init(renderer.domElement);
if (settings.binds) input.load(settings.binds);
const hud = new HUD(uiEl, input, settings);

let game = null;
let paused = false;

function saveSettings() {
  settings.binds = input.serialize();
  try { localStorage.setItem('wizardstrike_settings', JSON.stringify(settings)); } catch { /* ok */ }
}

function applySettings() {
  audio.setVolume(settings.volume);
  postfx.apply();
  applyRenderScale();
  applyFov();
  hud.applyCrosshair();
}

const menus = new Menus(uiEl, {
  settings, audio, input,
  saveSettings, applySettings,
  startGame, quitToMenu, resumeGame,
  getGame: () => game,
});

function startGame(setup, { requestLock = true, loading = true } = {}) {
  disposeGame();
  audio.ensure();
  input.lockEnabled = requestLock;
  const build = () => {
    scene = new THREE.Scene();
    scene.add(camera);
    postfx.setScene(scene);
    paused = false;
    game = window.__game = new Game({
      scene, camera, renderer, audio, input, hud, settings, postfx,
      onMatchEnd: (winner) => {
        setTimeout(() => {
          if (!game) return;
          input.unlock();
          hud.unbind();
          menus.showEnd(game, winner);
          menus.showLockOverlay(false);
          disposeGameKeepStats();
        }, 1400);
      },
    }, setup);
    if (loading) {
      // Warm up behind the loading screen: frame the scene, compile shaders,
      // and prime the GPU pipeline so the first visible frame doesn't hitch.
      try {
        game.update(0);
        renderer.compile(scene, camera);
        postfx.update(0);
        postfx.render();
      } catch (err) { console.error(err); }
    }
    menus.clear();
    menus.showLoading(false);
    last = performance.now(); // reset the frame clock so the first dt isn't a spike
    if (requestLock) input.lock();
  };
  if (loading) {
    // Paint the loading overlay (and start its compositor-driven spinner)
    // before the synchronous world build freezes the main thread for a beat.
    menus.showLoading(true);
    requestAnimationFrame(() => requestAnimationFrame(build));
  } else {
    build();
  }
}

let endedGame = null;
function disposeGameKeepStats() {
  // keep the Game object alive for the end screen tables, but stop simulating
  endedGame = game;
  game = null;
  endedGame.dispose();
}

function disposeGame() {
  if (game) {
    game.dispose();
    game = null;
  }
  endedGame = null;
  hud.unbind();
}

function quitToMenu() {
  disposeGame();
  paused = false;
  input.lockEnabled = true;
  input.unlock();
  menus.showLockOverlay(false);
  menus.showMain();
}

function resumeGame() {
  if (!game) return;
  paused = false;
  game.paused = false;
  menus.clear();
  menus.showLockOverlay(false);
  audio.ensure();
  input.lock();
  // browsers refuse pointer lock for ~1.3s after an Esc exit; if the grab
  // failed, leave a click-to-relock overlay instead of an unresponsive game
  setTimeout(() => {
    if (game && !game.paused && !game.over && !input.locked && !hud.buyOpen) {
      menus.showLockOverlay(true);
    }
  }, 350);
}

function pauseGame() {
  if (!game || game.over) return;
  paused = true;
  game.paused = true;
  hud.clearWheel?.();
  hud.openBuy(false);
  menus.showLockOverlay(false);
  menus.showPause();
}

// Esc in-game never reaches keydown: the browser exits pointer lock and
// swallows the key. Treat unexpected lock loss as "the player hit Esc" and
// open the pause menu. The keydown path below only fires while unlocked
// (paused / buy menu), where it acts as back/resume.
window.addEventListener('keydown', (e) => {
  if (e.code === 'F9' && !input.rebind) {
    if (menus.toggleDebugCheats()) e.preventDefault();
    return;
  }
  if (e.code === 'Escape') {
    if (game && !game.over) {
      if (hud.buyOpen) { hud.openBuy(false); return; }
      if (!paused) pauseGame();
      else if (menus.activePanel === 'pause') resumeGame();
      else menus.showPause(); // back out of settings to the pause panel
    }
  }
});

let hadLock = false;
input.onLockChange = (locked) => {
  if (locked) hadLock = true;
  if (!game || game.over) { hadLock = locked; return; }
  if (!locked) {
    // only a genuine locked→unlocked transition means the player hit Esc;
    // failed lock *requests* can fire spurious change events
    const lost = hadLock;
    hadLock = false;
    if (lost && !paused && !hud.buyOpen) pauseGame();
  } else {
    menus.showLockOverlay(false);
  }
};

// first user gesture unlocks audio
window.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// --------------------------------------------------------------------- loop ---
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (game && !paused) {
    game.update(dt);
  }
  input.endFrame(); // clear one-shot key edges exactly once per frame
  postfx.update(dt);
  postfx.render();
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------- start ---
const params = new URLSearchParams(location.search);
if (params.get('auto')) {
  const setup = {
    mode: params.get('mode') === 'dm' ? 'dm' : 'relic',
    mapId: params.get('map') || 'dust2',
    team: params.get('team') === 'death' ? 'death' : 'order',
    charId: params.get('char') || 'harry',
    prefWand: 'holly',
    botsFriendly: 4, botsEnemy: 5,
    difficulty: params.get('diff') || 'normal',
    discipline: params.get('disc') || null,
    format: 'mr8',
    // hand-picked lineups (?squad=ginny,neville&foes=greyback,umbridge)
    squad: (params.get('squad') || '').split(',').filter(Boolean),
    foes: (params.get('foes') || '').split(',').filter(Boolean),
    dmBanned: (params.get('ban') || '').split(',').filter(Boolean),
  };
  // custom brain axes via URL (?diff=custom&rf=80&am=20&se=60&iq=40)
  if (setup.difficulty === 'custom') {
    setup.aiCustom = {
      reflex: Number(params.get('rf') ?? 50), aim: Number(params.get('am') ?? 50),
      sense: Number(params.get('se') ?? 50), iq: Number(params.get('iq') ?? 50),
    };
  }
  startGame(setup, { requestLock: false, loading: false }); // tests build synchronously
} else {
  menus.showMain();
}
