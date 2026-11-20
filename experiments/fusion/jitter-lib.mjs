// experiments/fusion/jitter-lib.mjs -- jitter measures of a fused stroke signal and of the points made from it (paw-0sn8).
// Pure. What a human calls "jittery / not refined" on a stroke trace, each normalised by the scene's own stroke so scenes
// compare:
//   nsr      white-noise std (robust, from second differences) / the stroke's robust std: frame-to-frame fuzz
//   hf       rms of what a P/16 gaussian removes / rms of the detrended signal: energy above the stroke band
//   wig      visible turns per stroke (hysteresis 3 % of the scene's p5..p95), 2 = clean; wigX = wig - 2 (extra reversals)
//   acc      p99 |second difference| / the acceleration of a sine of the same amplitude and period: spikes (1 = smooth sine)
//   churn    mean share of the weights that moves from one 0.5 s window to the next (0.5 sum |dw|), lead = leader changes / min
// Points (strokes.js via pointsFromChannel): ppS = turn points per stroke, tiny = share of half-strokes under 25 % of the
// median, ampCV = half-stroke amplitude CV; against a script: F1 within 100 ms, errMs (mean |dt| matched), sdMs.
const fin = Number.isFinite;
export const med = (a) => { const b = a.filter(fin).sort((x, y) => x - y), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : NaN; };
export const mean = (a) => { let s = 0, n = 0; for (const x of a) if (fin(x)) { s += x; n++; } return n ? s / n : NaN; };
export function pct(a, p) { const b = a.filter(fin).sort((x, y) => x - y); if (!b.length) return NaN; const x = (b.length - 1) * p, i = Math.floor(x); return b[i] + (b[Math.min(b.length - 1, i + 1)] - b[i]) * (x - i); }
function movAvg(v, w) {
  const n = v.length, h = w >> 1, cs = new Float64Array(n + 1), cn = new Float64Array(n + 1), out = new Float64Array(n);
  for (let i = 0; i < n; i++) { const ok = fin(v[i]); cs[i + 1] = cs[i] + (ok ? v[i] : 0); cn[i + 1] = cn[i] + (ok ? 1 : 0); }
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1), c = cn[b] - cn[a]; out[i] = fin(v[i]) && c ? (cs[b] - cs[a]) / c : NaN; }
  return out;
}
export function gauss(v, sig) {   // sig in samples, NaN-aware
  const n = v.length, h = Math.max(1, Math.ceil(3 * sig)), k = Array.from({ length: 2 * h + 1 }, (_, i) => Math.exp(-0.5 * ((i - h) / sig) ** 2)), out = new Float64Array(n);
  for (let i = 0; i < n; i++) { if (!fin(v[i])) { out[i] = NaN; continue; } let s = 0, w = 0; for (let j = -h; j <= h; j++) { const x = v[i + j]; if (fin(x)) { s += k[j + h] * x; w += k[j + h]; } } out[i] = s / w; }
  return out;
}
/** Visible turns with hysteresis h (absolute) -> [[index, +1 top / -1 bottom]]. */
export function hystTurns(v, h) {
  const out = [];
  let dir = 0, hi = NaN, lo = NaN, ext = NaN, ei = -1;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!fin(x)) continue;
    if (!dir) {
      if (!(x <= hi)) hi = x;
      if (!(x >= lo)) lo = x;
      if (x - lo > h) { dir = 1; ext = x; ei = i; } else if (hi - x > h) { dir = -1; ext = x; ei = i; }
      continue;
    }
    if (dir > 0) { if (x > ext) { ext = x; ei = i; } else if (ext - x > h) { out.push([ei, 1]); dir = -1; ext = x; ei = i; } }
    else if (x < ext) { ext = x; ei = i; } else if (x - ext > h) { out.push([ei, -1]); dir = 1; ext = x; ei = i; }
  }
  return out;
}
/** Measures of one scene's signal: t (ms), v (NaN = none), P (stroke period ms). */
export function signalJitter(t, v, P) {
  const n = v.length, dt = (t[n - 1] - t[0]) / (n - 1) || 33.3;
  if (!(P > 0)) P = 800;
  const det = movAvg(v, Math.max(3, Math.round((2 * P) / dt))), v0 = Array.from(v, (x, i) => x - det[i]);
  const sd = 1.4826 * med(v0.map(Math.abs)) || 1e-9;
  const d2 = [];
  for (let i = 1; i + 1 < n; i++) { const x = v[i + 1] - 2 * v[i] + v[i - 1]; if (fin(x)) d2.push(Math.abs(x)); }
  const noise = (1.4826 * med(d2)) / Math.sqrt(6);
  const sm = gauss(v, Math.max(0.5, P / 16 / dt));
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) if (fin(v[i]) && fin(v0[i])) { a += (v[i] - sm[i]) ** 2; b += v0[i] ** 2; }
  const lo = pct(Array.from(v), 0.05), hi = pct(Array.from(v), 0.95), turns = hystTurns(v, 0.03 * (hi - lo));
  let on = 0;
  for (const x of v) if (fin(x)) on++;
  const strokes = (on * dt) / P;
  const sine = Math.SQRT2 * sd * (2 * Math.PI * dt / P) ** 2;
  return { nsr: noise / sd, hf: Math.sqrt(a / (b || 1e-12)), wig: strokes > 0 ? turns.length / strokes : NaN, acc: pct(d2, 0.99) / (sine || 1e-12), strokes };
}
/** Window weight churn from info.windows [{t, w: {row: share}}] -> {churn, lead (changes / min)}. */
export function churnOf(windows) {
  if (!windows?.length) return { churn: NaN, lead: NaN };
  let c = 0, k = 0, sw = 0, lastLead = null;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i].w, ld = Object.entries(w).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (i) { const p = windows[i - 1].w, ks = new Set([...Object.keys(w), ...Object.keys(p)]); let s = 0; for (const x of ks) s += Math.abs((w[x] || 0) - (p[x] || 0)); c += s / 2; k++; if (ld !== lastLead) sw++; }
    lastLead = ld;
  }
  const min = (windows[windows.length - 1].t1 - windows[0].t) / 60000 || 1;
  return { churn: k ? c / k : 0, lead: sw / min };
}
/** Turn times + kinds of a polyline (plateaus: their first point). */
export function polyTurns(at, pos) {
  const out = [], kind = [];
  let dir = 0;
  for (let i = 1; i < at.length; i++) {
    const d = Math.sign(pos[i] - pos[i - 1]);
    if (!d) continue;
    if (dir && d !== dir) { let k = i - 1; while (k > 0 && pos[k - 1] === pos[k]) k--; out.push(k); kind.push(dir); }
    dir = d;
  }
  return out.map((k, j) => [k, kind[j]]);
}
/** Points measures: at / pos (0..100) over [s0, s1), strokes (count), ref = script [[at, pos]] or null. */
export function pointsJitter(at, pos, strokes, ref = null, tol = 100) {
  const tu = polyTurns(at, pos), amps = [];
  for (let i = 1; i < tu.length; i++) amps.push(Math.abs(pos[tu[i][0]] - pos[tu[i - 1][0]]));
  const m = med(amps), sdA = Math.sqrt(mean(amps.map((x) => (x - mean(amps)) ** 2)));
  const out = { ppS: strokes > 0 ? tu.length / strokes : NaN, tiny: amps.length ? amps.filter((x) => x < 0.25 * m).length / amps.length : NaN, ampCV: amps.length > 2 ? sdA / mean(amps) : NaN, turns: tu.length };
  if (ref?.length > 4) {
    const rt = polyTurns(ref.map((p) => p[0]), ref.map((p) => p[1])).map(([k]) => ref[k][0]), gt = tu.map(([k]) => at[k]);
    const pairs = [];
    for (let i = 0; i < rt.length; i++) for (let j = 0; j < gt.length; j++) { const d = Math.abs(rt[i] - gt[j]); if (d <= tol) pairs.push([d, i, j, gt[j] - rt[i]]); }
    pairs.sort((a, b) => a[0] - b[0]);
    const ui = new Set(), uj = new Set(), e = [];
    for (const [d, i, j, s] of pairs) if (!ui.has(i) && !uj.has(j)) { ui.add(i); uj.add(j); e.push(s); }
    out.F1 = rt.length + gt.length ? (2 * e.length) / (rt.length + gt.length) : 0;
    out.errMs = e.length ? mean(e.map(Math.abs)) : NaN;
    out.sdMs = e.length > 2 ? Math.sqrt(mean(e.map((x) => (x - mean(e)) ** 2))) : NaN;
    out.refTurns = rt.length;
    const ra = [];
    const rtu = polyTurns(ref.map((p) => p[0]), ref.map((p) => p[1]));
    for (let i = 1; i < rtu.length; i++) ra.push(Math.abs(ref[rtu[i][0]][1] - ref[rtu[i - 1][0]][1]));
    out.refCV = ra.length > 2 ? Math.sqrt(mean(ra.map((x) => (x - mean(ra)) ** 2))) / mean(ra) : NaN;
    out.refTiny = ra.length ? ra.filter((x) => x < 0.25 * med(ra)).length / ra.length : NaN;
  }
  return out;
}
/** Linear interpolation of a script at t (NaN outside). */
export const interp = (at, pos, t) => { if (t < at[0] || t > at[at.length - 1]) return NaN; let lo = 0, hi = at.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (at[m] <= t) lo = m; else hi = m; } return at[hi] === at[lo] ? pos[lo] : pos[lo] + ((pos[hi] - pos[lo]) * (t - at[lo])) / (at[hi] - at[lo]); };
export function pearson(a, b) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; if (!(fin(x) && fin(y))) continue; n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; }
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return n > 8 && va > 1e-12 && vb > 1e-12 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : NaN;
}
