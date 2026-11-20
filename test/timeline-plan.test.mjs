import assert from 'node:assert/strict';
import test from 'node:test';
import { makeSegment, setKind, setRecipe, setParams, segState, stamp, genTargets, toSpans, importTimeline, toDirector, paramSummary, coerceParams, intensityOf, paramValue } from '../src/features/timeline/plan.js';
import { KINDS, KIND, kindFromName, kindByKey, kindOf } from '../src/features/timeline/kinds.js';
import { isValidIntervals } from '../src/features/timeline/intervals.js';
import { KINDS as GEN_KINDS, RECIPES } from '../src/lib/gen/recipes.js';
import { compilePlan, applyPlan, tile } from '../src/lib/gen/index.js';
import { isValid } from '../src/lib/core/script.js';

let n = 0;
const newId = () => 'p' + n++;

test('kinds: one look per gen kind, distinct colours, keys 0-9, valid recipes', () => {
  assert.deepEqual(KINDS.map((k) => k.id).sort(), Object.keys(GEN_KINDS).sort());
  assert.equal(new Set(KINDS.filter((k) => k.id !== 'outro' && k.id !== 'custom').map((k) => k.series)).size, KINDS.length - 2);   // outro and custom share idle's grey
  assert.notEqual(KINDS.find((k) => k.id === 'climax').series, KINDS.find((k) => k.id === 'orgasm').series);
  for (const k of KINDS) {
    assert.match(k.color, /^#[0-9A-F]{6}$/i);
    assert.ok(k.icon.startsWith('M'));
    assert.ok(['active', 'idle', 'carry', 'climax', 'orgasm'].includes(k.span));
    assert.ok(RECIPES[k.recipe], k.id);
  }
  assert.deepEqual(KINDS.filter((k) => k.key).map((k) => k.key).sort(), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.equal(kindByKey('6').id, 'climax');
  assert.equal(kindByKey('7').id, 'orgasm');
  assert.equal(kindFromName('cum'), 'orgasm');
  assert.deepEqual(KINDS.map((k) => k.id).slice(5, 8), ['climax', 'orgasm', 'afterglow']);
  assert.equal(kindFromName('Fade In'), 'fade-in');
  assert.equal(kindFromName('slow_ending'), 'afterglow');
  assert.equal(kindFromName('KNOT'), 'knotting');
  assert.equal(kindFromName('main act'), 'penetration');
  assert.equal(kindFromName('banana'), null);
  assert.equal(kindOf('banana').color, KIND.custom.color);
});

test('segments: sparse params, kind changes keep custom recipes, coercion', () => {
  const s = makeSegment({ id: 's', t0: 0, t1: 5000, kind: 'penetration' });
  assert.equal(s.recipe, 'penetration');
  assert.deepEqual(s.params, {});
  assert.equal(paramValue(s, 'hi'), 85);
  let plan = setKind([s], ['s'], 'climax');
  assert.equal(plan[0].recipe, 'climax');
  plan = setRecipe(plan, ['s'], 'strokes');
  plan = setKind(plan, ['s'], 'oral');
  assert.equal(plan[0].recipe, 'strokes');          // custom recipe survives a kind change
  plan = setParams(plan, ['s'], { rate: 999, junk: 1, intensity: 0.4 });
  assert.ok(plan[0].params.rate <= 20);
  assert.equal('junk' in plan[0].params, false);
  assert.equal(intensityOf(plan[0]), 0.4);
  plan = setParams(plan, ['s'], { intensity: undefined });
  assert.equal(intensityOf(plan[0]), 1);
  assert.deepEqual(coerceParams('hold', { pos: '12.7', x: 1 }), { pos: 12.7 });
  assert.deepEqual(coerceParams('hold', { pos: 400 }), { pos: 100 });
  assert.match(paramSummary(s), /^0–85/);
});

test('generation state: new -> fresh -> stale; locked skipped', () => {
  const a = makeSegment({ id: 'a', t0: 0, t1: 1000 }), b = makeSegment({ id: 'b', t0: 1000, t1: 2000 });
  let plan = [a, { ...b, locked: true }];
  assert.equal(segState(plan[0]), 'new');
  assert.equal(segState(plan[1]), 'locked');
  assert.deepEqual(genTargets(plan).map((s) => s.id), ['a']);
  plan = stamp(plan, ['a']);
  assert.equal(segState(plan[0]), 'fresh');
  assert.deepEqual(genTargets(plan), []);
  plan = setParams(plan, ['a'], { lo: 30 });
  assert.equal(segState(plan[0]), 'stale');
  assert.deepEqual(genTargets(plan, 'all').map((s) => s.id), ['a']);
  assert.deepEqual(genTargets(plan, 'selected', ['b']), []);
});

test('spans round trip', () => {
  const spans = [{ start_ms: 0, end_ms: 4000, state: 'idle' }, { start_ms: 4000, end_ms: 9000, state: 'active' }, { start_ms: 9000, end_ms: 12000, state: 'carry' }, { start_ms: 15000, end_ms: 16000, state: 'climax' }];
  const { plan, format, warnings } = importTimeline({ spans }, { dur: 20000, newId });
  assert.equal(format, 'spans');
  assert.deepEqual(warnings, []);
  assert.deepEqual(plan.map((s) => s.kind), ['idle', 'penetration', 'offscreen', 'climax']);
  assert.deepEqual(toSpans(plan), spans);
  // sidecar v3.1: climax = the fast run-in, orgasm = the pulses; both as spans and as track events
  const sp2 = [{ start_ms: 0, end_ms: 6000, state: 'climax' }, { start_ms: 6000, end_ms: 30000, state: 'orgasm' }];
  const p2 = importTimeline({ spans: sp2 }, { dur: 40000, newId }).plan;
  assert.deepEqual(p2.map((s) => [s.kind, s.recipe]), [['climax', 'climax'], ['orgasm', 'orgasm']]);
  assert.deepEqual(toSpans(p2), sp2);
  const evs = importTimeline({ events: [{ t_ms: 0, end_ms: 6000, kind: 'climax', label: 'climax 6.0 s' }, { t_ms: 6000, end_ms: 30000, kind: 'orgasm', label: 'orgasm 24.0 s' }] }, { dur: 40000, newId });
  assert.equal(evs.format, 'events');
  assert.deepEqual(evs.plan.map((s) => s.kind), ['climax', 'orgasm']);
  const two = importTimeline([{ start_ms: 0, end_ms: 1000, kind: 'foreplay' }, { start_ms: 1000, end_ms: 2000, kind: 'oral' }], { dur: 5000, newId }).plan;
  assert.deepEqual(toSpans(two), [{ start_ms: 0, end_ms: 2000, state: 'active' }]);
  const ev = importTimeline([{ t_ms: 100, end_ms: 2100, kind: 'still', label: 'still 2 s' }], { dur: 5000, newId });
  assert.equal(ev.format, 'events');
  assert.equal(ev.plan[0].kind, 'idle');
});

test('director import: aliases, intensity scales, recipes, overlaps, bounds', () => {
  const rows = [
    { start_ms: 0, end_ms: 8000, kind: 'fade-in', intensity: 3 },
    { start_ms: 7000, end_ms: 30000, kind: 'main act', intensity: 0.7, recipe: 'penetration-strokes', params: { lo: 20, bogus: 5 } },
    { start_ms: 30000, end_ms: 35000, kind: 'Knotting', intensity: 80 },
    { start_ms: 35000, end_ms: 99000, kind: 'interpretive dance' },
    { start_ms: 5, end_ms: 2 },
    { start_ms: 41000, end_ms: 42000, kind: 'climax', recipe: 'nope' },
  ];
  const { plan, warnings } = importTimeline(JSON.stringify({ segments: rows }), { dur: 40000, newId });
  assert.ok(isValidIntervals(plan, 40000));
  assert.deepEqual(plan.map((s) => s.kind), ['fade-in', 'penetration', 'knotting', 'custom']);
  assert.deepEqual(plan.map(intensityOf), [0.3, 0.7, 0.8, 1]);
  assert.equal(plan[1].t0, 8000);
  assert.equal(plan[1].recipe, 'penetration-strokes');
  assert.equal(plan[1].params.lo, 20);
  assert.equal('bogus' in plan[1].params, false);
  assert.equal(plan[3].name, 'interpretive dance');
  assert.equal(plan[3].t1, 40000);
  assert.equal(warnings.length, 6);   // bad row, unknown kind, trim, clamp, climax: unknown recipe + outside the video
  const again = importTimeline(toDirector(plan), { dur: 40000, newId }).plan;
  assert.deepEqual(again.map(({ id, ...s }) => s), plan.map(({ id, ...s }) => ({ ...s, params: { ...s.params, intensity: intensityOf(s) } })));
  assert.throws(() => importTimeline('{"nothing": 1}', { newId }));
});

test('real gen with timeline-made segments: valid script inside the segments; tile repeats exactly', () => {
  const plan = importTimeline([{ start_ms: 0, end_ms: 4000, kind: 'fade-in' }, { start_ms: 4000, end_ms: 9000, kind: 'knotting' }, { start_ms: 9000, end_ms: 12000, kind: 'climax' }], { dur: 12000, newId }).plan;
  const res = compilePlan(plan, {});
  assert.ok(isValid(res.script));
  assert.deepEqual(res.issues, []);
  assert.equal(res.segments.length, 3);
  const base = [{ at: 0, pos: 50 }, { at: 20000, pos: 50 }];
  assert.ok(isValid(applyPlan(base, res)));
  const t = tile([{ at: 1000, pos: 0 }, { at: 1300, pos: 100 }], 1000, 600, 1000, 4000);
  assert.deepEqual(t.script.map((a) => a.at), [1000, 1300, 1600, 1900, 2200, 2500, 2800, 3100, 3400, 3700, 4000]);   // + the clipped edge point
});

test('follow segments go stale when the tracker turns they use change; unknown turns never flag', async () => {
  const { setTurns, turnsSig } = await import('../src/features/timeline/plan.js');
  const turns = Array.from({ length: 200 }, (_, i) => ({ at: i * 400 }));
  const f = makeSegment({ id: 'f', t0: 20000, t1: 30000, kind: 'penetration' });   // follow
  const h = makeSegment({ id: 'h', t0: 50000, t1: 60000, kind: 'idle' });          // hold: turns irrelevant
  setTurns(turns);
  let plan = stamp([f, h], ['f', 'h']);
  assert.deepEqual(plan.map(segState), ['fresh', 'fresh']);
  assert.equal(turnsSig(h), '');
  const moved = turns.map((t) => (t.at === 25200 ? { at: 25260 } : t));       // a turn inside f's span moves
  setTurns(moved);
  assert.deepEqual(plan.map(segState), ['stale', 'fresh']);
  setTurns(turns.map((t) => (t.at === 70000 ? { at: 70100 } : t)));          // a turn far outside f's +-10 s window
  assert.equal(segState(plan[0]), 'fresh');
  setTurns(null);                                                              // no tracker ghost loaded
  assert.equal(segState(plan[0]), 'fresh');
  assert.equal(segState(setParams(plan, ['f'], { lo: 20 })[0]), 'stale');      // own edits still count
  setTurns(null);
});

test('unknownRecipes names the plan recipes the registry lacks (warned on open)', async () => {
  const { unknownRecipes } = await import('../src/features/timeline/plan.js');
  const known = Object.keys(RECIPES)[0];
  assert.deepEqual(unknownRecipes([{ recipe: known }, { recipe: 'nope' }, { recipe: 'nope' }, { recipe: 'abc' }, {}]), ['abc', 'nope']);
  assert.deepEqual(unknownRecipes(null), []);
});
