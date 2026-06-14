# DuelStrike — Optimization & Testing Spec

Draft spec for a focused pass on **performance**, **gameplay simulation**, **code
architecture**, and **testing**. Grounded in the current code (June 2026). Line
references point at the hot paths so each item is actionable without re-deriving
the diagnosis.

---

## 1. Context & goals

DuelStrike is a Three.js + Vite, fully-offline 5v5 FPS. Ten wizards cast,
particle storms layer up, fifteen maps. The engine has good bones — merged map
geometry, pooled bolt VFX, a GPU `Points` particle system, an `?auto` headless
mode, and a particle quality governor — but the heaviest costs are **not** the
ones currently being managed, and the test story is one ~1,100-line Playwright
soak script with no unit tests and no CI.

### Goals

1. Hold a stable 60 fps in a worst-case 5v5 firefight (ten wizards, smoke +
   incendio + wards live) on mid-range laptop iGPUs.
2. Cut per-frame allocations so GC pauses stop showing up as frame spikes.
3. Make the **simulation** testable in pure Node (no browser/WebGL), so logic
   can be unit-tested fast and deterministically.
4. Replace the single slow soak with a layered suite (unit + headless sim +
   integration smoke) wired into CI with explicit pass/fail and perf budgets.

### Non-goals

- No art/content rework, no new spells/maps, no gameplay-balance changes
  (behavior must stay identical unless a ticket explicitly says otherwise).
- No switch to a third-party physics or ECS framework. Keep the custom sim;
  refactor it in place.
- No multiplayer/netcode (determinism work here is for *testing*, not rollback).

### Success metrics

| Metric | Today (est.) | Target |
| --- | --- | --- |
| Draw calls, busy 5v5 | ~800–1200+ | < 350 |
| Frame time p99, busy 5v5 (mid iGPU) | spikes > 30 ms | < 16.6 ms |
| `new THREE.*` allocations / frame (10 bots) | many hundreds | < 30 |
| World raycast cost / frame | O(projectiles × all boxes) | O(projectiles × local cells) |
| Unit-testable sim modules | 0 | World, spells hit-resolution, economy, data |
| CI on push/PR | none | unit + headless sim, < 2 min |
| Full soak runtime | many minutes, manual | sharded, documented budget |

---

## 2. Performance

Severity tags: **P0** = causes the worst-case frame drops, **P1** = meaningful,
**P2** = cleanup / smaller wins.

### 2.1 GPU / draw calls

**P0 — Character rigs dominate draw calls.** `Player`'s `Rig` builds ~50–70
meshes, each with a freshly allocated `MeshLambertMaterial` via `mat()`
(`src/player.js:698`), plus a per-rig canvas sigil texture
(`src/player.js:662`). Ten wizards ≈ **500–700 draw calls and ~500 unique
materials** before any VFX.
- Cache materials by color key in a shared registry (two teams × N colors, not
  N × 10 instances). Share the team sigil texture (2 textures, not 10).
- Merge each rig's static, same-material parts into a few `BufferGeometry`
  groups; keep only the few animated parts (wand, arms, head) separate.
- Add distance/occlusion-aware visibility: a wizard fully behind walls or
  outside the frustum should skip rig animation work (see 2.4).
- Stretch goal: instanced rendering for shared body parts across champions.

**P0 — Sprites are unbatched.** The particle system pools 240 `THREE.Sprite`s
(`src/particles.js:94`); Three.js does not batch sprites, so heavy
smoke/incendio/charge scenes add tens of individual draw calls that the quality
governor never reduces (it only lowers *spawn rates*, not live sprites).
- Move sprite-class effects onto the existing GPU `Points` path (size + texture
  atlas via per-point attributes) or a custom instanced-quad shader.
- Until then: hard-cap concurrent sprites and have the governor scale that cap.

**P1 — Bolt VFX = ~7 draw calls each.** Each pooled bolt group has core, shell,
tail, 3 orbit spheres, optional ring (`src/effects.js:29`). 15 bolts ≈ 105 draw
calls. Reduce sub-meshes per bolt (fold orbit spheres into the shader / a single
additive sprite), or LOD distant bolts down to core + tail.

**P1 — Dynamic point-light count.** Up to ~8 torch lights
(`src/mapbuilder.js:896`) + 5 bolt + 5 flash + N ward lights
(`src/effects.js:386`) ≈ 18+ live point lights over `MeshLambertMaterial`
everywhere — fragment cost scales with lit surface × light count. Add a global
light budget with priority (nearest-to-camera wins) and let the governor shrink
it under load.

**P2 — `decor()` makes a new material per call** (`src/mapbuilder.js:587`), and
breakables/barrels are individual meshes. Route decor through the material cache
and merge static decor per material like the collider geometry already is
(`src/mapbuilder.js:839`).

**P2 — Renderer settings.** MSAA `antialias: true` at up to 1.35× DPR
(`src/main.js:38`) is the biggest fixed fill cost. Tie DPR + AA into the
governor (and unify with `performanceMode`, which today only touches DPR).
Particle `Points` are `frustumCulled = false` (`src/particles.js:90`) — fine for
a fixed buffer, but confirm.

### 2.2 CPU / GC (per-frame allocations)

**P0 — `eyePos()` / `lookDir()` / `aimDir()` allocate a new `Vector3` on every
call** (`src/player.js:179`). These are called from movement, hit tests, camera,
and especially bot perception. `Bot.senseEnemies` calls them per bot per enemy
(`src/bot.js:464`) → ~100+ Vector3 allocations/frame from eyes alone.
- Cache `eye`/`look`/`aim` as reusable `Vector3` fields on `Player`, recomputed
  once per frame in `update()`; have callers read the cached vectors.
- Add `eyePosInto(target)` / `lookDirInto(target)` variants for call sites that
  need a scratch value, backed by module-level scratch vectors (the bot module
  already does this partially with `V`/`V2`, `src/bot.js:24`).

**P0 — `particles.burst()` allocates `new THREE.Color` ×2 every call**
(`src/particles.js:136`), and bolt trails call `burst` every frame per flying
bolt (`src/effects.js:138`, `src/spells.js:326`). Accept numeric RGB or pooled
color objects; precompute spell colors once in `data.js`.

**P1 — Fire/ward/debuff FX churn `Vector3`/`clone()` on their tick timers**
(`src/effects.js:702`, `src/player.js:412`, `src/game.js:1268`). Convert to
scratch vectors / in-place math.

Deliverable: an allocation-counting harness (wrap `THREE.Vector3`/`Color` ctors
in a dev build, or use Chrome allocation profiler via the test browser) with a
per-frame budget assertion in the perf test (see 4.4).

### 2.3 Algorithmic / broadphase

**P0 — `World.raycast` is O(all boxes) with no spatial grid**
(`src/world.js:85`, the `for (const b of this.boxes)` at line 87). The grid
already exists and is used by `overlaps`/`candidates` (`src/world.js:62`) — but
**not** by `raycast`. Raycast is called per projectile per frame
(`src/spells.js:262`) and by every bot LOS check via `segmentClear`
(`src/world.js:128`). dust2 has 139 boxes; gringotts 152.
- Make `raycast` walk the grid (DDA/voxel traversal over `_grid` cells) so it
  only tests boxes along the ray. This is the single highest-leverage CPU fix.

**P0 — Projectile resolution is O(P × (boxes + players + wards + summons))**
(`src/spells.js:248`). After fixing raycast, add a broadphase for bolt-vs-player
(reuse the world grid or a simple per-frame player grid) so each bolt only tests
nearby wizards.

**P1 — Bot perception O(bots × players × raycast)** (`src/bot.js:467`). With the
grid raycast this drops a lot; additionally share one LOS query cache per frame
(many systems re-run the same `segmentClear` + `smokeBlocks` — see 3.3).

**P2 — `clashPass` is O(n²) over projectiles** (`src/spells.js:198`) with a
distance reject; fine at typical counts but cap projectile count and revisit if
it shows up in profiles.

### 2.4 Make the quality governor actually govern

Today the governor (`src/game.js:1109`) only scales `particles.quality`. Extend
it into a tiered LOD system that, under sustained load, also: lowers DPR/AA,
shrinks the point-light budget, caps live sprites, and reduces distant-rig
animation rate. Expose the active tier in the FPS HUD (`src/hud.js:931` already
shows `q`). Keep `performanceMode` as the manual floor for this system.

---

## 3. Gameplay simulation & architecture

The sim is correct and shares one movement/cast pipeline for bots and humans
(good). The problems are coupling and testability, not logic.

### 3.1 Separate simulation from presentation (enables §4)

`Game.update` interleaves sim with camera/HUD/audio (`src/game.js:1244`–`1246`),
`Player.update` interleaves movement with rig animation + particle spawns
(`src/player.js:412`), and projectile records embed their `fx` THREE group
(`src/spells.js:131`). Target structure:
- A **sim core** (`World`, movement, projectile integration + hit resolution,
  economy, round/objective state machine) that runs with **zero** Three.js,
  audio, HUD, or DOM dependencies and emits **events** (`hit`, `kill`, `plant`,
  `clash`, `cast`…).
- A **presentation layer** that subscribes to those events and owns rigs, VFX,
  camera, audio, HUD.
- `Player` splits into `PlayerSim` (state + movement + status) and `PlayerView`
  (Rig/FPRig). `Effects`' gameplay volumes (smoke LOS, fire damage zones, ward
  blocking) move into the sim core; only their visuals stay in presentation.

This is the big-ticket refactor; do it incrementally behind the events boundary
so behavior is preserved at each step (regression-checked by the soak).

### 3.2 Determinism for tests (not netcode)

Variable `dt` + heavy `Math.random()` (~53 calls in `bot.js`) + hitstop/slowmo
altering sim dt in normal play (`src/game.js:1120`) make replay impossible.
- Add a **fixed-timestep accumulator** option (e.g. 60 Hz sim steps with
  interpolation for render) selectable for tests; keep variable dt for shipping
  if preferred, but the sim core must accept a fixed dt.
- Route all randomness through a single **seedable PRNG** injected into the sim
  (replace bare `Math.random`/`rand`/`grand`/`shuffle` in `src/utils.js` and
  call sites). Seed via URL param for reproducible `?auto` runs.
- Hitstop/slowmo already disabled under `?auto` (`src/game.js:898`); keep the
  sim core unaware of cinematic time entirely (presentation-only).

### 3.3 De-duplicate LOS / perception

`segmentClear` + `smokeBlocks` is copy-pasted across `bot.senseEnemies`
(`src/bot.js:467`), human radar (`src/game.js:1218`), summon retarget
(`src/game.js:748`), and corpse notice (`src/bot.js:636`). Extract one
`visibility(a, b)` helper with an optional per-frame memo keyed by entity pair,
so the same pair isn't ray-tested by multiple systems in one frame.

### 3.4 AI scheduling

`think()` is already throttled to ~7.7 Hz (`src/bot.js:207`), but all bots that
are "due" can land on the same frame, and a due bot may run A* (up to 6000
iters) + O(players) raycasts + threat scan in one frame. Stagger think
phases across bots (offset each bot's `thinkT`) and/or time-slice A* across
frames so no single frame eats every bot's heavy work.

### 3.5 File-size / god-object cleanup (incremental)

`player.js` 1669 lines, `game.js` 1385, `bot.js` 1262. The sim/view split (3.1)
naturally carves these down. Additionally pull the economy/buy logic and the
round/objective state machine out of `Game` into focused modules. Treat this as
a by-product of 3.1, not a separate big-bang rewrite.

---

## 4. Testing

Replace "one giant Playwright soak + manual scripts, no CI" with a layered
pyramid. The `?auto` mode, `window.__game`, and `Game.autoMode` hooks already
make this feasible.

### 4.1 Unit tests (new — depends on 3.1 sim extraction)

Add `node:test` or Vitest. First targets, all pure today or after extraction:
- `src/data.js`: `aiProfile`, `charById`, `wandById`, discipline/perk math.
- `src/world.js`: `raycast` (correctness + the new grid path must match the
  brute-force result), `overlaps`, `moveBody` collision cases, A* pathfinding.
- Spell hit-resolution: hitzone math (`zoneFor`), `segVsSphere`, `segAABB`,
  damage multipliers, clash rules — against fixed inputs.
- Economy: buy costs with discounts/perks, round reward logic.
Budget: full unit run < 10 s, runs in plain Node.

### 4.2 Headless sim tests (new — depends on 3.1 + 3.2)

With the sim core decoupled from THREE, run **full matches in pure Node** with a
seeded PRNG and fixed timestep. Assert invariants and outcomes deterministically:
no NaN positions, round always resolves, plant/defuse transitions, economy never
negative, nav connectivity. Fast (no WebGL, no real timers) and reproducible by
seed. This absorbs most of what `soak.mjs` checks today, minus rendering.

### 4.3 Integration smoke (refactor of existing `soak.mjs`)

Keep a *thin* browser pass for things that genuinely need WebGL/DOM: boot every
map without console errors, HUD/buy/scoreboard render, pause/spectate, a short
real match. Split the monolith (`scripts/soak.mjs`, ~1,100 lines) into modules
sharing one Playwright harness; make it shardable so CI can parallelize. Adopt
`@playwright/test` for real reporting instead of the hand-rolled `check()`
(`scripts/soak.mjs:23`). Fix the port mismatch (soak defaults to 5174, Vite
serves 5173).

### 4.4 Performance regression test (new)

A headless scenario that spawns the worst-case 5v5 firefight, runs N frames, and
asserts: `renderer.info.render.calls` under budget, `triangles` under budget,
and the per-frame allocation counter (2.2) under budget. Fail CI on regression.
Capture `renderer.info` + the governor tier in the report.

### 4.5 Consolidate the `scripts/` folder

~15 of ~24 scripts are screenshot/debug throwaways. Promote the real audits
(`check-spawns.mjs`, `verify-slice.mjs`, `debug-nav.mjs`) into the test suite
with exit codes; move pure screenshot tools into a `scripts/shots/` subfolder
and out of the "tests" mental model. Optionally add baseline image comparison so
the shot scripts become visual-regression tests instead of eyeball checks.

### 4.6 CI

GitHub Actions (none today): on push/PR run unit (4.1) + headless sim (4.2) +
perf budget (4.4) — target < 2 min. Run the browser integration smoke (4.3)
nightly or on a label. Wire `npm test` to the fast tier.

---

## 5. Phased plan

Ordered so each phase ships value and de-risks the next. Behavior must stay
identical through Phases 1–2 (soak is the guardrail); Phase 3 is the structural
bet that unlocks real unit/sim testing.

**Phase 0 — Safety net (do first).**
Stand up `@playwright/test` around the existing soak so refactors are guarded;
add the allocation counter + a draw-call counter so wins are measurable. Wire a
minimal CI that just runs the current soak.

**Phase 1 — High-leverage perf, behavior-preserving.**
- Grid-accelerate `World.raycast` (2.3 P0) — biggest single win.
- Cache `eyePos/lookDir/aimDir` + `burst` color allocs (2.2 P0).
- Material/texture cache + sigil sharing for rigs (2.1 P0, big draw-call cut).
- Bolt-vs-player broadphase (2.3 P0).
Measure against Phase 0 counters; expect the largest frame-time gains here.

**Phase 2 — Rendering LOD + governor.**
Sprite batching (2.1 P0), light budget (2.1 P1), rig merging + visibility
culling (2.1 P0/2.4), governor → full LOD tiers incl. DPR/AA (2.4).

**Phase 3 — Sim/presentation split + determinism.**
Extract the sim core and event bus (3.1), seedable PRNG + fixed-step option
(3.2), de-dupe LOS (3.3), stagger/slice AI (3.4). This is the prerequisite for
real unit + headless-sim testing.

**Phase 4 — Test pyramid + CI.**
Unit tests (4.1), headless sim tests (4.2), perf regression (4.4), soak split +
shard (4.3), scripts cleanup (4.5), full CI (4.6).

---

## 6. Risks & open questions

- **Refactor risk (Phase 3):** the sim/view split is large. Mitigation: do it
  behind the event boundary in small steps, keep the soak green at each step,
  land it last.
- **Behavior drift:** any allocation/broadphase change must produce identical
  hit results. The grid raycast should be diff-tested against the brute-force
  version on real map box sets (4.1).
- **Open:** target hardware floor for the 60 fps goal? (Sets governor tiers and
  draw-call budget.)
- **Open:** keep variable dt for shipping and only fix-step for tests, or move
  the whole game to fixed-step? (Affects feel; needs a play test.)
- **Open:** is instanced character rendering worth it, or is material caching +
  merging enough to hit the draw-call budget?
