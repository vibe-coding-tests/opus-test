// Dust blockout: T courtyard west, A north-east, B south-east. CT spawn sits in
// the east alley between A and the east hall (like de_dust) so defenders reach
// A in ~25m and B in ~40m, well before the attackers (~70-100m).
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('dust', scene);
  M.bounds(-50, -50, 52, 58);

  M.layout([
    { x0: -46, z0: 28, x1: -12, z1: 54, wallH: 6 },   // T spawn courtyard
    { x0: -14, z0: 14, x1: -2, z1: 34 },              // T exit connector
    { x0: -18, z0: -12, x1: 22, z1: 26 },             // mid courtyard
    { x0: -2, z0: -30, x1: 46, z1: -10 },             // north hall (underpass runs beneath bridge)
    { x0: 22, z0: -36, x1: 46, z1: -10 },             // A site yard
    { x0: -14, z0: -46, x1: 10, z1: -28 },            // underpass back room
    { x0: 18, z0: 6, x1: 46, z1: 30 },                // east hall
    { x0: 36, z0: -10, x1: 46, z1: 8 },               // CT spawn alley (A ↔ east hall)
    { x0: 24, z0: 26, x1: 48, z1: 52 },               // B site
    { x0: -14, z0: 40, x1: 30, z1: 54, roof: 3.6 },   // south tunnel T→B
  ], { defWallH: 5.5 });

  // CT bridge over the north hall
  M.box(8, 2.6, -22, 8, 0.4, 24, 'wall2');
  M.box(4.4, 3.0, -22, 0.3, 0.95, 24, 'trim');
  M.box(11.6, 3.0, -22, 0.3, 0.95, 24, 'trim');
  M.stairs(8, -3.3, 6, '-z', 7, 0.38, 0.95);          // mid side up
  M.stairs(8, -40.7, 6, '+z', 7, 0.38, 0.95);         // CT side up

  // big T exit arch
  M.box(-8, 3.4, 32, 10, 2.2, 1, 'wall2');
  // mid cover
  M.crate(-2, 6, 1.5);
  M.crate(-0.6, 6.4, 1.2, 1.5 * 1.25 - 0.3);
  M.crate(12, 18, 1.4);
  M.stack(-12, -4, 1.4);
  // A site
  M.box(34, 0, -22, 2.6, 1.0, 2.6, 'crate');          // plant box A
  M.stack(40, -30, 1.5);
  M.crate(26, -32, 1.4);
  M.crate(28, -14, 1.3);
  // underpass clutter
  M.crate(16, -26, 1.3);
  // east hall
  M.crate(40, 12, 1.4);
  M.crate(22, 24, 1.2);
  // B site
  M.box(36, 0, 40, 2.6, 1.0, 2.6, 'crate');           // plant box B
  M.stack(44, 46, 1.5);
  M.crate(28, 48, 1.4);
  M.crate(46, 32, 1.3);
  // south tunnel
  M.crate(-6, 46, 1.3);
  M.crate(18, 50, 1.4);
  // T spawn
  M.crate(-40, 34, 1.5);
  M.crate(-18, 48, 1.3);
  // explosive barrels: underpass, east hall, south tunnel, mid
  M.barrel(20, -28);
  M.barrel(44, 24);
  M.barrel(24, 45);
  M.barrel(-14.5, -1);

  M.site('A', 26, -32, 44, -14);
  M.site('B', 28, 30, 46, 50);
  M.spawns('death', -30, 42, -Math.PI / 2);  // T face east
  M.spawns('order', 41, -1, 0, 3.6);         // CT face north toward A
  M.dmSpawns([
    [-30, 42, -Math.PI / 2], [41, -1, Math.PI / 2], [0, 6, 0], [34, -22, Math.PI],
    [36, 40, 0], [-8, 18, -Math.PI / 2], [8, -22, Math.PI],
  ]);

  M.routes({
    attack: [
      { name: 'Underpass', site: 'A', via: [[-8, 24], [0, 8], [10, -16], [16, -22], [30, -22]] },
      { name: 'East alley', site: 'A', via: [[-4, 20], [24, 14], [41, 2], [38, -14]] },
      { name: 'South tunnel', site: 'B', via: [[-16, 46], [0, 47], [20, 47], [32, 44]] },
      { name: 'Mid to B', site: 'B', via: [[-8, 18], [12, 14], [30, 16], [34, 30]] },
    ],
    holds: {
      A: [[30, -24], [42, -14], [12, -20], [8, -27]],
      B: [[36, 38], [28, 32], [45, 47], [30, 24]],
      mid: [[6, -14], [-2, -18]],
    },
  });
  M.torch(8, 3.2, -33, 0xffa040);
  M.torch(-8, 3.0, 33, 0xffa040);

  return M.finalize();
}
