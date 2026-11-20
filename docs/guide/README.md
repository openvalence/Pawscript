# Pawscript guide

Pawscript is an offline funscript editor with a semi-automatic scripter for animated clips (Tauri 2 + Svelte 5). If you know OpenFunscripter the layout is familiar: video on top, lanes below, a playhead, number keys for points.

## Pages

| Page | What it covers |
|---|---|
| [Quick start](quick-start.md) | **start here**: from a video to a written `.funscript` in nine steps, the key for each and the usual mistake (also `F1` in the app) |
| [Requirements and troubleshooting](requirements.md) | Windows and an NVIDIA card (this release), WebView2, VRAM per tracker setting, the CPU trackers, disk, where the folder may sit, SmartScreen, videos that do not play |
| [CoTracker3](cotracker.md) | point tracker, not included (non-commercial license) |
| [Getting started](getting-started.md) | install, open a video, several projects as tabs, import, commit / publish / export rules, continuous projects and checkpoints, layout, the stage tabs (Scenes, Track, Refine, Review), docks, the settings file and where files go |
| [Keys](keys.md) | every default binding by context, the command ids behind them, key precedence, changing bindings (`Ctrl+Alt+K`) |
| [Editing points](editing.md) | placing, moving, selecting, clipboard, transforms and their parameters, recording, lanes and ghosts |
| [Tracking](tracking.md) | the Scenes and Track tabs: trackers and params, ROI, stroke axis (`X`), runs, flips, anchors, live shots and Bake (`Shift+B`), the Actions panel, describe, the scene quick bar and its suggestions, span labels from tags, GPU notes |
| [Draft and Assist](draft-and-assist.md) | the one-button pipeline (`Ctrl+Shift+D`) and the one-key question overlay (`F6`) |
| [Generators and the plan](generators.md) | plan segments, kinds, recipes, generator parameters, Generate (`Ctrl+Shift+G`), lock / detach |
| [Review](review.md) | the Review tab: problem finder and fixes (`F8`), statistics, compare against a ghost, device profiles and heatmap |
| [Device playback](playback.md) | the Device panel: Buttplug toys and Valence hubs in sync with the video, pairing, pause / halt, what is sent |
| [Node graph](graph.md) | the Graph panel (`Ctrl+Alt+Shift+G`): wire types, node reference, probe, snapshot, bake |
| [Workflows](workflows.md) | end-to-end recipes: loop clips, tracked scenes, plan-driven scripts, review passes |

## Five things to know first

1. **Position convention.** `pos 0` = deepest / fully in, `pos 100` = out. The number keys follow it: `0` places 0, `5` places 50, `Shift+0` places 100. Every lane, tracker, generator and graph node uses this scale.
2. **Draft** (`Ctrl+Shift+D`, menu Track > Advanced > Draft) runs the whole tracker pipeline on an open video: scenes, tags, loop check, first plan, base track, generate, then hands off to Assist (`F6`) for the decisions it cannot make. Each step is one undo entry.
3. **Tabs are the stages of the job**: Scenes (`Ctrl+1`: detect and describe scenes, fix cuts, shots, loops), Track (`Ctrl+2`), Refine (`Ctrl+3`: hand editing), Review (`Ctrl+4`). In Track, set a range with `I` / `O` (or click a shot), `T` to track (a point grid over the whole frame; `Ctrl+T` tracks a ROI you drew, or SAM). A run plays in your script at once (live); flip direction with `F`, anchor the depth with `Alt+0` / `Alt+Shift+0`, and `Shift+B` bakes a shot when you want its points fixed.
4. **Saving.** The project (`clip.pawproj` beside the video) writes itself about a second after every change: no Save, no questions on close. `Ctrl+S` commits: a named point in the project history (`clip.pawhistory\`) with an optional note, listing what changed since the last commit. Publish (`Ctrl+Alt+S`) writes every non-empty axis as a sibling funscript (`clip.funscript`, `clip.roll.funscript`, …), stamped with a version (v1, v2, …): the file players read, and the only thing that writes it besides export (`Ctrl+E`). The status bar says which version is published and how many edits the project has since. Several projects open as tabs (`Ctrl+Tab` goes round them). A funscript Pawscript did not write is kept as `name.bak` on first overwrite.
5. **Settings** (`Ctrl+,`, File > Settings) is a panel with every preference, grouped and searchable; a change applies at once. They live in `%APPDATA%\app.pawscript\settings.json` (macOS `~/Library/Application Support/app.pawscript`, Linux `~/.config/app.pawscript`), never in a project. `Help > About Pawscript` shows the real paths.

Everything in the menus is also in the command palette (`Ctrl+K`) under the same title; `F1` opens the quick start and the shortcuts (the keys that apply right now on top).
