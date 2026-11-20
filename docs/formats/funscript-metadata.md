# Funscript `metadata.pawscript`

Specification text: CC BY 4.0; implementing it needs no licence ([README](README.md)).

Pawscript writes ordinary funscripts (`{version, inverted, range, actions: [{at, pos}], metadata}`), readable by any
player. Into `metadata` it adds one block, `pawscript`, that says where the file came from; players ignore unknown
metadata keys. Every other key of a file it rewrites stays as it was (`creator`, `title`, `tags`, ... are never changed).

| key in `metadata` | what |
|---|---|
| `creator_software` | `"Pawscript"` |
| `creator_software_version` | the version that wrote the file |
| `chapters` | not written: a file's own chapters (`[{name, startTime, endTime, color?}]`, clock strings `HH:MM:SS.mmm`) are read on open and kept as they are |
| `bookmarks` | `[{name, time}]` (clock string), main axis file only; a bookmark the file had keeps its other keys |
| `pawscript` | the block below |

| key in `metadata.pawscript` | what |
|---|---|
| `app` | `"Pawscript"` (required: a block without it is not Pawscript's) |
| `version` | the version that wrote it |
| `written` | ISO 8601: when the actions last changed |
| `project` | optional: the `.pawproj`'s file name, no folder |
| `how` | optional: `{tracked?, imported?, modifiers?}`: `tracked` / `imported` the share (0..1, 3 decimals) of the points equal to a tracker run's / to the opened file's, `modifiers` the kinds of the live modifiers on top |
| `hash` | 8 lowercase hex digits (below) |
| `from` | optional: `{tool?, version?, creator?}`, what an imported script named as its tool / creator before |
| `publish` | optional, a published script: `{version, commit, date, build}`: `version` its number (1, 2, ...), `commit` the id of the project history entry that holds that state (a string), `date` ISO 8601, `build` the build's commit or `null` |

- `hash`: FNV-1a 32-bit over the text `"<at>:<pos>,"` of every action, in file order, as 8 lowercase hex digits. A file
  whose actions no longer match `hash` (or whose `creator_software` names another tool) was changed by another tool after
  Pawscript wrote it.
- Rewriting a file with the same actions and `project` keeps the block unchanged (a Publish always writes a new one).
- `chapters` / `bookmarks` follow the keys other editors write; chapter `color` is an extension older Pawscript builds
  wrote.
- File names: `clip.funscript` for the main (stroke) axis, `clip.<axis>.funscript` for the others. When a file Pawscript
  did not write already has that name, Pawscript either writes `clip.pawscript.funscript` /
  `clip.pawscript.<axis>.funscript` beside it or replaces it and keeps the old one as a `.bak` file beside it.

Example (a published script; its `hash` is that of these three actions):

```json
{
  "version": "1.0",
  "inverted": false,
  "range": 100,
  "actions": [{ "at": 0, "pos": 100 }, { "at": 500, "pos": 0 }, { "at": 1000, "pos": 100 }],
  "metadata": {
    "creator": "someone",
    "creator_software": "Pawscript",
    "creator_software_version": "1.0.0",
    "chapters": [{ "name": "Intro", "startTime": "00:00:00.000", "endTime": "00:00:01.000" }],
    "bookmarks": [{ "name": "here", "time": "00:00:00.500" }],
    "pawscript": {
      "app": "Pawscript",
      "version": "1.0.0",
      "written": "2026-11-17T20:00:00.000Z",
      "project": "clip.pawproj",
      "how": { "tracked": 0.667, "modifiers": ["throbbing"] },
      "hash": "9b311453",
      "publish": { "version": 2, "commit": "1794945600000", "date": "2026-11-17T20:00:00.000Z", "build": "d923e88" }
    }
  }
}
```

Reference implementation: `src/lib/provenance.js`, `src/lib/io/funscript.js` (GPL-3.0-or-later). Conformance:
`test/format-specs.test.mjs`.
