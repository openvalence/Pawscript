// motion.js -- pure checks on a finished run (test/tracking-motion.test.mjs):
//   cameraMotion(run, ref)        does the run mostly follow the whole-frame (camera) motion?
//   lowMotion(run, media)         is the tracked thing barely moving (the sidecar normalises per scene, so a wall
//                                 drifting 1 px still yields a full-height signal)?
//   motionStats(points, windows)  per-scene turn count, strokes / min, regularity, idle spans
// run = lib/runs.js makeRun record: samples {t, v} (NaN gaps), scenes [{start_ms, end_ms}], channels {name: {t, v}},
// frames {t, ov} (overlay frames), points {at, pos}.

const fin = Number.isFinite;

function pct(xs, q) {
  const s = Float64Array.from(xs).sort();
  if (!s.length) return NaN;
  const i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}
const spread = (xs) => (xs.length < 2 ? 0 : pct(xs, 0.95) - pct(xs, 0.05));
function sd(xs) { const n = xs.length; if (n < 2) return 0; let m = 0; for (const x of xs) m += x; m /= n; let s = 0; for (const x of xs) s += (x - m) ** 2; return Math.sqrt(s / n); }

/** ref series {t, v} sampled at times ts (linear; NaN outside or across a gap). */
export function resample(ref, ts) {
  const out = new Float64Array(ts.length);
  let j = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    while (j + 1 < ref.t.length && ref.t[j + 1] <= t) j++;
    if (!ref.t.length || t < ref.t[0] || t > ref.t[ref.t.length - 1]) { out[i] = NaN; continue; }
    if (ref.t[j] === t || j + 1 >= ref.t.length) { out[i] = ref.t[j] === t ? ref.v[j] : NaN; continue; }
    const a = ref.v[j], b = ref.v[j + 1], f = (t - ref.t[j]) / (ref.t[j + 1] - ref.t[j]);
    out[i] = fin(a) && fin(b) ? a + (b - a) * f : NaN;
  }
  return out;
}

/**
 * Compares frame-to-frame changes of the run's primary signal with the whole-frame reference, per run scene (each
 * scene may be flipped, so |r| per scene). -> {flag, score (|r| weighted by frames), together (share of the run's
 * moving frames where the reference moves the same way), n, scenes:[{t0,t1,r,n}]} | null (no primary / too short).
 * flag: score >= minScore and together >= minTogether.
 */
export function cameraMotion(run, ref, { minScore = 0.7, minTogether = 0.6, minFrames = 10 } = {}) {
  const t = run?.samples?.t, v = run?.samples?.v;
  if (!t?.length || !ref?.samples?.t?.length) return null;
  const rv = resample(ref.samples, t);
  const scenes = run.scenes?.length ? run.scenes : [{ start_ms: -Infinity, end_ms: Infinity }];
  let wsum = 0, n = 0, moving = 0, agree = 0;
  const per = [];
  for (const s of scenes) {
    const da = [], db = [];
    for (let i = 1; i < t.length; i++) {
      if (t[i - 1] < s.start_ms || t[i] >= s.end_ms) continue;
      const a = v[i] - v[i - 1], b = rv[i] - rv[i - 1];
      if (fin(a) && fin(b)) { da.push(a); db.push(b); }
    }
    if (da.length < 3) continue;
    const r = corr(da, db), sa = sd(da), sb = sd(db), sign = r < 0 ? -1 : 1;
    for (let k = 0; k < da.length; k++) {
      if (!(Math.abs(da[k]) > 0.25 * sa)) continue;
      moving++;
      if (Math.abs(db[k]) > 0.25 * sb && Math.sign(da[k] * db[k]) === sign) agree++;
    }
    wsum += Math.abs(r) * da.length; n += da.length;
    per.push({ t0: s.start_ms, t1: s.end_ms, r, n: da.length });
  }
  if (n < minFrames) return null;
  const score = wsum / n, together = moving ? agree / moving : 0;
  return { flag: score >= minScore && together >= minTogether, score, together, n, scenes: per };
}
function corr(a, b) {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/** Centre of one overlay frame (normalised): mean of its points, else of its box centres, else of the first mask. */
function ovCentre(ov) {
  const pts = ov?.points?.length ? ov.points : ov?.boxes?.length ? ov.boxes.map((b) => [b[0] + b[2] / 2, b[1] + b[3] / 2]) : ov?.masks?.[0] || [];
  if (!pts.length) return null;
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
const finiteOf = (s) => Array.from(s?.v || []).filter(fin);

/**
 * How far the tracked thing actually moved, in frame px (p5..p95 spread). Sources, best first: the raw `raw_px`
 * channel (lk_box, template, lk_two_point), the `centroid_x` / `centroid_y` channels (normalised) x frame size,
 * the overlay frames' centre x frame size. -> {px, low: px < minPx, source} | null (nothing to measure).
 */
export function lowMotion(run, { width, height } = {}, { minPx = 3 } = {}) {
  const ch = run?.channels || {};
  let px = null, source = '';
  if (ch.raw_px && finiteOf(ch.raw_px).length > 1) { px = spread(finiteOf(ch.raw_px)); source = 'raw_px'; }
  else if (width && height && ch.centroid_x && ch.centroid_y && finiteOf(ch.centroid_x).length > 1) {
    px = Math.max(spread(finiteOf(ch.centroid_x)) * width, spread(finiteOf(ch.centroid_y)) * height); source = 'centroid';
  } else if (width && height && run?.frames?.ov?.length) {
    const xs = [], ys = [];
    for (const ov of run.frames.ov) { const c = ovCentre(ov); if (c) { xs.push(c[0] * width); ys.push(c[1] * height); } }
    if (xs.length > 1) { px = Math.max(spread(xs), spread(ys)); source = 'overlay'; }
  }
  return px == null ? null : { px, low: px < minPx, source };
}

/** Times of the turning points of a point list ({at, pos} typed arrays or [{at, pos}]); plateaus count once. */
export function turnTimes(points) {
  const at = points?.at ? Array.from(points.at) : (points || []).map((p) => p.at);
  const pos = points?.pos ? Array.from(points.pos) : (points || []).map((p) => p.pos);
  const out = [];
  let dir = 0, last = 0;   // last index where pos changed direction candidate
  for (let i = 1; i < pos.length; i++) {
    const d = Math.sign(pos[i] - pos[i - 1]);
    if (!d) continue;
    if (dir && d !== dir) out.push(at[last]);
    dir = d; last = i;
  }
  return out;
}

/**
 * Per window ({t0, t1}: the doc's scenes inside the run's range, else the range): turns, strokesPerMin (a stroke =
 * two turns), regularity (1 - CV of the turn intervals that are not idle gaps, 0..1; null below 3 intervals) and
 * idle spans (no turn for more than idleGapMs, window edges included).
 */
export function motionStats(points, windows, { idleGapMs = 2000 } = {}) {
  const turns = turnTimes(points);
  return windows.filter((w) => w.t1 > w.t0).map(({ t0, t1 }) => {
    const ts = turns.filter((x) => x >= t0 && x < t1);
    const edges = [t0, ...ts, t1], idle = [], iv = [];
    for (let i = 1; i < edges.length; i++) {
      const g = edges[i] - edges[i - 1];
      if (g > idleGapMs) idle.push({ t0: edges[i - 1], t1: edges[i] });
      else if (i > 1 && i < edges.length - 1) iv.push(g);
    }
    const mean = iv.reduce((s, x) => s + x, 0) / (iv.length || 1);
    return {
      t0, t1, turns: ts.length, strokesPerMin: (ts.length / 2) / ((t1 - t0) / 60000),
      regularity: iv.length >= 3 && mean > 0 ? Math.max(0, Math.min(1, 1 - sd(iv) / mean)) : null,
      idle, idleMs: idle.reduce((s, x) => s + x.t1 - x.t0, 0),
    };
  });
}

/** Windows for motionStats: scenes [{start_ms, end_ms}] clipped to [a, b); none -> [{a, b}]. */
export function statWindows(scenes, a, b) {
  const w = (scenes || []).map((s) => ({ t0: Math.max(a, s.start_ms), t1: Math.min(b, s.end_ms) })).filter((x) => x.t1 > x.t0);
  return w.length ? w : [{ t0: a, t1: b }];
}
