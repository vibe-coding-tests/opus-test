// Diagon Alley: the crooked shopping street between the Leaky Cauldron (south)
// and the Gringotts facade (north). Site A is the Ollivanders yard off the west
// side; site B is the Borgin & Burkes junction where Knockturn Alley lets out.
// Knockturn itself is a dark covered flank — green lamps, low ceiling.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('diagon', scene);
  M.bounds(-40, -60, 42, 60);

  M.layout([
    { x0: -8, z0: 16, x1: 8, z1: 46 },                       // south street (Leaky end)
    { x0: -14, z0: -12, x1: 10, z1: 16 },                    // mid street — the kink
    { x0: -10, z0: -46, x1: 8, z1: -12 },                    // north street (bank end)
    { x0: -20, z0: 46, x1: -2, z1: 56, roof: 4.6 },          // the Leaky Cauldron taproom
    { x0: -12, z0: -56, x1: 12, z1: -46, wallH: 7 },         // Gringotts steps (defender square)
    { x0: -34, z0: -22, x1: -14, z1: 2 },                    // Ollivanders yard (A)
    { x0: -34, z0: -18, x1: -26, z1: -6, roof: 4.0 },        // Ollivanders shop floor (roofed slice)
    { x0: -26, z0: 2, x1: -14, z1: 34 },                     // Wandmakers' Row (west back lane)
    { x0: -26, z0: 10, x1: -14, z1: 22, roof: 4.2 },         // Flourish & Blotts (roofed slice)
    { x0: -14, z0: 22, x1: -8, z1: 30 },                     // row ↔ south street cut
    { x0: -14, z0: -16, x1: -10, z1: -8 },                   // north street ↔ A window cut
    { x0: 10, z0: 4, x1: 24, z1: 16, roof: 4.6 },            // Weasleys' Wizard Wheezes
    { x0: 16, z0: 8, x1: 26, z1: 30 },                       // Knockturn mouth (open)
    { x0: 16, z0: -14, x1: 26, z1: 8, roof: 3.6, wallH: 4.2 }, // Knockturn Alley (covered, dark)
    { x0: 8, z0: 22, x1: 16, z1: 28 },                       // south street ↔ Knockturn cut
    { x0: 14, z0: -36, x1: 36, z1: -14 },                    // Borgin & Burkes junction (B)
    { x0: 8, z0: -30, x1: 14, z1: -22 },                     // north street ↔ B cut
  ], { defWallH: 5.5 });

  // narrow the wide-open seams into proper shop doors
  M.wall(-14, -12, -14, -6, 5.5, { mat: 'wall' });          // short-A entrance: door at z -6..2
  M.wall(10, 8, 10, 16, 5.5, { mat: 'wall2' });             // WWW: street door at z 4..8
  M.wall(-26, 2, -20, 2, 5.5, { mat: 'wall' });             // row → A yard: gate at x -20..-14
  M.wall(16, 8, 20, 8, 4.2, { mat: 'wall2' });              // Knockturn mouth narrowed

  // Ollivanders: counter + teetering wand-box shelves
  M.box(-30, 0, -12, 1.2, 1.0, 4.5, 'door');                // shop counter
  M.crate(-28, -8, 0.9);
  M.crate(-31, -15, 0.9);
  M.crate(-18, -18, 1.3);                                   // yard crates (plant cover)
  M.stack(-28, -2, 1.3);
  // Flourish & Blotts book crates
  M.crate(-22, 14, 1.1);
  M.crate(-17, 19, 1.2);
  // WWW joke shop: bright product crates
  M.crate(14, 8, 1.2);
  M.stack(20, 12, 1.2);
  // street clutter: cauldron stalls, owl crates, the apothecary cart
  M.box(0, 0, 30, 2.0, 1.1, 4.2, 'crate');                  // market cart mid south street
  M.crate(5, 20, 1.2);
  M.crate(-5, 42, 1.2);
  M.crate(-2, -20, 1.3);                                    // north street cover
  M.crate(4, -38, 1.2);
  M.stack(-6, -32, 1.3);
  // B junction cover
  M.stack(30, -30, 1.4);
  M.crate(18, -32, 1.3);
  M.crate(33, -17, 1.2);
  M.box(24, 0, -26, 2.6, 1.0, 2.6, 'crate');                // plant crate B
  // stacked cauldrons (decor)
  for (const [x, z] of [[-2, 24], [6, -16], [22, 24]]) {
    M.decor('cylinder', x, 0.3, z, { r0: 0.42, r1: 0.34, h: 0.6, color: 0x2e3236, collide: true });
    M.decor('cylinder', x, 0.85, z, { r0: 0.36, r1: 0.28, h: 0.5, color: 0x3a3e44 });
  }
  // gnarled wand-shop sign posts
  for (const [x, z] of [[-15, -4], [11, 6], [15, 27]]) {
    M.decor('cylinder', x, 1.6, z, { r: 0.08, h: 3.2, color: 0x3a2c1c });
  }

  // firewhisky barrels: cellar deliveries left in the lanes
  M.barrel(-24, 30);
  M.barrel(13, 7);
  M.barrel(21, 16);
  M.barrel(5, 38);
  M.barrel(34, -31);

  // the alley bell over the mid-street kink — ring it and every head turns
  M.bell(-2, 5.0, 14);

  M.site('A', -32, -20, -16, -4);
  M.site('B', 16, -34, 32, -18);
  M.spawns('death', 0, 40, 0);            // attackers face north, up the alley
  M.spawns('order', 0, -51, Math.PI);     // defenders on the bank steps face south
  M.dmSpawns([
    [0, 40, 0], [0, -51, Math.PI], [-24, -14, Math.PI / 2], [24, -28, Math.PI],
    [21, 2, Math.PI], [-20, 16, 0], [0, 4, Math.PI], [0, -26, 0],
  ]);

  M.routes({
    attack: [
      { name: 'The Alley', site: 'A', via: [[0, 30], [0, 4], [-4, -4], [-18, -8], [-24, -12]] },
      { name: 'Wandmakers Row', site: 'A', via: [[-2, 26], [-11, 26], [-20, 28], [-20, 12], [-20, 4], [-26, -6], [-28, -14]] },
      { name: 'Knockturn', site: 'B', via: [[4, 25], [12, 25], [21, 22], [21, 10], [21, -2], [21, -12], [24, -20], [26, -26]] },
      { name: 'North Street', site: 'B', via: [[0, 30], [-2, 4], [-2, -12], [-1, -26], [11, -26], [18, -26], [24, -24]] },
    ],
    holds: {
      A: [[-24, -14], [-18, -6], [-30, -8], [-20, -18]],
      B: [[24, -28], [30, -20], [18, -30], [28, -16]],
      mid: [[-2, 2], [-10, -4]],
    },
  });

  // warm gaslight down the street, green lamps in Knockturn
  for (const [x, z] of [[-6, 34], [6, 10], [-12, -2], [-8, -24], [6, -40]]) {
    M.decor('cylinder', x, 1.5, z, { r: 0.09, h: 3.0, color: 0x2a2c30 });
    M.torch(x, 3.2, z, 0xffc060);
  }
  M.torch(21, 2.8, 2, 0x49e07d);     // Knockturn: sickly green
  M.torch(21, 2.8, -10, 0x49e07d);
  M.torch(-30, 3.0, -12, 0xffa040);  // Ollivanders hearth
  M.torch(-20, 3.2, 16, 0xffa040);   // Flourish & Blotts
  M.torch(17, 3.4, 10, 0xffa040);    // WWW
  M.torch(-11, 3.4, 51, 0xffa040);   // the Leaky Cauldron

  return M.finalize();
}
