// Hogsmeade: a snowed-in high street between timber shopfronts. Site A is the
// taproom of the Three Broomsticks; site B is the Shrieking Shack yard. Back
// alleys behind the shops flank both sites.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('snow', scene);
  M.bounds(-46, -58, 46, 58);

  M.layout([
    { x0: -10, z0: -48, x1: 10, z1: 48 },                          // the high street
    { x0: -18, z0: -56, x1: 18, z1: -46 },                         // attacker square (south gate)
    { x0: -18, z0: 46, x1: 18, z1: 56 },                           // defender square (north gate)
    { x0: -26, z0: -28, x1: -10, z1: -8, roof: 4.2 },              // Honeydukes
    { x0: -28, z0: 4, x1: -10, z1: 30, roof: 4.6 },                // the Three Broomsticks (A)
    { x0: 10, z0: -30, x1: 24, z1: -10, roof: 4.2 },               // Zonko's
    { x0: 10, z0: 8, x1: 26, z1: 26, roof: 4.2 },                  // the Post Office
    { x0: -34, z0: -34, x1: -26, z1: 36, },                        // west back alley
    { x0: 24, z0: -34, x1: 32, z1: 32 },                           // east back alley
    { x0: 26, z0: 28, x1: 42, z1: 44 },                            // Shrieking Shack yard (B)
  ], { defWallH: 5.5 });

  // shop door stubs onto the street (narrow the wide-open seams)
  M.wall(-10, -28, -10, -22, 5.5, { mat: 'wall' });     // Honeydukes wall + door gap
  M.wall(-10, -16, -10, -8, 5.5, { mat: 'wall' });
  M.wall(-10, 4, -10, 12, 5.5, { mat: 'wall' });        // Broomsticks
  M.wall(-10, 20, -10, 30, 5.5, { mat: 'wall' });
  M.wall(10, -30, 10, -24, 5.5, { mat: 'wall' });       // Zonko's
  M.wall(10, -18, 10, -10, 5.5, { mat: 'wall' });
  M.wall(10, 8, 10, 14, 5.5, { mat: 'wall' });          // Post Office
  M.wall(10, 22, 10, 26, 5.5, { mat: 'wall' });
  // Three Broomsticks taproom: the bar + tables
  M.box(-22, 0, 16, 1.6, 1.0, 9, 'crate');              // the bar
  M.crate(-14, 10, 1.2);
  M.crate(-16, 24, 1.2);
  M.decor('cylinder', -22, 1.4, 12, { r: 0.45, h: 0.8, color: 0x7a5a30, collide: true }); // butterbeer barrel
  // shop clutter
  M.crate(-18, -18, 1.3);
  M.crate(16, -22, 1.3);
  M.crate(18, 18, 1.2);
  // street props: sleigh, barrels, market stalls
  M.box(0, 0, -14, 2.2, 1.2, 4.6, 'metal');             // the sleigh
  M.stack(-6, 6, 1.3);
  M.crate(6, 24, 1.3);
  M.crate(-5, 38, 1.2);
  M.crate(5, -34, 1.3);
  // shack yard cover
  M.stack(34, 38, 1.4);
  M.crate(30, 32, 1.3);
  M.box(38, 0, 34, 2.6, 1.0, 2.6, 'crate');             // plant crate B
  // firewhisky barrels: taproom, Zonko's, both alleys
  M.barrel(-25, 22);
  M.barrel(13.5, -27);
  M.barrel(28.5, -28);
  M.barrel(-30.5, 30);
  // the village bell over the high street
  M.bell(0, 5.0, 2);
  // snow-laden firs along the lanes (decor only)
  for (const [x, z] of [[-30, -32], [-31, 34], [28, -32], [13, 40], [-13, -40], [29, 6]]) {
    M.decor('cylinder', x, 0.8, z, { r: 0.3, h: 1.6, color: 0x4a3a26, collide: true }); // solid trunk
    M.decor('cone', x, 2.6, z, { r: 1.3, h: 2.6, color: 0x2e4a3a });
    M.decor('cone', x, 3.8, z, { r: 0.9, h: 1.8, color: 0x3a5a46 });
  }
  // lamp posts down the street (warm gaslight)
  for (const [x, z] of [[-8, -24], [8, -2], [-8, 20], [8, 40]]) {
    M.decor('cylinder', x, 1.5, z, { r: 0.09, h: 3.0, color: 0x2a2c30 });
    M.torch(x, 3.2, z, 0xffc060);
  }

  M.site('A', -26, 6, -12, 28);
  M.site('B', 28, 30, 40, 42);
  M.spawns('death', 0, -51, Math.PI);   // attackers face north up the street
  M.spawns('order', 0, 51, 0);          // defenders face south

  M.routes({
    attack: [
      { name: 'High Street', site: 'A', via: [[0, -30], [0, -2], [0, 16], [-14, 16]] },
      { name: 'West Alley', site: 'A', via: [[-14, -40], [-30, -20], [-30, 0], [-30, 20], [-20, 26]] },
      { name: 'East Alley', site: 'B', via: [[12, -40], [28, -20], [28, 8], [28, 24], [34, 34]] },
      { name: 'Post Office', site: 'B', via: [[0, -20], [0, 10], [18, 16], [25, 24], [34, 36]] },
    ],
    holds: {
      A: [[-18, 12], [-14, 24], [-22, 8], [-13, 18]],
      B: [[34, 36], [30, 40], [38, 32], [28, 36]],
      mid: [[0, 0], [-4, 20]],
    },
  });
  M.torch(-20, 3.0, 16, 0xffa040);   // taproom hearth
  M.torch(16, 2.8, -16, 0xffa040);   // Zonko's
  M.torch(18, 2.8, 16, 0xffa040);    // post office
  M.torch(34, 2.2, 36, 0x9fc4ff);    // shack yard cold lamp

  return M.finalize();
}
