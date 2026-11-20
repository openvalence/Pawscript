# lib/edit - pure edit operations on Scripts

Plain ES modules, no DOM, no dependencies. `import * as E from '../lib/edit/index.js'` (or import single modules). Every function
takes and returns immutable `Script` values from `lib/core/script.js` (`{at int ms, pos int 0..100}`, strictly increasing `at`,
pos 0 = deepest). Inputs are never mutated; unchanged actions are shared by reference (treat actions as frozen).

## Calling convention

```js
op(script, sel, opts) -> { script, ats }
```

- `sel` - `{ ats: Set<int> | int[] }` (selected timestamps) | `{ t0, t1 }` (inclusive time range; either end optional, reversed
  ends tolerated) | `null` (whole script). Timestamps not in the script are ignored. Empty selection -> script returned unchanged, `ats: []`.
- `opts` - plain object; every key is optional and has the default listed below. Unknown keys are ignored.
- result `script` - always valid (`isValid`). `ats` - sorted timestamps of the actions *the op produced/kept from the selection after the
  edit* (the new selection to show). Delete-like ops return `[]`; insert-like ops include the inserted points.
- Unselected actions are never changed, except: (1) a moved/pasted point that lands on an unselected action's timestamp replaces it
  (collision rule below), (2) documented ripple/range-clearing ops (`rippleInsert`, `rippleDelete`, `repeatSelection`
  `replace`/`insert`, `repeatLastStroke`, `changeStrokeRate` fill `ripple`, `capSpeed`/`minSpacing` with `ripple: true`, paste
  `replace`/`insert`, `setPoint`/`numberKey` within their tolerance).
- Collisions: ops that move times take `collide: 'moved'` (default; the moved point wins, later moved wins among moved, may reorder
  past unselected points) or `'clamp'` (selected points stay strictly between their unselected neighbours, order preserved, nothing
  is lost). Times are clamped to >= 0, pos clamped to 0..100, everything rounded to integers.
- Selection helpers (`group: 'select'`, `selection: true`) return `{ script: <same array>, ats }` - only the new selection matters.
- Random ops (`jitter`, `humanise`) are seeded by `(seed, original at)`: reproducible, and one action's offset does not depend on which
  others are selected.
- Not in the `{script, ats}` shape: `copy(script, sel) -> snippet`, `cut(...) -> {script, ats: [], snippet}`,
  `paste(script, snippet, at, {mode}) -> {script, ats}`, `pasteScaled(script, snippet, {t0,t1,mode})`, `patternFill(script, sel, {snippet|source, period, seam})`.
  A snippet is `{ origin, duration, actions: [{at relative to origin, pos}] }`, a plain value (copy->paste `replace` at `origin` is the identity
  for a contiguous selection).
- Helpers: `turns(script, minProminence=0, {endpoints=true}) -> [{i, kind:'top'|'bottom'}]`, `strokes(script, minProminence=0) -> [{i0, i1, dir (+1 up/-1 down), amplitude, durationMs, speed}]`,
  `rdp`, `smoothSeries`, `savgolWeights`, `tile`, `easeFn`, `selMask`, `selInfo`.
- API-only options (not representable as form fields, so not in `OPS`): `quantize({times})` (VFR frame times), `snapToTimes({times, tolerance})`,
  `envelope({curve:'custom', points:[[u,gain],...]})`, `repeatSelection`'s `until` (0 = off in the form), paste/pattern-fill snippets.

## OPS catalogue

```js
OPS = [{ id, title, group, params: [Param], apply(script, sel, params) -> {script, ats}, playhead?: key, selection?: true }]
Param = { key, label, type: 'number'|'bool'|'choice', default, min, max, step, unit }   // number
      | { key, label, type: 'choice', default, choices: string[] } | { key, label, type: 'bool', default }
getOp(id), runOp(id, script, sel, params)   // missing params take their catalogue defaults
```

`apply` fills missing params with the catalogue defaults, so a form may send only what the user changed. `playhead: 'at'` means the UI should
fill that param with the playhead time (the op ignores the selection for the point itself). Entries with `selection: true` change only the
selection. Groups: points, amplitude, time, density, speed, rhythm, variation, select. Ids and param keys are stable: add, never rename.

## Operations (generated from `OPS`)

### points

| id | title | options (default) |
|---|---|---|
| `setPoint` | Set point at time (playhead: `at`) | `at` 0..1000000000 ms (0); `pos` 0..100 (50); `tolerance` 0..1000 ms (0); `frameMs` 0..1000 ms (0) |
| `numberKey` | Number key (pos = key x 10) (playhead: `at`) | `key` 0..10 (5); `at` 0..1000000000 ms (0); `tolerance` 0..1000 ms (40); `frameMs` 0..1000 ms (0) |
| `delete` | Delete | - |
| `move` | Move by | `dt` -60000..60000 ms (0); `dpos` -100..100 (0); `collide` moved\|clamp (moved); `frameMs` 0..1000 ms (0) |
| `nudgeTime` | Nudge time | `frames` -100..100 (1); `frameMs` 1..1000 ms (33.333); `collide` moved\|clamp (clamp) |
| `nudgePos` | Nudge position | `amount` -100..100 (1) |
| `setPos` | Set position | `pos` 0..100 (50) |
| `setTime` | Set time of first point (playhead: `at`) | `at` 0..1000000000 ms (0); `collide` moved\|clamp (moved) |

### amplitude

| id | title | options (default) |
|---|---|---|
| `scale` | Scale amplitude | `factor` 0..5 (1); `pivot` center\|top\|bottom\|mean\|mid\|custom (center); `value` 0..100 (50) |
| `offset` | Offset position | `amount` -100..100 (0) |
| `invert` | Invert (100 - pos) | - |
| `remapRange` | Remap range | `lo` 0..100 (0); `hi` 0..100 (100); `trim` 0..49 % (0) |
| `limitRange` | Limit range | `lo` 0..100 (0); `hi` 0..100 (100); `mode` clamp\|compress (clamp) |
| `normalise` | Normalise to full range | `trim` 0..49 % (0) |
| `envelope` | Amplitude envelope | `from` 0..5 (1); `to` 0..5 (0.5); `curve` linear\|easeIn\|easeOut\|easeInOut\|sine (linear); `pivot` center\|top\|bottom\|mean\|mid\|custom (center); `value` 0..100 (50) |
| `alignExtremes` | Align tops / bottoms | `which` both\|tops\|bottoms (both); `to` value\|mean (value); `topValue` 0..100 (100); `bottomValue` 0..100 (0); `strength` 0..1 (1); `minProminence` 0..100 (0) |
| `extremes` | Expand / soften extremes | `amount` -50..50 (5); `which` both\|tops\|bottoms (both); `relative` bool (false); `minProminence` 0..100 (0) |

### time

| id | title | options (default) |
|---|---|---|
| `shift` | Shift in time | `dt` -600000..600000 ms (0); `collide` moved\|clamp (moved) |
| `stretch` | Stretch in time (playhead: `at`) | `factor` 0.05..20 (1); `anchor` start\|end\|center\|playhead (start); `at` 0..1000000000 ms (0); `collide` moved\|clamp (moved) |
| `fitDuration` | Fit to duration | `duration` 1..3600000 ms (1000); `anchor` start\|end\|center (start); `collide` moved\|clamp (moved) |
| `fitToRange` | Fit to time range | `t0` 0..1000000000 ms (0); `t1` 0..1000000000 ms (1000); `collide` moved\|clamp (moved) |
| `reverse` | Reverse in time | - |
| `rippleInsert` | Insert time (ripple) (playhead: `at`) | `at` 0..1000000000 ms (0); `duration` 0..3600000 ms (1000) |
| `rippleDelete` | Delete time (ripple) | - |
| `quantize` | Quantise to frames | `frameMs` 1..1000 ms (33.333); `origin` 0..1000 ms (0) |
| `equaliseSpacing` | Equalise spacing | `collide` moved\|clamp (moved) |

### density

| id | title | options (default) |
|---|---|---|
| `simplify` | Simplify (RDP) | `tolerance` 0..50 (2); `metric` vertical\|perpendicular (vertical); `timeScale` 0.001..10 pos/ms (0.1); `keepTurns` bool (false); `keepProminence` 0..100 (0) |
| `thinMinGap` | Thin by minimum gap | `minGapMs` 1..5000 ms (100); `keep` first\|extreme (first) |
| `keepExtremes` | Keep extremes only | `minProminence` 0..100 (0); `keepEnds` bool (true) |
| `removeMicroReversals` | Remove micro-reversals | `threshold` 1..50 (3) |
| `addMidpoints` | Add midpoints | `count` 1..20 (1); `minSegmentMs` 0..10000 ms (0) |
| `subdivide` | Subdivide with easing | `steps` 1..50 (3); `shape` linear\|sine\|easeIn\|easeOut\|easeInOut\|twoSpeed (sine); `ratio` 0.1..20 (2); `split` 0.05..0.95 (0.5); `stepMs` 0..5000 ms (0) |
| `smooth` | Smooth | `method` moving\|savgol (moving); `window` 20..5000 ms (200); `order` 1..5 (2); `step` 5..200 ms (20); `refit` times\|simplify (times); `tolerance` 0..20 (1); `pinEnds` bool (true) |

### speed

| id | title | options (default) |
|---|---|---|
| `capSpeed` | Cap speed | `maxSpeed` 10..2000 pos/s (400); `method` pull\|retime (pull); `ripple` bool (false) |
| `capKinematics` | Cap to device kinematics | `profile` built-in id (nucleus-capstan); `strokeMm` 50..400 mm (200); `method` pull\|retime (pull); `ripple` bool (false); `minProminence` 0..100 (3). Limits = `toUnits(withStroke(profile, strokeMm))` (speed-only for profiles without kinematics); pull = per rest-to-rest stroke the reached amplitude is clamped to `maxReach(T)`, retime = `cascadeRetime` with `minMoveTime` per move |
| `minSpacing` | Enforce minimum spacing | `minGapMs` 1..5000 ms (50); `method` push\|drop (push); `ripple` bool (false); `keep` first\|extreme (first) |

### rhythm

| id | title | options (default) |
|---|---|---|
| `doubleTime` | Double time | `factor` 2..8 (2); `minProminence` 0..100 (0) |
| `halfTime` | Half time | `factor` 2..8 (2); `keep` first\|last (first); `minProminence` 0..100 (0) |
| `changeStrokeRate` | Change stroke rate | `factor` 0.1..8 (2); `fill` repeat\|ripple\|none (repeat); `seam` next\|prev\|mean (next) |
| `repeatLastStroke` | Repeat last stroke at playhead (playhead: `at`) | `at` 0..1000000000 ms (0); `count` 1..100 (1); `shape` cycle\|stroke (cycle); `mode` replace\|merge\|insert (replace); `minProminence` 0..100 (0) |
| `repeatSelection` | Repeat selection (playhead: `until`) | `count` 0..1000 (1); `until` 0..1000000000 ms (0); `period` 0..3600000 ms (0); `seam` next\|prev\|mean (next); `mode` replace\|merge\|insert (replace) |
| `duplicate` | Duplicate | `count` 1..100 (1); `mode` merge\|replace\|insert (merge) |

### variation

| id | title | options (default) |
|---|---|---|
| `jitter` | Jitter | `timeMs` 0..500 ms (10); `amp` 0..50 (2); `seed` 0..1000000000 (1); `distribution` uniform\|gaussian (uniform); `collide` clamp\|moved (clamp); `keepEnds` bool (false) |
| `humanise` | Humanise | `preset` subtle\|natural\|loose (natural); `amount` 0..3 (1); `seed` 0..1000000000 (1); `keepEnds` bool (true) |

### select

| id | title | options (default) |
|---|---|---|
| `selectTurns` | Select tops / bottoms | `which` both\|tops\|bottoms (both); `minProminence` 0..100 (0) |
| `grow` | Grow selection | `count` 1..100 (1); `side` both\|before\|after (both) |
| `shrink` | Shrink selection | `count` 1..100 (1); `side` both\|before\|after (both) |
| `everyNth` | Select every Nth | `n` 1..100 (2); `offset` 0..100 (0) |
| `selectBySpeed` | Select by speed | `above` 0..5000 pos/s (0); `below` 0..5000 pos/s (5000); `basis` max\|in\|out (max) |
| `selectSimilar` | Select similar strokes | `ampTol` 0..100 (10); `durTolPct` 0..200 % (25) |
| `invertSelection` | Invert selection | - |

## Notes on semantics

- Range selection `{t0,t1}` vs `{ats}`: ops that need a span (stretch, reverse, fitDuration, envelope, repeatSelection, rippleDelete) use the
  range for a range selection and first..last selected action for an `ats` selection.
- `simplify`, `thinMinGap`, `smooth`, `addMidpoints`, `subdivide` work per contiguous run of selected actions; `thinMinGap` does not check the
  gap to unselected neighbours; `capSpeed` 'pull' only changes selected actions and does not re-check the action after the selection.
- `halfTime`/`doubleTime` work on cycles (bottom-top-bottom) between turning points of the *selected* actions (`minProminence` filters noise);
  leading/trailing partial cycles are left alone.
- `repeatLastStroke` ("Q"): finds the last complete cycle (or single stroke) ending at/before `at` and places it starting at `at`.
- `repeatSelection`: copy 0 is the selection itself; copies start at `first + k*period`; with `until` the last copy is cut with an interpolated point.

## Tests and timings

`test/edit-basic.test.mjs` (hand-computed cases per op, edges), `test/edit-props.test.mjs` (2500 seeded random scripts x every catalogue op:
validity, no mutation, unselected untouched; inverse pairs; invariants; timings). Run with `npm run check`.
On a 100 000-action script, whole-script, default params: simple transforms 3-20 ms, simplify ~140 ms, smooth ~60 ms, everything else < 40 ms.
