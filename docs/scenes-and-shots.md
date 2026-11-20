# Scenes and shots (paw-2zy)

A **scene** is the act: who, where, what, modifiers, the drawn groups. It is tagged once.
A **shot** is a camera span inside a scene: its cuts, camera kind and view, its fill. Every scene has at least one shot
and its shots tile it with no gaps.

Code: `src/features/timeline/shots.js` (pure). In memory `app.doc.scenes` stays the flat, contiguous list of shots in
the sidecar's scene shape, so every per-span consumer (links, runs, bridges, lanes, track requests) keeps working.
A scene is a run of shots: `join: true` puts a shot in the scene of the shot before it. The scene's fields are copied
onto each of its shots and kept identical by `normScenes`, which `app/doc.svelte.js` runs on every write: a writer may
change one shot's tags or groups and the whole scene follows (the shot edited since the previous list wins; with no
edit, as after a merge, the first shot wins and the others' differing fields become the scene's `offers`).

## Where each field lives

| Field | Lives on | Notes |
|---|---|---|
| `start_ms`, `end_ms` | shot | the scene's span is its first shot's start to its last shot's end |
| `join` | shot | `true` = same scene as the shot before; `false` = the owner split the scene here (never re-joined by Group shots); absent = a scene starts here. Saved as the scene's `apart: true` |
| `split: 'camera'` | shot | the cut before it is a camera move inside one take: tracked through (soft cut), same point ids and channels. A joined shot without it follows a hard cut: reseeded, same scene |
| `tags`: where, what, modifier, structure | scene | one diff for the scene; a span `{id, t0, t1}` is absolute time inside the scene (each shot clips it to itself) |
| modifier spans (orgasm, knotting, throbbing, idle) | scene | kinds: acts.js `SPAN_KINDS` (one table). `{id, t0, t1}` entries, any number per scene (timeline/mods.js, paw-8qb): absolute times, clipped per shot / scene when read; a merge keeps both scenes' spans, a moved boundary keeps them, a scene-wide modifier is stored as a span over its scene; consumers read `spansOf(list, id)` -> `[[t0, t1]]` or acts.js `tagSpansIn`; an effect of the span's kind family (`SPAN_KINDS` fx: Knotting over knotting) with exactly a span's times is tied to it and follows it (mods.js followFx in state `setScenes`, also live while dragging), its own edit detaches it; idle (paw-d8u) is the structure tag idle as a span: it counts on a shot only where it covers the whole shot (then the shot is idle), a part of a shot is the sidecar's idle label (acts.js tagSpans) |
| `tags`: view (internal, off-screen, blank), camera | shot | the camera chip and view chip act on a shot |
| `describe` | shot | what the tagger saw in that span; view tags and the internal-view shaft box come from it |
| `scene_describe` | derived | multi-shot scenes only: the first described shot's describe; the act tags come from it (acts.js autoTags). Never saved |
| `structure` | derived | acts.js withStructure, per list, never saved |
| `groups` | scene | drawn once; each group keeps the frame it was drawn on (`t_ms`), so a shot is seeded by the groups drawn inside its take (shots joined by camera moves). A take after a hard cut gets the scene's groups re-found under the same names (`suggest_groups` `prior`, PROTOCOL v4.13), stored with `unconfirmed: true, prior` until accepted or repainted |
| `fill` | shot | Fill from before / after / both, or `timing` (paw-b26): the turn times from the shot's own tracked points (an off-screen shot with this fill is tracked, for its timing only), the depth from the shots before and after eased across; Flatten bakes a fill that waits. A shot fact since paw-sxu ("I should also be able to fill cuts"): the scene's fill = every shot of it (Fill the scene sets them all), Fill this shot / Fill N shots exactly the selected ones. See **Fill** below |
| `range` | scene | the Autorange band |
| `detail` | scene | the stroke Detail (paw-izk, `lib/detail.js`): `{shape?, sens?, spans?: [{t0, t1, shape, sens}]}`; shape / sens = the scene default (absent: + Midpoint + Hold, 50), spans = overrides with absolute times: exactly a shot's times = that shot's override, else an area. Clipped to the scene when read; a merge keeps every scene's spans and a later scene's differing default becomes a span over its shots; a moved cut leaves spans where they were. An old shot `derive.strokes.detail` tolerance migrates on load to its shot override |
| `signal` | scene | range overrides of the run's signal (paw-9qm, `lib/signal-source.js`): `{spans: [{t0, t1, source?, against?, cam?}]}`, absolute times, clipped to the scene when read; source = a channel id (`fused`, `rel:<a>:<b>` a pair, any channel), against = `camera` / `none` / a group key, cam = camera removal `{mode, strength, source, smoothMs}`. A merge keeps every scene's spans. Absent in old projects: nothing changes |
| `tease` | scene | the Autorange gap fill mark |
| `offers` | scene | `[{t0, t1, tags?, groups?, range?, tease?}]`: the later scene's facts after a merge; Accept applies (tags over [t0, t1], groups added), Drop removes, splitting the scene at `t0` again gives them back. A merge never offers a fill (it stays on its shots); an offer's `fill` (made before paw-sxu, or by migrating an old flat list) fills the shots of its span on Accept or on a split at `t0` |
| `camera` | shot | pawtrack camera.py segments of that span |
| `kind` (`blank` / `still`), `transition` | shot | Detect scenes |
| `loop` | shot | an animation loop is a camera-span fact |
| `cum` | shot | proposed spurt times, keyed by time |
| `sign`, `auto_sign` | shot | detection fields; the stroke direction the owner sets lives on the run / its scene link |
| `continues` | gone | `true` became the join on load; `false` (the owner's "no") stays on the shot so proposals keep respecting it. Proposals still write `continues: 'auto'` on the live list (never stored) |
| scene links (`links` block), runs | per shot span | unchanged: keyed by time span |

## How a boundary looks (paw-p2p0)

A hard cut and a camera move must read apart at a glance, by shape, in the row's own grey inks and no new colour: filled
= cut, hollow = move, one ink quieter (`--tx-mut`). Code: shots.js `boundaryTimes`, `blockShade`, `boundaryWord`; draw.js
`drawGrip`.

| Where | Hard cut / scene start | Camera move (`split: 'camera'`: pan, zoom, handheld ... whatever the shot's camera tag) |
|---|---|---|
| Shots strip | solid line through the strip, notch at the top, filled grey grip | no line, no notch: the same grip hollow; the shot's number then its camera glyph (pan's arrows when it has no camera tag), a size larger; the shade carries on (one take = one block) |
| Filmstrip | solid line, filled grey grip | short ticks at the top and bottom, the grip hollow |
| Ruler | filled triangle on the bottom edge | the same triangle hollow |
| Script lanes (guides), overview, waveform, plan | ticks / hairline (a scene start: a faint line) | nothing |

Selected or under the pointer, a move shows the same full-height highlight as a cut.

Hit areas and gestures are the same for both (drag, click, double-click merge, right-click). The tips say "Cut ..." or
"Camera move (zoom), not a cut ...". The vocabulary it avoids: hatching = positioning, dashes = proposed / unconfirmed,
dotted = approximate. Owner on a first try with a sky colour, a glow, arches and round badges: "it doesn't match anything else".

## Saved shape

The `.pawproj` extra `scenes` holds one entry per scene:
`{start_ms, end_ms, apart?, groups?, fill?, range?, tease?, offers?, ..., tags? (act), shots: [{start_ms, end_ms, tags? (view / camera), split?, camera?, describe?, fill?, ...}]}`.
An entry without `shots` is the old flat format: `fromSaved` migrates the whole list.

`fill` is written on the scene when every shot of it has the same fill (so a project saved before shot fills, or one
whose fills are all whole scenes, saves byte for byte as before), else on each filled shot (and not on the scene). On
load a shot's own `fill` wins, else the scene's: a scene `fill` keeps meaning every shot.

## Migration of an old project

Each old scene becomes one shot. Neighbours become one scene when:
1. the later one is a camera split (`split: 'camera'`): the same take;
2. a stored `continues: true` link: the continuing shot and the cutaways / internal views before it join the action's scene; the old timeline's structural proposals (an off-screen run, or internal views between two shots of one act) count the same;
3. they have the same where and what (not empty), neither is blank or a structure scene, and the same fill, band and tease (`groupShots`).

A link-join (rule 2) whose later shots had another fill than the first: they take the first shot's fill and theirs is
offered, as before fill was a shot fact, so an old project loads as it did.

Joined shots lose nothing: every act tag any of them had is kept over the hull of where it was (a modifier on the last
shot becomes a span), the groups of all are kept (each on its own frame, so each shot keeps seeding from its own), a
link-join's differing fill / band / tease becomes an offer. View and camera tags, describes, runs and links stay per
shot.

## Repeated frames as evidence (paw-ef73.4)

The app's repeated frames (`media_repeats`, timeline/repeats.js) feed the structure through
`timeline/repeat-scenes.js` (pure) and `timeline/repeat-offers.svelte.js`:
- **Camera move inside a loop**: right after Detect scenes, a `split: 'camera'` boundary whose frames on both sides are
  one loop, phase continuous (the cycle goes on across it: a moving close-up read as a zoom / pan) is joined, one undo
  step, a toast with Undo, fix log `auto:shots.loopJoin`. Weaker evidence (both frames repeat, or the two shots share
  >= 3 pictures) is a badge on the boundary.
- **Cut off by 1-2 frames**: the frames next to a hard cut recur only in the other shot: a badge offers the corrected frame.
- **Same footage**: shots in different scenes that share >= 3 pictures: a badge on the later scene's boundary offers one
  scene from the earlier shot (whether a position change is a new scene stays the owner's choice).
- Badges sit on the boundary at the top of the Scenes strip: click = apply (one undo step), right-click = no (kept in
  `doc.repeats.no`).
- **Loops**: where the repeats show a loop's passes back to back (>= 3 at a steady period), it is marked in the Loops
  row as an automatic loop (`auto: {key, t0, t1, end, n}`: dashed, its passes drawn faint, an × at their end removes it,
  remembered in `doc.repeats.off`); never over a loop already there; moved, resized or tiled it is the owner's.

## Tracking across shots

- Track tagged scenes plans one item per scene: its trackable shots in segments (one track request each), off-screen /
  blank / filled / insertion shots skipped inside it (bridged / generated), internal-view shots their own item (SAM).
  A filled shot is skipped on its own (a timing fill is tracked, for its turn times), whether its scene is filled or not.
- Inside a request: a camera split is a soft cut (one run through it), a hard cut inside the scene is a hard cut
  (reseed), as before.
- The script's level carries across every cut inside a scene and resets at a scene cut (runs-channel stitch `smart`).
- An off-screen shot inside a multi-shot scene is a `carry` span for the sidecar (the act goes on unseen).

## Fill (paw-sxu)

A filled shot is not tracked: its strokes come from the shots around it (lib/scenes-continue.js `fillSpans` /
`fillScript`, previewed in the lime Bridges and holds ghost, Accept or Flatten writes them).

- **Where (since paw-ef73.2):** the fill is no longer a setup choice: a cutaway sets its own (below). The four fills
  stay for projects that use them: the Scenes row right-click › *Older fill choices* (the whole scene, and the selected
  shots of part of a scene): ← From before, ↔ From both sides, → From after, ⌁ Timing from this shot, No fill. The
  Scene chip popover shows its *Fill (older)* row only on a scene with one fill on every shot. The commands `timeline.scene.fill.before` / `both` / `after` / `timing` / `off` / `accept`
  (unbound) act on the selected shots, else on the whole scene at the playhead. The same choice again turns it off.
  One undo step each ("Scene fill …" for whole scenes, "Shot fill …" otherwise).
- **Looks:** a filled shot is a cutaway card (below); the scene block says "fill from both sides" when every shot has
  the same fill, else "2 cutaways".
- **Neighbours:** the shots before and after in time, in the same scene or the next / previous one. Adjacent shots with
  the same fill are one span (across a scene cut too), its sides the shots around the run. Adjacent filled shots with
  different fills are separate spans; each reads the nearest shots that are not filled (`fillSpans` a / c).
- **Structure edits:** a fill follows its shot. Cutting a filled shot: both halves are filled. Merging two shots: the
  merged shot keeps the first one's fill (as its other shot facts). Starting a new scene, merging scenes, moving a scene
  boundary: no shot changes fill (a merge offers nothing for it).
- Track, Autorange's unseen rule, the timing fill, Detail on the generated strokes, Accept and Flatten all read the
  shot's `fill`, so a shot fill and a scene fill behave the same.

## Cutaways (paw-ef73.2)

Owner: a cutaway (the bottom's penis, feet swaying) while the act goes on off camera is not a new scene, it is a layer
on top of it, like cameras layered in a video editor. A **cutaway** is a shot with a `fill`, or tagged off-screen (the
older mark, bridged). Nothing new is stored: the cutaway is read from those fields (shots.js `isCutaway`,
`cutawayMode`), so Track, Accept, Flatten, Autorange and Detail keep their meaning and old projects save byte for byte.

- **One choice per cutaway**, mapped onto `fill`:
  - *motion from the scene underneath* (the default) = the fill that reads the scene's own shots around the cutaway
    run (`sceneFill`): `both` in the middle of the scene, `after` when the run starts the scene, `before` when it ends
    it (`both` for a scene of cutaways only: its neighbours). An off-screen shot without a fill reads as this too (its
    bridge carries the scene's strokes).
  - *track this cutaway* = `timing`: tracked for its turn times, the depth from the shots around it.
  - any other fill (a `before` in the middle of a scene, chosen before cutaways) is kept and shown as that fill;
    one press of *motion from the scene* replaces it.
- **Marking:** `Alt+C` (it was `C` before paw-qbvj: C is circle select now) in the Scenes tab or while the Scenes row has the keyboard (`timeline.shot.cutaway`), the small
  button on the hovered / selected shot (on a card: its two choices), the right-click's *Cutaway* item, or the Shot
  chip popover's *Cutaway* button; not a drag (paw-ef73.18: dragging a shot up fired by accident and competed with the
  range select). Off
  removes the fill and the off-screen tag. Marking or unmarking refits the neighbouring cutaways that follow the scene
  by their fill (a pair at the scene's end both read `before`). The choice: `timeline.shot.cutaway.scene` / `.track`.
- **Looks:** a raised card over its scene (rising into the scene block, a shadow under it), the scene's colour running
  on in a band beneath; the scene block stays unbroken. The card says "scene motion" / "tracked" / "fill ←" (an older
  fill). A proposed cutaway (lib/scenes-continue.js) is a dashed card; click its raised part to take it (one scene,
  that shot a cutaway).
- ponytail: the `scene` fill is written for the cutaway's place when it is set; moving a cut across it later leaves the
  old value (then shown as that fill) until it is set again.
