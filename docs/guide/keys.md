# Keyboard reference

Every action in Pawscript is a *command* with an id (`lanes.point5`, `file.save`). Keys are bound to commands; the command palette, the top-bar menus, the F1 overlay and the Shortcuts editor all read the same list. This page lists the default bindings, grouped by where you use them.

Conventions used below:

- Chords are written `Ctrl+Alt+Shift+Key`. Arrows are ← → ↑ ↓. `?` is physically `Shift+/`; digits and punctuation are physical keys, so `Shift+1` is `Shift+1`, not `!`.
- Position values: **0 = deepest / fully in, 100 = out**. The point keys follow that scale (NumPad `0` places a point at 0, `5` at 50; in the OFS keymap the number row does it too and `Shift+0` places 100).
- Two keymaps (setting `keys.preset`, see [Keymaps](#keymaps-blender-and-ofs)): **Blender** (the default) and **OFS**. The tables list the Blender keys; where OFS differs it is written in brackets (OFS: …). Your own rebound keys win over both and survive a switch.
- Many keys are *guarded*: they only fire when their command applies (points selected, a lane focused, an overlay open). The first applicable command wins; see [Precedence](#precedence-and-shared-keys).
- In a text field only Esc, F-keys and modifier chords the field does not own reach the app. Nothing from the Edit menu fires from a text field.
- *hidden* = not listed in the palette or menus; the key still works.

## Space, Tab and the arrows

By default these keys drive the video and the timeline, never the controls on screen:

- **Space** plays and pauses everywhere except in a text field, even with a button, a menu or a list focused. In an open menu or list, Enter picks the highlighted item.
- **Tab** does not move between controls.
- **The arrows** step frames (or nudge the selected points, see [Transport](#transport)), unless you selected something in an editor: then they nudge that. An open menu, list or dropdown keeps its arrows.
- **A modal dialog** (a confirm, the commit dialog) holds the keyboard: nothing behind it acts on a key. Enter presses its default button, Esc cancels, Tab moves between its fields, Space presses its focused button.
- **The panic stop** (`Shift+Esc` or Pause, `playback.panic`) works everywhere, a dialog or a text field included.

The editor selection is what you last clicked in a direct-manipulation editor: a curve editor's handle (modifier curves, the range policy, the compress curve, the Stroker sleeve), the fusion pad, a stroke-window grip, an anchor, a selected range override, the selected modifiers on the focused Modifiers row. While one is selected the arrows nudge it one step (a frame on the timeline, a value step in an editor; Shift for a finer step). Esc drops it, and the arrows step frames again; a click elsewhere does too.

| Keys | Command | What |
|---|---|---|
| ← / → / ↑ / ↓ | `editor.nudgeLeft` / `nudgeRight` / `nudgeUp` / `nudgeDown` | Nudge the selected editor item one step (hidden) |
| Shift+← / → / ↑ / ↓ | `editor.nudgeLeftFine` / `nudgeRightFine` / `nudgeUpFine` / `nudgeDownFine` | The same, a finer step (hidden) |
| Esc | `editor.drop` | Drop the editor selection: the arrows step frames again (hidden) |

Three settings change this (Settings, Keyboard):

- **Arrows nudge the selection** (`keys.arrowsNudgeSelection`, on): off, the arrows always step frames.
- **Space in menus** (`keys.spaceInMenus`, play): pick makes Space pick the highlighted item in an open menu or list, as most apps do.
- **Keyboard navigation** (`keys.uiNavigation`, off): on, Tab and the arrows move between controls as in most apps (tabs, toolbars, menus, lists), Space presses the focused button, switch or check box instead of playing, and focus rings show. For working without a mouse.

## Command palette and help

| Keys | Command | What |
|---|---|---|
| Ctrl+K, Ctrl+Shift+P | `palette.open` | Open / close the command palette |
| F1, Shift+/ (`?`) | `palette.help` | Help overlay: the Quick start page (docs/guide/quick-start.md) and the Shortcuts page (every command that has keys, by menu; filter by name, id or key text such as `ctrl+z`) |
| Ctrl+Alt+K | `palette.keys` | Shortcuts editor (the `keys` dock panel; an overlay on the Welcome screen) |
| Esc | `palette.close` | Close whichever of the three is open (hidden) |
| Ctrl+, | `settings.open` | Settings panel: every preference, grouped and searchable (File > Settings; again folds it) |

Inside the palette:

- Empty query: up to 5 recently run commands, then every command grouped by menu. Disabled commands are grayed with their keys; Enter on one only says it is unavailable.
- Type to filter: each space-separated word must match the title, menu or id (`edit und` finds Undo).
- Prefixes: `>` commands (the default), `:` go to a time.
- Time forms for `:`: `1:23.5`, `1:02:03`, `83s`, `83` (bare numbers are seconds), `500ms`, `2m`, `1h`, `+5`, `-1.5s` (relative to the playhead). Clamped to the duration.
- ↑ ↓ PgUp PgDn Home End move, Enter runs (closes first, then runs), Esc or a click outside closes.

## Files

| Keys | Command | What |
|---|---|---|
| Ctrl+O | `file.open` | Open a video, funscript or `.pawproj` |
| Ctrl+Shift+O | `file.import` | Import a funscript into an axis or as a reference ghost |
| Ctrl+S | `file.save` | Commit (a named point in the project history, optional note) |
| Ctrl+Alt+S | `file.publish` | Publish: write the funscripts beside the video, next version (needs points) |
| Ctrl+Shift+S | `file.saveAs` | Save project as |
| Ctrl+E | `file.export` | Export funscripts (needs points) |
| Ctrl+W | `file.close` | Close the shown project's tab (written first, never asks; a middle-click or the tab's x does the same) |
| Ctrl+Tab / Ctrl+Shift+Tab | `tabs.next` / `tabs.prev` | Next / previous open project tab |
| — | `tabs.home` | Go to the Projects page |
| — | `file.revert` | Revert to saved |
| — | `video.saveFrame` | Save the current frame as PNG |
| — | `video.proxy` | Make a playable proxy of a video the player cannot decode |

## Transport

| Keys | Command | What |
|---|---|---|
| Space | `player.toggle` | Play / pause (fires on release; Space-drag pans a lane instead) |
| ← / → | `player.stepBack` / `player.stepFwd` | One frame (with points selected these nudge instead, see below) |
| Shift+← / → | `player.back` / `player.fwd` | Jump 1 s (`view.seekStepMs`, default 1000) |
| Ctrl+← / → | `video.back5s` / `video.fwd5s` | Jump 5 s (only with no points selected) |
| PgUp / PgDn | `video.back10f` / `video.fwd10f` | 10 frames |
| Home / End, Shift+G | `player.start` / `player.end` | Start / end |
| J / K | `video.shuttleBack` / `video.shuttleStop` | Shuttle reverse (again: faster) / stop |
| — | `video.shuttleFwd` | Shuttle forward (no default key: Space plays, `]` speeds up) |
| [ / ] / \ | `player.slower` / `player.faster` / `player.rate1` | Speed steps 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3 / back to 1x |
| Shift+Space | `video.playAround` | Play around the playhead (preroll) |
| Ctrl+Space | `video.playRange` | Play the I/O range |
| Ctrl+M | `video.mute` | Mute / unmute |
| — | `video.volumeUp` / `video.volumeDown` | Volume ±0.1 |
| Ctrl+G | `nav.goto` | Go to time or frame dialog |
| — | `video.goto` | Focus the video time field |
| Shift+W / W (OFS: , / .) | `lanes.prevPoint` / `lanes.nextPoint` | Seek to the previous / next point (pauses). In the Blender keymap `.` is the pivot |

Marker navigation:

| Keys | Command | What |
|---|---|---|
| Shift+PgUp / PgDn | `timeline.cut.prev` / `timeline.cut.next` | Previous / next scene cut |
| Ctrl+Alt+L / Ctrl+Alt+Shift+L | `loops.next` / `loops.prev` | Next / previous loop |
| Alt+PgUp / PgDn | `timeline.plan.prev` / `timeline.plan.next` | Previous / next plan segment (selects it, seeks to its start) |

## Range (I / O)

| Keys | Command | What |
|---|---|---|
| I | `range.in` | Range in at playhead |
| O | `range.out` | Range out at playhead |
| Ctrl+Shift+A | `edit.selectInRange` | Select the points inside the range |
| Shift+R | `view.fitRange` | Zoom to range |
| Esc | `edit.escape` | Clear the selection; press again to clear the range |
| — | `range.clear`, `timeline.range.clear` | Clear the range |
| — | `range.set` | Set range start / end by number |
| — | `range.fromSelection` | Range from the selected points |
| — | `range.selectPoints` | Select points in range (inspector's version) |

The I/O range is the fallback target for transforms and copy: with nothing selected, `lanes.copy`, `lanes.invert`, `lanes.simplify` and the rest act on the range.

## Placing and editing points (the Refine tab's job; the keys work in every tab)

All of these act on the active lane. A locked lane, or a lane that is not the solo lane, refuses the edit with a toast.

### Placing

| Keys | Command | What |
|---|---|---|
| Num0 … Num9 (OFS: 0 … 9 too) | `lanes.point0` … `lanes.point9` | Point at pos = key × 10 at the playhead (frame-snapped while `edit.snapFrames` is on). A point within half a frame is replaced. Blender keymap: the NumPad digits only (the number row picks the selection mode); a keyboard without a NumPad places points with `E`, Insert or the pointer |
| — (OFS: Shift+0) | `lanes.point100` | Point at 100 |
| — (OFS: Shift+1 … Shift+9) | `lanes.pointHalf1` … `lanes.pointHalf9` | Point at 15, 25 … 95 (hidden) |
| Insert | `lanes.addPoint` | Add a point on the interpolated line at the playhead (`A` is Blender's select all / none now) |
| Q | `lanes.repeatStroke` | Repeat the last full stroke (down-up-down) at the playhead; press again to tile on (seeks to the end of the copy while paused) |
| Enter | `lanes.editPoint` | Edit the one selected point's values in a popover |
| Delete, Backspace | `lanes.delete` | Delete the selection, else the point under the playhead |

Workflow (OFS keymap, or the NumPad): step with ← →, press a digit, step, press a digit. Points placed from the keyboard are selected (so ↑ ↓ Enter Delete act on them) but ← → keep stepping frames. A selection made any other way (click, box, paste, Ctrl+A) turns ← → into nudges.

### Nudging the selection

| Keys | Command | What |
|---|---|---|
| ← / →, Ctrl+← / → | `lanes.nudgeLeft` / `lanes.nudgeRight` | 1 frame earlier / later. Both chords share one guard: a selection that was not keyboard-placed. With a keyboard-placed selection ← → step frames and Ctrl+← / → do nothing (`video.back5s` / `fwd5s` only run with no selection at all). |
| ↑ / ↓ | `lanes.nudgeUp` / `lanes.nudgeDown` | Position ±`edit.posStep` (default 5) |
| Shift+↑ / ↓ | `lanes.nudgeUpFine` / `lanes.nudgeDownFine` | Position ±1 |
| Alt+P | `selection.toPlayhead` | Move the selection so its first point sits at the playhead |
| — | `selection.setPos`, `selection.shift` | Set position / shift in time by number |

Nudges within `history.coalesceMs` (default 1000) merge into one undo step. A nudge that would cross a neighbor is clamped: it moves as far as it can (stopping 1 ms short) and is committed. Only when no movement at all is possible does it refuse, with "Blocked by a neighbor" (time) or "At the limit" (position).

### Selection and clipboard

| Keys | Command | What |
|---|---|---|
| 1 / 2 / 3 / 4 (OFS: none) | `lanes.mode.point` / `.segment` / `.stroke` / `.cycle` | Selection mode (Blender's vertex / edge / face): a click takes a **point**, a **segment** (the line between two neighbouring points), a **stroke** (a run in one direction, low to high or high to low) or a **cycle** (low, high, low). Also the four buttons in the lane toolbar (setting `lanes.selectMode`). Hover lights what a click would take; B, C and A take whole elements; switching up keeps only complete elements, down keeps every point |
| click / Shift+click | — | Select the element under the pointer (it becomes the *active* one, drawn light) / toggle it. The active element stays while the selection grows around it |
| Alt+click, Shift+Alt+click | — | Loop: in Point mode on a peak every peak of the passage (on a trough every trough); in Segment / Stroke mode every stroke of that direction in the passage; in Cycle mode every cycle of it. Shift adds. A passage ends at a hold longer than the local median stroke, or at a stroke over 3x the local median (a slow drift) |
| Ctrl+click, Shift+Ctrl+click | — | Path: everything from the active element to the clicked one, in the current mode. Shift adds. (Ctrl+drag still keeps a drag to one axis; Alt+drag still duplicates) |
| A | `lanes.selectToggle` | Blender 2.7x: anything selected → select none, nothing selected → select every point on the lane |
| Ctrl+A | `edit.selectAll` | Select every point on the lane (`lanes.selectAll`, Edit menu, does the same) |
| Alt+A | `lanes.selectNone` | Select none |
| B | `timeline.select.box` | Box select: drag adds, `Shift`+drag or a middle drag removes; release applies, Esc / right click cancels. Every timeline editor with a multi-selection (points, Modifiers, Plan, shots); the row under the pointer |
| C | `timeline.select.circle` | Circle (brush) select: a circle follows the pointer, a drag paints in, `Shift` / middle drag paints out; the wheel and `[` / `]` size it while it is on (the wheel does not zoom then); Esc, Enter or right click end it. Radius: setting `timeline.circleRadius`. On interval rows it selects what it touches |
| Ctrl+I | `lanes.invertSelection` | Invert the selection |
| — | `lanes.selectConnected` | Grow to the strokes (turn to turn) that hold the selection |
| Ctrl+C / Ctrl+X | `lanes.copy` / `lanes.cut` | Copy / cut the selection, else the range |
| Ctrl+V | `lanes.paste` | Paste at playhead, replacing what is under the pasted span |
| Ctrl+Shift+V | `lanes.pasteMerge` | Paste, keeping existing points |
| Ctrl+Alt+V | `lanes.pasteInsert` | Paste and ripple everything after it later |
| Ctrl+D | `lanes.duplicate` | Duplicate the selection right after itself |
| Alt+K | `snippet.saveSelection` | Save the selection (else the range) as a snippet |
| Alt+V | `snippet.pasteLatest` | Paste the latest snippet at the playhead |

Points pasted past the end of the video are dropped (the toast says how many).

### Blender transforms (modal)

| Keys | Command | What |
|---|---|---|
| G | `lanes.grab` | Grab: the selection follows the mouse. `X` time only, `Y` position only, a typed number = exact offset (`G Y 1 0` +10 pos, `G X - 5 0` −50 ms) |
| S | `lanes.scale` | Scale time and level about the pivot: mouse distance or a typed factor. `X` time only (`S X 2` doubles the duration), `Y` level only (`S Y . 5` halves the height: the old level scale), the same key again frees both. Bare `S`: the first 8 px of mouse travel pick the lock (sideways time, up / down level) so a slip never rescales the timing; a factor typed before any move scales both. Time never crosses a neighbour, the video's ends or two points into one |
| R (OFS: none) | `lanes.rotate` | Rotate: time stays, the levels tilt about the pivot, each in proportion to its time from it (pivot at the start: the end rises or falls). The mouse's angle about the pivot sets it; a typed value is the level change at the far end (`R 1 0`) |
| . (OFS: none) | `lanes.pivotMenu` | The pivot, as a menu at the pointer: Start, Middle (bounding box centre), End, Playhead, Active element, Individual origins (each selected run of points about its own middle). Levels follow the same choice (Start / End: that point's level; Middle: the selection's mid level; Playhead: the line's level there). Also in the lane toolbar (setting `lanes.pivot`) and the lane menu |
| — | `lanes.pivot.start` / `.middle` / `.end` / `.playhead` / `.active` / `.individual` | Pick one pivot |
| E | `lanes.extrude` | Extrude: a new point comes out of the active point (else the last selected, else the one at / just before the playhead) and follows the pointer as a grab (`X` / `Y`, typed values, frame snapping); a click or Enter keeps it, Esc or a right click removes it. The new point is selected and active, so `E` again chains. Two points never share a time: a level-only pull (`E Y 2 0`) lands one frame later |
| Shift+D | `lanes.duplicateGrab` | Duplicate, then grab |
| X | `lanes.deleteSelected` | Delete the selection (hidden; not in the Track tab, where `X` draws the stroke axis) |

Enter / left click confirms (one undo step), Esc / right click cancels and puts every point back exactly. Holding the middle button and dragging during G or S picks the lock from the drag's direction (Blender). The status bar shows the transform, the lock, the pivot, the value and how many levels are held at 0 / 100 (they get a warning ring; nothing is flattened unseen). See [Blender logic](#blender-logic).

### Transforms on the selection or range

| Keys | Command | Op and parameters |
|---|---|---|
| Shift+I | `lanes.invert` | `invert` (100 − pos) |
| Shift+S | `lanes.simplify` | `simplify`, tolerance = `lanes.simplifyTol` (default 2) |
| Ctrl+↑ / Ctrl+↓ | `lanes.scaleUp` / `lanes.scaleDown` | `scale` factor 1.1 / 1÷1.1, pivot `mid` |
| Ctrl+Shift+→ / Ctrl+Shift+← | `lanes.stretch` / `lanes.compress` | `stretch` factor 1.1 / 1÷1.1, anchor `start`, collide `clamp` |
| Alt+I | `quick.invert` | `invert` |
| Alt+S | `quick.simplify` | `simplify` (remembered settings; catalog tolerance 2) |
| Alt+E | `quick.extremes` | `keepExtremes` |
| Alt+L | `quick.limit` | `capSpeed` (maxSpeed from `device.maxSpeed`, else 400 pos/s) |
| Alt+= / Alt+- | `quick.scale-up` / `quick.scale-down` | `scale` factor 1.1 / 0.9 |
| Alt+[ / Alt+] | `quick.shift-back` / `quick.shift-fwd` | `nudgeTime` frames −1 / +1 |
| — | `quick.smooth`, `quick.humanise` | `smooth`, `humanise` (no default key) |
| Alt+R | `tool.repeat` | Repeat the last transform |

### Fix a section (I/O range, else the selected points' span; one undo entry each)

| Keys | Command | What |
|---|---|---|
| Alt+Shift+X | `fix.panel` | Show the Fix section panel (range, source run, problems, recipe picker) |
| Alt+Shift+T | `fix.retrack` | Re-track only the span (press, paint the part, press again) and splice the run in |
| Alt+Shift+G | `fix.regenerate` | Regenerate the span with the panel's recipe (splits the plan segment under it) |
| Alt+Shift+F | `fix.flip` | Flip direction inside the span |
| Alt+Shift+D | `fix.scale` | Scale depth about the out end (asks the factor) |
| Alt+Shift+E | `fix.retime` | Shift / stretch inside the span, seam points keep their times (asks) |

Quick actions (`quick.*`) are user-configurable in the Quick actions panel; the keys above are the defaults. Every op in the catalog also exists as two palette commands: `tool.<op>` ("Transform: …", opens it in the Transform tools panel) and `tool.<op>.apply` ("Apply … (remembered settings)"). The op ids: `setPoint`, `numberKey`, `delete`, `move`, `nudgeTime`, `nudgePos`, `setPos`, `setTime`, `scale`, `offset`, `invert`, `remapRange`, `limitRange`, `normalise`, `envelope`, `alignExtremes`, `extremes`, `shift`, `stretch`, `fitDuration`, `fitToRange`, `reverse`, `rippleInsert`, `rippleDelete`, `quantize`, `equaliseSpacing`, `simplify`, `thinMinGap`, `keepExtremes`, `removeMicroReversals`, `addMidpoints`, `subdivide`, `smooth`, `capSpeed`, `minSpacing`, `doubleTime`, `halfTime`, `changeStrokeRate`, `repeatLastStroke`, `repeatSelection`, `duplicate`, `jitter`, `humanise`, `selectTurns`, `grow`, `shrink`, `everyNth`, `selectBySpeed`, `selectSimilar`, `invertSelection`.

### Undo

| Keys | Command |
|---|---|
| Ctrl+Z | `edit.undo` |
| Ctrl+Y, Ctrl+Shift+Z | `edit.redo` |
| — | `history.clear` (asks first) |

Undo restores the selection and active axis of each step.

### Recording

| Keys | Command | What |
|---|---|---|
| V (OFS: R) | `lanes.record` | Start / stop live recording (mouse or the point keys while the video plays) |
| Alt+Shift+R | `lanes.recordTap` | Start / stop tap recording |
| ↑ / ↓ | `lanes.recTop` / `lanes.recBottom` | While tap-recording: tap 100 / tap 0 (hidden) |
| NumPad digits (OFS: 0 … 9, Shift+0 too) | the `lanes.point*` keys | While recording: record that position instead of placing a point |
| Esc | `lanes.recordCancel` | Discard the recording |

### Lanes (axes)

| Keys | Command | What |
|---|---|---|
| Alt+↓ / Alt+↑ | `lanes.nextLane` / `lanes.prevLane` | Cycle the active lane |
| Alt+1 … Alt+9 | `lanes.focusLane1` … `lanes.focusLane9` | Focus lane N (not in the Track tab; 2–9 hidden) |
| Alt+Shift+↑ / ↓ | `lanes.moveLaneUp` / `lanes.moveLaneDown` | Reorder lanes |
| Ctrl+Enter | `lanes.acceptGhost` | Copy the ghost's points into the lane over the selection / range (replace); like any hand edit it bakes the live shots it covers |
| Ctrl+Shift+Enter | `lanes.acceptGhostMerge` | Same, keeping existing points |
| Shift+F10 | `lanes.contextMenu` | The lane's right-click menu |
| — | `lanes.addAxis`, `lanes.removeAxis` | Add the next known axis / remove one (asks if it has points) |
| — | `lanes.toggleLock`, `lanes.toggleVisible`, `lanes.toggleCollapse`, `lanes.toggleSolo`, `lanes.toggleLaneGhosts` | Per-lane flags |

Ctrl+Enter takes the ghost last interacted with, else the tracking feature's selected run, else the newest tracker run, else the reference. A tracked shot needs no copy: its run already plays there (live).

Mouse on a lane (no command, editing.md has the full table): click = select only that point, `Shift`+click (or `Ctrl`+click) toggles, `Ctrl+Shift`+click extends from the selection; drag on empty space = box select (time × pos), `Shift`+drag adds, `Ctrl`+drag subtracts, `Ctrl+Shift`+drag = every point from time to time, `Alt`+drag = the I/O range; `Shift`+right-click moves the playhead. A line between points is empty space unless both its ends are selected.

### Lane view toggles

| Keys | Command | Setting |
|---|---|---|
| N | `lanes.toggleSnap` | `edit.snapFrames` (default on) |
| — | `lanes.toggleSnapGhosts` | `lanes.snapGhosts` (default off) |
| — | `lanes.toggleSnapCuts` | `lanes.snapCuts` (default on) |
| H | `lanes.toggleSpeedColors` | `lanes.speedColors` (default on) |
| Alt+G | `lanes.toggleGhosts` | `lanes.ghosts` (default on) |
| Shift+P | `lanes.togglePush` | Push mode for drags (dragged points push neighbors) |
| Z | `lanes.zoomSelection` | Zoom to the selection / range |

## View and layout

| Keys | Command | What |
|---|---|---|
| = / - | `view.zoomIn` / `view.zoomOut` | Zoom around the playhead (factor 0.6) |
| Ctrl+0 | `view.fit` | Whole timeline |
| Shift+R | `view.fitRange` | Zoom to range |
| Alt+Shift+Z | `timeline.zoom.scene` | Zoom to the scene at the playhead |
| Ctrl+Alt+Z | `timeline.zoom.segments` | Zoom to the selected plan segments |
| Shift+F | `view.follow` | Follow playhead on / off |
| Ctrl+1 / Ctrl+2 / Ctrl+3 / Ctrl+4 | `mode.scenes` / `mode.track` / `mode.refine` / `mode.review` | Switch tab: Scenes, Track, Refine, Review |
| Ctrl+B / Ctrl+Alt+B / Ctrl+J | `layout.toggleLeft` / `layout.toggleRight` / `layout.toggleBottom` | Toggle a dock (only when the tab has panels there) |
| Ctrl+Alt+Space | `layout.maximize` | Toggle maximize area: the area under the pointer full-window, again back (Blender's Ctrl+Space is Play range here) |
| — | `layout.reset` | Reset the layout of this tab |
| Alt+D / Alt+T / Alt+N / Alt+H | `inspector.toggle.selection` / `.tools` / `.snippets` / `.history` | Toggle the Points, Transform tools, Snippets, History panels |
| — | `inspector.toggle.quick` | Toggle the Quick actions panel |
| — | `timeline.view.timeMode` | Ruler: timecode / frames |
| — | `timeline.view.repeats` | Ruler: show / hide repeated frames |
| — | `timeline.overview.metric` | Overview strip: mean / peak speed |
| — | `timeline.toggle.<lane>` | Collapse / expand a timeline row |
| — | `view.theme.<id>`, `view.density.<id>` | Theme, density |
| — | `view.machinePreview` | Machine preview ghost of the active axis under the device profile |
| — | `view.furry` | Furry items: show / hide (default show). Off: the paint tool offers no tail or sheath, paws read as feet and slit as vulva; animal-only scene tags, tagger tags, species words and the animal Machine bodies are not offered. The knot stays; projects are unchanged |
| — | `help.about` | About: version, build, graphics card, where your data is |
| — | `help.bugReport` | Copy bug report: build, Windows, graphics card and the last errors, no file names; nothing is sent |

Video pane:

| Keys | Command | What |
|---|---|---|
| M | `video.sim` | Device simulator drawn on the video |
| Ctrl+Shift+C | `video.copyFrame` | Copy the frame to the clipboard |
| — | `video.fit`, `video.fill`, `video.zoom100` | Fit / fill / pixel-exact |
| — | `video.rotateLeft`, `video.rotateRight`, `video.flipH`, `video.flipV` | Orientation |
| — | `video.guides` | Cycle guides: off, thirds, safe, both |
| — | `video.hud`, `video.timeFormat` | On-video readouts / time format |

## Timeline lanes

Keys shared with the point editor (digits, Delete, Enter, Ctrl+A, Esc, S, Shift+M, Ctrl+D) only fire while that timeline lane has keyboard focus (click it; it shows a focus ring). Keys marked *anywhere* work without focus and give the lane focus.

### Loops

| Keys | Command | What |
|---|---|---|
| L | `loop.mark` | Loop in at the playhead; press again at the end of the cycle to create the loop and start looping |
| Shift+L | `loop.playToggle` | Loop playback on / off (the loop under the playhead, else the range) |
| Ctrl+L | `loops.tile` | Tile the loop's points across the range |
| Ctrl+Shift+L | `loops.retile` | Re-tile the selected loop if it is stale, else every stale loop (a selected loop that is not stale falls through to the stale set) |
| Enter | `loops.open` | Loop options popover (loops lane focused, loop selected) |
| Delete, Backspace | `loops.delete` | Delete the selected loop (loops lane focused) |
| Alt+Shift+→ / Alt+Shift+← | `loops.outPlus` / `loops.outMinus` | Loop out ±1 frame (hidden; loops lane focused) |
| Ctrl+Alt+Shift+→ / Ctrl+Alt+Shift+← | `loops.inPlus` / `loops.inMinus` | Loop in ±1 frame (hidden; loops lane focused) |
| — | `loops.removeTiles`, `loops.playback`, `loops.snap`, `loops.useDetected` | Remove tiles / loop playback on this loop / snap the loop to frames / use the detected period |

### Scenes

| Keys | Command | What |
|---|---|---|
| Alt+Shift+S | `timeline.scene.select` | Select the scene at the playhead (sets the range) |
| A / Ctrl+A / Alt+A | `timeline.scene.selectToggle` / `selectAll` / `selectNone` | Toggle all / none, select every shot, none (hidden; scenes lane focused) |
| Alt+Shift+K | `timeline.scene.split` | Split the scene at the playhead |
| Alt+Shift+M | `timeline.scene.merge` | Merge the scene with the next |
| Alt+Shift+J | `timeline.scene.mergeRange` | Merge every scene in the range (Shift+click scenes to select several) |
| Alt+Shift+I | `timeline.scene.tag.internal` | Toggle the Internal view tag on the selected scene (else the one at the playhead); replaces Off-screen |
| Alt+Shift+N | `timeline.mod.toggle.knotting` | Knotting over the selected scenes, the range, else the scene at the playhead (again: off) |
| Alt+Shift+O | `timeline.mod.toggle.orgasm` | Orgasm over the selected scenes, the range, else the scene at the playhead (again: off) |
| — | `timeline.scene.tag.<id>` | Toggle any other scene tag or alias from the palette: `offscreen`, `blank` (one view at most); structure `intro`, `idle`, `after`, `outro` (one at most); where `anal`, `vaginal`, `oral`; what `penetration`, `insertion`, `tonguefucking`, `licking`, `fisting`, `toy`, `tailpen` (tail penetration), `fingering`, `grinding`, `handjob`, `masturbation`, `tailjob`, `footjob`, `titfuck`, `kissing`, `facesitting`, `dancing`, `exposed` (dick out, no act); `throbbing`; aliases `double-penetration`, `rimming`, `cunnilingus`, `fellatio` (toggle their parts). Knotting brings penetration; dropping penetration drops knotting |
| — | `timeline.scene.tagStart` / `tagEnd` / `tagWhole` | The quick bar (lane toolbar) tag chip last pointed at starts / ends at the playhead, or covers the whole scene again (also on the chip's right-click menu) |
| click | | A scene in the scenes lane: range = the scene, its points selected, playhead at its start (Shift+click extends over several scenes) |

**In the Scenes tab only** (no point editing there), on the shot / cut at the playhead or the selection, one undo step each, on frame starts. In Track / Refine / Review these keys keep their meanings (K shuttle stop, M simulator, N snap to frames, [ ] speed, , . points); the chords above work in every tab.

| Keys | Command | What |
|---|---|---|
| K | `timeline.key.cut` | Cut here: split the shot at the playhead |
| M / Shift+M | `timeline.key.mergeNext` / `mergePrev` | Merge with the shot to the right / left (the cut goes; across a scene boundary the two scenes become one: the first's tags and groups kept, the second's offered) |
| N | `timeline.acts.new` | An action region over the selected shots (else the shot at the playhead) with the last-used action; 1–9: a recent action |
| Alt+C | `timeline.shot.cutaway` | Cutaway on / off (also the button on the hovered / selected shot; C is circle select) |
| [ / ] | `timeline.key.prevCut` / `nextCut` | Previous / next cut (after a fade in: its first clean frame) |
| Shift+[ / Shift+] | `timeline.key.prevScene` / `nextScene` | Previous / next scene |
| , / . | `timeline.key.nudgeEarlier` / `nudgeLater` | The selected cut (else the one nearest the playhead) one frame earlier / later; the playhead follows |
| Delete | `timeline.scene.delete` | A selected cut (click its grip): merge across it |
| Shift+Z | `timeline.zoom.frames` | Zoom to frames around the playhead (each frame a numbered cell on the ruler) and back (every tab) |
| drag | | A block's body: select a range. A cut's grip (the pill on its line): move the cut. A fade's handle: adjust it. The line under the timeline says which |
| – | `lanes.toggleHoverScrub` | Scrub on hover: the playhead follows the mouse over the lanes (View options menu on the lane toolbar; off by default) |

### Effects

| Keys | Command | What |
|---|---|---|
| Delete, Backspace, X | `timeline.fx.delete` | Delete the selected effects (effects row focused) |
| A / Ctrl+A / Alt+A / Ctrl+I | `timeline.fx.selectToggle` / `selectAll` / `selectNone` / `invertSelection` | Toggle all / none, select every effect, none, invert (hidden; effects row focused) |
| G | `timeline.fx.grab` | Grab the selected effects: they follow the mouse in time (frame-snapped, Shift free), type ms for an exact shift; Enter / click confirms, Esc / right click cancels |
| Enter | `timeline.fx.edit` | Open the selected effect's curve |
| Esc | `timeline.fx.escape` | Clear the effect selection (hidden) |
| U | `fx.spurtAtPlayhead` | A spurt (one cumshot) on the playhead's frame; press again for the next (anywhere). It follows the spurt before it (same scene, else within 10 s) when that one is linked or has its own params: same link, same params |
| Alt+U | `fx.spurtUnlinked` | A spurt on the playhead's frame at the default params, not joining the spurt before it |
| Shift+U | `fx.throbAtPlayhead` | A throb one-shot: ONE beat with its dip on the playhead's frame; press again for the next. Follows the throb one-shot before it (same scene, else within 10 s) when that one is linked or tuned |
| — | `fx.spurtsFromBalls` | Spurts on the balls contraction peaks of the scene at the playhead (one undo step); grayed with the reason when there is no run, no balls group, too little balls, or a pre-v4.6 run |
| — | `timeline.flatten` | Flatten: write what plays (the modifiers and autorange over the script) into the points, one undo step; the baked modifiers turn hollow |
| Ctrl+← / → | `timeline.fx.nudgeLeft` / `nudgeRight` | Nudge the selected modifiers one frame (rapid presses are one undo step) |
| drag, Shift, Alt+drag, double-click | | On the modifiers row: an edge snaps to stroke turns (Shift: free), Alt+drag copies, double-click fits the span (a push or pull: turn to turn; the rest: the shot). The curve popover's **Strength over the span** sets how it builds and fades (Flat, Build, Fade, Swell) |
| — | `timeline.fx.unbake` | Un-bake the selected effect (live again) |
| — | `timeline.mod.add.shape` / `.climax` | Add an effect over the range, else the scene at the playhead |
| — | `timeline.fx.mute`, `timeline.fx.duplicate` | Mute / unmute, duplicate the selected effect (a copy stays linked) |
| Shift+click, drag | | On the effects row: add / remove an effect from the selection; a drag on empty row space box-selects (Shift adds, Ctrl subtracts); a click there clears the selection and moves the playhead |
| — | `timeline.fx.link` / `timeline.fx.unlink` | Link the selected effects (per kind: one set of params; also on the row's right-click menu) / unlink them (each keeps its params) |
| Ctrl+Alt+R | `timeline.autorange` | Autorange: plan the depth band of every scene from the tags and the motion, as autorange effects (a live layer; `timeline.flatten` writes it into the points); opens the Range row ([Workflows › Autorange](workflows.md#8-autorange-how-much-of-the-range-each-scene-uses)) |
| — | `timeline.autorange.gaps` | Autorange: accept every gap fill (act scenes with no points; dead gaps get a tease), one undo step |
| — | `timeline.autorange.toggle` | Show / hide the Range row (View) |
| drag, Shift, Esc, double-click | | On a Range bar: its top / bottom edge moves the out / deep end, the body shifts it (half speed, Shift fine, Esc cancels, one undo step per release); double-click: back to the policy |
| arrows, Shift, PgUp/PgDn, Home/End | | On a focused curve handle: 5 steps, 1 step, 20 steps, min / max; the key-up is the undo step |

### Plan

| Keys | Command | What |
|---|---|---|
| Shift+N | `timeline.plan.add` | Add a segment at the playhead: the range if set, else the gap between cuts (anywhere) |
| P | `timeline.plan.selectAtPlayhead` | Select the segment under the playhead (anywhere) |
| Alt+PgUp / Alt+PgDn | `timeline.plan.prev` / `timeline.plan.next` | Step segments (anywhere) |
| S | `timeline.plan.split` | Split at the playhead (plan lane focused) |
| Shift+M | `timeline.plan.merge` | Merge the selected neighboring segments |
| Ctrl+D | `timeline.plan.duplicate` | Duplicate the selection after itself |
| Delete, Backspace, X | `timeline.plan.delete` | Delete the selected segments |
| A | `timeline.plan.selectToggle` | Toggle all / none (hidden) |
| Ctrl+A | `timeline.plan.selectAll` | Select all segments |
| Alt+A / Ctrl+I | `timeline.plan.selectNone` / `invertSelection` | Select none / invert (hidden) |
| G | `timeline.plan.grab` | Grab the selected segments in time (clamped at the neighbors, whole frames always); type ms; Enter / click confirms, Esc / right click cancels |
| Enter | `timeline.plan.edit` | Segment inspector popover |
| Esc | `timeline.plan.escape` | Close the inspector, then clear the segment selection (hidden) |
| 1 … 9, 0 (and Shift+) | `timeline.plan.kind.<kind>` | Set the selection's kind: 1 fade-in, 2 foreplay, 3 oral, 4 penetration, 5 knotting, 6 climax (fast run-in), 7 orgasm, 8 afterglow, 9 offscreen, 0 idle (`outro` and `custom` have no key) |
| — | `timeline.plan.arm.<kind>` | Arm a kind for drawing new segments |
| Ctrl+Shift+G | `timeline.plan.generate` | Generate new and stale segments (the selection, if the plan lane is focused with one) |
| Ctrl+Alt+G | `timeline.plan.generateAll` | Generate the whole plan |
| — | `timeline.plan.generateSelected`, `timeline.plan.detach` | Generate the selection / detach it (keep its points) |
| Alt+Shift+L | `timeline.plan.lock` | Lock / unlock the selected segments |
| Ctrl+Alt+P | `timeline.plan.preview` | Plan preview on / off |
| Ctrl+Alt+I | `timeline.plan.inspect` | Open the plan inspector |
| — | `timeline.plan.import`, `timeline.plan.importMerge` | Import a director timeline JSON / spans (replace, or into the gaps) |
| — | `timeline.plan.exportDirector`, `timeline.plan.exportSpans` | Export the plan as director JSON / tracking spans |
| Esc | `timeline.drag.cancel` | While dragging on any timeline lane: cancel the gesture (hidden) |

## Track tab

Only the rows marked *Track tab* need the Track tab (`Ctrl+2`); the rest fire in any tab when their own condition holds.
The scene commands (`track.detectScenes`, `track.describeAll`, …) are the Scenes tab's work but fire anywhere.

| Keys | Command | What |
|---|---|---|
| T | `track.gridFrame` | Track the I/O range: a point grid over the whole frame, painted groups ride along (Track tab; the primary Track button). A range over an off-screen scene leaves it out and tracks the pieces around it. With the Groups tool on a modifier's seed (or a modifier selected in the focused Modifiers row), T tracks that modifier |
| Ctrl+T | `track.run` | Track ROI: one painted part over its shot (SAM by default: its size); several painted: a menu at the pointer asks which, its last row tracks every painted part with the picked tracker (Track tab; the secondary button) |
| Shift+T | `track.plan` | Track tagged scenes…: the plan from the scene tags (skip off-screen, SAM area on internal views, continuing scenes as one item), Run tracks it (a video open) |
| Esc | `track.cancel` | Cancel the running tracker job |
| X | `tracking.axisDraw` | Draw the stroke axis on the video (Track tab, video open, graph not focused). While the tool is active: Esc cancels (`tracking.axisCancel`), Delete removes a drawn axis (`tracking.axisDelete`); both hidden |
| Tab | `tracking.groups` | The Groups tool, opened and closed with Tab (a held Tab toggles once; G is move, always, and never opens it): paint the groups the points trackers pin, on the scene's seed frame (Track tab, video open; with keyboard navigation on Tab moves the focus, so open it from the Track menu or the palette). While it is open: hold Space and move the mouse sideways to scrub around the frame (Left / Right one frame, Shift finer; the one exception to Space = play / pause: inside the tool Space never plays), `[` / `]` brush size (`tracking.groupsSmaller` / `tracking.groupsBigger`), Delete / Backspace deletes the active group (`tracking.groupsDelete`), Esc cancels a stroke, else closes the tool (`tracking.groupsClose`), 1 / 2 / 3 paint Bottom / Top / Extra (`tracking.groupsWho1` / `tracking.groupsWho2` / `tracking.groupsWho3`); all hidden. Enter accepts the take's suggestions and re-found groups, or keeps a grab / scale (`tracking.groupsConfirm`); `tracking.groupsSuggest` (menu only): Suggest; `tracking.groupsSwap` (menu only): swap Bottom and Top; `tracking.groupsRetrain` (menu only): retrain the seeder from the painted groups |
| — | `tracking.axisClear` | Clear the stroke axis |
| Delete, Backspace | `tracking.knotDelete` | Delete the baseline knot last clicked on the stroke lane (Track tab) while the lane has focus (hidden; elsewhere Delete stays the point delete) |
| F | `track.flipAtPlayhead` | Flip the direction of the scene at the playhead in the selected run (Track tab) |
| — | `track.flipRun` | Flip the whole run (a selected run) |
| Alt+0 / Alt+Shift+0 / Alt+M | `tracking.anchorIn` / `anchorOut` / `anchorMid` | An anchor at pos 0 / 100 / 50 on the frame at the playhead, in the shot under it; the same key again takes it away. Each section of the shot is solved on its own: a section without anchors keeps the automatic result |
| Shift+B | `tracking.bake` | Bake: make the live points permanent (the selected shots, else the I/O range, else the shot under the playhead); one undo step. A tracked shot plays its run live until then; a hand edit bakes the shot it touches |
| — | `tracking.bakeRun`, `tracking.bakeAll` | Bake every shot the selected run plays live / the whole script |
| — | `tracking.unbake` | Unbake: the run plays live again (same scope as Bake) |
| — | `track.beside` | Track as a new run, keeping the earlier run of that shot beside it (a plain re-track replaces it and keeps its settings) |
| — | `tracking.retrack` | Re-track the range (a video open) |
| — | `tracking.checkCamera` | Check camera motion of the selected run |
| — | `track.export` | Export the selected run to a funscript |
| — | `track.detectScenes`, `track.describeAll`, `track.rangeToScene` | Detect scenes (video open, trackers listed) / describe all (scenes exist) / range to the scene at the playhead (scenes exist) |
| — | `track.listTrackers` | Reload the tracker list |

Automated runs:

| Keys | Command | What |
|---|---|---|
| Ctrl+Shift+D | `draft.run` | Draft script: scenes, tags, plan, base track, generate (shows the steps; runs what is pending) |
| — | `draft.show`, `draft.cancel` | Show the steps / cancel |
| Ctrl+Alt+Shift+D | `director.run` | Run the automated director |
| — | `director.show`, `director.cancel`, `director.exportTrace` | Show the decisions / cancel / export the trace (JSON + .md) |

### Assist overlay

| Keys | Command | What |
|---|---|---|
| F6 | `assist.open` | Open / close the assist overlay (answer the open questions) |
| — | `assist.regenerate`, `assist.reapply`, `assist.orientGhosts`, `assist.clearDecisions` | Regenerate questions / apply recorded directions to the active axis / orient tracker ghosts / forget the answers |

While the overlay is open these keys answer (all hidden `assist.key.*` commands):

| Keys | Answer |
|---|---|
| ← / → | left / first frame, right / second frame |
| ↓ | can't tell / skip |
| ↑, PgUp | previous question |
| PgDn | next question |
| 1 2 3 4 | choice 1–4 |
| S | direction changes inside |
| Y / N | yes / no |
| C | orgasm (deep tremor) |
| R | re-track |
| Z | zoom to the region |
| Enter | confirm the suggestion |
| Tab / Shift+Tab | next / previous pair |
| Backspace | take back the last answer |
| Shift+← / Shift+→ | split: 5 back / 5 on |
| Home / End | split: first / last |
| Esc | leave |

Keys that would edit the script behind the overlay (0, 5–9, Shift+0, Q, Delete, I, O, L, Shift+L, T, F, G, Shift+G, Space, `,`, `.`, Shift+↑/↓, Ctrl+←/→, Ctrl+X, Ctrl+V) are swallowed while it is open.

## Review tab

| Keys | Command | What |
|---|---|---|
| F8 / Shift+F8 | `review.nextProblem` / `review.prevProblem` | Step through problems |
| Ctrl+F8 | `review.fixProblem` | Fix this problem and advance |
| Ctrl+Shift+F8 | `review.fixAllOfKind` | Fix every problem of this kind |
| Alt+F8 | `review.ignoreProblem` | Ignore this problem and advance |
| — | `review.ignoreKind`, `review.recheck` | Ignore this kind / re-check now |
| F9 | `review.playFromPrevious` | Play from before the previous problem |
| Shift+F9 | `review.loopProblem` | Loop around the current problem |
| Ctrl+F9 | `review.stepWhilePlaying` | Step through problems while playing |
| — | `review.limitSpeed`, `review.nextProfile`, `review.allAxes` | Limit speed to the device maximum / next device profile / all axes or the active one |
| — | `review.copyStats` | Copy statistics as text (range, else whole script) |
| — | `review.compareAdoptRange`, `review.compareClear` | Adopt the ghost over the range / clear difference markers |
| — | `review.open` | Go to the Review tab |

### Device

| Keys | Command | What |
|---|---|---|
| Ctrl+Alt+D | `playback.toggle` | Device playback on / off (follows the video) |
| Ctrl+Shift+Space | `playback.preview` | Play the I/O range (or the selected points' span) on the device |
| Shift+Esc, Pause | `playback.panic` | Panic stop: pause, playback off, StopAll, and PAUSE on a connected Valence hub (works from text fields too) |
| — | `playback.connect` | Connect / disconnect the embedded Buttplug server |
| — | `playback.scan` | Scan for devices (while connected) |
| — | `playback.valence` | Connect / disconnect the Valence hub (address and port in the Device panel) |

## Graph editor

`Ctrl+Alt+Shift+G` (`graph.show`) opens the panel. Everything else only fires while the graph has focus; most keys are the same letters the lanes use, so click the graph first.

| Keys | Command | What |
|---|---|---|
| Shift+A, Shift+F10, ContextMenu | `graph.add` | Add a node (appends to the focused node) |
| Ctrl+Shift+A | `graph.insertBefore` | Insert a node before the focused node |
| Enter | `graph.editParam` | Edit the focused card's first parameter (hidden) |
| C | `graph.connect` | Connect: pick a compatible socket |
| Alt+→ / Alt+← | `graph.followDown` / `graph.followUp` | Follow the wire downstream / upstream (hidden) |
| Alt+↑ / Alt+↓ | `graph.siblingPrev` / `graph.siblingNext` | Previous / next sibling (hidden) |
| ← → ↑ ↓ | `graph.move<Dir>` | Move the selection 20 px (hidden) |
| Shift+arrows | `graph.move<Dir>Far` | Move 100 px (hidden) |
| Ctrl+arrows | `graph.walk<Dir>` | Go to the node in that direction (hidden) |
| Delete, Backspace | `graph.delete` | Delete the selection or wire |
| Ctrl+Delete, Ctrl+Backspace | `graph.dissolve` | Delete, keeping the wires through |
| Ctrl+D | `graph.duplicate` | Duplicate |
| Ctrl+C / Ctrl+X / Ctrl+V | `graph.copy` / `graph.cut` / `graph.paste` | Clipboard |
| Ctrl+A | `graph.selectAll` | Select all |
| M | `graph.mute` | Bypass / mute |
| H | `graph.collapse` | Collapse / expand |
| P / Shift+P | `graph.probe` / `graph.probeCycle` | Probe the node in the timeline / probe its next output |
| Alt+A / Alt+B / X | `graph.pinA` / `graph.pinB` / `graph.swapAB` | Pin as A / B, swap |
| S | `graph.snapshot` | Snapshot the node's output to a ghost |
| D | `graph.diff` | Show what the node changed |
| F / Home | `graph.frameSelection` / `graph.fit` | Frame the selection / fit all |
| F8 / Shift+F8 | `graph.nextProblem` / `graph.prevProblem` | Step through graph problems |
| Ctrl+Enter / Ctrl+Shift+Enter | `graph.bake` / `graph.bakeAll` | Bake the selected outputs (all when none) / bake all |
| Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z | `graph.undo` / `graph.redo` | Graph-local undo (hidden; only when the graph's undo mode is local) |
| Esc | `graph.escape` | Cancel / close / deselect (hidden) |
| Ctrl+G | `graph.group` | Group the selection in a frame |
| N | `graph.note` | Sticky note |
| Shift+L | `graph.arrange` | Auto-arrange the selection, or all |
| Ctrl+I | `graph.inspector` | Show / hide the node inspector |
| Ctrl+Shift+M | `graph.maximise` | Maximize / restore the panel |
| F2 | `graph.rename` | Rename the node |
| — | `graph.new`, `graph.align<Edge>`, `graph.distributeH`, `graph.distributeV`, `graph.savePreset` | New graph, align (2+ nodes), distribute (3+), save the selection as a preset |
| Ctrl+Enter / Ctrl+Shift+Enter | `graph.bake` / `graph.bakeAll` | Bake the selected outputs (all when none) / every output (graph focused) |

## Blender logic

Pawscript follows Blender where a key maps one-to-one and no existing key is taken:

| Blender | Pawscript | Where |
|---|---|---|
| Click / Shift+click / drag on empty | select / toggle / box select (Shift adds, Ctrl subtracts) | axis lanes |
| A (toggle all / none) / Alt+A / Ctrl+I | select all or none / none / invert | axis lanes |
| B, C | box select, circle (brush) select | axis lanes, effects row, plan lane, shots (the row under the pointer) |
| 1 / 2 / 3 (vertex / edge / face select) | 1 Point / 2 Segment / 3 Stroke / 4 Cycle select | axis lanes (Blender keymap) |
| Alt+click (loop), Ctrl+click (shortest path), the active element | loop through the passage, path from the active element, the last one clicked drawn light | axis lanes |
| G, S, R, Shift+D, X | grab, scale (time and level), rotate (levels tilt, time stays), duplicate + grab, delete; `X` / `Y` constrain, middle-drag picks, typed values, Enter / Esc | axis lanes |
| . (pivot pie) | the pivot menu at the pointer: start, middle, end, playhead, active element, individual origins | axis lanes (Blender keymap) |
| E (extrude) | E pulls a new point out of the active one and grabs it (E again chains) | axis lanes |
| Shift+RMB (3D cursor) | move the playhead | axis lanes |
| A / Alt+A / Ctrl+I | toggle all or none / none / invert (Ctrl+A all) | effects row, plan lane; scenes lane A / Alt+A / Ctrl+A (each when it has the keyboard) |
| Drag on empty, Shift adds, Ctrl subtracts | box select in time | effects row |
| G (typed ms, Enter / Esc) | grab in time | effects row, plan lane |
| X | delete | effects row, plan lane (next to Delete) |

The Blender keys belong to the axis lanes unless another editor holds the keyboard (a timeline row you clicked, the graph canvas): then that editor's own bindings get them.

Not mapped on the timeline rows: a drag on empty plan space keeps drawing a new segment (so its box select is `B`; Ctrl+click / Shift+click still multi-select); action regions, loops and cuts select one at a time, so no A / B / C there; the Range row's corners and keys multi-select by Shift+click only; S stays split on the plan lane; loops are unchanged. Inside the Groups tool its own keys win (`A` assign, `C` copy from a frame): no select modes there; in the node graph `C` stays connect.

Kept as they were (Blender would differ): `L` (select linked) stays `loop.mark`, select connected is `lanes.selectConnected` without a key (`Ctrl+L` is `loops.tile`); `Shift+A` adds a node in the graph only; Space, arrows, Home / End, I / O and F keep their meaning (the digits are the selection modes in the Blender keymap, point placement in the OFS one); `Ctrl+D` stays duplicate-in-place next to `Shift+D`. Insert still adds a point on the line (`A` used to as well).

## Precedence and shared keys

One rule: for a key bound to several commands, the first command *in registration order* whose `when` is true runs. Registration order: `palette`, `assist`, `tracking`, `timeline`, `review`, `inspector`, `graph`, `video`, `lanes`, any other feature (alphabetical), then the File commands, then the shell core. Contextual commands (an overlay open, a job running, a lane focused) therefore beat the broad editors, and every feature beats the core.

Pairs that share a key by design (the earlier registration wins when both apply):

| Key | First | Second |
|---|---|---|
| ← / → | `lanes.nudgeLeft/Right` (click/box selection) | `player.stepBack/Fwd` |
| Ctrl+← / → | `video.back5s/fwd5s` (nothing selected) | `lanes.nudgeLeft/Right` |
| ↑ / ↓ | `lanes.recTop/recBottom` (tap recording) | `lanes.nudgeUp/Down` |
| Digits, Shift+digits | `timeline.plan.kind.*` (plan lane focused, segment selected), `timeline.acts.*` recent actions (Shots strip / Scenes tab) | `lanes.mode.*` 1–4 (Blender keymap) or `lanes.point*` (OFS keymap) |
| Alt+← / → | `loops.outMinus/outPlus` (loops lane focused) | `graph.followUp/Down` (graph focused) |
| P | `timeline.plan.selectAtPlayhead` (a segment under the playhead) | `graph.probe` (graph focused) |
| S | `timeline.plan.split` (plan lane focused) | `graph.snapshot` (graph focused) |
| F | `track.flipAtPlayhead` | `graph.frameSelection` (graph focused) |
| E | `tracking.groupsGrow` (Groups tool open), `timeline.acts.extend` (an action region under the playhead, Scenes tab or the row focused) | `lanes.extrude` |
| Ctrl+D | `timeline.plan.duplicate` (plan focused) | `graph.duplicate` (graph focused), then `lanes.duplicate` |
| Ctrl+G | `nav.goto` (yields while `graph.group` applies) | `graph.group` |
| F8 / Shift+F8 | `review.nextProblem/prevProblem` | `graph.nextProblem/prevProblem` |
| X | `tracking.axisDraw` (yields while the graph has focus) | `graph.swapAB`, then `lanes.deleteSelected` (axis selection, not the Track tab) |
| Tab | `tracking.groups` (Track tab; inside a text field Tab stays the field's; with keyboard navigation on Tab moves the focus) | nothing else |
| [ / ] | `tracking.groupsSmaller` / `groupsBigger` (Groups tool open) | `player.slower` / `player.faster` |
| 1 / 2 / 3 | `tracking.groupsWho1` / `groupsWho2` / `groupsWho3` (Groups tool open) | `lanes.mode.point` / `.segment` / `.stroke` (Blender keymap) |
| W, V | `tracking.groupsCircle`, `tracking.groupsIgnore` (Groups tool open) | `lanes.nextPoint`, `lanes.record` (Blender keymap) |
| G, S, Shift+D, A, Alt+A, Ctrl+I, X | the focused timeline row's (`timeline.plan.*`, `timeline.fx.*`, `timeline.scene.*`) or the graph's own command | `lanes.grab`, `lanes.scale`, `lanes.duplicateGrab`, `lanes.selectToggle`, `lanes.selectNone`, `lanes.invertSelection` (no other editor holds the keyboard) |
| Esc | `palette.close`, `assist.key.escape`, `track.cancel`, `tracking.axisCancel` (stroke-axis tool active), `timeline.drag.cancel`, `timeline.plan.escape`, `graph.escape`, `lanes.recordCancel` | `edit.escape` (selection, then range) |
| Delete, Backspace | `tracking.axisDelete` (stroke-axis tool active with an axis drawn; Delete only), `tracking.knotDelete` (a baseline knot clicked, stroke lane focused), then `timeline.plan.delete`, `loops.delete`, `graph.delete` (each needs its lane / panel focused) | `lanes.delete` |
| Enter | `timeline.plan.edit`, `loops.open`, `graph.editParam` | `lanes.editPoint` |

Space fires on key release, and not if a pointer went down while it was held (Space-drag pans a lane).

## Keymaps: Blender and OFS

Setting `keys.preset` (Settings › Keyboard › Keymap, and the Shortcuts editor's header) picks the default keys of the lane editor. **Blender** (the default) keeps the editing keys around the left hand so the right hand stays on the mouse; **OFS** keeps OpenFunscripter's number-row placement. Only these commands differ; everything else is the same in both. Your own rebound keys (`keys.overrides`) win over either preset and are kept when you switch; an old settings file without a preset opens as Blender with every stored override intact.

| Command | Blender | OFS |
|---|---|---|
| `lanes.mode.point` / `segment` / `stroke` / `cycle` | 1 / 2 / 3 / 4 | — |
| `lanes.point0` … `lanes.point9` | NumPad 0 … 9 | 0 … 9 and NumPad 0 … 9 |
| `lanes.point100`, `lanes.pointHalf1` … `9` | — | Shift+0, Shift+1 … Shift+9 |
| `lanes.rotate` | R | — |
| `lanes.record` | V | R |
| `lanes.pivotMenu` | . | — |
| `lanes.prevPoint` / `lanes.nextPoint` | Shift+W / W | , / . |
| `lanes.extrude` | E | the same |

Kept in both: G grab, S scale, Shift+D duplicate, X delete, A / B / C select (the number row's placement no longer collides with them), Insert adds a point on the line, Q repeats the last stroke, Space play / pause, right click the menu, I / O the range, Tab the Groups tool.

## Changing bindings

1. Ctrl+Alt+K opens the Shortcuts editor (search is focused).
2. Search by title, id or key text, or use **Find by key**: press a chord to list what it runs. Filters: All / Changed / Conflicts.
3. Click a binding (or `+`) and press a chord, or up to three chords for a sequence (`G G`). Enter or leaving the cell saves, Esc cancels, Backspace clears what was typed (with nothing typed it removes that binding). Plain Esc, Enter and Backspace cannot be captured as bindings; modified ones can.
4. `×` removes a binding; the row's undo button resets it. **Reset all** asks first.

Conflicts are shown live while capturing: the same chord on an unguarded command, or a prefix clash (`G` against `G G`). A key shared only between guarded commands is listed as *shared*, not a conflict; the `?` overlay says which of them runs in the current context. Overrides persist in the `keys.overrides` setting.
