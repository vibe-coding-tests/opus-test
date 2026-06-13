// The Chamber of Secrets: a vast serpent-pillared vault deep underground.
// Site A on the statue dais, site B in the east reliquary, a flooded channel
// down the west flank. Dark, green, and very indoor.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('sewer', scene);
  M.bounds(-40, -54, 40, 50);

  const DY = 1.2; // statue dais height
  M.layout([
    { x0: -16, z0: -20, x1: 16, z1: 28, roof: 7.5, wallH: 8 },     // the great chamber
    { x0: -10, z0: 18, x1: 10, z1: 28, y: DY, mat: 'wall2' },      // statue dais (A)
    { x0: -6, z0: -44, x1: 6, z1: -20, roof: 4 },                  // entrance tunnel
    { x0: -14, z0: -52, x1: 14, z1: -44, roof: 5 },                // attacker antechamber
    { x0: -30, z0: -28, x1: -16, z1: 20, y: -0.6, roof: 4.2, mat: 'trim' }, // west channel (flooded)
    { x0: 16, z0: -28, x1: 30, z1: 22, roof: 4.2 },                // east gallery
    { x0: 16, z0: 22, x1: 34, z1: 40, roof: 4.6 },                 // reliquary (B)
    { x0: -12, z0: 28, x1: 12, z1: 42, roof: 5 },                  // defender passage
  ], { defWallH: 6 });

  // dais steps (ascending north toward the statue)
  M.stairs(0, 15.4, 10, '+z', 3, DY / 3, 0.9, 0, 'wall2');
  // water in the west channel + stepping stones
  M.water(-29, -27, -17, 19, -0.15);
  for (const z of [-20, -10, 0, 10]) M.box(-23, -0.6, z, 1.6, 0.5, 1.6, 'metal');
  // serpent pillar rows in the great chamber
  for (const z of [-14, -4, 6, 16]) {
    M.pillar(-9, z, 1.5, 7.5, 0, 'wall2');
    M.pillar(9, z, 1.5, 7.5, 0, 'wall2');
    M.decor('cone', -9, 8.0, z, { r: 0.8, h: 1.4, color: 0x3e5a4c });
    M.decor('cone', 9, 8.0, z, { r: 0.8, h: 1.4, color: 0x3e5a4c });
  }
  // the statue mouth (behind A) + braziers
  M.box(0, DY, 26.6, 7, 4.2, 1.4, 'wall2');
  M.decor('cylinder', -5, DY + 0.7, 24, { r: 0.5, h: 1.0, color: 0x46584e });
  M.decor('cylinder', 5, DY + 0.7, 24, { r: 0.5, h: 1.0, color: 0x46584e });
  // reliquary props
  M.box(25, 0, 31, 2.6, 1.0, 2.6, 'crate');     // plant chest B
  M.stack(30, 36, 1.3);
  M.crate(19, 26, 1.2);
  M.crate(32, 26, 1.3);
  // gallery + tunnel clutter
  M.crate(22, -12, 1.3);
  M.crate(20, 8, 1.2);
  M.crate(-2, -32, 1.2);
  M.crate(4, -24, 1.3);
  // venom-still barrels: gallery, tunnel, reliquary
  M.barrel(20, -24);
  M.barrel(-4, -40);
  M.barrel(32.5, 38);
  // chamber floor: shed snake skin (decor)
  M.decor('cylinder', -4, 0.25, -8, { r: 0.5, h: 7, rz: Math.PI / 2, ry: 0.5, color: 0x6a7a5e });

  M.site('A', -8, 18, 8, 27);
  M.site('B', 18, 24, 32, 38);
  M.spawns('death', 0, -47, Math.PI);   // attackers face north up the tunnel
  M.spawns('order', 0, 35, 0);          // defenders face south
  M.dmSpawns([
    [0, -47, Math.PI], [0, 35, 0], [0, 2, 0], [-23, 0, Math.PI / 2],
    [22, 8, Math.PI], [25, 30, Math.PI], [0, 22, Math.PI],
  ]);

  M.routes({
    attack: [
      { name: 'Main Tunnel', site: 'A', via: [[0, -32], [0, -10], [0, 8], [0, 19]] },
      { name: 'Flooded Channel', site: 'A', via: [[-3, -26], [-22, -16], [-23, 0], [-22, 14], [-6, 14], [-4, 20]] },
      { name: 'East Gallery', site: 'B', via: [[3, -26], [22, -16], [22, 0], [23, 18], [25, 28]] },
      { name: 'Chamber Cross', site: 'B', via: [[0, -12], [8, 4], [13, 14], [20, 26]] },
    ],
    holds: {
      A: [[0, 22], [-7, 18], [7, 18], [0, 10]],
      B: [[25, 30], [30, 26], [19, 32], [27, 38]],
      mid: [[0, 2], [-11, 6]],
    },
  });
  // sickly green chamber light
  M.torch(-9, 5.4, -4, 0x66ff99);
  M.torch(9, 5.4, 6, 0x66ff99);
  M.torch(0, DY + 3.6, 26, 0x66ff99);    // statue glow
  M.torch(0, 2.8, -32, 0xffa040);        // tunnel lantern
  M.torch(25, 3.2, 30, 0x9fd8ff);        // reliquary
  M.torch(-23, 2.6, 0, 0x66ff99);        // channel glow

  M.npc('basilisk', {
    x: 0, z: 24, yaw: Math.PI, hp: 120,
    range: 30, gazeCd: 4.5, biteRange: 2.3,
  });

  return M.finalize();
}
