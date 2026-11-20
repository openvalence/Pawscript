// Turning-point utilities shared by many tools.

/** Turning points with prominence >= minProminence (pos units), as [{i, kind:'top'|'bottom'}] in index order.
 *  A zig-zag filter: a reversal counts once the signal has retraced by minProminence from the running extreme.
 *  On a plateau the first index wins. endpoints (default true) includes the first/last action (as the opposite kind
 *  of their neighbouring turn); false excludes them. Fewer than two actions or a flat script -> []. */
export function turns(script, minProminence = 0, { endpoints = true } = {}) {
  const n = script.length;
  if (n < 2) return [];
  const P = Math.max(0, minProminence), p = (i) => script[i].pos;
  const out = [];
  let hi = 0, lo = 0, dir = 0, cand = 0;
  for (let i = 1; i < n; i++) {
    const v = p(i);
    if (dir === 0) {
      if (v > p(hi)) hi = i;
      if (v < p(lo)) lo = i;
      const d = p(hi) - p(lo);
      if (d > 0 && d >= P) {
        if (hi > lo) { out.push({ i: lo, kind: 'bottom' }); dir = 1; cand = hi; }
        else { out.push({ i: hi, kind: 'top' }); dir = -1; cand = lo; }
      }
    } else if (dir === 1) {
      if (v > p(cand)) cand = i;
      else if (p(cand) - v > 0 && p(cand) - v >= P) { out.push({ i: cand, kind: 'top' }); dir = -1; cand = i; }
    } else if (v < p(cand)) cand = i;
    else if (v - p(cand) > 0 && v - p(cand) >= P) { out.push({ i: cand, kind: 'bottom' }); dir = 1; cand = i; }
  }
  if (dir === 0) return [];
  out.push({ i: cand, kind: dir === 1 ? 'top' : 'bottom' });
  if (!endpoints) return out.filter((t) => t.i !== 0 && t.i !== n - 1);
  {
    const opp = (k) => (k === 'top' ? 'bottom' : 'top');
    if (out[0].i !== 0) out.unshift({ i: 0, kind: opp(out[0].kind) });
    const l = out[out.length - 1];
    if (l.i !== n - 1) out.push({ i: n - 1, kind: opp(l.kind) });
  }
  return out;
}

/** Strokes between consecutive turning points: {i0, i1, dir (+1 up / -1 down), amplitude, durationMs, speed (pos/s)}. */
export function strokes(script, minProminence = 0) {
  const T = turns(script, minProminence), out = [];
  for (let k = 0; k + 1 < T.length; k++) {
    const i0 = T[k].i, i1 = T[k + 1].i, a = script[i0], b = script[i1];
    const amplitude = Math.abs(b.pos - a.pos), durationMs = b.at - a.at;
    out.push({ i0, i1, dir: b.pos > a.pos ? 1 : -1, amplitude, durationMs, speed: (amplitude * 1000) / durationMs });
  }
  return out;
}
