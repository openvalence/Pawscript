# Director agent protocol

You are answering decisions for Pawscript's automated director: per scene, what the camera does, what happens
(story), what to track, which tracker run to keep, which way is deep, and whether the generated script matches the
video. The app asks; you answer. The contract is `src/lib/director/README.md` (schema `pawscript.director/1`); this
page is what an answering agent needs.

**Position convention: pos 0 = deepest, 100 = out.** Times are integer ms from the video start; spans are `[t0, t1)`.
Boxes and points are normalized 0..1 with the origin top-left of the full frame.

## Where requests appear

The session folder is `<agentRoot>/<session>/` (`session.json` names the video and holds `status`):

```
session.json      {status: running | paused | done | stopped, video:{path, dur_ms, ...}, conventions, protocol}
facts.json        the whole fact sheet (scenes, describe tags, loop periods, camera stats, energy, still spans)
req/<file>.json   one DecisionRequest each (current round inside); <file> = the id with ':' replaced by '_'
req/<file>/*.jpg  its images; Evidence.path is relative to the session folder
ans/<file>.json   YOUR answer: write ans/<file>.json.tmp, then rename it
ans/<file>.working          optional heartbeat while you think (any content)
ans/<file>.error.json       written by the app when your answer was refused: {id, round, error}; fix and rewrite
```

Watch `req/` (the app polls `ans/` every 500 ms). Ignore dot-files and `*.tmp`. Stop when `status` is `stopped` or
`done`. A request file that is rewritten (new round, or a redo with `prior`) needs a new answer. Over CDP the same
requests are `window.app.director.pending()` and answers go to `window.app.director.answer(id, answer)` (it returns
the error text, or null when accepted).

## What a request holds

`{id, kind, scope:{scene, t0, t1}, attempt, round, maxRounds, question, facts, frames, deps, prior?, evidence, choices?}`

- `question` is plain language and self-contained.
- `facts` carries what the app measured: `scene` (describe tags and boxes, loop, camera, 1 Hz energy, still spans,
  an 8x8 motion heat map, per-second brightness / black / credits), `camera` and `climax` (decided earlier), `segment`
  (the story segment of this span), `runs` and `pairs` (motion.compare of the tracker runs: turns/s, half-cycle cv,
  coverage, gaps, camera share and offset; pairwise turn match), `candidates` (motion.propose: box, axis x0,y0→x1,y1 =
  in, 4 points, an anti-phase pair), `pickPairs` (extreme pairs of the kept run), `keep`, `checks`.
- `evidence` is what you have seen so far: contact sheets, grids, overlays, blind pairs, tracking results.
  Round 0 already has a first look (a contact sheet for story, a 10% grid for roi, overlays for track, blind A/B
  pairs for direction and verify).
- `prior` is set on a verify redo: the answer that failed. Do not just flip it; look again.

## Your answer

```json
{"id": "track:s0@0", "round": 0, "value": {...}, "raw": 0.85, "rationale": "why, citing evidence", "evidence": ["ev-3"]}
```

Exactly one of `value`, `need`, `abstain`. Echo `id` and `round`. `raw` is your confidence (0..1); the app shows it
as uncalibrated and caps it at 0.95. Value shapes (README §3):

| kind | value |
|---|---|
| camera | `{mode: static\|rides\|move\|sway, p95Px, rateHz\|null, phaseMs\|null, moveSpans:[[t0,t1]], valid:[single\|relative\|rate]}` |
| climax | `{window:{t0,t1}\|null, afterglowTo\|null}` — the window is the ORGASM (first spurt to the fade) |
| story | `{segments:[{t0,t1,kind,visible,action:continues\|stops\|unknown,intensity,recipe?,params?,name}]}`, tiling the scene exactly, each ≥ 250 ms |
| roi | `{probes:[{id,tracker,roi,params,role:subject\|reference,part,channel?}], none?: offscreen\|camera\|still}`, at most 5 |
| track | `{keep: runId\|null, channel?, agree:[runId], reject:{runId: reason}, fallback?:{recipe, params}}` |
| direction | `{pairs:[{deep, shallow}]}` (ms of the two tiles; the app derives the sign) or `{sign: 1\|-1\|0, pairs}` |
| verify | `{pairs:[{deep, shallow}]}` from the blind pairs, or `{verdict: ok\|redo, redo?, checks, note}` |

Story kinds: idle, fade-in, foreplay, oral, penetration, knotting, climax (the fast full strokes right before the
orgasm, ~6.5 s), orgasm, afterglow, outro, offscreen, custom. The finale is climax → orgasm → afterglow.
Recipes are the keys of `src/lib/gen/recipes.js` RECIPES (e.g. `penetration-strokes` with `{rate}` in turns/s for
offscreen action with a known rhythm, `orgasm`, `orgasm-pulses` with `{decayMs}`, `knot-pop-stroke`).

## Asking for more evidence

Answer `{"need": [ToolCall, ...]}` instead of a value; the app runs the tools, appends the evidence and rewrites the
request with `round + 1` (at most `maxRounds`; tracks 12, GPU 900 s and images 60 per run in total).

| tool | call |
|---|---|
| frames | `{tool:"frames", times:[ms] \| t0,t1,stepMs, crop?:Box, grid?:0.1\|0.25, cols?, height?}` |
| pairs | `{tool:"pairs", run, t0, t1, k?}` blind A/B sheets at the run's extremes, no positions shown |
| overlay | `{tool:"overlay", run, times:[ms]}` frames with the run's tracked points / boxes drawn |
| track | `{tool:"track", tracker, roi, params?, t0, t1, role?, part?}` a new tracking run (costs GPU) |
| compare | `{tool:"compare", runs:[id], t0, t1, channels?:{id: channel}}` |
| camera | `{tool:"camera", boxes:[Box]\|null, t0, t1}` camera motion with explicit static reference boxes |
| channel | `{tool:"channel", run, channel}` switch a run's primary channel |

## What the good run did (trace 2)

- Judge the camera from static regions in raw pixels before trusting any tracker: a static wall can look like
  strokes after normalization; a frame that bumps at the stroke rate makes single-body tracks follow the camera
  (only a two-body distance survives); a push-in makes everything measure the camera.
- Track the moving part with points (custom axis, x0,y0 → x1,y1 = in), add a background reference, and keep the run
  that two independent trackers agree on (turn match ≥ 0.75 within 120 ms). Reject runs whose turns match the camera.
- Without visible contact claim a rate (from a stroke-locked wobble), never a phase.
- Decide direction from blind pairs at the kept run's extremes: which frame is deeper (bodies pressed, more inserted).
- Verify the generated script on frames at its extremes; redo what fails.

## Reference answerer

```
node tools/director-agent/answer.mjs <session dir> --policy rules            # the rules brain (proves the round trip)
node tools/director-agent/answer.mjs <session dir> --policy replay <trace.json>
node tools/director-agent/answer.mjs <session dir> --policy prompt           # prints each request + image paths, reads one JSON line
```

`brain.mjs` runs the brains on request JSONL (the eval's driver) and `render.mjs` renders a plan plus runs through
the app's own generator; see their headers.
