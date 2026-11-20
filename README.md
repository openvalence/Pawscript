# Pawscript

Funscript editor and semi-automatic scripter. Tauri 2 + Svelte 5 + Vite on the front, a small Rust
backend for safe file IO and ffmpeg media helpers, and an optional Python tracker sidecar (`trackers/`)
that turns a video region into a position signal.

**Licence: GPL-3.0-or-later** (`LICENSE`, `NOTICE`; see "Licensing" below). For adults (18+) only.

## State of the project

Pawscript is in early access. It is free software and will never be sold.

**What works.** On an NVIDIA graphics card it already does the whole path: open a video, find the cuts, paint the
parts on one frame, track them, watch the script build live, fix the direction with F or two anchors, bake, then
commit and publish a valid `.funscript`, or pack the whole project into one file. On clean footage TAPNext++ follows
the stroke to within a frame. Projects save continuously and survive the app being killed in the middle of a write.
Several projects open as tabs, and a track keeps running in a tab you are not looking at.

**What is rough.**

- The tracker usually gets the direction backwards on the first try. You fix it once per scene with F or two anchors.
- A few actions can still go wrong without saying so. Make a commit (Ctrl+S) as you go, so you can step back.
- Some first-run steps are easy to miss.
- Small windows are cramped: the panels leave little room for the picture.
- Some labels still use internal words.

**What you need.**

- Windows 11, 64-bit.
- An NVIDIA RTX 20-series card or newer, with driver 580 or newer. 8 GB of video memory works. Without one, the
  editor, playback and the simpler trackers still run; the tracking models do not.
- About 10 GB to download and about 15 GB of free disk space.

**What is next.** AMD cards and Linux come next, Mac later.

## Run

Requirements: Node 22+ (the device client and its tests use the global `WebSocket`), Rust 1.91+ (`src-tauri/Cargo.toml` `rust-version`), and for media features
(waveform, thumbnails, exact frames, proxies) `ffmpeg` and `ffprobe` on `PATH` or named by
`PAWSCRIPT_FFMPEG` / `PAWSCRIPT_FFPROBE`. Without them the app runs; media commands reject with
`ffmpeg_missing`.

```powershell
npm install
npm run tauri dev          # the app (vite on 5173 + the Rust backend)
npm run dev                # front end only, in a browser, with the mock backend

# tracker sidecar (optional; uv fetches Python 3.12 and the deps on first run)
uv sync --project trackers                                   # base trackers (CPU)
uv sync --project trackers --extra sam2 --extra describe     # ML extras, see trackers/README.md
```

Tests: `npm run check` (plain `node --test`, globs `test/**/*.test.mjs`), `npx vite build`, `cargo test`
in `src-tauri/` (needs its own `CARGO_TARGET_DIR`), `uv run --project trackers pytest trackers/tests`.
Rules for agents and harnesses: `src/ARCHITECTURE.md` (ports, ownership, test rules).

## Privacy

**No telemetry: online only when you ask, to download models or check for an update.** (The same sentence is in Help > About.)

- No telemetry, no crash reporting, no usage statistics sent anywhere, no automatic update check (unless you turn on
  Settings > Updates > "Check for updates at start", off by default), no account, no licence check.
  The usage log (Help > Usage report / Clear usage log: the commands and tracking actions you use, last 5000 plus
  counts) is local: localStorage keys `usage.log` / `usage.counts` in the WebView2 profile below; nothing reads it but you.
  The same events, in more detail (commands and how they were started, undo, tracker runs, effects, scene tags,
  settings, toasts, panels and dialogs, playback, a heartbeat each minute), go to one local JSONL file per day
  (`usage-YYYY-MM-DD.jsonl`, table below) for `node dev/usage-report.mjs`. Setting `usage.log` = false stops both.
- The app goes online in exactly two cases, both only when you click (items 6 and 7); otherwise nothing leaves
  this machine except, when you connect one, to your own Valence hub on your LAN. Every connection the app or its
  helpers make, in full:
  1. **Webview to backend**: Tauri IPC. The webview CSP is `connect-src 'self' ipc: http://ipc.localhost ws: wss:`
     (`src-tauri/tauri.conf.json`): the only socket the webview opens is item 5's. Tauri's `http`, `shell` and `fs`
     plugins are not enabled; the updater plugin is, for the Rust side only (no webview permission).
  2. **Device playback** (`src-tauri/src/buttplug.rs`, Device panel > Connect): a Buttplug server
     runs inside the app process and talks to toys over Bluetooth LE (btleplug), serial and HID. It
     listens on no port, starts only when you press Connect, and stops with the window. Scanning reads
     device names and addresses to drive the toy; they are shown in the panel and stored nowhere.
  3. **Tracker sidecar** (`trackers/`): a child process on stdin/stdout, no sockets. Its `bonsai-*`
     director backend starts the owner's `llama-server` as a child on a free `127.0.0.1` port and talks
     HTTP to it there (`PAWSCRIPT_LLAMA_SERVER`); the `qwen3.5-*` backends load in process or in a second
     Python child, again over pipes.
  4. **ffmpeg / ffprobe**: child processes, run with `-protocol_whitelist file`.
  5. **Valence playback** (`src/lib/valence/`, Device panel > Valence hub > Connect): plays the script to a Valence
     hub (the owner's machine protocol) in sync with the video, over a WebSocket to the address and port you type
     (`ws://host:port/`, subprotocol `valence.v1`). Opened only on Connect, closed on Disconnect; it reconnects by
     itself after a drop but never resumes motion. It sends this install's random 8-byte instance id, the name
     `Pawscript`, a paired token once the hub has granted one, and the motion; the hub's catalog is cached in the
     WebView2 profile's localStorage. Guide: `docs/guide/playback.md`.
  6. **Models and the runtime** (`src-tauri/src/models.rs`; Settings > Models, the first-start screen): HTTPS GET requests
     to the Pawscript models server, `https://dl.openvalence.org/pawscript/v1/` (`MODELS_BASE_URL` in
     `src/features/models/logic.js`; the only host the shell downloads from) for its `manifest.json` (Check for model updates) and for the files you picked (Download).
     Nothing is sent but the request itself (the server sees your IP address, the file asked for and the user agent
     `Pawscript/<version>`); no id, no cookie. Every file is checked against the SHA-256 in the manifest compiled into
     the app before it is kept; redirects are not followed. Bringing files you already have (Choose files…, a drop)
     needs no network.
  7. **Updates** (`src-tauri/src/update.rs`; Help > Check for updates, Settings > Updates): the official Tauri updater
     asks GitHub for `https://github.com/openvalence/Pawscript/releases/latest/download/latest.json` (GitHub serves it
     from its own download host, a redirect the updater follows), and on Download and install fetches the update named
     there, which is installed only when its signature matches the public key built into the app. Again nothing is
     sent but the requests.
- Downloads in a source checkout, all opt-in and all from the Python side: the sidecar's ML extras (`sam2`,
  `describe`, `tapnext`; `cotracker` never: not part of Pawscript, `docs/guide/cotracker.md`) fetch their checkpoints on first use into `trackers/.cache/` and
  `trackers/.models/`, and the director's `qwen3.5-*` backends fetch pinned Qwen3.5 revisions from the
  Hugging Face Hub via `transformers` into `trackers/experiments/vlm/.models/hf`. The extras print each
  download's URL and licence to the sidecar's stderr; the Hub fetch shows `transformers`' own progress. The
  base trackers (`lk_box`, scene cuts, loop finder) and
  the `bonsai-*` backend (owner-supplied GGUF files, read from disk) download nothing. Sources and sizes:
  `trackers/README.md`. Installing an extra (or the VLM venv) is the consent step. The shared build's Python cannot
  open a connection at all (`dev/share/sitecustomize.py`): there the app's own downloader (item 6) is the only way in.

### Where the app writes

The app's rows are copied from `src-tauri/API.md`, "Where the app writes" (the source of truth, kept in
sync by `test/docs-thirdparty.test.mjs`; Help > About shows the real paths on your machine via
`app_paths()`); the last rows are the Python side's, which API.md does not cover. Folders are Tauri's per-app folders for the identifier `app.pawscript`.
Windows paths shown; macOS uses `~/Library/Application Support/app.pawscript` and
`~/Library/Caches/app.pawscript`; Linux `~/.config/app.pawscript`, `~/.local/share/app.pawscript`,
`~/.cache/app.pawscript`.

| What | Where |
|---|---|
| Settings blob | `%APPDATA%\app.pawscript\settings.json` |
| Recent files | `%APPDATA%\app.pawscript\recent.json` |
| Window size/position | `%APPDATA%\app.pawscript\window-state.json` |
| Autosave snapshots | `%LOCALAPPDATA%\app.pawscript\autosave\<id>\<ms>.pawproj` + `meta.json` + `runs.pawruns` (the tracker runs, rewritten only when they changed) |
| Project page thumbnails (one small JPEG per recent project, from `save_frame` at open / save; removed with its list entry) | `%LOCALAPPDATA%\app.pawscript\thumbs\<16 hex>-<ms>.jpg` |
| Rolling backups of saved files | `%LOCALAPPDATA%\app.pawscript\backups\<16 hex>\<ms>-<name>` + `source.txt` (original path) |
| "Last written by us" hashes | `%LOCALAPPDATA%\app.pawscript\written.json` (≤2000 entries) |
| Usage log (setting `usage.log`, default on) | `%LOCALAPPDATA%\app.pawscript\usage-YYYY-MM-DD.jsonl` (one per day; `dev/usage-report.mjs` reads them) |
| Media cache (probe, peaks, thumbnails, proxies, scrub copies; cap: setting `media.cacheGb`, default 2 GiB) | `%LOCALAPPDATA%\app.pawscript\media-cache\<kind>-<hex>\` (2 GiB cap) |
| WebView2 profile (Tauri/Edge) | `%LOCALAPPDATA%\app.pawscript\EBWebView\` |
| Next to the user's files, only on save | the saved file itself; `name.bak` / `name.N.bak` (first overwrite of a file we did not write); a transient `.<name>.<random>.tmp` during each atomic write |
| Tracker runs of a project, only on save | `<project>.pawruns` beside the saved `<project>.pawproj` (every run: signals, channels, points, overlay frames; copy-on-write: a change appends what changed, so the last complete version always survives a crash or a forced close); `<project>.pawruns.<ms>.bak` when a runs file this session did not read or write (unreadable, or another project's) is about to be replaced; a version-1 `.pawruns` goes to the rolling backups (newest 2) when it is first rewritten as version 2 |
| Unreadable settings, kept | `settings.json.corrupt-<ms>` beside `settings.json` |
| Models (Settings > Models: Download, or files you bring, which are moved there; Remove deletes only the files the manifest names) | the models folder: `<app folder>\trackers\.cache\` and `.models\` (as before), or `.cache\` / `.models\` inside the folder you chose (setting `models.dir`); `<file>.part` while a download runs (kept for resuming) |
| Runtime download (a shared build released without `runtime.zip`; first-start screen) | `runtime.zip` (`runtime.zip.part` while downloading) beside `Pawscript.exe`, unpacked as the row below says and then deleted |
| An update (Help > Check for updates > Download and install; shared build) | `.setup\update\` (the update zip and what it holds, removed once applied), `Pawscript.exe` and `code.zip` replaced, the old exe kept as `.setup\Pawscript.old.exe` until the next start |
| Shared build only, at its first start (`runtime.zip` / `code.zip` beside the exe) | `python\`, `trackers\pawtrack\`, `ffmpeg.exe`, `ffprobe.exe` and `.setup\` beside `Pawscript.exe`: unpacked once, again only when a zip's stamp changes (`portable.rs`) |
| Tracker sidecar (optional) | `trackers/.cache/` and `trackers/.models/` (model checkpoints, gitignored); `trackers/.venv/` (uv) |
| Director VLM (optional) | `trackers/experiments/vlm/.models/hf` (Qwen3.5 weights, gitignored); `trackers/experiments/vlm/.venv/` (transformers + bitsandbytes); `bonsai-*` writes a `pawtrack-llama-*.log` in the OS temp dir |

Media results (probes, peaks, thumbnails, proxies) are never written next to a video: they live in the cache above. Next
to the user's files go only what a save writes: the funscripts, and the `.pawproj` with its `.pawruns` wherever the user
saves the project (often beside the video).

## Licensing

Pawscript is free and always will be. It is licensed under the GPL: anyone may share it, nobody may make it closed.
If someone sold it to you, you can get it free here: https://github.com/openvalence/Pawscript

- **The application and its code**: GPL-3.0-or-later, Copyright 2026 AtlanticTM (`LICENSE`, `NOTICE`). Source files
  carry no per-file licence headers; `NOTICE` applies to the whole repository except the parts it names. The GPL does
  not allow a "may not be sold" clause, and needs none: whoever gets a copy may pass it on for free with its source.
- **File formats** (`.pawpack`, `.pawproj`, `.pawruns`, the funscript `metadata.pawscript` block): the specifications in
  `docs/formats/` are CC BY 4.0, and implementing the formats needs no licence from this project, in open or closed,
  free or commercial software.
- **What you make is yours**: scripts, projects and packs belong to their author.
- Terms for the shared build (18+, no warranty, devices at your own risk, the source offer for the GPL components):
  `dev/share/TERMS.txt`. The toy library in `src/features/machine/toys` is not under the GPL and is left out of the
  public build (`dev/share/build-nas.ps1`).

Every dependency and model with its licence: `THIRD-PARTY.md`; where each idea and borrowed piece came from:
`PROVENANCE.md`.

## Map

| File | What |
|---|---|
| `pawscript-design-outline.md` | product intent (the stack section is obsolete; flows, UI, loops, safety nets stand) |
| `src/ARCHITECTURE.md` | front-end ownership map, contracts, plug-in discovery, the `app` object, ports, keys, test rules |
| `src-tauri/API.md` | every native command, error codes, the write locations above |
| `trackers/README.md`, `trackers/PROTOCOL.md` | tracker sidecar: trackers, extras, licences; JSONL contract |
| `PROVENANCE.md` | where ideas, conventions and borrowed code came from |
| `THIRD-PARTY.md` | every dependency, vendored asset and model, with licence |
| `LICENSE`, `NOTICE` | GPL-3.0 text; what it covers and what it does not |
| `docs/formats/` | the public file format specifications (CC BY 4.0, free to implement) |

## Building from source

This is the public source of Pawscript, exported from the working tree at `1408d64a434f` on 2026-11-19 without its history. Prerequisites, the tracker sidecar, where each model comes from and what is not reproducible yet: [docs/BUILDING.md](docs/BUILDING.md).
