// Dust II blockout: T spawn south, CT north, Long A east, Mid center, B Tunnels west.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('dust', scene);
  M.bounds(-54, -60, 48, 80);

  const AY = 2.2; // A site / catwalk plateau height
  M.layout([
    // T side
    { x0: -17, z0: 52, x1: 17, z1: 77, wallH: 6 },             // T spawn
    { x0: -6, z0: 14, x1: 8, z1: 54 },                         // top mid / T ramp
    { x0: 14, z0: 38, x1: 31, z1: 54 },                        // outside long path
    { x0: 15, z0: 24, x1: 33, z1: 38 },                        // long doors yard
    { x0: 17, z0: -16, x1: 35, z1: 24 },                       // long A corridor
    { x0: 33, z0: -2, x1: 45, z1: 16 },                        // pit / long corner
    { x0: 17, z0: -16, x1: 45, z1: -2 },                       // A long base by ramp
    // A site plateau + catwalk (short)
    { x0: 10, z0: -42, x1: 41, z1: -14, y: AY },               // A site plateau
    { x0: 1, z0: -32, x1: 10, z1: -4, y: AY },                 // catwalk
    { x0: 1, z0: -4, x1: 10, z1: 2 },                          // short stairs base
    // mid
    { x0: -6, z0: -12, x1: 8, z1: 14 },                        // mid
    { x0: -8, z0: -36, x1: 8, z1: -12 },                       // CT mid
    { x0: -31, z0: -31, x1: -8, z1: -21 },                     // B doors corridor
    // CT
    { x0: -15, z0: -58, x1: 15, z1: -36 },                     // CT spawn
    { x0: 13, z0: -50, x1: 27, z1: -36 },                      // CT → A ramp base
    // B
    { x0: -36, z0: 38, x1: -15, z1: 60, roof: 4.4 },           // upper tunnels (from T)
    { x0: -36, z0: 0, x1: -26, z1: 40, roof: 4.2 },            // tunnel corridor
    { x0: -26, z0: 16, x1: -6, z1: 21, roof: 3.6 },            // lower tunnels (mid ↔ tunnels link)
    { x0: -52, z0: -40, x1: -22, z1: 0 },                      // B site yard
  ], { defWallH: 5.5 });

  // --- stairs / ramps (each ends flush with its plateau edge) ---
  M.stairs(26, -7.4, 10, '-z', 6, AY / 6, 1.1);     // long → A ramp
  M.stairs(5.5, 2, 7, '-z', 6, AY / 6, 1.05);       // mid → catwalk stairs
  M.stairs(20, -48.6, 9, '+z', 6, AY / 6, 1.1);     // CT → A ramp
  M.stairs(-4.4, -16, 5, '+x', 6, AY / 6, 0.9);     // CT mid → catwalk stairs

  // A site props (on plateau)
  M.crate(14, -38, 1.3, AY);
  M.stack(30, -34, 1.5, AY);                        // triple-stack corner
  M.crate(33, -22, 1.5, AY);
  M.crate(20, -19, 1.2, AY);
  M.box(24, AY, -28, 2.6, 1.0, 2.6, 'crate');       // default plant box A
  M.crate(12.5, -39.2, 1.25, AY);                   // "goose" corner box

  // car at long corner + pit cover
  M.box(39, 0, 12, 4.4, 1.5, 2.2, 'metal');
  M.crate(42, 4, 1.4);
  // mid: xbox + top mid crates
  M.crate(1, 11, 1.6);
  M.crate(-4.2, 16.5, 1.3);
  // mid doors: stubs leaving a gap + lintel (in the ground strip x<1)
  M.wall(-6, -12, -3.5, -12, 5.5, { mat: 'door' });
  M.wall(0.5, -12, 8, -12, 5.5, { mat: 'door' });
  M.box(-1.5, 3.2, -12, 4.4, 2.3, 0.8, 'wall2');
  // long doors: stubs + lintel
  M.wall(15, 24, 22, 24, 5.5, { mat: 'door' });
  M.wall(26.5, 24, 33, 24, 5.5, { mat: 'door' });
  M.box(24.25, 3.4, 24, 5.2, 2.1, 0.9, 'wall2');
  // B doors stubs (between corridor and B yard)
  M.wall(-22, -31, -22, -27.5, 5.5, { mat: 'door' });
  M.wall(-22, -23, -22, -21, 5.5, { mat: 'door' });
  // B site props
  M.stack(-42, -26, 1.5);
  M.crate(-34, -32, 1.4);
  M.crate(-32.6, -32.4, 1.2, 1.4);
  M.crate(-26, -6, 1.3);
  M.box(-38, 0, -14, 2.6, 1.0, 2.6, 'crate');       // plant box B
  M.box(-48, 0, -20, 2.2, 1.4, 4.4, 'metal');       // the B car
  M.crate(-30, 14, 1.4);                            // tunnel exit cover
  // tunnels + T spawn props
  M.crate(-31, 30, 1.3);
  M.crate(-20, 47, 1.4);
  M.crate(-10, 60, 1.5);
  M.crate(12, 64, 1.4);
  M.crate(-12, 18.5, 1.2);                          // lower tunnels barrel
  // explosive barrels: long doors, tunnels, catwalk, B yard
  M.barrel(31.5, 27);
  M.barrel(-33.8, 34);
  M.barrel(8.7, -7, AY);
  M.barrel(-44, -32);

  M.site('A', 15, -36, 36, -18);
  M.site('B', -48, -30, -28, -8);
  M.spawns('death', 0, 68, 0);          // attackers (T) face north
  M.spawns('order', 0, -48, Math.PI);   // defenders (CT) face south
  M.dmSpawns([
    [0, 68, 0], [0, -48, Math.PI], [24, 46, -Math.PI / 2], [24, -28, Math.PI],
    [-36, -14, Math.PI / 2], [-31, 28, 0], [2, 8, Math.PI],
  ]);

  M.routes({
    attack: [
      { name: 'Long A', site: 'A', via: [[24, 46], [24, 30], [26, 6], [26, -5], [30, -22]] },
      { name: 'Catwalk', site: 'A', via: [[1, 32], [2, 10], [5.5, -1], [6, -20], [16, -26]] },
      { name: 'Tunnels', site: 'B', via: [[-25, 50], [-31, 28], [-31, 6], [-36, -14]] },
      { name: 'Lower Tunnels', site: 'B', via: [[1, 32], [-2, 18.5], [-16, 18.5], [-31, 14], [-31, 4], [-36, -14]] },
      { name: 'Mid to B', site: 'B', via: [[1, 26], [-2, 0], [-3, -24], [-16, -26], [-30, -18]] },
    ],
    holds: {
      A: [[20, -32], [33, -25], [12, -19], [23, -40]],
      B: [[-43, -25], [-27, -9], [-26, -28], [-36, -3]],
      mid: [[-3, -28], [-5, -33]],
    },
  });
  M.torch(-1.5, 3.0, -13, 0xffa040);
  M.torch(24, 3.0, 23, 0xffa040);

  return M.finalize();
}
