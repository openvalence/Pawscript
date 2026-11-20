# Provenance

Where ideas, conventions and borrowed code came from (outline §2, clean-room rule). Licences of every
dependency: `THIRD-PARTY.md`. Nothing here was taken from FunGen or any closed tool, decompiled binaries or
extracted strings. "From memory" below means a recollection of public behaviour, not a copy; those items
are marked `UNVERIFIED` in the code too.

## Borrowed from Phosphor

Phosphor is the owner's own app (a sibling checkout, `OpenValence/Phosphor`, Apache-2.0, read-only here).

- `src/lib/funscript.js` - copied unchanged from `plugins/factory/funscript-player/funscript.js` (parse/validate; it has no serializer, so `funscriptDoc` in `src/lib/runs.js` is new).
- `src/fonts/ChakraPetch-400.woff2`, `ChakraPetch-500.woff2`, `MartianMono.woff2` - copied from `src/fonts/` (SIL OFL 1.1 fonts, see `THIRD-PARTY.md`).
- `src/style.css` - adapted from Phosphor `src/style.css` (default theme): color tokens, spacing scale, radius, fonts, button (`.og-btn` -> `.btn`), select, range, scrollbar and card/screen surface styling. The kit (`src/ui/kit/theme.css`) later generalised these tokens into dark/light/contrast themes; `src/ui/kit/README.md` names the Phosphor-derived pieces (`.k-brackets`, disabled opacity, pressed colours).
- `svelte.config.js` - copied (runes mode everywhere).
- `package.json`, `vite.config.js`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` - same stack and versions (Svelte 5, Vite 5, plugin-svelte 4, Tauri 2), trimmed.
- `src/lib/video.js` (`frameMsFrom`) - idea from Phosphor `plugins/factory/funscript-player/clock.js` (`requestVideoFrameCallback` as the frame clock); code is new.
- `src/lib/graph/` - model, topological evaluation, load-time filtering, preset-as-data and the MATH node table are adapted from Phosphor `src/model/graph.js`; each file carries a `PROVENANCE:` header with the line ranges. Details: `src/lib/graph/README.md`, "Provenance".
- `src/features/video/sim.js` - the colour-by-speed ramp follows Phosphor's player (rest -> limit -> over).
- `src/lib/analyze/kinetic/driver.js` - adapted from Phosphor `kinetic.js` / `scheduler.js` so the preview feeds the planner exactly as Phosphor's player does.
- `src-tauri/src/buttplug.rs` - trimmed from Phosphor `src-tauri/src/buttplug.rs` (same buttplug fork, same calls): no websocket listener, no virtual device, no saved device config. The buttplug crates themselves are path deps on the owner's fork `OpenValence/ButtplugIO` (BSD-3-Clause, `THIRD-PARTY.md`).
- `src/features/playback/scheduler.js` - ported from Phosphor `plugins/factory/funscript-player/scheduler.js`, re-cut for buttplug's LinearCmd (its header lists each borrowed rule). Its `knotVel` (segment end velocity) follows Phosphor's `knotVel` rest rules (EXPECT_MS gap, reversal, hold edge) with SPEC §9.6's Fritsch-Butland PCHIP angle for through knots.
- `src/lib/valence/link.js` - `motionStream`, `segmentRecord` and the `unspecified` sentinel are adapted from Phosphor `src/model/motion.js` (`motionStream`, `record`, `unspecified`, `plainStream`); the 2 s publish bucket is Phosphor's. The session itself is the vendored Valence JS reference client (`src/lib/valence/vendor/`, MIT, `THIRD-PARTY.md`).
- `test/valence-fake-hub.mjs` - written from Valence `spec/SPEC.md` (§5, §6, §8.4, §9, §11, §12.3), not copied from `clients/js/localhub.js`.
- Testing convention: plain `node test/*.mjs`, as in Phosphor.

## Vendored: Kinetic2 motion planner (WebAssembly)

`src/lib/analyze/kinetic/bytes.js` (base64 wasm) and `kinetic.pin` are verbatim copies from Phosphor
(commit d2dd33d), built from Nucleus `531ade38c7e57c754461e82c04c4746c6f4c0f05` (`nucleus 531ade38c7e5
kinetic2 2.0.0-dev`). Apache-2.0, "Copyright 2026 AtlanticTM" (owner's own firmware). The device-accurate
preview (`src/lib/analyze`, engine `kinetic`) runs this planner; sha256, sizes, pin test and the refresh
procedure are in `src/lib/analyze/kinetic/PROVENANCE.md`. Device profile `nucleus-capstan`
(`src/lib/analyze/profiles.js`) is the owner's own machine; its v/a/j limits are owner-supplied
(`verified: true`), `minIntervalMs` / `latencyMs` are guesses.

## Funscript format and conventions

- The `.funscript` shape (`{version, inverted, range, actions:[{at, pos}]}`, pos 0..100, ms timestamps) is
  the public de-facto format used by every player; no single spec was copied. **Pawscript's position
  convention: pos 0 = deepest / fully in, 100 = out** (`src/lib/core/script.js`).
- Multi-axis sibling files (`video.funscript`, `video.roll.funscript`, ...) follow the naming players
  use; the axis ids in `src/lib/funscript.js` `AXES` and the embedded-axis parsing follow the public
  funlib schema (1.1 `axes[]`, 2.0 `channels{}`, OSC_AXES per its spec §9.7) and T-Code channel names
  (`L0`, `R1`, ...), read from the published specs.
- **OFS metadata block, UNVERIFIED, from memory** (`src/lib/io/funscript.js`): `metadata.{title, creator,
  description, duration (seconds), tags, performers, chapters:[{name, startTime, endTime}],
  bookmarks:[{name, time}]}` with `HH:MM:SS.mmm` clocks. Recalled from OpenFunscripter's (GPL-3.0) output;
  no OFS code was read or copied. Pawscript reads and writes those keys so chapters and bookmarks survive
  a round trip through other tools; a chapter `color` is Pawscript's own extension. Unknown keys in
  someone else's file are preserved on save.
- **Heat colours, UNVERIFIED, from memory** (`src/lib/analyze/heatmap.js` `SCALES.heat`): the familiar
  blue -> cyan -> green -> yellow -> red funscript heatmap look (OpenFunscripter / ScriptPlayer style);
  the stops are an approximation, tools differ. `viridis` and `cividis` are 10- and 6-stop recollections
  of the matplotlib colormaps (BSD-compatible, data not code). `grey` is ours.
- **Device profiles** (`src/lib/analyze/profiles.js`): every figure for a named commercial device (The
  Handy, Keon, Launch, OSR2/SR6) is a rough recollection of public marketing / community numbers,
  flagged `verified: false` in the data. Only `nucleus-capstan` is measured.

## External tools and platform pieces

- **ffmpeg / ffprobe** (`src-tauri/src/ffmpeg.rs`): run as child processes for probe, frame times,
  waveform peaks, thumbnail sheets, exact frames and H.264 proxies; found on `PATH` or
  `PAWSCRIPT_FFMPEG` / `PAWSCRIPT_FFPROBE`, never bundled, inputs opened with `-protocol_whitelist file`.
  Command lines were written from the public ffmpeg documentation. The waveform file format (`PWPK`) and
  the sprite-sheet layout are ours (`src-tauri/API.md`).
- **Tauri plugins**: `dialog` (Open / Save As), `single-instance` (second launch forwards its file
  arguments to the running window, `src-tauri/src/app.rs`), `window-state` (size / position / maximised
  in `window-state.json`), `opener` (Rust API only: reveal in file manager, open with default app;
  its JS commands are not registered). The `fs`, `shell` and `http` plugins are deliberately absent:
  every file access goes through Pawscript's own commands (`src-tauri/API.md`).
- **mp4box** (npm `mp4box` 2.5.0, BSD-3-Clause, `THIRD-PARTY.md`): MP4/MOV demux for the hover scrubber
  (`src/features/video/scrub.js`), used as a library. The avcC/hvcC/vpcC/av1C `description` extraction follows
  the public W3C WebCodecs MP4 sample; the decoder positioning, ring and remux fallback are ours.
- **Playwright** (dev-only): e2e tests launch the installed Edge against `dev/*.html` harnesses and
  attach to a test instance of the app over CDP (`dev/cdp-connect.mjs`, which refuses any window it did
  not start). Not shipped.
- **Tracker sidecar** (`trackers/`): own code; model and library provenance per entry in
  `trackers/README.md`, "Third-party licences" (SAM 2.1 Apache-2.0, TAPNext++ Apache-2.0, Hydra 3.5
  Apache-2.0 per model card, CoTracker3 CC-BY-NC 4.0: not part of Pawscript, `docs/guide/cotracker.md`).
  Checkpoints are downloaded on first use, never vendored. The point trackers' shared code (`pawtrack/points.py`)
  is own code with no CoTracker3 code in it; the CoTracker3 glue module is kept out of the public source and every build.
- **Director VLM** (`trackers/pawtrack/director.py`, `trackers/experiments/vlm/`): own prompting and
  first-token scoring code. Models: Qwen3.5 0.8B / 2B / 4B / 9B at pinned Hub revisions through
  `transformers` (weights cached under `trackers/experiments/vlm/.models/hf`), and the owner's
  `bonsai-*` GGUF files served by the owner's `llama-server` build as a child on a loopback port. Nothing
  from either is vendored; the system prompt is ours.

## Own design

Everything else (lane editor, loops, plan/segment lane, graph editor, assist/director, `.pawproj`
schema, backup and autosave scheme, file fingerprinting, the UI kit) is Pawscript's own design from
`pawscript-design-outline.md`.
