# dev/share/publish-release.ps1 -- publishes a build-nas.ps1 -Online -Release build to the public update channel (paw-tlx6).
#
#   pwsh -File dev/share/publish-release.ps1 [-Out <the build's -Out>] [-Check]
#
# Reads <Out>-release\latest.json, the update zip and its .sig, and <Out>.zip (the small download), and creates the
# GitHub release v<version> on openvalence/Pawscript (the public source repo) with those four files,
# marked latest (not a pre-release) so releases/latest/download/latest.json serves it.
# Refuses when the version is not higher than the current latest release's, when latest.json's signature or URL does
# not match the files, or when the .sig is not bound to that version (tauri.conf.json requireSignedVersion).
# -Check: every check and the sha256s, nothing published. Needs gh, logged in with write access to the repo.
param(
  [string]$Out = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Pawscript-nas\Pawscript'),
  [switch]$Check
)
$ErrorActionPreference = 'Stop'
# Must match plugins.updater.endpoints in src-tauri/tauri.conf.json and the URL build-nas.ps1 writes.
$Repo = 'openvalence/Pawscript'

$rel = "$Out-release"
$manifest = Join-Path $rel 'latest.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw "no $manifest`: build first with build-nas.ps1 -Online -Release <x.y.z> -Out $Out" }
$latest = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$v = $latest.version
if ($v -notmatch '^\d+\.\d+\.\d+$') { throw "latest.json version '$v' is not x.y.z" }
$upd = Join-Path $rel "Pawscript-$v-update.zip"
$small = "$Out.zip"
$files = @($manifest, $upd, "$upd.sig", $small)
foreach ($f in $files) { if (-not (Test-Path -LiteralPath $f)) { throw "missing $f (build-nas.ps1 -Online -Release $v -Out $Out makes it)" } }

$entry = $latest.platforms.'windows-x86_64-portable'
$sig = (Get-Content -LiteralPath "$upd.sig" -Raw).Trim()
if ($entry.signature -ne $sig) { throw "latest.json's signature is not $upd.sig: rebuild, nothing was published" }
$want = "https://github.com/$Repo/releases/download/v$v/Pawscript-$v-update.zip"
if ($entry.url -ne $want) { throw "latest.json's URL is $($entry.url), not $want`: rebuild, nothing was published" }
$sigText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($sig))
if ($sigText -notmatch "(?m)^trusted comment: .*\bversion:$([regex]::Escape($v))(\s|$)") { throw "$upd.sig is not bound to version $v (the app would refuse it): rebuild, nothing was published" }

$current = & gh release view --repo $Repo --json tagName --jq .tagName 2>&1
if ($LASTEXITCODE) {
  if ("$current" -notmatch 'release not found') { throw "gh release view failed: $current" }
  $current = ''
}
if ($current -and [version]$v -le [version]($current -replace '^v', '')) { throw "version $v is not higher than the latest release $current`: nothing was published" }

Write-Host "release v$v on $Repo (latest now: $(if ($current) { $current } else { 'none' }))"
foreach ($f in $files) { Write-Host ("  {0}  {1}" -f (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower(), (Split-Path $f -Leaf)) }
if ($Check) { Write-Host 'checked: nothing published (-Check)'; return }

$notes = Join-Path $rel 'notes.txt'
Set-Content -LiteralPath $notes -Value $latest.notes
& gh release create "v$v" --repo $Repo --title "Pawscript $v" --notes-file $notes --latest @files
if ($LASTEXITCODE) { throw "gh release create failed ($LASTEXITCODE)" }
Write-Host "published: https://github.com/$Repo/releases/tag/v$v"
