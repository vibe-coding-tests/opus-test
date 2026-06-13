// The Dungeons: torch-lit corridor ring around the Potions classroom (site A)
// and the ingredient storeroom (site B). Tight, indoor, all stone.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('sewer', scene);
  M.bounds(-44, -40, 44, 40);

  M.layout([
    { x0: -42, z0: -10, x1: -28, z1: 10, roof: 5 },              // attacker cells (west)
    { x0: -34, z0: -26, x1: -26, z1: 28, roof: 3.6 },            // west corridor
    { x0: -30, z0: 24, x1: 30, z1: 32, roof: 3.6 },              // north corridor
    { x0: -30, z0: -32, x1: 30, z1: -24, roof: 3.6 },            // south corridor
    { x0: 26, z0: -26, x1: 34, z1: 28, roof: 3.6 },              // east corridor
    { x0: 28, z0: -10, x1: 42, z1: 10, roof: 5 },                // defender stair landing (east)
    { x0: -14, z0: 4, x1: 10, z1: 24, roof: 4.5 },               // Potions classroom (A)
    { x0: -10, z0: -12, x1: 6, z1: 4, roof: 4.2 },               // central vault
    { x0: -8, z0: -28, x1: 16, z1: -12, roof: 4.0 },             // storeroom (B, defender half)
    { x0: -26, z0: -6, x1: -10, z1: 0, roof: 3.4 },              // west link
    { x0: 6, z0: -6, x1: 26, z1: 2, roof: 3.4 },                 // east link
    { x0: 8, z0: -22, x1: 26, z1: -16, roof: 3.4 },              // storeroom back door (defender rotate)
  ], { defWallH: 5.5 });

  // potions classroom: workbenches + the master's desk
  M.box(-6, 0, 14, 1.4, 0.95, 6, 'crate');
  M.box(2, 0, 14, 1.4, 0.95, 6, 'crate');
  M.box(-2, 0, 21, 5, 0.95, 1.4, 'door');        // Snape's desk
  M.decor('cylinder', -6, 1.3, 11, { r: 0.4, h: 0.7, color: 0x2e4438, collide: true }); // cauldrons
  M.decor('cylinder', 2, 1.3, 17, { r: 0.4, h: 0.7, color: 0x2e4438, collide: true });
  // central vault pillar
  M.pillar(-2, -4, 1.6, 4.2);
  // storeroom barrels
  M.stack(-4, -22, 1.4);
  M.crate(10, -16, 1.3);
  M.crate(4, -25, 1.2);
  M.crate(-2, -14, 1.1);
  // corridor clutter
  M.crate(-30, 14, 1.2);
  M.crate(14, 28, 1.3);
  M.crate(30, -14, 1.2);
  M.crate(-18, -28, 1.2);
  M.crate(20, -28, 1.3);
  // unstable potion barrels: storeroom, east link, west corridor
  M.barrel(-6, -26);
  M.barrel(23, 0);
  M.barrel(-29, -20);

  // sites lean toward the defender (east) half so rotations beat the push
  M.site('A', -4, 8, 9, 22);
  M.site('B', 0, -26, 14, -14);
  M.spawns('death', -35, 0, -Math.PI / 2);   // attackers face east
  M.spawns('order', 35, 0, Math.PI / 2);     // defenders face west

  M.routes({
    attack: [
      { name: 'North Passage', site: 'A', via: [[-30, 16], [-16, 28], [0, 28], [-2, 18]] },
      { name: 'Central Vault', site: 'A', via: [[-18, -3], [-2, -4], [-2, 8], [-2, 14]] },
      { name: 'South Passage', site: 'B', via: [[-30, -16], [-8, -28], [4, -20]] },
      { name: 'Vault to B', site: 'B', via: [[-18, -3], [-2, -8], [0, -16]] },
    ],
    holds: {
      A: [[-2, 16], [6, 10], [-8, 10], [2, 22]],
      B: [[4, -20], [12, -14], [-4, -18], [8, -26]],
      mid: [[-2, -2], [10, -2]],
    },
  });
  // green-flame slytherin sconces + a few warm ones
  M.torch(-2, 3.0, 14, 0x6fe89a);
  M.torch(-2, 3.0, -4, 0x6fe89a);
  M.torch(4, 2.8, -20, 0x6fe89a);
  M.torch(-30, 2.6, 0, 0xffa040);
  M.torch(30, 2.6, 0, 0xffa040);
  M.torch(0, 2.6, 28, 0xffa040);
  M.torch(0, 2.6, -28, 0xffa040);
  M.torch(-18, 2.4, -3, 0x6fe89a);

  return M.finalize();
}
