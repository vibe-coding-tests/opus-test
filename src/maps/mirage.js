// Mirage blockout: T spawn west, A site south-east via Palace/Ramp, B site
// north-east via Apartments, contested Mid with the Window room.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('mirage', scene);
  M.bounds(-58, -50, 52, 44);

  M.layout([
    // T side
    { x0: -56, z0: -10, x1: -36, z1: 12, wallH: 6 },           // T spawn
    { x0: -38, z0: -28, x1: -26, z1: -8 },                     // T ramp approach
    { x0: -26, z0: -36, x1: -8, z1: -22, roof: 4.6 },          // Palace (roofed)
    { x0: -8, z0: -34, x1: 0, z1: -24 },                       // palace exit yard
    // A
    { x0: 0, z0: -44, x1: 28, z1: -18 },                       // A site
    { x0: 28, z0: -26, x1: 40, z1: -8 },                       // ticket booth / CT-to-A
    // mid
    { x0: -36, z0: -4, x1: -16, z1: 6 },                       // top mid (from T)
    { x0: -16, z0: -12, x1: 2, z1: 10 },                       // mid
    { x0: 2, z0: -20, x1: 12, z1: -4 },                        // connector (jungle)
    { x0: 2, z0: -2, x1: 14, z1: 8, roof: 4.2 },               // window room (roofed)
    { x0: 14, z0: -2, x1: 26, z1: 6 },                         // CT link
    // B
    { x0: -36, z0: 8, x1: -24, z1: 22 },                       // T apts approach
    { x0: -24, z0: 14, x1: 2, z1: 30, roof: 4.4 },             // apartments (roofed)
    { x0: -8, z0: 10, x1: 2, z1: 22 },                         // B short (under apts edge)
    { x0: 2, z0: 18, x1: 8, z1: 28 },                          // apts exit balcony
    { x0: 8, z0: 14, x1: 32, z1: 36 },                         // B site
    { x0: 32, z0: 8, x1: 42, z1: 20 },                         // CT-to-B
    // CT
    { x0: 26, z0: -8, x1: 48, z1: 14, wallH: 6 },              // CT spawn
  ], { defWallH: 5.5 });

  // palace exit arch
  M.wall(-8, -36, -8, -31, 5.5, { mat: 'door' });
  M.wall(-8, -27, -8, -22, 5.5, { mat: 'door' });
  M.box(-8, 3.2, -29, 0.9, 2.3, 4.4, 'wall2');
  // apartments exit arch
  M.wall(2, 14, 2, 19, 5.5, { mat: 'door' });
  M.wall(2, 25, 2, 30, 5.5, { mat: 'door' });
  M.box(2, 3.2, 22, 0.9, 2.4, 6.4, 'wall2');
  // mid → connector arch stubs
  M.wall(2, -14, 2, -10, 5.5, { mat: 'wall2' });

  // A site props
  M.box(14, 0, -32, 2.6, 1.0, 2.6, 'crate');     // plant box (firebox)
  M.stack(22, -38, 1.5);                          // triple-ish stack
  M.crate(6, -38, 1.4);
  M.crate(24, -22, 1.3);
  M.crate(2, -28, 1.2);                           // palace exit cover
  M.box(33, 0, -16, 2.2, 1.5, 4.2, 'metal');      // ticket van
  // mid props
  M.crate(-7, -2, 1.5);
  M.crate(-12, 4, 1.2);
  M.box(8, 0, 3, 1.8, 1.1, 1.8, 'crate');         // window room box
  // B site props
  M.box(20, 0, 26, 2.6, 1.0, 2.6, 'crate');       // plant box
  M.box(26, 0, 32, 4.4, 1.9, 2.0, 'metal');       // the B van
  M.stack(12, 18, 1.4);
  M.crate(30, 18, 1.3);
  M.crate(-4, 18, 1.2);                            // B short cover
  // apartments furniture
  M.crate(-18, 22, 1.3);
  M.crate(-8, 26, 1.1);
  // T side
  M.crate(-30, -14, 1.3);
  M.crate(-44, 6, 1.4);
  // explosive barrels: palace exit, connector, B van corner, apartments
  M.barrel(-5.5, -32);
  M.barrel(10, -8);
  M.barrel(31, 34.5);
  M.barrel(-21, 26);

  M.site('A', 4, -40, 24, -22);
  M.site('B', 12, 16, 30, 34);
  M.spawns('death', -46, 1, -Math.PI / 2);        // T face east
  M.spawns('order', 38, 3, Math.PI / 2);          // CT face west
  M.dmSpawns([
    [-46, 1, -Math.PI / 2], [38, 3, Math.PI / 2], [12, -32, Math.PI], [20, 26, 0],
    [-8, 0, -Math.PI / 2], [-18, 22, 0], [34, -16, Math.PI / 2],
  ]);

  M.routes({
    attack: [
      { name: 'A Ramp', site: 'A', via: [[-32, -16], [-18, -28], [-4, -29], [10, -30]] },
      { name: 'Mid to A', site: 'A', via: [[-26, 1], [-8, 0], [7, -10], [7, -18], [14, -26]] },
      { name: 'Apartments', site: 'B', via: [[-30, 14], [-12, 22], [5, 23], [16, 24]] },
      { name: 'B Short', site: 'B', via: [[-26, 1], [-8, 2], [-3, 14], [4, 22], [18, 26]] },
      { name: 'Mid Window', site: 'B', via: [[-26, 1], [-6, 0], [8, 2], [20, 2], [36, 12], [24, 22]] },
    ],
    holds: {
      A: [[8, -36], [22, -24], [4, -24], [24, -40]],
      B: [[14, 32], [28, 18], [12, 20], [30, 32]],
      mid: [[8, 2], [-2, -8]],
    },
  });
  M.torch(-17, 3.2, -29, 0xffa040);   // palace interior
  M.torch(-12, 3.2, 22, 0xffa040);    // apartments
  M.torch(8, 3.0, 3, 0xffa040);       // window room
  M.torch(-8, 2.6, -29, 0xffc060);    // palace arch

  return M.finalize();
}
