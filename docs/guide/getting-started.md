# Getting started

Pawscript is an offline funscript editor with a semi-automatic scripter for animated clips. If you have used OpenFunscripter, the shape is familiar: video on top, lanes below, a playhead, number keys for points. This page gets you from install to a saved file. New to tracking: start with the [quick start](quick-start.md) (also `F1` in the app); the shared build's needs and fixes are in [requirements](requirements.md).

**Position convention:** `pos 0` is deepest / fully in, `pos 100` is out. Every lane, tracker and generator in the app uses this.

## Install and run

Requirements: Node 20+, Rust 1.91+ (`src-tauri/Cargo.toml`), and for media features (waveform, thumbnails, exact frames, proxies) `ffmpeg` and `ffprobe` on `PATH` or named by the `PAWSCRIPT_FFMPEG` / `PAWSCRIPT_FFPROBE` environment variables. Without ffmpeg the app runs; media commands fail with `ffmpeg_missing` and video duration comes from the player.

```powershell
npm install
npm run tauri dev      # the desktop app: vite on 5173 + the Rust backend
npm run tauri build    # a bundled installer (runs npm run build first)
```

`npm run dev` alone opens the front end in a browser against an in-memory backend. Nothing you do there touches disk; use it to look, not to work.

The tracker is optional and separate:

```powershell
uv sync --project trackers                                   # base trackers, CPU only; uv fetches Python 3.12 and the deps, no model checkpoints
uv sync --project trackers --extra sam2 --extra describe     # ML extras: installs torch 2.12.1+CUDA from the PyTorch index; checkpoints download on first use, not at install
```

The built app registers `.pawproj` as its file type. The window opens at 1440x900 (minimum 900x600).

## Open a video

Any of these works:

- `File > Open…` (`Ctrl+O`). The dialog accepts videos, `.pawproj` and `.funscript` files, several at once.
- Drop files anywhere in the window.
- Click a card on the **Projects** page (the home tab; right-click or `…` on a card: Show in folder, Pin, Go back to a checkpoint, Remove from list).
- **Empty script** on the Projects page: one empty `stroke` axis, no video.

Video extensions recognized: `mp4`, `m4v`, `mkv`, `webm`, `mov`, `avi`.

What happens on open:

1. The video is probed with ffprobe (duration, fps, size, VFR, audio track).
2. Sibling funscripts are looked for: `clip.funscript` for the stroke axis and `clip.<axis>.funscript` for the others (`roll`, `pitch`, `twist`, `surge`, `sway`, `vib`, …; T-code names like `R1` are accepted too). If a `clip.pawscript.funscript` sits beside `clip.funscript`, the `.pawscript` one is loaded and the other is named as the original.
3. Nothing is asked. A project beside the video (`clip.pawproj`) opens as the project. Without one, the script found beside the video loads as its axes, with one quiet toast that offers any other candidates (`clip (1).funscript`, …) as ghosts. A funscript edited outside Pawscript since Pawscript last wrote it stays a reference ghost to compare, with **Load the file** in the toast.
4. You land where you left off: playhead, zoom, tab, selection and the undo history come back.

**Several projects at once.** Each opened project or video gets its own tab in the top bar, after the Projects tab; opening one that is already open shows its tab. Click a tab to show it, `Ctrl+Tab` / `Ctrl+Shift+Tab` go round them, `Ctrl+W`, a middle-click or the tab's x closes it (written first, no question), a drag reorders. Each tab keeps its own playhead, view, selection, undo and stage tab, and goes on writing itself while hidden. When hidden tabs hold a lot of memory, the one shown longest ago is parked: its name turns italic and it opens again from disk, where it was, when you show it. The open tabs come back at the next start.

Dropping a video together with funscripts that are not its siblings imports those funscripts after the video opens. Dropping several videos opens the first.

Opening a `.funscript` with no document open looks for a same-stem video first; without one it edits the file on its own (timeline length = script end + 2 s).

## Import a funscript

`File > Import funscript…` (`Ctrl+Shift+O`). The axis comes from the file name (`clip.roll.funscript` → `roll`; a plain name → `stroke`). If that axis already has points you choose **Replace `<axis>`**, **Add as reference ghost**, or **Cancel**. Chapters and bookmarks in a stroke file are taken over when the document has none.

## Save, commit, publish

The project writes itself: about a second after every change the `.pawproj` (beside the video, `clip.pawproj`), its tracker runs (`clip.pawruns`) and the undo history (`clip.pawhistory\`) are written. There is no Save for the project and no "unsaved" mark; closing, quitting or opening another never asks. The `.funscript` a player reads is written only by Publish or an export. Tracked shots are in it as they play (live); Bake (`Shift+B`) is never needed for that.

| Command | Keys | What it writes |
|---|---|---|
| `File > Commit…` | `Ctrl+S` | a named point in the project history (never pruned): the dialog lists what changed since the last commit, by shot / scene, and takes an optional note (`Enter` commits, `Esc` cancels). Changes inside one shot or scene make a commit for that section, which can later be restored in that section alone |
| `File > Publish` | `Ctrl+Alt+S` | every non-empty axis as its sibling funscript next to the video, stamped with the next version (`metadata.pawscript.publish`: v1, v2, …) and kept in the history as a restorable entry. The status bar shows "v3 published · 14 edits since" |
| `File > Project history` | – | the **Commits** panel (right dock): every commit, publish and automatic checkpoint with what changed; go back (one undo step), go back in its shot / scene only, compare as a ghost, note, delete |
| `File > Save project as…` | `Ctrl+Shift+S` | picks a `.pawproj` path and moves the project there (no funscript) |
| `File > Export funscripts…` | `Ctrl+E` | funscripts only. Three choices: **All axes (…)** as edited (labeled with the axis name when there is only one), **Only `<active>`** as edited (shown when there is more than one axis), **All, Device safe**. Device safe always covers every axis; there is no Device safe export of the active axis alone. Then: next to the video or into a folder |
| `File > Revert to saved` | – | reloads from disk, dropping unsaved changes (asks first) |
| `File > Close` | `Ctrl+W` | closes the document's tab (written first; no question) |

Rules that matter:

- A `.funscript` that Pawscript did not write is never overwritten silently. The first overwrite keeps the original as `name.bak`; an existing `.bak` is never overwritten, so if it holds different content the copy goes to `name.2.bak`, `name.3.bak`, … (same content is reused). Files Pawscript itself last wrote get no `.bak`; their previous version goes to the rolling backups in the app data folder instead, newest `backup.keep` (1–100, default 10) kept. If the file changed on disk since Pawscript last wrote it, Publish asks: **Replace**, **Save as .pawscript.funscript**, **Compare (show theirs as ghost)**, **Reload from disk…**, or **Cancel**.
- Loops, plan segments, scenes, tracker runs and feature blocks only fit in a `.pawproj`; a document with a video always has one (beside the video, else in the app data folder's `projects`).
- Unknown keys in someone else's funscript survive a save.
- Bookmarks and chapters from another tool (funscript metadata) are kept as they are: saved back into the stroke file and the project, never shown or edited.
- A saved project records the video's size and a content fingerprint, so a moved video is found again (same folder as the project or the old folder, three levels deep). If it is not, the video pane shows **Locate video…**.

### Checkpoints and recovery

There are no Restore / Recover questions any more. Checkpoints are taken by themselves (after a track lands, before a run is discarded, on close; the file as first opened is kept for good) in `clip.pawhistory\`; the Projects page card's menu **Go back to a checkpoint** restores one (where you were becomes a checkpoint first). Undo survives closing. The status bar says **Not written** only when a write fails; the work then goes to an app-data snapshot, which opens by itself next time.

## The layout

```
┌ top bar: menus (File Edit Play View Track Review Help) · stage tabs · Projects tab + document tabs · undo redo palette ┐
│ left dock │              video pane  │ machine preview │ right dock                      │
├───────────┴──────────────────────────────────────┴─────────────────────────────────┤
│ timeline: overview · ruler (loops on it) · scenes · modifiers · range · plan · probe · audio · lanes │
├────────────────────────────────────────────────────────────────────────────────────┤
│ bottom tray (folds away; Graph)                                                    │
├────────────────────────────────────────────────────────────────────────────────────┤
│ status bar: write state · video fps · active axis + point count · selection · range · zoom · (i) = F1 │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Tabs (stages of the job)

Four tabs, in the order you work: each picks which panels, timeline rows, toolbar chips and video overlays show, and
each remembers its own arrangement of areas. In the code and the settings a tab is a *mode*.

| Tab | Keys | For |
|---|---|---|
| Scenes | `Ctrl+1` | timeline hygiene: detect and describe scenes, fix cuts (add a missed one, move one a frame or two, join a cut that was a camera move), shots, loops. The Actions panel on the left, the Inspector and History on the right; the Scenes row (loops on the ruler); the Scene and Shot chips; on the video only the describe tag boxes you Show |
| Track | `Ctrl+2` | click a shot, seed groups, track, check the direction and flip: the Tracking panel on the left, Inspector, Plan, Assist, Machine on the right; the stroke lane is the tracker lane (the runs' traces, anchors and seed marks on it, one controls band under it; no separate Tracker row); the Scene and Shot chips, Groups, Track, Track ROI and a cog for the tracker's settings; the tracker and Groups overlays |
| Refine | `Ctrl+3` | hand editing (for now what the old Script mode held): Inspector, Quick actions, Points, Transform, Snippets, History on the right; left dock starts folded |
| Review | `Ctrl+4` | Problems, Statistics, Compare, Device and heatmap; stats/compare/device sit on the left |

The segmented control at the top left, right after the menus, switches tabs too. The last tab is remembered (`mode`
setting; a stored `script` from before the stage tabs opens as Refine, with Script's layout).

### Areas, docks and panels

The body of the window is a set of **areas**, the Blender way. The default arrangement is the one drawn above: the
left dock, the video and the right dock side by side over the timeline, the bottom tray under both. Each panel area
holds its panels as tabs; the video and the timeline are areas too (they can move, never close). Each stage tab keeps
its own arrangement (settings `layout`); **Reset layout** brings back the default.

| Do | How |
|---|---|
| resize two areas | drag the border between them |
| move a panel | drag its tab onto another area: over an edge (the drop preview shows that half) it gets a new area there; over the middle it joins that area as a tab. Esc or a right-click cancels the drag |
| move a whole area | drag the empty part of its header (or Ctrl+drag one of its corners) onto another area: an edge docks it there, the middle swaps the two |
| split an area | drag from one of its corners (the crosshair at each corner) inward: left/right if you pull sideways, top/bottom if you pull up or down. Or the area's `…` menu: **Split left / right**, **Split top / bottom**. A new area opens empty: pick its panel with the button at the left of its header |
| join two areas | drag from a corner outward, onto the neighbor that shares the whole edge: it is absorbed and its tabs join yours (an area with panels never merges into the video or the timeline) |
| border menu | right-click a border: **Vertical split** / **Horizontal split** (the line follows the pointer; click to place it), **Join** (keep either side), **Swap areas** |
| show any panel in an area | the button at the left of an area's header lists every panel of the stage tab; picking one moves it there |
| close an area | its `…` menu: **Close area** (its tabs go to the neighboring area) |
| maximize | `Ctrl+Alt+Space` with the pointer over an area (again: back). Blender uses Ctrl+Space; here that is **Play range** |
| fold | the fold button at the right of a header, or the keys below: the area becomes a 24 px rail of its tabs |

| Keys | Command |
|---|---|
| `Ctrl+B` | fold / unfold the left dock |
| `Ctrl+Alt+B` | fold / unfold the right dock |
| `Ctrl+J` | fold / unfold the bottom tray |
| `Ctrl+Alt+Space` | toggle maximize area (the one under the pointer) |
| – | `View > Reset layout for this tab` (`layout.reset`) |

A dock with no panels in the current tab is left out (Refine has no left panels). The bottom tray folds to a Show button at the
bottom edge. New panels go to the dock their feature names.

Panels, by their default dock and the tabs they appear in:

| Panel | Dock | Tabs |
|---|---|---|
| Scenes | left | scenes |
| Tracking | left | track |
| Inspector | right | scenes, track, refine |
| Quick actions | right | refine |
| Points | right | track, refine, review |
| Fix section | right | track, refine, review |
| Assist | right | track, review |
| Director | right | track, refine, review |
| Plan | right | track, refine |
| Machine | right | track, refine, review |
| Transform | right | refine, review |
| Problems, Statistics, Compare, Device and heatmap | right (stats/compare/device default to left) | review |
| Device | right | track, refine, review |
| Snippets | right | refine |
| History | right | all |
| Graph | bottom | track, refine |

### Timeline rows

Top to bottom. Every row spans the full width and aligns to the same time viewport; a hide chip (top right, on hover) folds a row into the **Hidden** strip at the foot of the stack (click a name there to bring it back), and a handle under each row resizes it. Right-click a chip for **Reset its height** and **Reset rows** (every row back to the tab's default heights and shown / hidden state; also **reset rows** at the right of the Hidden strip). The bottom tray's **Rows** tab, or a right-click on any row's chip, shows a hidden row again; a double-click on the handle under a row gives it its default height.

| Row | Default height | Notes |
|---|---|---|
| Overview | 44 | whole-file minimap |
| Time | 28 | ruler; along its top edge the **repeated frames**: one tick per occurrence of a picture that shows up more than once in the video (exactly, held frames count once), one color per picture. Hover a tick: its picture's ticks stand tall and the tip says how often it repeats; click: jump to it. A loop (every frame of it repeats) is one tick per time round, at its loop frame: drag a tick left / right to pick another frame of the loop (all its ticks move, the video shows the frame; one undo step, saved in the project); Suggest prefers that frame. Right-click a tick: copy that frame's painted groups to its repeats. Worked out once per video in the background (status bar: Repeated frames; cached). View › Ruler: show / hide repeated frames |
| Scenes | 24 | cut markers from the tracker; starts folded in Script and Review |
| Modifiers | 24 | the modifiers layer (Reshape, Knotting, spurts, …): an edge snaps to stroke turns (Shift: free), Alt+drag copies, double-click fits, `Ctrl+←` / `→` nudges a frame. The modifier commands act on the selection, else the I/O range, else the scene at the playhead (Detect cumshots too; Flatten on the I/O range, else everything) |
| Range | 56 | Autorange's depth band per scene; shown by Autorange (`Ctrl+Alt+R`) or View › **Show / hide the Range row** |
| Tracker | 110 | tracker signal, right under the Range bars; Refine and Review only, hidden by default (in the Track tab the stroke lane carries it) |
| Plan | 64 | the legacy plan (segments the generator fills); **starts hidden** (the plan still drives Draft, the Director and the graph; bring the row back from the Hidden strip) |
| Probe | 64 | graph node output; starts folded |
| Audio | 36 | waveform; hidden when the probe says there is no audio track; starts folded in Script and Track |
| Lanes | fills the rest (min 180 px) | one lane per axis; stroke 168 px, others 104 px by default. Drag the handle under a lane, or `Ctrl`+wheel over it, to resize it; double-click the handle for the default height. The last lane's handle resizes the timeline with it |

A layout saved before this order is migrated once (layout v2): the Plan row hides unless you had resized or shown it yourself; a Tracker row you had resized or toggled keeps that.

Drag the splitter above the timeline to give it more or less height (120–900 px).

### Lanes

One lane per axis, the active axis highlighted. The timeline viewport is shared, so the overview, ruler and every lane line up. Keys you will reach for first:

| Keys | Command |
|---|---|
| `Space` | play / pause (fires on release; hold and drag to pan a lane) |
| `←` / `→` | previous / next frame; with a click, box, paste or `Ctrl+A` selection: nudge it a frame instead (points newly placed with the point keys, `Insert`, `Q` are selected but `←` / `→` keep stepping frames) |
| `Shift+←` / `→` | jump 1 s (`view.seekStepMs`) |
| `Home` / `End` | start / end |
| `J` / `K` | shuttle reverse / stop (in the Scenes tab `K` cuts the shot at the playhead; with Groups open it is the knot brush) |
| `[` / `]` / `\` | slower / faster / normal speed |
| NumPad `0`–`9` | point at pos 0, 10 … 90 at the playhead. In the OFS keymap (setting `keys.preset`) the number row too, `Shift+0` = 100, `Shift+1`–`Shift+9` = 15, 25 … 95 |
| `1` / `2` / `3` / `4` | Blender keymap (the default): select points / segments / strokes / cycles; `Alt`+click the loop, `Ctrl`+click the path |
| `G` / `S` / `R`, `.` | grab, scale (time and level), rotate (tilt the levels); `.` the pivot |
| `E` | extrude a new point from the active one |
| `Insert` | add a point on the line at the playhead (`A` toggles select all / none, `B` box select, `C` circle select) |
| `Q` | repeat the last stroke at the playhead |
| `Shift+W` / `W` | previous / next point (OFS keymap: `,` / `.`) |
| `Delete` / `Backspace` | delete selected (or the point at the playhead) |
| `Enter` | edit the selected point's values |
| `↑` / `↓`, `Shift+↑` / `↓` | nudge selected ±`edit.posStep` (5) / ±1 |
| `Ctrl+Z`, `Ctrl+Y` | undo, redo |
| `Ctrl+C` / `X` / `V` | copy, cut, paste at playhead (replace); `Ctrl+Shift+V` merge, `Ctrl+Alt+V` insert |
| `Ctrl+A`, `Ctrl+I`, `Esc` | select all, invert selection, clear selection then range |
| `I` / `O` | range in / out at the playhead |
| `L`, `Shift+L` | mark loop in then out (second `L` starts looping); loop playback on / off |
| `=` / `-` / `Ctrl+0` / `Z` / `Shift+R` | zoom in / out / fit / to selection / to range |
| `Shift+F` | follow playhead on / off |
| `N` | snap to frames on / off (`edit.snapFrames`, default on) |
| `H` | speed colors on / off |
| `Alt+↑` / `Alt+↓`, `Alt+1`–`9` | previous / next lane, focus lane N |
| `V` | record live with the mouse or the point keys (OFS keymap: `R`) |
| `M` | device simulator overlay on the video |

Points snap to video frames by default; `N` toggles it. A new point within half a frame of an existing one replaces it.

### Video pane

Transport and a time field sit under the picture. `View > Video:` commands fit, fill, show 100 %, rotate, flip and cycle guides. `Ctrl+M` mutes. `Ctrl+Shift+C` copies the current frame to the clipboard; `File > Save frame as PNG` writes it. A video the player cannot decode offers `File > Make a playable proxy of this video` (needs ffmpeg).

### Inspector and Points (right dock)

**Inspector** (the tab Script and Track open on) edits what you clicked last in the timeline: an effect's curve (the same editor as its popover), the selected plan segments, the selected scene's tags, tracker and signal (the scene quick bar's controls), else a line for the loop or tracker run. The popovers still open from the lanes.

**Points** shows the point selection, the range and the axis as numbers you can edit. **Quick actions** and **Transform** run the edit operations from `src/lib/edit` on an **Apply to** scope shared by both: Selection, Range, Chapter, Axis or All axes. The same operations have lane keys: simplify `Shift+S`, scale amplitude `Ctrl+↑` / `Ctrl+↓`, stretch / compress `Ctrl+Shift+→` / `←`, invert `Shift+I`. **History** lists every undo step by label; select one to jump there.

### Command palette and help

| Keys | What |
|---|---|
| `Ctrl+K` or `Ctrl+Shift+P` | command palette: every command, fuzzy search; `:1:23.5` seeks |
| `F1` or `Shift+/` | help overlay: the Quick start, and Shortcuts (on top the keys for the tab you are in; filterable); the page you picked last opens next time |
| – | `Help > Copy bug report` copies the build, Windows, graphics card and the last errors (no file names) to paste into a report; `Help > About Pawscript` shows the version, build and where your data is |
| `Ctrl+Alt+K` | keybinding editor (an overlay; also **Edit shortcuts** in F1): click a binding, press a chord or up to three for a sequence |

Every menu item, button and key runs the same command, so anything you see in a menu is in the palette under the same title.

## Themes and density

`View > Theme:` **Dark** (default), **Light**, **High contrast**. `View > Density:` **compact**, **default**, **comfortable**. Both persist (`ui.theme`, `ui.density`) and apply immediately.

`View > Furry items: show / hide` (setting `content.furry`, default show). Off: the paint tool offers no tail or sheath, paws read as feet and slit as vulva; the animal-only scene tags, the tagger's tags for animal anatomy, species words and the animal Machine bodies are not offered. The knot stays. Projects are the same on disk either way, and a project that already has a tail group or an animal tag keeps showing it.

## Settings

`Ctrl+,` (File > Settings, or "Settings" in the palette) opens the **Settings** panel in the right dock; `Ctrl+,` again folds it. On the Projects page with nothing open it opens over the page.

- **Grouped**: General, Keyboard, Playback & device, Video & cache, Tracking, Timeline & lanes, Machine & Stroker, Projects & tabs, Content, Advanced. Each row has its name, one line on what it does and its control (a switch, a choice, a number with its unit, a folder with a browse button).
- **Search** filters by name, description or key (`tabs.memoryMB`).
- A setting you changed is marked on its left and has its own reset. A change applies at once; there is no Apply and no undo for settings. The few read when a tab opens (undo memory, merged nudges) say "after a restart".
- **Show advanced** adds the settings that are state rather than preference: layouts, recent lists, the tracker view's own options.
- **⋯**: Export settings (a `.json` file), Import settings (a value that does not fit is skipped), Reset all to defaults (asks first; layouts, recent lists and key bindings stay). All three are in the palette too.
- The same settings stay where they were: the View menu (theme, density, furry items), lane toggles, each panel's own controls, the Shortcuts editor.
- Settings are personal: they are never written into a project, a pack or a bug report. The usage log notes which setting changed; for folder paths only the key, and your Stroker size not at all.

Settings you might look for: where a new project is kept (beside the video or the projects folder), whether the tabs open at quit come back, how much memory hidden tabs may hold, how many automatic checkpoints stay, what `Ctrl+S` does with no changes and whether it asks for a note, Smart stroke on new runs, the default tracker, its model size and points, whether a re-track keeps the earlier run, what a plain drag and a double-click do on the stroke lane, the Groups bar's fold, brush and opacity, the proxy height, the media cache size, how long an error message stays.

The settings file below keeps unknown keys. The shell's own keys and defaults:

| Key | Default | What |
|---|---|---|
| `autosave.seconds` | 30 | autosave interval; 0 turns it off |
| `backup.keep` | 10 | rolling backups (app data folder, 1–100) kept per file Pawscript last wrote; not the `.bak` siblings |
| `history.coalesceMs` | 1000 | rapid repeats of the same small edit within this window are one undo step |
| `history.capActions` | 4000000 | undo memory cap in actions held; oldest steps drop first |
| `player.rate` | 1 | playback rate (0.05–16) |
| `player.follow` | true | timeline scrolls to keep the playhead in view while playing |
| `edit.posStep` | 5 | nudge step for `↑` / `↓` |
| `edit.snapFrames` | true | new and moved points snap to video frames (`N`) |
| `view.seekStepMs` | 1000 | `Shift+←` / `→` jump |
| `ui.theme` | `dark` | `dark`, `light`, `contrast` |
| `ui.density` | `default` | `compact`, `default`, `comfortable` |
| `mode` | `scenes` | last tab: `scenes`, `track`, `refine`, `review` (a stored `script` opens as `refine`) |
| `layout`, `layout.docks` | – | the area tree and timeline rows per tab; panels moved to another dock before areas |
| `keys.overrides` | `{}` | your key bindings; `[]` unbinds a command |
| `recent` | `[]` | the Recent list |

Features keep their own keys under their prefix (`lanes.speedColors`, `lanes.latencyMs`, `tracking.lastTracker`, …); the lane toolbar and each feature's panel are where you set those.

## Where files go

Next to a video Pawscript writes only the project's own files (the `.pawproj`, its runs and history, see Saving above) and what you publish or export. `Help > About Pawscript` shows the real paths on your machine.

| What | Windows |
|---|---|
| Settings | `%APPDATA%\app.pawscript\settings.json` (an unreadable one is moved to `settings.json.corrupt-<ms>`) |
| Recent files (OS list) | `%APPDATA%\app.pawscript\recent.json` |
| Window size / position | `%APPDATA%\app.pawscript\window-state.json` |
| Autosave snapshots | `%LOCALAPPDATA%\app.pawscript\autosave\<id>\<ms>.pawproj` + `meta.json` |
| Rolling backups of files you saved | `%LOCALAPPDATA%\app.pawscript\backups\<16 hex>\<ms>-<name>` + `source.txt` |
| Media cache (probe, waveform peaks, thumbnails, proxies) | `%LOCALAPPDATA%\app.pawscript\media-cache\` (2 GiB cap, least recently used evicted) |
| Next to your files, on save only | the saved file; `name.bak` / `name.N.bak` on the first overwrite of a file Pawscript did not write; a transient `.<name>.<random>.tmp` during each write |
| Tracker | `trackers/.venv/`, `trackers/.cache/`, `trackers/.models/` |

macOS: `~/Library/Application Support/app.pawscript` and `~/Library/Caches/app.pawscript`. Linux: `~/.config/app.pawscript`, `~/.local/share/app.pawscript`, `~/.cache/app.pawscript`.

The app goes online only when you ask it to: Settings > Models (download the runtime and the models you pick) and Help > Check for updates. In a source checkout the other downloads are on the tracker side: `uv sync` fetches Python and the package deps (the ML extras pull torch 2.12.1+CUDA from the PyTorch index), and the optional ML model checkpoints are fetched the first time a tracker that needs them runs, not at install.

## First session, end to end

1. `npm run tauri dev`, or launch the built app.
2. `Ctrl+O`, pick the clip. A script already beside it loads as the axes (no question).
3. `Space` to play, `K` to stop, `←` / `→` to frame-step. Press NumPad `0` at the deepest frame, NumPad `9` near the fully-out one, repeat (in the OFS keymap the number row places points too, `Shift+0` = 100); or click a point and press `E` to pull the next one out of it (`E` again chains). `Q` repeats the last stroke.
4. `Ctrl+Alt+S` (Publish). The stroke lands in `clip.funscript` beside the video, as v1. If the clip already had a `clip.funscript` you did not write, the original is kept as `clip.funscript.bak`, or pick **Save as .pawscript.funscript** to leave it alone.
5. The project (`clip.pawproj`) was written beside the video all along; loops (`L L`), scenes and tracker runs live there. To track instead of placing points by hand, follow the [quick start](quick-start.md).
