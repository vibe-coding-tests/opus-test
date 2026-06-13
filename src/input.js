// Input: pointer lock mouse look, remappable keybinds, edge detection.

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'ControlLeft', walk: 'ShiftLeft', recharge: 'KeyR',
  dash: 'Mouse1', buy: 'KeyB', scoreboard: 'Tab', use: 'KeyE',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5',
  potion: 'KeyQ', broom: 'KeyC', cloak: 'KeyF', apparate: 'KeyG', finite: 'KeyX', portkey: 'KeyV',
  cast: 'Mouse0', altcast: 'Mouse2',
  commsWheel: 'KeyT', ping: 'KeyZ',
};

export const BIND_LABELS = {
  forward: 'Move Forward', back: 'Move Back', left: 'Strafe Left', right: 'Strafe Right',
  jump: 'Jump', crouch: 'Crouch', walk: 'Walk (silent)', recharge: 'Recharge Magic',
  dash: 'Blink Dash', buy: 'Buy Menu', scoreboard: 'Scoreboard', use: 'Use (Plant / Defuse / Loot)',
  slot1: 'Spell Slot 1', slot2: 'Spell Slot 2', slot3: 'Spell Slot 3', slot4: 'Spell Slot 4', slot5: 'Spell Slot 5',
  potion: 'Drink Potion', broom: 'Broomstick (fly)', cloak: 'Invisibility Cloak', apparate: 'Apparate',
  finite: 'Finite (Cleanse Self)', portkey: 'Emergency Portkey',
  cast: 'Cast Spell', altcast: 'Protego Shield',
  commsWheel: 'Command Wheel (hold)', ping: 'Ping (look + tap)',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  return code
    .replace('Key', '').replace('Digit', '')
    .replace('ControlLeft', 'L-Ctrl').replace('ControlRight', 'R-Ctrl')
    .replace('ShiftLeft', 'L-Shift').replace('ShiftRight', 'R-Shift')
    .replace('AltLeft', 'L-Alt').replace('AltRight', 'R-Alt')
    .replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→');
}

export class Input {
  constructor() {
    this.binds = { ...DEFAULT_BINDS };
    this.downCodes = new Set();
    this.edgeCodes = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    this.rebind = null; // {action, cb}
    this.enabled = true;
    this.lockEnabled = true;
    this.onLockChange = null;
    this.lockEl = null;
  }

  init(lockEl) {
    this.lockEl = lockEl;
    if (new URLSearchParams(window.location.search).has('auto')) {
      this.lockEnabled = false;
    }
    window.addEventListener('keydown', (e) => {
      if (this.rebind) {
        e.preventDefault();
        if (e.code !== 'Escape') this._applyRebind(e.code);
        else this._cancelRebind();
        return;
      }
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Control')) e.preventDefault();
      if (!e.repeat) {
        this.downCodes.add(e.code);
        this.edgeCodes.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.downCodes.delete(e.code));
    window.addEventListener('blur', () => this.downCodes.clear());
    window.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      if (this.rebind) { e.preventDefault(); this._applyRebind(code); return; }
      if (e.button === 1) e.preventDefault(); // middle-click: suppress autoscroll
      if (this.locked) {
        this.downCodes.add(code);
        this.edgeCodes.add(code);
      }
    });
    window.addEventListener('mouseup', (e) => this.downCodes.delete(`Mouse${e.button}`));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.dx += e.movementX || 0;
        this.dy += e.movementY || 0;
      }
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.lockEl;
      if (!this.locked) this.downCodes.clear();
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (new URLSearchParams(window.location.search).has('auto')) return;
    if (this.lockEnabled && !this.locked && this.lockEl) {
      const request = (opts, retryPlain = false) => {
        try {
          const p = opts ? this.lockEl.requestPointerLock(opts) : this.lockEl.requestPointerLock();
          if (p?.catch) {
            p.catch(() => {
              if (retryPlain) request();
            });
          }
        } catch {
          if (retryPlain) request();
        }
      };
      // Some browsers reject the options object, and automation can reject
      // pointer lock entirely because there was no user gesture.
      request({ unadjustedMovement: true }, true);
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  _applyRebind(code) {
    const { action, cb } = this.rebind;
    // unbind code from any other action
    for (const a of Object.keys(this.binds)) if (this.binds[a] === code && a !== action) this.binds[a] = null;
    this.binds[action] = code;
    this.rebind = null;
    cb?.(code);
  }

  _cancelRebind() {
    const cb = this.rebind?.cb;
    this.rebind = null;
    cb?.(null);
  }

  startRebind(action, cb) { this.rebind = { action, cb }; }

  down(action) {
    if (!this.enabled) return false;
    const c = this.binds[action];
    return !!c && this.downCodes.has(c);
  }

  pressed(action) {
    if (!this.enabled) return false;
    const c = this.binds[action];
    return !!c && this.edgeCodes.has(c);
  }

  consumeMouse() {
    const r = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = 0; this.dy = 0; this.wheel = 0;
    return r;
  }

  endFrame() {
    this.edgeCodes.clear();
    this.wheel = 0;
  }

  serialize() { return { ...this.binds }; }

  load(saved) {
    if (!saved) return;
    // migration: broom used to default to Shift, which is now Walk. If the
    // player never customized it, move them to the new defaults.
    if (saved.broom === 'ShiftLeft' && !saved.walk) delete saved.broom;
    this.binds = { ...DEFAULT_BINDS, ...saved };
    // one key, one action: on collision the binding the player saved wins
    const owner = new Map();
    for (const a of Object.keys(this.binds)) {
      const c = this.binds[a];
      if (!c) continue;
      if (!owner.has(c)) { owner.set(c, a); continue; }
      const other = owner.get(c);
      if (a in saved && !(other in saved)) { this.binds[other] = null; owner.set(c, a); }
      else this.binds[a] = null;
    }
  }

  reset() { this.binds = { ...DEFAULT_BINDS }; }
}
