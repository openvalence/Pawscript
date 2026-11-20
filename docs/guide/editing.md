# Editing points

Position convention: **pos 0 = deepest / fully in, 100 = out**. Times are integer milliseconds; two points can never share a time.

Everything below acts on the **active axis** (the focused lane). Click a lane or press `Alt+↑` / `Alt+↓` to change it. A locked or non-solo lane refuses edits with a toast.

## Placing points

The point keys put a point at the playhead. In the **Blender** keymap (the default, setting `keys.preset`) they are the NumPad digits: the number row picks the selection mode (below). In the **OFS** keymap the number row places points as in OpenFunscripter, `Shift` for the in-between values.

| Keys | Command | Result |
|---|---|---|
| NumPad `0`–`9` (OFS: `0`–`9` too) | `lanes.point0`..`lanes.point9` | pos = key × 10 at the playhead |
| OFS: `Shift+0` | `lanes.point100` | pos 100 |
| OFS: `Shift+1`–`Shift+9` | `lanes.pointHalf1`..`9` | pos 15, 25 … 95 |
| `Insert` | `lanes.addPoint` | point on the current line (interpolated pos) at the playhead |
| `Q` | `lanes.repeatStroke` | copy the last complete down-up-down cycle before the playhead so it starts at the playhead; paused, the playhead jumps to its end so `Q` again tiles on |
| `Enter` | `lanes.editPoint` | numeric popover for the one selected point (Time, Frame, Position; `Enter` applies, `Esc` closes) |

Rules:

- A point already within half a frame of the playhead is replaced, not duplicated.
- The time is where the playhead rests: a scrub is smooth, so it can be between frames, and the point keeps that time. With **Snap to frames** on (`N`, `lanes.toggleSnap`, default on) it is the nearest frame start instead; while playing, the lane's latency setting is subtracted.
- Points past the end of the video are dropped.
- A point placed from the keyboard is selected, but `←` / `→` keep stepping frames, so the loop is *step, key, step, key*. `↑` / `↓` / `Delete` act on it.

Mouse:

| Action | Result |
|---|---|
| Double-click empty space | add a point at the pointer (frame-snapped) |
| Double-click a segment | add a point on the line at that time; hold `Alt` to use the pointer's pos instead |
| Double-click a point | open the numeric popover |
| Right-click | *Add point here (pos)*, *Move playhead here*, then the edit menu (`Shift+F10` opens it from the keyboard) |
| `Shift`+right-click | move the playhead there (Blender's Shift+RMB places the cursor; the playhead is the cursor) |
| Click empty space | clear the selection and move the playhead there |

## Moving points

| Keys | Command | Result |
|---|---|---|
| `↑` / `↓` | `lanes.nudgeUp` / `Down` | pos ± `edit.posStep` setting (default 5) |
| `Shift+↑` / `Shift+↓` | `lanes.nudgeUpFine` / `DownFine` | pos ± 1 |
| `←` / `→`, `Ctrl+←` / `Ctrl+→` | `lanes.nudgeLeft` / `Right` | one frame earlier / later (all four only when the selection was not placed by a key; after a key-placed point `←` / `→` step frames and `Ctrl+←` / `Ctrl+→` do nothing) |
| `Alt+[` / `Alt+]` | `quick.shift-back` / `shift-fwd` | `nudgeTime` −1 / +1 frame |
| `Alt+P` | `selection.toPlayhead` | shift the selection so its first point lands on the playhead |
| – | `selection.shift` | dialog: shift by ms or frames (`+250`, `-33`, `f2`) |
| – | `selection.setPos` | dialog: set every selected pos |

Nudges stop when a neighbor blocks them ("Blocked by a neighbor") and held keys coalesce into one undo entry.

Blender-style transforms (keys, no mouse button held; the status bar shows what is happening):

| Keys | Command | Result |
|---|---|---|
| `G` | `lanes.grab` | the selection follows the mouse; `X` = time only, `Y` = position only (again: free); type a number for an exact offset along the constraint (no constraint = time): `G Y 1 0` = +10 pos, `G X - 5 0` = −50 ms |
| `S` | `lanes.scale` | time and level scale about the **pivot** with the mouse distance to it; `X` = time only (`S X 2` doubles the duration), `Y` = level only (`S Y . 5` halves the height; the old level-only scale), the same key again frees both. Bare `S` waits for the first 8 px of mouse travel: sideways locks time, up / down locks level, so a slip never rescales a script's timing; a factor typed first (`S 2`) scales both, as in Blender. Time stops at the neighbours and the video's ends and never merges two points |
| `R` (OFS: none) | `lanes.rotate` | the levels tilt about the pivot, time stays: each point moves in proportion to its time from the pivot (pivot at the start: the end rises or falls; at the end: the start does). The mouse's angle about the pivot sets it; type the level change at the far end: `R 1 0` |
| `.` (OFS: none) | `lanes.pivotMenu` | the pivot menu at the pointer: **Start**, **Middle** (the bounding box centre, the default), **End**, **Playhead**, **Active element**, **Individual origins** (each run of consecutive selected points about its own middle). The level follows the same choice (Start / End: that point's level, Middle: the selection's mid level, Playhead: the line's level there). The lane toolbar shows it and picks it too (setting `lanes.pivot`) |
| `E` | `lanes.extrude` | **extrude**: a new point comes out of the active point (else the last selected, else the one at / just before the playhead) and follows the pointer as a grab in progress (`X` / `Y`, a typed value, frame snapping); a click or `Enter` keeps it, `Esc` or a right click removes it. It becomes the selected, active point, so `E` again chains the next one. A level-only pull (`E Y 2 0`) lands one frame later: two points never share a time. The Groups tool keeps its own `E` (grow), an action region its `E` (extend) |
| `Shift+D` | `lanes.duplicateGrab` | duplicate, then grab the copies |
| `X` | `lanes.deleteSelected` | delete the selection (the Track tab keeps `X` for the stroke-axis tool) |

While one runs: `Enter` or a left click confirms (one undo step), `Esc` or a right click puts everything back exactly, `Backspace` edits the typed number, `-` flips its sign. Holding the middle button and dragging picks the lock from the drag's direction (Blender; it never pans the lane then). The status bar shows the transform, its lock, the pivot and the value; levels that S or R would push past 0 / 100 are held there with a warning ring and counted in the status line, and `Esc` brings back the shape as it was. Grab clamps at the neighbors like a drag and snaps to frames while snapping is on (`Shift` while moving: off). Every other key is held back until it ends, so the digits type values instead of placing points.

Dragging:

- Drag a point or a segment (the line between two points) to move the selection as a block. The block keeps its shape; it stops at the unselected neighbors (**clamp**).
- `Ctrl`+drag constrains to the dominant axis (time only or pos only).
- `Alt`+drag **duplicates**: copies move, originals stay.
- **Push mode** (`Shift+P`, `lanes.togglePush`, or hold `Meta` while dragging): everything in the direction of travel moves with the block, so nothing is ever crossed.
- `Shift` while dragging disables frame snapping for that drag.
- Snap targets besides frames: ghost extremes (`lanes.toggleSnapGhosts`, default off) and scene cuts / chapter / loop edges (`lanes.toggleSnapCuts`, default on). A guide line shows when a drag locks onto one.
- The drag tip shows time, frame, pos and the Δ in ms / frames / pos.
- **Scrub while dragging** (`lanes.toggleDragScrub`, default on): a horizontal drag of a point or a selection shows the video frame at the dragged point's time on every move (the hover scrubber's decoded frames, not a seek per move); on release one real seek lands there. A vertical-only drag never moves the video.

Transform box: with two or more points selected the lane draws a box with eight handles. Drag `e` / `w` to stretch or compress time (snaps to frames), `n` / `s` to scale amplitude (drag the top below the bottom to invert), corners for both. `Alt` scales about the center. The box cannot cross unselected points and never merges two selected ones. Committed as *Transform points*.

Depth handles: with three or more points selected (a scene click selects that scene's points) the lane draws two horizontal bars across the span (the range when it holds the selection, so the whole scene) at the selection's highest and lowest pos, with the value in a tab on the left. Drag the top bar to set the top (the bottom stays, the shape is kept), the bottom bar likewise; `Shift`+drag moves both (range kept), `Alt`+drag scales about the center. Integer positions, clamped to 0–100, the bars never cross. Grab a bar by its tab or anywhere along it that is not a point. One undo entry, *Scene depth*.

## Deleting points

| Keys | Command | Result |
|---|---|---|
| `Delete`, `Backspace` | `lanes.delete` | delete the selection, else the point at the playhead (within half a frame) |
| `Ctrl+X` | `lanes.cut` | copy then delete (selection, else the I/O range) |
| – | `tool.rippleDelete` | delete the time span and close the gap |

## Selection

| Keys | Command | Result |
|---|---|---|
| `1` / `2` / `3` / `4` (Blender keymap) | `lanes.mode.point` / `segment` / `stroke` / `cycle` | the selection mode: what a click, `B`, `C` and `A` take. **Point**; **Segment** (the line between two neighbouring points); **Stroke** (a run in one direction, from a low to the next high or a high to the next low; a hold is in none); **Cycle** (low, high, low: an up stroke and the down stroke after it). The lane toolbar's four buttons do the same (they and the pivot show when the toolbar is at least 1300 px wide; narrower, the keys, the Edit menu and the lane menu pick them). The selection stays points underneath, so every edit works in every mode; an element counts as selected when all its points are. Switching up (toward Cycle) keeps only complete elements, down keeps every point |
| Click | – | select the point (or, in modes 2–4, the element) under the pointer; it becomes the **active** one, drawn light. Hovering lights what a click would take |
| `Shift`+click | – | toggle this point / element (Blender); added, it becomes the active one; a drag that starts there moves the extended selection |
| `Alt`+click (`Shift+Alt` adds) | – | **loop**: Point mode on a peak: every peak of the passage (on a trough: every trough); Segment / Stroke: every stroke of that direction in the passage; Cycle: every cycle of it. A passage ends where a hold lasts longer than the local median stroke (half the local period) or a stroke lasts over 3x the local median (a slow drift between sections); the local median is over the 7 strokes around |
| `Ctrl`+click (`Shift+Ctrl` adds) | – | **path**: every point / element from the active one to this one. (Before: `Ctrl`+click toggled like `Shift`+click and `Ctrl+Shift`+click extended from the nearest selected end; `Shift`+click still toggles, `Ctrl`+drag still keeps a drag to one axis) |
| Drag on empty space | – | box select (time × pos); a line between points counts as empty space unless both its ends are selected (then it drags them) |
| `Shift`+drag / `Ctrl`+drag on empty space | – | box adds / box subtracts (Blender) |
| `Ctrl+Shift`+drag on empty space | – | select every point from time to time (full height, the box spans the lane) |
| `Alt`+drag on empty space | – | set the I/O range instead of selecting |
| Click a segment | – | select its two end points (`Shift` / `Ctrl` adds them) |

Points, the transform-box handles, the depth handles and the playhead keep their own hit areas: a drag that starts on one of them moves / scales / scrubs as before.
| `A` | `lanes.selectToggle` | Blender 2.7x: anything selected → none, nothing selected → every point of the axis |
| `Ctrl+A` | `edit.selectAll` | every point of the axis |
| `Alt+A` | `lanes.selectNone` | select none |
| `B` | `timeline.select.box` | box select: drag adds, `Shift` / middle drag removes; the box starts anywhere, on a point too (Esc / right click cancels). In modes 2–4 it takes the elements whose centre (mid time, on the line) is inside, as Blender's face centres |
| `C` | `timeline.select.circle` | circle (brush) select: drag paints in, `Shift` / middle drag paints out, the wheel or `[` `]` size the brush; Esc / Enter / right click end it. In modes 2–4: the elements whose centre it covers |
| `Ctrl+Shift+A` | `edit.selectInRange` | every point inside the I/O range |
| `Ctrl+I` | `lanes.invertSelection` | complement |
| – | `lanes.selectConnected` | grow to the strokes (turn to turn) that hold the selection (Blender's *select linked*; `L` stays loop mark) |
| `Esc` | `edit.escape` | clear the selection; a second `Esc` clears the range |
| `I` / `O` | `range.in` / `range.out` | range start / end at the playhead |
| – | `range.set` | dialog with start / end times |
| – | `range.fromSelection` | range = first..last selected point |
| – | `range.selectPoints` | select the points in the range |
| `Z` | `lanes.zoomSelection` | fit the view to the selection (or range) |
| `Shift+W` / `W` (OFS: `,` / `.`) | `lanes.prevPoint` / `nextPoint` | seek to the previous / next point (selection unchanged) |

The `lanes.*` keyboard transforms work on the **selection, else the I/O range**; the `quick.*` keys use the inspector Scope (see Keyboard transforms). The selection helpers in the Transform tools (`select` group, table below) refine a selection without changing the script.

Selection follows edits: after a transform the selection is the points the op produced or kept.

## Clipboard

| Keys | Command | Mode |
|---|---|---|
| `Ctrl+C` | `lanes.copy` | copy selection or range |
| `Ctrl+V` | `lanes.paste` | **replace**: clear the pasted span first |
| `Ctrl+Shift+V` | `lanes.pasteMerge` | **merge**: pasted points win ties, the rest stays |
| `Ctrl+Alt+V` | `lanes.pasteInsert` | **insert**: everything at/after the playhead moves later by the snippet length (ripple) |
| `Ctrl+D` | `lanes.duplicate` | copy right after the selection, same spacing |

Paste lands at the playhead. A range copy keeps the range's origin and length, so pasting an exact span back reproduces it.

Snippets (the Snippets panel, `Alt+N`) are a named clipboard kept across sessions: `Alt+K` (`snippet.saveSelection`) saves the selection or range, `Alt+V` (`snippet.pasteLatest`) pastes the newest at the playhead. The panel's paste options are *Time* (10–400 %, scales the snippet's duration), *Position* (0–200 %, scales pos about 50), *Fit to range* (stretch to the I/O range, overrides *Time*) and the mode.

## Undo / redo

| Keys | Command |
|---|---|
| `Ctrl+Z` | `edit.undo` |
| `Ctrl+Y`, `Ctrl+Shift+Z` | `edit.redo` |
| `Alt+H` | `inspector.toggle.history` – the History panel: click any entry to jump to it |
| – | `history.clear` |

One gesture is one entry: a drag, a held arrow key, a scrubbed slider, a transform over several axes. Undo restores the selection that went with the edit. Ghosts and lane flags are not undo steps.

## Snapping and quantise

- `N` toggles frame snapping for placing and dragging points. `Shift` overrides it per drag.
- Scrubbing (the ruler, the axis lane's playhead, the Scenes tab's filmstrip, hover scrub) is smooth: the playhead follows the pointer and rests where you let go, between frames if that is where it is; the video shows the frame containing it. `Shift` while scrubbing puts it on frame starts. The frame step keys land on frame starts.
- Structure always lands on frames, whatever `N` says: cuts, scene and shot edges, cutaways, loops, fades, the I / O range and modifier spans, made at the playhead or dragged (the start of the frame on screen / under the pointer; `Shift` only drops the snapping to other marks).
- `tool.quantize` moves already placed points onto the frame grid: `frameMs` (default the video's frame length) and `origin` (grid offset, ms). Points that land on the same frame collapse into one (the later wins).
- `tool.nudgeTime` moves by whole frames with its own `frameMs`.
- `tool.setPoint` / `tool.move` take a `frameMs` > 0 to snap their result.

## Clean joins

Wherever two pieces of a script meet, a tiny wiggle can be left behind: two points ~30 ms apart with a small step against the stroke, a blip in the middle of a slope. Pawscript removes these automatically at every join: a tracker run's stitches at scene cuts, Accept (`Shift+A`, replace or merge), Accept bridge, an effects bake, and the lanes' Accept ghost (`Ctrl+Enter` / `Ctrl+Shift+Enter`), within 300 ms of each join edge (a merge cleans its whole span). A wiggle goes when its points are closer than **60 ms** and it is smaller than **6** position units: a blip goes, a back-step or stall on a slope loses the point furthest off the slope, a shoulder at a turn loses the less extreme point. Bigger or slower turns are real and stay, the first and last point always stay, a live effect's own span (a spurt's ringing) is never touched, and removing a point never makes a segment faster. The wand toggle in the lanes toolbar turns it off (setting `edit.cleanMicro`); while on, its two pills scrub the thresholds (`edit.cleanMicroMs`, `edit.cleanMicroPos`). Tracker output away from joins and the live ghosts are not cleaned. For an older script, Review lists the remaining ones as **Micro glitch** problems; **Clean micro glitch** fixes one (or all).

## Keyboard transforms

Quick versions of common tools. The `lanes.*` rows use the selection, else the I/O range. The `quick.*` keys and `tool.repeat` use the inspector **Scope** setting (see below): with scope `selection` and nothing selected they stop with "no points selected" rather than falling back to the range; with `axis` / `all` they act on the whole axis / every axis.

| Keys | Command | Does |
|---|---|---|
| `Shift+I` | `lanes.invert` | pos → 100 − pos |
| `Shift+S` | `lanes.simplify` | RDP, tolerance from `lanes.simplifyTol` (default 2) |
| `Ctrl+↑` / `Ctrl+↓` | `lanes.scaleUp` / `Down` | amplitude × 1.1 / ÷ 1.1 about the selection's mid |
| `Ctrl+Shift+→` / `Ctrl+Shift+←` | `lanes.stretch` / `compress` | time × 1.1 / ÷ 1.1 from the start, clamped to the neighbors |
| `Alt+I` | `quick.invert` | Invert |
| `Alt+S` | `quick.simplify` | Simplify with remembered settings |
| `Alt+E` | `quick.extremes` | Keep extremes only |
| `Alt+L` | `quick.limit` | Cap speed (`maxSpeed` follows `device.maxSpeed` when set) |
| `Alt+=` / `Alt+-` | `quick.scale-up` / `scale-down` | Scale amplitude 1.1 / 0.9 |
| `Alt+R` | `tool.repeat` | repeat the last transform with the same settings and scope |

`quick.*` actions are editable in the Quick actions panel: add any tool with pinned settings (from the panel or the bolt button in the Transform tools panel). Only the ten default quick actions have `quick.<id>` commands, so only those can be rebound in the keybinding editor (`Ctrl+Alt+K`); an added quick action runs from the panel only.

## Fix a section

When one stretch of an otherwise good script is wrong, redo only that stretch. Every fix works on the I/O range, else on the first..last selected point, writes only inside it and is **one undo entry**. Points outside never move; at both edges the new points nearest the seam are dropped until the step across it is at least the device profile's minimum interval (regenerate also keeps it under the profile's max speed).

| Keys | Command | Does |
|---|---|---|
| `Alt+Shift+X` | `fix.panel` | the Fix section panel (right dock): the span, where it came from (plan segment and the run it follows, else the run that tracked it), the problems found inside it, the recipe picker and the five fixes |
| `Alt+Shift+T` | `fix.retrack` | first press: the Track tab, range preset. Paint the part with Groups (`Tab`; `X` for the stroke axis: its bounds are the region), press again (a part already painted in the range: the first press tracks): the current tracker tracks only the span, its points replace the span, the run stays as a ghost to compare, and you are back in the mode you came from |
| `Alt+Shift+G` | `fix.regenerate` | the span made again from the recipe picked in the panel (first press shows the panel with the picker focused when it is not in view). Over plan segments: the plan is split at the span's edges, the span becomes its own segment (keeping the run link) and only it is generated; trimmed neighbors that were up to date stay up to date. No plan there: generated straight into the span, the plan is left alone. The first move goes away from where the script is at the span's start |
| `Alt+Shift+F` | `fix.flip` | pos → 100 − pos inside the span |
| `Alt+Shift+D` | `fix.scale` | depth × factor about the out end (pos 100); asks the factor (0.8 below 1 = shallower) |
| `Alt+Shift+E` | `fix.retime` | asks a shift (ms or `f2` frames) and a stretch factor; the inner points move, the first and last points of the span keep their times and nothing crosses them |

## The inspector

Five panels, each toggled from the View menu:

| Keys | Panel | Content |
|---|---|---|
| `Alt+D` | Points (`inspector.toggle.selection`) | what is selected, with editing fields |
| `Alt+T` | Transform tools (`inspector.toggle.tools`) | every op below, as a form |
| – | Quick actions (`inspector.toggle.quick`) | one-click presets |
| `Alt+N` | Snippets (`inspector.toggle.snippets`) | saved clips |
| `Alt+H` | History (`inspector.toggle.history`) | undo list |

**Points panel.** One point selected: Time (ms), Timecode (`1:23.456`, `83.4s`, `f120`; `Esc` reverts a bad entry), Frame, Position slider, previous / next point buttons, and the speed in and out (red when above `device.maxSpeed`). Several points or a range: count, From / To / Span, strokes per minute, position range, mean position and peak speed, plus **Batch edit** rows: *Set position* (0–100), *Offset position* (−100..100), *Scale position* (0–300 %, about the selection mean), *Shift time* (−5000..5000 ms), *Scale time* (10–400 %, about the first selected point). Scrubbing a row draws a ghost preview; `Enter` or the row's button applies. Nothing selected: axis statistics (length, strokes per minute, position range, mean, peak speed and where it is) and the playhead section (nearest point distance).

**Transform tools panel.** Search box at the top; groups collapse; pinned tools sit first. Open a tool (`tool.<id>` in the palette, or click): edit its params, watch the ghost preview (*Live preview* switch, with before/after count and max speed), then **Apply** (`Ctrl+Enter`) or **Apply, keep open** (`Ctrl+Shift+Enter`). *Reset* drops your remembered values. *Pin* keeps it at the top; the bolt button turns the current settings into a quick action. `tool.<id>.apply` applies a tool from the palette with its remembered settings, no form.

Params you set are remembered per tool across sessions. Three params follow the app instead of their catalog default until you set them: `frameMs` (video frame length; only where the catalog default is non-zero, i.e. `nudgeTime` and `quantize`, `setPoint`, `numberKey` and `move` keep 0 = no snap), `maxSpeed` (`device.maxSpeed`), and the playhead param of tools marked *playhead* below.

**Scope** (*Apply to*, at the top of the Transform tools and Quick actions panels; shared by both and by `tool.*.apply` / `quick.*` keys): `selection` (selected points), `range` (points inside I/O), `chapter` (chapter at the playhead), `axis` (every point of the active axis), `all` (every axis, one undo entry). Ops that need a span use the real range for `range` / `chapter` and first..last selected for `selection`.

## Transform tools reference

Every tool: id (`tool.<id>` opens it), params with defaults, what it is for. Common params:

- `collide` – what happens when a moved point lands on an unselected one. `moved` (default): the moved point wins and may pass others. `clamp`: selected points stay strictly between their unselected neighbors, nothing is lost.
- `pivot` – the pos that stays fixed when scaling: `center` (50), `top` (100), `bottom` (0), `mean` (selection mean), `mid` (middle of the selection's min..max), `custom` (`value`, default 50).
- `minProminence` – how far the curve must retrace (pos units) before a reversal counts as a turning point. 0 = every reversal.
- `mode` for ops that write a span: `replace` clears it first, `merge` keeps what is there (pasted points win ties), `insert` ripples the rest later.

### points

| id | Params (default) | Use |
|---|---|---|
| `setPoint` *(playhead)* | `at` ms (playhead); `pos` 0..100 (50); `tolerance` ms (0): replace points this close; `frameMs` (0 = no snap) | place one point numerically |
| `numberKey` *(playhead)* | `key` 0..10 (5); `at`; `tolerance` (40); `frameMs` (0) | the number-key action with a custom tolerance |
| `delete` | – | delete the scope |
| `move` | `dt` ms (0); `dpos` (0); `collide` (moved); `frameMs` (0) | move by exact amounts |
| `nudgeTime` | `frames` (1); `frameMs` (33.333); `collide` (clamp) | move by whole frames |
| `nudgePos` | `amount` (1) | pos ± amount |
| `setPos` | `pos` (50) | flatten the scope to one pos |
| `setTime` *(playhead)* | `at` (playhead); `collide` (moved) | move the block so its first point is at `at` |

### amplitude

| id | Params (default) | Use |
|---|---|---|
| `scale` | `factor` 0..5 (1); `pivot` (center); `value` (50) | bigger / smaller strokes |
| `offset` | `amount` −100..100 (0) | shift everything up or down |
| `invert` | – | 100 − pos (swap in and out) |
| `remapRange` | `lo` (0); `hi` (100); `trim` % (0) | map the scope's own min..max onto lo..hi; `trim` ignores that share of outliers at each end before measuring |
| `limitRange` | `lo` (0); `hi` (100); `mode` clamp\|compress (clamp) | `clamp` cuts values outside; `compress` squeezes the full 0..100 scale into lo..hi |
| `normalise` | `trim` % (0) | remap to 0..100 |
| `envelope` | `from` (1); `to` (0.5); `curve` linear\|easeIn\|easeOut\|easeInOut\|sine (linear); `pivot`; `value` | fade the amplitude from the start gain to the end gain across the scope |
| `alignExtremes` | `which` both\|tops\|bottoms (both); `to` value\|mean (value); `topValue` (100); `bottomValue` (0); `strength` 0..1 (1); `minProminence` (0) | level the turning points onto a value or their mean; `strength` < 1 only goes part way |
| `extremes` | `amount` −50..50 (5); `which` (both); `relative` bool (false); `minProminence` (0) | push tops up and bottoms down by `amount` (negative softens); `relative` makes it a % of the headroom left to 100 / 0 |

### time

| id | Params (default) | Use |
|---|---|---|
| `shift` | `dt` ms (0); `collide` (moved) | slide the scope in time |
| `stretch` *(playhead)* | `factor` 0.05..20 (1): > 1 slower; `anchor` start\|end\|center\|playhead (start); `at` (playhead, for the `playhead` anchor); `collide` | change speed about a fixed point |
| `fitDuration` | `duration` ms (1000); `anchor` start\|end\|center (start); `collide` | make the span exactly this long |
| `fitToRange` | `t0` (0); `t1` (1000); `collide` | map the span onto t0..t1 |
| `reverse` | – | mirror in time about the middle of the span |
| `rippleInsert` *(playhead)* | `at` (playhead); `duration` ms (1000) | open a gap: everything at/after `at` moves later |
| `rippleDelete` | – | remove the span and its points, close the gap |
| `quantize` | `frameMs` (33.333); `origin` ms (0) | snap times to the frame grid |
| `equaliseSpacing` | `collide` (moved) | even spacing between the first and last point, which stay |

### density

| id | Params (default) | Use |
|---|---|---|
| `simplify` | `tolerance` pos (2); `metric` vertical\|perpendicular (vertical); `timeScale` pos/ms (0.1, perpendicular only); `keepTurns` bool (false); `keepProminence` (0) | RDP: drop points the player would interpolate anyway. 0 removes only collinear points. `keepTurns` protects reversals with prominence ≥ `keepProminence` |
| `thinMinGap` | `minGapMs` (100); `keep` first\|extreme (first) | drop points closer than the gap; `extreme` keeps the one furthest from the previous kept point |
| `keepExtremes` | `minProminence` (0); `keepEnds` bool (true) | keep only turning points (an OFS-style "extremes only") |
| `removeMicroReversals` | `threshold` pos (1..50, 3) | remove wobbles smaller than the threshold |
| `addMidpoints` | `count` per segment (1); `minSegmentMs` (0) | insert evenly spaced points on the straight line between neighbors |
| `subdivide` | `steps` (3); `shape` linear\|sine\|easeIn\|easeOut\|easeInOut\|twoSpeed (sine); `ratio` (2) and `split` (0.5) for twoSpeed; `stepMs` (0 = use `steps`) | replace straight segments by an eased curve of `steps` points; twoSpeed travels the first `split` of the time `ratio` times faster |
| `smooth` | `method` moving\|savgol (moving); `window` ms (200); `order` 1..5 (2, savgol); `step` ms (20, resample); `refit` times\|simplify (times); `tolerance` (1, simplify refit); `pinEnds` bool (true) | resample, smooth, then either keep the same points at smoothed values (`times`) or replace the run by an RDP fit of the smoothed curve (`simplify`) |

Density ops work per contiguous run of selected points; unselected neighbors are not touched.

### speed

| id | Params (default) | Use |
|---|---|---|
| `capSpeed` | `maxSpeed` pos/s (400, or `device.maxSpeed`); `method` pull\|retime (pull); `ripple` bool (false) | `pull` shortens the stroke (times kept); `retime` delays points (pos kept); `ripple` slides the rest of the script after a retime |
| `minSpacing` | `minGapMs` (50); `method` push\|drop (push); `ripple` (false); `keep` first\|extreme (first) | `push` delays later points to open the gap; `drop` removes the ones too close |

### rhythm

| id | Params (default) | Use |
|---|---|---|
| `doubleTime` | `factor` 2..8 (2); `minProminence` (0) | each full cycle (bottom-top-bottom) becomes `factor` shorter copies; total length unchanged |
| `halfTime` | `factor` 2..8 (2); `keep` first\|last (first); `minProminence` (0) | each group of `factor` cycles keeps one, stretched over the group |
| `changeStrokeRate` | `factor` 0.1..8 (2): 2 = twice as fast; `fill` repeat\|ripple\|none (repeat); `seam` next\|prev\|mean (next) | retime keeping amplitude, then `repeat` tiles the result over the old span, `ripple` pulls the rest of the script along, `none` leaves the gap / overlap |
| `repeatLastStroke` *(playhead)* | `at` (playhead); `count` (1); `shape` cycle\|stroke (cycle); `mode` (replace); `minProminence` (0) | the `Q` key with options: `stroke` copies a single up or down, not the pair |
| `repeatSelection` *(playhead: `until`)* | `count` extra copies (1); `until` ms (0 = off); `period` ms (0 = the span); `seam` (next); `mode` (replace) | tile the selection; a longer `period` leaves holds, a shorter one overlaps; `until` cuts the last copy at that time |
| `duplicate` | `count` (1); `mode` merge\|replace\|insert (merge) | copies right after the selection (`Ctrl+D` uses replace) |

`seam`: when the last point of one copy and the first of the next share a time, keep `next`, `prev`, or their `mean`.

Leading and trailing partial cycles are left alone by `doubleTime` / `halfTime`.

### variation

| id | Params (default) | Use |
|---|---|---|
| `jitter` | `timeMs` ± (10); `amp` ± pos (2); `seed` (1); `distribution` uniform\|gaussian (uniform); `collide` clamp\|moved (clamp); `keepEnds` bool (false) | random offsets, reproducible per seed; a point's offset does not depend on what else is selected |
| `humanise` | `preset` subtle\|natural\|loose (natural); `amount` 0..3 (1); `seed` (1); `keepEnds` (true) | preset gaussian jitter that keeps order |

### select

These change the selection, not the script.

| id | Params (default) | Use |
|---|---|---|
| `selectTurns` | `which` both\|tops\|bottoms (both); `minProminence` (0) | turning points inside the scope |
| `grow` | `count` (1); `side` both\|before\|after (both) | add neighbors |
| `shrink` | `count` (1); `side` (both) | drop points from the ends |
| `everyNth` | `n` (2); `offset` (0) | every n-th selected point |
| `selectBySpeed` | `above` pos/s (0); `below` (5000); `basis` max\|in\|out (max) | points whose adjacent segment speed is in the band |
| `selectSimilar` | `ampTol` pos (10); `durTolPct` % (25) | every stroke like the first full stroke in the selection: same direction, amplitude and duration within tolerance |
| `invertSelection` | – | complement (`Ctrl+I`) |

## Dialogs

| Command | Keys | Fields |
|---|---|---|
| `nav.goto` | `Ctrl+G` | time or frame (`1:23.456`, `83456`, `2.5s`, `f120`; `+` / `−` prefix = relative to the playhead) |
| `range.set` | – | start, end |
| `selection.setPos` | – | position 0–100 |
| `selection.shift` | – | ms or frames, signed |
