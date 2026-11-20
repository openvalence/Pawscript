// experiments/anchors/measure.mjs -- paw-wg2d / paw-ze8n: anchors on a shot that "starts off then corrects": in the first 40 % the
// automatic fusion backs the wrong motion, in the last 60 % it is right. Synthetic parts (test/fusion-synth.mjs) with a known
// stroke. Per part (bad = first 40 %, good = last 60 %): mean abs position error (pos, the fused channel over the shot vs the
// truth, both min..max) and turn timing error (frames: each true turn against the nearest fused turn of the same kind).
// Rows: automatic; the first anchors (1b1b592: one solve for the whole shot, experiments/anchors/old-global.mjs) with 2 in +
// 2 out on the bad part; the local anchors (lib/anchors.js) with the same marks; the same marks on the good part only (must
// change nothing); one of the bad-part marks 2 frames wrong. Also the earlier whole-shot lag case (lag3) for 1+1 / 2+2 / 3+3.
// Run: node experiments/anchors/measure.mjs
import { fusedChannel, fuseScene, forwardOf } from '../../src/lib/fusion.js';
import { signalTurns } from '../../src/lib/strokes.js';
import { anchorFit } from './old-global.mjs';
import { runOf, stroke, wander, T, N, ASPECT } from '../../test/fusion-synth.mjs';

const lagged = (f, n) => (i) => f(Math.max(0, i - n));
const at = (x, y) => () => [x, y];
const add = (...fs) => (i) => fs.reduce((s, f) => { const q = f(i); return [s[0] + q[0], s[1] + q[1]]; }, [0, 0]);
const vert = (amp, f) => (i) => [0, -amp * f(i)];   // y down: up (out) = + stroke
const drift = wander(91, 4000), noise = wander(92, 60);
export const CUT = Math.round(0.4 * N);   // where the automatic solve corrects itself
const early = (i) => i < CUT, late = (i) => i >= CUT;

export const CASES = {
  // the bodies are seen only from 40 % on; before that only the tail is, lagging the stroke by 4 frames, and fusion backs it
  lagStart: () => runOf({
    c1_hips: { at: add(at(0.4, 0.55), vert(0.03, stroke)), gap: early },
    c2_hips: { at: add(at(0.5, 0.45), (i) => [0, 0.004 * drift[i]]) },
    c1_tail: { at: add(at(0.3, 0.4), vert(0.03, lagged(stroke, 4))) },
    c2_head: { at: add(at(0.6, 0.3), vert(-0.015, stroke)), gap: early },
    c1_hand_r: { at: add(at(0.35, 0.7), (i) => [0.01 * noise[i], 0.01 * noise[(i + 7) % N]]) },
  }, { pair: false }),
  // the Bottom hips read upside down for the first 40 % (the bodies' relationship leads, so fusion is upside down there); the
  // Bottom head bobs with the true stroke all along
  flipStart: () => runOf({
    c1_hips: { at: add(at(0.4, 0.55), vert(0.03, (i) => (early(i) ? -1 : 1) * stroke(i))) },
    c2_hips: { at: add(at(0.5, 0.45), (i) => [0, 0.004 * drift[i]]) },
    c1_head: { at: add(at(0.45, 0.35), vert(0.02, stroke)) },
    c1_tail: { at: add(at(0.3, 0.4), (i) => [0.02 * drift[(i + 200) % N], 0.015 * drift[i]]) },
    c1_hand_r: { at: add(at(0.35, 0.7), (i) => [0.01 * noise[i], 0.01 * noise[(i + 7) % N]]) },
  }, { pair: false }),
  // paw-wg2d's case: the bodies lag 3 frames all along, the head in antiphase, drift, a noise hand; the true part is the penis
  lag3: () => runOf({
    c1_hips: { at: add(at(0.4, 0.55), vert(0.03, lagged(stroke, 3))) },
    c2_hips: { at: add(at(0.5, 0.45), (i) => [0, 0.02 * drift[i]]) },
    c2_penis: { at: add(at(0.45, 0.5), vert(0.025, stroke)) },
    c2_head: { at: add(at(0.6, 0.3), vert(-0.02, stroke)) },
    c1_tail: { at: add(at(0.3, 0.4), (i) => [0.03 * drift[(i + 200) % N], 0.02 * drift[i]]) },
    c1_hand_r: { at: add(at(0.35, 0.7), (i) => [0.02 * noise[i], 0.02 * noise[(i + 7) % N]]) },
  }, { pair: false }),
};

const truth = Float64Array.from({ length: N }, (_, i) => stroke(i));
const turnsOf = (v) => signalTurns(T, v).turns;
const tTurns = turnsOf(truth);
/** {pos, frames} of v over samples [a, b) (both scaled min..max over the whole shot). */
export function score(v, a = 0, b = N) {
  let lo = Infinity, hi = -Infinity, ta = Infinity, tb = -Infinity;
  for (let i = 0; i < N; i++) { if (v[i] === v[i]) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); } ta = Math.min(ta, truth[i]); tb = Math.max(tb, truth[i]); }
  let e = 0, n = 0;
  for (let i = a; i < b; i++) if (v[i] === v[i]) { e += Math.abs((100 * (v[i] - lo)) / (hi - lo) - (100 * (truth[i] - ta)) / (tb - ta)); n++; }
  const vt = turnsOf(Float64Array.from(v)), d = [];
  for (const [i, k] of tTurns) { if (i < a || i >= b) continue; let best = Infinity; for (const [j, kk] of vt) if (kk === k && Math.abs(j - i) < Math.abs(best)) best = j - i; d.push(Math.min(10, Math.abs(best))); }
  return { pos: +(e / n).toFixed(1), frames: +(d.reduce((x, y) => x + y, 0) / (d.length || 1)).toFixed(2) };
}
/** k in-anchors (true minima = fully in) and k out-anchors (maxima) spread over samples [a, b); wrong: the first one that many frames late. */
export function anchorsFor(k, wrong = 0, a = 0, b = N) {
  const ins = tTurns.filter(([i, kk]) => kk < 0 && i >= a && i < b), outs = tTurns.filter(([i, kk]) => kk > 0 && i >= a && i < b), pick = (L) => Array.from({ length: k }, (_, j) => L[Math.floor(((j + 0.5) * L.length) / k)]);
  const out = [...pick(ins).map(([i]) => ({ i, pos: 0 })), ...pick(outs).map(([i]) => ({ i, pos: 100 }))];
  if (wrong) out[0].i += wrong;
  return out.map((x) => ({ ms: T[Math.min(N - 1, x.i)], pos: x.pos }));
}
export const fused = (run, anchors, o = {}) => fusedChannel(run, { aspect: ASPECT, derives: anchors ? [{ anchors }] : [], ...o });
/** The first anchors (one solve for the whole shot) on the automatic result. */
export function oldGlobal(run, anchors) {
  const idx = Array.from({ length: N }, (_, i) => i), out = fuseScene(run, idx, { aspect: ASPECT }), F = forwardOf(out);
  const s = anchorFit({ t: F.A.t, v: out.v, raw: F.raw, tim: out.timing, conf: out.conf, rows: F.A.rows.map((r, i) => (F.live[i] ? { id: r.id, f: r.f, q: r.q } : null)).filter(Boolean) }, anchors.map((a) => ({ ...a, y: a.pos / 100, sign: 1 })));
  return s.v;
}
const both = (v) => ({ bad: score(v, 0, CUT), good: score(v, CUT, N) });
const fmt = (s) => `bad ${s.bad.pos} pos / ${s.bad.frames} fr · good ${s.good.pos} pos / ${s.good.frames} fr`;

if (process.argv[1]?.replace(/\\/g, '/').endsWith('experiments/anchors/measure.mjs')) {
  for (const id of ['lagStart', 'flipStart']) {
    const run = CASES[id](), bad = anchorsFor(2, 0, 0, CUT), good = anchorsFor(2, 0, CUT, N), wrong = anchorsFor(2, 2, 0, CUT);
    console.log(`${id}:`);
    console.log(`  automatic          ${fmt(both(fused(run, null).v))}`);
    console.log(`  old global, bad    ${fmt(both(oldGlobal(run, bad)))}`);
    const f = fused(run, bad);
    console.log(`  local, bad         ${fmt(both(f.v))}   sections ${JSON.stringify(f.info[0].anchors.sections.map((s) => [s.t0, s.t1, s.use, s.flipped, s.shift, s.unchanged]))}`);
    const g = fused(run, good), f0 = fused(run, null);
    console.log(`  local, good only   ${fmt(both(g.v))}   identical to automatic: ${Array.from(g.v).every((x, i) => Object.is(x, f0.v[i]))}`);
    console.log(`  local, one 2f late ${fmt(both(fused(run, wrong).v))}`);
  }
  const run = CASES.lag3();
  console.log(`lag3 (whole shot): automatic ${JSON.stringify(score(fused(run, null).v))}`);
  for (const k of [1, 2, 3]) console.log(`  ${k}+${k}: local ${JSON.stringify(score(fused(run, anchorsFor(k)).v))} · old global ${JSON.stringify(score(oldGlobal(run, anchorsFor(k))))}`);
}
