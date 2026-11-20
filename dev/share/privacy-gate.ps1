# dev/share/privacy-gate.ps1 -- the one privacy gate of export-source.ps1 and build-nas.ps1 (paw-jw3o, paw-3l6g). Dot-source it.
#
#   $markers = Get-PrivacyMarkers $repo          # ordered name -> regex; $null when the private list is absent
#   $hits = Find-PrivacyHits $markers $root [-Label code.zip] [-Files <full paths under $root>]   (default: all of $root)
#   $words = Find-RareWords $root -Files ... -Reviewed <file>   # a REVIEW list for a human, never a failure
#   $refs = Find-BrokenRefs $root -Files ... -Roots ...          # shipped docs naming files the folder does not have
#
# The markers live in dev/share/privacy-markers.json (private: public-allow.txt keeps it out of the public tree; the
# JS test test/release-paperwork.test.mjs reads the same file), plus at run time the repo's git user.email and this
# PC's name. A marker's optional "allow" regex names matches that do not count (documented examples, hash constants).
# Every file is read as Latin-1 (all markers are ASCII, so binaries such as the exe are scanned too), and every path.
# A hit is "<label/rel path>:<line>: <marker name>", never the matched text.
$PrivacyMarkersFile = Join-Path $PSScriptRoot 'privacy-markers.json'
$PrivacyAllow = @{}

function Get-PrivacyMarkers([string]$Repo) {
  if (-not (Test-Path -LiteralPath $PrivacyMarkersFile)) { return $null }
  $m = [ordered]@{}
  foreach ($x in (Get-Content -LiteralPath $PrivacyMarkersFile -Raw | ConvertFrom-Json).markers) {
    $m[$x.name] = [regex]::new(($x.rx -join '|'), $(if ($x.flags -match 'i') { 'IgnoreCase' } else { 'None' }))
    if ($x.allow) { $PrivacyAllow[$x.name] = [regex]::new($x.allow, 'IgnoreCase') }
  }
  $owner = (git -C $Repo config user.email 2>$null) -as [string]
  if ($owner -match '^([^@]+)@') { $m['owner email'] = [regex]::new([regex]::Escape($owner) + '|\b' + [regex]::Escape($Matches[1]) + '\b', 'IgnoreCase') }
  if ($env:COMPUTERNAME) { $m['machine name (this PC)'] = [regex]::new('\b' + [regex]::Escape($env:COMPUTERNAME) + '\b', 'IgnoreCase') }
  $m
}

function Find-PrivacyHits($Markers, [string]$Root, [string]$Label = '', [string[]]$Files = @()) {
  $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (-not $Files) { $Files = @((Get-ChildItem -LiteralPath $Root -Recurse -File -Force).FullName) }
  $latin1 = [Text.Encoding]::Latin1
  $hits = [Collections.Generic.List[string]]::new()
  foreach ($f in $Files) {
    $rel = [IO.Path]::GetRelativePath($Root, $f) -replace '\\', '/'
    if ($Label) { $rel = "$Label/$rel" }
    $s = $latin1.GetString([IO.File]::ReadAllBytes($f))
    foreach ($k in $Markers.Keys) {
      $allow = $PrivacyAllow[$k]
      foreach ($m in $Markers[$k].Matches($rel)) { if (-not ($allow -and $allow.IsMatch($m.Value))) { $hits.Add("$rel (file name): $k"); break } }
      $line = 1; $at = 0   # matches come in order: count the lines between them only
      foreach ($m in $Markers[$k].Matches($s)) {
        if ($allow -and $allow.IsMatch($m.Value)) { continue }
        for ($i = $s.IndexOf([char]10, $at); $i -ge 0 -and $i -lt $m.Index; $i = $s.IndexOf([char]10, $i + 1)) { $line++; $at = $i + 1 }
        $hits.Add("${rel}:${line}: $k")
      }
    }
  }
  , $hits
}

# Capitalised words that never appear in lower case anywhere in the files (so: not code, not ordinary words) and at
# most twice: the shape of a name nobody listed (a clip title, an artist, a character). Words in $Reviewed (one per
# line, accepted by a human with export-source.ps1 -Accept) are left out. Returns "word<TAB>first file:line".
# ponytail: a frequency heuristic, not a dictionary; it over-reports and the reviewed list absorbs that once.
function Find-RareWords([string]$Root, [string[]]$Files, [string]$Reviewed) {
  $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  if (Test-Path -LiteralPath $Reviewed) { foreach ($l in Get-Content -LiteralPath $Reviewed) { if ($l -and -not $l.StartsWith('#')) { [void]$seen.Add($l.Trim()) } } }
  $cap = [Collections.Generic.Dictionary[string, Collections.Generic.List[string]]]::new([StringComparer]::Ordinal)
  $low = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $tok = [regex]'\b[A-Za-z][a-z]{2,}(?:[A-Z][a-z]+)*\b'
  foreach ($f in $Files) {
    if ($f -notmatch '\.(?:md|txt|js|mjs|py|rs|svelte|json|ps1|html|css|toml|sh)$' -or $f -match '(?:package-lock\.json|Cargo\.lock|uv\.lock|LICENSE[^\\/]*)$') { continue }
    $rel = [IO.Path]::GetRelativePath($Root, $f) -replace '\\', '/'
    $n = 0
    foreach ($line in [IO.File]::ReadLines($f)) {
      $n++
      foreach ($m in $tok.Matches($line)) {
        $w = $m.Value
        if ([char]::IsUpper($w[0])) { if (-not $cap.ContainsKey($w)) { $cap[$w] = [Collections.Generic.List[string]]::new() }; $cap[$w].Add("${rel}:$n") }
        else { [void]$low.Add($w.ToLowerInvariant()) }
      }
    }
  }
  $(foreach ($kv in $cap.GetEnumerator()) {
    $w = $kv.Key
    if ($kv.Value.Count -le 2 -and -not $low.Contains($w.ToLowerInvariant()) -and -not $seen.Contains($w)) { "$w`t$($kv.Value[0])" }
  }) | Sort-Object -CaseSensitive
}

# public-allow.txt's lines (export-source.ps1's rules: -like patterns, `!` takes out, `?` may match nothing, the last
# matching line decides); Test-PublicPath says whether a repo path is in the public source.
function Get-PublicRules([string]$AllowFile) {
  foreach ($l in Get-Content -LiteralPath $AllowFile) {
    $t = $l.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $opt = $t.StartsWith('?'); if ($opt) { $t = $t.Substring(1) }
    $neg = $t.StartsWith('!'); if ($neg) { $t = $t.Substring(1) }
    [pscustomobject]@{ pattern = $t; neg = $neg; optional = $opt; used = 0 }
  }
}
function Test-PublicPath($Rules, [string]$Path) {
  $keep = $false
  foreach ($r in $Rules) { if ($Path -like $r.pattern) { $keep = -not $r.neg; $r.used++ } }
  $keep
}

# Shipped docs (paw-7hac): a Markdown link or a `dir/file.ext` path that names nothing in the folder as shipped
# ($Roots: the folder, code.zip's files) nor in the public source ($Public: a repo path -> exists and is public).
# Returns "file:line: reference".
function Find-BrokenRefs([string]$Root, [string[]]$Files, [string[]]$Roots, [scriptblock]$Public) {
  $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $md = [regex]'\]\(([^)\s#]+)(?:#[^)]*)?\)'
  $tick = [regex]'`((?:[\w.-]+[\\/])+[\w.-]+\.(?:md|txt|js|mjs|py|rs|json|ps1|toml|html))`'
  foreach ($f in $Files) {
    $rel = [IO.Path]::GetRelativePath($Root, $f) -replace '\\', '/'
    $dir = Split-Path $f; $n = 0
    foreach ($line in [IO.File]::ReadLines($f)) {
      $n++
      foreach ($m in $md.Matches($line)) {
        $t = $m.Groups[1].Value
        if ($t -match '^[a-z][a-z0-9+.-]*:' -or (Test-Path -LiteralPath (Join-Path $dir $t))) { continue }
        "${rel}:${n}: link $t"
      }
      foreach ($m in $tick.Matches($line)) {
        $t = $m.Groups[1].Value
        if (Test-Path -LiteralPath (Join-Path $dir $t)) { continue }
        if (-not ($Roots | Where-Object { Test-Path -LiteralPath (Join-Path $_ $t) }) -and -not ($Public -and (& $Public ($t -replace '\\', '/')))) { "${rel}:${n}: path $t" }
      }
    }
  }
}
