import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';

function makeWorld() {
  const world = new World();
  world.addBox(-6, -1, -6, 6, 0, 6, 'floor');
  world.addBox(2, 0, -2, 3, 4, 2, 'wall-a');
  world.addBox(-4, 0, 3, -1, 2, 4, 'wall-b');
  world.addBox(-10, 0, -10, -8, 6, 10, 'long-wall');
  world.addBox(5, 1, 5, 9, 3, 9, 'raised');
  world.finalize();
  return world;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomWorld(seed) {
  const r = rng(seed);
  const world = new World();
  for (let i = 0; i < 80; i++) {
    const x = r() * 80 - 40;
    const z = r() * 80 - 40;
    const y = r() * 6 - 2;
    const sx = r() * 5 + 0.2;
    const sz = r() * 5 + 0.2;
    const sy = r() * 5 + 0.2;
    world.addBox(x, y, z, x + sx, y + sy, z + sz, `box-${i}`);
  }
  world.finalize();
  return { world, r };
}

function assertSameHit(actual, expected, label) {
  if (!expected) {
    assert.equal(actual, null, label);
    return;
  }
  assert.ok(actual, `${label}: expected hit`);
  assert.equal(actual.box, expected.box, `${label}: box`);
  assert.equal(actual.nx, expected.nx, `${label}: nx`);
  assert.equal(actual.ny, expected.ny, `${label}: ny`);
  assert.equal(actual.nz, expected.nz, `${label}: nz`);
  assert.ok(Math.abs(actual.t - expected.t) < 1e-9, `${label}: t ${actual.t} !== ${expected.t}`);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${label}: x`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${label}: y`);
  assert.ok(Math.abs(actual.z - expected.z) < 1e-9, `${label}: z`);
}

test('grid raycast matches brute force for representative rays', () => {
  const world = makeWorld();
  const rays = [
    [-12, 1, 0, 20, 0, 0, 1],
    [0, 5, 0, 0, -1, 0, 20],
    [0, 1, -8, 0, 0, 18, 1],
    [8, 2, 8, -20, -1, -20, 1],
    [-30, 3, 3.5, 50, 0, 0, 1],
    [6, 2, 6, 8, 0.2, 8, 1],
    [20, 8, 20, 1, 0, 0, 5],
  ];
  for (let i = 0; i < rays.length; i++) {
    const args = rays[i];
    assertSameHit(world.raycast(...args), world._raycastBrute(...args), `ray ${i}`);
  }
});

test('grid raycast matches brute force on seeded random worlds', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const { world, r } = randomWorld(seed);
    for (let i = 0; i < 300; i++) {
      const ox = r() * 100 - 50;
      const oy = r() * 20 - 6;
      const oz = r() * 100 - 50;
      const dx = r() * 80 - 40;
      const dy = r() * 18 - 9;
      const dz = r() * 80 - 40;
      const max = r() < 0.2 ? r() * 60 + 1 : 1;
      assertSameHit(
        world.raycast(ox, oy, oz, dx, dy, dz, max),
        world._raycastBrute(ox, oy, oz, dx, dy, dz, max),
        `seed ${seed} ray ${i}`,
      );
    }
  }
});
