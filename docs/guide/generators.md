# Generators and the plan

Pawscript can write whole stretches of a script for you. You lay out the scene as a **plan**, a row of
segments on the plan lane, each with a kind (fade-in, penetration, knotting, climax, orgasm...), and press
**Generate**. Each segment is filled by a **generator** (the algorithm) through a **recipe** (a named preset
of that generator's parameters). Where tracker runs exist, the follow-type recipes put the extremes on the
tracked turning points; elsewhere they run at a rate.

Positions: `pos 0` is the deep end (fully in), `pos 100` is out. Every range below is `lo` = deep end,
`hi` = out end.

## The plan in one pass

1. Open the **Plan** panel (right dock, `timeline.plan`; `Ctrl+Alt+I` opens it and focuses the inspector).
2. Drag on empty space in the **plan lane** to draw a segment. It gets the *armed* kind (Penetration until you
   arm another: click a kind chip in the panel, or drag the chip onto the lane).
3. Select a segment, pick its recipe and tweak params in the inspector (double-click the block, or `Enter`
   with the lane focused).
4. Press **Generate** (`Ctrl+Shift+G`). New and stale segments are written into the active axis. Everything
   outside the generated spans keeps its points.

Edit the plan, not the points: regenerate after every change. Hand-edited spans you want to keep are
**locked** (`Alt+Shift+L`) or **detached** (the points stay, the segment goes).

## Plan lane

The lane shows every segment as a block in its kind's color, with the compiled motion drawn inside it when
**Plan preview** is on (`Ctrl+Alt+P`; also the eye button in the panel). The selected segments' motion is also
drawn into the point lane as a ghost named "Plan preview".

### Mouse

| Action | Result |
|---|---|
| Drag empty space | New segment of the armed kind |
| Drag a block body | Move it (and the rest of the selection) |
| Drag a block edge | Resize; an edge shared with a touching neighbor moves both |
| `Shift` while dragging | No snapping |
| `Ctrl` while dragging | Push neighbors along (they keep their length) |
| `Alt` while dragging an edge | Detach from the touching neighbor (stop at it) |
| Click | Select; `Ctrl`+click toggles, `Shift`+click extends in time order |
| Click empty space | Clear selection and seek there |
| Double-click a block | Inspector popover |
| Right-click | Context menu: split here / merge / duplicate / kind / generate / detach / lock / edit / delete |
| Drop a kind chip from the panel | Onto empty space: new segment filling the gap (bounded by scene cuts, else 10 s). Onto a block: sets its kind |

Snap targets while dragging: scene cuts, other plan edges, loop edges, the range,
the playhead; otherwise the frame grid.

### Keys

Keys marked *lane* fire only while the plan lane has keyboard focus (it shows a focus ring and a
"PLAN · KEYS" tag); the others work from anywhere and focus the lane.

| Key | Command | Scope |
|---|---|---|
| `Shift+N` | Add segment at playhead: the range if one is set, else the gap between the scene cuts around the playhead (10 s with no cuts) | anywhere |
| `P` | Select the segment under the playhead | anywhere |
| `Alt+PageDown` / `Alt+PageUp` | Next / previous segment (seeks to its start) | anywhere |
| `S` | Split the segment at the playhead | lane |
| `Shift+M` | Merge the selected neighboring segments | lane |
| `Ctrl+D` | Duplicate the selection after itself (copies are new and unlocked) | lane |
| `Delete` / `Backspace` | Delete the selection (points stay) | lane |
| `Ctrl+A` | Select all segments | lane |
| `Enter` | Open the inspector for the selection | lane |
| `Escape` | Close the inspector, else clear the selection | lane |
| `1`..`9`, `0` (also with `Shift`) | Set the selection's kind, see the digits below | lane, selection |
| `Ctrl+Shift+G` | Generate: new + stale segments; the selection instead when the lane is focused and has one | anywhere |
| `Ctrl+Alt+G` | Generate the whole plan (every unlocked segment) | anywhere |
| `Alt+Shift+L` | Lock / unlock the selection | anywhere |
| `Ctrl+Alt+P` | Plan preview on / off | anywhere |
| `Ctrl+Alt+I` | Open the Plan panel's inspector | anywhere |

Commands without a default key (reach them from the palette or the context menu): `timeline.plan.generateSelected`,
`timeline.plan.detach`, `timeline.plan.import` / `importMerge`, `timeline.plan.exportDirector` / `exportSpans`,
and one `timeline.plan.arm.<kind>` per kind (arm it for drawing).

## Kinds

A kind is the story role of a segment. It chooses the default recipe and the block color; it does not limit
which recipe you may pick.

| Digit | Kind | Default recipe | Generator |
|---|---|---|---|
| `1` | Fade-in | `fade-in` | ramp |
| `2` | Foreplay | `smooth-small` | smooth |
| `3` | Oral | `oral` | follow |
| `4` | Penetration | `penetration` | follow |
| `5` | Knotting | `knot-pop-stroke` | knot-stroke |
| `6` | Climax (fast run-in) | `climax` | ramp |
| `7` | Orgasm | `orgasm` | tremor |
| `8` | Afterglow / slow ending | `afterglow` | ramp |
| `9` | Off-screen (carry) | `carry` | follow |
| `0` | Title / idle | `hold` | hold |
| – | Outro | `hold` | hold |
| – | Custom | `strokes` | strokes |

**Climax vs orgasm.** In the reference scripts the finale is a *fast climax*, a few seconds of full-range strokes,
faster than before and usually speeding up, then the *orgasm*: a fast flutter and small pulses at the deep end,
then the afterglow. Plan them in that order: `climax` (about 6.5 s) → `orgasm` (about 24 s) → `afterglow` (about
30 s), the medians of the reference (`src/lib/gen/README.md`, "Climax, orgasm, afterglow"). Projects saved before
the split open with their old climax segments as `orgasm` on recipe `orgasm-pulses`, so they sound the same.

Changing the kind of a segment that is on its old kind's default recipe moves it to the new default; a
segment on a hand-picked recipe keeps it. Param overrides that still apply to the new recipe are kept.

When you export the plan as tracking spans, kinds map to span states: climax → `climax`, orgasm → `orgasm`, off-screen →
`carry`, idle / outro → `idle`, everything else → `active`.

## Recipes

A recipe = one generator + preset params. The inspector's **Recipe** dropdown lists the kind's default first,
then every other recipe.

| Recipe | Generator | Preset |
|---|---|---|
| `hold` | hold | `pos` 100 |
| `fade-in` | ramp | 0..90, rate 1.2 → 2.4, depth 0.15 → 1, ease-in-out, sine |
| `smooth-small` | smooth | 55..95, `amp` 14, `rate` 1.4, `driftMs` 9000 |
| `tease` | tease | 0..95, `rate` 2, `edge` 0.3, `every` 3, `dip` 0.7, `pauseMs` 350, `full` 0.15 |
| `tease-top` | tease-top | 80..100, `rate` 0.67 (Autorange's dead-gap fill) |
| `oral` | follow | 40..95, sine, `fallbackRate` 2.0 |
| `oral-strokes` | strokes | 40..95, `rate` 2.0, sine |
| `penetration` | follow | 0..85, two-speed on a seeded 25 % of half-strokes, `fallbackRate` 2.4 |
| `penetration-strokes` | strokes | 0..85, `rate` 2.4, same two-speed |
| `knot-pop-stroke` | knot-stroke | 0..80, `knotOut` 17, `popTo` 64, `knotIn` 30, `press` 20, `popSpeed` 600 |
| `knot-pop-held` | knot | 0..85, `knotLevel` 30, `between` 4 |
| `knot-tied` | knot | 0..85, `knotLevel` 30, `between` 3, `tied` on, `popsBeforeTie` 1 |
| `climax` | ramp | 10..90, rate 4.0 → 5.5, depth 1 → 1, linear, anchor `lo` (the fast run-in before the orgasm) |
| `orgasm` | tremor | 0..40, flutter 20 deep every 333 ms, the last 6 s as pulse bursts 20/15/10/5 |
| `orgasm-pulses` | pulses | `rate` 6.8 → `rateEnd` 4.2 over `decayMs` 15000, 1..34, `amp` 23 → `ampEnd` 20 (the old `climax` recipe) |
| `afterglow` | ramp | 0..90, rate 2.0 → 0.6, depth 0.8 → 0, ease-out, sine (ends held at the top) |
| `afterglow-follow` | follow | 0..90, sine, `fadeFrom` 1 → `fadeTo` 0, ease-out |
| `carry` | follow | 0..85, sine, the plain follow generator: turns inside the span are used; the neighboring rate is carried only where there are none |
| `accelerando` | ramp | 0..85, rate 1.2 → 3.2, full depth, `exp` curve |
| `ritardando` | ramp | 0..85, rate 3.2 → 1.2, full depth, `exp` curve |
| `fade-out` | ramp | 0..90, rate 2.4 → 1.2, depth 1 → 0, ease-in-out, sine |
| `strokes` | strokes | generator defaults |
| `beats` | beats | generator defaults |

Param precedence: generator default < recipe preset < the segment's own overrides. A value you set back to
the recipe's default is removed as an override (the reset dot in the form does the same).

## Generators

Shared vocabulary:

- **Rate** is in `turns/s`: one turn = one extreme, so 2 turns = 1 stroke. 2.4 turns/s = 72 strokes/min.
  The generator library also reads `spm` (strokes/min) as `rate` = spm / 30, only for the `rate` key (not
  `rate0` / `rate1` / `rateEnd` / `fallbackRate` / `tiedRate`), and only when `rate` is not set by the recipe or
  the segment. The app does not keep it: director-JSON import, new segments and every inspector edit keep only
  the recipe's schema keys, so `spm` survives only when written straight into the `.pawproj`.
- **`start`**: `in` = the first move goes toward deep (default), `out` = the reverse.
- **`anchor`**: when depth shrinks (intensity, fades, ramps, the speed cap, depth jitter) strokes shrink toward
  this end: `hi` keeps the out end (default), `lo` keeps the deep end (climax, orgasm), `mid`.
- **`shape`**: the profile of each half-stroke, see [Stroke shapes](#stroke-shapes).
- **`inFrac`** (strokes, ramp): share of each stroke spent going in. 0.35 = fast in, slow out.

### Common params (every generator except `hold`)

In the inspector these sit under **More**.

| Key | Default | Range | Meaning |
|---|---|---|---|
| `intensity` | 1 | 0..1 | Depth × intensity toward the anchor; every rate × (0.5 + 0.5 × intensity). 0 = flat line at the anchor. Own slider at the top of the inspector |
| `invert` | off | | pos → 100 − pos |
| `anchor` | `hi` | `hi` `mid` `lo` | see above |
| `fadeFrom`, `fadeTo` | 1, 1 | 0..1 | Depth envelope across the segment (fade in / out on any generator) |
| `fadeCurve` | `linear` | `linear` `ease-in` `ease-out` `ease-in-out` `exp` `step` | |
| `jitterTime` | 0 | 0..0.4 | Turning points move by up to this × the shorter neighboring half-stroke (seeded) |
| `jitterAmp` | 0 | 0..0.5 | Depth shrinks by up to this × travel toward the anchor (seeded) |
| `seed` | 0 | 0..999999 | Extra seed for this segment's variation |

### `hold`

| Key | Default | |
|---|---|---|
| `pos` | 100 | Stays there |
| `invert` | off | |

### `strokes`: constant strokes

| Key | Default | Range |
|---|---|---|
| `rate` | 2.4 | 0.05..12 turns/s |
| `lo`, `hi` | 0, 85 | 0..100 |
| `shape` | `linear` | |
| `start` | `in` | `in` `out` |
| `phase` | 0 | 0..1 of a cycle (one cycle = one stroke = 2 turns; 0.5 = half a stroke later, so the pattern starts at the opposite extreme) |
| `inFrac` | 0.5 | 0.1..0.9 |

### `ramp`: rate and depth together

Accelerando, ritardando, fade-in, fade-out. Depth is a fraction of `lo..hi`, shrinking toward the anchor.

| Key | Default | Range |
|---|---|---|
| `rate0` → `rate1` | 1.2 → 2.4 | turns/s |
| `amp0` → `amp1` | 0.2 → 1 | 0..1 |
| `curve` | `ease-in-out` | `linear` `ease-in` `ease-out` `ease-in-out` `exp` `step` (`exp` between two positive rates is geometric: equal ratios per second) |
| `lo`, `hi` | 0, 85 | |
| `shape` | `sine` | |
| `start`, `phase`, `inFrac` | `in`, 0, 0.5 | |

### `smooth`: small smooth motion

Small sine strokes whose center drifts slowly inside the band (two seeded sines). Anchor defaults to `mid`.

| Key | Default | Range |
|---|---|---|
| `lo`, `hi` | 55, 95 | |
| `amp` | 14 | 1..100 pos |
| `rate` | 1.4 | turns/s |
| `driftMs` | 9000 | 1000..120000 |
| `variation` | 0.25 | 0..1: at 1, stroke length ±30 % and depth up to −50 %; at the default 0.25, ±7.5 % and up to −12.5 % (seeded) |
| `shape` | `sine` | |
| `start` | `in` | |

### `tremor`: orgasm

The orgasm curve, fitted from a reference script's 25 s orgasm: a flutter at the deep end,
`0,10,5,15,10,20,10,15,5,10,0` scaled to `amp`, then a hold at the bottom, repeating every `periodMs`; for the
last `pulseMs` of the segment, bursts of `pulseCount` pulses whose depth falls from `pulseAmp` (20, 15, 10, 5), each
followed by a rest at the bottom that goes from `restMs` to `restEndMs`. Anchor `lo`. Ends at the bottom.

| Key | Default | Range |
|---|---|---|
| `lo`, `hi` | 0, 40 | |
| `amp` | 20 | 1..100 pos (flutter peak) |
| `periodMs` | 333 | 100..2000 |
| `holdMs` | 67 | 0..1000 |
| `pulseMs` | 6000 | 0..120000 (0 = flutter only) |
| `pulseAmp` | 20 | 1..100 pos |
| `pulseCount` | 4 | 1..12 |
| `pulseHalfMs` | 50 | 20..500 |
| `restMs` → `restEndMs` | 183 → 183 | 0..3000 (a longer end rest thins the pulses out) |

### `pulses`: classic orgasm pulses

Abrupt fast shallow pulses at the deep end, no holds; the rate and depth ease from the onset values to the
end values over `decayMs`. Anchor defaults to `lo`. Bottoms sit at `lo` + up to `deepJitter`; tops at
bottom + depth × (1 ± `ampJitter`), capped at `hi`. The segment switches in abruptly, no fade.

| Key | Default | Range |
|---|---|---|
| `rate` → `rateEnd` | 6.8 → 4.2 | turns/s |
| `decayMs` | 15000 | 0..120000 |
| `decayCurve` | `ease-in-out` | |
| `lo`, `hi` | 1, 34 | |
| `amp` → `ampEnd` | 23 → 20 | 1..100 pos |
| `ampJitter` | 0.25 | 0..1 |
| `deepJitter` | 2 | 0..20 pos |
| `shape` | `linear` | |
| `start` | `in` | |

### `follow`: tracked strokes

Extremes at the tracker's turning points, with this range and shape. Where the tracker is silent the local
rate is carried through: a gap longer than max(`gapFactor` × local half-stroke, `gapMinMs`) and both edges of
the segment are filled at the median half-stroke of the turns within `contextMs`. With no turns anywhere
near, `fallbackRate` is used. Pairs of turns closer than `minHalfMs` are thinned.

| Key | Default | Range |
|---|---|---|
| `lo`, `hi` | 0, 85 | |
| `shape` | `linear` | |
| `start` | `in` | Only matters where turns are unlabeled or absent |
| `carry` | on | Carry the rate through gaps |
| `gapFactor` | 3 | 1.5..10 |
| `gapMinMs` | 1500 | 200..10000 |
| `fallbackRate` | 2.4 | turns/s |
| `minHalfMs` | 60 | 0..500 |
| `contextMs` | 10000 | 1000..60000 |

Where the turns come from is in [Tracker runs](#tracker-runs-and-the-follows-selector).

### `knot-stroke`: knot on every stroke

Every stroke passes the knot. One cycle, starting at full depth, is six linear moves:

| # | Move | Lands at | Share of cycle |
|---|---|---|---|
| 1 | pull out against the knot (slow) | `knotOut` 17 | `fPull` 0.270 |
| 2 | pop out (near-instant) | `popTo` 64 | `fPopOut` 0.077 |
| 3 | rise to the top | `hi` 80 | `fTop` 0.132 |
| 4 | back down to the knot | `knotIn` 30 | `fDown` 0.326 |
| 5 | press against the knot (slow) | `press` 20 | `fPress` 0.157 |
| 6 | pop in (near-instant) | `lo` 0 | `fPopIn` 0.038 |

At the default `rate` 1.85 a cycle is about 1083 ms. When a cycle is longer or shorter, the pops keep their
duration (`popScale` 0) and the slow moves absorb the difference; `popScale` 1 scales everything with the
cycle. The pops may move at up to `popSpeed` (600 pos/s, above the global cap, because the pop *is* the speed
spike); `popSpeed` 0 puts them under the global cap. `variation` 1 gives the measured spread: cycle length
±28 % (rate mode) and the knot-in level ±2 pos, seeded; the other levels never vary.

`timing`: `auto` takes follow timing when the plan has any turns at all (every segment's chosen run
contributes its turns to one shared list, so a knot-stroke segment with no run of its own still follows when
some other segment has one); only with no turns anywhere in the plan does `auto` fall back to `rate`. Follow
timing works like `follow`: turns within `contextMs` of the segment, else carried at `fallbackRate` (2.4),
not `rate`. With turns, each bottom → top → bottom pair is one cycle: full depth lands on the bottom turn
and the top on the top turn, moves 1–3 fitted into the out half and 4–6 into the in half. `follow` forces
follow timing, `rate` ignores turns.

| Key | Default | Range |
|---|---|---|
| `rate` | 1.85 | turns/s (2 turns = 1 cycle) |
| `lo` (full depth), `hi` (top) | 0, 80 | |
| `knotOut`, `popTo`, `knotIn`, `press` | 17, 64, 30, 20 | 0..100 pos (clamped into `lo..hi`) |
| `fPull` `fPopOut` `fTop` `fDown` `fPress` `fPopIn` | 0.270 0.077 0.132 0.326 0.157 0.038 | shares, normalized |
| `popScale` | 0 | 0..1 |
| `popSpeed` | 600 | 0..2000 pos/s |
| `variation` | 1 | 0..3 |
| `timing` | `auto` | `auto` `rate` `follow` |
| follow params | as `follow` | used when timing comes from turns |

### `knot`: knot pop, held back

`between` shallow bumps from `hi` down to `knotLevel` (fast approach, slowing as it presses) → an approach
that catches on the knot → press 3 pos below the knot for `pressMs` → push through to `lo` over `pushMs`
(spends `resist` of the time on the first quarter of the travel, then slips) → dwell `dwellMs` at depth with
`grind`-pos micro-strokes → resisted pull to halfway up the knot over `pullMs` → pop out to `hi` over
`popMs`. Every move is lengthened as needed so it never exceeds the speed cap. With `tied` on, after
`popsBeforeTie` pops the next push stays in: `tiedAmp`-deep tugging at `tiedRate` until the segment ends.

| Key | Default | Range |
|---|---|---|
| `lo`, `hi` | 0, 85 | |
| `knotLevel` | 30 | 0..100 pos |
| `rate` | 2.4 | bump rate, turns/s |
| `between` | 4 | 0..32 bumps between pops |
| `pressMs` | 160 | 0..2000 |
| `pushMs` | 650 | 50..5000 |
| `resist` | 0.6 | 0.25..0.9 |
| `dwellMs` | 450 | 0..10000 |
| `grind` | 3 | 0..20 pos |
| `pullMs` | 260 | 0..3000 |
| `popMs` | 140 | 30..2000 |
| `tied` | off | |
| `popsBeforeTie` | 2 | 0..50 |
| `tiedAmp` | 10 | 0..50 pos |
| `tiedRate` | 2 | turns/s |
| `timing` | `auto` | `auto` = follow timing when the plan has any turns at all (see `knot-stroke`), else `rate`; `rate`; `follow`. Bump times come from the turns, carried at `fallbackRate` where there are none nearby |
| follow params | as `follow` | |

### `tease-top`

Slow, shallow eased strokes at the out end of `lo..hi`: Autorange's fill for dead gaps (a scene with no act, a run
with almost no motion, a long span with no points). Each half-stroke's length varies by `periodJitter`, each stroke's
depth by `ampJitter` (the deepest reaches `lo`), and with chance `pause` a stroke holds at the top instead.

| Key | Default | Range |
|---|---|---|
| `lo`, `hi` | 80, 100 | |
| `rate` | 0.67 | turns/s (a stroke ≈ 3 s) |
| `periodJitter` | 0.2 | 0..0.5 |
| `ampJitter` | 0.3 | 0..0.5 |
| `pause` | 0.12 | 0..0.5 |
| `shape` | `sine` | |

### `tease`

Shallow strokes at the out edge; every `every` strokes a dip that stops short at `dip` of the range, pauses
`pauseMs`, and retreats. With chance `full` a dip goes all the way to `lo` instead.

| Key | Default | Range |
|---|---|---|
| `lo`, `hi` | 0, 95 | |
| `rate` | 2 | turns/s |
| `edge` | 0.3 | 0.05..1 of the range |
| `every` | 3 | 0..20 |
| `dip` | 0.7 | 0..1 of the range |
| `pauseMs` | 350 | 0..3000 |
| `full` | 0.15 | 0..1 |
| `variation` | 0.2 | 0..1 |
| `shape` | `sine` | |

### `beats`: taps / beats

Extremes on a list of times in the param `times` (ms, or `{at}` objects). The app passes no beats or taps
of its own, and `times` is not in the recipe's schema, so import, new segments and inspector edits drop it:
in the app this recipe produces nothing unless `times` is written straight into the `.pawproj`. Covers the
beats plus one interval on each side, not necessarily the whole segment.

| Key | Default | Range |
|---|---|---|
| `lo`, `hi` | 0, 85 | |
| `shape` | `linear` | |
| `start` | `in` | parity of `alternate` mode |
| `mode` | `alternate` | `alternate`: beats alternate deep / out. `hit`: every beat is a deep hit, an out point between |
| `every` | 1 | 1..16: use every nth beat |
| `offsetMs` | 0 | −1000..1000 |
| `outFrac` | 0.5 | 0.1..0.9: hit mode, where between beats the out point sits |

## Stroke shapes

A shape is the profile of one half-stroke as extra points inside it (devices interpolate linearly, so the
points are the motion). The inspector offers the names; the finer knobs and the modifiers are reachable by
editing a segment's params in exported JSON.

| Name | Knobs | |
|---|---|---|
| `linear` | – | no extra points |
| `sine` | `samples` 3 | ease in and out |
| `ease-in` | `power` 2, `samples` 2 | slow start, fast arrival |
| `ease-out` | `power` 2, `samples` 2 | fast start, slow arrival |
| `two-speed` | `ratio` 2 (speed before / after), `at` 0.5 | one mid-stroke point |
| `bounce` | `amount` 0.12 | arrives early, rebounds, settles |
| `hold-top` / `hold-bottom` / `hold-both` | `dwell` 0.3 (0.25 for both) | dwell at that end for `dwell` of the half-stroke |
| `custom` | `knots` `[[u, v], ...]` | u = time fraction, v = travel fraction |

Modifiers on a shape object: `dir: 'in' | 'out'` (only that direction), `prob: 0..1` (a seeded share of
half-strokes, the rest linear), or `{ in: spec, out: spec }`. The `penetration` recipe's shape is
`{ name: 'two-speed', ratio: 2, at: 0.5, prob: 0.25 }`.

## Inspector

Opens in the Inspector and Plan panels for the selection, or as a popover over the block (double-click, `Enter`). With
several segments selected, edits apply to all of them.

- **Name** (placeholder is the kind's label), **state badge** (New / Fresh / Stale / Locked), time span.
- **Kind** row: one radio per kind, digit shown.
- **Recipe**: the kind's default first, then every other recipe.
- **Follows** (follow and knot recipes only): which tracker run the segment takes its turns from. `Auto` =
  the visible run covering most of the segment (newest on ties); or a named run, hidden ones included.
- **Intensity** slider (0..1). Stored as the param `intensity`; 1 removes the override.
- The recipe's first eight params; the rest, the common params, `phase`, `inFrac`, `timing` and the
  follow knobs under **More** (its count = how many are overridden). Every change is one undo entry;
  slider drags coalesce.
- Compile issues for this segment.
- **Generate** (this segment / the selection), **Lock**, **Detach** (keep the points, drop the segment),
  **Delete** (points stay).

## Generate, states and locks

Every segment has a state:

| State | Meaning |
|---|---|
| New | never generated |
| Fresh | the script holds what this segment generates |
| Stale | span, kind, recipe or params changed since it was generated; for follow and knot recipes also when the turns of the run it follows changed (within 10 s around the segment) |
| Locked | Generate skips it, whatever else is true |

Generate scopes (the control beside the button, and the keys): **Needed** = new + stale (`Ctrl+Shift+G`),
**Selected**, **All** = every unlocked segment (`Ctrl+Alt+G`). The whole plan is compiled each time so the
joins between neighbors stay right, but only the targets' spans are written into the active axis. Points
outside the targets are never removed; the joins to them are blended by trimming the generated side only.

A segment going from the plan (Delete, Detach) leaves its points in the script. Detach generates the
segment first if it is new or stale. Duplicates (`Ctrl+D`) come back as New and unlocked.

The panel's counts line shows how many segments are new / stale / locked / fresh and the last compile time.
Issues from the compile appear in the segment list (icon per segment, plan-wide ones above it), in the
inspector and in the Generate toast:

- **error**, the segment was skipped: missing or duplicate id, `t1 <= t0`, unknown kind or recipe, or it
  overlaps an earlier segment.
- **warn**, compiled, with something to look at: a join that cannot be brought under the speed cap or
  min gap because the segments are shorter than the blend window; params the recipe does not know (`spm`
  and `times` are exempt from this warning).

## How compilation works

`compilePlan` generates each segment over its own `[t0, t1]`, independently, then joins them in time order.
Gaps between segments stay empty.

- **Joins.** At a boundary the later segment owns the shared instant. Points near the join are removed
  (outgoing side first, at most `blendMs` = 300 ms from the boundary, widened to `50000 / maxSpeed` + 20 ms
  when that is larger) until the crossing step respects `maxSpeed` and `minGapMs`. If that is impossible it is a
  warn issue, never hidden.
- **`maxSpeed`** (pos/s). The cap every half-stroke respects: a too-fast half-stroke shrinks toward the
  anchor (its shape's peak slope counted), then an exact integer pass guarantees no step exceeds it. The
  value is the active device profile's effective speed cap (the Review profile, else the device preview's,
  else the `review.profile` setting); 450 when there is none. The only moves allowed over it are the
  `knot-stroke` pops, inside their own segment.
- **`minGapMs`** = 20 ms: no two points closer, inside a segment and across every join. Turning points win
  over shape points; a turn within 20 ms of a segment edge slides onto the edge, so the first point is at
  `t0` and the last at `t1` exactly. A span shorter than 20 ms collapses to one point.
- **Seeds.** Everything random is seeded and deterministic: same plan + same inputs = byte-identical script.
  The plan seed is a hash of the video's file name; each segment's seed is derived from that and the
  segment's id, so reordering or editing other segments does not change a segment's variation. The `seed`
  param (More) adds a per-segment seed on top. Moving a segment to another video file changes the result.
- **Incremental.** The live preview recompiles only the segments whose span, kind, recipe or params
  changed; a changed speed cap or tracker turns recompiles everything. Points outside an edited segment and
  its two join windows are byte-identical before and after.
- **Preview** polls the plan every 100 ms and compiles once it held still for one tick, so lane drags, undo
  and imports all update the blocks.

## Tracker runs and the Follows selector

Recipes on the `follow` and `knot` generators (and `knot-stroke` in `auto` / `follow` timing) take their
turning points from tracker runs: ghosts on the active axis whose source is the tracker. Each segment
chooses a run, and the chosen run's turns inside that segment's span go into one plan-wide turn list that
every generator sees:

- **Auto** = the visible run with the largest overlap with the segment, newest on ties. No run covering the
  segment = it contributes no turns. The generator still looks `contextMs` (10 s) past the segment's edges,
  so a neighboring segment's run within 10 s sets the rate that is carried through; with nothing nearby
  `follow` runs at `fallbackRate`. `knot` and `knot-stroke` in `auto` take the same follow timing whenever
  the plan has any turns at all; `rate` is used only when the plan has no turns anywhere, or `timing` is
  `rate`.
- A run pinned in **Follows** is used even when hidden; when it is gone the inspector shows "Missing run".

The Follows selector and the run chip exist only for `follow` and `knot` recipes. A `knot-pop-stroke`
segment (`knot-stroke`) has no selector and no chip and cannot pin a run from the UI; it is Auto (a `source`
written into the `.pawproj` is still honoured). The block shows the run chip (`⌖` when pinned) when several
runs overlap the segment or one is pinned. Turn kinds (top / bottom) come from the run's script; a plateau
turns at its first point.

## Import / export

In the Plan panel's **Import / export** section, or `timeline.plan.import*` / `export*` from the palette.

- **Import** (file or paste), mode **Replace** or **Into gaps** (existing segments win; an imported one
  split by an existing one becomes several). Accepts a director timeline
  `[{start_ms, end_ms, kind, intensity?, recipe?, params?, name?, locked?}]` (or `{segments|timeline|plan: [...]}`),
  tracking spans `[{start_ms, end_ms, state}]` / `{spans: [...]}`, or track events `[{t_ms, end_ms, kind}]`.
  Kind names are matched loosely (`knot`, `tie`, `bj`, `orgasm`, `credits`, ...); an unknown kind becomes
  Custom with the name kept. Intensity above 1 is read as a percent or tenths. Overlaps are trimmed, earlier
  wins; everything is clamped to the video.
- **Export director JSON** (file or clipboard): the plan rows as above, intensity lifted to the top level.
- **Export tracking spans**: `{spans: [{start_ms, end_ms, state: active | idle | carry | climax | orgasm}]}`, touching
  equal states merged, the tracker's spans input for a tracking run.

The plan itself is saved in the `.pawproj` (it does not fit in a bare `.funscript`).

## Recipes for common jobs

- **Steady strokes at a tempo, no tracking:** kind Custom, recipe `strokes` or `penetration-strokes`,
  set `rate` (2.4 = 72 strokes/min; strokes/min ÷ 30).
- **Fast in, slow out:** `strokes` / `ramp` with `inFrac` 0.35.
- **Build-up over a minute:** `accelerando` (rate 1.2 → 3.2) or `fade-in` (depth 0.15 → 1).
- **Wind-down to a stop:** `afterglow` (rate 2.0 → 0.6, depth 0.8 → 0, ends at the top) or
  `afterglow-follow` to keep the tracked timing while fading out.
- **Cutaway while the action continues:** kind Off-screen (`carry`), plain `follow`: where the run has no
  turns there, the neighboring rate is carried straight through; where it does, they are used. Without a plan
  segment: mark the scenes as one action (scenes row, right-click; workflows.md "Cutaways"): the bridge plays live there.
- **Knot that goes in and stays:** `knot-tied` (`popsBeforeTie` 1); for repeated pops with `between`
  bumps before each (the cycle loops until the segment ends), `knot-pop-held`; for the scripted feel of a
  pop on every stroke, `knot-pop-stroke`.
- **Quieter version of any segment:** the Intensity slider (depth × I toward the anchor, rate × (0.5 + 0.5 I)).
- **Hand-made span inside a generated scene:** Lock the segment (or Detach it) and leave it out of Generate.
