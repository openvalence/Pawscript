# Quick start

From a video to a working `.funscript`. You script by hand today; here the tracker follows the bodies and you check and fix what it gives. Position 0 is deepest, 100 is fully out. `F1` opens this page in the app.

## 1. Open a video

On the Projects page: **Open video or project…** (`Ctrl+O`), or drop the file on the window. Each project opens in its own tab. The project (`clip.pawproj` beside the video) saves itself about a second after every change: there is no Save for it, and closing never asks.

Mistake: a video that stutters or will not play. Use the film button under the video: **Make a proxy** (480p plays smoothly; the tracker still reads the original).

## 2. Check the cuts

`Ctrl+1` opens the Scenes tab. **Detect** in the Actions panel finds the cuts. Play through: `K` cuts at the playhead where a cut was missed, `M` merges a false cut away (`Shift+M`: with the shot before), `,` / `.` move the nearest cut one frame. On the timeline a filled grip is a cut, a hollow one a camera move.

Mistake: a pan or zoom left as a cut. The tracker starts over at a cut and the script jumps there. Right-click the cut and tick **Camera move**. A shot of something else (a face, the room): `Alt+C` marks it a cutaway and it is not tracked.

## 3. Paint the parts on one frame

`Ctrl+2` opens the Track tab. Click the shot on the timeline, park on a frame where every part is in view, press `Tab` (`Tab` again closes the tool). Drag on the video to paint a part; a stroke away from it starts the next part. `Shift`+drag erases, and an erased bit stays erased until you paint that part over it again. `[` / `]` change the brush.

Name each part: `A` over it, then `1` **Bottom** (the one receiving) or `2` **Top** (the one giving), type the part (`pe` for penis) and `Enter`. What matters:

- the Top's **penis**: the shaft is what the depth is read from;
- the Top's **hips**: the thrust;
- the Bottom's receiving part (hips, anus, slit, the head for oral): what the penis moves against. With View › Furry items off, the slit is called vulva.

For a knot, `K` paints it as a section inside the penis (`Shift` erases it). `Esc` closes the tool.

Mistake: unnamed parts (shown as `? 1`, `? 2`) are not tracked. Bottom and Top swapped makes the script move the wrong way.

## 4. Track

With the shot selected, press `T`. The status bar shows the progress; `Esc` cancels. The first run loads the model, which takes a few seconds. `T` again on that shot replaces its run and keeps its settings.

No NVIDIA card: `T` and the painted parts need one. Paint the moving part (step 3), press `Ctrl+T` (Track ROI): with no GPU, **Optical flow (box)** follows the part's bounds on the CPU.

Mistake: no shot or range selected. Then `T` tracks the whole video.

## 5. Check the script and fix it

The run comes back as a script fused from every named part (Smart stroke), and it is your script at once (live): the stroke lane draws it (the tracked signal faint under it), the machine preview plays it, Publish writes it. Every fix below changes it.

- Upside down (out where it should be deep): `F` flips the shot at the playhead.
- Depth or timing off in a stretch: on a frame there where it is fully in press `Alt+0`, fully out `Alt+Shift+0`, half way `Alt+M`. That section of the shot is solved again to meet them; the rest stays as it was. The same key on that frame takes the anchor away.
- The wrong body part leads: the source chip in the band under the stroke lane picks Fused (the default), Shaft (follows the penis) or one part.

Mistake: anchoring frames that are already right. An anchor there changes nothing; put them where the script is wrong, two or three per bad stretch.

## 6. Bake when it is right

`Shift+B` bakes the selected shot: its points become permanent, and a re-track or a fusion change no longer moves them. A hand edit on a live shot bakes that shot in the same undo step (`Ctrl+Z` takes both back). Track › Unbake gives a shot back to its run. On the Scenes row a baked shot's line is solid, a live one dashed.

Mistake: baking too early. You never have to bake; a live shot still takes every fix from step 5.

## 7. Next shot

Click the next shot and do 3 to 5 again. Inside one scene the parts carry over a cut by name: they show dotted with a `?`; check them, then `Enter` in the Groups tool keeps them. `C` in the Groups tool copies the parts from a similar frame.

Mistake: carrying parts into a new scene where the bodies changed place. Paint them again there.

## 8. Preview

`Space` plays. The machine preview beside the video (`M` shows or hides it) moves like the device will, live shots included. The Machine panel on the right shows it larger.

Mistake: judging only the lines on the lane. Watch the preview at full speed.

## 9. Write the funscript

`Ctrl+Alt+S` (Publish) writes `clip.funscript` beside the video, as v1, v2, … (a file Pawscript did not write is kept as `clip.funscript.bak` first); the status bar then says "v1 published" and counts your edits since. `Ctrl+S` commits: a named point in the project to come back to, with an optional note; nothing beside the video changes. `Ctrl+E` exports to another folder, or a device-safe copy.

Mistake: sharing the `.pawproj`. Players read the `.funscript`, and it changes only when you publish (`Ctrl+Alt+S`) or export.

Stuck? [Requirements and troubleshooting](requirements.md). Every key: `F1`, then Shortcuts.

<!-- guide-keys: test/guide-keys.test.mjs checks every line against the command registry, and that every key written in backticks above is listed here.
F1 = palette.help
Ctrl+O = file.open
Ctrl+1 = mode.scenes
K = timeline.key.cut
M = timeline.key.mergeNext
Shift+M = timeline.key.mergePrev
, = timeline.key.nudgeEarlier
. = timeline.key.nudgeLater
Alt+C = timeline.shot.cutaway
Ctrl+2 = mode.track
Tab = tracking.groups
[ = tracking.groupsSmaller
] = tracking.groupsBigger
A = tracking.groupsAssign
1 = tracking.groupsWho1
2 = tracking.groupsWho2
Enter = tracking.groupsConfirm
K = tracking.groupsKnot
Esc = tracking.groupsClose
T = track.gridFrame
Esc = track.cancel
Ctrl+T = track.run
F = track.flipAtPlayhead
Alt+0 = tracking.anchorIn
Alt+Shift+0 = tracking.anchorOut
Alt+M = tracking.anchorMid
Shift+B = tracking.bake
Ctrl+Z = edit.undo
C = tracking.groupsCopyFrom
Space = player.toggle
M = video.sim
Ctrl+S = file.save
Ctrl+Alt+S = file.publish
Ctrl+E = file.export
"Open…" = file.open
"Detect scenes" = track.detectScenes
"Make a proxy of this video" = video.proxy
"Camera move" = timeline.shot.take
"Unbake" = tracking.unbake
-->
