// core.js -- the graph controller's logic (contract: src/lib/graph/README.md §10), runes-free so node tests can
// drive it. controller.svelte.js wraps it: it passes `track` (reads a $state counter) and `bump` (increments
// it), plus an $effect that calls syncDoc() whenever a document value a graph can read changes.
//
// Where graphs live:
//   'app'   mode: app.doc.graphs (the shell lists 'graphs' in Doc.UNDOABLE). Every change is app.transact /
//           app.begin, so graph edits, bakes and script edits share one Ctrl+Z stack.
//   'local' mode (until the shell lands that): graphs live here with a local history (createHistory). After every
//           committed change they are written to app.doc.project.extra.graphs ({v:1, items}), which the
//           shell's projectDoc/appDocFrom already carry through .pawproj save/open.
// The `enabled` flag is stored on the Graph itself (`graph.enabled === false` = disabled; contract §1 keeps
// unknown keys), so it persists and undoes with the graph.

import { makeSources, stabilize, previewList, mergeGhosts, bakePlan, axisDiffersFromBake, markBaked, freezePlan, scriptHash, GRAPH_GHOST, ghostId } from '../../../lib/graph/doc.js';
import { readSnapshot } from './snapshot.js';

const SLOW_MS = 250, IDLE_MS = 150;
const isGraph = (x) => !!x && typeof x === 'object' && Array.isArray(x.nodes);
const isFrozen = (g) => g?.source?.kind === 'frozen';
const errText = (e) => String(e?.message || e);
const fmtClock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Which value a preset slot gets from the document ('' when nothing fits). Pure; exported for tests.
 * n: the slot's index among the preset's 'run' slots -- repeated run slots take successive runs (mix-trackers
 * mixes two different runs); with too few runs the extra slot stays unbound ('') so the user is told.
 */
export function resolveSlot(auto, sources, n = 0) {
  const ghosts = sources.list('ghost').map((x) => sources.get('ghost', x.id)).filter(Boolean);
  if (auto === 'tracker') return (ghosts.find((g) => g.source?.kind === 'tracker') ?? ghosts.find((g) => !g.pinned))?.id ?? '';
  if (auto === 'reference') return (ghosts.find((g) => g.pinned || g.source?.kind === 'reference'))?.id ?? '';
  if (auto === 'run') return sources.list('run')[n]?.id ?? '';
  if (typeof auto === 'string' && auto.startsWith('axis:')) return auto.slice(5);
  return '';
}

export class GraphCore {
  /**
   * opts: { app, engine (lib/graph index exports), registry, presets = [], track, bump, tracking: () => store|null,
   *   colors: (seriesKey) => css, raf, setTimer, clearTimer, now, loadAudio: (app) => Promise<audio|null> }
   */
  constructor({ app, engine, registry, presets = [], track = () => {}, bump = () => {}, tracking = () => null, colors = (k) => k,
    raf = (f) => setTimeout(f, 0), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (id) => clearTimeout(id), now = () => Date.now(), loadAudio = null } = {}) {
    Object.assign(this, { app, engine, registry, presets, track, bump, tracking, colors, raf, setTimer, clearTimer, now, loadAudio });
    const read = typeof app.doc.read === 'function' ? app.doc.read() : null;
    this.undoMode = read && 'graphs' in read ? 'app' : 'local';
    this.cache = engine.createCache({ budgetMB: Number(app.settings?.get?.('graph.cacheMB')) || 64 });
    this.history = engine.createHistory(100);
    this._graphs = [];
    this._known = new WeakSet();      // graphs this controller produced or parsed (app mode: anything else came from a load)
    this._activeId = null;
    this._block = undefined;          // the extra.graphs block we last read or wrote (local mode load detection)
    this._prog = null;
    this.result = null; this.preview = null;
    this._seq = 0; this._resultSeq = 0; this._previewSeq = 0;
    this.busy = false; this.slow = null;
    this.live = app.settings?.get?.('graph.live') !== false;
    this.probe = null; this.pins = { A: null, B: null }; this.snapshots = []; this._snapN = 0;
    this.visible = new Set();
    this.previewRange = null;
    this.selectRequest = null;        // {node, seq}: a 'select' fix asks the editor to select this node
    this.hoverTime = null;            // shared time cursor (the svelte wrapper makes it reactive)
    this.audio = null; this._audioFor = undefined;
    this._snap = null; this._keys = new Map(); this.sources = makeSources({});
    this._abort = { full: null, preview: null };
    this._frame = 0; this._idle = 0; this._running = 0;
    this._published = new Set();
    this._gesture = null;
    this._frozen = new Map();         // id -> pinned ghost made by the 'freezeSource' fix (re-added when redo brings its reader back)
    this._disposed = false;
    this.syncDoc();
  }

  // ---------------------------------------------------------------- reactive reads
  get graphs() { this.track(); return this.undoMode === 'app' ? this.app.doc.graphs || [] : this._graphs; }
  get graph() { const gs = this.graphs; return gs.find((g) => g.id === this._activeId) ?? gs[0] ?? null; }
  get activeId() { return this.graph?.id ?? null; }
  get enabled() { const g = this.graph; return !!g && g.enabled !== false; }
  get program() { return this.#programFor(this.graph); }
  get canUndo() { this.track(); return this.undoMode === 'app' ? !!this.app.history?.canUndo : this.history.canUndo; }
  get canRedo() { this.track(); return this.undoMode === 'app' ? !!this.app.history?.canRedo : this.history.canRedo; }
  get diags() {
    this.track();
    const p = this.program, by = new Map();
    for (const d of [...(p?.diags || []), ...(this.result?.diags || []), ...(this.preview?.diags || [])]) if (!by.has(d.id)) by.set(d.id, d);
    for (const m of [this._compileError, this._evalError]) if (m) by.set('throw@graph', { id: 'throw@graph', severity: 'error', code: 'throw', message: m });
    if (this.slow) {
      const node = this.slow.node, title = node ? this.#title(node) : '';
      by.set('slow@graph', { id: 'slow@graph', node: node || undefined, severity: 'info', code: 'slow',
        message: `slow graph: ${Math.round(this.slow.ms)} ms${title ? ` (${title} ${Math.round(this.slow.nodeMs)} ms)` : ''}; live preview runs on release` });
    }
    return [...by.values()];
  }

  #programFor(g) {
    if (!g) return null;
    const cur = this._prog;
    if (cur && cur.graph === g) return cur;
    this._compileError = '';
    try {
      if (cur && cur.graph.id === g.id) {
        try { return (this._prog = this.engine.withGraph(cur, g)); } catch { /* structure changed: recompile */ }
      }
      return (this._prog = this.engine.compile(g, this.registry));
    } catch (e) {
      this._compileError = 'compile failed: ' + errText(e);
      return (this._prog = null);
    }
  }
  #title(id) { const e = this._prog?.nodes?.get(id); return e?.node?.label || e?.def?.title || id; }

  // ---------------------------------------------------------------- document sync
  /** Re-read the document. Cheap when nothing a graph reads changed. The svelte wrapper calls it from an $effect. */
  syncDoc() {
    if (this._disposed) return;
    const app = this.app;
    if (this.undoMode === 'local') {
      const blk = app.doc.project?.extra?.graphs;
      if (blk !== this._block) {                 // a project was opened (or the block was replaced from outside)
        this._block = blk;
        let graphs = [];
        try { graphs = blk ? this.engine.parseGraphs(blk, this.registry).graphs : []; } catch (e) { app.toast?.('Graphs in this project could not be read: ' + errText(e), 'warn'); }
        this._graphs = graphs; this._activeId = graphs[0]?.id ?? null;
        this.history.clear(); this.#resetView();
      }
    }
    // app mode: graphs that arrived from outside (project open, recovery) are parsed once -- tolerant
    // migration, defaults, ids. Undo/redo hand back graphs we made, which are already known.
    if (this.undoMode === 'app') {
      const gs = app.doc.graphs || [];
      if (gs.some((g) => !this._known.has(g))) {
        const fixed = gs.map((g) => {
          if (this._known.has(g)) return g;
          try { return this.engine.parseGraph(g, this.registry).graph; } catch { return g; }
        });
        this.#own(fixed);
        app.doc.graphs = fixed;              // not an undo entry: it is the loaded state, normalised
      }
    }
    // stale graph ghosts (from a file, or a previous session) that this controller did not publish
    const gh = app.doc.ghosts || [];
    if (gh.some((g) => g.source?.kind === GRAPH_GHOST && !this._published.has(g.id))) {
      app.doc.ghosts = gh.filter((g) => g.source?.kind !== GRAPH_GHOST || this._published.has(g.id));
    }
    this.#syncFrozen();
    // audio: loaded on first use by a src.audio node; forgotten when the media changes
    const mediaKey = app.doc.media?.path ?? null;
    if (this._audioFor !== undefined && this._audioFor !== mediaKey) { this.audio = null; this._audioFor = undefined; }
    if (this._audioFor === undefined && this.loadAudio && this.graph?.nodes?.some((n) => n.type === 'src.audio')) {
      this._audioFor = mediaKey;
      Promise.resolve(this.loadAudio(app)).then((a) => { if (this._audioFor === mediaKey && a) { this.audio = a; this.syncDoc(); } }, () => {});
    }
    if (app.doc.activeAxis !== this._axis) { const first = this._axis === undefined; this._axis = app.doc.activeAxis; if (!first) this.publish(); }   // ghost outputs, pins and snapshots follow the active axis
    const snap = stabilize(readSnapshot(app, this.tracking(app), this.audio), this._snap, this._keys);
    const sourcesChanged = snap !== this._snap;
    if (sourcesChanged) { this._snap = snap; this.sources = makeSources(snap); }
    this.#followActive();
    const g = this.graph;
    if (sourcesChanged || g !== this._lastGraph) { this._lastGraph = g; this.kick({ gesture: !!this._gesture }); this.bump(); }
  }

  // ---------------------------------------------------------------- scheduler
  /** Something changed: a windowed preview next frame, then a full run after IDLE_MS (now, on commit). Slow
   *  graphs skip the idle full run during gestures. */
  kick({ commit = false, gesture = false } = {}) {
    if (this._disposed) return;
    const g = this.graph;
    this._lastGraph = g;
    if (!g || g.enabled === false) { this.#clearResults(); return; }
    if (!this._frame) this._frame = this.raf(() => { this._frame = 0; this.#runPreview(); });
    this.clearTimer(this._idle); this._idle = 0;
    if (commit) this._idle = this.setTimer(() => this.#runFull(), 0);
    else if (!(gesture && this.slow)) this._idle = this.setTimer(() => this.#runFull(), IDLE_MS);
  }
  /** Evaluate the full timeline now (the "evaluate now" command). Resolves with the Result (null if aborted). */
  evaluateNow() { this.clearTimer(this._idle); this._idle = 0; return this.#runFull(); }

  #targets(p) {
    const ids = new Set(p.outputs);
    for (const id of this.visible) ids.add(id);
    for (const x of [this.probe, this.pins.A, this.pins.B]) if (x?.node) ids.add(x.node);
    return [...ids].filter((id) => p.nodes.has(id));
  }
  #runCtx(signal) {
    const app = this.app;
    return { sources: this.sources, durationMs: Math.max(1, Math.round(app.durationMs || 1)), media: app.doc.media || null,
      frameMs: app.player?.frameMs || (app.doc.media?.fps ? 1000 / app.doc.media.fps : 1000 / 30), cache: this.cache, abort: signal, yieldMs: 8 };
  }
  #window() {
    if (this.previewRange) return this.previewRange;
    const v = this.app.view || { start: 0, span: this.app.durationMs || 60000 }, dur = this.app.durationMs || v.start + v.span;
    return { t0: Math.max(0, Math.floor(v.start - v.span * 0.25)), t1: Math.min(Math.ceil(dur), Math.ceil(v.start + v.span * 1.25)) };
  }
  async #evaluate(kind, opts) {
    const p = this.program;
    if (!p) return null;
    this._abort[kind]?.abort();
    const ac = new AbortController();
    this._abort[kind] = ac;
    this._running++; this.busy = true; this.bump();
    try {
      const res = await this.engine.evaluate(p, this.#runCtx(ac.signal), { targets: this.#targets(p), ...opts });
      if (this._abort[kind] !== ac || ac.signal.aborted || res.aborted || this._disposed) return null;
      this._evalError = '';
      return { res, p };
    } catch (e) {
      if (this._abort[kind] === ac) this._evalError = 'evaluation failed: ' + errText(e);
      return null;
    } finally {
      if (this._abort[kind] === ac) this._abort[kind] = null;
      this._running--; this.busy = this._running > 0; this.bump();
    }
  }
  async #runPreview() {
    const r = await this.#evaluate('preview', { range: this.#window() });
    if (!r) return;
    this.preview = r.res; this._previewSeq = ++this._seq;
    this.bump();
  }
  async #runFull() {
    const r = await this.#evaluate('full', { range: null });
    if (!r) return null;
    this.#acceptFull(r.res);
    return r.res;
  }
  #acceptFull(res) {
    this.result = res; this._resultSeq = ++this._seq;
    if (res.ms > SLOW_MS) {
      let node = null, nodeMs = 0;
      for (const [id, s] of res.stats || []) if (!s.hit && s.ms > nodeMs) { node = id; nodeMs = s.ms; }
      this.slow = { ms: res.ms, node, nodeMs };
    } else this.slow = null;
    this.publish();
    this.bump();
  }
  #clearResults() {
    this._abort.full?.abort(); this._abort.preview?.abort();
    this.clearTimer(this._idle); this._idle = 0;
    if (this.result || this.preview) { this.result = null; this.preview = null; this.bump(); }
    this.publish();
  }

  // ---------------------------------------------------------------- previews (ghosts)
  /** Writes this graph's preview ghosts into app.doc.ghosts (only when something changed). Outputs only while
   *  Live is on and the graph is enabled; pins, probe and snapshots whenever they are set. */
  publish() {
    const g = this.graph, p = g && g.enabled !== false ? this._prog : null;
    let mine = [];
    if (g) {
      const entries = previewList(p && p.graph.id === g.id ? p : { graph: g, nodes: new Map(), outputs: [] }, p ? this.result : null, {
        pins: this.pins, probe: this.probe, snapshots: this.snapshots, colors: this.colors, activeAxis: this.app.doc.activeAxis || 'stroke' });
      mine = entries.filter((e) => e.source.role !== 'output' || this.live);
    }
    this.#setGhosts(mine);
  }
  #setGhosts(mine) {
    const doc = this.app.doc, next = mergeGhosts(doc.ghosts || [], mine.map((e) => ({ ...e, visible: true })));
    this._published = new Set(mine.map((e) => e.id));
    if (next !== doc.ghosts) doc.ghosts = next;
  }
  setLive(on) { this.live = !!on; this.app.settings?.set?.('graph.live', this.live); this.publish(); this.bump(); }
  setVisible(ids) { this.visible = new Set(ids || []); this.kick(); }
  requestPreview(range) {
    this.previewRange = range && Number.isFinite(range.t0) && Number.isFinite(range.t1) ? { t0: Math.max(0, Math.floor(range.t0)), t1: Math.ceil(range.t1) } : null;
    if (!this._frame && this.enabled) this._frame = this.raf(() => { this._frame = 0; this.#runPreview(); });
  }
  setProbe(node, port = null) { this.probe = node ? { node, port } : null; this.publish(); this.kick(); this.bump(); }
  pin(k, node, port = null) { if (k !== 'A' && k !== 'B') return; this.pins = { ...this.pins, [k]: node ? { node, port } : null }; this.publish(); this.kick(); this.bump(); }
  swapPins() { this.pins = { A: this.pins.B, B: this.pins.A }; this.publish(); this.bump(); }
  /** Freezes a node's current (full) script output as a ghost; returns its ghost id ('' if it has no script). */
  snapshot(node, port = null) {
    const v = this.valueOf(node, port, { full: true });
    if (!Array.isArray(v)) { this.app.toast?.('Only a script output can be snapshotted', 'warn'); return ''; }
    const g = this.graph, key = 'snap' + ++this._snapN, id = ghostId(g.id, key);
    this.snapshots = [...this.snapshots, { id, name: `${this.#title(node)} @ ${fmtClock(new Date(this.now()))}`, node, port, script: v }];
    this.publish(); this.bump();
    return id;
  }
  clearSnapshots() { this.snapshots = []; this._snapN = 0; this.publish(); this.bump(); }
  #resetView() {
    this.probe = null; this.pins = { A: null, B: null }; this.snapshots = []; this.visible = new Set();
    this.result = null; this.preview = null; this.slow = null; this._prog = null;
  }

  // ---------------------------------------------------------------- values and status
  valueOf(node, port = null, { full = false } = {}) {
    this.track();
    const p = this._prog;
    const name = port || p?.nodes?.get(node)?.ports?.outs?.[0]?.name || p?.nodes?.get(node)?.def?.outs?.[0]?.name;
    if (!name) return undefined;
    const key = `${node}:${name}`;
    const order = full ? [this.result] : this._previewSeq > this._resultSeq ? [this.preview, this.result] : [this.result, this.preview];
    for (const r of order) if (r?.values?.has(key)) return r.values.get(key);
    return undefined;
  }
  statusOf(node) {
    this.track();
    const r = this._previewSeq > this._resultSeq && this.preview?.status?.has(node) ? this.preview : this.result?.status?.has(node) ? this.result : this.preview;
    const st = r?.status?.get(node) ?? 'skipped';
    const stats = r?.stats?.get(node);
    const e = this._prog?.nodes?.get(node);
    let summary = '';
    try {
      const outs = {};
      for (const o of e?.ports?.outs || e?.def?.outs || []) { const v = r?.values?.get(`${node}:${o.name}`); if (v !== undefined) outs[o.name] = v; }
      const first = (e?.ports?.outs || e?.def?.outs || [])[0];
      if (e?.def?.summary && Object.keys(outs).length) summary = e.def.summary(outs, e.node.params);
      else if (first && outs[first.name] !== undefined && this.engine.summarize) summary = this.engine.summarize(this._prog.types?.get(`${node}:${first.name}`) || first.type, outs[first.name]);
    } catch { /* a summary must never break a card */ }
    return { status: st, ms: stats?.ms ?? 0, hit: !!stats?.hit, key: r?.keys?.get(node) ?? '', summary, diags: this.diags.filter((d) => d.node === node) };
  }
  bakeStatus(node) {
    const g = this.graph, n = g?.nodes?.find((x) => x.id === node);
    if (!n || n.type !== 'out.axis') return 'never';
    const st = this.result?.status?.get(node);
    if (st === 'error' || st === 'blocked') return 'error';
    const lb = g.lastBake?.[node];
    if (!lb) return 'never';
    this.track();
    if (lb.hash !== scriptHash(this.app.doc.axes?.[lb.axis] || [])) return 'axis-differs';
    const key = this.result?.keys?.get(node);
    return key && key !== lb.key ? 'stale' : 'baked';
  }

  // ---------------------------------------------------------------- graph changes (undo-aware)
  #replace(graphs, g) { return this.#own(graphs.map((x) => (x.id === g.id ? g : x))); }
  #own(list) { for (const g of list) this._known.add(g); return list; }
  /** One undo entry that sets the whole graph list. */
  #commitGraphs(label, next, { open = undefined } = {}) {
    const app = this.app;
    this.#own(next);
    if (this.undoMode === 'app') app.transact(label, () => { app.doc.graphs = next; });
    else {
      const prev = this._graphs;
      this.history.push({ label, graphs: prev, active: this._activeId });
      this._graphs = next;
      this.#persist();
    }
    if (open !== undefined) this.#activate(open);
    this.kick();
    this.bump();
  }
  /** The active graph vanished (an undo/redo removed it): the fallback graph becomes active with a clean view,
   *  so the old graph's pins and snapshots are not re-published under the new graph's id. */
  #followActive() {
    const id = this.graph?.id ?? null;
    if (id !== this._activeId) this.#activate(id);
  }
  /**
   * Frozen copies (the 'freezeSource' fix) live in app.doc.ghosts, which is not undoable, so they follow the graphs
   * instead: kept while some node param in some graph names them (id or name), dropped when none does (the fix
   * was undone), re-added when one does again (redo).
   */
  #syncFrozen() {
    const app = this.app, gh = app.doc.ghosts || [];
    if (!this._frozen.size && !gh.some(isFrozen)) return;
    const refs = new Set();
    for (const g of this.graphs) for (const n of g.nodes || []) for (const v of Object.values(n.params || {})) if (typeof v === 'string' && v) refs.add(v);
    const used = (x) => refs.has(x.id) || refs.has(x.name);
    for (const x of gh) if (isFrozen(x)) this._frozen.set(x.id, x);
    const back = [...this._frozen.values()].filter((f) => used(f) && !gh.some((x) => x.id === f.id));
    const next = [...gh.filter((x) => !isFrozen(x) || used(x)), ...back];
    if (next.length !== gh.length || next.some((x, i) => x !== gh[i])) app.doc.ghosts = next;
  }
  /** Make `id` the active graph; pins, probe, snapshots and results belong to the previous one. */
  #activate(id) {
    if (id === this._activeId) return;
    this._activeId = id;
    this.#resetView();
    this.publish();
  }
  /** Local mode: graphs -> app.doc.project.extra.graphs (+ dirty), which the shell saves with the .pawproj. */
  #persist() {
    if (this.undoMode !== 'local') return;
    const app = this.app, project = app.doc.project || { path: null };
    const extra = { ...(project.extra || {}) };
    if (this._graphs.length) extra.graphs = this.engine.serializeGraphs(this._graphs); else delete extra.graphs;
    this._block = extra.graphs;
    app.doc.project = { ...project, extra };
    if (app.history?.markDirty) app.history.markDirty(); else app.doc.dirty = true;
  }
  #setLocal(next) { this._graphs = next; this.#persist(); this.kick(); this.bump(); }

  /** fn(graph) -> graph | {graph, reason}. One undo entry 'Graph: <label>'. Returns the reason ('' = ok). */
  mutate(label, fn) {
    const g = this.graph;
    if (!g) return 'no graph is open';
    let r;
    try { r = fn(g); } catch (e) { return errText(e); }
    let next = isGraph(r) ? r : r?.graph;
    if (r && !isGraph(r) && r.reason) return r.reason;
    if (!next || next === g) return '';
    next = this.#bindNewRuns(g, next);
    this.#commitGraphs('Graph: ' + label, this.#replace(this.graphs, next));
    return '';
  }
  /**
   * Drags and scrubs: any number of update(fn), one undo entry on commit(), cancel() reverts.
   * App mode holds NO app.begin group open across the gesture: updates write app.doc.graphs directly, and commit
   * puts the base list back and records base -> final in one app.transact. A held group breaks when Ctrl+Z
   * arrives mid-scrub (History.#closeOpen zeroes depth, the late commit takes it to -1 and nothing records
   * again). If the graph list is replaced under the gesture (an undo/redo that touched graphs), the gesture
   * ends: its later commit/cancel do nothing.
   */
  gesture(label) {
    const app = this.app, id = this.activeId;
    if (!id) return { update() {}, commit() {}, cancel() {} };
    this._gesture?.commit?.();
    let done = false, changed = false;
    const appMode = this.undoMode === 'app';
    const list = () => (appMode ? app.doc.graphs || [] : this._graphs);
    const base = list();
    let mine = base;                       // the list this gesture last wrote
    const self = this;
    const end = () => { done = true; if (self._gesture === handle) self._gesture = null; };
    const write = (gs) => { mine = gs; if (appMode) app.doc.graphs = gs; else self._graphs = gs; };
    const handle = {
      update(fn) {
        if (done) return;
        if (list() !== mine) { end(); return; }
        const g = mine.find((x) => x.id === id);
        if (!g) return;
        const r = fn(g), next = isGraph(r) ? r : r?.graph;
        if (!next || next === g) return;
        changed = true;
        write(self.#replace(mine, next));
        self.kick({ gesture: true }); self.bump();
      },
      commit() {
        if (done) return;
        end();
        if (list() !== mine) return;
        if (changed && appMode) {
          const final = mine;
          app.doc.graphs = base;
          app.transact('Graph: ' + label, () => { app.doc.graphs = final; });
        } else if (changed) { self.history.push({ label: 'Graph: ' + label, graphs: base, active: id }); self.#persist(); }
        self.kick({ commit: true }); self.bump();
      },
      cancel() {
        if (done) return;
        end();
        if (list() !== mine) return;
        if (changed) write(base);
        self.kick(); self.bump();
      },
    };
    this._gesture = handle;
    return handle;
  }
  #swap = (e) => {
    const cur = { label: e.label, graphs: this._graphs, active: this._activeId };
    this._graphs = e.graphs;
    if (e.graphs.some((g) => g.id === e.active)) this.#activate(e.active);
    return cur;
  };
  undo() {
    if (this.undoMode === 'app') return this.app.undo();
    const e = this.history.undo(this.#swap);
    if (e) { this.#followActive(); this.#syncFrozen(); this.#persist(); this.kick(); this.bump(); this.app.toast?.('Undo: ' + e.label, 'quiet'); }
    return e;
  }
  redo() {
    if (this.undoMode === 'app') return this.app.redo();
    const e = this.history.redo(this.#swap);
    if (e) { this.#followActive(); this.#syncFrozen(); this.#persist(); this.kick(); this.bump(); this.app.toast?.('Redo: ' + e.label, 'quiet'); }
    return e;
  }

  // ---------------------------------------------------------------- graph list
  newGraph({ name = '', preset = null } = {}) {
    const E = this.engine;
    let g = E.emptyGraph({ name: name || this.#freshName(preset ? this.presets.find((p) => p.id === preset)?.name : 'Graph') });
    if (preset) {
      const pr = this.presets.find((p) => p.id === preset);
      if (pr) {
        if (pr.rate) g = { ...g, rate: pr.rate };
        const placed = this.#placePreset(g, pr, { x: 0, y: 0 });
        g = placed.graph;
        this.#warnUnbound(pr, placed.unbound);
      }
    }
    this.#commitGraphs('Graph: new', [...this.graphs, g], { open: g.id });
    return g.id;
  }
  #freshName(base = 'Graph') {
    const names = new Set(this.graphs.map((g) => g.name));
    if (!names.has(base)) return base;
    let n = 2; while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
  openGraph(id) {
    if (!this.graphs.some((g) => g.id === id) || id === this.activeId) return;
    this.#activate(id);
    this.kick(); this.bump();
  }
  renameGraph(id, name) {
    const g = this.graphs.find((x) => x.id === id);
    if (!g || !String(name || '').trim() || g.name === name) return;
    this.#commitGraphs('Graph: rename', this.#replace(this.graphs, { ...g, name: String(name).trim() }));
  }
  duplicateGraph(id) {
    const g = this.graphs.find((x) => x.id === id);
    if (!g) return null;
    const { lastBake, ...rest } = g;
    const copy = { ...rest, id: this.engine.newId('g'), name: this.#freshName(g.name + ' copy') };
    this.#commitGraphs('Graph: duplicate', [...this.graphs, copy], { open: copy.id });
    return copy.id;
  }
  async deleteGraph(id) {
    const g = this.graphs.find((x) => x.id === id);
    if (!g) return false;
    const ok = await this.app.confirm({ title: 'Delete graph?', message: `"${g.name}" (${g.nodes.length} nodes) will be deleted. Baked scripts stay.`, ok: 'Delete', danger: true });
    if (!ok) return false;
    const rest = this.graphs.filter((x) => x.id !== id);
    const wasActive = this.activeId === id;
    this.#commitGraphs('Graph: delete', rest, { open: wasActive ? rest[0]?.id ?? null : undefined });
    if (wasActive) { this.#resetView(); this.publish(); }   // also when no graph is left (activate(null) may be a no-op)
    return true;
  }
  setEnabled(id = this.activeId, on = true) {
    const g = this.graphs.find((x) => x.id === id);
    if (!g || (g.enabled !== false) === !!on) return;
    const next = { ...g };
    if (on) delete next.enabled; else next.enabled = false;
    this.#commitGraphs(on ? 'Graph: enable' : 'Graph: disable', this.#replace(this.graphs, next));
    if (!on && id === this.activeId) this.#clearResults();
  }
  importGraph(text) {
    const { graph, diags } = this.engine.parseGraphFile(text, this.registry);
    let g = graph;
    if (this.graphs.some((x) => x.id === g.id)) g = { ...g, id: this.engine.newId('g') };
    if (this.graphs.some((x) => x.name === g.name)) g = { ...g, name: this.#freshName(g.name) };
    this.#commitGraphs('Graph: import', [...this.graphs, g], { open: g.id });
    return { id: g.id, diags };
  }
  exportGraph(id = this.activeId) {
    const g = this.graphs.find((x) => x.id === id);
    if (!g) throw new Error('no such graph: ' + id);
    return this.engine.stringifyGraphFile(g);
  }

  // ---------------------------------------------------------------- presets and fixes
  #placePreset(g, preset, { x = 0, y = 0 } = {}) {
    const E = this.engine, r = E.applyPreset(g, this.registry, preset, { x, y });
    let graph = r.graph;
    const unbound = [];
    let ri = 0;
    for (const s of preset.slots || []) {
      const id = r.map?.[s.node];
      if (!id) continue;
      const n = s.auto === 'run' ? (s.n ?? ri++) : 0;   // s.n: that run slot again (two channels of one run)
      const v = resolveSlot(s.auto, this.sources, n);
      if (v) graph = E.setParams(graph, this.registry, id, { [s.param]: v });
      else unbound.push(s.auto === 'run' && n ? `run #${n + 1}` : s.auto);
    }
    return { graph, ids: r.ids, unbound };
  }
  applyPreset(presetId, { x = 0, y = 0 } = {}) {
    const pr = this.presets.find((p) => p.id === presetId);
    if (!pr) return { ids: [], reason: `no preset "${presetId}"` };
    if (!this.graph) this.newGraph({ name: pr.name });
    let out = null;
    const reason = this.mutate(`add preset ${pr.name}`, (g) => { out = this.#placePreset(g, pr, { x, y }); return out.graph; });
    if (!reason) this.#warnUnbound(pr, out?.unbound);
    return { ids: reason ? [] : out?.ids || [], reason };
  }
  #warnUnbound(pr, unbound) {
    if (unbound?.length) this.app.toast?.(`Preset "${pr.name}": no ${[...new Set(unbound)].join(', ')} found; pick the source on its node`, 'warn');
  }
  /** Hand-added Tracker run nodes (no run picked) get the first run no other src.run in the graph uses (src.run
   *  cannot evaluate without one). None left: they stay unbound and show 'pick a run'. Existing nodes are never touched. */
  #bindNewRuns(prev, next) {
    const old = new Set(prev.nodes.map((n) => n.id));
    const fresh = next.nodes.filter((n) => n.type === 'src.run' && !n.params?.run && !old.has(n.id));
    if (!fresh.length) return next;
    const runs = this.sources.list('run').map((r) => r.id);
    const used = new Set(next.nodes.filter((n) => n.type === 'src.run' && n.params?.run).map((n) => n.params.run));
    let g = next;
    for (const n of fresh) {
      const id = runs.find((r) => !used.has(r));
      if (!id) break;
      used.add(id);
      g = this.engine.setParams(g, this.registry, n.id, { run: id });
    }
    return g;
  }
  applyFix(fix) {
    if (!fix?.kind) return 'not a fix';
    const E = this.engine, reg = this.registry, a = fix.args || {};
    switch (fix.kind) {
      case 'setParam': return this.mutate(fix.label || 'fix', (g) => E.setParams(g, reg, a.node, { [a.key]: a.value }));
      case 'select': this.selectRequest = { node: a.node, seq: (this.selectRequest?.seq || 0) + 1 }; this.bump(); return '';
      case 'insertBefore': return this.mutate(fix.label || 'insert', (g) => {
        const link = g.links.find((l) => l.to === a.node && l.in === a.port);
        if (!link) return { graph: g, reason: `nothing is wired into ${a.port}` };
        const at = g.nodes.find((n) => n.id === a.node);
        const { graph, id } = E.addNode(g, reg, a.type, { x: (at?.x ?? 0) - 220, y: at?.y ?? 0 });
        return E.insertOnLink(graph, reg, link.id, id);
      });
      case 'insertAfter': return this.mutate(fix.label || 'insert', (g) => {
        const at = g.nodes.find((n) => n.id === a.node);
        let { graph, id } = E.addNode(g, reg, a.type, { x: (at?.x ?? 0) + 220, y: at?.y ?? 0 });
        const outs = graph.links.filter((l) => l.from === a.node && l.out === a.port);
        const ports = reg.portsOf(graph.nodes.find((n) => n.id === id), graph);
        const r1 = E.connect(graph, reg, { from: a.node, out: a.port, to: id, in: ports.ins[0]?.name });
        if (r1.reason) return { graph: g, reason: r1.reason };
        graph = E.disconnect(r1.graph, outs.map((l) => l.id));
        for (const l of outs) {
          const r = E.connect(graph, reg, { from: id, out: ports.outs[0]?.name, to: l.to, in: l.in });
          if (r.reason) return { graph: g, reason: r.reason };
          graph = r.graph;
        }
        return graph;
      });
      case 'freezeSource': {
        let ghost = null;
        const reason = this.mutate(fix.label || 'freeze source', (g) => {
          const r = freezePlan(g, a.node, this._snap || {}, { reg, now: this.now() });
          ghost = r.ghost;
          return r.graph;
        });
        if (!reason && ghost) {
          if (!this._frozen.has(ghost.id)) this._frozen.set(ghost.id, ghost);
          this.#syncFrozen();
          this.app.toast?.(`${ghost.name}: the graph now reads this frozen copy`, 'ok');
        }
        return reason;
      }
      default: return `unknown fix "${fix.kind}"`;
    }
  }

  // ---------------------------------------------------------------- bake
  /**
   * Full evaluation (never preview values) -> bakePlan -> confirm if an axis changed since the last bake ->
   * ONE app.transact for every axis (+ the graph's lastBake in app mode). opts: { nodes, range, disable }.
   */
  async bake({ nodes = null, range = null, disable = false } = {}) {
    const app = this.app, g0 = this.graph;
    if (!g0) return { ok: false, changed: [], message: 'No graph to bake' };
    if (this._baking) return { ok: false, changed: [], message: 'A bake is already running' };
    this._baking = true;
    try {
      const p = this.#programFor(g0);
      if (!p) return { ok: false, changed: [], message: this._compileError || 'The graph does not compile' };
      const outs = (nodes || p.outputs).filter((id) => p.nodes.get(id)?.node?.type === 'out.axis');
      if (!outs.length) return { ok: false, changed: [], message: 'The graph has no axis output to bake' };
      const ac = new AbortController();
      const t = app.task?.('Baking graph', { cancel: () => ac.abort() });
      let res;
      try { res = await this.engine.evaluate(p, this.#runCtx(ac.signal), { targets: outs, range: null }); }
      finally { t?.end(); }
      if (res.aborted) return { ok: false, changed: [], message: 'Bake cancelled' };
      if (this.graph === g0) this.#acceptFull(res);
      const plan = bakePlan(p, res, app.doc.axes, { only: nodes ? outs : null, range });
      const problems = [...plan.diags.map((d) => d.message), ...plan.skipped.filter((s) => s.reason !== 'unchanged' && s.reason !== 'muted').map((s) => `${this.#title(s.node)}: ${s.reason}`)];
      const differs = axisDiffersFromBake(g0, app.doc.axes).filter((d) => d.axis in plan.writes);
      const wipes = plan.wipes || [];
      if (differs.length || wipes.length) {
        const names = [...new Set(differs.map((d) => d.axis))].join(', ');
        const emptied = wipes.map((ax) => `${ax} (${(app.doc.axes?.[ax] || []).length} → ${plan.writes[ax].length})`).join(', ');
        const message = [wipes.length ? `The graph's result would empty ${emptied}.` : '', differs.length ? `${names} changed since the last bake of "${g0.name}".` : ''].filter(Boolean).join(' ');
        const c = await app.choose({ title: wipes.length ? 'Replace with an empty result?' : 'Overwrite edits?', message,
          detail: 'Baking replaces what is on those axes now. Undo brings it back.', choices: [{ id: 'overwrite', label: wipes.length ? 'Empty it' : 'Overwrite', kind: 'danger' }, { id: 'cancel', label: 'Cancel' }] });
        if (c !== 'overwrite') return { ok: false, changed: [], message: 'Bake cancelled' };
      }
      const g = this.graphs.find((x) => x.id === g0.id) || g0;
      let gNext = markBaked(g, res, plan, this.now());
      if (disable) gNext = { ...gNext, enabled: false };
      if (!plan.changed.length) {
        // disabling is the user's intent: an undo entry of its own (a quiet write would be overwritten by the next
        // undo of an older graph entry). A lastBake-only update ("already equal" counts as baked) stays quiet.
        if (disable) this.#commitGraphs(`Graph: disable "${g.name}"`, this.#replace(this.graphs, gNext));
        else if (gNext !== g) this.#writeQuiet(gNext);
        if (disable) this.#clearResults();
        const message = problems.length ? `Nothing baked: ${problems.join('; ')}` : 'Nothing changed';
        this.notify(message, problems.length ? 'warn' : 'quiet');
        return { ok: !problems.length, changed: [], message };
      }
      const n = (x) => x.toLocaleString('en-US').replace(/,/g, ' ');
      const counts = `${plan.changed.join(', ')} (${plan.changed.map((ax) => n(plan.writes[ax].length)).join(' + ')} actions)`;
      const label = `Bake "${g.name}" → ${plan.changed.join(', ')}`;
      app.transact(label, () => {
        for (const ax of plan.changed) app.edit(label, ax, plan.writes[ax]);
        if (this.undoMode === 'app') app.doc.graphs = this.#replace(app.doc.graphs || [], gNext);
      });
      if (this.undoMode === 'local') {
        // local mode keeps graphs out of app history: the disable gets a local undo entry, lastBake stays quiet
        if (disable) this.#commitGraphs(`Graph: disable "${g.name}"`, this.#replace(this._graphs, gNext));
        else this.#setLocal(this.#replace(this._graphs, gNext));
      }
      if (disable) this.#clearResults();
      const message = `Baked ${counts}${range ? ' in range' : ''}${problems.length ? ` · skipped: ${problems.join('; ')}` : ''}`;
      this.notify(message, problems.length || wipes.length ? 'warn' : 'ok', { action: { label: 'Undo', run: () => app.undo() } });
      this.bump();
      return { ok: true, changed: plan.changed, message };
    } finally { this._baking = false; }
  }
  /** A bake / evaluate toast that replaces the previous one, so repeated runs never stack identical toasts. */
  notify(msg, kind, opts) {
    if (this._toast != null) this.app.dismiss?.(this._toast);
    this._toast = this.app.toast?.(msg, kind, opts) ?? null;
  }
  #writeQuiet(g) {
    if (this.undoMode === 'app') this.app.doc.graphs = this.#replace(this.app.doc.graphs || [], g);
    else this.#setLocal(this.#replace(this._graphs, g));
  }

  dispose() {
    this._disposed = true;
    this._abort.full?.abort(); this._abort.preview?.abort();
    this.clearTimer(this._idle);
    this.#setGhosts([]);
  }
}

// Plain state the editor reads reactively: a getter that tracks, a setter that does not bump (callers bump once).
const REACTIVE = ['result', 'preview', 'busy', 'slow', 'live', 'probe', 'pins', 'snapshots', 'sources', 'selectRequest'];
for (const k of REACTIVE) {
  Object.defineProperty(GraphCore.prototype, k, {
    get() { this.track(); return this['_' + k]; },
    set(x) { this['_' + k] = x; },
    configurable: true,
  });
}
