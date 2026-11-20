// repeat-direction.js -- a new take's direction from a decided take that shows the same pictures (paw-zl3n, part 1). Pure
// (test/repeat-direction.test.mjs).
// Animation reuses pictures (timeline/repeats.js: buckets of frames that are exactly one picture). A picture means one
// place in the stroke wherever it comes back, so where a new run's scene shares pictures with a span whose direction is
// already decided (the editor's script: accepted or scripted; or a scene the owner flipped), the run's polarity is the one
// that makes the shared pictures agree. Measured (experiments/repeat-consistency/RESULTS.md): the reference scripts never
// disagree in polarity across takes at shared pictures (0 of 15 take pairs; third-party hand scripts 2 of 21), the
// sidecar's own direction is at chance there; this rule with these gates, on the eval's 3 signals x 461 scenes: decides
// 105, right 84 (0.80); of the 59 flips it makes, 47 fix an inverted take and 12 break a right one.
// Gates: >= minShared shared pictures, both sides spread >= minSpread pos, |Pearson r| >= minR; else no decision.

export const REPEAT_DIR = Object.freeze({ minShared: 3, minSpread: 3, minR: 0.5, near: 1500 });

/** Script {at, pos} (typed arrays or arrays, sorted) at t ms, linear; NaN where the script does not cover t (no point
 *  within `near` ms on either side). */
export function valueAt(at, pos, t, near = REPEAT_DIR.near) {
  const n = at?.length || 0;
  if (!n) return NaN;
  let lo = 0, hi = n - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (at[m] <= t) lo = m + 1; else hi = m - 1; }
  if (hi >= 0 && at[hi] === t) return pos[hi];
  if (hi < 0 || lo >= n) return NaN;   // before the first / after the last point
  if (t - at[hi] > near || at[lo] - t > near) return NaN;
  return pos[hi] + ((pos[lo] - pos[hi]) * (t - at[hi])) / (at[lo] - at[hi]);
}

/** Mean script value per picture (bucket id) over the occurrences (repeats index `occ`: {t, id}) starting inside one of
 *  `spans` [{t0, t1}] and covered by the script. -> Map id -> value. */
export function pictureValues(occ, at, pos, spans, near = REPEAT_DIR.near) {
  const sum = new Map();
  for (const o of occ || []) {
    if (!spans.some((s) => o.t >= s.t0 && o.t < s.t1)) continue;
    const v = valueAt(at, pos, o.t, near);
    if (v !== v) continue;
    const c = sum.get(o.id) || [0, 0];
    c[0] += v; c[1]++; sum.set(o.id, c);
  }
  return new Map([...sum].map(([id, [s, k]]) => [id, s / k]));
}

const spread = (v) => { const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length); };

/** The polarity of B that makes the shared pictures agree with A (A already in its decided orientation). -> {sign: +1
 *  keep | -1 flip | 0 nothing to read, n: shared pictures, r: Pearson r of A vs B over them}. */
export function impliedSign(A, B, o = REPEAT_DIR) {
  const ids = [...B.keys()].filter((id) => A.has(id));
  if (ids.length < o.minShared) return { sign: 0, n: ids.length, r: NaN };
  const a = ids.map((id) => A.get(id)), b = ids.map((id) => B.get(id));
  const sa = spread(a), sb = spread(b);
  if (sa < o.minSpread || sb < o.minSpread) return { sign: 0, n: ids.length, r: NaN };
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  const r = a.reduce((s, x, k) => s + (x - ma) * (b[k] - mb), 0) / (a.length * sa * sb);
  return { sign: Math.abs(r) >= o.minR ? (r > 0 ? 1 : -1) : 0, n: ids.length, r };
}

/**
 * Per scene of a new run: the decided source sharing the most pictures with it that passes the gates.
 * ix: repeats index (repeats.js indexRepeats), scenes: the run's scenes [{start_ms, end_ms}], points: the run's points
 * {at, pos} as they are now (the sidecar's direction), sources: [{label, at, pos, spans: [{t0, t1}]}] in their decided
 * orientation (never overlapping the run). -> [{scene, sign, from, n, r}] for the scenes with a decision (sign -1 = flip).
 */
export function directionFromRepeats(ix, scenes, points, sources, o = REPEAT_DIR) {
  if (!ix?.occ?.length || !sources?.length) return [];
  const pv = sources.map((s) => ({ s, v: pictureValues(ix.occ, s.at, s.pos, s.spans, o.near) })).filter((x) => x.v.size >= o.minShared);
  const out = [];
  (scenes || []).forEach((sc, i) => {
    const B = pictureValues(ix.occ, points.at, points.pos, [{ t0: sc.start_ms, t1: sc.end_ms }], o.near);
    if (B.size < o.minShared) return;
    let best = null;
    for (const { s, v } of pv) {
      const d = impliedSign(v, B, o);
      if (d.sign && (!best || d.n > best.n)) best = { scene: i, sign: d.sign, from: s.label, n: d.n, r: Math.round(d.r * 100) / 100 };
    }
    if (best) out.push(best);
  });
  return out;
}
