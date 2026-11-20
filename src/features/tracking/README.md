# features/tracking

The tracker bench, moved into the shell. It runs sidecar trackers over a range of the open video, keeps every finished
run, and shows it as a ghost (`app.doc.ghosts`). You compare runs with each other and with the reference, flip a
scene's direction. paw-x7w7: there is no Accept. A tracked shot plays its run **live** (the script there IS the derived
result, recomputed on every change); **Bake** makes points permanent (below, "The live script and Bake"). Scenes (detect / describe /
loop) have their own panel; span labels (idle / carry / climax) derive from the scene tags at Track time
(timeline/acts.js tagSpans), old manual labels still win where they overlap.

| File | What |
|---|---|
| `tracking.svelte.js` | the store: `trackingFor(app)` (one per app, WeakMap), `peekTracking(app)` (never creates; for `when`) |
| `accept.js` | `acceptGhost(script, ghost, {range, mode, tol}) -> {script, ats}`, pure (test/tracking-accept.test.mjs): the live composition's replace |
| `export.js` | `exportFunscript(backend, video, script, overwrite)`: the no-overwrite-without-.bak policy (test/tracking-export.test.mjs) |
| `panel.js` → `TrackerPanel.svelte` | left dock, Track tab: tracker + params, ROI, range, Track / Cancel, runs |
| `panel.js` → `ScenesPanel.svelte` | left dock, the Scenes tab's own panel: Detect / Describe all / Loop, one row per scene (tags, tagger labels, run status), the scene options (cut_*, loop, describe) |
| `lane.js` → `TrackingLane.svelte` | timeline row "Tracker" (order 60, 110 px): signals, confidence, events, cycles, direction strip, span strip |
| `overlay.js` → `TrackingOverlay.svelte` | over the video, Track tab (the Scenes tab: only the tag boxes): ROI drawing, tag boxes, the live / selected run's overlay frame |
| `TrackerDock.svelte`, `dock.js` | the tracker dock on the video's left edge (blobs view, paw-ufv): per channel of the scene on show a toggle with its facts (`dockChannels`, `channelStats`: moves on the stroke axis, follows the stroke, points lost; `hiddenSlots` -> drawBlobsView `hide`), view toggles (tracking.blobs.*), the options popover, pick a pair (the store's `pairPick` / `pickPairPart`, paw-9qm) (test/tracking-dock.test.mjs) |
| `fusion-view.js` | the fusion contribution view while the shot uses `fused`: `fuseWeightsAt`, `partWeights`, `frameParts`, `partNear` (pure), `drawFusion`, `drawPairPick` |
| `overlay.js` → `GroupsOverlay.svelte`, `GroupsPicker.svelte` (+ `BodyFigure.svelte`, `figure.js`), `groups.svelte.js`, `groups.js` | the Groups tool (Tab opens / closes it; inside it hold Space + move the mouse sideways to scrub: the one deliberate exception to "Space is always play / pause", Space never plays while the tool is open; G, paw-kkb; paw-ls54: its controls are a dock BESIDE the stage on its left (moved into the stage row, the picture fits what it leaves; `tracking.groups.collapsed` folds it to a rail): shot, Bottom / Top / Extra, Suggest, Copy from…, where the groups are when off their frame (Go there), the groups as rows (hover lights the group on the video and back; the unassigned ones one line, `dockRows`), part chips for the selected group only (`chipParts`; click assigns it, Shift+click arms), the brush, the seeder in one line (numbers on hover, meanings on click), ask / auto in an options popover; no hint line under the video: the key list is the (i) hover, a short context line in the dock (test/groups-dock.test.mjs, dev/groups-dock-check.mjs); paw-1mo: never seeks, paint first as `unassigned_N` then assign with the picker / dragged labels; paw-h8c: the picker is a rig picker, a front-facing body to click (L = the picture's left), genitals a chip row under it, parts dragged off it onto groups, moved by its title and kept there (`tracking.groups.pickerAt`), max-composite brush whose 0.5 edge is the ring, sub-pixel outlines, patches split, an erase leaves each patch it cut as one piece (paw-1co9, `eraseIslands`: the piece with the SAM prompts, else the largest; crumbs go; untouched patches stay), G / S grab / scale, closes when a track job starts): a soft brush paints one mask per group on the scene's seed frame, a polygon is fitted live (`fitPoly`), Suggest asks the sidecar (`suggest_groups`, PROTOCOL v4.11); stored as `scene.groups` [{name, poly, pinned, t_ms, off?, score?, source?, mask: {w, h, rle}, who?, part?, side?}] (undoable, in the .pawproj); characters (paw-emy, v4.12): Bottom / Top / Extra (ids c1 / c2 / x; keys 1 / 2 / 3) + part chips target `who_part_side` groups (`c2_hand_l`), listed by character, swap / move between them, colour families in `colors.js`; `runTrack` sends `trackGroups(...)` as `track.groups` (with who / part / side); `blobs.js` names pinned ids from the run (`semNames`) and draws every group and the `who_c1` / `who_c2` centres (test/tracking-groups.test.mjs, dev/groups-check.mjs) |
| `copy-from.js` → `CopyStrip.svelte` | Copy from… (paw-lgtx; key C in the Groups tool, the dock's Copy from… button): a strip of up to six tiles over the bottom of the video. paw-55la, a two-way search: the frames of the shot under the playhead (inside the take's seed window, `seed-window.js`, and 120 ms in from its cuts: `shotFrames`, a cut found a frame off shows the other shot there) are printed as well as the sources, and every PAIR (frame of the shot, source frame) is compared by `printDist` of 32 x 32 grey prints; each tile is a source at the frame of the shot it matches best (`bestPairs`: one tile per source take, within `NEAR` 0.015 of the best the frame nearest the playhead), caption `→ f N (+n)`. Sources: (a) other takes' painted frames (`paintedSources`), (c) runs' tracked frames outside the take, one every 250 ms (`trackedSources`, `RUN_EVERY`, at most 240, away from cuts; inside a painted take the painted shapes carried by the run's points, `carry`, else rebuilt from the points: repeat-groups.js `runSeeds` / `seedGroups`); (b) a run covering the frame on screen (`runsHere`) stays first, at that frame. Order (progressive, never blocks): the frame on screen against the painted frames (first tile), the shot coarse (`coarseFrames`: every frame of a short shot, else about 48), every frame around the best pairs (`aroundFrames`: frame-exact), then the runs' frames (their decode walks every frame of their spans: the slow part) and around their best pairs. One WebCodecs decoder; prints / thumbnails cached per video by frame index (kept when the tool closes), prefetched 1.5 s after the tool opens (painted, the shot under the playhead, runs). Lining up = `alignPrints` of the pair (used when it leaves < 0.9 x the unmoved residual). Hover = peek: the video shows that frame through the player's scrub path, the groups lined up on it (`G.copyPreview`); leaving the tile goes back to the frame the owner was on. paw-trxk: the tiles rank by `tierOf` first (a source in a shot crop- or loop-linked to this one, tagged "linked ×s" / "same loop ×s"; then the run on this frame; painted frames, "similar picture"; runs' frames), and after the six numbered tiles the strip scrolls on through EVERY other painted frame (unreadable ones last, "not compared"); a line above says when the search could not look properly ("Compared only the frame on screen: the frame decoder is not responding (why)"); no decoder of its own for the file: the player's stills (`player.still`). Lining up is ONE move for the whole set: the crop / print move refined over the pixels all the groups cover (`regionOf` + `jointFit`, never part by part: the owner's "lining up needs to be all points grouped"; experiments/copy-crop/joint.mjs). Click / 1..6 = the playhead goes to that frame and the copies land as the hover showed them (each `unconfirmed`, no sidecar re-find; Suggest still re-finds parts one by one when asked), ONE undo step lands them on that frame (`landCopies`: they replace that frame's groups and the take's other frames keep theirs; if they name a part the take has on another frame, or the take is one set already, they replace the take's set, its ignore regions kept: a click never leaves a part on two frames, the paw-p42x state). Esc / C closes. Copies: source `repeat` (`run` from points) + `from` + `lined` (`moved`; `refound` from before paw-trxk): isCopy, an edit makes them the owner's. Mirrored prints are not tried (4 of 156 owner painted pairs matched better mirrored). Measured (experiments/copy-from/pairs.mjs, 31 painted frames of 5 owner projects hidden in turn): the chosen pair's print distance 0.095 vs 0.128 (closer in 30/31), but the copy's IoU with the hidden painting is not better (0.06-0.07 vs 0.076 old at the seed frame, 0.072 at the shot's first frame; measured on the painted frame, so a copy landing elsewhere in the shot is penalised; no painted pair closer than 0.05 in those projects). 1080p 45 fps (GOP 2 s), a 10 s shot, 10 painted takes, 3 runs: cold first tile 0.27 s, painted ranking final 2.3 s, with the runs' frames 4.1 s (decode-bound); after the prefetch 0.24 s; cached 13 ms (test/groups-copy-from.test.mjs, dev/groups-copy-check.mjs) |
| `commands.js` | menu Track (below) |
| `axes-derive.js` → `AxesLine.svelte` | paw-2pcf, the secondary axes (surge, sway, twist, roll, pitch) of a run: `lib/six-axis.js` measures them per shot (its header: the 3-D model, the view table, the signs, the conditioning, the confidence; paw-jyde.11: with no pair in the shot, one character's hips against the frame in its own body frame, its own table, the Shot popover's "vs frame" chip says against what and how the up / camera were taken); here they become ghosts, one per axis with data (`<run>~<axis>`, source kind `axes`, never saved, not in the run list), derived after every Track / add and on `tracking.deriveAxes`, re-derived when a shot's Angle tag (timeline/acts.js `angle`: side / rear / front / top, from Describe's views, hand-set wins; POV stays the camera tag and reads as top) or its `axflip` changes. The Shot popover's axes line (view, a meter per axis: measured / estimate / none, click = flip there), Show lanes (`tracking.addAxisLanes`), Accept axes (`tracking.acceptAxes`, one undo step); Shift+A on a secondary lane takes the selected run's ghost for it; the Simulator's dials follow them in the Track tab (test/six-axis.test.mjs, test/axes-derive.test.mjs, dev/axes-check.mjs) |
| `colors.js` | colour tokens for canvas (span states, event kinds, live, axis); `paint()` resolves them at paint time |
| `axis.js` | stroke axis: `axisOk/axisClean/axisInfo`, `axisParams(schema, mode, axis, current, aspect)` (request patch), `axisTool` (overlay pointer tool), `drawAxis` (test/tracking-axis.test.mjs) |
| `motion.js` | `cameraMotion(run, ref)`, `lowMotion(run, media)`, `motionStats(points, windows)`, `statWindows` (test/tracking-motion.test.mjs) |
| `../../lib/runs-file.js` | the `.pawruns` codec: `encodeRuns(runs)`, `decodeRuns(bytes)`, `runsPath(project)` (test/runs-file.test.mjs; store wiring: test/tracking-runs-file.test.mjs) |

Harness: `dev/tracking.html` (vite on port 5200) with a fake sidecar ported from `test/fake-pawtrack.mjs`;
`dev/tracking-drive.mjs` and `dev/tracking-check.mjs` drive it with Playwright (`node dev/tracking-drive.mjs <outDir>`).

## Store API (`const tr = trackingFor(app)`)

State (reactive): `trackers, listed, sceneParams, loopParams, describeParams (null = not installed), trackerId,
paramsBy[trackerId], sceneVals, loopVals, describeVals, roi, scenes, sceneInfo[i] {describe, loop, busy, error},
shownBoxes, batch, busy ('' | list | scenes | track | describe | loop | score), stopping (cancel asked, job not ended; T waits for it), progress {done,total}, error, notice,
runs (full records from lib/runs.js makeRun), selectedId (a ghost id), live {frames}, tick, spans, scores[ghostId],
origExists`.

Getters: `videoPath, tracker, params, locked, span ({t0,t1}: app.doc.range or the whole video), canTrack, trackBlock
(why not), cycleMarks, ghosts, reference (ghost with source.kind 'reference'), selectedGhost, selected (its run record)`;
`ghost(id)`, `run(id)`.

Actions: `ensureListed(), list(), selectTracker(id)`, `setRange(t0,t1), rangeToScene(s), rangeToSceneAtPlayhead()`,
`detectScenes(), describeScene(i), loopScene(i), describeAll(), toggleBox(i, tag)`, `paintedParts(), trackPart(name), partRoiIn(t0, t1)` (paw-x8we),
`track(), cancel()`, `scoreGhost(id), queueScore(id)`, `flipScene(i), flipRun(), flipAtPlayhead(), setChannel(id, ch)`,
`markSpan(state), setSpanState(i, s), removeSpan(i)`, `select(id), toggleVisible(id), remove(id)` (pinned ghosts are
never removed), `liveOf(axis)`, `bakeState(i, axis)`, `bake(scope)`, `unbake(scope)`, `exportBlock(ghost), exportGhost(id, overwrite), exportOverwrite(id)`
(asks first).

Runs → ghosts: a run's ghost is `{id: 'run'+n, name: '#n <tracker>', color, script, visible, source: {kind: 'tracker',
tracker, runId, range: {t0,t1}, params}}`; numbers continue past every `runN` ghost already in the document; colours skip
the editor's own blue. Flips recompose the run (its signal, below) and rewrite the ghost's script; visibility and removal go through the ghost. `app.doc.ghosts`
is always replaced, never mutated. Ghosts that are not this session's runs (the reference, imported ones, ghosts loaded
with a project) are listed too: show / hide, select, score, Accept, export, remove (unless pinned).
`setChannel(id, ch, scene?)` (per scene, below) also rebuilds the run's points from that channel (`lib/runs-channel.js` `pointsFromChannel`: per scene fill ≤ 500 ms, gaussian σ 120 ms, fit to 0..100, extremes; the sidecar's scene sign), so Accept and the ghost get it; flips / span orientations re-apply, `'primary'` (or the run's own `params.primary`) restores the sidecar's points (`points0Primary`).

Runs list (panel): only the runs overlapping the current scene (`tr.currentScene`: the timeline's selected scene, else the
one at the playhead; `lib/runs.js runsForScene(ghosts, scene)`), the selected run always; "all runs (N)" shows every one.
Nothing is deleted. The meta line of the run linked to the current scene says `scene N: <channel>`.

Channels are per scene. Scene links (project block `links`, `{v: 1, scenes: [{t0, t1, run: ghostId, channel, fit?}]}`): a
scene has at most one link (run + channel); a link belongs to a scene when it overlaps it by more than half (`linkFor`:
survives small cut edits and splits); `fit` = the `tracking.channelFit` overrides used. A run's points0 is composed per run
scene (`lib/runs-channel.js channelPatch(run, channel, fit, links)`, `sceneChannels`): that scene's link if it names this run,
else the run's default `channel` ('primary' = the sidecar's points there); its lane trace (`run.lane`, drawn by `layerOf`) is
likewise each scene's channel, a gap between scenes; the ghost script is the composed points.
- `setChannel(id, ch, scene)`: scene >= 0 changes only that scene's link (the run it named before goes back to its default
  there, both recompose); no scene / -1 sets the run's default `channel` (the Director's whole-run calls land here).
- `pickChannel(id, ch)` (lane dropdown, `pickGroup`, a group click on the video): `setChannel` with `sceneOf(run)` = the
  current scene if the run overlaps it, else the scene it overlaps most (`sceneForRun`), else the default.
- `channelFor(run, i = sceneOf(run))`: the channel the run uses in scene i (the dropdown, legend chips and lane group
  traces show it).
- `sceneLink(i)` -> `{runId, channel, ghost} | null` (live only), `linkScene(i, runId, channel)` -> bool (= `setChannel`
  with scene i); both on `api.js` too, with `currentScene()`.
- `setChannelFit(patch)`: the default and every channel link take the new fit; every run using a channel recomposes.
- Continuing actions (`lib/scenes-continue.js`): `proposed` (start_ms of scenes proposed to continue, from 16×16 grey
  fingerprints of each scene's first / last frame through a WebCodecs scrubber, recomputed 600 ms after any scene change,
  cached per video), `liveScenes(list)` (the scenes with the proposals applied, internal-view runs between two scenes of one kind included), `bridges` ($derived `[{t0, t1, script}]`:
  `follow` + carry over each cutaway with no link and no points on the active axis; neighbour points = the axis's in that
  scene, else its linked run's ghost), on the stroke (`bridgesOn(axis)`); paw-x7w7: live in the script where nothing is baked
  (no ghost, no Accept; Bake makes them permanent).
Links are never dropped; one whose ghost is gone is not live. Runs scenes are the sidecar's (the document's cuts in
`document` mode); links match them by the same overlap rule.
A run with a channel default or a link keeps on its ghost `source.keep` (`lib/runs-channel.js keepOf`): the default and every
linked channel's raw series `[[t, v|null]]`, `points0Primary`, scenes `{start_ms, end_ms, sign}`, flips, orient, roi, fit (about two
numbers per frame per channel). On video open / project load, `restoreRuns()` rebuilds a run record from each such ghost
(`runFromGhost(ghost, links)`: `restored: true`, no frames / samples / events / confidence; points = the ghost's script,
points0 recomposed from the kept channels and the links), so the lane draws each scene's channel and fit changes rebuild
it. `runsInfo()` (api `runs()`, Assist, Director) leaves restored runs out.

## Runs are saved (`<project>.pawruns`)

Rule: tracking data is never deleted automatically. Every run of the store (frames included; restored ones too) is written
beside the project, same stem, by project block `runs` (`saved` hook: `app.project.save` -> `app.blocksSaved(path)` after
the `.pawproj` is written; `saveRunsFile(path)`), and read on every load (`load` -> `loadRunsFile()`; `runsLoad` = the
read in flight, a save waits for it). Read runs (`fileRuns`) are real runs, not `restored`: frames, trails, blobs, group
picks and `runsInfo()` work; each replaces a ghost-rebuilt record of the same id, a run whose ghost is missing gets it back,
`lane` is recomposed (`channelPatch`). Projects without a runs file keep the ghost fallback (`restoreRuns`).
- Only `remove(id)` takes a run out (of the store and `fileRuns`; the next save rewrites the file without it). Open, close,
  a video change and Track never drop runs from the file.
- A new run marks the document dirty (`runTrack` -> `history.markDirty`), so Save writes it.
- A runs file this session did not read cleanly or write (unreadable / newer version: a warn toast on open; another
  project's under a Save As name) is copied to `<name>.<ms>.bak` before it is replaced. No runs and no file: nothing written.
- A failed write throws: the save toast says "Not saved: runs: ..." and the document stays dirty (autosave keeps it).
- paw-abi2: written twice per project write when runs changed: block `saving` before the `.pawproj` (every run either
  `.pawproj`, the one on disk or the new one, can name: discarded runs kept), `saved` after (a discarded run goes once the new
  `.pawproj` no longer names it). A kill between the two files never leaves a project naming a run its `.pawruns` lacks; a run
  only in the `.pawruns` opens with its ghost back. An unchanged runs file is not rewritten either time.
- Autosave writes them too, but only when they changed: `runsDirty` (set by `runTrack`, `remove`, `applyRunPatch`,
  `patchRun`; cleared by any successful runs write) -> block `autosaved` -> `autosaveRuns(dir)` writes
  `<autosave folder>/runs.pawruns` (a fixed name: snapshot pruning only touches 13-digit names; `autosave_clear` removes
  it with the folder). A tick with no run change writes nothing: one ~3 MB write per new grid run. Restoring an autosave
  (`load` gets `{autosaveDir}`) reads it when it is at least as new as the project's `.pawruns`.
- paw-o60v.3: writes never freeze the window and never repeat themselves. `encodeRunsAsync` runs in slices of ~8 ms and
  re-encodes only what changed (the codec keeps each frames object's section, filled from the file's own bytes on open, and
  each run record's manifest JSON; runs are replaced, never edited); a write whose result equals the file this session last
  wrote at that path (same mtime) is skipped. Writes go one at a time; one started under a project that is no longer loaded
  (`runsSeq`) never writes the new project's runs. Autosave waits while a pointer is down or the video plays (up to a minute).
- Format: `src/lib/runs-file.js` header. Masks (sam2 polygons) are not stored (`run.masksOmitted` = frame count; the box
  stays); a grid frame's points / boxes are rebuilt from `pts`. 256 points x 1800 frames is about 2.9 MB.

Usage notes (`app.usage`): `tracking:track` (tracker id), `tracking:gridFrame`, `tracking:describe` (scene index; describeAll notes each), `tracking:pickGroup` (g1..g4),
`tracking:setChannel` (channel).

## Run ranges: which run plays where (paw-1ysd; the rule: `lib/run-ranges.js`)

`doc.runRanges` = `[{id, run, t0, t1, layer}]` (undoable, the .pawproj extra `runRanges`, in checkpoints and commit summaries);
null = a project from before ranges: `tr.runRanges` derives them from the shots' links (exactly what played on open) and the
first range edit writes them. On a layer ranges never overlap: `putRange` trims / splits what it covers (the covered run and its
data stay); `layer` is 0 (mixing layers is not built). No range = no run plays there. The live script reads them
(`#piecesIn`: a shot can play several runs, piece by piece). `deriveRun(i)` (Adjust, fusion, shaft) = the selected range
(`tr.rangeSel`), else the one under the playhead when the shot has several, else the one covering most of it, else the link;
selecting a run in Runs only selects. A track takes the range it covered (`useRun`, one undo step); an earlier run of the same
tracker family over that span is discarded only when no range of it is left; Track as a new run (`track.beside`) takes none.
A linked shot's fill takes that shot. Store: `runRanges`, `useRun(id, t0, t1)`, `moveRangeEnd(rid, end, t)` (never past what the
run tracked: `runExtent`), `removeRange(rid)`, `invertRange(rid, t0?, t1?)` (the run's stretches xor over the range),
`unusedRuns`, `takeRange(id, t0, t1)` (a track / a fill: no undo step, folded into every state the history holds,
`history.rebase`, so undoing an earlier range edit never drops it). Restoring one section from a commit restores the ranges inside
it (clipped at its edges). The strip (`RunRangeStrip.svelte`, the top row of the lane's bottom band, 10 px; the band is two rows,
19 px: the strip, then the range overrides): a range = a clean 6 px bar in its run's colour (paw-k8pe: no name and no ± there
any more; the full title in the tooltip) and its flipped stretches (hatched): click = select, Delete removes, an end trims,
right-click = Remove / to the range's ends. The run's name and its direction are the lane toolbar's (`RunBar.svelte`, right of
Track's cog: the run chip `#3 · TAPNext++ · shot 1` = the picked run, else the one whose range plays at the shot; click = select
it / the next run here, right-click = its range's menu; the direction `normal` / `flipped` = the F command; then the shot's
source, Pair, vs camera, the fusion pad and its pin, depth, baseline in that order, the tail that does not fit in one … popover;
the band under the lane keeps ▾ (Adjust, the fusion panel), the shaft note and Detail). Click a range = select (and its run), an end = resize
(frame-snapped, Shift free; the selected run's tracked extent shows faint), a drag along a range or the empty strip = a span, then
Invert this stretch (on a range) or "Use <run>" (the runs that tracked all of it), Delete = remove, right-click = Use another run
here / Invert / Bake / Remove. The direction row under the overrides is gone (F, Flip whole run and the Track menu's flips stay).
The shaft strip is layered over the lane's foot (ShaftStrip `layered`): only its handles take the pointer (the knot line: drag,
double-click = automatic; a shot without one: the K grip; the entry line = fully out here; the foot line = hilted here; the truth
marks; the readout and its card); its hover words are the shaft data's (the data toggle), which already draws any tracked part's
depth (`part:<name>`) over the lane. Tests: test/run-ranges.test.mjs; real window: dev/runranges-check.mjs.

## The live script and Bake (paw-x7w7; the rule: `lib/script-of.js`)

The owner's "there is no apply, in fact bake is just make permanent, so a tracker run or change to fusion cannot change the
points, you never need to apply or bake". `doc.axes[axis]` holds the BAKED points (what Accept wrote before is baked, byte for
byte). Every shot with no baked points whose run (`deriveRun`, else its link; on a secondary axis that run's axes ghost, where
the axis has a lane) has points there is live: `liveSpans` / `composeLive` put the run's points in (a replace over the shot,
the join cleanup never removing a baked point), then the stroke's fills / bridges / holds / eases. `liveAll` ($derived) holds
`{script, spans}` per axis, the same object while its inputs are equal by content; `app.liveOf` (registered here) is what
`scriptOf(app, axis)` and `app.edit` read. Readers: everything that draws, edits, plays, analyses or writes the script reads
`scriptOf` / `finalOf` / `finalAxes` / `followOf` (test/script-of.test.mjs lists the allowed raw readers).
- `bake(scope)`: the live points in scope copied into the base on every axis, one undo step ("Bake shot 3" / "Bake the script" /
  "Bake #2 ..."). scope `{shots: [i]} | {run: id} | {all: true} | {range}`, none = the timeline's selected shots, else the I/O
  range, else the shot under the playhead. `unbake(scope)`: the baked points of shots a run still covers go, one undo step.
- `bakeState(i, axis)` -> `{state: 'baked' | 'live' | '', canUnbake, run}` (the Scenes row's 2 px line: solid = baked, dashed = live).
- `app.edit` settles every edit (`settleEdit`): a live shot the edit changed is baked with the edit in the same undo step;
  live shots it left alone stay live; switching tabs bakes nothing. Deleting every point of a live shot leaves it live (the
  run plays there again: there is no "baked empty" shot).
- Commands: `tracking.bake` (Shift+B), `tracking.bakeRun`, `tracking.bakeAll`, `tracking.unbake`. Old projects: a shot with
  accepted points is baked; a shot that only had an un-accepted run now plays it.

Video change (`app.doc.media.path`): scenes, runs, ROI, scores reset; span labels load from settings
`'tracking.spans:' + path`. The last tracker picked is settings `'tracking.lastTracker'`.

Scenes of a track (panel row "Scenes: document / detect / one", settings `'tracking.scenes'`, default `document`): Track
and `trackRange` (option `scenes`, default the setting) send `cuts` (PROTOCOL v3.1 / v4.9, `protocol.js trackCuts`):
`document` = the document's scene starts inside the range as `{t_ms, kind, why}`: `hard` at a real cut, `soft` where the
action continues (a camera split, a `continues` scene) and at each camera move inside a scene (`scene.camera`, a pan /
zoom / orbit / handheld starting or ending); the sidecar keeps one run through a soft cut (points, groups, pinned groups
kept; re-seed pass; its own normalisation segment) (no document scenes: like `detect`), `detect` = no `cuts`, the
sidecar's cut detector (it adds its own camera splits as soft cuts), `one` = `[]`, the whole range is one scene. The plan's
segments go through the same call, so a pan inside a planned item is a soft cut. The Why section lists the sidecar's
per-segment record (`runs-channel.js segmentLines`). The camera check's reference run always detects.

## Stroke axis

One arrow on the video, OUT end → IN end, normalised (`tr.axis = {x0,y0,x1,y1} | null`), with a quick choice
`tr.axisMode = '' (tracker default) | auto | vertical | horizontal | custom` (drawing selects custom). Stored per video in
settings `'tracking.axis:<path>'` and in the project block `tracking` (`{axis, axisMode}`). Every Track / `trackRange`
merges `axisParams()` into the request for a tracker whose schema has `axis`: custom → `axis: 'custom'`, `axis_x0..y1` and
`primary: 'proj'` (when proj is a choice and primary is still its default); a tracker without a custom axis (lk_box) gets
the nearer of vertical / horizontal with `pipe_invert` toggled so that toward IN = lower pos. The panel's Axis row (Draw /
Clear / readout / auto|vert|horiz|arrow) shows only for such trackers and replaces their axis params in the form. The tool
(`tr.axisPointer`, overlay tool `tracking.axis`): press at OUT, release at IN, or two clicks; ends draggable; Esc cancels,
Delete removes; drawn in the Track tab through env.map (glued under zoom / pan / rotation).

## The fused signal (paw-e3i, redesigned paw-iasp)

`lib/fusion.js` (pure; its header is the design): `fusedChannel(run, {aspect, derives, trackedAxis})` -> the channel
`fused` (0..1 per run scene, `conf`, `timing`, `info[k]`). Parts (repeats merged) -> bodies (each character's parts by role
and agreement) -> a fixed catalogue of relationships (`ROWS`, `SOLO_ROWS`) tilted by the shot's act tags (`ACT_ROWS`;
`runDerives` hands them over as `derive.acts`) -> fuzzy weights (rhythm, noise, presence, fit, phase against the
reference stroke, the pad) per 2 s window. `info[k]` = {bodies: [{who, parts: [{id, names, role, lagMs, coh, inBody,
say}]}], relations: [{id, label, kind, sideA, sideB, prior, gain, pad, user, rhythm, quality, lagMs, coh, phase, sign,
share, split}], scene: {acts, strength, rows}, solo, auto, mix, pad, conf, windows, candidates (the rows in the old
shape), motion (the 2-D body motions)}. A new run's scenes default to `fused` where two painted parts or more have data
(`runs-channel.js defaultSignal`). Controls: `derive.fuse = {exclude, pin, pad: {x, y}, prior, w: {rowId: mult}}`
(`rederive.js fuseClean`; ids: a part `c1_hips`, a row `c1:core~c2:core`); `tr.fuseInfo(i)`,
`tr.toggleFusePart(i, id, 'pin' | 'exclude')`. Score: `experiments/fusion` (RESULTS.md). Tests: `test/fusion.test.mjs`,
synthetic design cases `test/fusion-synth.mjs`.
The pad (TrackingLane, beside the source chip while the signal is fused): press and drag anywhere (relative motion, 120
px centre to edge, Shift fine): x relative <-> absolute, y core <-> extremities, stored as `fuse.pad` (`tr.setFuse(i,
patch, {commit, span})`: a drag step previews, the release is one undo step; inside a range override it edits the
override's own `fuse`, signal-source.js `spanClean`). Double-click / 0 = centre; the faint ring = `info.auto`. Real
window: `dev/fusion-pad-check.mjs`. paw-o60v.2: while a pad / weight drag moves (`tr.fuseLive`, until the pointer rests
120 ms), the run composes the trace only (`channelPatch` ctx.live: the fused signal and its record exactly, no HOW, no
Detail, no points; linked fills and the Smart A/B wait); a rest, the release or a cancel compose everything as a direct
set would. fusion.js keeps per analysis the automatic mix, the windows' data-only parts and the exact results per
controls (a drag re-weighs only the scene it moves). `test/fusion-live.test.mjs`; timing `dev/perf/pad-drag.mjs`.
The panel (`FusionPanel.svelte`, in the Adjust strip where "Fused from" was; shown whenever the shot is fused, re-derive
blocked or not): per body its parts (phase dial = lag / stroke period, a half turn = anti-phase; coherence; say), the
relationships (bar = share; drag sideways = `fuse.w[rowId]`, live, one undo step; double-click / ↺ = back), the scene
type's strength (`fuse.prior`) and what it raised, the pad; pin / × per part and per row; changed values marked.
paw-439e: the act tags limit themselves (lib/fusion.js FUSE `TAG_*`; `info.scene.notes` say when a tag is ignored here);
the panel's act chips turn a tag off for this shot / run (`fuse.actsOff`). Inside a range override (`tr.fuseSpan(i)`:
the row's active one) every panel control reads / writes the override's `fuse`, the panel draws the override's own
fusion record (`run.fuseSpans`, runs-channel.js; `tr.fuseInfo(i, span)`), the header says "range a–b" / "shot N" with
× clear. The standing pad (`FusionPad.svelte`: press = jump there and drag, Shift fine, the trace live, one undo step
per drag, double-click / 0 centre, arrows nudge) is in the panel and, pinned from the chip's pin button, floats
(`tr.fusePadPin`, its title bar moves it); the same value as the chip. Real window: `dev/fusion-panel-check.mjs`.
paw-t11b, HOW: fusion also describes how each half-stroke goes (`lib/fusion-how.js readHow`, its header is the design),
from every part it read (`fusion.js voicesOf`; also the parts with no say in the depth): per turn the parts' dwell (the
band dwell per part, their say-weighted median), where the rest starts / motion resumes, the impact (the move still
speeding up into the stop x the unexplained motion that rings after it: a swinging ball), its strength, and which parts
said so; per half its shape from the most confident parts; the halves of the whole scene sorted into types (tempo, size,
shape, the dwell they leave). `info[k].how` = {turns, halves, types, secondary, used}; the channel's `how` (every used
scene, by time) is what the Detail reads (`stroke-shape.js shapeFit o.how`: decided per type, the parts' dwell x (1 +
impact / 2), their shape, blended with the signal's measure by the evidence's conf; turns never move; loops keep one
layout). `used` only where the scene has a secondary part (tracked, < 5 % say in the depth): measured against the owner's
scripts it is not clearly better everywhere (`experiments/fusion/how-score.mjs`); elsewhere the Detail is as before.
Tests: `test/fusion-how.test.mjs`, synthetic tracks `test/how-synth.mjs`. The fusion panel shows it ("How"): a strip over
the shot (a cell per half-stroke in its type's colour, a tick per turn as tall as the parts' rest, a red dot for an
impact, the playhead) and one line for the stroke under the playhead (its type, shape, the turn it lands on: rest and
the parts that say so, impact and what rings, the hold score at the shot's sensitivity), or that HOW is not used here.
Real window: `dev/fusion-how-check.mjs`.
paw-na9u, Detail by render (the default; `+ mid + hold` is the old Detail, one chip away): the owner's "shape the curve
knowing how it renders, not based on linear estimation". `stroke-shape.js renderScript` is the generic device model (a move
from rest to rest is an S, a point inside a move is passed smoothly; checked against the Capstan's Kinetic2), `fitLeg`
picks 0-2 points per half-stroke whose rendered curve follows the trace (a price per point, x the parts' disagreement on
the bow: `readHow` halves `agree` / `by`), `flatTest` keeps a point next to a turn a flat hold only where the trace is level
within its noise (else a sloped 'shoulder'). Turns never move; a point that would break the speed cap is left out. The
Tracker lane draws the device's curve of the run's points (a thin light line) and a point's tooltip names the parts that
support it. Numbers: `experiments/detail-render/RESULTS.md`. Tests: `test/detail-render.test.mjs`; real window:
`dev/detail-render-check.mjs`.
References (paw-qynw, `lib/references.js`, `ReferenceStrip.svelte`): Tracker row right-click › Use as a reference… over
the shot (or the I-O range) of ONE run: a strip on the timeline, drag = strike a region out, click a strike = back,
Enter saves `<data folder>/references/<hash>_<run>_<t0>-<t1>.json` (`tr.saveReference`; nothing beside the video), Esc
cancels; "saved ▾" lists this video's records (go there / remove). `experiments/fusion/score.mjs` scores them.

Signal row (paw-9qm, `lib/signal-source.js`, pure; test/signal-source.test.mjs, test/signal-row-e2e.test.mjs opt-in):
a shot's `derive.source` (a channel id: `fused`, `rel:a:b`, any channel; wins over the scene link's channel; Smart
stroke takes it through the strokes step instead of `fused`) and `derive.against` (absent = the camera as `derive.cam`
says; `none` = camera removal off; a group key = the source relative to that part: `resolveSource` makes a single part
the pair `rel:part:against`, `fusionInput` makes fusion's centres relative to it). With a camera override (or against)
fusion's inputs are re-handled like the projected channels (`fusionInput`); none set: the stored centres, as before.
Range overrides: the scene fact `signal = {spans: [{t0, t1, source?, against?, cam?}]}` (`setSignalSpan`,
`signalSpans`); `channelPatch(…, ctx.spans)` splices each override's channel into its run scene's signal (`splice`:
mapped onto the base's range there, sign aligned, smoothstep cross-fade over `BLEND_MS` 300 ms at its ends); a scene
on the sidecar's own points keeps them outside the override windows. Store: `tr.setSource(channel, span?)`,
`tr.setAgainst(against, span?)`, `tr.setSignalCam(patch, span?)`, `tr.setSpan(span, patch | null, {to, commit})`,
`tr.signalSpans`, `tr.sigSel`, `tr.signalPreview`; `tr.pickChannel` now writes the scene's source (one undo step).
paw-hiq5: the row's strip edits `tr.activeSpan` (the selected override, else the one under the playhead, else the shot's own; the label says
"range a–b" / "shot N", × clears it); `tr.addSignalSpan(t0, t1)` (frame-snapped, a copy of the shot's source / against / explicit camera,
selected) is what a drag in the row's thin band (y 18–31) and the command `track.signalOverride` call; a segment's body drags to move, its ends
resize, right-click = Whole shot / Remove, Delete removes the selected one. Camera removal precedence (`effectiveCam`, rederive.js): the
override's `cam` > the shot's Adjust `cam` > the camera tag's default (`CAM_TAG_DEFAULT`: turntable and rides-the-stroke = off) > as tracked;
a chosen mode is explicit (`cam.explicit` keeps a chosen auto), `camState(i, span)` -> {cam, from, tag}; `runDerives` puts the tag default
under untouched shots as `cam.tag` (it never swaps the sidecar's points: `userReprojects`), pairs and fusion read it (`camInput`).
API for the video overlay (paw-ufv): `tr.setPair(a, b, span?)`, `tr.signalState(t)` -> {runId, shot, source, pair,
against, override, parts, fusion: {candidates, windows, weightsAt}}, `tr.pairPick` + `tr.pickPairPart(key)` (two
tracker clicks = a pair). The g1..g4 motion groups have no chips or legend in the panel / Shot popover / lane any more
(the picker lists them last; `tr.pickGroup` and the overlay's group click still work; old projects load as they were).
paw-0sn8 (jitter; measured in experiments/fusion/RESULTS.md): `FUSE.JIT`, per shot / range in `fuse.jit` (fuseClean keeps
only `{dir: true}` / `{refine: 0}`), the panel's **Signal** chips. *smooth* (default on, `refine` 0.15): a quadratic
Savitzky-Golay pass over the fused signal and its timing series, half-width 0.15 x the stroke period (twice the 25th
percentile of the turn-to-turn intervals, or the fused rhythm when clear and shorter), easing back to the signal itself
within `REFINE_KEEP` half-widths of each turn, so turns, impacts and the Detail's lopsided strokes stay; fusion's HOW reads
the unrefined signal. *direction* (default off, `dir`): one stroke direction per scene (each row's own direction = the
angle where its motion repeats; the scene's = their axial mean by prior x gain x rhythm^2; rows within `DIR_SNAP` read along
it, a row's share of motion across it lowers its window weight, `DIR_COH`). Always (`rel`): `REL_ROWS`, the Top sheath /
knot against the Bottom body and the penis against its base (the balls swing on their own and stay out; the knot counts
there like a genital part). A row's 2-D motion is now built from its sides' velocities (a part seen part of the time is
centred on the frames its other side shares). info: `dir` {u, from: 'axis' | 'scene' | 'lead', label, contact {a, b}}, `jit`,
and per part `rel`, `vs` (what it is read against: its strongest relationship's other side, or 'the frame') and `dirCoh`
(that relationship's share of motion along `dir`). The Fusion view draws `dir` as a double arrow at the contact (between the
leading relationship's sides) and each part's motion across it as a thin tick beside its along arrow.

## Anchors: local evidence for fusion (paw-wg2d, paw-ze8n)

`lib/anchors.js` (pure; test/anchors.test.mjs, test/anchors-store.test.mjs; numbers: `node experiments/anchors/measure.mjs`). The
owner parks on a frame and marks it fully in (pos 0, Alt+0), fully out (pos 100, Alt+Shift+0) or the middle (pos 50, Alt+M),
as many of each as he likes: the same key on the same frame takes it off, on any other frame adds one. Stored on the shot
(`scene.anchors = [{ms, pos}]`: undoable, in the .pawproj, no run in it, so a re-track keeps them); `anchorsOf(doc)` lists
them all ({shot, ms, pos}) for measurement scripts.
- `runDerives` gives each run scene `derive.anchors` (every anchor inside it: the shots of one tracked scene share them);
  `channelPatch` hands fusion each anchor's sign as it will play (scene sign x whole-scene flip x a flipped stretch over it),
  decides the s80k match on the anchor-free fused channel (as without anchors) and redoes the anchored one if that flips it.
- `fuseScene` with anchors: `anchorLocal` on the forward result (cached as ever; paw-ze8n, the owner's "a signal to fusion,
  that it needs to look elsewhere for the motion"). Sections = where the forward window weights drift apart (`SPLIT`; the cut
  moved to where the leading rows come or go); a section's anchors in groups one candidate can meet (anchors within a window
  that none meets = one compromise, said so). Per group the candidates are the automatic mix and every row with either sign,
  scored by an extreme of the right kind on each anchored frame (`fitAt`), their turns' steadiness around the anchors
  (`TIMING`) and agreement with the automatic mix away from the anchors (`ELSE`); the automatic mix stays within `TIE`. A
  chosen row mix is set to the automatic level / size there, shifted by the anchors' median turn offset, snapped locally
  (offsets of `STILL` frames or less: no change). Reach: the group's range, and where the chosen motion disagrees with the
  automatic one at the anchors only as far as that disagreement lasts; a 1 s ramp inside each end; nothing outside (the
  automatic samples, and the channel keeps the automatic scale: `range`). `info[k].anchors` = {list [{ms, pos, want, before,
  reads, moved, section}], sections [{t0, t1, n, met, use, flipped, shift, compromise, unchanged}], rms}.
- `autorange` rangePlan: each cluster of anchors (`ANCHOR_REACH`: within 6 s, +-3 s around) is a piece of its own reaching 0 /
  100 at the anchored end; the rest of the shot keeps its band (a hand-set band still wins).
- UI: a diamond per anchor on the Tracker row, as high as its pos (in vermilion at the bottom, out sky at the top, middle
  lime): drag = move frame by frame inside its shot (`tr.moveAnchor(a, ms, {commit: false})` through `detailPreview` and the
  fusion drag's trace-only compose; release = one undo step), click = go to its frame (then Delete / Backspace removes it),
  right-click = remove it / every anchor of the shot. The fusion panel lists the sections: what each did and why, its anchors'
  residuals. Not handled: loop averaging (after fusion) softens a snap where the other passes have no anchor; a fused range
  override does not see the shot's anchors.
## Smart stroke and the strokes step (paw-e3i part 2)

`lib/strokes.js` (pure): `strokes(t, v, {smoothMs, minStroke, minMs, range: scene | follow | local, detail, maxSpeed,
sign, timing, conf})` -> {points [{at, pos, why}], low [{t0, t1}]}: the sidecar's `to_points` ported (Savitzky-Golay,
local-range prominence, alternation, sub-frame, min interval, speed clamp) plus min stroke duration, the range policy
(scene = drift over two strokes removed, then p2..p98), detail by tolerance, a timing series, low-confidence spans.
`pointsFromChannel(run, name, {strokes})` uses it (and returns `why`, `low`); `channelPatch` routes a scene there when
its shot derive has `smart` (channel `fused`) or `strokes` (its signal; the sidecar's pick from `run.samples`), and
returns `whys` / `low` for the lane. Store: `setSmart(i, on)`, the A/B preview ghost `smart-ab` (`#publishSmartAB`,
never saved, not a run; paw-89bd: only on a shot switched on by hand in this session, `smartABRun`), `whyAt`. Tests: `test/strokes.test.mjs`, `rederive-e2e`.
paw-lji3 / paw-83sq: the owner's new run (`#arrive`, `rederive.js arrivalShots`, no undo step) writes `smart: true` on the
shots it covers where it can fuse, and a re-track carries each shot's settings on the run it re-tracks (`deriveRun`, else
the newest other run there; not its `unflip`, not a source the new run lacks). Off by hand is `smart: false` (kept);
absent stays classic, so older runs play as they did. Tests: `smart-default`, `fusion-runs`.
paw-s80k: a shot on a signal of its own (Smart stroke's fused, the source chip, a camera / axis re-derive) plays the same
way up as its scene's own channel (link / run default; the sidecar's samples for 'primary'): `channelPatch` correlates the
two over the run scene and adds one whole-scene flip where r <= -`MATCH_R` (0.3); |r| below that: left as it comes
(`extra.match` [{ref, r, flip, weak}] -> `run.match`, the direction strip's tooltip, `polarity.js matchText`). Only on
derives with `match` (every `setDerive` / `#putScene` write since; older ones keep their orientation and the flips made
against it). A flip is the exact mirror for every DEPTH / Detail (`test/smart-flip.test.mjs`).

## Flipped stretches (paw-57ve)

`lib/polarity.js` (pure; its header is the design; test/polarity.test.mjs, test/polarity-store.test.mjs, dev/polarity-check.mjs):
a stretch `[t0, t1)` of a run scene whose signal is flipped relative to the rest of it (the measured sense flops mid-shot:
the motion right, upside down from some frame on). Applied in `channelPatch` (`ctx.flips`): the scene's signal (overrides
spliced in) mirrored about the middle of its range inside the stretch, each join continuous (the gap to the unflipped
side's extrapolated next value fades out over `BLEND_MS` inside); a scene on the sidecar's points takes the flipped
`__samples` inside (± BLEND_MS) and keeps its points outside. Extremes, the strokes step, the Detail, the lane and the
ghost all read it; the patch's `flipSpans` (the owner's stretches over the run, as the strip edits them) and `dir`
(what was applied) are on the run.
Stored on the shots per run (`shot.polarity = {[runId]: [[t0, t1]]}`, each stretch on the shot under its middle; split at
the run's cuts, touching ones merged): undoable, saved in the .pawproj; `flipPreview` = a drag's live list.
Store: `flipsOf(run)`, `setRunFlips(id, list, {commit, label})`, `flipStretch(t0, t1)` (xor), `flipToEnd()`, `flipRange()`.
Strip (TrackingLane): a click on a scene still flips it; a drag along it flips the stretch (xor); a stretch: click =
select (Delete removes), body drag = move, ends = trim, double-click an end = to the shot's edge, right-click = Extend /
Remove. Not seen through it: runsInfo's per-scene `sign` (runsInfo has `flipSpans`), repeat-direction's sources.

## One direction, on the signal (paw-vtec)

A run's direction is ONE map, applied to its signal before anything direction-dependent reads it, never to its finished
points (`lib/polarity.js` `directionOf`; test/polarity-direction.test.mjs, test/polarity-store.test.mjs, dev/direction-check.mjs).
Inputs: the sidecar's scene sign (already in its points and samples; a raw channel takes it in `pointsFromChannel`), the
owner's whole-scene flips (`run.flips`: F, a strip click, `flipRun`, the repeat-direction pass; stored as before, with the
run / `ghost.source.keep`), Assist's span orientations (`run.orient`, absolute inside their span, over the scene flips) and
the stretches (`shot.polarity`, relative, xor). Per run scene: **whole** (the scene's sign x -1) when the map covers the
scene (so a stretch over a whole scene IS a whole-scene flip), none when it is empty, else the owner's scene flip;
**partial** = where the map differs from that (flipChannel, above). `channelPatch` applies it: whole = the scene's sign in
`pointsFromChannel` (the classic fit, the strokes step: shapes, holds, mids, the shaft's depth anchoring, the timing series),
the sidecar's points mirrored before the Detail dresses them (`points0Primary` stays the sidecar's), the Detail's signal
and the lane trace in the played direction; partial = the stretch path. So `points0` plays as it is: `applyRunPatch` on a
`flips` / `orient` change recomposes the run (no `orientedPoints` any more), the stitch reads `points0`; `shaftDirection`
reads the points that play. Averaged loops: a partial flip applies at the same phase in every pass (`loopFlips`, by the
phase maps), since the passes carry one signal. The sidecar's `__samples` is `signed` (its sign is not applied twice;
it used to be under sign -1). The fusion panel's out / deep and the graph's run source read `signAt(run, t)`.
A .pawruns from before (points0 unflipped, the flip mirrored after): at load a run with flips takes `points0` as composed,
its points as saved. On the owner's saved runs (his video folder, 50 runs, 16 with flips) the change moves no point.

## Track direction (paw-bh2)

`direction.js` (pure): `directionSpan(shots, seed, dir, {range, near, duration})` -> the request span and the hard cuts
crossed; `throughCuts` (every cut soft); `progressBand` (the lane's band from the seed). Store: `direction` (settings
`tracking.direction`), `setDirection`, `trackDir(d)` (commands `track.forward` / `track.backward` / `track.both`, for the
Tracker chip too), `trackJob` {dir, seed, t0, t1} while it runs, `markCameraMoves(shots)` (the offer's action). A one-way
`track()` skips the plan path and sends `direction` + `seed_ms` (sidecar v4.15: the range cut at the seed, the run stops
where its points are lost: note `lost`); the run keeps `seedMs`, `direction` and the range it really covers.

## Groups added later: the second seed (paw-o74b)

A part that starts off camera (the camera tilts down later in the shot): each group keeps its own seed frame (`g.t_ms`),
so the owner paints it on the frame where it is in view. The Groups tool edits the groups seeded on the frame on screen
(`G.groups`; `G.all` = the take's, `G.others` = seeded elsewhere, `G.seedFrames`); on any other frame of the take (its other
shots too) a stroke ADDS groups seeded there, never divides the take (only "New groups for this shot" does). The others are
drawn dimmed where a run tracked them on this frame (`G.othersHere()`, `lib/runs-add.js trackedPoly`: the painted outline
moved by the group's image-space displacement, its centre + camera; dotted where no run has it) and listed under the
groups ("Seeded on other frames": seed frame(s), a click goes there; a part seeded on this frame too is not drawn again).
Suggest on such a frame stays on it.
Track (T, the chip, the quick bar, `tr.track()`): `addPlan(span)` = every group painted in the span is in a run covering its
frame (the selected run, else the shot's linked one, else the newest; points runs with stored frames) except some new ones
(`newForRun`: by name, seed frame and outline fingerprint, `run.groupSeeds`; another frame of a part the run has is new: another
seed; a run made before: its `sem_<name>_x` channels), none changed, and those runs cover the span: then only the new groups are tracked (`#addGroups`: one sidecar
call per run scene and seed frame, v4.45 `groups_only` over that run scene, both ways from the frame, stopping where their
points are lost) and merged into the run (`mergeAdded`: their channels on the run's frame times, NaN where not tracked;
centres re-expressed against the run's camera, `_proj` recomputed per run scene; points appended with fresh pinned ids;
`scenes[k].groups` records; `groupSeeds` with the tracked `span`; a `groups_added` note); the run's own channels, frames and
points are the same objects. A failed / cancelled add leaves the run as it was. A shot still on the run's old default
signal takes the new one (fused once two parts have data). Otherwise Track makes a new run as before; a fresh run with
groups on several frames of one take seeds on the earliest (`splitSeeds`) and adds the others right after. A changed
outline, or the command `track.full`, tracks everything again (a new run). Fusion: a part with a span ramps its say in its
body and its rows' weights from 0 over `FUSE.JOIN_MS` at a span edge inside the scene (no step where it comes into view;
runs without spans are unchanged bit for bit). Tests: test/runs-add.test.mjs, test/track-add.test.mjs (the fake
sidecar's `fake.groups`), test/groups-new-shot.test.mjs, trackers/tests/test_user_groups.py; real window:
dev/groups-seed2-check.mjs.

## One part seeded on several frames (paw-o74b.1)

The owner's "a turntable is impossible but being capable is the point": the same part (same who_part_side, same name and
colour) may be painted on any number of frames of a take, re-anchoring it where its look changed (an orbit, a part that turns,
drift). Never twice on one frame (a frame's names are free names of that frame). In the tool: painting a part seeded elsewhere
is another seed of it (no refusal); a plain stroke over a part's dimmed tracked outline proposes that part (`trackedUnder`:
more than half of the stroke inside it; a fixed proposal, Enter takes it like any confident one; the picker / 1 / 2 / 3 still
decide); Suggest names a suggestion after the tracked part under it. The dock shows the part once per frame with its seed
frames as chips (`G.seedsOfPart`: click = go there; Delete deletes that seed only); "Seeded on other frames" lists each part
once with its frames; Copy from… adds seeds (`landCopies`: the copies replace that frame's groups only). An older take
(paw-p42x census: a fill / copy / Suggest beside the owner's groups) is a multi-seed take now; its groups that cannot be seeds
are dropped once when the tool shows the take (`groups.js tidySeeds`: a frame outside the scene, one part twice on one frame:
the later kept; one undo step, a toast), and `trackGroups` keeps the later of two same-frame twins.
Tracking: every seed is tracked both ways from its own frame (the first frame of the take in the run's call, every later seed
in its own `groups_only` call, as a late group: no sidecar change, PROTOCOL unchanged) and merged as ANOTHER SEED of the part
(`mergeAdded`): the part keeps one set of channels `sem_<name>_*`, stitched across its seeds inside its take
(`lib/seed-stitch.js`): per frame the seed with the nearest seed frame among those whose track holds the frame (a handover half
way; a seed lost early leaves its frames to the nearest one still holding them, either side; nobody holds it: a gap, NaN);
at each handover the incoming track is aligned to the outgoing one on the frames both hold (median difference for centres /
angles / projections, median ratio for scales, each seed aligned once, chained from the first stretch: the two paintings'
offset never becomes a step or a ramp), then cross-faded (smoothstep) over min(500 ms, the distance between the seed frames)
centred on the handover; `_proj` is recomputed from the stitched centre. Each seed keeps its points under its own pinned id
(drawn in the blobs view only where it owns the frames: `ownsAt`; its own painting carried by them: `carriedPoly`) and its
own track in its `groupSeeds` entry (`track`: {t0, ch: {sfx: [v | null]}} at 7 significant digits, `id`, `own` = the
stretches it owns, `take`). The store re-stitches when the document's seeds change (`restitchSeeds`, a scene effect: a seed
deleted or hidden, or brought back by an undo: no tracking; one seed left = that seed's own track again; a seed repainted
since it was tracked does not count: its outline fingerprint differs, T tracks everything again). Fusion's join ramp uses the
union of the part's seeds' spans (no ramp at a handover); six-axis fits a multi-seed group per seed and stitches the fits
(the change of point set at a handover is no turn). Tests: test/seed-stitch.test.mjs, test/runs-seeds.test.mjs,
test/track-add.test.mjs, test/groups-new-shot.test.mjs; real window: dev/groups-mseed-check.mjs (run / reopen), dev/smoke-check.mjs;
the owner's example measured on a generated turntable: trackers/experiments/multiseed/ + experiments/multiseed/stitch.mjs.

## An erase stays erased (paw-yx6q)

The owner's "if I erase a section, it pretty much needs to be erased from that section, sam loves growing back". Cause: a grow
erase only sent negatives (SAM's answer was kept whole), the positives under it stayed in the group's SAM state, the next dab sent
SAM's old mask back as its prompt, and a plain erase dropped the SAM state so the next dab started over without it. Now every
erase stroke's sweep goes into the group's record `g.erased` ({w, h, rle}, saved with the group); `#finish` (the one door every
stroke, SAM answer, dial, fill and fill-to-edge goes through) cuts the result by it; SAM gets the record's inside as negatives,
the positives under it dropped and the mask prompt cut; cleanMask / the dial / fill treat it like another group. A paint stroke of
the same group (brush, grow stroke, circled loop) lifts the record where it paints. A grab / scale moves it with the group.
Track sends it as `erased` outlines (PROTOCOL v4.53, `groupFp` includes it): no points seeded there, the shaft pass's mask cut
there on the painted frame. Tests: test/groups-erase-stays.test.mjs, trackers/tests/test_erased.py.

Grow is a smooth blob, never arms (same bead): a dab walked up SAM's levels to the largest under LEVEL_MAX x, and SAM's larger
levels take in similar-coloured thin things touching the part. grow.js `openArms` (an opening at OPEN_FRAC x the blob's width, on
its box) gives the share it takes and how far the thin bits reach from what is left; `hasArms` = at least ARM_MIN of it reaching at
least REACH_MIN widths (ears, fingers, a ragged edge reach less). The dab steps back down from such a level (`pickMask` `arms`, the
app only: Suggest's seedsam.walk_up is unchanged), cleanMask (`arms`) opens such arms away and keeps the piece with the prompts,
and the brushed stroke is always kept (`stroke`). Measured on generated pictures through SAM 2.1 tiny (not on the owner's frames):
a limb touching similar strands / a crossing limb / a torso, 30 dabs and scribbles: IoU with the limb 0.689 -> 0.875, area off the
limb 29 % -> 6 %, results with arms or a neighbour (> 15 % off) 15 -> 3 (the 3 left: a compact torso broadly touching the limb,
no arms); parts that must grow whole (striped / two-tone limb, hand with fingers, tail, head with ears), 18 dabs: IoU 0.895 ->
0.893; pick + clean ~11 -> ~14 ms per answer. Test: test/groups-grow-arms.test.mjs.

## The knot is a section of the penis (paw-njnf)

The owner's "you paint the penis, then the knot within that group, it won't need assigned, and it's not required, an absence means
no knot". A penis group may carry `g.knot` ({w, h, rle}, always inside its own mask): the knot brush (K, the dock's dot button)
paints it on the penis under the stroke (else the active one; no penis there: nothing, a toast), Shift erases it, one undo step, a
darker shade of the penis colour (colors.js `knotPaint`); never a group to create, name or assign (PICK_PARTS: not in the picker,
its chips, auto-naming or the modifiers' arms; Find knot, Shift+K, sets the section). An erase or a repaint of the penis keeps
the section inside it; G / S move it along. Track sends it as the penis entry's `knot` outlines (PROTOCOL v4.54; groupFp includes
it): the penis' seeded points inside it are a labelled subset of the penis (one fit, one re-placement, cf8565c) and the sidecar
reports their centre as `sem_<who>_knot_*`, the channels an old knot group had, so lib/shaft.js (the knot place on the shaft
strip) and fusion's knot part read it unchanged; no section = no such channel = the readers' no-knot path (the shaft pass's own
bulge finder still runs on knotting scenes). Old projects (groups.js `foldKnots`): a knot group overlapping or touching (2 mask
px) a penis of the same character on the same frame becomes that penis' section (the penis takes its pixels): in Track's request
always, in the document when the tool shows the take (one undo step, a toast); any other knot group stays and tracks as before.
paw-adxi (PROTOCOL v4.59): a hidden section's members wait for it (no re-seed moves them onto the rest of the shaft), a re-seed
whose place in the penis' layout is inside the section joins it, and while none of its members shows its centre is carried by
the penis' fit with `_n` 0 (the knot keeps its place on the shaft strip while it is inside the partner); the shaft pass takes the
section as its base-end hint as it took a knot group (shaft.py BASE_PARTS); the learned seeder trains its knot class on the
sections (7e73c91). Tests: test/groups-knot-section.test.mjs, trackers/tests/test_knot_section.py,
trackers/tests/test_knot_section_reseed.py.

## Adjust after tracking (paw-a3n)

A finished points run is re-derived from what it stored, no sidecar: `lib/rederive.js` (pure; parity with the sidecar's
`stroke_proj` through `test/fixtures/rederive-run.json`, made by `trackers/tests/rederive_fixture.py`) recomputes `proj`,
`proj_cam`, every `{group}_proj` with a stored centre, and (axis not auto, or a zoom / rotation camera) `pair_proj` and
the characters' distances, per run scene, from `centroid_x/_y`, `cam_x/_y`, `{group}_x/_y` and the frames' `pts`.
- Settings live on the shot: `app.doc.scenes[i].derive = {cam?: {mode: auto|off|move|zoom|full, strength, source:
  background|all, smoothMs}, axis?: {mode: auto|vertical|horizontal|custom, x0..y1}}` (`deriveClean`: overrides only).
  Undoable (`setDerive(i, patch, {commit, scope: 'shot'|'scene'})` = one `app.transact`); a drag sets `derivePreview`
  ({t0, t1, derive}, no history) and its release commits. The store's effect recomposes every run whose run scenes'
  derives changed (`runDerives`, `channelPatch` ctx.derives). Derived channels feed the points and the lane only; they
  never replace `run.channels`.
- A re-derived scene on the sidecar's pick builds its points from that pick's channel (the decision record's `chosen`),
  through the channel path (no cadence fill / detrend there).
- `camPeek` + `camCompare`: the lane's dashed no-camera trace while a camera control is dragged. `cameraAtT` drives the
  stabilised preview (`player.stab` returns `{x, y, s, th}`; `video/view.js stabilised`).
- A live shot follows every control at once; the strip's last button bakes it ("Bake this shot") or, baked, gives it back
  ("Baked · Unbake").
- `deriveBlockFor(i, needPts)`: why a shot cannot be adjusted (restored run, no centroid / camera, no `pts` for
  move / zoom / full): shown as "Re-track needed".
- The axis tool edits a shot's axis when `toggleAxisTool(true, shot)` (`axisTarget`), live while dragged.
- UI: `DeriveStrip.svelte` at the top of the Runs section. Browser check: `REDERIVE_E2E=1 node --test test/rederive-e2e.test.mjs`.

## ROI

paw-x8we: nothing draws an ROI on the video. Track ROI (`track.run`, Ctrl+T) tracks ONE painted part (`roi-part.js`: the parts in the
range, one per name; the tracker: the panel's when it takes a box and is not a grid tracker, else `sam2_mask`, whose seed is the
painting (v4.39 `groups`) and whose value is the part's size against the seed; the box any tracker needs = the painting's bounds +
10 %), over the shot its seed is on, through `runTrack` as the grid (take, replace, select). Several parts: a kit menu at the pointer
(the part under the pointer, else the last pick on that shot, first; `tr.partHover` outlines the row's part); args `{part}` /
`{all}` (the old panel Track: every painted part / a box set by code). `tr.roi` is a PENDING roi set by code only (an internal-view
plan, Fix's re-track, a selected old box run re-tracked with its stored box, scripts): a Track moves it into the run (`run.roi`)
and clears it. The overlay draws the live / selected run's own roi only.

## Checks on every run

- `run.lowMotion = {px, low, source}`: p5–p95 spread in frame px of the raw `raw_px` channel, else `centroid_x/y` × frame size,
  else the overlay frames' centre. low (< 3 px): a warn toast and a chip ("almost no motion: 1.8 px").
- `run.cameraMotion`: after each run (not for whole-frame runs) a whole-frame reference is found (a whole-frame run covering the
  range, e.g. the draft's base track) or made (`draft/logic.js pickTracker` → lk_box on the whole frame, `axis: auto`, a hidden
  ghost tagged `camera`, reused); per run scene |r| of frame-to-frame changes, and the share of moving frames that move
  together. flag = score ≥ 0.7 and together ≥ 0.6 → warn toast and chip ("tracks the camera: 0.91"). `{pending}`, `{skipped:
  reason}` (no primary signal, …), `{error}`. Busy label `camera`; a panel Track stops the panel's own check. "Check camera
  motion" in the run, command `tracking.checkCamera`.
- Jobs: `startedAt` (the panel shows elapsed time, and "waiting for the GPU" until a describe reports progress); describe
  fails after `settings 'tracking.describeTimeoutS'` (default 180) seconds with no event; a cancel the process ignores ends
  the job after 3 s; failed / cancelled panel jobs toast.

## Commands (menu Track)

| id | keys | when |
|---|---|---|
| `track.run` | Ctrl+T | Track ROI: one painted part (paw-x8we; see ROI); enabled: canPart / canTrack (or a live selection of shots that is not one unbroken run, tracked by `{all}`: `trackPicked`, paw-25g) |
| `track.gridFrame` | T | Track (paw-rw84: THE Track, the primary button everywhere; was the "Grid" button, no key): Track tab, canGrid (or a modifier seed in the Groups tool / a selected modifier in the focused Modifiers row: that modifier, as before): a point grid over the whole frame = Track with the selected point tracker (else TAPNext++, else CoTracker; offline mode for CoTracker), box 0,0,1,1, grid of settings `tracking.gridPoints` (512). Its overlays carry `pts` (PROTOCOL v3.1): the overlay draws ~0.4 s motion trails (hue = direction, alpha / saturation = speed) unless `tracking.trails` is off (`groups`: coloured by motion group, `blobs`: the blobs diagnostic view, blobs.js: per moving group a hull + centroid path, optional points / camera grid / axis + pair / labels / velocity, the tracker dock on the left edge (TrackerDock.svelte) and an opt-in Info card with a sparkline, options in settings `tracking.blobs.*`, docs/guide/tracking.md; clicking a group, or its legend chip, makes `g{k}_proj` the lane channel) |
| `track.full` | | Track tab, canTrack: a new run of every group in the range, never only the groups painted since (paw-o74b) |
| `track.cancel` | Escape | a job runs (registered before the shell's Esc, which keeps working otherwise) |
| `track.flipAtPlayhead` | F | Track tab, a video: flips the scene of the run playing at the playhead (paw-3cbm) |
| `track.flipRun` | | the selected run has scenes |
| `track.flipToEnd` | | a run selected: from the playhead's frame to the end of its run scene, flipped (xor; paw-57ve) |
| `track.flipRange` | | a run selected and an I-O range: the range flipped in every run scene it touches, one undo step |
| `tracking.bake` | Shift+B | something live: the selected shots, else the I/O range, else the shot under the playhead, made permanent (paw-x7w7) |
| `tracking.bakeRun` / `tracking.bakeAll` / `tracking.unbake` | | the selected run / the whole script / the run plays live again |
| `track.export` | | the selected ghost can be exported |
| `track.detectScenes`, `track.describeAll`, `track.rangeToScene` | | a video / scenes, not busy |
| `track.describeScene` | | hidden; args `{index}` (else the scene at the playhead): Describe one scene — the scenes lane's context menu runs it |
| `track.listTrackers` | | not listing |
| `tracking.anchorIn` / `anchorOut` / `anchorMid` | Alt+0 / Alt+Shift+0 / Alt+M | a video, a shot under the playhead: an anchor (pos 0 / 100 / 50) on that frame, again = off (paw-wg2d) |
| `tracking.axisDraw` | X | Track tab, a video, the graph not focused (graph.swapAB has X there) |
| `tracking.axisClear` | | an axis |
| `tracking.axisCancel` / `tracking.axisDelete` (hidden) | Escape / Delete | the axis tool is on |
| `tracking.checkCamera` | | a run of this session is selected, not busy |
| `track.span.active` / `idle` / `carry` / `climax` / `orgasm`, `track.spans.fromPlan` | | hidden (no keys, no menu): span labels derive from the scene tags at Track time (acts.js tagSpans); a manual label still wins where it overlaps |

## App members used

`app.doc.media` (path, fps, width, height), `doc.range`, `doc.ghosts`, `doc.axes`, `doc.activeAxis`, `app.durationMs`,
`app.edit`, `app.select`, `app.undo`, `app.player` (timeMs, playing, frameMs, seek, pause, el?.seeking),
`app.view` / `app.setView`, `app.mode`, `app.settings.get/set`, `app.toast` (with action), `app.confirm`, `app.task`,
`app.sidecar`, `app.commands.keysFor`, `app.backend` (sidecar, cancelSidecar, exists, readText, writeText, readBytes, writeBytes),
`app.registerBlock` (`tracking`, `runs`, `links`), `app.history.markDirty`, `app.doc.project.path`.
From other areas: `lib/protocol.js`, `lib/runs.js`, `lib/lane.js`, `lib/video.js`, `lib/core/script.js`, the kit's
`Icon` and `tooltip`, and `features/video/roi.js` (drawRoi, drawFrameOverlay, drawTagBox).
