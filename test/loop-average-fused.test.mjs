// An owner clip, shot 47 (the owner's "loop doesn't match here even with smart stroke and average passes on"): with a loop's
// passes averaged every part channel repeats exactly, but fusion weighs its rows per 2 s window on a 0.5 s hop that does not
// line up with the loop (2250 ms there), so the fused signal and its timing series came out different in each pass (up to
// 4 % / 18 % of their range) and Smart stroke's turns moved by up to 2.5 frames between passes. The fused channel of an
// averaged loop is averaged over the same passes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { channelPatch } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';
import { fistingScene, T } from './fusion-synth.mjs';

const fm = 1000 / 30, F = 68, P0 = 20, NP = 7;   // a 68-frame loop (2267 ms), 7 passes from frame 20
const sc = fistingScene(['anal', 'fisting']), src = sc.run;
// every channel made an exact loop: frame f shows pass 0's frame at its phase
const ph = (f) => (f < P0 ? f : P0 + ((f - P0) % F));
const channels = Object.fromEntries(Object.entries(src.channels).map(([k, c]) => [k, channelOf(T.map((ms, f) => [ms, c.v[ph(f)] ?? null]))]));
const run = { ...src, id: 'lp', channels, channel: 'fused' };
const occ = Array.from({ length: F }, () => []);
for (let k = 0; k < NP; k++) for (let p = 0; p < F; p++) { const f = P0 + k * F + p; occ[p].push({ f0: f, f1: f, t_ms: T[f] }); }
const ix = indexRepeats({ frames: T.length, buckets: occ });
const loop = { id: 'l', avg: true, t0: T[P0], t1: T[P0 + F], auto: { key: 'k', t0: T[P0], t1: T[P0 + F], end: T[P0 + NP * F], n: NP } };

test('averaged loop: the fused signal and its timing series repeat exactly in every pass', () => {
  const r = channelPatch(run, 'fused', {}, [], { aspect: sc.aspect, derives: [{ smart: true, acts: ['anal', 'fisting'] }], loopAvg: { loops: [loop], ix, fm } });
  const f = r.channels.fused, at = (a, fr) => a[f.t.indexOf(T[fr])];
  let dv = 0, dt = 0;
  for (let k = 2; k < NP; k++) for (let p = 0; p < F; p++) { dv = Math.max(dv, Math.abs(at(f.v, P0 + k * F + p) - at(f.v, P0 + F + p))); dt = Math.max(dt, Math.abs(at(f.timing, P0 + k * F + p) - at(f.timing, P0 + F + p))); }
  // (2e-3: a frame on a pass boundary may take its neighbour pass's phase; before: 1e-2 / 2e-2 here, 0.044 / 0.178 on shot 47)
  assert.ok(dv < 2e-3 && dt < 2e-3, `fused differs between passes by ${dv.toFixed(4)}, its timing by ${dt.toFixed(4)}`);
});
