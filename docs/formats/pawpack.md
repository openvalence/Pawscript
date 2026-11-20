# .pawpack (paw-2k9s)

Specification text: CC BY 4.0; implementing it needs no licence ([README](README.md)).

File › Pack project writes one `.pawpack`: everything a friend needs to watch, play and keep working on a script.
File › Open (or a drop, or the project page) takes it back: unpacked into a folder named after it beside it (or a folder
you pick when that place is read-only), every file's SHA-256 checked, then its project opens.

## Container

A plain ZIP (ZIP64 records always), every entry STORED (no compression: video does not compress, and stored entries stay
fast and seekable), names UTF-8, all at the root. Any zip tool unpacks it. Written by the shell (`src-tauri/src/pack.rs`)
in one streaming pass into a temp file beside the destination: cancel or failure leaves nothing.

| entry | role | what |
|---|---|---|
| `pawpack.json` | manifest | always the FIRST entry (offset 0) |
| `<video name>` | video | the original file, byte for byte (never a proxy or a re-encode) |
| `<stem>.funscript`, `<stem>.<axis>.funscript` | script | the PUBLISHED version as it is beside the video (`metadata.pawscript.publish`); a project never published: every axis as Export writes it, with `metadata.pawscript` provenance |
| `<stem>.pawproj` | project | as Save writes it ([pawproj.md](pawproj.md)), plus the `view` and `playheadMs` of the moment; `media.path` / `relativePath` = the video's entry name, no `proxyOf` |
| `<stem>.pawruns` | runs | the current tracker runs, saved or not, always [version 1](pawruns.md) (encoded whole, whatever version the project's own file is); only when there are runs |

`<stem>` is the video's name without its extension (without a video: the project's).

Manifest: UTF-8 JSON.

| key | what |
|---|---|
| `format` | `"pawpack"` (required) |
| `version` | `"MAJOR.MINOR"` string, now `"1.0"` (required). A reader refuses a newer major (`2.x`) with "update Pawscript"; a minor bump only adds keys |
| `created` | ISO 8601 time of writing |
| `app` | `{"name": "Pawscript", "version", "commit" (the build's commit or `null`)}` |
| `video` | `{"name" (its entry name), "durationMs", "fps", "width", "height", "size"}` (each `null` when unknown), or `null` (no video) |
| `project` | the project entry's name |
| `published` | optional: `{"version", "date" (ISO or `null`)}`: the scripts in the pack are that published version; absent: never published, the scripts are the current work |
| `files` | `[{"name", "role", "size", "sha256"}]` for every entry but the manifest (required, not empty); `role` is `video`, `script`, `project` or `runs`; `sha256` 64 hex digits |

A reader refuses a manifest without the format, with a version that is not a number or a newer major, without files,
with a file name that is not a plain relative name (no `..`, no drive, no leading `/`, nothing Windows refuses) or
without a checksum. Opening unpacks every entry, checks its SHA-256, then opens the `project` entry (without one: the
video and the scripts).

Example (written by Pawscript; `files` is completed by the shell):

```json
{
  "format": "pawpack",
  "version": "1.0",
  "created": "2026-11-18T12:00:00.000Z",
  "app": { "name": "Pawscript", "version": "1.0.0", "commit": null },
  "video": { "name": "clip.mp4", "durationMs": 600000, "fps": 30, "width": 1920, "height": 1080, "size": 104857600 },
  "project": "clip.pawproj",
  "published": { "version": 2, "date": "2026-11-17T20:00:00.000Z" },
  "files": [
    { "name": "clip.mp4", "role": "video", "size": 104857600, "sha256": "0000000000000000000000000000000000000000000000000000000000000000" },
    { "name": "clip.funscript", "role": "script", "size": 4096, "sha256": "1111111111111111111111111111111111111111111111111111111111111111" },
    { "name": "clip.pawproj", "role": "project", "size": 20480, "sha256": "2222222222222222222222222222222222222222222222222222222222222222" },
    { "name": "clip.pawruns", "role": "runs", "size": 1048576, "sha256": "3333333333333333333333333333333333333333333333333333333333333333" }
  ]
}
```

## Never in a pack

Caches (scrub cache, proxies, filmstrip, waveform, scan results), autosaves, backups, checkpoint history, usage logs,
settings, absolute paths, the user's folder, the computer's name. Every absolute path in the project, the scripts and the
runs' manifest becomes relative to the project / video folder, else just its file name (`app/pack.js scrubPaths`); the
written text is then scanned (`privacyIssues`: drive / UNC paths, `Users\<name>`; the shell: the computer's name) and
the pack is refused, nothing written, when anything is left.

## Later: the script inside the video

The same manifest and scripts can ride inside the video container instead of beside it: in Matroska as attachments
(`ffmpeg -i in.mp4 -c copy -attach pawpack.json -metadata:s:t mimetype=application/json -attach clip.funscript ... out.mkv`,
the bundled ffmpeg can write it with no re-encode), the manifest's `files` naming the attachments and `role: "video"`
meaning "this container". A reader would take the attachments as it takes the zip entries.
