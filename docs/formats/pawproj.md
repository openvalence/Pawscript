# .pawproj

Specification text: CC BY 4.0; implementing it needs no licence ([README](README.md)).

A Pawscript project: one UTF-8 JSON file, by default beside the video with the same stem (`clip.mp4` ->
`clip.pawproj`). Pawscript writes it continuously (about a second after each change), atomically (a temp file in the
same folder, then a rename).

## Shape (version 4)

The smallest file Pawscript opens (only `format`, `version` and `axes` are required on read; every other key is
optional):

```json
{ "format": "pawproj", "version": 4, "axes": { "stroke": [[0, 100], [500, 0], [1000, 100]] } }
```

The core keys, as Pawscript writes them:

| key | what |
|---|---|
| `format` | `"pawproj"` |
| `version` | integer, now 4 |
| `app` | `{"name": "Pawscript", ...}`; other keys a file had there are kept |
| `createdAt`, `savedAt` | ISO 8601 times |
| `media` | the video, or `null`: `{path, relativePath?, name, size, hash: {algo, value} \| null, durationMs, fps, isVfr, width, height, hasAudio, frameCount, fpsRational: {num, den} \| null, startMs?}` (unknown numbers `null`) |
| `axes` | `{axis: [[at, pos], ...]}` |
| `activeAxis` | the axis being edited; written only when it has a script in `axes` |
| `playheadMs` | written only when known (a pack's project); Save leaves it out (where you were is kept per user, not in the file) |
| `chapters` | `[{id, t0, t1, name, color}]` |
| `bookmarks` | `[{id, at, note}]` |
| `loops` | `[{id, t0, t1, tiledTo?}]` |
| `plan` | `[{id, t0, t1, kind, recipe, params}]` |
| `ghosts` | `[{id, name, color, visible, source, script: [[at, pos], ...], pinned?, ...}]`: the overlay scripts (tracker runs' points, the reference copy of an opened funscript); previews are never written |
| `profileId` | string or `null` |
| `settings` | the project's own settings object (`{}` when none); never the app's settings |
| `view` | `{start, span}` or `null` (Save writes `null`; a pack writes the view of the moment) |

- Times are milliseconds from the start of the video (`at`, `t0`, `t1`, `playheadMs`, `durationMs`).
- `axes`: one array per axis, keyed by axis name (`stroke`, `roll`, `pitch`, `twist`, `surge`, `sway`, `vib`, ...; T-code
  ids such as `L0` are accepted on read). Each point is `[at, pos]`, integers, `at` >= 0 in ms, `pos` 0..100 where **0
  is deepest and 100 is fully out** (the funscript convention). Points are sorted by `at`, one per `at`.
- On read, `chapters`, `bookmarks`, `loops`, `plan` and `ghosts` entries need a non-empty, unique string `id`; spans
  need `t0` <= `t1`; a `plan` entry needs a string `kind`.
- `media.path` is absolute on the machine that wrote it; `relativePath` is relative to the project file. A reader
  should try `relativePath` first, then `path`, then a file with the same `name` and `size` (and `hash`, when present)
  beside the project.
- `bookmarks` are the marks Pawscript writes into a funscript's `metadata`, `chapters` the ones it reads from it (see
  [funscript-metadata.md](funscript-metadata.md)).
- Not saved: selection, play state, undo history (that lives in `.pawhistory`, below).

## Other top-level keys

Every other top-level key is a block. On load Pawscript keeps every key it does not know, unchanged, and writes it back
on every save (a writer must do the same); a block of a feature that is there replaces its own key on save, and is
removed when the feature has nothing to keep. Pawscript's own blocks (their inner shape is Pawscript's working data, not
fixed by this document; a reader may ignore them):

| key | what |
|---|---|
| `scenes` | the shots (detected or edited cuts) and their tags |
| `acts` | the action regions |
| `modifiers` | the modifiers on the timeline (`[{id, kind, t0, t1, params?, muted?, label?}]`) |
| `finish` | the finishing stack's settings (`{autorange, strength, policy, applied?}`); always written |
| `repeats` | the frame picked per repeated-frame loop, and hand edits of fades |
| `runRanges` | which tracker run plays where (`[{id, run, t0, t1, layer}]`) |
| `bakedEmpty` | live run pieces whose every point was deleted: baked with nothing in them, nothing plays there (`[{axis, t0, t1}]`; absent: none) |
| `graphs` | node graphs (`{v, items}`) |
| `timeline` | the ruler mode |
| `transitions` | the fades and dissolves found in the video |
| `tracking` | the tracking axis and the run counter (`{axis, axisMode, runSeq?}`; `runSeq`: the highest run number given, never given again) |
| `links` | which run carries which scene (`{v, scenes}`) |
| `loopLinks` | loop pairs found and compared (`{v, done, pairs}`) |
| `review` | review marks set aside (`{ignore}`) |
| `draft` | the Draft script steps' state |
| `director` | the experimental Director's decisions |
| `assist` | assist answers |
| `scriptFiles` | the funscripts beside the video as Pawscript last wrote them (`{v, files: [{path, sha256}]}`) |
| `published` | the published version (`{v, version, commit, at, key, adopted?}`, see funscript-metadata.md `publish`) |
| `pawscriptAutosaveOf` | autosave copies only: the base path of the document the copy belongs to (or `null`) |

Read but no longer written: `fx` (version 2's effects, turned into `modifiers` on load).

## Versions

Older versions (0, 1, 2, 3) are migrated on read; a newer one is refused ("update Pawscript"). Version 4 differs from 3 in
the modifier kinds: an `insertion` / `pullout` modifier is read as a `knotting` with `params.mode` `none` (its `from`,
`to`, `push` kept, `arrive` as `popAt`), a `climax` modifier is dropped, and a toast says so. Version 3 differs from 2 in
keeping effects (`fx`) and modifier spans apart (both become `modifiers`), and 2 from 1 in what plan kind `climax` means.

## Beside it

- `<stem>.pawruns`: the tracker runs ([pawruns.md](pawruns.md)).
- `<stem>.pawhistory/`: `undo.json` (the undo stack), `index.json` (`{v: 1, checkpoints: [{id, at, label, auto, keep?,
  key}]}`) and `<id>.pawproj` (the project at each checkpoint). Pawscript's private working data: not a public format.
- `name.bak`: the previous version of a file Pawscript replaced but had not written itself.

Reference implementation: `src/lib/io/project.js`, `src/app/project-logic.js` (`projectDoc`, `appDocFrom`)
(GPL-3.0-or-later). Conformance: `test/format-specs.test.mjs`.
