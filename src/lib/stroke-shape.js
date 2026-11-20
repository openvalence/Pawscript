// stroke-shape.js -- the stroke-shape model (paw-izk). Pure (test/stroke-shape.test.mjs).
// Owner: "doing too many points results in jerky motion, generally you want a max of 1 midpoint, or 1 midpoint and one
// hold point per stroke". The device moves linearly between points, so between two turns (one half-stroke: an in-move
// or an out-move) this emits AT MOST:
//   - one midpoint ('mid'): where the move is farthest off the straight line between the half's ends (slow-then-fast
//     or fast-then-slow), only if that, less how far it strays the other way (slow at both ends is no lopsided move),
//     is at least midThr(sens) (+ one sample's worth of the move) of the half's own amplitude (judged on the smoothed
//     signal, on the group's median shape), strictly between the two
//     levels (the move stays monotonic), at least max(min interval, 15 % of the move) from either end, its two segment
//     speeds at least 25 % apart (else it changes nothing) and neither over the speed cap;
//   - one hold per turn ('hold'): the signal dwells within 6 % of the stroke size (at least 2 pos) of the turn's level
//     for at least holdFrac(sens) of the adjacent half-strokes' mean length (and the device's shortest move): the turn sits at
//     the arrival and the hold where motion resumes, both at the turn's level (a flat rest on the device). A full stroke
//     has at most one hold at the top and one at the bottom; per half-stroke at most a midpoint plus the hold of the
//     turn it leaves.
// Both are decided per GROUP of alike strokes, not per stroke (paw-e82, UNIFORM): near-identical neighbours get the same
// layout, with the midpoint / hold at the group's phase; the layout changes where the motion changes.
// paw-t11b: with fusion's HOW (o.how: lib/fusion-how.js, the fused channel's `how`) the Detail reads how each stroke goes
// from every tracked part instead of re-measuring the one blended signal: a half-stroke fusion described is grouped by its
// TYPE over the whole scene (not only with its neighbours), its hold score is the parts' dwell at the turn (raised by an
// impact there: x (1 + HOW_HOLD.impact x impact)) over holdFrac(sens), where the hold starts / motion resumes from the
// parts, its shape for the midpoint the parts' (the most confident ones), each blended with today's signal measure by the
// evidence's conf (thin evidence: mostly the signal). A half or turn fusion did not describe (no parts, another channel,
// turns the strokes step found elsewhere) keeps today's measure. Turns never move; loops keep one layout per pass.
// Shapes: 'turns' (turns only), 'mid' (+ midpoint), 'hold' (+ midpoint + hold: the default before paw-na9u), 'render' (by render, below: the default), 'free' (the old
// Douglas-Peucker at a tolerance: any number of points, can make the motion jerky). One sensitivity (0..100, default 50)
// drives both thresholds (and Free's tolerance); 50 is conservative: a sine stroke stays two points.

// paw-na9u: 'render' (By render) -- the owner: "shape the curve knowing how it renders, not based on linear estimation". The
// device does not draw straight lines: a move from rest to rest (turn to turn, a hold's edge) comes out as an S, a point
// inside a move is passed through smoothly (renderScript: the generic device model). Per half-stroke the points that make
// that RENDER follow the trace: nothing, one point, or two, each anywhere in time and depth (a mid where the move changes
// speed, a shoulder just before / after a turn: a slow transition), chosen by the rendered error against the trace with a
// price per point (RENDER.price, scaled by the sensitivity and by how well the tracked parts agree on the move's bow); a
// loop's passes share one layout. A shoulder becomes a true flat hold only when the trace there is level within its noise
// (flatTest). Turns never move. paw-6t7d: the speed cap (maxSpeed) is part of the fit, not a filter after it: a fast full-range
// stroke gets the best layout the cap allows (fitted blind and then filtered, every point broke it: a bare triangle wave).
export const SHAPES = ['turns', 'mid', 'hold', 'render', 'free'];
export const SHAPE = Object.freeze({ shape: 'render', sens: 50 });   // paw-na9u: By render is the default ('hold' = the old Detail, one chip away)
export const SHAPE_NAMES = { turns: 'Turns only', mid: '+ Midpoint', hold: '+ Midpoint + Hold', render: 'By render', free: 'Free' };
const fin = Number.isFinite;
const s01 = (sens) => Math.min(1, Math.max(0, (fin(+sens) ? +sens : SHAPE.sens) / 100));
/** Lopsided deviation from the straight line (share of the half's amplitude) a midpoint needs: 0.35 at 0, 0.20 at 50,
 *  0.05 at 100 (a sine half-stroke deviates 0.105 both ways, so it stays two points at any sensitivity). */
export const midThr = (sens) => 0.35 - 0.3 * s01(sens);
/** The dwell a hold needs, as a share of the adjacent half-strokes' mean length: 0.51 / 0.36 / 0.21 (a sine turn dwells 0.32 in
 *  the band; a shoulder of 40 % of the half-stroke is a hold at 50). No length in ms: a fast stroke's shoulder is as real as a
 *  slow one's (an absolute 400 ms used to hide every hold on strokes faster than about 1 per second). */
export const holdFrac = (sens) => 0.51 - 0.3 * s01(sens);
/** Free's Douglas-Peucker tolerance (pos): 30 at 0, 15.5 at 50, 1 at 100. */
export const freeTol = (sens) => 1 + 29 * (1 - s01(sens));
const BAND = 0.06, MIN_BAND = 2, MIN_AMP = 6, EDGE = 0.15, JERK = 0.25;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** A clean {shape, sens} (unknown fields dropped, defaults filled). */
export const shapeClean = (x) => ({ shape: SHAPES.includes(x?.shape) ? x.shape : SHAPE.shape, sens: fin(+x?.sens) ? Math.round(Math.min(100, Math.max(0, +x.sens))) : SHAPE.sens });
/** opts {shape, sens, detail (a Free tolerance that wins over sens), shapes: [{t0, t1, shape, sens}] (later entries win)}
 *  -> (ms) => {shape, sens, tol}: the setting at a time. */
export function shapeAt(o = {}) {
  const b = shapeClean(o), base = { ...b, tol: o.detail > 0 ? +o.detail : freeTol(b.sens) };
  const sp = (Array.isArray(o.shapes) ? o.shapes : []).map((s) => ({ t0: s.t0, t1: s.t1, ...shapeClean(s), tol: freeTol(shapeClean(s).sens) }));
  return (ms) => { for (let j = sp.length - 1; j >= 0; j--) if (ms >= sp[j].t0 && ms < sp[j].t1) return sp[j]; return base; };
}

// ---- the generic device model and the fit by render (paw-na9u) ----
/** N: samples of a half-stroke's shape; price: the rendered error (share of the move, RMS) one more point must buy at
 *  sensitivity 50 (x2 at 0, x0.25 at 100); kmax: points per half-stroke; flatZ: a shoulder is a flat hold when the trace's
 *  slope over it is under flatZ standard errors (and its level within flatZ noise of the turn's); gapMs: a point farther
 *  than this from the next is a rest (the Capstan host's rule); agree: the price x (1 + agree x (1 - the parts' agreement));
 *  knot: a point inside a move is passed at this share of the least-bending speed (calibrated on the Capstan's Kinetic2:
 *  the generic fit's points rendered by Kinetic2 0.045 -> 0.032 RMS of the move, Kinetic2's own best fit 0.030). */
export const RENDER = Object.freeze({ N: 33, price: 0.06, kmax: 2, flatZ: 2, gapMs: 500, agree: 1, knot: 0.7 });
/** Experiments only (experiments/detail-render): price multiplier, agree (0: the parts' agreement ignored), knot (RENDER.knot),
 *  vcap (0: the fit ignores the speed cap and its points that break it are left out afterwards: before paw-6t7d). */
export const RENDER_DEBUG = { price: 1, agree: 1, knot: RENDER.knot, vcap: 1 };   // vcap 0: the fit ignores the speed cap (paw-6t7d's before)
export const RENDER_MODEL = 'generic smooth device: a move from rest to rest is an S (smoothstep), a point inside a move is passed smoothly';
const priceOf = (sens) => RENDER.price * RENDER_DEBUG.price * 2 ** (1 - s01(sens) * 3);   // 0: x2, 50: x0.71, 100: x0.25
/** Velocities at a rest-to-rest leg's knots (x ascending, its ends at rest): the clamped cubic spline (least bending), each
 *  limited so the leg stays monotone (Fritsch-Carlson: at most 3 x the smaller chord slope beside it, 0 next to a flat),
 *  x RENDER.knot (the planner passes an inner point slower than the spline would). */
function legVel(x, y) {
  const n = x.length, v = new Float64Array(n), m = n - 2;
  if (m < 1) return v;
  const B = new Float64Array(m), C = new Float64Array(m), D = new Float64Array(m);
  for (let k = 1; k < n - 1; k++) { const h0 = x[k] - x[k - 1], h1 = x[k + 1] - x[k]; B[k - 1] = 2 / h0 + 2 / h1; C[k - 1] = 1 / h1; D[k - 1] = 3 * ((y[k] - y[k - 1]) / (h0 * h0) + (y[k + 1] - y[k]) / (h1 * h1)); }
  for (let i = 1; i < m; i++) { const w = 1 / (x[i] - x[i - 1]) / B[i - 1]; B[i] -= w * C[i - 1]; D[i] -= w * D[i - 1]; }
  for (let i = m - 1; i >= 0; i--) v[i + 1] = (D[i] - (i + 1 < m ? C[i] * v[i + 2] : 0)) / B[i];
  for (let k = 1; k < n - 1; k++) {
    const a = (y[k] - y[k - 1]) / (x[k] - x[k - 1]), b = (y[k + 1] - y[k]) / (x[k + 1] - x[k]);
    v[k] = a * b <= 0 ? 0 : RENDER_DEBUG.knot * Math.sign(a) * Math.min(Math.abs(v[k]), 3 * Math.min(Math.abs(a), Math.abs(b)));
  }
  return v;
}
/** The leg (x, y, v) at q (cubic Hermite between its knots). */
function legAt(x, y, v, q) {
  let k = 0;
  while (k + 2 < x.length && q > x[k + 1]) k++;
  const h = x[k + 1] - x[k], s = Math.min(1, Math.max(0, (q - x[k]) / h)), s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * y[k] + (s3 - 2 * s2 + s) * h * v[k] + (-2 * s3 + 3 * s2) * y[k + 1] + (s3 - s2) * h * v[k + 1];
}
/** The generic device model: what a smooth device draws from points [{at, pos}] at times ts (ascending or not). A rest at
 *  the first / last point, a reversal, a flat's edge, and before a gap over RENDER.gapMs; between two rests one smooth leg
 *  through its points (legVel). Checked against the Capstan's own planner (Kinetic2) in experiments/detail-render. */
export function renderScript(pts, ts) {
  const n = pts.length, out = new Float64Array(ts.length);
  if (!n) return out.fill(NaN);
  const rest = [0];
  for (let j = 1; j < n - 1; j++) { const d0 = pts[j].pos - pts[j - 1].pos, d1 = pts[j + 1].pos - pts[j].pos; if (!(d0 * d1 > 0) || pts[j + 1].at - pts[j].at > RENDER.gapMs) rest.push(j); }
  if (n > 1) rest.push(n - 1);
  const legs = [];
  for (let q = 0; q + 1 < rest.length; q++) { const s = pts.slice(rest[q], rest[q + 1] + 1), x = s.map((p) => p.at), y = s.map((p) => p.pos); legs.push({ x0: x[0], x1: x[x.length - 1], x, y, v: legVel(x, y) }); }
  ts.forEach((t, i) => {
    if (!(t > pts[0].at)) { out[i] = pts[0].pos; return; }
    if (t >= pts[n - 1].at) { out[i] = pts[n - 1].pos; return; }
    let lo = 0, hi = legs.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (legs[m].x1 < t) lo = m + 1; else hi = m; }
    const L = legs[lo];
    out[i] = legAt(L.x, L.y, L.v, t);
  });
  return out;
}
/** A half-stroke's shape on [0, 1] (y 0 at its first turn, 1 at the next; target: RENDER.N samples at u = k / (N - 1)) and
 *  the knots [[u, d]] inside -> the rendered RMS error. */
function legErr(target, knots) {
  const N = target.length, x = [0, ...knots.map((k) => k[0]), 1], y = [0, ...knots.map((k) => k[1]), 1], v = legVel(x, y);
  let e = 0;
  for (let k = 1; k < N - 1; k++) { const d = legAt(x, y, v, k / (N - 1)) - target[k]; e += d * d; }
  return Math.sqrt(e / (N - 2));
}
/**
 * The points of one half-stroke chosen by render: target (its shape, legErr), o {du (the shortest gap between two points,
 * share of the half), price (error one more point must buy), kmax, vmax (paw-6t7d: the fastest a segment may go, share of the
 * move per share of the half: the speed cap; 0 = none)} -> {knots: [[u, d]] (0 <= d <= 1, ascending), err,
 * err0 (turns only), errs [per count]}. Coarse grid then a pattern search; deterministic.
 */
const FITS = new Map();   // fitLeg's answers (a recompose fits the same strokes again): key = its inputs
export function fitLeg(target, o = {}) {
  const key = `${Array.from(target, (x) => Math.round(x * 1e4)).join(',')}|${o.du}|${o.price}|${o.kmax}|${o.vmax}`;
  let hit = FITS.get(key);
  if (!hit) { if (FITS.size > 50000) FITS.clear(); hit = fitLegNow(target, o); FITS.set(key, hit); }   // ponytail: cleared whole when full, an LRU if that ever shows
  return { ...hit, knots: hit.knots.map((k) => k.slice()) };
}
function fitLegNow(target, o) {
  const du = Math.max(0.02, o.du ?? 0.08), price = o.price ?? RENDER.price, kmax = o.kmax ?? RENDER.kmax, vmax = o.vmax > 0 ? o.vmax : Infinity;
  const ok = (ks) => { let pu = 0, pd = 0; for (let q = 0; q < ks.length; q++) { const [u, d] = ks[q]; if (u - pu < du - 1e-9 || d < pd - 1e-9 || d > 1 || d < 0 || d - pd > vmax * (u - pu) + 1e-9) return false; pu = u; pd = d; } return 1 - pu >= du - 1e-9 && 1 - pd <= vmax * (1 - pu) + 1e-9; };
  const refine = (ks, e) => {
    for (let st = 0.05; st >= 0.0015; st /= 2) {
      for (let moved = true, guard = 0; moved && guard < 40; guard++) {
        moved = false;
        for (let q = 0; q < ks.length; q++) for (const c of [0, 1]) for (const s of [-st, st]) {
          const tr = ks.map((k) => k.slice()); tr[q][c] += s;
          if (c && Math.abs(tr[q][1] - Math.round(tr[q][1])) < 1e-9) tr[q][1] = Math.round(tr[q][1]);   // (a level exactly at a turn's)
          if (!ok(tr)) continue;
          const te = legErr(target, tr);
          if (te < e - 1e-12) { ks = tr; e = te; moved = true; }
        }
      }
    }
    return [ks, e];
  };
  const add = (base) => {   // the best extra knot on a grid, then everything refined
    let best = null, be = Infinity;
    for (let iu = 0; du + iu * 0.1 <= 1 - du + 1e-9; iu++) for (let id = 0; id <= 10; id++) {   // (coarse: the refine below goes from 0.05)
      const ks = [...base, [du + iu * 0.1, id / 10]].sort((a, b) => a[0] - b[0]);
      if (!ok(ks)) continue;
      const e = legErr(target, ks);
      if (e < be - 1e-12) { be = e; best = ks; }
    }
    return best ? refine(best, be) : null;
  };
  const errs = [legErr(target, [])];
  let cur = [], ce = errs[0], keep = [], ke = errs[0];
  for (let k = 1; k <= kmax; k++) {
    const r = add(cur);
    if (!r) break;
    [cur, ce] = r;
    errs.push(ce);
    if (ce + k * price < ke + keep.length * price - 1e-12) { keep = cur.map((x) => x.slice()); ke = ce; }
  }
  return { knots: keep, err: ke, err0: errs[0], errs };
}
/** Is a dwell level? The fitted point's slope toward the turn (pos/s) against its standard error from the trace's noise over
 *  the dwell: ts (ms) its samples there, sigma the noise of one sample (pos, at least 1: the script's own resolution). Level
 *  when |slope| < RENDER.flatZ standard errors and the level it leaves within flatZ x sigma of the turn's (a snap moves a
 *  point at most that far), with at least two samples. -> {flat, z}. */
export function flatTest(ts, slope, sigma) {
  const n = ts.length;
  if (n < 2) return { flat: false, z: Infinity };
  const mu = ts.reduce((q, x) => q + x, 0) / n;
  let sxx = 0;
  for (const x of ts) sxx += ((x - mu) / 1000) ** 2;
  const z = sxx > 0 ? Math.abs(slope) / (Math.max(1, sigma) / Math.sqrt(sxx)) : Infinity;
  const drop = (Math.abs(slope) * (ts[n - 1] - ts[0])) / 1000;
  return { flat: z < RENDER.flatZ && drop <= RENDER.flatZ * Math.max(1, sigma), z };
}

function rdp(t, y, a, b, eps, keep) {
  if (b - a < 2) return;
  let best = -1, bd = eps;
  for (let i = a + 1; i < b; i++) { const c = y[a] + ((y[b] - y[a]) * (t[i] - t[a])) / (t[b] - t[a] || 1), d = Math.abs(y[i] - c); if (d > bd) { bd = d; best = i; } }
  if (best < 0) return;
  keep[best] = 1; rdp(t, y, a, best, eps, keep); rdp(t, y, best, b, eps, keep);
}
export const PROF = 15;   // a move's shape is sampled at u = 1/16 .. 15/16
/** The shape of the move a..b on f (fa -> fb): its deviation from the straight line (share of the move, > 0 = ahead of
 *  the line: fast then slow) at u = k / 16, k = 1..15 (linear between samples), or null (no time / no move). Whole-curve,
 *  so two alike strokes compare alike even where noise moves the single farthest sample from one end to the other. */
function profile(t, f, a, b, fa, fb) {
  const T = t[b] - t[a], A = fb - fa;
  if (!(T > 0) || !A || b - a < 1) return null;
  const out = new Float64Array(PROF);
  let i = a;
  for (let k = 0; k < PROF; k++) {
    const u = (k + 1) / (PROF + 1), x = t[a] + u * T;
    while (i + 1 < b && t[i + 1] <= x) i++;
    const y = f[i] + ((f[i + 1] - f[i]) * (x - t[i])) / (t[i + 1] - t[i] || 1);
    out[k] = (y - fa) / A - u;
  }
  return out;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Uniform detail (paw-e82). Owner: "it should try and be uniform if motion is super similar, accounting for
 *  differences, dynamic but not random". Consecutive half-strokes whose motion is alike (duration and amplitude within
 *  dur / amp of the group's median for that direction, shape (the whole move's deviation from the straight line, RMS)
 *  within `shape` of the group's median shape) form a group; the midpoint (per direction) and the hold (per turn kind,
 *  top / bottom) are decided once per group: the midpoint on the group's median shape (where it is farthest off the
 *  line, how far: one phase and one relative level for every member, scaled to its own turns), the hold from the median
 *  of its members' dwells (1 = exactly at the threshold), at the group's median phase. Never a member's own. A group whose
 *  median is within `band` of the threshold keeps the previous group's decision (hysteresis: one borderline stroke never
 *  flips the layout), or with none before it the simpler layout. */
export const UNIFORM = Object.freeze({ dur: 0.35, amp: 0.35, shape: 0.12, band: 0.2 });
const HOLD_BAND = 0.1;   // a hold's borderline is narrower: a shoulder (0.45 of the stroke) is on, a sine turn (0.31) off
/** paw-t11b: how much an impact at a turn (fusion-how.js, 0..1) raises the parts' dwell there (the same band dwell as the
 *  signal's, per part) toward a hold: an impact with a short rest is a hold, one with none is not. */
export const HOW_HOLD = Object.freeze({ impact: 0.5 });
const decide = (score, prev, band = UNIFORM.band) => (score >= 1 + band ? true : score <= 1 - band ? false : prev ?? false);   // borderline, nothing before: the simpler layout
/** Pointwise median of profiles; the RMS distance between two. */
export const medProf = (ps) => Float64Array.from({ length: PROF }, (_, k) => median(ps.map((q) => q[k])));
const rms = (x, y) => { let s = 0; for (let k = 0; k < PROF; k++) s += (x[k] - y[k]) ** 2; return Math.sqrt(s / PROF); };
/** A move's shape pr (over its own [0, 1]) re-cut to [u0, u1] of it (before 0 / after 1: resting at its ends) -> the shape
 *  there, or null. */
export function subProf(pr, u0, u1) {
  const yk = (q) => (q < 0 ? 0 : q >= PROF ? 1 : (q + 1) / (PROF + 1) + pr[q]);
  const y = (u) => { if (u <= 0) return 0; if (u >= 1) return 1; const x = u * (PROF + 1) - 1, k = Math.floor(x); return yk(k) + (yk(k + 1) - yk(k)) * (x - k); };
  const y0 = y(u0), y1 = y(u1);
  if (!(u1 > u0) || !(Math.abs(y1 - y0) > 1e-6)) return null;
  return Float64Array.from({ length: PROF }, (_, k) => { const v = (k + 1) / (PROF + 1); return (y(u0 + v * (u1 - u0)) - y0) / (y1 - y0) - v; });
}
const nearest = (t, lo, hi, want) => { let b = -1; for (let i = lo; i <= hi; i++) if (b < 0 || Math.abs(t[i] - want) < Math.abs(t[b] - want)) b = i; return b; };

/** Repeated pictures (paw-otoh, paw-w7wr). Where the video shows exactly the same pictures again (a loop: the app's
 *  repeats, features/timeline/repeats.js), the half-strokes that cover the same pictures, the same way, are ONE stroke:
 *  their layout (midpoint yes / no and the picture it sits on, hold yes / no and the picture where motion resumes) is
 *  decided once from all the passes pooled and put on that picture in each pass, so every pass of a loop gets the
 *  identical layout. Their levels are never made equal (a loop often holds 2-3 strokes; folding it costs accuracy).
 *  Two halves are the same stroke when they share at least `share` of the smaller one's repeated pictures (and `min`). */
export const PICTURES = Object.freeze({ share: 0.5, min: 2 });
/** halves [{j, dir}] (anchors: their sample indices by j), pic per sample -> Map half j -> 'P<class>' for the halves
 *  that share their pictures with another half (union of pairs), nothing else. */
function picClasses(halves, anchors, pic) {
  const out = new Map();
  if (!pic || halves.length < 2) return out;
  const sets = halves.map((h) => { const S = new Set(); for (let i = anchors[h.j]; i <= anchors[h.j + 1]; i++) if (pic[i] >= 0) S.add(pic[i]); return S; });
  const by = new Map();   // picture -> halves showing it
  sets.forEach((S, q) => S.forEach((x) => { if (!by.has(x)) by.set(x, []); by.get(x).push(q); }));
  const up = halves.map((_, q) => q), root = (q) => { while (up[q] !== q) q = up[q] = up[up[q]]; return q; };
  for (let q = 0; q < halves.length; q++) {
    const n = new Map();
    for (const x of sets[q]) for (const r of by.get(x)) if (r > q && halves[r].dir === halves[q].dir) n.set(r, (n.get(r) || 0) + 1);
    for (const [r, c] of n) if (c >= PICTURES.min && c >= PICTURES.share * Math.min(sets[q].size, sets[r].size)) up[root(r)] = root(q);
  }
  const size = new Map();
  halves.forEach((_, q) => size.set(root(q), (size.get(root(q)) || 0) + 1));
  halves.forEach((h, q) => { if (size.get(root(q)) > 1) out.set(h.j, 'P' + root(q)); });
  return out;
}

/**
 * The points of one gap-free piece under the stroke-shape model. t: ms ascending, p: pos per sample, anchors: sorted
 * sample indices that are always points (the turns and the piece's ends), turn: Set / Map of the anchors that are turns,
 * at: shapeAt(...), o: {minIntervalMs, maxSpeed, flat (the series a dwell and a midpoint's shape are judged on: default
 * p; strokes.js passes the smoothed signal before its drift is taken out, which tilts plateaus and moves), quant (default
 * true: samples on a frame grid, so a midpoint must also beat a turn one sample off; false for exact points), pic (per
 * sample: the id of its picture where the video repeats it exactly, else -1 / undefined: see PICTURES), how (paw-t11b:
 * fusion's HOW {turns: [{t, dwell, fs, fe, impact, conf}], halves: [{t0, t1, m0, m1, prof, conf, type}]} by time, matched
 * to these turns within 1.5 samples: see the header)}.
 * -> [{i, pos, why, k?, u?, df?}] in time order: each anchor ('turn' | 'end'; k = its own index, i = where the point
 * goes: a held turn's arrival), 'hold', 'mid' (u / df: its phase and share of the move from the point before it to the
 * next turn, the group's: exact placement for callers off the sample grid; i = the nearest sample; at?: its exact time
 * when it sits on a repeated picture), 'detail' (Free).
 */
export function shapeFit(t, p, anchors, turn, at, o = {}) {
  const n = anchors.length, minIv = Math.max(1, o.minIntervalMs ?? 60), maxSpeed = o.maxSpeed ?? 0, quant = o.quant !== false;
  const arr = anchors.slice(), dep = anchors.slice(), lvl = anchors.map((i) => p[i]), f = o.flat || p;
  const isT = (j) => j >= 0 && j < n && turn.has(anchors[j]);
  // paw-t11b: fusion's HOW, matched to these turns by time
  const how = o.how?.turns?.length ? o.how : null, tolH = 1.5 * ((t[t.length - 1] - t[0]) / Math.max(1, t.length - 1) || 1000 / 30);
  const near = (list, key, ms) => { let lo = 0, hi = list.length - 1; if (hi < 0) return null; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (list[m][key] <= ms) lo = m; else hi = m; } const r = Math.abs(list[lo][key] - ms) <= Math.abs(list[hi][key] - ms) ? list[lo] : list[hi]; return Math.abs(r[key] - ms) <= tolH ? r : null; };
  const howTurn = (k) => (how ? near(how.turns, 't', t[k]) : null);
  const howHalf = (a, b) => { const r = how?.halves?.length ? near(how.halves, 't0', t[a]) : null; return r && Math.abs(r.t1 - t[b]) <= tolH && r.m1 > r.m0 ? r : null; };
  const isType = (g) => typeof g === 'string' && g.startsWith('T');
  // the half-strokes (turn to turn) and their groups of alike motion
  const halves = [];
  for (let j = 0; j + 1 < n; j++) {
    if (!isT(j) || !isT(j + 1)) continue;
    const a = anchors[j], b = anchors[j + 1], S = at((t[a] + t[b]) / 2);
    halves.push({ j, T: t[b] - t[a], A: Math.abs(f[b] - f[a]), dir: Math.sign(p[b] - p[a]), prof: profile(t, f, a, b, f[a], f[b]) || new Float64Array(PROF), key: `${S.shape}|${S.sens}`, rec: howHalf(a, b) });
  }
  // where the video repeats its pictures (a loop): the strokes that cover the same pictures are one stroke (PICTURES)
  const same = picClasses(halves, anchors, o.pic);
  // grouped per direction (an odd in-move never splits the out-moves); a lone outlier inside a group takes that group's
  // layout (it does not move the group's medians) and the group goes on after it: one odd stroke never breaks the pattern
  const gOf = new Map();   // half j -> its group
  let gid = 0;
  for (const dir of [1, -1]) {
    const seq = halves.filter((h) => h.dir === dir);
    let g = null, lastJ = -9;
    const fits = (h) => {
      if (!g || h.j !== lastJ + 2 || h.key !== g[0].key) return false;
      const near = (k, tol) => { const m = median(g.map((x) => x[k])); return Math.abs(h[k] - m) <= tol * Math.max(Math.abs(h[k]), Math.abs(m)); };
      return near('T', UNIFORM.dur) && near('A', UNIFORM.amp) && rms(h.prof, medProf(g.map((x) => x.prof))) <= UNIFORM.shape;
    };
    seq.forEach((h, q) => {
      if (fits(h)) { g.push(h); gOf.set(h.j, g.id); lastJ = h.j; return; }
      const nx = seq[q + 1];
      if (g && h.j === lastJ + 2 && nx?.j === h.j + 2 && (lastJ = h.j, fits(nx))) { gOf.set(h.j, g.id); return; }
      g = [h]; g.id = gid++; gOf.set(h.j, g.id); lastJ = h.j;
    });
  }
  for (const h of halves) if (h.rec?.conf >= 0.5) gOf.set(h.j, `T${h.rec.type}|${h.key}`);   // paw-t11b: fusion's type over the whole scene (where its evidence is not thin)
  for (const [j, c] of same) gOf.set(j, c);   // the same pictures: one group, whatever the likeness grouping said
  const pic = o.pic, picOf = (i) => (pic && pic[i] >= 0 ? pic[i] : -1);
  /** The picture most members show at their own sample (idx(x) -> sample index or -1), or -1 (no repeated picture). */
  const modePic = (mem, idx) => { const c = new Map(); for (const x of mem) { const q = picOf(idx(x)); if (q >= 0) c.set(q, (c.get(q) || 0) + 1); } let best = -1, bn = 1; for (const [q, nq] of c) if (nq > bn) { best = q; bn = nq; } return best; };
  /** The sample of picture q in [lo, hi] nearest to time want, or -1. */
  const findPic = (q, lo, hi, want) => { let b = -1; for (let i = Math.max(0, lo); i <= hi; i++) if (picOf(i) === q && (b < 0 || Math.abs(t[i] - want) < Math.abs(t[b] - want))) b = i; return b; };
  const prev = {};   // the previous group's decision per hold kind / midpoint direction (hysteresis)
  // holds: a dwell at a turn's level, measured per turn, decided per group and turn kind (a turn goes with the half it leaves)
  const dw = [];
  for (let j = 0; j < n; j++) {
    const k = anchors[j];
    if (!turn.has(k) || at(t[k]).shape !== 'hold') continue;
    const S = at(t[k]), amps = [], durs = [];
    if (j > 0) { amps.push(Math.abs(f[k] - f[anchors[j - 1]])); durs.push(t[k] - t[anchors[j - 1]]); }
    if (j + 1 < n) { amps.push(Math.abs(f[anchors[j + 1]] - f[k])); durs.push(t[anchors[j + 1]] - t[k]); }
    if (!amps.length) continue;
    // the band: 6 % of the stroke size, at least 2 pos (in f's units: 2 % of the larger side's size when f is not pos)
    const band = Math.max(f === p ? MIN_BAND : 0.02 * Math.max(...amps), BAND * mean(amps)), lo = j > 0 ? anchors[j - 1] : -1, hi = j + 1 < n ? anchors[j + 1] : t.length;
    let s = k, e = k;
    while (s - 1 > lo && Math.abs(f[s - 1] - f[k]) <= band) s--;
    while (e + 1 < hi && Math.abs(f[e + 1] - f[k]) <= band) e++;
    while (s < k && lo >= 0 && t[s] - t[lo] < minIv) s++;   // the moves either side stay renderable
    while (e > k && hi < t.length && t[hi] - t[e] < minIv) e--;
    const dur = t[e] - t[s], Tb = durs[0], Ta = durs[durs.length - 1];
    const d = { j, k, hi, Tb, Ta, dur, fs: (t[k] - t[s]) / Tb, fe: (t[e] - t[k]) / Ta, g: gOf.get(j) ?? gOf.get(j - 1) ?? `t${j}`,
      kind: (j > 0 ? p[k] > p[anchors[j - 1]] : p[k] < p[anchors[j + 1]]) ? 'top' : 'bottom',
      score: dur >= minIv ? (dur + (quant ? 0.5 * dur / (e - s) : 0)) / (holdFrac(S.sens) * mean(durs)) : 0 };   // on a frame grid n samples in the band dwell n frames, not n - 1
    // paw-t11b: the parts' dwell (an impact raises it), where they rest, blended with the signal's by the evidence's conf
    const rec = howTurn(k);
    if (rec) {
      const c = Math.min(1, Math.max(0, rec.conf || 0));
      d.score = c * ((rec.dwell * (1 + HOW_HOLD.impact * (rec.impact || 0))) / holdFrac(S.sens)) + (1 - c) * d.score;
      if (rec.dwell > 0) { d.fs = c * rec.fs + (1 - c) * d.fs; d.fe = c * rec.fe + (1 - c) * d.fe; d.dur = Math.max(d.dur, 1); }
      d.how = { c: rec.dwell > 0 ? c : 0 };
    }
    dw.push(d);
  }
  const holdPlan = new Map();
  for (const d of dw) {
    const id = `${d.g}|${d.kind}`;
    if (holdPlan.has(id)) continue;
    // (a fusion type is not a neighbour of the group before it: no hysteresis across types, a borderline type stays plain)
    const mem = dw.filter((x) => x.g === d.g && x.kind === d.kind), held = mem.filter((x) => x.dur > 0), on = decide(median(mem.map((x) => x.score)), isType(d.g) ? undefined : prev['h' + d.kind], HOLD_BAND);
    prev['h' + d.kind] = on;
    const plan = on && held.length ? { fs: median(held.map((x) => x.fs)), fe: median(held.map((x) => x.fe)) } : null;
    // one stroke of a loop: motion resumes at the same picture in every pass
    if (plan && typeof d.g === 'string' && d.g.startsWith('P')) plan.pic = modePic(mem, (x) => nearest(t, x.k, Math.min(x.hi, t.length) - 1, t[x.k] + plan.fe * x.Ta));
    holdPlan.set(id, plan);
  }
  for (const d of dw) {   // in time order: a hold never reaches back past the previous one
    const P = holdPlan.get(`${d.g}|${d.kind}`), j = d.j, k = d.k;
    if (!P) continue;
    const lo = j > 0 ? dep[j - 1] : -1;
    // paw-t11b: a stroke the parts describe well rests where its parts rest (the type decided yes; where the rest falls
    // around this turn is measured, not the type's median: the turn sits anywhere inside a flat rest)
    const own = d.how && d.how.c >= 0.5, fs = own ? d.fs : P.fs, fe = own ? d.fe : P.fe;
    let s = nearest(t, lo + 1, k, t[k] - fs * d.Tb), e = nearest(t, k, Math.min(d.hi, t.length) - 1, t[k] + fe * d.Ta);
    if (P.pic >= 0) { const e2 = findPic(P.pic, k, Math.min(d.hi, t.length) - 1, t[e]); if (e2 >= 0) e = e2; }
    while (s < k && lo >= 0 && t[s] - t[lo] < minIv) s++;
    while (e > k && d.hi < t.length && t[d.hi] - t[e] < minIv) e--;
    if (d.how && maxSpeed > 0) {   // ... and leaves the moves either side under the speed cap (else the turn's depth would be clamped)
      const fast = (a, b, pa, pb) => (1000 * Math.abs(pb - pa)) / Math.max(1e-9, t[b] - t[a]) > maxSpeed;
      while (s < k && lo >= 0 && fast(lo, s, lvl[j - 1], lvl[j])) s++;
      while (e > k && d.hi < t.length && j + 1 < n && fast(e, anchors[j + 1], lvl[j], lvl[j + 1])) e--;
    }
    if (t[e] - t[s] < minIv) continue;
    arr[j] = s; dep[j] = e;
  }
  // midpoints: decided per group and direction on the group's median shape of the moves left after the holds; ONE layout
  // (paw-otoh): the midpoint at the group's phase and relative level on every member, scaled to its own two turns, never
  // a member's own (its farthest sample jumps from one end of the move to the other with noise)
  const mv = [];
  for (const h of halves) {
    const j = h.j, a = dep[j], b = arr[j + 1], S = at((t[a] + t[b]) / 2), pa = lvl[j], pb = lvl[j + 1];
    if (S.shape === 'turns' || S.shape === 'free' || S.shape === 'render' || b - a < 2 || Math.abs(pb - pa) < MIN_AMP) continue;
    let pr = profile(t, f, a, b, f[anchors[j]], f[anchors[j + 1]]);
    // paw-t11b: the parts' shape of this move (fusion's, over its move between the rests: re-cut to this move), by conf
    const r = h.rec, hp = r ? subProf(r.prof, (t[a] - r.m0) / (r.m1 - r.m0), (t[b] - r.m0) / (r.m1 - r.m0)) : null;
    if (hp) { const c = Math.min(1, Math.max(0, r.conf || 0)); pr = pr ? pr.map((x, k) => c * hp[k] + (1 - c) * x) : hp; }
    if (pr) mv.push({ j, a, b, pa, pb, pr, S, id: gOf.get(j), dir: h.dir, c: hp ? Math.min(1, Math.max(0, r.conf || 0)) : 0 });
  }
  const midAt = new Map(), done = new Set();
  for (const m of mv) {
    if (done.has(m.id)) continue;
    done.add(m.id);
    const mem = mv.filter((x) => x.id === m.id), D = medProf(mem.map((x) => x.pr));
    let k = -1;   // where the group's shape is farthest off the line (15 % of the move clear of either end)
    for (let q = 0; q < PROF; q++) { const u = (q + 1) / (PROF + 1); if (u >= EDGE && u <= 1 - EDGE && (k < 0 || Math.abs(D[q]) > Math.abs(D[k]))) k = q; }
    const u = (k + 1) / (PROF + 1), df = u + D[k], v1 = df / u, v2 = (1 - df) / (1 - u);
    let opp = 0;   // the other way off the line: slow at both ends (an S, a sine) is not lopsided, one midpoint would make it so
    // (a fusion type's shape: only inside the same 15 % margins, its ends are a frame's turn timing, not the move)
    for (let q = 0; q < PROF; q++) { const u = (q + 1) / (PROF + 1); if (D[q] * D[k] < 0 && (!isType(m.id) || (u >= EDGE && u <= 1 - EDGE))) opp = Math.max(opp, Math.abs(D[q])); }
    const fair = df > 0 && df < 1 && Math.abs(v1 - v2) >= JERK * Math.max(v1, v2);   // strictly between the levels; alike speeds add nothing
    // (the frame grid's one-sample error: fusion's shape is pooled from the parts between sub-frame turns, so by its conf less)
    const score = fair ? (Math.abs(D[k]) - opp) / (midThr(m.S.sens) + (quant ? median(mem.map((x) => (1 - x.c) / (x.b - x.a))) : 0)) : 0;
    const on = decide(score, isType(m.id) ? undefined : prev['m' + m.dir]);
    prev['m' + m.dir] = on;
    if (!on) continue;
    // one stroke of a loop: the midpoint on the same picture in every pass (its time there, the group's relative level)
    const loopPic = typeof m.id === 'string' && m.id.startsWith('P') ? modePic(mem, (x) => nearest(t, x.a + 1, x.b - 1, t[x.a] + u * (t[x.b] - t[x.a]))) : -1;
    for (const x of mem) {
      const T = t[x.b] - t[x.a], edge = Math.max(minIv, EDGE * T), A = x.pb - x.pa, ip = loopPic >= 0 ? findPic(loopPic, x.a + 1, x.b - 1, t[x.a] + u * T) : -1;
      const ux = ip >= 0 ? (t[ip] - t[x.a]) / T : u;
      if (ux * T < edge || (1 - ux) * T < edge) continue;   // too short to render it: this member stays plain
      if (maxSpeed > 0 && 1000 * Math.max(Math.abs(df * A) / (ux * T), Math.abs((1 - df) * A) / ((1 - ux) * T)) > maxSpeed) continue;   // over the speed cap
      const i = ip >= 0 ? ip : nearest(t, x.a + 1, x.b - 1, t[x.a] + u * T);
      if (i > x.a && i < x.b) midAt.set(x.j, { i, pos: x.pa + df * A, u: ux, df, ...(ip >= 0 ? { at: t[ip] } : {}) });
    }
  }
  const renderAt = renderPlan(t, p, anchors, halves, gOf, at, lvl, howTurn, { minIv, maxSpeed, log: o.fitLog, raw: o.raw, turnAt: o.turnAt });
  const out = [];
  for (let j = 0; j < n; j++) {
    const k = anchors[j];
    out.push({ i: arr[j], pos: lvl[j], why: turn.has(k) ? 'turn' : 'end', k, ...(renderAt.capped?.has(j) ? { cap: true } : {}) });   // cap: the speed cap cost the half from here its shape (paw-6t7d)
    if (renderAt.has(j)) { out.push(...renderAt.get(j)); continue; }
    if (dep[j] !== arr[j]) out.push({ i: dep[j], pos: lvl[j], why: 'hold' });
    if (j + 1 >= n) break;
    const a = dep[j], b = arr[j + 1];
    if (b - a < 2 || !isT(j) || !isT(j + 1)) continue;   // only between two turns (an end is a partial move)
    const S = at((t[a] + t[b]) / 2);
    if (S.shape === 'free') {
      const keep = new Uint8Array(t.length);
      rdp(t, p, a, b, S.tol, keep);
      for (let i = a + 1; i < b; i++) if (keep[i]) out.push({ i, pos: p[i], why: 'detail' });
    } else if (midAt.has(j)) out.push({ ...midAt.get(j), why: 'mid' });
  }
  return out;
}

/** A turn between samples: the parabola through sample i and its neighbours -> {t, y} of its vertex (at most half a sample off). */
const vtx = (t, p, i) => { if (i < 1 || i + 1 >= p.length) return { t: t[i], y: p[i] }; const den = p[i - 1] - 2 * p[i] + p[i + 1], d = Math.abs(den) < 1e-12 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (p[i - 1] - p[i + 1])) / den)); return { t: t[i] + d * (d > 0 ? t[i + 1] - t[i] : t[i] - t[i - 1]), y: p[i] - 0.25 * (p[i - 1] - p[i + 1]) * d }; };
/** f at time x on samples (t ascending, linear; clamped to the ends). */
const lin = (t, f, x) => { let lo = 0, hi = t.length - 1; if (x <= t[0]) return f[0]; if (x >= t[hi]) return f[hi]; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; } return f[lo] + ((f[hi] - f[lo]) * (x - t[lo])) / (t[hi] - t[lo] || 1); };
/**
 * paw-na9u: the 'render' halves of shapeFit. Each half-stroke's shape (the trace over it on [0, 1], between its turns at
 * their final times) fitted by fitLeg at the sensitivity's price x (1 + agree x (1 - the parts' agreement on its bow,
 * fusion's HOW)); a loop's passes (gOf 'P' groups) share one fit on their median. A point next to a turn ends up a flat hold
 * only when flatTest says the trace from it to the turn is level within its noise, else it is a shoulder (a slow
 * transition, its slope kept); a point that lands closer than the shortest interval or over the speed cap is left out.
 * -> Map half j -> [{i, pos, why: 'mid' | 'shoulder' | 'hold', u, df (of the turn-to-turn move), rel: 'turns', at, by (the
 * parts that say it)}], + .capped (Set of the halves j whose shape the speed cap limited). o.log: per half (per loop group)
 * {j, n, err0, err, errs, agree, knots, capped?, points: [{u, d, why, slope (pos/s), veto?: 'gap' | 'speed'}]}.
 */
function renderPlan(t, p0, anchors, halves, gOf, at, lvl0, howTurn, o) {
  const p = o.raw || p0, lvl = o.raw ? anchors.map((i) => p[i]) : lvl0;   // the shape from the depth before it is kept inside 0..100
  const res = new Map(), N = RENDER.N, mine = halves.filter((h) => at((t[anchors[h.j]] + t[anchors[h.j + 1]]) / 2).shape === 'render');
  res.capped = new Set();
  if (!mine.length) return res;
  // the trace's noise per sample (pos): second differences, robust
  const d2 = [];
  for (let i = 1; i + 1 < p.length; i++) d2.push(Math.abs(p[i + 1] - 2 * p[i] + p[i - 1]));
  const sig = Math.max(0.1, (1.4826 * median(d2.length ? d2 : [0])) / Math.sqrt(6));
  const mem = mine.map((h) => {
    // the turns where the points put them (o.turnAt: the strokes step's timing, the given points' times), else between samples
    const j = h.j, a = anchors[j], b = anchors[j + 1], va = o.turnAt?.has(a) ? { t: o.turnAt.get(a), y: p[a] } : vtx(t, p, a), vb = o.turnAt?.has(b) ? { t: o.turnAt.get(b), y: p[b] } : vtx(t, p, b), ta = va.t, T = vb.t - va.t, pa = va.y, pb = vb.y, A = pb - pa;
    if (Math.abs(lvl0[j + 1] - lvl0[j]) < MIN_AMP || !(Math.abs(A) > 1e-9) || b - a < 2 || !(T > 0)) return null;
    const y = Float64Array.from({ length: N }, (_, k) => (lin(t, p, ta + (k / (N - 1)) * T) - pa) / A);
    // (the target is the fused trace itself: the parts' consensus shape, fusion's HOW, was a worse target against the synthetic
    // truth, experiments/detail-render RESULTS.md; their agreement on the bow scales the price)
    const r = h.rec;
    return { j, a, b, ta, T, pa, pb, A, y, qa: lvl0[j], qb: lvl0[j + 1], agree: r && fin(r.agree) && RENDER_DEBUG.agree ? r.agree : 1, by: r?.by || [], S: at((t[a] + t[b]) / 2) };
  }).filter(Boolean);
  const groups = new Map();
  for (const m of mem) { const id = `${gOf.get(m.j)}|${m.S.shape}|${m.S.sens}`; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(m); }
  for (const [gid, g] of groups) {
    // every half-stroke fitted on its own (a whole-curve fit, not one sample: alike strokes come out alike; a turn sits
    // anywhere inside a flat rest, so a group's median smears a flat away); a loop's passes (the same pictures) share one
    // fit on their median, placed alike in every pass
    const loop = gid.startsWith('P'), agree = median(g.map((m) => m.agree)), price = (m) => priceOf(m.S.sens) * (1 + RENDER.agree * (1 - (loop ? agree : m.agree)));
    // paw-6t7d: the speed cap is the fit's own bound (share of the move per share of its time, 3 % kept for the rounding to
    // whole ms and pos), so the fit picks the best layout the cap allows; fitted freely, every point of a fast full-range stroke broke
    // the cap and was left out afterwards (the owner's 0 of 42). A half where the cap cost shape (without it another layout
    // would win at the same price) is reported: res.capped
    const vmax = (gs) => (o.maxSpeed > 0 && RENDER_DEBUG.vcap ? Math.min(...gs.map((m) => (0.97 * o.maxSpeed * m.T) / (1000 * Math.max(1e-9, Math.abs(m.qb - m.qa))))) : 0);
    const fitC = (y, du, pr, vm) => { const f = fitLeg(y, { du, price: pr, vmax: vm }); if (vm > 0) { const f0 = fitLeg(y, { du, price: pr }); f.capped = f0.err + f0.knots.length * pr < f.err + f.knots.length * pr - 1e-9; } return f; };
    const fit = loop ? fitC(Float64Array.from({ length: N }, (_, k) => median(g.map((m) => m.y[k]))), Math.max(0.04, o.minIv / Math.min(...g.map((m) => m.T))), price(g[0]), vmax(g)) : null;
    const kindOf = ([u, d]) => (d >= 0.75 && u >= 0.5 ? 1 : d <= 0.25 && u <= 0.5 ? 0 : -1);
    g.forEach((m, r) => {
      const f = loop ? fit : fitC(m.y, Math.max(0.04, o.minIv / m.T), price(m), vmax([m])), ks = f.knots, logged = [];
      if (f.capped) res.capped.add(m.j);
      if (!loop || !r) o.log?.push({ j: m.j, n: loop ? g.length : 1, err0: f.err0, err: f.err, errs: f.errs, agree: loop ? agree : m.agree, knots: ks.map(([u, d]) => [+u.toFixed(3), +d.toFixed(3)]), points: logged, ...(f.capped ? { capped: true } : {}) });
      const pts = [], tb = m.ta + m.T;
      let pt = m.ta, pp = m.qa;
      for (const [u, d0] of ks) {
        // a shoulder next to a turn is a true flat only where the trace from it to the turn is level within its noise
        const end = kindOf([u, d0]);
        let flat = false, slope = null;
        if (end >= 0) {
          const t0 = end ? m.ta + u * m.T : m.ta, t1 = end ? tb : m.ta + u * m.T, ts = [];
          for (let i = m.a; i <= m.b; i++) if (t[i] >= t0 - 1e-6 && t[i] <= t1 + 1e-6) ts.push(t[i]);
          if (ts.length) { ts[0] = Math.min(ts[0], t0); ts[ts.length - 1] = Math.max(ts[ts.length - 1], t1); }   // (the span itself: the drop is over all of it)
          slope = (1000 * Math.abs((end ? 1 - d0 : d0) * (m.qb - m.qa))) / Math.max(1, t1 - t0);
          flat = flatTest(ts, slope, sig).flat;
          slope = Math.round(slope);
        }
        const fast = (x0, p0, x1, p1) => o.maxSpeed > 0 && (1000 * Math.abs(p1 - p0)) / Math.max(1e-9, x1 - x0) > o.maxSpeed;
        const at1 = m.ta + u * m.T, over = (dd) => { const q = m.qa + dd * (m.qb - m.qa); return fast(pt, pp, at1, q) || fast(at1, q, tb, m.qb); };
        if (RENDER_DEBUG.vcap && flat && over(end) && !over(d0)) flat = false;   // (paw-6t7d: snapped level it would break the speed cap: it stays a shoulder)
        const d = flat ? end : d0, why = end < 0 ? 'mid' : flat ? 'hold' : 'shoulder', pos = m.qa + d * (m.qb - m.qa);
        const veto = at1 - pt < o.minIv || tb - at1 < o.minIv ? 'gap' : over(d) ? 'speed' : null;
        logged.push({ u, d, why, slope, ...(veto ? { veto } : {}) });
        if (veto) continue;
        const by = why === 'hold' ? (howTurn(end ? anchors[m.j + 1] : anchors[m.j])?.by || []).map((x) => x.label) : m.by;
        pts.push({ i: nearest(t, m.a + 1, m.b - 1, at1), pos, why, u, df: d, rel: 'turns', at: at1, ...(by.length ? { by: by.join(', ') } : {}) });
        pt = at1; pp = pos;
      }
      if (pts.length) res.set(m.j, pts);
    });
  }
  return res;
}

/**
 * Detail on points made elsewhere (paw-otoh): the sidecar's points, the classic fit's, anything that is turns. Changing
 * the Detail must never move the strokes, so the reversals of `pts` [{at, pos}] (and its two ends) stay exactly, time
 * and depth; between two, shapeFit on the signal they were made from (t ms ascending, v any units and sign; NaN = lost),
 * each half-stroke mapped linearly onto its own two turns (a half where the signal runs the other way, or not at all,
 * stays plain). Other points of `pts` (an old tolerance's in-betweens, a hold's second point) give way to the Detail. o: shapeFit's
 * {minIntervalMs, maxSpeed, pic (per sample of t: its repeated picture's id or -1), how (fusion's HOW, paw-t11b)}. -> [{at, pos, why}] ('turn' |
 * 'end' | 'mid' | 'hold' | 'detail'), or null when there is nothing to fit on (fewer than three points, too few samples).
 */
export function dressPoints(pts, t, v, at, o = {}) {
  const n = pts.length, N = t?.length ?? 0;
  if (n < 3 || N < 3) return null;
  const K = [0];   // the reversals (of a flat run at one, e.g. a hold, its first point)
  for (let i = 1, j = 0; i + 1 < n; i++) {
    if (pts[i].pos === pts[i - 1].pos) continue;
    j = i; while (j + 1 < n - 1 && pts[j + 1].pos === pts[i].pos) j++;
    if ((pts[i].pos - pts[i - 1].pos) * (pts[j + 1].pos - pts[i].pos) < 0) K.push(i);
  }
  K.push(n - 1);
  // the signal with its holes bridged, each anchor on its nearest sample (two on one sample: no grid for it)
  const f = Float64Array.from(v);
  let last = -1;
  for (let i = 0; i < N; i++) if (f[i] === f[i]) { if (last < 0) f.fill(f[i], 0, i); else for (let k = last + 1; k < i; k++) f[k] = f[last] + ((f[i] - f[last]) * (t[k] - t[last])) / (t[i] - t[last]); last = i; }
  if (last < 0) return null;
  f.fill(f[last], last + 1);
  const idx = [];
  let lo = 0;
  for (const k of K) {
    while (lo + 1 < N && Math.abs(t[lo + 1] - pts[k].at) <= Math.abs(t[lo] - pts[k].at)) lo++;
    if (idx.length && lo <= idx[idx.length - 1]) return null;
    idx.push(lo);
  }
  // pos per sample: each half-stroke's signal mapped onto its two turns
  const p = new Float64Array(N);
  for (let i = 0; i < N; i++) p[i] = i <= idx[0] ? pts[K[0]].pos : pts[K[K.length - 1]].pos;
  const raw = Float64Array.from(p);   // paw-na9u: the same, not kept between the two turns' levels (a render is fitted to the shape, not to a clipped one)
  for (let q = 0; q + 1 < idx.length; q++) {
    const a = idx[q], b = idx[q + 1], pa = pts[K[q]].pos, pb = pts[K[q + 1]].pos, F = f[b] - f[a], P = pb - pa, l = Math.min(pa, pb), h = Math.max(pa, pb);
    for (let i = a; i <= b; i++) { raw[i] = F * P > 0 ? pa + ((f[i] - f[a]) * P) / F : pa + (P * (t[i] - t[a])) / (t[b] - t[a]); p[i] = Math.min(h, Math.max(l, raw[i])); }
  }
  const turnSet = new Set(idx.slice(1, -1)), byIdx = new Map(idx.map((i, q) => [i, pts[K[q]]]));
  const fit = shapeFit(t, p, idx, turnSet, at, { minIntervalMs: o.minIntervalMs, maxSpeed: o.maxSpeed, pic: o.pic, how: o.how, turnAt: new Map(idx.map((i, q) => [i, pts[K[q]].at])), raw, fitLog: o.fitLog });
  const out = [];
  let cur = null;   // the anchor last placed (a hold departs from it)
  for (const q of fit) {
    if (q.why === 'turn' || q.why === 'end') { cur = byIdx.get(q.k); out.push({ at: q.i === q.k ? cur.at : Math.min(t[q.i], cur.at), pos: cur.pos, why: q.why }); }
    else if (q.why === 'hold') out.push({ at: Math.max(t[q.i], cur.at), pos: cur.pos, why: 'hold' });
    else out.push({ at: t[q.i], pos: q.pos, why: q.why, u: q.u, df: q.df, t: q.at, rel: q.rel, by: q.by });
  }
  return placeMids(out, o.minIntervalMs);
}
/** Midpoints (u / df from shapeFit) at their exact phase and level between the point before (a turn or its hold) and the
 *  next turn, as those were finally placed. In place on a [{at, pos, why, u?, df?}] list; -> it. */
export function exactMids(out) {
  const isTurn = (q) => /^(turn|end|clamped)$/.test(q.why);
  for (let k = 1; k + 1 < out.length; k++) {
    const m = out[k];
    let a = out[k - 1], b = out[k + 1];
    if (m.u == null || !(m.why === 'mid' || m.rel === 'turns')) continue;
    if (m.rel === 'turns') {   // paw-na9u: a point by render sits at its share of the turn-to-turn move
      let ka = k - 1, kb = k + 1;
      while (ka > 0 && !isTurn(out[ka])) ka--;
      while (kb + 1 < out.length && !isTurn(out[kb])) kb++;
      a = out[ka]; b = out[kb];
    }
    m.at = m.t ?? a.at + m.u * (b.at - a.at); m.pos = a.pos + m.df * (b.pos - a.pos);   // t: on a repeated picture
    delete m.u; delete m.df; delete m.t; delete m.rel;
  }
  return out;
}
/** exactMids on whole ms, then no point closer than minGap to the one before (a turn / hold never gives way to a mid /
 *  detail). */
function placeMids(out, minGap = 60) {
  const res = [];
  for (const q of exactMids(out)) {
    q.at = Math.round(q.at);
    const pr = res[res.length - 1];
    if (pr && q.at - pr.at < Math.max(1, minGap)) { if (/^(mid|detail|shoulder)$/.test(q.why)) continue; if (/^(mid|detail|shoulder)$/.test(pr.why)) res.pop(); }
    res.push({ at: q.at, pos: q.pos, why: q.why, ...(q.by ? { by: q.by } : {}) });
  }
  return res;
}

// ---- generated strokes (fills, bridges) dressed like their neighbours (paw-uiu, paw-e82) ----
/** The turns of a points script: [{a (arrival index), d (departure index: a + 1 for a hold, else a), kind}]; a hold is
 *  a flat pair at a reversal. */
function turnsOf(s) {
  const out = [];
  for (let i = 1; i + 1 < s.length; i++) {
    const p = s[i - 1].pos, c = s[i].pos;
    let j = i;
    if (s[i + 1].pos === c && i + 2 < s.length) j = i + 1;
    const n = s[j + 1].pos;
    if ((c - p) * (n - c) < 0) { out.push({ a: i, d: j, kind: c > p ? 'top' : 'bottom' }); i = j; }
  }
  return out;
}
/**
 * The layout of the strokes in `parts` (points scripts, e.g. the shots before and after a fill): per direction the
 * midpoint ({u: phase, df: share of the move} when at least half the half-strokes have exactly one), per turn kind the
 * hold (its share of the adjacent strokes' mean length, when at least half the turns hold). -> {mid: {1, -1}, hold:
 * {top, bottom}} or null (fewer than two turns).
 */
export function layoutOf(parts) {
  const H = { 1: [], '-1': [] }, K = { top: [], bottom: [] };
  let n = 0;
  for (const s of parts) {
    const T = turnsOf(s || []);
    n += T.length;
    for (let q = 0; q < T.length; q++) {
      const x = T[q], prev = T[q - 1], next = T[q + 1], spans = [prev && s[x.a].at - s[prev.a].at, next && s[next.a].at - s[x.a].at].filter(Boolean);
      if (spans.length) K[x.kind].push(x.d > x.a ? (s[x.d].at - s[x.a].at) / mean(spans) : 0);
      if (!next) continue;
      const a = s[x.d], b = s[next.a], m = next.a - x.d - 1, dir = Math.sign(b.pos - a.pos);
      if (m > 1 || !dir) continue;
      H[dir].push(m === 1 ? { u: (s[x.d + 1].at - a.at) / (b.at - a.at), df: (s[x.d + 1].pos - a.pos) / (b.pos - a.pos) } : null);
    }
  }
  if (n < 2) return null;
  const mid = (L) => { const w = L.filter(Boolean); return L.length && 2 * w.length >= L.length ? { u: median(w.map((x) => x.u)), df: median(w.map((x) => x.df)) } : null; };
  const hold = (L) => { const w = L.filter((x) => x > 0); return L.length && 2 * w.length >= L.length ? median(w) : null; };
  return { mid: { 1: mid(H[1]), '-1': mid(H['-1']) }, hold: { top: hold(K.top), bottom: hold(K.bottom) } };
}
/**
 * Generated turn-to-turn strokes (`script`, points with a turn at every reversal) dressed with a layout (layoutOf): the
 * same midpoint at the same phase on every half-stroke of that direction and the same hold on every turn of that kind,
 * where the Detail there allows it (at: shapeAt; 'turns' / 'free' leave them as they are). Every point keeps at least
 * minGapMs from its neighbours. -> a new script (the same one when nothing is added).
 */
export function dressScript(script, layout, at, { minGapMs = 60 } = {}) {
  if (!layout || !script?.length || script.length < 3) return script;
  const s = script, T = turnsOf(s).filter((x) => x.d === x.a), out = [];
  const isTurn = new Map(T.map((x) => [x.a, x.kind])), end = (i, j) => (s[i].pos > s[j].pos ? 'top' : 'bottom');
  isTurn.set(0, end(0, 1)); isTurn.set(s.length - 1, end(s.length - 1, s.length - 2));   // the ends of a generated span are turns too
  // holds: a turn becomes an arrival and a departure around its time
  const pts = s.map((p, i) => ({ ...p, turn: isTurn.get(i) }));
  const held = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], f = p.turn && layout.hold[p.turn];
    if (f && i > 0 && i + 1 < pts.length && /^(hold|render)$/.test(at(p.at).shape)) {   // (By render: the neighbours' layout too, paw-na9u)
      const d = f * mean([p.at - pts[i - 1].at, pts[i + 1].at - p.at]), a = Math.round(p.at - d / 2), e = Math.round(p.at + d / 2);
      if (e - a >= minGapMs && a - pts[i - 1].at >= 2 * minGapMs && pts[i + 1].at - e >= 2 * minGapMs) { held.push({ at: a, pos: p.pos, turn: p.turn }, { at: e, pos: p.pos, dep: true }); continue; }
    }
    held.push(p);
  }
  for (let i = 0; i < held.length; i++) {
    const p = held[i], q = held[i + 1];
    out.push({ at: p.at, pos: p.pos });
    if (!q || !(p.turn || p.dep) || !q.turn) continue;   // only a move from a turn (or its hold) to the next turn
    const dir = Math.sign(q.pos - p.pos), m = dir && layout.mid[dir], S = at((p.at + q.at) / 2);
    if (!m || !/^(mid|hold|render)$/.test(S.shape)) continue;
    const t = Math.round(p.at + m.u * (q.at - p.at));
    if (t - p.at >= minGapMs && q.at - t >= minGapMs) out.push({ at: t, pos: Math.round(p.pos + m.df * (q.pos - p.pos)) });
  }
  return out.length === s.length ? script : out;
}
