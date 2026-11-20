# `src/lib/graph/` — node-graph CONTRACT

This file is the contract the four graph builders code against. They work in parallel and cannot talk to
each other, so every signature here is final: **add, never change**. The design and its reasons are in
`src/features/graph/DESIGN.md`. The user guide is `src/features/graph/README.md`.

Conventions used throughout:
- Everything in `src/lib/graph/` is pure ES modules: no DOM, no Svelte, no `import.meta.glob`, no `app`.
- Scripts follow `src/lib/core/script.js`: `{at:int ms, pos:int 0..100}`, strictly increasing `at`,
  **pos 0 = deepest, 100 = out**.
- Values are immutable. Nothing mutates its input. Tests deep-freeze inputs to enforce this.
- Every refusal is a human sentence in a `reason` string. `''` means OK.
- Colours are `SERIES` keys from `src/ui/kit/tokens.js` (`sky, orange, green, yellow, blue, vermilion,
  pink, grey, violet, lime`), never hex. Resolving them to CSS colours happens in features only.
- Param schemas use the dialect of `src/ui/kit/params.js`. Sanitise with its `coerce` / `normalizeValues`.

## 0. Files and owners

| File | Owner | Exports (sections below) |
|---|---|---|
| `types.js` | ENGINE | port types, compat, adapters, signal/spans/script helpers (§2) |
| `model.js` | ENGINE | ids, `defineNode`, `createRegistry`, graph edit functions, history (§1, §3, §4) |
| `eval.js` | ENGINE | `compile`, `validate`, `createCache`, `evaluate`, `evaluateSync`, hashing (§5) |
| `serialize.js` | ENGINE | versioned load/save, `.pawproj` block, `.pawgraph` files (§6) |
| `index.js` | ENGINE | re-exports every public name of all lib/graph files, including nodes, presets and doc |
| `nodes/**` | NODES | `createCatalogue`, `BUILTINS`, wrappers, node definitions (§7) |
| `presets.js` | NODES | `PRESETS` (§8) |
| `doc.js` | INTEGRATION | `makeSources`, bake and preview adapters (§9) |
| `src/features/graph/integration.js` | INTEGRATION | `graphController(app)` (§10) |

Builders' tests import the specific module, never `index.js`, so a sibling file that has not landed yet
cannot break them.

## 1. Graph JSON (version 1)

```js
Graph = {
  v: 1,
  id: 'g…',                       // newId('g')
  name: string,
  rate: 25 | 50 | 100 | 200,       // signal grid in Hz, default 50. dt = 1000/rate ms: 40 | 20 | 10 | 5 (integers)
  nodes: Node[],
  links: Link[],
  frames?: Frame[],                // visual groups only; no effect on evaluation
  lastBake?: { [outNodeId]: { axis: string, key: string, hash: string, time: number } },
  // any other key: preserved untouched
}
Node = {
  id: 'n…',
  type: string,                    // a NodeDef.type. An unknown type is kept verbatim (see §6).
  tv: int,                         // the node type version it was saved with (NodeDef.version)
  x: number, y: number,            // canvas units, snapped to GRID on release
  params: { [key]: value },        // ALL params, defaults included (a library default changing later never changes a saved graph)
  byKind?: { [kind]: { [key]: value } },   // perSpan nodes only: overrides per span kind (§3)
  label?: string | null,           // user title; null = def.title
  muted?: boolean,                 // bypass (§5.6)
  collapsed?: boolean,
  preview?: boolean,               // out.axis only: publish its result as a ghost (default true)
  color?: string | null,           // SERIES key tint
  // any other key: preserved
}
Link  = { id: 'l…', from: nodeId, out: outPortName, to: nodeId, in: inPortName | 'p:<paramKey>' }
Frame = { id: 'f…', title: string, x, y, w, h, color: string | null }
```

Rules:
- One link per input. Wiring a second link into the same input replaces the first. Outputs fan out freely.
- A link into `p:<key>` drives that param (§3, "modulation"). The stored constant stays as the fallback.
- No type is stored on links. Types are resolved by `compile`.
- The view (pan/zoom) and the selection are **not** part of the graph. The editor persists the view in
  `app.settings` key `graph.view.<graphId>`.

## 2. Port types and values (`types.js`)

```js
export const TYPES = {
  script: { label: 'Script', color: 'sky' },
  signal: { label: 'Signal', color: 'green' },
  spans:  { label: 'Spans',  color: 'yellow' },
  number: { label: 'Number', color: 'grey' },
  any:    { label: 'Any',    color: 'violet' },   // type variable, resolved per node by compile (§5.1)
};
```

| type | JS value | invariant |
|---|---|---|
| `script` | `Action[]` | `isValid` (core). |
| `signal` | `{ i0: int, dt: int, v: Float32Array, range?: [lo, hi] }` | Sample `k` is at `t = (i0 + k) * dt` ms. `dt` = the graph's `1000/rate`. **NaN = unknown** (tracker lost, cut, outside a sampled script). Position-like signals are in pos units (0..100, 0 = deep). Confidence, phase and amplitude are 0..1. `range` is a display hint only. |
| `spans` | `Span[]`, `Span = { t0: int, t1: int, kind?: string, label?: string, value?: number, data?: object }` | Sorted by `t0`, then `t1`. Half-open `[t0, t1)`. `t0 === t1` is a **point** (turns, bookmarks, selections, events). Overlaps are allowed. `data` carries the source record (e.g. a plan segment's `{id, recipe, params, intensity}`). |
| `number` | finite JS number | Booleans are numbers 0/1. A non-finite result is an error, never a silent 0. |

### 2.1 Compatibility

```js
compat(from: TypeId, to: TypeId) ->
    { ok: true }                                  // same type, or either side 'any'
  | { ok: true, adapter: 'sample' | 'const' }     // drawn as a diamond badge on the wire
  | { ok: false, reason: string, suggest: string[] }   // suggest = node types that convert
```

| from → to | result |
|---|---|
| same → same | ok |
| `script → signal` | adapter `sample`: linear `posAt` on the grid, NaN outside `[first.at, last.at]`, all-NaN for an empty script. O(n+m) merge walk. |
| `number → signal` | adapter `const`: a filled signal on the grid |
| `signal → script` | refuse. suggest `['sig.toScript', 'sig.sampleAt']` |
| `script → spans` | refuse. suggest `['script.turns', 'script.strokes']` |
| `signal → spans` | refuse. suggest `['spans.threshold']` |
| `spans → signal` | refuse. suggest `['spans.toSignal', 'spans.kindValue']` |
| `script|signal → number` | refuse. suggest `['an.stat']` |
| `spans → script` | refuse. suggest `['flow.switch', 'script.splice']` |
| anything else | refuse, reason names both types |

Param ports follow §3: a `mod:'signal'` param port accepts `signal`, `number` (no adapter) and `script`
(adapter `sample`). A `mod:'number'` param port accepts `number` only.

### 2.2 Helpers (all pure, all exported)

```js
gridFor(range: {t0, t1}, dt) -> { i0, n, dt }       // i0 = floor(t0/dt), n = floor(t1/dt) - i0 + 1
makeSignal(i0, n, dt, fill = NaN) -> Signal
signalAt(sig, t) -> number                          // linear between samples; NaN outside or if a needed neighbour is NaN
sliceSignal(sig, t0, t1) -> Signal                  // subarray view covering [t0, t1] (shares the buffer; values are immutable)
sampleScript(script, grid) -> Signal                // the 'sample' adapter
resampleSeries(t: Float64Array, v: Float32Array, grid, { maxGapMs = Infinity, scale = 1, offset = 0 } = {}) -> Signal
                                                    // irregular series (tracker samples) -> grid; v*scale+offset; NaN where the source is NaN or the gap > maxGapMs
clipScript(script, t0, t1) -> Script                // actions in [t0, t1] PLUS the nearest action outside on each side (keeps interpolation exact)
normSpans(list) -> Spans                            // ints, t0 <= t1 (swapped), sorted; drops non-finite entries
flattenSpans(spans) -> Spans                        // disjoint; where two overlap, the one that starts later owns the overlap (plan semantics); points kept
unionSpans(a, b = []) -> Spans                      // disjoint merge; a merged span keeps the kind/label of its earliest member
intersectSpans(a, b) -> Spans                       // disjoint; kind/label from a
invertSpans(spans, t0, t1) -> Spans                 // the gaps inside [t0, t1)
spanAt(spans, t) -> Span | null                     // on the flattened list; a point matches only t === t0
spansToAts(script, spans) -> Set<int>               // ats inside any span ([t0, t1); a point matches at === t0)
atsToSpans(ats: Iterable<int>, kind?) -> Spans      // sorted points
valueAt(type, value, t) -> number | Span | null     // time-cursor readout: script -> posAt, signal -> signalAt, spans -> spanAt, number -> value
summarize(type, value) -> string                    // default card status: '4 812 pts · 0:00–9:58 · 5–95' | '30 001 smp · 38–92 · 12% gaps' | '14 spans · climax 3, oral 6' | '62.4'
checkValue(type, value) -> ''                       // or a reason (used by the engine on every node output)
bytesOf(type, value) -> number                      // cache estimate: script 40 B/action, signal 4 B/sample, spans 64 B/span, number 8
adapt(adapter, value, grid) -> Value                // applies 'sample' | 'const'
```

## 3. Node definitions (`model.js`)

A node type is one plain object that holds both its declaration and its evaluator.

```js
defineNode(def) -> NodeDef      // validates once and freezes; throws Error('defineNode <type>: <problem>') on a malformed def

NodeDef = {
  type: string,                 // 'group.name'. Stable forever: stored in graphs. Rename = new type + migrate.
  version?: int,                // default 1. Saved as node.tv. migrate() runs when tv < version.
  title: string,
  group: string,                // palette path, segments joined by ' · ', e.g. 'Edit · amplitude'
  icon?: string,                // a kit ICON_NAMES name
  help?: string,                // one or two sentences; shown in search results and the inspector
  aliases?: string[],           // extra search words
  ins: Port[],
  outs: Port[],
  params: Param[],
  variants?: [{ id, title, params, aliases? }],   // palette items that create this type with these params (e.g. gen recipes)
  perSpan?: true,               // the engine adds the optional input `where` (spans) and honours node.byKind (below)
  timeShift?: true,             // the node moves actions in time; downstream spans are not moved (engine adds a 'time-shift' info diag)
  halo?: (p) => number,         // ms of input context needed on each side of a requested range. Default: () => Infinity (global)
  local?: true,                 // output on [a,b] depends only on inputs on [a - halo, b + halo]. Must be proven by the halo test (§11)
  reads?: (p) => [kind, ref?][],// SOURCE nodes only: the document values it depends on (§9). Their identities enter the cache key
  bypass?: { [outName]: inName },   // muted mapping. Default: each output takes the first input of the same type
  migrate?: (params, fromVersion) => params,
  summary?: (outs, p) => string,    // card status line; default summarize() of the first output
  eval(inputs, p, ctx) -> { [outName]: Value },   // synchronous, pure; see below
}

Port = {
  name: string,                 // unique among ins (resp. outs). 'where' and names starting 'p:' are reserved
  type: 'script' | 'signal' | 'spans' | 'number' | 'any',
  label?: string,
  required?: boolean,           // ins only; default false
  accepts?: TypeId[],           // for type 'any': the allowed concrete types (default all four)
  hint?: 'points',              // spans that are points: the editor draws a distinct socket glyph
}

Param = kit params.js Param   // { key, label, type, default, min?, max?, step?, unit?, choices?, group?, hint?, control? }
      & {
  mod?: 'number' | 'signal',    // can be driven by a link into port 'p:<key>' (number-typed params only)
  inline?: boolean,             // shown on the node card (else only in the inspector). Default: first two numeric params
  hidden?: boolean,             // never shown (internal)
  seed?: true,                  // set to a fresh random int when the node is created (stored; duplicates copy it)
  editor?: 'axis' | 'ghost' | 'run' | 'channel' | 'kinds' | 'kindTable' | 'expr' | 'script' | 'spans' | 'shape' | 'color',
}
```

Param `type` is one of `number | float | int | bool | choice` (sanitised by kit `coerce`) or a type the kit
does not know (`text`, `shape`, `json`, `list`), which passes through `coerce` unchanged. A node must tolerate
any JSON value in those. `editor` picks a custom widget: `axis` (AXES ids), `ghost` / `run` (pickers from
`sources.list`), `channel` (the selected run's channel names), `kinds` (multi-select of plan kinds, value
`string[]`), `kindTable` (rows per kind, value `{ [kind]: number | [lo, hi] }`), `expr` (text with live
parse errors), `script` / `spans` (small embedded editors for `const.*`), `shape` (gen shape dropdown),
`color` (SERIES picker).

### 3.1 `eval(inputs, p, ctx)`

- `inputs[name]`: values already adapted to the declared type. An optional input that is not connected is
  `undefined`. For `any` ports the value is of the resolved type.
- `p`: every param coerced, plus, for linked `mod:'number'` params, the linked number (coerced by the
  schema). For a linked `mod:'signal'` param, `p[key]` stays the stored constant and `ctx.param(key)`
  gives the time function.
- Returns an object keyed by output name. A missing key = no value on that output.
- Throwing an `Error` is the error path: its message becomes the diagnostic. Never return NaN silently.
- No `Date`, no `Math.random`, no globals: use `ctx.rng()`.

### 3.2 The evaluation context `ctx`

```js
ctx = {
  range:   { t0, t1 },          // the time range this node must produce correct output on (ms, inclusive)
  full:    { t0: 0, t1: durationMs },
  window:  boolean,             // true when range is a preview window rather than the full timeline
  durationMs: number,
  rate: number, dt: number,     // graph signal grid
  grid(): { i0, n, dt },        // gridFor(ctx.range, ctx.dt): make output signals on this grid
  frameMs: number,              // media frame duration (1000/fps), else 1000/30
  fps: number,
  media: { durationMs, fps, isVfr, width, height } | null,
  param(key): (t: number) => number,   // per-time value of a numeric param: linked signal (NaN -> stored constant), linked number, or constant
  where:  Spans | null,         // perSpan nodes: the flattened `where` input, or null when unconnected
  paramsFor(span): object,      // perSpan nodes: p merged with node.byKind[span.kind] (coerced); span null -> p
  read(kind, ref?): any,        // source nodes: a value declared by def.reads (throws if not declared)
  rng(): () => number,          // seeded [0,1): mulberry32(hashSeed(p.seed ?? 0, def.type)) from gen/util.js
  warn(message, fix?): void,    // a 'warn' diagnostic on this node
  info(message, fix?): void,
  abort: AbortSignal,           // long loops may check ctx.abort.aborted and throw ABORT (exported by eval.js)
}
```

A `local` node must produce correct output on `ctx.range`. Values outside it may be missing. Scripts carry
one neighbour outside each end (`clipScript`). Signals cover `ctx.grid()`.

### 3.3 `perSpan` and `byKind`

For a def with `perSpan: true`:
- the engine adds `{ name: 'where', type: 'spans', label: 'Only inside', required: false }` to its inputs;
- `node.byKind` may hold per-kind param overrides. They are coerced like params, unknown kinds kept;
- `ctx.where` is `flattenSpans(inputs.where)` (or `null`) and `ctx.paramsFor(span)` merges the overrides.

The node decides how to use them. The wrappers in `nodes/` (§7) fold: one call per span, with that span's
params, `timeShift` nodes right to left.

### 3.4 Registry

```js
createRegistry(defs = []) -> Registry
Registry = {
  add(defOrDefs) -> Registry,          // chainable; a duplicate type throws
  get(type) -> NodeDef | null,
  has(type) -> boolean,
  list() -> NodeDef[],                 // registration order
  groups() -> [{ name, items: NodeDef[], groups: [...] }],   // tree from the ' · ' group paths, registration order
  portsOf(node, graph?) -> { ins: Port[], outs: Port[], params: Port[] },
    // ins: def.ins (+ 'where' when perSpan); params: one Port per mod param, name 'p:<key>', type 'signal' | 'number';
    // unknown type: ports inferred from the links touching the node in `graph`, typed 'any' ([] without graph)
}
```

## 4. Graph editing (`model.js`)

All functions are pure. Each returns a new graph, or the same graph plus a reason when refused.

```js
GRID = 20
snap(v, grid = GRID) -> number
newId(prefix) -> string                     // prefix + Date.now().toString(36) + (seq++).toString(36)
emptyGraph({ name = 'Graph', rate = 50 } = {}) -> Graph

addNode(g, reg, type, { x = 0, y = 0, params = {}, byKind, label } = {}) -> { graph, id }
    // params: defaults filled from the def, seed params randomised, then `params` applied and coerced. Unknown type -> throws
removeNodes(g, ids) -> graph               // also removes their links; also deletes lastBake entries
moveNodes(g, ids, dx, dy) -> graph
setParams(g, reg, id, patch) -> graph      // coerced; unknown keys kept
setByKind(g, reg, id, kind, patch | null) -> graph    // null removes that kind's overrides; {} keeps an empty entry
setNodeProps(g, id, { label?, muted?, collapsed?, preview?, color? }) -> graph

planLink(g, reg, { from, out, to, in }) ->
    { ok: true, replace?: linkId, adapter?: 'sample' | 'const' }
  | { ok: false, reason: string, suggest?: string[] }
    // reasons (exact text may vary, meaning may not): 'refused: would loop', 'refused: no such input "x"',
    // 'refused: no such output "y"', 'refused: a node cannot feed itself', 'refused: signal cannot feed script — insert "Signal → Script"'
connect(g, reg, link) -> { graph, id, reason }      // id null and graph unchanged when refused
disconnect(g, linkIds) -> graph
insertOnLink(g, reg, linkId, nodeId) -> { graph, reason }
    // link.from → node's first compatible input, node's first compatible output → link.to
dissolveNodes(g, reg, ids) -> graph        // remove, reconnecting each bypass pair (input source → output targets)
duplicate(g, ids, { dx = 40, dy = 40 } = {}) -> { graph, map: { [oldId]: newId } }   // copies links among the copied nodes
wouldLoop(g, from, to) -> boolean          // DFS: does `to` already reach `from`
upstreamOf(g, ids) -> Set<nodeId>          // excluding ids
downstreamOf(g, ids) -> Set<nodeId>

addFrame(g, { title, x, y, w, h, color = null }) -> { graph, id }
patchFrame(g, id, patch) -> graph
removeFrames(g, ids) -> graph

toPreset(g, ids, { name = '' } = {}) -> Preset            // copy: the nodes, links among them, frames fully inside
applyPreset(g, reg, preset, { x = 0, y = 0 } = {}) -> { graph, ids, map }
    // ids remapped, positions offset so the preset's top-left lands at (x, y), params completed with defaults

createHistory(limit = 100) -> { push(entry), undo(swap) -> entry|null, redo(swap) -> entry|null, canUndo, canRedo, clear() }
    // Phosphor's: undo pops `back`, pushes swap(entry) onto `fwd`; push clears `fwd`. Used only in local-undo mode (§10)
```

## 5. Evaluation (`eval.js`)

### 5.1 Compile and validate

```js
compile(graph, reg) -> Program
Program = {
  graph, reg,
  order: nodeId[],                       // topological; ties broken by node id (deterministic)
  nodes: Map<nodeId, { node, def: NodeDef | null, ports: { ins, outs, params }, inLinks: Map<inPortName, Link> }>,
  types: Map<'nodeId:port', TypeId>,     // resolved; 'any' replaced by the concrete type where it can be
  adapters: Map<linkId, 'sample' | 'const'>,
  outputs: nodeId[],                     // nodes of type out.axis / out.ghost
  diags: Diag[],                         // static diagnostics (below)
  structureKey: string,                  // hash of nodes' ids/types and links; params excluded
}
validate(graph, reg) -> Diag[]           // = compile(graph, reg).diags
withGraph(program, graph) -> Program     // same structure, new params; throws if the structureKey differs
```

`compile` runs only when structure changes (nodes added/removed, links, type versions). A param edit
reuses the Program: `evaluate` reads params from `program.graph`, which the caller may swap with
`withGraph(program, graph)`, which returns a Program sharing everything but `graph`. It is only valid when
`structureKey` is unchanged, and it throws otherwise.

`any` resolution: per node, the first connected input in port order that is typed `any` fixes T. Every
`any` input and output then takes T. A later conflicting input gets a `type` diagnostic on its link.

Static checks: `cycle` (error on every node of the cycle; files can lie), `unknown-type` (error),
`dangling-link` (warn; the link is ignored), `type` (error on the link), `missing-input` (error: a required
input is unconnected), `param` (warn: a stored value was out of range and coerced), `output-collision`
(error on every unmuted `out.axis` writing the same axis), `self-reference` (warn: an `out.axis` whose
upstream contains `src.axis` of the same axis; fix kind `freezeSource`).

### 5.2 Diagnostics

```js
Diag = {
  id: string,                    // stable: `${code}@${node ?? link}${port ? ':' + port : ''}`
  node?: nodeId, port?: string, link?: linkId,
  severity: 'error' | 'warn' | 'info',
  code: 'cycle' | 'unknown-type' | 'dangling-link' | 'type' | 'missing-input' | 'param' | 'output-collision'
      | 'self-reference' | 'throw' | 'upstream' | 'invalid-output' | 'source-missing' | 'time-shift'
      | 'empty' | 'gaps' | 'slow' | 'note',
  message: string,
  origin?: nodeId,               // 'upstream': the failing node
  fix?: Fix,
}
Fix =
    { label, kind: 'insertBefore', args: { node, port, type } }     // insert a node of `type` on the link into node.port
  | { label, kind: 'insertAfter',  args: { node, port, type } }     // insert after node's output port (rewires its links)
  | { label, kind: 'setParam',     args: { node, key, value } }
  | { label, kind: 'freezeSource', args: { node } }                 // src.axis → pinned ghost + src.ghost (integration)
  | { label, kind: 'select',       args: { node } }
```

`ctx.warn` / `ctx.info` messages from nodes get code `note`. Nodes may pass a `fix`.

### 5.3 Cache keys (computed before a node runs)

```
key(node) = H(type, tv, stableJSON(params), stableJSON(byKind ?? null), rate, muted,
              for each connected input and param port in port order: [port, key(src), srcPort, adapter],
              rangeKey (only when this node runs windowed), sourceTokens (source nodes: tokenOf of each reads() value))
```

- Node ids never enter keys. Identical sub-chains share cache entries and a preset remap keeps them.
- `tokenOf(value)`: objects are keyed by identity through a `WeakMap` counter, primitives by JSON, and
  `undefined` by `'∅'`. Document values are immutable, so identity changes iff content may have changed.
  Undo hands back the old array, so it hits the cache. A false hit is impossible. A false miss (equal
  content, new array) only recomputes.
- A muted node's key = `H('mute', key of the input it passes)`.

```js
hashKey(...parts) -> string     // FNV-1a over the parts' canonical strings, 53-bit, base 36
stableJSON(value) -> string     // sorted object keys; typed arrays refused (never part of params)
tokenOf(value) -> string
ABORT                           // the Error instance a node throws to abort cooperatively
```

### 5.4 Cache

```js
createCache({ budgetMB = 64 } = {}) -> Cache
Cache = {
  get(key) -> { outs, bytes } | undefined,
  set(key, outs, bytes) -> void,
  pinOnly(keys: Iterable<string>) -> void,   // entries outside the LRU budget (the latest value of every node); replaces the previous pin set
  clear() -> void,
  stats() -> { entries, bytes, pinnedBytes, hits, misses },
}
```

The cache is an LRU over keys against a byte budget (`bytesOf`), plus a pinned set. `evaluate` pins the
keys of every node it evaluated or hit, so flipping a param back and forth or A/B never thrashes. It is
in memory only and never persisted.

### 5.5 Evaluate

```js
evaluate(program, run: RunContext, opts?: EvalOptions) -> Promise<Result>   // yields to the event loop every run.yieldMs between nodes
evaluateSync(program, run, opts) -> Result                                  // same, no yielding (tests, bake fallbacks)

RunContext = {
  sources: Sources,            // §9
  durationMs: number,
  media?: object | null, frameMs?: number,
  cache: Cache,
  abort?: AbortSignal,
  yieldMs?: number,            // default 8
}
EvalOptions = {
  targets?: (nodeId | `${nodeId}:${port}`)[],   // default program.outputs
  range?: { t0, t1 } | null,                     // null (default) = the full timeline
}
Result = {
  values: Map<`${nodeId}:${port}`, Value>,       // every output of every node evaluated or hit (never faults)
  status: Map<nodeId, 'ok' | 'cached' | 'error' | 'blocked' | 'muted' | 'skipped'>,
  keys:   Map<nodeId, string>,                   // content key per evaluated node (bake status, preview dedup)
  stats:  Map<nodeId, { ms: number, bytes: number, hit: boolean }>,
  diags:  Diag[],                                // static + runtime, deduplicated by id
  ms: number,
  aborted: boolean,
  range: { t0, t1 },
  window: boolean,
}
```

Semantics:
1. **Pull.** Only targets and their ancestors are evaluated, in `program.order`.
2. **Memo.** On a key hit, the node is `cached` and its outputs are reused. Otherwise `def.eval` runs and
   every output is checked with `checkValue`. An invalid script is repaired by `normalize`, invalid spans by
   `normSpans`, and the node gets a `warn` `invalid-output` diag. Other invalid values make the node an error.
3. **Windowed.** With `opts.range`, a node whose own def and every ancestor's def are `local` with a finite
   halo runs on `range` widened by the summed downstream halos. Any other node runs on the full timeline,
   which is cached, so it is computed once. Values are therefore valid **at least** on `opts.range`.
   Consumers slice.
4. **Errors.** A node that throws, has a missing required input, or has an unknown type, is `error` and has
   no outputs. A node whose required input comes from an `error`/`blocked` node is `blocked`, with an
   `info` `upstream` diag naming `origin`. Only root causes are drawn red. Optional inputs from a failed
   node arrive as `undefined`. Outputs that do not depend on a failure still evaluate.
5. **Abort.** It is checked between nodes, and in nodes that poll `ctx.abort`. An aborted run resolves
   with `aborted: true`. Completed nodes stay cached.
6. **Determinism.** The same graph with the same source tokens gives bit-identical values.

### 5.6 Mute

A muted node is not evaluated. Each output takes the value of `def.bypass[out]` (default: the first input of
the same type). With no such input, the output is missing, and downstream required inputs make those
nodes `blocked`. A muted `out.*` node is `muted` and is skipped by preview and bake.

## 6. Serialisation (`serialize.js`)

```js
GRAPH_VERSION = 1
MIGRATIONS = {}                                  // { [v]: (obj) => obj of version v+1 }
parseGraph(raw, reg) -> { graph, diags }
  // tolerant: migrates; fills missing ids/name/rate (rate snapped to 25|50|100|200, default 50); x/y finite;
  // KEEPS nodes of unknown type verbatim (their params and links survive; compile reports 'unknown-type');
  // runs def.migrate when node.tv < def.version; coerces params of known types (unknown keys kept);
  // drops links whose endpoints are missing ('dangling-link' warn); renames duplicate ids; keeps unknown keys at every level.
  // Never throws for content problems; throws Error('not a graph: ...') only when raw is not an object.
serializeGraph(graph) -> object                  // plain JSON (drops undefined fields only)
parseGraphs(block, reg) -> { graphs: Graph[], diags }     // block = .pawproj feature block value { v: 1, items: Graph[] }; null/undefined -> []
serializeGraphs(graphs) -> { v: 1, items: object[] }
stringifyGraphFile(graphOrPreset) -> string      // JSON text { format: 'pawgraph', version: 1, graph }
parseGraphFile(text, reg) -> { graph, diags }    // throws Error('not a .pawgraph file: ...')
```

The `.pawproj` block key is **`graphs`**, holding `{ v: 1, items: Graph[] }` (lib/io `getBlock`/`setBlock`).

## 7. Node catalogue (`nodes/`, NODES)

```js
// nodes/index.js
createCatalogue({ compilePlan } = {}) -> Registry
    // BUILTINS + wrapEditOps(OPS) + wrapGenerators(GENERATORS, RECIPES).
    // compilePlan: lib/gen plan compiler if the caller has it (signature of lib/gen/README.md);
    // without it gen.plan uses its local per-segment fallback (resolveSegment + generator + joinPlan).
BUILTINS: NodeDef[]
wrapEditOps(OPS) -> NodeDef[]             // every non-select op except EXCLUDED_OPS -> 'edit.<id>'; select ops -> 'select.<id>'
wrapGenerators(GENERATORS, RECIPES) -> NodeDef[]   // 'gen.<generatorId>', recipes as variants
EXCLUDED_OPS = ['setPoint', 'numberKey', 'setTime']
EDIT_HALO: { [opId]: (p) => ms }          // context each op needs; unlisted = Infinity. Shared by windowing and the per-span fold
TIME_SHIFT_OPS: string[]                   // ops flagged timeShift
```

`nodes/` imports `src/lib/edit/index.js`, `src/lib/gen/recipes.js`, `generators.js`, `loops.js`, `shapes.js`,
`util.js` and `src/lib/analyze/index.js`. It never imports `src/features/**`.

### Port names (the editor and presets rely on these)

| type | ins | outs |
|---|---|---|
| `edit.<op>` | `script` (req), `where` | `script`, `changed` (spans, points: the op's `ats`) |
| `select.<op>` | `script` (req), `where` | `points` (spans, points) |
| `gen.<gen>` | `where`, `turns` (spans points; follow/knot), `beats` (spans points; beats) | `script` |
| `gen.plan` | `segments` (spans, req), `turns` | `script` |
| `src.axis` | – | `script` |
| `src.ghost` | – | `script` |
| `src.run` | – | `signal`, `confidence`, `points` (script), `events` (spans), `scenes` (spans) |
| `src.plan` | – | `spans` |
| `src.fx` | – | `spans` (the effects row, lib/fx.js: kind = effect kind, data = {id, params}; muted left out) |
| `fx.apply` | `script` (req), `where` (perSpan: the effects) | `script` (applyFx; byKind overrides add to each effect's params; unconnected `where` = pass-through) |
| `src.chapters` / `src.loops` / `src.bookmarks` / `src.range` / `src.selection` / `src.scenes` / `src.trackSpans` / `src.tags` | – | `spans` |
| `src.audio` | – | `signal` |
| `src.time` | – | `signal` |
| `src.media` | – | `duration`, `fps` (numbers) |
| `const.number` / `const.script` / `const.spans` | – | `value` |
| `script.sample` | `script` (req) | `signal` |
| `script.turns` | `script` (req) | `points` |
| `script.strokes` | `script` (req) | `spans` |
| `script.phase` | `script` (req) | `phase`, `amp`, `period` (signals) |
| `script.speed` / `script.rate` | `script` (req) | `signal` |
| `script.splice` | `base` (req), `insert` (req), `where` (req, spans) | `script` |
| `script.trim` | `script` (req), `where` (req) | `script` |
| `script.merge` | `a` (req), `b` (req) | `script` |
| `script.mix` | `a` (req), `b` (req) | `script` |
| `script.tile` | `template` (req), `where` (req) | `script` |
| `amp.remap` / `amp.gain` / `amp.offset` / `amp.clamp` / `amp.curve` | `script` (req) | `script` |
| `sig.*` (unary) | `signal` (req) | `signal` |
| `sig.math` | `a` (req), `b` (signal) | `signal` |
| `sig.expr` | `a`, `b`, `c`, `d` (signals) | `signal` |
| `sig.blend` | `a` (req), `ca`, `b` (req), `cb` | `signal`, `dominance` |
| `sig.lfo` / `sig.noise` | – | `signal` |
| `sig.phaseWave` | `phase` (req), `amp` | `signal` |
| `sig.toScript` | `signal` (req) | `script` |
| `sig.sampleAt` | `signal` (req), `times` (any: script or spans, req) | `script` |
| `spans.filter` / `.not` / `.pad` / `.mergeGaps` / `.shift` / `.relabel` / `.between` | `spans` (req) | `spans` |
| `spans.and` / `.or` / `.minus` | `a` (req), `b` (req) | `spans` |
| `spans.threshold` | `signal` (req) | `spans` |
| `spans.kindRange` | `spans` (req) | `lo`, `hi` (signals) |
| `spans.kindValue` / `spans.envelope` / `spans.toSignal` | `spans` (req) | `signal` |
| `flow.switch` | `a` (any, req), `b` (any, req), `where` (req) | `out` (any) |
| `flow.gate` | `in` (any, req), `where` (req) | `out` (any) |
| `flow.select` | `in0`..`in3` (any) | `out` (any) |
| `flow.reroute` | `in` (any, req) | `out` (any) |
| `an.stat` | `in` (any: script or signal, req), `where` | `value` (number) |
| `an.problems` | `script` (req) | `spans` |
| `an.compare` | `cand` (req), `ref` (req) | `score` (number: f1), `lag` (number ms), `diff` (spans) |
| `out.axis` | `script` (req), `where` | `result` (script: what bake writes) |
| `out.ghost` | `script` (req) | `result` (script) |

`out.axis` params: `axis` (editor `axis`, default `'stroke'`), `mode` `replace | inside | merge` (default
replace), `seamMs` (0..2000, default 0). `inside`: the input replaces the current axis only inside
`where` (or inside the input's own extent when `where` is unconnected), joined with `blend` over `seamMs`.
`merge`: `upsert`. Only `inside` and `merge` declare `reads: [['axis', p.axis]]`; `replace` does not read
the axis. `result` is exactly the Script bake writes. `out.ghost` params: `name`, `color` (SERIES key,
default `'pink'`).

### 7.1 Example A: a pointwise node with time-varying params

```js
// nodes/amp.js
import { defineNode } from '../model.js';
import { clampPos } from '../../core/script.js';

export const remap = defineNode({
  type: 'amp.remap', title: 'Remap depth', group: 'Amplitude', icon: 'range',
  aliases: ['range', 'depth', 'lo hi', 'stroke length'],
  help: 'Maps pos 0..100 linearly onto Deep end..Out end per action. Wire signals into the ends to vary them over time.',
  ins:  [{ name: 'script', type: 'script', required: true }],
  outs: [{ name: 'script', type: 'script' }],
  params: [
    { key: 'lo', label: 'Deep end', type: 'number', default: 0,   min: 0, max: 100, step: 1, mod: 'signal', inline: true },
    { key: 'hi', label: 'Out end',  type: 'number', default: 100, min: 0, max: 100, step: 1, mod: 'signal', inline: true },
  ],
  halo: () => 0, local: true,
  bypass: { script: 'script' },
  eval({ script }, p, ctx) {
    const lo = ctx.param('lo'), hi = ctx.param('hi');
    const out = new Array(script.length);
    for (let i = 0; i < script.length; i++) {
      const a = script[i], l = lo(a.at), h = hi(a.at);
      out[i] = { at: a.at, pos: clampPos(l + (a.pos * (h - l)) / 100) };
    }
    return { script: out };
  },
});
```

### 7.2 Example B: a source node

```js
// nodes/sources.js
import { defineNode } from '../model.js';
import { normSpans } from '../types.js';

export const plan = defineNode({
  type: 'src.plan', title: 'Plan segments', group: 'Sources', icon: 'layers',
  help: 'The plan lane as spans: kind = segment kind, data = {id, recipe, params, intensity}.',
  ins: [], outs: [{ name: 'spans', type: 'spans' }],
  params: [{ key: 'kinds', label: 'Only kinds', type: 'list', default: [], editor: 'kinds' }],
  reads: () => [['plan']],
  halo: () => 0, local: true,
  eval(_in, p, ctx) {
    const keep = Array.isArray(p.kinds) && p.kinds.length ? new Set(p.kinds) : null;
    const segs = (ctx.read('plan') || []).filter((s) => !keep || keep.has(s.kind));
    return { spans: normSpans(segs.map((s) => ({ t0: s.t0, t1: s.t1, kind: s.kind, label: s.name || s.recipe || s.kind,
      data: { id: s.id, recipe: s.recipe, params: s.params, intensity: s.intensity } }))) };
  },
  summary: ({ spans }) => `${spans.length} segments`,
});
```

### 7.3 How a wrapped edit op behaves (normative for NODES)

`edit.<id>`: `params` = the op's params, normalised to the kit dialect, with `mod: 'number'` on numeric ones.
Ops with a `playhead` param keep it as a plain number. `perSpan: true`, `halo` = `EDIT_HALO[id]`
(default Infinity), `local` only for ids that pass the halo test, `timeShift` for `TIME_SHIFT_OPS`. In eval:
- `ctx.where` null → `op.apply(script, null, p)`;
- else fold over the flattened spans (right to left for timeShift), with `sel = { t0: span.t0, t1: span.t1 - 1 }`
  (a point span: `{ ats: [span.t0] }`) and `ctx.paramsFor(span)`. With a finite halo the op runs on
  `clipScript(s, t0 - h, t1 + h)` and the result is spliced back with `replaceRange` over that clip's extent,
  so each span costs O(span), not O(script);
- `changed` = `atsToSpans` of the union of returned `ats`.

`select.<id>`: `sel = where ? { ats: spansToAts(script, where) } : null`, output `points = atsToSpans(r.ats)`.

## 8. Presets (`presets.js`, NODES)

```js
PRESETS: Preset[]
Preset = {
  id, name, description, tags: string[],
  rate?: number,
  nodes: [{ id, type, x, y, params?, byKind?, label? }],   // params may be partial: applyPreset fills defaults
  links: [{ from, out, to, in }],
  frames?: Frame[],
  slots?: [{ node, param, auto: 'tracker' | 'reference' | 'run' | `axis:${string}` }],   // bound by integration on placement
}
```

Required ids (the user guide refers to them): `tracker-cleanup`, `depth-by-kind`, `mix-trackers`,
`roll-from-phase`, `twist-from-phase`, `climax-pulses`, `ab-smoothing`, `polish`, `fill-dropouts`,
`scene-flip-fix`, `plan-plus-tracker`. Also `tracked-effects` (tracker ghost → `fx.apply` ← `src.fx` → stroke, `inside`).

## 9. Document adapters (`doc.js`, INTEGRATION)

```js
// The snapshot integration builds from app (plain values; tests build it by hand)
Snapshot = {
  axes: { [axisId]: Script }, ghosts: Ghost[], plan: PlanSegment[], chapters, loops, bookmarks,
  range: { t0, t1 } | null, selection: { axis, ats: Set } | null, media: object | null,
  runs: RunRecord[],           // src/lib/runs.js makeRun shape (tracking feature), [] if none
  scenes: [{ start_ms, end_ms, sign? }],   // tracking feature's scene list, [] if none
  trackSpans: [{ start_ms, end_ms, state }],           // tracking feature's span labels, [] if none
  audio: { i0: 0, dt: number, v: Float32Array } | null, // peak envelope 0..1, null until loaded
  tags: [{ t0, t1, tag, score? }] | null,               // null: no provider yet
  fx: [{ id, kind, t0, t1, params?, muted? }],          // the effects layer (doc.fx), [] if none
  durationMs: number, frameMs: number,
}

makeSources(snapshot) -> Sources
Sources = {
  get(kind, ref?) -> value | undefined,   // the snapshot value itself (identity preserved), never a copy
  list(kind) -> [{ id, name, detail? }],  // pickers: 'axis' | 'ghost' | 'run' | 'kind' | 'channel' (ref = run id)
}
// kinds for get(): 'axis' (ref axis id) | 'ghost' (ref id -> Ghost) | 'plan' | 'chapters' | 'loops' | 'bookmarks'
//   | 'range' | 'selection' | 'media' | 'run' (ref id -> RunRecord) | 'scenes' | 'trackSpans' | 'audio' | 'tags' | 'fx'
// Ghosts whose source.kind === 'graph' are invisible to get('ghost') and list('ghost'): a graph never reads its own previews.

GRAPH_GHOST = 'graph'                          // ghost.source.kind of every ghost the graph publishes
ghostId(graphId, key) -> string                // `graph:${graphId}:${key}`, key = nodeId | 'A' | 'B' | `snap${n}` | 'probe'
mergeGhosts(docGhosts, mine) -> Ghost[]        // replaces only kind-'graph' ghosts; returns docGhosts itself when nothing changed
previewList(program, result, { pins, probe, snapshots, colors }) -> [{ id, name, axis, color, script, source }]
    // unmuted out.axis with preview !== false (on its axis), out.ghost, pins A/B, probe (scripts only), snapshots

bakePlan(program, result, axes, { only = null, range = null } = {}) ->
  { writes: { [axis]: Script }, changed: string[], skipped: [{ node, axis, reason }], diags: Diag[], hashes: { [nodeId]: string } }
    // per unmuted out.axis (or `only` ids): needs status ok|cached and a 'result' value; result.window must be false (else throws).
    // range: replaceRange(current, t0, t1, slice(result, t0, t1)). Skips when sameScript(current, next).
    // Two outputs writing one axis -> error diag, neither written.
scriptHash(script) -> string                   // FNV over every at/pos
sameScript(a, b) -> boolean                    // identity, else length + every action
axisDiffersFromBake(graph, axes) -> [{ node, axis }]   // lastBake[node].hash !== scriptHash(axes[axis])
markBaked(graph, result, plan, now) -> Graph   // writes lastBake for every written node: { axis, key: result.keys.get(node), hash, time }
freezePlan(graph, nodeId, snapshot) -> { ghost: Ghost, graph }   // fix 'freezeSource': a pinned ghost copy of the axis + src.ghost replacing src.axis
```

## 10. Controller (`src/features/graph/integration.js`, INTEGRATION → EDITOR)

```js
import { graphController } from '../features/graph/integration.js';   // plain .js re-export; the runes live in integration/controller.svelte.js
graphController(app) -> GraphController       // one per app (WeakMap); created on first call
```

Reactive (`$state.raw` / getters):

```js
ctl.registry: Registry
ctl.graphs: Graph[]
ctl.activeId: string | null
ctl.graph: Graph | null                        // the active graph
ctl.program: Program | null                    // compile(graph), recompiled only when structureKey changes
ctl.result: Result | null                      // latest FULL evaluation of the active graph
ctl.preview: Result | null                     // latest windowed evaluation (sparklines while scrubbing)
ctl.diags: Diag[]                              // program + result + controller diags ('slow'), by id
ctl.busy: boolean
ctl.slow: { ms, node } | null                  // last full run exceeded 250 ms: live preview runs on commit only
ctl.live: boolean                              // publish preview ghosts
ctl.probe: { node, port } | null
ctl.pins: { A: { node, port } | null, B: { node, port } | null }
ctl.snapshots: [{ id, name, node, port, script }]
ctl.undoMode: 'app' | 'local'                  // 'app' when app.doc has a `graphs` field (shell change landed)
ctl.canUndo: boolean, ctl.canRedo: boolean     // local mode
ctl.sources: Sources                           // the current snapshot's
ctl.hoverTime: number | null                   // shared time cursor (editor sets it; probe lane and cards read it)
```

Methods:

```js
ctl.valueOf(nodeId, port?) -> Value | undefined          // newest of preview/result that has it; port default = first output
ctl.statusOf(nodeId) -> { status, ms, hit, key, summary, diags: Diag[] }
ctl.bakeStatus(nodeId) -> 'never' | 'baked' | 'stale' | 'axis-differs' | 'error'
    // stale: result.keys differs from lastBake.key; axis-differs: the axis no longer has the baked hash
ctl.newGraph({ name, preset } = {}) -> id
ctl.openGraph(id) ; ctl.renameGraph(id, name) ; ctl.duplicateGraph(id) -> id
ctl.deleteGraph(id) -> Promise<boolean>                  // asks app.confirm
ctl.importGraph(text) -> { id, diags } ; ctl.exportGraph(id) -> string
ctl.mutate(label, fn) -> string                          // fn(graph) -> graph | { graph, reason }. One undo entry 'Graph: <label>'.
                                                         // A non-empty reason (or an unchanged graph) records nothing and is returned.
ctl.gesture(label) -> { update(fn), commit(), cancel() } // drags, scrubs: any number of updates, one entry on commit, cancel reverts
ctl.undo() ; ctl.redo()                                  // local mode; app mode delegates to app.undo/redo
ctl.applyFix(fix) -> string                              // reason
ctl.applyPreset(presetId, { x, y }) -> { ids, reason }   // binds slots from sources.list
ctl.requestPreview(range: { t0, t1 }) ; ctl.setVisible(nodeIds) ; ctl.setLive(on)
ctl.setProbe(nodeId | null, port?) ; ctl.pin('A' | 'B', nodeId | null, port?) ; ctl.swapPins()
ctl.snapshot(nodeId, port?) -> ghostId ; ctl.clearSnapshots()
ctl.bake({ nodes = null, range = null } = {}) -> Promise<{ ok, changed: string[], message }>
    // full evaluation (never preview values) -> bakePlan -> app.choose if axisDiffersFromBake -> ONE app.transact
ctl.dispose()
```

The scheduler is owned by the controller:
1. A graph or source change triggers a windowed evaluation of `setVisible` nodes plus outputs, on
   `requestPreview`'s range, coalesced to one per animation frame.
2. After 150 ms idle, or on gesture commit, a full evaluation runs. It publishes ghosts and updates
   `result`.
3. A newer request aborts an older run. Finished nodes stay cached.

## 11. Required tests (per owner)

- ENGINE `test/graph-engine-*.test.mjs`:
  - model: `planLink` reasons and replace, `wouldLoop`, `duplicate`, `applyPreset` remap, history;
  - types: every compat cell, adapters, spans helpers;
  - eval:
    - a second run recomputes 0 nodes;
    - a param change recomputes exactly the downstream set;
    - undo identity hits;
    - abort keeps finished entries;
    - fault, upstream and an independent output;
    - mute;
    - determinism;
    - deep-frozen inputs;
  - serialize: unknown types kept, dangling links dropped;
  - perf (§DESIGN "Performance").
- NODES `test/graph-nodes-*.test.mjs`:
  - **sweep**: every registered type, default params, fixture inputs, gives valid values of its declared output types;
  - **halo honesty**: for every `local` def, over seeded random inputs, full-then-slice equals window-then-slice on [a, b];
  - per-node cases;
  - expression grammar;
  - every preset compiles with zero errors and evaluates on a synthetic snapshot.
- EDITOR `test/graph-editor-*.test.mjs`: pure helpers (geometry, fuzzy rank, gesture reducer, layout, keyboard chain).
- INTEGRATION `test/graph-integration-*.test.mjs`: `makeSources` (own ghosts hidden, identity preserved), `bakePlan` (two axes, unchanged skipped, collision, range), `mergeGhosts`, `markBaked` and `axisDiffersFromBake`, `freezePlan`.

## PROVENANCE

Adapted from OpenValence/Phosphor (same owner, Apache-2.0, a sibling checkout):
- From `src/model/graph.js`:
  - `newId` (l.210), `snap`/`GRID` (l.351);
  - `createHistory` (l.359-370);
  - `wouldLoop` (l.238, rels removed) and `topo` (l.595, generalised to all nodes with deterministic ties);
  - the `planLink`/`addLink` refusal-string shape (l.561-592);
  - the MATH/COMPARE tables (l.435-494);
  - `lowpassStep`/`slewStep`/`hysteresis` (l.58-78), rewritten as zero-phase whole-array functions;
  - load-time filtering (l.719-735), changed to KEEP unknown node types.
- From `src/plugins/graph.js`: the `step` snapshot/restore pattern (l.462-542) and the preset id remap (`applyPreset`, l.696).
- From `src/ui/graph/GraphEditor.svelte` and `GraphPalette.svelte` (editor, see DESIGN.md).
- `docs/GRAPH.md`, as the behaviour-spec template.

Record the same in each adapted file's header.
