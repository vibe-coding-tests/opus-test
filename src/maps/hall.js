// The Great Hall: four long house tables down the nave, the head-table dais
// (site A) under an enchanted starry ceiling, arcaded side galleries, and the
// Entrance Hall at the south end.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('castle', scene);
  M.bounds(-30, -70, 30, 52);

  const DY = 1.0; // dais height
  M.layout([
    { x0: -11, z0: -34, x1: 11, z1: 30, roof: 9, wallH: 10, roofMat: 'roofsky' }, // the Great Hall
    { x0: -11, z0: 22, x1: 11, z1: 30, y: DY, mat: 'trim' },                      // head-table dais
    { x0: -22, z0: -30, x1: -11, z1: 20, roof: 4.5 },                             // west gallery
    { x0: 11, z0: -30, x1: 22, z1: 20, roof: 4.5 },                               // east gallery
    { x0: -14, z0: -52, x1: 14, z1: -34, roof: 6, wallH: 7 },                     // Entrance Hall
    { x0: -8, z0: -66, x1: 8, z1: -52, roof: 5 },                                 // attacker vestibule
    { x0: -8, z0: 30, x1: 8, z1: 44, y: DY, roof: 5, mat: 'trim' },               // trophy room (defender, dais level)
  ], { defWallH: 5.5 });

  // dais steps (ascending north toward the head table)
  M.stairs(0, 20, 12, '+z', 2, DY / 2, 1.0);
  // arcade pillars along the gallery seams (arches between them)
  for (const z of [-26, -18, -10, -2, 6, 14]) {
    M.pillar(-11, z, 1.1, 4.5);
    M.pillar(11, z, 1.1, 4.5);
  }
  // four long house tables (jump-on cover), segmented with crossing gaps
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    for (const z0 of [-28, -16, -4, 8]) {
      M.box(x, 0, z0 + 4.5, 1.5, 0.85, 9, 'crate');
    }
  }
  // lectern + head table on the dais
  M.box(0, DY, 27.5, 8, 0.9, 1.4, 'crate');     // head table
  M.box(0, DY, 25, 0.8, 1.1, 0.8, 'door');      // owl lectern
  // entrance hall props
  M.stack(-9, -44, 1.4);
  M.crate(8, -40, 1.4);
  M.crate(0, -48, 1.2);
  // gallery cover
  M.crate(-17, -8, 1.3);
  M.crate(17, 2, 1.3);
  M.crate(-17, 12, 1.2);
  // volatile potion barrels (entrance hall + west gallery)
  M.barrel(11.5, -38);
  M.barrel(-19.5, -22);
  // the dinner bell, hung where the nave meets the Entrance Hall
  M.bell(0, 6.5, -30);

  M.site('A', -7, 22, 7, 30);
  M.site('B', -22, 4, -12, 18);
  M.spawns('death', 0, -59, Math.PI);   // attackers face north up the nave
  M.spawns('order', 0, 37, 0);          // defenders face south
  M.dmSpawns([
    [0, -59, Math.PI], [0, 37, 0], [0, -20, 0], [0, 14, Math.PI],
    [-16, 10, Math.PI / 2], [16, -8, -Math.PI / 2], [0, -44, 0],
  ]);

  M.routes({
    attack: [
      { name: 'Centre Aisle', site: 'A', via: [[0, -44], [0, -20], [0, 0], [0, 18]] },
      { name: 'East Gallery', site: 'A', via: [[6, -40], [16, -24], [16, 0], [14, 16], [4, 24]] },
      { name: 'West Gallery', site: 'B', via: [[-6, -40], [-16, -26], [-16, -6], [-17, 10]] },
      { name: 'Table Flank', site: 'B', via: [[0, -44], [-5, -20], [-5, 2], [-14, 8]] },
    ],
    holds: {
      A: [[0, 26], [-8, 18], [8, 18], [0, 12]],
      B: [[-16, 14], [-13, 2], [-20, 8], [-14, 18]],
      mid: [[0, -2], [6, -12]],
    },
  });
  // floating-candle warmth down the nave
  M.torch(-9, 4.2, -20, 0xffc868);
  M.torch(9, 4.2, -12, 0xffc868);
  M.torch(-9, 4.2, 0, 0xffc868);
  M.torch(9, 4.2, 10, 0xffc868);
  M.torch(0, 3.4, 26, 0xffd890);     // dais candles
  M.torch(0, 3.6, -42, 0xffc868);    // entrance hall
  M.torch(-16, 3.0, 10, 0x9fd8ff);   // B alcove cold lamp
  M.torch(16, 3.0, -8, 0xffc868);

  return M.finalize();
}
