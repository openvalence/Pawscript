// features/fix/logic.js: the splice (seams, min gap, outside untouched, empty / 1-point spans), the in-place pieces,
// regenerate into a plan (carving) and without one, and undo = one step through the real History.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixRange, spliceRange, piece, flipPiece, scalePiece, retimePiece, carvePlan, regenerateSpan, recipeChoices } from '../src/features/fix/logic.js';
import { makeSegment, stamp, segState } from '../src/features/timeline/plan.js';
import { isValid, slice } from '../src/lib/core/script.js';
import { History } from '../src/app/history.js';

const A = (...p) => p.map(([at, pos]) => ({ at, pos }));
const strokes = (t0, t1, step = 250) => { const s = []; for (let t = t0, k = 0; t <= t1; t += step, k++) s.push({ at: t, pos: k % 2 ? 10 : 90 }); return s; };
const outside = (s, t0, t1) => s.filter((a) => a.at < t0 || a.at > t1);
const minGap = (s) => Math.min(...s.slice(1).map((a, i) => a.at - s[i].at));

test('fixRange: the I/O range, else the selected points\' span, else null', () => {
  assert.deepEqual(fixRange({ range: { t0: 10.4, t1: 99.6 } }), { t0: 10, t1: 100 });
  assert.deepEqual(fixRange({ range: null, activeAxis: 'stroke', selection: { axis: 'stroke', ats: new Set([500, 100, 300]) } }), { t0: 100, t1: 500 });
  assert.equal(fixRange({ range: null, activeAxis: 'stroke', selection: { axis: 'stroke', ats: new Set([100]) } }), null);
  assert.equal(fixRange({ range: null, activeAxis: 'roll', selection: { axis: 'stroke', ats: new Set([1, 2]) } }), null);
});

test('splice: inside replaced, outside points untouched, seams at least minGapMs and under the cap', () => {
  const base = strokes(0, 10000), t0 = 3001, t1 = 5999;   // base points at 3000 and 6000 sit right outside: the seams must trim
  const fresh = A([2990, 50], [3010, 0], [3500, 100], [4000, 0], [5000, 100], [5995, 0], [6005, 100]);
  const out = spliceRange(base, t0, t1, fresh, { maxSpeed: 400, minGapMs: 60 });
  assert.ok(isValid(out));
  assert.deepEqual(outside(out, t0, t1), outside(base, t0, t1));         // never moved, never removed
  const inside = slice(out, t0, t1);
  assert.ok(inside.every((a) => fresh.some((f) => f.at === a.at && f.pos === a.pos)));   // only the new points inside
  assert.ok(!inside.some((a) => a.at === 2990 || a.at === 6005));       // the piece is clipped to the span
  const i = out.findIndex((a) => a.at === inside[0].at), j = out.findIndex((a) => a.at === inside[inside.length - 1].at);
  for (const [p, q] of [[out[i - 1], out[i]], [out[j], out[j + 1]]]) {
    assert.ok(q.at - p.at >= 60, `seam gap ${q.at - p.at}`);
    assert.ok(Math.abs(q.pos - p.pos) * 1000 / (q.at - p.at) <= 400 + 1e-9, 'seam speed');
  }
});

test('splice: empty and 1-point spans, empty pieces', () => {
  const base = strokes(0, 2000);
  // no base points inside (between two points): the piece lands, outside untouched
  const a = spliceRange(base, 1010, 1240, A([1100, 50]), { minGapMs: 20 });
  assert.deepEqual(outside(a, 1010, 1240), base);
  assert.deepEqual(slice(a, 1010, 1240), A([1100, 50]));
  // one base point inside
  const b = spliceRange(base, 990, 1010, A([1000, 40]), { minGapMs: 1 });
  assert.equal(b.find((x) => x.at === 1000).pos, 40);
  assert.equal(b.length, base.length);
  // empty base
  assert.deepEqual(spliceRange([], 0, 1000, A([0, 10], [500, 90])), A([0, 10], [500, 90]));
  // an empty piece clears the span (callers refuse that before splicing)
  assert.deepEqual(spliceRange(base, 900, 1100, []), outside(base, 900, 1100));
});

test('in-place pieces: flip, scale about the out end, retime keeps the seam times', () => {
  const p = A([0, 100], [100, 0], [200, 60], [300, 20]);
  assert.deepEqual(flipPiece(p).map((a) => a.pos), [0, 100, 40, 80]);
  assert.deepEqual(scalePiece(p, 0.5).map((a) => a.pos), [100, 50, 80, 60]);
  const r = retimePiece(A([0, 0], [100, 50], [200, 100], [300, 0]), 0, { dt: 30 });
  assert.deepEqual(r.map((a) => a.at), [0, 130, 230, 300]);
  const s = retimePiece(A([0, 0], [100, 50], [200, 100], [300, 0]), 0, { factor: 2 });
  assert.equal(s[0].at, 0); assert.equal(s[s.length - 1].at, 300);
  assert.ok(isValid(s) && s.every((a) => a.at <= 300));
  assert.deepEqual(retimePiece(A([0, 0], [10, 5]), 0, { dt: 5 }), A([0, 0], [10, 5]));   // nothing inner to move
});

test('carvePlan: splits a spanning segment, trims overlaps, keeps fresh pieces fresh, inherits the run link', () => {
  const plan = stamp([makeSegment({ id: 'a', t0: 0, t1: 10000, kind: 'penetration' }), makeSegment({ id: 'b', t0: 10000, t1: 20000, kind: 'oral' })], ['a']);
  plan[0] = { ...plan[0], source: 'run3', genKey: plan[0].genKey };
  const c = carvePlan(plan, 4000, 6000, { recipe: 'tease', ids: { seg: 'n', right: 'r' } });
  assert.deepEqual(c.plan.map((s) => [s.id, s.t0, s.t1]), [['a', 0, 4000], ['n', 4000, 6000], ['r', 6000, 10000], ['b', 10000, 20000]]);
  assert.equal(segState(c.plan[0]), 'fresh'); assert.equal(segState(c.plan[2]), 'fresh');
  assert.equal(c.plan[1].recipe, 'tease'); assert.equal(c.plan[1].source, 'run3'); assert.equal(segState(c.plan[1]), 'new');
  // across a boundary: both neighbours trimmed, the never-generated one stays new
  const d = carvePlan(plan, 8000, 12000, { recipe: 'climax', ids: { seg: 'n', right: 'r' } });
  assert.deepEqual(d.plan.map((s) => [s.id, s.t0, s.t1]), [['a', 0, 8000], ['n', 8000, 12000], ['b', 12000, 20000]]);
  assert.equal(d.plan[1].kind, 'climax'); assert.equal(segState(d.plan[2]), 'new');
  // a locked segment refuses
  assert.ok(carvePlan([{ ...plan[0], locked: true }], 1000, 2000, { recipe: 'hold', ids: { seg: 'n', right: 'r' } }).error);
});

test('regenerateSpan: into the plan (only the new segment generated) and without a plan (straight into the span)', () => {
  const base = strokes(0, 30000, 400);
  const doc = { activeAxis: 'stroke', axes: { stroke: base }, ghosts: [], media: { name: 'x.mp4' },
    plan: [makeSegment({ id: 'a', t0: 0, t1: 30000, kind: 'penetration' })] };
  const r = regenerateSpan(doc, 'stroke', { t0: 10000, t1: 14000 }, { recipe: 'climax', maxSpeed: 400, minGapMs: 50, ids: { seg: 'n', right: 'r' } });
  assert.ok(isValid(r.script));
  assert.deepEqual(outside(r.script, 10000, 14000), outside(base, 10000, 14000));
  assert.deepEqual(r.plan.map((s) => s.id), ['a', 'n', 'r']);
  assert.equal(segState(r.plan.find((s) => s.id === 'n')), 'fresh');
  assert.notDeepEqual(slice(r.script, 10000, 14000), slice(base, 10000, 14000));
  assert.ok(minGap(r.script) >= 50 || minGap(base) < 50);
  const n = regenerateSpan({ ...doc, plan: [] }, 'stroke', { t0: 10000, t1: 14000 }, { recipe: 'penetration-strokes', maxSpeed: 300, minGapMs: 50, ids: { seg: 'n' } });
  assert.equal(n.plan, null);
  assert.deepEqual(outside(n.script, 10000, 14000), outside(base, 10000, 14000));
  const i = n.script.findIndex((a) => a.at > 10000 - 1 && a.at >= 10000);
  const p = n.script[i - 1], q = n.script[i];
  assert.ok(q.at - p.at >= 50 && Math.abs(q.pos - p.pos) * 1000 / (q.at - p.at) <= 300 + 1e-9, 'left seam within the cap');
  assert.ok(regenerateSpan(doc, 'stroke', { t0: 0, t1: 10 }, { recipe: 'nope', ids: { seg: 'n' } }).error);
  assert.ok(recipeChoices().length >= 15);
});

test('a fix is one undo step: the script and the plan revert together', () => {
  const doc = { axes: { stroke: strokes(0, 10000) }, plan: [makeSegment({ id: 'a', t0: 0, t1: 10000, kind: 'penetration' })] };
  const h = new History({
    read: () => ({ 'axes.stroke': doc.axes.stroke, plan: doc.plan }),
    write: (p, v) => { if (p === 'axes.stroke') doc.axes = { ...doc.axes, stroke: v }; else doc[p] = v; },
  });
  const before = { s: doc.axes.stroke, p: doc.plan };
  const r = regenerateSpan({ ...doc, activeAxis: 'stroke', ghosts: [] }, 'stroke', { t0: 2000, t1: 4000 }, { recipe: 'tease', ids: { seg: 'n', right: 'r' } });
  // what fix.svelte.js does: one transact around the script edit and the plan write
  h.transact('Fix: regenerate', () => { h.transact('edit', () => { doc.axes = { stroke: r.script }; }); doc.plan = r.plan; });
  assert.equal(h.entries.length, 1);
  h.undo();
  assert.equal(doc.axes.stroke, before.s); assert.equal(doc.plan, before.p);
});
