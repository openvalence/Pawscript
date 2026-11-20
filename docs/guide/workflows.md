# Workflows

End-to-end recipes. Each one names the keys and commands it uses; every command is also in the palette (`Ctrl+K`) and the top-bar menus, and `?` shows which command a key runs in the current context.

Basics that every recipe assumes:

- Position: **pos 0 = deepest / fully in, 100 = out**. The point keys follow that: NumPad `0` places 0 (in); in the OFS keymap `0` and `Shift+0` (100, out) on the number row too.
- Four tabs, the stages of the job: `Ctrl+1` Scenes (scenes, cuts, shots, loops), `Ctrl+2` Track, `Ctrl+3` Refine (hand editing), `Ctrl+4` Review. Most tracker keys only work in the Track tab.
- A range is set with `I` (in) and `O` (out) at the playhead; `Esc` clears the selection, then the range. Transforms act on the selection, else on the range.
- `Ctrl+Z` / `Ctrl+Y` undo / redo. Every recipe step below is one undo entry.
- The project writes itself. `Ctrl+S` commits (a named point to come back to); `Ctrl+Alt+S` publishes the `.funscript` beside the video.
- A tracked shot plays its run at once (live): there is no Accept. `Shift+B` bakes a shot's points for good; a hand edit bakes the shot it touches.

## 1. Script a short loop

A clip that repeats one cycle (a looping animation). Script one cycle by hand, tile it across the rest.

1. Open the video (`Ctrl+O`). Find the start of one full cycle with `←` / `→` (one frame) and `Shift+←` / `Shift+→` (1 s).
2. Press `L` at the cycle start, play or step to the end of the cycle, press `L` again. The second `L` creates the loop and starts loop playback; `Shift+L` stops it. The toast shows the length in frames.
   - If a scene has a loop result (from the draft's Loop check step or the Actions panel's Loop button; Detect scenes alone gives none), the loops lane shows its detected period as an outline; clicking it makes the loop, and `loops.useDetected` snaps an existing loop to it.
3. Script the cycle inside the loop with the point keys (NumPad digits; the number row too in the OFS keymap, setting `keys.preset`). Step with `→`, press a digit at each extreme: `0` deep, `9` near out, `5` mid (OFS: `Shift+0` out, `Shift+1`..`Shift+9` for 15..95). Points placed from the keyboard stay selected but `←` / `→` keep stepping frames ("step, key, step, key").
   - `Insert` adds a point on the current line at the playhead; `Q` repeats the last full stroke at the playhead.
   - `N` toggles frame snapping (default on). `Shift+W` / `W` jump to the previous / next point (OFS keymap: `,` / `.`).
4. Make the join close: the loop's last point should land where the first one starts. Select a point and nudge it with `↑` / `↓` (±5) or `Shift+↑` / `Shift+↓` (±1).
5. Tile: `Ctrl+L` (`loops.tile`). The target end is the range end if a range is set, else the end of the scene, else a dialog asks (4 more cycles, 16 more cycles, up to the next loop / to the end). A warning toast reports a seam that jumps; its "Close join" action sets the join option to `meet`.
6. Edit later: changing any point of the source cycle makes the tiles stale. `Ctrl+Shift+L` re-tiles the selected loop if it is stale, otherwise every stale loop, in one undo entry.

Loop keys (the ones with lane focus need the loops lane focused: click it or arrive with `Ctrl+Alt+L`):

| Key | Command | Does |
|---|---|---|
| `L`, `L` | `loop.mark` | mark in, then out; the second press starts loop playback |
| `Shift+L` | `loop.playToggle` | loop playback on / off (the loop under the playhead, else the range) |
| `Ctrl+L` | `loops.tile` | tile the loop across the range / scene |
| `Ctrl+Shift+L` | `loops.retile` | re-tile the selected loop if it is stale, else every stale loop |
| `Ctrl+Alt+L` / `Ctrl+Alt+Shift+L` | `loops.next` / `loops.prev` | go to the next / previous loop and focus the lane |
| `Enter` (lane focus) | `loops.open` | loop options: join `keep` / `meet`, variation |
| `Alt+←` / `Alt+→` (lane focus) | `loops.outMinus` / `loops.outPlus` | loop out ±1 frame |
| `Alt+Shift+←` / `Alt+Shift+→` (lane focus) | `loops.inMinus` / `loops.inPlus` | loop in ±1 frame |
| `Delete` (lane focus) | `loops.delete` | delete the loop (its tiles stay in the script) |
| — | `loops.removeTiles` | remove the tiles, keep the loop |
| — | `loops.snap` | snap the loop edges to frames |

Tiles are speed-capped with the active device profile's maximum (see recipe 4).

## 2. Script a long multi-scene video

Scenes, a plan, a base track, a generated draft, then corrections. The draft dialog runs the automatic part.

### Draft

1. Open the video, `Ctrl+Shift+D` (`draft.run`). The dialog lists the steps and runs what is pending:

| Step | What it does |
|---|---|
| Probe and detect scenes | tracker cut detection fills `scenes` (one undo entry) |
| Describe scenes | the shot tagger (needs the `describe` extra installed); skipped otherwise |
| Loop check | per-scene period detection |
| First plan | one plan segment per scene from the describe tags: knotting / oral / penetration / foreplay / custom; scenes with no tags and no motion become idle (head / tail) or off-screen (inside); everything else is penetration. Climax is never chosen automatically. |
| Base tracking (no region) | `lk_box` on the whole frame, so the generators have stroke timing to follow |
| Generate | switches the active axis to `stroke` and compiles the plan into points there |
| Hand-off to assist | builds the question queue (`F6`) |
| Review | the problem check with the active device profile |

   A first run over an existing plan or points waits for "Run all" under a "Replaces ..." warning. `draft.cancel` stops a running step; `draft.show` reopens the dialog. Touching an earlier step marks the later ones stale.

2. Commit (`Ctrl+S`) to name this point; Publish (`Ctrl+Alt+S`) when the script is ready for players.

### Corrections

Fix scene cuts first, then the plan, then direction, then the points.

**Scene cuts** (`Alt+Shift+S` selects the scene at the playhead as the range, `Alt+Shift+K` splits a scene at the playhead, `Alt+Shift+M` merges a scene with the next, Shift+click selects several scenes and `Alt+Shift+J` merges every scene in the range). `Shift+PgUp` / `Shift+PgDn` jump between cuts.

**Cutaways (the action goes on behind them).** A cut away from the action gives three scenes: action, wide (or reaction) shot, action again. Right-click the second action scene, **Continues previous action**: the scene before it becomes Off-screen and the two action scenes are one action (a bracket in the first scene's color over the scenes row, the cutaway hatched; the hover text says which scene continues which). Shift+click several scenes, right-click, **Mark scenes a–b as one action with cutaways**: the first and last are the action, everything between is cutaway. After Detect scenes (and after any cut edit) the first and last frame of every scene are compared as 16×16 gray thumbnails; where the action scene before and after a cutaway look alike and the cutaway looks like neither, the relation is proposed (dashed bracket, "proposed from the pictures"). A proposal is not saved and changes nothing until you act on it; untick it to say no, which is remembered. Needs WebCodecs (MP4/MOV, or a remux); without it, set them by hand. An **internal view** (x-ray / cross-section; from the describe tags `internal*`, `x-ray`, `cross_section`, `cutaway_view`, or the **Internal** tag in the scene's right-click menu, the quick bar or Alt+Shift+I) is not a cutaway: it is drawn with an inset outline in its act's color, a run of them between two scenes of the same act is proposed as one action with the internal scenes as tracked members (never made Off-screen, no bridge), and the picture comparison never turns one into a cutaway. A **camera move** inside one shot is not a cutaway either: Detect scenes splits the shot where the camera starts and stops panning, zooming, orbiting or shaking, and the pieces after the first are marked as continuing the same action (a dashed cut on the scenes row; the hover text says "same shot, camera move"): no bracket, no bridge, Track runs straight through it (the tracker is not re-seeded there) and the stitch carries the level across. A camera that only bobs with the stroke never splits. Tag a scene **Off-screen** yourself (the act goes on, unseen) and the scene after it is proposed as continuing the action across it, whatever the pictures say; it keeps its acts (off-screen but anal), is drawn dimmed and hatched, gets no tracker default and is bridged like any cutaway. A **Blank** scene (Detect scenes: a black or white screen and its fades; view tag, one of Internal / Off-screen / Blank, yours to change) can be a cutaway too: between two scenes of the same act, or where the pictures say so, the scene after it is proposed as continuing the action, but the blank is never made Off-screen and its bridge **holds** instead of carrying strokes: the viewer sees nothing, so the ghost eases to the level before the blank, stays there and eases into the first point after it. A blank that is not a cutaway gets the same hold. Track tagged scenes skips blanks (*blank: hold*).

**Intro, idle, after, outro (structure).** A fifth tag group says where a scene with nothing happening sits in the story, at most one per scene, in the old plan kinds' colors: **intro** (blue: titles, establishing shot before the first act), **idle** (gray: talking, posing), **after** (violet: cuddling, panting, lying there after the orgasm) and **outro** (gray: credits, end card). They fill themselves: the quiet scenes before the first scene with an act are intro (a still from Detect scenes, or a scene describe saw no act in; a blank among them stays only blank; a scene not described yet stops the run); behind the last act, a still or a scene with nobody in frame is outro and a quiet scene with bodies is after (outro when the video has no sex act at all). Idle is never detected: you set it. Change them like any tag (the quick bar's Structure chips, the right-click menu, `timeline.scene.tag.intro` / `idle` / `after` / `outro`). They are never tracked (*intro: nothing to track, generated*); instead the lanes show a generated ghost in the same **Bridges and holds** ghost as the bridges: intro holds at rest (pos 100, the old idle recipe) and eases into the first point of the next scene, idle holds at rest, outro eases from the last point to rest and holds, after plays the old afterglow recipe (slow, shallow strokes easing out over up to 30 s) and holds where it ends. They play live where the scene has no baked points; right-click the scene, **Bake**, to make them permanent (one undo step, never needed).

**Scene tags.** A scene carries tags in four groups plus the camera, several at once, composed the way e621 composes acts: **view** (Internal or Off-screen, at most one; none = visible), **where** = the receiving part (anal, vaginal, oral; double penetration = anal + vaginal), **what** = the action (penetration, **insertion**, tonguefucking, licking, fisting, toy, **tail penetration** (a tail is the penetrating part: no penis, so no shaft reading; the fused stroke follows the Top's tail against the Bottom's hips, or one's own tail in oneself), fingering, grinding, handjob, masturbation, **tailjob** (a tail on a penis, a partner's or its own: can be solo; the fused stroke follows the tail against the penis), footjob, titfuck, kissing, **facesitting** (one character sits on the other's face, either one sitting; oral family; there is no stroke axis: the fused stroke follows the sitter's hips against the head in whichever direction they rock, sideways included), **dancing** (can be solo; the fused stroke follows the hips against the frame); handjob … dancing usually have no where; **exposed** = dick out, no act: an erect penis on screen with nothing happening, intros, idling, a throbbing erection, in a muted vermilion) and **modifiers** on top (knotting, throbbing, orgasm). With View › Furry items off, tail penetration, tailjob and the slit and sheath tags are not offered (a scene that has one keeps it). Describe fills them from the e621 tags: anal_penetration → anal + penetration, anal_fingering → anal + fingering, rimming → anal + licking, cunnilingus → vaginal + licking, fellatio / irrumatio / deep_throat / oral_penetration → oral + penetration, tongue_in_ass / tongue_in_pussy → anal / vaginal + tonguefucking, tongue_in_mouth / french_kiss → kissing, vaginal_fisting → vaginal + fisting, anal_dildo → anal + toy, tail_in_ass / tail_in_vagina / tail_insertion → (anal / vaginal +) tail penetration (never also penetration: e621 implies anal_penetration on them), tailjob / tail_around_penis → tailjob, facesitting / butt_smother → facesitting, double_penetration → anal + vaginal + penetration; the bare e621 `anal` / `vaginal` / `oral` give the where only when nothing specific gave one, `sex` / `penetration` / `thrusting` give penetration only when nothing specific gave a what (so a rimming or fingering shot never also reads as anal penetration); `erection`, `penis`, `genitals`, `exposed_*`, `presenting`, `presenting_penis`, `knot` (the body part) and `erect_*` give **exposed** only when no other what hit at all (so a penetration scene never gets exposed too). Exposed is no act: an exposed opening is still an intro, and it composes with idle / intro and with throbbing, but Track tagged scenes tracks it (a points tracker on the whole-frame grid, so the seeded penis / balls groups give the throb signal), Autorange rests it at 85–100, and the quick bar shows **+ Throb** on it (adding the throb sets the throbbing tag). Throbbing is never detected: you set it, on any scene, with or without an act. **Insertion** is never detected either (the tagger has no name for it): set it on a cut where you see it go in, usually slowly, with no stroking. Track tagged scenes skips it (reason "insertion: one push, generated": a tracker has no timing for one slow push), and the scene gets ONE generated push instead (the lime *Bridges and holds* ghost, playing live; right-click **Bake** keeps it): from wherever the script is when the scene starts (100 if nothing comes before) eased down to depth 10, slow start, steady, settle, arriving at 90 % of the span and held there to its end, so the next penetration scene starts deep. It is never stroke-shaped, gated or reshaped (Autorange gives it no band, no gap fill, no tease; the next scene carries on the same run). **+ Insertion** on the quick bar opens its curve (an Insertion effect over the tag's span, added if there is none): drag the start, the depth it ends at, how much of the span the push takes, where it arrives and the two eases; drag the end above the start and it is a slow pull-out. With **knotting** on too, the scene is one knot going in instead (Knotting in *One knot*: push, pop, settle, the tie), never a push and a knot on top of each other: + Insertion opens that knot, and a Knotting effect over an Insertion effect wins. **Camera** (at most one) comes from Detect scenes (the camera kind covering most of the scene): **static**, **rides the stroke** (the camera bobs with the stroke: its path carries the stroke, no camera removal, `cam x` / `cam y` are stroke candidates), **pan** (tilts too), **zoom**, **turntable** (the camera orbits the action: camera removal off, rolling stroke axis) and **handheld**; pan / zoom / turntable / handheld draw a small glyph at the scene's left end, and the tag picks a scene's default signal (see the tracking guide). Click a chip in the quick bar's Camera group, the right-click menu or `timeline.scene.tag.<id>` to set it yourself; your pick replaces the detected one and survives a re-detect. **Aliases** are words for a where + what: rimming (analingus) = anal + licking, cunnilingus = vaginal + licking, fellatio (blowjob) = oral + penetration, double penetration = anal + vaginal + penetration. They are not stored: picking one toggles its parts, and when all its parts are on the label and the chip say the word (one chip; click removes its parts, keeping a part another alias still uses). **Implications:** turning knotting on turns penetration on; turning penetration off turns knotting off (a toast says so). Knotting, insertion, fisting, fingering, toy, tail penetration and tonguefucking need a where: with none, the quick bar's where chips are outlined with *pick where* (never set for you; the best where is dashed as a suggestion). A where with no what offers up to three dashed *what?* chips ranked by the tagger's confidence, then this project's other scenes, then penetration / fingering / licking / toy (tracking guide, "Scene quick bar"). **Time inside a scene:** a where / what / modifier tag covers the whole scene unless you move its start or end (right-click its chip, or point at the chip and run *Tag starts at playhead* / *Tag ends at playhead*): frotting, then penetration from here, the knot in from here, throbbing over this stretch. Such a tag draws as a thin band under the scene (a modifier: a line with its marker at its start; three rows, then +n), and **+ Knotting effect** adds the effect over the knotting span at the playhead (else the range, else the scene). Edit the tags on the quick bar chips, the right-click menu or the `timeline.scene.tag.<id>` commands. Your changes are stored as a diff over the describe (`tags: ['knotting', '-anal', {id: 'penetration', t0: 41200}]`), so a tag you removed stays removed after a re-describe; **Reset to describe** in the right-click menu drops them. The scenes row draws the act as words ("anal penetration", "rimming"; the what's color, penetration taking oral green or the yellow of anal / vaginal; underlined = changed by hand), a knot / diamond / drop marker per whole-scene modifier at the scene's right end, the internal outline and the off-screen hatch. Projects from before tags open with their kind / sub / internal-view overrides turned into tags, and old tag ids (`sex`, `rimming`) into their new parts.

While a cutaway has no linked run and no points of the active axis, the lanes show a dashed **Bridges and holds** ghost there: `follow` strokes carried at the rate of the turns within 10 s on both sides, depth = their median top / bottom, timed so they land on the first stroke after the cutaway. It follows the neighbors' points (the script in those scenes) and plays live where the cutaway has no baked points. Right-click the cutaway, **Bake**, or **Bake** on the quick bar, to make it permanent (one undo step).

**Fill a scene from its neighbors.** Often the action in a scene goes on from the scene before, or leads into the scene after, and tracking it is not worth it. Select the scene (Shift+click for several: they fill as one span) and on the quick bar's **Fill** group click **← before**, **both** or **after →** (the same items are in the scene's right-click menu, and the commands `timeline.scene.fill.before` / `after` / `both` / `timing` / `off` are in Shortcuts and the palette, unbound: they act on the selected shots, else on the scene at the playhead). **One cut, not the whole scene:** select one or more shots of a multi-shot scene in the Shots strip; the right-click menu then also has **Fill this shot** / **Fill N shots**, and the Shot chip's popover a **Fill shot** row, with the same choices: only those shots are filled (and not tracked), the rest of the scene stays as it is. Their sides are the shots before and after them in time, in the same scene or the next one; a filled shot shows "fill ↔" after its number in the Shots strip. The lime **Bridges and holds** ghost shows the fill at once over the scene, read live from the script around it (the active axis's points in the neighboring scene, else its linked run, else a visible run ghost covering it; the turns within 10 s of the scene):
- **← before**: the strokes of the scene before go on through this one at its rate and depth, in phase with its last stroke.
- **after →**: the strokes of the scene after run backward from its first stroke, at its rate and depth, so the fill arrives in phase on it.
- **both**: from the last stroke before to the first stroke after; the rate and the depth change smoothly from the one side's to the other's across the span, and it lands in phase on the stroke after.

A side needs at least three turns; when it has fewer (or there is no scene there) the quick bar says so in plain words (*Cannot fill: scene 4 has too few strokes*) and no ghost is drawn. The fill plays at once (live) where the scene has no baked points; **Bake** on the quick bar (or right-click, **Bake**) makes it permanent, one undo step. A scene with baked points keeps them: Unbake it first to let the fill play. The fill stays on the scene (saved in the project, undoable; the scenes row shows *fill ←* / *fill →* / *fill ↔*), and Track tagged scenes and a manual Track skip it (*filled from before*). Click the same Fill button again (or **No fill**) to make it trackable again. A fill wins over a bridge, hold or generated ghost on the same scene.

**Plan.** The plan lane only takes digits, `Delete`, `Enter`, `S`, `Shift+M`, `Ctrl+D`, `Ctrl+A` and `Esc` while it has keyboard focus (it shows a focus ring and a "PLAN · KEYS" tag); `P`, `Shift+N`, `Alt+PgUp` / `Alt+PgDn` work from anywhere and focus it.

| Key | Command | Does |
|---|---|---|
| `P` | `timeline.plan.selectAtPlayhead` | select the segment under the playhead |
| `Alt+PgDn` / `Alt+PgUp` | `timeline.plan.next` / `.prev` | next / previous segment (seeks to it) |
| `1`..`9`, `0` | `timeline.plan.kind.*` | set the kind: 1 fade-in, 2 foreplay, 3 oral, 4 penetration, 5 knotting, 6 climax (fast run-in), 7 orgasm, 8 afterglow, 9 off-screen, 0 idle |
| `S` | `timeline.plan.split` | split at the playhead |
| `Shift+M` | `timeline.plan.merge` | merge the selected neighbors |
| `Shift+N` | `timeline.plan.add` | add a segment at the playhead (the range, else the gap between cuts) |
| `Enter` | `timeline.plan.edit` | the segment inspector: name, recipe, parameters, lock |
| `Ctrl+Alt+I` | `timeline.plan.inspect` | the plan inspector |
| `Alt+Shift+L` | `timeline.plan.lock` | lock / unlock: locked segments are never regenerated |
| `Ctrl+Shift+G` | `timeline.plan.generate` | generate new and stale segments (or the selection when the lane is focused) |
| `Ctrl+Alt+G` | `timeline.plan.generateAll` | generate the whole plan |
| — | `timeline.plan.detach` | keep the points, forget the segment |
| `Ctrl+Alt+P` | `timeline.plan.preview` | plan preview ghost on / off |

The finale is three segments, in this order: `climax` (the fast full strokes, about 6.5 s), `orgasm` (the deep tremor and pulses, about 24 s), `afterglow` (about 30 s); the director's story step lays them out that way from the orgasm window it finds.

Each kind has a default recipe (`idle` hold, `fade-in` fade-in, `foreplay` smooth-small, `oral` oral (follow), `penetration` penetration (follow), `knotting` knot-pop-stroke, `climax` climax (the fast run-in), `orgasm` orgasm (tremor + pulses), `afterglow` afterglow, `outro` hold, `offscreen` carry, `custom` strokes). Segment parameters are sparse overrides of the recipe; a segment is `new`, `fresh`, `stale` (edited since it was generated) or `locked`. Generate only touches new and stale segments unless you ask for all.

**Direction and the assist queue.** The tracker cannot tell in from out. `F6` (`assist.open`) runs the question queue the draft built, best gain first; answer with one key each:

| Question | Keys |
|---|---|
| direction (two frames) | `←` / `1` left is deeper, `→` / `2` right is deeper, `↓` can't tell, `S` the direction changes inside (then `←` / `→` step, `Enter` split) |
| track (4 frames with the run's overlay) | `Y` / `N` / `↓`; after `N`: `Y` use the other run, `R` re-track (paint the part, Track ROI), `N` keep |
| activity (a muted loop) | `Y` carry the rhythm, `N` idle, `C` orgasm, `↓` |
| depth | `1`..`4` presets, `↓` |

`Enter` takes the suggestion, `Backspace` takes back the last answer and its edit, `Esc` leaves. Answers are remembered in the project; `assist.regenerate` rebuilds the queue after you change the script, `assist.reapply` ("apply recorded directions to the active axis") flips every span of the active axis that disagrees with a remembered direction answer; track, activity and depth answers are not reapplied.

Direction can also be flipped by hand in the Track tab: `F` (`track.flipAtPlayhead`) flips the selected run's scene at the playhead, `track.flipRun` the whole run.

**Weak scenes.** Where the whole-frame base track is poor, re-track that scene with a region and an axis (recipe 5) (its run plays there at once); then `Ctrl+Shift+G` regenerates the segments over it, because their timing comes from the run that covers them.

**Points.** Everything from recipe 1 applies. Transforms on the selection or range: `Shift+I` invert, `Shift+S` simplify (tolerance 2), `Ctrl+↑` / `Ctrl+↓` scale amplitude ×1.1, `Ctrl+Shift+→` / `Ctrl+Shift+←` stretch / compress in time ×1.1. `Alt+T` opens the transform tools with parameters; `Alt+R` repeats the last one.

**Review.** `Ctrl+4`, then recipe 4.

## 3. A knot scene

Three knot recipes exist (`knot-pop-stroke`, `knot-pop-held`, `knot-tied`) over two generators. The `knotting` kind only picks the default; the segment inspector lists every recipe for any kind.

- `knot-pop-stroke` "Knot on every stroke" (the kind's default): every stroke passes the knot. From full depth a slow pull against the knot to `knotOut`, a near-instant pop out to `popTo`, up to the top, back down to the knot (`knotIn`), a slow press to `press`, and a near-instant pop in. The pops may exceed the device speed cap up to `popSpeed`.
- `knot-pop-held` "Knot pop (held back)": shallow bumps held at `knotLevel`, then every `between` bumps a press, a resisted push through to full depth, a dwell with grind, a resisted pull and a pop out. `knot-tied` is the same with `tied: true` (after `popsBeforeTie` pops it stays deep, small motion for the rest of the segment).

Steps:

1. Set the range to the scene (`Alt+Shift+S` on the scene, or `I` / `O`).
2. Track it with a region on the moving part and a drawn axis (recipe 5). Without a run the recipe uses its `rate` instead of the footage.
3. `Shift+N` adds a plan segment over the range (or `P` selects the draft's), `5` sets the kind to knotting.
4. `Enter` opens the segment: pick the recipe and adjust. Parameters worth touching:

| Param | Default | Meaning |
|---|---|---|
| `knot-pop-stroke` `lo` / `hi` | 0 / 80 | full depth / top of the stroke |
| `knotOut` | 17 | where the knot catches on the way out |
| `popTo` | 64 | where the pop out lands |
| `knotIn` | 30 | where the knot catches on the way in |
| `press` | 20 | how far the press goes before the pop in |
| `popSpeed` | 600 pos/s | speed allowance for the pops (0 = the global cap) |
| `variation` | 1 | 0 = clean, 1 = as measured |
| `timing` | auto | `follow` the tracked run, `rate` (1.85 turns/s), `auto` = follow when a run covers the segment |
| `knot-pop-held` `knotLevel` | 30 | the held-back level |
| `between` | 4 | bumps between pops (3 for `knot-tied`) |
| `pressMs` / `pushMs` / `dwellMs` / `pullMs` / `popMs` | 160 / 650 / 450 / 260 / 140 ms | the phases of one pop |
| `grind` | 3 | motion at depth during the dwell |
| `tied`, `popsBeforeTie` | false, 2 | stays deep after that many pops (`knot-tied`: true, 1) |
| `tiedAmp`, `tiedRate` | 10, 2 turns/s | the tied motion |

5. `Ctrl+Shift+G` generates. `Ctrl+Alt+P` shows the preview ghost before you commit if you prefer to look first.
6. Review (`Ctrl+4`): the pops show as `speed-limit` findings on a hard-limit profile. Leave them, ignore the kind (`review.ignoreKind`), or lower `popSpeed`. The Nucleus Capstan profile keeps them as `speed-limit` but informational, with the message "The planner will reshape this: ...".

## 4. Fix an overspeed script for a device

The device profile tells the problem finder what the device can follow. It never changes a script by itself.

1. `Ctrl+4`, the Review tab. Pick the profile in the Device and heatmap panel, or cycle with `review.nextProfile`:

| Profile | maxSpeed (pos/s) | minIntervalMs | limits |
|---|---|---|---|
| Generic stroker (conservative) | 250 | 80 | hard |
| Generic stroker (fast) | 400 | 50 | hard |
| The Handy | 360 | 60 | hard |
| Kiiroo Keon | 300 | 80 | hard |
| Fleshlight Launch | 200 | 100 | hard |
| OSR2 / SR6 (DIY) | 330 | 60 | hard |
| Nucleus Capstan | 600 (derived: 1200 mm/s over 200 mm) | 20 | planner |

   Every named figure except the Capstan's v/a/j is marked unverified; edit the numbers or add your own profile in the panel (stored in settings `review.profiles`). The Capstan has a stroke-length slider (100–300 mm, default 200): maxSpeed follows it. Its `planner` limit mode makes `speed-limit`, `too-close` and `kinematic-limit` findings informational, because the device's planner reshapes them itself: `speed-limit` and `too-close` keep their kind names with a "The planner will reshape this: ..." message, `kinematic-limit` becomes `planner-reshaped`. None of them is an error; their fix is left out of fix-all and offered as an optional fix instead.

2. Walk the problems: `F8` next, `Shift+F8` previous. Kinds and their fix:

| Kind | Severity | Fix |
|---|---|---|
| `speed-limit` | warn; error above 1.5 × maxSpeed | `capSpeed` (pull positions toward the previous point, times kept) |
| `too-close` | warn | `thinMinGap` keeping the extremes |
| `kinematic-limit` | warn / error | `capSpeed` retime with ripple (profiles with kinematics) |
| `long-gap` | warn | none (a hole over 5 s inside an active section) |
| `redundant` | info | `simplify` tolerance 0 |
| `out-of-range` | warn | `limitRange` clamp to the profile's range |
| `jitter` | info | `removeMicroReversals` |
| `micro` | info | `cleanMicro` |
| `past-media` | error | `deletePoints` after the video end |
| `cut-sync` | info | none |

3. Fix:
   - `Ctrl+F8` (`review.fixProblem`) fixes the current one and selects the next.
   - `Ctrl+Shift+F8` (`review.fixAllOfKind`) fixes every problem of that kind on the scope's axes as one undo entry.
   - `review.limitSpeed` caps the whole active axis at the profile's maxSpeed (`capSpeed`, method pull).
   - `Alt+L` (`quick.limit`) is the inspector's quick version on the selection: `capSpeed` with maxSpeed 400 unless settings `device.maxSpeed` is set; `Alt+T` opens the tool to choose `method` `pull` / `retime` and `ripple`.
   - `Alt+F8` ignores one problem, `review.ignoreKind` a kind; `review.allAxes` toggles between the active axis and all axes.
4. Listen: `F9` plays from before the previous problem, `Shift+F9` loops around the current one, `Ctrl+F9` steps through problems while playing.
5. See what the device would do: `view.machinePreview` draws the kinematic preview ghost of the active axis under the active profile; `M` is the drawn simulator; `Ctrl+Alt+D` (`playback.toggle`) drives a real device in sync with the video (Device panel > Connect first, or a Valence hub: [Device playback](playback.md)), `Ctrl+Shift+Space` plays the selected points' span on it, `Shift+Esc` is the panic stop.
6. `Ctrl+E` exports the funscripts. A foreign `.funscript` is never overwritten without a first backup.

## 5. Tracking assisted with the axis tool

For one scene: the moving part painted, an arrow for the stroke direction, a run that plays in the lane at once.

1. `Ctrl+2`, the Track tab. Set the range: `Alt+Shift+S` on the scene, `track.rangeToScene`, or `I` / `O`. `Shift+R` zooms to it.
2. Pick the tracker in the Tracking panel (`track.listTrackers` reloads the list):

| Tracker | Region | Notes |
|---|---|---|
| `lk_box` Optical flow (box) | box | fast, no ML; no custom axis: gets the nearer of vertical / horizontal |
| `template` Template match (box) | box | as above |
| `lk_two_point` Optical flow (distance between 2 points) | 2 clicks | distance between two bodies |
| `cotracker_points` CoTracker3 points ([not included](cotracker.md)) | clicks or box | custom axis; `proj` = centroid projected on the axis |
| `tapnext_points` TAPNext++ points | clicks or box | same channels as CoTracker |
| `sam2_mask` SAM 2.1 mask | box or clicks | needs the `sam2` extra; `len_over_width` primary (shorter = deeper) |

3. Paint the moving part with Groups (`Tab`) on a good frame of the scene. Nothing is drawn on the video: the painting is the region (SAM takes it as its seed mask; a box tracker gets its bounds).
4. Draw the axis: `X` (`tracking.axisDraw`), then press at the OUT end and release at the IN end (or two clicks). Ends are draggable; `Esc` cancels, `Delete` removes, `tracking.axisClear` clears. The Axis row offers `auto` / `vertical` / `horizontal` / the drawn arrow; drawing selects custom. The arrow is stored per video and in the project. Toward IN = lower pos.
5. `Ctrl+T` (`track.run`, the **Track ROI** button) tracks that one part over its shot (several painted: a menu at the pointer asks which; see [Track just one part](tracking.md#track-just-one-part-track-roi)). `T`, the primary **Track** button, tracks a point grid over the whole frame instead, the painted parts riding along. `Esc` cancels a running job. The run becomes a ghost "#n <tracker>" on the lane and a row in the panel; the stroke lane shows its trace and direction marks. Its shots play it at once (live).
6. Read the checks on the run: "almost no motion: x px" (the raw signal moved under 3 px: wrong region or axis) and "tracks the camera: 0.91" (the region moves with the whole frame; `tracking.checkCamera` runs the check on demand).
7. Direction: `F` flips the scene at the playhead, `track.flipRun` the whole run. Use the assist queue (`F6`) when there are many scenes.
8. Bake when it is right (optional): `Shift+B` (`tracking.bake`) makes the selected shots' points permanent (else the range, else the shot at the playhead); a hand edit bakes the shot it touches; **Unbake** (Track > Bake and export) gives a shot back to its run. In the Refine tab the lane's `Ctrl+Enter` / `Ctrl+Shift+Enter` (`lanes.acceptGhost` / `lanes.acceptGhostMerge`) copy the last ghost you interacted with onto the selection or range (replace / merge), baking what they cover.
9. Re-run a part: `Ctrl+T` again replaces its run; `tracking.retrack` sets the range for a re-track.
10. The tracker's activity gate is told what each stretch is by the scene tags (Track derives the span labels: intro / idle / after / outro and blank hold, an off-screen cutaway carries the rhythm, orgasm keeps the fast strokes): tag the scenes, not the spans.

## 6. Fix a goofed section

The script is good except one stretch (the tracker followed a hand, a generated pattern went the wrong way, a span is a few frames late). Redo only that stretch; everything else stays as it is.

1. Mark it: `I` / `O` at its edges, or select its points. `Alt+Shift+X` (`fix.panel`) shows the Fix section panel: the span, where it came from (the plan segment and the run it follows, or the run that tracked it) and the problems found inside it.
2. Pick the fix. Each is one undo entry; points outside never move and the seams keep at least the device profile's minimum interval.
   - Tracked the wrong thing: `Alt+Shift+T` (`fix.retrack`) puts you in the Track tab with the span as the range. Paint the part with Groups (`Tab`; `X` for a new stroke axis: its bounds are the region), press `Alt+Shift+T` again. Only the span is tracked with the current tracker, its points replace the span, the run stays as a ghost so you can compare, and you are back in the mode you started from.
   - Wrong pattern: pick a recipe in the panel and press `Alt+Shift+G` (`fix.regenerate`). Over plan segments the plan is split at the span's edges and only the new segment is generated (the plan lane stays the source of truth); with no plan there it is generated straight into the span under the profile's speed cap.
   - In and out swapped: `Alt+Shift+F` (`fix.flip`).
   - Too shallow / too deep: `Alt+Shift+D` (`fix.scale`), factor about the out end.
   - Late or early: `Alt+Shift+E` (`fix.retime`), a shift (`+40`, `-f2`) and a stretch; the span's first and last points keep their times.
3. Not better? `Ctrl+Z` undoes the whole fix in one step. Try another fix or recipe.

## 7. Track tagged scenes

Once the scenes are tagged, the tags decide what gets tracked. Off-screen scenes and the scenes the action continues across are not tracked one by one: the plan reads the tags and runs only what needs a tracker.

1. In the Scenes tab (`Ctrl+1`), Detect scenes and Describe all (the Actions panel, or `track.detectScenes` / `track.describeAll`), and fix the tags (the panel's rows or the quick bar in the lane toolbar): **Off-screen** on cutaways, **Internal** on x-ray / cross-section views, **Continues previous action** on the scene after a cutaway (or accept the proposed brackets). Camera splits from Detect scenes already continue. A scene with no tags at all is still tracked: tags are not required.
2. `Ctrl+2`, the Track tab. Pick the tracker for the action scenes in the Tracking panel and set its params (TAPNext points 512 / 1024 and so on); paint the parts on a good frame of an action scene.
3. `Shift+T` (`track.plan`, menu Track › **Track tagged scenes…**). The dialog lists one row per item: the scenes and their tags, in–out, what will happen, the tracker · ROI · default signal, and why:

| Scene | Row | What happens |
|---|---|---|
| Filled (quick bar **Fill**) | **Skip** (*filled from before* / *after* / *both sides*) | not tracked; the fill plays there from the scenes around it (wins over every tag) |
| Off-screen | **Skip** | not tracked; no run spans it, so the **Bridges and holds** ghost fills it from the scenes around it |
| Blank | **Skip** (*blank: hold*) | not tracked; the ghost holds the level before it and eases into the next scene |
| Intro / idle / after / outro | **Skip** (*…: nothing to track, generated*) | not tracked; the ghost holds at rest (intro eases into the first action, outro eases to rest, after plays the afterglow recipe) |
| Internal view | **Track** with SAM · area | the bounds of a part painted on that scene, else the describe box on the shaft; with neither: the whole-frame grid with the panel's point tracker ("paint the inserted part for SAM area"). A part painted on an internal view is used only there |
| Continuing pieces (A, cutaway, A′; camera splits) | **Track**, one row | the panel's tracker over each piece; the cutaways and internal views between them are never inside a request, the cuts inside a piece still re-seed and normalize per scene (camera splits do not) |
| Camera tag | (on the row) | the default signal it picks once tracked: pan / zoom / handheld → `proj_cam`, rides the stroke → `proj`, turntable → `pair_proj` / `g1_proj` |
| Anything else | **Track** | the panel's tracker and params; with no box, the **whole-frame grid** (the Grid button's points, settings `tracking.gridPoints`), **Needs a box** only for a tracker that takes clicks, not a box |
| Already has a run | **Done** | linked to a run, or wholly covered by one; **Force re-track** tracks it again |

4. **Run** tracks the Track rows one after another (one request per piece; the resident tracker keeps the model loaded between them). The status bar shows one task, *Track tagged scenes · scene 4/19 · S7 · 43 % · 1:20 left*. Each run is linked to its scenes on its camera signal, so the bridges over the skipped cutaways appear as soon as the runs on both sides exist. `Esc` once: it stops after the running piece (that run is kept); `Esc` again kills it. A failed piece stops the batch; the finished runs stay.
5. When it ends a toast sums up (*2 runs · 3 skipped · 1 needs a box · 9 done*). If rows still need a box the dialog comes back: **Go there** puts the range on that scene, the playhead on its middle frame and the Tracking panel up (an internal view picks SAM by itself: paint the inserted part). Paint it, `Shift+T` again, **Run**: the done rows are left alone.
6. The runs play at once, the bridges over the cutaways too. Bake what you want fixed: select shots, `Shift+B`.

Pressing `T` (or `Ctrl+T`) yourself over a range that spans an off-screen scene does the same split: the off-screen scene is left out (a toast names it) and the pieces around it run one by one with the panel's tracker. With the panel's Scenes setting on **one** the range is tracked as drawn.

## 8. Autorange: how much of the range each scene uses

For a stroker or a fuck machine the depth is the script: tip only while it starts, lower in, then deep; the bottom kept for the knot when a section is all knotting; the deepest band at the orgasm; rest after it. Autorange plans that for every scene at once from the scene tags and the tracked motion, as a layer you can see and drag.

1. Track as usual (section 7): the stroke axis has the motion, live or baked.
2. `Ctrl+Alt+R` (`timeline.autorange`, Edit › Modifiers › **Autorange on / off**). The **Range** row opens under the modifiers and the stroke plays (and publishes and exports) through the bands at once: Autorange is a live layer over the points, nothing is baked. `Ctrl+Alt+R` again turns it off and the points play as they are.
3. The Range row draws the target band as an envelope over time (top = 100 = out, bottom = 0 = deepest), piece by piece: a piece is a scene, or a stretch of one where a reason splits it (a shot with its own stroke depth, a modifier span, a knot or its tie, a split of yours); hover a piece for its reason (*penetration: tip only → deep (scene 1 of 3 in the run)*). Every piece has four corner handles:
   - drag a corner: its level (up / down), or sideways: that side in time;
   - drag the top or bottom edge: both corners of that edge (between two keys: just those two);
   - click an edge: a **key** there, an extra handle on that edge; drag a key in time and level;
   - drag a side: the piece's start or end in time, taking the neighbor's shared boundary along (`Alt`: detach it);
   - drag the body: the whole piece in level (`Alt`: only its end, the slope; `Ctrl`: the piece's strength);
   - double-click a corner or the piece: back to auto; a key: delete it.

   `Shift` drags without snapping (otherwise to frames, cuts, span ends and spurt markers in time, to the neighbor's touching corner and round levels). Each gesture is one undo step, and the stroke lane follows while you drag.
4. Click selects a handle (`Shift`+click adds). With the Range row focused: `G` moves the selection, `S` scales it, `X` / `Delete` deletes keys and puts corners back to auto, `Shift+D` duplicates keys, `Esc` selects none, and `K` splits the band at the playhead (not while playing: then `K` stops the video).
5. Right-click a piece: **Split band here**, **Split by shots**, **Split by modifier spans**, **Merge with the piece before** / **after**, **Strength back to the policy's**, **Leave this piece as it is** (and **Range this piece again**), **Back to auto**: this piece, this scene or everything, and **Flatten this piece** (its final into the points). On a key: **Hold**, **Linear** or **Smooth** to the next handle, **Delete key**. Over a fade: the soft start or stop (**Ramp the range over the fade** / **Remove the fade envelope**, back to the default). **Accept gap fill** when the scene has one.
6. The strip at the row's left: the **policy** button (its summary: stroker or machine, build-up, knot reserve; see below), **live** / **off** (the same as `Ctrl+Alt+R`) and **gaps N**. **Flatten** (`timeline.flatten`, Edit › Modifiers) writes what plays into the points; **Range: everything back to auto** (`timeline.range.resetAll`) drops every hand edit.
7. **gaps N** lists what has nothing to range: act scenes with no points (*gap: S7 oral, fill with oral recipe at 55–95*) and **dead gaps**, which get a **tease** by default (*gap: S12 (no act), tease at 80–100*): a scene with no act and no points (untagged, or intro / idle / after without an act), a scene whose tracked run barely moved (the tracker's *almost no motion*), and a span of over 5 s with no points inside a tracked scene. The tease (recipe `tease-top`) is slow, shallow, eased strokes at the top of the scene's band (the top 20 % by default, a stroke every ~3 s), each stroke's length and depth varied a little, now and then a stroke held at the top: dynamic, never dramatic. Every fill shows as the orange ghost; **accept** one scene or **accept all** (one undo step; `timeline.autorange.gaps` in the palette). Nothing is filled by itself; a scene teased whole is marked (no act, no band) and not offered again.

**The policy** (the **policy** button; every handle a drag, one undo step per release, the stroke follows live). The project keeps its own policy (saved in the project's `timeline` block), so a re-plan of the same project is the same plan; a new project starts from the last policy you used.

- **Stroker | Machine**, and **Penetration | Oral | Foreplay**: which act's ladder the curve edits. **defaults** puts every handle back (device and floor kept).
- The curve: x = through an act run (the orgasm band at the right end), y = depth. One band per act family in its color (the picked one solid, the others faint). For the picked family: the **start** band (its out end and deep end pills at the left: where the first scene of a run begins), the **full** band (at the end of the run), and **full depth at …** (left = a faster build-up, all the way left = none; per family, default 60 %).
- **orgasm** band: its ceiling and deep end pills at the right (default 0–45).
- **knot reserve** pill, and **tie** (after a single knot the tie holds from the bottom up to this; default = the knot reserve).
- **offset** (the dot in the middle): slides every act band up (shallower) or down (deeper).
- On **Machine**, the **floor** pill.
- The strip under the curve: **band ×** (every act band's amplitude, ×0.5–1.2, shrinking from the deep end), **ease** between runs (0–2 strokes: a new run slides in from the band before instead of jumping), and the **tease**: how far down from the top it reaches (10–40 % of the band) and its pace (1.5–5 s a stroke).

The bands remap each scene's **own** tracked turns from their own min..max onto the band, so the cadence and the shape of every stroke stay the video's (every point goes through the same map). The user's other effects stack on top (Autorange acts first in a scene); a Knotting effect's span is left out of the band (the knot keeps its full depth), and after a **One knot** the tie holds deep (0 to the knot reserve). Spurts ride on the band untouched.

The policy table (first match wins; `src/lib/autorange.js` `RULES`, pos 0 = deepest):

| Rule | When | Band |
|---|---|---|
| manual | you dragged the bar (stored on the scene) | yours |
| inherit | off-screen / blank | none: the bridge / hold decides |
| rest-after | after / outro | from where the scene before ended, easing to 100 over the scene |
| rest | intro / idle | 100 (held) |
| orgasm | orgasm tag | 0–45 (the policy's orgasm band): the deepest band of the run |
| exposed | exposed tag (dick out, no act) | 85–100 rest band, no stroke narrowing; a Throb effect rides on top at rest; intro / idle still win with 100 |
| build-up | an act run (same act in a row; cutaways are transparent, a continuing scene rejoins its run, a structure scene or an orgasm ends one) | penetration: tip only 65–100 → lower in 40–95 → deep 10–90 → full 0–100; oral: 70–100 → 55–98 → 40–95; handjob / foreplay: 55–95 (the policy's start / full bands move every rung, the ladder's shape kept). Progress = scene *n* of *k* plus the time inside it, reaching full depth at *build-up* (default 60 %, per family) of the run. Untagged scenes with points use the penetration ladder |

Then, per scene:

- **Knotting density**: the share of the run's time in knotting (Knotting effects, *cycles* in full, a *One knot* its own span; knotting tag spans with no single knot). Under 10 %: no reserve, the knot goes to 0 like everything else. Over 40 %: the full *knot reserve* (default 15): the ordinary strokes in that run stay at reserve + 5 (20) or shallower, so each pop reads deeper. Between: a share.
- **Small strokes** (a scene's median stroke under 60 % of its run's): the band narrows (to ×0.4 at most), keeping the out end. Then the policy's **band ×** and **offset**.
- **Ease between runs** (when set): the first scene of a run slides from where the band before ended to its own band over that many of its strokes.
- **Fast strokes**: the band is no wider than the speed cap (`lanes.speedMax`) covers in one half-stroke.
- **Device**: *Stroker* uses 0–100. *Machine* squeezes every band into floor..100 (the floor pill, default 20, or the device profile's min position if higher; a profile with `device: 'machine'` or `'stroker'` sets the toggle), bands ×0.85, and the build-up reaches full depth 1.5× later.
