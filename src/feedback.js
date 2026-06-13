// Centralized game-feel ("juice") layer: trauma-based screen shake, camera kicks
// (landing dip, cast push, incoming-hit flinch), and bloom swells. Everything the
// player FEELS routes through here so it's tunable in one place and gated by the
// Feel settings (shake %, reduce motion, reduce flashing).
import * as THREE from 'three';
import { clamp } from './utils.js';

// Smooth, deterministic per-channel noise (summed sines) — reads as a hand-held
// camera, not the old white-noise vibration.
function snoise(seed, t) {
  return Math.sin(t * 27.3 + seed * 1.7) * 0.6 + Math.sin(t * 11.1 + seed * 5.3) * 0.4;
}

export class Feedback {
  constructor(game) {
    this.game = game;
    this.settings = game.settings;
    this.postfx = game.postfx || null;

    this.trauma = 0;          // 0..1, decays; shake amplitude is trauma^2
    this.kickPitch = 0;       // incoming-hit view flinch (visual only, decays)
    this.kickYaw = 0;
    this.lk = new THREE.Vector3(); // camera-local positional kick (spring → 0)
    this.lv = new THREE.Vector3();
    this.t = 0;               // noise clock (real time)
    this.off = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 };
  }

  get shakeScale() { return clamp(this.settings.shake ?? 1, 0, 1.5); }
  get motionScale() { return this.settings.reduceMotion ? 0.35 : 1; }
  get flashScale() { return this.settings.reduceFlash ? 0.3 : 1; }

  // --- inputs -------------------------------------------------------------
  // amount in ~0..1; bigger events shake harder (trauma is squared on read).
  addTrauma(amount) {
    this.trauma = clamp(this.trauma + amount * this.shakeScale, 0, 1);
  }

  // camera-local impulse (x=right, y=up, z=back); springs back to neutral.
  localImpulse(x, y, z) {
    const m = this.motionScale;
    this.lk.x += x * m; this.lk.y += y * m; this.lk.z += z * m;
  }

  land(speed) {
    this.localImpulse(0, -clamp(speed * 0.012, 0.03, 0.14), 0); // dip down, rebound
  }

  cast(spell) {
    const recoil = spell?.recoil ?? 0.015;
    this.localImpulse(0, recoil * 0.6, 0.02 + recoil * 1.2); // small push back + lift
    if (spell?.id === 'avada') this.bloomPulse(0.7);
    else if (spell?.kind === 'lob' || (spell?.dmg ?? 0) >= 60) this.bloomPulse(0.2);
  }

  // incoming hit: trauma + a brief view flinch. lateral>0 = hit from the right.
  hit(amount, lateral = 0) {
    this.addTrauma(clamp(amount / 55, 0.05, 0.55));
    const m = this.motionScale;
    this.kickPitch += clamp(amount / 420, 0.004, 0.05) * m;
    this.kickYaw += (-lateral * clamp(amount / 300, 0.004, 0.05) + (Math.random() - 0.5) * 0.006) * m;
  }

  bloomPulse(a) {
    this.postfx?.pulse?.(a * this.flashScale);
  }

  // --- per-frame (real, unscaled dt so shake stays crisp during slow-mo) ---
  update(realDt) {
    this.t += realDt;
    // trauma settles in ~0.85s
    this.trauma = Math.max(0, this.trauma - realDt / 0.85);
    // view-flinch springs back fast
    const rotDecay = Math.exp(-realDt * 10);
    this.kickPitch *= rotDecay;
    this.kickYaw *= rotDecay;
    // local positional kick: light underdamped spring → 0
    const k = 170, c = 22;
    this.lv.addScaledVector(this.lk, -k * realDt);
    this.lv.multiplyScalar(Math.max(0, 1 - c * realDt));
    this.lk.addScaledVector(this.lv, realDt);

    // bake the shake offset for this frame
    const tr = this.trauma * this.trauma;
    const o = this.off;
    if (tr > 0.0001) {
      const pos = tr * 0.11, roll = tr * 0.05, rot = tr * 0.03;
      o.x = snoise(1, this.t) * pos;
      o.y = snoise(2, this.t) * pos;
      o.z = snoise(3, this.t) * pos * 0.6;
      o.roll = snoise(4, this.t) * roll;
      o.pitch = snoise(5, this.t) * rot;
      o.yaw = snoise(6, this.t) * rot;
    } else {
      o.x = o.y = o.z = o.roll = o.pitch = o.yaw = 0;
    }
  }

  // Apply to the camera AFTER its base position/rotation are set this frame.
  applyToCamera(cam, alive) {
    const o = this.off;
    cam.position.x += o.x;
    cam.position.y += o.y;
    cam.position.z += o.z;
    cam.rotation.z += o.roll;
    cam.rotation.x += o.pitch + (alive ? this.kickPitch : 0);
    cam.rotation.y += o.yaw + (alive ? this.kickYaw : 0);
    if (alive && (this.lk.lengthSq() > 1e-7)) {
      cam.translateX(this.lk.x);
      cam.translateY(this.lk.y);
      cam.translateZ(this.lk.z);
    }
  }

  reset() {
    this.trauma = 0; this.kickPitch = 0; this.kickYaw = 0;
    this.lk.set(0, 0, 0); this.lv.set(0, 0, 0);
  }
}
