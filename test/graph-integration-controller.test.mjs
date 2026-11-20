// The graph controller's logic (features/graph/integration/core.js) against a minimal app (the shell's real
// History, ARCHITECTURE.md's app surface) and a small stand-in evaluator, so it runs before/without eval.js.
// The model functions are the real lib/graph/model.js. A last test runs the real engine when it has landed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { History } from '../src/app/history.js';
import { GraphCore, resolveSlot } from '../src/features/graph/integration/core.js';
import { GRAPH_GHOST, makeSources, scriptHash } from '../src/lib/graph/doc.js';
import * as model from '../src/lib/graph/model.js';

const A = (...p) => p.map(([at, pos]) => ({ at, pos }));
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- a minimal app (src/app shapes)
function fakeApp({ appMode = false, doc = {} } = {}) {
  const UNDO = ['chapters', 'bookmarks', 'loops', 'plan', ...(appMode ? ['graphs'] : [])];
  const d = {
    axes: { stroke: A([0, 10], [500, 90], [1000, 10], [1500, 90]) }, activeAxis: 'stroke', selection: { axis: 'stroke', ats: new Set() },
    range: null, chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], media: { path: 'v.mp4', durationMs: 2000, fps: 30 },
    dirty: false, project: null, ...(appMode ? { graphs: [] } : {}), ...doc,
  };
  Object.defineProperty(d, 'read', { value: () => { const o = {}; for (const [k, v] of Object.entries(d.axes)) o['axes.' + k] = v; for (const k of UNDO) o[k] = d[k]; return o; } });
  const write = (p, v) => {
    if (p.startsWith('axes.')) { const n = { ...d.axes }; if (v === undefined) delete n[p.slice(5)]; else n[p.slice(5)] = v; d.axes = n; }
    else if (UNDO.includes(p)) d[p] = v ?? [];
  };
  const h = new History({ read: () => d.read(), write, readSel: () => ({ selection: d.selection }), writeSel: (s) => { if (s) d.selection = s.selection; }, onChange: () => { d.dirty = h.dirty; } });
  const settings = new Map();
  const app = {
    doc: d, durationMs: 2000, player: { frameMs: 1000 / 30 }, view: { start: 0, span: 2000 }, toasts: [], choices: [], answer: 'overwrite', confirmAnswer: true,
    settings: { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
    edit(label, axis, next) { if (d.axes[axis] !== next) h.transact(label, () => { d.axes = { ...d.axes, [axis]: next }; }); },
    transact: (l, fn, o) => h.transact(l, fn, o), begin: (l, o) => h.begin(l, o), undo: () => h.undo(), redo: () => h.redo(),
    history: { get canUndo() { return h.canUndo; }, get canRedo() { return h.canRedo; }, get entries() { return h.list(); }, markDirty: () => h.markDirty() },
    toast(m, k) { app.toasts.push([m, k]); }, async choose(o) { app.choices.push(o); return app.answer; }, async confirm() { return app.confirmAnswer; },
    task: () => ({ update() {}, end() {} }),
  };
  return app;
}

// ---------------------------------------------------------------- stand-in node types (real defineNode/registry)
const S = (name = 'script') => ({ name, type: 'script' });
const DEFS = [
  model.defineNode({ type: 'src.axis', title: 'Axis', group: 'Sources', ins: [], outs: [S()], params: [{ key: 'axis', type: 'text', default: 'stroke' }],
    reads: (p) => [['axis', p.axis]], eval: (_i, p, ctx) => ({ script: ctx.read('axis', p.axis) || [] }) }),
  model.defineNode({ type: 'src.ghost', title: 'Ghost', group: 'Sources', ins: [], outs: [S()], params: [{ key: 'ghost', type: 'text', default: '' }],
    reads: (p) => [['ghost', p.ghost]], eval: (_i, p, ctx) => { const g = ctx.read('ghost', p.ghost); if (!g) throw new Error('ghost not found'); return { script: g.script }; } }),
  model.defineNode({ type: 'amp.gain', title: 'Gain', group: 'Amplitude', ins: [{ ...S(), required: true }], outs: [S()], params: [{ key: 'gain', type: 'number', default: 1, min: 0, max: 4 }],
    eval: ({ script }, p) => ({ script: script.map((a) => ({ at: a.at, pos: Math.max(0, Math.min(100, Math.round(a.pos * p.gain))) })) }) }),
  model.defineNode({ type: 'test.boom', title: 'Boom', group: 'Test', ins: [{ ...S(), required: true }], outs: [S()], params: [], eval: () => { throw new Error('boom'); } }),
  model.defineNode({ type: 'out.axis', title: 'Axis output', group: 'Outputs', ins: [{ ...S(), required: true }], outs: [S('result')],
    params: [{ key: 'axis', type: 'text', default: 'stroke' }, { key: 'mode', type: 'choice', default: 'replace', choices: ['replace', 'inside', 'merge'] }, { key: 'seamMs', type: 'number', default: 0, min: 0, max: 2000 }],
    eval: ({ script }) => ({ result: script }) }),
  model.defineNode({ type: 'src.run', title: 'Tracker run', group: 'Sources', ins: [], outs: [S('points')], params: [{ key: 'run', type: 'text', default: '' }],
    reads: (p) => [['run', p.run]], eval: (_i, p) => { if (!p.run) throw new Error('pick a run'); return { points: [] }; } }),
  model.defineNode({ type: 'out.ghost', title: 'Ghost output', group: 'Outputs', ins: [{ ...S(), required: true }], outs: [S('result')],
    params: [{ key: 'name', type: 'text', default: '' }, { key: 'color', type: 'text', default: 'pink' }], eval: ({ script }) => ({ result: script }) }),
];

// A stand-in evaluator with the contract's shapes: pull, memo by (type, params, input keys, source identity).
function standInEngine() {
  const counts = { evals: 0, runs: 0 };
  const ids = new WeakMap(); let idn = 0;
  const tok = (v) => (v && typeof v === 'object' ? (ids.has(v) || ids.set(v, ++idn), 'o' + ids.get(v)) : JSON.stringify(v ?? null));
  const skey = (g) => JSON.stringify([g.nodes.map((n) => [n.id, n.type]), g.links.map((l) => [l.from, l.out, l.to, l.in])]);
  const build = (g, reg) => new Map(g.nodes.map((n) => [n.id, { node: n, def: reg.get(n.type), ports: reg.get(n.type) ? reg.portsOf(n, g) : { ins: [], outs: [], params: [] },
    inLinks: new Map(g.links.filter((l) => l.to === n.id).map((l) => [l.in, l])) }]));
  function compile(graph, reg) {
    const nodes = build(graph, reg), order = [], seen = new Set();
    const visit = (id) => { if (seen.has(id)) return; seen.add(id); for (const l of nodes.get(id).inLinks.values()) visit(l.from); order.push(id); };
    for (const n of [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) visit(n.id);
    return { graph, reg, nodes, order, outputs: graph.nodes.filter((n) => n.type === 'out.axis' || n.type === 'out.ghost').map((n) => n.id),
      types: new Map(), adapters: new Map(), diags: [], structureKey: skey(graph) };
  }
  function withGraph(p, graph) { if (skey(graph) !== p.structureKey) throw new Error('structure changed'); return { ...p, graph, nodes: build(graph, p.reg) }; }
  async function evaluate(p, run, { targets = p.outputs, range = null } = {}) {
    counts.runs++;
    await tick();
    const need = new Set(), add = (id) => { if (need.has(id) || !p.nodes.has(id)) return; need.add(id); for (const l of p.nodes.get(id).inLinks.values()) add(l.from); };
    for (const t of targets) add(String(t).split(':')[0]);
    const values = new Map(), status = new Map(), keys = new Map(), stats = new Map(), diags = [];
    for (const id of p.order) {
      if (!need.has(id)) continue;
      if (run.abort?.aborted) return { values, status, keys, stats, diags, ms: 0, aborted: true, range: range || { t0: 0, t1: run.durationMs }, window: !!range };
      const { node, def, inLinks } = p.nodes.get(id);
      const ins = {}, parts = [node.type, JSON.stringify(node.params)];
      let blocked = false;
      for (const [port, l] of inLinks) { if (status.get(l.from) === 'error' || status.get(l.from) === 'blocked') blocked = true; ins[port] = values.get(`${l.from}:${l.out}`); parts.push(port, keys.get(l.from)); }
      if (blocked) { status.set(id, 'blocked'); continue; }
      if (def.reads) for (const [k, r] of def.reads(node.params)) parts.push(tok(run.sources.get(k, r)));
      const key = parts.join('|'); keys.set(id, key);
      const hit = run.cache.get(key);
      let outs;
      if (hit) { outs = hit.outs; status.set(id, 'cached'); }
      else {
        try { counts.evals++; outs = def.eval(ins, node.params, { read: (k, r) => run.sources.get(k, r) }); status.set(id, 'ok'); run.cache.set(key, outs, 1); }
        catch (e) { status.set(id, 'error'); diags.push({ id: `throw@${id}`, node: id, severity: 'error', code: 'throw', message: e.message }); continue; }
      }
      stats.set(id, { ms: 0, bytes: 0, hit: !!hit });
      for (const [k, v] of Object.entries(outs)) values.set(`${id}:${k}`, v);
    }
    return { values, status, keys, stats, diags, ms: 1, aborted: false, range: range || { t0: 0, t1: run.durationMs }, window: !!range };
  }
  const createCache = () => { const m = new Map(); return { get: (k) => m.get(k), set: (k, outs, bytes) => m.set(k, { outs, bytes }), pinOnly() {}, clear: () => m.clear(), stats: () => ({ entries: m.size }) }; };
  const serializeGraphs = (gs) => ({ v: 1, items: JSON.parse(JSON.stringify(gs)) });
  const parseGraphs = (blk) => ({ graphs: blk?.items ? JSON.parse(JSON.stringify(blk.items)) : [], diags: [] });
  const parseGraph = (raw) => ({ graph: { rate: 50, links: [], ...raw, parsed: true }, diags: [] });
  const engine = { ...model, compile, withGraph, evaluate, createCache, serializeGraphs, parseGraphs, parseGraph,
    stringifyGraphFile: (g) => JSON.stringify({ format: 'pawgraph', version: 1, graph: g }), parseGraphFile: (t) => ({ graph: JSON.parse(t).graph, diags: [] }) };
  return { engine, counts };
}

function setup(opts = {}) {
  const app = fakeApp(opts);
  const { engine, counts } = standInEngine();
  const registry = model.createRegistry(DEFS);
  const timers = [];
  let bumps = 0;
  const core = new GraphCore({ app, engine, registry, presets: opts.presets || [], tracking: () => opts.tracking || null, bump: () => bumps++, raf: (f) => (timers.push(f), timers.length), setTimer: (f) => (timers.push(f), timers.length), clearTimer: () => {}, now: () => 1000 });
  const flush = async () => { for (let i = 0; i < 20 && timers.length; i++) { timers.splice(0).forEach((f) => f()); await tick(); await tick(); } };
  /** a graph: src.axis(stroke) -> gain -> out.axis(axis) */
  const chain = (axis = 'roll', gain = 0.5) => {
    core.newGraph({ name: 'Test' });
    let id;
    core.mutate('build', (g) => {
      let r = model.addNode(g, registry, 'src.axis', { params: { axis: 'stroke' } }); const s = r.id;
      r = model.addNode(r.graph, registry, 'amp.gain', { params: { gain } }); const m = r.id;
      r = model.addNode(r.graph, registry, 'out.axis', { params: { axis } }); id = r.id;
      let gg = model.connect(r.graph, registry, { from: s, out: 'script', to: m, in: 'script' }).graph;
      gg = model.connect(gg, registry, { from: m, out: 'script', to: id, in: 'script' }).graph;
      return gg;
    });
    return { out: id, gain: core.graph.nodes.find((n) => n.type === 'amp.gain').id, src: core.graph.nodes.find((n) => n.type === 'src.axis').id };
  };
  return { app, core, engine, counts, registry, flush, chain, bumps: () => bumps };
}

const graphGhosts = (app) => app.doc.ghosts.filter((g) => g.source?.kind === GRAPH_GHOST);

test('undo mode follows the shell: app.doc.graphs in Doc.UNDOABLE -> app, else local', () => {
  assert.equal(setup().core.undoMode, 'local');
  assert.equal(setup({ appMode: true }).core.undoMode, 'app');
});

test('bake writes every output as ONE undo step; undo/redo round trip (app mode, incl. lastBake)', async () => {
  const { app, core, chain, registry } = setup({ appMode: true });
  const { out } = chain('roll', 0.5);
  const twist = (() => { let id; core.mutate('add twist', (g) => { const r = model.addNode(g, registry, 'out.axis', { params: { axis: 'twist' } }); id = r.id; return model.connect(r.graph, registry, { from: g.nodes.find((n) => n.type === 'src.axis').id, out: 'script', to: id, in: 'script' }).graph; }); return id; })();
  const before = app.history.entries.length, stroke = app.doc.axes.stroke, rollBefore = app.doc.axes.roll;
  assert.equal(rollBefore, undefined);
  const r = await core.bake();
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.changed.sort(), ['roll', 'twist']);
  assert.equal(app.history.entries.length, before + 1, 'exactly one history entry');
  assert.match(app.history.entries.at(-1).label, /^Bake "Test" → /);
  assert.deepEqual(app.doc.axes.roll, stroke.map((a) => ({ at: a.at, pos: Math.round(a.pos * 0.5) })));
  assert.equal(app.doc.axes.twist, stroke, 'an output passes its script through untouched');
  assert.equal(core.bakeStatus(out), 'baked'); assert.equal(core.bakeStatus(twist), 'baked');
  app.undo();
  assert.equal(app.doc.axes.roll, undefined, 'undo removes axes the bake created');
  assert.equal(app.doc.axes.twist, undefined);
  assert.equal(core.graph.lastBake, undefined, 'and restores the bake status (graphs undo with it)');
  app.redo();
  assert.equal(app.doc.axes.roll.length, stroke.length);
  assert.equal(core.bakeStatus(out), 'baked');
  const again = await core.bake();
  assert.equal(again.message, 'Nothing changed'); assert.equal(app.history.entries.length, before + 1);
});

test('bake: axis edited since last bake asks first; cancel writes nothing; range bake; bake and disable', async () => {
  const { app, core, chain } = setup();
  const { out, gain } = chain('roll', 0.5);
  await core.bake();
  app.edit('hand edit', 'roll', A([0, 1], [100, 2]));
  assert.equal(core.bakeStatus(out), 'axis-differs');
  app.answer = 'cancel';
  const n = app.history.entries.length;
  const r = await core.bake();
  assert.equal(r.ok, false); assert.equal(app.choices.length, 1); assert.match(app.choices[0].message, /roll changed since the last bake/);
  assert.equal(app.history.entries.length, n); assert.deepEqual(app.doc.axes.roll, A([0, 1], [100, 2]));
  app.answer = 'overwrite';
  core.mutate('gain', (g) => model.setParams(g, core.registry, gain, { gain: 1 }));
  const rr = await core.bake({ range: { t0: 400, t1: 1100 } });
  assert.equal(rr.ok, true, rr.message);
  assert.deepEqual(app.doc.axes.roll, A([0, 1], [100, 2], [500, 90], [1000, 10]), 'only [400, 1100] replaced');
  await core.evaluateNow();
  assert.equal(core.bakeStatus(out), 'stale', 'a range bake does not claim the whole output');
  const d = await core.bake({ disable: true });
  assert.equal(d.ok, true); assert.equal(core.graph.enabled, false);
  assert.equal(graphGhosts(app).length, 0, 'disabled graphs publish nothing');
});

test('bake skips outputs reached by an error; independent outputs still bake', async () => {
  const { app, core, chain, registry } = setup({ appMode: true });
  const { src } = chain('roll', 1);
  core.mutate('bad branch', (g) => {
    let r = model.addNode(g, registry, 'test.boom'); const b = r.id;
    r = model.addNode(r.graph, registry, 'out.axis', { params: { axis: 'pitch' } });
    let gg = model.connect(r.graph, registry, { from: src, out: 'script', to: b, in: 'script' }).graph;
    return model.connect(gg, registry, { from: b, out: 'script', to: r.id, in: 'script' }).graph;
  });
  const res = await core.bake();
  assert.deepEqual(res.changed, ['roll']);
  assert.match(res.message, /waiting on an upstream error/);
  assert.equal(app.doc.axes.pitch, undefined);
});

test('preview ghost lifecycle: publish, live off, re-enable, switch graph, delete, dispose; stale ghosts dropped', async () => {
  const stale = { id: 'graph:old:n1', name: 'stale', script: A([0, 1]), visible: true, source: { kind: GRAPH_GHOST, graph: 'old' } };
  const tracker = { id: 'run1', name: 'Run 1', script: A([0, 3], [900, 70]), visible: true, source: { kind: 'tracker' } };
  const { app, core, chain, flush } = setup({ doc: { ghosts: [tracker, stale] } });
  assert.deepEqual(app.doc.ghosts.map((g) => g.id), ['run1'], 'stale graph ghosts from a file are removed on attach');
  const { out } = chain('roll', 0.5);
  await flush();
  let mine = graphGhosts(app);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, `graph:${core.activeId}:${out}`); assert.equal(mine[0].axis, 'roll'); assert.equal(mine[0].visible, true);
  assert.equal(app.doc.ghosts[0], tracker, 'other ghosts untouched');
  const arr = app.doc.ghosts;
  await core.evaluateNow();
  assert.equal(app.doc.ghosts, arr, 'an unchanged result does not rewrite doc.ghosts');
  // the user hides it in the lane: it stays hidden across re-publishes
  app.doc.ghosts = app.doc.ghosts.map((g) => (g.id === mine[0].id ? { ...g, visible: false } : g));
  core.mutate('gain', (g) => model.setParams(g, core.registry, g.nodes.find((n) => n.type === 'amp.gain').id, { gain: 0.25 }));
  await flush();
  assert.equal(graphGhosts(app)[0].visible, false); assert.equal(graphGhosts(app)[0].script[1].pos, 23);
  core.setLive(false);
  assert.equal(graphGhosts(app).length, 0, 'live off removes output previews');
  core.setLive(true);
  assert.equal(graphGhosts(app).length, 1);
  core.pin('A', out); await flush();
  assert.equal(graphGhosts(app).length, 2);
  const sid = core.snapshot(out);
  assert.ok(sid.endsWith(':snap1')); assert.equal(graphGhosts(app).length, 3);
  core.setEnabled(undefined, false); await flush();
  assert.equal(graphGhosts(app).filter((g) => g.source.role === 'output').length, 0, 'disabled: no outputs');
  core.setEnabled(undefined, true); await flush();
  const first = core.activeId;
  core.newGraph({ name: 'Other' }); await flush();
  assert.notEqual(core.activeId, first);
  assert.equal(graphGhosts(app).length, 0, 'switching graphs removes the previous graph previews');
  core.openGraph(first); await flush();
  assert.equal(graphGhosts(app).length, 1);
  assert.equal(await core.deleteGraph(first), true);
  assert.equal(graphGhosts(app).length, 0, 'deleting removes them');
  core.openGraph(core.graphs[0].id); core.dispose();
  assert.deepEqual(app.doc.ghosts.map((g) => g.id), ['run1']);
});

test('change detection: only a real source change re-evaluates; equal rebuilt values do not', async () => {
  const { app, core, chain, flush, counts } = setup();
  chain('roll', 0.5);
  await flush();
  const runs = counts.runs, evals = counts.evals;
  app.doc.range = null; app.doc.plan = []; app.doc.selection = { axis: 'stroke', ats: new Set() };   // rebuilt, equal content
  core.syncDoc(); await flush();
  assert.equal(counts.runs, runs, 'no evaluation scheduled');
  app.doc.plan = [{ id: 'p', t0: 0, t1: 100, kind: 'climax' }];            // not read by this graph
  core.syncDoc(); await flush();
  assert.ok(counts.runs > runs, 'a changed source schedules a run');
  assert.equal(counts.evals, evals, 'but the engine recomputes nothing (sources this graph does not read)');
  app.edit('edit', 'stroke', A([0, 50], [800, 60]));
  core.syncDoc(); await flush();
  assert.equal(counts.evals, evals + 3, 'the read axis changed: the chain recomputes');
  assert.deepEqual(graphGhosts(app)[0].script, A([0, 25], [800, 30]));
});

test('local mode: mutate, gesture, undo/redo, persisted in project.extra.graphs and re-read on project load', async () => {
  const { app, core, chain, engine } = setup();
  const { gain } = chain('roll', 0.5);
  assert.equal(core.canUndo, true);
  assert.equal(app.doc.project.extra.graphs.v, 1);
  assert.equal(app.doc.project.extra.graphs.items[0].nodes.length, 3);
  assert.equal(app.doc.dirty, true, 'a graph change makes the document dirty');
  const g = core.gesture('scrub gain');
  for (const v of [0.6, 0.7, 0.8]) g.update((x) => model.setParams(x, core.registry, gain, { gain: v }));
  g.commit();
  const node = () => core.graph.nodes.find((n) => n.id === gain);
  assert.equal(node().params.gain, 0.8);
  core.undo();
  assert.equal(node().params.gain, 0.5, 'a whole gesture is one step');
  core.redo(); assert.equal(node().params.gain, 0.8);
  const c = core.gesture('cancelled'); c.update((x) => model.setParams(x, core.registry, gain, { gain: 2 })); c.cancel();
  assert.equal(node().params.gain, 0.8);
  assert.equal(core.mutate('refused', (x) => ({ graph: x, reason: 'refused: would loop' })), 'refused: would loop');
  assert.equal(core.mutate('noop', (x) => x), '');
  // the project is saved and re-opened: a new block identity -> parsed, history cleared
  const saved = engine.serializeGraphs(core.graphs);
  app.doc.project = { path: 'x.pawproj', extra: { graphs: JSON.parse(JSON.stringify(saved)), other: 1 } };
  core.syncDoc();
  assert.equal(core.canUndo, false);
  assert.equal(core.graphs[0].nodes.find((n) => n.id === gain).params.gain, 0.8);
  core.renameGraph(core.activeId, 'Renamed');
  assert.equal(app.doc.project.extra.other, 1, 'other feature blocks survive');
  assert.equal(app.doc.project.path, 'x.pawproj');
});

test('app mode: graph edits are app history entries; a gesture is one entry', () => {
  const { app, core, chain } = setup({ appMode: true });
  const { gain } = chain('roll', 0.5);
  const n = app.history.entries.length;
  const g = core.gesture('scrub'); g.update((x) => model.setParams(x, core.registry, gain, { gain: 0.7 })); g.update((x) => model.setParams(x, core.registry, gain, { gain: 0.9 })); g.commit();
  assert.equal(app.history.entries.length, n + 1);
  assert.equal(app.history.entries.at(-1).label, 'Graph: scrub');
  core.undo();
  assert.equal(core.graph.nodes.find((x) => x.id === gain).params.gain, 0.5);
});

test('app mode: graphs that arrive with a project load are parsed once; undo-restored ones are not', () => {
  const { app, core, chain } = setup({ appMode: true });
  chain('roll', 0.5);
  const mine = app.doc.graphs;
  core.syncDoc();
  assert.equal(app.doc.graphs, mine, 'graphs the controller made are left alone');
  app.doc.graphs = [{ v: 1, id: 'gx', name: 'Loaded', nodes: [] }];      // what a shell load hands over (raw block items)
  core.syncDoc();
  assert.equal(app.doc.graphs[0].parsed, true); assert.equal(app.doc.graphs[0].rate, 50);
  const parsed = app.doc.graphs;
  core.syncDoc();
  assert.equal(app.doc.graphs, parsed, 'parsed only once');
  assert.equal(core.graph.id, 'gx');
});

test('fixes: setParam, freezeSource (pinned ghost + src.ghost), select request', async () => {
  const { app, core, chain, flush } = setup();
  const { src, gain } = chain('stroke', 0.5);
  assert.equal(core.applyFix({ kind: 'setParam', label: 'Set gain', args: { node: gain, key: 'gain', value: 2 } }), '');
  assert.equal(core.graph.nodes.find((n) => n.id === gain).params.gain, 2);
  assert.equal(core.applyFix({ kind: 'freezeSource', label: 'Freeze', args: { node: src } }), '');
  const frozen = app.doc.ghosts.find((g) => g.source?.kind === 'frozen');
  assert.ok(frozen?.pinned); assert.equal(frozen.script, app.doc.axes.stroke);
  const n = core.graph.nodes.find((x) => x.id === src);
  assert.deepEqual([n.type, n.params.ghost], ['src.ghost', frozen.id]);
  core.syncDoc(); await flush();
  const res = await core.bake();
  assert.equal(res.ok, true, res.message);
  core.applyFix({ kind: 'select', args: { node: gain } });
  assert.equal(core.selectRequest.node, gain);
  assert.match(core.applyFix({ kind: 'nope' }), /unknown fix/);
});

test('presets: slots bound from the document', () => {
  const ghosts = [
    { id: 'ref', name: 'Ref', script: [], pinned: true, source: { kind: 'reference' } },
    { id: 'run2', name: 'Run 2', script: [], source: { kind: 'tracker' } },
  ];
  const src = makeSources({ ghosts, runs: [{ id: 'run7', name: 'R7' }] });
  assert.equal(resolveSlot('tracker', src), 'run2');
  assert.equal(resolveSlot('reference', src), 'ref');
  assert.equal(resolveSlot('run', src), 'run7');
  assert.equal(resolveSlot('axis:roll', src), 'roll');
  assert.equal(resolveSlot('tracker', makeSources({})), '');

  const preset = { id: 'p1', name: 'Ghost to roll', description: '', tags: [],
    nodes: [{ id: 'a', type: 'src.ghost', x: 0, y: 0 }, { id: 'b', type: 'out.axis', x: 200, y: 0, params: { axis: 'roll' } }],
    links: [{ from: 'a', out: 'script', to: 'b', in: 'script' }], slots: [{ node: 'a', param: 'ghost', auto: 'tracker' }] };
  const { core } = setup({ doc: { ghosts }, presets: [preset] });
  const r = core.applyPreset('p1', { x: 100, y: 40 });
  assert.equal(r.reason, ''); assert.equal(r.ids.length, 2);
  const g = core.graph.nodes.find((n) => n.type === 'src.ghost');
  assert.equal(g.params.ghost, 'run2'); assert.equal(g.x, 100);
  assert.equal(core.graph.links.length, 1);
  assert.match(core.applyPreset('nope').reason, /no preset/);
});

test('graph list: new / rename / duplicate / import / export / delete with confirm', async () => {
  const { app, core, chain } = setup();
  chain('roll', 0.5);
  const id = core.activeId;
  const dup = core.duplicateGraph(id);
  assert.notEqual(dup, id); assert.equal(core.activeId, dup); assert.equal(core.graph.name, 'Test copy');
  const text = core.exportGraph(id);
  const { id: imp } = core.importGraph(text);
  assert.notEqual(imp, id, 'an imported graph with a taken id gets a new one');
  assert.equal(core.graphs.length, 3);
  app.confirmAnswer = false;
  assert.equal(await core.deleteGraph(imp), false); assert.equal(core.graphs.length, 3);
  app.confirmAnswer = true;
  assert.equal(await core.deleteGraph(imp), true); assert.equal(core.graphs.length, 2);
  assert.equal(core.newGraph(), core.activeId);
  assert.equal(core.graph.name, 'Graph');
});

// ---------------------------------------------------------------- the real engine, once it has landed
const has = (f) => existsSync(new URL('../src/lib/graph/' + f, import.meta.url));
const REAL = ['eval.js', 'serialize.js', 'nodes/sources.js', 'nodes/out.js'].every(has);
test('real engine: src.axis -> out.axis(roll) bakes as one undo step; graphs block round trip', { skip: !REAL && 'lib/graph eval.js / serialize.js / nodes not landed yet' }, async () => {
  const E = { ...model, ...(await import('../src/lib/graph/eval.js')), ...(await import('../src/lib/graph/serialize.js')), ...(await import('../src/lib/graph/types.js')) };
  let registry;
  if (has('nodes/index.js')) {
    const { createCatalogue } = await import('../src/lib/graph/nodes/index.js');
    const { compilePlan } = await import('../src/lib/gen/plan.js');
    registry = createCatalogue({ compilePlan });
  } else {
    const { SOURCES } = await import('../src/lib/graph/nodes/sources.js'), { OUTPUTS } = await import('../src/lib/graph/nodes/out.js');
    registry = model.createRegistry([...SOURCES, ...OUTPUTS]);
  }
  const app = fakeApp({ appMode: true });
  const core = new GraphCore({ app, engine: E, registry, raf: () => 0, setTimer: () => 0, clearTimer: () => {}, now: () => 7 });
  core.newGraph({ name: 'Real' });
  let out;
  core.mutate('build', (g) => {
    let r = model.addNode(g, registry, 'src.axis', { params: { axis: 'stroke' } }); const s = r.id;
    r = model.addNode(r.graph, registry, 'out.axis', { params: { axis: 'roll' } }); out = r.id;
    return model.connect(r.graph, registry, { from: s, out: 'script', to: out, in: 'script' }).graph;
  });
  const n = app.history.entries.length;
  const res = await core.bake();
  assert.equal(res.ok, true, res.message);
  assert.deepEqual(app.doc.axes.roll, app.doc.axes.stroke);
  assert.equal(app.history.entries.length, n + 1);
  assert.equal(core.bakeStatus(out), 'baked');
  assert.equal(core.graph.lastBake[out].hash, scriptHash(app.doc.axes.roll));
  // change detection end to end: an unread source changing recomputes nothing; the read axis does
  const warm = await core.evaluateNow();
  assert.ok([...warm.status.values()].every((st) => st === 'cached'), 'a second run recomputes 0 nodes');
  app.doc.plan = [{ id: 'p', t0: 0, t1: 100, kind: 'climax', recipe: 'climax', params: {} }];
  core.syncDoc();
  const r2 = await core.evaluateNow();
  assert.ok([...r2.status.values()].every((st) => st === 'cached'), 'plan is not read: still all cached');
  app.edit('hand', 'stroke', A([0, 40], [700, 60]));
  core.syncDoc();
  const r3 = await core.evaluateNow();
  assert.ok([...r3.status.values()].every((st) => st === 'ok'), 'the read axis changed: recomputed');
  assert.deepEqual(app.doc.ghosts.find((g) => g.source?.kind === GRAPH_GHOST)?.script, A([0, 40], [700, 60]), 'preview ghost follows');
  app.undo();
  core.syncDoc();
  const r4 = await core.evaluateNow();
  assert.ok([...r4.status.values()].every((st) => st === 'cached'), 'undo hands back the old array: cache hit');
  assert.equal(core.bakeStatus(out), 'baked');
  app.undo();
  assert.equal(app.doc.axes.roll, undefined);
  // the .pawproj block: serialise -> JSON text -> parse keeps the graph (incl. unknown keys and enabled)
  const g = { ...core.graph, enabled: false, futureKey: { a: 1 } };
  const back = E.parseGraphs(JSON.parse(JSON.stringify(E.serializeGraphs([g]))), registry);
  assert.equal(back.graphs.length, 1);
  assert.deepEqual(back.graphs[0].nodes.map((x) => [x.id, x.type, x.params.axis]), g.nodes.map((x) => [x.id, x.type, x.params.axis]));
  assert.equal(back.graphs[0].enabled, false); assert.deepEqual(back.graphs[0].futureKey, { a: 1 });
  const { graphsToProject, graphsFromProject } = await import('../src/features/graph/integration/persist.js');
  const pd = graphsToProject({ axes: {}, extra: { other: 2 } }, [g]);
  const rt = graphsFromProject(JSON.parse(JSON.stringify(pd)), registry);
  assert.equal(rt.graphs[0].id, g.id); assert.deepEqual(rt.extra, { other: 2 });
  assert.equal(graphsToProject(pd, []).extra.graphs, undefined);
});

// ---------------------------------------------------------------- regressions

test('bake: an empty result over a non-empty axis asks first; cancel keeps the axis; confirm empties it with a warning', async () => {
  const { app, core, registry } = setup({ appMode: true });
  core.newGraph({ name: 'Empty' });
  core.mutate('build', (g) => {
    let r = model.addNode(g, registry, 'src.axis', { params: { axis: 'nothing' } }); const s = r.id;
    r = model.addNode(r.graph, registry, 'out.axis', { params: { axis: 'stroke' } });
    return model.connect(r.graph, registry, { from: s, out: 'script', to: r.id, in: 'script' }).graph;
  });
  const stroke = app.doc.axes.stroke, n = app.history.entries.length;
  app.answer = 'cancel';
  const r = await core.bake();
  assert.equal(r.ok, false); assert.equal(app.choices.length, 1, 'a first bake that would empty an axis asks');
  assert.match(app.choices[0].message, /empty stroke \(4 → 0\)/);
  assert.equal(app.doc.axes.stroke, stroke); assert.equal(app.history.entries.length, n);
  app.answer = 'overwrite';
  const ok = await core.bake();
  assert.equal(ok.ok, true); assert.deepEqual(app.doc.axes.stroke, []);
  assert.equal(app.toasts.at(-1)[1], 'warn', 'an emptied axis is never an ok toast');
});

test('presets: repeated run slots take successive runs; too few runs leave the extra slot unbound and say so', () => {
  const preset = { id: 'mix', name: 'Mix', description: '', tags: [],
    nodes: [{ id: 'a', type: 'src.run', x: 0, y: 0 }, { id: 'b', type: 'src.run', x: 0, y: 200 }], links: [],
    slots: [{ node: 'a', param: 'run', auto: 'run' }, { node: 'b', param: 'run', auto: 'run' }] };
  const two = setup({ presets: [preset], tracking: { runs: [{ id: 'run1' }, { id: 'run2' }] } });
  two.core.newGraph({ preset: 'mix' });
  assert.deepEqual(two.core.graph.nodes.map((x) => x.params.run).sort(), ['run1', 'run2']);
  const one = setup({ presets: [preset], tracking: { runs: [{ id: 'run1' }] } });
  one.core.applyPreset('mix');
  assert.deepEqual(one.core.graph.nodes.map((x) => x.params.run).sort(), ['', 'run1'], 'never mixes a run with itself');
  assert.match(one.app.toasts.at(-1)[0], /no run #2 found/);
  assert.equal(resolveSlot('run', makeSources({ runs: [{ id: 'r1' }, { id: 'r2' }] }), 1), 'r2');
});

test('a hand-added Tracker run node binds the first unused run; a tracker ghost whose run is gone is offered as a run', () => {
  const ghost = { id: 'run9', name: '#9 flow', script: A([0, 3]), source: { kind: 'tracker' } };
  const { core, registry } = setup({ doc: { ghosts: [ghost] }, tracking: { runs: [{ id: 'run1' }] } });
  assert.deepEqual(core.sources.list('run').map((r) => r.id), ['run1', 'run9']);
  core.newGraph();
  const add = () => { let id; core.mutate('add', (g) => { const r = model.addNode(g, registry, 'src.run'); id = r.id; return r.graph; }); return core.graph.nodes.find((x) => x.id === id); };
  assert.equal(add().params.run, 'run1');
  assert.equal(add().params.run, 'run9', 'the next one takes the ghost-backed run');
  assert.equal(add().params.run, '', 'none left: unbound, not a duplicate');
  const first = core.graph.nodes[0];
  core.mutate('clear', (g) => model.setParams(g, registry, first.id, { run: '' }));
  assert.equal(core.graph.nodes[0].params.run, '', 'existing nodes are never rebound');
});

test('Ctrl+Z during a graph gesture (app mode) never breaks history: later edits still record', () => {
  // undo lands on a graph entry: the gesture ends and its late commit is a no-op
  const { app, core, chain, registry } = setup({ appMode: true });
  const { gain } = chain('roll', 0.5);
  const g1 = core.gesture('scrub');
  g1.update((x) => model.setParams(x, registry, gain, { gain: 0.9 }));
  app.undo();
  g1.commit();
  core.newGraph({ name: 'X' });
  core.mutate('later', (x) => ({ ...x, name: 'Y' }));
  const labels = app.history.entries.filter((e) => e.applied).map((e) => e.label);
  assert.deepEqual(labels.slice(-2), ['Graph: new', 'Graph: later'], 'edits after the interrupted gesture are recorded');
  app.undo(); assert.equal(core.graph.name, 'X');
  // undo lands on a script entry: the graph gesture survives and records as one entry
  const h = setup({ appMode: true }); const c = h.chain('roll', 0.5);
  const stroke = h.app.doc.axes.stroke;
  h.app.edit('hand', 'stroke', A([0, 1], [100, 2]));
  const g2 = h.core.gesture('scrub');
  g2.update((x) => model.setParams(x, h.registry, c.gain, { gain: 0.7 }));
  h.app.undo();
  assert.equal(h.app.doc.axes.stroke, stroke, 'the script edit was undone');
  g2.update((x) => model.setParams(x, h.registry, c.gain, { gain: 0.8 }));
  g2.commit();
  assert.equal(h.app.history.entries.at(-1).label, 'Graph: scrub');
  h.core.mutate('after', (x) => ({ ...x, name: 'After' }));
  assert.equal(h.app.history.entries.at(-1).label, 'Graph: after');
  h.app.undo(); h.app.undo();
  assert.equal(h.core.graph.nodes.find((x) => x.id === c.gain).params.gain, 0.5, 'the gesture undoes as one step back to its base');
});

test('bake and disable with nothing to bake is its own undo entry; Ctrl+Z re-enables without touching the earlier bake', async () => {
  const { app, core, chain } = setup({ appMode: true });
  chain('roll', 0.5);
  await core.bake();
  const baked = app.doc.axes.roll, n = app.history.entries.length;
  const r = await core.bake({ disable: true });
  assert.equal(r.message, 'Nothing changed'); assert.equal(core.graph.enabled, false);
  assert.equal(app.history.entries.length, n + 1); assert.match(app.history.entries.at(-1).label, /^Graph: disable/);
  app.undo();
  assert.equal(core.graph.enabled, undefined, 'enabled again');
  assert.equal(app.doc.axes.roll, baked, 'the earlier bake is untouched');
  // local mode: the disable is a local undo entry
  const L = setup(); L.chain('roll', 0.5);
  await L.core.bake();
  await L.core.bake({ disable: true });
  assert.equal(L.core.graph.enabled, false);
  L.core.undo();
  assert.equal(L.core.graph.enabled, undefined);
});

test('the active graph removed by undo: its pins and snapshots are not carried over to the fallback graph', async () => {
  for (const appMode of [true, false]) {
    const { app, core, chain, flush } = setup({ appMode });
    core.newGraph({ name: 'B' });
    const b = core.activeId;
    const { out } = chain('roll', 0.5);
    await flush();
    core.pin('A', out); core.snapshot(out); await flush();
    assert.ok(graphGhosts(app).some((g) => g.source.role === 'snapshot'));
    const undo = () => (appMode ? app.undo() : core.undo());
    undo(); undo();                       // the build, then "Graph: new" of Test
    core.syncDoc(); await flush();
    assert.equal(core.activeId, b, appMode ? 'app' : 'local');
    assert.equal(core.snapshots.length, 0); assert.equal(core.pins.A, null);
    assert.equal(graphGhosts(app).length, 0, 'no ghost of the removed graph under the fallback id');
  }
});

test('freezeSource: undo drops the frozen ghost, redo brings it back', () => {
  for (const appMode of [true, false]) {
    const { app, core, chain } = setup({ appMode });
    const { src } = chain('stroke', 0.5);
    assert.equal(core.applyFix({ kind: 'freezeSource', label: 'Freeze', args: { node: src } }), '');
    const frozen = () => app.doc.ghosts.filter((g) => g.source?.kind === 'frozen');
    assert.equal(frozen().length, 1);
    if (appMode) { app.undo(); core.syncDoc(); } else core.undo();
    assert.equal(frozen().length, 0, 'undo removes the copy with its reader');
    if (appMode) { app.redo(); core.syncDoc(); } else core.redo();
    assert.equal(frozen().length, 1, 'redo restores it');
    assert.equal(core.graph.nodes.find((n) => n.id === src).params.ghost, frozen()[0].id);
  }
});

test('a cycle: bake names the root cause (part of a loop) and repeated bakes replace their toast instead of stacking', { skip: !REAL && 'real engine not landed' }, async () => {
  const E = { ...model, ...(await import('../src/lib/graph/eval.js')), ...(await import('../src/lib/graph/serialize.js')), ...(await import('../src/lib/graph/types.js')) };
  const { createCatalogue } = await import('../src/lib/graph/nodes/index.js');
  const { compilePlan } = await import('../src/lib/gen/plan.js');
  const registry = createCatalogue({ compilePlan });
  const app = fakeApp({ appMode: true });
  let seq = 0; const live = new Set();
  app.toast = (m, k) => { app.toasts.push([m, k]); live.add(++seq); return seq; };
  app.dismiss = (id) => live.delete(id);
  const core = new GraphCore({ app, engine: E, registry, raf: () => 0, setTimer: () => 0, clearTimer: () => {}, now: () => 7 });
  core.newGraph({ name: 'Loop' });
  core.mutate('build', (g) => {
    let r = model.addNode(g, registry, 'script.trim'); const a = r.id;
    r = model.addNode(r.graph, registry, 'script.trim'); const b = r.id;
    r = model.addNode(r.graph, registry, 'out.axis', { params: { axis: 'roll' } }); const o = r.id;
    const L = (id, from, to) => ({ id, from, out: 'script', to, in: 'script' });
    return { ...r.graph, links: [L('l1', a, b), L('l2', b, a), L('l3', b, o)] };   // model.connect refuses loops: wire it by hand
  });
  const res = await core.bake();
  assert.equal(res.ok, false);
  assert.match(res.message, /part of a loop/, res.message);
  await core.bake(); await core.bake();
  assert.equal(live.size, 1, 'one bake toast on screen after three bakes');
});
