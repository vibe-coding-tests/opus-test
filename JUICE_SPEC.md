# WizardStrike — Game Feel & Spell Identity Spec ("Make It Sing")

Draft spec for a major pass on **game feel, special effects, audio, and UI/UX** —
the "dopamine layer." Every spell should be identifiable by its **look**, its
**sound**, and how it **feels** to cast and to be hit by. The big moments (kills,
headshots, parries, aces, explosions) should hit hard and reward the player.
Grounded in the current code (June 2026); line references point at the exact hooks
so each item is actionable.

This is a companion to `OPTIMIZATION_SPEC.md` — that spec makes the frame cheap,
this one spends some of that budget on impact. §7 reconciles the two.

---

## 1. Context & goals

WizardStrike already has a real juice foundation, which is why it's worth pushing
hard: screen shake (`src/game.js:890`), hitstop + slow-mo behind a `juice` setting
(`src/game.js:898`/`src/main.js:15`), CS-style view-punch that bolts follow
(`src/player.js:66`, `src/spells.js:153`), an Avada FOV-scope (`src/game.js:1346`),
ACES filmic tone mapping (`src/main.js:44`), a GPU `Points` + sprite particle
system (`src/particles.js`), fully synthesized spatial audio (`src/audio.js`),
color-coded hit feedback + status vignettes (`src/hud.js`, `src/style.css:306`),
and an animated first-person wand rig with charge glow (`src/player.js:1522`).

The problem isn't that juice is missing — it's that it's **uniform and restrained**:

- **Spells are color-swapped, not distinct.** Every bolt is built from one template
  (`acquireBolt`, `src/effects.js:26`) with a color + a couple of silhouette scale
  tweaks; every trail is the same `trailTick` burst (`src/effects.js:138`); every
  non-Avada muzzle is the same `muzzle` (`src/effects.js:145`). Stupefy, Sectumsempra,
  and Impedimenta read as "red dot / white dot / blue dot."
- **Casts sound thin.** Each cast is a ~0.12–0.16 s synth blip (`cast_stupefy`,
  `src/audio.js:146`). There's no weight on the heavy spells, no tail, no space —
  the room tone is a single filtered-noise bed (`ambient`, `src/audio.js:483`) with
  no reverb send, so impacts feel dry and small.
- **No bloom / post.** ACES is on, but additive cores only fake glow. There is no
  `EffectComposer` anywhere in `src/`. Magic *should* bloom.
- **Shake is primitive.** `Math.random()` jitter with linear decay
  (`src/game.js:1357`) — no trauma curve, no direction, no smooth noise. It reads
  as "vibration," not "impact."
- **The HUD is beautiful but static.** The frosted-glass system (`src/style.css:24`)
  doesn't react: the HP bar doesn't flinch on hit, mana doesn't tell you when a cast
  just became affordable, slots don't pop on switch, kills aren't celebrated beyond
  a killfeed row and an announcer line.

### Goals

1. **Spell identity.** Each offensive spell passes two blind tests: identifiable by
   **silhouette alone** (no color) and by **sound alone** (no picture).
2. **Impact.** Landing a hit, a headshot, a kill, a parry, or an explosion fires a
   coordinated multi-channel burst (visual + audio + camera + HUD) tuned to the
   moment's weight — restrained on chip damage, overwhelming on an ace.
3. **A reactive HUD.** The interface responds to the fight: damage, affordability,
   spell switches, kills, streaks, and clutch states all get felt, not just shown.
4. **One place to tune it.** Centralize the scattered juice calls behind a
   `Feedback` event layer so feel is data-driven and adjustable, not sprinkled
   across `game.js`/`spells.js`/`effects.js`.
5. **Accessible by default.** Everything strong is behind a slider; ship a sane
   default, a "Competitive" low-distraction preset, and a reduce-flashing toggle.

### Non-goals

- **No balance / gameplay changes.** Damage, mana, timings, hitboxes, AI stay
  identical. This is feel and presentation only. (Where a feel hook needs a sim
  value — e.g. spell "weight" — it reads existing data, it doesn't change it.)
- **No external assets.** Everything stays synthesized/procedural and offline:
  WebAudio for sound, canvas/shaders for texture, no CDN, no audio files, no
  sprite sheets shipped as binaries.
- **No engine swap.** Stay on Three.js + the custom particle system; add the
  postprocessing modules Three already ships (`three/addons/postprocessing/*`).

### Success metrics

| Dimension | Today | Target |
| --- | --- | --- |
| Spells distinguishable by silhouette (color-blind test) | ~3 of 13 | all 13 bolts/lobs |
| Spells distinguishable by cast sound alone | ~4 of 13 | all 13 |
| Feedback channels on a kill | 3 (killfeed, stinger, hitstop) | 6+ (｜+ crosshair, kill card, HUD pulse, shake, screen grade) |
| Distinct impact materials (stone/wood/metal/flesh/water) | 2 (`impact`, `impact_flesh`) | 5 |
| Post / bloom | none | thresholded bloom, governor-tiered |
| Audio space (reverb) | none (dry) | per-map convolver send |
| Juice tuning surface | scattered literals across 4 files | one `Feedback` table + settings |
| Accessibility controls | `juice` on/off, FOV | shake %, flash reduction, bloom, motion, palette |

---

## 2. Pillar A — LOOK (VFX)

Severity: **P0** = headline dopamine, **P1** = strong, **P2** = polish.

### A1. Post-processing stack — bloom is the single biggest win (**P0**)

There is no `EffectComposer` today; the renderer draws straight to screen
(`src/main.js:216`). Add a composer with a **thresholded `UnrealBloomPass`** so the
additive bolt cores, charge tips, fire, wards, and explosions *actually* bloom
instead of faking it with sprites.

- Pipeline: `RenderPass` → `UnrealBloomPass` (high threshold so only emissive magic
  blooms, not the whole scene) → optional subtle vignette + a hair of chromatic
  aberration on the edges → output. Keep ACES where it is (`src/main.js:44`).
- Drive bloom strength from events: a short bloom *swell* on Avada release, parries,
  and explosions (the composer's strength is a cheap thing to animate).
- This recolors the entire game as "magical" for one pass of work. It is the
  highest LOOK-per-effort item in the spec.
- **Perf:** a full-screen pass at up to 1.35× DPR is real cost on iGPUs → render
  bloom at half-res, expose a toggle, and let the governor drop it first (§7).

### A2. Per-spell projectile archetypes (**P0**)

Replace the "one bolt, recolored" model (`acquireBolt`, `src/effects.js:26`) with a
small set of **archetypes** selected by `spell.fxKind`, so each spell has a
silhouette. Keep the pool; pool per archetype. Proposed identities:

| Spell | Projectile identity |
| --- | --- |
| Stupefy | Tight crackling **electric bolt** — forked micro-arcs, fast strobe core |
| Sectumsempra | A spinning **crescent blade** — flat, edge-lit, leaves a thin slash ribbon |
| Avada Kedavra | A roiling **green skull-comet** — heavy, slow-rolling, drinks light around it (local vignette), thick smoke wake |
| Expelliarmus | A loose **disarming spiral** — orange double-helix, wobbling ring |
| Petrificus | A heavy **stone rune** — angular, slow, dim, grinding dust trail |
| Impedimenta | A **snare web** — blue tangle that trails sticky threads |
| Silencio | A **void mote** — dark core, *negative* glow that dims its surroundings |
| Bombarda | A tumbling **iron charge** with sputtering fuse sparks |
| Incendio | A tumbling **fireball** shedding embers + heat shimmer |
| Lumos | A **white star** that gets painfully bright on the way |
| Fumos | A dull **canister** wobbling, hissing a thin pre-smoke |
| Patronum | A **silver wisp** with a stag-antler flicker in the glow |
| Episkey | A soft **green seed** of light, gentle and slow |

Distinct **muzzle flashes** per archetype (the uniform `muzzle`,
`src/effects.js:145`, becomes archetype-driven) and distinct cast tells at the wand
tip (the FP tip already takes spell color, `src/player.js:1612`).

### A3. Real trails (**P1**)

Every bolt currently emits the same point burst (`trailTick`, `src/effects.js:138`).
Add a **ribbon/streak trail** option (additive triangle strip following recent
positions) for the darting bolts, keep particle wakes for the heavy/smoky ones, and
vary density/length/color2 per archetype. A Sectumsempra slash and an Avada drag
should not leave the same confetti.

### A4. Impact identity (**P1**)

`impact` (`src/effects.js:167`) is one generic spark + decal for all world hits.
Branch impacts on **surface × spell**: stone chips + dust puff, wood splinters,
metal sparks + ring, water splash crown (the splash hook already exists,
`src/spells.js:335`), flesh already special-cased (`fleshImpact`,
`src/effects.js:177`). Each impact drops a **brief colored point-light** (reuse the
flash-light pool, `src/particles.js:220`) so hits *paint* the wall for a frame.
Spell-flavored residue: Incendio scorches, Petrificus leaves a frost/stone splat,
Stupefy a quick scorch-ring.

### A5. Explosions worth the name (**P0** — the user said "explosions")

`explode` (`src/effects.js:185`) is a solid two-burst + flash. Make Bombarda and the
relic detonation (`relicExplode`, `src/effects.js:675`) *events*:

1. white **core flash** (instant, blooms via A1),
2. a **fireball** that expands and darkens to smoke,
3. an expanding **shockwave ring** (a thin additive torus/decal that races out),
4. **debris + embers** thrown on ballistic arcs (extend the existing bursts),
5. a **heat-shimmer / distortion** ring (cheap screen-space ripple, or a refractive
   sprite) — optional, governor-gated,
6. **dust settling** after, and a scorch decal (already present).

Pair with the camera (C1/C3) and audio (B1/B3) so a Bombarda near you is an *event*,
not a pop.

### A6. Death & status spectacle (**P1**)

Deaths reuse one `deathBurst` (`src/effects.js:611`). Make the killing spell write
the death:

- **Avada** → the body flashes green and **disintegrates into drifting ash** (the
  `avadaWisp` already gestures at this, `src/effects.js:524`).
- **Petrificus kill / shatter** → the victim **bursts into stone chunks** (the
  combo `shatter` path exists, `src/spells.js:463`).
- **Bombarda** → hard ragdoll launch (already has `lastHit` momentum,
  `src/game.js:439`) + scorch + a puff of robe scraps.
- **Sectumsempra** → a heavier blood mist on the finishing hit.

### A7. Ambient world life (**P2**)

Small touches that make the world feel charged: floating motes/dust in light shafts,
wards casting moving caustics, fire throwing flicker light further (partly present,
`src/effects.js:709`), and the Avada scope tinting the world sickly green as it
charges. Cheap, atmospheric, governor-gated.

---

## 3. Pillar B — SOUND

The synth engine is good bones (`_tone`/`_noise`, `src/audio.js:118`/`:101`) but the
voices are short and dry. Give them **weight, identity, and space**.

### B1. Layered cast model (**P0**)

Casts are single short voices (`src/audio.js:146`). Move to a **transient + body +
tail** envelope per spell:

- **transient** — the snap/crack at t0 (what you have now),
- **body** — a short sustain that carries the spell's character (a buzzing saw for
  Stupefy, a metallic ring for Sectum, a detuned bass swell for Avada),
- **tail** — a quick decay into the reverb send (B2) so it *rings out in the room*.

Add a low **sub-thump** layer to heavy casts (Avada, Bombarda, Petrificus) — the
single most effective "this is powerful" cue.

### B2. Per-map reverb send (**P0**)

There is no reverb anywhere — every sound is dry (`_out`, `src/audio.js:88`). Add one
**`ConvolverNode`** on a shared send bus, with a **synthesized impulse response**
(decaying filtered noise) tuned per map theme — long stone tail for the Great Hall /
Gringotts / Chamber, tight and dead for tunnels/bunkers, airy and short outdoors.
Wire it alongside the existing `ambient` theme switch (`src/audio.js:483`). One node,
massive perceived-quality jump: spells, footsteps, and explosions suddenly sit *in a
place*.

### B3. Distinct spell voices (**P0**)

Match the visual archetypes (A2) one-to-one in sound. A target sketch:

| Spell | Sound signature |
| --- | --- |
| Stupefy | dry electric *zap* + saw buzz body |
| Sectumsempra | metal *shing* (bandpass ring) + air slice |
| Avada Kedavra | detuned sub swell + dissonant choir-ish pad + a sucking pre-cast |
| Expelliarmus | rising *whorl* (it already sweeps up, `src/audio.js:160`) — keep, add tail |
| Petrificus | low stone *thunk* + grinding noise |
| Impedimenta | wet rubbery *boing* descending |
| Silencio | a swell that **collapses into silence** (it ducks the bus for a beat) |
| Bombarda (throw / blast) | hefty *whump* underhand + a real boom (`explosion`, `src/audio.js:227`) |
| Incendio | gas *whoosh* ignite |
| Lumos | bright airy *fwoom* |
| Fumos | pressurized hiss |
| Patronum | choral shimmer (already nice, `src/audio.js:362`) |

### B4. Spatial & material polish (**P1**)

- **Air absorption:** distant sounds already attenuate (`_spatial`,
  `src/audio.js:76`); add a distance-driven low-pass so far casts go dull, not just
  quiet.
- **Occlusion:** reuse the LOS/`smokeBlocks` data the sim already computes to muffle
  sounds behind walls (the muffle filter exists, `setMuffle`, `src/audio.js:46`).
- **Bolt whoosh / doppler:** a near-miss bolt should *whoosh* past with a pitch
  bend — visceral and informative (tells you how close that was).
- **Underwater:** low-pass the whole bus while the listener is in water (the world
  already knows water, `waterAt`, used at `src/spells.js:336`).

### B5. Impact materiality (**P1**)

Split the single `impact` voice (`src/audio.js:213`) into **stone / wood / metal /
flesh / water**, chosen by the surface that A4 already resolves. Headshots and kills
already have distinct cues (`headshot`, `src/audio.js:223`) — keep and reinforce.

### B6. Feedback audio escalation (**P1**)

Layer the confirmation sounds by weight: body hit → headshot ring → kill *thunk* →
multi-kill rising motif → ace fanfare (`stinger`, `src/audio.js:455` already has the
motifs; wire them to the escalation in C/D). Parry already rings beautifully
(`parry`, `src/audio.js:324`).

### B7. Adaptive intensity bed (**P2, stretch**)

A subtle music/percussion layer that rises with on-screen action (live players,
recent casts) and drops in the lull — built from the same synth primitives. Optional
and fully mutable; listed for completeness.

---

## 4. Pillar C — FEEL (camera, time, haptics)

### C1. Trauma-based screen shake (**P0**)

Replace the random-jitter shake (`src/game.js:1357`) with a **trauma model**:
events add `trauma` (0..1, clamped); the per-frame offset is `trauma²` × max-amp
sampled from **smooth noise** (time-scrolled), with separate positional and
rotational terms and a constant decay. Add a **directional kick** so a hit from the
left shoves the view right. Trauma per event lives in the `Feedback` table (§6) and
scales by `settings.shake` (§5). This alone makes every existing shake feel
intentional instead of buzzy.

### C2. Camera feel layer (**P1**)

The view is rigid except for punch + shake. Add (all small, all toggleable):

- **landing dip** — a quick downward bob on ground contact (the `land` sound already
  fires; the camera doesn't move),
- **cast micro-kick** — a tiny positional/FOV nudge per cast, scaled by `spell.recoil`
  (`src/data.js`), distinct from the existing aim-punch,
- **directional hit kick** — knockback nudges the camera, not just velocity,
- **strafe roll** — a subtle bank into lateral movement (**off** in the Competitive
  preset),
- **broom tilt** — bank/pitch with flight input for a sense of speed.

### C3. Hitstop tuning + impact frames (**P1**)

Hitstop/slow-mo exist (`src/game.js:898`) and already fire on Avada kills, parries,
shatters, aces. Make them **graded** by event weight via the `Feedback` table, add a
**freeze-frame + brief zoom** on a round-ending blow (a mini kill-cam beat), and make
sure every "meaty" hit (headshot, heavy spell) gets a 1–2 frame stop. Keep all of it
behind `settings.juice` and disabled under `?auto` (already handled,
`src/game.js:898`).

### C4. Wand viewmodel juice (**P1**)

The `FPRig` already bobs, sways, builds a charge glow, and plays flick/lob/recharge
anims (`src/player.js:1601`–`:1652`). Extend it, don't replace it:

- **per-spell recoil kick** scaled by `spell.recoil` — Stupefy ticks, Avada *heaves*,
- **per-spell cast poses** (a two-handed brace for Avada; a flick for Stupefy; a
  side-arm slash for Sectum),
- a **pre-cast spark** at the tip the instant before release,
- **low-mana flicker** on the tip when you can't afford the held spell,
- a wisp of **smoke off the tip** after heavy casts.

### C5. Haptics (**P2**)

If a **Gamepad** is connected, drive its rumble from the same `Feedback` events
(hits, casts, explosions, low-HP heartbeat). Pure addition; no-op on keyboard/mouse.

### C6. Clutch & low-HP cinematics (**P1**)

Some of this exists (low-HP pain overlay `src/style.css:299`, `heartbeat`
`src/audio.js:320`). Promote it to a state: when you're the last alive in a 1vX or
under ~25 HP, layer a subtle **desaturation + edge vignette + heartbeat + muffled
world**, and clear it on resolve. Makes the dramatic moments *feel* dramatic.

---

## 5. Pillar D — UI / UX

The glass design system (`src/style.css:24`) is the foundation; make it **react**.

### D1. Reactive vitals (**P0**)

In `HUD.update` (`src/hud.js:721`) the bars just set width. Add:

- HP bar **flinch** (quick shake + white flash) on damage, with a **"ghost" trail**
  that lags behind the real value so you see how much you just lost,
- mana bar **pulse** the moment a held spell becomes affordable (you *feel* "I can
  cast now"),
- low-HP HP bar already pulses (`src/style.css:385`) — add a vignette tie-in (C6),
- **money count-up** with a soft *ding* on reward (kills, plant), instead of a silent
  number swap (`src/hud.js:732`).

### D2. Dynamic crosshair (**P0**)

The crosshair already blooms with spread (`applyCrosshair`, `src/hud.js:280`). Add
**hit confirmation**: a quick inward pop + color flash on a confirmed hit, a stronger
**gold pop on a kill**, and a distinct **headshot** tick. The hitmarker exists
(`hitmarker`, `src/hud.js:313`) — escalate it (size/color/sound) by hit weight.

### D3. Kill banners & feed (**P1**)

- Killfeed rows currently just appear (`killfeed`, `src/hud.js:376`) — have them
  **slam in** and the icon flash on a headshot.
- A brief **kill card** ("ELIMINATED — Bellatrix", with the spell icon) on your own
  kills.
- **Streak banners** escalate visually, not just by stinger: DOUBLE → TRIPLE → QUAD →
  ACE get progressively bigger/brighter treatment (the announcer text + stingers are
  already wired, `src/game.js:502`).

### D4. Damage numbers with character (**P1**)

`damageNumber` (`src/hud.js:417`) rises and fades; HS is bigger (`src/style.css:520`).
Add: **color by severity** (chip → heavy → lethal), **combine** rapid hits on one
target into a stacking total, and a small **combo flourish** when the combo system
fires (`comboFX` already exists, `src/spells.js:470`).

### D5. Menu & buy juice (**P2**)

Hover/click/buy sounds exist (`ui`, `src/audio.js:438`). Add card **press**
animation, an **affordability shimmer** on cards you can now afford, and a satisfying
**purchase "ka-ching"** with a card flip/checkmark. Round start/win/lose already have
stingers (`src/audio.js:464`); add matching screen treatment.

### D6. Spell readability (**P1**)

With louder VFX comes a readability duty: a compact **spell-color legend** (optional
HUD chip), clearer **incoming-spell tells** (the color-coded hit flash already does
this, `victimFeedback`, `src/game.js:553`), and consistent color language across
bolt / impact / vignette / killfeed for each spell.

### D7. Accessibility & presets (**P0** — ship with the juice, not after)

A new **Feel** settings group (extends `DEFAULT_SETTINGS`, `src/main.js:10`):

- **Screen shake** 0–150% slider,
- **Reduce flashing** (caps flash/strobe brightness and bloom swells — important for
  photosensitivity; Lumos and Avada are the offenders),
- **Bloom** on/off + intensity,
- **Reduce motion** (disables strafe roll, view bob, count-ups),
- **Colorblind spell palettes** (remap the per-spell colors in `data.js` to a
  distinguishable set),
- A one-click **"Competitive"** preset (minimal shake, no roll/bob, fast feedback,
  bloom low) and a **"Cinematic"** preset (everything on).

---

## 6. Architecture — a `Feedback` (juice) layer

Today juice is **scattered**: `game.js` calls `shake`/`hitstop`/`slowmo` inline
(`src/game.js:445`, `:559`, `:619`), `spells.js` triggers hitstop on parry/combo
(`src/spells.js:376`, `:475`), and `effects.js` plays audio directly from VFX
functions. Tuning "how a headshot feels" means editing four files.

**Proposal:** a single `Feedback` module that maps a small **event taxonomy** to
bundles of reactions, driven by a data table:

```
feedback.emit('headshot', { pos, victim, attacker, spell })
  → shake(trauma) + hitstop(t) + audio(layered) + crosshair pop
    + dmg number style + HUD pulse + (gamepad rumble)
```

- **Event taxonomy:** `cast`, `impact`, `headshot`, `kill`, `multikill`, `parry`,
  `clash`, `explosion`, `flash`, `ignite`, `petrify`, `disarm`, `lowHP`, `clutch`,
  `roundStart`, `roundEnd`, `purchase`…
- **Data-driven table:** each event → `{ trauma, hitstop, slowmo, bloomSwell, sound,
  crosshair, hudPulse, rumble }`, all scaled by the §5 settings. One file to balance
  the entire feel of the game.
- **Respects** `settings.juice` + the new granular toggles + the governor (§7), in
  one place instead of per-call-site `if`s.
- **Aligns with `OPTIMIZATION_SPEC.md` §3.1.** That refactor proposes a sim→view
  **event bus** (`hit`, `kill`, `clash`, `cast`…). `Feedback` should be *the*
  consumer of that bus: the sim emits facts, `Feedback` turns facts into juice. Build
  them together and they reinforce each other; the events this spec needs are the
  same events that spec already wants to emit.

This keeps the dopamine **tunable and centralized**, and makes "turn it down for
competitive" / "turn it up for a trailer" a config change, not a code hunt.

---

## 7. Performance — reconciling with `OPTIMIZATION_SPEC.md`

The optimization spec targets `< 350` draw calls and a stable 60 fps on mid iGPUs.
New spectacle must not blow that budget. Rules for this work:

- **Bloom/post is a fixed fill cost.** Render bloom **half-res**, gate it behind the
  toggle (D7), and make it the **first thing the quality governor drops**
  (`OPTIMIZATION_SPEC.md` §2.4, `src/game.js` governor). One composer, not a stack of
  passes.
- **All new VFX use pools.** Ribbon trails, shockwave rings, debris, and per-archetype
  bolts extend the existing pools (`src/effects.js`/`src/particles.js`); spawn counts
  scale with `particles.quality` like everything else. No per-event `new THREE.*` in
  the hot path (the opt spec is already hunting those, §2.2).
- **Share the light budget.** Per-impact flash lights (A4) draw from the *same*
  pooled light budget the opt spec wants to cap (§2.1 P1) — they don't add a new
  uncapped source.
- **Audio is nearly free.** One convolver + a few more oscillators per cast is
  trivial CPU; the existing node-GC sweep (`_sweep`, `src/audio.js:64`) already
  handles teardown. Keep using it.
- **Camera/HUD feel is ~free.** Trauma shake, view kicks, and CSS/DOM HUD reactions
  cost effectively nothing.

Net: the only items that need active perf governance are **bloom** and the **extra
particle volume** in explosions — both already covered by the governor mechanism the
opt spec is building. Do the cheap perf wins (opt spec Phase 1) *before or alongside*
the heavy LOOK items so there's headroom to spend.

---

## 8. Phased plan

Ordered so each phase ships something playable and the cheap, safe feel-wins land
first. No phase changes gameplay; the soak suite is the guardrail.

**Phase 0 — Scaffolding & settings.**
Stand up the `Feedback` module (route the *existing* shake/hitstop/slowmo calls
through it, no behavior change yet) and the **Feel settings group + presets** (D7).
Low risk, unlocks tuning for everything after.

**Phase 1 — FEEL (cheap, huge).**
Trauma shake (C1), camera feel layer (C2), hitstop grading + round-end freeze (C3),
reactive vitals + dynamic crosshair (D1/D2). No new assets, near-zero perf cost,
biggest feel-per-effort.

**Phase 2 — LOOK headliners.**
Bloom/post stack (A1) + governor wiring (§7), per-spell muzzle/trail/projectile
archetypes (A2/A3), impact identity (A4). This is the visual transformation.

**Phase 3 — SOUND overhaul.**
Layered casts (B1), per-map reverb send (B2), distinct spell voices (B3), spatial +
material polish (B4/B5), feedback escalation (B6).

**Phase 4 — UI/UX reward layer.**
Kill banners + feed slam (D3), damage-number character + combo flourish (D4), menu/buy
juice (D5), readability/legend (D6).

**Phase 5 — Spectacle & drama.**
Big explosions (A5), death/status spectacle (A6), clutch/low-HP cinematics (C6),
ambient world life (A7), haptics (C5), adaptive bed (B7, if pursued).

---

## 9. Risks & open questions

- **Over-juice hurts competitive readability.** Mitigation: every strong effect is on
  a slider, defaults are tasteful, and the **Competitive preset** tones the spectacle
  down. The blind-test metrics (§1) keep clarity honest — louder must not mean less
  legible.
- **Photosensitivity.** Lumos and Avada flash hard; bloom swells amplify it. The
  **reduce-flashing** toggle (D7) is a ship requirement, not a nice-to-have.
- **Bloom on weak iGPUs.** Half-res + governor-first-to-drop + toggle (§7). Open: what
  hardware floor sets the default-on threshold? (Shared with the opt spec's open
  hardware question.)
- **Sequencing vs. the big refactor.** `Feedback` wants the sim→view event bus from
  `OPTIMIZATION_SPEC.md` §3.1. Open: build `Feedback` first against today's call sites
  and migrate it onto the bus later, or land the bus first? (Recommendation: build
  `Feedback` now wrapping existing calls — Phase 0 — so feel work proceeds, then point
  it at the bus when that lands.)
- **Synth reverb quality.** A noise-IR convolver is convincing but not a real space.
  Open: is one IR per theme enough, or do a few maps want bespoke IRs?
- **Scope.** This is large. It's structured so Phases 0–1 alone already make the game
  feel dramatically better; later phases are independently shippable.

---

## 10. Appendix — per-spell identity cards

The contract for §2/§3/§4: each spell's **look / sound / feel**, terse. (Color stays
as in `src/data.js`; identity comes from silhouette + motion + voice, not just hue.)

| Spell | LOOK | SOUND | FEEL (caster → victim) |
| --- | --- | --- | --- |
| **Stupefy** | strobing forked bolt, thin streak trail | dry zap + saw buzz | light tick recoil → red flash + jolt |
| **Sectumsempra** | spinning crescent blade, slash ribbon | metal shing + air slice | side-arm flick → red mist + bleed pulse |
| **Avada Kedavra** | green skull-comet, light-drinking, smoke wake | sub swell + dissonant pad + pre-suck | heavy two-hand heave, big hitstop → green disintegration |
| **Expelliarmus** | orange spiral + wobble ring | rising whorl + tail | flick → wand spins away, victim fumble shake |
| **Petrificus** | angular stone rune, dust trail | stone thunk + grind | weighty cast → grey-out, statue, shatter on hit |
| **Impedimenta** | blue snare web, sticky threads | wet boing | flick → blue web vignette, heavy steps |
| **Silencio** | dark void mote, negative glow | swell that collapses to silence | hush cast → world mutes for victim |
| **Serpensortia** | (summon) coiling conjure burst | conjuring hiss | ground-cast → snake; bite = sharp strike |
| **Bombarda** | tumbling iron + fuse sparks | underhand whump → boom | lob arc → shockwave, ragdoll, ears ring |
| **Lumos** | searing white star | bright fwoom | lob → white-out (flash-safe capped) |
| **Fumos** | wobbling canister, pre-hiss | pressurized hiss | lob → smoke wall |
| **Incendio** | tumbling fireball + embers | gas whoosh ignite | lob → fire pool, ignite, orange edges |
| **Patronum** | silver wisp, antler flicker | choral shimmer | lob → guardian wall hum |
| **Episkey** | soft green light-seed | gentle chime | lob → heal sparkle on allies |
| **Protego** | (existing bubble) refraction splash | hum / hit / break | hold → block; perfect = gold parry ring + bell |
