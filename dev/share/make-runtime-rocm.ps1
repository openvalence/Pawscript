# dev/share/make-runtime-rocm.ps1 -- the AMD runtime archive, runtime-rocm-<date>.zip (paw-vdb3.2): the same shape as the
# CUDA runtime (dev/share/runtime/runtime-2026-11-18.txt) with AMD's ROCm-on-Windows PyTorch instead of the CUDA build,
# laid out to unpack BESIDE it (paw-vdb3.3, src-tauri/src/portable.rs ZIPS): python-rocm\ + ffmpeg.exe + ffprobe.exe (the
# same files as the CUDA zip's) + runtime-rocm.stamp. The app downloads it as runtime-rocm.zip. Its record:
# dev/share/runtime/runtime-rocm-<date>.txt.
#
#   pwsh -NoProfile -File dev/share/make-runtime-rocm.ps1 -Python <python-build-standalone 3.12 folder> -Ffmpeg <folder>
#        [-Out <zip>] [-Work <scratch>] [-Date yyyy-MM-dd]
#   pwsh -NoProfile -File dev/share/make-runtime-rocm.ps1 -Compile     re-pins trackers/requirements-rocm.txt from .in
#
# Needs uv and the network (PyPI, AMD's index, GitHub for sam2 / tapnet); best run on the AMD PC, which can test it.
# Packages: trackers/requirements-rocm.txt (no dependency resolution at install: every package is pinned there), then
# sam-2 and tapnet from the git revisions in trackers/pyproject.toml, without their declared dependencies.
# python-rocm\gpu-archs.json (sys.prefix of the unpacked runtime) lists the GPU architectures whose device libraries it
# ships, from the installed amd-torch-device-gfx* packages; pawtrack/gpu.py reads it (paw-vdb3.1).
# Windows PowerShell 5.1 runs it too (the AMD PC has no pwsh): powershell -NoProfile -ExecutionPolicy Bypass -File ...
param(
  [string]$Python = '',
  [string]$Ffmpeg = '',
  [string]$Out = '',
  [string]$Work = (Join-Path $env:TEMP 'pawscript-runtime-rocm'),
  [string]$Date = (Get-Date -Format 'yyyy-MM-dd'),
  [switch]$Compile
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$trk = Join-Path $repo 'trackers'
$index = @('--index-url', 'https://pypi.org/simple', '--extra-index-url', 'https://stable.repo.amd.com/rocm/whl-next/', '--index-strategy', 'unsafe-best-match')
function Native { & $args[0] @($args | Select-Object -Skip 1); if ($LASTEXITCODE) { throw "failed ($LASTEXITCODE): $args" } }

if ($Compile) {
  Push-Location $trk
  try {
    Native uv pip compile requirements-rocm.in -o requirements-rocm.txt --python-version 3.12 --python-platform x86_64-pc-windows-msvc `
      @index --emit-index-url --custom-compile-command 'pwsh -NoProfile -File dev/share/make-runtime-rocm.ps1 -Compile'
  } finally { Pop-Location }
  return
}
if (-not (Test-Path (Join-Path $Python 'python.exe'))) { throw "-Python must be a python-build-standalone 3.12 folder (python.exe in it)" }
foreach ($x in 'ffmpeg.exe', 'ffprobe.exe') { if (-not (Test-Path (Join-Path $Ffmpeg $x))) { throw "-Ffmpeg has no $x" } }
if (-not $Out) { $Out = Join-Path $PSScriptRoot "runtime\runtime-rocm-$Date.zip" }

$build = Join-Path $Work 'build'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force $build | Out-Null
Copy-Item $Python (Join-Path $build 'python-rocm') -Recurse
$py = Join-Path $build 'python-rocm\python.exe'
Native uv pip install -p $py --break-system-packages --no-deps -r (Join-Path $trk 'requirements-rocm.txt') @index
$toml = Get-Content (Join-Path $trk 'pyproject.toml') -Raw
$git = foreach ($n in 'sam-2', 'tapnet') {
  if ($toml -notmatch "(?m)^$n = \{ git = `"([^`"]+)`", rev = `"([0-9a-f]+)`" \}") { throw "pyproject.toml has no git source for $n" }
  "$n @ git+$($Matches[1])@$($Matches[2])"
}
$env:SAM2_BUILD_CUDA = '0'   # sam2's optional CUDA op is unused (as in pyproject.toml)
Native uv pip install -p $py --break-system-packages --no-deps @git

# <folder>\trackers on sys.path (pawtrack and the shared build's sitecustomize.py), as in the CUDA runtime
Set-Content (Join-Path $build 'python-rocm\Lib\site-packages\pawtrack.pth') '../../../trackers'
# no double quotes in the Python: Windows PowerShell drops them from a native argument
$info = & $py -I -c @'
import importlib.metadata as md, json, re, sys, torch
archs = sorted({m.group(1) for d in md.distributions() if (m := re.fullmatch(r'amd[-_]torch[-_]device[-_](gfx[0-9a-f]+)', d.metadata['Name'] or '', re.I))})
json.dump({'backend': 'rocm', 'torch': torch.__version__, 'hip': torch.version.hip, 'archs': archs}, open(sys.prefix + '/gpu-archs.json', 'w'), indent=1)
print('python' + sys.version.split()[0], 'torch' + torch.__version__, 'archs=' + ','.join(archs))
'@
if ($LASTEXITCODE) { throw 'the runtime does not import torch' }
$info = @($info)[-1]
Write-Host $info
Copy-Item (Join-Path $Ffmpeg 'ffmpeg.exe'), (Join-Path $Ffmpeg 'ffprobe.exe') $build
$ff = ((& (Join-Path $build 'ffmpeg.exe') -hide_banner -version | Select-Object -First 1) -split ' ')[2] -replace '-.*$', ''
$py3, $torch = ($info -split ' ')[0, 1]
Set-Content (Join-Path $build 'runtime-rocm.stamp') "runtime-rocm $Date $py3 $torch ffmpeg$ff"
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
Native "$env:SystemRoot\System32\tar.exe" --format zip -c -f "$Out.part" -C $build python-rocm ffmpeg.exe ffprobe.exe runtime-rocm.stamp
Move-Item "$Out.part" $Out -Force
$z = Get-Item $Out
Write-Host ("{0}: {1} bytes, sha256 {2}; stamp '{3}'" -f $z.FullName, $z.Length, (Get-FileHash $Out -Algorithm SHA256).Hash.ToLower(), (Get-Content (Join-Path $build 'runtime-rocm.stamp')))
