// Nuke blockout: outdoor yard, indoor A silo hall (tall roof), sunken B bunker
// reached by the ramp or a vent drop, outside route along the north fence.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('nuke', scene);
  M.bounds(-58, -34, 56, 40);

  const BY = -3.4; // B bunker floor depth
  M.layout([
    { x0: -56, z0: -8, x1: -38, z1: 14, wallH: 6 },              // T spawn
    { x0: -38, z0: -20, x1: -4, z1: 24 },                        // the yard (outdoor)
    { x0: -12, z0: -30, x1: 8, z1: -20 },                        // yard south → ramp approach
    { x0: -4, z0: -8, x1: 10, z1: 10, roof: 4.6 },               // lobby (radio room)
    { x0: -4, z0: 10, x1: 4, z1: 20, roof: 3.4 },                // squeaky corridor
    { x0: 4, z0: 12, x1: 14, z1: 22, roof: 3.6 },                // the hut
    { x0: 10, z0: -6, x1: 14, z1: 6, roof: 4.2 },                // lobby → A main doors
    { x0: 14, z0: -12, x1: 40, z1: 18, roof: 7.5, wallH: 8, roofMat: 'metal' }, // A silo hall
    { x0: 8, z0: -28, x1: 26, z1: -12, roof: 5 },                // ramp room
    { x0: 26, z0: -28, x1: 50, z1: -8, y: BY, roof: 3.2, wallH: 8, roofMat: 'metal' }, // B bunker (sunken)
    // the big B ramp: terraced descent into the bunker (each tread nav-walkable;
    // the bunker rect above already roofs these cells)
    { x0: 26, z0: -26, x1: 27.8, z1: -14, y: -0.57, mat: 'trim' },
    { x0: 27.8, z0: -26, x1: 29.6, z1: -14, y: -1.14, mat: 'trim' },
    { x0: 29.6, z0: -26, x1: 31.4, z1: -14, y: -1.71, mat: 'trim' },
    { x0: 31.4, z0: -26, x1: 33.2, z1: -14, y: -2.28, mat: 'trim' },
    { x0: 33.2, z0: -26, x1: 35, z1: -14, y: -2.85, mat: 'trim' },
    { x0: 40, z0: -8, x1: 50, z1: 4, roof: 2.2 },                // vents (low crawl, drops into B)
    { x0: -8, z0: 24, x1: 40, z1: 34 },                          // outside (north fence)
    { x0: 40, z0: 12, x1: 54, z1: 34, wallH: 6 },                // CT spawn
  ], { defWallH: 5.5 });

  // A silo: the reactor plant box + catwalk crates
  M.box(26, 0, 4, 3.4, 1.2, 3.4, 'trim');         // plant box A (hazard-striped)
  M.stack(18, 12, 1.5);
  M.crate(34, -6, 1.4);
  M.crate(16, -8, 1.3);
  M.box(26, 6.2, 4, 9, 0.4, 1.2, 'metal');        // rafter beam over the silo
  // B bunker props (east of the ramp terraces)
  M.box(41, BY, -18, 3.0, 1.2, 3.0, 'trim');      // plant box B
  M.crate(37, -25, 1.4, BY);
  M.stack(46, -24, 1.4, BY);
  M.crate(47, -12, 1.2, BY);
  // yard: red shipping containers + silo tanks
  M.box(-20, 0, 8, 7.5, 2.6, 2.4, 'crate');
  M.box(-14, 0, -10, 2.4, 2.6, 7.5, 'crate');
  M.box(-26, 0, -4, 2.4, 5.2, 2.4, 'metal');      // tall tank
  M.decor('cone', -26, 6.0, -4, { r: 1.7, h: 1.6, color: 0x9aa2a8 });
  M.crate(-8, 16, 1.4);
  M.crate(-32, 16, 1.3);
  // outside cover
  M.crate(8, 28, 1.4);
  M.crate(24, 30, 1.3);
  // explosive barrels everywhere — it's a nuclear plant
  M.barrel(-25, 12);
  M.barrel(-11, -15);
  M.barrel(20, -26);
  M.barrel(48, -10, BY);
  M.barrel(31, 9);
  // squeaky door stubs
  M.wall(-4, 10, -1.5, 10, 5.5, { mat: 'door' });
  M.wall(2.5, 10, 4, 10, 5.5, { mat: 'door' });
  // vent mouth: narrow the A-hall side to a crawl gap
  M.wall(40, -8, 40, -4, 5.5, { mat: 'metal' });
  M.wall(40, 1, 40, 4, 5.5, { mat: 'metal' });

  M.site('A', 20, -6, 36, 12);
  M.site('B', 35, -26, 49, -10);
  M.spawns('death', -47, 3, -Math.PI / 2);        // T face east
  M.spawns('order', 47, 23, Math.PI / 2);         // CT face west
  M.dmSpawns([
    [-47, 3, -Math.PI / 2], [47, 23, Math.PI / 2], [-20, 8, -Math.PI / 2], [26, 4, Math.PI],
    [40, -18, Math.PI / 2], [0, 28, Math.PI], [14, -20, 0],
  ]);

  M.routes({
    attack: [
      { name: 'Squeaky', site: 'A', via: [[-18, 2], [0, 2], [0, 15], [8, 17], [20, 8]] },
      { name: 'Main Doors', site: 'A', via: [[-18, 2], [3, 0], [12, 0], [24, 4]] },
      { name: 'Ramp', site: 'B', via: [[-20, -12], [-4, -24], [14, -20], [24, -20], [30, -20], [40, -18]] },
      { name: 'Outside', site: 'B', via: [[-16, 16], [0, 29], [20, 29], [36, 29], [45, 16], [45, -2], [44, -16]] },
    ],
    holds: {
      A: [[22, 10], [34, -2], [16, 4], [36, 14]],
      B: [[38, -22], [46, -12], [36, -12], [46, -24]],
      mid: [[-10, 2], [-14, -12]],
    },
  });
  M.torch(0, 3.4, 0, 0xffd080);      // lobby lamp
  M.torch(26, 6.4, 4, 0xaad4ff);     // silo floodlight
  M.torch(41, -0.6, -18, 0xaad4ff);  // B bunker lamp
  M.torch(0, 2.6, 15, 0xffd080);     // squeaky

  return M.finalize();
}
