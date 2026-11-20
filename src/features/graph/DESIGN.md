# Node graph — design

Status: design of record for the node-graph feature. The exact signatures every builder codes against are in
**`src/lib/graph/README.md` (the contract)**. This file explains the design and its reasons, and lists what
each builder delivers. Where the two disagree, the contract wins. File a note in your report instead of
changing it.

## 1. Goals

A **non-destructive dataflow graph** for really advanced scripting:
- Sources (axes, ghosts, tracker runs, plan, chapters, loops, bookmarks, scenes, span labels, audio,
  generators) flow through processing nodes (every `lib/edit` op, every `lib/gen` generator, plus maths,
  mix, gate, switch, envelope and timing nodes) into outputs (one Script per axis, and ghost previews).
- Live preview. Nothing touches the document until **Bake**, which writes every output as ONE undo entry.

Must-build examples, all shipped as presets (§9):
1. tracker signal → smooth → extremes → depth range chosen per plan segment kind;
2. mix two trackers by confidence;
3. derive roll/twist from the stroke's phase;
4. climax pulses only inside spans of kind `climax`;
5. A/B two chains as ghosts.

Quality bar:
- Results are deterministic, so a bake reproduces exactly what the preview showed.
- An error stays on the node that caused it. No silent zeros, no data loss: unknown node types and unknown
  keys survive a load/save.
- Scrubbing a parameter feels instant on a 10-minute, 100 000-action document.
- Everything is reachable from the keyboard.

Non-goals for this build:
- real-time device output (Phosphor's runtime);
- a persistent cache;
- auto-bake;
- macros/subgraphs (§13);
- a Web Worker. The engine is kept worker-ready.

## 2. How this design was chosen

Three proposals were judged: *dataflow* (rigorous engine), *catalogue* (thin layer over the libraries) and
*ux* (power-user workflow). Two of three judges picked dataflow as the base. This design is dataflow's
engine with these grafts:

| Decision | From | Why |
|---|---|---|
| Merkle cache keys + identity tokens, ids out of keys, pinned latest values, byte-budget LRU | dataflow | No false hits by construction. Undo and A/B hit the cache. Duplicated chains share entries. |
| Faults as values: root cause red, downstream `blocked`, independent outputs still bake | dataflow | Debuggable and safe. |
| Store **all** params incl. defaults; seeds stored at creation; topo ties by id | dataflow | A library default change, or a preset id remap, can never silently change a result. |
| Real float signals on one grid per graph (`rate` 25/50/100/200 Hz), explicit NaN rules | dataflow | Exact confidence/phase maths. Catalogue's integer-Script signals were rejected (quantisation, missed crossings). |
| **Four** wire types: script, signal, spans, number (+ `any`). Points = zero-length spans, gates = spans, bool = 0/1 | ux | Halves dataflow's seven types and its adapter table. Fewer mis-wirings. |
| Two adapters only: script→signal `sample`, number→signal `const`. Everything else is refused with a suggested conversion node | ux + judges | Turning a signal into a script, or spans into a gate value, is a creative choice and is never implicit. |
| `compile()` once per structure change; param edits reuse the Program | ux | Saves validation and topo per scrub frame. |
| `halo`/`local` declared on every node from day one, proven by a halo-honesty property test; windowed preview in P1 | dataflow + ux | Needed to meet the scrub performance target (§6.6). The test makes the halo table trustworthy. |
| `perSpan` + `byKind` overrides on every wrapped op and generator, folded per span with `{t0,t1}` selections (not `{ats}`) | catalogue + judge fix | Cheap, discoverable per-kind control of non-pointwise ops (e.g. smoothing window per kind). Range semantics preserved. |
| Pointwise nodes take time-varying params (`mod:'signal'`, `ctx.param(key)(t)`) | dataflow + ux | Exact per-action depth-by-kind with crossfades (`spans.kindRange` → `amp.remap`). |
| `changed` output on wrapped edits; `lastBake` hashes + confirm when the axis changed since bake | ux | Visibility and data-loss guard. |
| Pure `bakePlan` in lib; bake always re-evaluates the full range | catalogue + dataflow | Testable in node. No stale-preview bakes (catalogue's debounce hole). |
| `src.ghost` never sees the graph's own ghosts; slow-graph fallback to "on release" names the slow node | catalogue | No feedback loops. Honest about cost. |
| Measured socket positions (ResizeObserver), keyboard chain building, quick fixes, A/B pins + snapshot, time cursor, probe lane, hover card | ux | Debugging is "follow the wire at one instant". |
| `sig.expr` safe expression node, Freeze-source-to-ghost, knife cut | dataflow | Free-form roll/twist maths, and a fix for the self-reference trap. |
| Registry built in lib from lib/edit + lib/gen (both are lib, both exist now). Plan compiler injected | judges' fact check | No lib→features import. `lib/gen` has `RECIPES`/`GENERATORS` objects, but `plan.js`/`index.js` have not landed yet. |
| Tracker data from the tracking feature (`peekTracking(app).runs`) via integration | tree as it is | `app.runs` does not exist. Runs moved from `bench` to `features/tracking`. |

Cut, with the reason in one line each:
- `mask`, `events` and `bool` types: spans and number cover them.
- Piecewise modulation of wrapped ops: byKind covers the real cases, at O(n) rather than O(runs·n).
- Graph-level scope: `out.axis` `mode: inside` plus `where` covers it.
- `out.compare` and `out.probe` nodes: `an.compare`, A/B pins and the controller probe cover them.
- `dynamicPorts`: `src.run` picks its channel by param.
- Macros, gallery and dirty-range splicing: phase 2.

## 3. Graph model and serialisation

The JSON shape is in the contract §1. Key points:
- **Plain immutable JSON values.** Every model function returns a new graph (the same discipline as Scripts
  and `app.doc`). This makes undo a reference swap and lets Svelte see changes by identity.
- **Versioned**:
  - `graph.v` (format version, `MIGRATIONS` table in `serialize.js`);
  - `node.tv` (per node-type version, `def.migrate`);
  - the `.pawproj` block `{v:1, items}`.
- **Unknown survives**:
  - Unknown node types load as placeholders. They keep their params and links, render as
    "Missing: edit.foo", and are an error only if an output depends on them.
  - Unknown keys at every level round-trip.
  - Only dangling links are dropped, with a diagnostic.
- **Links** are `{id, from, out, to, in}`, with named multi-port outputs. `in: 'p:<key>'` drives a param.
  One link per input: a second link replaces the first, as in Phosphor.
- **Not in the graph**: view and selection (editor-local), so panning and selecting never create undo
  entries. `lastBake` IS in the graph, so undoing a bake (in app-undo mode) also restores the bake status.
- **Presets** use the same node/link shape with preset-local ids, remapped on placement (§9).

## 4. Port types and conversions

The contract §2 is normative. In short:

| Type | What it carries | Typical producers |
|---|---|---|
| **script** | the frozen Action[] | axes, ghosts, edit ops, generators, `sig.toScript` |
| **signal** | `{i0, dt, v: Float32Array}` on the graph grid, NaN = unknown | tracker samples, confidence, phase, envelopes, LFOs, audio, maths |
| **spans** | sorted `[{t0,t1,kind?,label?,value?,data?}]`, half-open; zero-length = point | plan, chapters, loops, scenes, tracker events, turns, selections, thresholds, problems |
| **number** | finite number (0/1 for booleans) | constants, `an.stat`, `an.compare`, media |
| **any** | type variable on generic flow nodes, resolved by the first connected input | `flow.*` |

**NaN rules.**
- Elementwise maths propagates NaN.
- `sig.blend` ignores a NaN arm when the other arm is present.
- `sig.toScript` leaves gaps empty unless its `gaps` param says `hold`/`bridge`.
- `sig.fillGaps` states the policy explicitly.
- `ctx.param(key)(t)` falls back to the stored constant where a modulating signal is NaN.
- A non-finite *number* is an error.

**Adapters.**
- There are two adapters, both drawn as a diamond badge with a tooltip, e.g. "script read as signal:
  linear @ 50 Hz".
- Every other mismatch is refused at wiring time. The refusal names the conversion node, the
  link-drag-search offers it first, and the diagnostic carries a one-click `insertBefore` fix.

**Grid.**
- One signal grid per graph (`rate`, default 50 Hz → dt 20 ms) keeps elementwise maths trivial and windows
  aligned. 10 min at 50 Hz is 30 001 samples (≈120 KB).
- Timing finer than dt is lost in the signal domain. Where it matters, `sig.toScript` uses parabolic
  sub-sample refinement for extremes, or the user stays in the script domain.

## 5. Node-definition API

The contract §3 is normative. A node type is one frozen object that holds its declaration (ports, param
schema in the kit dialect, halo, locality, source reads) and its synchronous pure `eval(inputs, p, ctx)`.
This fixes Phosphor's split between a declaration table and a big `switch`.

- **Params** use kit `params.js` (`coerce`, `normalizeValues`), plus the graph flags `mod`, `inline`,
  `hidden`, `seed` and `editor`.
- **Modulation**:
  - `mod:'signal'` params (pointwise nodes only) are read per time through `ctx.param(key)`, so node code
    never branches on whether a param is wired.
  - `mod:'number'` params (wrapped ops) take a static number from e.g. `an.stat`.
- **`perSpan`/`byKind`**:
  - The engine adds an optional `where: spans` input and stores per-kind overrides.
  - The wrappers fold the op once per flattened span, with `sel = {t0, t1-1}` and that span's params.
  - With a finite halo, each fold step runs on a clipped slice (O(span), not O(n)).
  - Time-shifting ops fold right to left and get an info diagnostic: "shifts time; downstream spans are not
    shifted".
- **Auto-wrapping.**
  - Every `OPS` entry becomes `edit.<id>` (or `select.<id>` for selection ops), except `setPoint`,
    `numberKey` and `setTime`.
  - Every `GENERATORS` entry becomes `gen.<id>`, with each matching `RECIPES` entry as a palette
    *variant* (same node type, recipe params pre-filled).
  - A new library op therefore appears in the palette with no graph code. The catalogue sweep test covers it
    automatically.
- **Determinism.**
  - Params flagged `seed` get a random int at creation. It is stored, duplicates copy it, and the inspector
    has "Reroll".
  - `ctx.rng()` is seeded from it.
  - There are no clocks.

## 6. Evaluation

### 6.1 Pipeline
`compile(graph, reg)` runs validation and builds the Program:
- topo order (Kahn, ties by id);
- per-node ports;
- input-link maps;
- resolved types and adapters;
- static diagnostics;
- a `structureKey`.

It reruns only when structure changes. `withGraph(program, g)` swaps in a graph whose params changed.

`evaluate(program, run, {targets, range})`:
- It pulls only targets and their ancestors.
- For each node in order it computes the Merkle key (contract §5.3). On a cache hit it reuses the stored
  outputs; otherwise it runs `eval` and checks the outputs.
- It yields every 8 ms and honours an `AbortSignal`.
- The scheduler is latest-wins.

### 6.2 Keys and cache
- A key is a hash of the node's type, version, canonical params, byKind, rate, mute flag, its input keys
  with ports and adapters, and — for sources — the identity tokens of the document values they read. A
  windowed run adds the range.
- Document values are immutable, so identity tokens are exact and O(1). Undo restores the old array and
  hits.
- The cache is an LRU with a byte budget (64 MB default, setting `graph.cacheMB`). The latest value of
  every node is pinned outside the budget.
- Nothing is persisted.

### 6.3 Errors and cycles
- Cycles are refused at wiring time (`wouldLoop`). `compile` re-checks, because files can lie, and marks
  every node on a cycle as an error.
- A node that throws, lacks a required input, or has an unknown type is `error`. Its dependants are
  `blocked`, drawn dimmed with "waiting on Smooth".
- Outputs that do not depend on a failure still preview and bake.
- Invalid scripts or spans from a node are repaired (`normalize`/`normSpans`) with an `invalid-output`
  warning naming the node, so library bugs surface without corrupting a bake.
- Empty values are valid, not errors.

### 6.4 Windowed (time-range scoped) evaluation
- Each node declares `halo(p)` (ms of context each side, `Infinity` = global) and `local`.
- For a request on `[a,b]`, a node whose whole ancestry is local runs on `[a,b]` widened by the summed
  downstream halos.
  - Sources clip with `clipScript` (one neighbour beyond each end) and `sliceSignal`.
  - A node with a global ancestor uses the full-timeline value, computed once and cached.
- Results are exact on `[a,b]`.
- The halo-honesty property test is the gate: `local` may only be set on defs that pass it.
- **Dirty-range splicing is phase 2.** Windowing plus the cache already meet the target.

### 6.5 Scheduling (controller)
1. Any change (graph or source identity) starts a **windowed** run on `app.view` ± 25 % for the visible
   cards' main outputs, the previewed outputs, the probe and the pins. It is coalesced to one per
   animation frame. Its results drive sparklines and the probe lane.
2. After 150 ms idle, or on gesture commit, a **full** run starts. It publishes preview ghosts, updates
   output bake status, and is what `Bake` reuses when its keys are current.
3. If a full run exceeds 250 ms, the controller enters **slow mode**:
   - full runs happen only on commit;
   - the status line says "slow graph: 410 ms (Smooth 290 ms)";
   - each card shows its own time, amber above 50 ms.
4. **Bake** always requests a full evaluation of its outputs. It is instant when cached and never uses
   windowed values.

### 6.6 Performance targets and how they are met

Scenario: a 10-min video, a 100 000-action source script, a 30-node graph, a single param change.
Reference timings (lib/edit README, this machine, 100k actions):
- simple transforms: 3–20 ms;
- smooth: ~60 ms;
- simplify: ~140 ms.
Signal nodes over 30k samples: < 1 ms.

| Case | Target | Mechanism |
|---|---|---|
| Unchanged re-run (all hits) | < 2 ms | keys from params and input keys; no value hashing |
| Engine overhead per node | < 0.05 ms | params JSON is small; tokens O(1) |
| Param change, **windowed** preview of the affected subgraph (60 s view, local chain) | < 16 ms | only downstream nodes recompute, on ~10 % of the data |
| Param change, **full** re-run of an affected subgraph of O(n) nodes (≤ 20 ms each, up to 4 script ops plus signal/spans nodes) | < 100 ms | memo: upstream nodes hit |
| Affected subgraph containing smooth/simplify | windowed < 16 ms; full deferred to idle (60–200 ms) | §6.5 |
| Cold 30-node run | < 2 s | — |

`test/graph-engine-perf.test.mjs`:
- builds a seeded 100k-action script and a 30-node graph;
- asserts cold < 2 s, warm < 5 ms, a one-param change with a cheap 6-node downstream suffix < 100 ms full,
  and windowed < 20 ms;
- prints the timings.

The worker (phase 2) is triggered only if real graphs exceed these budgets. Values are structured-cloneable
and the engine is pure, so the move is mechanical.

## 7. Built-in node catalogue

Port names are in the contract §7. Params are listed as `name default`. "mod" marks a time-varying param.

**Sources** (`reads` declared; each recomputes only when its document value changes identity)
- `src.axis` `{axis 'stroke'}` → script.
  - Self-reference warning when it feeds an `out.axis` of the same axis.
  - Fix: *Freeze source to ghost*.
- `src.ghost` `{ghost}` → script.
  - Binds by id, then by name.
  - "ghost not found" is an error.
  - Never lists graph ghosts.
- `src.run` `{run, channel 'primary', maxGapMs 100}` → signal (samples × 100, pos units), confidence
  (0..1), points (script), events (spans: cycle/idle/carry/still/climax, with `end_ms` spans), scenes
  (spans, `value` = effective sign).
  - Runs are not saved across reloads. A missing run falls back to the ghost with the same id, read as a
    signal, with `source-missing` warn.
- `src.plan` `{kinds []}` → spans, `data` = `{id, recipe, params, intensity}`.
- `src.chapters` (kind `chapter`, label name), `src.loops` (kind `loop`, data `{id, tiledTo}`),
  `src.bookmarks` (points, label note), `src.range` (0 or 1 span).
- `src.selection` (points; warn: "selection is not saved and not undoable").
- `src.scenes` (the tracking feature's scenes; value = sign), `src.trackSpans` (span labels; kind via
  timeline `SPAN_KIND` mapping active→penetration, idle→idle, carry→offscreen, climax→climax).
- `src.audio` → signal (peak envelope 0..1). Empty, with an info message, until the waveform has loaded.
- `src.tags` `{tag}` → spans. Empty, with info "needs a tags provider", until one exists.
- `src.time` → signal (t in s). `src.media` → duration, fps.
- `const.number {value}`, `const.script` (small embedded template, mini-lane editor),
  `const.spans` (stored list, editable on the probe lane).

**Script analysis**
- `script.sample` `{interp linear|step|cosine}` → signal. The explicit form of the adapter.
- `script.turns` `{minProminence 5, which both|tops|bottoms}` → points (kind top/bottom, value pos).
- `script.strokes` `{minProminence 5}` → spans (kind up/down, value amplitude).
- `script.phase` `{minProminence 5}` → phase (0 at a top/out turn, 0.5 at a bottom/deep turn, linear in time
  between turns; NaN outside the first and last turn), amp (0..1, stroke amplitude interpolated between
  strokes), period (ms).
- `script.speed` → signal (pos/s). `script.rate` → signal (strokes/min).

**Script structure**
- `script.splice(base, insert, where)` `{seamMs 150, seam cut|blend}`: `insert` inside the spans, `base`
  outside. A blend seam uses `gen/util.blend` under the speed cap.
- `script.trim(script, where)` `{bridge true}`: keep actions inside. A bridge adds interpolated edge
  points.
- `script.merge(a, b)` `{priority b, minGapMs 0}`.
- `script.mix(a, b)` `{w 0.5 mod}`: pointwise at the union of times. Its help says to blend signals and then
  `sig.toScript` for clean strokes.
- `script.tile(template, where)` `{variation 0, seed}` wraps `gen/loops.tile`.

**Amplitude** (pointwise, exact per action, all mod)
- `amp.remap {lo 0, hi 100}`
- `amp.gain {gain 1, pivot 50}`
- `amp.offset {amount 0}`
- `amp.clamp {lo 0, hi 100, mode clamp|compress}`
- `amp.curve {curve linear|ease-in|ease-out|ease-in-out|exp (gen CURVES), gamma 1}`

**Edit** (auto-wrapped, `edit.<op>`, perSpan + byKind, `where`, `changed` output)
- amplitude: scale, offset, invert, remapRange, limitRange, normalise, envelope, alignExtremes, extremes
- time: shift, stretch, fitDuration, fitToRange, reverse, rippleInsert, rippleDelete, quantize,
  equaliseSpacing
- density: simplify, thinMinGap, keepExtremes, removeMicroReversals, addMidpoints, subdivide, smooth
- speed: capSpeed, minSpacing
- rhythm: doubleTime, halfTime, changeStrokeRate, repeatLastStroke, repeatSelection, duplicate
- variation: jitter, humanise
- points (palette group "Edit · points (advanced)"): delete, move, nudgeTime, nudgePos, setPos

Overrides table in the wrapper:
- `nudgeTime.frameMs` and `quantize.frameMs` default to the media's frame duration at creation;
- playhead params stay plain numbers.

`EDIT_HALO` starts with:
- `offset`, `invert`, `setPos`, `nudgePos`, `limitRange`, `jitter`, `humanise`: 0;
- `smooth`: `p.window`;
- `capSpeed`: 2000;
- `thinMinGap`, `minSpacing`: `p.minGapMs`;
- `removeMicroReversals`: 2000;
- `keepExtremes`, `simplify`, `extremes`, `alignExtremes`: 5000.

Every finite entry must pass the halo test, or it is removed (Infinity).

**Select** (auto-wrapped, `select.<op>` → points): selectTurns, grow, shrink, everyNth, selectBySpeed,
selectSimilar, invertSelection. They feed any `where`.

**Signal** (typed-array kernels, NaN-aware, no per-sample allocation)
- `sig.math {fn add|sub|mul|div|min|max|pow|absdiff|avg|mix|clamp|abs|neg, b 0 mod}` (Phosphor MATH)
- `sig.expr {expr}` (a, b, c, d) → signal. A safe recursive-descent parser compiled to a closure, never
  `eval`/`Function`. The grammar:
  - numbers;
  - variables `a b c d`, `t` (ms), `s` (seconds);
  - constants `pi tau e`;
  - operators `+ - * / % ^`, unary `-`, comparisons → 0/1, `&& || !`, `c ? x : y`;
  - functions `sin cos tan abs min max clamp mix pow exp log sqrt floor ceil round sign fract smoothstep
    tri saw sqr` (period 1), plus `isnan nz(x, d)`.

  NaN in gives NaN out. Parse errors report the column.
- `sig.smooth {method onepole|moving|gaussian|savgol, windowMs 200}`: zero-phase, so offline smoothing
  never adds lag (Phosphor `lowpassStep`, run forward and back).
- `sig.slew {maxPerSec 400}` (Phosphor `slewStep`)
- `sig.median {windowMs 100}`
- `sig.fillGaps {maxGapMs 500, mode linear|hold|none}`
- `sig.normalise {pLo 2, pHi 98}` (global)
- `sig.remap {inLo 0, inHi 100, outLo 0, outHi 100, clamp true}`
- `sig.blend(a, ca, b, cb) {gamma 2}` → `(a·ca^γ + b·cb^γ)/(ca^γ + cb^γ)`, NaN-aware; `dominance` output =
  `ca^γ/(ca^γ+cb^γ)`
- `sig.delay {ms 0}`, `sig.derivative`, `sig.integrate`
- `sig.envelope {mode peak|rms, attackMs 20, releaseMs 300}`
- `sig.quantise {step 5}`
- `sig.lfo {shape (gen SHAPES + tri/saw/square), periodMs 800 mod, phase 0, lo 0 mod, hi 100 mod}`
- `sig.noise {smoothMs 400, lo 0, hi 100, seed}`
- `sig.phaseWave(phase, amp?) {shape sine, cycles 1, offset 0.25, center 50 mod, depth 20 mod, followAmp 1}`
- `sig.toScript {mode extremes|resample, minProminence 3, minGapMs 60, tolerance 1, everyMs 100,
  gaps break|hold|bridge, maxBridgeMs 400}`. Extremes use parabolic refinement, then `normalize`.
- `sig.sampleAt(signal, times: script|spans) {also none|mids|quarters}` → script. Points at the given times
  (e.g. the stroke's own turns) plus optional in-between points.

**Spans**
- `spans.filter {kinds [], labelContains '', minMs 0, maxMs 0}`
- `spans.and`, `spans.or`, `spans.minus`, `spans.not` (within the timeline)
- `spans.pad {beforeMs 0, afterMs 0}` (negative shrinks), `spans.mergeGaps {gapMs 500}`,
  `spans.shift {ms 0}`, `spans.relabel {kind, label}`
- `spans.between(points)` → the spans between consecutive points (e.g. cuts → scenes)
- `spans.threshold(signal) {above 50, below null, hysteresis 2, minMs 0}`
- `spans.kindRange {table {kind:[lo,hi]} (editor kindTable), default [10, 90], fadeMs 400}` → lo, hi.
  Values crossfade over `fadeMs` at span boundaries. **The headline depth-by-kind node.**
- `spans.kindValue {table {kind:value}, default 0, fadeMs 400}` → signal
- `spans.envelope {attackMs 2000, releaseMs 2000, curve}` → 0..1 inside spans (e.g. intensity ramps in
  build-ups)
- `spans.toSignal {inside 1, outside 0, fadeMs 0}`

**Flow** (generic `any`)
- `flow.switch(a, b, where) {fadeMs 0}`: b inside the spans. Scripts are spliced; signals are selected or
  crossfaded; spans are clipped and merged.
- `flow.gate(in, where)`: restrict to spans. Scripts are trimmed, signals become NaN outside, spans are
  intersected.
- `flow.select(in0..in3) {pick 0}`: one-key A/B for whole chains.
- `flow.reroute`: a dot on a wire.

**Analyze**
- `an.stat(in, where?) {fn mean|median|min|max|p5|p95|p10|p90}` → number. Scripts are time-weighted
  through `posAt`; signals ignore NaN.
- `an.problems(script) {profile 'generic'}` → spans (kind = problem kind). Feed it to `where` to fix only
  where problems are.
- `an.compare(cand, ref) {tolMs 150}` → score (f1), lag (ms), diff (spans of unmatched turns).

**Generate** (auto-wrapped `gen.<id>`, perSpan + byKind; recipes as variants)
- `gen.strokes`, `gen.ramp`, `gen.hold`, `gen.smooth`, `gen.pulses` (variant "Climax pulses"),
  `gen.follow` (needs `turns`), `gen.knot`, `gen.tease`, `gen.beats` (needs `beats`).
- Each where-span is generated over its own `[t0,t1]`. Adjacent spans are joined with
  `gen/util.joinPlan` under `maxSpeed` (an extra wrapper param, default 450).
- No `where` → the whole timeline.
- `gen.plan(segments, turns?) {seed, maxSpeed 450}`: compiles plan spans with each segment's own recipe
  (through the injected `compilePlan`, or the local fallback).

**Outputs**
- `out.axis(script, where?) {axis, mode replace|inside|merge, seamMs}` → result. It is the bake target.
  - Card: bake status chip (never / baked / stale / axis differs), +added/−removed against the current
    axis, and a problems count (`analyze.findProblems` with the active profile, on demand).
- `out.ghost(script) {name, color}` → result. Preview only. Its "Bake to axis…" action creates an
  `out.axis` wired to the same source.

## 8. Editor

Owned by the EDITOR builder (`src/features/graph/**` except integration).

### 8.1 Surfaces
- **Panel**: `panel.js` → `{id:'graph', title:'Graph', icon:'graph' (or the nearest kit icon), dock:'bottom',
  order:50, modes:['script','track'], component: GraphPanel}`.
  - Toolbar:
    - graph picker (new / rename / duplicate / delete / import / export);
    - **Add preset**;
    - **Live** toggle;
    - A/B strip;
    - problems counter ("2 errors · 1 warn", where F8 jumps);
    - status ("142 ms · 3 cached · slow: Smooth 290 ms");
    - **Maximise**: the panel goes `position: fixed` over the workspace, Esc restores;
    - primary **Bake → stroke, roll** button.
  - Body: canvas plus a 280 px **inspector** column (collapsible).
- **Probe lane**: `lane.js` → `{id:'graph.probe', title:'Probe', order:47, height:64, component}`.
  - It draws the probed value aligned with `app.view` through `msToX`, pixel-aligned with the lanes:
    script polyline (up = out), signal min/max band with NaN gaps blank, spans as bars in kind colours
    (`features/timeline/kinds.js kindOf`), points as ticks.
  - Hovering sets `ctl.hoverTime`. Clicking seeks.
  - It shows "No probe — press P on a node" when empty.
- **Harness**: `dev/graph.html` + `dev/graph.js` on port 5187:
  - `createMockApp()` with `sampleDoc()`, plus a synthetic plan of real kinds (foreplay, penetration,
    knotting, climax, afterglow), a synthetic 10-min 100k-action tracker ghost, and a fake tracking run
    with samples/confidence injected into the snapshot;
  - a preset dropdown;
  - FallbackLane-style canvases for stroke/roll so ghosts are visible.

### 8.2 Rendering (ported from Phosphor `GraphEditor.svelte` l.190-546)
- `.gview` (pointer capture) > `.glayer` (`translate(x,y) scale(k)`) > absolutely positioned DOM node cards
  plus one `<svg>` of wires.
- Wires are cubic Béziers with handles that grow for backward links, plus a fat invisible hit path, coloured
  by resolved type (`TYPES[type].color` → `--series-*`). An adapter diamond sits at the midpoint.
- Grid is a CSS background bound to the view. `GRID = 20`, snap on release.
- Zoom: cursor-anchored wheel, `exp(-dy*0.0015)`, k ∈ [0.2, 2], non-passive listener. Pinch on touch.
  `fit()` with overflow-aware padding.
- **Sockets are measured**: each port row has `data-port`. A ResizeObserver per card reads row
  `offsetTop`/`offsetLeft`, which is untransformed layout, into a Map used for wire geometry. Collapsible
  and param-heavy cards can never drift from their wires.
- Points-typed spans ports (`hint:'points'`) use a hollow diamond socket. Optional inputs are hollow
  circles, required ones filled.
- Must stay smooth at 200 nodes. Sparklines are canvas, decimated min/max per column, redrawn only when
  the value's key or the view changes.

### 8.3 Node card
- Header: group icon, title (or label), status glyph (spinner / cached / muted / error), mute and
  collapse toggles.
- Port rows: inputs left, outputs right. Linked param ports show as small sockets beside the param name
  ("← Depth by kind.lo").
- Inline params (flagged `inline`, else the first two numeric). Scrub fields with kit NumberField
  semantics:
  - drag to scrub, Shift ×0.1 fine, Ctrl round values;
  - double-click or Enter to type;
  - right-click: Reset / Link from… / Expose as socket.

  A scrub is one `ctl.gesture`.
- Sparkline 160×28 over `app.view`, with playhead and `ctl.hoverTime` cursor plus readout
  "@1:23.4 → 62" (`valueAt`). Clicking seeks. **D** toggles an overlay of the node's main input in grey
  ("what did this node change").
- Status line: `summary` + ms. Amber > 50 ms, red with message on error, dimmed "waiting on X" when
  blocked.
- `out.axis` extras: bake status chip, diff counts.
- Collapsed: header and sockets only, sockets stacked on the header line.

### 8.4 Inspector column
- Params form, generated from the schema. A local `ParamFields.svelte` built on kit `params.js`
  (`groupsOf`, `coerce`, `stepOf`, `isDefault`) and `paramform.js` (`controlOf`). It switches to kit
  `ParamForm.svelte` when that lands (same schema).
- Custom editors per `editor`: axis/ghost/run/channel pickers from `ctl.sources.list`, kinds multi-select,
  kindTable (rows per lib/gen `KINDS` with colour chips and lo/hi scrubs), expr (live parse errors with
  column), shape, color.
- **Per-kind chips** (perSpan nodes): one chip per kind seen in the connected `where` spans plus all
  `KINDS`. Overridden kinds are highlighted. Clicking a chip edits `{...params, ...byKind[kind]}`, writing
  only changed keys. "Reset kind" removes it.
- Diagnostics with fix buttons (`ctl.applyFix`). Help text. On-demand stats for a script output
  (`analyze.statistics`). Actions: Probe, Pin A/B, Snapshot, Mute, Duplicate, Delete, Reroll seed.

### 8.5 Discoverability and wiring
- **Search/palette** (port of Phosphor `GraphPalette.svelte` with a local ~40-line fuzzy matcher over
  title, aliases, group, param labels and help).
  - It opens with Shift+A, ContextMenu/Shift+F10, a double-click on the canvas, or typing a letter with the
    canvas focused (the letter seeds the query).
  - Results show port-type chips, a one-line help and variants.
  - Recent picks are boosted. Presets are a group. Browsing is the nested group tree.
- **Link-drag-search**: release a wire on empty canvas → palette filtered to nodes with a compatible port,
  conversion nodes first. Placing the node wires it (port by name match, else first compatible).
- **Live wiring feedback**: while dragging, `elementFromPoint` finds the socket and `planLink` decides:
  green, amber with an adapter badge, or red with the reason in a cursor flash.
- Dropping a wire on a node body opens a port picker that includes mod params, so no socket is needed per
  param.
- Dragging an existing wire's input end re-routes or detaches it.
- **Ctrl+drag** across wires cuts them (knife). Dropping a node onto a wire whose types fit splices it in
  (`insertOnLink`).
- **Hover card on a wire**: type, summary, and for scripts n / range / max speed / strokes per min
  (statistics, lazy, after 300 ms, memoised by identity).
- **Marquee** with Shift+drag. Move has a 4 px dead zone. Pan by background drag or middle-drag.

### 8.6 Keyboard
All keys are Commands in `commands.js`. Graph-internal ones use `when: ui.focused && ctl.graph`, where
`ui.focused` is tracked by focusin/focusout on the panel root. `features/graph` sorts before every other
feature in the shell's glob, so its commands register first and win shared keys **only while focused**.

| Keys | Action |
|---|---|
| Ctrl+Shift+G (global) | show/focus the graph panel (`app.layout?.tab('bottom','graph')` when available) |
| Shift+A, ContextMenu, Shift+F10 | add (with a node focused: **append** to its primary output and wire) |
| Ctrl+Shift+A | insert before the focused node |
| C | connect picker: compatible (node, port) targets ranked by distance; type to filter, Enter wires |
| Enter on two sockets | wire them (Phosphor `kwire`, keyboard/touch path) |
| Tab / Shift+Tab | walk nodes in reading order (native focus) |
| Alt+→ / Alt+← / Alt+↑ / Alt+↓ | follow wire downstream / upstream / sibling ports |
| Arrows, Shift+Arrows | move selection by 1 / 5 grid steps |
| Del, Backspace / Ctrl+Del | delete / dissolve (reconnect through bypass) |
| Ctrl+D, Ctrl+C, Ctrl+X, Ctrl+V | duplicate, copy/cut/paste nodes (preset JSON, also as clipboard text) |
| Ctrl+A | select all |
| M / H | mute / collapse |
| P | probe (Shift+P cycles the probed port) |
| Alt+A / Alt+B / X | pin as A / pin as B / swap A↔B |
| S | snapshot the node's output to a pinned ghost |
| D | diff overlay on the card |
| F / Home | frame selection / fit all |
| F8 / Shift+F8 | next / previous graph problem |
| Ctrl+Enter / Ctrl+Shift+Enter | bake selected outputs (all if none) / bake all |
| Ctrl+Z / Ctrl+Y | only in local-undo mode (else the core keys already undo graph edits) |
| Esc | layered: gesture → palette → param field → maximise → selection |

The keybinding editor will list same-key "conflicts" with core and lanes. They are by design (narrow
`when`). Menu: `'Track'`, group `'Graph'` for show / new / bake / presets.

### 8.7 A/B and snapshots
- Pins A/B are controller state, not graph state. They publish ghosts `graph:<gid>:A` (series sky) and `:B`
  (series orange) on the active axis.
- The A/B strip shows `analyze.compare(B, A)` over the view range (f1, lag, stroke counts, max speed,
  problem counts), plus a disagreement bar. X swaps.
- Snapshot (S) freezes a node's current output as a pinned ghost "Smooth @ 14:02". It is a reference only,
  because values are immutable.
- `flow.select` gives a single-key A/B inside the graph that is saved with it.

### 8.8 Accessibility
- Cards are focusable `role="group"` with `aria-label` = title + status.
- Sockets are buttons with `aria-label` "input script (required), connected to Smooth".
- Wires are reachable from their sockets.
- The status line is `aria-live="polite"`. Refusals are announced.
- Focus rings use kit tokens. Reduced motion is honoured.

## 9. Presets

`PRESETS` in `src/lib/graph/presets.js`. They are templates with slots bound on placement (first tracker
ghost, plan, axis). Each one also serves as a test fixture.

| id | What it builds |
|---|---|
| `tracker-cleanup` | src.ghost(auto tracker) → edit.removeMicroReversals → edit.smooth (savgol 160) → edit.keepExtremes (8) → edit.capSpeed (450) → out.axis stroke |
| `depth-by-kind` | …cleanup → edit.extremes (amount 6, relative) → amp.remap ← spans.kindRange(src.plan) with rows foreplay [55,95], oral [40,95], penetration [0,85], knotting [0,30], climax [0,40], afterglow [20,90], fade 400 → out.axis stroke |
| `mix-trackers` | src.run A, src.run B → sig.blend(a, ca, b, cb, γ 2) → sig.fillGaps → sig.smooth → sig.toScript (extremes) → out.axis stroke |
| `roll-from-phase` | stroke → script.phase → sig.phaseWave (offset 0.25, depth 18, followAmp 1) → sig.sampleAt(times = stroke, also mids) → edit.capSpeed → out.axis roll |
| `twist-from-phase` | as above, `cycles 0.5`, `offset 0.5`, `center 50` → out.axis twist |
| `climax-pulses` | src.plan → spans.filter [climax] → gen.pulses(where) ; stroke → script.splice(base, insert, where; seam blend 150) → out.axis stroke |
| `ab-smoothing` | src.ghost → edit.smooth (moving 120) → out.ghost A ; → edit.smooth (savgol 240) → out.ghost B ; an.compare |
| `polish` | stroke → edit.simplify (1) → edit.removeMicroReversals → edit.minSpacing (50) → edit.capSpeed (450) → edit.quantize (frame) → out.axis stroke (mode replace) |
| `fill-dropouts` | src.run confidence → spans.threshold (below 0.4, minMs 500) → gen.follow(where, turns = script.turns of the tracker) → script.splice over the tracker script |
| `scene-flip-fix` | src.run scenes → spans.filter (value < 0 via `spans.filter` param `valueBelow 0`) → edit.invert(where) |
| `plan-plus-tracker` | gen.plan(src.plan) inside plan spans, tracker clean-up elsewhere (flow.switch) |

`scene-flip-fix` needs `spans.filter` params `valueAbove`/`valueBelow` (null = off). That makes the
`spans.filter` params `{kinds [], labelContains '', minMs 0, maxMs 0, valueAbove null, valueBelow null}`.

## 10. Document integration

Owned by the INTEGRATION builder: `src/features/graph/integration.js` (+ `integration/*.js`,
`*.svelte.js`), `src/lib/graph/doc.js`, and the user guide `src/features/graph/README.md`.

### 10.1 Reading the document
The controller builds a **Snapshot** (contract §9) reactively:
- from `app.doc`: `axes`, `ghosts`, `plan`, `chapters`, `loops`, `bookmarks`, `range`, `selection`,
  `media`;
- `app.durationMs`, `app.player.frameMs`;
- tracker data via `import.meta.glob('../tracking/tracking.svelte.js')` → `peekTracking(app)?.runs`,
  `.scenes`, `.spans` (absent → `[]`);
- audio via `../video/waveform.js loadWaveform` on first `src.audio` use. The pyramid is reduced to a
  peak envelope on the graph grid and held in controller state;
- tags: `null`.

`makeSources(snapshot)` hands identity-preserving values to source nodes, so the engine's tokens are exact.
`lib/graph` never touches `app`.

### 10.2 Live preview as ghosts
- Ghosts are not undoable, so previews add no history noise.
- `previewList` builds one entry per:
  - unmuted `out.axis` with `preview !== false` (`axis` = its axis, name "Graph → roll");
  - `out.ghost`;
  - pin;
  - snapshot;
  - probe (scripts only).
- Each entry is `{id: 'graph:<gid>:<key>', name, color (cssVar of the SERIES key at publish time),
  script, visible: true, source: {kind:'graph', graph, node}, axis}`.
- The lanes already draw each ghost on `ghost.axis` (`lanes/state.svelte.js ghostsFor`).
- `mergeGhosts` replaces only `kind:'graph'` entries and returns the same array when nothing changed. The
  controller publishes only after full runs, and only when a value key changed.
- Graph ghosts are removed when Live is off, a graph is switched or deleted, or the panel is disposed.
- On project load, stale `kind:'graph'` ghosts are filtered out.

### 10.3 Bake: one undoable edit
1. `ctl.bake({nodes, range})` requests a full evaluation of the targets (never windowed).
2. `bakePlan`:
   - it refuses outputs that are reached by an error;
   - it errors on two outputs writing one axis;
   - it applies `range`;
   - it skips unchanged axes (`sameScript`).
3. If `axisDiffersFromBake` → `app.choose` "Stroke changed since the last bake. Overwrite / Cancel".
4. `app.transact('Bake "<name>" → stroke, roll', () => { app.doc.axes = {...app.doc.axes, ...writes};
   if (appMode) app.doc.graphs = replace(graph, markBaked(graph, …)) })`. This is ONE history entry for
   every axis. Axes that did not exist before are created, and undo removes them (`Doc.write` deletes on
   `undefined`).
5. A toast "Baked stroke, roll (4 812 + 1 610 actions)" with an Undo action. "Nothing changed" when
   nothing was written.

Self-reference:
- An `out.axis` reading its own axis upstream gets a warning plus the **Freeze source to ghost** fix: a
  pinned ghost copy of the axis, with `src.axis` replaced by `src.ghost`.
- This is not refused, because "polish my existing script" is legitimate.

### 10.4 Where graphs live; undo for graph edits
**Target (shell request, below).**
- `app.doc.graphs: Graph[]`, listed in `Doc.UNDOABLE`.
- Every graph change is `app.transact('Graph: connect', () => app.doc.graphs = next)`. Drags and scrubs use
  `app.begin(label)` → `commit()`/`cancel()`.
- Graph edits and bakes then share the single Ctrl+Z stack and the history panel. An entry costs one graph
  reference (a few KB).

**Interim (`ctl.undoMode === 'local'`, detected by `!('graphs' in app.doc)`).**
- The controller holds graphs in `$state.raw`, with Phosphor `createHistory(100)` and the
  `step(fn)`-snapshot pattern (nested steps join the outer one). Graph Ctrl+Z/Ctrl+Y commands are scoped to
  graph focus.
- Persistence still works today, because the shell already carries unknown project keys:
  - after each committed change the controller writes `app.doc.project = {...(app.doc.project ?? {path:
    null}), extra: {...extra, graphs: serializeGraphs(graphs)}}` and sets `app.doc.dirty = true`;
  - `project-logic.js projectDoc` saves `p.extra`, and `appDocFrom` restores it;
  - on open the controller reads `app.doc.project?.extra?.graphs` through `parseGraphs`.
- Bakes always go through `app.transact`.
- Known cost: two undo stacks. Undoing a bake does not restore that graph's `lastBake`, so the card then
  shows "axis differs from last bake", which is true.

**Persistence in `.pawproj`.**
- The graphs are stored in the feature block `graphs: {v: 1, items: Graph[]}` (lib/io `getBlock`/`setBlock`;
  `project.js` already names `graphs` as its example).
- There is no schema bump, and older builds round-trip the block untouched.
- Funscript export never contains graphs.
- Autosave/recovery carries it automatically once it is in the doc.

### 10.5 Requests to other agents (not done here; reported)
1. **Shell** (`src/app/doc.svelte.js`, `project-logic.js`):
   - `graphs = $state.raw([])` and `'graphs'` in `UNDOABLE`;
   - `load()` reads `d.graphs`;
   - `appDocFrom` sets `graphs: pd.extra?.graphs?.items ?? []` (and drops `graphs` from the carried extra);
   - `projectDoc` writes `extra.graphs = {v: 1, items: d.graphs}` when non-empty;
   - `projectDoc` filters ghosts with `source?.kind === 'graph'`.
   Optionally expose `app.layout` so `graph.show` can open the bottom tab.
2. **Tracking**: keep `peekTracking(app)` and the `runs`/`scenes`/`spans` field names stable. They are
   the graph's tracker source.
3. **gen-lib**: when `plan.js`/`index.js` land, integration passes `compilePlan` into `createCatalogue`
   (an `import.meta.glob` probe, the same pattern as `timeline/deps.js`). No graph code changes.

## 11. File ownership for the four parallel builders

| Builder | Owns (creates/edits only these) | Delivers |
|---|---|---|
| **(1) ENGINE** | `src/lib/graph/model.js`, `types.js`, `eval.js`, `serialize.js`, `index.js`; `test/graph-engine-*.test.mjs` | contract §1–§6: types and helpers, defineNode/registry, graph edit functions, history, compile/validate, keys, cache, evaluate (pull, memo, windowed, faults, mute, abort, determinism), serialisation; perf test |
| **(2) NODES** | `src/lib/graph/nodes/**`, `src/lib/graph/presets.js`; `test/graph-nodes-*.test.mjs` | contract §7–§8 and this file's §7 and §9: every node listed, `createCatalogue`, wrappers with `EDIT_HALO`/`TIME_SHIFT_OPS`/`EXCLUDED_OPS`, expression parser, presets; sweep + halo-honesty + per-node + preset tests |
| **(3) EDITOR** | `src/features/graph/**` **except** `integration.js`, `integration/**` and `README.md`: `GraphPanel.svelte`, `GraphEditor.svelte`, `NodeCard.svelte`, `Palette.svelte`, `NodeInspector.svelte`, `ParamFields.svelte`, `ProbeLane.svelte`, `Sparkline.svelte`, `ui.svelte.js` (focus, selection, view), pure helpers `editor/*.js` (geometry, fuzzy, gestures, layout, keyboard chain, decimation), `panel.js`, `lane.js`, `commands.js`, `graph.css`; `dev/graph.html`, `dev/graph.js`; `test/graph-editor-*.test.mjs` | §8. Codes against `graphController(app)` (contract §10). Until integration lands, the harness may use a local stub of that interface (`dev/graph.js` only) |
| **(4) INTEGRATION** | `src/features/graph/integration.js`, `src/features/graph/integration/**`, `src/lib/graph/doc.js`, `src/features/graph/README.md`; `test/graph-integration-*.test.mjs` | contract §9–§10, this file's §10: snapshot, sources, scheduler, previews, bake, undo modes, persistence, fixes, preset slot binding; user guide with worked examples for the five must-build cases |

Everyone: read `src/ARCHITECTURE.md`. Touch nothing outside your row. Missing sibling code → code to the
contract and stub locally inside your own files, and say so in your report. No npm dependencies. Vite port
**5187** (`npx vite --port 5187 --strictPort`, page `/dev/graph.html`). Screenshots with Playwright
`chromium.launch({channel:'msedge'})`.

## 12. Testing summary
- Plain node tests per builder (contract §11), run by `npm run check`.
- Properties carry most of the correctness:
  - the **catalogue sweep** (every node, defaults, valid typed outputs; it catches library drift);
  - **halo honesty** (windowed equals full on the window, for every `local` def);
  - **memo exactness** (a param change recomputes exactly `downstreamOf`);
  - **determinism** (two runs deep-equal);
  - **no mutation** (deep-frozen inputs).
- The editor's DOM is verified with harness screenshots:
  - the default preset;
  - a refused wire;
  - an error with blocked downstream;
  - the probe lane;
  - the A/B strip;
  - maximised mode.

## 13. Phases
- **P1 (this build)**: everything in §3–§11.
- **P2**:
  - dirty-range splicing for local chains;
  - Worker evaluation (if budgets are exceeded);
  - macros/groups with exposed params (graph JSON key `macros`, already preserved as an unknown key);
  - a template gallery with live previews;
  - `out.plan` (spans → plan segments, designed with the timeline owner);
  - a user preset library in `app.settings('graph.presets')`.
- **P3**: a tags provider (describe results), audio onsets/beats, plan segments that run a graph as their
  recipe.

## 14. Risks
1. **Shell change pending.** Until `doc.graphs` exists there are two undo stacks. Persistence works today
   via `doc.project.extra`.
2. **Tracker runs are session-only.** `src.run` degrades to its ghost after a reload, with a warning.
   Presets prefer `src.ghost` unless confidence or channels are essential.
3. **Halo table correctness.** A wrong finite halo would make the preview differ from the bake. Mitigated
   by the halo test, the Infinity default, and bake always running full.
4. **byKind per-span semantics.** Range ops (normalise, remapRange) use each span's own extent; time ops
   can collide at seams.
   - The node help says so.
   - The recommended depth-by-kind path is the pointwise `amp.remap` + `spans.kindRange` with crossfades.
5. **Main-thread evaluation.** A single heavy node (simplify on 100k ≈ 140 ms) blocks for that long,
   because cancellation is per node. Mitigated by the windowed preview, slow mode and per-node timings.
6. **Key sharing.** Graph commands reuse core keys under `when: focused`. A focus-tracking bug would hijack
   lane keys. Focus is set on focusin/pointerdown and cleared on focusout. The harness checks
   `app.commands.conflicts()`.
7. **Ghost contention.** Another feature rebuilding `app.doc.ghosts` from its own list could drop graph
   ghosts until the next full run. The graph itself always filters by `source.kind`.
8. **`lib/gen` plan compiler not landed.** `gen.plan` uses a local fallback. Output changes when the real
   compiler is injected. Graphs keep their params, so nothing is lost.

## 15. Provenance
See the contract's PROVENANCE section (Phosphor, Apache-2.0). The editor additionally ports from
`src/ui/graph/GraphEditor.svelte`:
- view/zoom/pan/pinch;
- the `gest` state machine;
- Bézier wires and hit paths;
- marquee, `kwire`, link-drag-search and `fit`.

It ports `GraphPalette.svelte`, with `rank` replaced by a local matcher. Its behaviour spec follows
`docs/GRAPH.md`. Record it in each adapted file's header.
