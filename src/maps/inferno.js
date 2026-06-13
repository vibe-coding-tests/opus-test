// Inferno blockout: T spawn west, Banana to B (north), Mid + Apartments to A (east).
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('inferno', scene);
  M.bounds(-56, -50, 46, 50);

  const APY = 2.3; // apartments floor height
  M.layout([
    { x0: -52, z0: 20, x1: -30, z1: 44, wallH: 6 },    // T spawn
    { x0: -32, z0: 24, x1: 10, z1: 38 },               // main street
    { x0: -26, z0: -8, x1: -16, z1: 26 },              // banana (lower)
    { x0: -24, z0: -28, x1: -6, z1: -6 },              // banana (upper bend)
    { x0: -22, z0: -44, x1: 2, z1: -26 },              // B site
    { x0: -2, z0: -6, x1: 10, z1: 26 },                // mid ramp
    { x0: -4, z0: -14, x1: 12, z1: -4 },               // top mid
    { x0: 2, z0: -26, x1: 12, z1: -12 },               // arch to library
    { x0: -2, z0: -36, x1: 16, z1: -26 },              // library / CT-B link
    { x0: 12, z0: -12, x1: 22, z1: 2 },                // A short
    { x0: 18, z0: -18, x1: 40, z1: 4 },                // A site courtyard
    { x0: 14, z0: -42, x1: 34, z1: -26 },              // CT spawn
    { x0: 24, z0: -28, x1: 32, z1: -12 },              // CT → A path
    { x0: 8, z0: 22, x1: 16, z1: 36 },                 // apartments entry (stairs inside)
    { x0: 10, z0: 8, x1: 30, z1: 22, y: APY, roof: 5.6, mat: 'wall2' }, // apartments interior
    { x0: 26, z0: 0, x1: 38, z1: 10, y: APY },         // balcony (drop to A)
  ], { defWallH: 5.5 });

  // apartment stairs (entry → interior)
  M.stairs(13, 26, 5, '-z', 6, APY / 6, 0.7);
  // banana props: car + sandbags
  M.box(-21, 0, 8, 2.2, 1.4, 4.2, 'metal');
  M.box(-20, 0, -3, 4.5, 1.1, 1.2, 'trim');            // sandbags (shoot-over)
  // B site: coffins / new box
  M.box(-12, 0, -34, 2.6, 1.0, 2.6, 'crate');          // plant spot
  M.stack(-18, -38, 1.5);
  M.crate(-4, -40, 1.4);
  M.crate(-16, -28, 1.2);
  M.crate(0, -28, 1.3);
  // A site: triple boxes + plant
  M.box(28, 0, -8, 2.6, 1.0, 2.6, 'crate');
  M.stack(34, -14, 1.5);
  M.crate(22, -14, 1.4);
  M.crate(36, 0, 1.3);
  M.crate(20, 0, 1.2);
  // library cover
  M.crate(8, -30, 1.3);
  // street barrels
  M.crate(-12, 30, 1.3);
  M.crate(-28, 26, 1.2);
  M.crate(4, 34, 1.4);
  // explosive barrels: the famous banana pair, library, A corner
  M.barrel(-24, 12);
  M.barrel(-24.5, 16.5);
  M.barrel(12, -32);
  M.barrel(37, -17);

  M.site('A', 20, -16, 38, 2);
  M.site('B', -20, -42, 0, -28);
  M.spawns('death', -42, 32, -Math.PI / 2);  // T face east
  M.spawns('order', 24, -34, Math.PI / 2);   // CT face west
  M.dmSpawns([
    [-42, 32, -Math.PI / 2], [24, -34, Math.PI / 2], [-21, 12, Math.PI], [-12, -34, 0],
    [28, -8, Math.PI], [4, 10, 0], [18, 15, Math.PI / 2],
  ]);

  M.routes({
    attack: [
      { name: 'Banana', site: 'B', via: [[-21, 28], [-21, 2], [-16, -14], [-10, -32]] },
      { name: 'Mid', site: 'A', via: [[4, 28], [4, 2], [6, -8], [16, -6], [28, -6]] },
      { name: 'Apartments', site: 'A', via: [[12, 30], [13, 24], [20, 15], [32, 5], [30, -4]] },
      { name: 'Mid to B', site: 'B', via: [[4, 28], [4, -8], [7, -20], [2, -30], [-10, -32]] },
    ],
    holds: {
      A: [[28, -10], [22, 0], [34, -4], [28, -24]],
      B: [[-16, -30], [-2, -34], [-18, -41], [-12, -22]],
      mid: [[6, -22], [10, -10]],
    },
  });
  M.torch(13, APY + 2.4, 15, 0xffa040);
  M.torch(-10, 3.0, -33, 0xffa040);
  M.torch(7, 3.0, -21, 0xffa040);

  return M.finalize();
}
