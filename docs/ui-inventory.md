# UI inventory: where every control lives (paw-5la)

The owner, 2026-11-10: "I feel like we got tons of things in different places where they can be all combined into one
home, or across a few, idk, don't dramatically re-arrange everything I like the layout currently, but some things can
move". This page is the audit and the proposal. The overall layout stays: the docks, the timeline rows and the panels.
The owner approved moves 1 to 15 on 2026-11-10 ("lets go ahead with the ui changes from the inventory", paw-t8z): all
but 12 are done, each its own commit (section 5); 12 was left undone, see section 5.

Sources: the registered commands and panels, dumped from the running shell (705 commands, 21 panels, 12 timeline
lanes), and the surfaces' own code (chips, popovers, panels, right-click menus). The usage log covers 46 sessions,
2026-11-09 19:32 to 2026-11-10 05:39 (`node dev/usage-report.mjs`).

## 1. Surfaces and what they hold

| Surface | What is on it |
|---|---|
| **Top menus** (File, Edit, Play, View, Track, Review, Help) | Generated from each command's `menu`. Edit holds Transform tools (103), points, plan, effects (37), chapters, range. Track holds the tracker, groups, graph, director, assist and draft. View holds lanes, timeline rows, zoom, theme and video. |
| **Command palette** (Ctrl+K) | Every command (705), including the 141 with no menu. |
| **Toolbar chips**: Scene · Shot, plus inline Groups, Track ▾ and Track ROI (`SceneChips`) | Each chip opens a popover with its part of the quick bar (`SceneQuickBar`). Several shots: the Shot chip says how many (the Shots strip shows which). **Tracker** (paw-unuy: no chip; Track's tooltip names the tracker and its points): the ▾ beside Track or a right-click on Track / Track ROI opens its settings (`TrackMenu`): tracker select, Track's grid points, the tracker's params (model input size, points per group, ...), the signal and progress, Cancel, Tracker panel; Groups / Track ROI too when the row is narrow. **Scene**: where / what / structure chips, modifier chips with the scene's span list, Knotting effect, Unknotting, Spurt, Fill (← before / both / after → / Accept), merge offers, New scene here, Merge ← / →, + Effect (Knotting, Spurt, More). **Shot**: view and camera chips, Camera move before, Cut here, Merge ← / →, Stabilise, Accept re-found groups, *Adjust in Tracker panel* (done). |
| **Scenes row** (Scenes / Shots / Modifiers strips) | Click and drag to select. Drag boundaries. Right-click a boundary to convert or merge. Right-click a scene or shot for: select, zoom, describe, split / merge scene or shot, join, own scene, cutaway proposal, group shots, offers, fill, spurts from balls, detect cumshots, guide lines, the tag list. Modifiers strip: draw, move and resize spans, G / S / X / Shift+D, Shift+O / Shift+K, a kind picker; right-click a span for kind, detect cumshots (orgasm), select its range, delete. |
| **Effects row** (`FxLane`), CumBar and the balls row | Drag and resize effects, box-select. Right-click: link / unlink, Curve…, mute, un-bake, duplicate, kind, add effect, delete. CumBar: detect cumshots, all / strong only, place, ↻, ×. Balls row: contraction peaks → place spurts. |
| **Range row** (Autorange, `RangeLane`) | Band drags, the policy popover, live / off, gaps. Right-click: back to the policy, lock, leave as it is, flatten, accept the fill. |
| **Tracker lane** (paw-unuy: on the Track tab it is the stroke lane itself: the runs' traces faint under the points, anchors, seed marks, baseline knots on it; inside its bottom edge one band (range overrides: drag along it to draw one; under them the ± direction marks of the selected run), the lane's pos scale ending above it; the shaft data layered on the lane's own scale; under it only one inspector band for the shot (the shaft note there too), ▾ = the Adjust strip in place (fusion, depth and its compressor, Smart stroke, camera, strokes, shaft data); no shot-number strip, no span-label strip: their clicks are the Shots strip and the lane's right-click. Refine / Review keep the separate Tracker row, hidden by default) | Group / part channel chips and their ▾ variants, relative pair ⇄, baseline off / auto / knots, env, the ± flip strip per run cut, right-click a knot to delete it. **Detail chip** on the run at the current shot (popover: scene / shot / area, turns / + mid / + mid + hold / free, sensitivity, points per half-stroke, override list, Simplify to this detail); right-click the run: scene / shot Detail radios, Simplify. Range overrides of the signal (paw-hiq5): drag along the thin band at the top of the row to draw one (frame-snapped), click = select, body drag = move, end drag = resize, right-click = source / against / Whole shot / Remove, Delete or × clear removes it; the strip edits the override under the playhead ("range a–b") else the shot ("shot N"); command "Signal override over the I-O range". |
| **Script lane** (`LaneView` + `LaneToolbar`) | Toolbar: axis chips, add axis, Snap menu, speed colours, ghosts, push, follow, clean joins, Rec / Tap, latency. Right-click: point edits, transform, accept ghost, select, Lane ▸ (lock, visible, solo, ghosts on this lane, move, remove). |
| **Tracking panel** (left) | **Tracker**: select, params, Parts-first (the next run's stroke axis: a bar beside the axis tool on the video; Trails: the video's View menu). **Range**: Scene at playhead, Whole video, Track, Cancel, Direction (fwd / back), Scenes (document / detect / one), Grid: whole frame, grid form (points). **Runs**: per run eye / select / ×; expanded: Why, Score, Check camera motion, Accept, Merge, Flip, Export, Overwrite; **Adjust · shot N** (camera auto / off / move / zoom / rot, strength, smooth, stroke axis, On video, Smart stroke, **Strokes** (min stroke, min length, max speed, depth), Fused from, Apply to script). |
| **Scenes panel** (left) | Detect, Describe all, Loop. Per scene: the quick bar tag chips, offers, shot lines, Describe, Loop (this shot), box tags Show / ROI. Scene options: detection, loop and describe forms. |
| **Inspector** (right) | The selected thing in full: FxEditor (effect curve), PlanInspector, loop / marker / run text, or the quick bar for the scene. |
| **Points**, Transform, Quick actions, Snippets, History (right) | Point editing and transforms (`inspector.*`, `tool.*`). |
| **Machine** (right) | Character, size, toy and its menu, view and cutaway, Readouts, Tuning, Calibration. |
| **Device** (right, `playback`) | Device connect / scan, Valence hub, Playback (play on device, follow scrubbing, latency, range, invert), Profile (device profile, stroke window), Live. |
| Review panels (Problems, Statistics, Compare, Device and heatmap), Plan, Chapters, Fix, Assist, Director | Each its own panel. |
| **Settings** (right, every tab; `Ctrl+,`, File > Settings; over the Projects page when nothing is open) | Every preference, generated from the settings schema (`app/settings.svelte.js`: group, label, doc): search, Show advanced (state such as layouts and recent lists), per-row reset, Export / Import / Reset all. The home for preferences; the rule against forms is about editing the script. The earlier entry points (View menu, lane toggles, panel controls) stay. |
| **F1 help overlay** (`palette/Help.svelte`) | Two pages: **Quick start** (docs/guide/quick-start.md, bundled; `onboard/QuickStart.svelte`) and **Shortcuts** (Here: <tab>, every bound command, Edit shortcuts). Opens on the page picked last (new profile: Quick start). Help menu: Quick start, Show / Hide first-run hints (paw-kxwz). |
| **First-run hint** (over the picture, Scenes / Track tabs; `onboard/NextStep.svelte`) | One line: the next step for the shot under the playhead with its key, Quick start, x (hides that step). On only for a profile that had no projects (`onboard.hints`). The empty Projects page shows the five-step card (`onboard/FirstSteps.svelte`, x hides it). |
| **Graph** and **Shortcuts** (bottom) | The node graph; the key list (rebinding, conflicts). |
| **Status bar** | Save state, video info, active axis, selection count, range, loop, span, follow, the running task, problems, sidecar, plug-in chips (Device, Draft, Director, Assist). |

## 2. What the owner uses (usage log)

- **Keys carry the work.** player.toggle 87, undo 68, tracking.accept 47, lanes.delete 20, timeline.autorange (Ctrl+Alt+R) 15, tracking.axisDraw 14, fx.spurtAtPlayhead (U) 13, groupsDelete 11, fx.throbAtPlayhead 6.
- **Chips and popovers are used.** quickbar.tag 28, quickbar.grid 17, chips.grid 14, quickbar.stabilise 6, quickbar.what 5, chips.shot 3, quickbar.mod 3, chips.scene 2. Grid is pressed from both the inline toolbar button and the Tracker popover, about equally (14 / 17).
- **Menus are used rarely.** Fill both (11) and Fill after (2) from a menu (the Scenes row's right-click carries them); timeline.fx.remove (menu 7, button 12); fx.unbake 8; modifier toggles from the menu 3.
- **Panels by dwell time.** Scenes panel 26 min, Tracking 9, Machine 8, Inspector 8, Fix 2, Device 1. Points, History, Chapters, Director, Plan and Assist got a glance or nothing.
- **Never touched in the log.** The Plan lane and panel, chapters / loops commands, Director, Assist, Draft, Review panels other than Problems, Snippets, the Transform tools (103 commands), the graph, CumBar place, balls → spurts.
- **Friction.** Undo within 10 s: timeline.mod.toggle.orgasm 2 / 2, quickbar.mergeShotNext 1 / 1, tracking.accept 5 / 47. The undo log shows "Move orgasm" undone twice. That matches paw-d8u: spans did not update while dragged, fixed in 1896920.
- **Settings.** Machine camera / params / character dominate (Machine panel). tracking.groups.brush 36. autorange.policy 10.

## 3. The scatter: one concept, several places

| Concept | Where it is today | How the places differ |
|---|---|---|
| **Track / Grid / Cancel** | Inline toolbar Track and Grid (`SceneChips`); Tracker popover Track, Grid, Cancel; Tracking panel Range ▸ Track, Cancel, "Grid: whole frame"; key T | With the popover open, both Track buttons show at once. The chip Track handles a non-contiguous shot selection (`trackShots`); the panel's does not. Grid has a third name in the panel. Their tips and toasts differ ("this selection" / "this span" / "this scene"). |
| **Motion groups g1–g4** (which group drives the stroke) | retired from the primary UI (paw-9qm): only at the bottom of the Tracker row's source picker, and the overlay's group click | One place. |
| **Painted groups** (Groups tool) | Tracker popover "Groups" (command); key Tab; Shot popover "Accept re-found" | One button (the panel's duplicate went, paw-57dw). |
| **Spurts / cumshots** | U / Alt+U; quick bar Spurt (while an orgasm span exists); + Effect ▸ Spurt; Effects row menu ▸ Spurt; CumBar detect / place / clear; balls row → place spurts; Scenes row menu: Detect cumshots, Spurts from balls; orgasm span menu: Detect cumshots over this orgasm | Was "Find spurts" in one place and "Detect cumshots" in the others: **done**, one name now. CumBar "place" puts spurts while its command says "cumshots". Two "place" buttons for two proposal sources sit in neighbouring rows. |
| **Knotting effect vs knotting span** | Span: Shift+K, Alt+Shift+N, the Scene popover chip, the Modifiers strip. Effect: Alt+N (over the span at the playhead), the quick bar "Knotting effect" (span ≤ 8 s → One knot), + Effect ▸ Knotting (whole bar span), Effects row menu ▸ Knotting (scene at the click), Unknotting | Four "add Knotting effect" entries with four span rules. Since paw-d8u an effect made over a span follows it. |
| **Camera of a shot** | Shot popover camera tags (static / rides the stroke / pan / zoom / turntable / handheld) and "Camera move before"; Tracking panel ▸ Runs ▸ Adjust camera (auto / off / move / zoom / rot, strength, smooth, from); run "Check camera motion"; tracker params | Tags "turntable" and "rides the stroke" mean removal off BY DEFAULT (the strip and Adjust say "off (turntable)"; any mode chosen in Adjust, the Tracker row's vs-camera menu or a range override wins, "Default" brings it back); Adjust "rot" has a turntable tip. The Shot popover had no way to the Adjust section: link **done**. |
| **Stroke axis** | Tracking panel ▸ Tracker (before tracking: Draw / Clear / auto / vert / horiz / arrow); Adjust (after tracking: tracked / auto / … / On video) | Same words, different scope (the next run vs this shot's derived stroke). |
| **Stroke direction / flip** | Key F "Flip scene at playhead"; Adjust hint "F flips the scene"; Tracker lane ± strip per **run cut** and menu "Flip run cut N"; panel run **Flip** (the whole run) | "scene" and "run cut" name the same unit. The panel's "Direction" means *tracking* direction (fwd / back), and Trails has a "direction" option too. |
| **Turning a run into strokes** | Adjust ▸ Strokes (min stroke, length, detail, max speed, depth); Smart stroke; Autorange policy (Range row); the old script-shaping params in the tracker form (pipe_*) | Three places shape the same strokes at different stages. |
| **Fill** | **Since paw-ef73.2 a cutaway** (a layer over the scene: drag up / C / right-click; its one choice motion from the scene or track it, mapped onto the fill). The older fills ← / both / → / timing stay in the Scenes row right-click › Older fill choices and on a scene that has one fill on every shot. Before: Scene fill and shot fill (paw-sxu: Fill this shot / Fill N shots for part of a scene) ← / both / → / timing from this shot and Accept (Scene popover, Shot popover, Inspector, Scenes row menu; Flatten bakes the waiting ones); Autorange "Accept the fill" / gaps (Range row); Tracker lane "low confidence: Fill" | One word for three features. |
| **Merge offers** | Scene popover Accept / Drop; Scenes panel Accept / Drop; Scenes row menu | They do the same thing through different code paths. |
| **Stabilise** | Shot popover; the Inspector's quick bar; command track.stabilise | Same, two copies of the code. |
| **Snap to frames** | Toolbar Snap ▸ frames (global); Loops menu "Snap to frames" (that loop's period) | Same label, different action. |
| **Loop** | Scenes panel top Loop and per-shot Loop (**done**: "Loop this shot"); Loops lane; status-bar loop playback | |
| **Follow playhead** | Toolbar toggle, View menu, status bar "no follow" | Fine: three views of one toggle. |
| **Ghosts** | Toolbar "Show ghosts" (global), lane menu "Ghosts on this lane", run eye | Fine: three levels. |
| **Accept** | Run Accept / Merge, lane "Accept ghost", Adjust "Apply to script", fill Accept, gaps accept, offer Accept, re-found Accept | Seven "accept"s. Each is local to what it accepts, which is acceptable. |
| **Range** | I / O range (panel, status bar), Range row (Autorange), Device "Range", Adjust "Depth range" | Same word for four things. |

**Dead code and duplicates found.** A `{#if true}` dead branch in SceneQuickBar (**done**). The Effects row menu's
Delete showed X, which deletes the whole selection, while the item deletes one effect (**done**). Two "Loop" buttons
were on screen at once in the Scenes panel (**done**). The `tagsOnly` quick bar in the Scenes panel still shows Fill,
modifiers, effects, view / camera and Stabilise, against its comment ("just the tag chips"). That last one is a
proposal below, because the owner uses the Scenes panel most (26 min).

## 4. Proposal: a few homes

1. **Everything about the act → the Scene chip popover and the Scenes row.** Tags, modifier spans, fill, merges and
   offers, and the act's effects (Knotting over the span, Spurt).
2. **Everything about the camera of a shot → the Shot chip popover.** View and camera tags, camera move before, cut and
   merge, Stabilise, and the shot's camera *removal* (today in Adjust).
3. **Everything about tracking → the Tracker chip popover**, with the Tracking panel as its full form. Tracker, Track /
   Grid / Cancel, motion groups, Groups. One Track, one Grid.
4. **Everything about turning a run into strokes → one place: Runs ▸ Adjust ▸ Strokes.** Smart stroke, strokes,
   stroke axis after tracking, flip.
5. **Everything about finishing → the Range and Effects rows.** Autorange (policy, bands, gaps), effects, spurts and
   cumshot proposals.
6. **The Inspector shows the selected thing's full detail.** It is never the only place for an action.

### Specific moves (for the owner's yes)

| # | Move | Size | What is removed where | Notes |
|---|---|---|---|---|
| 1 | Hide the inline toolbar **Track** and **Grid** while the Tracker popover is open (one of each on screen) | small | nothing removed; the inline pair hides only while the popover shows | **done** `f0249fb` · Grid is used from both (14 / 17): keep both entry points |
| 2 | One Track: the panel's Track uses the chip's multi-shot path (`trackShots`); one name "Grid" everywhere | small | "Grid: whole frame" → "Grid" (tip keeps "whole frame") | **done** `bade34c` · behaviour fix + label |
| 3 | Motion-group chips behave the same everywhere (pick **and** link the scene) | medium | the panel legend's no-link pick | **done** `59a8240` · tracking panel |
| 4 | Painted-groups button: one enable rule (the command's) in popover and panel | small | the panel's own rule | **done** `a47a38e` |
| 5 | Flip wording: "Flip scene" everywhere (the lane's "run cut" → "scene of the run") | small | "run cut" in the lane strip / menu | **done** `aed56de` |
| 6 | Panel "Direction" → "Track direction" | small | label only | **done** `86ae70c` · avoids the stroke-direction clash |
| 7 | Show the shot's **camera removal** (Adjust camera mode + strength) inside the Shot popover; Adjust keeps the full form | medium | none (a mirror) | **done** `f4b6fd0` · home 2; Adjust is used post-track only |
| 8 | Knotting effect: one span rule for every "add Knotting" entry (the span at the playhead, else the range, else the scene; ≤ 8 s → One knot), and Unknotting next to it in + Effect | medium | the four separate span rules | **done** `f843d00` · home 1 |
| 9 | The Scenes panel's tag block shows only tags (as its `tagsOnly` says); Fill, effects, Stabilise stay in the popovers | medium | Fill / effects / Stabilise from the Scenes panel | **done** `a7f7394` · the owner's most-used panel: approved |
| 10 | Autorange "Accept the fill" → "Accept gap fill" (vs scene Fill) | small | label only | **done** `dac9182` |
| 11 | CumBar "place" → "place spurts"; command titles "Place the proposed spurts" | small | label only | **done** `5b64a30` |
| 12 | One place for spurt *proposals*: CumBar and the balls row become one proposals row (sources: cumshot detection, balls, pulse groups) | large | the separate balls row | **not done**: needs a behaviour change, see section 5 |
| 13 | Turning a run into strokes: move the tracker form's script-shaping `pipe_*` params under Adjust ▸ Strokes ("advanced") | large | those fields from the tracker form | **done** `f0b2a2c` · touches the sidecar param form |
| 14 | Stroke axis: label the panel's "Stroke axis (next run)" and Adjust's "Stroke axis (this shot)" | small | labels | **done** `f954d05` |
| 15 | Toolbar "Snap to frames" vs Loops "Snap to frames": rename the loop item "Snap the loop to frames" | small | label | **done** `0829011` |
| 16 | Machine and Device: keep as they are (Machine panel used 8 min, settings-heavy) | — | — | kept as they are |

## 5. Done now (small and clearly right, each its own commit)

- `2b13fe7` Effects row menu: with several effects selected, the delete item says "Delete this effect" and no longer
  shows X (X deletes the whole selection).
- `0a6c765` Scenes panel: the multi-shot scene's detail button reads "Loop this shot".
- `8efe151` One name for spurt detection: "Detect cumshots" (the orgasm span's menu and hover, the tag tip, the guide;
  it was also "Find spurts").
- `25e187c` Scene quick bar: a dead `{#if true}` branch removed.
- `b2b4ca3` Shot popover: "Adjust in Tracker panel" (when the shot has a run) opens the Tracking panel, where its camera
  removal, stroke axis and strokes are.
- `f0249fb` Move 1 (paw-t8z): the inline toolbar Track and Grid hide while the Tracker popover is open, so one Track
  and one Grid are on screen; both entry points stay.
- `bade34c` Move 2 (paw-t8z): one Track. The Tracking panel's Track goes the chip's way: a selection of shots that is not one
  unbroken run tracks exactly those shots (`trackPicked` in quickbar.js, shared by the chip, the quick bar and the
  panel), else the range as before. The panel's "Grid: whole frame" is "Grid" (its tip and the command title keep
  "whole frame").
- `a47a38e` Move 4 (paw-t8z): the Tracking panel's Groups button is the `tracking.groups` command, so it is enabled exactly
  Groups buttons in the panel and the Tracker popover are plain toggles, enabled whenever a video is open.
- `aed56de` Move 5 (paw-t8z): flip wording. The Tracker lane's ± strip tip and menu say "Scene N of the run" / "Flip
  scene N of the run" (were "Run cut N"), matching F "Flip scene at playhead"; the guide too.
- `86ae70c` Move 6 (paw-t8z): the Tracking panel's "Direction" row reads "Track direction" (fwd / back is the tracking
  direction, not the stroke direction).
- `f954d05` (+ `fd6e98f`, a tip quote that broke the build) Move 14 (paw-t8z): stroke axis labels. The Tracker
  section's row reads "Stroke axis (next run)", Adjust's "Stroke axis (this shot)".
- `0829011` Move 15 (paw-t8z): the loop's "Snap to frames" (Loops row menu, loop popover, command title) reads "Snap
  the loop to frames"; the toolbar's global "Snap to frames" keeps its name.
- `dac9182` Move 10 (paw-t8z): the Range row's right-click "Accept the fill" reads "Accept gap fill" ("Accept N gap fills"),
  apart from the scene Fill.
- `5b64a30` Move 11 (paw-t8z): the Effects row's cumshot bar button reads "place spurts" (was "place"); its commands are
  "Place / Drop the proposed spurts of the scene at the playhead"; the toast and the guide say the same.
- `59a8240` Move 3 (paw-t8z): the motion-group chips pick the same way everywhere (`pickGroupFor` in quickbar.js): the
  Tracking panel's g1–g4 legend now also links the current scene to the picked group, as the Tracker popover and
  Inspector chips do. (Its old pick already linked the run's own scene through pickChannel, so the visible change is
  small: the scene under the selection is the one linked.)
- `f4b6fd0` (+ `335bd65`, the guide) Move 7 (paw-t8z): the Shot popover mirrors the shot's camera removal (mode auto /
  off / move / zoom / rot and strength), the same setDerive and reach as Runs ▸ Adjust, while the shot has a run it can
  adjust; Adjust keeps the full form (smoothing, camera from, stroke axis, strokes).
- `f843d00` Move 8 (paw-t8z): one span rule for every "add Knotting" (`knotSpan` in commands-fx.js): the knotting span
  at the playhead (on the Effects row menu: at the click), else the range, else the scene; a knotting span of 8 s or
  less is One knot. Alt+N, the quick bar's Knotting effect, + Effect ▸ Knotting, the Effects row menu and the palette
  all use it. + Effect has Unknotting next to Knotting (the last 3 s of that span). The quick bar no longer falls back
  to the scene's first knotting span when the playhead is outside it.
- `a7f7394` Move 9 (paw-t8z): the Scenes panel's selected row shows only its tags (where / what / modifiers and their
  spans / structure / view / camera): no Fill, Knotting effect / Unknotting / Spurt or Stabilise there. Checked first
  that they stay reachable: Fill (← / both / → / Accept) and the effects in the Scene popover and the Inspector;
  Stabilise in the Shot popover and the Inspector; the Scenes row right-click already had Fill and the fill / bridge
  Accept and now also has Add effect (Knotting by the one rule, Unknotting, Spurt, More effects) and Stabilise.
- `f0b2a2c` Move 13 (paw-t8z): the tracker's script-shaping `pipe_*` params (protocol.js `isShapePipe`: smoothing,
  norm window, prominence, hold, RDP, output range, spacing, max speed, snap, carry gaps, camera detrend, cadence fill;
  not the gate, climax, sign or invert) left the tracker form for a closed Runs ▸ Adjust ▸ Strokes ▸ Advanced section.
  Same keys, same stored values (`paramsBy` of the panel tracker), same requests: they still apply at the next Track
  (↻). Adjust shows only while a run covers the shot, so before the first track they are not on screen.
- Move 12 (one spurt-proposals row) is **not done** (paw-t8z). There is no separate balls row: the balls → spurts
  suggestion and the cumshot bar already sit side by side in the Effects row's one suggestion strip, and cumshot
  detection already takes the balls pulses and the pulse groups as inputs. What is left to merge is the two proposal
  sets: cumshot proposals are scored and saved on the scene (`scene.cum`, all / strong only, place spurts, ↻, ×), balls
  peaks are worked out live from the run, unscored, with their own contraction / swelling switch. One place / one ×
  for both would change what a press places and what the project saves, a behaviour change, not a move. Filed as its
  own bead for the owner to decide (paw-w5s).
