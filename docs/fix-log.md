# Fix log and feedback notes (paw-dze)

Two local records of where the owner had to step in, written for an agent to read in a later session. Nothing leaves the
machine. Files live in the app's local data folder (`data_dir` in Help › About; on this machine
`%LOCALAPPDATA%\app.pawscript`):

| file | what | written by |
|---|---|---|
| `usage-YYYY-MM-DD.jsonl` | every usage event, now also the fix log's raw facts (`auto:*`, `ok:*`, `fix:*`) | `src/app/usage.svelte.js` |
| `fixes.jsonl` | one line per closed episode | `src/app/fixlog.js` (FixLog) |
| `feedback.jsonl` | one line per feedback note (and per deletion) | `src/features/feedback/feedback.svelte.js` |

All three are append-only JSONL, written through the same sink (`fileSink`: the backend's atomic `writeText`, a file it
cannot read is never overwritten). None of them is the settings file. The fix log and the usage log follow the setting
`usage.log` (off: nothing of either is recorded). Feedback notes are saved even then: the owner typed them on purpose.

Read it: `node dev/fix-report.mjs [data dir] [--since YYYY-MM-DD] [--project <id or part of the video name>] [--json]`
(Help › Fix log: copy report command, in the dev server only, copies it with the data dir). Sessions from before the fix log are replayed from
their raw events: the undo steps' labels and the tracker notes; scene numbers are unknown there (positions come from
the playhead) and the from / to values and point summaries are missing.

## Feedback notes

`` ` `` (Backquote; works while the video plays; not from inside another text field) opens one line in the status bar.
Enter saves, Esc cancels, every key stays in the field (Space types a space). A leading `!` = bug, `?` = confusing,
`+` = like (a small chip shows the tone); anything else is a plain note. Notes show as dots along the bottom of the
Chapters row (colour by tone; hover reads it; click selects and seeks; Delete / X or right-click › Delete removes it).
Help › Show feedback notes on the Chapters row toggles the dots (setting `feedback.markers`); Help › Copy feedback log
path copies the file's path.

A note line: `{t, s, k: 'note', id, tone: note|bug|confusing|like, text, project, video, at (ms), frame, scene, shot,
sel: {shots (1-based), points, range}, mode, tool (groups|axis|pair|''), focus (the panel / lane that had the keyboard
before the field), axis, run: {id, tracker, source, pair?, against, direction, override?} | null, zoom (visible ms),
playing, recent: [the 15 usage events before it, {t, k, d}], screenshot: null}`. A deletion: `{t, k: 'delete', id}`.
The note is mirrored as usage event `note:feedback` and lands in the fix log's episode at its time.

No screenshot: WebView2 has no cheap capture of the window with the video element masked (it would need a new Rust
command around `CapturePreview` plus hiding the video for a frame, or a new DOM-rasterising dependency); the context
fields above say what was on screen instead.

`project` everywhere is `'n' + FNV-1a hash of the video's file name` (`fixlog.js projectId`): never a path, the same
before and after the project first saves. `video` is the file name only (as `project:open` already logs it).

## How fixes are detected

`app.svelte.js` feeds `FixLog` from two places, both in the store / commands layer (never from raw keys):

- every undo step (`History.onRecord(label, patches)`): its label plus a cheap diff of the patches (`diffPatches`: the
  changed stretch of each script by identity, per-shot key changes of `doc.scenes`, effect adds / removes / edits, the
  finishing settings);
- every usage event (`Usage.tap`): tracker runs, channel picks, flips, cumshot detection, settings, undo.

`Detector` turns them into facts; `Grouper` puts facts into episodes; `FixLog` stamps each fact with project / video /
scene / shot (from the doc's shots and the playhead), writes it to the usage log as a raw event (with `autoStep` and
`autoS`: what the app had produced for that target and how long ago), and appends each closed episode to fixes.jsonl.
It never throws into the app (every entry point is wrapped). Runtime cost: per undo step one identity scan of the
changed arrays (the history does the same scan already) and JSON of the few small shot values that changed; nothing per
frame; the point-edit summary runs once per episode close (below).

### Facts

`{t, kind, key?, project, video?, scene?, shot?, t0?, t1? (video ms), at? (playhead), sceneT0?, sceneT1?, auto?, manual?, axis?}`.
`kind` is `auto:<step>` (the app produced something), `ok:<step>` (the owner confirmed it as is) or
`fix:<area>.<what>` (the owner changed it). `key` separates targets within an episode (a group name, a setting key).

| kind | from | manual / auto fields |
|---|---|---|
| `auto:shots.detect` | step "Detect scenes" | whole video |
| `auto:shots.loopJoin` | step "Camera moves inside a loop joined" (paw-ef73.4: right after Detect scenes, a camera-move boundary whose frames on both sides are one loop, phase continuous; `scenes:loopJoin` in the usage log has the times; kept = no cut put back there) | whole video |
| `auto:describe` | `tracking:describe` | (live only) |
| `auto:seed.suggest`, `auto:seed.refind` | "Groups: suggest", "Groups: re-found after a cut" | auto.n |
| `auto:seed.repeat` | "Groups: auto from <m:ss>" / "auto from the run at <m:ss>" (paw-8mf4: an empty take filled from a repeated frame on selecting it; kept = its episode has no fix; edits of its groups are `fix:seed.repaint` with src repeat / run) | auto: from, kind |
| `auto:track.run` | `tracking:runEnd` (not cancelled / failed) | auto: run, tracker, picked, points, lowMotion, direction |
| `auto:signal.direction` | `tracking:repeatDirection` (paw-zl3n: a new run's scene flipped at arrival to agree with a decided span showing the same pictures; kept = no `fix:signal.flip` on the span after it) | auto: run, from (the decided span), n (shared pictures), r |
| `auto:strokes.accept` | "Accept <run> (replace / merge)" | auto: run, mode; the accepted span is kept for the hand-edit summary |
| `auto:fill.accept` | "Accept fill (...)", "Accept fills", "Accept bridge" | span kept like an Accept |
| `auto:finish.autorange` | "Autorange on" | whole video |
| `auto:spurts.detect`, `auto:spurts.place` | `timeline:cum.detect`; "Add N spurts (proposed cumshots / balls ...)" | auto.n, from |
| `auto:fx.knotting` | "Add Knotting effect" (its params are fitted) | |
| `auto:structure.proposals` | `scenes:continuesProposed` | whole video |
| `ok:seed.accept` | "Groups: accept ..." / "Accept re-found groups" | the suggestion taken as is |
| `ok:structure.cameraMoves` | "Cuts tracked through: camera moves" | the offer taken |
| `fix:seed.paint` | "Groups: paint X" / "erase X" on the owner's own or a new group | group, new (no group of that name: from scratch), suggested (suggestions in the take), own, erase |
| `fix:seed.repaint` | paint / erase of a suggested group | group, src (seeder / tagger ...) |
| `fix:seed.name` | "Groups: assign unassigned_N → X" | the owner's painted group named |
| `fix:seed.reassign` | "assign / rename A → B", "A → B" (other character), "swap A ↔ B" | from, to, suggested |
| `fix:seed.swapWho` | "Groups: swap Bottom and Top" (older logs: "swap C1 and C2") | |
| `fix:seed.delete` | "Groups: delete X", an erase that removed it | group, suggested |
| `fix:seed.dropFill` | "Groups: drop the filled groups" (the fill removed; Ctrl+Z of it shows as `fix:generic.undo`) | |
| `fix:seed.move`, `fix:seed.split`, `fix:seed.flag`, `fix:seed.frame` | move / scale, split / drop patches, pulse / depth / skip, move to this frame | group, flag |
| `fix:track.retrack` | a `tracking:runStart` over at least half of an earlier run's span | manual: what changed: tracker, params {k: [from, to]}, direction, seedMs, range |
| `fix:track.cancel`, `fix:track.error`, `fix:track.discard` | run cancelled, failed, deleted | tracker, s, error, run |
| `fix:signal.channel` | `tracking:setChannel` (a channel override of the sidecar's pick) | from, to, sidecar |
| `fix:signal.source` | "Signal: source" (a pair is the source `rel:<moving part>:<against part>`) | from, to (shot derive.source) |
| `fix:signal.against`, `fix:signal.camera`, `fix:signal.axis`, `fix:signal.fuse`, `fix:signal.shaft`, `fix:signal.derive` | "Signal: measured against", camera removal / "Camera mode", "Stroke axis", "Fusion:", "Shaft:", "Adjust after tracking" | from, to |
| `fix:signal.range` | range overrides ("Signal: source of a range", resize, ...) | key: source / against / cam |
| `fix:signal.flip` | `tracking:flip` (a scene or the whole run), `tracking:orient` (a span) | run, all, span, sign |
| `fix:strokes.detail` | "Detail: <shape> (scene / shot / area)" | to, level |
| `fix:strokes.simplify`, `fix:strokes.smart`, `fix:strokes.step` | "Simplify ...", "Smart stroke on / off", "Strokes: <what>" | |
| `fix:strokes.points` | any other step that changes only points ("Move N points", "Delete points", "Add point", "Edit point", "Cut", "Paste", "Record", "Scene depth", ...) | label; key `accept<N>` inside an accepted span; `points` at episode close (below) |
| `fix:strokes.pointsSummary` | (usage log only) the summary written at episode close | see below |
| `fix:strokes.acceptUndone` | undo of an Accept / Accept fill | label |
| `fix:finish.autorangeOff`, `fix:finish.policy`, `fix:finish.range` | "Autorange off"; "Autorange policy ...", "Autorange: <device>"; "Autorange: S<n> range / lock / leave / back to / clear", "Range: ..." | finish keys from / to |
| `fix:fx.add`, `fix:fx.remove`, `fix:fx.retime`, `fix:fx.params`, `fix:fx.knotting` | "Add X effect", "Delete effect(s)", "Move / Resize effect", "Effect: X", mute / un-bake; a Knotting effect edited | kind, what, dt, n |
| `fix:spurts.hand`, `fix:spurts.drop`, `fix:spurts.move` | "Add spurt / throb" (U), a spurt deleted, spurts moved | kind |
| `fix:structure.cut`, `.merge`, `.split`, `.take` | "Cut", "Move cut", ...; "Merge scenes / shots", "One scene with cutaways"; "Split scene", "New scene"; "Shot: hard cut / same take" | what |
| `fix:structure.offscreen`, `fix:structure.tag` | "Scene tag: Off-screen / Internal / Exposed / Blank"; any other scene tag | tag |
| `fix:structure.fill`, `.mods`, `.continues` | "Scene / Shot fill ..."; modifier spans (orgasm, throbbing, knotting); "Scene continues the action" | to, what |
| `fix:generic.undo` | an undo of the step made within 10 s before it | label, s |
| `fix:settings.revert` | a setting changed and set back within 5 min (not the Machine panel's view settings, layout, brush) | key, via |

A step no label rule knows is classified by its diff (cuts, joins, derive / detail / fill / range / signal / tags
changes); steps that generate points (Assist, Director, Import, Autorange fill / apply, ...) are not hand edits.

Not hooked (no store-layer event to hook; a bead tracks them): Simplify's preview dismissed without Accept; the
Groups tool's brush strokes cancelled before release; describe results replaced by a re-describe (only the tag edits
after it count); a fill chosen and then replaced by an Accept of a run over it is two facts, not linked.

### Episodes (fixes.jsonl)

A fact joins the open episode of its session and video whose video span holds its time (its t0..t1 middle, else the
playhead); facts with no time join the latest open one; whole-video facts (scene detection, Autorange on / off /
policy, proposals) share one episode per video. A new episode spans the fact's scene (its run of joined shots). An
episode closes after 2 min with no fact on it (checked on every fact and every minute), before another document
loads, and when the window hides or closes. Repeats of one fix kind on one key are one item with `n` and a `chain` of
their values (a retry chain); repeated automatic outputs are one item with `n` (per tracker for runs).

```
{t, s, kind: 'episode', project, video, scene, shot, t0, t1 | whole: true,
 auto: [{step, t, n?, what}], ok: [{step, n, key?}],
 fixes: [{kind, key?, n, t, s (seconds from the anchor), manual (the last value), chain? (all values), points?}],
 notes: [{t, id, tone, text}],
 cost: {s: seconds from the first automatic output (else the first action) to the last fix, n: fix actions},
 text: 'S3 · shot 12 (1:23.4–1:31.0): tracked (tapnext_points, picked sem_c1_penis); flipped direction; changed source fused -> rel:sem_c1_penis:sem_c2_hips 2x; points by hand: moved 9, ... · 85 s, 14 actions'}
```

### Hand edits of accepted points

An Accept (and an accepted fill / bridge) keeps a reference to the script it wrote and its span (no copy: scripts are
immutable). Later point steps inside that span mark it. When an episode over that span closes, `pointEdits(accepted
points of the span, points there now)` runs once: unchanged points (same at and pos) are skipped, the rest are paired
nearest in time within 400 ms (moved) or counted as added / deleted:
`{n, moved, added, deleted, dtMax, dtSum, dpMax, dpSum (pos units), where: {turn, mid, hold}, accept, axis, t0, t1}`
(where: the accepted point's place in its stroke: turn = both neighbours on one side, hold = a neighbour within 2
units, else mid; for moved and deleted points). The summary is cumulative since the Accept: a later episode over the
same span writes a newer one with the same `accept` id (read the last). A new Accept over the span replaces the old
reference; undoing the Accept drops it.

## The report (dev/fix-report.mjs)

1. Top problems ranked by total manual cost and by frequency: rows "automatic step -> what the owner did" (the
   episode's first automatic output; for an episode without one, the latest earlier output of the fix's home step in
   that session and video, e.g. a cut moved long after Detect scenes -> `shots.detect`), episodes, actions, total and
   median seconds (an episode's cost shared by its fixes by their action counts), where (video and scene).
2. Per video and scene: episodes and notes in the order they happened, as sentences.
3. The feedback notes with their context.
4. Retry chains (one target, one kind, two or more different values; every re-track chain) and undos within 10 s.
5. Automatic outputs left as they were: per step, episodes, untouched (no fix in the episode and no later fix
   attributed to it), rate; and the confirmations (`ok:`).
