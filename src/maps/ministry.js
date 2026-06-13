// Ministry of Magic — the Atrium. Peacock-blue tile, gilded fittings, and the
// Fountain of Magical Brethren in the middle of a long marble hall. Site A is
// the lift lobby behind the golden gates; site B is the Department of Mysteries
// wing, reached through the black door off the east gallery or the long
// corridor the Unspeakables use.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('ministry', scene);
  M.bounds(-32, -52, 46, 52);

  M.layout([
    { x0: -16, z0: -34, x1: 16, z1: 34, roof: 10, wallH: 10 },        // the Atrium
    { x0: -26, z0: -28, x1: -16, z1: 28, roof: 5.5 },                 // west gallery (floo fireplaces)
    { x0: 16, z0: -28, x1: 26, z1: 28, roof: 5.5 },                   // east gallery (floo fireplaces)
    { x0: -14, z0: 34, x1: 14, z1: 48, roof: 6 },                     // visitors' antechamber (attackers)
    { x0: -14, z0: -48, x1: 14, z1: -34, roof: 6.5 },                 // lift lobby — the golden gates (A)
    { x0: 14, z0: 34, x1: 36, z1: 42, roof: 4 },                      // service corridor, first leg
    { x0: 28, z0: -6, x1: 36, z1: 34, roof: 4 },                      // service corridor, long leg
    { x0: 26, z0: -30, x1: 42, z1: -6, roof: 4.5, mat: 'wall2', roofMat: 'wall2' }, // Department of Mysteries (B)
  ], { defWallH: 6 });

  // arcade columns between atrium and galleries (arches, not walls)
  for (const z of [-24, -16, -8, 0, 8, 16, 24]) {
    M.pillar(-16, z, 1.1, 10, 0, 'trim');
    M.pillar(16, z, 1.1, 10, 0, 'trim');
  }
  // the golden gates: narrow the lobby mouth to two doorways
  M.wall(-14, -34, -5, -34, 6, { mat: 'trim' });
  M.wall(5, -34, 14, -34, 6, { mat: 'trim' });
  // the black door: B wing off the east gallery
  M.wall(26, -28, 26, -24, 4.5, { mat: 'wall2' });
  M.wall(26, -16, 26, -6, 4.5, { mat: 'wall2' });

  // Fountain of Magical Brethren: shallow pool you can wade (and get ambushed in)
  M.water(-5, -5, 5, 5, 0.32);
  M.decor('cylinder', 0, 0.5, 0, { r0: 1.1, r1: 1.4, h: 1.0, color: 0xb89a48, collide: true });   // plinth (statues sit on top)
  M.decor('cone', 0, 1.9, 0, { r: 0.55, h: 1.8, color: 0xc9a94e });                // the wizard
  M.decor('cone', 0.9, 1.5, 0.4, { r: 0.4, h: 1.2, color: 0xc9a94e });             // the witch
  M.decor('cone', -0.9, 1.4, 0.4, { r: 0.38, h: 1.0, color: 0xc9a94e });           // the centaur
  M.decor('ring', 0, 0.35, 0, { r: 4.8, tube: 0.18, color: 0x8a7434 });            // pool rim
  for (const [x, z] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]]) {
    M.decor('cylinder', x, 0.55, z, { r: 0.14, h: 1.1, color: 0x8a7434 });
  }

  // atrium furniture: visitor benches and the daily prophet stand
  M.box(-9, 0, 14, 1.2, 0.6, 4.6, 'crate');
  M.box(9, 0, -14, 1.2, 0.6, 4.6, 'crate');
  M.box(0, 0, 22, 3.4, 1.1, 1.4, 'door');                   // security desk
  M.crate(-11, -22, 1.2);                                    // luggage left at the gates
  M.crate(10, 24, 1.2);
  // floo fireplaces: gilded alcove stubs down both galleries
  for (const z of [-20, -8, 4, 16]) {
    M.box(-25.2, 0, z, 1.4, 3.4, 2.6, 'trim');
    M.box(25.2, 0, z, 1.4, 3.4, 2.6, 'trim');
  }
  // lift lobby: grille banks + the plant console
  M.box(-10, 0, -45.5, 5.5, 3.4, 1.6, 'door');               // lift grilles
  M.box(10, 0, -45.5, 5.5, 3.4, 1.6, 'door');
  M.box(0, 0, -41, 2.8, 1.0, 2.8, 'trim');                   // golden gate console (plant cover)
  M.crate(-7, -38, 1.2);
  M.crate(7, -42, 1.2);
  // Department of Mysteries: prophecy crates and the brain tank
  M.stack(38, -24, 1.4);
  M.crate(30, -26, 1.3);
  M.crate(38, -10, 1.2);
  M.box(33, 0, -16, 2.6, 1.0, 2.6, 'crate');                 // plant crate B
  M.decor('cylinder', 29, 1.1, -10, { r: 0.8, h: 2.2, color: 0x3a5a4a, collide: true });          // the tank
  // service corridor clutter
  M.crate(32, 20, 1.2);
  M.crate(32, 2, 1.2);
  M.crate(24, 38, 1.3);

  // confiscated volatile artifacts, crated and forgotten
  M.barrel(-21, -14);
  M.barrel(21, 22);
  M.barrel(32, 10);
  M.barrel(39, -27);
  M.barrel(-10, 30);

  // the Ministry gong above the atrium's north end
  M.bell(0, 7.6, -12);

  M.site('A', -12, -46, 12, -36);
  M.site('B', 28, -28, 40, -10);
  M.spawns('death', 0, 41, 0);             // visitors' entrance, facing the Atrium
  M.spawns('order', 0, -42, Math.PI);      // by the lifts, facing the gates
  M.dmSpawns([
    [0, 41, 0], [0, -42, Math.PI], [0, 0, 0], [-21, 0, -Math.PI / 2],
    [21, 4, Math.PI / 2], [34, -18, Math.PI], [32, 24, Math.PI], [-6, -38, 0],
  ]);

  M.routes({
    attack: [
      { name: 'The Atrium', site: 'A', via: [[0, 36], [0, 16], [-6, 2], [0, -16], [0, -30], [-2, -40]] },
      { name: 'West Fireplaces', site: 'A', via: [[-6, 34], [-21, 24], [-21, 4], [-21, -16], [-12, -30], [-4, -38]] },
      { name: 'East Gallery', site: 'B', via: [[4, 34], [21, 26], [21, 8], [21, -12], [22, -20], [32, -20]] },
      { name: 'Mysteries Corridor', site: 'B', via: [[8, 38], [24, 38], [32, 30], [32, 8], [32, -2], [34, -14]] },
    ],
    holds: {
      A: [[-6, -38], [6, -40], [0, -34], [-10, -44]],
      B: [[32, -20], [36, -14], [30, -26], [38, -24]],
      mid: [[0, 0], [-21, 0], [21, 4]],
    },
  });

  // floo-green flames down the galleries; warm gold in the atrium
  for (const z of [-20, -8, 4, 16]) {
    M.torch(-24.3, 2.6, z, 0x49e07d);
    M.torch(24.3, 2.6, z, 0x49e07d);
  }
  M.torch(0, 7.4, 12, 0xffd080);     // atrium chandelier south
  M.torch(0, 7.4, -20, 0xffd080);    // atrium chandelier north
  M.torch(-14.5, 4.4, -12, 0xffd080); // gilded sconces along the arcades
  M.torch(14.5, 4.4, -12, 0xffd080);
  M.torch(-14.5, 4.4, 12, 0xffd080);
  M.torch(14.5, 4.4, 12, 0xffd080);
  M.torch(0, 5.0, -2, 0xffe8a0);     // the fountain's own glow
  M.torch(0, 4.6, -42, 0xffd080);    // lift lobby
  M.torch(34, 3.2, -18, 0x6f9fff);   // Mysteries: cold blue
  M.torch(28, 3.4, -8, 0x6f9fff);    // the black door
  M.torch(32, 3.0, 24, 0xffc060);    // service corridor
  M.torch(0, 4.4, 41, 0xffd080);     // antechamber

  return M.finalize();
}
