# dev/share/build-nas.ps1 -- build the public Pawscript folder: one plain copy, a few dozen files (paw-i7s, paw-zqxu).
#
#   pwsh -File dev/share/build-nas.ps1 [-Out <folder>] [-Work <scratch>] [-Private]
#
# <Out> (default Documents\Pawscript-nas\Pawscript) gets:
#   Pawscript.exe              release build, identifier app.pawscript.portable (users' data never mixes with the owner's)
#   code.zip                   trackers\pawtrack + PROTOCOL.md + sitecustomize.py (no network for the bundled Python) + code.stamp
#   runtime.zip.001, .002      python\ + ffmpeg.exe + ffprobe.exe + runtime.stamp: dev\share\runtime\$RuntimeArchive (pinned
#                              below, checked against trackers/uv.lock's torch; git-ignored, made once; how: the .txt beside it)
#   trackers\.cache, .models   the model files, plain, where the loaders read them (hard links from the live cache)
#   tapnextpp_ckpt.pt.001, .002, tapnextpp_512.ckpt.001, .002   the two TAPNext++ checkpoints, in parts
#   parts.txt                  every file over $PartBytes (GitHub's 2 GiB cap) goes as parts beside the exe; this lists
#                              them with size and sha256; the first start joins each where it belongs (portable.rs)
#   README.txt, TERMS.txt, LICENSE, NOTICE, LICENSES-SUMMARY.txt, LICENSES\, VERSION.txt, Guide\ (docs\guide, Markdown)
#   Sample\                    the sample project (sample\, CC0, paw-ys3x) as plain files; the exe carries its own copy
# https://github.com/openvalence/Pawscript / https://github.com/openvalence/Pawscript/issues in README.txt, TERMS.txt and LICENSES-SUMMARY.txt are filled from src/app/release.js.
# The public build has no stock toy library (the Machine panel offers the generic toys) and no tagger pack. No build has
# CoTracker3 (paw-vdr4: CC-BY-NC 4.0 code + weights; TAPNext++ everywhere), nor its glue module (paw-uekm:
# trackers\pawtrack\trackers\cotracker_points.py is left out of code.zip).
# -Private (the owner's own builds only, never published): the Bad Dragon toy library stays in, and beside the folder
# <Out>-tagger\trackers\.cache\taggerine (the optional taggerine pack, merged by copying it over the folder); their rows
# are appended to LICENSES-SUMMARY.txt.
# On its first start the exe joins the parts, then unpacks runtime.zip / code.zip into its own folder
# (src-tauri/src/portable.rs), again only when a zip's stamp changes. An update for friends = Pawscript.exe + code.zip.
#
# Built from a clean `git archive HEAD` (the owner's uncommitted files, e.g. his own character body and toys, can
# never get in): vite build, then `tauri build --no-bundle` with the portable identifier, cargo -j 8 --offline, at
# below-normal priority, its own target dir. dev/share/patches/*.patch (fixes not yet in HEAD) are applied to that copy
# in name order; one already in HEAD is skipped.
# Privacy gate (paw-jw3o; dev/share/privacy-gate.ps1, the one export-source.ps1 runs): the built dist before it is
# embedded, then everything staged as text or code (code.zip's files before zipping, Guide\, README/TERMS/LICENSES,
# LICENSE, NOTICE, Pawscript.exe's bytes) is scanned for the private markers; a hit stops the build with file:line and
# the marker's category (never the matched text), writes <Out>\BUILD-FAILED.txt and makes no code.zip. The shipped
# docs must name only files that ship or are in the public source (paw-7hac); rare capitalised words are printed as a
# review list (paw-3l6g, not a failure).
# -StageOnly: a quick re-check of staging + gate from an earlier build in <Work> (its target\release\pawscript.exe):
# vite build and the gates run; tauri build, runtime, models and parts are skipped.
# Never writes into the live repo, src-tauri, dist or node_modules; never downloads.
# paw-cdot:
# -Online: the small download. No runtime, no models, no parts in <Out>: the app's first start downloads the runtime
#   and the models the user picks (src/features/models, from the models server; manifest: dev/share/build-models.ps1).
#   <Out> must not hold an earlier full build's runtime / models (use a fresh -Out). Afterwards <Out>.zip is made: the
#   one file to publish. Without -Online the folder is the full offline bundle, as before (nothing to download).
# -Release <x.y.z>: the version the exe reports (tauri.conf.json "version" for this build) and the updater files in
#   <Out>-release\: Pawscript-<x.y.z>-update.zip (Pawscript.exe + code.zip), its .sig (tauri signer sign, bound to
#   <x.y.z>; the key is %USERPROFILE%\.tauri\pawscript-updater-auto.key, no password, unless TAURI_SIGNING_PRIVATE_KEY is
#   set) and latest.json (platform windows-x86_64-portable, URL
#   https://github.com/openvalence/Pawscript/releases/download/v<x.y.z>/...). dev\share\publish-release.ps1
#   publishes them (docs/BUILDING.md, "Updates"). -Notes <file>: the release notes in latest.json.
# Either way the compiled manifest (src/features/models/manifest.json) must pin the runtime this build ships
# ($RuntimeArchive): else the app would ask friends to download another runtime. Checked below.
#Requires -Version 7
param(
  [string]$Out = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Pawscript-nas\Pawscript'),
  [string]$Work = (Join-Path $env:TEMP 'pawscript-share-build'),
  [switch]$Private,
  [switch]$StageOnly,
  [switch]$Online,
  [string]$Release = '',
  [string]$Notes = ''
)
if ($Release -and $Release -notmatch '^\d+\.\d+\.\d+$') { throw "-Release must be a version like 0.2.0 (semver, higher than the last release)" }
# Must match the pubkey in src-tauri/tauri.conf.json; TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD) overrides it.
$AutoKey = if ($env:TAURI_SIGNING_PRIVATE_KEY) { '' } else { Join-Path $env:USERPROFILE '.tauri\pawscript-updater-auto.key' }
if ($Release -and $AutoKey -and -not (Test-Path -LiteralPath $AutoKey)) { throw "-Release needs the signing key $AutoKey (or TAURI_SIGNING_PRIVATE_KEY): docs/BUILDING.md, Updates" }
$ErrorActionPreference = 'Stop'
# The runtime this build ships, in dev\share\runtime (git-ignored; its record is the .txt of the same name). Pinned by
# name, never "the newest": runtime-public-2026-11-18.zip (cu126) sorts after it. Select-Runtime checks it against the
# torch build in trackers/uv.lock and stops the build when they differ.
$RuntimeArchive = 'runtime-2026-11-18.zip'
# paw-7yed: GitHub takes at most 2 GiB per file, so every file over this goes as parts beside the exe (Write-Parts);
# the exe's first start joins them back (src-tauri/src/portable.rs). 2,000,000,000 bytes = 1.86 GiB: 147 MB headroom.
$PartBytes = [long]2000000000

function Select-Runtime([string]$dir, [string]$lock) {
  $zip = Get-Item (Join-Path $dir $RuntimeArchive) -ErrorAction SilentlyContinue
  if (-not $zip) { throw "no dev\share\runtime\$RuntimeArchive (`$RuntimeArchive in build-nas.ps1): see dev\share\runtime\*.txt for how it is made" }
  if ((Get-Content $lock -Raw) -notmatch 'name = "torch"\r?\nversion = "([^"]+\+[^"]+)"') { throw "$lock has no CUDA torch build (torch x.y.z+cuNNN)" }
  $torch = "torch$($Matches[1])"
  $record = [IO.Path]::ChangeExtension($zip.FullName, '.txt')
  $recStamp = if (Test-Path $record) { (Select-String -Path $record -Pattern 'runtime\.stamp\s+"([^"]+)"' | Select-Object -First 1).Matches.Groups[1].Value }
  $zipStamp = (& "$env:SystemRoot\System32\tar.exe" -xOf $zip.FullName runtime.stamp | Out-String).Trim()
  if ($recStamp -ne $zipStamp -or ($zipStamp -split ' ') -notcontains $torch) {
    throw "$($zip.Name) does not match trackers/uv.lock: the lock has $torch, the zip's runtime.stamp says '$zipStamp', its record $(Split-Path $record -Leaf) says '$recStamp'. Set `$RuntimeArchive to the runtime built from this lock."
  }
  $zip
}

# Cuts $from into <name>.001, .002, ... (each $PartBytes, the last the rest) in $out beside the exe; returns its parts.txt
# line "<rel> <bytes> <sha256> <part bytes> <count>". Parts already there with the same line in $known are kept.
function Write-Parts([string]$from, [string]$rel, [string]$out, [string[]]$known) {
  $name = Split-Path $rel -Leaf
  $len = (Get-Item $from).Length
  $count = [long][Math]::Ceiling($len / $PartBytes)
  $line = "$rel $len $((Get-FileHash $from -Algorithm SHA256).Hash.ToLower()) $PartBytes $count"
  $part = { param($k) Join-Path $out ('{0}.{1:D3}' -f $name, $k) }
  $size = { param($k) [Math]::Min($PartBytes, $len - ($k - 1) * $PartBytes) }
  $whole = $known -contains $line
  for ($k = 1; $whole -and $k -le $count; $k++) { $whole = (Test-Path (& $part $k)) -and (Get-Item (& $part $k)).Length -eq (& $size $k) }
  if (-not $whole) {
    Step "$name -> $count parts"
    $in = [IO.File]::OpenRead($from)
    $buf = [byte[]]::new(4MB)
    try {
      for ($k = 1; $k -le $count; $k++) {
        $p = & $part $k
        $o = [IO.File]::Create("$p.tmp")
        try {
          for ($left = & $size $k; $left -gt 0; $left -= $n) {
            $n = $in.Read($buf, 0, [Math]::Min([long]$buf.Length, $left))
            if ($n -le 0) { throw "$from ended early" }
            $o.Write($buf, 0, $n)
          }
        } finally { $o.Dispose() }
        Move-Item "$p.tmp" $p -Force
      }
    } finally { $in.Dispose() }
  }
  Get-ChildItem $out -File -Filter "$name.*" | Where-Object { $_.Name -match '\.(\d{3})$' -and [int]$Matches[1] -gt $count } | Remove-Item -Force
  $line
}

# parts.txt beside the exe, which portable.rs reads (none when nothing is split)
function Write-PartsList([string]$path, [string[]]$lines) {
  if (-not $lines) { Remove-Item $path -Force -ErrorAction SilentlyContinue; return }
  $names = $lines | ForEach-Object { Split-Path ($_ -split ' ')[0] -Leaf }
  if (($names | Sort-Object -Unique).Count -ne $names.Count) { throw "two split files share a name (their parts would collide): $names" }
  @('# Pawscript: files in parts beside Pawscript.exe, joined by its first start. <file> <bytes> <sha256> <part bytes> <parts>') + $lines |
    Set-Content $path
}
(Get-Process -Id $PID).PriorityClass = 'BelowNormal'   # children (node, cargo, rustc) inherit it
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$t0 = Get-Date
function Step($what) { Write-Host ("[{0,5:N0} s] {1}" -f ((Get-Date) - $t0).TotalSeconds, $what) }
function Native { & $args[0] @($args | Select-Object -Skip 1); if ($LASTEXITCODE) { throw "failed ($LASTEXITCODE): $args" } }
. (Join-Path $PSScriptRoot 'privacy-gate.ps1')
$markers = Get-PrivacyMarkers $repo
if (-not $markers) { Write-Warning "no $PrivacyMarkersFile (the public source has none): the build runs WITHOUT its privacy gate" }
function Stop-OnLeak([string]$what, $hits) {
  if (-not $markers) { return }
  if (-not $hits.Count) { Step "privacy gate ($what): clean"; return }
  $hits | Select-Object -First 200 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  if (Test-Path $Out) { Set-Content (Join-Path $Out 'BUILD-FAILED.txt') (@("NOT FOR PUBLICATION: the build of $commit failed its privacy gate ($what).", '') + $hits) }
  throw "privacy gate ($what): $($hits.Count) private marker hit(s), listed above as file:line: category. Rewrite them in the source; nothing masks them."
}

# ---- clean checkout of HEAD
$src = Join-Path $Work 'src'
$nm = Join-Path $src 'node_modules'
if (Test-Path $nm) { [IO.Directory]::Delete($nm) }   # the junction only (never recurse into the live node_modules)
if (Test-Path $src) { Remove-Item $src -Recurse -Force }
New-Item -ItemType Directory -Force $src | Out-Null
$commit = (git -C $repo rev-parse HEAD).Trim()
Step "git archive $commit"
Native git -C $repo archive --format=tar -o (Join-Path $Work 'src.tar') $commit
Native tar -xf (Join-Path $Work 'src.tar') -C $src
Remove-Item (Join-Path $Work 'src.tar')

# Cargo path deps on ../../OpenValence: absolute in the scratch copy only (read-only use, the target dir is ours).
# The public tree has git deps instead (export-source.ps1) and no fork beside it: nothing to rewrite there.
$toml = Join-Path $src 'src-tauri\Cargo.toml'
if (-not $StageOnly -and (Get-Content $toml -Raw) -match '"\.\./\.\./OpenValence/') {
  $ov = (Resolve-Path (Join-Path $repo '..\OpenValence')).Path -replace '\\', '/'
  (Get-Content $toml -Raw) -replace '"\.\./\.\./OpenValence/', "`"$ov/" | Set-Content $toml -NoNewline
}
New-Item -ItemType Junction -Path $nm -Target (Join-Path $repo 'node_modules') | Out-Null

# ---- patches not yet in HEAD (applied to the scratch copy only)
$applied = @()
Push-Location $src
try {
  foreach ($p in Get-ChildItem (Join-Path $PSScriptRoot 'patches') -Filter *.patch -ErrorAction SilentlyContinue | Sort-Object Name) {
    $lf = Join-Path $Work $p.Name   # LF copy: the archive is LF, a CRLF checkout of the patch would not match
    [IO.File]::WriteAllText($lf, ([IO.File]::ReadAllText($p.FullName) -replace "`r`n", "`n"))
    $p = Get-Item $lf
    git apply --check -R $p.FullName 2>$null
    if (-not $LASTEXITCODE) { Step "patch $($p.Name): already in HEAD, skipped"; continue }
    Native git apply $p.FullName
    $applied += $p.BaseName; Step "patch $($p.Name): applied"
  }
} finally { Pop-Location }
# the folder holds parts (runtime.zip, the TAPNext++ checkpoints): an exe that cannot join them would never set up
if (-not (Select-String -Quiet -SimpleMatch -Path (Join-Path $src 'src-tauri\src\portable.rs') -Pattern 'PARTS: &str = "parts.txt"')) {
  throw "this checkout's portable.rs cannot join parts.txt's parts: apply dev/patches/paw-7yed-runtime-parts.patch first"
}

# ---- public build: an empty toy library (same top-level fields), no pictures or meshes; library.js then falls back to
# the generic toys. -Private keeps the library.
if (-not $Private) {
  $toys = Join-Path $src 'src\features\machine\toys'
  $lib = Get-Content (Join-Path $toys 'library.json') -Raw | ConvertFrom-Json
  $lib.toys = @()
  Get-ChildItem $toys -Force | Remove-Item -Recurse -Force
  $lib | ConvertTo-Json -Depth 20 -Compress | Set-Content (Join-Path $toys 'library.json')
  $applied += 'no-stock-toys'; Step 'stock toy library left out'
} else { $applied += 'private'; Step 'PRIVATE build: stock toy library and tagger pack included (never publish this folder)' }

# ---- frontend (cacheDir moved off the shared node_modules)
Step 'vite build'
$wrap = Join-Path $src 'vite.share.config.mjs'
"import c from './vite.config.js';`nexport default { ...c, cacheDir: '$(($Work -replace '\\', '/'))/vite-cache' };" | Set-Content $wrap
Push-Location $src
try {
  $env:VITE_PAWSCRIPT_COMMIT = $commit   # a .pawpack's manifest names the build that made it (paw-2k9s)
  Native node (Join-Path $repo 'node_modules\vite\bin\vite.js') build --config $wrap --outDir dist --emptyOutDir --logLevel warn
  Stop-OnLeak 'frontend dist' (Find-PrivacyHits $markers (Join-Path $src 'dist') 'dist')   # before the exe embeds it
  # ---- shell: release, no installer, the portable identifier, offline, 8 jobs
  if (-not $StageOnly) {
    Step 'tauri build (release)'
    $cfg = Join-Path $Work 'tauri.share.json'
    $share = [ordered]@{ identifier = 'app.pawscript.portable'; build = @{ beforeBuildCommand = '' } }
    if ($Release) { $share.version = $Release }   # what the updater compares latest.json against
    $share | ConvertTo-Json -Compress | Set-Content $cfg
    $env:CARGO_TARGET_DIR = Join-Path $Work 'target'
    $env:RUSTFLAGS = "--remap-path-prefix=$env:USERPROFILE=~"   # keeps the home folder out of panic locations
    Push-Location 'src-tauri'
    Native node (Join-Path $repo 'node_modules\@tauri-apps\cli\tauri.js') build --no-bundle --config $cfg '--' -j 8 --offline
    Pop-Location
  }
} finally { Pop-Location }

# ---- the folder
Step 'stage'
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
New-Item -ItemType Directory -Force $Out | Out-Null
Remove-Item (Join-Path $Out 'BUILD-FAILED.txt') -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $Work 'target\release\pawscript.exe') (Join-Path $Out 'Pawscript.exe') -Force
Copy-Item (Join-Path $src 'LICENSE'), (Join-Path $src 'NOTICE') $Out -Force
# the texts, with https://github.com/openvalence/Pawscript / https://github.com/openvalence/Pawscript/issues filled from src/app/release.js (the one place they are set)
$rel = Get-Content (Join-Path $src 'src\app\release.js') -Raw
$fill = @{}
foreach ($k in 'SOURCE_URL', 'CONTACT') {
  if ($rel -notmatch "export const $k = '([^']+)'") { throw "src/app/release.js has no $k" }
  $fill[$k] = $Matches[1]
}
foreach ($name in 'README.txt', 'TERMS.txt', 'LICENSES-SUMMARY.txt') {
  $text = (Get-Content (Join-Path $src "dev\share\$name") -Raw).Replace('https://github.com/openvalence/Pawscript', $fill.SOURCE_URL).Replace('https://github.com/openvalence/Pawscript/issues', $fill.CONTACT)
  if ($text -match '\{\{\w+\}\}') { throw "$name still has a placeholder: $($Matches[0])" }
  Set-Content (Join-Path $Out $name) $text -NoNewline
}
# the guide beside the exe (paw-kxwz): docs\guide as plain Markdown (quick-start.md first; the quick start is also inside the app, F1)
$guide = Join-Path $Out 'Guide'
if (Test-Path $guide) { Remove-Item $guide -Recurse -Force }
Copy-Item (Join-Path $src 'docs\guide') $guide -Recurse
# the sample project (paw-ys3x): inside Pawscript.exe too (Help > Open the sample project copies it to Videos); here as
# plain files for anyone who wants them outside the app (CC0, sample\README.md); gated below with the guide
$sample = Join-Path $Out 'Sample'
if (Test-Path $sample) { Remove-Item $sample -Recurse -Force }
Copy-Item (Join-Path $src 'sample') $sample -Recurse
if ($Private) {
  @'

PRIVATE BUILD ONLY (-Private; never in the public folder)
---------------------------------------------------------
NO       Bad Dragon toy library inside Pawscript.exe (Machine panel: names, side pictures, dimensions, meshes, maps;
         src/features/machine/toys): "Bad Dragon's; bundled for private use only, not licensed for redistribution".
unclear  taggerine (Pawscript-tagger piece): card says Apache-2.0, but it is a fine-tune of Meta's DINOv3 ("DINOv3
         License", custom); no licence file came with the weights. LICENSES\models\taggerine-NOTE.txt.
'@ | Add-Content (Join-Path $Out 'LICENSES-SUMMARY.txt')
}
# LICENSES: the app's table and attributions from this checkout; Python's, ffmpeg's and the models' licences and the
# notes from dev/share/LICENSES (each Python package's own licence files are inside runtime.zip, python\Lib\site-packages)
$lic = Join-Path $Out 'LICENSES'
if (Test-Path $lic) { Remove-Item $lic -Recurse -Force }
New-Item -ItemType Directory -Force $lic | Out-Null
Copy-Item (Join-Path $src 'THIRD-PARTY.md') (Join-Path $lic 'THIRD-PARTY-app.md')
Copy-Item (Join-Path $src 'src\features\machine\bodies\human.ATTRIBUTION.txt') (Join-Path $lic 'human-body-ATTRIBUTION.txt') -ErrorAction SilentlyContinue
Copy-Item (Join-Path $src 'src\lib\valence\vendor\LICENSE') (Join-Path $lic 'valence-vendor-LICENSE.txt')
Copy-Item (Join-Path $PSScriptRoot 'LICENSES\*') $lic -Recurse -Force
if (-not $Private) { Remove-Item (Join-Path $lic 'models\taggerine-NOTE.txt') -Force }   # the tagger pack is private-only

# code.zip: trackers\pawtrack (no caches), the protocol, sitecustomize.py, code.stamp (not trackers\README.md: a developer notebook)
$code = Join-Path $Work 'stage-code'
if (Test-Path $code) { Remove-Item $code -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $code 'trackers') | Out-Null
Copy-Item (Join-Path $src 'trackers\pawtrack') (Join-Path $code 'trackers') -Recurse
Remove-Item (Join-Path $code 'trackers\pawtrack\trackers\cotracker_points.py') -Force   # paw-uekm: the CoTracker3 glue is in no build
Get-ChildItem (Join-Path $code 'trackers') -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
Copy-Item (Join-Path $src 'trackers\PROTOCOL.md'), (Join-Path $src 'dev\share\sitecustomize.py') (Join-Path $code 'trackers')
$codeStamp = "code $stamp $($commit.Substring(0, 12))"
Set-Content (Join-Path $code 'code.stamp') $codeStamp

# ---- privacy gate over everything staged as text or code, before code.zip is made
$leaks = [Collections.Generic.List[string]]::new()
$leaks.AddRange((Find-PrivacyHits $markers $code 'code.zip'))
$staged = @('Pawscript.exe', 'LICENSE', 'NOTICE', 'README.txt', 'TERMS.txt', 'LICENSES-SUMMARY.txt' | ForEach-Object { Join-Path $Out $_ }) +
  (Get-ChildItem $guide, $lic, $sample -Recurse -File -Force).FullName
$leaks.AddRange((Find-PrivacyHits $markers $Out -Files $staged))
Stop-OnLeak 'code.zip, Guide, Sample, texts, LICENSES, exe' $leaks
# paw-7hac: what the shipped docs name must be in the folder, in code.zip or in the public source (never a private file)
$docs = @($staged | Where-Object { $_ -match '\.(?:md|txt)$' }) + (Join-Path $code 'trackers\PROTOCOL.md')
$allowList = Join-Path $src 'dev\share\public-allow.txt'
$pubRules = if (Test-Path $allowList) { @(Get-PublicRules $allowList) }
$isPublic = { param($p) (Test-Path -LiteralPath (Join-Path $src $p)) -and (-not $pubRules -or (Test-PublicPath $pubRules $p)) }
$broken = @(Find-BrokenRefs $Out $docs @($Out, (Join-Path $Out 'Guide'), $code) $isPublic)
if ($broken) {
  $broken | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  throw "shipped docs: $($broken.Count) reference(s) to files that are neither shipped nor in the public source (above): name the shipped file or drop the reference"
}
Step 'shipped docs: every file they name is shipped or public'
if ($markers) {   # the review list (paw-3l6g): not a failure, a human reads it (export-source.ps1 -Accept records it)
  $words = @(Find-RareWords $Out -Files (@($staged) + (Get-ChildItem $code -Recurse -File).FullName) -Reviewed (Join-Path $PSScriptRoot 'privacy-reviewed-words.txt'))
  Write-Host "REVIEW (not a failure): $($words.Count) rare capitalised word(s) not reviewed yet in what ships" -ForegroundColor Yellow
  $words | Select-Object -First 100 | ForEach-Object { Write-Host "  $_" }
}

$zip = Join-Path $Out 'code.zip'
Push-Location $code
try { Native tar --format zip -c -f "$zip.part" trackers code.stamp } finally { Pop-Location }
Move-Item "$zip.part" $zip -Force

# paw-cdot: the compiled manifest pins the runtime this build ships (the app compares it with the unpacked one)
$keep = Select-Runtime (Join-Path $PSScriptRoot 'runtime') (Join-Path $src 'trackers\uv.lock')
$pinned = ((Get-Content (Join-Path $src 'src\features\models\manifest.json') -Raw | ConvertFrom-Json).models | Where-Object { $_.kind -eq 'runtime' }).version
$rtWant = (& "$env:SystemRoot\System32\tar.exe" -xOf $keep.FullName runtime.stamp | Out-String).Trim()
if (@($pinned) -notcontains $rtWant) { throw "src/features/models/manifest.json pins runtime '$pinned', this build ships '$rtWant': run dev/share/build-models.ps1 -Embed and commit it" }
if ($Online) {
  $old = @('runtime.zip', 'runtime.zip.001', 'parts.txt', 'trackers\.cache', 'trackers\.models', 'tapnextpp_ckpt.pt.001') | Where-Object { Test-Path (Join-Path $Out $_) }
  if ($old) { throw "-Online: $Out still holds $($old -join ', ') from a full build: use a fresh -Out (nothing was deleted)" }
  $rtStamp = "$rtWant (downloaded by the first start)"
}
if (-not $StageOnly -and -not $Online) {
# runtime.zip: the pinned archive in dev\share\runtime, as parts when over $PartBytes (parts.txt lists them), else
# whole (a hard link: no copy), replaced only when its stamp differs
Step "runtime: $($keep.Name)"
$rt = Join-Path $Out 'runtime.zip'
$manifest = Join-Path $Out 'parts.txt'
$known = if (Test-Path $manifest) { @(Get-Content $manifest) } else { @() }
$parts = @()
$stampOf = { param($z) (& "$env:SystemRoot\System32\tar.exe" -xOf $z runtime.stamp | Out-String).Trim() }
if ($keep.Length -gt $PartBytes) {
  if (Test-Path $rt) { Remove-Item $rt -Force }
  $parts += Write-Parts $keep.FullName 'runtime.zip' $Out $known
} elseif (-not (Test-Path $rt) -or (& $stampOf $rt) -ne (& $stampOf $keep.FullName)) {
  Step "runtime.zip <- $($keep.Name)"
  if (Test-Path $rt) { Remove-Item $rt -Force }
  try { New-Item -ItemType HardLink -Path $rt -Target $keep.FullName -ErrorAction Stop | Out-Null } catch { Copy-Item $keep.FullName $rt }
}
$rtStamp = & $stampOf $keep.FullName

# models: hard links from the live cache (a copy when on another volume); -Private: taggerine beside, as the optional piece
$live = Join-Path $repo 'trackers'
$models = @('.cache\sam2\sam2.1_hiera_tiny.pt', '.cache\sam2\sam2.1_hiera_small.pt', '.cache\sam2\sam2.1_hiera_base_plus.pt',
  '.cache\sam2\sam2.1_hiera_large.pt',
  '.cache\tapnext\tapnextpp_ckpt.pt', '.cache\tapnext\tapnextpp_512.ckpt', '.models\hydra\models\hydra-3.5.safetensors') +
  (Get-ChildItem (Join-Path $live '.models\hydra\hydra') -Filter *.py | ForEach-Object { ".models\hydra\hydra\$($_.Name)" })
Remove-Item (Join-Path $Out 'trackers\.cache\cotracker') -Recurse -Force -ErrorAction SilentlyContinue   # left by an older build
$tagger = @('.cache\taggerine\tagger_proto.safetensors', '.cache\taggerine\tagger_vocab.json')
$sets = @(@{ to = $Out; files = $models }) + $(if ($Private) { @(@{ to = "$Out-tagger"; files = $tagger }) } else { @() })
foreach ($set in $sets) {
  foreach ($rel in $set.files) {
    $from = Join-Path $live $rel; $to = Join-Path (Join-Path $set.to 'trackers') $rel
    if ($set.to -eq $Out -and (Get-Item $from).Length -gt $PartBytes) {   # the TAPNext++ checkpoints (2.36 GiB each)
      if (Test-Path $to) { Remove-Item $to -Force }
      $parts += Write-Parts $from ("trackers/$rel" -replace '\\', '/') $Out $known
      continue
    }
    if ((Test-Path $to) -and (Get-Item $to).Length -eq (Get-Item $from).Length) { continue }
    New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
    if (Test-Path $to) { Remove-Item $to -Force }
    try { New-Item -ItemType HardLink -Path $to -Target $from -ErrorAction Stop | Out-Null } catch { Copy-Item $from $to }
  }
}
Write-PartsList $manifest $parts
} elseif (-not $Online) { $rtStamp = 'unchanged (-StageOnly)' }
$proto = Select-String -Path (Join-Path $src 'trackers\PROTOCOL.md') -Pattern '^v(\d+)\.(\d+)' |
  ForEach-Object { [version]"$($_.Matches[0].Groups[1].Value).$($_.Matches[0].Groups[2].Value)" } | Sort-Object -Descending | Select-Object -First 1
@"
Pawscript (shared build) $stamp
commit    $commit
built     $(Get-Date -Format 'yyyy-MM-dd HH:mm zzz')
protocol  v$proto (trackers\PROTOCOL.md)
version   $(if ($Release) { $Release } else { '(not a release)' })$(if ($Online) { ', small download' } else { ', full folder' })
patches   $(if ($applied) { $applied -join ', ' } else { 'none' })
code.zip  $codeStamp
runtime   $rtStamp
data      %APPDATA%\app.pawscript.portable and %LOCALAPPDATA%\app.pawscript.portable
"@ | Set-Content (Join-Path $Out 'VERSION.txt')
[IO.Directory]::Delete($nm)
$all = Get-ChildItem $Out -Recurse -File -Force
Step ("done: {0}: {1} files, {2:N2} GB; code.zip {3:N1} MB, Pawscript.exe {4:N1} MB; commit {5}" -f $Out, $all.Count,
  (($all | Measure-Object Length -Sum).Sum / 1GB), ((Get-Item $zip).Length / 1MB), ((Get-Item (Join-Path $Out 'Pawscript.exe')).Length / 1MB), $commit.Substring(0, 9))
# paw-cdot: the small download as one zip; the updater's files for a release
if ($Online -and -not $StageOnly) {
  $one = "$Out.zip"
  Native "$env:SystemRoot\System32\tar.exe" --format zip -c -f "$one.part" -C (Split-Path $Out) (Split-Path $Out -Leaf)
  Move-Item "$one.part" $one -Force
  Step ("small download: {0} ({1:N1} MB)" -f $one, ((Get-Item $one).Length / 1MB))
}
if ($Release -and -not $StageOnly) {
  $rel = "$Out-release"
  New-Item -ItemType Directory -Force $rel | Out-Null
  $upd = Join-Path $rel "Pawscript-$Release-update.zip"
  Native "$env:SystemRoot\System32\tar.exe" --format zip -c -f $upd -C $Out Pawscript.exe code.zip
  Remove-Item "$upd.sig" -Force -ErrorAction SilentlyContinue
  $keyArgs = if ($AutoKey) { @('-f', $AutoKey, '-p', '') } else { @() }   # else key and password from the environment
  Native node (Join-Path $repo 'node_modules\@tauri-apps\cli\tauri.js') signer sign @keyArgs --app-version $Release $upd   # requireSignedVersion
  $notesText = if ($Notes) { Get-Content $Notes -Raw } else { "Pawscript $Release" }
  [ordered]@{ version = $Release; notes = $notesText; pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = [ordered]@{ 'windows-x86_64-portable' = [ordered]@{ signature = (Get-Content "$upd.sig" -Raw).Trim()
      url = "https://github.com/openvalence/Pawscript/releases/download/v$Release/Pawscript-$Release-update.zip" } } } |
    ConvertTo-Json -Depth 5 | Set-Content (Join-Path $rel 'latest.json')
  Step "release $Release`: $rel (publish: pwsh -File dev\share\publish-release.ps1 -Out $Out)"
}