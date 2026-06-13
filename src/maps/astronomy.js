// The Astronomy Tower: a moonlit courtyard, the tower platform (site A) up two
// stair flights, cloister arcades down both flanks, and the walled garden (B).
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('night', scene);
  M.bounds(-40, -46, 40, 46);

  const TY = 3.6; // tower platform height
  M.layout([
    { x0: -36, z0: -40, x1: 36, z1: 40 },                         // courtyard
    { x0: -9, z0: -9, x1: 9, z1: 9, y: TY, mat: 'wall2' },        // tower platform (A)
    { x0: -36, z0: -36, x1: -26, z1: 36, roof: 3.4 },             // west cloister
    { x0: 26, z0: -36, x1: 36, z1: 36, roof: 3.4 },               // east cloister
    { x0: -8, z0: -46, x1: 8, z1: -40, roof: 4.5 },               // attacker gatehouse
    { x0: -8, z0: 40, x1: 8, z1: 46, roof: 4.5 },                 // defender gatehouse
  ], { defWallH: 6 });

  // tower stairs: north flight (defender-fast) and west flight (attacker route)
  M.stairs(0, 17, 7, '-z', 8, TY / 8, 1.0);
  M.stairs(-17, 0, 7, '+x', 8, TY / 8, 1.0);
  // platform parapet (low cover on the tower edges, stair gaps left open)
  M.wall(-9, -9, -9, 9, 0.9, { y: TY, t: 0.5, mat: 'trim' });
  M.wall(9, -9, 9, 9, 0.9, { y: TY, t: 0.5, mat: 'trim' });
  M.wall(-9, 9, -4, 9, 0.9, { y: TY, t: 0.5, mat: 'trim' });
  M.wall(4, 9, 9, 9, 0.9, { y: TY, t: 0.5, mat: 'trim' });
  M.wall(-9, -9, -4, -9, 0.9, { y: TY, t: 0.5, mat: 'trim' });
  M.wall(4, -9, 9, -9, 0.9, { y: TY, t: 0.5, mat: 'trim' });
  // telescopes on the platform
  M.decor('cylinder', -5, TY + 1.2, 5, { r: 0.16, h: 2.0, rz: 0.7, color: 0x8a7a4a });
  M.decor('cylinder', 5, TY + 1.2, -5, { r: 0.16, h: 2.0, rz: -0.7, color: 0x8a7a4a });
  // cloister arcade pillars
  for (const z of [-30, -22, -14, -6, 2, 10, 18, 26]) {
    M.pillar(-26, z, 1.1, 3.4);
    M.pillar(26, z, 1.1, 3.4);
  }
  // the walled garden (site B, defender half): hedge cover
  M.wall(10, 34, 30, 34, 1.5, { t: 0.7, mat: 'trim' });
  M.wall(10, 14, 22, 14, 1.5, { t: 0.7, mat: 'trim' });
  M.wall(10, 26, 10, 34, 1.5, { t: 0.7, mat: 'trim' });
  M.crate(16, 28, 1.3);
  M.crate(26, 20, 1.2);
  M.stack(22, 30, 1.3);
  // courtyard statues + clutter
  M.pillar(-16, -16, 1.4, 2.6);
  M.decor('cone', -16, 3.6, -16, { r: 0.8, h: 2.0, color: 0x5a6478 });
  M.pillar(16, 16, 1.4, 2.6);
  M.decor('cone', 16, 3.6, 16, { r: 0.8, h: 2.0, color: 0x5a6478 });
  M.crate(-18, 8, 1.3);
  M.crate(8, -24, 1.2);
  M.crate(-8, -26, 1.3);
  // star-oil barrels: west cloister, garden gate, courtyard
  M.barrel(-30, 30);
  M.barrel(13, 18);
  M.barrel(-11, -27);
  // the tower bell above the platform — ring it across the courtyard
  M.bell(0, TY + 4.4, 0);

  M.site('A', -7, -7, 7, 7);
  M.site('B', 12, 16, 28, 32);
  M.spawns('death', 0, -43, Math.PI);   // attackers face north into the courtyard
  M.spawns('order', 0, 43, 0);          // defenders face south
  M.dmSpawns([
    [0, -43, Math.PI], [0, 43, 0], [0, 0, Math.PI], [-14, 0, -Math.PI / 2],
    [14, -4, Math.PI / 2], [20, 24, Math.PI], [-31, -8, -Math.PI / 2], [31, 8, Math.PI / 2],
  ]);

  M.routes({
    attack: [
      { name: 'West Steps', site: 'A', via: [[-12, -28], [-18, -10], [-15, 0], [-4, 0]] },
      { name: 'Courtyard to Tower', site: 'A', via: [[0, -28], [0, -14], [12, 2], [0, 13], [0, 4]] },
      { name: 'East Cloister to B', site: 'B', via: [[31, -28], [31, -8], [31, 10], [24, 22]] },
      { name: 'Centre to Garden', site: 'B', via: [[0, -24], [14, -6], [16, 10], [18, 24]] },
    ],
    holds: {
      A: [[0, 0], [-6, 6], [6, -6], [-13, 6]],
      B: [[20, 22], [26, 30], [14, 18], [28, 16]],
      mid: [[-14, 0], [14, -4]],
    },
  });
  // cold blue brazier light
  M.torch(0, TY + 2.4, 0, 0x9fc4ff);     // tower beacon
  M.torch(-31, 2.6, -8, 0x9fc4ff);
  M.torch(31, 2.6, 8, 0x9fc4ff);
  M.torch(18, 1.8, 24, 0xffa040);        // garden lantern
  M.torch(0, 3.0, -42, 0xffa040);
  M.torch(0, 3.0, 42, 0xffa040);

  return M.finalize();
}
