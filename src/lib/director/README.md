# Director contract (v1)

This is the contract the four director builders code against. The design and rationale are in
`src/features/director/DESIGN.md`. **Add fields, never rename or remove them.** A breaking change bumps `v` and
requires an edit here first.

Schema id: `pawscript.director/1`. Every JSON object below is plain JSON: no typed arrays, no `undefined`, no NaN.
NaN in a series becomes `null`.

## 1. Conventions

- **Time.** `Ms` is an integer number of milliseconds from the video start. A span is half-open, `[t0, t1)`.
- **Position.** pos 0 = deepest, 100 = out. A sign of `+1` means "as tracked" and `-1` means mirrored (`pos → 100 − pos`).
- **Coordinates.** Normalized 0..1, with the origin at the top-left of the full frame. `Box = {x, y, w, h}`.
- **Ids.**
  - A decision id is `` `${kind}:${scope}` ``, where scope is `v` for the whole video, `s${i}` for a scene, or
    `s${i}@${t0}` for a span. Examples: `camera:s1`, `track:s0@4500`, `climax:v`.
  - Re-deciding replaces the record with the same id (the old one is kept as `supersedes`).
  - A run id is a tracking ghost id (`runN`). A probe id is the digest of `{tracker, roi, params, t0, t1}`.
- **Confidence.** A brain reports `raw` in 0..1. `decide()` maps it to `conf` through calibration (§5). Agent and
  user confidences are never calibrated: `calibrated:false`.

## 2. Shared types (JSDoc in `src/lib/director/decisions.js`)

```ts
type Ms = number;
type Box = {x:number, y:number, w:number, h:number};
type Roi = {kind:'box', x:number, y:number, w:number, h:number} | {kind:'points', points:[number,number][]} | null;
type Scope = {scene:number|null, t0:Ms, t1:Ms, seg?:string};          // seg = plan segment id when known
type FrameRef = {t:Ms, roi?:Box, label?:string, overlay?:string /* runId */};

interface CameraFacts {                       // motion.stats per scene (§8.2), camelCased
  mode:'static'|'rides'|'move'|'sway'; p95Px:number; zoomPct:number; rateHz:number|null; phaseMs:number|null;
  moveSpans:[Ms,Ms][]; strokeLock:{rateHz:number, cv:number, phaseMs:number}|null;
}
interface SceneFacts {
  i:number; t0:Ms; t1:Ms;
  describe:{acts:string[], parts:string[], knot:boolean, count:string|number, views:string[], rating:string|null,
            boxes:{tag:string, box:Box, score:number}[], cumOnsetMs:Ms|null} | null;   // null = describe off/failed
  loop:{periodMs:number|null, prominence:number, confidence:number, held:number} | null;
  camera:CameraFacts|null;                    // null before survey
  energy:{t:Ms[], v:number[]};                // 1 Hz
  still:[Ms,Ms][];
  heat:number[][];                            // 8x8, camera removed, row-major from top
  seconds:{t:Ms, bright:number, black:boolean, creditsLike:number}[];
}
interface FactSheet { video:{path:string, dur:Ms, fps:number, w:number, h:number}; scenes:SceneFacts[] }
interface RunStat {                           // motion.compare per series, camelCased (§8.3)
  id:string; role:'subject'|'reference'|'base'; tracker:string; channel:string;
  turns:number; turnsPerS:number; halfCv:number; coverage:number; gaps:[Ms,Ms][]; cycleMs:number|null;
  vsLoop:number|null; cameraShare:number|null; cameraOffsetMs:number|null;
}
interface PairStat { a:string; b:string; corr:number; match:number; medianOffsetMs:number }
```

## 3. Decision kinds

`KINDS = ['camera','climax','story','roi','track','direction','depth','verify']`, in dependency order. The value
shapes:

```ts
type Value = {
  camera:    {mode:'static'|'rides'|'move'|'sway', p95Px:number, rateHz:number|null, phaseMs:number|null,
              moveSpans:[Ms,Ms][], valid:('single'|'relative'|'rate')[]},
  climax:    {window:{t0:Ms, t1:Ms}|null, afterglowTo:Ms|null},   // window = the ORGASM (kind id kept)
  story:     {segments:{t0:Ms, t1:Ms, kind:KindId, visible:boolean, action:'continues'|'stops'|'unknown',
              intensity:number, recipe?:string, params?:object, name:string}[]},   // tiles [scene.t0, scene.t1)
  roi:       {probes:{id:string, tracker:string, roi:Roi, params:object, role:'subject'|'reference',
              part:string, channel?:string}[], none?:'offscreen'|'camera'|'still'},   // 0..5 probes
  track:     {keep:string|null, channel?:string, agree:string[], reject:Record<string,string>,
              fallback?:{recipe:string, params:object}},
  direction: {sign:1|-1|0, pairs:{deep:Ms, shallow:Ms}[]},                         // 0 = can't tell / unobservable
  depth:     {lo:number, hi:number, intensity:number},                              // lo/hi 0..100, lo = deep end
  verify:    {verdict:'ok'|'redo', redo?:'story'|'roi'|'track'|'direction'|'depth',
              checks:{id:string, ok:boolean, value:number|string|null, limit:string}[], note:string},
};
type KindId = 'idle'|'fade-in'|'foreplay'|'oral'|'penetration'|'knotting'|'climax'|'orgasm'|'afterglow'|'outro'|'offscreen'|'custom';
// climax = the fast run-in before the orgasm (story adds it from CLIMAX_FIT), orgasm = the climax decision's window
```

The default for each kind, used when no brain answers (`DEFAULTS[kind](req) -> Value`, status `fallback`):

| kind | default |
|---|---|
| camera | `static` with `valid` = all three |
| climax | `null` |
| story | the draft RULES row for the scene (`kindForSummary`) |
| roi | lk_box on the act tag box, or the whole frame |
| track | `keep:null` with the kind's default recipe |
| direction | sign 0, which leaves the run as tracked |
| depth | recipe lo/hi, intensity 1 |
| verify | `ok` with `note:'unchecked'` |

`validate(kind, value) -> string|null` returns the first problem it finds, or null. It is used at every trust
boundary: agent answers, user overrides and replay. It checks:
- types and enum membership;
- that times fall inside the scope;
- that story segments tile the scene with no gaps or overlaps and length ≥ 250 ms;
- that `keep`, `agree` and `reject` ids are among the request's runs;
- that the probe count is at most 5;
- that a `channel` is allowed by `camera.valid`;
- that each `deep`/`shallow` pair lies inside the scope.

Channel classes for `valid`: `relative` = `dist01`, `area`, `len_over_width`; `single` = every other channel;
`rate` = turn timing only, with no phase claimed.

## 4. Request, answer, brain (`src/lib/director/decisions.js`, `decide.js`)

```ts
interface DecisionRequest<K> {
  schema:'pawscript.director/1'; id:string; kind:K; scope:Scope;
  attempt:number;                 // 0; +1 per verify redo of this id (max 2)
  round:number; maxRounds:number; // agent need-loop rounds (round 0 first)
  question:string;                // plain language, self-contained (for agent and user)
  facts:{scene?:SceneFacts, video?:FactSheet['video'], camera?:Value['camera'], climax?:Value['climax'],
         segment?:Value['story']['segments'][number], runs?:RunStat[], pairs?:PairStat[],
         candidates?:ProposeCandidate[], pickPairs?:{a:{at:Ms,pos:number}, b:{at:Ms,pos:number}}[],
         review?:{errors:number, warnings:number, notes:string[]}, checks?:Value['verify']['checks']};
  frames?:FrameRef[];             // references only; pixels come only through Tools / the mailbox sheets
  deps:string[];                  // decision ids this request read
  prior?:{value:any, brain:string};  // the answer a verify redo rejected
  evidence?:Evidence[];           // grows during the agent need loop
  choices?:string[];              // fixed choices when the decision is VLM-askable (first tokens differ)
}
interface Evidence { id:string; type:'image'|'stats'|'text'; what:string; path?:string; data?:any;
                     tiles?:{t:Ms, x:number, y:number, w:number, h:number, label:string}[]; source?:string }
interface BrainAnswer {
  id:string; round?:number;
  value?:any; need?:ToolCall[]; abstain?:string;      // exactly one of value | need | abstain
  raw?:number;                                        // brain's own confidence in value, 0..1
  p?:Record<string,number>;                           // optional distribution (VLM, rules per-choice)
  rationale?:string; evidence?:string[];              // ids of Evidence used / short facts cited
  cost?:{ms:number, questions?:number, frames?:number};
}
interface Brain {
  id:string;                                // 'rules' | 'vlm:qwen3.5-2b' | 'vlm:bonsai-q1' | 'agent' | 'user' | 'replay'
  kinds:string[];                           // decision kinds it may answer
  available(ctx:BrainCtx):Promise<boolean>; // false = skipped in the chain (recorded)
  decide(reqs:DecisionRequest<any>[], ctx:BrainCtx):Promise<BrainAnswer[]>;   // batched; same order as reqs
}
interface BrainCtx { signal:AbortSignal; service:Service; tools:Tools|null; note(text:string):void; now():number }
interface Service { call(request:object, o?:{onEvent?(e:object):void, signal?:AbortSignal}):Promise<{result?:object, error?:string, cancelled?:boolean}> }
```

The brain registry lives in `src/features/director/brains/index.js`:

```ts
export function makeBrains(opts:{vlmModel?:string, agentRoot?:string|null, cdp?:boolean}):Record<string,Brain>;
```

- `rules` and `replay` are always present.
- `vlm` is present when `opts.vlmModel` is set.
- `agent` is present when the mailbox root or CDP is enabled.
- `user` is always present. Its `decide` never resolves a value: it returns `{abstain:'queued'}`, and `decide()`
  then enqueues the request.

## 5. Policy, decide, calibration

```ts
// src/lib/director/decisions.js
export const POLICY = {
  camera:    {tau:0.80, chain:['rules','agent','user']},
  climax:    {tau:0.85, chain:['rules','vlm','agent','user']},
  story:     {tau:0.75, chain:['rules','vlm','agent','user']},   // rules+vlm combine (see below)
  roi:       {tau:0.70, chain:['rules','agent','user']},
  track:     {tau:0.75, chain:['rules','agent','user']},
  direction: {tau:0.90, chain:['rules','agent','user']},         // no vlm: measured below flow
  depth:     {tau:0.60, chain:['rules']},
  verify:    {tau:0.80, chain:['rules','agent','user']},
};
export const PRESETS = {               // settings.preset -> brains enabled (chains are filtered by this)
  rules:['rules'], 'rules+vlm':['rules','vlm'], 'rules+vlm+agent':['rules','vlm','agent'], ask:['rules','vlm','agent','user'] };
// chainFor = (override chain ?? POLICY chain) filtered to PRESETS[preset] ∪ (askUser !== false ? ['user'] : []),
// order kept; 'replay' is never in a chain (decide() checks it first). verify additionally skips, per span, the brain
// that decided that span's direction (passed through o.skip).
export function chainFor(kind, settings):string[];
export const DEFAULTS:Record<string,(req)=>any>;
export function validate(kind:string, value:any):string|null;

// src/lib/director/digest.js
export function digest(x:any):string;  // stable: keys sorted, numbers as JSON; cyrb53 -> 14 hex chars; no deps
export function requestDigest(req, depValues:Record<string,any>, brainVersion:string):string;
     // hashes {kind, scope, attempt, facts, frames, choices, prior, deps' values, brainVersion}; not evidence/round

// src/lib/director/calib.js
export function calibrate(table, brain:string, kind:string, raw:number):{conf:number, n:number, calibrated:boolean};
     // table = calib.json {[brain]:{[kind]:{a,b,n,ci95}}}; conf = 1/(1+exp(-(a*logit(raw)+b))); missing -> raw, calibrated:false

// src/lib/director/decide.js
export async function decide(reqs:DecisionRequest<any>[], o:{
  brains:Record<string,Brain>, settings:Settings, calib:object|null,
  records:Record<string,TraceRecord>,          // replay cache (by id; hit only if digest equal and status != 'superseded')
  overrides:Record<string,{value:any, at:number}>,   // user answers by decision id
  skip?:Record<string,string[]>,               // per id: brains to skip (verify redo: the prior's brain)
  ctx:BrainCtx, budget:Budget,
  enqueue(req:DecisionRequest<any>, provisional:Decision):void,   // user queue (non-blocking)
}):Promise<Decision[]>;

interface Decision { req:DecisionRequest<any>; value:any; conf:number; calibrated:boolean; brain:string;
  status:'decided'|'provisional'|'queued'|'user'|'replayed'|'fallback'|'abstain';
  chain:{brain:string, raw?:number, conf?:number, abstain?:string, skipped?:string, ms:number}[];
  rationale:string; tools:ToolRecord[]; digest:string; ms:number }
interface Settings { preset:keyof typeof PRESETS; askUser:boolean; vlmModel:string|null; agentRoot:string|null;
  cdp:boolean; override?:Record<string,{tau?:number, chain?:string[]}>; deadlineMs:number /*600000*/;
  maxRounds:number /*3*/; budget:{tracks:number /*12*/, gpuS:number /*900*/, images:number /*60*/} }
type Budget = Settings['budget'] & {used:{tracks:number, gpuS:number, images:number}};
```

How `decide()` resolves each request, in order:
1. **Override.** If one exists, the result is status `user`, conf 1.
2. **Replay.** If the record with the same id has an equal `digest`, the result is `replayed` with the stored value
   and status kept.
3. **The chain.** Brains are tried in `chainFor(kind)` order, skipping unavailable ones and the ones in `skip[id]`.
   Each brain gets one batch of all still-unresolved requests.
   - **story combine.** `rules` and `vlm` are both asked, and their per-second log-scores (`p` per second, packed in
     `value.evidence`) are summed and decoded once with `viterbi(…, 4)`. The combined answer's `raw` is the mean
     posterior. `chain[]` records both brains.
   - **Acceptance.** `conf = calibrate(...)`. If `conf ≥ tau` (tau = `settings.override[kind].tau ?? POLICY[kind].tau`),
     the result is `decided`.
   - **agent** (the agent brain owns this loop):
     - It awaits up to `deadlineMs`.
     - A `need` answer makes it run `tools.run(call)` for each call, within `budget`, append the Evidence, and
       re-ask with `round+1` until `maxRounds`.
     - Over budget, or past the rounds, it abstains with `'budget'`.
     - Its answers are `calibrated:false`, with conf = `min(raw, 0.95)`.
   - **user.** The request is enqueued. The result is status `queued`, and its value is the best answer seen so far
     (highest conf in `chain`), else `DEFAULTS`. `provisional` is set to true in the record.
4. **Nothing answered and no user.** The result is the best answer seen so far with status `provisional`, else
   `DEFAULTS` with status `fallback`.
5. **Validation.** Every value passes `validate`. An invalid brain answer counts as `abstain:'invalid: …'`.

## 6. Trace record and the `director` project block (`src/lib/director/trace.js`)

```ts
interface ToolRecord { call:ToolCall; result:object; ms:number; round:number }
interface TraceRecord {
  id:string; session:string; kind:string; scope:Scope; attempt:number; digest:string;
  question:string; inputs:{deps:string[], frames:FrameRef[], facts:string /* one-line summary */};
  chain:Decision['chain']; brain:string; value:any; conf:number; calibrated:boolean;
  status:Decision['status']; provisional:boolean; rationale:string; tools:ToolRecord[];
  applied:{label:string, entry:string|null /* undo entry id */, effects:string[]}|null;
  supersedes:TraceRecord|null; verifiedBy:string|null; at:number /* epoch ms */; ms:number;
}
export function toRecord(d:Decision, o:{session:string, applied?:TraceRecord['applied'], prev?:TraceRecord}):TraceRecord;
export function toTrace2(video:object, records:TraceRecord[]):{video:object, trace:{stage:string, inputs:object,
  decision:object, rationale:string, confidence:number, time_ms:number}[]};   // stage = STAGE_OF[kind] + scope
export function fromTrace2(json:object):{replay:Record<string,{value:any, rationale:string, conf:number}>, warnings:string[]};
export const STAGE_OF = {camera:'survey.base_and_camera', climax:'story.climax', story:'story.plan', roi:'tracking.runs',
  track:'tracking.compare', direction:'direction', depth:'depth', verify:'verify'};
```

The project block (`app.registerBlock('director', {save, load})`):

```ts
{ v:1, session:string /* 'dr-YYYYMMDD-HHMMSS' */, settings:Settings,
  records:Record<string,TraceRecord>,           // by decision id (current), each with its supersedes chain
  overrides:Record<string,{value:any, at:number}>,
  queue:string[] }                               // decision ids waiting for the user, oldest first
```

The block never holds images. `load(null)` resets the block to empty.

## 7. External agent: tools, mailbox, CDP

### 7.1 ToolCall (the need loop)

```ts
type ToolCall =
 | {tool:'frames', times?:Ms[], t0?:Ms, t1?:Ms, stepMs?:Ms, crop?:Box|null, grid?:0.1|0.25|null, cols?:number, height?:number}
 | {tool:'pairs', run:string, t0:Ms, t1:Ms, k?:number}            // blind A/B sheets of pickPairs extremes; no pos shown
 | {tool:'overlay', run:string, times:Ms[]}                         // frames with the run's frames.ov drawn
 | {tool:'track', tracker:string, roi:Roi, params?:object, t0:Ms, t1:Ms, role?:'subject'|'reference', part?:string}
 | {tool:'compare', runs:string[], t0:Ms, t1:Ms, channels?:Record<string,string>}
 | {tool:'camera', boxes:Box[]|null, t0:Ms, t1:Ms}                  // motion.stats with explicit reference boxes
 | {tool:'channel', run:string, channel:string};
interface Tools { run(call:ToolCall, o:{reqId:string, round:number}):Promise<{evidence:Evidence[], result:object}> }
```

Budget accounting:
- `track` costs 1 track, plus the measured GPU seconds.
- An image tool costs 1 image per written image.
- Over budget, the tool returns `{result:{error:'budget'}}`.
- `pairs` writes one sheet per pair, with tiles labelled `A`/`B` in an order randomised by the app. The mapping is
  kept in the app (`Evidence.data.order` is withheld from the agent's copy). An agent answers a pair-based
  `direction` or `verify` as `{pairs:[{deep:Ms, shallow:Ms}]}`, and the app reads the times back from the tile
  labels it assigned.

### 7.2 Mailbox (file transport)

The root is `settings.agentRoot`, default `<app_paths().data>/director`.

```
<root>/<session>/
  session.json   {schema, session, status:'running'|'paused'|'done'|'stopped', heartbeat_ms,
                  video:{path,name,dur_ms,fps,w,h}, conventions:{pos:'0=deepest,100=out'},
                  protocol:'<abs path of tools/director-agent/README.md>'}
  facts.json     FactSheet (rewritten when it changes)
  req/<id>.json  DecisionRequest (current round; `round` inside)   req/<id>/*.jpg  its images (Evidence.path relative to <session>)
  ans/<id>.json  BrainAnswer written by the agent: write ans/<id>.json.tmp, then rename. Must echo id and round.
  ans/<id>.working      optional heartbeat (any content; mtime shown in the panel)
  ans/<id>.error.json   {id, round, error} written by the app when validation fails; the agent rewrites the answer
  trace.jsonl    one TraceRecord per line, append-only mirror
```

Rules for the mailbox:
- **Polling.** The app polls `listDir(ans)` every 500 ms while requests are pending, and ignores `*.tmp`.
- **Stale rounds.** An answer for a stale round is ignored.
- **Stop.** On stop, `session.json.status` becomes `stopped` and the pending `req/` files are deleted.
- **Retention.** The app keeps the last 10 sessions.

### 7.3 CDP surface (`window.app.director`, present when `window.app` is exposed)

```ts
pending():DecisionRequest<any>[];                      // agent-routed and user-queued requests
answer(id:string, a:BrainAnswer):string|null;          // validates; null = accepted, else the error text
sheet(id:string):Promise<{images:{path?:string, b64?:string, tiles:Evidence['tiles']}[]}>;
trace():TraceRecord[];
run(opts?:{from?:string}):Promise<void>; cancel():void;
```

### 7.4 Reference tools (`tools/director-agent/`, node, no deps)

| command | contract |
|---|---|
| `node tools/director-agent/brain.mjs --brain rules [--chain rules,vlm --calib <json> --vlm-answers <json>]` | stdin: DecisionRequest JSONL. stdout: one `{id, decision:Decision}` per line, the same order. `--chain` runs `decide()` with the stub brains replaying cached VLM answers. |
| `node tools/director-agent/render.mjs <plan.json> <runs.json> [--max-speed 450]` | `plan.json` is a plan segment array as `importTimeline` returns it, with `source`. `runs.json` is `[{id, script:[{at,pos}], range:{t0,t1}}]`. stdout: `{script:[{at,pos}], issues:[…]}`, through `planCtx` plus `generatePlan` from `src/features/timeline/generate-logic.js` with `src/lib/gen/plan.js`. |
| `node tools/director-agent/answer.mjs <session dir> --policy rules\|replay <trace.json>\|prompt` | watches `req/` and answers as described in §7.2. `prompt` prints the request and image paths, then reads one JSON answer from stdin. |

## 8. Sidecar commands (one-shot and serve)

Every command is `cmd_x(req, emit) -> dict` in `trackers/pawtrack/cli.py COMMANDS`. One-shot use is unchanged:
one request on stdin, then JSONL events, then `{"type":"result", …}` or `{"type":"error","message"}` with exit 1.
The progress event is `{"type":"progress","done":n,"total":m}`. Every `video` path is absolute.

### 8.1 `frames`

```json
{"cmd":"frames","video":"…","jobs":[
  {"dest":"<abs path>.jpg" | null, "times_ms":[…] | null, "t0":0, "t1":0, "step_ms":500,
   "crop":{"x":0,"y":0,"w":1,"h":1} | null, "grid":0.1 | null, "cols":4, "height":240,
   "labels":"time" | "time+pos" | "AB" | "none", "pos":[…] | null, "tile_labels":["A","B"] | null,
   "overlay":[{"t_ms":0,"points":[[x,y]],"boxes":[[x,y,w,h]]}] | null, "quality":85}]}
→ {"type":"result","images":[{"dest":"…"|null,"b64":"…"|null,"w":0,"h":0,
     "tiles":[{"t_ms":0,"x":0,"y":0,"w":0,"h":0,"label":"…"}]}]}
```

- **Times.** Either `times_ms` or `t0`/`t1`/`step_ms`. The nearest frame at or before each time is used.
- **Output.** `dest:null` returns base64 JPEG. Otherwise the JPEG is written atomically (tmp then `os.replace`).
- **Gold guard.** Any `video` with a path component equal to `Reference` (case-insensitive) is an error:
  `"frames: gold-set video, images disabled"`.

### 8.2 `motion.stats`

```json
{"cmd":"motion.stats","video":"…","ranges":[{"start_ms":0,"end_ms":26489}],
 "params":{"width":320,"fps":15,"grid":8,"border":0.12,"boxes":null}}
→ {"type":"result","ranges":[{"start_ms":0,"end_ms":26489,
    "camera":{"mode":"static","p95_px":1.5,"zoom_pct":0.2,"rate_hz":null,"phase_ms":null,"move_spans":[],
              "stroke_lock":null},
    "global":{"hz":15,"dx":[…],"dy":[…],"zoom":[…]},
    "energy":{"t":[…],"v":[…]}, "still":[[t0,t1]], "heat":[[…8…]×8],
    "seconds":[{"t":0,"bright":71.2,"black":false,"credits_like":0.02}]}]}
```

- **Units.** `dx`/`dy` are full-resolution pixels per frame step, accumulated.
- **`boxes`** are explicit reference boxes (the agent's `camera` tool). When it is null, the border ring and the 4
  corners are used.
- **`stroke_lock`** is `{"rate_hz","cv","phase_ms"}` when global motion has a periodic part.
- **`mode`** uses DESIGN §4.2's thresholds. The raw fields are always returned, so rules can re-threshold.
- **Pure core** (importable by the eval): `pawtrack.motion.stats_from_flow(t_ms, block_flow, thumbs, params) -> dict`,
  the same shape as one entry of `ranges`, minus the full-resolution refinement.

### 8.3 `motion.compare` (pure)

```json
{"cmd":"motion.compare","t0":26489,"t1":40444,"loop_period_ms":778,"match_ms":120,
 "series":[{"id":"run21","role":"subject","tracker":"tapnext_points","channel":"dist01","t":[…],"v":[…]}],
 "camera":{"t":[…],"dx":[…],"dy":[…]} | null}
→ {"type":"result","series":[{"id":"run21","turns":70,"turns_per_s":2.51,"half_cv":0.07,"coverage":1.0,
     "gaps":[],"cycle_ms":788,"vs_loop":1.01,"camera_share":0.12,"camera_offset_ms":177}],
   "pairs":[{"a":"run21","b":"run22","corr":0.91,"match":0.83,"median_offset_ms":44}]}
```

- **Values.** `v` uses `null` for a lost sample.
- **Camera share.** Computed against the turns of the camera series' dominant axis. A run "measures the camera"
  when `camera_share ≥ 0.8 and camera_offset_ms < 60`. The command reports both numbers; the caller applies the
  test.
- **Turns** come from `pawtrack.score`'s turn finder.
- **Pure function** (importable): `pawtrack.motion.compare(series, t0, t1, loop_period_ms, match_ms, camera) -> dict`.

### 8.4 `motion.propose`

```json
{"cmd":"motion.propose","video":"…","start_ms":0,"end_ms":26489,"period_ms":889,
 "boxes":[{"x":0,"y":0,"w":1,"h":1}] | null,"params":{"width":256,"max":3}}
→ {"type":"result","candidates":[{"box":{…},"axis":[0.78,0.6,0.6,0.6],"points":[[x,y],…4],
     "pair":[[x,y],[x,y]] | null,"power":0.41,"cam_corr":0.12}]}
```

The axis runs from x0,y0 to x1,y1 = "in", which matches `tapnext_points` `axis:"custom"` with
`axis_x0, axis_y0, axis_x1, axis_y1`. In JS the candidate is camelCased as `ProposeCandidate {box, axis, points,
pair, power, camCorr}`.

### 8.5 `director.ask`

```json
{"cmd":"director.ask","model":"qwen3.5-2b","quant":"nf4","res":448,"video":"…",
 "items":[{"frames":[{"t_ms":20000,"roi":{…}|null}],"text":"…"}],
 "choices":["yes","no"],"groups":false,"context":"facts: …" | null}
→ {"type":"result","probs":[{"yes":0.81,"no":0.19,"_mass":0.93}],"s":4.1,"load_s":5.7,"model":"qwen3.5-2b"}
```

- **Choices** must differ in their first token, otherwise the request is an error. The prompt is the question plus
  "Answer with exactly one word from: …".
- **Frames** are decoded by reference and never written. Gold videos are allowed here, because the frames only feed
  the model.
- **Model routing.** `model` is one of `qwen3.5-2b`, `qwen3.5-4b`, `bonsai-q1`, `bonsai-heretic-ptq1`,
  `bonsai-heretic-pq2`. The Bonsai models use the owner's llama-server on a private port, killed at the end of the
  request (one-shot) or on idle or unload (serve).
- **No VLM available.** The error is `"director.ask: no VLM (install the vlm extra or set PAWSCRIPT_VLM_PYTHON)"`.

### 8.6 `pawtrack serve` (JSONL session)

Launch: `<pawtrack launcher words> serve`, for example `uv run --project trackers --extra sam2 --extra describe pawtrack serve`.
Optional: `--role describe` (internal child).

```
← {"type":"hello","protocol":"pawtrack-serve/1","pid":1234,"commands":["list","probe",…,"director.ask"]}
→ {"id":"7","cmd":"frames",…}                 any one-shot request + "id" (string)
← {"id":"7","type":"progress","done":3,"total":10}
← {"id":"7","type":"frame",…}                 (track frames, as one-shot)
← {"id":"7","type":"result",…}  |  {"id":"7","type":"error","message":"…","cancelled"?:true}
→ {"id":"c1","cmd":"cancel","target":"7"}     ← {"id":"c1","type":"result","cancelled":true|false}
→ {"id":"c2","cmd":"status"}                  ← {"id":"c2","type":"result","busy":"7"|null,"queued":["8"],
                                                  "resident":[{"kind":"tracker","name":"tapnext_points","mib":2800}],
                                                  "vram_mib":4100,"fraction":0.5}
→ {"id":"c3","cmd":"unload","name":"vlm"|null}   ← {"id":"c3","type":"result","unloaded":[…]}
→ {"id":"c4","cmd":"shutdown"}                ← {"id":"c4","type":"result"} then exit 0;  stdin EOF = shutdown
```

- **Scheduling.** Jobs run one at a time in FIFO order. `cancel`, `status`, `unload` and `shutdown` are answered at
  once, even while a job runs.
- **Malformed input.** A malformed line yields `{"id":null,"type":"error","message":…}` and the session continues.
- **Isolation.** `describe` runs in a resident `serve --role describe` child, because of the Hydra/sam2 clash.
- **VRAM.** `PAWSCRIPT_GPU_FRACTION` is read once. There is one resident GPU tracker model (LRU), and the VLM is
  evicted after 120 s idle. Without a fraction (the app's own resident serve, src-tauri/API.md) a GPU job first
  unloads every resident of another kind, and all residents unload after `PAWTRACK_IDLE_UNLOAD_S` (120 s) idle. Dev and eval runs go under `python trackers/gpu_lock.py --gb N <abs python> -m pawtrack.cli serve`
  with N ≤ 12.

### 8.7 Environment

| variable | meaning |
|---|---|
| `PAWSCRIPT_GPU_FRACTION` | per-process VRAM fraction (existing) |
| `PAWSCRIPT_VLM_PYTHON` | interpreter for `vlm_worker.py` when transformers is not importable; default `trackers/experiments/vlm/.venv/Scripts/python.exe` if it exists |
| `PAWSCRIPT_LLAMA_SERVER` | path to llama-server.exe for Bonsai (default: the owner's LM Studio path used by `experiments/stage`) |
| `PAWSCRIPT_GOLD_IMAGES=owner-approved` | the eval allows an agent brain with images on gold; otherwise refused |

## 9. App side (FEATURE)

### 9.1 Store and steps

```ts
// src/features/director/director.svelte.js
export function directorFor(app):Director;  export function peekDirector(app):Director|null;
interface Director {
  settings:Settings; records:Record<string,TraceRecord>; queue:DecisionRequest<any>[]; facts:FactSheet|null;
  status:{step:string|null, scene:number|null, waitingAgent:number, waitingUser:number};
  setSettings(patch:Partial<Settings>):void;
  run(o?:{from?:string}):Promise<void>;            // draftFor(app).setMode('director'), then draft.runAll() / run(from)
  cancel():void;
  redecide(id:string, o?:{brain?:string}):Promise<void>;   // drop record id (and o.brain forces chain [brain]), re-run from its step
  answer(id:string, value:any):string|null;       // user override; validate; re-run from its step; null = ok
  pending():DecisionRequest<any>[];  exportTrace():{json:object, md:string};
}
// src/features/director/steps.js
export function directorSteps(app):Record<'survey'|'story'|'regions'|'compare'|'direction'|'verify',
  (draft, i:number, single:boolean) => Promise<{note:string, facts?:object, entry?:string|null}|{skip:string}|{cancelled:true, note?:string, wrote?:boolean}>>;
export const STEP_OF:Record<string,string>;   // decision kind -> step id: camera:survey, climax/story:story, roi:regions,
                                              // track:compare, direction/depth:direction, verify:verify
```

Ghost tags:
- Probe runs: `director:<probe id>`.
- Kept runs stay visible on stroke. Non-kept director runs are hidden through the `visible` flag in one ghost update
  (not an undo entry, as with ghosts today).
- A probe whose tag already exists as a ghost with a script is reused, not re-tracked.

### 9.2 Draft hooks (exact; nothing else in draft changes)

1. **`draft/logic.js`**:

   ```js
   export const DIRECTOR_STEPS = [
     {id:'scenes',title:'Probe and detect scenes'},{id:'describe',title:'Describe scenes'},{id:'loops',title:'Loop check'},
     {id:'survey',title:'Camera and motion survey'},{id:'story',title:'Director: story'},{id:'regions',title:'Director: regions'},
     {id:'compare',title:'Director: compare trackers'},{id:'direction',title:'Director: direction and depth'},
     {id:'generate',title:'Generate'},{id:'verify',title:'Director: verify'},{id:'assist',title:'Hand-off to assist'},
     {id:'review',title:'Review'}];
   export const stepsOf = (mode) => (mode === 'director' ? DIRECTOR_STEPS : STEPS);
   ```

   `initSteps(list = STEPS)` and `restoreSteps(saved, list = STEPS)` take the list as a parameter. Saved steps
   whose ids do not match the list reset that step.
2. **`draft/draft.svelte.js`**:
   - add `mode = $state('rules')` and `ext = null`;
   - add `get list() { return stepsOf(this.mode); }`;
   - every `STEPS[...]`/`STEPS.length` becomes `this.list[...]`;
   - `exec` calls `this[id] ? this[id](i, single) : this.ext[id](this, i, single)`;
   - add `useSteps(ext) { this.ext = ext; }`;
   - add `setMode(m) { if (!this.busy && m !== this.mode && (m === 'rules' || this.ext)) { this.mode = m; this.steps = initSteps(this.list); } }`;
   - `save()` adds `mode`, and `load(v)` restores `mode` before the steps;
   - `startAssist` and the other behaviour stay unchanged.
3. **`draft/DraftDialog.svelte`**: a two-way "Rules / Director" toggle bound to `setMode`, shown only when
   `draft.ext`.

### 9.3 Commands (`src/features/director/commands.js`, no default keys)

| id | args |
|---|---|
| `director.run` | `{from?, preset?}` |
| `director.show` | – |
| `director.cancel` | – |
| `director.redecide` | `{id, brain?}` |
| `director.answer` | `{id, value}` |
| `director.exportTrace` | `{to?:'file'\|'clipboard'}` |
| `director.setPreset` | `{preset}` |

## 10. Pure helpers (BRAINS, `src/lib/director/`)

```ts
// viterbi.js
export function viterbi(logp:number[][] /* T x K */, switchPenalty?:number /* 4 */):number[];
export function segmentsFrom(labels:number[], names:string[], t0:Ms, stepMs:Ms, t1:Ms):{t0:Ms, t1:Ms, label:string}[];
// checks.js (oracle-free self-checks; used by the rules verify and the panel)
export function verifyChecks(o:{seg:{t0:Ms,t1:Ms}, keep:RunStat|null, others:RunStat[], pairs:PairStat[],
  script:{at:Ms,pos:number}[], loopPeriodMs:number|null, prominence:number, review:{errors:number}|null}):Value['verify']['checks'];
export function planChecks(plan:object[], dur:Ms):string[];   // gaps, overlaps, unknown recipes, orgasm count
```

## 11. Eval files (EVAL)

- **Requests.** `trackers/eval/out/director/requests/clipNN.<kind>.jsonl`: one DecisionRequest per line, built with
  this contract's shapes, `facts` from caches.
- **Answers.** `trackers/eval/out/director/<variant>/answers.jsonl`: `{id, clip, decision:Decision}`.
- **Scores.** `trackers/eval/out/director/<variant>/scores.json`: `{decisions:{[kind]:{[brain]:metrics}},
  e2e:{f1, f1_fixed_sign, r_pos, mae}, ablation:{[kind]:{df1, df1_fixed}}, curve:[{questions, f1, f1_fixed}]}`.
  `report.txt` is the same data as tables.
- **Calibration.** `trackers/eval/out/director/calib.json`: `{[brain]:{[kind]:{a, b, n, ci95}}}`. BRAINS copies it
  to `src/lib/director/calib.json`.
- **CLI.** `uv run --project trackers python trackers/eval/director_eval.py --brain rules|vlm:qwen3.5-2b|oracle|chain:rules,vlm
  --decisions story,climax,track,direction,depth,verify [--clips clip01,…] [--ablate] [--curve] --out <variant>`.
  GPU variants are launched under `gpu_lock.py --gb 8`.
