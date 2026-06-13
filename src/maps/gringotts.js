// Gringotts: the marble banking hall above, the rough-rock vaults below.
// Site A sits behind the teller counters (the floor-vault door); site B is the
// deep vault reached by the west stairs — or the cart tunnel the goblins use.
// The Ironbelly circles over the open courtyard out front.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('bank', scene);
  M.bounds(-46, -54, 40, 46);

  const VY = -3.2; // vault floor depth
  const W = [];    // west stair treads (down into the vault)
  for (let k = 1; k <= 10; k++) {
    W.push({ x0: -32, z0: -20 - k, x1: -24, z1: -19 - k, y: -0.32 * k, mat: 'trim', roof: 5 });
  }
  const E = [];    // east treads (the goblins' service stair by CT spawn)
  for (let k = 1; k <= 8; k++) {
    E.push({ x0: 22 - k, z0: -44, x1: 23 - k, z1: -36, y: -0.4 * k, mat: 'trim', roof: 4.5 });
  }

  M.layout([
    { x0: -16, z0: 26, x1: 16, z1: 40 },                                     // street courtyard (open sky)
    { x0: -14, z0: 16, x1: 14, z1: 26, roof: 8, wallH: 9, roofMat: 'wall' },  // the portico
    { x0: -22, z0: -18, x1: 22, z1: 16, roof: 9, wallH: 10, roofMat: 'wall' }, // the Great Marble Hall
    { x0: -22, z0: -28, x1: 26, z1: -18, roof: 5, roofMat: 'wall' },          // tellers' gallery (behind the counters)
    { x0: 22, z0: -28, x1: 32, z1: 10, roof: 4.4 },                          // east wing corridor (offices)
    { x0: 22, z0: -44, x1: 36, z1: -28, roof: 5 },                           // CT offices (defender spawn)
    { x0: -34, z0: -20, x1: -22, z1: -8, roof: 5 },                          // west stair landing
    ...W,
    { x0: -42, z0: -50, x1: -12, z1: -30, y: VY, roof: 5, wallH: 9, mat: 'wall2', roofMat: 'wall2' }, // the deep vault (B)
    { x0: -12, z0: -44, x1: 14, z1: -36, y: VY, roof: 4, mat: 'wall2', roofMat: 'wall2' },            // cart tunnel
    ...E,
  ], { defWallH: 6 });

  // portico columns
  for (const x of [-10, -3.5, 3.5, 10]) {
    M.pillar(x, 21, 1.1, 9, 0, 'trim');
  }
  // teller counters: two long islands with a center aisle and side gaps
  M.box(-11, 0, 0, 14, 1.1, 1.6, 'metal');
  M.box(11, 0, 0, 14, 1.1, 1.6, 'metal');
  M.box(-11, 0, -8, 14, 1.1, 1.6, 'metal');
  M.box(11, 0, -8, 14, 1.1, 1.6, 'metal');
  // hall columns flanking the aisle
  M.pillar(-7, 8, 1.2, 10, 0, 'trim');
  M.pillar(7, 8, 1.2, 10, 0, 'trim');
  // site A: the floor-vault door behind the west counters (kept off the site
  // center so the nav grid and plant pathing stay clean)
  M.box(-17, 0, -14, 3.2, 0.5, 3.2, 'trim');                 // the brass floor door (plant box)
  M.crate(-18, -14, 1.3);
  M.crate(-6, -15, 1.2);
  // gallery clutter: ledgers and strongboxes
  M.crate(4, -23, 1.2);
  M.crate(-14, -24, 1.2);
  M.stack(18, -24, 1.3);
  // courtyard cover
  M.stack(-9, 33, 1.4);
  M.crate(9, 31, 1.3);
  // east corridor crates
  M.crate(27, -8, 1.2);
  M.crate(27, 4, 1.3);
  // the vault: gold-bar pallets, strongboxes, the great round door
  M.box(-30, VY, -40, 2.6, 1.0, 2.6, 'trim');                // gold pallet (plant cover)
  M.stack(-36, -34, 1.4, VY);
  M.crate(-22, -46, 1.3, VY);
  M.crate(-16, -34, 1.2, VY);
  M.crate(-38, -46, 1.2, VY);
  M.crate(0, -42, 1.2, VY);                                  // tunnel crate
  M.decor('cylinder', -41.2, VY + 2.2, -40, { r: 2.2, h: 0.5, color: 0x8a8478, rz: Math.PI / 2 }); // the round vault door
  M.decor('ring', -40.8, VY + 2.2, -40, { r: 1.5, tube: 0.12, color: 0xc09a3e, ry: Math.PI / 2 });
  M.box(-41.2, VY, -40, 0.6, 4.4, 4.4, 'metal');            // the vault door is solid — no walking through it
  // cart rails down the tunnel (decor)
  for (let x = -10; x <= 12; x += 4) {
    M.decor('cylinder', x, VY + 0.06, -39, { r: 0.05, h: 3.6, color: 0x4a4640, rx: Math.PI / 2, ry: Math.PI / 2 });
  }
  M.decor('cylinder', 6, VY + 0.5, -40.5, { r0: 0.5, r1: 0.7, h: 0.9, color: 0x5a5048, collide: true });           // a parked cart

  // volatile vapors in iron drums — goblin security doesn't label things
  M.barrel(10, 34);
  M.barrel(18, 12);
  M.barrel(27, -24);
  M.barrel(-16, -46, VY);
  M.barrel(4, -42, VY);

  // the alarm bell over the hall aisle
  M.bell(0, 7.2, -3);

  M.site('A', -20, -16, -6, -4);
  M.site('B', -38, -48, -26, -32);
  M.spawns('death', 0, 37, 0);              // attackers outside the front doors
  M.spawns('order', 27, -33, Math.PI);      // goblin-office side, facing the hall

  M.routes({
    attack: [
      { name: 'Front Doors', site: 'A', via: [[0, 30], [0, 20], [0, 6], [-8, -2], [-13, -8]] },
      { name: 'East Offices', site: 'A', via: [[6, 30], [10, 20], [18, 10], [27, 2], [27, -14], [8, -23], [-8, -20], [-13, -10]] },
      { name: 'West Stairs', site: 'B', via: [[-4, 30], [-8, 18], [-16, 0], [-26, -12], [-28, -24], [-28, -32], [-32, -40]] },
      { name: 'Cart Tunnel', site: 'B', via: [[0, 30], [-6, 18], [-18, -2], [-27, -14], [-28, -26], [-20, -34], [-10, -40], [-22, -42], [-32, -42]] },
    ],
    holds: {
      A: [[-14, -10], [-8, -14], [-18, -6], [-11, -22]],
      B: [[-32, -38], [-26, -34], [-36, -44], [-28, -46]],
      mid: [[0, 0], [27, -6]],
    },
  });

  // chandeliers down the hall, lamps below
  M.torch(0, 7.0, 8, 0xffd080);
  M.torch(0, 7.0, -8, 0xffd080);
  M.torch(-14, 4.2, 4, 0xffd080);     // wall sconces over the counters
  M.torch(14, 4.2, 4, 0xffd080);
  M.torch(0, 6.4, 21, 0xffd080);      // portico lantern
  M.torch(-12, 3.6, -23, 0xffd080);   // gallery lamp
  M.torch(27, 3.2, -2, 0xffc060);     // east corridor
  M.torch(-28, 3.6, -14, 0xffc060);   // stair landing
  M.torch(-30, VY + 3.4, -40, 0x9fc4ff); // vault: cold goblin-light
  M.torch(0, VY + 3.0, -40, 0x9fc4ff);   // tunnel
  M.torch(29, 3.6, -36, 0xffd080);    // offices

  return M.finalize();
}
