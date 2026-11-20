# Third-party software

Every direct dependency, vendored asset, external tool and model Pawscript uses, with its licence. Versions
are the resolved ones in `package-lock.json` / `src-tauri/Cargo.lock` at the time of writing; the manifests
pin ranges. `test/docs-thirdparty.test.mjs` fails if a dependency named in `package.json` or
`src-tauri/Cargo.toml` is missing from this file. Pawscript itself is GPL-3.0-or-later (`LICENSE`, `NOTICE`,
`README.md` "Licensing"). Everything below may ship with it except CoTracker3 (CC-BY-NC 4.0, non-commercial: not part of Pawscript, and the code that would call it is in no build and not
in the public source, `docs/guide/cotracker.md`), with one note: `evalexpr` (AGPL-3.0-only, pulled by `buttplug_server`) is compiled into the exe. The Machine panel's toy library is not part of
this source or of the public build: its `library.json` is empty there and the panel offers generic toys.

## npm: runtime (`package.json` `dependencies`)

| Package | Version | Licence | Use |
|---|---|---|---|
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT | `invoke`, events, `convertFileSrc`, drag-drop, window title |
| `@tauri-apps/plugin-dialog` | 2.8.4 | MIT OR Apache-2.0 | native Open / Save As dialogs |
| `mp4box` | 2.5.0 | BSD-3-Clause (Telecom ParisTech / GPAC, Cyril Concolato) | MP4/MOV demux for the WebCodecs hover scrubber (`src/features/video/scrub.js`), loaded on first hover scrub |

## npm: build and test (`package.json` `devDependencies`)

| Package | Version | Licence | Use |
|---|---|---|---|
| `svelte` | 5.57.3 | MIT | UI (runes mode) |
| `vite` | 5.4.21 | MIT | dev server and bundler |
| `@sveltejs/vite-plugin-svelte` | 4.0.4 | MIT | Svelte in Vite |
| `@tauri-apps/cli` | 2.12.4 | Apache-2.0 OR MIT | `tauri dev` / `tauri build` |
| `playwright` | 1.65.0 | Apache-2.0 | test-only: drives the installed Edge (`channel: 'msedge'`, no browser download) against `dev/*.html` harnesses and attaches to the app over CDP (`dev/cdp-connect.mjs`, `test/*-e2e.test.mjs`). Not shipped. |

## Rust (`src-tauri/Cargo.toml`)

All Tauri crates are dual-licensed Apache-2.0 OR MIT. Transitive crates are in `Cargo.lock`; the notable
ones the buttplug crates pull are `btleplug` (MIT OR Apache-2.0, Bluetooth LE), `serialport` (MPL-2.0) and
`hidapi` (MIT, wrapping the BSD-3-Clause / GPL-3 / original-licence tri-licensed hidapi C library).

| Crate | Version | Licence | Use |
|---|---|---|---|
| `tauri` (feature `protocol-asset`) | 2.12.5 | Apache-2.0 OR MIT | app runtime; `asset://` streams user-chosen videos |
| `tauri-build` | 2.7.4 | Apache-2.0 OR MIT | build script |
| `tauri-plugin-dialog` | 2.8.4 | Apache-2.0 OR MIT | file dialogs (the only plugin with JS commands enabled) |
| `tauri-plugin-single-instance` | 2.5.5 | Apache-2.0 OR MIT | a second launch hands its paths to the running window |
| `tauri-plugin-window-state` | 2.5.0 | Apache-2.0 OR MIT | `window-state.json` in the config dir |
| `tauri-plugin-opener` | 2.7.2 | Apache-2.0 OR MIT | Rust API only (reveal in file manager, open with default app); its JS commands are not registered |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | |
| `serde_json` | 1.0.154 | MIT OR Apache-2.0 | |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 | content hashes for backups, fingerprints, cache keys |
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 | atomic writes (same-directory temp file) |
| `crc32fast` | 1.5.4 | MIT OR Apache-2.0 | CRC-32 of .pawpack zip entries while streaming (already in the tree through flate2 / png) |
| `windows-sys` (Windows only) | 0.61.2 | MIT OR Apache-2.0 | Job Objects: sidecar / ffmpeg process trees die with the app (already in the tree) |
| `buttplug_core`, `buttplug_server`, `buttplug_server_device_config`, `buttplug_server_hwmgr_btleplug`, `buttplug_server_hwmgr_serial`, `buttplug_server_hwmgr_hid` | 11.0.0 (path deps: the OpenValence fork, public at https://github.com/openvalence/ButtplugIO, branch `valence`) | BSD-3-Clause (upstream buttplug's; GitHub shows "Other") | embedded in-process device server for device playback (`src-tauri/src/buttplug.rs`, `src/features/playback`); pulls btleplug, serialport, hidapi |
| `futures` | 0.3.34 | MIT OR Apache-2.0 | the device server's event stream (already in the tree through buttplug) |
| `tauri-plugin-updater` (no default features; `rustls-tls`) | 2.14.1 | Apache-2.0 OR MIT | Help > Check for updates (`src-tauri/src/update.rs`): GitHub's `latest.json`, minisign-signed updates; Rust API only, no webview permission. Pulls `minisign-verify` (MIT), `rustls` + `ring` (Apache-2.0 / ISC / MIT), `semver`, `time` |
| `reqwest` (feature `rustls-no-provider`) | 0.13.5 | MIT OR Apache-2.0 | HTTPS downloads of the models and the runtime (`src-tauri/src/models.rs`), only on the user's Download; the client the updater plugin brings (already in the tree through tauri, which uses it without TLS) |
| `rustls` (features `ring`, `std`, `tls12`) | 0.23.46 | Apache-2.0 OR ISC OR MIT | the TLS provider for `reqwest` (the same one the updater plugin installs); certificate checks by `rustls-platform-verifier` (the Windows certificate store) |

Test-only, not shipped, not in the repo: `test/playback-valence-live.test.mjs` runs Nucleus's device twin
`neutrino-sim.exe` (Apache-2.0, owner's own firmware) when `PAWSCRIPT_NEUTRINO_EXE` names a copy.

Runtime platform: the webview is the OS's (WebView2 / Edge on Windows, WebKit on macOS and Linux); nothing
is bundled.

## Vendored into `src/`

| What | Where | Licence | Notes |
|---|---|---|---|
| Kinetic2 motion planner, WebAssembly | `src/lib/analyze/kinetic/bytes.js`, `kinetic.pin` | Apache-2.0 (Nucleus / Kinetic, "Copyright 2026 AtlanticTM") | built from Nucleus `531ade38`, copied from Phosphor at d2dd33d; hash-pinned by `test/analyze-kinetic-pin.test.mjs`. Full record: `src/lib/analyze/kinetic/PROVENANCE.md`. |
| Chakra Petch (400, 500) | `src/fonts/ChakraPetch-*.woff2` | SIL OFL 1.1 (Cadson Demak) | UI font, via Phosphor |
| Martian Mono | `src/fonts/MartianMono.woff2` | SIL OFL 1.1 (Evil Martians) | monospace, via Phosphor |
| Code adapted from Phosphor | see `PROVENANCE.md` | Apache-2.0 (owner's own app) | funscript parser, style tokens, graph model/eval ideas, kinetic driver |
| Valence JS reference client (`session.js`, `catalog.js`, `frames.js`, `cbor.js`, `sha256.js`, the generated `registry_vocab.js`) | `src/lib/valence/vendor/` (+ its `LICENSE`) | MIT ("Copyright (c) 2026 AtlanticTM", owner's own protocol) | verbatim copies from `OpenValence/Valence/clients/js` at commit `56de58b`: the hub session, catalog, wire codec and registry numbers behind `src/lib/valence/link.js` |
| Valence device catalog fixture | `test/fixtures/valence/neutrino-catalog.bin` + `.etag` | MIT (Valence, as above) | test-only, copied from `clients/js/test/fixtures/` at `56de58b`; the fake hub serves it |
| Human body for the Machine panel (Z-Anatomy, derived) | `src/features/machine/bodies/human.*` | CC-BY-SA 4.0 (the derived mesh); source: "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan" and "Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0" | authors Kousaku OKUBO (BodyParts3D), Gauthier KERVYN (design, 3D, anatomy), Marcin ZIELINSKI (Blender add-on), Lluis VINENT (Unity development). Modified: posed on all fours, head removed (the brain and the inner ear, CC-BY-NC-SA, with it), kidneys replaced by generated shapes (the atlas's CC-BY-NC kidney model is not included), hair, muscles, vessels and nerves left out, reduced, coloured per tissue; built by `tools/zanatomy_export.py` and `tools/build-body-layers.mjs`; attribution shipped beside it in `human.ATTRIBUTION.txt`. |
| Penis and scrotum for the Stroker's realistic style ("Easy penis auto-rigger" v2.2 by Likkez, derived) | `src/features/machine/bodies/stroker-penis.glb` | CC0 1.0 (public domain dedication, chosen by the uploader) | model from "Easy penis auto-rigger" v2.2 by Likkez; the author asks for credit when the model is used ("Please give credit if you are going to use the included dick model!"), given here and in NOTICE. Modified: rest pose straightened along the rig's centre line, the author's shape keys as set, subdivided, the shaft and glans resampled as rings (a root added under the base), the scrotum cut out and closed, no textures; built by `dev/stroker-penis-export.py` (the source .blend is not in the repo); the credit is also in the file's glTF `asset.copyright`. |

## External tools (found at run time, never bundled)

| Tool | Licence | Notes |
|---|---|---|
| `ffmpeg`, `ffprobe` | LGPL-2.1+ or GPL-2.0+ depending on the build (gyan.dev "full" builds are GPL) | media probe, waveform peaks, thumbnails, exact frames, H.264 proxies. Found on `PATH` or via `PAWSCRIPT_FFMPEG` / `PAWSCRIPT_FFPROBE`; run as a child process with `-protocol_whitelist file`. The user supplies the binary, so its licence does not attach to Pawscript. |
| `uv` + Python 3.12 | MIT OR Apache-2.0 (uv); PSF-2.0 (Python) | runs the tracker sidecar; fetched by the user, not shipped |

## Tracker sidecar (`trackers/pyproject.toml`)

The full table, including every bundled library inside the wheels and every model checkpoint, is in the source
code's `trackers/README.md`, "Third-party licences" (the shared build lists them in `LICENSES-SUMMARY.txt`). Summary of what constrains Pawscript's own licence:

| Dependency | Licence | Caveat |
|---|---|---|
| PyAV (`av`), base | BSD-3-Clause | the binary wheel bundles an FFmpeg (9.0.2 in av 19.0.2) built with libx264/libx265, so as shipped it is GPL-2.0-or-later; fits Pawscript's GPL, source offer in `dev/share/TERMS.txt` |
| opencv-python-headless, numpy, scipy, base | Apache-2.0 / BSD-3 | |
| PyTorch, torchvision (extras) | BSD-3-Clause | CUDA wheels bundle NVIDIA runtime under NVIDIA's redistribution licence |
| SAM 2 code + SAM 2.1 checkpoints (`sam2`) | Apache-2.0 | the shared build downloads the checkpoints from the Pawscript models server when the user picks them (Settings > Models; the full offline folder still carries them); a source checkout's extra downloads them on first use |
| TAPNext++ code + checkpoints (`tapnext`) | Apache-2.0 | as SAM 2.1 |
| RedRocket/Hydra 3.5 shot tagger (`describe`) | Apache-2.0 per model-card metadata; the repo has no LICENSE file | as SAM 2.1 (optional, only for tagging); its note ships in `LICENSES\models\Hydra-3.5-NOTE.txt` |
| lodestones/taggerine (optional seeder features) | Apache-2.0 per its card; fine-tuned from Meta's DINOv3 (DINOv3 License, custom) | never hosted or downloaded by Pawscript: Settings > Models links its page and licence; the user brings the files (Choose files… / a drop), which are checked against the tested version and moved into the models folder |
| CoTracker3 code + checkpoints (`cotracker`) | **CC-BY-NC 4.0, non-commercial** | not part of Pawscript (not GPL-compatible): never shipped or downloaded, and the code that would call it is in no build and not in the public source; support as a separate add-on may come later (`docs/guide/cotracker.md`) |
| pyvips-binary (`describe`) | LGPL-3.0-or-later | dynamically loaded |

## Director VLM (`trackers/pawtrack/director.py`, `trackers/experiments/vlm/`)

Not in `pyproject.toml`: the `qwen3.5-*` backends run in a separate venv (`trackers/experiments/vlm/.venv`,
`PAWSCRIPT_VLM_PYTHON`) or in process when `transformers` imports; `bonsai-*` runs an external binary.
Everything here is opt-in and absent from a default install (source code: `trackers/README.md`, "VLM").

| Dependency | Version | Licence | Notes |
|---|---|---|---|
| `transformers` (Hugging Face) | 5.22.2 | Apache-2.0 | loads the Qwen3.5 models; downloads pinned revisions from the Hub into `trackers/experiments/vlm/.models/hf` |
| `bitsandbytes` | 0.50.2 | MIT | nf4 / int8 quantisation (CUDA) |
| Qwen3.5 0.8B / 2B / 4B / 9B (`Qwen/Qwen3.5-*`) | pinned commits in the VLM experiment (a developer setup, not in the public source) | Apache-2.0 per the Hub model cards (check the card of the pinned revision before shipping) | downloaded on first use |
| `llmfan46/Qwen3.5-9B-ultra-uncensored-heretic` | pinned commit | community finetune, no licence declared; experiments only, never a default | downloaded on first use if selected |
| `llama-server` (llama.cpp) | the owner's LM Studio PrismML build, `PAWSCRIPT_LLAMA_SERVER` | MIT (llama.cpp) | started as a child on a loopback port for `bonsai-*`; found on disk, never bundled |
| Bonsai GGUF models (PrismML) | owner-supplied files, read-only | per the model's own card; not redistributed | `bonsai-*` backends |

## Not used, on purpose

- Ultralytics YOLO (AGPL-3.0): the outline (§2) rules it out; detectors, if any, come from permissive repos.
- No analytics, crash-reporting or update SDK of any kind (`README.md`, "Privacy").
