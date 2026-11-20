# lib/io — pure (de)serialisation

Text <-> objects only; the Rust side does file IO. Import from `src/lib/io/index.js`.

## funscript.js
- `parseFunscript(textOrObject)` -> `{script, meta, raw, notes}`. Tolerant (floats, unsorted, duplicates, missing fields, BOM, numeric strings,
  `channels.stroke.actions` layout); every repair is in `notes`. `inverted:true` flips pos on load (editor shows 100 = out) and back on save,
  same as `runs.js funscriptDoc`. `range` is kept (meta.range, raw) but not applied. Throws `Error('not a funscript: ...')`.
  `meta = {version, inverted, range, source:'actions'|'channels.stroke', title, creator, description, durationMs, chapters:[{id,t0,t1,name,color}], bookmarks:[{id,at,note}]}`.
- `serializeFunscript({script, meta?, raw?}, {chapters?, bookmarks?})` -> object; `stringifyFunscript(file, {indent?, ...})` -> text.
  Only `actions`, `inverted` (if meta.inverted is boolean) and, when `chapters`/`bookmarks` are passed, `metadata.chapters/bookmarks` change;
  every other key (and its order) of `raw` survives, as do extra keys on matching chapter/bookmark entries. `raw: null` -> fresh
  `{version:'1.0', inverted:false, range:100, actions}`.
- Marks: `readMarks(metadata, endMs)`, `formatClock(ms)`/`parseClock(v)` (`HH:MM:SS.mmm`).
  **Unverified, from memory of OpenFunscripter**: `metadata.chapters[{name,startTime,endTime}]`, `metadata.bookmarks[{name,time}]`, clock strings,
  `metadata.duration` in seconds. Chapter `color` is our own extension. `funscript.js marksOf` reads the same keys.

## axes.js
App axis ids are AXES names (`stroke, roll, pitch, twist, surge, sway, vib, ...`); T-code ids are accepted and mapped.
`axisName(id)`, `axisPath(videoPath, axis, {alt})` (`clip.mp4` -> `clip.funscript` / `clip.roll.funscript`; `alt` = `clip.pawscript[.roll].funscript`),
`axisPaths(video, axes)`, `parseAxisFile(path)` -> `{base, axis, alt}|null`, `discoverAxes(videoPath, listing)` -> `{found:{axis:{path,alt}}, alternates, other}`,
`exportTargets(videoPath, axes, existingPaths, overwrite)` -> `{axis:{script, bak, orig, alt}}` (same policy as `runs.js exportTarget`).

## project.js — `.pawproj`
Version 1 (`CURRENT_VERSION`). File: `{format:'pawproj', version, app, createdAt, savedAt, media:{path, relativePath?, name, size, hash:{algo,value}|null,
durationMs, fps, isVfr, width, height}, axes:{stroke:[[at,pos],...]}, activeAxis, playheadMs, chapters, bookmarks, loops, plan, ghosts (no scripts/frames
unless `ghostScripts`), profileId, settings, view:{start,span}, ...unknown}`. Selection, time-range selection, dirty flag, player state are NOT saved.
- `serialize(doc, {projectPath?, savedAt?, appVersion?, ghostScripts?})` -> text (each numeric pair on one line: `[at, pos]`, and a tracker ghost's kept channel `[t, v|null]` in `source.keep`). `toJSON(doc, opts)` -> object.
- `parse(text, {lenient?, warnings?: [], allowNewer?})` -> doc `{media, axes, activeAxis, chapters, bookmarks, loops, plan, ghosts, settings, view,
  profileId, playheadMs, meta:{version, app, createdAt, savedAt, migratedFrom}, extra}`. Throws `ProjectError` with `.errors:[{path, message}]`
  (all problems collected; messages like `chapters[2].t1: ends (100) before it starts (500)`). `lenient` repairs scripts/active axis and reports `warnings`.
- `migrate(obj, table=MIGRATIONS, target)`; `MIGRATIONS[v](obj)` -> v+1 (v0 = the outline section 5 shape).
- `relativePath(projectFile, mediaFile)`, `rankRelink(media, candidates)` (hash > size+name > size > name).
- **Feature blocks (e.g. node-graph `graphs`)**: unknown top-level keys round-trip untouched in `doc.extra`. A feature owns one key:
  `setBlock(doc, 'graphs', value)` -> new doc, `getBlock(doc, 'graphs', fallback)`; core keys are refused. The shell must keep `doc.extra` in `app.doc`
  and hand it back to `serialize`. The feature validates its own block (builds without it keep it intact).

## `.pawruns` (in `src/lib/runs-file.js`, beside `lib/runs.js`)
The tracker runs of a project, binary, beside the `.pawproj` (same stem): `encodeRuns(runs) -> Uint8Array`,
`decodeRuns(bytes) -> runs` (makeRun shape; throws `RunsFileError`, code `corrupt`), `runsPath(projectPath)`,
`encodeRunsAsync(runs, prevKey) -> {bytes | null, key}` (sliced; unchanged parts kept, same bytes). Container:
`PAWRUNS1`, u32 manifest length, JSON manifest `{format:'pawruns', version:1, runs}`, then one frames section per run
(u32 t_ms, f32 value, u16 n, n x i16 x / i16 y (x10000), i8 v, i8 label). Details in the file's header; written and read by
the tracking store (src/features/tracking/README.md "Runs are saved") through `backend.readBytes` / `writeBytes`.
Decoded frames keep their points in the file's bytes: each overlay's `pts` (and derived `points` / `boxes`) is an accessor
that decodes that frame on read, held FIFO up to 3 M points (paw-o60v.4; `lazyFrames(frames)`). `runsFileKey(runs)`: the
decoded file as an `encodeRunsAsync` key, so runs that did not change since the open are not written again (paw-v9qp).
Version 2 (paw-ee14, `docs/formats/pawruns.md`): the project's runs file copy-on-write, an append-only log of hashed blocks
and checksummed commits. `decodeRuns` reads both versions; `runsFileState(runs)` (what the writer needs), `verifyRuns(runs)`
(blocks against their names), `planBlocks(runs)`, `decodeRecords(bytes, hashes)` (a history entry's runs, paw-s49h),
`lightenFrames(frames)` (session-tracked frames read from their packed bytes once written, paw-d1sq). The writer is
`src/lib/runs-cow.js` (`writeRunsCow`, `cowShell(backend)`: only with the shell commands of `src-tauri/src/cow.rs`).

## recovery.js
- Snapshot: `makeSnapshot(doc, {now, projectPath, projectSavedAt, clean, appVersion})`, `serializeSnapshot`, `parseSnapshot(text)` -> `{meta, doc}`,
  `shouldRecover(meta, projectInfo|null, {slackMs=2000})` -> `{recover, reason}`, `isRecoveryNewer(meta, projectMtimeMs)`.
- Backups: `backupName(base, when)` (`show.pawproj.20261106-100000.123.bak`, sorts chronologically), `parseBackupName`, `rotateBackups(names, {base, keep=10})`
  -> `{keep (newest first), remove}`; unrelated names are ignored.
- Recent: entries `{path, name, kind, openedAt, pinned, missing}`; `addRecent(list, entry, {cap=20, now})` (dedupe by case/slash-insensitive path, keeps pin,
  cap on unpinned only), `pinRecent`, `removeRecent`, `markMissing(list, Set|array|predicate)`, `pruneMissing` (pinned survive), `RECENT_CAP`, `toMs`.

## export.js
Options per axis `{simplifyTolerance, speedCap, range:[lo,hi]|null, invert}`; preset `{id, name, default, axes:{axis: overrides}}`.
`makeOptions`, `makePreset`, `optionsFor(preset, axis)`, `BUILTIN_PRESETS`, `applyExport(script, options, ops?)`, `buildExports(axes, preset, ops?)`.
`devicePreset(profile)` -> the `'device-safe'` preset for a lib/analyze device profile (simplify 1, speedCap = `effectiveMaxSpeed`, range when
narrower than 0..100); `BUILTIN_PRESETS`' device-safe is `devicePreset(GENERIC)` (250 u/s). Callers with an active profile should use `devicePreset`.
Order: simplify, range remap, speed cap (holds in final units), invert; through real edit-lib ops (`EDIT_OPS`: density.js simplify, amplitude.js limitRange
'compress' / invert, speed.js capSpeed 'pull'), overridable via `ops`.
