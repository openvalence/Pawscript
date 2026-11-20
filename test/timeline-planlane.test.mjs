import assert from 'node:assert/strict';
import test from 'node:test';
import { clickSelect, fillSpan, addSpan, stepSegment, duplicateSegments, liveSel, segmentAt } from '../src/features/timeline/plan-edit.js';
import { blockLod, blockText, energyOf, hasIntensity } from '../src/features/timeline/plan-draw.js';
import { makeSegment } from '../src/features/timeline/plan.js';
import { isValidIntervals } from '../src/features/timeline/intervals.js';

const seg = (id, t0, t1, kind = 'penetration', params) => makeSegment({ id, t0, t1, kind, params });
const plan = [seg('a', 0, 10000, 'idle'), seg('b', 10000, 30000), seg('c', 50000, 60000, 'climax'), seg('d', 60000, 80000, 'afterglow')];

test('clickSelect: replace, toggle, extend from the anchor in time order', () => {
  assert.deepEqual(clickSelect(plan, [], null, 'b'), { sel: ['b'], anchor: 'b' });
  assert.deepEqual(clickSelect(plan, ['b'], 'b', 'd', 'toggle'), { sel: ['b', 'd'], anchor: 'd' });
  assert.deepEqual(clickSelect(plan, ['b', 'd'], 'd', 'b', 'toggle'), { sel: ['d'], anchor: 'd' });
  assert.deepEqual(clickSelect(plan, ['d'], 'd', 'a', 'extend').sel, ['a', 'b', 'c', 'd']);
  assert.deepEqual(clickSelect([...plan].reverse(), ['b'], 'b', 'c', 'extend').sel, ['b', 'c']);
  assert.deepEqual(clickSelect(plan, [], 'gone', 'c', 'extend'), { sel: ['c'], anchor: 'c' });   // stale anchor
});

test('fillSpan: gap bounded by the cuts around t; 10 s without cuts; null inside a segment', () => {
  const dur = 120000;
  assert.deepEqual(fillSpan(plan, 40000, { cuts: [35000, 45000], dur }), { t0: 35000, t1: 45000 });
  assert.deepEqual(fillSpan(plan, 40000, { cuts: [20000, 100000], dur }), { t0: 30000, t1: 50000 });   // segments bound tighter
  assert.deepEqual(fillSpan(plan, 35000, { cuts: [35000], dur }), { t0: 35000, t1: 50000 });           // a cut at t starts the span
  assert.deepEqual(fillSpan(plan, 32000, { dur }), { t0: 32000, t1: 42000 });
  assert.deepEqual(fillSpan(plan, 45000, { dur }), { t0: 40000, t1: 50000 });                          // slid back before the next segment
  assert.deepEqual(fillSpan(plan, 85000, { dur }), { t0: 85000, t1: 95000 });
  assert.deepEqual(fillSpan(plan, 115000, { dur }), { t0: 110000, t1: 120000 });                       // clipped at the end, slid back
  assert.equal(fillSpan(plan, 15000, { dur }), null);
  assert.equal(fillSpan(plan, 49990, { cuts: [49980], dur, minLen: 33 }), null);
  assert.deepEqual(fillSpan([], 5000, { cuts: [], dur: 3000 }), { t0: 0, t1: 3000 });                 // clamped to dur
});

test('addSpan: the range (confined to its gap) when set, else fillSpan', () => {
  const dur = 120000;
  assert.deepEqual(addSpan(plan, 0, { range: { t0: 32000, t1: 55000 }, dur }), { t0: 32000, t1: 50000 });
  assert.equal(addSpan(plan, 0, { range: { t0: 20000, t1: 40000 }, dur }), null);
  assert.deepEqual(addSpan(plan, 40000, { range: null, cuts: [35000, 45000], dur }), { t0: 35000, t1: 45000 });
  const s = addSpan(plan, 90000, { dur, cuts: [] }), next = [...plan, seg('n', s.t0, s.t1)].sort((x, y) => x.t0 - y.t0);
  assert.ok(isValidIntervals(next, dur));
});

test('stepSegment and segmentAt: from the selection, else from the playhead', () => {
  assert.equal(stepSegment(plan, ['b'], 0, 1).id, 'c');
  assert.equal(stepSegment(plan, ['b'], 0, -1).id, 'a');
  assert.equal(stepSegment(plan, ['d'], 0, 1).id, 'd');      // stays at the last
  assert.equal(stepSegment(plan, ['a'], 0, -1).id, 'a');
  assert.equal(stepSegment(plan, [], 40000, 1).id, 'c');
  assert.equal(stepSegment(plan, [], 55000, -1).id, 'c');    // inside c: back to c's start
  assert.equal(stepSegment(plan, [], 90000, 1), null);
  assert.equal(stepSegment([], [], 0, 1), null);
  assert.equal(segmentAt(plan, 10000).id, 'b');
  assert.equal(segmentAt(plan, 40000), null);
});

test('duplicateSegments: copies follow, are new (no genKey) and unlocked; originals keep theirs', () => {
  let n = 0;
  const p = plan.map((s) => (s.id === 'c' ? { ...s, genKey: 'k', locked: true } : s));
  const r = duplicateSegments(p, ['c'], { dur: 200000, newId: () => 'x' + n++ });
  const copy = r.list.find((s) => s.id === r.ids[0]), orig = r.list.find((s) => s.id === 'c');
  assert.equal(copy.t0, 60000); assert.equal(copy.t1, 70000);
  assert.equal(copy.genKey, undefined); assert.equal(copy.locked, undefined);
  assert.equal(orig.genKey, 'k'); assert.equal(orig.locked, true);
  assert.equal(r.list.find((s) => s.id === 'd').t0, 70000);   // pushed along
  assert.ok(isValidIntervals(r.list, 200000));
  assert.equal(duplicateSegments(p, ['d'], { dur: 80000, newId: () => 'z' }), null);   // no room
  assert.deepEqual(liveSel(plan, ['b', 'gone', 'd']), ['b', 'd']);
});

test('blockLod: colour, icon, then text rows by width and height', () => {
  assert.equal(blockLod(10, 64).lod, 'color');
  assert.equal(blockLod(30, 64).lod, 'icon');
  assert.equal(blockLod(30, 18).lod, 'color');
  assert.deepEqual(blockLod(60, 64), { lod: 'text', rows: 1 });
  assert.deepEqual(blockLod(200, 40), { lod: 'text', rows: 1 });
  assert.deepEqual(blockLod(200, 64), { lod: 'text', rows: 2 });
  assert.deepEqual(blockLod(200, 120), { lod: 'text', rows: 3 });
  for (let w = 0; w < 400; w += 7) for (const h of [20, 40, 64, 120]) {   // monotone in width
    const order = ['color', 'icon', 'text'], a = blockLod(w, h), b = blockLod(w + 7, h);
    assert.ok(order.indexOf(b.lod) >= order.indexOf(a.lod) && (a.lod !== 'text' || b.rows >= a.rows));
  }
});

test('blockText and energyOf', () => {
  const s = seg('s', 0, 1000, 'penetration', { intensity: 0.8 });
  assert.deepEqual(blockText(s, 1), ['Penetration']);
  assert.equal(blockText({ ...s, name: 'Riding' }, 1)[0], 'Riding');
  assert.match(blockText(s, 2)[1], /^Penetration \(follow\) · 0–85/);
  assert.equal(blockText(s, 3)[1], 'Penetration (follow) · 80%');
  assert.deepEqual(energyOf(s), [0.8, 0.8]);
  const fi = energyOf(seg('f', 0, 1000, 'fade-in'));
  assert.ok(fi[0] < 0.2 && fi[1] === 1);                       // ramp amp0 0.15 -> 1
  const ag = energyOf(seg('g', 0, 1000, 'afterglow', { intensity: 0.5 }));
  assert.ok(Math.abs(ag[0] - 0.4) < 1e-9 && ag[1] === 0);
  assert.equal(energyOf(seg('i', 0, 1000, 'idle')), null);     // hold: no intensity
  assert.equal(hasIntensity(seg('i', 0, 1000, 'idle')), false);
  assert.equal(blockText(seg('i', 0, 1000, 'idle'), 3)[1], 'Hold');
});

test('planMenu: registry-driven entries, kind radio, lock label, split here, empty space', async () => {
  const { planMenu } = await import('../src/features/timeline/plan-edit.js');
  const ran = [], ids = ['timeline.plan.split', 'timeline.plan.merge', 'timeline.plan.duplicate', 'timeline.plan.kind.oral', 'timeline.plan.kind.climax',
    'timeline.plan.lock', 'timeline.plan.edit', 'timeline.plan.delete', 'timeline.plan.add', 'timeline.plan.selectAll'];
  const cmds = { has: (id) => ids.includes(id), enabled: (id) => id !== 'timeline.plan.merge', keys: (id) => ({ 'timeline.plan.kind.climax': ['6', 'Shift+6'], 'timeline.plan.delete': ['Delete'] })[id] || [], run: (id, a) => ran.push([id, a]) };
  const kinds = [{ id: 'oral', label: 'Oral' }, { id: 'climax', label: 'Climax' }, { id: 'idle', label: 'Idle' }];
  const segs = [{ id: 'a', kind: 'climax', locked: true }];
  const m = planMenu(cmds, segs, kinds, { t: 1234 });
  const by = (l) => m.find((x) => x.label === l);
  assert.equal(by('Split here').run() && ran.at(-1)[1].t, 1234);
  assert.equal(by('Merge').disabled, true);
  assert.equal(m.some((x) => x.label === 'Generate'), false);                 // not registered: left out
  const k = by('Kind').items;
  assert.deepEqual(k.map((x) => [x.label, x.checked, x.shortcut]), [['Oral', false, undefined], ['Climax', true, '6']]);
  assert.equal(by('Unlock').icon, 'unlock');
  assert.equal(by('Delete').shortcut, 'Delete');
  assert.equal(planMenu(cmds, [...segs, { id: 'b', kind: 'oral' }], kinds).find((x) => x.label === 'Kind').items.some((x) => x.checked), false);
  assert.equal(planMenu(cmds, [...segs, { id: 'b', kind: 'oral' }], kinds).some((x) => x.label === 'Lock'), true);
  assert.equal(planMenu(cmds, segs, kinds).some((x) => x.label === 'Split at playhead'), true);
  assert.deepEqual(planMenu(cmds, [], kinds), []);
  const e = planMenu(cmds, [], kinds, { t: 50, empty: true, armedLabel: 'Oral' });
  assert.deepEqual(e.map((x) => x.label), ['Add Oral here', 'Select all segments']);
  e[0].run(); assert.deepEqual(ran.at(-1), ['timeline.plan.add', { t: 50 }]);
});
