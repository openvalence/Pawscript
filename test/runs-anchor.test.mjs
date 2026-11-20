// paw-2ntn: the anchor (runs-channel.js anchorStrokes, a shot's derive.anchorTo): where a stroke shorter than the range sits.
// Synthetic: 10 s of full strokes, then 10 s of half strokes (1.2 Hz). 'middle' (no anchorTo) = the points as before this
// change, number for number (BEFORE below was dumped from the tree before it); 'in' pins every bottom at 0 (a half stroke
// tops out near 50), 'out' every top at 100 (a half stroke bottoms near 50), 'full' (the link's envelope) stretches them;
// a drift in the raw signal does not come through 'in' / 'out'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRun, newFrames } from '../src/lib/runs.js';
import { channelPatch, anchorStrokes } from '../src/lib/runs-channel.js';
import { runOf, T, N, ASPECT } from './fusion-synth.mjs';
import { BEFORE } from './runs-anchor.before.mjs';

const amp = (i) => (T[i] < 10000 ? 1 : 0.5), wave = (i) => amp(i) * Math.sin((2 * Math.PI * 1.2 * T[i]) / 1000);
// fused: Top hips stroking on a still Bottom (fusion.js), Smart stroke on (the strokes step), as a new run plays
const fz = runOf({ c1_hips: { at: () => [0.4, 0.6] }, c2_hips: { at: (i) => [0.5, 0.45 + 0.05 * wave(i)] } }, { pair: (i) => 0.5 + 0.5 * wave(i) });
fz.points0 = { at: Float64Array.of(0, T[N - 1]), pos: Float64Array.of(50, 50) };
// a raw channel with a drift under the strokes (0.3 of the full stroke over the run), classic fit (the run's range) and strokes
const raw = (drift) => T.map((ms, i) => [ms, 1 + wave(i) + (drift * ms) / T[N - 1]]);
const rawRun = (drift) => makeRun({ n: 1, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: { primary: 'auto' }, range: { start: 0, end: T[N - 1] + 1 }, roi: null,
  result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 0, pos: 50 }], scenes: [], channels: { g2_proj: raw(drift) } }, frames: newFrames(), runs: [] });
const link = (run, ch, extra = {}) => [{ t0: 0, t1: T[N - 1] + 1, run: run.id, channel: ch, ...extra }];

const pts = (run, ch, d, links = link(run, ch)) => { const p = channelPatch(run, ch, {}, links, { aspect: ASPECT, derives: d ? [d] : [] }); return { at: [...p.points0.at], pos: [...p.points0.pos], pinned: p.pinned }; };
/** turns (strict local extremes of the points, a hold as one) in [t0, t1): {tops, bottoms} positions */
function turns({ at, pos }, t0, t1) {
  const tops = [], bottoms = [];
  for (let j = 1; j + 1 < pos.length; j++) {
    if (at[j] < t0 || at[j] >= t1) continue;
    let a = j - 1, b = j + 1;
    while (b < pos.length - 1 && pos[b] === pos[j]) b++;
    if (pos[a] === pos[j]) continue;   // the hold's first point counts it
    if (pos[j] > pos[a] && pos[j] > pos[b]) tops.push(pos[j]); else if (pos[j] < pos[a] && pos[j] < pos[b]) bottoms.push(pos[j]);
  }
  return { tops, bottoms };
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const FULL = [1500, 9500], HALF = [11500, 19000];   // away from the switch and the ends
const say = (name, x) => console.log(name, JSON.stringify({ full: turns(x, ...FULL), half: turns(x, ...HALF) }));

const CASES = {
  fusedSmart: () => [fz, 'fused', { smart: true }],
  rawClassic: () => [rawRun(0), 'g2_proj', null],
  rawStrokes: () => [rawRun(0), 'g2_proj', { strokes: {} }],
  driftClassic: () => [rawRun(0.6), 'g2_proj', null],
  driftStrokes: () => [rawRun(0.6), 'g2_proj', { strokes: {} }],
};

test("'middle' = the points before the anchor existed, number for number (every path)", () => {
  for (const [k, mk] of Object.entries(CASES)) {
    const [run, ch, d] = mk(), m = pts(run, ch, d);
    assert.deepEqual({ at: m.at, pos: m.pos }, BEFORE[k], k);
    assert.equal(m.pinned, null, k);
    const h = turns(m, ...HALF);
    if (k !== 'driftClassic') assert.ok(Math.abs(mean(h.tops) + mean(h.bottoms) - 100) < 12, `${k}: the half strokes sit round the middle (${mean(h.bottoms).toFixed(1)}..${mean(h.tops).toFixed(1)})`);
  }
});

test("'in': every bottom at 0, a half stroke tops out near 50, a full one near 100; 'out' mirrors it; sizes stay true", () => {
  for (const [k, mk] of Object.entries(CASES)) {
    const [run, ch, d] = mk(), m = pts(run, ch, d), i = pts(run, ch, { ...(d || {}), anchorTo: 'in' }), o = pts(run, ch, { ...(d || {}), anchorTo: 'out' });
    if (process.env.ANCHOR_SAY) { say(k + ' middle', m); say(k + ' in', i); say(k + ' out', o); }
    assert.equal(i.pinned?.[0], 'in', k);
    const [fi, hi, fo, ho, hm] = [turns(i, ...FULL), turns(i, ...HALF), turns(o, ...FULL), turns(o, ...HALF), turns(m, ...HALF)];
    assert.ok(fi.bottoms.length >= 8 && hi.bottoms.length >= 6, `${k}: turns found (${fi.bottoms.length} / ${hi.bottoms.length})`);
    assert.ok([...fi.bottoms, ...hi.bottoms].every((x) => x === 0), `${k} in: every bottom at 0 (${[...fi.bottoms, ...hi.bottoms]})`);
    assert.ok(Math.abs(mean(hi.tops) - 50) <= 8 && mean(fi.tops) >= 88, `${k} in: half strokes top out at ${mean(hi.tops).toFixed(1)}, full ones at ${mean(fi.tops).toFixed(1)}`);
    assert.ok([...fo.tops, ...ho.tops].every((x) => x === 100), `${k} out: every top at 100 (${[...fo.tops, ...ho.tops]})`);
    assert.ok(Math.abs(mean(ho.bottoms) - 50) <= 8 && mean(fo.bottoms) <= 12, `${k} out: half strokes bottom out at ${mean(ho.bottoms).toFixed(1)}, full ones at ${mean(fo.bottoms).toFixed(1)}`);
    // the size of a half stroke is what it was on 'middle' (not stretched), within the pins' share of the jitter
    if (k !== 'driftClassic') assert.ok(Math.abs(mean(hi.tops) - (mean(hm.tops) - mean(hm.bottoms))) <= 6, `${k}: half stroke ${mean(hi.tops).toFixed(1)} tall on 'in', ${(mean(hm.tops) - mean(hm.bottoms)).toFixed(1)} on 'middle'`);
  }
});

test("a drift in the raw signal does not leak through 'in' / 'out' (it does on the classic fit's 'middle')", () => {
  const run = rawRun(0.6), m = pts(run, 'g2_proj', null), i = pts(run, 'g2_proj', { anchorTo: 'in' }), o = pts(run, 'g2_proj', { anchorTo: 'out' });
  const early = turns(m, 1500, 5000).bottoms, late = turns(m, 6000, 9500).bottoms;
  assert.ok(mean(late) - mean(early) > 5, `middle: the bottoms ride the drift (${mean(early).toFixed(1)} -> ${mean(late).toFixed(1)})`);
  const ti = turns(i, 1500, 9500).tops, to = turns(o, 1500, 9500).bottoms;
  assert.ok(Math.max(...ti) - Math.min(...ti) <= 6, `in: the full strokes' tops level (${Math.min(...ti)}..${Math.max(...ti)})`);
  assert.ok(Math.max(...to) - Math.min(...to) <= 6, `out: the full strokes' bottoms level (${Math.min(...to)}..${Math.max(...to)})`);
});

test("'full' (the link's envelope) stretches the half strokes to the range", () => {
  const f = pts(fz, 'fused', { smart: true }, link(fz, 'fused', { envelope: { mode: 'auto' } })), h = turns(f, ...HALF);
  assert.ok(mean(h.tops) >= 85 && mean(h.bottoms) <= 15, `half strokes ${mean(h.bottoms).toFixed(1)}..${mean(h.tops).toFixed(1)}`);
});

test('anchorStrokes: a wobble at a turn rides along, a hold is one turn, the ends follow the nearest pin', () => {
  const q = [[0, 40], [100, 100], [200, 97], [300, 100], [400, 25], [500, 75], [600, 25], [600.5, 25], [700, 80]];
  // in: the 97 dip is no bottom of its own (3 against strokes of 50+); before the first pinned bottom everything moves with it
  assert.deepEqual(anchorStrokes(q, 'in').map((p) => p[1]), [15, 75, 72, 75, 0, 50, 0, 0, 55]);
  // out: both tops round the dip pinned (no move), the 75 top to 100, the bottom between moves half of that
  assert.deepEqual(anchorStrokes(q, 'out').map((p) => p[1]), [40, 100, 97, 100, 38, 100, 50, 50, 100]);
  assert.deepEqual(anchorStrokes([[0, 1, 'turn', 'x']], 'in'), [[0, 1, 'turn', 'x']]);
  assert.equal(anchorStrokes(q, 'middle'), q);
  assert.deepEqual(anchorStrokes([[0, 50, 'end'], [10, 20, 'turn', 'b'], [20, 60, 'turn']], 'in'), [[0, 30, 'end'], [10, 0, 'turn', 'b'], [20, 40, 'turn']]);
});
