// Join cleanup (core/script.js cleanMicro / cleanJoins): micro glitches go, real turns, effects and ends stay; idempotent,
// never faster; the problems finder reports what is left with a fix; the settings that drive it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMicro, cleanJoins, isValid, MICRO } from '../src/lib/core/script.js';
import { cleanMicro as cleanMicroOp } from '../src/lib/edit/density.js';
import { findProblems, FIX_OPS } from '../src/lib/analyze/problems.js';
import { applyFix, hasFix } from '../src/features/review/logic/fixes.js';
import { applyFx } from '../src/lib/fx.js';
import { joinsOfFx } from '../src/features/tracking/accept.js';
import { SCHEMA, cleanMicroOpts } from '../src/app/settings.svelte.js';

const S = (...p) => p.map(([at, pos]) => ({ at, pos }));
const ats = (s) => s.map((a) => a.at);
// the owner's screenshot: a cut at 337 400, the accepted script wiggles 3 units back in 30 ms in the middle of a rising stroke
const SHOT = S([336900, 90], [337150, 2], [337400, 20], [337430, 17], [337900, 95], [338400, 5]);

test('the screenshot: the back-step at 337 430 goes, the slope continues, nothing else moves', () => {
  const out = cleanMicro(SHOT);
  assert.deepEqual(ats(out), [336900, 337150, 337400, 337900, 338400]);
  assert.ok(isValid(out));
  assert.equal(SHOT.length, 6, 'input not mutated');
  assert.deepEqual(MICRO, { gapMs: 60, posTol: 6, blendMs: 300 });
});

test('real turns survive: big enough, slow enough, the ends, dense samples with the motion', () => {
  const big = S([0, 50], [40, 58], [80, 50], [120, 58], [160, 50]);   // an 8-unit vibration at 40 ms: real
  assert.equal(cleanMicro(big), big);
  const slow = S([0, 50], [100, 53], [200, 50], [300, 53]);           // 3 units but 100 ms legs: real
  assert.equal(cleanMicro(slow), slow);
  const dense = S([0, 10], [20, 12], [40, 14], [60, 16], [80, 18], [100, 60]);   // micro legs WITH the slope: samples, not glitches
  assert.equal(cleanMicro(dense), dense);
  const ends = S([0, 50], [30, 53], [500, 90], [530, 87]);            // micro legs at the script's ends: the end points stay
  assert.equal(cleanMicro(ends)[0].at, 0);
  assert.equal(cleanMicro(ends).at(-1).at, 530);
  // a shoulder at a peak: the less extreme point goes, the turn keeps its extreme
  assert.deepEqual(cleanMicro(S([0, 50], [500, 90], [530, 86], [1000, 10], [1500, 60])), S([0, 50], [500, 90], [1000, 10], [1500, 60]));
  // a valley with a micro bump: the bottom stays
  assert.deepEqual(cleanMicro(S([0, 50], [500, 10], [530, 14], [560, 10], [1000, 90])).map((a) => a.pos), [50, 10, 90]);
  // a blip on a slope goes; the slope points either side stay
  assert.deepEqual(cleanMicro(S([0, 2], [500, 50], [520, 53], [540, 50], [1000, 95])), S([0, 2], [500, 50], [1000, 95]));
});

test('thresholds, spans, keep, minGapMs, joins', () => {
  assert.equal(cleanMicro(SHOT, { posTol: 3 }), SHOT, 'a 3-unit step is not under posTol 3');
  assert.equal(cleanMicro(SHOT, { gapMs: 30 }), SHOT, '30 ms is not under gapMs 30');
  assert.equal(cleanMicro(SHOT, { spans: [[338000, 339000]] }), SHOT, 'outside the spans: untouched');
  assert.equal(cleanMicro(SHOT, { keep: [[337420, 337440]] }), SHOT, 'a kept point stays');
  assert.deepEqual(ats(cleanMicro(SHOT, { spans: [[337420, 337440]] })), [336900, 337150, 337400, 337900, 338400], 'context may lie outside the span');
  // (c) a too-close pair WITH the slope goes only under minGapMs; a big back-step under it is a real turn and stays
  const close = S([0, 0], [500, 40], [510, 48], [1000, 90]);
  assert.equal(cleanMicro(close), close);
  assert.equal(cleanMicro(close, { minGapMs: 20 }).length, 3);
  const back = S([0, 0], [500, 40], [510, 30], [1000, 90]);
  assert.equal(cleanMicro(back, { minGapMs: 20 }), back);
  // joins: only within blendMs of each join
  assert.equal(cleanJoins(SHOT, [336000], {}), SHOT);
  assert.equal(cleanJoins(SHOT, [337400], {}).length, 5);
  assert.equal(cleanJoins(SHOT, [[337000, 337200]], { blendMs: 250 }).length, 5);
  assert.equal(cleanJoins(SHOT, [337400], null), SHOT, 'off');
  // an unsorted input is normalised first
  assert.ok(isValid(cleanMicro([SHOT[3], ...SHOT.slice(0, 3), ...SHOT.slice(4)])));
});

test('idempotent, deterministic, sorted, in range, never faster, ends kept (random scripts)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 300; n++) {
    const s = [];
    for (let t = 0, k = 0; k < 40; k++) { t += 5 + Math.floor(rnd() * (rnd() < 0.3 ? 40 : 400)); s.push({ at: t, pos: Math.floor(rnd() * 101) }); }
    const opts = { gapMs: 30 + Math.floor(rnd() * 90), posTol: 2 + Math.floor(rnd() * 10), minGapMs: rnd() < 0.3 ? 15 : 0 };
    const a = cleanMicro(s, opts);
    assert.ok(isValid(a));
    assert.deepEqual(cleanMicro(a, opts), a, 'cleaning twice = once');
    assert.deepEqual(cleanMicro(s, opts), a, 'deterministic');
    assert.equal(a[0].at, s[0].at); assert.equal(a.at(-1).at, s.at(-1).at);
    // every kept segment is no faster than the fastest input segment it replaces
    for (let i = 1; i < a.length; i++) {
      const i0 = s.findIndex((x) => x.at === a[i - 1].at), i1 = s.findIndex((x) => x.at === a[i].at);
      let was = 0;
      for (let j = i0 + 1; j <= i1; j++) was = Math.max(was, Math.abs(s[j].pos - s[j - 1].pos) / (s[j].at - s[j - 1].at));
      assert.ok(Math.abs(a[i].pos - a[i - 1].pos) / (a[i].at - a[i - 1].at) <= was + 1e-9, 'speed guard');
    }
  }
});

test('a spurt: its ringing survives by default; a tiny one only as a kept span (joinsOfFx)', () => {
  const rising = S([0, 20], [10000, 80]), t = 5000, fx = (amount) => [{ id: 's', kind: 'spurt', t0: t, t1: t, params: { amount } }];
  const ring = applyFx(rising, fx(20), { maxSpeed: 0 });
  assert.ok(ring.length > 4);
  assert.equal(cleanMicro(ring), ring, 'swings >= posTol are real');
  const tiny = applyFx(rising, fx(4), { maxSpeed: 0 });
  assert.ok(cleanMicro(tiny).length < tiny.length, 'a spurt under posTol would be eaten ...');
  const { joins, keep } = joinsOfFx(fx(4));
  assert.equal(cleanJoins(tiny, joins, { keep }), tiny, '... unless its span is kept');
  assert.ok(keep[0][0] < t && keep[0][1] > t + 100, 'the spurt span is its ringing window');
});

test('findProblems reports what is left as "micro" with a cleanMicro fix (one or all); the edit op works on a selection', () => {
  const ps = findProblems(SHOT).filter((p) => p.kind === 'micro');
  assert.equal(ps.length, 1);
  assert.deepEqual(ps[0].ats, [337430]);
  assert.equal(ps[0].fix.op, 'cleanMicro'); assert.equal(FIX_OPS.cleanMicro, 'edit/density.js');
  assert.ok(hasFix(ps[0]));
  assert.deepEqual(applyFix(SHOT, ps[0]), cleanMicro(SHOT));
  assert.deepEqual(applyFix(SHOT, ps[0], { all: true }), cleanMicro(SHOT));
  assert.equal(findProblems(SHOT, undefined, { thresholds: { microPos: 3 } }).filter((p) => p.kind === 'micro').length, 0, 'thresholds from ctx');
  assert.equal(findProblems(cleanMicro(SHOT)).filter((p) => p.kind === 'micro').length, 0);
  const r = cleanMicroOp(SHOT, { t0: 337000, t1: 337500 }, {});
  assert.deepEqual(r.ats, [337150, 337400]);
  assert.equal(cleanMicroOp(SHOT, { ats: [336900, 337900] }, {}).script, SHOT, 'unselected points are context only');
});

test('settings: edit.cleanMicro on by default, 60 ms / 6 units, off = null, values validated', () => {
  assert.equal(SCHEMA['edit.cleanMicro'].default, true);
  assert.equal(SCHEMA['edit.cleanMicroMs'].default, 60);
  assert.equal(SCHEMA['edit.cleanMicroPos'].default, 6);
  // a Settings-like get (the real class needs the Svelte compiler): schema validation as Settings.get does it
  const vals = {}, s = { get: (k) => { const v = vals[k], sc = SCHEMA[k]; return v != null && typeof v === typeof sc.default && (!sc.valid || sc.valid(v)) ? v : sc.default; } };
  assert.deepEqual(cleanMicroOpts(s), { gapMs: 60, posTol: 6 });
  assert.deepEqual(cleanMicroOpts(undefined), { gapMs: 60, posTol: 6 }, 'no settings: the defaults');
  Object.assign(vals, { 'edit.cleanMicroMs': 90, 'edit.cleanMicroPos': 'x' });
  assert.deepEqual(cleanMicroOpts(s), { gapMs: 90, posTol: 6 });
  assert.ok(!SCHEMA['edit.cleanMicroMs'].valid(-1) && !SCHEMA['edit.cleanMicroPos'].valid(80));
  vals['edit.cleanMicro'] = false;
  assert.equal(cleanMicroOpts(s), null);
});
