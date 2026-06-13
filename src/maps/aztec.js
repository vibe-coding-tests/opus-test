// Aztec blockout: elevated T spawn south, main yard, rope bridge over the water
// ditch to B (west), A courtyard north-east. Ladders out of the water.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('aztec', scene);
  M.bounds(-58, -52, 44, 56);

  M.layout([
    { x0: -12, z0: 34, x1: 14, z1: 52, y: 2.4, wallH: 6, mat: 'wall2' }, // T spawn plateau
    { x0: -20, z0: -2, x1: 20, z1: 34 },               // main yard
    { x0: 14, z0: -26, x1: 38, z1: 2 },                // A approach + site
    { x0: -12, z0: -48, x1: 8, z1: -30 },              // CT spawn
    { x0: -8, z0: -34, x1: 20, z1: -18 },              // CT ↔ A corridor
    { x0: -38, z0: -14, x1: -20, z1: 32, y: -2, mat: 'trim' }, // water ditch (lowered)
    { x0: -54, z0: -20, x1: -38, z1: 12 },             // B side yard
    { x0: -54, z0: -34, x1: -6, z1: -14 },             // north ground (B ↔ CT link)
  ], { defWallH: 5.5 });

  // T spawn stairs down to yard
  M.stairs(1, 28.3, 8, '+z', 6, 0.4, 0.95);
  // double doors: yard → A passage (band x 14..20, z -2..2)
  M.wall(17, -2, 17, -1.3, 5, { mat: 'door' });
  M.box(17, 0, 0, 0.8, 5, 0.9, 'door');
  M.wall(17, 1.3, 17, 2, 5, { mat: 'door' });
  M.box(17, 3.6, 0, 0.9, 1.4, 4.4, 'trim');
  // rope bridge across the ditch (solid beam + plank tops + rails)
  M.box(-29, 0.1, 8.5, 18.6, 0.3, 3.4, 'door');
  for (let x = -37.5; x <= -21; x += 1.15) M.box(x, 0.4, 8.5, 0.95, 0.1, 3.2, 'crate');
  M.box(-29, 0.5, 6.95, 18.6, 0.85, 0.16, 'door');
  M.box(-29, 0.5, 10.05, 18.6, 0.85, 0.16, 'door');
  // water + ladders out of the ditch
  M.water(-38, -14, -20, 32, -1.1);
  M.ladder(-20.4, 24, -2, 0, '-x');
  M.ladder(-37.6, -8, -2, 0, '+x');
  // yard cover
  M.stack(-6, 12, 1.5);
  M.crate(8, 20, 1.4);
  M.crate(-14, 2, 1.3);
  // A site
  M.box(28, 0, -14, 2.6, 1.0, 2.6, 'crate');           // plant spot
  M.stack(34, -20, 1.5);
  M.crate(22, -22, 1.4);
  M.crate(36, -4, 1.3);
  M.box(26, 0, -24, 3.2, 1.6, 1.4, 'trim');            // stone block
  // B site
  M.box(-46, 0, -4, 2.6, 1.0, 2.6, 'crate');           // plant spot
  M.stack(-50, -12, 1.5);
  M.crate(-42, 6, 1.4);
  M.box(-50, 0, 4, 3.4, 1.7, 1.5, 'trim');             // stone block
  // north ground cover
  M.crate(-26, -24, 1.4);
  M.crate(-40, -18, 1.3);
  // CT spawn crates
  M.crate(-8, -42, 1.3);
  M.crate(4, -36, 1.2);
  // explosive barrels: yard, B side, CT corridor
  M.barrel(11, 23);
  M.barrel(-47, 8);
  M.barrel(16, -31);

  M.site('A', 22, -22, 36, -6);
  M.site('B', -52, -16, -40, 8);
  M.spawns('death', 1, 44, 0);          // T face north
  M.spawns('order', -2, -40, Math.PI);  // CT face south
  M.dmSpawns([
    [1, 44, 0], [-2, -40, Math.PI], [0, 16, Math.PI], [28, -14, Math.PI / 2],
    [-46, -4, -Math.PI / 2], [-29, 8.5, -Math.PI / 2], [-30, -24, 0],
  ]);

  M.routes({
    attack: [
      { name: 'Main doors', site: 'A', via: [[0, 20], [12, 4], [17, 0], [26, -12]] },
      { name: 'Rope bridge', site: 'B', via: [[-10, 18], [-19, 8.5], [-29, 8.5], [-41, 4], [-46, -4]] },
      { name: 'Water ditch', site: 'B', via: [[-12, 22], [-26, 22], [-30, 0], [-36, -8], [-46, -8]] },
      { name: 'Yard to A', site: 'A', via: [[4, 10], [16, -4], [28, -10], [28, -16]] },
    ],
    holds: {
      A: [[28, -10], [24, -20], [34, -18], [4, -26]],
      B: [[-46, 0], [-50, -12], [-40, -14], [-32, 6]],
      mid: [[-2, -24], [6, -28]],
    },
  });
  M.torch(17, 3.2, 1, 0xffc060);
  M.torch(-46, 3.0, -2, 0xffc060);
  M.torch(28, 3.0, -13, 0xffc060);

  return M.finalize();
}
