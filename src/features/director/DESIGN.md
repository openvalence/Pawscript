# Director: design

Status: design (2026-11-06). The contract the builders code against is `src/lib/director/README.md`. When the two
disagree, the README wins; fix this file.

Inputs to this design:
- The spec is the second live director run: `Documents\Pawscript-live\DIRECTOR-TRACE-2.md/.json` and its project file. The owner called its script good.
- The first run (`DIRECTOR-TRACE.md/.json`) shows what goes wrong without camera references or tracker comparison.
- Three design proposals and three judge verdicts. This design takes "local-first" as the base and grafts in the
  following: from "decision-api", the eval ablation, inputs-digest replay, chain attribution and per-span redo;
  from "agent-in-the-loop", the bounded `need` tool loop, the file mailbox, blind A/B pairs, JS-generator scoring
  and the trace-2 replay regression.

Position convention everywhere: **pos 0 = deepest, 100 = out.**

---

## 1. Goals

1. **The trace-2 standard, automated.** For every scene the director decides the following:
   - camera behaviour;
   - kind, visibility, intensity, and the finale: climax (fast run-in) → orgasm → afterglow;
   - which part to track and with which trackers;
   - which run to keep (or none, with a recipe fallback);
   - direction and depth.

   It then generates a script, verifies it against independent evidence, re-decides what failed, and
   leaves a trace: every decision with its inputs, confidence, brain and rationale.
2. **One pipeline, swappable brains.** The pipeline is written once. Each decision goes through a chain of brains:
   - `rules`: pure JS over numbers;
   - `vlm`: a local Qwen3.5-2B asked fixed-choice questions;
   - `agent`: an external Opus-class agent through a file mailbox or CDP, which can ask for more evidence;
   - `user`: Director panel cards.

   A brain answers when its calibrated confidence clears the threshold for that decision. Otherwise the decision
   falls through to the next brain in the chain.
3. **It never blocks on the user.** A complete script exists after one pass. Questions for the user are queued and
   the run continues on provisional answers. Answering a question re-runs only what depends on it, and that
   re-run is free because unchanged decisions replay from their digest.
4. **Honest numbers.** Brain routing follows measurements. The local VLM is kept **out of `direction` and out of
   frame verification**: measured single-frame accuracy is 0.45, the pair question gets about 0.01 of the answer
   mass with a 77% first-image bias, and end-to-end fixed-sign F1 is 0.48 against 0.549 for flow. Confidences are
   calibrated on the gold set with leave-one-clip-out, and the UI shows n. Agent and user confidences are shown
   as uncalibrated.
5. **Measurable.** An offline eval runs every brain over the 78 gold scenes from caches and numeric frame access.
   It scores each decision type against its oracle, and the whole script through the app's own JS generator.
   It also measures how much each decision is worth (oracle-for-X), so effort goes where it pays.
6. **The existing pieces stay working.**
   - The one-shot sidecar protocol is unchanged.
   - Draft's rules mode is unchanged.
   - Assist, tracking and timeline keep their APIs.
   - The director reuses them: draft as the runner, `trackingApi` for jobs, `generate` and assist facts.

What the realistic target is, stated plainly:
- On easy clips, rules plus the 2B model plus the flow-based region proposal settle camera, track, depth and most of
  the story numerically.
- Direction, the climax onset and offscreen-or-not reach the agent or the user, at about 2 to 4 questions per video.
- Trace-2 quality without any agent or user is not claimed.

---

## 2. Pipeline (what a run does)

The director is a **mode of the draft runner**. Draft's step engine (Run / Redo / Skip per step, one transact per
step, cancel, step state follows undo) runs a longer step list whose new steps live in this feature.

| # | step id | owner | what it does | decisions |
|---|---|---|---|---|
| 1 | `scenes` | draft (as is) | detect cuts | – |
| 2 | `describe` | draft (as is) | per-scene tags | – |
| 3 | `loops` | draft (as is) | per-scene period | – |
| 4 | `survey` | director | sidecar `motion.stats` over every scene (camera dx/dy/zoom in px, 1 Hz energy, still spans, an 8x8 heat map with the camera removed). It replaces draft's whole-frame `track` step. | `camera` per scene |
| 5 | `story` | director | orgasm window over the video (decision kind `climax`), then segments per scene; writes the plan (one transact) | `climax`, `story` per scene |
| 6 | `regions` | director | for each visible active segment: `motion.propose`, then choose probes, then `trackRange` each probe (cached by digest) | `roi` per span |
| 7 | `compare` | director | `motion.compare` over the probe runs, the reference and the camera series; keep one run or none; pin `seg.source` | `track` per span |
| 8 | `direction` | director | `pickPairs` on the kept run's ghost script, then the sign; assist facts, plus `setSpanOrientation` if the sign is -1 | `direction` per span; `depth` per span |
| 9 | `generate` | draft (as is) | `generate(app,'all')` on stroke | – |
| 10 | `verify` | director | independent checks per span, plus a blind pair check from the agent or user; a redo re-runs steps 6 to 9 for that span (at most 2 times) | `verify` per span |
| 11 | `assist` | draft (as is) | self-check queue | – |
| 12 | `review` | draft (as is) | device profile | – |

Order of the decisions, and why:
- `camera` comes first because every tracker judgment depends on it. Trace 2's scenes give one case for each mode:
  - s0 is static;
  - s1 rides the strokes (34 px at 2.51 turns/s, 177 ms phase);
  - s2 is a push-in;
  - s3 is sway.
- `climax` is decided before `story`, so that story's segments respect its window. The decision kind keeps its id,
  but its window is the **orgasm** (first spurt to where it fades); the plan gets `climax` (the owner's "fast
  climax": full strokes, `CLIMAX_FIT.runInMs` = 6.5 s before the window) → `orgasm` (the window) → `afterglow`.
- `roi`, `track` and `direction` are per span. `verify` checks the generated script and can send one span back.

A re-run is cheap:
- Every decision has an inputs digest. A decision whose inputs have not changed replays its stored answer.
- Every probe run is cached as a hidden ghost tagged `director:<probe digest>`.
- "Re-decide X" and "the user answered X" both just re-run the draft from X's step. Only X and the decisions
  downstream of it, whose digests change, are asked again.

The plan is written by the director itself. The `story` step builds the rows and turns them into segments with
`importTimeline` (a pure function). The `compare` step sets `s.source = runId` on each segment and writes
`app.doc.plan` in one transact, as draft's `plan()` does. `generate-logic.js chooseRun` already honours
`s.source`, so per-scene runs compose and **no merged ghost is needed**. Trace 2's "only the newest ghost" limit
came from the older build in Pawscript-live.

---

## 3. Decisions

There are eight decision kinds. The exact shapes are in the README §3.

| kind | scope | value | needs | oracle on gold |
|---|---|---|---|---|
| `camera` | scene | mode `static`, `rides`, `move` or `sway`; px; rate; phase; move spans; `valid` channels | motion.stats | none (end-to-end only) |
| `climax` | video | window `{t0,t1}` or null, `afterglowTo` | tags `cum` per frame, energy, story evidence | reference pulse bursts (`av_climax`) |
| `story` | scene | segments `{t0,t1,kind,visible,action,intensity,recipe?,params?,name}` | tags, loop, camera, energy, VLM per-second evidence | per-second activity, coarse kind |
| `roi` | span | 1–5 probes `{tracker, roi, params, role, part}` or `none` | propose candidates, tag boxes, camera.valid | seed recall against `pt_seeds` |
| `track` | span | keep a run id or null, channel, agree, reject reasons, fallback recipe | motion.compare | regret against the best cached candidate |
| `direction` | span | sign +1, -1 or 0, plus `{deep,shallow}` pairs | kept run, pairs, channel geometry | `counts_fixed` sign |
| `depth` | span | lo, hi, intensity | the kept run's excursion, kind defaults | reference p5/p95 |
| `verify` | span | ok or redo(target), the checks | the script, a second tracker, compare, review, a blind pair | injected faults |

Rules that the pipeline enforces (brains do not):
- **The `camera` guard (stroke-locked camera).**
  - A run counts as "measures the camera" only if at least 80% of its turns fall within 120 ms of camera turns
    **and** the median offset is under 60 ms. Scene 1's bump has a 177 ms phase, so it survives.
  - `camera.valid` restricts which channels may be kept: `rides` allows only relative channels (`dist01`, `area`).
- **Rate without phase.** When no subject run is kept (offscreen), the plan may claim a rate taken from a
  stroke-locked wobble, but never a phase. Such a span gets no `direction` decision.
- **Redo.**
  - A verify redo of X invalidates X and everything downstream of it, for that span only.
  - The redo re-asks X with `prior` set and `attempt+1`, and the brain that produced the prior answer is
    **skipped**: the next brain in the chain answers. This applies to every kind, including binary signs; a redo
    never forces "flip the answer".
  - At most 2 redos per span. After that the span is queued for the user.
- **Verify independence.** The numeric checks never compare the script with the run it was generated from alone.
  Each check is one of these:
  - agreement between the kept run and a *second, independent* subject run;
  - camera share;
  - stroke rate against the loop period;
  - device review;
  - a blind A/B frame pair at the script's extremes.

  The frame pair goes to the agent or the user, and never to the brain that decided `direction` for that span.

---

## 4. Brains

### 4.1 Capability matrix

The matrix says which brain may answer each decision. "–" means never asked. The thresholds are the defaults in
`POLICY` (README §5); the eval replaces them with calibrated ones.

| decision | rules | vlm (Qwen3.5-2B) | agent (external) | user | chain (tau) |
|---|---|---|---|---|---|
| camera | ✓ motion.stats thresholds | – | ✓ | ✓ (rarely asked) | rules → agent → user (0.80) |
| climax | ✓ cum-tag onset after 40% of the video, energy burst then decay, snapped to a cut within 1.5 s | ✓ CLIMAX letter through `relative_climax` only | ✓ (may ask for 0.5 s sheets) | ✓ 6-frame strip | rules → vlm → agent → user (0.85) |
| story | ✓ draft RULES + structure rules + trace-2 rules | ✓ KIND a–j, CONT, VIS, INT per second, as evidence added to the rules before Viterbi | ✓ | ✓ top-3 kinds sheet | rules+vlm → agent → user (0.75) |
| roi | ✓ `motion.propose` + tag boxes + reference tile | – | ✓ (custom axis, clicks; may ask for tracks) | ✓ draw a box / click points | rules → agent → user (0.70) |
| track | ✓ compare gates and score | – | ✓ (may ask for overlays) | ✓ two overlay frames | rules → agent → user (0.75) |
| direction | ✓ `dist01` geometry; an existing assist fact | **–** (measured worse than flow) | ✓ blind A/B pairs | ✓ blind A/B pair | rules → agent → user (0.90) |
| depth | ✓ excursion ratio × kind defaults | – | – | – (edited in the inspector) | rules (0.60, always applies) |
| verify | ✓ independent numeric checks | **–** | ✓ blind pairs at extremes | ✓ blind pair | rules → agent → user (0.80) |

Two more brains are internal:
- `replay` serves stored answers by digest and the trace-2 fixture.
- `oracle` answers from gold labels in the eval only and never ships.

Bonsai (`vlm:bonsai-*` through the owner's llama-server) is selectable as a second VLM for `story` and `climax`
only. It is off by default: gold F1 0.602 against 0.612 for 2B, at a tenth of the speed.

### 4.2 rules (`src/features/director/brains/rules.js`)

Rules is pure and synchronous, with no Svelte and no `app`, so it runs in the browser and under node. It reuses:
- draft `logic.js` (`RULES`, `kindForSummary`, `quietWhy`);
- assist `model.js` (`pickPairs`, `turnList`, `agrees`);
- timeline `plan.js` (`KINDS` defaults through `importTimeline`).

Each rule cites the trace-2 decision it reproduces. The thresholds below are the starting points; the eval fits
them leave-one-clip-out.

- **camera** (per scene, from `motion.stats`):

  | condition | mode | trace-2 scene |
  |---|---|---|
  | p95 under 2 px | `static` | s0 |
  | periodic global motion within 15% of the loop or stroke rate, `strokeLock.cv` < 0.25 | `rides`, `valid:['relative','rate']`, with phaseMs | s1 |
  | monotone zoom > 3% or translation lasting ≥ 3 s | `move` with moveSpans | s2 |
  | tiles share at least 0.9 of their turns with the global motion | `sway` | s3 |

  Confidence comes from the margin to the threshold, then calibration.
- **climax**:
  - Candidates are the first `cum` tag onset in describe `per_frame` after 40% of the video, and a burst-then-decay
    in 1 Hz energy or in an independent-part run.
  - The onset snaps to a cut if it is within 1.5 s (trace 2: first spurt 0.6 s after the cut at 56.2 s).
  - `afterglowTo` is where the energy falls to 30% of the orgasm median.
  - Expect `unsure` on most videos, which routes the decision on.
- **story** (per scene, as per-second log scores so the VLM evidence adds to them before `viterbi(…, 4)`):
  - **Tags.** Draft RULES order: knotting > oral > penetration > custom > foreplay.
  - **Structure.** Black or fade frames give fade-in or idle. Before the first act and after the last act gives
    idle or outro. Still for ≥ 3 s gives idle. A static image with high `credits_like` at the end gives outro.
  - **Foreplay vs penetration.** Periodic at the stroke rate with excursion ≥ 0.6 of the scene's later excursion
    gives penetration, with intensity = that ratio (trace 2, 0–4.5 s: 0.043/0.057 = 0.75).
  - **Offscreen.** `camera.mode=='move'`, or no act tags with VIS low, gives offscreen, `visible:false`,
    `action:'continues'`, recipe `penetration-strokes` with the rate from a stroke-locked wobble when a sibling scene
    proved one.
  - **Finale.** From the `climax` decision: `climax` (default recipe: the fast run-in) over the 6.5 s before the window
    (`CLIMAX_FIT`, measured on the reference), `orgasm` (recipe `orgasm`) over the window, then afterglow up to
    `afterglowTo`. Score 6 per second each, like the window always had.
  - **Abstain.** When the tags contradict (two act groups both ≥ 0.5 in one span).
  - **Names.** Template names, e.g. "penetration · from_behind · cam static".
- **roi** (per visible active span):
  1. A reference probe: `lk_box` on the lowest-energy border tile (role `reference`). Trace 2 needed this every time.
  2. The top `motion.propose` candidate inside a figure box:
     - if `camera.valid` includes `single`: `tapnext_points` with its 4 points, `proj` on the proposed axis
       (`axis:'custom'`, x0→x1 = in);
     - if the camera `rides`: `tapnext_points` on the anti-phase pair, `dist01`.
  3. If a part tag box exists (`knot`, `penis`): `sam2_mask` on it, as the second opinion.
  4. Fallback when there is no candidate: `lk_box` on the act tag box, `axis:'auto'`.

  At most 3 subject probes plus 1 reference. Cheap ones are tracked first.
- **track** (from `motion.compare`):
  - **Gates.** A run is rejected for any of these:
    - camera share ≥ 0.8 with offset < 60 ms;
    - coverage < 0.9 or a gap longer than 1 s;
    - `|turnsPerS/2 − 1000/loop.periodMs| / (1000/loop.periodMs) > 0.25` when `loop.prominence ≥ 0.3` (lk_box at
      half rate in s1);
    - the channel is not allowed by `camera.valid`.
  - **Score.** `0.4·(1−halfCV) + 0.3·bestAgree.match + 0.3·rateMatch`.
  - **Confidence.** At least 0.8 only when two independent subject runs agree (match ≥ 0.75 within 120 ms; run25
    against run7 was 0.82 at 22 ms; run21 against sam2 `area` was 0.83 at 44 ms).
  - **No survivor.** `keep:null` with a recipe fallback.
- **direction**:
  - With a `dist01` channel the sign is +1 by geometry, since the smallest two-body distance is pos 0. It is shown
    as uncalibrated until the eval measures it.
  - With `proj` on a proposed axis: the axis prior. This usually falls through to the agent or user.
  - An existing `assist.direction` fact that covers the span is answered through `agrees()` at 0.98.
  - With no kept run there is no request.
- **depth**: the kind defaults (`lo`/`hi` from the recipe), with `intensity` = the median 2 s excursion relative
  to the scene maximum.
- **verify** (numeric, independent):

  | check | limit | on failure |
  |---|---|---|
  | (a) turn match between the kept run and the best *other* subject run | ≥ 0.6 when one exists | redo `track` |
  | (b) camera share of the kept run | < 0.8 or offset ≥ 60 ms | redo `track` |
  | (c) generated stroke rate against the loop period | within 15% when prominence ≥ 0.3 | redo `track` |
  | (d) review errors in the span | 0 | redo `depth` |

  Rules answers `ok` only when every applicable check passes. It abstains when no independent evidence exists,
  which sends the span to the frame check.

### 4.3 vlm (`src/features/director/brains/vlm.js` + sidecar `director.ask`)

- **Questions.** The stage `DOMAIN.adult` texts as they are:
  - KIND letters a–j (black, intro, foreplay, oral, penetration, knotting, offscreen, orgasm (h: "orgasm: ejaculation, cum spurting" — maps to the `orgasm` kind; the run-in has no letter), afterglow, outro);
  - CONT yes/no; VIS yes/no; INT a–d.
- **Sampling.**
  1. One keyframe per 5 s window, with the window's fact line as text.
  2. Re-ask at 1 fps on the flagged seconds: boundaries, max-p < 0.45, a cum onset, a rate jump of 1.6x.
  3. Group the requests into one `director.ask` per scene.
- **Mapping.**

  | answer | used as |
  |---|---|
  | KIND, CONT | per-second log evidence added to the rules scores, then Viterbi (switch penalty 4) |
  | VIS | `visible` (offscreen if mean VIS < 0.5 while CONT > 0.5) |
  | INT | intensity prior |
  | climax letter | feeds only `relative_climax` (P ≥ 0.15 and ≥ 2x the clip median, after 40% of the video) |
- **Budget.** For a 104 s video, about 84 coarse plus up to 100 fine questions: 8–10 s, plus 6 s to load the model.
- **Not asked:** direction, depth, verify, roi, track.

### 4.4 agent (`src/features/director/brains/agent.js`)

This is the trace-2 standard: an Opus-class agent that sees contact sheets and numbers and chooses its own evidence.

- **Transport 1, the file mailbox** (README §7). It works with any agent that can read and write files, including
  Claude Code in this tree, a remote service on a synced folder, or the reference script.
  - The app writes `req/<id>.json` plus JPEG sheets made by the sidecar `frames` command.
  - The agent writes `ans/<id>.json` (tmp then rename).
  - The app validates the answer. A failure writes `ans/<id>.error.json` and the app keeps waiting.
  - Polling is every 500 ms while a request is pending.
- **Transport 2, CDP / in-process.** `window.app.director.pending()` and `.answer(id, response)`, which is how
  trace 2 drove the app. It shares the same queue and the same validation.
- **The `need` tool loop.** An answer may be `{need:[ToolCall…]}` instead of a value. The app runs the tools
  (`frames`, `pairs`, `overlay`, `track`, `compare`, `camera`, `channel`), adds the results to `evidence`, and
  re-issues the request with `round+1`.
  - Bounded by `maxRounds` (3) and a per-run budget (tracks 12, GPU-seconds 900, images 60).
  - Every tool call lands in the trace.
  - This is what reproduces background-reference runs, custom `proj` axes and 0.5 s climax sheets.
- **Deadline.** Default 10 min per request. At the deadline the request counts as an abstention and the chain
  moves on to `user`.
- **Confidence.** The agent states one. It is shown as `uncal.` and capped at 0.95 until verify passes.
- **Blind pairs.** Direction and verify pairs are rendered as A/B in an order the app randomises, with no position
  shown. The mapping stays in the app.
- **Reference script.** `tools/director-agent/answer.mjs` watches a session folder:
  - `--policy rules` answers with the rules brain, which proves the round trip;
  - `--policy replay <trace.json>` answers from a recorded trace;
  - `--policy prompt` prints the request and sheet paths and reads a JSON answer from stdin, which is how a human
    or an LLM CLI answers.

### 4.5 user (`src/features/director/brains/user.js` + panel cards)

- **Non-blocking.** When the chain reaches `user`, the decision gets status `queued`, the best answer so far is
  applied as `provisional`, and a card appears.
- **Answering.** An answer is stored as an override (confidence 1, brain `user`), then the draft re-runs from the
  decision's step.
- **"Can't tell".** Keeps the provisional answer and marks the decision `abstain`.
- **Direction cards.** They write `{t0,t1,deep,shallow}` facts into the `assist.direction` block, where assist
  expects them, so assist and the director agree.

---

## 5. Sidecar service

The one-shot protocol stays exactly as it is. New commands are added to the **same dispatch table**, so each one
works both one-shot (the app in v1, through the existing `sidecar_run`) and inside the new long-lived `pawtrack serve`.

### 5.1 New commands (README §8 has the shapes)

| cmd | module | cost | what |
|---|---|---|---|
| `frames` | `pawtrack/frames.py` | ~0.1 s per frame plus start | exact frames by timestamp, as single JPEGs or labelled contact sheets (grid, crop, 10% grid overlay, run overlay points/boxes, blind A/B labels), written to `dest` or returned as base64. **Refuses any video under a `Reference` path component** (the gold set is numeric only). |
| `motion.stats` | `pawtrack/motion.py` | ~+1–2 s per 100 s at 320 px, CPU | per range: global dx/dy/zoom in raw px (phase correlation of the border tiles and divergence of the block flow), the camera verdict (§4.2 thresholds, also returned raw), 1 Hz energy (`pipeline.motion_energy` with the camera removed), still spans, a 8x8 heat map, per-second brightness/black/credits_like. The pure core `stats_from_flow(t, block_flow, thumbs)` runs on the eval's cached 16x9 block flow. |
| `motion.compare` | `pawtrack/motion.py` | ms, pure | per series: turns, turns/s, half-cycle CV, gaps, coverage, cycle ms, rate against the loop, camera share and median offset. Per pair: corr, turn match within `match_ms`, median offset. Turns come from `pawtrack.score`'s turn finder, so app and eval agree. |
| `motion.propose` | `pawtrack/motion.py` | ~1–2 s per scene at 256 px, CPU | the moving-part proposal: block flow minus the camera, FFT power at 1/period, candidates `{box, axis:[x0,y0,x1,y1], points (4 × Shi-Tomasi), pair (strongest anti-phase blocks), power, cam_corr}`. The axis is oriented "in" toward the other figure's box when boxes are given. |
| `director.ask` | `pawtrack/director.py` | 19–28 q/s on 2B, 5.7 s load | fixed-choice first-token probabilities over frames given by `(t_ms, roi?)` reference. Frames are decoded in the worker at `res` px and never written to disk. Has `groups` for multi-image items. Bonsai routes to the owner's llama-server. |

### 5.2 `pawtrack serve`

`pawtrack serve` (`trackers/pawtrack/serve.py`, entered from `cli.main` when `argv[1]=='serve'`) is JSONL in both
directions:
- **Hello.** It prints a `hello` line first.
- **Requests** carry an `id`. Every event of a request echoes the id, and a `result` or `error` line closes it.
- **Jobs** run one at a time in FIFO order on a worker thread.
- **Control commands** are answered immediately by the reader thread: `cancel`, `status`, `unload`, `shutdown`.
- **Cancel** is cooperative: `emit` raises `Cancelled` at the job's next progress line. A hard cancel kills the
  process, and the client restarts it.
- **Model residency.**
  - An LRU of one GPU tracker model keyed `(kind, name)`, with `torch.cuda.empty_cache()` on eviction.
  - The existing tapnext `_MODELS` cache is kept (CoTracker3 is not included).
  - A new sam2 predictor cache is added to `sam2_mask.py` (today it is rebuilt on every call).
  - `describe` runs in a child `pawtrack serve --role describe`, spawned on first use and kept alive, because the
    Hydra `hydra` package and sam2's `hydra-core` cannot share an interpreter.
  - The VLM unloads after 120 s idle, on `unload`, or before a tracker loads if the VRAM budget would be exceeded.
- **VRAM.** `PAWSCRIPT_GPU_FRACTION` is read once and `cap_vram` is called once, sized for the resident set. Dev
  and eval runs wrap the whole serve process in `python trackers/gpu_lock.py --gb N` with N ≤ 12. Expected budget:
  describe 3 GB in its child, VLM ≤ 5 GB, one tracker ≤ 4.3 GB. Never two trackers at once.
- **VLM environment.**
  - `director.ask` loads in-process when `transformers` imports. That needs the additive `vlm` extra (torch
    ==2.12.1, the same as describe, plus transformers/accelerate/bitsandbytes). SIDECAR must lock and measure it
    first, and must not land it if it changes the torch build.
  - Otherwise it runs `trackers/pawtrack/vlm_worker.py` (a stdlib-plus-model script, the same JSONL framing) under
    `PAWSCRIPT_VLM_PYTHON`, default `trackers/experiments/vlm/.venv/Scripts/python.exe`. In serve that worker child
    stays resident.

Who uses `serve` now:
- the eval (VLM residency over 78 scenes);
- `tools/director-agent` (an agent pulling frames and stats without the app);
- the app later, once a Rust `sidecar_session` exists (needed hook N1).

Until then the app's `service.js` falls back to one-shot `app.backend.sidecar(request)` per command. That is
correct but pays interpreter start per call, so the app batches: one `frames` request per round, one `motion.stats`
for all scenes, one `director.ask` per scene.

---

## 6. App feature (`src/features/director/`)

### 6.1 Files

| file | role |
|---|---|
| `director.svelte.js` | `directorFor(app)` / `peekDirector(app)`: settings, the decision records, the queue, overrides; `registerBlock('director')`; exposes `app.director` (the CDP surface) |
| `steps.js` | the director steps for the draft runner: `survey`, `story`, `regions`, `compare`, `direction`, `verify` (each `async (draft, i, single) -> {note, facts, entry} \| {skip} \| {cancelled}`) |
| `facts.js` | builds `SceneFacts` from the doc (scenes, describe, loop) plus `motion.stats` |
| `apply.js` | the only doc writer: plan (importTimeline, then source pins), assist direction facts, `setSpanOrientation`, `setChannel`, hiding non-kept director ghosts. One transact per step. |
| `service.js` | sidecar seam: `call(request, {onEvent, signal})` uses a session when `app.backend.sidecarSession` exists, else one-shot `app.backend.sidecar` |
| `tools.js` | the `Tools` implementation for the agent's `need` loop (README §7.3) |
| `mailbox.js` | the session folder (writeText, listDir, readText, remove through `app.backend`) |
| `thumbs.js` | panel thumbnails through `frames` with `out:"b64"`, memory LRU, never persisted |
| `DirectorPanel.svelte`, `DecisionRow.svelte`, `AskCard.svelte`, `panel.js` | the panel (right dock, the Track, Refine and Review tabs) |
| `DirectorChip.svelte`, `status.js` | the chip |
| `commands.js` | `director.run`, `director.show`, `director.cancel`, `director.redecide`, `director.answer`, `director.exportTrace`, `director.setPreset`; no default keys (Ctrl+Shift+G is Generate) |
| `dev/director.html`, `dev/director.js` | harness on `createMockApp` with `test/director-fake-sidecar.mjs` (answers the new commands, delegates the rest to `test/fake-pawtrack.mjs`); `window.H = {app, D, DIR, FAKE, requests}`; headless only, its own port, never 5173/9477 |

### 6.2 Hooks in draft (FEATURE implements these, minimal and additive; nothing else in draft changes)

The exact text is in README §9.2. In summary:
- **H1** `draft/logic.js`:
  - add `DIRECTOR_STEPS` (the 12 ids of §2) and `stepsOf(mode)`;
  - give `initSteps(list = STEPS)` and `restoreSteps(saved, list = STEPS)` a list parameter.
  
  The defaults keep `test/draft-logic.test.mjs` green.
- **H2** `draft/draft.svelte.js`:
  - add `mode = $state('rules')` and `get list()`;
  - replace the direct `STEPS[...]` uses with `this.list[...]`;
  - add `setMode(mode)`, which resets the steps;
  - `exec` resolves `this[id] ?? this.ext?.[id]`;
  - add `useSteps(ext)`;
  - the block save/load carries `mode`.
- **H3** `draft/DraftDialog.svelte`: a "Rules / Director" mode toggle shown when `draft.ext` is set.

Read-only imports, needing no change:
- `trackingApi(app)`;
- `trackingFor(app).run(id)` (the full run record: `samples`, `channels`, `points`), `.setChannel`;
- `generate`, `importTimeline`, `toSpans`, `chooseRun`;
- assist `pickPairs`, `agrees`, `readBlock`, `withDecision`;
- `lib/io/project.js` `getBlock`/`setBlock`.

`trackRange` already returns the full run record, so the director keeps the records it gets.

Needed outside the four builders (list only; the director works without each one):

| id | hook | without it |
|---|---|---|
| N1 | `src-tauri`: `sidecar_session` start/send/stop with a line channel, and `app.backend.sidecarSession` | one-shot per call |
| N2 | `src-tauri/API.md` "Where the app writes": add `<app data>/director/<session>/` and an `app_paths().director` entry | the mailbox root is a settings path, default `<app_paths().data>/director` |
| N3 | Rust launcher: add `--extra vlm` only if that extra lands | the `PAWSCRIPT_VLM_PYTHON` route |
| N4 | assist: the track question should use `chooseRun(seg)`, not the selected run (trace 2: all 4 pointed at run7) | assist's self-check track questions stay noisy |
| N5 | export name `.pawscript.funscript` and `openVideo` path validation (trace 1) | unchanged behaviour |

### 6.3 UI

- **Draft dialog.** It stays the runner UI: a step list with Run, Redo and Skip, plus the mode toggle. "Run all" in
  director mode is `director.run`.
- **Director panel.**
  1. **Header.**
     - The preset: Rules only / Rules + local VLM / Rules + VLM + agent / Ask me everything.
     - An expandable table of chain and tau overrides per decision.
     - The agent mailbox path with a copy button, and the agent status: last answer, `.working` heartbeat age.
     - Progress: `scene 2/4 · compare · 1:12`.
     - Budget left (tracks, GPU-s, images).
  2. **Waiting cards (top).** Each card shows the question in plain words, the evidence thumbnails or blind pair,
     the provisional answer pre-selected with its confidence and brain, choices with keys, "Let the agent decide",
     and "Can't tell".
  3. **Trace.** Grouped by scene, then span. Each row shows:
     - the kind icon and a value summary (`track · keep #21 tapnext dist01`);
     - a confidence bar, amber below tau, with `uncal.` or `n=29` on hover;
     - a brain badge: R, V, A, U or replay;
     - status: decided, provisional, queued, user, replayed or fallback;
     - a ✓/✗ from verify;
     - the rationale;
     - tool calls with times;
     - actions: **Re-decide ▾** (same brain or another brain), **Ask me** (route to the user), **Show frames**.

     Superseded rows fold under the newer row. Clicking a row seeks to t0 and selects the segment.
  4. **Footer.** `24 decisions · 17 R · 3 V · 2 A · 2 U · 1 redo · 2 provisional`, and **Export trace**
     (`DIRECTOR-TRACE-N.json/.md` in the trace-2 shape).
- **Status chip.** `Director · verify · 2 to answer` or `Director · waiting for agent (12 s)`. Clicking it opens
  the panel.
- **Export warning.** Exporting the funscript while decisions are provisional or queued shows a warning that lists
  them.

### 6.4 Persistence

- **Project block `director`** (`registerBlock`):

  ```
  {v:1, session, settings, records, overrides, queue}
  ```

  `records` are TraceRecords (README §6). They double as the replay cache by digest.
- **Images.** Never stored in the project. They live in the session folder, which keeps the last 10 sessions and is
  cleared on reset.
- **Reopening a project.** Queued cards come back. A session that was running comes back paused, and "Run all"
  resumes from the first pending step. Everything decided replays.
- **Undo.** Each step's doc writes are one `app.transact('Director: <step> …')`. Sidecar work and trace records are
  not undo entries, as with draft. A record whose transact was undone counts as not applied, and draft's `view` marks
  the step stale.

---

## 7. Eval harness (`trackers/eval/director_*.py`, outputs in `trackers/eval/out/director/`)

**Constraint: gold frames are never viewed.**
- Everything is numeric.
- Frames reach only `director.ask` and `motion.*`, decoded in-process and never written.
- `--brain agent` with images is refused unless `PAWSCRIPT_GOLD_IMAGES=owner-approved`. Without that, the agent is
  benchmarked text-and-stats only.

### Files

- `director_requests.py` builds the same `DecisionRequest` JSON the app sends, from caches only:
  - `cache/clipNN.npz`, through `motion.stats_from_flow`;
  - `clipNN.tags.json` / `tagtl.npz`;
  - the `run_all` scene loops;
  - `stage/survey`;
  - candidate runs from `out/pt/cache` (CoTracker/TAPNext), the `auto_sam` outputs and the `kf_prep` extremes, put
    through the real `motion.compare`.

  It writes `out/director/requests/clipNN.<kind>.jsonl`.
- `director_oracle.py` has the label functions (table below) and the `oracle` brain.
- `director_eval.py` does three things:
  - **Drive.** rules through `node tools/director-agent/brain.mjs --brain rules`; vlm through `director.ask` in a
    `pawtrack serve` under `gpu_lock --gb 8`, with the per-second answers cached to `out/director/vlm/clipNN.<model>.json`;
    oracle in-process.
  - **Chain.** Runs the decide chain through the same node runner (`--chain rules,vlm --calib calib.json`).
  - **Score.** Scores each decision, renders end to end through `node tools/director-agent/render.mjs` (the
    app's own generator, **not** stage `recipes.py`), and scores with `pawtrack.score` the way `run_all.evaluate`
    pools.

### Decision labels

| decision | label | metric |
|---|---|---|
| story: activity | `stage/recipes.oracle_seconds` act flag (reference turn density) | per-second F1 (VLM baseline 0.85), boundary error median |
| story: kind | `oracle_seconds` coarse classes {inactive, active-visible, offscreen, climax, afterglow/outro} | agreement. The act sub-kind is tag-derived (circular), so it is reported and never tuned on. |
| climax | `av_summary.json C_climax.script_events` | onset hit within ±3 s, onset MAE, false climaxes per clip, share queued |
| track | `score` F1 of every cached candidate in the span | regret = F1(best) − F1(picked); reject correctness |
| roi | `pt_seeds` best seeds | seed recall (IoU ≥ 0.3 or point in box); proj F1 gap from proposed points |
| direction | sign maximising `counts_fixed` per (scene, kept run); eval_depth truth (dev 15 / test 29) | accuracy, coverage, accuracy at coverage, weighted by stroke count |
| depth | reference p5/p95 per span | MAE(lo), MAE(hi) |
| camera | none | end-to-end ΔF1 with camera forced to `static`; the camera-share gate's AUC against "candidate F1 < 0.45" |
| verify | injected faults on otherwise oracle decisions: flip the sign, shift the climax ±10 s, swap in the worst candidate, mark an active span idle | detection rate per fault, false alarm rate on clean spans |

### Reports

`out/director/<variant>/report.txt` plus `scores.json`. Each report has:
1. one table per decision, with every brain as a row (accuracy, coverage, cost in ms and questions per scene);
2. calibration: reliability bins and ECE, with leave-one-clip-out Platt `{a,b,n,ci95}` written to
   `out/director/calib.json`, which BRAINS checks in as `src/lib/director/calib.json`;
3. end to end: `f1`, `f1_fixed_sign`, `r_pos` and `mae` for the variants `rules`, `rules+vlm`, `+bonsai`, and
   `+oracle-user` (queued decisions answered by the oracle);
4. **oracle-for-X ablation:** ΔF1 when exactly one decision is replaced by the oracle;
5. **F1 against user questions,** sweeping the thresholds. This is the headline.

Anchors from `eval/out/stage/report.txt`:

| variant | f1 / f1_fixed_sign |
|---|---|
| flow | 0.549 / 0.519 |
| keyframe | 0.602 / 0.548 |
| rules | 0.605 / 0.554 |
| qwen-2b stage | 0.612 / 0.556 |
| oracle recipes | 0.643 / 0.591 |
| oracle recipes + sign | 0.644 / 0.657 |

The expected win is in `f1_fixed_sign`, through direction questions.

### Trace-2 regression (the trace-2 clip is owner-approved and outside the gold set; FEATURE's test)

The fixture is `test/director-trace2.fixture.json`, built from the trace JSON plus the 28 ghosts and scene results in
the trace-2 project file. `test/director-replay.test.mjs` runs the pipeline on the harness with the `replay` brain:
- it must reproduce the 8-segment plan: kinds, boundaries within 50 ms, `source` run25 on segments 1–2 and run21 on
  segment 3;
- the generated stroke script must score F1 ≥ 0.98 against the trace-2 script, with the point count within ±2%;
- it must have 0 generate errors.

With the rules brain the same test **reports** (it does not fail) which decisions agree with trace 2. The target
is: camera 4/4; track for s0/s1 (keep run25/run21, reject lk_box and whole frame); rules abstain on s2 offscreen
and on the s3 climax.

---

## 8. Ownership (four builders)

| builder | owns | must not touch |
|---|---|---|
| **1 SIDECAR** | `trackers/pawtrack/serve.py`, `director.py`, `frames.py`, `motion.py`, `vlm_worker.py`; additive edits in `cli.py` (lift the dispatch dict to module level as `COMMANDS`, register the 5 commands, the `serve` argv branch) and in `trackers/pawtrack/trackers/sam2_mask.py` (the predictor cache only); `trackers/pyproject.toml` (an additive `vlm` extra, only after measuring); `trackers/tests/test_serve_*.py` (also `test_motion_*.py`, `test_frames_*.py`); additions to `trackers/PROTOCOL.md` and `trackers/README.md` | src/**, eval, experiments |
| **2 FEATURE** | `src/features/director/**` except `brains/` and this file's eval section; `test/director-*.test.mjs`, `test/director-fake-sidecar.mjs`, `test/director-trace2.fixture.json`; `dev/director.html`, `dev/director.js`; hooks H1–H3 in `src/features/draft/` | tracking, timeline, assist, lib (other than importing them) |
| **3 BRAINS** | `src/features/director/brains/**` (`index.js`, `rules.js`, `vlm.js`, `agent.js`, `user.js`, `replay.js`); `src/lib/director/**` (`decisions.js`, `decide.js`, `trace.js`, `calib.js`, `viterbi.js`, `checks.js`, `digest.js`, `calib.json`, this README); `tools/director-agent/*.mjs` (`brain.mjs`, `render.mjs`, `answer.mjs`) plus `tools/director-agent/README.md`; `test/director-brains-*.test.mjs` | the store, steps, UI, sidecar |
| **4 EVAL** | `trackers/eval/director_requests.py`, `director_oracle.py`, `director_eval.py`; `trackers/eval/out/director/**` | pawtrack (imports only), src |

The `test/director-*` prefix is shared by FEATURE and BRAINS. BRAINS uses `test/director-brains-*` and FEATURE uses
everything else.

### Build order (contract-first; each builder stubs what it lacks)

1. **BRAINS** lands `src/lib/director/{decisions,digest,decide,trace}.js` first, because FEATURE imports them.
   FEATURE meanwhile codes against the README signatures with a stub brain.
2. **SIDECAR** lands `motion.stats`, `motion.compare` and `frames` one-shot, then `motion.propose`, then
   `director.ask`, then `serve`. FEATURE's fake sidecar implements the README shapes from day one.
3. **FEATURE** lands the draft hooks, the store, the steps on the fake, then the UI, then the replay regression.
4. **EVAL** lands the request builder and oracle on caches first. It scores rules as soon as `tools/director-agent/brain.mjs`
   exists and vlm as soon as `director.ask` exists, then writes calib.json, and BRAINS picks it up.

---

## 9. Risks

1. **Local brains are weak exactly where Opus used vision** (direction, climax, clicks).
   - `motion.propose` is unproven until its eval runs. If it misses, s0-type scenes fall to rules-quality regions
     and verify sends them on to the agent or user.
   - Expect 2–4 questions on easy clips and 5–10 on hard ones. Do not lower thresholds to hide that.
2. **Small gold set.**
   - 78 scenes and 10 clips. Direction test n=29 gives about ±0.17.
   - Kind sub-labels are circular, and there are no camera labels at all.
   - Differences under about 0.01 F1 are noise. Calibration may not transfer. The UI shows n.
3. **End-to-end F1 hardly moves with story decisions** (0.60–0.64). Story quality is judged by the per-decision
   tables and the owner's review of exported traces, not by F1.
4. **Cost on a shared GPU.**
   - Tracking dominates: trace 2 saw cotracker at 50–190 s per run, with 23.8 of 24.5 GB already in use.
   - So: at most 3 subject probes plus 1 reference per span, a digest cache, one GPU job at a time, and an ETA from
     measured `progress()`.
   - A realistic director run is 3–6 min on a shared GPU, not the ~100 s that an unshared GPU would give.
5. **One-shot overhead.** Until N1 lands, each call pays uv start plus imports (1–2 s) and the VLM load per scene
   (≈6 s). Batching keeps this to about 1 min per video. `serve` removes it once the Rust session exists.
6. **Provisional answers can ship.** The export warns and the trace marks them.
7. **Privacy surface.** The mailbox holds frames of the user's video on disk. It is listed for API.md (N2), keeps
   the last 10 sessions and is cleared on reset. If an agent is remote, frames leave the machine, so the panel says
   so before the first agent session. The gold set never reaches `frames`.
8. **Build mismatch.** The live window in Pawscript-live runs older generate code. Test only in this tree through
   `dev/director.html` or `dev/test-app.mjs`, and never touch ports 5173/9477.
