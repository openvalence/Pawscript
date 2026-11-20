# lib/analyze — pure analysis

Plain ES modules, no DOM, no IO. Import from `src/lib/analyze/index.js` (or the individual files). Scripts are core `Script`s
(`{at:int ms, pos:0..100}[]`, 0 = deepest). Times in ms, speeds in pos units per second.

Vocabulary: a *move* is one reversal-to-reversal movement; a *stroke* is a full cycle (down + up), so
`strokesPerMin` = cycles per minute. A reversal counts when the signal moved back >= `minProm` (default 10) units.

## heatmap.js
- `heatmap(script, {t0, t1, width, minProm=10, restSpeed=2})` -> `{t0, t1, width, binMs, mean, peak, rate, activity, maxMean, maxPeak}`.
  `mean/peak/rate/activity` are `Float32Array(width)`: mean speed (u/s), peak segment speed (u/s), strokes (cycles) per minute from
  turning points in the bin, share (0..1) of the bin moving faster than `restSpeed`. t0/t1 default to first/last action. One pass over the
  window; typed arrays cached per Script identity (a new Script after an edit = one O(n) copy). Timings below.
- Colour (all return `[r,g,b]` 0..255; no CSS): `SCALES` (`heat`, `viridis`, `cividis`, `grey`), `SCALE_NAMES`, `colorAt(scale, v01)`,
  `speedColor(speed, {scale='heat', max=400})`, `colorLut(scale)` (256 entries), `colorize(Float32Array, {scale,max})` -> RGBA `Uint8ClampedArray`.
  `heat` stops are an approximation from memory of common funscript heat colours; viridis/cividis are approximate stops.

## stats.js
`statistics(script, {t0, t1, minProm=10, restSpeed=2, windowMs=60000, stepMs=windowMs, ampBins=10, posBins=20})` -> plain JSON-able object:
`durationMs, actions, strokes{turns,moves,cycles}, strokesPerMin, activeStrokesPerMin, strokesPerMinSeries[{t0,t1,count,spm}],
amplitude{n,mean,p10,p50,p90,min,max,hist[ampBins]}, positionHist[posBins] (time-weighted shares), range{p5,p95,shareAt0,shareAt100,
actionShareAt0,actionShareAt100}, speed{mean,p50,p90,p99,max} (p* time-weighted over segments), rest{ms,share}, longestGap{ms,at},
avgStrokeMs, medianStrokeMs, avgCycleMs, asymmetry{upMs,downMs,upShare,upSpeed,downSpeed,speedRatio}`. Undefined values are `null`.
A range past the script counts as rest.

## problems.js
`findProblems(script, profile=GENERIC, ctx={})` -> `[{id, severity:'error'|'warn'|'info', kind, t0, t1, ats, message, fix?}]`, sorted by t0
then severity then kind. `id = kind@t0` (stable across edits elsewhere; `#n` on collision; `empty-chapter@<chapter id>`).
`ctx`: `{mediaDurationMs, cuts:[ms|{t}], chapters:[{id,t0,t1,name,expectMotion?}], thresholds:{...DEFAULTS overrides}}`.
`script` may be an unnormalised imported list: hygiene problems come first, other checks run on its normalised form.

| kind | severity | fix (`{op, opts, sel}`; call `edit[op](script, sel, opts)`) |
|---|---|---|
| `invalid-action`, `out-of-order`, `duplicate-time`, `negative-time`, `invalid-position` | error | `normalize` (core/script.js, `normalize(script)`) |
| `speed-limit` | error (> 1.5x limit) / warn | `capSpeed` `{maxSpeed, method:'pull'}` sel `{t0,t1}` |
| `too-close` | warn | `thinMinGap` `{minGapMs, keep:'extreme'}` |
| `long-gap` (inside an active section) | warn | none |
| `redundant` (middle of a flat hold) | info | `simplify` `{tolerance:0}` (sel padded by one neighbour each side) |
| `out-of-range` (outside profile.range) | warn | `limitRange` `{lo,hi,mode:'clamp'}` |
| `jitter` | info | `removeMicroReversals` `{threshold}` |
| `micro` | info | `cleanMicro` `{gapMs, posTol}` (thresholds `microGapMs`, `microPos`) |
| `past-media` | error | `deletePoints` sel `{t0: mediaDurationMs+1}` |
| `cut-jump`, `chapter-jump` | warn | none |
| `cut-sync` (rhythm continues unbroken across a cut) | info | none |
| `empty-chapter` | warn | none |

`fix.op` names are real exports of `src/lib/edit/` (`FIX_OPS` lists the module). `summarize(problems)` -> `{error,warn,info}`.
Exports also `DEFAULTS` (thresholds).

## profiles.js
`GENERIC` (250 u/s, 80 ms), `BUILTIN_PROFILES` (generic, generic-fast, handy, keon, launch, osr2), `makeProfile(partial)` (validates, throws
precise message), `listProfiles(userProfiles)`, `getProfile(id, userProfiles)`. Shape `{id,name,maxSpeed,minIntervalMs,range:[lo,hi],latencyMs,verified,note}`.
**All named device figures are unverified** (`verified:false`); profiles are plain data and user-editable.

## Kinematics (profiles.js additions, kinematics.js, kinetic/)  — all additive
**Profile fields** (optional): `kinematics: {strokeMm, vMax mm/s, aMax mm/s^2, jMax mm/s^3, strokeRange?: [lo,hi] slider hint}`, `limits: 'hard'|'planner'`
(default `'hard'`), `maxSpeedDerived`. Units: `units/s = mm/s / strokeMm * 100` (same factor for a, j). `strokeMm` is a WORKING parameter, not a fact.
- `toUnits(profile)` -> `{v, a, j, strokeMm}` in pos units; `withStroke(profile, mm)` -> profile copy (cheap, for live sliders); `effectiveMaxSpeed(profile)`
  (kinematics.vMax-derived when `maxSpeed` is unset/derived, else `maxSpeed`; `findProblems` and `makeProfile` use it); `limitsMode(profile)`.
- Built-in `nucleus-capstan` (`verified: true` for v/a/j = 1200 / 100 000 / 20 000 000; strokeMm 200, strokeRange [100,300], `limits:'planner'`;
  minIntervalMs 20 and latencyMs 0 are guesses).

**Move maths** (any consistent unit system; limits `{v,a,j}`): `minMoveTime(d, lim)` seconds for a rest-to-rest S-curve (regime `j` jerk-only when
d <= 2a^3/j^2: `T=4cbrt(d/2j)`; `a` acceleration-limited: `T=2(vp/a+a/j)`; `v` cruise: `T=d/v+v/a+a/j`; if v < a^2/j, a is capped at sqrt(vj));
`minMoveTimeInfo` -> `{T, regime, vPeak}`; `maxReach(T, lim)` (inverse); `reachTime(d, lim)` (from rest, free end velocity);
`maxStrokesPerMin(amplitude, lim)` (back-to-back rest-to-rest moves).

**Per-stroke check** `strokeShortfalls(script, lim, {minProm=3})` -> failing strokes `{i0,i1,t0,t1,D,durationMs,requiredMs,shortfallMs,limiting,shortfallUnits,sub}` (array has `.total`);
`sub` `{i0,i1,t0,t1,d,durationMs,requiredMs,whole}` is the part that sets the shortfall (whole stroke, rest -> action k, or k -> rest), `shortfallUnits` its analytic lower bound.
Each stroke between rest points (turning points, hold edges, ends) must satisfy `T >= minMoveTime(D)` and at every interior action
`t_k >= reachTime(d_k)` and `T - t_k >= reachTime(D - d_k)`. Exact necessary conditions for a monotone stroke; small counter-wiggles are ignored
(net displacement); sufficiency is not claimed.

**Problems**: kind `kinematic-limit` (`limiting: 'j'|'a'|'v'`, `shortfallMs`, `shortfallUnits`; error if >20% short, else warn) with fix
`{op:'capSpeed', opts:{maxSpeed: D/required, method:'retime', ripple:true}, sel, needs:'capKinematics'}`. `capSpeed` only knows speed: the
average-speed trick makes the stroke take at least the required time (approximation, middle slower than needed). The op we would want in
`src/lib/edit`: `capKinematics(script, sel, {limits:{v,a,j}, method:'retime'|'pull', ripple})`.
**Planner profiles** (`limits:'planner'`): `kinematic-limit` becomes kind `planner-reshaped`, `speed-limit`/`too-close` keep their kind; all three are severity `info`,
carry `planner: true`, have NO `fix` (so never in fix-all) and keep the would-be fix as `optionalFix`. Message: "The planner will reshape this stroke: ... needs at least X ms,
has Y ms; expected peak position shortfall Z units" (`>= Z` analytic lower bound; measured when `ctx.simulation` is passed). Numbers are those of the limiting part
(`(first|last part of a D-unit, T ms stroke)` when it is not the whole stroke); planner notes under 1 unit of shortfall are dropped. `summarize` -> `{error, warn, info, planner}`:
planner findings are counted ONLY in `planner`.

**Simulation** `simulateDevice(script, limits, {t0, t1, dtMs=1, engine='auto', strokeMm})` -> `{dtMs, t, pos, vel, acc, engine, ...}` (Float64Arrays; pos units, units/s, units/s^2).
`limits` = `toUnits(profile)` (carries strokeMm). Engines: `'kinetic'` the machine's own Kinetic2 planner (vendored wasm, below), `'scurve'` dependency-free analytic model,
`'auto'` = kinetic once loaded, else scurve (`result.engine` says which). Synchronous. `await loadKinetic()` first (returns the version string, or null and `kineticError()` on failure);
`simulateDeviceAsync` does both. `kineticLoaded()`, `kineticVersion()`.
**Whole-script plan** `planDevice(script, limits, {engine})` is a generator (yields between ~4k-ms chunks) returning `{t0, dtMs: 1, pos (Float32Array, units), flags, engine, anomalies}`:
the motion when the script plays from its start. Use it, not a window of the script, for previews: the planner carries history (an over-limit run stays on the side of the
rail it began on, measured: 0/100 every 120 ms swings 0..55 from a 0 start, 45..100 from a 100 start). `planAt(plan, t)`, `planScript(plan, tol, {ints, from})` (a Script within tol),
`planMisses(script, plan, tol=2)` (points the planner trims), `planClamps(plan)` (held at a window edge >= 10 ms).
`trackingError(script, sim)` -> `{max, rms, lagAtExtremesMs:{n,mean,max,p90}, extremeShortfall:{mean,max}}`.
`sweepStroke(script, profile, [100,150,200,250,300], {tracking=true, engine, dtMs=2})` -> rows `{strokeMm, strokes, reshaped, share, worstShortfallMs, worstShortfallUnits, rms, maxError, engine}`
("at which window size does this script start to get reshaped?"; `{tracking:false}` is pure maths, instant).

**Kinetic2, what it does** (source: Kinetic `solver.hpp`/`handles.hpp`, Nucleus `.claude/rules/motion-control.md`, measured on the wasm): an event-driven look-ahead knot planner. Every
script point is a knot "be at p at time t"; legs are composite cubic Béziers. TIME is never given up: a knot the ceilings (v/a/j sampled on a 1 ms grid) cannot reach is moved toward the previous
achieved position, in position only, by the least legal amount, in one forward greedy pass; a hold after a trimmed knot stays at the trimmed position. Rests (end velocity 0) are declared by the host at
reversals, hold edges, the last point and gaps > 500 ms; other knots are free (pchip-shaped). Unconstrained rest-to-rest legs are smoothstep (peak 1.5x chord). No global delay (emitter 1 ms), look-ahead ~150 ms.
Consequence: over-limit input comes out LOWER (peaks/valleys cut, mean drifts to the first-visited side), not late. The `kinetic` engine feeds the wasm exactly as Phosphor's player does (`kinetic/driver.js`).
The `scurve` engine applies the same rules analytically (`plannerShape` forward-greedy trim with 0.9x reach (0.85x more through interior free knots), smoothstep legs, then a jerk/accel/velocity-limited tracker).
Where it differs: dense free runs (fast sine) trim differently and lag more in the planner (extremes 20-40 ms late vs ~2 ms), free knots are pchip in the planner vs linear here, and the planner's reach is ~10% below
the time-optimal S-curve. Use `kinetic` for anything the user looks at; `scurve` is the fallback when the wasm cannot load.
Vendored files and refresh procedure: `kinetic/PROVENANCE.md` (Apache-2.0, owner-approved copy; pin test `test/analyze-kinetic-pin.test.mjs`).

## compare.js
`compare(cand, ref, {t0,t1,tolMs=150,minProm=10,maxLagMs=500,allowFlip=false,maxSamples=60000})` -> fields named as in
`trackers/pawtrack/score.py`: `sign, lag_ms (>0 = candidate late), lag_bound_ms, r_pos, r_vel, r_pos_lag, r_vel_lag, n_cand, n_ref, tp, fp, fn,
precision, recall, f1, f1_lag, dt_median_ms, dt_p90_ms, dt_bias_ms`, plus `pairs[{cand,ref,kind,dt}]`, `unmatchedCand/Ref[{at,kind}]`
for drawing. Turning points match one-to-one, same kind, within tolMs, closest first (stable bucket sort, O(candidate pairs)). Samples at 100 Hz; ranges over ~10 min use 30 s windows spread over the range. Empty range -> `{empty:true,...}`.

## util.js (also re-exported: `arrays, clipped, turns, percentile`)
`turns(at, pos, minProm)` zigzag turning points; `clipped(script,t0,t1)` range with interpolated ends.

## Timings (100 000 actions, this dev machine)
heatmap 2000 px full range 2-5 ms (cold 5, warm 2, after an edit 2.4); 60 s window 0.02 ms; statistics ~57 ms; findProblems ~60 ms
(24 000 problems on a noisy script); compare ~110 ms (dense random 100k vs 100k, a point every 5 ms: ~140 ms, was ~550 ms).
