# Pawscript front end — architecture and ownership

Pawscript is a funscript editor and semi-automatic scripter (Tauri 2 + Svelte 5 + Vite, plain CSS, no UI
framework, no state library). Product intent: `pawscript-design-outline.md` (the stack section there is
obsolete; the flows, UI layout, shortcuts, loops and safety-net sections stand). Sidecar contract:
`trackers/PROTOCOL.md`. Sibling app whose design language we borrow: `OpenValence/Phosphor` (a sibling checkout)
(read-only).

Many agents build this at once. The rules below exist so their work drops together without conflicts.

## Shared contracts (frozen — add, never change)

- **Script data**: `src/lib/core/script.js`. `Action = {at:int ms, pos:int 0..100}`, `Script = Action[]` sorted,
  strictly increasing `at`. **pos 0 = deepest, 100 = out.** Scripts are immutable values; every function
  returns a new valid Script and never mutates input. Use `normalize()` at trust boundaries.
- **Time viewport**: `src/lib/lane.js` — `view = {start, span}` in ms, `clampView`, `zoomAt`, `panBy`,
  `xToMs`, `msToX`, `tickStep`. Every time-based surface (lanes, overview, strips) uses these so they align
  pixel for pixel.
- **Axes**: ids from `src/lib/funscript.js` `AXES` (`stroke` is the main axis; `roll`, `pitch`, `twist`,
  `surge`, `sway`, …). Multi-axis = one Script per axis id, saved as sibling files
  (`video.funscript`, `video.roll.funscript`, …).
- **Sidecar protocol**: `src/lib/protocol.js`, `src/lib/sidecar.js`, `test/fake-pawtrack.mjs`.

## Layout of `src/` and who owns what

| Path | Contents | Owner |
|---|---|---|
| `lib/core/` | script contract | frozen |
| `lib/edit/` | pure edit operations and transforms on Scripts | edit-lib agent |
| `lib/gen/` | pure pattern generators, recipes, loop tiling | gen-lib agent |
| `lib/analyze/` | pure analysis: heatmap, statistics, problems | analyze-lib agent |
| `lib/io/` | pure (de)serialisation: funscript multi-axis, `.pawproj` project schema, migrations | analyze-lib agent |
| `lib/valence/` | Valence hub client: `link.js` (session -> segments STREAM, safety, telemetry by role), `vendor/` = the Valence JS reference client, verbatim (MIT; refresh by re-copying, never edit) | playback agent |
| `ui/kit/` | design tokens (`theme.css`) and reusable components | kit agent |
| `app/` | shell: layout, document store, history, command registry, keymap, registries, settings | shell agent |
| `features/lanes/` | the lane editor (canvas, point editing, selection) | lanes agent |
| `features/video/` | video pane: player controller, overlays, simulator, hover preview | video agent |
| `features/timeline/` | overview/minimap, heatmap strip, plan (segment) lane, ruler (chapters and bookmarks: data only, no UI) | timeline agent |
| `features/<other>/` | later drop-in features (inspector, problems, project, palette, tracking, …) | assigned per feature |
| `../src-tauri/` | Rust commands (file IO, autosave, recent files, ffmpeg helpers); API in `src-tauri/API.md` | rust agent |
| `../dev/` | standalone harness pages, one per feature (`dev/<feature>.html` + `dev/<feature>.js`) | each feature |
| `../test/` | plain node tests, `test/<area>-*.test.mjs` (run by `npm run check`, which globs) | each area |
| `lib/graph/`, `features/graph/` | node graph: pure engine + node catalogue + doc adapters (`lib/graph/README.md` = contract), editor and integration (`features/graph/DESIGN.md`) | graph agents (engine, nodes, editor, integration; split in DESIGN.md §11) |

Only the shell agent edits `package.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/App.svelte`,
`src/style.css` and the existing top-level components (`Panel.svelte`, `Lane.svelte`, `Scenes.svelte`,
`VideoPane.svelte`, `lib/bench.svelte.js`, `lib/runs.js`). Everyone else creates files only inside their
own directories. Need something from another area? Import it if it exists; otherwise code against the
interface written here or in that area's `README.md`, and say so in your report. Do not add npm
dependencies (Playwright is already a devDependency for screenshots: `chromium.launch({channel:'msedge'})`).

## How features plug into the shell (no shared registry file to fight over)

The shell discovers modules with `import.meta.glob`, so adding a feature never edits a shared file:

- `src/features/*/panel.js` → default export `{ id, title, icon?, dock: 'left'|'right'|'bottom', order, modes?: ['scenes','track','refine','review'], component }`
- `src/features/*/lane.js` → default export `{ id, title, order, height, component }` for rows in the timeline stack
- `src/features/*/commands.js` → default export `Command[]`

A `panel.js` or `lane.js` default export may also be an ARRAY of such objects (one feature, several panels or rows).

`Command = { id: 'area.verb', title, keys?: ['Ctrl+Z'], when?: (app) => bool, run: (app, args?) => void }`.
Every user action is a command — the keymap, the command palette, menus, buttons and the help overlay all
read the same registry. Never bind keys directly in a component.

## The `app` object features receive (shell agent implements; this is the interface)

```
app.doc            document store ($state):
  .axes            { [axisId]: Script }            .activeAxis   axis id being edited
  .selection       { axis, ats: Set<int> }         selected action timestamps on that axis
  .range           { t0, t1 } | null               time-range selection (I/O)
  .chapters        [{ id, t0, t1, name, color }]   .bookmarks  [{ id, at, note }]
  .loops           [{ id, t0, t1, tiledTo? }]      .plan       [{ id, t0, t1, kind, recipe, params }]  (kinds: lib/gen KINDS; the
                   finale is climax = fast run-in → orgasm → afterglow; .pawproj v2, v1 'climax' pulses migrate to 'orgasm')
  .fx              [{ id, kind, t0, t1, params?, muted?, label? }]  effects layer over the tracked motion, may overlap (lib/fx.js applyFx;
                   timeline Effects row; tracker ghosts are drawn and accepted through it; .pawproj block `fx`)
  .ghosts          [{ id, name, color, script, visible, source }]   read-only overlays (tracker runs, reference)
  .media           { path, name, durationMs, fps, isVfr, width, height } | null
  .dirty           bool
app.edit(label, axis, nextScript)        the ONLY way to change a script: pushes one undo entry
app.transact(label, fn)                  group several edits (and non-script changes) into one undo entry
app.undo() / app.redo() / app.history    undo stack with labels
app.player         { timeMs ($state), playing, rate, frameMs, seek(ms), play(), pause(), step(dir), loop: {t0,t1}|null }
app.view           { start, span } ($state) shared time viewport;  app.setView(v), app.follow (bool)
app.mode           'scenes' | 'track' | 'refine' | 'review'   (the stage tabs, app/modes.js; a stored 'script' opens as 'refine')
app.commands       run(id, args), list(), keysFor(id)
app.settings       get(key), set(key, value)   (persisted)
app.toast(msg, kind?) ; app.confirm(opts) -> Promise<bool>
app.backend        thin wrappers over Tauri commands (see src-tauri/API.md) and the sidecar
app.tabs           the window's tabs (app/tabs.svelte.js, paw-shgb): ONE app per open document, all sharing one settings
                   object, backend, usage log and this Tabs; .current = the shown app (its editor alone is mounted),
                   .list, .show(id), .open(paths), .park(app) / budget (memory), .restore() (at start)
app.cleanups       what ends with the app (its tab closed): a per-app store made with lib/rooted.svelte.js rooted(make, app)
```

Several documents (paw-shgb): a feature's state is per app (a WeakMap keyed by the app, made with `rooted(make, app)`), never
module-level, unless it is the shown tab's UI only (then it may follow `lib/shown.svelte.js`, as the timeline's `tl` does;
code that runs for a document in the background uses `tlFor(app)`). A store must not keep a component's closures or elements
after the component unmounts (a tab switch unmounts the whole editor): give them back in the component's teardown.

Until the shell exists, features run in their harness page against a small mock of this object
(`dev/mock-app.js`, owned by the shell agent; if it is not there yet, make a local mock in your harness
and keep to this interface).

## Standards

- Svelte 5 runes (`$state`, `$derived`, `$props`); state classes in `*.svelte.js`.
- Canvas for anything that scales with script length; it must stay smooth with 100 000 actions (draw only
  what is visible; no per-frame allocation in hot paths).
- Pure logic lives in plain `.js` with node tests; components stay thin.
- Keyboard first: every action reachable without the mouse; visible focus; no key handling outside the
  command registry.
- Look and feel: Phosphor's tokens and control styling via `ui/kit`; dense, calm, dark by default; no
  layout shift; 60 fps interactions; nothing decorative that costs clarity.
- Safety nets (outline §11): never overwrite a user's `.funscript` without a backup; autosave; unknown
  keys in someone else's file survive a save.
- Verify by running it: node tests, `npx vite build`, and screenshots of your harness page that you
  actually look at (use only synthetic or public SFW clips — `trackers/tests/make_video.py` makes some;
  never open anything under `Reference/`).
- Kill only processes you started, by PID. No git commits. Use a dev-server port from the table below.
- Driving a real app instance from a script (CDP / Playwright): start your own with `node dev/test-app.mjs start
  --dir <scratch> --target <your CARGO_TARGET_DIR>` (free high debugging and preview ports drawn from its id, kept by
  `restart --dir <scratch>` so localStorage survives a restart; its own identifier, the fake sidecar, and the whole app on a separate never-displayed Win32 desktop, so it can never take focus or
  pull the owner out of a fullscreen game) and attach only through `dev/cdp-connect.mjs`, which refuses
  unless port, page URL and the build's `window.__pawscriptTestId` all match yours. Never use port 9333, never a
  default port, never attach to a window you did not start; scripts never answer a destructive dialog choice (the
  app ignores scripted Discard / Replace) and close documents with `app.project.close({force: true})`.
  That is the only way to open a real app window: never a plain `tauri dev` / built exe for testing, and every
  Playwright `chromium.launch` is `headless: true`.

| Agent | Vite port |
|---|---|
| shell | 5173 (the app; `tauri dev` uses it — use a separate `CARGO_TARGET_DIR` and identifier for test runs) |
| kit | 5181 |
| lanes | 5182 |
| video | 5183 |
| timeline | 5184 |
| inspector | 5185 |
| review | 5186 |
| later features | 5187–5199, assigned in the brief |
| graph | 5187 |

## Additions (shell agent) — implemented in `src/app/`, also available in `dev/mock-app.js`

Everything above stands; these are extra members and rules. The mock IS the real store
(`createMockApp({ commands, video, doc })` builds `src/app/app.svelte.js` with an in-memory backend and loads
`sampleDoc()`), so code that works in a harness works in the app.

**Components.** Panel, lane and overlay components receive one prop, `app`. Lanes also get `height` (px).
Export arrays from `panel.js` / `lane.js` freely; the shell flattens and sorts by `order`.
`src/features/*/overlay.js` → `{ id, order, modes?, component }` (or an array): drawn over the video pane
(absolute, full size; compute the picture rect with `fitRect` from `src/lib/video.js` and
`app.doc.media.width/height`). The tracking feature uses it for ROI drawing.

**Document values are immutable and stored raw.** Replace, never mutate: `app.doc.chapters = [...]`.
Undoable: `axes.<id>`, `chapters`, `bookmarks`, `loops`, `plan`, `scenes`, `fx`, `runRanges` (paw-1ysd: which run plays where; null = derived from the links) — change them inside `app.transact` (plain
assignment there is recorded) or via `app.edit`. `selection`, `range`, `activeAxis`, `ghosts`, `media` are not
undoable (selection + activeAxis are restored with each undo step). `ghosts[i].pinned` = reference (never
auto-removed).

```
app.edit(label, axis, next, {coalesce?})   coalesce: rapid repeats of the same label (nudges) within
                                           settings 'history.coalesceMs' merge into one entry
app.transact(label, fn, opts)              fn may be async; a throw / rejection rolls everything back
app.begin(label, opts) -> {commit(), cancel()}   for drags: edits until commit() are one entry; cancel() reverts
app.history        { entries:[{id,label,time,size,applied}], index, canUndo, canRedo, undoLabel, redoLabel,
                     undo(), redo(), goto(n) }      (reactive; for a history panel)
app.select(ats, axis = activeAxis)         replace the selection     app.setActiveAxis(id)
app.script                                 the active axis's Script ([] if none): baked + live (lib/script-of.js scriptOf, paw-x7w7)
app.durationMs                             timeline length: max(media duration, last action of any axis); no media: script end + 2 s
app.mediaMs / app.scriptEndMs              media duration (0 = no media / unknown; seek and end clamps) / last action time
app.load(docLike)                          replace the whole document (clears history)
app.player         also: durationMs, ready, toggle(), setRate(r), setLoop({t0,t1}|null), snap(ms) -> nearest
                   frame start, attach(videoEl) / detach() — features/video attaches its <video> here and
                   app.player then follows it frame-accurately (rVFC); with no element it runs a timer clock
app.commands       also: get(id), enabled(id), register(list, source), setKeys(id, keys|null), resetAll(),
                   isOverridden(id), conflicts() -> [{keys, ids, kind:'same'|'prefix'}], recent (ids)
                   list({enabled = true}) -> [{id, title, keys, enabled, menu, group, source, hidden}] ({enabled: false}
                   skips every `when`: menu builders call enabled(id) lazily)
Command extras     menu?: 'File'|'Edit'|'Play'|'View'|'Track'|'Review'|'Help' (top-bar menu), group?: section
                   inside that menu, hidden?: true (not in palette/menus, keys still work), whileTyping?: bool (may
                   its chord fire from a text field; default: every command outside the Edit menu)
                   Top-bar menus (src/app/menus.js): the shell's commands and the everyday sections of lanes/video sit
                   at the top level; every other feature gets ONE submenu named after it (Track / Review list their own
                   feature at the top). Titles carry no area prefix ("Split segment", not "Plan: split segment").
app.setMode(m)     app.mode is read-only state; app.setView(v) clamps
app.choose({title, message, detail, choices:[{id,label,kind?:'primary'|'danger'}]}) -> Promise<id|null>
app.toast(msg, kind = 'info'|'ok'|'warn'|'error'|'quiet', {timeout, action:{label, run}})
app.task(label, {cancel?}) -> {update(done,total), label(text), end()}   progress in the status bar
app.backend        exists(p), readText(p), writeText(p, s), readBytes(p) -> Uint8Array, writeBytes(p, bytes) (atomic),
                   copy(a, b), remove(p), openDialog(opts),
                   saveDialog(opts), mediaUrl(path), sidecar(request, {onEvent, onFrames}) -> {result,error,
                   cancelled}, cancelSidecar(), isTauri
```

**Keys.** Bindings are canonical chords `Ctrl+Alt+Shift+Meta+Key`; sequences are space-separated (`G G`).
Digits/punctuation are physical keys (`Shift+1`, `?` is written `Shift+/`). In a text field only Esc, F-keys
and modifier chords the field doesn't own fire (the field keeps Ctrl+A/C/V/X/Z/Y, Ctrl+Shift+V, word moves, ...), and
never a command of the Edit menu unless it sets `whileTyping: true`. Commands registered earlier win a shared key (features before
the shell's core commands), so give a feature command a narrow `when` if it reuses a core key. Defaults:

| Keys | Command |
|---|---|
| Space | player.toggle |
| ← / → | player.stepBack / stepFwd (frame) |
| Shift+← / → | player.back / fwd (1 s) |
| Home / End, Shift+G | player.start / player.end (sequences like `G G` are supported for user bindings) |
| [ / ] / \ | slower / faster / normal speed |
| , / . | edit.prevPoint / nextPoint |
| 0–9, Shift+0 | edit.point0..9 (pos × 10 at playhead, snapped to frame), edit.point100 |
| Q | edit.repeatStroke |
| Del, Backspace | edit.delete (selected) |
| ↑ / ↓, Shift+↑ / ↓ | nudge selected pos ±5 / ±1 (coalesced) |
| Ctrl+← / → | nudge selected ±1 frame |
| Ctrl+Z / Ctrl+Y, Ctrl+Shift+Z | undo / redo |
| Ctrl+X / C / V | cut / copy / paste points (paste at playhead) |
| Ctrl+A / Ctrl+Shift+A | select all / select in range |
| Esc | clear selection, then range (feature commands like track.cancel take it first when active) |
| I / O | range in / out |
| L / Shift+L | mark loop in/out (the second L also starts loop playback) / loop playback on / off |
| = / - / Ctrl+0 / Shift+R | zoom in / out / fit / zoom to range |
| Shift+F | follow playhead |
| Alt+↑ / Alt+↓ | previous / next axis |
| Ctrl+1 / 2 / 3 / 4 | Scenes / Track / Refine / Review tab |
| Ctrl+O, Ctrl+S, Ctrl+Alt+S, Ctrl+Shift+S, Ctrl+E, Ctrl+Shift+O | open, commit, publish, save as, export, import funscript |
| Ctrl+K, Ctrl+Shift+P / ? / Ctrl+Alt+K | command palette / shortcut help / keybinding editor |
| Ctrl+B / Ctrl+Alt+B / Ctrl+J | toggle left / right / bottom dock (only in a tab that has panels in that dock) |
| T / Ctrl+T / F (Track) | track range (point grid) / Track ROI / flip scene at playhead (span labels derive from the scene tags at Track time) |
| Alt+Shift+X / T / G / F / D / E | fix section (features/fix, on the I/O range else the selected points' span): panel / re-track / regenerate / flip / scale depth / retime; each one undo entry |

**More plug-in points.** `src/features/*/modal.js` → `{ id, component }` (or an array): mounted once at the top
of the app (above docks), receiving `{app}`; it decides itself when to show (its own `$state`, toggled by its
commands) — used by the command palette, shortcut help, dialogs a feature owns. Timeline rows: every row spans the
full timeline width (no shell gutter: a lane draws its own label if it wants one), so `msToX(app.view, width, t)`
aligns across rows; the shell adds a resize handle under each row and a hide chip (top-right, on hover); hidden
rows fold into a thin strip. Lane rows may set `height: 'fill'` (takes the remaining height, min 180 px; the
component still receives the measured numeric `height`) and `axis`.

`src/features/*/status.js` → `{ id, order, component }` (or an array): rendered at the right end of the status
bar with `{app}` (use kit `StatusItem`). `src/features/*/boot.js` → a default `(app) => void`, run once by `bootApp`
before the shell mounts (a throw is listed in `problems`): where a feature makes its long-lived store, so the store's
effects belong to no component and its blocks are registered before any project loads (tracking). Feature blocks in the project file: `app.registerBlock(key, {save(app)
-> JSON|null, load(app, value|null, {autosaveDir?}), saved?(app, projectPath) -> Promise, autosaved?(app, dir) -> Promise})` — the one mechanism for a feature's own top-level `.pawproj` block (written
on save and autosave, loaded after every open/restore); unknown top-level blocks also round-trip untouched. `saved` runs
after each save of the `.pawproj` (`app.blocksSaved(path)` -> error list) for a file a feature keeps beside it; a throw is
reported in the save toast and the document stays dirty.
`app.devicePreview` = `{on, ghost, engine, available, toggle()}` (machine preview of the active axis under the
active device profile; its ghost has `source: 'device-preview'` and is never saved).
`app.usage` (`src/app/usage.svelte.js`): local usage log, `note(kind, detail?)` (every command id is noted on run; features
note `'<area>:<action>'`, or call `noteUsage(app, kind, detail?)`), `top(n)`, `report()`, `clear()`; localStorage `usage.log`
(last 5000 `{t, kind, detail?}`) + `usage.counts`; commands `usage.report` / `usage.clear` (Help).
`app.fixes` (`src/app/fixlog.js`): the fix log, fed from every undo step and usage event: what the owner changed of what
the app produced, as episodes in `<data_dir>/fixes.jsonl` (`docs/fix-log.md`, `dev/fix-report.mjs`); feedback notes
(`` ` ``, `src/features/feedback`) go to `<data_dir>/feedback.jsonl`.

**Continuous projects (paw-up1r stage 1, paw-bztd; supersedes the save / autosave / recovery questions below).** Every change
reaches the `.pawproj` (+ `.pawruns`) about a second after it is made (`app.project.flush()` now; never during a drag or
playback, a minute at most); `doc.dirty` only means "not written yet" and nothing shows it. Closing, opening another and
quitting ask nothing (`close({quit})`). A document that never had a place gets `<stem>.pawproj` beside its video, else
`<data_dir>/projects/`. Beside the project, `<stem>.pawhistory/` (`src/app/project-history.js`): `undo.json` (the undo stack,
reloaded when it matches the file's sha256) and automatic checkpoints (`index.json` + `<id>.pawproj`: after a track lands,
before a run is discarded, on close, the file as first opened kept for good; newest 20 + one per day).
`app.project.checkpoint(label)` before a big change (a feature's 'Before clean'), `checkpoints` (newest first),
`restoreCheckpoint(id)` (the state left becomes one first; the project page's card menu lists them). Where the owner was
(playhead, view, tab, axis, selection, range, loop, speed, video zoom, the timeline's selected shot / region / modifier, the
selected run) is kept per document in localStorage `pawscript.resume` and put back on open; `reopenLast()` at start. The
app-data autosaves only catch a project that cannot be written (`writeError`, the status bar), and open with it without a question.

**Commit, history, Publish (paw-up1r stage 2).** Ctrl+S (`file.save`, now "Commit…") opens the commit dialog
(`features/history/CommitDialog.svelte` over `app.project.commitDraft`): what changed since the last commit, by section
(`src/app/history-diff.js diffDocs`: points per axis, runs, modifiers, regions, loops, plan, bookmarks, run links per shot; cuts,
chapters, graphs, settings, blocks = project), an optional note. All changes in one shot / one scene: the commit is FOR that
section (`scope` on the entry), and its "go back in this section only" (`restoreCheckpoint(id, {section: true})`,
`restoreSection`) touches nothing outside the span. Entries in `index.json` carry `kind` (auto | commit | publish; commits and
publishes are never pruned), `note`, `version`, `scope`, `changes` (since the entry before; a commit: since the last commit),
`sum`. A restore is ONE undo step (the present checkpointed first; runs made since are never dropped). The Commits panel
(`features/history/EntriesPanel.svelte`, right dock, File > Project history, the status chip, the project page card) lists
them: go back, go back in the section, compare (`compareCheckpoint`: a `checkpoint` ghost, never saved), note, delete.
File > Publish (Ctrl+Alt+S, `app.project.publish()`) is the ONLY write of the funscripts beside the video: each stamped with
`metadata.pawscript.publish {version, commit, date, build}`, the project's `published` block, a `publish` entry for that
state. Save As moves the project and writes no funscript; Export still writes anywhere. A project from before Publish whose
funscript is what Pawscript last wrote (`scriptFiles`) adopts it as v1. The app's own playback and the device use the live
document; anything reading the folder (players) sees only what was published.

**app.project** (shell, `src/app/project.svelte.js`): `name`, `path` (.pawproj or null), `recent` (reactive),
`openPaths(paths)`, `openVideo(path)`, `openProject(path)`, `openDialog()`, `importDialog()` (funscript → an
axis or a reference ghost), `save()`, `saveAs()`, `exportDialog()`, `close()` → Promise<bool>.
Opening a video looks for sibling funscripts for every axis and asks: edit them, use them as reference
(pinned ghost `{id:'ref', pinned:true, source:{kind:'reference', path}}`), or ignore. Saves never overwrite a
foreign `.funscript` without a first backup; autosave every `autosave.seconds` while dirty into the app data dir
(`%LOCALAPPDATA%pp.pawscriptutosave\<id>\<ms>.pawproj` + `meta.json`, the 10 newest snapshots kept; see
src-tauri/API.md `autosave_*`), offered for recovery on the next open and at launch. A `clip.pawscript.funscript`
(what a save writes when the plain file is someone else's) is preferred over `clip.funscript` when both exist.
Loops, plan, scenes, effects, tracker runs and project blocks only fit in a `.pawproj`: saving a session that has them and
no project asks for one (Save As). Every tracker run, overlay frames included, is written beside the project as
`<stem>.pawruns` after each save (tracking block `runs`, `src/lib/runs-file.js`) and read back on open; autosave writes
`runs.pawruns` into its folder whenever the runs changed (block hook `autosaved(app, dir)`), and restoring that autosave
reads it (block `load` gets `{autosaveDir}`). Runs leave it only when the user removes them. Changes that are not undo steps (ghosts, project blocks) still mark the document
dirty. A saved project carries `media.size` / `media.hash` (`file_fingerprint`), so a moved video is found again.
The project page (`src/app/ProjectPage.svelte`, model `home.js`, paw-xn04) replaces the welcome screen: the recents as cards
(an entry may carry `video`, `summary`, `thumb` / `thumbKey` / `thumbMs`, refreshed on open / save / autosave) plus a card for
every unsaved autosave (listed until saved or discarded: `restoreAutosave(id)`, `discardAutosave(id)`); it opens only through
`openPaths(paths, {recover})` (`recover`: restore that file's autosave without asking). "Save changes?" offers Keep unsaved
(close; the autosave stays). Every funscript written carries `metadata.pawscript` (`src/lib/provenance.js`: app, version,
written, project, how, hash, from) and `metadata.creator_software = 'Pawscript'`; `app.project.originOf(raw)` says where a
file came from (Points panel, open / import messages, the cards).

### Keys: precedence and shared keys (shell decision)

- **One rule:** for a key bound to several commands, the first command *in registration order* whose `when`
  is true runs. Registration order (src/app/boot.js `FIRST`): `palette`, `assist`, `tracking`, `timeline`, `review`,
  `inspector`, `graph`, `video`, `lanes`, any other feature (alphabetical), then the shell's `project` (File)
  commands, then the shell core.
  So contextual commands (overlay open, job running, a plan segment / loop / chapter selected) beat the broad
  editors, and every feature beats the core. With `features/lanes` present the core's point-editing commands
  (`edit.point*`, nudges, cut/copy/paste/delete, prev/next point, repeat stroke, `axis.next/prev`) are not
  registered at all; lanes owns them.
- **Conflicts** (`app.commands.conflicts()`, the Shortcuts editor, the startup log): two or more *unguarded*
  commands on one key, any collision involving a user override, and sequence prefixes. A key shared by
  `when`-guarded commands is by design (kind `shared`, `conflicts({all:true})`); the `?` overlay says which of
  them runs in the current context (`app.commands.winner(keys)`).
- **Space** (`player.toggle`, `keyUp: true`) fires on release, and not if a pointer went down while it was held
  (Space-drag pans a lane). Any command may set `keyUp: true`.
- **Shared pairs under review by their owners** (both guarded, can both apply at once; the earlier one in the
  order above wins today): Alt+L `quick.limit` / `video.shuttleFwd`; Alt+←/→ `loops.outMinus/outPlus` /
  `video.back10f/fwd10f`; Shift+M `timeline.plan.merge` / `video.mute`; Ctrl+D `timeline.plan.duplicate` /
  `lanes.duplicate`; digits and Shift+digits `timeline.plan.kind.*` (segment selected) / `lanes.point*`;
  ←/→ `lanes.nudgeLeft/Right` (points selected) /
  `player.stepBack/Fwd`; Ctrl+Alt+G `timeline.plan.generateAll` / `graph.show`; F8 and Shift+F8 review next / previous
  problem / graph; Ctrl+G `nav.goto` / `graph.group`; Shift+A `graph.add` (Track tab; `tracking.accept` went with paw-x7w7).
- **Conflict reporting:** a user conflict is a key the user *added* that collides (keeping a default key is not one);
  a key shared only with hidden, guarded helpers (an overlay swallowing keys while open) is not listed as shared.
- **Timeline keys** shared with the point editor (digits for plan kinds, Del, Enter, ...) only fire while a
  timeline lane has DOM focus (it shows a focus ring and a "PLAN · KEYS" tag), so number-key scripting wins
  everywhere else. Navigation: scene cuts Shift+PgUp/PgDn; bare PgUp/PgDn = video ±10 frames.

**Scenes and rows (shell).** `app.doc.scenes` = `[{start_ms, end_ms, sign?, loop?, describe?, tags?, continues?}]` (sidecar shape; `tags` = the user's diff over the describe's tags, `['knotting', '-anal', {id: 'penetration', t0, t1}]` (an object = a tag over part of the scene, ms), vocabulary + helpers in timeline/acts.js TAG_CATEGORIES / ALIASES: view `internal` | `offscreen` (one at most), where × what, modifiers; old `kind` / `sub` / `view` overrides are migrated on load; `continues` true / false = the user's call that the scene continues the action before its run of `offscreen` cutaways, lib/scenes-continue.js — proposals from frame fingerprints, internal-view runs and off-screen tags live in the tracking store, never in the document; an internal view is a tracked member of the action, never a cutaway) is
an undoable document field, saved in the `.pawproj` (top-level `scenes` block): the tracking feature fills it
from Detect scenes (one undo entry) and stores per-scene `describe` / `loop` results in it; the timeline edits
the cuts — wrap those edits in `app.transact(label, fn)` so they are undo steps. `app.doc.media.hasAudio` is
true / false from ffprobe, null when unknown. A lane registration may add `visible: (app) => bool` to hide its
row entirely (e.g. audio when `hasAudio === false`); a hidden row is not mounted.

**Scene → run channel links (tracking).** Project block `links` = `{v: 1, scenes: [{t0, t1, run, channel, fit?, baseline?,
envelope?}]}`: which run and channel a scene's points come from (lib/runs.js `linkFor`, lib/runs-channel.js `channelPatch`).
`baseline` = `{mode: 'off' | 'auto' | 'knots', knots?: [[ms, raw channel value]]}` (a carrier curve subtracted before the fit;
knots kept while off / auto), `envelope` = `{mode: 'auto'}` (strokes stretched between top / bottom curves). Parametric,
never baked; not undo steps (like channel picks). Readers that do not know the carrier fields ignore them.
