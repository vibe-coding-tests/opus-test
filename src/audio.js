// Fully synthesized WebAudio: spell sfx, UI, announcer stingers, ambient beds.
import { clamp, rand } from './utils.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
    this.ambientNodes = null;
    this.ambientTimer = null;
    // every sound's gain→panner chain must be disconnected after it ends or
    // the graph accumulates thousands of dead nodes and audio starts crackling
    this._garbage = [];
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // muffle filter (flash blind / blast deafness) sits between master and the compressor
    this.muffleLP = this.ctx.createBiquadFilter();
    this.muffleLP.type = 'lowpass';
    this.muffleLP.frequency.value = 19500;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.master.connect(this.muffleLP).connect(this.comp).connect(this.ctx.destination);
    // shared noise buffer
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // Muffle everything (strength 0..1) for dur seconds, then recover.
  setMuffle(strength, dur = 1.5) {
    if (!this.ctx || !this.muffleLP) return;
    const f = this.muffleLP.frequency;
    const now = this.ctx.currentTime;
    const target = Math.max(450, 19500 * (1 - clamp(strength, 0, 1)) + 450);
    try {
      f.cancelScheduledValues(now);
      f.setTargetAtTime(target, now, 0.04);
      f.setTargetAtTime(19500, now + Math.max(0.1, dur), 0.7);
    } catch { /* context not ready */ }
  }

  updateListener(pos, fwd) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    this.listener.fx = fwd.x; this.listener.fz = fwd.z;
    this._sweep();
  }

  _sweep() {
    if (!this.ctx || !this._garbage.length) return;
    const now = this.ctx.currentTime;
    let n = 0;
    for (const it of this._garbage) {
      if (it.at > now) { this._garbage[n++] = it; continue; }
      try { it.g.disconnect(); it.p.disconnect(); } catch { /* ok */ }
    }
    this._garbage.length = n;
  }

  // Spatialize: returns [gainMult, pan]
  _spatial(pos) {
    if (!pos) return [1, 0];
    const L = this.listener;
    const dx = pos.x - L.x, dy = (pos.y || 0) - L.y, dz = pos.z - L.z;
    const dist = Math.hypot(dx, dy, dz);
    const g = clamp(9 / (9 + dist * dist * 0.055), 0.02, 1);
    // right vector = (-fz, fx)
    const rx = -L.fz, rz = L.fx;
    const pan = dist < 0.5 ? 0 : clamp((dx * rx + dz * rz) / dist, -1, 1) * 0.8;
    return [g, pan];
  }

  _out(pos, vol = 1, ttl = 4) {
    const g = this.ctx.createGain();
    let [att, pan] = this._spatial(pos);
    if (!Number.isFinite(att)) att = 0;
    if (!Number.isFinite(pan)) pan = 0;
    g.gain.value = Number.isFinite(vol) ? vol * att : 0;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.master);
    this._garbage.push({ g, p, at: this.ctx.currentTime + ttl });
    return g;
  }

  _noise(out, t0, dur, { f0 = 800, f1 = 400, q = 1, a = 0.005, vol = 1, type = 'lowpass' } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rand(0.9, 1.1);
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  _tone(out, t0, dur, { f0 = 440, f1, type = 'sine', vol = 0.5, a = 0.005, curve = 'exp' } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== undefined) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      else o.frequency.linearRampToValueAtTime(f1, t0 + dur);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // name, {pos, vol, rate} → for sustained sounds returns {stop()}
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const t = this.ctx.currentTime + 0.001;
    const vol = opts.vol ?? 1;
    const r = opts.rate ?? 1;
    const sustained = name === 'charge' || name === 'shield' || name === 'defuse_hum';
    const ttl = sustained ? (name === 'shield' ? 90 : (opts.dur || 6) + 1.5) : 4;
    const out = this._out(opts.pos, vol, ttl);
    const N = (o) => this._noise(out, t, o.dur, o);
    const T = (o) => this._tone(out, t, o.dur, o);
    switch (name) {
      case 'cast_stupefy':
        T({ dur: 0.14, f0: 900 * r, f1: 220, type: 'sawtooth', vol: 0.35 });
        T({ dur: 0.1, f0: 1800 * r, f1: 500, type: 'square', vol: 0.12 });
        N({ dur: 0.08, f0: 4000, f1: 1200, vol: 0.25 });
        break;
      case 'cast_sectum':
        N({ dur: 0.16, f0: 6000, f1: 900, q: 3, vol: 0.5, type: 'bandpass' });
        T({ dur: 0.12, f0: 1400, f1: 300, type: 'sawtooth', vol: 0.22 });
        break;
      case 'cast_avada':
        T({ dur: 0.5, f0: 220, f1: 55, type: 'sawtooth', vol: 0.6 });
        T({ dur: 0.35, f0: 880, f1: 110, type: 'square', vol: 0.25 });
        N({ dur: 0.3, f0: 3000, f1: 300, vol: 0.4 });
        break;
      case 'cast_expelliarmus':
        T({ dur: 0.25, f0: 500, f1: 1400, type: 'triangle', vol: 0.4, curve: 'exp' });
        N({ dur: 0.12, f0: 3500, f1: 6000, vol: 0.15, type: 'highpass' });
        break;
      case 'throw':
        N({ dur: 0.18, f0: 1200, f1: 300, vol: 0.3 });
        break;
      case 'charge': {
        // sustained rising whine; decays naturally at full charge so a fired
        // cast doesn't leave the oscillator whining forever
        const dur = opts.dur || 1.15;
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(80, t);
        o.frequency.linearRampToValueAtTime(640, t + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.25 * vol, t + dur);
        g.gain.setTargetAtTime(0.0001, t + dur, 0.07);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 1200;
        o.connect(f).connect(g).connect(out);
        o.start(t); o.stop(t + dur + 0.5);
        return { stop: () => { try { g.gain.cancelScheduledValues(0); g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02); o.stop(this.ctx.currentTime + 0.1); } catch { /* ok */ } } };
      }
      case 'shield': {
        const o = this.ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = 180;
        const o2 = this.ctx.createOscillator();
        o2.type = 'sine'; o2.frequency.value = 184;
        const g = this.ctx.createGain(); g.gain.value = 0.08 * vol;
        o.connect(g); o2.connect(g); g.connect(out);
        o.start(t); o2.start(t);
        return { stop: () => { try { g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03); o.stop(this.ctx.currentTime + 0.15); o2.stop(this.ctx.currentTime + 0.15); } catch { /* ok */ } } };
      }
      case 'defuse_hum': {
        const dur = opts.dur || 6;
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(300, t);
        o.frequency.linearRampToValueAtTime(900, t + dur);
        const g = this.ctx.createGain(); g.gain.value = 0.12 * vol;
        o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.2);
        return { stop: () => { try { o.stop(); } catch { /* ok */ } } };
      }
      case 'shield_hit':
        T({ dur: 0.15, f0: 700, f1: 250, type: 'triangle', vol: 0.5 });
        N({ dur: 0.08, f0: 2500, f1: 800, vol: 0.2 });
        break;
      case 'shield_break':
        T({ dur: 0.3, f0: 500, f1: 80, type: 'sawtooth', vol: 0.4 });
        N({ dur: 0.25, f0: 4000, f1: 400, vol: 0.4 });
        break;
      case 'impact':
        N({ dur: 0.09, f0: 2000, f1: 300, vol: 0.45 });
        break;
      case 'impact_flesh':
        N({ dur: 0.1, f0: 900, f1: 150, vol: 0.5 });
        T({ dur: 0.07, f0: 200, f1: 80, vol: 0.3 });
        break;
      case 'hitmarker':
        T({ dur: 0.05, f0: 1200, type: 'square', vol: 0.18 });
        break;
      case 'headshot':
        T({ dur: 0.1, f0: 2400, f1: 1800, type: 'square', vol: 0.3 });
        T({ dur: 0.16, f0: 3600, f1: 2400, type: 'sine', vol: 0.25 });
        break;
      case 'explosion':
        N({ dur: 0.7, f0: 3000, f1: 60, vol: 1.0 });
        T({ dur: 0.5, f0: 120, f1: 30, type: 'sine', vol: 0.9 });
        T({ dur: 0.25, f0: 300, f1: 60, type: 'sawtooth', vol: 0.4 });
        break;
      case 'flash':
        T({ dur: 0.5, f0: 3200, f1: 3000, type: 'sine', vol: 0.5 });
        N({ dur: 0.2, f0: 6000, f1: 2000, vol: 0.5, type: 'highpass' });
        break;
      case 'tinnitus':
        T({ dur: 1.6, f0: 3800, f1: 3800, type: 'sine', vol: 0.18 });
        break;
      case 'smoke':
        N({ dur: 0.6, f0: 600, f1: 150, vol: 0.4 });
        break;
      case 'fire_ignite':
        N({ dur: 0.5, f0: 2500, f1: 500, vol: 0.6 });
        T({ dur: 0.3, f0: 150, f1: 60, type: 'sawtooth', vol: 0.25 });
        break;
      case 'fire_tick':
        N({ dur: 0.12, f0: rand(1500, 3500), f1: 500, vol: 0.12 });
        break;
      case 'disarm':
        T({ dur: 0.3, f0: 1200, f1: 200, type: 'triangle', vol: 0.5 });
        T({ dur: 0.2, f0: 1600, f1: 400, type: 'square', vol: 0.15 });
        break;
      case 'heal':
        T({ dur: 0.4, f0: 500, f1: 1000, type: 'sine', vol: 0.3 });
        T({ dur: 0.5, f0: 750, f1: 1500, type: 'sine', vol: 0.2 });
        break;
      case 'broom':
        N({ dur: 0.5, f0: 400, f1: 2500, vol: 0.4 });
        break;
      case 'cloak':
        N({ dur: 0.4, f0: 5000, f1: 500, vol: 0.25, type: 'bandpass', q: 2 });
        T({ dur: 0.35, f0: 900, f1: 300, type: 'sine', vol: 0.2 });
        break;
      case 'apparate':
        N({ dur: 0.3, f0: 300, f1: 4500, vol: 0.5, type: 'bandpass', q: 3 });
        T({ dur: 0.25, f0: 200, f1: 1800, type: 'square', vol: 0.12 });
        break;
      case 'recharge':
        T({ dur: opts.dur || 1.2, f0: 200, f1: 900, type: 'triangle', vol: 0.16 });
        break;
      case 'relic_beep':
        T({ dur: 0.1, f0: 1100, type: 'square', vol: 0.3 });
        break;
      case 'plant_tick':
        T({ dur: 0.06, f0: 700, type: 'square', vol: 0.2 });
        break;
      case 'relic_explode':
        N({ dur: 1.4, f0: 4000, f1: 40, vol: 1.2 });
        T({ dur: 1.0, f0: 90, f1: 24, type: 'sine', vol: 1.0 });
        T({ dur: 0.6, f0: 400, f1: 50, type: 'sawtooth', vol: 0.5 });
        break;
      case 'death':
        T({ dur: 0.4, f0: 300, f1: 60, type: 'sawtooth', vol: 0.4 });
        N({ dur: 0.3, f0: 800, f1: 100, vol: 0.4 });
        break;
      case 'hurt':
        T({ dur: 0.08, f0: 250, f1: 120, type: 'square', vol: 0.2 });
        break;
      case 'footstep':
        N({ dur: 0.07, f0: 700, f1: 200, vol: 0.12 });
        break;
      case 'land':
        N({ dur: 0.12, f0: 500, f1: 120, vol: 0.3 });
        break;
      case 'stagger':
        T({ dur: 0.09, f0: 170, f1: 70, type: 'sine', vol: 0.4 });
        N({ dur: 0.08, f0: 600, f1: 120, vol: 0.3 });
        break;
      case 'wand_drop':
        T({ dur: 0.05, f0: 1900, f1: 1100, type: 'triangle', vol: 0.22 });
        this._tone(out, t + 0.08, 0.04, { f0: 1500, f1: 900, type: 'triangle', vol: 0.14 });
        this._noise(out, t + 0.01, 0.05, { f0: 2400, f1: 800, vol: 0.18 });
        break;
      case 'wand_pickup':
        T({ dur: 0.12, f0: 700, f1: 1600, type: 'sine', vol: 0.28 });
        T({ dur: 0.08, f0: 1400, f1: 2200, type: 'triangle', vol: 0.14 });
        break;
      case 'wand_return':
        T({ dur: 0.3, f0: 1100, f1: 2400, type: 'sine', vol: 0.2 });
        N({ dur: 0.25, f0: 4000, f1: 8000, vol: 0.12, type: 'highpass' });
        break;
      case 'ignite_player':
        N({ dur: 0.45, f0: 900, f1: 3200, vol: 0.5 });
        N({ dur: 0.3, f0: 2500, f1: 900, q: 2, vol: 0.3, type: 'bandpass' });
        break;
      case 'crucio':
        N({ dur: 0.22, f0: 2800, f1: 700, q: 5, vol: 0.45, type: 'bandpass' });
        T({ dur: 0.18, f0: 130, f1: 85, type: 'square', vol: 0.25 });
        break;
      case 'heartbeat':
        T({ dur: 0.09, f0: 72, f1: 42, type: 'sine', vol: 0.55 });
        this._tone(out, t + 0.16, 0.08, { f0: 62, f1: 38, type: 'sine', vol: 0.4 });
        break;
      case 'parry': // bright bell ping: the perfect block
        T({ dur: 0.18, f0: 2100, f1: 1900, type: 'triangle', vol: 0.5 });
        T({ dur: 0.3, f0: 1400, f1: 1380, type: 'sine', vol: 0.3 });
        N({ dur: 0.06, f0: 6000, f1: 2500, vol: 0.2 });
        break;
      case 'clash': // two spells annihilating: crackle + gong
        N({ dur: 0.08, f0: 7000, f1: 2200, vol: 0.5 });
        T({ dur: 0.22, f0: 880, f1: 320, type: 'sawtooth', vol: 0.35 });
        T({ dur: 0.4, f0: 1560, f1: 1490, type: 'sine', vol: 0.22 });
        this._noise(out, t + 0.05, 0.18, { f0: 2400, f1: 500, vol: 0.25 });
        break;
      case 'sizzle': // fire meeting smoke/water
        N({ dur: 0.55, f0: 5200, f1: 2800, vol: 0.4 });
        this._noise(out, t + 0.12, 0.4, { f0: 3400, f1: 1600, vol: 0.22 });
        break;
      case 'petrify': // stone clunk + grind
        T({ dur: 0.12, f0: 220, f1: 70, type: 'square', vol: 0.45 });
        N({ dur: 0.28, f0: 700, f1: 150, vol: 0.4 });
        this._noise(out, t + 0.1, 0.15, { f0: 400, f1: 120, vol: 0.2 });
        break;
      case 'freeze_break': // cracking shell
        N({ dur: 0.12, f0: 3200, f1: 900, vol: 0.45 });
        T({ dur: 0.08, f0: 500, f1: 200, type: 'square', vol: 0.25 });
        break;
      case 'jinx': // tripping zap — wobbling descending buzz
        T({ dur: 0.2, f0: 900, f1: 260, type: 'sawtooth', vol: 0.3 });
        T({ dur: 0.14, f0: 1400, f1: 500, type: 'square', vol: 0.18 });
        N({ dur: 0.1, f0: 2600, f1: 900, q: 4, vol: 0.2, type: 'bandpass' });
        break;
      case 'silencio': // the sound being sucked out — reversed-feeling swell into nothing
        T({ dur: 0.3, f0: 1600, f1: 90, type: 'sine', vol: 0.45 });
        N({ dur: 0.22, f0: 4000, f1: 300, q: 2, vol: 0.25, type: 'bandpass' });
        this._tone(out, t + 0.24, 0.1, { f0: 70, f1: 55, type: 'sine', vol: 0.3 });
        break;
      case 'cleanse': // rising chime sweep
        T({ dur: 0.35, f0: 700, f1: 1700, type: 'sine', vol: 0.4 });
        T({ dur: 0.45, f0: 1050, f1: 2500, type: 'triangle', vol: 0.2 });
        break;
      case 'ward_up': // choral shimmer rising
        T({ dur: 0.7, f0: 420, f1: 640, type: 'sine', vol: 0.4 });
        T({ dur: 0.8, f0: 630, f1: 960, type: 'sine', vol: 0.3 });
        T({ dur: 0.9, f0: 840, f1: 1280, type: 'triangle', vol: 0.18 });
        N({ dur: 0.5, f0: 3000, f1: 7000, vol: 0.12, type: 'highpass' });
        break;
      case 'ward_block':
        T({ dur: 0.14, f0: 900, f1: 500, type: 'triangle', vol: 0.45 });
        N({ dur: 0.1, f0: 3500, f1: 1200, vol: 0.25 });
        break;
      case 'snake_cast': // conjuring hiss
        N({ dur: 0.55, f0: 6500, f1: 3000, q: 1.6, vol: 0.4, type: 'bandpass' });
        T({ dur: 0.3, f0: 300, f1: 140, type: 'sawtooth', vol: 0.18 });
        break;
      case 'snake_bite': // sharp strike + venom fizz
        T({ dur: 0.07, f0: 1500, f1: 300, type: 'square', vol: 0.4 });
        N({ dur: 0.22, f0: 5000, f1: 2200, q: 2, vol: 0.3, type: 'bandpass' });
        break;
      case 'crate_break': // splintering wood
        N({ dur: 0.16, f0: 2200, f1: 350, vol: 0.6 });
        T({ dur: 0.1, f0: 160, f1: 70, type: 'sine', vol: 0.4 });
        this._noise(out, t + 0.05, 0.12, { f0: 1400, f1: 300, vol: 0.3 });
        this._noise(out, t + 0.11, 0.09, { f0: 900, f1: 250, vol: 0.18 });
        break;
      case 'dragon_roar': { // layered growl sweep, heard across the map
        T({ dur: 1.5, f0: 110, f1: 48, type: 'sawtooth', vol: 0.55 });
        T({ dur: 1.3, f0: 175, f1: 70, type: 'square', vol: 0.22 });
        N({ dur: 1.4, f0: 520, f1: 130, q: 1.4, vol: 0.5, type: 'bandpass' });
        this._noise(out, t + 0.5, 0.9, { f0: 300, f1: 90, vol: 0.3 });
        break;
      }
      case 'dragon_fire': // sustained breath rush
        N({ dur: 1.5, f0: 2600, f1: 700, vol: 0.8 });
        T({ dur: 1.3, f0: 180, f1: 90, type: 'sawtooth', vol: 0.25 });
        this._noise(out, t + 0.3, 1.0, { f0: 3400, f1: 1200, q: 1.5, vol: 0.3, type: 'bandpass' });
        break;
      case 'bell': // a great bronze toll with long partials
        T({ dur: 2.4, f0: 520, f1: 516, type: 'sine', vol: 0.6 });
        T({ dur: 1.8, f0: 782, f1: 776, type: 'sine', vol: 0.3 });
        T({ dur: 1.2, f0: 1244, f1: 1236, type: 'sine', vol: 0.18 });
        N({ dur: 0.06, f0: 4000, f1: 1500, vol: 0.4 });
        break;
      case 'bat': // squeaky flutter
        T({ dur: 0.05, f0: 3900, f1: 2900, type: 'sine', vol: 0.16 });
        this._tone(out, t + 0.08, 0.05, { f0: 4300, f1: 3100, type: 'sine', vol: 0.12 });
        this._tone(out, t + 0.17, 0.04, { f0: 3600, f1: 2700, type: 'sine', vol: 0.1 });
        break;
      case 'ghost': // airy sigh
        N({ dur: 1.1, f0: 800, f1: 350, q: 1.2, vol: 0.12, type: 'bandpass' });
        T({ dur: 0.9, f0: 420, f1: 300, type: 'sine', vol: 0.05 });
        break;
      case 'owl': // two-note hoot
        T({ dur: 0.18, f0: 470, f1: 400, type: 'sine', vol: 0.3 });
        this._tone(out, t + 0.3, 0.3, { f0: 400, f1: 330, type: 'sine', vol: 0.32 });
        break;
      case 'snitch_catch': // golden sparkle arpeggio
        T({ dur: 0.1, f0: 1320, type: 'triangle', vol: 0.3 });
        this._tone(out, t + 0.09, 0.1, { f0: 1760, type: 'triangle', vol: 0.28 });
        this._tone(out, t + 0.18, 0.16, { f0: 2640, type: 'triangle', vol: 0.25 });
        this._noise(out, t + 0.02, 0.3, { f0: 6000, f1: 9000, vol: 0.1, type: 'highpass' });
        break;
      case 'dash': // a blink: airy whoosh with an arcane chime
        N({ dur: 0.18, f0: 700, f1: 2800, q: 1.2, vol: 0.3, type: 'bandpass' });
        T({ dur: 0.16, f0: 320, f1: 780, type: 'triangle', vol: 0.22 });
        break;
      case 'combo': // a crunch into a controlled enemy
        T({ dur: 0.1, f0: 1700, f1: 820, type: 'square', vol: 0.28 });
        N({ dur: 0.13, f0: 3200, f1: 700, vol: 0.32 });
        T({ dur: 0.07, f0: 240, f1: 90, type: 'sine', vol: 0.25 });
        break;
      default:
        break;
    }
    return null;
  }

  ui(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this._sweep(); // menus play UI sounds without the per-frame game sweep
    const t = this.ctx.currentTime + 0.001;
    const out = this._out(null, 0.8);
    const T = (o) => this._tone(out, t + (o.at || 0), o.dur, o);
    switch (name) {
      case 'click': T({ dur: 0.05, f0: 900, type: 'square', vol: 0.12 }); break;
      case 'hover': T({ dur: 0.03, f0: 1400, type: 'sine', vol: 0.06 }); break;
      case 'buy': T({ dur: 0.08, f0: 800, f1: 1200, type: 'triangle', vol: 0.25 }); T({ at: 0.07, dur: 0.12, f0: 1400, type: 'sine', vol: 0.2 }); break;
      case 'cash': T({ dur: 0.05, f0: 1320, f1: 1760, type: 'triangle', vol: 0.1 }); T({ at: 0.04, dur: 0.07, f0: 1980, type: 'sine', vol: 0.08 }); break;
      case 'deny': T({ dur: 0.15, f0: 220, f1: 160, type: 'square', vol: 0.2 }); break;
      case 'kill': T({ dur: 0.07, f0: 1000, type: 'square', vol: 0.15 }); T({ at: 0.06, dur: 0.09, f0: 1500, type: 'square', vol: 0.12 }); break;
      default: break;
    }
  }

  // Announcer stingers: short synth motifs.
  stinger(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime + 0.02;
    const out = this._out(null, 0.9);
    const seq = (notes, type = 'triangle', dur = 0.16, gap = 0.12, vol = 0.3) => {
      notes.forEach((f, i) => {
        if (f) this._tone(out, t0 + i * gap, dur, { f0: f, type, vol });
      });
    };
    switch (name) {
      case 'round_start': seq([392, 523, 659], 'triangle', 0.18, 0.13, 0.32); break;
      case 'planted': seq([196, 0, 196, 185], 'sawtooth', 0.3, 0.22, 0.3); break;
      case 'warning10': seq([880, 880, 880], 'square', 0.08, 0.16, 0.22); break;
      case 'win': seq([523, 659, 784, 1047], 'triangle', 0.2, 0.12, 0.34); break;
      case 'lose': seq([392, 330, 262, 196], 'triangle', 0.22, 0.14, 0.3); break;
      case 'mvp': seq([784, 988, 1175], 'sine', 0.14, 0.09, 0.25); break;
      case 'halftime': seq([440, 554, 440, 554], 'triangle', 0.16, 0.14, 0.26); break;
      case 'match_point': seq([659, 659, 784], 'square', 0.12, 0.14, 0.2); break;
      case 'victory': seq([523, 659, 784, 1047, 1319], 'triangle', 0.25, 0.13, 0.36); break;
      case 'defeat': seq([330, 294, 262, 220, 196], 'triangle', 0.26, 0.15, 0.3); break;
      case 'go': seq([659, 880], 'square', 0.1, 0.1, 0.25); break;
      case 'firstblood': seq([330, 392, 523], 'square', 0.1, 0.09, 0.22); break;
      case 'multikill': seq([523, 659, 880], 'square', 0.09, 0.08, 0.26); break;
      case 'ace': seq([659, 784, 1047, 1319], 'sawtooth', 0.14, 0.11, 0.28); break;
      default: break;
    }
  }

  ambient(theme) {
    this.stopAmbient();
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    // wind/room-tone bed, voiced per theme
    const FREQ = {
      aztec: 900, inferno: 500, dust: 650, mirage: 700, nuke: 460,
      castle: 420, night: 560, snow: 760, pitch: 820, sewer: 320,
    };
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = FREQ[theme] ?? 650;
    const g = ctx.createGain();
    g.gain.value = theme === 'sewer' || theme === 'castle' ? 0.024 : 0.018;
    const lfo = ctx.createOscillator(); lfo.frequency.value = theme === 'night' ? 0.07 : 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 250;
    lfo.connect(lfoG).connect(f.frequency);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    this.ambientNodes = [src, lfo, g];
    if (theme === 'aztec' || theme === 'pitch') {
      // sparse birdsong
      this.ambientTimer = setInterval(() => {
        if (Math.random() < (theme === 'pitch' ? 0.4 : 0.55) && this.ctx) {
          const t = this.ctx.currentTime;
          const out = this._out(null, 0.25);
          const f0 = rand(1800, 3600);
          this._tone(out, t, 0.09, { f0, f1: f0 * rand(1.1, 1.4), type: 'sine', vol: 0.12 });
          this._tone(out, t + 0.12, 0.07, { f0: f0 * 1.2, f1: f0, type: 'sine', vol: 0.08 });
        }
      }, 2600);
    } else if (theme === 'sewer' || theme === 'castle' || theme === 'night') {
      // echoing water drips in the dark
      this.ambientTimer = setInterval(() => {
        if (Math.random() < 0.5 && this.ctx) {
          const t = this.ctx.currentTime;
          const out = this._out(null, 0.2);
          const f0 = rand(900, 1600);
          this._tone(out, t, 0.05, { f0, f1: f0 * 0.6, type: 'sine', vol: 0.14 });
          this._tone(out, t + 0.07, 0.18, { f0: f0 * 0.5, f1: f0 * 0.3, type: 'sine', vol: 0.05 });
        }
      }, 3400);
    }
  }

  stopAmbient() {
    if (this.ambientTimer) { clearInterval(this.ambientTimer); this.ambientTimer = null; }
    if (this.ambientNodes) {
      for (const n of this.ambientNodes) { try { n.stop?.(); n.disconnect?.(); } catch { /* ok */ } }
      this.ambientNodes = null;
    }
  }
}
