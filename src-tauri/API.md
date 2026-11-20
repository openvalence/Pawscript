# Pawscript native API (`src-tauri/`)

Commands the front end calls with `invoke(name, args)` from `@tauri-apps/api/core`. Thin JS wrappers:
`src-tauri/js/backend.js` (the shell wraps them as `app.backend`); pure helpers for the binary/sprite
formats: `src-tauri/js/media-data.js`.

**Argument names are camelCase in JS** (Tauri converts: Rust `expected_sha256` = JS `expectedSha256`).
Optional arguments may be omitted or `null`. Paths are absolute strings.

**Errors.** Every command rejects with `{code, message}`. `message` is human text naming the path/tool; switch
on `code`:

| code | meaning |
|---|---|
| `not_found` | file/folder does not exist |
| `permission_denied` | the OS refused (read-only file, no access) |
| `busy` | file locked by another program (Windows), or a job id / cache entry already in use |
| `exists` | target exists and must not be replaced |
| `disk_full` | no space left |
| `invalid_input` | bad argument (folder where a file was expected, bad id, ...) |
| `not_utf8` / `too_large` | `read_text` of a binary file / a file over 256 MB (`read_bytes`: 1 GiB); `scrub_cache`: the copy would exceed the cache limit |
| `conflict` | `write_with_backup`: the file changed on disk since it was read |
| `refused` | `open_path` on a program or script |
| `protected` | `write_text_atomic` / `write_bytes_atomic` / `write_with_backup` / `remove_file` / `save_frame` into a read-only root: settings.json `files.readOnlyRoots` (array of folders), else `PAWSCRIPT_READ_ONLY_ROOTS` (folders separated by `;`), plus the checkout's `Reference` folder always (an empty setting does not clear it); no other folder is built in. Pawscript's own files (`.funscript`, `.pawproj`, `.pawruns`, `.bak`) are writable everywhere: they live next to the video |
| `ffmpeg_missing` | ffmpeg/ffprobe not found (PATH, or `PAWSCRIPT_FFMPEG` / `PAWSCRIPT_FFPROBE`) |
| `ffmpeg_failed` | ffmpeg ran and failed; message has its last stderr lines |
| `no_media` / `no_video` / `no_audio` / `no_frame` | the file lacks what was asked for |
| `cancelled` | the job was cancelled with `job_cancel` |
| `io` / `internal` | anything else |

**Jobs and progress.** Long commands take `job` (any unique string you choose; omit = not cancellable) and
`onEvent` (a `Channel`). `job_cancel(job)` stops the job (ffmpeg is killed) and the command rejects with
`cancelled`. Events: `{kind:'progress', stage, fraction}` (0..1, ≤10/s, always a final 1) and, for thumbnails,
`{kind:'sheet', level, index, path}`.

Nothing here touches the network: ffmpeg inputs are opened with `-protocol_whitelist file`.

---

## Safe file IO

### `read_text({path})` → `{text, sha256, size, mtime_ms}`
UTF-8 text (a leading BOM is stripped from `text`; `sha256` is of the bytes on disk). Keep `sha256` and pass it
back as `expectedSha256` when saving. Errors: `not_found`, `not_utf8`, `too_large`, `invalid_input` (folder).

### `write_text_atomic({path, text})` → `{path, sha256, size, mtime_ms}`
Temp file in the same folder (`.<name>.<random>.tmp`), fsync, rename over the target. A crash or full disk
leaves the old file or the new one, never a truncated one; the temp file is removed on failure. Writes through
a symlink to its target. The folder must exist (`not_found`). No backup — use for app files and exports.

### `read_bytes({path})` → `ArrayBuffer`
The raw bytes (`tauri::ipc::Response`, like `extract_frame`), for the app's own binary files (`<project>.pawruns`).
Errors: `not_found`, `too_large` (over 1 GiB), `invalid_input` (folder).

### `write_bytes_atomic(bytes, {headers: {path}})` → `{path, sha256, size, mtime_ms}`
Binary twin of `write_text_atomic` (same temp + fsync + rename). The content is the raw request body: invoke with a
`Uint8Array` as the args; the target path rides in the `path` header, percent-encoded (`encodeURIComponent`: headers
are ASCII). Read-only roots apply and nothing is exempt (a `.pawruns` is written only where its project may be).
JS: `writeBytesAtomic(path, bytes)`. Errors: as `write_text_atomic`, plus `invalid_input` (no raw body, no / bad header).

### Copy-on-write `.pawruns` (paw-ee14, `src/cow.rs`; format: `docs/formats/pawruns.md` version 2)
The runs file is an append-only log: new blocks, fsync, then a small commit last. Bytes never cross IPC in one large body:
the front end sends parts of at most 8 MB, and copies of what is already on disk are made here.
- `runs_append(bytes, {headers: {path, at, tail?, sync?}})` → `{size, mtime_ms}`: the raw body appended to the live file at
  `at`, which must be its length; `tail` (hex) what its last bytes must be; `sync: '1'` fsync before returning. Errors:
  `moved` (the file is not as the app left it, or paw-51zd another writer holds it at this moment: write it whole),
  `not_found`, io codes.
- `runs_stage_write(bytes, {headers: {path, stage}})` → size: appended to the stage `stage` (6-64 of `[A-Za-z0-9_-]`) of
  `path`, a temp file beside it, begun by its first part; a new stage for a path drops the older ones.
- `runs_stage_copy({path, stage, src, ranges: [[offset, length]]})` → `{size, sha256: [hex]}`: byte ranges of `src` appended
  to the stage, streamed, each range's SHA-256 returned (the caller checks them against the blocks' names).
- `runs_stage_commit({path, stage, backup?})` → `{size, mtime_ms}`: fsync + rename over `path` (the target untouched until
  then); `backup`: the file replaced is first copied into its rolling backups (the newest 2 kept): a version-1 file migrated.
- `runs_stage_drop({path, stage})`: the stage and its temp file gone.
An error drops the stage. Read-only roots apply as for `write_bytes_atomic`.
JS: `runsAppend`, `runsStageWrite`, `runsStageCopy`, `runsStageCommit`, `runsStageDrop`; `app.backend.writeBytes` sends
parts through a stage when these exist.

### `write_with_backup({path, text, keep?=10, expectedSha256?})` → `SaveResult`
Use for every user document (`.funscript`, `.pawproj`).
```
{ path, sha256, size, mtime_ms,
  first_backup: string|null,    // content we did not write was copied here first
  rolling_backup: string|null,  // our own previous version was kept here
  unchanged: bool }             // file already held exactly this text: nothing written
```
1. `expectedSha256` given and the file on disk differs → `conflict`, nothing written (ask: overwrite / reload).
   Pass `expectedSha256: null` to overwrite after the user confirms.
2. File exists and was **not last written by Pawscript** (content hash differs from the one recorded at our last
   write, or never written by us) → copied beside it as `name.bak` (e.g. `video.funscript.bak`). An existing
   `.bak` is never overwritten: if it holds different content the copy goes to `name.2.bak`, `name.3.bak`, …;
   if it already holds the same content it is reused.
3. File exists and **was** last written by us → that previous version goes to the rolling backups
   (app data dir, below), newest `keep` (1..100) kept.
4. Atomic write as above; the new hash is recorded in `written.json`.

### `list_backups({path})` → `[{path, kind:'rolling'|'first', saved_ms, size}]`
Rolling backups newest first, then `.bak` siblings. Restore = `read_text(backup.path)` then save normally.

### `file_stat({path})` → `{exists, is_file, is_dir, size, mtime_ms, readonly}`
Never rejects for a missing path (`exists:false`).

### `list_dir({dir, stem?, ext?})` → `[{name, path, is_dir, size, mtime_ms}]`
One folder, sorted by name. With `stem` and/or `ext`, only names equal to `stem+ext` or `stem + '.' + … + ext`,
case-insensitive (Unicode): `list_dir({dir, stem:'video', ext:'.funscript'})` finds `video.funscript`,
`video.roll.funscript`, … (map the middle part to axis ids yourself). Non-UTF-8 names are skipped.

### `list_dir_stream({dir, exts, onEvent})` → count
Files (no folders) whose name ends in one of `exts` (lower-case, with the dot; empty = all), sent as `[Entry]` batches on the
channel (250 at a time or every 150 ms) while the walk runs, unsorted; resolves when done. For a share with thousands of names.

### `image_thumbnail({path, dest, max?})`
A JPEG of a still image, long side <= max (160), at `dest` through ffmpeg; nothing happens when `dest` exists. Read-only roots apply to `dest`.

### `make_dir({path})`
Creates a folder and its parents (an existing folder is fine). Read-only roots apply (`protected`). The app uses it for its own state folders (the seeder's image labels).

### `remove_file({path})`
Deletes one file (folders refused: `invalid_input`).

### `reveal_path({path})` / `open_path({path})`
Show in Explorer/Finder/file manager; open with the default app. `open_path` refuses programs and scripts
(`refused`: .exe, .bat, .cmd, .ps1, .lnk, .js, .sh, …).

## App state

### `app_paths()` → every folder/file the app writes (see "Where the app writes"), for a settings page "Show".

### `settings_get()` → `{value, warning}` / `settings_set({value})`
One JSON blob, schema-less, whole-blob get/set, atomic. `value` is `null` before the first save. If the file is
unreadable it is moved aside to `settings.json.corrupt-<ms>`, `value` is `null` and `warning` says so — show it.

### `recent_list()` / `recent_add({path})` / `recent_remove({path?})` → `[Recent]`
`Recent = {path, name, kind:'project'|'script'|'media'|'other', opened_ms, exists}`, newest first, max 30,
deduplicated per file. `recent_remove` without `path` clears the list. `exists` is checked at each call.

### `autosave_write({projectPath?, session, title?, content, keep?=10})` → `{id, path, saved_ms, size}`
Writes one snapshot (`content` = the `.pawproj` JSON text) and keeps the newest `keep`. `session`: an id you make
per open document (`[A-Za-z0-9_-]{1,64}`, e.g. `crypto.randomUUID()`). With `projectPath` the folder is keyed
by the project (`p-<hash>`), else by session (`u-<session>`). Call every N seconds while dirty.

### `autosave_list()` → `[Candidate]` (newest first)
```
{ id, project_path|null, session, title, updated_ms,
  snapshots: [{id, path, saved_ms, size}],     // newest first; read with read_text(path)
  project_mtime_ms|null,
  unsaved_work: bool }   // newest snapshot is newer than the saved project, or there is no project
```
At startup offer recovery for candidates with `unsaved_work`.

### `autosave_clear({id})`
After a clean save (the project's id, and the old `u-` id if the document was untitled), and after the user
restores or discards a candidate.

## Media (ffmpeg)

All media results are cached under the media cache (below), keyed by path + size + mtime + parameters,
size-capped (default 2 GiB, `media_cache_limit`), least-recently-used evicted. Nothing is ever written next to the video.

### `media_tools()` → `{ffmpeg: {path, version}|null, ffprobe: …|null}`
For a settings/about line and to decide whether to offer media features.

### `media_probe({path, job?})` → `Probe`
```
{ path, container, size, duration_ms, start_ms, bit_rate|null, has_audio, webview_playable,
  video: { stream_index, codec, profile, pix_fmt, width, height, display_width, display_height,
           rotation,            // clockwise degrees a player applies: 0/90/180/270
           fps, fps_rational: {num, den},   // e.g. {num: 30000, den: 1001}; {num: 0, den: 1} if unknown
           frame_ms, is_vfr /* hint */, frame_count, frame_count_exact, duration_ms } | null,
  audio: { codec, sample_rate, channels, duration_ms } | null }
```
`webview_playable` is a hint (H.264/VP8/VP9/AV1 in MP4/MOV/WebM); if playback fails anyway, offer a proxy.

### `media_frame_times({path, job?, onEvent})` → `ArrayBuffer` (little-endian Float64, one per frame)
Every video frame's presentation time in ms, ascending, duplicates removed, on the same timeline as
`extract_frame` and the player (file start = 0; packets flagged discard, e.g. edit-list priming, are skipped).
A packet scan, no decoding: a 10-min 1080p file (17 983 frames) took 0.26 s cold, 8 ms cached. Progress stage
`frame_times`. JS: `frameTimes(path)` in `js/backend.js` resolves a plain `number[]` (`frameTimesJob` for a
cancellable handle). Use it for VFR stepping and exact frame numbers (`is_vfr`); for CFR, `fps_rational` is exact.

### `waveform_peaks({path, resolutionMs?=8, job?, onEvent})` → `ArrayBuffer`
Audio decoded to mono 8 kHz (10-min clip: 0.4 s cold, 8 ms cached; 0.9 MB); min/max/RMS per bucket of `resolutionMs` (0.5..10000) at level 0, then a pyramid
halving the resolution down to ≤1024 buckets. Binary, little-endian:
```
0   "PWPK"                    4 bytes
4   version = 1               u32
8   sample_rate (8000)        u32
12  level_count L             u32
16  total_samples             u64
24  L × { samples_per_bucket u32, bucket_count u32 }
..  for each level: bucket_count × { min i16, max i16, rms i16 }   (2-byte aligned)
```
`parsePeaks(buf)` in `js/media-data.js` returns typed-array views and `pickLevel(peaks, msPerPixel)` picks the
level to draw. Values are raw sample units (−32768..32767). Errors: `no_audio`.

### `media_repeats({path, job?, onEvent})` → `Repeats`
```
{ frames, exact, buckets: [ [ {f0, f1, t_ms}, .. ], .. ] }
```
Frames that show exactly the same picture (to codec noise, no transform) as another frame elsewhere (paw-6dno,
`src/repeats.rs`). One ffmpeg pass (`-threads 4`) to 160 px grey, frame for frame (`-fps_mode passthrough`). A run of held
frames is one occurrence (`f0..f1`, `t_ms` = `f0`'s time on the player's timeline: the frame table when it lines up, else
`f0 × frame_ms`); near-uniform frames (black, white, flat colour) never count. Two frames are one picture when the worst
5 px tile's mean |difference| is ≤ `exact` (4 grey levels: calibrated on the owner's videos against the native frames, see the module doc). A bucket (id =
index, in order of first occurrence) has ≥ 2 occurrences. Progress stage `repeats`. Cached (`repeats.json`). Errors:
`no_video`, `no_frame`.

### `thumbnail_strip({path, height?=90, count?, job?, onEvent})` → `Strip`
```
{ tile_w, tile_h, columns, rows,
  levels: [ { count, times_ms: [..], sheets: [jpegPath, ..] } ] }
```
JPEG sprite sheets of `columns × rows` tiles (≤4096 px a side, ≤10×10; `rows` no more than the full set
needs, so a 10-frame strip is a single row). Frame `i` of a level is in
`sheets[floor(i / (columns*rows))]` at cell `i % (columns*rows)`, row-major; `times_ms[i]` is its media time
(centre of its slice). Default `count`: one frame per second, 10..300 (explicit: 1..5000). When there are more
than 40 frames, level 0 is a coarse pass of 20 frames that arrives first; the last level is the full set.
Sheets stream in as `{kind:'sheet', level, index, path}` events, in order, before the command resolves. Load
sheets with `convertFileSrc(path)` (CSP allows `asset:` images). `thumbAt(strip, ms)` in `js/media-data.js`
gives the sheet and pixel rectangle for a time. Errors: `no_video`. Frames are exact (each one is seeked
and decoded), so cost depends on the keyframe interval: a 10-min 1080p H.264 clip with 8 s GOPs gave the coarse
sheet in 1.3 s and all 320 frames in 15 s (32 threads); cached afterwards. A frame ffmpeg cannot decode is filled
with its neighbour; if none decode, `ffmpeg_failed`.

### `extract_frame({path, timeMs, format?='png'|'jpeg', maxWidth?, job?})` → `ArrayBuffer`
The frame a player shows at `timeMs` (the last frame starting at or before it), as PNG or JPEG bytes. Not
cached. Exact for CFR and VFR (VFR files use the frame table above, built and cached on first use) and for
open-GOP streams (it seeks 2 s early and decodes forward; ~0.1 s for 1080p H.264). For "copy frame": `navigator.clipboard.write([new ClipboardItem({'image/png': new Blob([buf])})])`.

### `save_frame({path, timeMs, dest, maxWidth?, job?})` → `{path, sha256, size, mtime_ms}`
Same frame written atomically to `dest` (from a save dialog); format from the extension (.png/.jpg/.jpeg).

### `transcode_preview({path, height?=720, job?, onEvent})` → `string` (path of an `.mp4` in the cache)
H.264/AAC proxy (x264 veryfast, CRF 23, 1 s keyframes, faststart) of any video (paw-nydn). paw-mh1a: capped to half
the logical cores (2..=8 threads for decoder, filters and x264) and below-normal priority on Windows. Every
source timestamp is kept (`-fps_mode passthrough`), so script timing matches. Play with `convertFileSrc`.
Slow: a 10-min 1080p source took ~2 min (≈5× real time) on a 32-thread machine — show progress, allow cancel.

### `remux_mp4({path, h264?=false, job?, onEvent})` → `string` (path of an `.mp4` in the cache)
An MP4 of the first video track (no audio) that the webview's WebCodecs frame reader (`src/features/video/scrub.js`:
hover scrub, Groups' Copy from…, shot links) can read. paw-b88b: H.264, HEVC, VP9 and AV1 are stream-copied
(`-c copy -movflags +faststart`); any other codec (VP8, Theora, MPEG-2, ...), a copy ffmpeg refuses, or `h264: true`
(the front end found the copy undecodable: 10-bit H.264, HEVC without a system decoder) is transcoded to H.264
(x264 veryfast CRF 18, 8-bit 4:2:0, ≤ 2160 lines, 1 s keyframes, no B-frames), every frame at its source time
(`-fps_mode passthrough`); threads capped and below-normal priority like `transcode_preview`. Cached (kind `remux`,
counted by Clean project); cancellable; progress stage `remux`. Shells before paw-b88b ignore `h264` and fail VP8 /
Theora with `ffmpeg_failed`.

### `scrub_cache({path, job?, onEvent})` → `string` (path of an `.mp4` in the cache)
All-intra H.264 copy of the first video track (every frame a keyframe, source timestamps, ≤2160 lines, 8-bit 4:2:0,
no audio) for the hover scrubber: any jump decodes one frame. libx264 CRF 18 fastdecode, else h264_nvenc QP 19. A
cache entry like the others. When the copy alone would exceed the cache limit the encode stops as soon as it does and
a smaller copy is made instead (paw-mh1a: 1080 / 720 / 540 / 360 / 240 / 144 lines, picked from how fast the full one
grew; named `scrub-<height>.mp4`, found again by later calls); `too_large` only when even 144 lines would not fit. Progress stage `scrub`; 60 s of 1080p took ~3 s and 258 MB (≈15 GB/hour).

### `job_cancel({job})` → `bool` (false: no such job running)

### `media_cache_info()` / `media_cache_clear()` → `{path, bytes, entries, limit}`
Clearing skips entries being generated right now.

### `media_cache_limit({bytes})` → `{path, bytes, entries, limit}`
Sets the cache size limit (clamped to 512 MiB..512 GiB; process-wide, not persisted: the front end sends setting
`media.cacheGb` at startup and on change) and evicts down to it at once.

Eviction (after every finished entry, and here): least recently USED first (an entry's `done` stamp is touched on
every hit), never the entry just made, one being made, or an entry of a file open in the app (below). All kinds
(probe, frame times, peaks, thumbnails, remux, proxy, scrub) share the one budget and order.

### `media_cache_open({paths})` → `null`
paw-mh1a: the files the app has open now (the video and the proxy playing; replaces the previous set). Entries made
from them this session are never evicted.

### `media_cache_evicted()` → `[{kind, bytes, age_s}]`
paw-mh1a: the entries evicted since the last call (kind = the key prefix: scrub, proxy, thumbs, ...; age = since last
used), for the usage log.

### `media_cache_of({paths})` → `[{kind, bytes}]` / `media_cache_remove_of({paths})` → `{freed: [{kind, bytes}], kept: [...]}`
paw-zkvc (Clean project): the finished entries made from these files (the video and its proxies; biggest first): keys made
from them this session plus the keys their usual requests make (probe, frame times, remux, scrub at every ladder height,
proxies at every height). Removing skips an entry being built; one that cannot go (a file still open) is `kept`.

### `remove_recoverably({path})` → `"recycle-bin"` | the path it was moved to
paw-zkvc: one file removed so it can be got back: to the Recycle Bin on a fixed local drive, else (network / removable
drive: no Recycle Bin, Windows would delete it for good) moved into `<data_dir>/backups/removed/<ms>-<name>`.
Read-only roots apply.

## Pack (paw-2k9s, `src/pack.rs`, format: `src/app/PACK.md`)

### `pack_write({dest, manifest, entries: [{name, role, path} | {name, role, text}], job?, onEvent})` → `{path, size}`
A `.pawpack` at `dest` (replaced): ZIP64, entries stored, `pawpack.json` first (`manifest` + `files: [{name, role, size,
sha256}]` filled in here). Streamed into a temp file beside `dest`; cancel (`job_cancel`) or failure leaves nothing.
Errors: `unsafe_name`, `private` (a text names this computer), `changed` (a file changed while packing), `cancelled`.

### `pack_manifest({path})` → manifest
Errors: `not_a_pack`, `too_new` (a newer major format: "update Pawscript"), `corrupt`.

### `pack_unpack({path, dir, job?, onEvent})` → `[written paths]`
Every file the manifest lists into `dir`, names checked (no `..`, drive or device name), sizes and SHA-256 checked;
an existing file is never replaced (`exists`); on failure or cancel every file written is removed again. paw-goia: the
files written go into `written.json` as the app's own, so the first `write_with_backup` over one rolls (no `.bak`). Read-only
roots apply (`protected`). Errors also: `corrupt` (also: two entries sharing bytes, a local header naming another file
than the central directory, paw-ijyn / paw-sr01), `compressed` (unpack with a zip tool), `no_space` (the files do not
fit on the drive; nothing written).

## File identity

### `file_fingerprint({path})` → `{size, fingerprint}`
`fingerprint` = `q1-<size>-<32 hex>`: SHA-256 of size + first, middle and last MiB (whole file under 3 MiB).
Reads ≤3 MiB, so instant. Store it in the project; compare as an opaque string. The algorithm is pinned by a test.

### `file_sha256({path, job?, onEvent})` → `string` (64 hex)
Full-file hash, cancellable, progress stage `sha256`.

### `relink_search({dir, fingerprint, maxDepth?=3})` → `[path]`
Files under `dir` (≤`maxDepth` levels, ≤8) with that fingerprint; only same-size files are read.

## App plumbing

### `portable_status()` → `{state: 'ready'} | {state: 'unpacking', what} | {state: 'refused' | 'failed', message}`
The shared build's one-time setup (`portable.rs`, paw-i7s): when `runtime.zip` / `code.zip` lie beside the exe,
it unpacks each whose `<name>.stamp` differs from `.setup\<name>.stamp` in place, stamp last (`what`: `checking` |
`runtime` | `code`); `sidecar_run` waits for it. `refused`: a cloud-synced folder (OneDrive, Dropbox, Google Drive,
iCloud), a network drive or a folder it cannot write; `failed`: what to do first, then the error (the message says). A dev build has no zips: always `ready`. `src/app/setup-screen.js` shows it.
paw-mkcd: also `refused`, before anything is touched: an item the zip holds is already there and no
`.setup\<name>.owns` (written before an unpack removes anything) lists it (someone's own `python\` / `ffmpeg.exe`); less
free space than the unpack needs (about 5 GB for the runtime; the message says how much is missing); a folder path so
long that `<folder>\<longest entry>` would pass MAX_PATH.
paw-7yed / paw-6s20 / paw-xm2c / paw-d62c: files in parts (`parts.txt`: `<file> <bytes> <sha256> <part bytes> <count>
[<part sha256>,...]`, the sixth field optional) are joined first, and every refusal above (plus the `.joining` file's
own path length) is decided before a part is renamed, appended or deleted; a zip still in parts is listed from its parts.
With per-part hashes each part is checked before it is joined: a damaged one is refused by name and only it must be
downloaded again. A split zip whose stamp is recorded is done; `runtime.zip` is deleted once unpacked and stamped (an
update ships a new one). A panic in the setup is `failed`, never an endless `unpacking`.

### `launch_paths()` → `[path]`
Existing files/folders the app was started with ("Open with", file association, `pawscript video.mp4`), plus
any that arrived before you asked. Returns them once; call at startup.

### Event `pawscript://open-paths` (payload `[path]`)
A second launch (single instance: it exits and hands its paths to the running window, which is focused), or
macOS Open With. `listen('pawscript://open-paths', e => open(e.payload))` from `@tauri-apps/api/event`.

### File drops
Built into Tauri, no command: `getCurrentWebview().onDragDropEvent(e => …)` from `@tauri-apps/api/webview`;
`e.payload.type === 'drop'` carries `paths` (also `'enter'|'over'|'leave'` with `position` for a drop
highlight). Note: with native drop enabled (the default), WebView2 does not deliver HTML5 drag-and-drop of files
to the page — use this event.

### Close guard: `close_guard({armed})`, event `pawscript://close-requested`, `window_close_now()`
**The front end must arm it**: `close_guard({armed: true})` whenever the document becomes dirty, `false` when
clean. While armed, closing the window (title bar ×, Alt+F4) is held back and `pawscript://close-requested` is
emitted. Ask the user (save / discard / cancel); to close, call `window_close_now()` (disarms and closes). OS
shutdown cannot be held back — that is what autosave is for. paw-a82t: a close is held once, for at most 3 s; a
second close request, or no `window_close_now()` within 3 s (a hung or dead renderer), closes the window anyway.
paw-ee14: `close_heartbeat()` (every second while the front end is still writing) restarts that 3 s wait, so a healthy
app mid-write is never closed by it; `close_cancel()` (the "Writing your project" panel's Cancel) ends the wait and
re-arms: the next close request is held again. JS: `closeHeartbeat()`, `closeCancel()`.
paw-hzz3: the shell's own writes count as life too (WebView2 throttles a minimised window's timers to once a minute):
while a `write_text_atomic` / `write_bytes_atomic` / `write_with_backup` / `runs_*` / `autosave_write` / `pack_*` call
is in flight the close is held, and each one's start and end restart the 3 s wait. A hung page with no write in flight
still closes after 3 s; a second close request still closes at once. paw-mn92: the front end now arms the guard for as
long as the app runs, so every close passes through it and writes the usage log's `app:close` first.

### `system_info()` → `{windows, gpus: [string], runtime: [string]}`
paw-frhy, for Help › Copy bug report: `cmd /c ver`, nvidia-smi's GPUs as `"name, 12282 MiB VRAM, driver 581.57"`
(none without an NVIDIA driver), and the recorded `.setup` stamps of the shared build (none in a dev build). No paths.

### Window state
Size, position and maximised state are saved and restored automatically (tauri-plugin-window-state). Nothing to
call.

### Sidecar
`sidecar_run({request, onLine, run?})` → `{code, stderr_tail, cancelled}` and `sidecar_cancel({run?})` (async); see
`src/lib/sidecar.js` and `trackers/PROTOCOL.md`. `run`: the front end's id for the run; a cancel naming it stops only
that run (a cancel for a run that has ended is a no-op); a cancel without one stops whatever runs. One run at a time (a second call fails with "a sidecar run is
already active" and spawns nothing). `onLine` gets every stdout line, every stderr line as
`{"type":"log","line":...}`, and `{"type":"exit"}` last. Each run is a kill-on-close Windows Job Object: cancel
kills the whole tree (uv and python), and so does the app ending in any way; ffmpeg children likewise.

Runs go to one resident `pawtrack serve` (trackers/PROTOCOL.md, "pawtrack serve"), started on the first run, so
models stay loaded between runs. The run's request gets an `id` (`app<n>`) and its event lines carry it (the front
end ignores it; the closing result / error line goes out without it, as a one-shot run's); `code` is 0 for a result, 1 for an error event, the process's code if serve died mid-run (the next run
starts a new one). An error line with `"restart": true` (a broken CUDA context: serve exits by itself) drops the serve
at once: the run waits up to 10 s for it to exit, then kills what is left, and the next run starts a new one. Cancel sends serve a cooperative `cancel` (the job stops at its next event, serve keeps its
models); a job that has not closed 5 s later gets the whole serve tree killed. The serve process is killed after
`PAWTRACK_SERVE_IDLE_S` (default 600) without a run, on window close and on app exit (and by its job object in any
other way the app ends); serve itself unloads its models after `PAWTRACK_IDLE_UNLOAD_S` (default 120). When serve
does not come up (spawn error, exit or garbage before its hello) the run, and every later one this session, is a
one-shot process as before. `PAWTRACK_SERVE=0` turns the resident off, `=1` forces it; with `PAWTRACK_CMD` set (the
fake sidecar) it is off unless forced. paw-cdot: the sidecar is started with `PAWTRACK_MODELS` = the models folder
(settings.json `models.dir` when absolute, else `<root>\trackers`), where `pawtrack` looks for `.cache\` and `.models\`.

## Models, runtime, updates (paw-cdot: the only network access, each started by the user)

`src/models.rs`, `src/update.rs`, `src/portable.rs`; front end `src/features/models`, `src/features/updates`. Long jobs
take an `id` (`models_cancel({id})` stops them between chunks) and report `{file, done, total}` on `onEvent`.

### `models_info({dir?})` → `{defaultDir, envUrl, exists, free, fake}`
The default models folder (`<root>\trackers`), `PAWSCRIPT_MODELS_URL` when set, whether `dir` exists, the free bytes on
its drive, and `fake` (PAWTRACK_CMD is set: nothing needs models). No network.

### `models_scan({dir, paths})` → `[{path, exists, bytes, part}]`
What is on the disk for each manifest path (`part`: bytes of an unfinished `<file>.part`). Paths are checked as a
pack's entries: relative, no `..`, no drive (`unsafe_path`).

### `models_manifest({base})` → text
GET `<base>manifest.json` (at most 4 MB). `base`: https on `dl.openvalence.org` only (`ALLOWED_HOST`), or 127.0.0.1 /
localhost (tests); a redirect is an error.

### `models_download({id, base, dir, files: [{path, url, bytes, sha256}], onEvent})`
Each file to `<dir>\<path>.part` (resumed with `Range: bytes=<n>-` when a part is there; a server that answers 200
restarts it), then hashed from the disk and renamed into place only when size and SHA-256 match (`hash_mismatch`
deletes the part). The URL is `base` + `url` and must stay under `base`. Errors: `offline` (no connection),
`http` (a status other than 200 / 206, redirects included), `disk_full` (checked first, against what is left to fetch),
`hash_mismatch`, `cancelled` (the part is kept). Never unpacks or runs anything.

### `models_import({id, dir, items: [{src, path, bytes?, sha256?, strict}], onEvent})` → `[{path, sha256, tested}]`
Files the user brings: the name must be the manifest's; `strict` (a hosted model) also needs its size and SHA-256
(`hash_mismatch`, nothing moved); otherwise a different version is taken (`tested: false`). Moved by rename; across
drives copied to `.part`, hashed again, renamed, and only then the source deleted.

### `models_verify({id, dir, paths, onEvent})` → `{path: sha256}` / `models_remove({dir, paths})` → count
Verify hashes the files that exist. Remove deletes exactly the named files and their `.part` (never a folder or
anything else). `models_changed()`: an idle tracker serve is dropped so the next run sees the folder as it is now.

### `open_url({url})`
A licence or download page in the default browser; https only (`refused` otherwise).

### `runtime_status()` → `{portable, dir, installed, python, zip}` / `runtime_unpack()`
The shared build's runtime: whether this is the shared build (code.zip beside the exe), its folder, the recorded
`.setup\runtime.stamp`, whether `python\python.exe` is there, and whether a `runtime.zip` (or `.001` part) waits beside
the exe. `runtime_unpack()` runs the first-start setup again (`portable_status` then reports the unpack).

### `update_check()` → `{configured, current, version, notes, date, portable}`
tauri-plugin-updater against `plugins.updater.endpoints` (GitHub's `latest.json`); the shared build asks for the
`windows-x86_64-portable` entry. `configured: false` (the public key in tauri.conf.json is still the placeholder): no
request is made. `version`: null when there is no newer version.

### `update_download({onEvent: {done, total}})` / `update_restart()`
Downloads what the last check found; the plugin checks its minisign signature against the public key. Shared build: the
zip may hold only `Pawscript.exe` and `code.zip`; the running exe is renamed to `.setup\Pawscript.old.exe`, the new one
put in its place, code.zip replaced (any failure restores the old exe); an installer build keeps the installer for the
restart. A debug build refuses (`refused`). `update_restart()`: refused (`busy`) while a shell write is in flight; else
runs the installer (installer build) or restarts the app. The front end asks first and writes every project (closeApp).

---

## Where the app writes (privacy rule: this list is complete)

Folders are Tauri's per-app folders for the identifier `app.pawscript`. Windows paths shown; macOS uses
`~/Library/Application Support/app.pawscript` (config, data) and `~/Library/Caches/app.pawscript`; Linux
`~/.config/app.pawscript`, `~/.local/share/app.pawscript`, `~/.cache/app.pawscript`. `app_paths()` returns
the real ones.

| What | Where |
|---|---|
| Settings blob | `%APPDATA%\app.pawscript\settings.json` |
| Recent files | `%APPDATA%\app.pawscript\recent.json` |
| Window size/position | `%APPDATA%\app.pawscript\window-state.json` |
| Autosave snapshots | `%LOCALAPPDATA%\app.pawscript\autosave\<id>\<ms>.pawproj` + `meta.json` + `runs.pawruns` (the tracker runs, rewritten only when they changed) |
| Project page thumbnails (one small JPEG per recent project, from `save_frame` at open / save; removed with its list entry) | `%LOCALAPPDATA%\app.pawscript\thumbs\<16 hex>-<ms>.jpg` |
| Rolling backups of saved files | `%LOCALAPPDATA%\app.pawscript\backups\<16 hex>\<ms>-<name>` + `source.txt` (original path) |
| "Last written by us" hashes | `%LOCALAPPDATA%\app.pawscript\written.json` (≤2000 entries) |
| Media cache (probe, peaks, thumbnails, proxies, scrub copies; cap: setting `media.cacheGb`, default 2 GiB) | `%LOCALAPPDATA%\app.pawscript\media-cache\<kind>-<hex>\` (2 GiB cap); paw-tprc: settings.json `media.cacheDir` (an absolute folder, made if missing) moves it there |
| WebView2 profile (Tauri/Edge) | `%LOCALAPPDATA%\app.pawscript\EBWebView\` |
| Next to the user's files, only on save | the saved file itself; `name.bak` / `name.N.bak` (first overwrite of a file we did not write); a transient `.<name>.<random>.tmp` during each atomic write |
| Tracker runs of a project, only on save | `<project>.pawruns` beside the saved `<project>.pawproj` (every run: signals, channels, points, overlay frames); `<project>.pawruns.<ms>.bak` when a runs file this session did not read or write (unreadable, or another project's) is about to be replaced |
| Pack project (File › Pack project, paw-2k9s) | the `.pawpack` where the save dialog says (a transient `.<name>.<random>.tmp` beside it while writing); the project's runs staged as `%LOCALAPPDATA%\app.pawscript\<cache>\pack-staging\<stem>.pawruns` while packing, removed after |
| Opening a `.pawpack` | a folder named after it beside it (or in a folder you pick): the files it lists |
| Clean project and remove tracker runs (paw-zkvc) | the old `<project>.pawruns` to the Recycle Bin (fixed drive), else `%LOCALAPPDATA%\app.pawscript\backups\removed\<ms>-<name>.pawruns` |
| Unreadable settings, kept | `settings.json.corrupt-<ms>` beside `settings.json` |
| Models (Settings > Models: Download, or files you bring, which are moved there; Remove deletes only the files the manifest names) | the models folder: `<app folder>\trackers\.cache\` and `.models\` (as before), or `.cache\` / `.models\` inside the folder you chose (setting `models.dir`); `<file>.part` while a download runs (kept for resuming) |
| Runtime download (a shared build released without `runtime.zip`; first-start screen) | `runtime.zip` (`runtime.zip.part` while downloading) beside `Pawscript.exe`, unpacked as the row below says and then deleted |
| An update (Help > Check for updates > Download and install; shared build) | `.setup\update\` (the update zip and what it holds, removed once applied), `Pawscript.exe` and `code.zip` replaced, the old exe kept as `.setup\Pawscript.old.exe` until the next start |
| Shared build only, at its first start (`runtime.zip` / `code.zip` beside the exe) | `python\`, `trackers\pawtrack\`, `ffmpeg.exe`, `ffprobe.exe` and `.setup\` beside `Pawscript.exe`: unpacked once, again only when a zip's stamp changes (`portable.rs`) |

Autosaves all live in the app data dir (not next to the project): one place to look, no clutter or write
failures in read-only/synced folders, and recovery needs no index. `app_paths().autosave` + `reveal_path` shows
them to the user.

## Capabilities (`capabilities/default.json`) and config

| Permission | Why |
|---|---|
| `core:default` | Tauri basics: events (`listen`), window/webview getters, drag-drop event, `convertFileSrc`. |
| `core:window:allow-set-title` | dirty marker / file name in the title bar. |
| `dialog:allow-open`, `dialog:allow-save` | native Open and Save As dialogs. |

App commands (everything above) are not listed in capabilities: Tauri allows an app's own commands to its
windows. Not enabled: the fs plugin (removed: all file access goes through the commands above; the crate stays in
Cargo.lock only as a dependency of the dialog plugin, which works without it), the opener plugin's JS commands,
shell, http — nothing in the webview can read arbitrary files, open URLs or run programs. The updater plugin
(paw-cdot) is registered for the shell's own use (`update.rs`); no `updater:*` permission is granted, so the webview
cannot call it directly. `plugins.updater` in tauri.conf.json: the public key (a placeholder until the owner sets his:
docs/BUILDING.md, "Updates") and the endpoint.

`tauri.conf.json` CSP:
- `script-src 'self' 'wasm-unsafe-eval'`: the motion planner (`src/lib/analyze/kinetic/`, base64 WASM) compiles
  with `WebAssembly.instantiate`. Only WebAssembly is allowed: `eval` / `new Function` stay blocked (the harness
  checks both).
- `connect-src` IPC plus `ws: wss:` (unchanged by paw-cdot: the model and update downloads run in Rust, not the webview): the webview's one network path is the Valence client (`src/lib/valence/`, Device panel >
  Valence hub), a WebSocket from the webview to the hub address the user types, opened only on Connect. No Rust
  side: the hub speaks WebSocket, which the webview opens directly. `img-src` and `media-src` allow `asset:`
  (thumbnail sheets, videos, proxies via `convertFileSrc`); the asset protocol (scope `**`) streams user-chosen files.
- `bundle.fileAssociations` registers `.pawproj`.

## Testing

- `cargo test` (own `CARGO_TARGET_DIR`): unit tests per module, plus `src/media_it.rs`, which runs real ffmpeg
  on clips it synthesises (skipped with a note when ffmpeg is absent). `cargo clippy --all-targets` is clean.
- `node --test test/backend-media-data.test.mjs`: the peaks parser and sprite lookup.
- Real app: `src-tauri/js/harness/` runs every command and writes a JSON report, then exits. Serve a folder holding
  a copy of `src-tauri/js/` plus `src/lib/` (as `src/lib/`, for the kinetic check) as the frontend, with a
  separate identifier (never touches a real profile or a running Pawscript) and the window **off-screen,
  unfocused, out of the taskbar** (the machine is in use):
  ```
  TAURI_CONFIG='{"identifier":"app.pawscript.rusttest","build":{"frontendDist":"<RELATIVE path to the folder>"},
    "app":{"withGlobalTauri":true,"windows":[{"label":"main","title":"Pawscript native harness",
    "url":"harness/index.html","width":1200,"height":800,"x":-32000,"y":-32000,"focus":false,
    "skipTaskbar":true,"alwaysOnTop":false,"visible":true}]}}' cargo build --features tauri/custom-protocol
  pawscript.exe C:\path\harness.json  # {video, videoNoAudio?, workDir, report, kineticModule?, closeGuardProbe?}
  ```
  `frontendDist` must be relative: an absolute `C:/…` value parses as a URL and the window shows
  ERR_FILE_NOT_FOUND. Launch once, with a timeout and kill by PID; never relaunch in a loop. A second launch is a
  single-instance hand-off that focuses the running window, so do not script it on a shared desktop
  (`secondInstanceProbe` exists but was verified once and should stay off). `closeGuardProbe`: the driver sends
  WM_CLOSE (`Process.CloseMainWindow()`) once the window title reads `harness: waiting for close`.
