# DuelStrike 1.6 — Hogwarts Duels

A fully offline, first-person wizard dueling game with Counter-Strike 1.6 rules:
round-based 5v5 (Order of the Phoenix vs Death Eaters), a plant/dispel objective
(the Cursed Relic), an economy with buy phases, a sixteen-champion roster with
hand-pickable lineups on both sides, personality-driven bots, and fifteen maps:
six blockout remakes of classic CS layouts plus nine original wizarding-world
battlegrounds.

Built with Three.js + Vite. All textures, sounds, and announcer stingers are
synthesized at runtime — no CDN or external assets.

## Run it

```bash
git clone https://github.com/char-boomer-remakes/wizard-duel.git
cd wizard-duel
npm install
npm start
```

That opens `http://localhost:5173` in your browser. Everything runs locally.

On Windows? See [WINDOWS.md](WINDOWS.md) for setup steps.

## How to play

- **Objective (Cursed Relic):** Death Eaters attack — carry the Relic to site A
  or B and hold **E** to plant. The Order defends — eliminate the attackers, run
  the clock, or hold **E** on a planted Relic to dispel it with Finite
  Incantatem. First to 8 rounds wins; sides swap at halftime.
- **Deathmatch:** team kill race with every spell unlocked.

## Multiplayer (beta)

Host a deathmatch and a few friends can join over the internet by room code.

```bash
npm run relay     # terminal 1 — the dumb relay server (ws://localhost:8787)
npm start         # terminal 2 — the game
```

In the game: **MULTIPLAYER → HOST GAME** prints a four-letter room code and a
share link (`?room=CODE`). Friends open that link (or type the code under
**JOIN**), then the host hits **START DEATHMATCH**. Empty slots fill with bots.

**How it works.** The relay is a dumb message forwarder — it holds no game
logic, just rooms keyed by code. One browser is the **host**: it runs the
authoritative simulation (bots, the match timer, damage, score) and streams a
~15 Hz snapshot. Every client drives its own wizard locally and broadcasts its
transform ~20 Hz; casts are replicated so everyone sees the bolts. Hits are
self-reported to the host (a friends-only trust model).

**Production.** Build with `VITE_RELAY_URL=wss://your-relay-host` so the client
talks to your deployed relay instead of `ws://localhost:8787`. See
[`server/README.md`](server/README.md) for deploy notes.

**Current limits (Phase 1).** Deathmatch only (no Relic objective). No
reconnect — if the host leaves, the match ends. Damage-over-time effects
(bleed/burn) from a remote player's spells aren't replicated yet.

### Maps

**The classics** — Dust II, Dust, Inferno, Aztec, Mirage, and Nuke blockouts
follow their CS 1.6 layouts: real chokes and route names (Long A, Catwalk,
upper/lower Tunnels, Banana, Apartments, Palace, Squeaky…), painted A/B site
markers, team-colored spawn pads with a banner at each spawn, and a radar that
shows sites, spawns, teammates, and the dropped/planted Relic. Nuke is the
indoor showpiece: a tall silo hall over site A, a sunken B bunker reached by
the big terraced ramp (or a one-way vent drop), and an outdoor yard with
shipping containers.

**Hogwarts** — six more battlegrounds with their own architecture and light:

- **The Great Hall** — four house tables down the nave, arcaded side
  galleries, the head-table dais under a self-lit *enchanted ceiling* of stars.
- **The Dungeons** — torch-lit corridor ring around the Potions classroom and
  the ingredient storeroom; green sconces, all interior.
- **Astronomy Tower** — a moonlit courtyard map: stars, a cratered moon,
  cloisters, and a raised tower platform with telescopes.
- **Quidditch Pitch** — open grass, equipment sheds, team stands at both ends,
  golden goal hoops. Brooms were made for this one.
- **Hogsmeade** — a snowed-in high street between timber shopfronts (the Three
  Broomsticks taproom is site A), back alleys, gas lamps, and firs.
- **Chamber of Secrets** — serpent-pillared vault with a flooded channel,
  stepping stones, and the statue dais.

**The wider wizarding world** — three more battlegrounds beyond the castle:

- **Diagon Alley** — the crooked brick shopping street from the Leaky Cauldron
  to the Gringotts facade. Site A is the Ollivanders yard; site B is the
  Borgin & Burkes junction, fed by the dark covered flank of **Knockturn
  Alley** (green lamps, low ceiling).
- **Gringotts** — a white-marble banking hall with teller-counter islands over
  a rough-rock vault level 3m down. Site A hides behind the counters; site B
  is the deep vault, reached by the west stairs or the goblins' cart tunnel.
  The Ironbelly circles over the courtyard out front — leave it alone.
- **Ministry Atrium** — peacock-blue tile, gilded arcades, floo fireplaces
  burning green down both galleries, and the Fountain of Magical Brethren
  mid-map (wadeable — and an awful place to be flashed). Site A sits behind
  the golden gates of the lift lobby; site B is the Department of Mysteries
  behind the black door.

Every map now has a real **sky**: a painted dome with sun or moon, drifting
clouds, and stars at night, tuned per theme (noon glare on Mirage, overcast
slab over Nuke, deep night over the Astronomy Tower). Indoor spaces have true
**ceilings** — tunnels, apartments, silo halls, taprooms — with interior
lighting so roofed rooms read like rooms, and the radar skips roofs so
interiors stay visible on the minimap.

### Controls (rebindable in Settings)

| Input | Action |
| --- | --- |
| WASD + mouse | Move / look (pointer lock) |
| Shift (hold) | Walk — silent footsteps, tighter spread |
| LMB | Cast spell |
| RMB (hold) | Protego shield (drains mana) |
| 1–5 / wheel | Switch spells |
| R | Recharge magic (reload) |
| Space / Ctrl | Jump / crouch (crouch-jump climbs crates) |
| B | Buy menu (during buy time) |
| E | Plant / defuse / use / loot a wand |
| Q / F / G / V | Potion / cloak / apparate / emergency portkey |
| C | Broomstick — hold a direction to fly, Space climbs, Ctrl dives |
| X | Finite Incantatem (self-cleanse) |
| Tab | Scoreboard |

**Scoreboard (Tab):** hold Tab during a match for a CS-style stat sheet — K/A/D,
headshot kills, damage dealt, plants + dispels, round-MVP stars (★), current
money, and a round-history strip (☠ elimination, ⏱ time expired, ✦ relic
dispelled, ✸ relic detonated).
The ◆ marker shows who is carrying the Cursed Relic; hover a row to read that
champion's personality blurb.

### Spells

Stupefy (rifle), Avada Kedavra (charged one-hit AWP), Expelliarmus (2s disarm),
Petrificus Totalus (body-bind), Impedimenta (snare jinx), Silencio (anti-cast
hex), Bombarda (HE), Lumos Maxima (flash), Fumos (smoke), Incendio (molotov),
Expecto Patronum (ward wall), Serpensortia (hunting snake), Protego (shield),
plus Snape's exclusive Sectumsempra bleed bolt. All spells are projectiles
with travel time; your own Bombarda/Incendio can hurt you.

**The hex school (slot 3)** — four disables, each with different counterplay:
Expelliarmus knocks the wand out of your hands (sprint to it to recover
early), Petrificus binds you solid until a hard hit shatters it, Impedimenta
snares — 45% slower, no jumping, cleansable with Finite — and Silencio steals
your voice: no casting *and no Protego* for 2.4s, but your legs still work.
Silencio interrupts a charging Avada and shuts down a turtled shield; bots
save it for exactly those moments.

### Recoil, accuracy, and the scope

Spread works like CS 1.6: every cast **blooms** your spread and kicks your aim
up a touch, and the crosshair opens up to show it — tap or burst instead of
spraying. Bolts follow the **punched view** — recoil is honest, the spell goes
where the crosshair points, and pulling down mid-spray genuinely compensates.
Movement state stacks on top: running is loose, walking or crouching is tight,
jumping is a prayer, and casting from a broom is wild. **Charging Avada
Kedavra scopes your view in** (slower turn speed while zoomed) — it plays like
a wizard AWP.

Damage is locational, CS 1.6 style. Every wizard has five hit zones:

| Zone    | Damage         | Extra                        |
| ------- | -------------- | ---------------------------- |
| Head    | 2× (spell hs)  | distinct crack + killfeed ◎  |
| Chest   | 1×             |                              |
| Stomach | 1.15×          |                              |
| Arm     | 0.85×          |                              |
| Leg     | 0.7×           | victim stumbles briefly      |

The head is a sphere riding above the body box; legs/stomach/chest split the
box by height and arms are the outer chest band relative to the victim's
facing. Avada Kedavra ignores zones — any touch kills.

### Spell-on-spell combat

Magic collides with magic:

- **Bolt clashes** — opposing bolts that cross paths annihilate in a white
  flash with both spell colors thrown out. **Avada Kedavra burns through**
  lesser bolts and keeps going — don't try to trade with it.
- **Shoot down grenades** — a bolt striking an enemy lob (Bombarda, Lumos,
  Fumos…) detonates it mid-air, wherever it happens to be.
- **Fumos snuffs Incendio** — a smoke landing on cursed fire extinguishes it
  with a hiss of steam (classic smoke-vs-molly).
- **Water puts you out** — wading into Aztec's ditch clears a burn.
- **Protego parries, Patronum walls** — see Defensive play below.

### Disciplines (your build for the match)

Pick one school of magic in match setup; it shapes your whole match:

- **Duelist** — bolts fly 12% faster, wider Protego parry window.
- **Hexer** — your burns/bleeds/slows tick 30% harder and last 30% longer.
- **Warden** — Protego drains 35% less, a 30% bigger Patronum wall, 15% less
  blast/fire damage taken.
- **Phantom** — +8% move speed and 25% cheaper equipment.

Bots pick the discipline that fits their personality (Voldemort duels, Snape
hexes, Ron wards, Draco ghosts around).

### Bot AI: difficulty and personalities

Five difficulty tiers (Easy → Normal → Hard → Expert → **Legend**) scale
reaction time, aim error, utility usage, movement, and hearing range — with
per-bot skill jitter so no two teammates play identically.

On top of difficulty, every character has a **personality** that drives where
and how they fight (shown on the champion card in setup):

- **Harry** — entry duelist: first through the door, trades for teammates.
- **Hermione** — support: stocks a full grenade belt, follows the pack.
- **Ron** — anchor: plants his feet on the site and soaks damage.
- **Luna** — wildcard: odd routes, shows up where no one is looking.
- **Dumbledore** — the wall: unhurried, holds the door behind endless Protego.
- **McGonagall** — discipline: binds the entry man and slows the second.
- **Ginny** — second entry: a blast, a hex, and the site is hers.
- **Neville** — the last man standing: hardest to kill when it matters most.
- **Snape** — lurker: takes the long flank, buys cloaks, punishes rotations.
- **Bellatrix** — berserker: sprints at you, fights at knife range, no retreat.
- **Voldemort** — the AWPer: holds long angles with a charged Avada.
- **Draco** — baiter: fights beside teammates, bails when a duel sours.
- **Lucius** — old money: fights from the second rank, banks every kill.
- **Greyback** — predator: point-blank, eats the wounded, gets faster doing it.
- **Umbridge** — surveillance: files a report on everywhere you hide.
- **Wormtail** — the rat: never first, never seen, always behind you.

Personalities decide route choice (lurkers take the long way around), push
timing (cautious bots stagger behind the entry), preferred fight range,
when to retreat, what to buy, peeks off held angles, trading a nearby
teammate's death, and stale-duel flanking instead of endless staring
contests.

Each champion also has a **signature spell** they favor buying (Harry → Lumos
Maxima, Hermione → Impedimenta, Ron → Expecto Patronum, Luna → Fumos, Snape →
Silencio, Bellatrix → Incendio, Voldemort → Serpensortia, Draco → Petrificus
Totalus…) and distinct visual signatures on their model (Harry's scar and house
scarf, Hermione's satchel and time-turner, Luna's Spectrespecs, Dumbledore's
great silver beard and half-moon spectacles, McGonagall's emerald witch hat and
tartan sash, Ginny's ponytail and keeper pads, Neville's Mimbulus sprig,
Snape's high collar, Bellatrix's corset lacing, Voldemort's serpentine nose
slits, Draco's prefect badge, Lucius's serpent cane and fur collar, Greyback's
mane, scars and claws, Umbridge's curls, bow and pink brooch, Wormtail's
balding cower and silver hand).

### Champion perks

Every champion carries a unique perk, implemented in the combat sim:

| Champion | Perk |
| --- | --- |
| Harry | Expelliarmus costs 50% less mana, recovers 60% faster |
| Hermione | Recharge (R) refills twice as fast |
| Ron | 25% less blast/fire damage |
| Luna | 60% flash resistance, radar pings linger +2s |
| Dumbledore | Protego drains 40% less, 50% wider parry window |
| McGonagall | Petrificus holds 40% longer, slot-3 hexes carry +1 charge |
| Ginny | Bombarda blasts 25% wider, free Impedimenta each round |
| Neville | Below 35% HP: +25% damage out, −15% damage in |
| Snape | Sectumsempra replaces Stupefy — a bleeding bolt |
| Bellatrix | Bolt hits Crucio-slow victims 25% for 1.5s |
| Voldemort | Avada charges 35% faster, costs 20% less |
| Draco | 20% discount on every purchase |
| Lucius | Kills pay +150 G, living squadmates collect +50 G |
| Greyback | Kills feed: +35 HP and +15% speed for 4s |
| Umbridge | Hex hits brand victims on the squad radar 4s, Silencio +50% |
| Wormtail | Silent footsteps, free Invisibility Cloak each round |

### Pick your lineups

In match setup, below the champion grid, two **LINEUP** boxes let you hand-pick
which characters fight beside you and which you face — any mix from either
side. Unpicked slots auto-fill with wizards of that team's own allegiance
first. No character appears twice in a match; bots keep their personalities
and perks whichever side they fight for.

Bots are also **aware** of the world, not just what's in their crosshair:

- **Hearing** — running footsteps and casts mark your position on the enemy
  team's shared memory; walk (Shift) to move silently.
- **Corpses** — a bot that spots a fresh teammate's body marks the killer's
  last position and calls it on the radio ("Granger down — long A!").
- **Radio** — contact and intel callouts from your teammates appear as radio
  notices, so you get the same information the bots share.
- **Search behavior** — lose sight of a target and bots push to the last-seen
  spot and sweep the angles instead of forgetting you existed.
- Lurkers walk silently when closing on known enemy positions, and desperate
  bots will portkey out of a losing fight.

### Defensive play

Combat isn't just trading bolts — there's a defensive toolkit:

- **Protego (RMB)** — hold to raise a mana-draining shield that soaks hits.
  **Perfect block:** raise it within a quarter-second of a bolt landing and the
  bolt is *parried* — reflected back at the caster with a gold flash. A parry
  kill is the flashiest play in the game.
- **Expecto Patronum (slot 5, 500 G)** — conjure a glowing guardian wall ~8m
  wide for 6 seconds. Enemy spells splash harmlessly against it; yours pass
  through. Cuts off a push, covers a dispel, walls off a retake.
- **Petrificus Totalus (slot 3, 600 G)** — body-bind bolt: the victim locks up
  as a stone statue for 1.6s (can't move, cast, or shield). A solid hit (18+
  damage) shatters the bind early, so follow up fast or use the window to
  reposition.
- **Finite Incantatem (X, 250 G)** — self-cleanse that strips burn, bleed, and
  slow, and clears most of a flash. Carry one against Incendio/Sectumsempra
  lineups.

Bots buy and use all of these — expect defenders to wall chokepoints and
Bellatrix to bind you mid-push.

### Equipment and movement kit

Beyond spells, the shop sells equipment — some persistent, some one-shot:

- **Dragonhide Vest (700 G)** — armor: soaks 25% of every hit until it has
  absorbed 60 damage, then shatters. Survive the round and you keep it.
- **Felix Felicis (1000 G)** — liquid luck: the next killing blow leaves you at
  1 HP instead. One sip, one miracle.
- **Emergency Portkey (350 G, V)** — channel 1.2s (any damage interrupts),
  then snap back to your spawn. A lurker's escape hatch.
- **Broomstick (500 G, C)** — a flight tank, not a one-shot: 4.5s of fuel that
  refills every round. Steer where you look, Space climbs, Ctrl dives; dismount
  to bank the fuel you didn't burn and remount whenever. Casting mid-air is
  wildly inaccurate. Bought once, kept until you die.
- **Healing Potion (300 G, Q)** — restores 55 HP over 2.75s; strong sustain,
  weak to burst.
- **Invisibility Cloak (500 G, F)** — vanish for 5.2s; casting breaks it.
- **Apparition Charm (450 G, G)** — blink 8m where you face, outreaching the
  intrinsic dash; once per round.
- **Finite Incantatem (200 G, X)** — dispel your own fire, bleeds, slows,
  blinds, and polymorphs; two charges.

### Serpensortia and loot drops

- **Serpensortia (550 G, slot 5)** — conjures a snake that slithers after the
  nearest enemy and strikes once for 24 + a slow. It has 30 HP and can be shot
  down; bots will call it out and panic-fire at it.
- **The fallen drop loot** — every kill drops the victim's wand plus a piece
  of their kit (a grenade or potion). Walk over a grenade/potion to scavenge
  it; wands show a `[E] Take…` prompt so you don't swap by accident. Upgrading
  off a dead Death Eater's Elder Wand mid-round is very on-theme.

### On-hit effects

Every spell does something distinct to the victim — you always see *what* hit
you (color-coded screen flash) and *feel* it:

- **Stupefy** — knockback + a brief stagger; red body flash; screen jolt.
- **Avada Kedavra** — instant kill; the body flashes green and ragdolls with a
  green smoke wisp.
- **Expelliarmus** — the victim's wand physically flies out and lands nearby;
  they fumble empty-handed until they grab it (walk over it) or it returns
  after 2s. Disarmed bots sprint for their wand.
- **Bombarda** — distance-scaled blast knockback; near the center you're bowled
  off your feet; ears ring and audio muffles.
- **Lumos Maxima** — white-out fade based on whether you faced the flash, with
  muffled audio while blind.
- **Incendio** — victims ignite: body flames, damage ticks, burning footprints,
  orange screen-edge glow.
- **Sectumsempra** — bleed ticks with a dripping blood trail and pulsing red
  screen edges.
- **Crucio (Bellatrix's perk)** — 30% slow for 1.5s with purple crackle and a
  writhing flinch.
- **Petrificus Totalus** — the victim turns grey and freezes mid-pose as a
  statue with crumbling stone dust; their screen desaturates behind a stone
  vignette until the bind breaks.
- **Protego** — bolts splash and refract off the bubble; blocked hits nudge the
  shield-bearer back. Perfect blocks ring out with a gold parry flash.

Corpses take the killing blow's momentum (rigid ragdoll launch), low health
adds a heartbeat, and the announcer calls **first blood** (+150 G) and
multi-kills (double / triple / quad / ACE).

### Graphics

Filmic (ACES) tone mapping, distinct character models (hair, faces, robes,
proportions, team sigils and shoulder pads per champion), per-character wands
in first and third person, layered bolt visuals (hot core + colored shell +
halo rings on disarm/bind bolts) with dynamic lights on the first few bolts in
flight, charge-up glows visible on enemy wands, muzzle flashes, and full
victim feedback effects.

### HUD

The in-match interface is a frosted-glass design system: one top module with
team alive-pips, scores, the round timer and phase label; a glass radar tile;
pill-shaped killfeed rows; a vitals panel with slim glowing health/mana bars
and big numerals; rounded spell slots that lift and glow gold when active
(showing true mana costs after your champion's discounts); and matching glass
styling across the buy menu, scoreboard, notices, and setup screens.

### Useful URL params (dev)

`?auto=1&map=dust2&mode=relic&team=order&char=hermione&diff=legend&disc=warden`
skips the menus and starts a match directly. Add
`&squad=ginny,neville&foes=greyback,umbridge` to hand-pick the lineups.

### Dev test scripts

With the dev server running (`npm start`):

```bash
npx playwright install chromium-headless-shell   # once
npm run soak        # headless smoke+soak suite: all 15 maps, match, defuse, DM, on-hit FX, defensive kit, clashes/disciplines/AI, hit zones, recoil/zoom/items/drops/summons, pause+spectate, env set pieces, hexes, scoreboard stats, roster lineups + champion perks
npm run nav-audit   # navmesh connectivity report per map (node scripts/debug-nav.mjs [base] [mapsCsv])
# node scripts/check-spawns.mjs [base]  — spawn/timing audit (defenders must beat attackers to sites)
# node scripts/map-shots.mjs [base] [mapsCsv]  — screenshots of map vantages
node scripts/check-spawns.mjs  # spawn audit: ground/clearance/facing/nav + defender-first site timings
node scripts/fx-shots.mjs    # staged screenshots of on-hit effects → shots/
node scripts/def-shots.mjs   # staged screenshots of the defensive kit → shots/
node scripts/v2-shots.mjs    # champion lineup, bolt visuals, clash, setup menu → shots/
node scripts/v3-shots.mjs    # staged screenshots: Avada scope, snake, loot drops, broom flight
node scripts/shot.mjs        # screenshots of the glass HUD, buy menu, scoreboard, setup screen
node scripts/rigshot.mjs     # lineup portrait of the new character models
node scripts/debug-brain.mjs # dump attacker-bot decision state mid-round
node scripts/net-smoke.mjs   # two-client multiplayer smoke: presence, bot snapshot, host-authoritative damage round-trip (spawns its own relay; needs the dev server)
node scripts/visual-audit.mjs # Playwright per-map visual + collision audit: walks all 15 maps and flags blocked spawns, low ceilings, unreachable sites, and console errors; writes screenshots + report.json to artifacts/
```

## Performance

Map geometry is merged into a handful of draw calls, projectiles/particles are
pooled, and a quality governor automatically scales particle budgets to hold
60 fps even with ten wizards casting at once.
