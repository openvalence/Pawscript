# dev/share/build-models.ps1 -- the download manifest and the folder to upload to the models bucket (paw-cdot).
#
#   pwsh -File dev/share/build-models.ps1 [-Out <folder>] [-Models <trackers folder>] [-Runtime <runtime zip>] [-Embed] [-Upload]
#
# Reads the model files from <Models> (default: this checkout's trackers\, where .cache\ and .models\ are) and the
# runtime archive (default: dev\share\runtime\<$RuntimeArchive of build-nas.ps1>, the one the shared build ships), and
#   <Out>\manifest.json          what the app's downloader reads (src/features/models/logic.js parseManifest)
#   <Out>\<url of each file>     the files themselves, as hard links (a copy when on another volume), laid out as the
#                                manifest's "url" fields say, exactly as under https://dl.openvalence.org/pawscript/v1/
#                                (MODELS_BASE_URL in src/features/models/logic.js). Every name carries the first 8 hex of
#                                its SHA-256 (sam2/sam2.1_hiera_tiny-7402e0d8.pt): files under v1 are never changed in
#                                place, a new version is a new name; only manifest.json is replaced.
# -Embed also writes the manifest to src/features/models/manifest.json: the copy compiled into the app. The app trusts
# THAT copy's sizes and SHA-256 for the runtime (it pins the runtime the build needs) and uses it to tell installed /
# missing / damaged with no network at all. Commit it with the build that ships these files.
#
# Kinds: a model ("source" hosted: downloaded from the bucket; "manual": nobody hosts it, the user downloads it from its
# own page and brings the files in, Settings > Models, Choose files... or a drop) and the runtime ("kind": "runtime":
# runtime.zip beside the exe, unpacked by the first start, src-tauri/src/portable.rs). Every file is hashed (SHA-256):
# about 15 GB with the runtime and taggerine; seconds when the files are in the disk cache, a few minutes when not. At low
# priority on the second CCD (AGENT-RULES):
#   cmd /c start "" /b /wait /belownormal /affinity FFFF0000 pwsh -NoProfile -File dev\share\build-models.ps1 -Embed
# Uploading: -Upload runs rclone (the owner's own: the remote "r2" and its keys live in his rclone config, never in this
# repo; Wrangler takes 315 MB a file at most, the runtime and TAPNext++ files are 2.3-2.5 GB). Without -Upload the
# commands are printed. Big files first, manifest.json last and on its own (a manifest never names a file not there
# yet). docs/BUILDING.md, "Models and the runtime on R2".
# Never in the manifest: CoTracker3 (CC BY-NC 4.0, in no build: docs/guide/cotracker.md).
# paw-vdb3.2: the AMD runtime (-RuntimeRocm, made by dev/share/make-runtime-rocm.ps1) is the entry runtime-rocm; the app
# picks between the two runtimes (paw-vdb3.3). Its "hosted" is carried over from the compiled manifest (false until the
# owner uploads it; then set it true there; a new zip starts at false again).
# Without the zip on this machine the compiled manifest's entry is kept as it is.
#Requires -Version 7
param(
  [string]$Out = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Pawscript-models\v1'),
  [string]$Models = (Join-Path $PSScriptRoot '..\..\trackers'),
  [string]$Runtime = '',
  [string]$RuntimeRocm = (Join-Path $PSScriptRoot 'runtime\runtime-rocm-2026-11-19.zip'),
  [switch]$Embed,
  [switch]$Upload,
  [string]$Bucket = 'openvalence-downloads',   # OpenValence's R2 bucket (served as https://dl.openvalence.org/)
  [string]$RemoteName = 'r2'                   # the rclone remote in your own config
)
$ErrorActionPreference = 'Stop'
$Remote = "${RemoteName}:$Bucket" + '/pawscript/v1'
$Models = (Resolve-Path $Models).Path
if (-not $Runtime) {
  if ((Get-Content (Join-Path $PSScriptRoot 'build-nas.ps1') -Raw) -notmatch "\`$RuntimeArchive = '([^']+)'") { throw 'build-nas.ps1 has no $RuntimeArchive' }
  $Runtime = Join-Path $PSScriptRoot "runtime\$($Matches[1])"
}
$rtStamp = (& "$env:SystemRoot\System32\tar.exe" -xOf $Runtime runtime.stamp | Out-String).Trim()
if (-not $rtStamp) { throw "$Runtime has no runtime.stamp: not a Pawscript runtime zip" }
$apache = 'SAM2.1-weights-and-code-Apache-2.0.txt'
$tapLic = 'TAPNext++-weights-and-code-Apache-2.0.txt'
$samUrl = 'https://github.com/facebookresearch/sam2/blob/main/LICENSE'
$tapUrl = 'https://github.com/google-deepmind/tapnet/blob/main/LICENSE'
# id, title, what it is for, required, licence (+ its upstream page), notice (dev/share/LICENSES/models), VRAM (GB,
# about), files: paths under <Models>, which is also where they go in the models folder the app uses
$hydraCode = Get-ChildItem (Join-Path $Models '.models\hydra\hydra') -Filter *.py | Sort-Object Name | ForEach-Object { ".models/hydra/hydra/$($_.Name)" }
$table = @(
  @{ id = 'sam2.1-tiny'; title = 'SAM 2.1 tiny'; for = 'Finds the parts you point at (Groups, part finder)'; required = $true; licence = 'Apache-2.0'; licenceUrl = $samUrl; notice = $apache; vramGb = 1; files = @('.cache/sam2/sam2.1_hiera_tiny.pt') }
  @{ id = 'sam2.1-small'; title = 'SAM 2.1 small'; for = 'The mask tracker and the shaft, default size'; required = $true; licence = 'Apache-2.0'; licenceUrl = $samUrl; notice = $apache; vramGb = 2; files = @('.cache/sam2/sam2.1_hiera_small.pt') }
  @{ id = 'sam2.1-base_plus'; title = 'SAM 2.1 base+'; for = 'The mask tracker, a larger size you can pick'; required = $false; licence = 'Apache-2.0'; licenceUrl = $samUrl; notice = $apache; vramGb = 3; files = @('.cache/sam2/sam2.1_hiera_base_plus.pt') }
  @{ id = 'sam2.1-large'; title = 'SAM 2.1 large'; for = 'The mask tracker, the largest size you can pick'; required = $false; licence = 'Apache-2.0'; licenceUrl = $samUrl; notice = $apache; vramGb = 4; files = @('.cache/sam2/sam2.1_hiera_large.pt') }
  @{ id = 'tapnext-256'; title = 'TAPNext++ 256'; for = 'The point tracker (Track, T)'; required = $true; licence = 'Apache-2.0'; licenceUrl = $tapUrl; notice = $tapLic; vramGb = 4; files = @('.cache/tapnext/tapnextpp_ckpt.pt') }
  @{ id = 'tapnext-512'; title = 'TAPNext++ 512'; for = 'The point tracker for small parts (Auto picks it)'; required = $false; licence = 'Apache-2.0'; licenceUrl = $tapUrl; notice = $tapLic; vramGb = 9; files = @('.cache/tapnext/tapnextpp_512.ckpt') }
  @{ id = 'hydra-3.5'; title = 'Hydra 3.5 tagger'; for = 'Scene tags and part suggestions (Describe, Suggest)'; required = $false; licence = 'Apache-2.0 (model card)'; licenceUrl = 'https://huggingface.co/RedRocket/Hydra'; notice = 'Hydra-3.5-NOTE.txt'; vramGb = 3; files = @('.models/hydra/models/hydra-3.5.safetensors') + $hydraCode }
  # nobody hosts it (its DINOv3 base licence is unclear): the user gets the files from its page and brings them in
  @{ id = 'taggerine'; title = 'taggerine'; for = 'Extra features for the learned seeder (optional)'; required = $false; licence = 'Apache-2.0 card, DINOv3 License base'; licenceUrl = 'https://ai.meta.com/resources/models-and-libraries/dinov3-license/'; notice = 'taggerine-NOTE.txt'; vramGb = 4; source = 'manual'; downloadPage = 'https://huggingface.co/lodestones/taggerine'; files = @('.cache/taggerine/tagger_proto.safetensors', '.cache/taggerine/tagger_vocab.json') }
)
# the file's place in the bucket: its path without the leading .cache/ or .models/, its SHA-256's first 8 hex in the name
$urlOf = { param($p, $sha) $u = $p -replace '^\.(cache|models)/', ''; $ext = [IO.Path]::GetExtension($u); "$($u.Substring(0, $u.Length - $ext.Length))-$($sha.Substring(0, 8))$ext" }
New-Item -ItemType Directory -Force $Out | Out-Null
function Add-File([string]$from, [string]$rel, [string]$url) {
  if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { throw "missing $from (every file in the table must be on this machine)" }
  $len = (Get-Item -LiteralPath $from).Length
  Write-Host ("hashing {0} ({1:N0} bytes)" -f $rel, $len)
  $f = [ordered]@{ path = $rel; bytes = $len; sha256 = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash.ToLower() }
  if (-not $url) { return $f }   # a manual model: pinned, not uploaded
  $url = & $urlOf $url $f.sha256
  $to = Join-Path $Out $url
  New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
  if (-not ((Test-Path -LiteralPath $to) -and (Get-Item -LiteralPath $to).Length -eq $len)) {
    if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Force }
    try { New-Item -ItemType HardLink -Path $to -Target $from -ErrorAction Stop | Out-Null } catch { Copy-Item -LiteralPath $from $to }
  }
  $f.url = $url
  $f
}
$list = @(foreach ($m in $table) {
  $manual = $m.source -eq 'manual'
  $files = foreach ($rel in $m.files) { Add-File (Join-Path $Models $rel) $rel $(if ($manual) { '' } else { $rel }) }
  $e = [ordered]@{ id = $m.id; title = $m.title; for = $m.for; required = $m.required; licence = $m.licence; licenceUrl = $m.licenceUrl; notice = $m.notice; vramGb = $m.vramGb }
  if ($manual) { $e.source = 'manual'; $e.downloadPage = $m.downloadPage }
  $e.files = @($files)
  $e
})
# the runtime, by its stamp: one file (no 2 GB cap on R2), runtime.zip beside the exe
$rtName = Split-Path $Runtime -Leaf
$list += [ordered]@{ id = 'runtime'; kind = 'runtime'; title = 'Runtime (Python, PyTorch, ffmpeg)'; for = 'Runs the trackers and reads your videos'; required = $true
  licence = 'PSF / BSD / GPL-3.0 (ffmpeg) and more'; licenceUrl = 'https://github.com/openvalence/Pawscript/blob/main/dev/share/LICENSES-SUMMARY.txt'; notice = ''; version = $rtStamp
  files = @(Add-File $Runtime 'runtime.zip' "runtime/$rtName") }   # -> runtime/runtime-<date>-<sha8>.zip
# paw-vdb3.2: the AMD runtime, runtime-rocm.zip (python-rocm\ beside the CUDA runtime's python\, portable.rs ZIPS)
$compiled = Get-Content (Join-Path $PSScriptRoot '..\..\src\features\models\manifest.json') -Raw | ConvertFrom-Json
$wasRocm = $compiled.models | Where-Object { $_.id -eq 'runtime-rocm' }
if (Test-Path -LiteralPath $RuntimeRocm) {
  $rocmStamp = (& "$env:SystemRoot\System32\tar.exe" -xOf $RuntimeRocm runtime-rocm.stamp | Out-String).Trim()
  $pin = (Select-String -Path (Join-Path $PSScriptRoot '..\..\trackers\requirements-rocm.txt') -Pattern '^torch==(\S+)').Matches[0].Groups[1].Value
  if (($rocmStamp -split ' ') -notcontains "torch$pin") { throw "$RuntimeRocm (stamp '$rocmStamp') is not built from trackers/requirements-rocm.txt (torch $pin)" }
  $archs = (& "$env:SystemRoot\System32\tar.exe" -xOf $RuntimeRocm python-rocm/gpu-archs.json | Out-String | ConvertFrom-Json).archs
  $list += [ordered]@{ id = 'runtime-rocm'; kind = 'runtime'; hosted = [bool]($wasRocm -and $wasRocm.hosted -ne $false -and $wasRocm.version -eq $rocmStamp)
    gpu = 'amd'; archs = @($archs); title = 'Runtime for AMD (Python, PyTorch ROCm, ffmpeg)'; for = 'Runs the trackers on an AMD Radeon RX 9000 or RX 7000 card'
    required = $true; licence = 'PSF / BSD / Apache-2.0 / MIT (ROCm) / GPL-3.0 (ffmpeg) and more'
    licenceUrl = 'https://github.com/openvalence/Pawscript/blob/main/dev/share/LICENSES-SUMMARY.txt'; notice = ''; version = $rocmStamp
    files = @(Add-File $RuntimeRocm 'runtime-rocm.zip' "runtime/$(Split-Path $RuntimeRocm -Leaf)") }   # -> runtime/runtime-rocm-<date>-<sha8>.zip
} elseif ($wasRocm) { Write-Warning "no $RuntimeRocm here: runtime-rocm kept as the compiled manifest has it"; $list += $wasRocm }
$manifest = [ordered]@{ kind = 'pawscript.models/1'; version = 1; generated = (Get-Date -Format 'yyyy-MM-dd'); models = $list }
$json = ($manifest | ConvertTo-Json -Depth 8) + "`n"
Set-Content (Join-Path $Out 'manifest.json') $json -NoNewline
if ($Embed) { Set-Content (Join-Path $PSScriptRoot '..\..\src\features\models\manifest.json') $json -NoNewline }
$all = $list.files
Write-Host ("{0}: {1} entries, {2} files, {3:N2} GB{4}" -f $Out, $list.Count, $all.Count, (($all | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum / 1e9), $(if ($Embed) { '; src/features/models/manifest.json written' } else { '' }))
# the upload: big files first (by size), then manifest.json alone, short-cached; the bucket's two probe files go
$cmds = @(
  "rclone copy `"$Out`" $Remote/ --exclude manifest.json --order-by size,descending --s3-chunk-size 64M --transfers 4 --checksum --progress",
  "rclone copyto `"$(Join-Path $Out 'manifest.json')`" $Remote/manifest.json --header-upload `"Cache-Control: max-age=60`" --checksum",
  "rclone deletefile $Remote/_probe.bin",
  "rclone deletefile $Remote/_probe.json"
)
if (-not $Upload) { Write-Host "to upload (rclone, the remote in your own config):"; $cmds | ForEach-Object { Write-Host "  $_" }; return }
if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) { throw 'rclone is not on PATH (https://rclone.org/install/)' }
foreach ($c in $cmds) {
  Write-Host "> $c"
  cmd /c $c
  if ($LASTEXITCODE -and $c -notmatch '_probe') { throw "failed ($LASTEXITCODE): $c" }   # the probes may be gone already
}
Write-Host 'uploaded; check: curl.exe -I https://dl.openvalence.org/pawscript/v1/manifest.json'