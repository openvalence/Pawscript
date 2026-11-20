# Draft and Assist

Two tools that get a script from nothing to a reviewable first pass:

- **Draft** (`Ctrl+Shift+D`): one button runs the tracker over the whole video (scenes, tags, loops), builds a first plan, runs a base track over the whole frame and generates the stroke axis from the plan.
- **Assist** (`F6`): a queue of the decisions the pipeline cannot make itself. Each one is a key press over a couple of frames.

Positions: `pos 0` is deepest / fully in, `100` is out.

## Draft: the one-button pipeline

Menu: **Track > Advanced > Draft**. Needs a video open.

### Run it

1. Open the video.
2. Press `Ctrl+Shift+D`. The dialog opens and, on a fresh project, runs every step straight away.
3. If the project already has a plan or points on stroke, the dialog waits with a warning ("Replaces the current plan ... and regenerates its spans on stroke") and you click **Run all**.
4. When the last step finishes with questions waiting, the dialog closes and the Assist overlay opens.

Hide the dialog while it runs: **Hide**. The status bar chip shows progress. Reopen with **Track > Advanced > Draft > Show the steps**.

| Command | Key | What |
|---|---|---|
| `draft.run` | `Ctrl+Shift+D` | Open the dialog and run what is pending (a finished run is shown) |
| `draft.show` | — | Open the dialog without running |
| `draft.cancel` | — | Kill the running tracker job and stop Run all (also the **Cancel** button) |

### The steps

This is the **Rules** pipeline. When the director feature is present the dialog shows a **Pipeline: Rules / Director** switch (disabled while a step runs); switching resets the step list. In **Director** mode the list is: Probe and detect scenes, Describe scenes, Loop check, Camera and motion survey, Director: story, Director: regions, Director: compare trackers, Director: direction and depth, Generate, Director: verify, Hand-off to assist, Review, and **Run all** runs `director.run` instead. The table below is the Rules list.

| # | Step | What it does | Writes |
|---|---|---|---|
| 1 | Probe and detect scenes | Tracker probe + scene detection | `doc.scenes` |
| 2 | Describe scenes | Tagger per scene (needs the `describe` extra and a CUDA GPU; skipped with a note otherwise) | `describe` on each scene |
| 3 | Loop check | Loop detector per scene; a new exact loop (`period_ms > 0`, `cycles >= 2`) also becomes a loop region, one cycle long at the scene start, unless one overlaps already | `loop` on each scene, `doc.loops` |
| 4 | First plan | Scenes become plan segments by the rule table below (or from a director timeline JSON, see **Timeline...**) | `doc.plan` |
| 5 | Base tracking (no region) | A tracker that needs no user region: one with ROI `none` if the tracker offers it, else `lk_box` (or any box tracker) on the whole frame. Runs over the full duration with the plan's spans; tagged `draft`. A redo removes the run this dialog made before | a tracker ghost |
| 6 | Generate | `generate(app, 'all')` on the stroke axis (switches the active axis to stroke if needed); locked segments are left alone | stroke axis |
| 7 | Hand-off to assist | Selects the base track run, regenerates the Assist queue, reports open questions and estimated gain (run on its own with questions waiting, it opens the overlay) | — |
| 8 | Review | Switches to the Review tab, shows the Problems panel (and Compare when it is docked apart), turns the machine preview on if a kinematic profile exists | — |

Every step that changes the document does it as **one undo entry** at its end. Cancel or failure part-way leaves the document as it was, except describe / loops, which keep the scenes already finished.

Per step: **Run** / **Redo** runs that step alone; **Skip** marks it skipped (Run all leaves user skips alone). The **Describe scenes** switch turns step 2 off for Run all.

A redone step outdates the done steps after it ("out of date: an earlier step changed"). **Run the rest** then runs from the first stale step. Undoing a step's entry with `Ctrl+Z` marks it "undone" in the dialog; Run the rest redoes it.

### What the first plan contains

With describe on, each scene's tags pick a kind. First match wins:

| Tags found | Kind |
|---|---|
| `knotting`, `anal_knotting`, `vaginal_knotting`, `oral_knotting` | `knotting` |
| `oral`, `oral_penetration`, `fellatio`, `deep_throat`, `irrumatio`, `cunnilingus`, `rimming`, `ball_lick`, `penis_lick` | `oral` |
| `sex`, `penetration`, `anal`, `anal_penetration`, `vaginal`, `vaginal_penetration`, `double_penetration`, `spitroast`, `dildo_insertion`, `sex_toy_insertion`, `thrusting`, `fisting`, `humping` | `penetration` |
| `handjob`, `footjob`, `tailjob`, `titfuck`, `thigh_sex`, `masturbation`, `fingering`, `anal_fingering`, `vaginal_fingering` | `custom`, named after the tag |
| `kissing`, `licking`, `grinding`, `frottage`, `tribadism` | `foreplay` |
| no act tag, rating not explicit, someone in frame | `foreplay` |
| any other act tag (any rating) | `custom`, named after the first tag |
| no act tag, rating explicit, someone in frame (count known) | `custom`, named "unlabelled" |

An explicit scene with nobody in frame gets no kind from the tags and falls through to the quiet / motion rules below.

Scenes with no kind: a quiet scene (describe saw nobody and no species, or the loop result says `static`) at the head or tail of the video becomes `idle`, a quiet scene inside becomes `offscreen` (carry); anything else becomes `penetration` (plain tracked strokes). Touching segments of the same kind merge. `climax` and `orgasm` are never chosen automatically.

Each segment gets its kind's default recipe (`src/lib/gen/recipes.js` KINDS): `idle` -> hold, `foreplay` -> smooth-small, `oral` -> oral, `penetration` -> penetration, `knotting` -> knot-pop-stroke, `offscreen` -> carry, `custom` -> strokes.

Describe not installed or failing: the step is skipped and the plan degrades to motion-only kinds. Everything else still runs.

### Correct the draft

- Wrong kind on a segment: edit it in the plan lane, then **Redo** step 6 (Generate). Steps 7 and 8 rerun on **Run the rest**.
- Wrong scene cuts: fix the scenes lane, then **Redo** from step 4 (First plan) on.
- Bad base track: paint the part and track it by hand (`Ctrl+T`, Track ROI, on the range), or let Assist's track check send you there.
- Start over: **Run all again** (only reruns what is not a user skip). Each step is its own undo entry, so `Ctrl+Z` walks back one step at a time.
- Use a plan you already have as JSON: **Timeline...** on the plan step picks a director timeline / spans JSON; the plan step imports it instead of the rule table. The chip's **x** goes back to the rule table.

The dialog state (pipeline, steps, describe switch, timeline, base run id) is saved in the project as the `draft` block. A run interrupted by closing the app shows "Interrupted" and is idle again.

## Assist: one-key questions

Menu: **Track > Direction and anchors > Assist: answer the open questions** (`F6`). Docked panel in the Track and Review tabs; status bar chip "N questions".

| Command | Key | What |
|---|---|---|
| `assist.open` | `F6` | Open / close the overlay. The panel's **Start** only opens it (grayed out with no open questions) |
| `assist.regenerate` | — | Rebuild the queue from the document (the panel's **Regenerate**) |
| `assist.reapply` | — | Invert every span on the active axis that disagrees with a recorded direction answer |
| `assist.orientGhosts` | — | Same, on every tracker ghost |
| `assist.clearDecisions` | — | Forget the recorded answers (asks first; the script keeps its edits) |

Questions are built from the active axis's script, the scenes (with no scenes lane: the selected run's scenes, else script stretches split at gaps of 4 s or more), the tracker runs and their events, and the plan. They are ordered by expected gain, highest first: a direction question is worth `0.12` x its span's share of strokes, track `0.05` x the scene's share of strokes, activity `0.03` x `min(1, 4 x span length / scripted length)`, depth `0.01` x the span's share of strokes.

The panel shows an **out of date** badge when the script changed by something other than an answer (a tracked run playing live, a Bake, hand edits). Click **Regenerate**.

### In the overlay

The overlay is full-window. Its keys win over everything else; keys that would edit behind it (digits `0`, `5`–`9`, `Delete`, `Q`, `I`, `O`, `L`, `T`, `F`, `G`, `Space`, `,`, `.`, `Ctrl+X`, `Ctrl+V` ...) do nothing while it is open. `Ctrl+Z` / `Ctrl+Y` and save still work.

| Key | Everywhere in the overlay |
|---|---|
| `Enter` | Confirm the suggested answer (when one is shown) |
| `Backspace` | Take back the last answer and its edit, go back to that question |
| `ArrowUp` / `PageUp` | Previous question |
| `PageDown` | Next question |
| `Escape` | Leave (cancels split mode first) |

Every answer that edits the script is one undo entry, with an **Undo** toast. `Ctrl+Z` anywhere undoes it; the question counts as open again until redo.

### Direction: "Which frame is deeper?"

One per scene (or script stretch). Shows two frames: consecutive extremes of the script, never across a scene edge, plan segment edge or tracker event span. The two frames are the script's deepest and shallowest moment of one stroke.

| Key | Answer |
|---|---|
| `ArrowLeft` / `1` | Left frame is deeper |
| `ArrowRight` / `2` | Right frame is deeper |
| `ArrowDown` | Can't tell (skip) |
| `S` | The direction changes inside this span (split mode) |
| `Tab` / `Shift+Tab` | Another pair of frames from the same span (up to 5) |
| `Z` | Toggle zoom to the tracker's region |

Result: if the script already agrees, nothing changes ("was already right"). If it disagrees, the whole span `[t0, t1)` is inverted (`pos -> 100 - pos`). The answer is stored as a fact ("the frame at `deep` is deeper than the one at `shallow`"), so it holds for any later track: a new run whose script agrees is not asked again; one that disagrees is asked with your earlier answer as the suggestion.

**Suggestions.** Learned from the answers given since the queue was last built (recorded answers from before do not count). From the first one on, a scene whose thumbnail looks like an answered one (distance `8` or less) pre-fills that scene's answer. Otherwise a cue (the tracker's sign per scene, correlation with a second run, stroke asymmetry) pre-fills it once that cue was non-zero on 3 or more answered scenes and matched the flip / no-flip outcome, in one polarity or the other, on at least 80 % of those. The suggested frame is marked and `Enter` confirms it. Nothing is applied without a key.

**Split mode** (`S`). The candidates are the moments the script calls deepest in the span. Step to the first one that is *not* deep and press `Enter` (or `S`): the span is cut right before it and both halves get their own direction question. A "possible change at ..." hint means a second run's correlation flipped sign there; the queue has already cut the scene at that point into two direction questions, each showing the hint, so you do not need `S` for it. Pressing `S` on one of those halves starts split mode at the candidate nearest that point, which is at the half's own edge; with no hint it starts mid-span.

| Key in split mode | What |
|---|---|
| `ArrowLeft` / `ArrowRight` | Previous / next candidate |
| `Shift+ArrowLeft` / `Shift+ArrowRight` | 5 at a time |
| `Home` / `End` | First / last |
| `Enter` / `S` | Split here |
| `Escape` / `Backspace` | Cancel the split |

### Track check: "Is the highlighted region the thing that moves in and out?"

One per scene that a run with stored overlays covers (the run that covers it most; scenes with fewer than 2 strokes are not asked). Four frames from the covered part, with that run's overlay drawn.

| Key | Answer |
|---|---|
| `Y` | Yes, right thing |
| `N` | No, wrong thing: a **fallback** question follows |
| `ArrowDown` | Can't tell |

Fallback (after `N`):

| Key | Answer |
|---|---|
| `Y` | Use the other run here (only offered when a second run with points exists); its actions replace the span |
| `R` | Re-track: the overlay closes, the range is set to the span, the Track tab opens at its start. Paint the part with Groups (`Tab`) and press `Ctrl+T` (Track ROI) |
| `N` | Keep as is |

A `Y`/`N` is recorded per run and span; the same run is not asked again there.

### Activity: "Is the action continuing here?"

One per tracker event span (`still`, `carry`, `idle`) and per long gap in the script (a turn-to-turn interval over `max(1500 ms, 3 x the local interval)`) that no event covers. Spans already planned as `idle`, `offscreen`, `climax` or `orgasm` are not asked. Shows the span looping muted (2x when longer than 8 s) plus a 6-frame filmstrip. A dashed `Assist: if the action continues` ghost on the lane previews what `Y` would generate.

| Key | Answer | Writes |
|---|---|---|
| `Y` | Yes, keep the rhythm | an `offscreen` segment (recipe `carry`); `lo` / `hi` from the median bottoms / tops within 10 s either side (`hi` at least `lo + 10`) |
| `N` | No, it stops | an `idle` segment (recipe `hold`) at the position the script had at the span start (`pos`, default 100) |
| `C` | Orgasm (cum) | an `orgasm` segment (recipe `orgasm`: deep tremor + pulses) |
| `ArrowDown` | Skip | — |

The segment is generated into the span and recorded in the plan (segments partly inside are trimmed, wholly inside dropped). One undo entry covers both the script and the plan. Speed limit for the generated moves: setting `gen.maxSpeed`, default `450`.

### Depth: "How deep does this scene go?"

Lowest priority; one per direction span with 6 or more strokes. Shows the deepest frame the script has in the span right now. Turn these off with the setting `assist.depth` (default `true`).

| Key | Preset | Span remapped to |
|---|---|---|
| `1` | All the way | 0–100 |
| `2` | Deep | 0–70 |
| `3` | Halfway | 30–90 |
| `4` | Shallow | 60–100 |
| `ArrowDown` | Skip | — |

A preset the span already fits makes no edit.

### Correct an answer

- Right after: `Backspace` in the overlay. If other edits came after that answer, a toast tells you to undo from History instead.
- Later: `Ctrl+Z` on its entry (every answer is labeled `Assist: ...` in History). The question is open again until redone.
- A wrong direction fact that keeps coming back as a suggestion, or wrong per-scene answers in general: **Track > Direction and anchors > Assist: forget recorded answers**, then Regenerate. The script keeps its edits.
- You re-tracked and the new script is flipped in places you already answered: **Track > Direction and anchors > Assist: apply recorded directions to the active axis** inverts every span that disagrees, as one undo entry. **Orient tracker ghosts by recorded directions** does the same on the ghosts (not undoable; ghosts are overlays).

### Where answers live

The project's `assist` block: `{v:1, direction:[{t0,t1,deep,shallow}], splits:[ms], track:[{t0,t1,ghost,ok}], activity:[{t0,t1,state}], depth:[{t0,t1,preset}]}`. Written whenever an answer, undo or redo changes what stands; it marks the project dirty. A new video, another axis, a new run or a changed scene count rebuilds the queue, keeping the recorded answers. Another document gets its own queue from its own block.
