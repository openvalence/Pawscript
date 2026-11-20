import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtTime, parseTime, selectionStats, rangeStats, axisStats, pointInfo, resolveScope, chapterAt, runOp, diffScripts, previewStats,
  batchEdit, movePoint, normParam, defaultsFor, coerceParams, groupOps, sliderOK, makeSnippet, parseSnippets, serializeSnippets, placeSnippet,
  snippetFromSelection, yielded,
} from '../src/features/inspector/logic.js';
import { Registry } from '../src/app/commands.js';
import { applyTransform, computeScope, applyBatch, applyPoint, setPreview, pasteSnippet, selectRange } from '../src/features/inspector/actions.js';
import { OPS } from '../src/lib/edit/index.js';
import { isValid } from '../src/lib/core/script.js';
import { budget } from './perf.mjs';

const S = (...p) => p.map(([at, pos]) => ({ at, pos }));
const zig = (n, dt = 100) => Array.from({ length: n }, (_, i) => ({ at: i * dt, pos: i % 2 ? 90 : 10 }));
const op = (id) => OPS.find((o) => o.id === id);

// an app double with the shell semantics we depend on (edit / transact / selection / ghosts)
function mockApp(axes, extra = {}) {
  const log = [];
  const app = {
    doc: { axes, activeAxis: 'stroke', selection: { axis: 'stroke', ats: new Set() }, range: null, chapters: [], ghosts: [], ...extra },
    player: { timeMs: 0, frameMs: 1000 / 30 },
    edits: log,
    edit(label, axis, next) { log.push({ label, axis }); app.doc.axes = { ...app.doc.axes, [axis]: next }; },
    transact(label, fn, opts) { log.push({ group: label, opts }); fn(); },
    toast() {},
  };
  return app;
}

test('fmtTime / parseTime', () => {
  assert.equal(fmtTime(83456), '1:23.456');
  assert.equal(fmtTime(3723004), '1:02:03.004');
  assert.equal(parseTime('1:23.456'), 83456);
  assert.equal(parseTime('83456'), 83456);
  assert.equal(parseTime('2.5s'), 2500);
  assert.equal(parseTime('f30', { fps: 30 }), 1000);
  assert.equal(parseTime('+500', { base: 1000 }), 1500);
  assert.equal(parseTime('-500', { base: 1000 }), 500);
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.ok(Number.isNaN(parseTime('')));
});

test('selectionStats: count, span, pos, strokes/min, peak speed', () => {
  const s = zig(11);
  const st = selectionStats(s, new Set(s.map((a) => a.at)));
  assert.equal(st.count, 11);
  assert.equal(st.span, 1000);
  assert.deepEqual([st.posMin, st.posMax], [10, 90]);
  assert.equal(st.peakSpeed, 800);
  assert.ok(Math.abs(st.spm - 300) < 1, `spm ${st.spm}`);
  assert.equal(selectionStats(s, new Set()).count, 0);
  assert.equal(selectionStats(s, new Set([55555])).count, 0);
});

test('selection speed includes the segments touching the selection', () => {
  const s = S([0, 0], [1000, 0], [1100, 100], [2000, 100]);
  assert.equal(selectionStats(s, new Set([1000])).peakSpeed, 1000);
  assert.equal(selectionStats(s, new Set([1100])).peakSpeed, 1000);
  assert.equal(selectionStats(s, new Set([0])).peakSpeed, 0);
});

test('rangeStats / axisStats / pointInfo', () => {
  const s = zig(11);
  assert.equal(rangeStats(s, 200, 500).count, 4);
  assert.equal(rangeStats(s, 5000, 6000).count, 0);
  assert.equal(axisStats([]).count, 0);
  assert.equal(axisStats(s).duration, 1000);
  const p = pointInfo(s, 300);
  assert.deepEqual([p.at, p.pos, p.speedIn, p.speedOut, p.prevAt, p.nextAt], [300, 90, 800, 800, 200, 400]);
  assert.equal(pointInfo(s, 0).speedIn, null);
  assert.equal(pointInfo(s, 1000).speedOut, null);
  assert.equal(pointInfo(s, 7), null);
});

test('resolveScope: selection / range / chapter / axis / all', () => {
  const stroke = zig(11), roll = S([0, 50], [500, 60]);
  const doc = { axes: { stroke, roll }, activeAxis: 'stroke', selection: { axis: 'stroke', ats: new Set([100, 200, 9999]) },
    range: { t0: 300, t1: 600 }, chapters: [{ id: 'a', t0: 0, t1: 450, name: 'A' }, { id: 'b', t0: 500, t1: 1000, name: 'B' }] };
  let r = resolveScope(doc, 'selection');
  assert.equal(r.targets[0].ats.size, 2); assert.deepEqual([...r.targets[0].sel.ats], [100, 200]);
  r = resolveScope(doc, 'range');
  assert.deepEqual(r.targets[0].sel, { t0: 300, t1: 600 }); assert.equal(r.targets[0].ats.size, 4);
  r = resolveScope(doc, 'chapter', 700);
  assert.equal(r.label, 'B'); assert.deepEqual(r.targets[0].sel, { t0: 500, t1: 1000 });
  assert.equal(chapterAt(doc.chapters, 470).id, 'a');
  r = resolveScope(doc, 'axis'); assert.equal(r.targets[0].sel, null); assert.equal(r.targets[0].ats.size, 11);
  r = resolveScope(doc, 'all'); assert.deepEqual(r.targets.map((t) => t.axis), ['stroke', 'roll']);
  assert.equal(resolveScope({ ...doc, selection: { axis: 'roll', ats: new Set([0]) } }, 'selection').empty, true);
  assert.equal(resolveScope({ ...doc, range: null }, 'range').empty, true);
  assert.equal(resolveScope({ ...doc, chapters: [] }, 'chapter').empty, true);
  assert.match(resolveScope({ ...doc, selection: { axis: 'stroke', ats: new Set() } }, 'selection').why, /no points selected/);
});

test('resolveScope selection: big select-all is one pass, no copy; small selections still drop stale times', () => {
  const big = zig(100000, 50), all = new Set(big.map((p) => p.at));
  const doc = { axes: { stroke: big }, activeAxis: 'stroke', selection: { axis: 'stroke', ats: all } };
  resolveScope(doc, 'selection');
  const t = performance.now(), r = resolveScope(doc, 'selection'), ms = performance.now() - t;
  assert.equal(r.targets[0].ats, all); assert.equal(r.label, '100000 selected');
  budget(ms < 30, `select-all of 100k took ${ms.toFixed(1)} ms`);
  // small selection on a big script (binary-search path) and a big one (linear path), both with a stale time
  const small = resolveScope({ ...doc, selection: { axis: 'stroke', ats: new Set([50, 7, 100]) } }, 'selection');
  assert.deepEqual([...small.targets[0].ats], [50, 100]);
  const stale = new Set(all); stale.add(7);
  const r2 = resolveScope({ ...doc, selection: { axis: 'stroke', ats: stale } }, 'selection');
  assert.equal(r2.targets[0].ats.size, 100000); assert.ok(!r2.targets[0].ats.has(7)); assert.notEqual(r2.targets[0].ats, stale);
});

test('yielded: a broad command gives its key to a later command whose `when` is true (nav.goto vs graph.group)', () => {
  const app = {};
  let ov = {};
  const reg = new Registry({ app, getOverrides: () => ov, setOverrides: (o) => { ov = o; } });
  app.commands = { winner: (k, s) => reg.winner(k, s), keysFor: (id) => reg.keysFor(id) };
  let graphSel = false;
  reg.register([{ id: 'nav.goto', keys: ['Ctrl+G'], when: (a) => !yielded(a, 'nav.goto'), run() {} }], 'inspector');
  reg.register([{ id: 'graph.group', keys: ['Ctrl+G'], when: () => graphSel, run() {} }], 'graph');
  assert.equal(reg.winner('Ctrl+G'), 'nav.goto');
  graphSel = true;
  assert.equal(reg.winner('Ctrl+G'), 'graph.group');
  reg.setKeys('graph.group', ['Ctrl+Shift+G']);   // rebound away: Go to has Ctrl+G again
  assert.equal(reg.winner('Ctrl+G'), 'nav.goto');
});

test('diffScripts / previewStats', () => {
  const a = S([0, 0], [100, 50], [200, 0]), b = S([0, 0], [100, 60], [150, 20], [200, 0], [300, 5]);
  assert.deepEqual(diffScripts(a, b), { added: 2, removed: 0, moved: 1 });
  assert.deepEqual(diffScripts(b, a), { added: 0, removed: 2, moved: 1 });
  assert.equal(previewStats(a, a).unchanged, true);
  const p = previewStats(zig(11), zig(5, 250));
  assert.equal(p.dCount, -6);
  assert.ok(p.dMaxSpeed < 0);
});

test('runOp passes sel to the op and repairs sloppy results', () => {
  const inv = op('invert'), s = S([0, 10], [100, 90], [200, 10]);
  const r = runOp(inv, s, { ats: new Set([100]) });
  assert.deepEqual(r.script.map((a) => a.pos), [10, 10, 10]);
  assert.deepEqual(r.ats, [100]);
  assert.equal(runOp(inv, s, null).script[0].pos, 90);
  const bad = runOp({ title: 'x', apply: () => ({ script: [{ at: 5.4, pos: 120 }, { at: 1, pos: 3 }] }) }, s, null);
  assert.ok(isValid(bad.script));
  assert.ok(runOp({ title: 'x', apply: () => { throw new Error('boom'); } }, s, null).error.includes('boom'));
  assert.ok(runOp({ title: 'x', apply: () => 42 }, s, null).error);
});

test('batchEdit kinds', () => {
  const s = S([0, 20], [100, 80], [200, 40], [300, 60]);
  const sel = new Set([100, 200]);
  assert.deepEqual(batchEdit(s, sel, 'set', 55).script.map((a) => a.pos), [20, 55, 55, 60]);
  assert.deepEqual(batchEdit(s, sel, 'offset', 30).script.map((a) => a.pos), [20, 100, 70, 60]);
  assert.deepEqual(batchEdit(s, sel, 'offset', 50).script.map((a) => a.pos), [20, 100, 90, 60]);
  assert.deepEqual(batchEdit(s, sel, 'scale', 50).script.map((a) => a.pos), [20, 70, 50, 60]);
  const sh = batchEdit(s, sel, 'shift', 50);
  assert.deepEqual(sh.script.map((a) => a.at), [0, 150, 250, 300]); assert.deepEqual(sh.ats, [150, 250]);
  assert.deepEqual(batchEdit(s, new Set([0, 100]), 'shift', -500).script.map((a) => a.at), [0, 100, 200, 300]); // never before 0
  assert.deepEqual(batchEdit(s, sel, 'tscale', 200).script.map((a) => a.at), [0, 100, 300]); // 200 -> 300 merges into the point there
  assert.ok(isValid(batchEdit(s, sel, 'shift', 100).script));
  assert.equal(batchEdit(s, new Set(), 'set', 5).script, s);
  assert.equal(batchEdit(s, sel, 'set', NaN).script, s);
});

test('movePoint: time and pos', () => {
  const s = S([0, 0], [100, 50], [200, 100]);
  assert.deepEqual(movePoint(s, 100, { at: 150 }).script, S([0, 0], [150, 50], [200, 100]));
  assert.deepEqual(movePoint(s, 100, { pos: 130 }).script[1], { at: 100, pos: 100 });
  assert.deepEqual(movePoint(s, 100, { at: -5 }).script[0], { at: 0, pos: 50 });
  assert.equal(movePoint(s, 999, { at: 5 }).script, s);
});

test('param schema <-> form state, against the real catalogue', () => {
  for (const o of OPS) {
    const d = defaultsFor(o);
    assert.deepEqual(coerceParams(o, d), d, o.id);
  }
  const scale = op('scale');
  assert.equal(coerceParams(scale, { factor: 99 }).factor, 5);
  assert.equal(coerceParams(scale, { factor: 'x' }).factor, 1);
  assert.equal(coerceParams(scale, { pivot: 'nonsense' }).pivot, 'center');
  assert.equal(coerceParams(scale, { bogus: 1 }).bogus, undefined);
  const choice = normParam(scale.params.find((p) => p.key === 'pivot'));
  assert.equal(choice.type, 'select'); assert.ok(choice.options.length >= 5);
  assert.equal(normParam({ key: 'k', type: 'bool', default: true }).type, 'bool');
  assert.equal(sliderOK(normParam({ key: 'k', type: 'number', min: 0, max: 1e9, step: 1 })), false);
  assert.equal(sliderOK(normParam({ key: 'k', type: 'number', min: 0, max: 100, step: 1 })), true);
});

test('groupOps: order, search, favourites', () => {
  const g = groupOps(OPS, '', ['invert', 'nope']);
  assert.equal(g.groups[0].group, 'Favourites'); assert.deepEqual(g.groups[0].ops.map((o) => o.id), ['invert']);
  assert.equal(g.groups[1].group, 'Amplitude');
  assert.ok(g.groups.findIndex((x) => x.group === 'Density') < g.groups.findIndex((x) => x.group === 'Points'));
  const q = groupOps(OPS, 'simpl');
  assert.ok(q.count >= 1);
  assert.equal(groupOps(OPS, 'zzzzz').count, 0);
});

test('snippets: make, (de)serialise, tolerant parse, place', () => {
  const sn = makeSnippet(S([1000, 10], [1200, 90], [1400, 10]), 'Stroke');
  assert.deepEqual(sn.actions.map((a) => a.at), [0, 200, 400]); assert.equal(sn.duration, 400);
  assert.equal(makeSnippet([], 'x'), null);
  assert.deepEqual(parseSnippets(serializeSnippets([sn])), [sn]);
  assert.deepEqual(parseSnippets([sn]), [sn]);
  assert.deepEqual(parseSnippets('not json'), []);
  assert.equal(parseSnippets({ snippets: [{ name: 'bad' }, { actions: [] }, { actions: [{ at: 'x', pos: 1 }] }] }).length, 0);
  const odd = parseSnippets([{ name: 'odd', actions: [{ at: 500, pos: 150 }, { at: 100, pos: -5 }] }])[0];
  assert.deepEqual(odd.actions, S([0, 0], [400, 100]));
  const base = S([0, 50], [5000, 50]);
  const p = placeSnippet(base, sn, 1000);
  assert.deepEqual(p.ats, [1000, 1200, 1400]); assert.ok(isValid(p.script)); assert.equal(p.script.length, 5);
  const scaled = placeSnippet(base, sn, 1000, { timeScale: 2, posScale: 0.5 });
  assert.deepEqual(scaled.ats, [1000, 1400, 1800]);
  assert.deepEqual(scaled.script.filter((a) => a.at >= 1000 && a.at <= 1800).map((a) => a.pos), [30, 70, 30]);
  assert.equal(placeSnippet(base, sn, 1000, { fitMs: 2000 }).ats.at(-1), 3000);
  const rep = placeSnippet(S([900, 1], [1100, 2], [1300, 3], [1500, 4]), sn, 1000, { mode: 'replace' });
  assert.ok(!rep.script.some((a) => a.at === 1100 || a.at === 1300));
});

test('snippetFromSelection ignores stale ats and orders by time', () => {
  const sn = snippetFromSelection(zig(6), new Set([300, 100, 12345]), 'x');
  assert.deepEqual(sn.actions.map((a) => a.at), [0, 200]);
});

test('applyTransform: one undo group, selection kept', () => {
  const app = mockApp({ stroke: zig(11) });
  app.doc.selection = { axis: 'stroke', ats: new Set([100, 200, 300]) };
  const r = applyTransform(app, op('invert'), {}, 'selection');
  assert.ok(r.ok && r.changed);
  assert.equal(app.edits.filter((e) => e.group).length, 1);
  assert.deepEqual(app.doc.axes.stroke.slice(1, 4).map((a) => a.pos), [10, 90, 10]);
  assert.deepEqual([...app.doc.selection.ats], [100, 200, 300]);
});

test('applyTransform: scopes, empty scope, no-op, all axes in one group', () => {
  const app = mockApp({ stroke: zig(11), roll: zig(5, 250) });
  assert.equal(applyTransform(app, op('invert'), {}, 'selection').ok, false);
  assert.equal(applyTransform(app, op('invert'), {}, 'range').ok, false);
  const none = applyTransform(app, op('scale'), { factor: 1 }, 'axis');
  assert.deepEqual([none.ok, none.changed], [true, false]);
  assert.equal(app.edits.length, 0);
  assert.ok(applyTransform(app, op('invert'), {}, 'all').changed);
  assert.equal(app.edits.filter((e) => e.group).length, 1);
  assert.equal(app.edits.filter((e) => !e.group).length, 2);
  app.doc.range = { t0: 0, t1: 300 };
  const before = app.doc.axes.stroke;
  applyTransform(app, op('invert'), {}, 'range');
  assert.deepEqual(app.doc.axes.stroke.slice(0, 4).map((a) => a.pos), before.slice(0, 4).map((a) => 100 - a.pos));
  assert.equal(app.doc.axes.stroke[5].pos, before[5].pos);
});

test('applyTransform: selection-result tools only select', () => {
  const app = mockApp({ stroke: zig(11) });
  app.doc.selection = { axis: 'stroke', ats: new Set([0, 100, 200, 300, 400, 500]) };
  const r = applyTransform(app, op('everyNth'), { n: 2, offset: 0 }, 'selection');
  assert.ok(r.ok && !r.changed);
  assert.equal(app.edits.length, 0);
  assert.deepEqual([...app.doc.selection.ats], [0, 200, 400]);
});

test('computeScope never touches the document', () => {
  const app = mockApp({ stroke: zig(11) });
  const before = app.doc.axes;
  const { results } = computeScope(app, op('simplify'), { tolerance: 20 }, 'axis');
  assert.equal(app.doc.axes, before); assert.equal(app.edits.length, 0);
  assert.ok(results[0].script.length <= before.stroke.length);
});

test('setPreview owns only its ghosts', () => {
  const app = mockApp({ stroke: zig(3) });
  app.doc.ghosts = [{ id: 'run1', source: { kind: 'tracker' }, script: [] }];
  setPreview(app, [{ axis: 'stroke', script: zig(2) }]);
  assert.equal(app.doc.ghosts.length, 2); assert.equal(app.doc.ghosts[1].source, 'inspector-preview');
  setPreview(app, [{ axis: 'stroke', script: zig(4) }]);
  assert.equal(app.doc.ghosts.length, 2);
  setPreview(app, []);
  assert.deepEqual(app.doc.ghosts.map((x) => x.id), ['run1']);
  const same = app.doc.ghosts; setPreview(app, []); assert.equal(app.doc.ghosts, same);
});

test('applyBatch / applyPoint: coalesce flag, selection follows, range fallback', () => {
  const app = mockApp({ stroke: S([0, 0], [100, 50], [200, 100]) });
  app.doc.selection = { axis: 'stroke', ats: new Set([100]) };
  assert.equal(applyPoint(app, 100, { at: 130 }, { coalesce: true }), 130);
  assert.deepEqual([...app.doc.selection.ats], [130]);
  assert.equal(app.edits[0].opts.coalesce, true);
  applyBatch(app, 'set', 80);
  assert.equal(app.doc.axes.stroke[1].pos, 80);
  assert.equal(applyBatch(mockApp({ stroke: zig(3) }), 'set', 1), null);
  const app2 = mockApp({ stroke: zig(11) }); app2.doc.range = { t0: 0, t1: 200 };
  assert.deepEqual(applyBatch(app2, 'set', 50), [0, 100, 200]);
  assert.equal(selectRange(app2), 3);
});

test('pasteSnippet at the playhead, fit to range', () => {
  const app = mockApp({ stroke: S([0, 50], [10000, 50]) });
  const sn = makeSnippet(S([0, 10], [500, 90]), 'S');
  app.player.timeMs = 2000;
  assert.equal(pasteSnippet(app, sn, {}), 2);
  assert.deepEqual(app.doc.axes.stroke.map((a) => a.at), [0, 2000, 2500, 10000]);
  app.doc.range = { t0: 4000, t1: 5000 };
  pasteSnippet(app, sn, { fit: true });
  assert.ok(app.doc.axes.stroke.some((a) => a.at === 5000 && a.pos === 90));
});
