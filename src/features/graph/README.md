# Graph — user guide

The **Graph** panel is Pawscript's node editor, for advanced work. You wire sources (your scripts, tracker
runs, the plan, scenes, chapters, audio) through processing nodes into outputs. Each output is one axis
script or one preview ghost. Nothing you do in the graph touches your scripts until you **Bake**, and a bake
is a single step you can undo.

Open the panel with **Ctrl+Alt+Shift+G** (Ctrl+Shift+G is the plan's Generate), or **Track ▸ Graph**. It sits in the bottom dock, in Script and Track
modes. **Maximise** in its toolbar lets it fill the workspace, and **Esc** restores it.

> Design and contract, for developers: `DESIGN.md` here and `src/lib/graph/README.md`.

---

## 1. Concepts

**A graph** is a set of nodes and the wires between them. A project can hold several graphs. Use the picker
in the toolbar to make, rename, duplicate, delete, import or export them. A graph is saved inside the
`.pawproj` and can also be shared on its own as a `.pawgraph` file. Funscript export never includes graphs.

**Non-destructive.** The graph reads the document and never writes to it. Only Bake writes. Change a
parameter and the result updates. Your script stays as it was until you bake.

**Wires carry one of four kinds of value.** Each kind has its own colour:

| Wire | Carries | Typical sources |
|---|---|---|
| **Script** (sky) | a funscript: points in time, pos 0 = deepest, 100 = out | axes, ghosts, edit operations, generators |
| **Signal** (green) | a smooth curve sampled on a fixed grid (default 50 Hz). Gaps are *unknown*, not zero. | tracker samples, confidence, phase, envelopes, LFOs, audio |
| **Spans** (yellow) | time intervals, each with a kind and a label. A zero-length span is a **point**, drawn as a hollow diamond. | plan segments, chapters, scenes, tracker events, turns, thresholds |
| **Number** (grey) | a single number (on/off = 1/0) | constants, statistics, media fps/duration |

Generic nodes (Switch, Gate, Select, Reroute) take whatever kind you wire in first.

**Two conversions happen automatically.** Each one is marked on the wire with a small diamond:
- a Script read as a Signal is sampled linearly on the grid;
- a Number read as a Signal becomes a constant curve.

Every other conversion is a choice you make. If you drag a Signal into a Script input, the wire is refused
and the editor suggests the node that does the conversion (here, **Signal → Script**). Turning a curve into
strokes, or turning spans into a gate value, is a creative decision, so the graph never does it for you.

**Parameters can be wired.** Some parameters show a socket beside their name. A wire into that socket drives
the parameter, and the typed value stays as the fallback:
- Amplitude nodes take a *Signal* that varies along time. This is how "depth per plan segment" works.
- Edit operations take a *Number*, for example from a statistic.

**Per kind ("Only inside" and per-kind overrides).** Every edit operation and every generator has an extra
input, **Only inside** (spans). With it connected, the node works only inside those spans. In the inspector,
the **kind chips** let you override any parameter for one span kind: for example, smoothing window 80 ms in
`penetration` but 300 ms in `foreplay`. Overridden kinds are highlighted. **Reset kind** removes an override.

**Status at a glance.** Each card shows a small preview (sparkline), a summary such as
`4 812 pts · 0:00–9:58 · 5–95`, and how long it took:
- A node that fails turns red and says why.
- Nodes that depend on it are dimmed and show "waiting on …".
- Outputs that do not depend on the failure keep working, and still bake.

**Live preview.** Every enabled axis output is drawn as a ghost on its lane, named "Graph → roll". So are
ghost outputs, pins A/B and snapshots. The ghosts update about 150 ms after you stop changing things.
- **Live** in the toolbar turns the output previews on and off.
- You can hide a single preview ghost from the lane, as with any ghost.
- Preview ghosts are never saved, and they go away when the graph is disabled, switched or deleted.

**Enable / disable.** A disabled graph keeps its nodes but does not evaluate and publishes no previews. Use
this to park a graph you have baked. The commands are **Graph: Enable / Disable** in the command palette.

**Bake.** **Bake** in the toolbar (Ctrl+Enter with outputs selected, Ctrl+Shift+Enter for all) runs a full,
fresh evaluation and writes every axis output into its axis:
- It is **one undo step** for all the axes it writes. Axes that did not exist yet are created, and Undo
  removes them.
- The toast says what was written and has an **Undo** button.
- Outputs reached by an error are skipped. The toast says which ones and why.
- If you edited an axis by hand since its last bake, Pawscript asks before overwriting it.
- If the result would empty an axis (or leave fewer than 2 points where there were more), Pawscript asks
  first, and the toast warns if you go ahead.
- Variants, from the command palette:
  - **Bake outputs inside the range** writes only between your I/O marks.
  - **Bake and disable** bakes, then parks the graph. Parking is its own undo step, so Ctrl+Z after it
    re-enables the graph without undoing the bake.

**Output modes** (the Axis output node's **Mode**):
- `replace`: the axis becomes the output (default).
- `inside`: replace the axis only inside the spans on its **Only inside** input, or inside the output's own
  time extent when nothing is wired. The joins are smoothed over **Seam (ms)**.
- `merge`: add the output's points to the axis, replacing points at the same times.

**Bake status chip** on each axis output:
- **never**: not baked yet.
- **baked**: the axis holds exactly this output.
- **stale**: the graph has changed since the bake.
- **axis differs**: the axis was edited after the bake.
- **error**: the output cannot be computed.

**Undo for graph edits.** Graph edits (add, wire, move, parameter changes) are undoable. A drag or a
parameter scrub is one step. Pressing Ctrl+Z in the middle of a drag is safe: if the undo touches the graph,
the drag ends there; if it touches a script, the drag carries on.

> **Note:** graphs live in the document (`app.doc.graphs`), so graph edits and bakes share the app's one undo
> stack. Only a host without `doc.graphs` (an old harness) falls back to a separate graph-only undo stack.

---

## 2. Node groups

Search with **Shift+A**, or double-click the canvas, or just start typing with the canvas focused. Results show
the port kinds and a one-line help. Presets are listed too.

### Sources
| Node | Gives |
|---|---|
| **Axis** (`src.axis`) | the current script of an axis. If it feeds an output of the same axis, you get a warning with the fix **Freeze source to ghost**: a pinned copy of the axis, so baking does not feed back into itself. |
| **Ghost** (`src.ghost`) | a ghost's script (tracker run, reference). Bound by id, then by name. The graph never sees its own preview ghosts. |
| **Tracker run** (`src.run`) | from a tracker run of this session: `signal` (samples, pos units, or a named **channel**), `confidence` 0..1, `points` (script), `events` (spans: cycle/idle/carry/still/climax), `scenes` (spans, value = sign). A newly added one picks the first run no other Tracker run node uses; presets with two run slots (Mix trackers) take two different runs. Runs are not saved, so after a reload it falls back to the run's ghost and warns. The Run picker lists those ghosts too ("ghost only"). |
| **Plan segments** (`src.plan`) | the plan lane as spans. kind = segment kind, data = its recipe, params and intensity. **Only kinds** filters. |
| **Chapters / Loops / Bookmarks / Range / Selection** | spans (bookmarks and selection are points). Selection is neither saved nor undoable, so it is meant for quick experiments. |
| **Scenes / Track spans** | the tracking feature's scene cuts and span labels. |
| **Audio** | the soundtrack's peak envelope, 0..1. It is loaded when you first add this node, and it is empty until the waveform is available. |
| **Tags** | spans from a tags provider. There is none yet, so it stays empty. |
| **Time / Media** | `t` as a signal; duration and fps as numbers. |
| **Number / Script / Spans** (`const.*`) | values you type or draw in the node. |

### Script analysis
**Sample** (script → signal, linear/step/cosine) · **Turns** (points at tops and bottoms) · **Strokes**
(spans up/down, value = amplitude) · **Phase** (`phase` 0 at the out turn, 0.5 at the deep turn; `amp`;
`period`) · **Speed** (pos/s) · **Rate** (strokes/min).

### Script structure
- **Splice**: `insert` inside the spans, `base` outside, with a cut or blended seam.
- **Trim**: keep only the parts inside the spans.
- **Merge**: union of the points of a and b, with a priority.
- **Mix**: a weighted average of a and b. For clean strokes, it is usually better to blend signals and then
  use Signal → Script.
- **Tile**: repeat a template across the spans.

### Amplitude (exact per point; every parameter can take a signal)
**Remap depth** (pos 0..100 onto Deep end..Out end) · **Gain** (around a pivot) · **Offset** · **Clamp**
(clamp or compress) · **Curve** (ease/exp/gamma).

### Edit (every operation of the editor's Edit menu)
- **amplitude**: scale, offset, invert, remap, limit, normalise, envelope, align extremes, extremes;
- **time**: shift, stretch, fit, reverse, ripple, quantise, equalise spacing;
- **density**: simplify, thin, keep extremes, remove micro-reversals, add midpoints, subdivide, smooth;
- **speed**: cap speed, minimum spacing;
- **rhythm**: double/half time, change stroke rate, repeat;
- **variation**: jitter, humanise;
- **points (advanced)**: delete, move, nudge, set pos.

Each node also has a `changed` output: points marking what it altered. Feed it to **Probe** to see where it
acted. Operations that move points in time say so: spans downstream are not moved with them.

### Select
Select turns, grow, shrink, every Nth, by speed, similar, invert. Each one outputs points, ready for any
**Only inside**.

### Signal
- **Math** (add, sub, mul, div, min, max, pow, absdiff, avg, mix, clamp, abs, neg)
- **Expression** (`a b c d`, `t` ms, `s` seconds; `sin cos … smoothstep tri saw sqr`, `nz(x, d)`, `isnan`;
  comparisons give 0/1; `c ? x : y`)
- **Smooth** (zero-phase: no lag)
- **Slew** · **Median** · **Fill gaps** · **Normalise** · **Remap** · **Delay** · **Derivative** ·
  **Integrate** · **Envelope** · **Quantise**
- **Blend by confidence** (`a`, `ca`, `b`, `cb`, γ). A missing arm is ignored; `dominance` shows who wins.
- **LFO** · **Noise** (seeded)
- **Phase wave** (a wave driven by a phase, optionally scaled by amplitude)
- **Signal → Script** (extremes with sub-sample timing, or resample; gaps: break / hold / bridge)
- **Sample at** (the signal's value at given times, e.g. the stroke's own turns, plus mids or quarters)

### Spans
- **Filter** (kinds, label, length, value above/below), **Not**, **And / Or / Minus**
- **Pad**, **Merge gaps**, **Shift**, **Relabel**, **Between** (points → spans between them)
- **Threshold** (signal → spans, with hysteresis)
- **Depth by kind** (`spans.kindRange` → `lo`/`hi` signals per kind with crossfades: *the* depth-per-plan
  node)
- **Value by kind** · **Envelope** (ramps inside spans) · **To signal**

### Flow
- **Switch**: b inside the spans, a outside. Scripts are spliced, signals crossfaded.
- **Gate**: keep only what is inside the spans.
- **Select**: one of four inputs; a saved A/B switch.
- **Reroute**: a dot to tidy wires.

### Analyze
- **Statistic** (mean, median, min, max, percentiles → number)
- **Problems** (spans where the review profile finds problems). Wire it into **Only inside** to fix only
  there.
- **Compare** (`score` F1, `lag` ms, `diff` spans of unmatched turns)

### Generate
Every pattern generator, with its recipes as variants (for example **Pulses ▸ Climax pulses**). Each
**Only inside** span is generated over its own extent, joined under the speed cap. **Plan** compiles plan
spans with each segment's own recipe.

### Outputs
- **Axis output** (`axis`, `mode`, `seam`) is what Bake writes. Its card shows the bake status chip.
- **Ghost output** (name, colour) is preview only. Its "Bake to axis…" action adds an Axis output wired to
  the same source.

---

## 3. Worked examples

All three are also presets (**Add preset** in the toolbar). Building them by hand once is the best way to
learn the editor.

### Example 1 — tracker → clean → depth per plan segment → stroke

*Goal:* a tracker run has the right timing but noisy, uniform depth. You want clean strokes whose depth
follows the plan: shallow foreplay, full penetration, tight knotting.

1. **Shift+A**, type `ghost`, pick **Ghost**. In the inspector, choose your tracker run (for example
   "Run 1: flow").
2. With the Ghost node focused, press **Shift+A** and add **Remove micro-reversals**. It is wired to the
   ghost automatically. Then append **Smooth** (method `savgol`, window 160 ms) and **Keep extremes**.
3. Append **Cap speed** (450).
4. Append **Extremes** (amount 6, relative). This pushes each turn a little further out so the strokes read
   clearly.
5. Add **Plan segments**, then **Depth by kind**, and wire Plan → Depth by kind. In its table, set the rows,
   for example:

   | kind | lo | hi |
   |---|---|---|
   | foreplay | 55 | 95 |
   | oral | 40 | 95 |
   | penetration | 0 | 85 |
   | knotting | 0 | 30 |
   | climax | 0 | 90 |
   | orgasm | 0 | 40 |
   | afterglow | 20 | 90 |

   Keep **Fade** at 400 ms so the depth glides across segment boundaries.
6. Add **Remap depth** after Extremes. Drag Depth by kind's `lo` onto Remap's **Deep end** socket, and `hi`
   onto **Out end**. The typed values stay as the fallback where no segment applies.
7. Append **Axis output** with axis `stroke`, mode `replace`. The result appears as the ghost
   "Graph → stroke" on the stroke lane.
8. Probe as you go. Press **P** on any node to draw its value on the Probe row under the lanes, aligned
   with the timeline. Hover a card to read its value at the cursor.
9. **Bake**. Check the stroke lane, and press Ctrl+Z if you want it back.

Variation: if the cleanup should differ per kind, select **Smooth**, click the `knotting` chip in the
inspector and lower its window. Then wire Plan segments into Smooth's **Only inside**.

### Example 2 — derive roll from the stroke

*Goal:* a roll axis that sways with the strokes, deeper on bigger strokes, without scripting it by hand.

1. Add **Axis** (axis `stroke`).
2. Append **Phase**. Its `phase` output is 0 at each out turn, 0.5 at each deep turn, and runs evenly in
   between. `amp` is each stroke's size, 0..1.
3. Add **Phase wave**. Wire `phase` → `phase` and `amp` → `amp`. Set offset 0.25, so roll peaks
   mid-stroke; depth 18; center 50; follow amp 1, so small strokes roll less.
4. Add **Sample at**. Wire Phase wave → `signal`, and the **Axis** script → `times`, so roll points land on
   the stroke's own turns. Set **also** to `mids` for a point between turns.
5. Append **Cap speed** (for example 300).
6. Append **Axis output** with axis `roll`.
7. Bake. Undo removes the new roll axis again.

For **twist**, use the same chain with cycles 0.5 (one twist per two strokes), offset 0.5, center 50, and
axis `twist`. Two outputs may write different axes in one graph, and one Bake writes both in a single undo
step.

The Axis output warns that it reads its own axis only if it reads the axis it writes. That is not the case
here: roll is derived from stroke.

### Example 3 — mix two trackers by confidence

*Goal:* two tracker runs each lose the subject in different places. Combine them, trusting whichever is
more confident at each moment, then turn the result into strokes.

1. Add **Tracker run** twice. Pick run A in the first and run B in the second. Each one has `signal` and
   `confidence` outputs.
2. Add **Blend by confidence**. Wire A.signal → `a`, A.confidence → `ca`, B.signal → `b`,
   B.confidence → `cb`. Keep γ at 2, which favours the more confident run clearly. Where one run is missing,
   the other is used as is.
3. Probe Blend's `dominance` output to see which run wins where (1 = A).
4. Append **Fill gaps** (max 500 ms, linear), so short gaps where both runs are lost are bridged.
5. Append **Smooth** (zero-phase: it adds no lag).
6. Append **Signal → Script** (mode `extremes`, min prominence 3, gaps `break`).
7. Append **Axis output** with axis `stroke`.
8. To compare with your current stroke first, add an **Axis** (stroke) node and **Compare** (cand = the
   new script, ref = Axis). Its score and lag appear on the card.
9. Bake.

Tracker runs live only for the session. After a reload, **Tracker run** falls back to the run's ghost, which
gives the same signal with no confidence, and warns. Bake while the runs are still loaded, or use **Ghost**
sources and **Mix**.

### Two more, in short

- **Orgasm pulses only inside orgasm segments** (preset `climax-pulses`):
  1. **Plan segments** → **Filter** (kinds: orgasm) → **Pulses** ▸ Orgasm pulses (classic), wired into its
     **Only inside**.
  2. **Splice**: base = Axis stroke, insert = Pulses, where = the filtered spans, seam `blend` 150 ms.
  3. → **Axis output** stroke.
- **A/B two chains** (preset `ab-smoothing`):
  1. Run one source through two different Smooth nodes, each into a **Ghost output**. Both appear on the
     lane.
  2. Or press **Alt+A** on one node and **Alt+B** on another: the A/B strip shows how they compare. **X**
     swaps them, and **S** snapshots a node's current output as a reference ghost.
  3. **Select** (flow) gives a one-key A/B that is saved with the graph.

---

## 4. Tips

- **Probe everything.** **P** puts a node's value on the Probe row. Shift+P cycles its outputs. Hover the
  row and every card shows its value at that moment, so you can follow a wire at one instant.
- **Read the wire colours.** An amber diamond on a wire is an automatic conversion. A refused wire tells you
  which node to insert: the drag-search lists it first, and the error card has a one-click fix.
- **Keyboard first:**
  - **Shift+A** appends to the focused node. **C** connects to a compatible port.
  - **Alt+arrows** follow wires.
  - **M** mutes (bypass), **Ctrl+Del** dissolves a node and reconnects around it.
  - **F8** jumps to the next problem.
- **Mute to compare.** A muted node passes its input straight through, so you can see what a step
  contributes.
- **Seeds.** Random nodes store their seed, so the same graph gives the same script every time. Use
  **Reroll** in the inspector for a new variation.
- **Slow graphs.** If a full evaluation takes longer than 250 ms, the status line names the slowest node and
  previews update when you release a control, not while you drag. Simplify and smooth on long scripts are
  the usual culprits. Mute them while you tune what comes after.
- **"Polish my script" graphs** that read and write the same axis are allowed. Freeze the source (the fix on
  the warning) if you want to bake repeatedly from the same starting point.
- **Bake range** (I/O marks, then **Graph: Bake outputs inside the range**) is the safe way to apply a graph
  to one passage.
- **Share** a graph with **Export** (a `.pawgraph` file) and bring it back with **Import**. Unknown node
  types from a newer version are kept and shown as "Missing", and they survive a save.

## 5. Limits

- The graph previews and bakes. It does not drive a device in real time.
- One signal grid per graph (25/50/100/200 Hz). Timing finer than the grid is lost in signal nodes, so stay
  in script nodes where exact timing matters. Signal → Script refines extremes below the grid step.
- Tracker runs are session-only (see Example 3). Audio needs the waveform to load. Tags need a provider that
  does not exist yet.
- Only the open graph evaluates and previews. Other graphs in the project wait until you open them.
- Per-kind overrides on time-moving operations can collide at segment seams. For depth per kind, prefer
  Remap depth + Depth by kind, which crossfades.
- Evaluation runs on the main thread. A single very heavy node (simplify on 100 000 points) can hold the UI
  for a moment. Previews of the visible range come first to keep that rare.
- No macros or sub-graphs yet.

---

## For developers: integration surface

`integration.js` exports:
- `graphController(app)`, the reactive controller of contract §10, one per app;
- `integrationCommands`, the `graph.doc.*` commands. The editor's `commands.js` spreads them in.

The pieces behind it:
- `integration/core.js`: the logic, runes-free and node-tested.
- `integration/controller.svelte.js`: the runes wrapper, plus discovery of lib/graph, tracking and waveform
  through `import.meta.glob`.
- `integration/snapshot.js`: the document Snapshot and the audio envelope.
- `integration/persist.js`: the `.pawproj` block helpers for the shell.

Pure adapters (sources, previews, bake plan) are in `src/lib/graph/doc.js`. Tests:
`test/graph-integration-*.test.mjs`.

### Shell integration status

Items 1-4 below have landed in the shell (verified 2026-11-06: app-undo mode in the real shell, bake + undo +
redo on one stack, `.pawproj` round trip through `projectDoc`/`appDocFrom`, graph ghosts filtered). Item 5 is
still open in `src/app/history.js`.

1. In `src/app/doc.svelte.js`:
   - add `graphs = $state.raw([])` to `Doc`;
   - add `'graphs'` to `UNDOABLE`;
   - in `load()`, set `this.graphs = d.graphs || []`.
   The controller detects the new field through `app.doc.read()` and switches to app-undo mode. Graph edits
   and bakes then share Ctrl+Z.
2. In `src/app/project-logic.js`, using `integration/persist.js` (pure; no registry needed):
   - `projectDoc`: `graphsToProject(pd, d.graphs)`, and `pd.ghosts = withoutGraphGhosts(pd.ghosts)`;
   - `appDocFrom`: `const { graphs, extra } = graphsFromProject(pd)` → `graphs` into the doc (raw block
     items), `extra` into `project.extra`.
   The controller parses graphs it did not make (`parseGraph`: migrations, defaults, ids) the first time it
   sees them, so the shell does not need the node registry.
   Until then the controller keeps graphs in `app.doc.project.extra.graphs` itself, which `projectDoc` and
   `appDocFrom` already carry.
3. In `src/app/project.svelte.js`: add `d.project` (or `d.graphs`) to the autosave change key (`#autosave`
   key list). Otherwise a session whose only change is a graph edit is not autosaved.
4. In autosave and `.pawproj` writes (`ghostScripts: true`), filter ghosts whose `source.kind === 'graph'`
   (`withoutGraphGhosts`). The controller also drops stale ones on load.
5. In `src/app/history.js`: a handle that `#closeOpen()` force-closed (Ctrl+Z / Ctrl+Y while a group is open)
   still decrements `depth` on its late `commit()` / `cancel()`, taking it to -1, after which no group ever
   records again. Fix: a generation counter bumped in `#closeOpen()` and `reset()`, captured in `begin()`;
   `finish()` returns false when it changed. The graph's own gestures no longer hold an `app.begin` group open
   (they record base → final in one `app.transact` on commit), so they cannot trigger it; other features'
   drags still can.
