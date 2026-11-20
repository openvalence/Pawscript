// lib/graph/doc.js: sources over a synthetic document, hash stability, preview ghosts, bake plans, bake marks,
// freeze. Programs and results are hand-built in the contract's shapes (§5), so this needs no engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSources, stabilize, GRAPH_GHOST, ghostId, mergeGhosts, previewList, bakePlan, scriptHash, sameScript,
  axisDiffersFromBake, markBaked, freezePlan,
} from '../src/lib/graph/doc.js';
import { pyramidToEnvelope, readSnapshot, readDeps } from '../src/features/graph/integration/snapshot.js';

const A = (...p) => p.map(([at, pos]) => ({ at, pos }));
const deepFreeze = (o) => { if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

function snapshot() {
  const stroke = A([0, 10], [500, 90], [1000, 10], [1500, 90]);
  return deepFreeze({
    axes: { stroke, roll: A([0, 50], [1500, 60]) },
    ghosts: [
      { id: 'run1', name: 'Run 1: flow', color: '#1FE59A', script: A([0, 20], [600, 80]), visible: true, source: { kind: 'tracker', tracker: 'flow' } },
      { id: 'ref', name: 'Reference', color: '#E8D8A0', script: stroke, visible: false, pinned: true, source: { kind: 'reference', path: 'x.funscript' } },
      { id: ghostId('g1', 'n9'), name: 'Graph → stroke', color: 'x', script: A([0, 0]), visible: true, source: { kind: GRAPH_GHOST, graph: 'g1', node: 'n9' } },
    ],
    plan: [{ id: 'p1', t0: 0, t1: 800, kind: 'foreplay', recipe: 'smooth-small', params: {} }, { id: 'p2', t0: 800, t1: 1500, kind: 'mystery', recipe: 'x', params: {} }],
    chapters: [{ id: 'c1', t0: 0, t1: 1000, name: 'Intro', color: '#fff' }], loops: [], bookmarks: [{ id: 'b1', at: 300, note: 'hi' }],
    range: { t0: 200, t1: 900 }, selection: { axis: 'stroke', ats: new Set([500]) }, media: { durationMs: 2000, fps: 30 },
    runs: [{ id: 'run1', name: 'Run 1', tracker: 'flow', samples: { t: new Float64Array([0, 40]), v: new Float32Array([0.1, 0.9]) }, channels: { dx: { t: new Float64Array([0]), v: new Float32Array([1]) } } }],
    scenes: [{ start_ms: 0, end_ms: 2000 }], trackSpans: [], audio: null, tags: null, durationMs: 2000, frameMs: 1000 / 30,
  });
}

test('makeSources: identity preserved, graph ghosts invisible, pickers', () => {
  const s = snapshot(), src = makeSources(s);
  assert.equal(src.get('axis', 'stroke'), s.axes.stroke);
  assert.equal(src.get('plan'), s.plan);
  assert.equal(src.get('range'), s.range);
  assert.equal(src.get('run', 'run1'), s.runs[0]);
  assert.equal(src.get('ghost', 'run1'), s.ghosts[0]);
  assert.equal(src.get('ghost', 'Reference'), s.ghosts[1], 'binds by name when the id misses');
  assert.equal(src.get('ghost', ghostId('g1', 'n9')), undefined, "a graph never reads its own previews");
  assert.equal(src.get('axis', 'pitch'), undefined);
  assert.deepEqual(src.list('ghost').map((g) => g.id), ['run1', 'ref']);
  const axes = src.list('axis').map((a) => a.id);
  assert.equal(axes[0], 'stroke'); assert.ok(axes.includes('roll') && axes.includes('twist') && axes.includes('pitch'));
  assert.ok(src.list('kind').some((k) => k.id === 'climax'), 'every lib/gen kind');
  assert.ok(src.list('kind').some((k) => k.id === 'mystery'), 'plus kinds only the plan uses');
  assert.deepEqual(src.list('channel', 'run1').map((c) => c.id), ['primary', 'dx']);
  assert.equal(src.list('ghost'), src.list('ghost'), 'lists are memoised per Sources');
});

test('stabilize: content-equal small values keep their identity; scripts by identity only', () => {
  const s = snapshot();
  assert.equal(stabilize({ ...s }, s), s, 'nothing changed -> prev itself');
  const rebuilt = { ...s, range: { t0: 200, t1: 900 }, plan: s.plan.map((p) => ({ ...p })), selection: { axis: 'stroke', ats: new Set([500]) }, axes: { ...s.axes } };
  assert.equal(stabilize(rebuilt, s), s, 'equal content, new objects -> still prev');
  const moved = stabilize({ ...s, range: { t0: 200, t1: 901 } }, s);
  assert.notEqual(moved, s); assert.notEqual(moved.range, s.range); assert.equal(moved.plan, s.plan);
  const edited = stabilize({ ...s, axes: { ...s.axes, stroke: [...s.axes.stroke] } }, s);
  assert.notEqual(edited.axes, s.axes, 'a new script array is a change (no content hashing of scripts)');
  const g2 = [...s.ghosts.slice(0, 2), { ...s.ghosts[2], script: A([0, 1]) }];
  assert.equal(stabilize({ ...s, ghosts: g2 }, s), s, "the graph's own ghosts changing is not a source change");
});

test('scriptHash is stable, content-based and memoised; sameScript', () => {
  const a = A([0, 10], [100, 20]), b = A([0, 10], [100, 20]), c = A([0, 10], [100, 21]);
  assert.equal(scriptHash(a), scriptHash(b));
  assert.notEqual(scriptHash(a), scriptHash(c));
  assert.notEqual(scriptHash(A([0, 1], [1, 0])), scriptHash(A([1, 0], [0, 1])));
  assert.notEqual(scriptHash([]), scriptHash(A([0, 0])));
  assert.equal(scriptHash(a), scriptHash(a));
  assert.ok(sameScript(a, b)); assert.ok(!sameScript(a, c)); assert.ok(sameScript(a, a)); assert.ok(!sameScript(a, A([0, 10])));
});

// ---- hand-built programs/results (contract §5 shapes)
function program(nodes, gid = 'g1') {
  const map = new Map(nodes.map((n) => [n.id, { node: n, def: { title: n.type, outs: [{ name: n.type.startsWith('out.') ? 'result' : 'script', type: 'script' }] }, ports: { ins: [], outs: [{ name: n.type.startsWith('out.') ? 'result' : 'script', type: 'script' }], params: [] }, inLinks: new Map() }]));
  return { graph: { id: gid, nodes, links: [] }, nodes: map, outputs: nodes.filter((n) => n.type.startsWith('out.')).map((n) => n.id), order: nodes.map((n) => n.id), types: new Map(), adapters: new Map(), diags: [] };
}
function result(entries, { window = false } = {}) {
  const values = new Map(), status = new Map(), keys = new Map();
  for (const [id, st, port, v] of entries) { status.set(id, st); if (v) values.set(`${id}:${port}`, v); keys.set(id, 'k' + id + (v ? scriptHash(v) : '')); }
  return { values, status, keys, stats: new Map(), diags: [], ms: 1, aborted: false, range: { t0: 0, t1: 2000 }, window };
}
const outAxis = (id, axis, extra = {}) => ({ id, type: 'out.axis', tv: 1, x: 0, y: 0, params: { axis, mode: 'replace', seamMs: 0 }, ...extra });

test('previewList: outputs, ghost, pins, probe, snapshots; muted/preview:false/errors left out', () => {
  const S = A([0, 5], [100, 95]);
  const p = program([outAxis('o1', 'roll'), outAxis('o2', 'twist', { preview: false }), outAxis('o3', 'pitch', { muted: true }), outAxis('o4', 'surge'),
    { id: 'gh', type: 'out.ghost', tv: 1, x: 0, y: 0, params: { name: 'Try B', color: 'lime' } }, { id: 's1', type: 'edit.smooth', tv: 1, x: 0, y: 0, params: {} }]);
  const r = result([['o1', 'ok', 'result', S], ['o2', 'ok', 'result', S], ['o3', 'muted', 'result', null], ['o4', 'error', 'result', null], ['gh', 'cached', 'result', S], ['s1', 'ok', 'script', S]]);
  const list = previewList(p, r, { pins: { A: { node: 's1' }, B: null }, probe: { node: 's1', port: 'script' }, snapshots: [{ id: ghostId('g1', 'snap1'), name: 'Smooth @ 14:02', node: 's1', script: S }], colors: { violet: '#a98bff' }, activeAxis: 'stroke' });
  assert.deepEqual(list.map((e) => e.id), ['graph:g1:o1', 'graph:g1:gh', 'graph:g1:A', 'graph:g1:probe', 'graph:g1:snap1']);
  const [o1, gh, pa] = list;
  assert.equal(o1.axis, 'roll'); assert.equal(o1.color, '#a98bff'); assert.equal(o1.script, S); assert.equal(o1.name, 'Graph → roll');
  assert.deepEqual(o1.source, { kind: 'graph', graph: 'g1', node: 'o1', role: 'output' });
  assert.equal(gh.axis, 'stroke'); assert.equal(gh.color, 'lime'); assert.equal(gh.name, 'Try B');
  assert.equal(pa.color, 'sky'); assert.equal(pa.source.role, 'pin'); assert.equal(pa.source.port, 'script');
  assert.equal(previewList(p, null).length, 0, 'no result -> no entries');
});

test('mergeGhosts: replaces only graph ghosts, keeps the user visible flag, returns the same array when unchanged', () => {
  const doc = snapshot().ghosts, S = A([0, 1]);
  const mine = [{ id: ghostId('g1', 'n9'), name: 'Graph → stroke', axis: 'stroke', color: 'x', script: S, source: { kind: 'graph', graph: 'g1', node: 'n9', role: 'output' } }];
  const m1 = mergeGhosts(doc, mine);
  assert.equal(m1.length, 3); assert.equal(m1[0], doc[0]); assert.equal(m1[1], doc[1]); assert.equal(m1[2].script, S);
  assert.equal(mergeGhosts(m1, mine), m1, 'same content -> same array');
  const hidden = m1.map((g) => (g.id === mine[0].id ? { ...g, visible: false } : g));
  const m2 = mergeGhosts(hidden, mine);
  assert.equal(m2, hidden, 'a hidden preview stays hidden and nothing changes');
  const m3 = mergeGhosts(hidden, [{ ...mine[0], script: A([0, 2]) }]);
  assert.equal(m3[2].visible, false, 'new value, still hidden');
  const cleared = mergeGhosts(m1, []);
  assert.deepEqual(cleared.map((g) => g.id), ['run1', 'ref']);
  assert.equal(mergeGhosts(cleared, []), cleared);
});

test('bakePlan: two axes, unchanged skipped, collision, range, windowed refused', () => {
  const axes = deepFreeze({ stroke: A([0, 0], [1000, 100], [2000, 0]), roll: A([0, 50]) });
  const R = A([0, 10], [500, 90], [1000, 10], [1500, 90], [2000, 10]), T = A([0, 30], [2000, 70]);
  const p = program([outAxis('o1', 'stroke'), outAxis('o2', 'twist'), outAxis('o3', 'roll'), outAxis('o4', 'pitch')]);
  const r = result([['o1', 'ok', 'result', R], ['o2', 'cached', 'result', T], ['o3', 'ok', 'result', axes.roll], ['o4', 'blocked', 'result', null]]);
  const plan = bakePlan(p, r, axes);
  assert.deepEqual(plan.changed.sort(), ['stroke', 'twist']);
  assert.equal(plan.writes.stroke, R, 'result is exactly what bake writes');
  assert.equal(plan.writes.roll, undefined);
  assert.deepEqual(plan.skipped.map((s) => [s.node, s.reason.split(' ')[0]]).sort(), [['o3', 'unchanged'], ['o4', 'waiting']]);
  assert.deepEqual(Object.keys(plan.hashes).sort(), ['o1', 'o2', 'o3']);
  assert.equal(plan.hashes.o1, scriptHash(R));

  const only = bakePlan(p, r, axes, { only: ['o2'] });
  assert.deepEqual(only.changed, ['twist']);

  const ranged = bakePlan(p, r, axes, { only: ['o1'], range: { t0: 400, t1: 1100 } });
  assert.deepEqual(ranged.writes.stroke, A([0, 0], [500, 90], [1000, 10], [2000, 0]));
  assert.deepEqual(ranged.range, { t0: 400, t1: 1100 });

  const p2 = program([outAxis('a', 'stroke'), outAxis('b', 'stroke')]);
  const col = bakePlan(p2, result([['a', 'ok', 'result', R], ['b', 'ok', 'result', T]]), axes);
  assert.deepEqual(col.writes, {}); assert.equal(col.diags.length, 2); assert.ok(col.diags.every((d) => d.code === 'output-collision' && d.severity === 'error'));

  assert.throws(() => bakePlan(p, result([['o1', 'ok', 'result', R]], { window: true }), axes), /windowed/);
});

test('markBaked + axisDiffersFromBake', () => {
  const R = A([0, 10], [500, 90]);
  const g = deepFreeze({ v: 1, id: 'g1', name: 'G', rate: 50, nodes: [outAxis('o1', 'stroke')], links: [] });
  const p = program(g.nodes), r = result([['o1', 'ok', 'result', R]]);
  const plan = bakePlan(p, r, { stroke: [] });
  const g2 = markBaked(g, r, plan, 1234);
  assert.deepEqual(g2.lastBake.o1, { axis: 'stroke', key: r.keys.get('o1'), hash: scriptHash(R), time: 1234 });
  assert.equal(g.lastBake, undefined, 'input untouched');
  assert.deepEqual(axisDiffersFromBake(g2, { stroke: [...R] }), [], 'equal content counts as the baked axis');
  assert.deepEqual(axisDiffersFromBake(g2, { stroke: A([0, 11], [500, 90]) }), [{ node: 'o1', axis: 'stroke' }]);
  assert.deepEqual(axisDiffersFromBake({ ...g2, nodes: [] }, {}), [], 'deleted outputs are ignored');
  const ranged = markBaked(g, r, { ...plan, range: { t0: 0, t1: 100 } }, 1);
  assert.match(ranged.lastBake.o1.key, /@0-100$/);
  assert.equal(markBaked(g, r, { hashes: {} }, 1), g);
});

test('freezePlan: pinned ghost copy + src.ghost on the same id (links survive)', () => {
  const s = snapshot();
  const g = deepFreeze({ v: 1, id: 'g1', name: 'G', rate: 50, nodes: [{ id: 'n1', type: 'src.axis', tv: 1, x: 0, y: 0, params: { axis: 'stroke' } }, outAxis('o1', 'stroke')],
    links: [{ id: 'l1', from: 'n1', out: 'script', to: 'o1', in: 'script' }] });
  const reg = { get: (t) => (t === 'src.ghost' ? { version: 2, params: [{ key: 'ghost', default: '' }, { key: 'extra', default: 7 }] } : null) };
  const { ghost, graph } = freezePlan(g, 'n1', s, { reg, now: 5 });
  assert.equal(ghost.script, s.axes.stroke); assert.equal(ghost.pinned, true); assert.notEqual(ghost.source.kind, GRAPH_GHOST);
  const n = graph.nodes.find((x) => x.id === 'n1');
  assert.deepEqual([n.type, n.tv, n.params], ['src.ghost', 2, { ghost: ghost.id, extra: 7 }]);
  assert.equal(graph.links, g.links);
  assert.equal(makeSources({ ...s, ghosts: [...s.ghosts, ghost] }).get('ghost', ghost.id), ghost, 'the graph can read the frozen copy');
  assert.equal(freezePlan(g, 'n1', s).ghost.id, ghost.id, 'deterministic id');
  assert.throws(() => freezePlan(g, 'o1', s), /not an axis source/);
});

test('pyramidToEnvelope: peak envelope 0..1 on a 10 ms grid', () => {
  // 8000 Hz, 64-sample bins = 8 ms; a loud second half
  const n = 250, min = new Float32Array(n), max = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = i < n / 2 ? 0.1 : 0.5; min[i] = -a; max[i] = a * 0.8; }
  const env = pyramidToEnvelope({ sampleRate: 8000, base: 64, length: n * 64, levels: [{ per: 64, min, max }] }, 10);
  assert.equal(env.dt, 10); assert.equal(env.i0, 0);
  assert.equal(env.v.length, Math.floor((n * 64 / 8000) * 1000 / 10) + 1);
  assert.ok(Math.abs(env.v[10] - 0.2) < 1e-6, 'quiet part = 0.1 / 0.5');
  assert.equal(env.v[180], 1);
  assert.equal(pyramidToEnvelope(null), null);
});

test('bakePlan.wipes: changed axes the result would empty or collapse (callers ask first)', () => {
  const axes = deepFreeze({ stroke: A([0, 0], [1000, 100]), roll: A([0, 50]), twist: [] });
  const p = program([outAxis('o1', 'stroke'), outAxis('o2', 'roll'), outAxis('o3', 'twist'), outAxis('o4', 'pitch')]);
  const r = result([['o1', 'ok', 'result', A([0, 5])], ['o2', 'ok', 'result', A([0, 10], [500, 90])], ['o3', 'ok', 'result', A([0, 1], [9, 2])], ['o4', 'ok', 'result', A([0, 1])]]);
  const plan = bakePlan(p, r, axes);
  assert.deepEqual(plan.wipes, ['stroke'], '2 -> 1 action collapses; growing or new axes do not count');
  const empty = bakePlan(program([outAxis('o2', 'roll')]), result([['o2', 'ok', 'result', []]]), axes);
  assert.deepEqual(empty.wipes, ['roll']);
});

test('makeSources list(run): live runs, then tracker ghosts whose run is gone', () => {
  const s = snapshot();
  const extra = { id: 'run5', name: '#5 flow', script: A([0, 1]), source: { kind: 'tracker' } };
  const src = makeSources({ ...s, ghosts: [...s.ghosts, extra] });
  assert.deepEqual(src.list('run').map((r) => r.id), ['run1', 'run5'], 'run1 is live (its ghost is not listed twice); run5 only has a ghost');
  assert.match(src.list('run')[1].detail, /ghost only/);
});

test('readDeps touches every document value readSnapshot can read (scene edits re-evaluate without a tracking store)', () => {
  const seen = (fn) => {
    const keys = new Set();
    const doc = new Proxy({ axes: {}, scenes: [], media: { fps: 30 } }, { get(t, k) { keys.add(k); return t[k]; } });
    fn({ doc, durationMs: 1000, player: null });
    return keys;
  };
  for (const tracking of [null, { runs: [], scenes: [], spans: [] }]) {
    const snap = seen((app) => readSnapshot(app, tracking)), deps = seen((app) => readDeps(app, tracking));
    for (const k of snap) assert.ok(deps.has(k), `readDeps misses doc.${String(k)}`);
  }
});
