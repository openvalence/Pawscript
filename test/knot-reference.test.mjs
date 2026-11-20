// paw-afoe: knotting against the owner's reference knot script (a slow-knotting funscript, 24 fps, 11 cycles of
// 80 -> catch -> 20 -> 0 -> 17 -> 64 -> 80). Only numbers derived from its profile are used here (segments.json of the
// paw-xu4v audit: per segment min / mean / max), on a synthetic base of tops at 80 and bottoms at 0 at its mean period.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValid } from '../src/lib/core/script.js';
import { applyFx } from '../src/lib/fx.js';

const FRAME = 1000 / 24, PERIOD = 1129;
// the reference's profile: catch level (approach end) 29..33, press end 20, approach 107..188 pos/s, press 43..72 pos/s,
// pop 20 -> 0 in one frame, the drift 0 -> 17 in 167..417 ms, the pull-out 17 -> 64 -> 80 in 208..292 ms
const REF = { catch: [29, 33], press: 20, approachV: [107, 188], pressV: [43, 72], tie: 17, settleMs: [167, 417], popTo: 64, top: 80, pullOutMs: [208, 292] };
const base = [];
for (let k = 0; k <= 10; k++) base.push({ at: Math.round(k * PERIOD), pos: 80 }, { at: Math.round(k * PERIOD + 0.53 * PERIOD), pos: 0 });
const ctx = { maxSpeed: 0, minGapMs: 20, grid: FRAME };   // no cap: the shape as drawn
const speed = (a, b) => (Math.abs(b.pos - a.pos) * 1000) / (b.at - a.at);
const inRange = (v, [lo, hi], what) => assert.ok(v >= lo && v <= hi, `${what} ${v.toFixed(1)} not in ${lo}..${hi}`);

test('single over one reference cycle: catch, a slower press to the knot depth, a one-frame pop, the drift to the tie, the pull-out back on the top', () => {
  const t0 = base[4].at, t1 = base[6].at, out = applyFx(base, [{ id: 'k', kind: 'knotting', t0, t1, params: { mode: 'single' } }], ctx);
  assert.ok(isValid(out));
  const s = out.filter((a) => a.at >= t0 && a.at <= t1), i = (pos) => s.findIndex((a) => a.pos === pos);
  assert.equal(s[0].pos, REF.top, 'starts from the tracked level (the top), not 100');
  const iC = s.findIndex((a, k) => k && a.pos >= REF.catch[0] && a.pos <= REF.catch[1]), iP = i(REF.press), iB = i(0), iT = i(REF.tie);
  assert.ok(iC > 0 && iP === iC + 1 && iB === iP + 1, `catch, press, pop in a row: ${JSON.stringify(s)}`);
  const vA = speed(s[0], s[iC]), vP = speed(s[iC], s[iP]);
  inRange(vA, REF.approachV, 'approach pos/s'); inRange(vP, REF.pressV, 'press pos/s');
  assert.ok(vA / vP >= 2, `the press is slower than the approach (${(vA / vP).toFixed(2)}x; the reference 2.6x)`);
  assert.ok(s[iB].at - s[iP].at <= Math.ceil(FRAME), `the pop in one frame: ${s[iB].at - s[iP].at} ms`);
  assert.ok(iT === iB + 1, 'the drift up to the tie'); inRange(s[iT].at - s[iB].at, REF.settleMs, 'settle ms');
  const last = s[s.length - 1], peak = s.slice(iT).find((a) => a.pos === REF.popTo);
  assert.ok(peak, `the pull-out passes popTo ${REF.popTo}`); assert.equal(last.pos, REF.top, 'pulled out onto the top');
  const pullStart = s.slice(iT).filter((a) => a.pos === REF.tie).pop();
  inRange(last.at - pullStart.at, REF.pullOutMs, 'pull-out ms');
});

test('cycles on the same base still draw the reference cycle on every stroke', () => {
  const t0 = base[2].at, t1 = base[16].at, out = applyFx(base, [{ id: 'c', kind: 'knotting', t0, t1, params: { mode: 'cycles' } }], ctx);
  assert.ok(isValid(out));
  const s = out.filter((a) => a.at >= base[6].at && a.at < base[12].at);   // whole cycles away from the edge eases
  const pos = s.map((a) => a.pos);
  for (const v of [REF.press, 0, REF.tie, REF.popTo, REF.top]) assert.ok(pos.includes(v), `level ${v} in ${JSON.stringify(pos)}`);
  assert.ok(pos.some((v) => v >= REF.catch[0] - 2 && v <= REF.catch[1] + 2), 'the catch');
  for (let k = 1; k < s.length; k++) if (s[k - 1].pos === REF.press && s[k].pos === 0) assert.ok(s[k].at - s[k - 1].at <= Math.ceil(FRAME) + 1, 'the pop in one frame');
});

test('single under a device cap: the pop gives way in size, never in time, and stays under the cap', () => {
  const t0 = base[4].at, t1 = base[6].at;
  for (const [cap, gap] of [[360, 60], [200, 100]]) {
    const out = applyFx(base, [{ id: 'k', kind: 'knotting', t0, t1, params: { mode: 'single' } }], { maxSpeed: cap, minGapMs: gap, grid: FRAME });
    assert.ok(isValid(out));
    for (let k = 1; k < out.length; k++) if (out[k].at > t0 && out[k - 1].at < t1) {
      assert.ok(out[k].at - out[k - 1].at >= gap, `gap ${out[k].at - out[k - 1].at} under ${gap}`);
      assert.ok(speed(out[k - 1], out[k]) <= cap * 1.01, `${speed(out[k - 1], out[k]).toFixed(0)} pos/s over ${cap}`);
    }
  }
});
