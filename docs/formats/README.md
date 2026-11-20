# Pawscript file formats

The files Pawscript reads and writes, described so that anyone can read and write them too.

| File | What | Spec |
|---|---|---|
| `.pawproj` | a project: scripts of every axis, chapters, bookmarks, loops, plan, view (JSON) | [pawproj.md](pawproj.md) |
| `.pawruns` | the tracker runs of a project: signals, channels, tracked points (binary + JSON manifest) | [pawruns.md](pawruns.md) |
| `.pawpack` | one file to share a project: video, scripts, project and runs (ZIP) | [pawpack.md](pawpack.md) |
| `.funscript` `metadata.pawscript` | where a funscript came from: the block Pawscript adds to the standard funscript `metadata` | [funscript-metadata.md](funscript-metadata.md) |

Not public formats (they may change without notice): the `<name>.pawhistory\` folder beside a project (undo history and
checkpoints, see [pawproj.md](pawproj.md)), the app's settings and caches, and the tracker sidecar's wire protocol
(`trackers/PROTOCOL.md`).

## Licence and use

- **The specifications** (the text of the files in this folder) are licensed under the
  [Creative Commons Attribution 4.0 International licence (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/),
  Copyright 2026 AtlanticTM, published by OpenValence. Copy, adapt and republish them; name the source.
- **Implementing the formats needs no licence from this project.** Anyone may write software that reads or writes
  these files, open or closed, free or commercial, without asking and without paying. Pawscript's own code is GPL
  (`LICENSE`); an implementation written from these specifications is not based on that code and is not bound by the
  GPL.
- **Files are their author's.** A project, script or pack belongs to whoever made it, whatever program made it.

Versions: `.pawproj` and `.pawruns` carry an integer `version`, `.pawpack` a `MAJOR.MINOR` one. Pawscript refuses a
file whose (major) version is newer than it knows, with a message to update; within a version, new optional keys may
appear, and a reader that rewrites a file keeps the keys it does not know.
