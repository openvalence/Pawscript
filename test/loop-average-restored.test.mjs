// paw-ef73.33: a run loaded back (the .pawruns decode, or rebuilt from its ghost) is composed through the same
// channelPatch ctx.loopAvg as a fresh one: averaged while the loop's switch is on, raw when off, raw passes kept stored.
import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { makeRun } from '../src/lib/runs.js';
import { encodeRuns, decodeRuns } from '../src/lib/runs-file.js';
import { channelPatch, runFromGhost, keepOf } from '../src/lib/runs-channel.js';

// a 20-picture loop at 30 fps, 5 passes from frame 30; pass 1 runs 40 % short (a wild pass the median drops)
const fm = 1000 / 30, F = 20, P0 = 30, NP = 5, T = (f) => f * fm;
const occ = Array.from({ length: F }, () => []);
for (let k = 0; k < NP; k++) for (let p = 0; p < F; p++) { const f = P0 + k * F + p; occ[p].push({ f0: f, f1: f, t_ms: T(f) }); }
const ix = indexRepeats({ frames: 200, buckets: occ });
const loopOf = (avg) => ({ id: 'lp1', avg, t0: Math.round(T(P0)), t1: Math.round(T(P0 + F)), auto: { key: 'k', t0: Math.round(T(P0)), t1: Math.round(T(P0 + F)), end: Math.round(T(P0 + NP * F)), n: NP } });
const raw = Array.from({ length: 160 }, (_, f) => { const k = Math.floor((f - P0) / F), p = f - P0 - k * F; const y = 50 + 40 * Math.sin((2 * Math.PI * p) / F); return [Math.round(T(f)), k >= 0 && k < NP ? (k === 1 ? 50 + (y - 50) * 0.6 : y) : 50]; });
const run = makeRun({ n: 3, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: {}, range: { start: 0, end: Math.round(T(160)) }, roi: null, runs: [],
  result: { samples: [], points: [{ at: 0, pos: 50 }], channels: { g2_proj: raw } } });
run.channel = 'g2_proj';
run.restored = true;   // a ghost-rebuilt run written into the .pawruns comes back with the flag (rederive keys it on its loops)

const ctx = (avg) => ({ loopAvg: { loops: [loopOf(avg)], ix, fm } });
const inPass = (pts, k) => Array.from(pts.pos).filter((_, i) => pts.at[i] >= T(P0 + k * F) && pts.at[i] < T(P0 + (k + 1) * F));
const range = (a) => Math.max(...a) - Math.min(...a);

for (const [how, load] of [
  ['the .pawruns decode', () => decodeRuns(encodeRuns([run]))[0]],
  ['its ghost', () => ({ ghost: { id: 'run3', source: { kind: 'tracker', tracker: run.tracker, range: { t0: run.range.start, t1: run.range.end }, keep: keepOf(run, ['g2_proj']) }, script: [] } })],
]) {
  test(`a run restored through ${how}: averaged with the loop's switch on, raw when off, raw passes stored`, () => {
    const got = load();
    const compose = (avg) => (got.ghost ? runFromGhost(got.ghost, [], ctx(avg)) : { ...got, ...channelPatch(got, got.channel, {}, [], ctx(avg)) });
    const on = compose(true), off = compose(false);
    // off: the short pass stays short; on: it strokes as far as its neighbours
    assert.ok(range(inPass(off.points0, 1)) < 0.8 * range(inPass(off.points0, 2)), 'off: pass 1 raw');
    assert.ok(Math.abs(range(inPass(on.points0, 1)) - range(inPass(on.points0, 2))) < 3, 'on: pass 1 averaged');
    // the stored channel keeps the raw passes either way
    for (const r of [on, off]) {
      const v = r.channels.g2_proj.v, t = r.channels.g2_proj.t, j = t.indexOf(raw[P0 + F + 5][0]);
      assert.ok(Math.abs(v[j] - raw[P0 + F + 5][1]) < 1e-3, 'raw pass stored');
    }
  });
}
