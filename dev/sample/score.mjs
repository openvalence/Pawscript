// dev/sample/score.mjs -- how close a script is to the sample clip's TRUE stroke (dev/sample/truth.json, paw-ys3x). Pure;
// dev/sample/build-project.mjs prints it, test/sample-project.test.mjs holds it to a tolerance.
//
// Turns: the points where the stroke changes direction (a plateau counts once, at its start). Each true turn is matched to
// the nearest script turn of the same kind (deepest / out) within `win` frames. Position: |script - truth| on every frame
// (the script interpolated linearly, as a device plays it).

/** [[ms, pos], ...] -> [{at, pos, kind: 'in' | 'out'}] (in = a local minimum: deepest; out = a maximum). */
export function turnsOf(pts, eps = 1) {
  const p = [];
  for (const [at, pos] of pts) if (!p.length || Math.abs(pos - p[p.length - 1][1]) >= eps) p.push([at, pos]);
  const out = [];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i][1] - p[i - 1][1], b = p[i + 1][1] - p[i][1];
    if (a < 0 && b > 0) out.push({ at: p[i][0], pos: p[i][1], kind: 'in' });
    else if (a > 0 && b < 0) out.push({ at: p[i][0], pos: p[i][1], kind: 'out' });
  }
  return out;
}

/** Linear interpolation of [[ms, pos], ...] at t (clamped at the ends). */
export function posAt(pts, t) {
  if (!pts.length) return NaN;
  if (t <= pts[0][0]) return pts[0][1];
  let lo = 0, hi = pts.length - 1;
  if (t >= pts[hi][0]) return pts[hi][1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= t) lo = m; else hi = m; }
  const [a, pa] = pts[lo], [b, pb] = pts[hi];
  return pa + (pb - pa) * (t - a) / (b - a);
}

const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** truth: truth.json; pts: the script [[ms, pos], ...]; skip: [[t0, t1] ms] left out (e.g. a modifier's span).
 *  -> {turns, matched, missed, extra, frames: {median, mean, p90}, signedFrames (script - truth, median), pos: {mae, p90}} */
export function score(truth, pts, { win = 8, skip = [] } = {}) {
  const fms = 1000 / truth.fps, out = (t) => skip.some(([a, b]) => t >= a && t < b);
  const tt = turnsOf(truth.turns).filter((x) => !out(x.at)), st = turnsOf(pts).filter((x) => !out(x.at));
  const used = new Set(), d = [];
  for (const x of tt) {
    let best = -1, bd = Infinity;
    st.forEach((y, j) => { const e = Math.abs(y.at - x.at); if (y.kind === x.kind && !used.has(j) && e < bd) { bd = e; best = j; } });
    if (best >= 0 && bd <= win * fms) { used.add(best); d.push((st[best].at - x.at) / fms); }
  }
  const abs = d.map(Math.abs).sort((a, b) => a - b), errs = [];
  for (let i = 0; i < truth.frames; i++) { const t = i * fms; if (!out(t)) errs.push(Math.abs(posAt(pts, t) - truth.pos[i])); }
  errs.sort((a, b) => a - b);
  const r = (x) => Math.round(x * 100) / 100;
  return {
    turns: tt.length, matched: d.length, missed: tt.length - d.length, extra: st.length - used.size,
    frames: { median: r(median(abs)), mean: r(abs.reduce((s, x) => s + x, 0) / (abs.length || 1)), p90: r(abs[Math.floor(abs.length * 0.9)] ?? NaN) },
    signedFrames: r(median(d)),
    pos: { mae: r(errs.reduce((s, x) => s + x, 0) / (errs.length || 1)), p90: r(errs[Math.floor(errs.length * 0.9)] ?? NaN) },
  };
}
