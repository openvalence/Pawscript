# Pawscript — design outline

*Working title. A free, open-source funscript editor and semi-automatic scripter built
for furry content: 2D animation, 3D renders, short loops, non-human anatomy.*

This is an outline of **flow, logic and UI**. The tracking/AI side is kept to a plug-in
slot on purpose; the editor has to be good on its own first.

---

## 1. Goals and non-goals

**Goals**
- A fast, keyboard-driven editor for `.funscript` files that feels good for manual work.
- Semi-automatic help that works on **any body shape**: you point at what moves, it
  follows it. No assumption that the subject is human.
- First-class support for **looping animations**: script one cycle, tile it.
- Live preview on real devices through an open protocol.
- **Offline, private, no accounts.** No telemetry, no update pings unless the user
  turns them on, no licence server. Everything is in the source for anyone to check.

**Non-goals (for now)**
- Selling anything, licence keys, paid tiers.
- One-click "generate the whole video" as the headline feature.
- Cloud processing.

---

## 2. Licensing and clean-room rules

- **Licence:** GPL-3.0 if you want every fork to stay open; MIT or Apache-2.0 if you
  want anyone, including closed apps, to reuse parts. For a "nobody should be able to
  close this" project, GPL-3.0 fits.
- **Clean room.** Build from public specs and your own design. Do not copy code, UI
  text, file layouts or assets from FunGen or any other closed tool, and do not work
  from decompiled binaries or extracted strings. Keep a short `PROVENANCE.md` saying
  where each idea and dependency came from; it costs nothing and ends arguments.
- **Borrowing from open projects is fine, on their terms.** OpenFunscripter (OFS) is
  GPL-3.0: reading it is fine, copying code means your project must be GPL-compatible.
- **Models (later):** check every model's licence before shipping it. Ultralytics YOLO
  is AGPL-3.0; permissive options exist (for example Apache-2.0 detectors such as YOLOX,
  RT-DETR's original repo, or D-FINE). List each model and its licence in
  `THIRD-PARTY.md`.

---

## 3. The funscript format (what you read and write)

A funscript is JSON:

```json
{
  "version": "1.0",
  "inverted": false,
  "range": 100,
  "actions": [
    { "at": 1200, "pos": 10 },
    { "at": 1550, "pos": 90 }
  ]
}
```

- `at` is milliseconds from the start of the video; `pos` is 0–100.
- `actions` must be sorted by `at`, with no duplicate timestamps.
- **Multi-axis** follows the common convention of sibling files:
  `video.funscript` (stroke), `video.roll.funscript`, `video.pitch.funscript`,
  `video.twist.funscript`, `video.surge.funscript`, `video.sway.funscript`, etc.
- Extra fields (metadata, chapters) are tolerated by most players; keep them under a
  `metadata` key and never drop unknown keys when re-saving someone else's file.

---

## 4. Architecture

```
┌──────────────── UI (Qt) ────────────────┐
│ Video pane │ Timeline │ Lanes │ Inspector│
└───────┬───────────┬──────────┬──────────┘
        │ commands  │ events   │
┌───────▼───────────▼──────────▼──────────┐
│ Core: Project, Script model, Undo stack  │  pure logic, no UI, fully unit-tested
├──────────────────────────────────────────┤
│ Media: playback + frame access (mpv)     │
│ Tracking: plug-in API (§9)               │
│ Devices: Buttplug / Intiface client      │
│ Storage: project files, autosave         │
└──────────────────────────────────────────┘
```

**Suggested stack** (fast to build, easy for others to contribute to):
- Python 3.12 + **PySide6** (Qt) for the UI.
- **libmpv** (via `python-mpv`) for playback; it handles odd codecs, variable frame
  rate and frame-accurate seeking.
- **NumPy** / **OpenCV** for frames and simple tracking.
- **buttplug-py** talking to **Intiface Central** for devices (covers The Handy, OSR,
  and many others through one open protocol).

Alternative if you want a single fast native binary later: Rust + egui + libmpv. Keep
the **core** as a separate module with no UI imports either way, so it can be ported or
used from the command line.

---

## 5. Data model

```
Project
├── media: path, duration_ms, fps (nominal), is_vfr, sha256 (to re-link moved files)
├── axes: { "stroke": Script, "roll": Script, ... }
├── chapters: [ {start_ms, end_ms, name, color} ]
├── bookmarks: [ {at_ms, note} ]
├── loops: [ LoopRegion ]                       (§8)
├── tracking_sessions: [ TrackSession ]         (§9, optional)
└── settings: per-project overrides

Script
└── actions: sorted list of (at_ms: int, pos: 0..100)

Selection: a set of action indices, or a time range, per axis
```

**Rules the core enforces:** sorted actions, integer ms, clamp pos to 0–100, merge
points closer than 1 ms, every change goes through the undo stack.

**Undo:** command pattern (`AddPoints`, `MovePoints`, `DeleteRange`, `Transform`…),
each with `do`/`undo`. Group drags and multi-step tools into one undo entry.

---

## 6. Core flows

### 6.1 Open
1. Drop a video (or a `.pawproj`).
2. If a `.funscript` with the same name sits next to it, offer to load it (and any
   multi-axis siblings).
3. Probe the media: duration, frame rate, VFR flag. Warn if VFR — seek by timestamp,
   never by frame index × fps.

### 6.2 Manual scripting loop (the heart of the app)
1. Play or step to a moment.
2. Press a **number key 0–9** → set `pos = key × 10` at the playhead (fine-tune with
   modifiers or the inspector).
3. **Frame step** with arrow keys, **jump to previous/next point**, **nudge** a selected
   point by ±1 frame or ±5 pos.
4. **Repeat stroke at playhead**: copy the last up/down pair to where you are.
5. Live preview on the device while scrubbing (toggle).

### 6.3 Assisted scripting (optional)
1. Mark a region of interest on the video (§9).
2. Run tracking over a time range or chapter → get a raw position signal.
3. Review the proposed points as a **ghost lane**; accept all, accept range, or tweak.
4. Accepted points become normal actions (undoable as one step).

### 6.4 Review
- Playback with the script graph and a moving playhead, device on.
- **Heatmap** strip across the whole timeline (speed per second) to spot dead zones,
  spikes and impossible speeds.
- **Problems panel:** speed over device limit, points closer than the device can follow,
  long gaps, out-of-sync suspicion around cuts.

### 6.5 Export
- Save `.funscript` (and per-axis siblings) next to the video, or to an output folder.
- Optional: embed chapters in metadata; write a `.pawproj` that keeps everything.

---

## 7. UI layout

```
┌─────────────────────────────────────────────────────────────┐
│ Menu · Mode: [Script] [Review] [Track]        Device: ● Handy│
├───────────────────────────────────┬─────────────────────────┤
│                                   │ Inspector               │
│            Video pane             │  - selected point(s)    │
│   (ROI boxes drawn here in Track) │  - transform tools      │
│                                   │  - chapter / loop props │
├───────────────────────────────────┴─────────────────────────┤
│ Overview: heatmap of the whole video + chapter colours       │
├─────────────────────────────────────────────────────────────┤
│ Lane: stroke   ▁▃▇▃▁▃▇▃▁ (editable graph, ghost lane overlay)│
│ Lane: roll     ───╱╲───                                      │
│ Lane: twist    (collapsed)                                   │
├─────────────────────────────────────────────────────────────┤
│ Transport: ⏮ ◀▮ ▶ ▮▶ ⏭   0:42.317 / 3:10.000   speed 0.5×     │
└─────────────────────────────────────────────────────────────┘
```

**Interaction rules**
- Everything has a keyboard shortcut; mouse is optional for core scripting.
- Click a lane to focus it; number keys write into the focused lane.
- Drag on a lane = box-select; drag a point = move (snaps to frames, Shift disables).
- Mouse wheel over the timeline zooms around the cursor; the playhead stays visible.
- Four **tabs**, the stages of the job (paw-ef73.1; were three modes: Script, Review, Track), change what the video pane
  and the panels show:
  - **Scenes:** scenes, cuts, shots, loops: a clean timeline.
  - **Track:** ROI drawing, tracking controls, ghost lane.
  - **Refine:** clean video, point tools (the old Script mode).
  - **Review:** heatmap, problems panel, device on by default.

**Starter shortcut map**

| Key | Action |
|---|---|
| Space | play / pause |
| ← / → | frame back / forward |
| Shift + ← / → | jump 1 s |
| , / . | previous / next point |
| 0–9 | set point at playhead (pos × 10) |
| Q | repeat last stroke at playhead |
| Del | delete selected |
| Ctrl+Z / Ctrl+Y | undo / redo |
| L | set loop in/out (§8) |
| T | track current range (Track tab) |
| M | toggle device preview |

---

## 8. Loops (the furry-specific killer feature)

A lot of furry content is short **looping animation**: a 2–8 s cycle repeated, often at
exact frame counts.

- **Loop region:** mark in/out on one clean cycle (`L` twice). The app shows the cycle
  length in frames and ms.
- **Auto-detect:** optional helper that compares frames to find the repeat point
  (frame-difference minimum after the in-point); the user confirms.
- **Script once, tile:** script the single cycle, then "Tile across range" copies it
  forward with exact timing, re-anchored to each cycle start, so it doesn't drift.
- **Seamless join:** make the last point of the cycle connect to the first point of the
  next (warn if the join would be a speed spike).
- **Variation (optional):** small random amplitude/timing jitter per repeat so long
  tiled sections don't feel mechanical; off by default, seeded so it's reproducible.
- **Re-tile after edits:** editing the source cycle offers to update every tile.

---

## 9. Tracking plug-in slot (kept small on purpose)

Design it so the first version needs no AI at all.

**Input → output contract**

```
track(frames: iterator of (t_ms, image),
      roi: region the user drew (box or points),
      params: dict) -> list of (t_ms, value 0..1)
```

**Built-in tracker v1: point/region following (no model)**
- User draws a box (or 2 points) on a moving part — any species, any art style.
- Follow it with optical flow (OpenCV Lucas–Kanade) or template matching.
- Project the movement onto an axis the user picks (vertical, horizontal, or "distance
  between two tracked points"), giving a 0–1 signal.
- Works on 2D animation and 3D renders where human-trained body detectors fail.

**Signal → points pipeline (shared by every tracker)**
1. Smooth (moving average or Savitzky–Golay).
2. Find turning points (peaks and valleys) with a minimum prominence.
3. Map 0–1 → 0–100 with user-set min/max.
4. Simplify (Ramer–Douglas–Peucker) to drop redundant points.
5. Apply device limits: cap speed, enforce minimum spacing.
6. Output to the ghost lane for review (§6.3).

**Later:** detector plug-ins can sit behind the same contract. Keep models optional
downloads, each with its licence shown before download.

---

## 10. Devices

- Connect through **Intiface Central** (Buttplug protocol) — one integration, many
  devices, and nothing proprietary.
- **Preview modes:** follow playback; follow scrubbing; "test this stroke" on a selection.
- **Per-device profile:** range limits, max speed, latency offset (ms) to line up with
  the video. A calibration screen plays a beat and lets the user slide the offset.
- Safety: a big **stop** button and a global hotkey (Esc) that halts all devices.

---

## 11. Files and safety nets

- Project file: `.pawproj` (JSON, human-readable, versioned schema).
- **Autosave** every N seconds to a sidecar; rolling **backups** (keep last 10).
- **Never overwrite** an existing `.funscript` without a backup copy the first time.
- Re-link moved videos by hash.
- No hidden files outside the user's chosen folders; settings in one documented place.

---

## 12. Privacy as a feature

Write it in the README, not just the code:
- No telemetry. No crash reporting unless the user opts in per report.
- No network at all by default. Optional "check for updates" button that does one plain
  request to a public releases page.
- No account, no licence check, no device identifiers.
- Anything the app downloads (models, tools) is listed, asked for, and shown in the UI.

---

## 13. Code layout

```
pawscript/
├── core/          project.py, script.py, undo.py, transforms.py, loops.py, io_funscript.py
├── media/         player.py (mpv), frames.py
├── tracking/      api.py, flow_tracker.py, signal_pipeline.py
├── devices/       buttplug_client.py, profiles.py
├── ui/            main_window.py, timeline.py, lanes.py, inspector.py, video_view.py
├── tests/         core is tested without any UI
├── PROVENANCE.md  where ideas and dependencies came from
├── THIRD-PARTY.md every dependency and model, with licence
└── LICENSE
```

---

## 14. Roadmap

| Milestone | Scope |
|---|---|
| **M0 — Core** | funscript read/write, data model, undo, transforms, unit tests, CLI round-trip |
| **M1 — Manual editor** | video + one lane, number-key scripting, frame step, save/load |
| **M2 — Editor that's pleasant** | multi-axis lanes, selection tools, heatmap, problems panel, autosave/backups |
| **M3 — Loops** | loop regions, tiling, seamless joins, re-tile |
| **M4 — Devices** | Intiface preview, profiles, latency calibration, panic stop |
| **M5 — Assisted** | ROI flow tracker, signal pipeline, ghost-lane review |
| **M6 — Plug-ins** | tracker plug-in API documented; optional model plug-ins with licences shown |

Ship M1 to yourself first. If it's already nicer than what you use today for loops,
everything after is a bonus.
