# Node graph

The Graph panel is a node editor that reads your document (axes, ghosts, tracker runs, the plan, chapters, scenes, audio) and produces scripts without touching anything until you **Bake**. A bake is one undo step.

Open it with **Ctrl+Alt+Shift+G** (command `graph.show`, menu Track ▸ Advanced ▸ Graph). It lives in the bottom dock in the Refine and Track tabs. Every graph key below works only while the graph panel has focus; the one global key is Ctrl+Alt+Shift+G.

## Concepts

### Values on wires

| Wire | Color | Carries |
|---|---|---|
| Script | sky | a funscript: `{at, pos}` points. pos 0 = deepest, 100 = out |
| Signal | green | a curve sampled on the graph's grid (25/50/100/200 Hz, default 50). A gap is *unknown* (NaN), not zero |
| Spans | yellow | time intervals with an optional `kind`, `label`, `value`. A zero-length span is a **point** (hollow diamond socket) |
| Number | gray | one number; on/off is 1/0 |

Flow nodes (**Switch by spans**, **Gate by spans**, **Select input**, **Reroute**) are typed "any" and take the type of whatever you wire in first.

Two conversions are automatic and drawn as a diamond on the wire: Script → Signal (sampled on the grid) and Number → Signal (constant). Every other conversion is refused and the editor suggests the node that does it:

| You wired | Insert |
|---|---|
| Signal → Script | **Signal → Script** (`sig.toScript`) or **Sample at times** (`sig.sampleAt`) |
| Script → Spans | **Turning points** (`script.turns`) or **Strokes** (`script.strokes`) |
| Signal → Spans | **Threshold → spans** (`spans.threshold`) |
| Spans → Signal | **Spans → Signal** (`spans.toSignal`) or **Value by kind** (`spans.kindValue`) |
| Script/Signal → Number | **Statistic** (`an.stat`) |
| Spans → Script | **Switch by spans** (`flow.switch`) or **Splice** (`script.splice`) |

One link per input; wiring a second one replaces the first. Outputs fan out freely. Loops are refused.

### Parameter sockets ("fx inputs")

A parameter marked `~` in the inspector has its own socket, named `p:<key>` on the card. A wire into it drives the parameter; the typed value stays as the fallback wherever the wire has no value (NaN in a signal).

- Amplitude nodes (**Remap depth**, **Gain**, **Offset**, **Limit range**, **Depth curve**) accept a Signal: the parameter varies along time. A Number or a Script also fits (Script is sampled).
- Every numeric parameter of an Edit node accepts a Number only (a statistic, a constant, media fps).

Unlink from the inspector (the unlink button beside the parameter) to go back to the stored value.

### Spans and "Only inside"

Every Edit, Select and Generate node, plus **Axis output**, **Switch by spans**, **Gate by spans**, **Statistic**, **Splice**, **Keep inside** and **Tile loop**, has an extra input **Only inside** (port name `where`, type Spans). Unconnected, the node works on the whole script. Connected, it runs once per span, with that span's own parameters (see per-kind overrides). Overlapping spans are flattened first: the one that starts later owns the overlap.

What feeds **Only inside**:

- **Plan segments** (`src.plan`): the plan lane as spans, `kind` = segment kind. **Only kinds** filters.
- **Chapters**, **Loop regions**, **Bookmarks** (points), **Time range (I/O)** (`src.range`, one span), **Selection** (points, not saved).
- **Scenes / cuts** (`src.scenes`) and **Span labels** (`src.trackSpans`) from the tracker; **Tracker run** also outputs `events` and `scenes`.
- Any **Select** node (`select.*`): its `points` output is ready for an Only inside.
- **Problems** (`an.problems`): the problems the chosen **Device profile** (`profile`, default `generic`) finds, at severity **At least** (`minSeverity`), as spans, so an edit fixes only there.
- **Threshold → spans** (`spans.threshold`): a signal above/below a level, with hysteresis and a minimum length.
- Span algebra: **Filter spans** (`spans.filter`: kinds, label, length, value above/below), **Invert spans**, **Intersect (and)** / **Union (or)** / **Subtract**, **Pad spans**, **Close gaps**, **Shift spans**, **Relabel spans**, **Spans between points** (points → the spans between them).

### Edit, Select and Generate nodes

- **`edit.<op>`**: every operation of the Edit menu, auto-wrapped, except set point / number key / set time. Inputs `script` (required) and `where`; outputs `script` and `changed` (points at the actions it produced; press **D** to see them, or probe them). Groups: Edit · amplitude, time, density, speed, rhythm, variation, points (advanced).
- **`select.<op>`**: the selection helpers (select turns, grow, shrink, every Nth, by speed, similar, invert). Output `points`. With Only inside connected, they start from the actions inside those spans.
- **`gen.<generator>`**: every pattern generator (hold, strokes, ramp, smooth, pulses, tremor, follow, knot, knot-stroke, tease, beats). Recipes appear as palette variants under their generator's node, e.g. the **Climax pulses** node (`gen.pulses`) lists its `climax` recipe. Each Only inside span is generated over its own extent and the pieces are joined under **Speed cap** (`maxSpeed`, default 450 pos/s, 0 = off). Unconnected, it generates over the whole video. **follow** and **knot** take a `turns` input (points, usually from **Turning points**); **beats** takes `beats` (points, e.g. Bookmarks).
- **Compile plan** (`gen.plan`): input `segments` (spans, required) and `turns`; generates every plan span with its own recipe and params, gaps stay empty. Params `seed`, `maxSpeed`.

### Per-kind overrides

With Only inside connected to spans that have kinds, the inspector shows one chip per kind above the parameters (**All** first). Click a kind, change a parameter: that value applies only inside spans of that kind. Overridden rows and chips are highlighted; **Reset kind** drops the kind's overrides, the per-row reset drops one. Overrides are stored on the node (`byKind`), so they survive re-wiring.

### Fold

With Only inside connected, an edit node folds: it runs the operation once per span, in order, with that span's parameters, on a clip around the span, then splices the piece back. Operations that move actions in time (shift, stretch, reverse, quantise, equalise spacing, jitter, humanise, double/half time, change stroke rate, repeat, ripple, fit, nudge, move, duplicate) fold **right to left**, and spans downstream of them are not moved along; the card says "time-shift". For depth per kind, do not fold a time-moving op per segment; use **Remap depth** driven by **Depth by kind**, which crossfades at boundaries.

### Outputs

- **Axis output** (`out.axis`) is what Bake writes. Params:

  | Param | Default | Meaning |
  |---|---|---|
  | `axis` | `stroke` | the axis written |
  | `mode` | `replace` | `replace`: the axis becomes the input. `inside`: the input replaces the axis only inside Only inside (or the input's own extent when unconnected). `merge`: the input's points are added, input wins on equal times |
  | `seamMs` | 0 | `inside` only: 0 = hard cut, else joins are blended over this |
  | `maxSpeed` | 450 | speed cap enforced at the seams |

  Its card shows a bake chip: **never**, **baked**, **stale** (graph changed since), **axis differs** (axis edited since), **error**. Two unmuted Axis outputs on the same axis is an error; neither bakes. An Axis output fed from **Axis** (`src.axis`) of the same axis warns, with the fix **Freeze source to ghost**: a pinned copy of the axis replaces the source so repeated bakes start from the same place.

- **Ghost preview** (`out.ghost`, params `name`, `color`, default `pink`): preview only, never baked.

### Preview, probe, A/B

- **Live** (toolbar, command `graph.doc.live`) publishes every enabled output as a ghost "Graph → <axis>" on its lane, about 150 ms after you stop changing things. Preview ghosts are never saved.
- **P** probes the focused node on the Probe row under the lanes; **Shift+P** cycles its outputs. Hover the row: every card shows its value at that time.
- **Alt+A** / **Alt+B** pin two nodes; the toolbar strip scores them (F1 of matched turns, lag). **X** swaps. **S** snapshots a node's current output into a ghost, kept until **Graph: Clear snapshots**.
- **M** mutes a node: its first input of the same type passes through, so you see what one step contributes.
- A failing node turns red with the reason; nodes behind it dim and say "waiting on …". Outputs that do not depend on the failure still bake. **F8** / **Shift+F8** jump through problems.
- If a full evaluation takes longer than 250 ms the status line names the slowest node and previews update on release, not during a drag.

### Bake

- **Ctrl+Enter** bakes the selected Axis outputs (all when none selected); **Ctrl+Shift+Enter** bakes all. One undo step for every axis written; new axes are created and removed by Undo.
- If you edited an axis by hand since its last bake, you are asked before it is overwritten.
- Command palette: **Graph: Bake outputs inside the range (I/O)** (`graph.doc.bakeRange`) writes only between your I and O marks; **Graph: Bake and disable** (`graph.doc.bakeDisable`) bakes then parks the graph.
- **Graph: Enable / Disable** (`graph.doc.enable`, `graph.doc.disable`): a disabled graph keeps its nodes, does not evaluate and publishes no previews. **Graph: Evaluate now** (`graph.doc.evaluate`) runs a full pass and reports the time or the first error.

Graphs are saved in the `.pawproj` (block `graphs`). Only the open graph evaluates. Funscript export never includes graphs.

## Presets

**Presets** in the toolbar (or the graph menu ▸ Presets…) opens the gallery. **Place** adds the preset to the open graph; **New graph** (built-in presets only) starts a graph from it. Source pickers are bound automatically from the document: the first tracker ghost, the reference ghost, successive tracker runs, or a named axis. An unbound slot is reported so you can pick by hand.

| id | Name | What it does |
|---|---|---|
| `tracker-cleanup` | Tracker clean-up | Ghost → Remove micro-reversals (3) → Smooth (savgol, 160 ms) → Keep extremes (prominence 8) → Cap speed (450) → stroke |
| `depth-by-kind` | Depth by plan kind | the clean-up, then Extremes (6 %, relative) and Remap depth driven by Depth by kind from Plan segments (fade 400 ms) |
| `mix-trackers` | Mix two trackers by confidence | two Tracker runs → Blend by confidence (γ 2) → Fill gaps (500 ms) → Smooth (gaussian 120 ms) → Signal → Script (extremes, prominence 4, gap 60 ms) → Cap speed → stroke |
| `roll-from-phase` | Roll from the stroke's phase | Axis stroke → Phase → Phase wave (sine, offset 0.25, center 50, depth 18) → Sample at (the stroke's times + mids) → Cap speed → roll |
| `twist-from-phase` | Twist from the stroke's phase | same chain, cycles 0.5, offset 0.5, depth 25 → twist |
| `climax-pulses` | Orgasm pulses inside orgasm spans | Plan segments → Filter (kind orgasm) → Pulses (orgasm-pulses recipe) → Splice into the stroke (blend, 150 ms) |
| `ab-smoothing` | A/B two smoothing settings | one ghost through moving 120 ms and savgol 240 ms, each to a Ghost preview, scored by Compare, picked by Select input |
| `polish` | Polish the stroke | Axis stroke → Simplify (1) → Remove micro-reversals → Min spacing (50 ms) → Cap speed (450) → Quantise (media frame) → stroke |
| `fill-dropouts` | Fill tracker dropouts | confidence below 0.4 for ≥ 500 ms → Follow strokes from the run's turns → spliced into the run's points |
| `scene-flip-fix` | Fix flipped scenes | Invert the run's points inside scenes whose sign is negative |
| `plan-plus-tracker` | Plan inside, tracker elsewhere | Compile plan inside plan spans, cleaned tracker outside, through Switch by spans |
| `tracked-effects` | Tracked motion + effects | A tracker ghost → **Apply effects** (`fx.apply`, its "Only inside" fed by **Effects** `src.fx`: the Effects row) → stroke, inside the tracker's extent. Per-kind overrides on Apply effects add to each effect's own params |
| `loop-tiling` | Tile a loop cycle | a hand-drawn cycle (const.script) tiled across the I/O range with variation, spliced into the stroke |
| `humanise` | Humanise | Humanise (natural) + Gain driven by slow Noise (0.85..1) → Cap speed → stroke |

**Save selection as preset…** (`graph.savePreset`, also in the right-click menu) stores the selected nodes, their wires and enclosing frames under a name. Saved presets appear in the gallery under **Saved** and can be deleted there. **Export .pawgraph…** / **Import .pawgraph…** in the graph menu move whole graphs between projects; unknown node types from a newer build are kept as "Missing" and survive a save.

## Build a pipeline

The cleanest way to build is keyboard-first: every **Shift+A** appends a node wired to the focused one.

### Tracker → clean → depth per plan segment → stroke

1. **Shift+A**, type `ghost`, Enter. In the inspector, pick the tracker ghost.
2. With it focused, **Shift+A** → **Remove micro-reversals**. Repeat for **Smooth** (`method` savgol, `window` 160), **Keep extremes only** (`minProminence` 8), **Cap speed** (`maxSpeed` 450), **Expand / soften extremes** (`amount` 6, `relative` on).
3. Add **Plan segments**, then **Depth by kind** (`spans.kindRange`); wire Plan → Depth by kind. Edit its **Range per kind** table (default foreplay 55–95, oral 40–95, penetration 0–85, knotting 0–30, climax 0–90, orgasm 0–40, afterglow 20–90; **Default range** 10–90 for kinds not listed; **Fade** 400 ms).
4. Append **Remap depth** after Expand / soften extremes. Drag `lo` onto its **Deep end** socket and `hi` onto **Out end**.
5. Append **Axis output**, `axis` stroke. The ghost "Graph → stroke" appears on the lane.
6. **P** on any node to check it on the Probe row. **Ctrl+Enter** to bake. **Ctrl+Z** takes it back.

To vary clean-up per kind instead: focus Smooth, wire Plan segments into its **Only inside**, click a kind chip in the inspector, change `window`.

### Derive roll from the stroke

1. **Axis** (`src.axis`, `axis` stroke) → **Stroke phase** (`script.phase`): `phase` is 0 at each out turn, 0.5 at each deep turn; `amp` is each stroke's size 0..1.
2. **Phase → wave** (`sig.phaseWave`): wire `phase` → `phase`, `amp` → `amp`. `offset` 0.25, `depth` 18, `center` 50, `followAmp` 1.
3. **Sample at times** (`sig.sampleAt`): wire the wave into `signal` and the Axis script into `times`; `also` = mids.
4. **Cap speed** → **Axis output** `axis` roll. Bake. Two outputs on different axes bake in one undo step.

### Something only inside some spans

1. Make the spans: **Plan segments** → **Filter spans** (`kinds`), or **Threshold → spans** on a signal, or a **Select** node, or **Problems**.
2. Wire them into the node's **Only inside**. For a generator, that is where it generates; for an edit, where it acts.
3. To put the result back into the existing script, either set the Axis output `mode` to `inside` with a `seamMs`, or use **Splice** (`script.splice`: `base`, `insert`, `where`; `seam` cut/blend, `seamMs`) or **Switch by spans** (`flow.switch`: `a` outside, `b` inside, `fadeMs`).

### Tidy and reuse

- **Ctrl+G** frames the selection; **N** adds a sticky note; **Shift+L** auto-arranges (selection, or all).
- A dropped wire on empty canvas opens the search filtered to compatible nodes. **Ctrl+Shift+A** inserts before the focused node. **C** picks a compatible socket to connect to.
- **Ctrl+Delete** dissolves a node and reconnects its input to its outputs.
- Random nodes store their seed; **Reroll seed** in the inspector gives a new variation, and the same graph always gives the same script.

## Keys

All keys need focus inside the graph panel, except the first.

| Key | Command | Action |
|---|---|---|
| Ctrl+Alt+Shift+G | `graph.show` | show the graph editor (global) |
| Shift+A, Shift+F10, ContextMenu | `graph.add` | add node, appended to the focused node |
| Ctrl+Shift+A | `graph.insertBefore` | insert a node before the focused node |
| Enter | `graph.editParam` | edit the focused card's first parameter |
| C | `graph.connect` | connect: pick a compatible socket |
| Alt+Right / Alt+Left | `graph.followDown` / `graph.followUp` | follow the wire downstream / upstream |
| Alt+Down / Alt+Up | `graph.siblingNext` / `graph.siblingPrev` | next / previous sibling |
| Arrows | `graph.move*` | move selection 20 units; Shift+Arrows ×5 |
| Ctrl+Arrows | `graph.walk*` | focus the node in that direction |
| Delete, Backspace | `graph.delete` | delete selection (or the hovered wire) |
| Ctrl+Delete, Ctrl+Backspace | `graph.dissolve` | delete, keeping the wires through |
| Ctrl+D | `graph.duplicate` | duplicate |
| Ctrl+C / Ctrl+X / Ctrl+V | `graph.copy` / `graph.cut` / `graph.paste` | clipboard |
| Ctrl+A | `graph.selectAll` | select all |
| M | `graph.mute` | bypass / mute |
| H | `graph.collapse` | collapse / expand card |
| P | `graph.probe` | probe the node in the timeline |
| Shift+P | `graph.probeCycle` | probe the next output |
| Alt+A / Alt+B | `graph.pinA` / `graph.pinB` | pin as A / B |
| X | `graph.swapAB` | swap A and B |
| S | `graph.snapshot` | snapshot output to a ghost |
| D | `graph.diff` | show what the node changed |
| F | `graph.frameSelection` | frame selection in view |
| Home | `graph.fit` | fit all |
| F8 / Shift+F8 | `graph.nextProblem` / `graph.prevProblem` | next / previous problem |
| Ctrl+Enter | `graph.bake` | bake selected outputs (all when none) |
| Ctrl+Shift+Enter | `graph.bakeAll` | bake all outputs |
| Ctrl+Z / Ctrl+Y, Ctrl+Shift+Z | `graph.undo` / `graph.redo` | undo / redo (shares the app stack) |
| Escape | `graph.escape` | cancel gesture / close palette / restore from maximize / deselect |
| Ctrl+G | `graph.group` | group selection in a frame |
| N | `graph.note` | add a sticky note |
| Shift+L | `graph.arrange` | auto-arrange (selection, or all) |
| Ctrl+I | `graph.inspector` | show / hide the inspector |
| Ctrl+Shift+M | `graph.maximise` | maximize / restore the panel |
| F2 | `graph.rename` | rename the node |

Unbound commands (command palette): `graph.new`, `graph.align{Left,Right,Top,Bottom,CentreH,CentreV}`, `graph.distributeH`, `graph.distributeV`, `graph.savePreset`, `graph.doc.bake`, `graph.doc.bakeRange`, `graph.doc.bakeDisable`, `graph.doc.enable`, `graph.doc.disable`, `graph.doc.evaluate`, `graph.doc.live`, `graph.doc.clearSnapshots`.

In the node search: Up/Down walk, Right/Left open and close a group, Enter places, Shift+Enter stars a favorite, Esc closes. Favourites and Recent are listed first.

## Limits

- One signal grid per graph; timing finer than the grid is lost in Signal nodes. Stay in Script nodes where exact timing matters. Signal → Script refines extremes below the grid step.
- Tracker runs are session-only. After a reload, **Tracker run** falls back to the run's ghost (same signal; confidence 1 wherever the signal is known, unknown elsewhere; no events or scenes) and warns.
- **Audio** fills once the waveform has loaded. **Tags** has no provider yet and stays empty.
- Evaluation is on the main thread; a heavy node on a long script can pause the UI briefly. Mute it while tuning what comes after.
- No sub-graphs or macros.
