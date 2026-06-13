// The Quidditch Pitch: open grass, equipment crates at the centre circle,
// team stands at both ends (the sites), golden goal hoops overhead. Brooms
// were made for this map.
import { MapBuilder } from '../mapbuilder.js';

export function build(scene) {
  const M = new MapBuilder('pitch', scene);
  M.bounds(-34, -58, 34, 58);

  const SY = 2.6; // stand height
  M.layout([
    { x0: -30, z0: -52, x1: 30, z1: 52 },                          // the pitch
    { x0: -22, z0: 40, x1: 22, z1: 52, y: SY, mat: 'wall2' },      // north stand (A)
    { x0: -22, z0: -52, x1: 22, z1: -40, y: SY, mat: 'wall2' },    // south stand (B)
    { x0: -30, z0: -10, x1: -22, z1: 10, roof: 3.2 },              // west equipment shed
    { x0: 22, z0: -10, x1: 30, z1: 10, roof: 3.2 },                // east equipment shed
  ], { defWallH: 5.5 });

  // stand stairs (two flights each side)
  M.stairs(-10, 32, 7, '+z', 8, SY / 8, 1.0);
  M.stairs(10, 32, 7, '+z', 8, SY / 8, 1.0);
  M.stairs(-10, -32, 7, '-z', 8, SY / 8, 1.0);
  M.stairs(10, -32, 7, '-z', 8, SY / 8, 1.0);
  // stand parapets
  M.wall(-22, 40, -14, 40, 0.9, { y: SY, t: 0.5, mat: 'trim' });
  M.wall(14, 40, 22, 40, 0.9, { y: SY, t: 0.5, mat: 'trim' });
  M.wall(-22, -40, -14, -40, 0.9, { y: SY, t: 0.5, mat: 'trim' });
  M.wall(14, -40, 22, -40, 0.9, { y: SY, t: 0.5, mat: 'trim' });
  // golden goal hoops above each stand
  for (const s of [1, -1]) {
    const z = 47 * s;
    for (const [x, h] of [[-8, 5.5], [0, 7.5], [8, 6.5]]) {
      M.decor('cylinder', x, SY + h / 2, z, { r: 0.14, h, color: 0xc8a23a });
      M.decor('ring', x, SY + h + 1.3, z, { r: 1.5, tube: 0.14, rx: 0, color: 0xe0bc52 });
    }
  }
  // centre circle: the equipment trunk + bludger crates
  M.box(0, 0, 0, 2.8, 1.1, 1.8, 'crate');         // team chest
  M.crate(-4, 3, 1.2);
  M.crate(4, -3, 1.2);
  // low barrier rows (mid-field cover)
  M.box(-12, 0, 16, 7, 1.0, 1.1, 'wall');
  M.box(12, 0, 16, 7, 1.0, 1.1, 'wall');
  M.box(-12, 0, -16, 7, 1.0, 1.1, 'wall');
  M.box(12, 0, -16, 7, 1.0, 1.1, 'wall');
  M.stack(-20, 28, 1.4);
  M.stack(20, -28, 1.4);
  M.crate(-20, -28, 1.3);
  M.crate(20, 28, 1.3);
  // shed contents (clear of the spawn pads)
  M.crate(-28, 8, 1.3);
  M.crate(28, -8, 1.3);
  // broom-polish barrels in the sheds + one by the barriers
  M.barrel(-26, -6);
  M.barrel(26, 6);
  M.barrel(-17.5, 16);

  M.site('A', -14, 42, 14, 52);
  M.site('B', -14, -52, 14, -42);
  M.spawns('death', -27, 0, -Math.PI / 2);   // attackers face east across the pitch
  M.spawns('order', 24, 0, Math.PI / 2);     // defenders face west (slightly field-side)
  M.dmSpawns([
    [-27, 0, -Math.PI / 2], [24, 0, Math.PI / 2], [0, 0, 0], [-20, 28, 0],
    [20, -28, Math.PI], [0, 46, Math.PI], [0, -46, 0], [-16, 0, -Math.PI / 2],
  ]);

  M.routes({
    attack: [
      { name: 'North Wing', site: 'A', via: [[-22, 18], [-12, 34], [-8, 44]] },
      { name: 'Centre Rush', site: 'A', via: [[-8, 6], [4, 22], [10, 35], [6, 45]] },
      { name: 'South Wing', site: 'B', via: [[-22, -18], [-12, -34], [-8, -44]] },
      { name: 'Centre Feint', site: 'B', via: [[-8, -6], [4, -22], [10, -35], [6, -45]] },
    ],
    holds: {
      A: [[0, 46], [-12, 44], [12, 44], [0, 34]],
      B: [[0, -46], [-12, -44], [12, -44], [0, -34]],
      mid: [[0, 0], [-16, 0]],
    },
  });
  M.torch(-26, 2.8, 0, 0xffa040);    // shed lanterns
  M.torch(26, 2.8, 0, 0xffa040);
  M.torch(0, SY + 1.8, 46, 0xe8543a);
  M.torch(0, SY + 1.8, -46, 0x49e07d);

  M.npc('bludger', {
    route: [[-24, -30, 2.6], [24, 28, 4.2], [-18, 18, 3.4], [22, -24, 3.9]],
    speed: 11, hitCd: 1.8,
  });
  M.npc('bludger', {
    route: [[24, -30, 3.5], [-24, 26, 4.8], [16, 14, 2.8], [-20, -22, 4.1]],
    speed: 10.2, hitCd: 2.0,
  });

  return M.finalize();
}
