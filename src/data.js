// All gameplay data: teams, spells, characters, wands, equipment, economy, formats.

export const TEAM = { ORDER: 'order', DEATH: 'death' };

export const TEAM_INFO = {
  order: {
    name: 'Order of the Phoenix',
    short: 'ORDER',
    color: 0xe8543a,
    css: '#e8543a',
    robe: 0x6e1d14,
    trim: 0xd9a441,
    desc: 'Defend the sites. Dispel the Cursed Relic with Finite Incantatem.',
  },
  death: {
    name: 'Death Eaters',
    short: 'DEATH EATERS',
    color: 0x49e07d,
    css: '#49e07d',
    robe: 0x14141c,
    trim: 0x2f8f57,
    desc: 'Plant the Cursed Relic at site A or B, or eliminate the Order.',
  },
};

export const otherTeam = (t) => (t === TEAM.ORDER ? TEAM.DEATH : TEAM.ORDER);

// ---------------------------------------------------------------- SPELLS ---
// kind: 'bolt' (projectile), 'lob' (arcing grenade), 'shield', 'summon'
// spread: [standing deg, moving extra deg]; falloff: [startDist, endDist, minMult]
// recoil: camera kick (rad) per cast; bloom: spread (deg) added per cast,
// decaying over ~0.6s — spamming sprays, tapping stays tight.
export const SPELLS = {
  stupefy: {
    id: 'stupefy', name: 'Stupefy', kind: 'bolt', slot: 1, icon: 'bolt',
    dmg: 26, interval: 0.25, speed: 48, mana: 7, spread: [0.32, 2.15],
    recoil: 0.015, bloom: 0.5,
    falloff: [26, 60, 0.62], hs: 2, kb: 2.25, stagger: 0.14, killReward: 300, price: 0,
    color: 0xff3b4a, glow: 0xff97a3,
    role: 'Rifle', desc: 'Rapid red stunner. Four close body hits drop a wizard — but it bleeds power at range.',
  },
  avada: {
    id: 'avada', name: 'Avada Kedavra', kind: 'bolt', slot: 2, icon: 'skull',
    dmg: 250, interval: 1.55, charge: 1.5, speed: 64, mana: 55, spread: [0.04, 5.2],
    recoil: 0.058, bloom: 0, zoom: 0.55,
    falloff: null, hs: 1, kb: 3.7, killReward: 150, price: 5400, chargeSlow: 0.45, // hs 1: it kills on ANY contact — no headshot math needed; slower bolt + longer charge + rooted charge make it dodgeable and beatable by a rusher who closes the gap
    color: 0x37ff6e, glow: 0xa9ffc4,
    role: 'AWP', desc: 'Hold to charge — your focus narrows (scope) — release the Killing Curse. One hit, loud and expensive.',
  },
  sectum: {
    id: 'sectum', name: 'Sectumsempra', kind: 'bolt', slot: 1, icon: 'slash',
    dmg: 21, interval: 0.29, speed: 54, mana: 8.5, spread: [0.28, 2.25],
    recoil: 0.019, bloom: 0.65,
    falloff: [24, 58, 0.74], hs: 2, kb: 1.3, bleed: [3.5, 3.2], killReward: 300, price: 0,
    color: 0xd9c9ff, glow: 0xffffff, exclusive: 'snape', replaces: 'stupefy',
    role: 'Rifle+', desc: 'Cutting curse, "for enemies". Victims bleed for 3.2s.',
  },
  expelliarmus: {
    id: 'expelliarmus', name: 'Expelliarmus', kind: 'bolt', slot: 3, icon: 'swirl',
    dmg: 14, interval: 0.9, speed: 62, mana: 12, spread: [0.3, 2.0],
    recoil: 0.011, bloom: 0.28,
    falloff: null, hs: 1, kb: 2.8, disarm: 2.0, killReward: 300, price: 0,
    color: 0xffb347, glow: 0xffe2ad,
    role: 'Interrupt', desc: 'Snaps the wand away and shoves them back: no casting for 2.0s unless they scramble to recover it. An interrupt for a charge or a shield — too slow to lock a wizard down on its own.',
  },
  petrificus: {
    id: 'petrificus', name: 'Petrificus Totalus', kind: 'bolt', slot: 3, icon: 'bind',
    dmg: 0, interval: 1.05, speed: 44, mana: 20, spread: [0.34, 1.9],
    recoil: 0.013, bloom: 0.35,
    falloff: null, hs: 1, freeze: 1.45, charges: 1, killReward: 300, price: 500,
    color: 0x9fb6c8, glow: 0xe2eef8,
    role: 'Body-Bind', desc: 'Full Body-Bind: target is a statue for 1.45s. A solid hit shatters the bind.',
  },
  impedimenta: {
    id: 'impedimenta', name: 'Impedimenta', kind: 'bolt', slot: 3, icon: 'slow',
    dmg: 5, interval: 0.82, speed: 54, mana: 15, spread: [0.34, 2.0],
    recoil: 0.011, bloom: 0.32,
    falloff: null, hs: 1, kb: 2.5, snare: 2.15, charges: 2, killReward: 300, price: 400,
    color: 0x58c8ff, glow: 0xc6ecff,
    role: 'Jinx', desc: 'Knockback jinx: shoves the target and SNARES them — 45% slower, no jumping, for 2.15s.',
  },
  silencio: {
    id: 'silencio', name: 'Silencio', kind: 'bolt', slot: 3, icon: 'mute',
    dmg: 2, interval: 0.95, speed: 58, mana: 17, spread: [0.3, 1.9],
    recoil: 0.011, bloom: 0.28,
    falloff: null, hs: 1, kb: 0.5, silence: 1.8, charges: 1, killReward: 300, price: 400,
    color: 0xc886ff, glow: 0xeed4ff,
    role: 'Hex', desc: 'Steals the voice: no casting, no Protego for 1.8s. They can still run — and so can you.',
  },
  serpensortia: {
    id: 'serpensortia', name: 'Serpensortia', kind: 'summon', slot: 5, icon: 'snake',
    dmg: 20, interval: 1.15, speed: 0, mana: 20, spread: [0, 0],
    charges: 1, summon: { hp: 26, speed: 7.8, life: 10, bite: 20, slow: 0.8, range: 24 }, killReward: 300, price: 500,
    color: 0x3fae5a, glow: 0x9fe8b4,
    role: 'Summon', desc: 'Conjure a fast serpent that hunts the nearest enemy and strikes once. Can be shot down.',
  },
  bombarda: {
    id: 'bombarda', name: 'Bombarda', kind: 'lob', slot: 4, icon: 'bomb',
    dmg: 72, radius: 4.7, interval: 1.05, speed: 18, mana: 26, spread: [1, 2],
    charges: 2, self: true, killReward: 300, price: 550,
    color: 0xff8a2a, glow: 0xffc890,
    role: 'HE Grenade', desc: 'Lobbed blasting charge. Big shove, softer lethal radius — hurts you too.',
  },
  lumos: {
    id: 'lumos', name: 'Lumos Maxima', kind: 'lob', slot: 5, icon: 'sun',
    dmg: 0, radius: 15, interval: 0.78, speed: 16.5, mana: 13, spread: [1, 2],
    charges: 2, flash: 2.2, killReward: 300, price: 250,
    color: 0xffffff, glow: 0xffffff,
    role: 'Flashbang', desc: 'Blinding burst of light. Look away!',
  },
  fumos: {
    id: 'fumos', name: 'Fumos', kind: 'lob', slot: 5, icon: 'cloud',
    dmg: 0, radius: 4.2, interval: 0.78, speed: 16.5, mana: 15, spread: [1, 2],
    charges: 2, smoke: 10, killReward: 300, price: 300,
    color: 0x9fb2c8, glow: 0xcfd8e6,
    role: 'Smoke', desc: 'Dense smokescreen for 10 seconds. Blocks sight lines.',
  },
  incendio: {
    id: 'incendio', name: 'Incendio', kind: 'lob', slot: 5, icon: 'flame',
    dmg: 0, radius: 3.3, interval: 0.88, speed: 17, mana: 19, spread: [1, 2],
    charges: 1, fire: [5.5, 12], self: true, killReward: 300, price: 450,
    color: 0xff5a1f, glow: 0xffae6e,
    role: 'Molotov', desc: 'Pool of cursed fire: 12 dmg/s for 5.5s. Denies ground.',
  },
  patronum: {
    id: 'patronum', name: 'Expecto Patronum', kind: 'lob', slot: 5, icon: 'stag',
    dmg: 0, radius: 0, interval: 0.88, speed: 15.5, mana: 22, spread: [1, 2],
    charges: 1, ward: [6.5, 4.6, 3.0], killReward: 300, price: 450,
    color: 0xcfe8ff, glow: 0xffffff,
    role: 'Ward Wall', desc: 'Conjure a silver guardian wall for 6.5s. Enemy spells cannot pass.',
  },
  episkey: {
    id: 'episkey', name: 'Episkey', kind: 'lob', slot: 5, icon: 'potion',
    dmg: 0, radius: 4.5, interval: 0.82, speed: 16, mana: 18, spread: [1, 2],
    charges: 2, heal: 28, killReward: 300, price: 300,
    color: 0x7dffa0, glow: 0xd6ffe4,
    role: 'Support Heal', desc: 'Lobbed healing charm. Restores nearby allies, but does nothing to enemies.',
  },
  protego: {
    id: 'protego', name: 'Protego', kind: 'shield', slot: 0, icon: 'shield',
    dmg: 0, mana: 0, drain: 12, drainHit: 0.45, speedMult: 0.6, price: 0,
    parry: 0.3, color: 0x6fb4ff, glow: 0xbfe0ff,
    role: 'Shield', desc: 'Hold RIGHT CLICK to block spells. Raise it at the last instant to REFLECT a bolt.',
  },
};

export const GRENADES = ['bombarda', 'lumos', 'fumos', 'incendio', 'patronum', 'serpensortia', 'episkey'];
export const SLOT3 = ['expelliarmus', 'petrificus', 'impedimenta', 'silencio'];
export const HEXES = ['expelliarmus', 'petrificus', 'impedimenta', 'silencio']; // the disable school
export const SLOT5 = ['lumos', 'fumos', 'incendio', 'patronum', 'serpensortia', 'episkey'];

// -------------------------------------------------------------- HIT ZONES ---
// CS 1.6-style locational damage. Head uses the spell's own hs multiplier
// (Avada kills on any contact regardless). Body-zone multipliers below keep
// Stupefy's documented 4-chest-hit kill intact.
export const HITZONES = {
  head: { name: 'Head' },               // spell.hs (2x for most bolts)
  chest: { mult: 1.0, name: 'Chest' },
  stomach: { mult: 1.15, name: 'Stomach' },
  arm: { mult: 0.85, name: 'Arm' },
  leg: { mult: 0.7, name: 'Leg' },
};

// ------------------------------------------------------------ CHARACTERS ---
// ai: bot playstyle — aggro (push vs hold), range (preferred fight distance m),
// util (grenade-usage mult), lurk (flank/slow-play bias), snipe (Avada affinity),
// team (sticks with + trades for teammates), dodge (strafe intensity mult).
export const CHARACTERS = [
  {
    id: 'harry', name: 'Harry Potter', side: 'order', short: 'Harry',
    hp: 100, speed: 5.6, power: 1.0, cast: 1.02, mana: 100, regen: 4.2,
    perk: 'The Disarming Hero', perkDesc: 'Expelliarmus costs 40% less mana and recovers 45% faster.',
    fav: 'lumos',
    skin: { hair: 0x1f1a14, glasses: true, scar: true, messy: true, accent: 0x8a1e1e, scarf: [0x8a1e1e, 0xd6a531], wand: { len: 0.5, color: 0x6b4226 } },
    ai: { aggro: 0.85, range: 12, util: 0.6, lurk: 0.05, snipe: 0.2, team: 0.7, dodge: 0.95, disc: 'duelist' },
    style: 'Entry duelist — first through the door, fights close, trades for teammates.',
  },
  {
    id: 'hermione', name: 'Hermione Granger', side: 'order', short: 'Hermione',
    hp: 85, speed: 5.6, power: 0.94, cast: 1.18, mana: 115, regen: 5.2,
    perk: 'Time-Turner Focus', perkDesc: 'Recharge (R) refills mana twice as fast.',
    fav: 'impedimenta',
    skin: { hair: 0x6e4a23, bushy: true, accent: 0x8a1e1e, satchel: true, timeTurner: true, wand: { len: 0.48, color: 0x7a5a33 } },
    ai: { aggro: 0.4, range: 18, util: 1.6, lurk: 0.1, snipe: 0.3, team: 0.9, dodge: 0.7, disc: 'warden' },
    style: 'Support caster — smokes and flashes before every push, follows the pack.',
  },
  {
    id: 'ron', name: 'Ron Weasley', side: 'order', short: 'Ron',
    hp: 112, speed: 5.25, power: 0.96, cast: 0.97, mana: 95, regen: 3.8,
    perk: "Keeper's Grit", perkDesc: 'Takes 20% less damage from explosions and fire.',
    fav: 'patronum',
    skin: { hair: 0xb3502a, accent: 0x6e2230, scarf: [0x6e2230, 0xd6a531], patch: true, wand: { len: 0.46, color: 0x8a5a33 } },
    ai: { aggro: 0.35, range: 14, util: 0.7, lurk: 0.15, snipe: 0.1, team: 0.85, dodge: 0.45, disc: 'warden' },
    style: 'Site anchor — plants his feet, soaks damage, never leaves the objective.',
  },
  {
    id: 'luna', name: 'Luna Lovegood', side: 'order', short: 'Luna',
    hp: 90, speed: 5.65, power: 0.92, cast: 1.08, mana: 118, regen: 5.8,
    perk: 'Spectrespecs', perkDesc: '60% flash resistance. Enemy radar pings linger 2s longer.',
    fav: 'fumos',
    skin: { hair: 0xe6d8a8, long: true, accent: 0x2b4a8a, spectrespecs: true, radish: true, wand: { len: 0.5, color: 0xcbb98a } },
    ai: { aggro: 0.55, range: 16, util: 1.2, lurk: 0.65, snipe: 0.25, team: 0.2, dodge: 0.85, disc: 'phantom' },
    style: 'Wildcard — wanders strange routes alone and appears exactly where you are not looking.',
  },
  {
    id: 'snape', name: 'Severus Snape', side: 'death', short: 'Snape',
    hp: 96, speed: 5.35, power: 1.04, cast: 1.02, mana: 105, regen: 4.3,
    perk: 'The Half-Blood Prince', perkDesc: 'Exclusive: Sectumsempra replaces Stupefy — a bleeding bolt.',
    fav: 'silencio',
    skin: { hair: 0x101010, curtains: true, accent: 0x14181c, collar: true, buttons: true, wand: { len: 0.52, color: 0x14110d } },
    ai: { aggro: 0.3, range: 20, util: 0.9, lurk: 0.9, snipe: 0.45, team: 0.2, dodge: 0.6, disc: 'hexer' },
    style: 'Lurker — patient, silent, takes the long flank and punishes rotations.',
  },
  {
    id: 'bellatrix', name: 'Bellatrix Lestrange', side: 'death', short: 'Bellatrix',
    hp: 82, speed: 5.8, power: 1.13, cast: 1.05, mana: 95, regen: 4,
    perk: 'Crucio', perkDesc: 'Your bolt hits slow victims by 30% for 1.2s.',
    fav: 'incendio',
    skin: { hair: 0x140d0d, wild: true, accent: 0x2a1230, corset: true, locket: true, wand: { len: 0.44, color: 0x231811 } },
    ai: { aggro: 1.0, range: 7, util: 0.5, lurk: 0.0, snipe: 0.1, team: 0.4, dodge: 1.1, disc: 'duelist' },
    style: 'Berserker — sprints straight at you cackling, point-blank, no retreat. Ever.',
  },
  {
    id: 'voldemort', name: 'Lord Voldemort', side: 'death', short: 'Voldemort',
    hp: 96, speed: 4.75, power: 1.2, cast: 0.98, mana: 125, regen: 5.2,
    perk: 'Master of Death', perkDesc: 'Avada Kedavra charges 28% faster and costs 15% less.',
    fav: 'serpensortia',
    skin: { hair: null, pale: true, slits: true, accent: 0x3a4438, noseSlits: true, clasp: true, wand: { len: 0.58, color: 0xded7c4 } },
    ai: { aggro: 0.45, range: 30, util: 0.6, lurk: 0.3, snipe: 1.0, team: 0.3, dodge: 0.5, disc: 'duelist' },
    style: 'The AWPer — holds a long angle with Avada Kedavra charged. One mistake, one kill.',
  },
  {
    id: 'draco', name: 'Draco Malfoy', side: 'death', short: 'Draco',
    hp: 92, speed: 5.55, power: 0.99, cast: 1.02, mana: 105, regen: 4.4,
    perk: 'Malfoy Coffers', perkDesc: '15% discount on every purchase.',
    fav: 'petrificus',
    skin: { hair: 0xeae2c8, slick: true, accent: 0x1f4d33, badge: true, ring: true, wand: { len: 0.5, color: 0x4a3b2e, grip: 0xc0c4cc } },
    ai: { aggro: 0.45, range: 16, util: 1.0, lurk: 0.4, snipe: 0.35, team: 0.6, dodge: 0.75, disc: 'phantom' },
    style: 'Baiter — fights beside teammates, bails the moment a duel turns sour.',
  },
  {
    id: 'dumbledore', name: 'Albus Dumbledore', side: 'order', short: 'Dumbledore',
    hp: 92, speed: 4.85, power: 1.12, cast: 1.08, mana: 135, regen: 6.2,
    perk: 'For the Greater Good', perkDesc: 'Protego drains 35% less mana and your perfect-parry window is 35% wider.',
    fav: 'patronum',
    skin: { hair: 0xdfd9cf, beard: true, halfMoon: true, accent: 0x4a2a6e, startrim: true, wand: { len: 0.58, color: 0x3d2c1c } },
    ai: { aggro: 0.35, range: 22, util: 1.3, lurk: 0.1, snipe: 0.4, team: 0.8, dodge: 0.5, disc: 'warden' },
    style: 'The headmaster holds the door — an unhurried wall of Protego who answers every mistake with precision.',
  },
  {
    id: 'mcgonagall', name: 'Minerva McGonagall', side: 'order', short: 'McGonagall',
    hp: 88, speed: 5.35, power: 1.02, cast: 1.12, mana: 110, regen: 4.8,
    perk: 'Transfiguration Mistress', perkDesc: 'Your Petrificus holds 30% longer and slot-3 hexes carry +1 charge.',
    fav: 'petrificus',
    skin: { hair: 0x3c3530, bun: true, squareGlasses: true, accent: 0x14532d, tartan: true, witchHat: true, wand: { len: 0.5, color: 0x52391f } },
    ai: { aggro: 0.5, range: 16, util: 1.1, lurk: 0.1, snipe: 0.3, team: 0.85, dodge: 0.65, disc: 'hexer' },
    style: 'Discipline incarnate — binds the entry man, slows the second, and tuts at both.',
  },
  {
    id: 'ginny', name: 'Ginny Weasley', side: 'order', short: 'Ginny',
    hp: 88, speed: 5.75, power: 1.08, cast: 1.06, mana: 98, regen: 4.2,
    perk: 'Bat-Bogey Barrage', perkDesc: 'Bombarda blasts 20% wider and every round starts with a free Impedimenta charge.',
    fav: 'bombarda',
    skin: { hair: 0xc2401f, pony: true, accent: 0x6e2230, pads: true, wand: { len: 0.46, color: 0x7a4a2a } },
    ai: { aggro: 0.9, range: 10, util: 0.9, lurk: 0.05, snipe: 0.15, team: 0.6, dodge: 1.0, disc: 'duelist' },
    style: 'Second through the door — a blast, a hex, and whatever is left of the site is hers.',
  },
  {
    id: 'neville', name: 'Neville Longbottom', side: 'order', short: 'Neville',
    hp: 118, speed: 5.05, power: 0.98, cast: 0.93, mana: 90, regen: 3.8,
    perk: "Gryffindor's Courage", perkDesc: 'Below 35% health you deal 20% more damage and take 12% less.',
    fav: 'incendio',
    skin: { hair: 0x6a4a2c, sidePart: true, accent: 0x8a1e1e, sprig: true, wand: { len: 0.47, color: 0x9a7146 } },
    ai: { aggro: 0.45, range: 12, util: 0.8, lurk: 0.1, snipe: 0.05, team: 0.9, dodge: 0.4, disc: 'warden' },
    style: 'The last man standing — hardest to kill exactly when the round matters most.',
  },
  {
    id: 'lucius', name: 'Lucius Malfoy', side: 'death', short: 'Lucius',
    hp: 88, speed: 5.25, power: 1.04, cast: 1.06, mana: 112, regen: 4.8,
    perk: 'Galleons & Influence', perkDesc: 'Your kills pay +125 G, and every living squadmate collects +50 G.',
    fav: 'serpensortia',
    skin: { hair: 0xe8e3d0, long: true, accent: 0x101418, cane: true, furTrim: true, wand: { len: 0.54, color: 0x1c1812, grip: 0xcfd6da } },
    ai: { aggro: 0.35, range: 18, util: 1.2, lurk: 0.3, snipe: 0.4, team: 0.7, dodge: 0.6, disc: 'phantom' },
    style: 'Old money — fights from the second rank, banks every kill, never dirties his gloves.',
  },
  {
    id: 'greyback', name: 'Fenrir Greyback', side: 'death', short: 'Greyback',
    hp: 120, speed: 5.75, power: 1.06, cast: 0.85, mana: 75, regen: 3.2,
    perk: 'The Hunger', perkDesc: 'Kills feed you: +30 HP and +12% move speed for 3.5s.',
    fav: 'incendio',
    skin: { hair: 0x8d8578, mane: true, scarred: true, accent: 0x3a2e24, fur: true, claws: true, wand: { len: 0.42, color: 0x4a3424 } },
    ai: { aggro: 1.0, range: 5, util: 0.3, lurk: 0.25, snipe: 0.0, team: 0.3, dodge: 0.9, disc: 'duelist' },
    style: 'A werewolf with a wand he barely needs — eats the wounded and gets faster doing it.',
  },
  {
    id: 'umbridge', name: 'Dolores Umbridge', side: 'death', short: 'Umbridge',
    hp: 96, speed: 5.05, power: 0.96, cast: 1.11, mana: 118, regen: 5.2,
    perk: 'Ministry Surveillance', perkDesc: 'Hex hits brand victims on the squad radar for 4s, and Silencio lasts 35% longer.',
    fav: 'silencio',
    skin: { hair: 0x8a6b50, curls: true, accent: 0xd55a9e, bow: true, brooch: true, wand: { len: 0.4, color: 0x70513a } },
    ai: { aggro: 0.25, range: 17, util: 1.4, lurk: 0.2, snipe: 0.2, team: 0.5, dodge: 0.5, disc: 'hexer' },
    style: 'Hem hem. Files a report on everywhere you hide, then has the committee silence you.',
  },
  {
    id: 'wormtail', name: 'Peter Pettigrew', side: 'death', short: 'Wormtail',
    hp: 82, speed: 5.7, power: 0.9, cast: 1.03, mana: 92, regen: 4.2,
    perk: 'Animagus Instincts', perkDesc: 'Your footsteps make no sound and every round starts with an Invisibility Cloak.',
    fav: 'fumos',
    skin: { hair: 0x9a8a72, balding: true, hunched: true, accent: 0x4e4438, silverHand: true, wand: { len: 0.4, color: 0x6b5a44 } },
    ai: { aggro: 0.2, range: 14, util: 1.0, lurk: 0.95, snipe: 0.1, team: 0.15, dodge: 0.7, disc: 'phantom' },
    style: 'The rat — never first, never seen, always behind you when the duel is already lost.',
  },
];

export const charById = (id) => CHARACTERS.find((c) => c.id === id);

// Extra bot identities reuse main character stat templates (used only when a
// lobby needs more bodies than the roster has unique characters).
export const BOT_NAMES = {
  order: [
    ['Tonks', 'ginny'], ['Kingsley', 'dumbledore'], ['Sirius', 'harry'], ['Lupin', 'neville'],
    ['Moody', 'mcgonagall'], ['Fleur', 'hermione'], ['Seamus', 'ginny'], ['Cho', 'luna'],
  ],
  death: [
    ['Dolohov', 'snape'], ['Yaxley', 'lucius'], ['Rookwood', 'umbridge'], ['Avery', 'bellatrix'],
    ['Mulciber', 'greyback'], ['Travers', 'snape'], ['Nott', 'draco'], ['Rosier', 'wormtail'],
  ],
};

// ----------------------------------------------------------------- VOICE ---
// Procedural "wizard murmur" voice per champion (see audio.voice). No speech
// files: a pitched formant utterance, so Bellatrix shrieks and Voldemort
// rasps low. pitch=fundamental Hz, shift=formant brightness, rasp=breath/growl
// mix, wobble=vibrato, rate=syllable length, syl=preferred syllable count.
export const DEFAULT_VOICE = { pitch: 160, shift: 1, rasp: 0.05, wobble: 0.05, rate: 1, syl: 0 };
export const VOICE = {
  harry: { pitch: 152, shift: 1.0, rasp: 0.04 },
  hermione: { pitch: 198, shift: 1.06, rate: 0.95 },
  ron: { pitch: 138, shift: 0.98, rasp: 0.06 },
  luna: { pitch: 210, shift: 1.12, wobble: 0.1, rate: 1.25 },
  snape: { pitch: 104, shift: 0.9, rasp: 0.1, wobble: 0.03, rate: 1.2 },
  bellatrix: { pitch: 232, shift: 1.16, rasp: 0.16, wobble: 0.13 },
  voldemort: { pitch: 90, shift: 0.8, rasp: 0.22, wobble: 0.03, rate: 1.1 },
  draco: { pitch: 166, shift: 1.04 },
  dumbledore: { pitch: 116, shift: 0.94, rasp: 0.07, rate: 1.2 },
  mcgonagall: { pitch: 184, shift: 1.0, rate: 1.05 },
  ginny: { pitch: 192, shift: 1.05 },
  neville: { pitch: 146, shift: 0.99, rasp: 0.07 },
  lucius: { pitch: 128, shift: 0.95, rate: 1.15 },
  greyback: { pitch: 98, shift: 0.84, rasp: 0.36, wobble: 0.06 },
  umbridge: { pitch: 226, shift: 1.2, wobble: 0.06, rate: 1.1 },
  wormtail: { pitch: 172, shift: 1.06, rasp: 0.18, wobble: 0.07 },
};
export const voiceFor = (charId) => ({ ...DEFAULT_VOICE, ...(VOICE[charId] || {}) });

// ----------------------------------------------------------------- LINES ---
// Callout banks keyed by comms category. Each has a generic pool (`_`) plus
// optional per-champion flavor so the same situation sounds like the wizard
// saying it. Tokens {area} and {name} are filled in by the comms layer.
export const LINES = {
  contact: {
    _: ['Contact {area}!', 'Enemy {area}!', 'One spotted {area}.', "They're {area}!", 'Eyes {area}!'],
    harry: ['Contact {area} — on me!'],
    hermione: ['Enemy {area}, smoke ready.'],
    ron: ['Oi, one {area}!'],
    luna: ["Something's {area}... or someone.", 'A wrackspurt {area}, I think.'],
    snape: ['Movement. {area}.'],
    bellatrix: ['Found a plaything {area}!', 'I see you {area}!'],
    voldemort: ['A fool reveals himself. {area}.'],
    draco: ['One {area} — sort it out.'],
    mcgonagall: ['Enemy {area}. Hold the line.'],
    greyback: ['I smell one {area}.'],
    umbridge: ['Intruder {area}. Noted.'],
    wormtail: ["S-someone's {area}!"],
  },
  kill: {
    _: ['Got one!', 'Down!', 'Tagged him!', 'One down!', 'Scratch one.'],
    harry: ['Got one — keep pushing!'],
    hermione: ['Target down.'],
    ron: ['Bloody hell, got him!'],
    luna: ["Oh, he's gone now."],
    snape: ['Pathetic.', 'Spare me.'],
    bellatrix: ['Hahaha! Did you see that?!', 'Another one for me!'],
    voldemort: ['As it should be.', 'Weak.'],
    draco: ['Easy. My father will hear of this.'],
    ginny: ["That all you've got?"],
    mcgonagall: ['Detention.'],
    greyback: ['Fresh meat.', 'Mine now.'],
    umbridge: ['Hem hem. Discipline.'],
    lucius: ['Predictable.'],
  },
  need: {
    _: ['Need backup {area}!', 'Help {area}!', 'Trade me {area}!', "I'm pinned {area}!"],
    ron: ['Little help here?!'],
    wormtail: ['H-help! Please!'],
    neville: ['Holding but hurt — back me up!'],
  },
  status: {
    _: ['Low HP, falling back.', 'Reloading — cover me.', "I'm hurt.", 'Need a sec.'],
    bellatrix: ['Just a scratch!'],
    neville: ["I'm not going down."],
  },
  objective: {
    _: ["Relic's down {area}.", 'Planting — cover me!', 'On the defuse!', 'Get to site!'],
    hermione: ['Defusing, hold them off!'],
    ron: ['Planting it, watch my back!'],
  },
  banter: {
    _: ['Stay sharp.', "Let's run it.", 'Standard — watch flanks.', 'Quiet... too quiet.'],
    bellatrix: ['I do love a good duel!', 'Come out, come out...'],
    luna: ['The nargles are restless today.'],
    ron: ["I've got a bad feeling about this."],
    snape: ['Do try not to die.'],
    voldemort: ['Do not disappoint me.'],
    umbridge: ['Naughty, naughty.'],
    greyback: ["Hunt's on."],
    draco: ['Try to keep up.'],
    dumbledore: ['Steady, everyone.'],
  },
  ack: {
    _: ['Copy.', 'On it.', 'Moving.', 'Roger.', 'Got it.'],
    bellatrix: ['With pleasure!'],
    snape: ['...Fine.'],
    wormtail: ['O-okay!'],
    draco: ['If I must.'],
    greyback: ['Hngh.'],
  },
  refuse: {
    _: ['Negative, holding.', "Can't — I'm pinned.", "You go, I've got this angle."],
    wormtail: ["I-I'd rather not..."],
    snape: ['I think not.'],
    luna: ["I'll wander, thanks."],
  },
  report: {
    _: ['{area}, all good.', '{area}, low HP.', 'Holding {area}.', 'Alive, {area}.'],
  },
  clutch: {
    _: ["It's just me — wish me luck.", '1 v many. Watch this.', 'Clutch time.'],
    bellatrix: ['Just me and you now!'],
    voldemort: ['Alone is how I prefer it.'],
    harry: ['Not over yet.'],
  },
  revenge: {
    _: ["That's for {name}!", "You'll pay for {name}!", 'Avenged.'],
  },
};

// Squad strategy calls (Phase 3) — the in-round "plan" the leader announces.
export const PLAN_LINES = {
  rushA: ['Rush A — all in, go go!', 'Hit A hard!'],
  rushB: ['Everyone B! Fast!', 'Stack B, go!'],
  split: ['Split it — I take the flank.', 'Two here, rest the other way.'],
  default: ['Default. Take map control.', 'Slow it — gather info.'],
  save: ['Save it, play next round.', "Eco — don't waste it."],
  fake: ['Fake A, rotate on my call.', 'Bait it out, then swing.'],
  retake: ['Retake together — on my count.', 'Group up, we take it back.'],
  stackA: ['Stack A, they love it.', 'Anchor A heavy.'],
  stackB: ['Hold B in force.', 'Weight B.'],
};

const _fill = (line, ctx = {}) => line
  .replace('{area}', ctx.area || 'mid')
  .replace('{name}', ctx.name || 'someone');

// Pick a callout for a category, biased toward the champion's own flavor.
export function pickLine(cat, charId, ctx = {}) {
  const bank = LINES[cat];
  if (!bank) return null;
  const generic = bank._ || [];
  const flavor = bank[charId] || null;
  let pool;
  if (flavor && flavor.length) pool = Math.random() < 0.6 ? flavor : generic.concat(flavor);
  else pool = generic;
  if (!pool.length) return null;
  return _fill(pool[(Math.random() * pool.length) | 0], ctx);
}

export function pickPlan(strat) {
  const pool = PLAN_LINES[strat] || PLAN_LINES.default;
  return pool[(Math.random() * pool.length) | 0];
}

// ----------------------------------------------------------------- WANDS ---
export const WANDS = [
  { id: 'training', name: 'Training Wand', price: 0, power: 0.84, cast: 0.98, spread: 1.35, manaMult: 1.0, castPoint: { fwd: 0.45, right: 0.13, up: -0.16 }, desc: 'School-issue practice wand. Forgiving enough to fight, still clearly outclassed.' },
  { id: 'holly', name: 'Holly & Phoenix Feather', price: 1500, power: 1.0, cast: 1.06, spread: 1.0, manaMult: 1.0, castPoint: { fwd: 0.5, right: 0.16, up: -0.14 }, desc: 'The balanced classic. Reliable cast point, no special weakness.' },
  { id: 'vine', name: 'Vine Wood & Dragon Heartstring', price: 1800, power: 0.95, cast: 1.12, spread: 0.65, manaMult: 1.0, hexMana: 0.82, castPoint: { fwd: 0.62, right: 0.1, up: -0.1 }, desc: 'Surgical control: tight spread and cheaper hexes, with slightly softer hits.' },
  { id: 'walnut', name: 'Walnut & Dragon Heartstring', price: 2200, power: 1.1, cast: 0.98, spread: 1.15, manaMult: 1.18, lobRadius: 1.1, castPoint: { fwd: 0.48, right: 0.2, up: -0.18 }, desc: 'Battle wand: hard hits and wider lob magic, paid for with accuracy and mana.' },
  { id: 'elder', name: 'The Elder Wand', price: 4600, power: 1.16, cast: 1.06, spread: 0.85, manaMult: 1.08, castPoint: { fwd: 0.72, right: 0.14, up: -0.08 }, desc: 'Long reach and elite dueling stats, with enough mana tax to keep it honest.' },
];

export const wandById = (id) => WANDS.find((w) => w.id === id);

// ------------------------------------------------------------- EQUIPMENT ---
export const EQUIP_EFFECTS = {
  potion: { duration: 2.75, healPerSecond: 20 },
  broom: { duration: 2.4, speedMult: 1.55 },
  cloak: { duration: 5.2 },
  apparate: { distance: 7.5 },
  finite: {},
  vest: { pool: 55, soak: 0.25 },
  felix: { slow: 0.5 },
  portkey: { channel: 1.2 },
};

export const EQUIPMENT = [
  { id: 'potion', name: 'Healing Potion', price: 300, action: 'potion', max: 1, icon: 'potion', desc: 'Restores 55 HP over 2.75s. Strong sustain, weak to burst.' },
  { id: 'broom', name: 'Broomstick', price: 450, action: 'broom', max: 2, icon: 'broom', desc: 'Hold to FLY for up to 2.4s: steer where you look, Space climbs, Ctrl dives. Two mounts.' },
  { id: 'cloak', name: 'Invisibility Cloak', price: 500, action: 'cloak', max: 1, icon: 'cloak', desc: 'Vanish for 5.2s. Casting breaks it.' },
  { id: 'apparate', name: 'Apparition Charm', price: 450, action: 'apparate', max: 1, icon: 'blink', desc: 'Blink 7.5m in the direction you face. Once per round.' },
  { id: 'finite', name: 'Finite Incantatem', price: 200, action: 'finite', max: 2, icon: 'ward', desc: 'Dispel your afflictions: fire, bleeding, slows, blinds.' },
  { id: 'vest', name: 'Dragonhide Vest', price: 700, action: null, max: 1, icon: 'vest', desc: 'Armor: takes 25% of every spell hit until it absorbs 55 damage. Survive and you keep it.' },
  { id: 'felix', name: 'Felix Felicis', price: 1000, action: null, max: 1, icon: 'luck', desc: 'Liquid luck: the next killing blow leaves you at 1 HP instead. One sip, one miracle.' },
  { id: 'portkey', name: 'Emergency Portkey', price: 350, action: 'portkey', max: 1, icon: 'portkey', desc: 'Channel 1.2s (interrupted by damage), then snap back to your spawn. One use.' },
];

export const equipById = (id) => EQUIPMENT.find((e) => e.id === id);

// --------------------------------------------------------------- ECONOMY ---
export const ECON = {
  start: 800, cap: 16000,
  winElim: 3250, winTime: 3250, winDefuse: 3250, winRelic: 3500,
  lossBase: 1400, lossStep: 500, lossMax: 3400, plantedLossBonus: 800,
  plant: 300, defuse: 300,
};

// ------------------------------------------------------------------ BOTS ---
// The bot brain is tuned along four human axes (0..100 each):
//   reflex — how fast they notice→turn→fire; aim — flick/settle/tracking error;
//   sense — vision cone/range, hearing, memory; iq — tactics, utility, saves.
// Presets are points in that space; "custom" exposes the sliders directly.
export const DIFFICULTIES = [
  { id: 'easy', name: 'Rookie', axes: { reflex: 10, aim: 8, sense: 18, iq: 12 },
    desc: 'Half-second reactions, wide sprays, tunnel vision. Learn the maps in peace.' },
  { id: 'normal', name: 'Regular', axes: { reflex: 38, aim: 34, sense: 42, iq: 38 },
    desc: 'Human reflexes (~350ms), loose tracking, basic teamwork. A fair scrim.' },
  { id: 'hard', name: 'Veteran', axes: { reflex: 62, aim: 58, sense: 64, iq: 64 },
    desc: 'Sharp ~250ms reactions, counter-strafing, trades kills, plays the economy.' },
  { id: 'expert', name: 'Expert', axes: { reflex: 82, aim: 78, sense: 82, iq: 84 },
    desc: 'Tournament reflexes, tight tracking, shields on reaction, full utility.' },
  { id: 'legend', name: 'Legend', axes: { reflex: 97, aim: 95, sense: 97, iq: 97 },
    desc: 'Inhuman: 170ms flicks, eyes in the back of their hood. You will be punished.' },
];

// Map the four 0..100 axes onto every concrete brain parameter.
export function aiProfile(axes) {
  const f = (k) => Math.min(100, Math.max(0, axes?.[k] ?? 50)) / 100;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rf = f('reflex'), am = f('aim'), se = f('sense'), iq = f('iq');
  return {
    axes: { reflex: rf * 100, aim: am * 100, sense: se * 100, iq: iq * 100 },
    // --- reflexes: the notice → orient → fire pipeline ---
    reactMean: lerp(0.62, 0.17, rf),   // s from recognition to first cast
    reactStd: lerp(0.20, 0.045, rf),   // human variance
    surprise: lerp(2.3, 1.25, rf),     // shot from behind: how much longer to process
    shieldReact: lerp(1.1, 0.26, rf),  // s to raise Protego against an incoming bolt
    turnSpeed: lerp(230, 720, rf),     // deg/s max camera swing
    // --- aim: a hand, not an aimbot ---
    settle: lerp(0.8, 0.15, am),       // s for the flick overshoot to decay
    flick: lerp(0.5, 0.1, am),         // overshoot fraction of the initial snap
    trackErr: lerp(3.6, 0.4, am),      // deg of wandering tracking error
    leadErr: lerp(0.55, 0.08, am),     // misjudgement of projectile lead
    headBias: lerp(0.1, 0.5, am),      // how often they go for the head
    counterStrafe: am > 0.45,          // stop to shoot accurately
    // --- senses: seeing and hearing like a person ---
    fovDot: lerp(0.42, 0.12, se),      // cos of half-FOV (~130° → ~166°)
    sightDist: lerp(38, 74, se),
    noticeMul: lerp(0.55, 2.6, se),    // recognition speed multiplier
    hear: lerp(10, 36, se),            // hearing radius baseline (m)
    cloakEye: lerp(2.5, 5.5, se),      // distance at which a cloak shimmer registers
    memoryT: lerp(3.5, 7.5, se),       // how long a "last seen there" stays actionable
    // --- tactics ---
    iq,
    util: lerp(0.12, 0.95, iq),
    strafe: lerp(0.3, 1.15, (rf + am) / 2),
  };
}

// --------------------------------------------------------- DISCIPLINES ---
// A "build" picked per match: one passive school of magic. Bots pick the one
// matching their playstyle; the human picks in match setup.
export const DISCIPLINES = [
  {
    id: 'duelist', name: 'Duelist', icon: 'bolt',
    boltSpeed: 1.12, parryBonus: 0.08,
    desc: 'Your bolts fly 12% faster and the Protego parry window is wider. Win the duel.',
  },
  {
    id: 'hexer', name: 'Hexer', icon: 'flame',
    dotMult: 1.3,
    desc: 'Your burns, bleeds and slows tick 30% harder and last 30% longer. Let them wither.',
  },
  {
    id: 'warden', name: 'Warden', icon: 'shield',
    drainMult: 0.65, wardMult: 1.3, blastResist: 0.85,
    desc: 'Protego drains 35% less mana, your Patronum wall is 30% larger, and blasts/fire hurt you 15% less.',
  },
  {
    id: 'phantom', name: 'Phantom', icon: 'blink',
    speedMult: 1.08, equipDiscount: 0.75,
    desc: '+8% move speed and equipment costs 25% less. Be where they least expect.',
  },
];

export const disciplineById = (id) => DISCIPLINES.find((d) => d.id === id) || null;

// --------------------------------------------------------- MATCH FORMATS ---
export const FORMATS = [
  { id: 'mr8', name: 'Short — first to 8', winTarget: 8, halftimeAfter: 8, maxRounds: 15, tie: false },
  { id: 'mr15', name: 'Full — first to 16 (15:15 tie allowed)', winTarget: 16, halftimeAfter: 15, maxRounds: 30, tie: true },
];

export const ROUND = {
  freeze: 5, time: 105, buyWindow: 20, fuse: 35, plantTime: 3.2, defuseTime: 6,
  endPause: 6, dmTime: 300, dmRespawn: 2.5,
};

// Blink Dash — the intrinsic, always-available mobility tool that gives the
// duel its footwork. A short directed burst on a cooldown; the iframe window
// lets a well-timed blink slip a bolt (even the Killing Curse). speed*dur is
// roughly the reach; rooted/petrified/snared wizards can't blink.
export const DASH = { speed: 26, dur: 0.22, cd: 4.5, iframe: 0.18, hop: 1.7 };

export const MAP_LIST = [
  // classics
  { id: 'dust2', name: 'Dust II', group: 'classic', desc: 'The classic. Long A, Mid Doors, B Tunnels.' },
  { id: 'dust', name: 'Dust', group: 'classic', desc: 'Underpass, the bridge, sweeping sand courtyards.' },
  { id: 'inferno', name: 'Inferno', group: 'classic', desc: 'Banana, Apartments, tight Mediterranean streets.' },
  { id: 'aztec', name: 'Aztec', group: 'classic', desc: 'Jungle stone, the rope bridge, water ditch.' },
  { id: 'mirage', name: 'Mirage', group: 'classic', desc: 'Palace, Apartments, the Window room. Blue doors, noon sun.' },
  { id: 'nuke', name: 'Nuke', group: 'classic', desc: 'Indoor silo hall, sunken B bunker, vents, the yard.' },
  // hogwarts
  { id: 'hall', name: 'The Great Hall', group: 'hogwarts', desc: 'House tables, side galleries, the dais — under an enchanted ceiling.' },
  { id: 'dungeons', name: 'The Dungeons', group: 'hogwarts', desc: 'Torch-lit corridors around the Potions classroom.' },
  { id: 'astronomy', name: 'Astronomy Tower', group: 'hogwarts', desc: 'A moonlit courtyard, cloisters, and the tower platform.' },
  { id: 'quidditch', name: 'Quidditch Pitch', group: 'hogwarts', desc: 'Open grass, team stands, golden hoops. Bring a broom.' },
  { id: 'hogsmeade', name: 'Hogsmeade', group: 'hogwarts', desc: 'A snowed-in high street, shop interiors, back alleys.' },
  { id: 'chamber', name: 'Chamber of Secrets', group: 'hogwarts', desc: 'Serpent pillars, a flooded channel, the statue dais.' },
  // the wider wizarding world
  { id: 'diagon', name: 'Diagon Alley', group: 'world', desc: 'The crooked shopping street: Ollivanders, the joke shop, dark Knockturn Alley.' },
  { id: 'gringotts', name: 'Gringotts', group: 'world', desc: 'Marble bank hall over deep vaults. Mind the dragon below.' },
  { id: 'ministry', name: 'Ministry Atrium', group: 'world', desc: 'The Fountain of Magical Brethren, floo fireplaces, the lift lobby.' },
];
