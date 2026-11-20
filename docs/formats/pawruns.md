# .pawruns

Specification text: CC BY 4.0; implementing it needs no licence ([README](README.md)).

Every tracker run of a project, in one binary file beside the `.pawproj` with the same stem. It can be large (about
120 MB for a long video with point trackers). There are two versions: a project's own file is version 2 (copy-on-write)
when Pawscript's shell has the commands for it, else version 1; a pack (`.pawpack`) always carries version 1. Every
integer in either version is little-endian.

## Version 1

| bytes | what |
|---|---|
| 8 | ASCII `PAWRUNS1` |
| 4 | u32: manifest length in bytes |
| n | manifest: UTF-8 JSON `{"format": "pawruns", "version": 1, "runs": [run, ...]}` |
| ... | blob: the runs' frame sections, each at `run.frames.off` bytes from the blob start (the byte after the manifest) |

A reader refuses a file without the `PAWRUNS1` head, whose manifest is cut short or not JSON, whose `format` is not
`"pawruns"`, whose `version` is above 2 ("newer than this app reads"), or without a `runs` array. In version 1 one bad run
(below) refuses the whole file.

### A run

A JSON object, every key optional except these three:

| key | required | what |
|---|---|---|
| `id` | yes | string, unique in the file (`"run1"`, ...) |
| `range` | yes | object: the tracked span, `{"start": ms, "end": ms}` |
| `points` | yes | the script points the run produced: `[[at, pos], ...]` (at in ms, pos 0..100) |
| `points0` | no | the points before any edit: `[[at, pos], ...]`, or `"="` (or absent): the same as `points` |
| `points0Primary` | no | `[[at, pos], ...]`, or `"="`: the same as `points0` |
| `samples` | no | the primary signal: `[[t, v \| null], ...]` (t in ms); absent: none |
| `confidence` | no | the same pairs, or `null` |
| `channels` | no | `{name: {"pairs": [[t, v \| null], ...], "min": number, "max": number}}`; a reader works `min` / `max` out again from the pairs |
| `frames` | no | where the run's per-frame data is (below); absent or `null`: none |
| `masksOmitted` | no | how many frames had mask outlines that were not stored |

Signal values are written with 7 significant digits. Every other key (`n`, `tracker`, `name`, `params`, `roi`, `color`,
`visible`, `ref`, `channel`, `scenes`, `flips`, `events`, `notes`, `orient`, `cameraMotion`, `lowMotion`,
`sceneChannels`, `tag`, `mod`, ...) is plain JSON and kept as it is; a reader keeps keys it does not know. A reader fills
these when absent: `scenes`, `flips`, `events`, `notes` = `[]`, `channel` = `"primary"`, `visible` = `true`, `ref` =
`false`.

`frames` (version 1):

| key | required | what |
|---|---|---|
| `off` | yes | integer: the frame section's start, bytes from the blob start |
| `len` | yes | integer: its length in bytes |
| `n` | yes | integer >= 0: how many frames it holds |
| `ovx` | no | the frames' other overlay keys: `[[frameIndex, {key: value, ...}], ...]` |
| `ext` | no | `{"off", "len"}` (from the blob start): the part / pinned id section (below) |

A section that does not lie inside the file, or a missing / non-integer `n`, refuses the file.

### Frame section

`n` frames, written in increasing time, each:

| type | what |
|---|---|
| u32 | t (ms) |
| f32 | value (NaN = none) |
| u16 | k: points in this frame's overlay; `0xFFFF` = no overlay, `0xFFFE` = an overlay without points |
| k x 6 bytes | per point: i16 x, i16 y (round(x * 10000), round(y * 10000): 0..10000 across the frame's width / height, clamped to the i16 range), i8 visible (1 / 0), i8 label (-128 = none) |

- The section holds exactly its `n` frames: bytes missing or left over refuse the file.
- A frame's overlay is its points (as `pts: [[x, y, visible, label?], ...]`, x / y 0..1) plus its `ovx` keys. An overlay
  with more than 65533 points keeps them as JSON in `ovx` (`pts`), with k = `0xFFFE`.
- A frame with points and no `ovx` entry also has `points` (the visible points, `[x, y]`) and `boxes` (each hidden point
  as `[x - 0.006, y - 0.006, 0.012, 0.012]`, 4 decimals): the point trackers' overlay, worked out rather than stored.
- A reader sorts frames that are not in increasing time (of equal times the last one stays).

Optional part / pinned id section at `frames.ext`: for every point of every frame that has points, in the same order,
i8 part, i8 pinned group id (0 = none). Its length is exactly 2 bytes per point (else the file is refused). Readers that
do not know `ext` ignore it.

### Example

The manifest of a file with one run whose frame section is 32 bytes: frame 0 at 0 ms, value 0.5, two points (x 0.25,
y 0.5, visible, no label; x 0.75, y 0.5, hidden, label 3); frame 1 at 33 ms, no value, no overlay. The section, in hex:
`000000000000003f0200c409881301804c1d88130003210000000000c07fffff`.

```json
{
  "format": "pawruns",
  "version": 1,
  "runs": [
    {
      "id": "run1",
      "range": { "start": 0, "end": 1000 },
      "points": [[0, 100], [500, 0]],
      "samples": [[0, 0.5], [33, null]],
      "frames": { "off": 0, "len": 32, "n": 2 }
    }
  ]
}
```

## Version 2: copy-on-write

The project's own runs file as an append-only log: a change never rewrites what is already there, so a crash, a forced
close or a power cut leaves the last complete version.

| bytes | what |
|---|---|
| 8 | ASCII `PAWRUNS1` |
| 4 | u32: length of the head JSON |
| n | UTF-8 `{"format":"pawruns","version":2}` (a version-1 reader refuses the file: "version 2 is newer than this app reads") |
| ... | blocks and commits, appended |

- A **block** is written once and never changed. Its name is the first 16 bytes of its SHA-256, as 32 lowercase hex
  digits. Blocks are: a run's frame section and its part / pinned id section (exactly as in version 1), and a run's
  **record**: the version-1 run object as UTF-8 JSON, except `frames` = `{"sec": name, "n": frames, "ovx"?, "ext"?: name}`,
  where `sec` (required) and `ext` (optional) name blocks instead of giving offsets, and `n` is required.
- A **commit** is a UTF-8 JSON manifest `{"v": 2, "blocks": {name: [offset, length] | [offset, length, deps]}, "runs":
  [record name, ...]}` followed by a 16-byte trailer: ASCII `PAWRTAIL`, u32 manifest length, u32 CRC-32 (IEEE, as zip)
  of the manifest bytes. Offsets are from the file start. A record's entry carries `deps`: the names of its sections.
  Every commit is whole: it names every block the version uses (the runs' records and sections, and the records history
  entries keep), not only the new ones. `runs` lists the open runs' records in order.
- **Reading**: the newest trailer (searched from the end) whose manifest length fits after the head and whose CRC checks
  out is the file. Bytes after it (a write cut short) are ignored. A block entry that does not lie between the head and
  that commit is ignored. A run whose record is missing or unreadable is left out and said; a run whose frame block is
  missing or damaged opens without its frames; the other runs open as usual. After opening, each block is checked
  against its name: a record that does not match is said, frames that do not match are dropped.
- **Writing**: new blocks are appended and flushed to disk, then the commit is appended and flushed. Blocks no commit
  names (old records, discarded runs that no history entry keeps) stay as dead bytes until the file is written whole
  again (compaction): when the file's size minus the bytes of the blocks the new commit names is at least
  max(32 MiB, half those bytes), and on File › Clean project. A whole write builds a new file (head, the named blocks,
  one commit) beside the old one and replaces it by an atomic rename; a kept history record whose sections did not make
  it is left out. A version-1 project file is written whole as version 2 the first time it is written (the old file goes to the
  rolling backups).
- A project's history entries (`<stem>.pawhistory/index.json`, `runRefs: {run id: record name}`) name the records they
  had: the file keeps those records and their sections while an entry names them.

### Example

The version-1 example as version 2: the head (44 bytes), the frame section above at offset 44 (32 bytes), the record
at offset 76 (129 bytes, written without spaces), then the commit and its trailer.

The record:

```json
{"id":"run1","range":{"start":0,"end":1000},"points":[[0,100],[500,0]],"frames":{"sec":"bf00e7c0f5c52379f90b1ef9c15f092d","n":2}}
```

The commit:

```json
{"v":2,"blocks":{"bf00e7c0f5c52379f90b1ef9c15f092d":[44,32],"455adc506a0597865add619768c1789e":[76,129,["bf00e7c0f5c52379f90b1ef9c15f092d"]]},"runs":["455adc506a0597865add619768c1789e"]}
```

Reference implementation: `src/lib/runs-file.js`, `src/lib/runs-cow.js`, `src-tauri/src/cow.rs` (GPL-3.0-or-later).
Conformance: `test/format-specs.test.mjs` builds both examples from this text and opens them.
