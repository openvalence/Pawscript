# Building Pawscript from source

Pawscript is a Tauri 2 app: a Svelte 5 front end built by Vite, a Rust shell (`src-tauri/`), and an optional Python
tracker sidecar (`trackers/`, package `pawtrack`). Windows 10/11 x64 is the only platform it is built and tested on;
the code has macOS / Linux branches, but nobody has built them. Source: https://github.com/openvalence/Pawscript.

## Prerequisites

| What | Version | Why |
|---|---|---|
| Node.js | 22 or newer | the front end, its tests (the device client uses the global `WebSocket`) |
| Rust (rustup, MSVC toolchain) | 1.91 or newer (`rust-version` in `src-tauri/Cargo.toml`) | the shell |
| Tauri 2 system prerequisites | Microsoft C++ Build Tools, WebView2 (preinstalled on Windows 11) | see the Tauri 2 "Prerequisites" guide |
| ffmpeg + ffprobe | any recent build, on `PATH` or named by `PAWSCRIPT_FFMPEG` / `PAWSCRIPT_FFPROBE` | waveform, thumbnails, exact frames, proxies. Without them the app runs and media commands reject with `ffmpeg_missing`. |
| uv | 0.9 or newer | the tracker sidecar only; it fetches Python 3.12 (`trackers/.python-version`) itself |
| NVIDIA GPU, driver 580+ | GTX 16xx / RTX 20xx and newer, RTX 50xx included (CUDA 13.0 wheels; no Maxwell, Pascal or Volta) | the ML trackers only; the base trackers run on the CPU |

## The app

```powershell
npm ci                     # exact versions from package-lock.json (public npm registry)
npm run check              # the unit tests (plain node --test)
npm run tauri build        # runs `npm run build` (tests + vite build), then the release shell and the installer
npm run tauri dev          # development: vite on port 5173 + the shell, hot reload
npm run dev                # the front end alone in a browser, against the mock backend
```

`cargo test` in `src-tauri/` runs the shell's own tests.

## The tracker sidecar (optional)

```powershell
uv sync --project trackers                                                       # base trackers (CPU)
uv sync --project trackers --extra sam2 --extra describe --extra tapnext          # ML extras (CUDA torch)
uv run --project trackers pytest trackers/tests -q -m "not gpu"                   # its tests (need the ML extras)
```

The tests need the ML extras: many of them load torch. The CUDA wheels run on the CPU too, so they pass on a PC
without an NVIDIA card (the `gpu`-marked tests are the ones left out).

`trackers/uv.lock` resolves everything from PyPI, the PyTorch CUDA 13.0 (cu130) index and pinned GitHub commits
(facebookresearch/sam2, google-deepmind/tapnet; it also pins facebookresearch/co-tracker, which nothing in the public
source uses). The app starts the sidecar from `trackers/` (see `trackers/README.md`
and `trackers/PROTOCOL.md`).

## Models

None ship with the source. The app's Settings > Models downloads them from the Pawscript models server ("Models and
the runtime on R2" below) into `trackers/.cache/` and `trackers/.models/`, or a folder you choose (the sidecar gets it
as `PAWTRACK_MODELS`). In a source checkout each extra also fetches its weights from upstream on first use (the URL and licence are printed
to the sidecar's stderr) into `trackers/.cache/` or `trackers/.models/` (both git-ignored):

| Model | Extra | Fetched from | Licence |
|---|---|---|---|
| SAM 2.1 (tiny / small / base_plus / large) | `sam2` | `dl.fbaipublicfiles.com/segment_anything_2/092824/` | Apache-2.0 |
| TAPNext++ 256 / 512 | `tapnext` | `storage.googleapis.com` (dm-tapnet / gresearch buckets), 2.5 GB each | Apache-2.0 |
| CoTracker3 | `cotracker` | never fetched; the module that would call it is not in the public source | CC-BY-NC 4.0 (non-commercial): in no build (`docs/guide/cotracker.md`) |
| Hydra 3.5 shot tagger | `describe` | `huggingface.co/RedRocket/Hydra`, pinned revision in `pawtrack/describe.py` | see its model card |
| taggerine (optional seeder features) | none | not downloaded by anything: place `tagger_proto.safetensors` + `tagger_vocab.json` from `huggingface.co/lodestones/taggerine` in `trackers/.cache/taggerine/` | Apache-2.0 card, DINOv3 base licence: read both |
| Qwen3.5 (Director, experimental) | separate venv | Hugging Face Hub via `transformers`, pinned revisions | per model card |

Every dependency, vendored asset and model with its licence: `THIRD-PARTY.md`.

## The portable build

`dev/share/build-nas.ps1` builds the shared portable folder (`Pawscript.exe` + `code.zip` + `runtime.zip` + models).
`code.zip` is `trackers/pawtrack` plus `dev/share/sitecustomize.py`. `runtime.zip` (an embeddable Python with the
sidecar's packages, and ffmpeg) is made by hand once; `dev/share/runtime/*.txt` records how.

Two shapes (paw-cdot):

- **Full folder** (default): everything inside, nothing is downloaded; `runtime.zip` and the two TAPNext++ checkpoints
  come in parts (`parts.txt`) for hosts with a 2 GB per-file cap. The way to pass Pawscript on by hand or to a PC
  without internet; it keeps working with no network.
- **Small download** (`-Online`): the exe, `code.zip`, the texts, `Guide\`, `LICENSES\`, `Sample\`, zipped as
  `<Out>.zip` (a few tens of MB). The first start shows the download screen: the runtime (2.29 GB, one file, beside the
  exe) and the models the user picks (into the models folder they choose), then unpacks the runtime as the full
  folder's first start does. A runtime already beside the exe (or unpacked, with the stamp the build pins) is never
  downloaded.

The compiled manifest `src/features/models/manifest.json` (made by `dev/share/build-models.ps1 -Embed`) pins the
runtime by its stamp and SHA-256 and every model file by size and SHA-256; build-nas.ps1 refuses to build when it pins
another runtime than `$RuntimeArchive`. A new runtime: build it, set `$RuntimeArchive`, run build-models.ps1 -Embed,
upload, commit. An app update whose manifest pins the same runtime downloads nothing at its first start; one that pins a
new runtime downloads only that (the models stay).

## Models and the runtime on R2

The base address is ONE constant, `MODELS_BASE_URL` in `src/features/models/logic.js`:
`https://dl.openvalence.org/pawscript/v1/` (OpenValence's R2 bucket `openvalence-downloads` behind its own domain).
The setting `models.baseUrl` and the env var `PAWSCRIPT_MODELS_URL` may point at another folder, but the shell downloads
from `dl.openvalence.org` only (https; `ALLOWED_HOST` in `src-tauri/src/models.rs`), or from 127.0.0.1 for the tests.
The bucket holds what `build-models.ps1` lays out in its `-Out` folder: `manifest.json`,
`runtime/runtime-<date>-<sha8>.zip`, `sam2/…`, `tapnext/…`, `hydra/…` (7.7 GB of models + 2.3 GB of runtime). Every
name carries the first 8 hex of its SHA-256: files under `v1/` are immutable, a new version is a new name, and only
`manifest.json` is ever replaced (served with `Cache-Control: max-age=60`; Cloudflare does not cache `.json` here).
taggerine is in the manifest (pinned by SHA-256) but never uploaded: users get it from its own page and bring the
files in. CoTracker3 is in neither. The app follows no redirects from the models server.

Upload (the owner; nothing in this repo holds a key): rclone over R2's S3 API. Not Wrangler: `r2 object put` takes at
most 315 MB a file and one file at a time, and the runtime and TAPNext++ files are 2.3-2.5 GB each. The remote `r2`
lives in your own rclone config (`rclone config`: type s3, provider Cloudflare, region auto, endpoint
`https://<account id>.r2.cloudflarestorage.com` (the account id is on the R2 page of the Cloudflare dashboard), the
token's Access Key ID and Secret; add
`no_check_bucket = true` for an object-scoped token).

```powershell
cmd /c start "" /b /wait /belownormal pwsh -NoProfile -File dev\share\build-models.ps1 -Embed           # manifest + folder; prints the commands
cmd /c start "" /b /wait /belownormal pwsh -NoProfile -File dev\share\build-models.ps1 -Embed -Upload   # ... and runs them:
#   (the bucket is openvalence-downloads; build-models.ps1 -Bucket / -RemoteName change it)
#   rclone copy <Out> r2:<bucket>/pawscript/v1/ --exclude manifest.json --order-by size,descending --s3-chunk-size 64M --transfers 4 --checksum --progress
#   rclone copyto <Out>\manifest.json r2:<bucket>/pawscript/v1/manifest.json --header-upload "Cache-Control: max-age=60" --checksum
#   rclone deletefile r2:<bucket>/pawscript/v1/_probe.bin      (the bucket's two probe files, first upload only)
#   rclone deletefile r2:<bucket>/pawscript/v1/_probe.json
curl.exe -I https://dl.openvalence.org/pawscript/v1/manifest.json                                                       # 200
curl.exe -r 0-99 -o NUL -w "%{http_code}" https://dl.openvalence.org/pawscript/v1/sam2/sam2.1_hiera_tiny-7402e0d8.pt   # 206: resume works
```

The big files go first and `manifest.json` last, on its own, so a manifest never names a file that is not there yet.
Commit `src/features/models/manifest.json` (the copy compiled into the app) with the upload it describes.

## Updates

The app checks `https://github.com/openvalence/Pawscript/releases/latest/download/latest.json` only when the user runs
Help > Check for updates (or turned on "Check for updates at start", off by default). Updates are signed with a
minisign key; the public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`), now a placeholder: a build
with it compiles and says "updates are not configured in this build". Never commit the private key.

Once, by the owner:

```powershell
npm run tauri signer generate -- -w "$env:USERPROFILE\.tauri\pawscript-updater.key"   # asks for a password
# It prints the PUBLIC key (also in pawscript-updater.key.pub): paste it as "pubkey" in src-tauri/tauri.conf.json and
# commit that. Keep pawscript-updater.key and its password private and backed up (a password manager plus an offline
# copy): without them no installed copy can verify a later update.
```

Each release (the shared, portable build):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\pawscript-updater.key"   # the path, or the key text itself
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<its password>"
pwsh -File dev\share\build-nas.ps1 -Online -Release 0.2.0 -Notes notes.md -Out "$env:USERPROFILE\Documents\Pawscript-0.2.0\Pawscript"
```

`-Release` makes the exe report 0.2.0 (the version latest.json is compared with) and writes `<Out>-release\`:
`Pawscript-0.2.0-update.zip` (Pawscript.exe + code.zip), its `.sig` (from `tauri signer sign`), and `latest.json`
(platform `windows-x86_64-portable`, the signature, the zip's URL on the release). Create the GitHub release with the
tag `v0.2.0` and attach `latest.json`, the update zip, its `.sig` and the small download `<Out>.zip`;
`releases/latest/download/latest.json` then serves the new one. The version must be higher than the last release's.

What an update replaces in the portable folder: `Pawscript.exe` (the running exe is renamed to
`.setup\Pawscript.old.exe`, which Windows allows, and deleted at the next start) and `code.zip` (unpacked at the next
start because its stamp changed). Settings, projects, the models and the runtime are not touched; a version that needs a
new runtime downloads only that at its first start. The restart is asked first and writes every open project. The
NSIS-installer path of tauri-plugin-updater is wired too (`update.rs`) for an installer build, but no installer is
published: the portable flow above is the one in use.

## Not reproducible yet

- **Device playback** uses six crates of the OpenValence fork of buttplug,
  [github.com/openvalence/ButtplugIO](https://github.com/openvalence/ButtplugIO) (branch `valence`): `buttplug_core`,
  `buttplug_server`, `buttplug_server_device_config`, `buttplug_server_hwmgr_btleplug`, `buttplug_server_hwmgr_serial`,
  `buttplug_server_hwmgr_hid` (11.0.0), pinned to one commit in `src-tauri/Cargo.toml`. The first build fetches them
  (needs network).
- **The toy library** of the Machine panel is third-party product data and is not part of this source:
  `src/features/machine/toys/library.json` is empty, the picker offers the generic toys and imported ones.
  The tests that measured the physics against that library are not included.
- **`runtime.zip`** of the portable build is assembled by hand (see above), not by a script.
- **The models server and the update key** are the owner's (above): a build from this source downloads from
  `dl.openvalence.org` (the files the compiled manifest pins), and reports updates as not configured until a key is set.
- **The Director's VLM backends** expect a separate Python environment that is not part of this tree.
- **The evaluation harness and experiments** that set many of the tuned constants ran on private footage and are not
  included; the constants are, with comments saying what they were tuned for.
