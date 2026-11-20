// mirror-synth.mjs -- paw-s80k: Smart stroke points of synthetic runs, flipped (F / a stretch over the scene) and not, for
// the mirror property (test/smart-flip.test.mjs, experiments/smart-flip/mirror.mjs). Not a test file itself.
import { channelPatch } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';
import { track, howRun, ASPECT } from './how-synth.mjs';
import { T as FT } from './fusion-synth.mjs';

const many = (n, s) => Array.from({ length: n }, () => ({ ...s }));
export const HOW_CASES = {
  impact: () => track(many(10, { kind: 'impact', T: 800, rest: 0.45 })),
  slowout: () => track(many(10, { kind: 'slowout', T: 700 })),
  shoulder: () => track(many(10, { kind: 'shoulder', T: 900, rest: 0.4, top: 0.2 })),
  'cusp bottom fast': () => track(many(14, { kind: 'cusp', T: 465 })),
  'cusp top fast': () => track(many(14, { kind: 'cusp', cusp: 'top', T: 465 })),
  'cusp bottom slow': () => track(many(10, { kind: 'cusp', T: 900 })),
};
/** A run of the case with one run scene; shaft: 'follow' (a SAM shaft whose visible share follows the depth) | 'noise' | null. */
export function caseRun(make, { shaft = null } = {}) {
  let run, t;
  if (make.how) { const tr = make.how(); run = howRun(tr, { seed: 3 }); t = tr.t; if (shaft) run.channels.__d = channelOf(tr.t.map((ms, i) => [ms, tr.d[i]])); }
  else { const s = make.fus(); run = s.run; t = FT; if (shaft) run.channels.__d = channelOf(FT.map((ms, i) => [ms, 0.5 + 0.5 * (s.truth ? s.truth(i) : Math.sin(ms / 160))])); }
  const end = run.range.end, scene = { start_ms: 0, end_ms: end, sign: 1 };
  if (shaft) {
    const d = run.channels.__d, len = (j) => (shaft === 'follow' ? 0.3 + 0.7 * d.v[j] : 0.82 + 0.05 * Math.sin(t[j] / 37) * Math.cos(t[j] / 91));
    run.channels.sem_c2_penis_len = channelOf(t.map((ms, j) => [ms, len(j)]));
    run.channels.sem_c2_penis_in = channelOf(t.map((ms, j) => [ms, 1 - len(j)]));
    run.channels.sem_c2_penis_in_conf = channelOf(t.map((ms) => [ms, 1]));
    delete run.channels.__d;
    scene.shaft = { c2_penis: { source: 'sam', full: 'seen', conf_share: 1 } };
  }
  return { ...run, scenes: [scene], channel: 'primary', points0: { at: new Float64Array(), pos: new Float64Array() } };
}
export const DETAILS = ['render', 'hold', 'mid', 'turns'];
export const RANGES = [undefined, 'scene', 'follow', 'local', 'shaft'];
/** The Smart stroke points of run (flipped: F on its scene, or 'stretch': a stretch over all of it) -> [{at, pos, why}]. */
export function smartPoints(run, { shape = 'render', range, depth = null, held = false, flip = false } = {}) {
  const d = { smart: true, detail: [{ t0: 0, t1: 1e9, shape, sens: 50 }], ...(range ? { strokes: { range } } : {}), ...(depth ? { fuse: { depth } } : {}), ...(held ? { held: true } : {}) };
  const r = flip === true ? { ...run, flips: [0] } : run;
  const p = channelPatch(r, 'primary', {}, [], { aspect: ASPECT, derives: [d], ...(flip === 'stretch' ? { flips: [[0, run.range.end]] } : {}) });
  const why = new Map((p.whys?.at || []).map((a, k) => [a, p.whys.why[k]]));
  return { pts: Array.from(p.points0.at, (at, k) => ({ at, pos: p.points0.pos[k], why: why.get(at) || 'turn' })), depthUsed: p.depthUsed };
}
/** a (flipped) against the mirror of b -> {n, t (time differences), d (depth > 1 pos), dMax, kind}. */
export function mirrorDiff(a, b) {
  const m = new Map(b.map((q) => [q.at, q]));
  let t = 0, d = 0, dMax = 0, kind = 0;
  for (const q of a) { const o = m.get(q.at); if (!o) { t++; continue; } const e = Math.abs(q.pos - (100 - o.pos)); if (e > 1e-9) { dMax = Math.max(dMax, e); if (e > 1) d++; } if (o.why !== q.why) kind++; }
  t += Math.max(0, b.length - (a.length - t));
  return { n: b.length, t, d, dMax, kind };
}
