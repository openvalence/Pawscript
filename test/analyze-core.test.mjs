import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatmap, colorAt, speedColor, colorize, SCALE_NAMES, SCALES, statistics, findProblems, summarize, compare, makeProfile, getProfile, listProfiles, GENERIC, BUILTIN_PROFILES } from '../src/lib/analyze/index.js';
import { isValid } from '../src/lib/core/script.js';
import * as density from '../src/lib/edit/density.js';
import * as speed from '../src/lib/edit/speed.js';
import * as amplitude from '../src/lib/edit/amplitude.js';
import * as points from '../src/lib/edit/points.js';

/** n full strokes (down, up) of `period` ms starting at t0, between lo and hi. */
const strokes = (n, period, t0 = 0, lo = 0, hi = 100) => {
  const out = [{ at: t0, pos: hi }];
  for (let i = 0; i < n; i++) { out.push({ at: t0 + i * period + period / 2, pos: lo }, { at: t0 + (i + 1) * period, pos: hi }); }
  return out.map((a) => ({ at: Math.round(a.at), pos: a.pos }));
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('heatmap: constant speed, bins and rate', () => {
  const s = strokes(20, 1000);                         // 100 units every 500 ms = 200 u/s
  const h = heatmap(s, { width: 10 });
  assert.equal(h.mean.length, 10);
  for (let k = 0; k < 10; k++) { near(h.mean[k], 200, 0.01); near(h.peak[k], 200, 0.01); near(h.activity[k], 1, 1e-6); }
  assert.equal(h.t0, 0); assert.equal(h.t1, 20000);
  // 20 cycles in 20 s = 60 per minute; edge bins lose the unconfirmed first/last turn
  const mid = Array.from(h.rate).slice(1, 9);
  for (const r of mid) near(r, 60, 1e-3);
});

test('heatmap: window, zoom and idle', () => {
  const s = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 5000, pos: 100 }, { at: 6000, pos: 0 }];
  const h = heatmap(s, { t0: 0, t1: 6000, width: 6 });
  near(h.mean[0], 100, 1e-3); near(h.mean[2], 0); near(h.activity[2], 0); near(h.mean[5], 100, 1e-3);
  const z = heatmap(s, { t0: 500, t1: 1500, width: 2 });   // zoomed: half moving at 100, half idle
  near(z.mean[0], 100, 1e-3); near(z.mean[1], 0);
  assert.equal(heatmap(s, { t0: 10, t1: 10, width: 5 }).mean.length, 5);
  assert.equal(heatmap([], { width: 4 }).maxPeak, 0);
  assert.equal(heatmap(s, { width: 0 }).mean.length, 0);
  // far outside the script
  assert.equal(heatmap(s, { t0: 1e6, t1: 2e6, width: 3 }).maxPeak, 0);
});

test('heatmap: bin integral equals total distance', () => {
  const s = strokes(37, 733);
  const h = heatmap(s, { width: 53 });
  let dist = 0;
  for (let i = 1; i < s.length; i++) dist += Math.abs(s[i].pos - s[i - 1].pos);
  let sum = 0;
  for (const m of h.mean) sum += (m * h.binMs) / 1000;
  near(sum, dist, 0.05);
});

test('colour scales', () => {
  for (const name of SCALE_NAMES) {
    for (const v of [-1, 0, 0.3, 0.5, 1, 2, NaN]) {
      const c = colorAt(name, v);
      assert.equal(c.length, 3);
      assert.ok(c.every((x) => Number.isInteger(x) && x >= 0 && x <= 255), name);
    }
    assert.deepEqual(colorAt(name, 0), SCALES[name][0]);
    assert.deepEqual(colorAt(name, 1), SCALES[name][SCALES[name].length - 1]);
  }
  assert.notDeepEqual(speedColor(0), speedColor(400));
  assert.deepEqual(speedColor(800, { scale: 'viridis' }), colorAt('viridis', 1));
  const rgba = colorize(Float32Array.from([0, 200, 400]), { scale: 'grey' });
  assert.equal(rgba.length, 12); assert.equal(rgba[3], 255); assert.ok(rgba[8] > rgba[0]);
  assert.deepEqual(colorAt('nope', 0), SCALES.heat[0]);
});

test('statistics: regular strokes', () => {
  const s = strokes(30, 1000);                          // 30 cycles, 60 spm, 100 u over 500 ms
  const st = statistics(s);
  assert.equal(st.durationMs, 30000);
  assert.equal(st.actions, 61);
  assert.equal(st.strokes.turns, 59);                   // first top and last top are endpoints
  near(st.strokesPerMin, 58 / 2 / 30 * 60, 1e-9);       // (turns-1)/2 cycles over 30 s
  assert.equal(st.avgStrokeMs, 500); assert.equal(st.avgCycleMs, 1000); assert.equal(st.medianStrokeMs, 500);
  assert.equal(st.amplitude.n, 58); near(st.amplitude.mean, 100); assert.equal(st.amplitude.hist[9], 58);
  near(st.speed.mean, 200, 1e-6); near(st.speed.p50, 200); near(st.speed.max, 200);
  assert.equal(st.rest.ms, 0); assert.deepEqual(st.longestGap, { ms: 500, at: 0 });
  near(st.asymmetry.upShare, 0.5); near(st.asymmetry.speedRatio, 1);
  near(st.range.p5, 5, 1.5); near(st.range.p95, 95, 1.5);
  near(st.positionHist.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.equal(st.strokesPerMinSeries.length, 1 + 0);   // one 60 s window covers 30 s
  assert.ok(Math.abs(st.strokesPerMinSeries[0].spm - 60) < 3);
});

test('statistics: holds, rest, asymmetry, range', () => {
  const s = [{ at: 0, pos: 0 }, { at: 1000, pos: 0 }, { at: 1100, pos: 100 }, { at: 2100, pos: 0 }, { at: 12100, pos: 0 }];
  const st = statistics(s);
  near(st.range.shareAt0, 11000 / 12100, 1e-9); assert.equal(st.range.shareAt100, 0);
  near(st.range.actionShareAt0, 4 / 5); near(st.range.actionShareAt100, 1 / 5);
  assert.equal(st.longestGap.ms, 10000);
  near(st.rest.ms, 11000, 1e-6);
  assert.ok(st.asymmetry.speedRatio > 5);               // fast up (1000 u/s), slow down (100 u/s)
  const part = statistics(s, { t0: 1000, t1: 2100 });
  assert.equal(part.durationMs, 1100); assert.equal(part.actions, 3);
  near(part.speed.max, 1000);
  const outside = statistics(s, { t0: 0, t1: 30000 });  // range past the script: the rest is rest
  near(outside.rest.ms, 11000 + 17900, 1e-6);
});

test('statistics: degenerate inputs', () => {
  for (const s of [[], [{ at: 5, pos: 5 }], [{ at: 0, pos: 1 }, { at: 10, pos: 1 }]]) {
    const st = statistics(s);
    assert.ok(st.durationMs >= 0);
    assert.ok(!Object.values(st.speed).some((v) => Number.isNaN(v)));
    JSON.stringify(st);
  }
});

const kinds = (list) => list.map((p) => p.kind);
const P = { ...GENERIC, maxSpeed: 250, minIntervalMs: 80 };

test('problems: clean script has none', () => {
  assert.deepEqual(findProblems(strokes(30, 1000), P, {}), []);
  assert.deepEqual(findProblems([], P, {}), []);
});

test('problems: speed limit, severity, fix', () => {
  const s = [{ at: 0, pos: 0 }, { at: 200, pos: 100 }, { at: 1500, pos: 0 }, { at: 1600, pos: 40 }];  // 500 u/s, 400 u/s? 100/1.3s
  const p = findProblems(s, P, {});
  const sp = p.filter((x) => x.kind === 'speed-limit');
  assert.equal(sp.length, 2);
  assert.equal(sp[0].severity, 'error'); assert.equal(sp[1].severity, 'error');
  assert.equal(sp[0].id, 'speed-limit@0'); assert.deepEqual(sp[0].ats, [0, 200]);
  assert.equal(sp[0].fix.op, 'capSpeed'); assert.deepEqual(sp[0].fix.sel, { t0: 0, t1: 200 });
  const mild = findProblems([{ at: 0, pos: 0 }, { at: 360, pos: 100 }], P, {});   // 277 u/s: warn
  assert.equal(mild[0].severity, 'warn');
});

test('problems: too close, redundant, jitter, range, past media', () => {
  const s = [{ at: 0, pos: 0 }, { at: 30, pos: 5 }, { at: 1000, pos: 50 }, { at: 2000, pos: 50 }, { at: 3000, pos: 50 }, { at: 4000, pos: 50 }, { at: 5000, pos: 52 }, { at: 5100, pos: 50 }, { at: 5200, pos: 52 }, { at: 5300, pos: 50 }, { at: 9000, pos: 100 }];
  const p = findProblems(s, { ...P, range: [10, 90] }, { mediaDurationMs: 8000 });
  const k = kinds(p);
  for (const want of ['too-close', 'redundant', 'jitter', 'out-of-range', 'past-media']) assert.ok(k.includes(want), want + ' in ' + k);
  const red = p.find((x) => x.kind === 'redundant');
  assert.deepEqual(red.ats, [2000, 3000]);
  assert.equal(red.severity, 'info');
  const past = p.find((x) => x.kind === 'past-media');
  assert.equal(past.severity, 'error'); assert.deepEqual(past.ats, [9000]);
  assert.equal(p.find((x) => x.kind === 'out-of-range').fix.op, 'limitRange');
});

test('problems: long gap only inside active section', () => {
  const a = strokes(10, 1000), b = strokes(10, 1000, 20000);
  const gap = findProblems([...a, ...b], P, {}).filter((x) => x.kind === 'long-gap');
  assert.equal(gap.length, 1); assert.equal(gap[0].t0, 10000); assert.equal(gap[0].t1, 20000);
  assert.deepEqual(findProblems([{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 30000, pos: 0 }], P, {}).filter((x) => x.kind === 'long-gap'), []);
  assert.equal(gap[0].fix, undefined);
});

test('problems: raw imported lists', () => {
  const raw = [{ at: 100, pos: 10 }, { at: 50, pos: 20 }, { at: 50, pos: 30 }, { at: 200, pos: 140 }, { at: -5, pos: 1 }, { at: NaN, pos: 3 }];
  const p = findProblems(raw, P, {});
  const k = kinds(p);
  for (const want of ['out-of-order', 'duplicate-time', 'invalid-position', 'negative-time', 'invalid-action']) assert.ok(k.includes(want), want + ' in ' + k);
  assert.ok(p.filter((x) => x.severity === 'error' && x.kind !== 'speed-limit').every((x) => x.fix.op === 'normalize'));
});

test('problems: cut jump, cut sync, chapters, ids and order', () => {
  const s = [...strokes(8, 1000), ...strokes(8, 1000, 8000, 0, 100)];  // perfectly continuous at 8000
  const cont = findProblems(s, P, { cuts: [8000] });
  assert.ok(kinds(cont).includes('cut-sync'));
  const jump = findProblems([{ at: 0, pos: 0 }, { at: 3000, pos: 0 }, { at: 3200, pos: 100 }, { at: 5000, pos: 100 }], { ...P, maxSpeed: 1000 }, { cuts: [3100] });
  assert.ok(kinds(jump).includes('cut-jump'));
  const chap = findProblems([{ at: 0, pos: 0 }, { at: 3000, pos: 0 }, { at: 3200, pos: 100 }], { ...P, maxSpeed: 1000 },
    { chapters: [{ id: 'a', t0: 0, t1: 3000, name: 'intro' }, { id: 'b', t0: 3100, t1: 9000, name: 'rest' }] });
  assert.ok(kinds(chap).includes('empty-chapter') && kinds(chap).includes('chapter-jump'));
  assert.equal(chap.find((x) => x.kind === 'empty-chapter').id, 'empty-chapter@a');
  // ids are stable across edits elsewhere and unique
  const base = strokes(5, 120);                                         // fast: speed-limit + too-close
  const more = [...base, { at: 100000, pos: 0 }];
  const ids1 = findProblems(base, P, {}).map((x) => x.id), ids2 = findProblems(more, P, {}).map((x) => x.id);
  for (const id of ids1) assert.ok(ids2.includes(id), id);
  assert.equal(new Set(ids1).size, ids1.length);
  const list = findProblems(base, P, {});
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].t0 <= list[i].t0);
  assert.deepEqual(summarize(list), { planner: 0, error: list.filter((x) => x.severity === 'error').length, warn: list.filter((x) => x.severity === 'warn').length, info: list.filter((x) => x.severity === 'info').length });
});

test('problems: every fix descriptor runs on the real edit lib and yields a valid script', () => {
  const mods = { ...density, ...speed, ...amplitude, ...points };
  const s = [{ at: 0, pos: 0 }, { at: 30, pos: 5 }, { at: 200, pos: 100 }, { at: 1000, pos: 50 }, { at: 2000, pos: 50 }, { at: 3000, pos: 50 }, { at: 4000, pos: 50 }, { at: 5000, pos: 52 }, { at: 5100, pos: 50 }, { at: 5200, pos: 52 }, { at: 5300, pos: 50 }, { at: 9000, pos: 100 }];
  const prof = { ...P, range: [10, 90] };
  const ctx = { mediaDurationMs: 8000 };
  const before = findProblems(s, prof, ctx);
  assert.ok(before.length >= 5);
  let ran = 0;
  for (const p of before) {
    if (!p.fix || p.fix.op === 'normalize') continue;
    const out = mods[p.fix.op](s, p.fix.sel ?? null, p.fix.opts).script;
    assert.ok(isValid(out), p.kind);
    ran++;
    const still = findProblems(out, prof, ctx).filter((x) => x.kind === p.kind);
    assert.ok(still.length <= before.filter((x) => x.kind === p.kind).length, `${p.kind} did not improve`);
  }
  assert.ok(ran >= 4);
  const red = before.find((x) => x.kind === 'redundant');
  assert.equal(mods.simplify(s, red.fix.sel, red.fix.opts).script.length, s.length - 2);
});

test('profiles', () => {
  assert.equal(getProfile('handy').id, 'handy'); assert.equal(getProfile('nope'), GENERIC);
  assert.ok(BUILTIN_PROFILES.filter((p) => p.id !== 'nucleus-capstan').every((p) => p.verified === false));
  const mine = makeProfile({ id: 'mine', name: 'Mine', maxSpeed: 180, range: [5, 95] });
  assert.equal(listProfiles([mine]).at(-1), mine);
  assert.equal(getProfile('mine', [mine]).maxSpeed, 180);
  assert.equal(listProfiles([{ ...mine, id: 'handy' }]).filter((p) => p.id === 'handy').length, 1);
  assert.throws(() => makeProfile({ id: 'x', maxSpeed: -3 }), /maxSpeed/);
  assert.throws(() => makeProfile({ id: 'x', range: [50, 20] }), /range/);
  assert.throws(() => makeProfile({ id: '' }), /id/);
});

test('compare: identical, shifted, flipped, noisy', () => {
  const ref = strokes(40, 900);
  const same = compare(ref, ref);
  assert.equal(same.f1, 1); assert.equal(same.tp, same.n_ref); assert.equal(same.fp, 0);
  near(same.r_pos, 1, 1e-9); assert.equal(same.lag_ms, 0); assert.equal(same.dt_median_ms, 0);

  const late = ref.map((a) => ({ at: a.at + 80, pos: a.pos }));
  const l = compare(late, ref);
  assert.equal(l.f1, 1); assert.equal(l.lag_ms, 80); near(l.dt_median_ms, 80); near(l.dt_bias_ms, 80);
  const veryLate = compare(ref.map((a) => ({ at: a.at + 300, pos: a.pos })), ref);
  assert.equal(veryLate.f1, 0); assert.equal(veryLate.f1_lag, 1);            // beyond tolerance, lag fixes it
  assert.ok(veryLate.lag_ms > 0 && veryLate.lag_ms <= veryLate.lag_bound_ms);

  const flipped = ref.map((a) => ({ at: a.at, pos: 100 - a.pos }));
  assert.equal(compare(flipped, ref).f1, 0);
  const fl = compare(flipped, ref, { allowFlip: true });
  assert.equal(fl.sign, -1); assert.equal(fl.f1, 1);

  const half = ref.filter((_, i) => i % 4 !== 1);                            // drops some turning points
  const h = compare(half, ref);
  assert.ok(h.recall < 1 && h.precision <= 1 && h.fn > 0);
  assert.equal(h.tp + h.fn, h.n_ref); assert.equal(h.tp + h.fp, h.n_cand);
  assert.equal(h.pairs.length, h.tp); assert.equal(h.unmatchedRef.length, h.fn);

  // range restriction and degenerate inputs
  assert.equal(compare(ref, ref, { t0: 1000, t1: 5000 }).f1, 1);
  assert.equal(compare([], ref).tp, 0);
  assert.equal(compare([], []).empty, true);
  assert.equal(compare(ref, [], { t0: 0, t1: 5000 }).recall, 0);
});
