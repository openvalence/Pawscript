import assert from 'node:assert/strict';
import test from 'node:test';
import * as gen from '../src/lib/gen/plan.js';
import { makeSegment, setParams, segState, stamp, toSpans, importTimeline } from '../src/features/timeline/plan.js';
import {
  turnsOf, trackerRuns, chooseRun, runsOver, runLabel, runRange, planCtx, planSig, generatePlan, detachPlan, toggleLocked, stateCounts, sliceSegments,
  withGhost, PREVIEW_ID, mergeIntoGaps, formSchema, formValues, overridden, paramPatch,
} from '../src/features/timeline/generate-logic.js';
import { isValid, lowerBound } from '../src/lib/core/script.js';
import { isValidIntervals } from '../src/features/timeline/intervals.js';
import { budget } from './perf.mjs';

const story = () => [
  makeSegment({ id: 'a', t0: 0, t1: 8000, kind: 'idle' }),
  makeSegment({ id: 'b', t0: 8000, t1: 20000, kind: 'fade-in' }),
  makeSegment({ id: 'c', t0: 20000, t1: 60000, kind: 'penetration', params: { intensity: 0.8 } }),
  makeSegment({ id: 'd', t0: 60000, t1: 80000, kind: 'knotting' }),
  makeSegment({ id: 'e', t0: 80000, t1: 95000, kind: 'climax' }),
  makeSegment({ id: 'f', t0: 100000, t1: 120000, kind: 'afterglow' }),   // gap 95..100 s
];
// a hand-made base script: slow strokes everywhere
const base = Array.from({ length: 300 }, (_, i) => ({ at: 200 + i * 400, pos: i % 2 ? 90 : 10 }));
const inSpan = (a, segs) => segs.some((s) => a.at >= s.t0 && a.at <= s.t1);
const ctx = { seed: 1, maxSpeed: 450, turns: [] };

test('turnsOf: extremes with kinds, plateaus turn at their first point, endpoints included', () => {
  const s = [{ at: 0, pos: 50 }, { at: 100, pos: 90 }, { at: 200, pos: 90 }, { at: 300, pos: 10 }, { at: 400, pos: 40 }];
  assert.deepEqual(turnsOf(s), [{ at: 0, kind: 'bottom' }, { at: 100, kind: 'top' }, { at: 300, kind: 'bottom' }, { at: 400, kind: 'top' }]);
  assert.deepEqual(turnsOf([]), []);
  assert.deepEqual(turnsOf([{ at: 0, pos: 5 }, { at: 9, pos: 5 }]), []);
});

test('runs: auto = largest overlap (newest on ties); explicit source overrides, even hidden; gone = none', () => {
  const run = (id, t0, t1, o = {}) => ({ id, name: id + ': flow', source: { kind: 'tracker', range: { start: t0, end: t1 } }, script: base, ...o });
  const A = run('A', 0, 60000), B = run('B', 40000, 120000), C = run('C', 40000, 120000), H = run('H', 0, 200000, { visible: false });
  const R = run('R', 0, 300000, { axis: 'roll' }), ref = { id: 'ref', source: { kind: 'reference' }, script: base };
  const ghosts = [A, B, C, H, R, ref];
  assert.deepEqual(trackerRuns(ghosts, 'stroke').map((g) => g.id), ['A', 'B', 'C']);
  assert.deepEqual(trackerRuns(ghosts, 'stroke', true).map((g) => g.id), ['A', 'B', 'C', 'H']);
  const runs = trackerRuns(ghosts, 'stroke'), all = trackerRuns(ghosts, 'stroke', true);
  assert.equal(chooseRun({ t0: 0, t1: 30000 }, runs, all).id, 'A');                 // only A covers it
  assert.equal(chooseRun({ t0: 30000, t1: 70000 }, runs, all).id, 'C');             // B/C cover 30 s > A's 20 s; C newer than B
  assert.equal(chooseRun({ t0: 45000, t1: 60000 }, runs, all).id, 'C');             // A, B, C all 15 s: newest wins
  assert.equal(chooseRun({ t0: 30000, t1: 70000, source: 'A' }, runs, all).id, 'A'); // explicit override
  assert.equal(chooseRun({ t0: 0, t1: 10, source: 'H' }, runs, all).id, 'H');        // explicit may name a hidden run
  assert.equal(chooseRun({ t0: 0, t1: 10, source: 'gone' }, runs, all), null);
  assert.equal(chooseRun({ t0: 0, t1: 10, source: 'auto' }, runs, all).id, 'A');
  assert.equal(chooseRun({ t0: 130000, t1: 140000 }, runs, all), null);             // nothing covers it
  assert.deepEqual(runsOver({ t0: 50000, t1: 55000 }, runs).map((g) => g.id), ['A', 'B', 'C']);
  assert.equal(runLabel(B), 'B');
  assert.deepEqual(runRange({ source: { kind: 'tracker' }, script: [{ at: 5, pos: 0 }, { at: 9, pos: 1 }] }), { t0: 5, t1: 9 });
});

test('planCtx: turns composed per segment from each segment’s run; stable seed; key follows inputs', () => {
  const mk = (id, shift, t0, t1) => ({ id, source: { kind: 'tracker', range: { start: t0, end: t1 } }, script: base.map((a) => ({ at: a.at + shift, pos: a.pos })) });
  const A = mk('A', 0, 0, 50000), B = mk('B', 7, 50000, 150000);
  const plan = [{ id: 's1', t0: 0, t1: 50000, kind: 'penetration' }, { id: 's2', t0: 50000, t1: 100000, kind: 'penetration' }];
  const doc = { ghosts: [A, B], activeAxis: 'stroke', media: { name: 'v.mp4' }, plan };
  const a = planCtx(doc), b = planCtx(doc, { maxSpeed: 300 });
  assert.equal(a.ctx.maxSpeed, 450); assert.equal(b.ctx.maxSpeed, 300);
  assert.equal(a.ctx.seed, planCtx({ ...doc }).ctx.seed);
  assert.deepEqual([...a.pick], [['s1', 'A'], ['s2', 'B']]);
  assert.ok(a.ctx.turns.every((t, i, l) => !i || t.at > l[i - 1].at));             // sorted, no duplicate instants
  const fromA = turnsOf(A.script).filter((t) => t.at <= 50000).map((t) => t.at), fromB = turnsOf(B.script).filter((t) => t.at > 50000 && t.at <= 100000).map((t) => t.at);
  assert.ok(fromA.length && fromB.length);
  assert.deepEqual(a.ctx.turns.map((t) => t.at), [...fromA, ...fromB]);
  assert.equal(a.turnsFor(plan[1]).length, turnsOf(B.script).length);   // staleness sees s2's whole run
  const forced = planCtx({ ...doc, plan: [plan[0], { ...plan[1], source: 'A' }] });
  assert.equal(forced.pick.get('s2'), 'A');
  assert.notEqual(forced.key, a.key);
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.key, planCtx({ ...doc, ghosts: [] }).key);
  assert.deepEqual(planCtx({ ...doc, ghosts: [] }).ctx.turns, []);
});

test('staleness follows the chosen run: switching or editing a segment’s run marks only it stale', async () => {
  const { setTurns, stamp, makeSegment } = await import('../src/features/timeline/plan.js');
  const A = { id: 'A', source: { kind: 'tracker', range: { start: 0, end: 60000 } }, script: base };
  const B = { id: 'B', source: { kind: 'tracker', range: { start: 60000, end: 200000 } }, script: base.map((a) => ({ at: a.at + 31, pos: a.pos })) };
  const s1 = makeSegment({ id: 's1', t0: 0, t1: 50000, kind: 'penetration' }), s2 = makeSegment({ id: 's2', t0: 70000, t1: 120000, kind: 'penetration' });
  const doc = { ghosts: [A, B], activeAxis: 'stroke', media: { name: 'v' } };
  setTurns(planCtx({ ...doc, plan: [s1, s2] }).turnsFor);
  let plan = stamp([s1, s2], ['s1', 's2']);
  assert.deepEqual(plan.map(segState), ['fresh', 'fresh']);
  plan = plan.map((s) => (s.id === 's2' ? { ...s, source: 'A' } : s));               // follow A instead of B
  setTurns(planCtx({ ...doc, plan }).turnsFor);
  assert.deepEqual(plan.map(segState), ['fresh', 'stale']);
  const B2 = { ...B, script: B.script.map((a) => (a.at > 80000 && a.at < 90000 ? { at: a.at + 40, pos: a.pos } : a)) };   // edit run B
  plan = stamp(plan.map((s) => (s.id === 's2' ? { ...s, source: undefined } : s)), ['s2']);
  setTurns(planCtx({ ...doc, ghosts: [A, B2], plan }).turnsFor);
  assert.deepEqual(plan.map(segState), ['fresh', 'stale']);
  setTurns(null);
});

test('generatePlan: whole-plan compile, only target spans change, targets stamped, deterministic', () => {
  const plan = story();
  const r = generatePlan(base, plan, { scope: 'needed', ctx, gen });
  assert.deepEqual(r.done, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.ok(isValid(r.script));
  assert.ok(r.plan.every((s) => segState(s) === 'fresh'));
  // base points in the gap (95..100 s) survive untouched
  const gap = base.filter((a) => a.at > 95000 && a.at < 100000);
  for (const a of gap) assert.ok(r.script.some((b) => b.at === a.at && b.pos === a.pos), `gap point ${a.at}`);
  assert.deepEqual(generatePlan(base, plan, { scope: 'needed', ctx, gen }).script, r.script);
  // nothing needed now
  const again = generatePlan(r.script, r.plan, { scope: 'needed', ctx, gen });
  assert.equal(again.targets.length, 0);
  assert.equal(again.script, r.script);
});

test('generatePlan: an edited segment goes stale and "needed" rewrites only it (plus join blending)', () => {
  const g1 = generatePlan(base, story(), { scope: 'all', ctx, gen });
  const edited = setParams(g1.plan, ['c'], { hi: 60 });
  assert.equal(segState(edited.find((s) => s.id === 'c')), 'stale');
  const g2 = generatePlan(g1.script, edited, { scope: 'needed', ctx, gen });
  assert.deepEqual(g2.done, ['c']);
  const c = edited.find((s) => s.id === 'c');
  // outside c's span plus the blend window, the script is unchanged
  const W = 300;
  const outside = (s) => s.filter((a) => a.at < c.t0 - W || a.at > c.t1 + W);
  assert.deepEqual(outside(g2.script), outside(g1.script));
  assert.ok(g2.script.filter((a) => a.at > c.t0 + W && a.at < c.t1 - W).every((a) => a.pos >= 0 && a.pos <= 61));
  assert.equal(segState(g2.plan.find((s) => s.id === 'c')), 'fresh');
});

test('generatePlan: locked never written, even with scope all; hand edits outside targets kept', () => {
  const g1 = generatePlan(base, story(), { scope: 'all', ctx, gen });
  const hand = g1.script.map((a) => (a.at > 62000 && a.at < 78000 ? { ...a, pos: 50 } : a));   // hand edit inside d
  const plan = toggleLocked(g1.plan, ['d']);
  const g2 = generatePlan(hand, plan, { scope: 'all', ctx, gen });
  assert.ok(!g2.done.includes('d'));
  const d = (s) => s.filter((a) => a.at > 62000 && a.at < 78000);
  assert.deepEqual(d(g2.script), d(hand));
  // selected scope: just those
  const g3 = generatePlan(hand, plan, { scope: 'selected', sel: ['b', 'd'], ctx, gen });
  assert.deepEqual(g3.done, ['b']);
});

test('generatePlan: segments that fail to compile are not stamped; their issue is reported', () => {
  const plan = [...story(), { id: 'bad', t0: 130000, t1: 140000, kind: 'penetration', recipe: 'nope', params: {} }];
  const r = generatePlan(base, plan, { scope: 'needed', ctx, gen });
  assert.ok(!r.done.includes('bad'));
  assert.equal(segState(r.plan.find((s) => s.id === 'bad')), 'new');
  assert.ok(r.issues.some((i) => i.id === 'bad' && i.level === 'error'));
});

test('detachPlan: generates new/stale ids first, removes them; fresh ones just leave the plan', () => {
  const g1 = generatePlan(base, story(), { scope: 'all', ctx, gen });
  const edited = setParams(g1.plan, ['c'], { hi: 60 });
  const r = detachPlan(g1.script, edited, ['c', 'e'], { ctx, gen });
  assert.deepEqual(r.generated, ['c']);
  assert.deepEqual(r.plan.map((s) => s.id), ['a', 'b', 'd', 'f']);
  const want = generatePlan(g1.script, edited, { scope: 'selected', sel: ['c'], ctx, gen }).script;
  assert.deepEqual(r.script, want);
  const r2 = detachPlan(g1.script, g1.plan, ['e'], { ctx, gen });
  assert.equal(r2.script, g1.script);
});

test('toggleLocked / stateCounts', () => {
  let p = story();
  p = toggleLocked(p, ['a', 'b']);
  assert.ok(p[0].locked && p[1].locked);
  p = toggleLocked(p, ['a', 'c']);   // mixed -> lock all
  assert.ok(p[0].locked && p[2].locked);
  p = toggleLocked(p, ['a', 'c']);   // all locked -> unlock (key removed)
  assert.ok(!('locked' in p[0]) && !('locked' in p[2]) && p[1].locked);
  assert.deepEqual(stateCounts(stamp(p, ['c'])), { new: 4, fresh: 1, stale: 0, locked: 1 });
});

test('preview: slices of the selected segments, ghost entry replaced in place', () => {
  const plan = stamp(story(), ['a', 'b']);
  const res = gen.compilePlan(plan, ctx);
  const pts = sliceSegments(res, ['b', 'c', 'f']);
  assert.ok(isValid(pts));
  assert.ok(pts.every((a) => inSpan(a, plan.filter((s) => 'bcf'.includes(s.id)))));
  assert.ok(pts.length > 20);
  const other = { id: 'run1' };
  const g = { id: PREVIEW_ID, script: pts };
  const l1 = withGhost([other], g);
  assert.deepEqual(l1, [other, g]);
  const g2 = { ...g, script: [] };
  assert.deepEqual(withGhost(l1, g2), [other, g2]);
  assert.deepEqual(withGhost(l1, null), [other]);
  const l0 = [other];
  assert.equal(withGhost(l0, null), l0);
  assert.notEqual(planSig(plan), planSig(setParams(plan, ['c'], { hi: 50 })));
  assert.equal(planSig(plan), planSig(stamp(plan, ['c', 'd'])));   // stamps do not change the compile
});

test('mergeIntoGaps: existing segments win, overlapping imports trimmed or split, result valid', () => {
  let n = 0;
  const newId = () => 'n' + n++;
  const plan = [makeSegment({ id: 'x', t0: 10000, t1: 20000 }), makeSegment({ id: 'y', t0: 30000, t1: 40000 })];
  const inc = importTimeline([
    { start_ms: 0, end_ms: 15000, kind: 'fade-in' },        // trimmed to 0..10000
    { start_ms: 15000, end_ms: 45000, kind: 'climax' },    // split: 20..30 s and 40..45 s
    { start_ms: 32000, end_ms: 38000, kind: 'oral' },      // inside y: dropped (overlap with previous is trimmed by import)
    { start_ms: 50000, end_ms: 60000, kind: 'oral' },      // untouched
  ], { dur: 100000, newId }).plan;
  const r = mergeIntoGaps(plan, inc, { newId });
  assert.ok(isValidIntervals(r.plan, 100000));
  assert.deepEqual(r.plan.map((s) => [s.t0, s.t1, s.kind]), [
    [0, 10000, 'fade-in'], [10000, 20000, 'penetration'], [20000, 30000, 'climax'], [30000, 40000, 'penetration'], [40000, 45000, 'climax'], [50000, 60000, 'oral'],
  ]);
  assert.equal(r.added, 4);
  assert.equal(r.trimmed, 2);
});

test('spans export for a tracking run', () => {
  const s = toSpans(story());
  assert.deepEqual(s.map((x) => x.state), ['idle', 'active', 'climax', 'active']);
  assert.deepEqual(s[1], { start_ms: 8000, end_ms: 80000, state: 'active' });
});

test('form: schema mapping, values, overrides and patches', () => {
  const seg = makeSegment({ id: 's', t0: 0, t1: 1000, kind: 'penetration', params: { hi: 70, intensity: 0.5 } });
  const sch = formSchema(seg.recipe);
  assert.ok(!sch.some((p) => p.key === 'intensity'));
  const shape = sch.find((p) => p.key === 'shape');
  assert.equal(shape.type, 'choice'); assert.equal(shape.default, 'two-speed'); assert.ok(shape.choices.includes('sine'));
  assert.equal(sch.find((p) => p.key === 'jitterTime').unit, '×');
  assert.equal(sch.find((p) => p.key === 'fadeTo').group, 'More');
  assert.equal(sch.find((p) => p.key === 'gapFactor').group, 'More');
  assert.equal(sch.find((p) => p.key === 'shape').group, undefined);
  assert.equal(sch.find((p) => p.key === 'lo').group, undefined);
  const v = formValues(seg, sch);
  assert.equal(v.hi, 70); assert.equal(v.lo, 0); assert.equal(v.shape, 'two-speed');
  assert.deepEqual([...overridden(seg, sch)], ['hi']);
  // change one key
  assert.deepEqual(paramPatch(sch, { ...v, lo: 10 }, v, seg), { lo: 10 });
  // back to the recipe default removes the override
  assert.deepEqual(paramPatch(sch, { ...v, hi: 85 }, v, seg), { hi: undefined });
  // shape: a name, then back to the default name removes it (the recipe's object returns)
  assert.deepEqual(paramPatch(sch, { ...v, shape: 'sine' }, v, seg), { shape: 'sine' });
  const s2 = setParams([seg], ['s'], { shape: 'sine' })[0];
  assert.deepEqual(paramPatch(sch, { ...formValues(s2, sch), shape: 'two-speed' }, formValues(s2, sch), s2), { shape: undefined });
  // hold has no intensity and no common params
  assert.deepEqual(formSchema('hold').map((p) => p.key), ['pos', 'invert']);
});

test('compile timing: story plan and a 200-segment plan (reported, loose bound)', () => {
  const big = Array.from({ length: 200 }, (_, i) => makeSegment({ id: 'g' + i, t0: i * 18000, t1: (i + 1) * 18000, kind: ['penetration', 'oral', 'foreplay', 'knotting', 'climax', 'afterglow'][i % 6] }));
  const turns = turnsOf(Array.from({ length: 9000 }, (_, i) => ({ at: 100 + i * 400, pos: i % 2 ? 90 : 5 })));
  for (const [name, plan] of [['story', story()], ['200 segments', big]]) {
    for (const c of [ctx, { ...ctx, turns }]) {
      const t = performance.now();
      const res = gen.compilePlan(plan, c);
      const ms = performance.now() - t;
      const t2 = performance.now();
      gen.recompileSegment(res, setParams(plan, [plan[1].id], { hi: 60 }), null, c);
      const ms2 = performance.now() - t2;
      console.log(`  compile ${name}${c.turns.length ? ' + turns' : ''}: ${ms.toFixed(1)} ms full, ${ms2.toFixed(1)} ms incremental, ${res.script.length} points`);
      budget(ms < 5000);
    }
  }
});

test('Generate caps speed at the active device profile, not the unwritten device.maxSpeed setting', async () => {
  const { activeMaxSpeed } = await import('../src/features/timeline/generate-logic.js');
  const settings = (o) => ({ get: (k, d) => (k in o ? o[k] : d) });
  assert.equal(activeMaxSpeed({ settings: settings({}) }), 250, 'default profile: Generic stroker (conservative)');
  assert.equal(activeMaxSpeed({ settings: settings({ 'review.profile': 'handy' }) }), 360);
  assert.equal(activeMaxSpeed({ settings: settings({ 'review.profile': 'mine', 'review.profiles': [{ id: 'mine', name: 'Mine', maxSpeed: 123, minIntervalMs: 50, range: [0, 100] }] }) }), 123);
  assert.equal(activeMaxSpeed({ review: { profile: { maxSpeed: 300 } }, settings: settings({ 'review.profile': 'handy' }) }), 300, 'the review feature wins');
  assert.equal(activeMaxSpeed({ devicePreview: { profile: { maxSpeed: 280 } }, settings: settings({}) }), 280);
  assert.equal(activeMaxSpeed({}), 0, 'no app settings: planCtx falls back to its default');
  assert.equal(planCtx({ ghosts: [] }, { maxSpeed: activeMaxSpeed({ settings: settings({}) }) }).ctx.maxSpeed, 250);
});
