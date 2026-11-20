# Review

The Review tab checks a finished (or half-finished) script against a device, gives you the numbers, and compares it with a reference. Open it with **Ctrl+4** (or the command `review.open`, menu View). Four panels dock on the right: **Problems**, **Statistics**, **Compare**, **Device and heatmap**.

Positions follow the app convention: 0 = deepest / fully in, 100 = out.

## Problems

The problem finder runs on the active axis (or every axis, see Scope) against the active device profile. It reruns about 140 ms after any edit and only re-checks the neighborhood of the change on long scripts, so it keeps up while you work.

### Walk the list

| Key | Command | What it does |
|---|---|---|
| F8 | `review.nextProblem` | Jump to the next problem after the playhead: seeks there, selects its points, scrolls the view |
| Shift+F8 | `review.prevProblem` | Previous problem |
| Ctrl+F8 | `review.fixProblem` | Apply the problem's fix (one undo step), then select the next one without moving the playhead |
| Ctrl+Shift+F8 | `review.fixAllOfKind` | Run the kind's fix over the whole of every in-scope axis that has a non-ignored problem of that kind (one undo step). Ignored problems of that kind on those axes get fixed too; only the toast count leaves them out |
| Alt+F8 | `review.ignoreProblem` | Ignore this problem and move to the next |
| - | `review.ignoreKind` | Ignore every problem of this kind |
| - | `review.recheck` | Re-run the finder now |

"This problem" is the selected one, else the first problem at or after the playhead, else the first in the list. The list wraps at both ends. Clicking a row does the same as F8 for that row; hover or select a row for its **Fix** and **Ignore** buttons.

### Hear it

| Key | Command | What it does |
|---|---|---|
| F9 | `review.playFromPrevious` | Seek 1.5 s before the previous problem and play |
| Shift+F9 | `review.loopProblem` | Loop from 1.5 s before to 1 s after the current (else nearest next) problem; press again to release |
| Ctrl+F9 | `review.stepWhilePlaying` | While playing, once the playhead passes the selected problem by 1 s, jump to 1.5 s before the next one and keep playing. If paused, starts from the next problem. Press again to stop |

### Filter, sort, scope

Head of the panel: a search field (matches message, kind and axis), three severity toggles with counts (Errors, Warnings, Notes), a Kind select, and a menu button with sort (**By time**, **By severity**, **By kind**, **By length**, plus Reverse order) and scope (**Active axis** / **All axes**; also command `review.allAxes`, setting `review.scope`). With scope All axes each row shows its axis.

Footer: total count, ignored count, the profile name (click: opens Device and heatmap), **Fix all (n)** and **Ignore kind** for the selected kind (the selected problem's kind, else the one kind picked in the Kind select; hidden otherwise), and an **Ignored** toggle that lists ignored problems too (shown once anything is ignored).

### Ignore rules

Ignored ids and kinds are saved in the project (`.pawproj`, block `review`), so they survive reopening. Ids that no longer match a problem are dropped on the next recheck while scope is All axes; with Active axis they stay in the block. An ignored row shows struck through when **Ignored** is on; its eye button un-ignores it.

### What it finds

Severity: error / warn / info. `fix` = what Ctrl+F8 does. Problems without a fix need a human.

| Kind | Severity | Trigger | Fix |
|---|---|---|---|
| `invalid-action`, `out-of-order`, `duplicate-time`, `negative-time`, `invalid-position` | error | Imported file that is not normalized | Clean up (normalize) |
| `speed-limit` | error above 1.5x the limit, else warn | Segment faster than the profile's max speed | Slow to limit (`capSpeed`, method `pull`, to the profile's `maxSpeed`) |
| `too-close` | warn | Two moving points closer than the profile's `minIntervalMs` | Merge close points (`thinMinGap`, keep `extreme`) |
| `kinematic-limit` | error if more than 20 % short, else warn | Profiles with kinematics only: a stroke the device cannot finish in time under its v/a/j limits | Slow to limit (`capSpeed`, method `retime`, ripple) - an approximation |
| `long-gap` | warn | 5 s or more without points, with at least 2 reversals in the 10 s on both sides | none |
| `redundant` | info | Points in the middle of a flat hold | Remove redundant points (`simplify`, tolerance 0) |
| `out-of-range` | warn | Positions outside the profile's range (only when range is narrower than 0..100) | Clamp to range (`limitRange`, mode `clamp`) |
| `jitter` | info | 3 or more alternating reversals of at most 2 units | Remove jitter (`removeMicroReversals`, threshold 3) |
| `micro` | info | a micro glitch a join left: a blip, back-step or stall under 6 units in under 60 ms (the Clean joins thresholds, see Editing) | Clean micro glitch (`cleanMicro`) |
| `past-media` | error | Points after the end of the video | Trim to media (`deletePoints` after the media end) |
| `chapter-jump` | warn | Position moves 50 or more units across a chapter start (150 ms either side) | none; check sync |
| `empty-chapter` | warn | Chapter of 3 s or more with fewer than 2 reversals | none |

Reversals count at 10 units of prominence (3 for the kinematic check). Thresholds are the finder's defaults; there is no UI to change them. The finder also knows `cut-jump` and `cut-sync` (scene cuts), but the Problems panel never passes it scene cuts, so those do not appear in the app.

### Planner devices: overspeed is a signal, not a blocker

With a profile whose `limits` is `planner` (built-in: Nucleus Capstan) the device runs its own motion planner and reshapes anything it cannot follow. So `speed-limit`, `too-close` and `kinematic-limit` are reported as **info**, prefixed "The planner will reshape this", and `kinematic-limit` is renamed `planner-reshaped`. They have no fix: Ctrl+F8 and Fix all skip them. The panel counts them under Notes with everything else of info severity. A `planner-reshaped` stroke whose position shortfall is under 1 unit is not reported at all; `speed-limit` and `too-close` are reported as usual.

What reshaping means in practice: the planner never gives up time. A point it cannot reach is moved toward the previous achieved position by the least amount needed, so over-limit input comes out shallower (peaks and valleys cut), not late. Use the Machine preview (below) to see exactly what it will do.

## Device profiles

Panel **Device and heatmap**. The profile drives the problem checks, the heatmap top-of-scale (by default), the simulator's over-limit readout and the Limit speed action. Setting: `review.profile`. Cycle with `review.nextProfile`.

| Field | Unit | Meaning |
|---|---|---|
| Max speed | u/s (position units per second; 1 unit = 1 % of stroke) | Fastest segment the device follows |
| Min interval | ms | Shortest gap between two moving points |
| Range low / high | 0..100 | Usable position window |
| Latency offset | ms | Informational; the player's sync offset is separate |

Built-in profiles (all figures except Nucleus Capstan are unverified guesses; edit them to your device):

| Profile | id | Max speed | Min interval | Range | Notes |
|---|---|---|---|---|---|
| Generic stroker (conservative) | `generic` | 250 | 80 | 0..100 | Default |
| Generic stroker (fast) | `generic-fast` | 400 | 50 | 0..100 | Optimistic |
| The Handy | `handy` | 360 | 60 | 0..100 | |
| Kiiroo Keon | `keon` | 300 | 80 | 0..100 | |
| Fleshlight Launch | `launch` | 200 | 100 | 0..100 | |
| OSR2 / SR6 (DIY) | `osr2` | 330 | 60 | 0..100 | Servo dependent |
| Nucleus Capstan | `nucleus-capstan` | derived (600 at 200 mm) | 20 | 0..100 | Planner; v/a/j supplied by its maker |

Built-ins are read-only. To edit: **Duplicate** (makes `<name> copy`), or **New** (a copy of the generic profile named Custom), then type into the fields; the Name saves as you type, the numeric fields save on commit (Enter or leaving the field), and nothing saves while any field shows an error (setting `review.profiles`). **Delete** removes a custom profile and falls back to generic.

**Limit speed to N u/s** (`review.limitSpeed`): lowers amplitudes on the active axis so no segment exceeds the profile's max speed, as one undo step. This is the `speed-limit` fix applied to the whole axis.

### Nucleus Capstan and the stroke window

This profile carries kinematic limits in millimetres: vMax 1200 mm/s, aMax 100 000 mm/s², jMax 20 000 000 mm/s³. Position units map to mm through the rail length you actually run, so the panel shows a **Stroke window** slider, 100..300 mm in 5 mm steps (default 200, setting `review.strokeMm` per profile).

- A longer window makes every position unit longer, so the same script needs more mm/s: max speed in u/s drops (1200 mm/s over 300 mm = 400 u/s; over 100 mm = 1200 u/s) and more strokes get flagged as planner-reshaped.
- Moving the slider reruns the problem check and the Machine preview, so you can find the window at which a script starts to get reshaped.
- Typing a Max speed into a duplicated copy stops it being derived from the window.

## Heatmap

The overview strip (timeline) colors the active axis by speed; the lanes color the line the same way (**H**, `lanes.toggleSpeedColors`), as does the on-video simulator's piston. All three use one setting pair:

| Control | Setting | Default |
|---|---|---|
| Color scale: Heat / Viridis / Cividis / Gray | `review.heatmapScale` | `heat` |
| Follow the device speed limit (switch) | `review.heatmapMax` = 0 | on |
| Top of scale, 50..2000 u/s | `review.heatmapMax` | profile max speed |

The legend bar under the scale shows 0 .. top of scale with a tick at the device limit. Color at or beyond the top means "at least this fast". Overview bars draw mean speed per column by default; `timeline.overview.metric` (View menu) switches to peak. Bars are scaled so the top of scale sits at mid height; the hairline across them marks that top of scale, which is the device limit while **Follow the device speed limit** is on and your custom top otherwise. Hovering the overview reads the speed, chapter, and any problem under the pointer; problem ticks sit under the bars (worst severity per column), the selected problem gets a full-height line.

## Statistics

Panel **Statistics**. Recomputes live, about 160 ms after an edit.

Scope: **Whole**, **Range** (the I/O range), **Selection** (needs 2+ selected points on the active axis), **Chapter** (pick one). A scope that is not set falls back to the whole script and says so.

Numbers: duration, actions, strokes/min (and active strokes/min, excluding rest), stroke count (full cycles), average / median / 90th percentile / peak speed, share of segments over the profile's speed limit, mean amplitude, typical range (p5..p95), time at rest, longest gap, mean move duration, up vs down speed.

Charts: position histogram (share of time per 5-unit band; tall end bars mean the stroke sits at its limits), speed distribution (24 bins, red bars beyond the profile limit, the limit marked), strokes per minute over time, mean amplitude over time (40 bins each).

Chapters table (when the project has chapters): length, strokes/min, average and p90 speed, share over limit. Click a row to jump there and switch the scope to that chapter.

**Copy as text** (button) copies the numbers and the chapter table, tab separated. `review.copyStats` copies the active axis over the range (or the whole script) from anywhere.

## Compare

Panel **Compare**: the active axis against a ghost. A ghost comes from importing a funscript (Ctrl+Shift+O) onto an axis that already has points and choosing **Add as reference ghost** (on an empty axis the import replaces the axis without asking), from opening a video with funscripts beside it and choosing **Use as reference only**, or from a tracker run. Pick the ghost and the span: **Whole script**, **Selected range**, or a chapter.

### Agreement

The headline is turning-point F1: the harmonic mean of precision (share of your extremes with a matching reference extreme within 150 ms, same kind, one-to-one) and recall (share of reference extremes you matched). The panel's hint words it loosely as a share; the number is F1. It colors green at 80 % and above, amber from 55 %, red below.

Quick numbers (in-browser, instant): matched / extra / missing, precision, recall, timing error (median and 90th percentile), timing bias (> 0: your extremes are late), best lag, position and velocity correlation at 100 Hz.

**Run** under Full score asks the tracking tracker for the exact scorer: sign detection (was the script flipped?), lag, and, when the span covers more than one chapter, a per-scene table (F1 and lag per chapter; click a row to view it). Needs the tracker running; otherwise the button is disabled.

### Differences

Two tabs, both also drawn as markers on the overview:

- **Regions**: 2 s windows where the mean position difference is 8 units or more, worst first (up to 25), with mean and peak error. Click a row to view it; **Enter** or the row's import button adopts the ghost over that window.
- **Extremes**: unmatched turning points, "only in yours" or "missing in yours".

### Adopt

| Command | What it does |
|---|---|
| `review.compareAdoptRange` (also the **Adopt in range** button) | Replace your script with the ghost over the I/O range, one undo step |
| `review.compareClear` (**Clear markers**) | Remove the difference markers from the overview |

Adopting replaces the range directly; like any hand edit it bakes the live shots it covers.

**Copy as text** copies the score rows (tracker result if there is one, else quick) and the scene table.

## Machine preview

`view.machinePreview` (View menu, "Machine preview (device kinematics)"; setting `view.machinePreview`) shows what the device will actually do with the active axis. It needs a profile with kinematics (Nucleus Capstan, or a copy of it).

- A yellow ghost named "Machine preview (<profile>, <engine>)" appears on the lane for the visible range plus one view-width either side; it follows as you pan and is never saved.
- The on-video simulator's piston, trail and look-ahead follow the machine; the raw script shows as a dashed line with a hollow marker.
- Engine `kinetic` is the device's own Kinetic2 planner (bundled). `scurve` is the analytic fallback when the planner cannot load; it trims and lags slightly differently on dense fast runs.
- Where the ghost falls short of your points is where the planner reshapes: the same strokes the Problems panel lists as planner-reshaped. Change the stroke window to see the preview move.

## The Machine panel

**Stroker mode** (the Machine | Stroker switch at the top) drives a sleeve over your own size with the script, in the panel's 3D view (the sleeve cut open on your side so the contact shows; Cutaway is the flat drawing). On the model, drag the tip for the length, the side for the girth and the corona for the glans. The two markers on the rail under it set where the sleeve's entrance is at pos 0 (deepest) and at pos 100; they reach 6 cm past the hilt and past the tip. Cross them to invert. The sleeve comes from presets (closed long, closed short, open-ended short, ring, and approximate Fleshlight Quickshot, Flight Pilot and standard channels) or from a picture through the toy import; drag its channel to shape it, and set its softness and whether its end is open or closed. A closed end pressed by the tip, or the case pushed past the hilt, presses softly instead of stopping; the totals add the end-contact and past-hilt time. Drag empty space to orbit, Shift+drag to pan, the wheel zooms to the pointer and a double-click frames it; the view presets are Side, 3/4, Top, Tip-on and Cutaway. The color along the penis is the stimulation: brighter is more. It is an estimate from shape and motion, not a measurement of sensation.

A 3D view of a thrust machine playing the active axis: the picked toy (its own model and colorway) on the carriage,
a generic body, and the hole. The toy is soft silicone: it compresses against the ring and lags the carriage, and a
knot takes time to go in. A knot snaps through: pushed against the rim it stalls while the toy compresses and the rim
is forced open; once its widest point passes, the ring closes behind it and the knot shoots in past the carriage,
overshoots a little and settles (pulled, it flies out the same way). Cold and tight means a high peak and a long build,
or no way over at all; warm means a lower peak and a softer snap. The knot-in line's tooltip gives the last snap's peak
force and speed. Past the anal canal it follows an internal path with typical adult anatomy to scale (the
anorectal angle, the rectum along the sacral curve, the rectosigmoid bend at about 15 cm, the start of the sigmoid);
each bend has to straighten before a stiff toy gets past it, and depth readiness builds with time spent working near
it. Readouts say how deep is comfortable now, how long until the rectosigmoid bend is ready, and mark a push that
forces a bend as "forcing". It is a typical-anatomy model with plausible dynamics for planning scripts and scenes,
not a measurement of any body and not guidance on what is safe for a person; fantasy characters reuse the
human-derived path, scaled.

- **Character** picks the creature (with View › Furry items off, only the Human and your own models are offered): Generic, Human (a real anatomical model, below), Canine (a bushy curled tail),
  Feline (long, thin, S-curved), Equine (a short dock with a long fall of hair) or Dragon (a thick tail that carries on
  from the spine). Every tail is held up and swept to the receiver's right, so it never covers the opening, the toy or
  the rail in any view; the cutaway slices it like the body. The built-in body is a slim, soft young adult on all fours with the back arched:
  the hips and full, round glutes are the widest part (the waist about two thirds of their width), a narrow waist
  and tucked abdomen, a narrower ribcage, thighs full at the top and set apart, tapering to the knee (proportions
  within anthropometric survey figures, scaled by the height). **Height** and **Build** (Tuning) set
  size and shape: slim narrows it, chubby adds soft volume to the glutes, hips and thighs first, then the belly.
  **Anatomy** (Tuning) switches the plain genital mass between the thighs off (Neutral). **Experience** (New, Some, Exp., Very) sets how
  the tissue behaves, whatever the character, including how much the deep bends resist. **Warmed start** (Tuning, after Experience; None by default) starts the script
  warmed: the state the model itself reaches after slow strokes with the toy, working up to the depth the script uses
  (Light: at least 2 minutes, and with a knot until the ring is half ready for it; Full: at least 5 minutes, until it is
  ready, at most 15); the tooltip says what it gave for this toy and script. However long and stiff the toy, the internal path keeps it inside the
  body's flanks; it bends along the side as far as its stiffness lets it, and its surface may push the belly out (the
  bulge).
- **Human** (Character) is Z-Anatomy's male model (BodyParts3D anatomy, 171 cm standing), posed on all fours (thighs
  vertical, palms flat, arms straight, so the torso rises about 11 degrees toward the shoulders), the head removed (the
  last few cm before the cut at the base of the neck fade out) and in layers: **Skin**, **Skeleton** (shown), **Rectum
  and colon**, **Small intestine**, **Stomach and oesophagus**, **Bladder**, **Prostate and genitals**, **Kidneys and
  adrenals**, **Liver, gallbladder, pancreas, spleen**, **Lungs, heart, trachea**, and **Opening (ring)**. The panel's **...** menu › **Body
  layers…** opens a row per layer: a slider for its opacity (0 = off) and its name, which switches it off or back to its
  last opacity; **Reset** restores skin and skeleton. Left alone, the skin is see-through (35 %) while an inner layer
  shows (55 % alone); the cutaway slices every layer. The opening hugs the toy's own section (its mesh's,
  oval, flat or lobed, as it is rolled, with a little tissue on it; the fine surface detail smoothed out), at the
  verge and along the canal, round again where the ring stands off it, closed as before when the toy is out. Its
  marker, on every body (the **Opening (ring)** layer on the Human, whose opacity is its brightness), is the hole's
  edge carried inward: a thin sleeve of light in the rim's own green (warmer with strain) from the canal's inner end
  out to the rim, where it turns out over the skin round the hole as a short flange (from outside, a glow exactly where
  the hole is and as wide as it is open), brightest at the hole and fading to clear at both edges, seen through skin,
  bone and the toy from any side (dimmer behind them);
  it moves and stretches because the hole does: in on the push, out on the pull, a knot pulled from inside drawing it
  out until it lets go. On the phone, Lite draws the hole as the outline's oval and the marker in one pass. Readouts
  give the opening's width against its relaxed size. The gut never narrows round the toy: it is at least the toy plus its wall where the toy is (per vertex, from the
  toy's own profile, so a knot or a ridge shows in the wall; Lite on the phone keeps the coarser stations)
  and eases back to its own width over 18 mm past the tip. Toy parts hidden behind bone or organs show faintly through them (not through an opaque skin). The toy runs inside the
  model's own colon: its rectum, sigmoid and descending colon are carried by the solved path and opened round the toy
  (there is no separate tube for this body; the canal shows at 55 % or the colon layer's opacity, whichever is more), the
  rectum held to the sacrum, the sigmoid the mobile part a stiff toy straightens and carries toward the midline and the
  belly, the descending colon held to the back wall: it gives about a centimetre, and it is a third bend (about 40
  degrees, left and back) that readies with depth work far more slowly and less than the first two (minutes to tens of
  minutes, never past a ceiling; **Descending give** in Tuning, 33 % by default, raises it: about a third of people have
  a mobile portion there). A toy flexible enough for what is left of its turn gets through once it has readied enough;
  one too stiff for it even at the ceiling stops there and the readout says "Stopped at the descending colon: too stiff
  for the turn it has left"; one held in it while it is still opening reads "Working through the descending turn: N % of
  the way" (its readiness of what this toy needs). In the cutaway the canal's lining is drawn in a lit mucosa tone. How far a tip gets into the turn first depends on the toy: a slender, soft tip about 20 mm,
  a wide, firm one a few mm (the readout's "reach"); with the Human at 180 cm typical toys meet it at 280-300 mm, matching
  one person's measurement. With use the sigmoid straightens too: the longer, deeper and wider it is
  carried, the straighter its own resting shape, drawn in toward the midline and forward onto the lower front of the
  belly (over minutes; it takes part of the rectosigmoid turn away, and Light / Full warmed starts begin with some of
  it), easing back over tens of minutes left alone. Then the toy sets the path: as the descending colon's turn opens,
  the sigmoid and the descending colon's lower part come off their resting places and are carried onto the toy (only the
  rectum and the colon above the drawn path stay anchored; the gut keeps its length, taking up its slack), so a deep toy
  swings forward and to the center and lies along the belly's front wall: the bulge runs up the middle of the belly
  toward the navel as it goes deeper (tens of mm for a large toy). A stiff toy holds its own line, a flexible one meets
  the carried gut; the readout's "along the toy N %" says how far it has come. **Experience** decides how much the
  rectosigmoid turn and the descending turn resist, where their readiness starts and how fast it builds over a session:
  New, the toy slows or stalls at each bend (about 150 mm, then 280-300 mm on the Human at 180 cm) and the gut takes most
  of a session to come onto the toy; Very, little resistance at either and the gut lies along the toy almost from the
  start. Both are estimates from anatomy texts and
  one person's measurement, not a measurement of anyone's body. The small
  intestine and the bladder slide aside as a mass where the toy passes (a coarse lattice over the abdomen, kept inside
  the belly wall, the back and the flanks; the belly's skin moves out with them where the toy bulges it). The gut sinks back in its own time when the toy
  withdraws: the rectum within about a second (0.75 s time constant), the sigmoid and the loops it pushed over a few
  seconds (3 s), with no spring-back; while stroking the sigmoid stays near where the deepest strokes leave it, and a
  seek shows the same as playing there. The colon lies on the toy where it is (its folds pressed flat to it) and turns
  only as its line bends, never spinning with the toy's roll. Pushing in, the toy's tip wobbles a few mm (a soft toy
  more; settled while held); the readouts never see it. The bends sit where its own colon puts them (the rectosigmoid junction where
  its rectum ends, 148 mm in). The simulation reads the real anatomy: the opening
  where the anal sphincter's axis meets the skin, the rail's line along the rectum (from the opening to the
  rectosigmoid junction; the anal canal itself points about 23 degrees further toward the belly, which the rail
  straightens), the internal path along the colon's own center line (rectum, sigmoid, descending colon on the left),
  the bone under it from the front of the coccyx, sacrum and spine (the coccyx's tip yields), and the torso and belly
  from the skin. Its rectum lies close under the sacrum and the sacral promontory is in line with it, so a stiff deep
  toy is turned toward the belly sooner than in the built-in bodies. While the drawn path shows, the colon around it
  stays faint. **Opening height** and **Opening depth** (Tuning › Calibration) move the opening; **Height** scales the model; **Build** and **Anatomy** do not apply. Kidneys are generated shapes (the
  atlas's kidney model is not included); muscles, vessels and nerves are left out. Attribution:
  `src/features/machine/bodies/human.ATTRIBUTION.txt` (and THIRD-PARTY.md); built by `tools/zanatomy_export.py`
  (Blender, background) and `tools/build-body-layers.mjs`.
- **Prostate stimulation** (the Human; ... › **Track prostate stimulation**, on by default): how much the toy works the
  prostate through the front wall of the rectum, 0-100 %: touching it (within 6 mm), times how hard it presses (its
  girth at that level, full at 8 mm of indentation) and how fast it slides past (full at 150 mm/s). The readout line
  says the number and touched / stroked / pressed; the prostate glows with it in the **Prostate and genitals** layer;
  each spell above 25 % is a warm bar along the top of the stroke lane (with **Knot events on the timeline**) and the
  summary counts the spells in view, their time, peak and mean. A thicker toy, a deeper stroke range, a warmed start
  and an entry angle toward the belly raise it; a thin toy or shallow strokes never reach it.
- **Your own models.** Any other model in `src/features/machine/bodies/` (`<id>.json` + `.bin`, built from an OBJ and
  MTL by `tools/build-body-asset.mjs`; kept out of the repo) is offered too, only where its files are: its opening, the
  rail's line (along the torso), the sections, the belly and the bone under the back are found from its own shape; the
  two Calibration sliders move the opening, kept per character; Height scales it against the height in its json.
- **Entry angle** (Tuning, every character; kept per character; double-click it for 0): the toy's line into the body
  tilted toward the back (+) or the belly (-) about the opening, up to 25 degrees, from the body's own line (the Human:
  along its rectum; your own models: along the torso; the built-in bodies: along their canal). The body stays kneeling
  level on its floor and the rail and machine tilt; the internal path, the bone stop and the bulge follow the angle.
- **The belly bulge.** Where the toy runs close under a thin belly wall, the skin stands out over its own form (the
  head, the taper, a knot): the skin itself is displaced and its shading shows the swelling, with only a soft, even
  footprint over it (no contour rings); the pushed skin is a little more opaque so it reads over the toy. On the Human
  the swelling is smooth (the belly's skin is drawn finer there, the push eases in over a wide band and saturates
  softly); the groin's creases and the genitals stay put. A thick wall
  (Build) softens it or hides it. The readout line with the rim says "bulge N mm" (the peak). Over the pelvis bone nothing shows: a knot about 10 cm
  in sits inside the pelvis; what shows is the shaft and the head further in, mostly on the receiver's left (the
  sigmoid's side), and only with a long toy deep in a slim body. The back never bulges: the toy's surface stays under
  the front of the sacrum and the lumbar spine (bone), and a toy that meets it slides along it toward the belly.
- **...** at the end of the top bar: **View** (every preset, including **Below** (looking up at the belly) and
  **3/4 below** (from the receiver's left)); **Body layers** (the Human); turn or flip the toy (kept per toy; double-click the toy for its default), pick
  its colorway, import a toy from a picture.
- **Depth readiness along the path.** Every 5 mm of the rectum and sigmoid has its own resting width, its own
  readiness (built by depth work at or near it, fading when left alone) and a residual opening after a toy has
  stretched it. The rectal ampulla relaxes within a minute and stays open for many minutes after; the rectosigmoid
  junction is a narrowing that opens over minutes of repeated depth work and closes faster unless well worked; the
  sigmoid is narrower and recovers quickly at first. After withdrawing a deep toy the tube in the view stays open
  where it was stretched and closes over seconds (the stretch) and minutes (the tone); a soon re-entry is easier at
  both bends. The tube is tinted blue by readiness along its length; a bend being forced shows on its edge in the
  strain color instead. The junction's label carries a small ring and "N % ready" for the toy on the carriage.
- The **depth** row in Readouts is a depth map: four small bars, anal canal (its warm-up) · rectum · junction · sigmoid
  (readiness, of the most depth work gives), the junction's with a tick at what this toy needs, and on the Human a fifth,
  the descending colon's turn (of what depth work can open it, with this toy's need as the tick); the number is the
  junction's readiness for this toy. Hover a bar for what it means (the sigmoid's says how straightened it is). The depth
  line adds "straightened N %" and "Descending: ready / ~N more depth work / not with this toy, reach N mm".
- **Readouts** folds the event strip and the readout rows away (remembered). Folded, its header still shows the knot
  badge, readiness and the one status that matters most (forcing, at the force limit, stalled or blocked at a bend),
  and the 3D view takes nearly the whole panel. The view only changes size when you fold or unfold it.
- The **stroke window**: drag an end or the middle to set it. Double-click resets it. Hold `Shift` while dragging for no snap.
- The stroke window's readout shows **H+20** when the deepest point is 20 mm past the hilt.
- **Knot events on the timeline** (the panel's **...** menu; off by default) draws what the Machine simulates over the
  stroke lane while the panel is open: a filled dot where a knot went in and a hollow one where it popped, each with a
  thin line back to the stroke that caused it (where a rigid toy would have), a red cross for a knot or pop that did not
  happen, small triangles along the bottom for the bends (warn color when forced, red when stalled) and a quiet bar
  where the machine sat at its force limit. It follows the final script and the panel's toy, experience and stroke
  window, and goes away when the panel closes. The lane's ghost toggle hides it too.
- The **hilt** (the last point of the toy that goes in) is where the toy's own shape turns from shaft into base (the
  neck or knee before the base flare; a knot or a medial ring counts as shaft), found from its model; the catalog's
  usable length only picks between candidates. If it is still not where you would put it, **Alt+drag** the hilt mark on
  the stroke window (saved for that toy, as a share of its length, so it holds at every size); **Alt+double-click** it
  gives the model's back. Past the hilt the base seats progressively along its flare.
- **Depth from video**: when the tracker has measured the shaft (a run with a penis group's depth glyph on), the stroke
  window gets a header **S / V / S+V**. **S** plays the script; **V** plays the video's depth where its reading is
  confident (inserted share x this toy's usable length; the script elsewhere); **S+V** plays the script and shows the
  video's depth as an orange bar on the stroke window and a dashed outline in the view. The force-limit readout line then
  says how far the script is from the video now and over the visible range (average, worst, where the script runs against
  it), and the knot badge gets "video: in / entrance / out" when the video disagrees. Where the reading is not confident
  nothing is shown for the video. The device always gets the script.
- Library toys are drawn at their own model's density and subdivided once when picked, so they stay smooth up close.
