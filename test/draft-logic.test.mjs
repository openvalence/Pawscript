import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STEPS, RULES, kindForSummary, quietWhy, planRows, planFromScenes, kindTally, pickTracker, WHOLE_FRAME,
  initSteps, stepEvent, pending, isComplete, restoreSteps, saveSteps, summaryLine, factsOf, withDoc, fmtCount, fmtMs, plural, MOTION_KIND,
} from '../src/features/draft/logic.js';
import { isValidIntervals } from '../src/features/timeline/intervals.js';
import { toSpans } from '../src/features/timeline/plan.js';

// describe summaries (the sidecar's shape: trackers/PROTOCOL.md describe.summary)
const S = (o) => ({ count: 'duo', species: ['canine'], acts: [], visible_parts: [], knot: false, rating: 'explicit', positions: [], views: [], ...o });
const FIX = [
  [S({ acts: ['anal_knotting', 'anal'] }), 'knotting', 'knotting act'],
  [S({ acts: ['anal_penetration'], knot: true }), 'penetration', 'penetration act'],   // a visible knot (anatomy) is not knotting
  [S({ acts: ['sex'], knot: true }), 'penetration', 'penetration act'],
  [S({ acts: ['vaginal_penetration', 'fellatio'] }), 'oral', 'oral act'],              // spitroast: oral comes first (by design)
  [S({ acts: ['fellatio', 'deep_throat'] }), 'oral', 'oral act'],
  [S({ acts: ['fellatio'], knot: true }), 'oral', 'oral act'],                     // a visible knot alone is not knotting
  [S({ acts: ['vaginal_penetration', 'thrusting'] }), 'penetration', 'penetration act'],
  [S({ count: 'solo', acts: ['dildo_insertion'] }), 'penetration', 'penetration act'],
  [S({ count: 'solo', acts: ['masturbation'], knot: true }), 'custom', 'stroking act'],   // the fake sidecar's summary
  [S({ acts: ['kissing', 'grinding'] }), 'foreplay', 'kissing / licking / grinding'],
  [S({ acts: [], rating: 'questionable' }), 'foreplay', 'not explicit, someone in frame'],
  [S({ acts: [], rating: 'safe', count: 'solo' }), 'foreplay', 'not explicit, someone in frame'],
  [S({ acts: [], rating: 'explicit' }), 'custom', 'explicit, no known act'],
  [S({ acts: ['something_new'] }), 'custom', 'explicit, no known act'],
];

test('rule table: fixtures of describe summaries -> kind', () => {
  for (const [s, kind, why] of FIX) assert.deepEqual([kindForSummary(s)?.kind, kindForSummary(s)?.why], [kind, why], JSON.stringify(s.acts));
  assert.equal(kindForSummary(S({ count: 'solo', acts: ['masturbation'], knot: true })).name, 'masturbation');
  assert.equal(kindForSummary(S({ acts: ['something_new'] })).name, 'something new');
  assert.equal(kindForSummary(S({ acts: [], rating: 'explicit' })).name, 'unlabelled');
  // nothing usable -> null (motion decides)
  assert.equal(kindForSummary(null), null);
  assert.equal(kindForSummary({}), null);
  assert.equal(kindForSummary(S({ count: 'unknown', species: [], rating: 'safe' })), null);
  // never climax
  assert.ok(RULES.every(([k]) => k !== 'climax'));
  assert.ok(RULES.every(([k]) => ['oral', 'penetration', 'knotting', 'foreplay', 'custom'].includes(k)));
});

test('quiet scenes: black (nobody in frame) or a static loop result', () => {
  assert.equal(quietWhy({}), '');
  assert.equal(quietWhy({ describe: { summary: S({ count: 'unknown', species: [], rating: 'safe' }) } }), 'nothing in frame');
  // loops.py's `none` dict (kind null, prominence 0) is a static scene, a < 10-frame scene OR motion without a rhythm:
  // not quiet. Only an explicit static flag is.
  assert.equal(quietWhy({ loop: { kind: null, prominence: 0 } }), '');
  assert.equal(quietWhy({ loop: { kind: null, prominence: 0, static: true } }), 'no motion');
  assert.equal(quietWhy({ loop: { kind: 'periodic', prominence: 0.02 } }), '');
});

test('a describe kind wins over the loop result (real-sidecar "no period" scenes keep their act)', () => {
  const none = { kind: null, prominence: 0, period_ms: null, cycles: 0 };
  const scenes = [sc(0, 4000, { describe: { summary: S({ acts: ['fellatio'] }) }, loop: none }),
    sc(4000, 9000, { describe: { summary: S({ acts: ['anal_penetration'] }) }, loop: none }),
    sc(9000, 12000, { describe: { summary: S({ acts: ['vaginal_penetration'] }) }, loop: { ...none, static: true } })];
  assert.deepEqual(planRows(scenes, 12000).map((r) => [r.t0, r.t1, r.kind]), [[0, 4000, 'oral'], [4000, 12000, 'penetration']]);
  // describe off, every scene without a period: motion, not one idle hold
  assert.deepEqual(planRows([sc(0, 5000, { loop: none }), sc(5000, 9000, { loop: none })], 9000).map((r) => r.kind), [MOTION_KIND]);
});

const sc = (t0, t1, o = {}) => ({ start_ms: t0, end_ms: t1, ...o });
const still = { loop: { kind: null, prominence: 0, static: true } };
const black = { describe: { summary: S({ count: 'unknown', species: [], rating: 'safe', acts: [] }) } };
const d = (acts, o = {}) => ({ describe: { summary: S({ acts, ...o }) }, loop: { kind: 'periodic', prominence: 0.4 } });

test('scenes -> plan rows: idle head/tail, offscreen inside, merged equal kinds', () => {
  const scenes = [sc(0, 3000, black), sc(3000, 8000, d(['fellatio'])), sc(8000, 15000, d(['oral'])), sc(15000, 18000, still),
    sc(18000, 30000, d(['anal'])), sc(30000, 40000, d(['anal_knotting'])), sc(40000, 44000, still), sc(44000, 50000, black)];
  const rows = planRows(scenes, 50000);
  assert.deepEqual(rows.map((r) => [r.t0, r.t1, r.kind]), [
    [0, 3000, 'idle'], [3000, 15000, 'oral'], [15000, 18000, 'offscreen'], [18000, 30000, 'penetration'], [30000, 40000, 'knotting'], [40000, 50000, 'idle'],
  ]);
  assert.match(rows[0].why, /nothing in frame \(head\)/);
  assert.match(rows[2].why, /no motion \(inside\)/);
  let n = 0;
  const plan = planFromScenes(scenes, { dur: 50000, newId: () => 's' + n++ });
  assert.ok(isValidIntervals(plan, 50000));
  assert.deepEqual(plan.map((s) => s.recipe), ['hold', 'oral', 'carry', 'penetration', 'knot-pop-stroke', 'hold']);
  assert.deepEqual(toSpans(plan).map((s) => s.state), ['idle', 'active', 'carry', 'active', 'idle']);
  assert.equal(kindTally(plan), '2 idle, 1 oral, 1 offscreen, 1 penetration, 1 knotting');
});

test('scenes -> plan: edge cases', () => {
  // no scenes: one motion-only segment over the video; nothing at all without a duration
  assert.deepEqual(planRows([], 60000).map((r) => [r.t0, r.t1, r.kind]), [[0, 60000, MOTION_KIND]]);
  assert.deepEqual(planRows([], 0), []);
  // one scene, no tags (describe skipped / failed): motion only
  assert.deepEqual(planRows([sc(0, 60000)], 60000).map((r) => [r.t0, r.t1, r.kind, r.why]), [[0, 60000, MOTION_KIND, 'motion only']]);
  // several scenes, no tags: merged into one
  assert.equal(planRows([sc(0, 5000), sc(5000, 9000), sc(9000, 12000)], 12000).length, 1);
  // every scene without strokes: all idle (nothing is "inside")
  assert.deepEqual(planRows([sc(0, 5000, still), sc(5000, 9000, black)], 9000).map((r) => r.kind), ['idle']);
  // a lone quiet scene between two active ones is offscreen
  assert.deepEqual(planRows([sc(0, 5000), sc(5000, 9000, still), sc(9000, 12000)], 12000).map((r) => r.kind), [MOTION_KIND, 'offscreen', MOTION_KIND]);
  // clamped to the duration, unsorted input, empty scenes dropped
  assert.deepEqual(planRows([sc(5000, 12000, d(['oral'])), sc(0, 5000), sc(12000, 12000)], 10000).map((r) => [r.t0, r.t1, r.kind]), [[0, 5000, MOTION_KIND], [5000, 10000, 'oral']]);
  // custom segments keep their act as the name; different acts stay apart
  const rows = planRows([sc(0, 5000, d(['masturbation'], { count: 'solo' })), sc(5000, 9000, d(['handjob']))], 9000);
  assert.deepEqual(rows.map((r) => [r.kind, r.name]), [['custom', 'masturbation'], ['custom', 'handjob']]);
  // overlapping scenes (a moved cut, a hand-edited project): clipped to the previous one, swallowed ones dropped
  const ov = planRows([sc(0, 6000, d(['oral'])), sc(5000, 9000, d(['anal'])), sc(6000, 8000, d(['kissing'])), sc(8500, 12000, still)], 12000);
  assert.deepEqual(ov.map((r) => [r.t0, r.t1, r.kind]), [[0, 6000, 'oral'], [6000, 9000, 'penetration'], [9000, 12000, 'idle']]);
  let n = 0;
  assert.ok(isValidIntervals(planFromScenes([sc(0, 6000), sc(3000, 9000, d(['oral'])), sc(2000, 4000, still)], { dur: 9000, newId: () => 'o' + n++ }), 9000));
});

test('pickTracker: roi none first, else lk_box (or any box tracker) on the whole frame', () => {
  const fake = [{ id: 'fake.box', roi: 'box' }, { id: 'fake.none', name: 'Fake whole-frame', roi: 'none' }];
  assert.deepEqual(pickTracker(fake), { tracker: 'fake.none', name: 'Fake whole-frame', roi: null });
  const real = [{ id: 'sam2_mask', roi: 'box_or_points' }, { id: 'lk_box', name: 'Optical flow (box)', roi: 'box' }, { id: 'lk_two_point', roi: 'points' }];
  assert.deepEqual(pickTracker(real), { tracker: 'lk_box', name: 'Optical flow (box)', roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 } });
  assert.equal(pickTracker([{ id: 'template', roi: 'box' }]).tracker, 'template');
  assert.equal(pickTracker([{ id: 'p', roi: 'points' }]), null);
  assert.equal(pickTracker([]), null);
  assert.ok(Object.isFrozen(WHOLE_FRAME));
});

test('step state machine: run / done / skip / fail / cancel / redo', () => {
  let s = initSteps();
  assert.equal(s.length, STEPS.length);
  assert.deepEqual(pending(s), [0, 1, 2, 3, 4, 5, 6, 7]);
  s = stepEvent(s, 0, { type: 'start' });
  assert.equal(s[0].status, 'running');
  s = stepEvent(s, 0, { type: 'progress', done: 1, total: 4 });
  assert.deepEqual(s[0].progress, { done: 1, total: 4, label: '' });
  assert.equal(stepEvent(s, 1, { type: 'progress', done: 1, total: 2 }), s);   // not running: ignored
  s = stepEvent(s, 0, { type: 'done', note: '12 scenes', ms: 1200, facts: { scenes: 12 } });
  assert.deepEqual([s[0].status, s[0].note, s[0].progress], ['done', '12 scenes', null]);
  s = stepEvent(s, 1, { type: 'skip', reason: 'turned off', user: true });
  s = stepEvent(s, 2, { type: 'start' });
  s = stepEvent(s, 2, { type: 'fail', error: 'boom\nTraceback ...' });
  assert.deepEqual([s[2].status, s[2].note], ['failed', 'boom']);
  assert.deepEqual(pending(s), [2, 3, 4, 5, 6, 7]);                 // done and user-skipped steps stay
  s = stepEvent(s, 2, { type: 'start' });
  s = stepEvent(s, 2, { type: 'cancel' });
  assert.deepEqual([s[2].status, s[2].note], ['idle', 'Cancelled']);
  for (let i = 2; i < 8; i++) s = stepEvent(stepEvent(s, i, { type: 'start' }), i, { type: 'done', note: 'ok', facts: { i } });
  assert.ok(isComplete(s));
  assert.deepEqual(pending(s), [0, 2, 3, 4, 5, 6, 7]);              // nothing left: full re-run, user skip kept
  // redo step 3: the finished steps after it go stale, the ones before do not
  s = stepEvent(stepEvent(s, 3, { type: 'start' }), 3, { type: 'done', note: 'again' });
  assert.deepEqual(s.map((x) => x.stale), [false, false, false, false, true, true, true, true]);
  assert.ok(!isComplete(s));
  assert.deepEqual(pending(s), [4, 5, 6, 7]);
  assert.deepEqual(Object.keys(factsOf(s)), ['scenes', 'loops']);   // stale facts do not count; plan's redo had none
  // a non-user skip (no scenes) also invalidates the steps after it; reset clears
  s = stepEvent(s, 0, { type: 'skip', reason: 'no video' });
  assert.ok(s.slice(1).filter((x) => x.status === 'done').every((x) => x.stale));
  s = stepEvent(s, 0, { type: 'reset' });
  assert.deepEqual([s[0].status, s[0].note], ['idle', '']);
  assert.equal(stepEvent(s, 99, { type: 'start' }), s);
});

test('steps follow undo and partial writes', () => {
  let s = initSteps();
  const ids = ['e1', 'e2', 'e3', null, null, 'e6', null, null];
  for (let i = 0; i < 8; i++) s = stepEvent(stepEvent(s, i, { type: 'start' }), i, { type: 'done', note: 'ok', entry: ids[i], facts: i === 4 ? { runId: 'run1', points: 9 } : { i } });
  assert.equal(s[0].entry, 'e1');
  assert.equal(withDoc(s), s);                                           // all live: same list
  // generate (e6) undone: it and the steps after it are stale; earlier ones stand
  let v = withDoc(s, { live: (id) => id !== 'e6' });
  assert.deepEqual(v.map((x) => !!x.stale), [false, false, false, false, false, true, true, true]);
  assert.ok(v[5].undone && !v[6].undone);
  assert.ok(!isComplete(v));
  assert.deepEqual(pending(v), [5, 6, 7]);
  assert.ok(!('generate' in factsOf(v)));
  // the scenes entry undone: everything stale
  assert.deepEqual(pending(withDoc(s, { live: (id) => id !== 'e1' })), [0, 1, 2, 3, 4, 5, 6, 7]);
  // the track's ghost removed
  v = withDoc(s, { gone: (x) => x.id === 'track' });
  assert.deepEqual(pending(v), [4, 5, 6, 7]);
  // entries are not persisted (history starts empty on open)
  assert.ok(!('entry' in saveSteps(s)[0]));
  // a cancel / failure after a partial write outdates the finished steps after it; a clean one does not
  let c = stepEvent(stepEvent(s, 1, { type: 'start' }), 1, { type: 'cancel', note: 'Cancelled after 3/9', wrote: true });
  assert.deepEqual([c[1].status, c.slice(2).every((x) => x.stale)], ['idle', true]);
  c = stepEvent(stepEvent(s, 2, { type: 'start' }), 2, { type: 'fail', error: '3/9 checked (kept), then: boom', wrote: true });
  assert.ok(c.slice(3).every((x) => x.stale));
  c = stepEvent(stepEvent(s, 2, { type: 'start' }), 2, { type: 'cancel' });
  assert.ok(c.slice(3).every((x) => !x.stale));
});

test('persisted steps: running -> interrupted, garbage ignored', () => {
  let s = initSteps();
  s = stepEvent(s, 0, { type: 'done', note: '3 scenes', facts: { scenes: 3 } });
  s = stepEvent(s, 1, { type: 'start' });
  const back = restoreSteps(JSON.parse(JSON.stringify(saveSteps(s))));
  assert.deepEqual([back[0].status, back[0].facts], ['done', { scenes: 3 }]);
  assert.deepEqual([back[1].status, back[1].note], ['idle', 'Interrupted']);
  assert.deepEqual(restoreSteps(null), initSteps());
  assert.deepEqual(restoreSteps([{ id: 'scenes', status: 'weird' }, 5, { id: 'nope', status: 'done' }]), initSteps());
});

test('summary line and formatting', () => {
  assert.equal(summaryLine({ scenes: { scenes: 12 }, loops: { exact: 2 }, plan: { segments: 9 }, generate: { points: 1847 }, assist: { questions: 14 } }),
    '12 scenes · 2 exact loops · plan 9 segments · 1 847 points · 14 questions waiting');
  assert.equal(summaryLine({ scenes: { scenes: 1 }, plan: { segments: 1 }, generate: { points: 1 }, assist: { questions: 0 } }), '1 scene · plan 1 segment · 1 point · no questions waiting');
  assert.equal(summaryLine({ scenes: { scenes: 0 }, loops: { exact: 1 } }), '0 scenes · 1 exact loop');
  assert.equal(summaryLine({}), 'Nothing done yet');
  assert.equal(fmtCount(1234567), '1 234 567');
  assert.equal(fmtCount(999), '999');
  assert.equal(plural(1, 'scene'), '1 scene');
  assert.deepEqual([fmtMs(0), fmtMs(340), fmtMs(1234), fmtMs(125000)], ['', '340 ms', '1.2 s', '2 min 05 s']);
});
