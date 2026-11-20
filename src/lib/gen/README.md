# `src/lib/gen/` — script synthesis

Pure ES modules (no DOM, no deps) that **synthesise** script (the effects layer that modulates tracked motion instead is `../fx.js`, below): stroke shapes, pattern generators, recipes,
the plan → script compiler, and loop tiling. Everything returns a valid `Script` (`core/script.js`):
`[{at:int ms, pos:int 0..100}]`, strictly increasing `at`, **pos 0 = deepest, 100 = out**. Inputs are never
mutated. Everything random is seeded and deterministic.

```js
import { compilePlan, recompileSegment, applyPlan, RECIPES, KINDS, recipeSchema, GENERATORS, tile, retile, extractCycle } from '../lib/gen/index.js';
```

| File | Contents |
|---|---|
| `shapes.js` | `SHAPES` (stroke-shape vocabulary), `resolveShape`, `strokePoints`, `knotSlope` |
| `generators.js` | `GENERATORS` registry + one export per generator, `KNOT_STROKE_FIT`, `TREMOR_FIT`, `finish`, `followTimes`, `prepTurns`, `COMMON_SCHEMA` |
| `recipes.js` | **`RECIPES`** (the table to edit), **`KINDS`**, `CLIMAX_FIT`, `recipeSchema`, `recipesFor`, `resolveSegment` |
| `plan.js` | `compilePlan`, `recompileSegment`, `validatePlan`, `applyPlan` |
| `loops.js` | `tile`, `retile`, `extractCycle` |
| `util.js` | `DEFAULTS`, seeded RNG (`mulberry32`, `hashSeed`), `CURVES`, `mix`, `limitSpeed`, `blend`, `joinPlan`, `humanize`, `maxStepSpeed` |

## Conventions

- **Range**: `lo` = deep end, `hi` = out end (`lo <= hi`; swapped if given reversed). Generators stay inside it.
- **Rate**: `turns/s` (a turn = one extreme; 2 turns = 1 stroke). Any generator with `rate` also accepts
  `spm` (strokes/min, `= 30 × turns/s`).
- **Direction**: `start: 'in'` = the first move goes toward deep (pos falling); `'out'` the reverse.
- **Anchor**: when depth shrinks (intensity, fades, ramps, the speed cap, depth jitter) strokes shrink
  toward `anchor`: `'hi'` (keeps the out end — shallower strokes; default), `'lo'` (keeps the deep end — the
  climax run-in and the orgasm use this), `'mid'`.
- **Speed cap**: `ctx.maxSpeed` (default **450 pos/s**, the owner's scripts). A too-fast half-stroke shrinks
  toward the anchor (its shape's peak speed counted); a final integer pass guarantees no step exceeds it.
  Exception by design: a generator may give single moves their own allowance. `knot-stroke`'s pops move at
  up to `popSpeed` (600 pos/s by default, above the global cap), because in the owner's scripts the pop *is*
  the speed spike. `popSpeed: 0` puts them back under the global cap.
- **minGapMs** (default **20**, the smallest interval some devices accept; pass the device profile's value): no two points closer, inside a segment and across every join. Turning points win over shape points; a turn within
  `minGapMs` of an edge slides onto the edge, so the first point is at `t0` and the last at `t1` exactly.
  A span shorter than `minGapMs` collapses to one point.
- **Rate aliases**: `spm` is used only when `rate` is not given in the params. `phase` is a fraction of a
  full stroke (0.5 = one stroke = two turns later).
- `intensity: 0` gives a flat line at the anchor (depth × 0).

### Generator signature

```js
gen(t0, t1, params, ctx) -> Script      // every point has t0 <= at <= t1; exact interpolated points at both edges
```

`GENERATORS[id] = { id, label, description, schema, gen }`. Missing params take the schema defaults.

### `ctx` (shared by generators, `compilePlan`, `applyPlan`)

| field | default | meaning |
|---|---|---|
| `seed` | `0` | plan seed. `compilePlan` derives each segment's seed as `hashSeed(seed, seg.id)` (so seeds survive reordering/editing other segments) |
| `maxSpeed` | `450` | pos/s cap (0 = off) |
| `minGapMs` | `20` | minimum spacing between points, also across segment joins (use the device profile's minimum interval) |
| `blendMs` | `300` | how far from a segment boundary points may be removed to make the join respect the cap (widened automatically to what always suffices: `50000 / maxSpeed` ms) |
| `turns` | `[]` | tracker turning points `[{at, kind?}]` or `[ms]`; kind `'top'/'out'/'hi'/1` or `'bottom'/'in'/'lo'/-1`; missing kinds alternate. Used by `follow`, `knot` (timing `auto`/`follow`) |
| `beats` / `taps` | `[]` | `[ms]` or `[{at}]` for `beats` |
| `intensity` | `1` | multiplies every segment's `intensity` |
| `invert` | `false` | XORed with each segment's `invert` |

### Param schema (for UI forms)

`[{ key, label, type, default, min?, max?, step?, choices?, unit? }]`, `type` ∈ `number | int | bool | choice | shape | json`.
`shape` values are a name (`'sine'`) **or** an object (`{name:'two-speed', ratio:2, at:0.5, prob:0.25}`) —
show `value.name ?? value` in a dropdown of `choices`; `SHAPES[name].params` is the schema of its own knobs.
`recipeSchema(recipeId)` = the generator's schema with the recipe's defaults filled in.

### Common params (every generator except `hold`)

| key | default | |
|---|---|---|
| `intensity` | 1 | 0..1. Depth × intensity (toward the anchor); every `turns/s` param × `(0.5 + 0.5·intensity)` |
| `invert` | false | pos → 100 − pos |
| `anchor` | `'hi'` | see above (`pulses`, `tremor`: `'lo'`, `smooth`: `'mid'`) |
| `fadeFrom`, `fadeTo`, `fadeCurve` | 1, 1, linear | depth envelope across the span (fade in/out on any generator, incl. `follow`) |
| `jitterTime` | 0 | humanise: turning points move by up to this × the shorter neighbouring half-stroke (seeded) |
| `jitterAmp` | 0 | humanise: depth shrinks by up to this × travel, toward the anchor (seeded; never leaves the range) |
| `seed` | 0 | extra seed for this segment's variation |

## Stroke shapes (`SHAPES`)

A shape is the profile of one half-stroke as interior knots `[u (time frac), v (travel frac)]` — the points
are the motion (devices interpolate linearly).

| name | params | |
|---|---|---|
| `linear` | – | no extra points |
| `sine` | `samples` 3 | ease in and out |
| `ease-in` | `power` 2, `samples` 2 | slow start, fast arrival |
| `ease-out` | `power` 2, `samples` 2 | fast start, slow arrival |
| `two-speed` | `ratio` 2 (speed before / after), `at` 0.5 (break, time frac) | one mid-stroke point |
| `bounce` | `amount` 0.12 | arrives early, rebounds, settles (stays in range) |
| `hold-top` / `hold-bottom` / `hold-both` | `dwell` 0.3 | dwell at that end for `dwell` of the half-stroke |
| `custom` | `knots` | explicit `[[u, v], …]` |

Spec modifiers: `dir: 'in'|'out'` (only that direction), `prob: 0..1` (seeded share of half-strokes),
or `{ in: spec, out: spec }`. **Fast-in / slow-out** (timing asymmetry) is `inFrac` on `strokes`/`ramp`
(share of each stroke spent going in: 0.35 = fast in, slow out), because it moves the turning point.

## Generators (`GENERATORS`)

| id | params (defaults) | what it does |
|---|---|---|
| `hold` | `pos` 100 | stays put |
| `strokes` | `rate` 2.4, `lo` 0, `hi` 85, `shape` linear, `start` in, `phase` 0 (cycle frac), `inFrac` 0.5 | constant-rate strokes |
| `ramp` | `rate0` 1.2 → `rate1` 2.4, `amp0` 0.2 → `amp1` 1 (frac of range, toward anchor), `curve` ease-in-out (`linear`, `ease-in`, `ease-out`, `exp` = geometric, `step`), range, shape sine, start, phase, inFrac | accelerando / ritardando / fade-in / fade-out (rate and depth together) |
| `smooth` | `lo` 55, `hi` 95, `amp` 14, `rate` 1.4, `driftMs` 9000, `variation` 0.25, shape sine | small sine strokes whose centre drifts slowly inside the band |
| `pulses` | `rate` 6.8 → `rateEnd` 4.2 over `decayMs` 15000 (`decayCurve` ease-in-out), `lo` 1, `hi` 34, `amp` 23 → `ampEnd` 20, `ampJitter` 0.25, `deepJitter` 2 | classic orgasm pulses (recipe `orgasm-pulses`, the pre-split `climax`): abrupt fast shallow pulses at the deep end, no holds |
| `tremor` | `lo` 0, `hi` 40, `amp` 20, `periodMs` 333, `holdMs` 67, `pulseMs` 6000, `pulseAmp` 20, `pulseCount` 4, `pulseHalfMs` 50, `restMs` 183 → `restEndMs` 183 | **orgasm**, fitted (below): deep-end flutter `0,10,5,15,10,20,10,15,5,10,0` + hold every 333 ms, then for the last `pulseMs` bursts of decaying pulses (20, 15, 10, 5) with a rest at the bottom |
| `follow` | range, shape, start, `carry` true, `gapFactor` 3, `gapMinMs` 1500, `fallbackRate` 2.4, `minHalfMs` 60, `contextMs` 10000 | extremes at `ctx.turns`; gaps > max(3 × local half-stroke, 1.5 s) and the edges carried at the local rate (turns within ±10 s); pairs closer than `minHalfMs` thinned; nothing nearby → `fallbackRate` |
| `knot-stroke` | `rate` 1.85 (one cycle = 2 turns ≈ 1083 ms), `lo` 0, `hi` 80 (top), `knotOut` 17, `popTo` 64, `knotIn` 30, `press` 20, `fPull` .270, `fPopOut` .077, `fTop` .132, `fDown` .326, `fPress` .157, `fPopIn` .038, `popScale` 0, `popSpeed` 600, `variation` 1, `timing` auto (+ follow's params) | **knot on every stroke** (below). The default for `knotting` |
| `knot` | `lo` 0, `hi` 85, `knotLevel` 30, `rate` 2.4, `between` 4, `pressMs` 160, `pushMs` 650, `resist` 0.6, `dwellMs` 450, `grind` 3, `pullMs` 260, `popMs` 140, `tied` false, `popsBeforeTie` 2, `tiedAmp` 10, `tiedRate` 2, `timing` auto (+ follow's params) | knot pop (below) |
| `tease` | `lo` 0, `hi` 95, `rate` 2, `edge` 0.3, `every` 3, `dip` 0.7, `pauseMs` 350, `full` 0.15, `variation` 0.2, shape sine | shallow strokes at the out edge; every few, a dip that stops short, pauses, retreats (sometimes goes all the way) |
| `tease-top` | `lo` 80, `hi` 100, `rate` 0.67, `periodJitter` 0.2, `ampJitter` 0.3, `pause` 0.12, shape sine | slow shallow eased strokes at the top of the band, seeded length / depth variation, now and then a held stroke (Autorange's dead-gap fill, recipe `tease-top`) |
| `beats` | range, shape, start, `mode` alternate/hit, `every` 1, `offsetMs` 0, `outFrac` 0.5; times from `params.times` / `ctx.beats` / `ctx.taps` | extremes on tap/beat times; `hit` = every beat a deep hit. Covers only the beats (plus one interval on each side), not necessarily all of `[t0, t1]` |

`follow` turn kinds: the parity of unlabelled turns comes from the first labelled turn in the whole
`ctx.turns` list (or `start` when none is labelled), so it does not change when a segment moves.
`smooth`: the centre drift adds to the stroke, so consecutive extremes can differ by a little more than `amp`.

**Knot on every stroke** (`knot-stroke`, recipe `knot-pop-stroke`, the `knotting` default). Fitted from the
owner's own hand-made knot scripting (10 full cycles; the fit is `KNOT_STROKE_FIT` in `generators.js`).
Every stroke passes the knot. One cycle has six moves, starting at full depth:

| # | move | to pos | share of cycle (median, range) | at a longer/shorter cycle |
|---|---|---|---|---|
| 1 | pull out against the knot (slow) | `knotOut` 17 | 0.270 (0.19–0.31) | takes 47.5% of the change |
| 2 | pop out (near-instant) | `popTo` 64 | 0.077 — always 83 ms, ≈ 566 pos/s | fixed |
| 3 | rise to the top | `hi` 80 | 0.132 (0.12–0.16) | 11.9% |
| 4 | back down to the knot | `knotIn` 30 (29–33, sd 1.2) | 0.326 (0.23–0.37) | 31.7% |
| 5 | press against the knot (slow) | `press` 20 | 0.157 (0.13–0.23) | 8.9% |
| 6 | pop in (near-instant) | `lo` 0 | 0.038 — always 41.5 ms, ≈ 482 pos/s | fixed |

The cycle is 1083 ms median (875–1375, relative sd 0.164). In the reference the two pops last exactly
83 ms and 41.5 ms on every cycle, and the slow moves absorb all the variation in cycle length (regression
slopes above). The generator does the same. Pops keep their duration (`popScale` 0; 1 makes everything scale
with the cycle), and the slow moves share the difference by those weights. A pop is lengthened only if
it would exceed `popSpeed`. All moves are linear (no shape points), as in the reference.
`variation` 1 reproduces the measured spread (seeded): cycle length ±28% uniform (sd 0.164) in rate
mode, and the knot-in level ±2.1 (sd 1.22). The other levels never vary.
Timing: `auto` uses `ctx.turns` when present. Then each tracked bottom → top → bottom pair is one cycle:
depth lands on the bottom turn and the top on the top turn, and the six-point shape is fitted inside each
half (moves 1–3 in the out half, 4–6 in the in half). Otherwise `rate` is used.

**Knot pop, held back** (`knot`, recipes `knot-pop-held` and `knot-tied`): `between` shallow bumps from `hi` down to `knotLevel` (two-speed: fast approach, slowing as it
presses on the knot) → approach → press 3 below the knot for `pressMs` → push through to `lo` over `pushMs`
(spends `resist` of the time on the first quarter of the travel, then slips) → dwell `dwellMs` at depth with
`grind`-pos micro-strokes → resisted pull (ease-in) to halfway up the knot → pop out to `hi` (fast, settles).
Every move is lengthened if needed so it never exceeds the speed cap (the pop is as fast as the cap allows).
`tied`: after `popsBeforeTie` pops, the next push stays in: `tiedAmp`-deep tugging at `tiedRate` until the
segment ends. `timing: auto` takes the bump times from `ctx.turns` when there are any (else `rate`).

**Orgasm pulses, classic** (`pulses`): abrupt switch (no fade; at the boundary the outgoing segment yields), turns at 6.8/s easing to 4.2/s
over 15 s; bottoms at `lo` + up to `deepJitter`, tops at bottom + `amp`·(1 ± `ampJitter`) capped at `hi`.

### Climax, orgasm, afterglow (fit)

Owner: "orgasms need to be separated from climaxes — in my reference it's fast climax, then orgasm". Measured on
the numbers of the 10 scripts of the owner's reference set (pos 0 = deepest; turn = direction
change, a plateau counted once; rates in turns/s, 2 turns = 1 stroke). Candidates came from `av_climax.script_climax`
and a scan for fast motion confined to pos 0–45, then each was read point by point. Seven orgasms are clear:

| clip | run-in (the "fast climax") | orgasm | after |
|---|---|---|---|
| ref A #2 | 414.1–418.4 s: full 10↔90 strokes, linear, 50–83 ms dwell at both ends; half-strokes 417 → 184 ms (2.7 → 3.7 turns/s accelerando) | 419.4–438 s **tremor**: `0,10,5,15,10,20,10,15,5,10,0` at alternating 17/33 ms, then a 66–67 ms hold at 0; period **333 ms** (n = 33, median 333.0); 438–444 s **pulse bursts** `0→20→0→15→0→10→0→5→0` (50 ms halves, the 5 one 17 ms), 233–267 ms rest at 0, burst period **567/600 ms** alternating | 444.5–474 s: 0..50 strokes with 40-50-40 / 10-0-10 wiggles at the ends, 3.8 turns/s |
| ref A #1 | 303–309.5 s: full 0↔80, 5.0 → 5.5 turns/s, 67 ms dwells | 309.6–333.4 s bursts `0→20→0` then four `0→10→0` (50 ms halves), rest 233–267 ms growing to 1150–1267 ms at the end; burst period median 767 ms (666–1767) | back to 10↔90 strokes (the scene goes on) |
| ref B | 189–206.6 s: 10..90, amplitude 40–80, 4.8 → 6.9 turns/s (owner: 2.2 → 3.8 strokes/s); fast in (41 ms), 125 ms dwell at the bottom | 206.6–222 s 10↔50 at 7.9 turns/s (period 250 ms: in 83, dwell 83, out 84); 222–231 s 8..56 at 6.8 turns/s (period **333 ms**) | 231–249 s 0..74 at 2.8 turns/s; 249–300 s 0..50 at 2.2 |
| ref C | 183–189.5 s: 10↔75, 3.75 → 5.0 turns/s | 190.6–219 s slow deep throbs 0↔10 every 767 ms (2.0 turns/s) | 231–258 s 0..50 at 2.9; 261–285 s 0↔10 slow |
| ref D | 159–181.4 s: full 0↔100, 5 → 3.4 turns/s (583 ms period) | 181.5–228 s (clip end) slow deep throbs 0↔20, 800 ms up / 295 ms down (1.8 turns/s) | – |
| ref E | 81–92 s: ~9 turns/s, mostly small deep bumps (amp median 17, 0..65) | 92–96 s 0..13 at ~7 turns/s; 96–117 s (clip end) 0↔12 every 765 ms (2.5 turns/s) | – |
| ref F | 165–195.5 s: ~1 s cycles 90 → deep flutter (20,23,3,12,0,18,15) → 35 → 80 → 90, 12–16 turns/s counted | 195.5–198.4 s 0↔25 every 1 s (666 up / 334 down), then the cycles resume | 198–216 s 3.5 turns/s 0..100 |

Not used: ref G (93–105 s fast 0..61 cycles with descending peaks 60/61/46/27, no clear orgasm), ref H
(no deep-end section), ref I (57–64 s a 33 ms-step tremor at the OUT end, 85↔90, on oral),
ref J (12 s clip).

- **Run-in (`climax`)**: full-range strokes (amplitude median 80; 60–100), linear, faster than what came before and
  usually accelerating: start 2.7–5.0 turns/s (median of the accelerating clips 4.3), end 3.7–6.9 (median 5.25).
  Duration 4.4–22 s, **median 6.5 s** (`CLIMAX_FIT.runInMs`). Recipe `climax` = `ramp` 4.0 → 5.5 turns/s, depth 1 → 1,
  10..90, linear, anchor `lo` (at 5.5 turns/s an 80-pos half-stroke is 440 pos/s, just under the 450 cap).
- **Orgasm (`orgasm`)**: everything happens at the deep end (pos 0–25; 0–56 in ref B). Two families: the fast
  one (A, B: the 333 ms period appears in both) and slow throbs 0↔10–25 every 0.75–1.1 s that last to the
  clip end (C, D, E, F). Duration 3–46 s, **median 24 s** (`CLIMAX_FIT.orgasmMs`; A 25 and 24,
  B 24.4). Recipe `orgasm` = `tremor` with `TREMOR_FIT`: flutter period 333 ms (hold 67), the last 6 s as
  pulse bursts 20/15/10/5. Uniform 100 ms pulses + a 183 ms rest give the measured 583 ms burst period (the reference
  rests 233–267 ms after a shorter last pulse). `restEndMs` > `restMs` reproduces A #1's lengthening rests; the
  slow-throb family is `orgasm-pulses` with a low rate or `strokes` 0..15 at ~2.2 turns/s.
- **Afterglow**: deep-anchored half-depth strokes, 0..50 (0..74 once) at 2.2–3.8 turns/s, 18–51 s (**median ~30 s**,
  `CLIMAX_FIT.afterglowMs`), slowing. The `afterglow` recipe (fade toward the top) was left as it is, so existing
  plans keep their sound; a deep-anchored afterglow is a recipe edit away (`anchor: 'lo'`, `hi` 50).
- Old projects: `.pawproj` v1 → v2 (`src/lib/io/project.js` `MIGRATIONS[1]`) turns a pulses climax (kind `climax`
  with recipe `climax` or none, or recipe `climax` on any kind) into recipe `orgasm-pulses` (kind `orgasm`), so it
  sounds the same.
- Tests: `test/gen-generators.test.mjs` "tremor (orgasm fit)" (period, pattern, hold, pulse decay, burst period),
  `test/gen-plan.test.mjs` "climax -> orgasm -> afterglow", `test/io-project.test.mjs` "v1 -> v2".

## Recipes and kinds (`recipes.js`)

`RECIPES[id] = { gen, label, params }` — **edit this table** to change presets. `KINDS[kind] = { label, recipe, color }`.

| kind | default recipe | |
|---|---|---|
| `idle` | `hold` (pos 100) | title, black, idle |
| `fade-in` | `fade-in` | ramp: rate 1.2 → 2.4, depth 0.15 → 1, 0..90, sine |
| `foreplay` | `smooth-small` | 55..95, depth 14, 1.4 turns/s |
| `oral` | `oral` | follow, 40..95 (higher, shallower), sine |
| `penetration` | `penetration` | follow, 0..85, two-speed on a seeded 25% of half-strokes (≈ 20% of points mid-stroke) |
| `knotting` | `knot-pop-stroke` | knot on every stroke, fitted from the owner's scripting (top 80) |
| `climax` | `climax` | the fast run-in before the orgasm: ramp 4.0 → 5.5 turns/s, full 10..90, linear (fit above) |
| `orgasm` | `orgasm` | tremor + decaying pulse bursts at the deep end (fit above); `orgasm-pulses` = the old climax pulses |
| `afterglow` | `afterglow` | ramp: rate 2.0 → 0.6, depth 0.8 → 0, ease-out (ends as a hold at the top) |
| `outro` | `hold` | |
| `offscreen` | `carry` | follow with no turns inside: keeps the neighbouring stroke rate |
| `custom` | `strokes` | |

Other recipes: `oral-strokes`, `penetration-strokes`, `knot-pop-held`, `knot-tied`, `tease`, `orgasm-pulses`, `afterglow-follow`,
`accelerando`, `ritardando`, `fade-out`, `strokes`, `beats`. `recipesFor(kind)` lists recipe ids with the
kind's default first.

## Effects layer (`src/lib/fx.js`)

The plan replaces motion with recipes; the effects layer **modulates the tracked motion** instead, and stays a layer:
`applyFx(base, fx, ctx) -> Script`, `fx = [{ id, kind, t0, t1, params?, muted?, label? }]` (doc.fx, the `.pawproj` block
`fx`; `spurt` is the one point kind). Effects are layers and may overlap: each live effect (sorted by t0, muted ones skipped) works on the result of the ones before it, so the later one is on top, only inside its
span clipped to the base's extent; outside every span the base comes back as the same action objects. Deterministic.
Per kind (`FX_KINDS`, `fxSchema(kind)`, `fxParams(effect)`):

| kind | params | rule |
|---|---|---|
| `knotting` | `knot-pop-stroke`'s schema (`recipeSchema`, `timing` forced `auto`) | `knot-stroke` with `ctx.turns` = the base's extremes over the span ± 3 s: one knot cycle per tracked bottom → top → bottom; spliced with `applyPlan` (base locked, joins trimmed on the knot side) |
| `orgasm` / `climax` | `lo` `hi` (0/40, 10/90), `pulse` (1, 0), `rampIn` `rampOut` 0.3, `fastMs` 250, `flutterMs` 50, `edgeMs` 1000 | every base point keeps its time; pos → `lo..hi` from the span's min..max, weighted by an edge ease (smoothstep over `edgeMs`, ≤ span/4); between two turns with nothing between them a flutter (±5 pos × `pulse`, steps ≥ `flutterMs`) scaled by `envelope(u, rampIn, rampOut)` and by the half-stroke's speed (full under `fastMs`, none over 1.5 ×), capped so a step stays under `maxSpeed`. The shots themselves are timed with `spurt` points |
| `spurt` (a point, `t1 === t0`) | `amount` 25 (pos; an old `depth` is ignored), `rise` 50, `fall` 50, `hold` 0 ms, `count` 3 half-swings, `decay` 0.75 | `spurtKeys(p, cap, fit)` = [[ms, offset from the trace]]: a ringing about the trace: −amount at t0 (deeper, on the frame), +amount·decay, −amount·decay², … (`count` half-swings, each held `hold`), back to 0; every key = the trace at its time + its offset, so the ends sit on the trace (continuous) and trace points inside the window are replaced. A swing deeper takes ≥ `rise`, shallower ≥ `fall`; when the cap needs longer the approach starts earlier and the rest ends later (every swing in full, the first on t0). A swing that would leave 0..100 is squeezed to the room (`fit`), never clipped. Only where the base covers the window |
| `shape` (Reshape) | `accelIn` `accelOut` (−1..1), `dwellTop` `dwellBottom` (0..0.6 of a move), `inFrac`, `lo`, `hi` (null = as tracked) | the base's stop points (both ends of a plateau) keep their time; the moves between two of them are re-drawn with `moveCurve(u, accelIn, accelOut, dwell)` (cubic Hermite, end slopes 1 − accel, arriving early by the dwell and holding; 4 samples + the knee, ≥ `minGapMs`); `lo`/`hi` remap the span's turns; `inFrac` (set by hand only) moves single-point tops to that share of their bottom → bottom stroke. All "as tracked" = the base unchanged |

`fitProfile(samples {t, v}, base, t0, t1)` reads the Reshape params off a run's own track: the mean normalised move
between the base's turns (24 samples each, per direction) → dwell = how long it sits within 3 % of the end it arrives
at plus the one it leaves, accel = the start / end slopes of its moving part, `lo`/`hi` = the turns' range; never `inFrac`
(turn times come from the video). `fxGhost(ghost, fx)` / `fxCached(script, fx)`: a tracker ghost seen through the layer,
memoised by identity (the lanes draw it). `fxAxisGhost(script, fx)`: the stroke's own points through the layer over the effects' reach (`fxReach`), the lanes' live "Effects on the stroke" ghost until Flatten (`timeline.flatten`) bakes it (no Accept, no Shift+A since paw-x7w7); `markBaked(fx, range)` flags what went into the axis (`baked: true` effects are skipped by `liveFx`). Graph: `src.fx` + `fx.apply`. Tests: `test/fx.test.mjs`.

## Plan compiler (`plan.js`)

```js
plan = [{ id, t0, t1, kind, recipe?, params? }]   // ms; may have gaps; must not overlap (t0 == previous t1 is fine)
const res = compilePlan(plan, ctx, opts?)   // opts = { maxSpeed, minGapMs, blendMs } from the caller / device profile; overrides the same ctx fields
// res = { script, segments: [{ id, t0, t1, count, recipe, gen }], issues: [{ id, level: 'error'|'warn', msg, at? }], raw, keys }
const res2 = recompileSegment(res, editedPlan, id, ctx, opts?)   // regenerates `id` (and any segment whose t0/t1/kind/recipe/params changed); others reused
validatePlan(plan) -> issues
applyPlan(baseScript, res, ctx, opts?) -> Script   // base with each segment span replaced, joins to the untouched base blended (base points never removed)
```

- `recipe` defaults to `KINDS[kind].recipe`; `params` override the recipe's. Per-segment direction / invert /
  intensity are params: `start`, `invert`, `intensity` (0..1: depth × I toward the anchor, rate × (0.5 + 0.5 I)).
- Invalid segments (missing/duplicate id, `t1 <= t0`, unknown kind/recipe, overlapping an earlier segment)
  are reported as `level: 'error'` and skipped; the rest still compiles.
- Each segment is generated over its own `[t0, t1]`; at a boundary the later segment owns the shared
  instant, and points are removed near the join (outgoing side first, at most `blendMs` away) until the
  crossing step respects `maxSpeed` and `minGapMs`. Position is continuous (piecewise linear) and no step
  exceeds the cap except moves a recipe explicitly allows (the knot pops, inside their segment); if a join cannot be fixed (segments shorter than the window) it is reported as a `warn`
  issue, never hidden. **Gaps stay empty.**
- Deterministic: same plan + ctx → byte-identical script. `recompileSegment` gives exactly what
  `compilePlan` would (a changed `seed`, `maxSpeed`, `minGapMs`, `intensity` or `invert` makes it recompile everything; changed `turns` need an explicit `compilePlan`); points outside the edited segment and its two blend windows are byte-identical.
- `segments[].count` = points in the final script inside the segment (shared boundary instant counted for the later one).

## Loops (`loops.js`)

```js
tile(cycle, cycleT0, cycleLenMs, rangeT0, rangeT1, opts) ->
  { script, tiles: [{ k, start, end, partial }], seam: { speed, spike, gapMs, fromPos, toPos }, issues }
```

- `cycle`: points of one cycle in absolute time (`cycleT0 <= at < cycleT0 + cycleLenMs`; anything later is ignored).
- `cycleLenMs` may be fractional (frames / fps × 1000). Tile `k` starts at `round(gridT0 + k × cycleLenMs)`
  (`gridT0` defaults to `cycleT0`, `k` may be negative to tile backward), so there is no drift; offsets inside a
  tile are the cycle's own integer offsets. `opts.starts: [ms]` gives explicit cycle starts instead (e.g. detected frames).
- `opts`: `partial: 'clip' | 'drop'` (default clip: partial first/last tiles cut at the range with an
  interpolated edge point), `join: 'keep' | 'meet'` (meet: a last point within `joinTolMs` (50) of the cycle end
  takes the first point's pos so the cycle closes onto the next), `vary: { seed, amp, timeMs }` (per-repeat
  seeded depth scale and interior timing jitter; tile starts stay exact), `stretch` (with explicit `starts`,
  scale offsets to each tile's length), `maxSpeed` (for the seam report only — seams are reported, never smoothed).
- `seam`: the step from the cycle's last point to the next tile's first (`spike: speed > maxSpeed`;
  `maxSpeed: 0` turns the check off). Worst case over the tile spacings that occur (`floor(P)` for a
  fractional period). It describes the cycle without variation. A spike also adds a `warn` issue.
- A cycle point that falls on or past the next tile's start (fractional periods, explicit starts) is
  dropped, so the later tile wins (`warn` issue). The output is strictly increasing by construction.
- `issues`: `[{ level: 'error'|'warn', msg }]`. Invalid input (period <= 0, empty cycle, empty range)
  gives an empty script and an `error`.

```js
extractCycle(script, t0, lenMs, { includeStart = true }) -> Script   // round(t0) <= at < round(t0)+len, with an interpolated point at round(t0) if missing
retile(script, loop, opts) -> { script, report: { cycle, periodMs, tiledTo, tiles, seam, issues } }
// loop = { t0, t1, periodMs?, tiledTo: { t0, t1 } | t1, starts? }   (tiledTo missing -> { t0: loop.t0, t1: loop.t1 })
```

`retile` re-extracts the source cycle (`loop.t0 .. loop.t0 + (periodMs ?? t1 - t0)`) and replaces
`tiledTo` with fresh tiles. Call it after the source cycle was edited. Tile 0 reproduces the source
exactly when there is no variation. On an error the script comes back unchanged.

## Examples

```js
// 10 s of steady penetration strokes at 75 strokes/min, sine-shaped
GENERATORS.strokes.gen(60000, 70000, { spm: 75, lo: 0, hi: 90, shape: 'sine' }, { seed: 7 });

// a small plan
const plan = [
  { id: 'a', t0: 0,      t1: 8000,   kind: 'idle' },
  { id: 'b', t0: 8000,   t1: 20000,  kind: 'fade-in' },
  { id: 'c', t0: 20000,  t1: 140000, kind: 'penetration', params: { intensity: 0.8 } },
  { id: 'd', t0: 140000, t1: 163500, kind: 'knotting', recipe: 'knot-tied' },
  { id: 'e', t0: 163500, t1: 170000, kind: 'climax' },      // fast run-in (6.5 s)
  { id: 'o', t0: 170000, t1: 194000, kind: 'orgasm' },      // tremor + pulses (24 s)
  { id: 'f', t0: 194000, t1: 224000, kind: 'afterglow' },
];
const res = compilePlan(plan, { seed: 1, turns: trackerTurns, maxSpeed: 450 });
app.edit('Compile plan', 'stroke', applyPlan(app.doc.axes.stroke, res));

// tile a 2.5-frame-accurate loop (83 frames at 30 fps) over a minute
const cyc = extractCycle(script, 12000, 83 / 30 * 1000);
const { script: tiled, seam } = tile(cyc, 12000, 83 / 30 * 1000, 12000, 72000, { join: 'meet' });
if (seam.spike) app.toast(`Loop seam moves at ${Math.round(seam.speed)} pos/s`, 'warn');
```
