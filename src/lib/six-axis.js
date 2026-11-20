// six-axis.js -- the secondary axes of an SR6-class stroker (surge L1, sway L2, twist R0, roll R1, pitch R2) measured
// from a points run, one shot at a time. Pure (test/six-axis.test.mjs). The stroke (L0) is never touched here.
//
// ---- the 3-D model ----
// Device frame (T-code SR6): S = the toy's axis (the stroke runs along it); surge = translation along F, sway =
// translation along L, F and L the two directions perpendicular to S; twist = rotation about S, roll = rotation about F,
// pitch = rotation about L. Body frame: S = the axis of the Bottom's opening (the Top's penis enters along it), F = the
// Bottom's front-back, L = the Bottom's left-right. What is measured is the Bottom's hips relative to the Top (the
// opening relative to the penis: a stroker moves the sleeve on the user, so the device axes describe the Bottom's body
// relative to the Top's; one convention, sleeve and mount alike, owner 2026-11-14). Relative measures cancel the camera.
//
// ---- what a 2-D picture shows ----
// A view puts one body axis along the camera; the picture plane holds the other two. In the picture: a translation in
// the plane is seen, along the camera only as a size change (weak); a rotation about the camera axis is an in-plane
// rotation (seen well), a rotation about an in-plane axis only as foreshortening (the point cloud's across-vs-along
// stretch: weak); a rotation of the body about its own long axis shows as the body's surface points moving across it
// relative to its outline (the residual of the similarity fit: weak, experimental).
//   view            camera along   picture plane   seen well                          weak (estimate)             not seen
//   side            L              S, F            surge (across), pitch (rotation)   sway (size), twist (resid.),  -
//                                                                                     roll (stretch)
//   rear / front    S              F, L            sway (horizontal), surge (vertical), pitch (stretch)           roll, stroke*
//                                                  twist (rotation)
//   top (high-angle, POV)  F       S, L            sway (across), roll (rotation)     surge (size), twist (resid.),  -
//                                                                                     pitch (stretch)
//   * the stroke is along the camera in rear / front views (only a size change): the stroke pipeline's business.
// POV is the shot's camera tag (timeline/acts.js 'pov', from Describe's *_pov), not a view value: one source of truth; a
// POV shot without an angle tag maps like 'top' (the penetrating eye looks down the Bottom's body, S receding in the
// picture). Rear / front stretch: the vertical-vs-horizontal ratio cannot tell pitch from roll; it goes to pitch, roll
// stays empty there. A shot with no angle and no POV is measured as 'side' (the common case) but never above estimate.
//
// ---- the picture measurements (Bottom group B = c1_hips, else c1_torso; Top group T = c2_hips, else c2_penis ...) ----
//   d       = centre(B) - centre(T) (sem_<g>_x / _y, x scaled by the aspect)
//   u       = the stroke axis in the picture: the shaft base -> entry when the run has one, else the run's custom axis,
//             else the major axis of d's motion (high-passed). n = its perpendicular, + = up in the picture (right when
//             the stroke runs nearly vertical).
//   across  = d . n                       horiz = -d.x (+ = picture left)      vert = -d.y (+ = up)
//   rot     = rotation of B's similarity fit minus T's (+ = counter-clockwise on screen); B's alone when T has < 3 points
//   scale   = log size of B minus log size of T (+ = the Bottom grows: comes toward the camera)
//   prof    = B's residual after the fit, across u, regressed on the member's squared distance from the middle (the middle
//             of a turning body moves, its edges do not: the owner's "intra point location" / "surface distortion")
//   aniso   = log(spread across / spread along) of B's points (rear / front: vertical / horizontal)
// A group seeded on several frames (paw-o74b.1: run.groupSeeds entries with their own pinned id) is fitted per seed, each
// against its own fullest frame (the two seeds' point sets differ: one fit across them would read the handover as a turn
// or a jump in size), and the per-seed rot / lsz / prof / aniso series are stitched like its channels (seed-stitch.js:
// aligned on their overlap, cross-faded): what is left at a handover is the part's motion, not the change of points.
// Signs (unverified on a device; flippable per shot, shot.axflip): + = up / picture-left / counter-clockwise / toward the
// camera, so surge+ = up in the picture; sway+ = the Bottom's left as seen from behind (rear: picture left; front:
// picture right; side / top: the up / right perpendicular: a guess from 2-D); twist+ = counter-clockwise looking along S
// from behind; pitch+ / roll+ = counter-clockwise on screen.
// Painted sides (paw-5r1): a paired part's stored side is the CHARACTER's own left / right, so the Bottom's painted limbs say where ITS left
// is in the picture (lside: right part -> left part of one pair, else its centre -> a left part / a right part -> its centre, averaged over
// the shot), which settles the mirror a 2-D view cannot: rear / front: sway and twist take +1 when the Bottom's left is on the picture's
// left (seen from behind), -1 when on its right, whatever the angle tag says; top: sway takes the sign that makes + the Bottom's left
// (L . n), roll the handedness of (S, L) in the picture (S = Top -> Bottom), the unmirrored view being det > 0. Those axes then say
// signFrom 'sides'. Side views keep the convention (L is along the camera there: positions cannot say which flank faces it).
//
// ---- the solo reading (paw-jyde.11: a lone dancer, a solo scene; "hips vs frame") ----
// When no pair is seen in the shot (no Bottom or no Top group, or the two never both tracked there) and one character has a hips
// group seen >= MIN_FRAMES (SOLO_HIPS order: c1, c2, x, unassigned), its hips are measured against the frame. The device frame is
// the lone body's own: S = its up (the stroke runs along it), F = its front-back, L = its left-right; twist = about S, roll =
// about F (hips tilting side to side), pitch = about L (tilting forward / back). The body's up in the picture U (aspect-corrected,
// averaged over the shot so it does not chase the motion): hips -> torso of the same character, else hips -> head, else (paw-jyde.13,
// all guesses) from evidence, by the shot's tagged view (opts.view = viewFor's; POV alone = rear): rear / front / top: the painted L / R
// pairs (up across the L -> R line, toward the hips from the legs, else up in the picture, else right), the legs, the hips' SHORT axis
// on their fullest frame (their long axis is their left-right there); side: the legs only (L / R and the long axis run along the camera);
// untagged: the legs, the L / R pairs. Legs = from the thighs / shins to the hips, only when two thighs or a thigh and a shin agree within
// 45 deg (raised legs disagree). Else the picture's vertical.
// n = U turned a quarter clockwise on screen = the body's picture-left when it stands upright (a lying body: rotated with it).
//   fside = c . n, fup = c . U (c = the hips centre; s = fup: up the body = + = out, so down = deeper; no automatic polarity),
//   frot / fscale / fprof / faniso = the hips' own fit (as rot / scale / prof / aniso, with U for the stroke axis, no Top).
//   view (camera along)   measured                          estimate                                       not seen
//   rear / front (F)      sway (fside), roll (frot)         surge (fscale), twist (fprof), pitch (faniso)   -
//   side (L)              surge (fside), pitch (frot)       sway (fscale), twist (fprof), roll (faniso)     -
//   top (S)               sway (fside), twist (frot)        surge (fup), pitch (faniso)                     roll
//   POV with no angle: read as rear (the dancer faces or backs the camera); estimate at most unless the painted sides say which.
// Signs: rear and its mirror via the character's painted L / R sides (sway, roll, twist; top: sway, twist), + = its left lying on n;
// front without sides = rear negated; surge from size: + = toward the camera seen from the front (rear: away). A guessed up caps
// fside / fup / fprof / faniso at estimate (x GUESS_W); frot / fscale need no up. Camera: the centres are the stored ones,
// camera removed as tracked (the run's cam_x path), or re-handled as the shot's camera setting says (opts.cam.run: the same
// fusionInput fusion reads); when the camera is NOT removed and the shot's camera tag says it moves (anything but static), every
// axis x CAM_W and the label says so. The rotation / size fits are on the image points: a camera zoom / roll still leaks there.
//
// ---- conditioning (per measurement, per shot) ----
// gaps <= GAP_MS filled; high-pass (HP_MS gaussian: slow posture drift is NOT kept); jitter smoothed (SMOOTH_MS gaussian,
// the stroke's filter family); per-shot robust amplitude (p95 of |x|, never below FLOOR) onto BAND around 50, times the
// confidence; hard clamp; slew limit SPEED; faded to 50 over FADE_MS at the shot's edges and around untracked stretches.
// Points: the extremes (graph sig.toScript, the strokes' own reducer) plus 50 at both ends.
// Confidence: realness (1 - the white-noise share of the motion / NOISE) x (0.5 + 0.5 x the stroke-locked share above chance) x
// coverage x (ESTIMATE_W for an estimate mapping) x (GUESS_W when the view is a guess). >= MEASURED: 'measured' (a
// measured mapping only), >= ESTIMATE: 'estimate', else no data (the lane stays as it is). Stroke-locked AND free motion
// are both kept: the lock only raises the confidence that a wobble is the body, not the tracker.
import { fillGaps, smooth, slew, toScript } from './graph/nodes/signal.js';
import { lowerBound } from './lane.js';
import { stitch } from './seed-stitch.js';
import { sceneAt } from './runs.js';
import { PAIRED } from '../features/tracking/groups.js';

export const SECONDARY = ['surge', 'sway', 'twist', 'roll', 'pitch'];
export const VIEWS = ['side', 'rear', 'front', 'top'];
/** Half-width of each axis's band around 50 (0..100), its speed cap (units / s): one place. */
export const BAND = { surge: 15, sway: 15, twist: 10, roll: 10, pitch: 10 };
export const SPEED = { surge: 250, sway: 250, twist: 200, roll: 160, pitch: 160 };
export const SIX = { HP_MS: 2000, SMOOTH_MS: 200, GAP_MS: 500, FADE_MS: 400, MIN_MS: 1500, MIN_FRAMES: 30, MEASURED: 0.35, ESTIMATE: 0.08, ESTIMATE_W: 0.4, GUESS_W: 0.6, SOLO_W: 0.7, MIN_AMP: 1, NOISE: 0.8, CAM_W: 0.5 };
/** Below these amplitudes (p95 |x|) a measurement is not stretched to the band: frame heights, radians, log units. */
export const FLOOR = { across: 0.006, horiz: 0.006, vert: 0.006, rot: 0.01, scale: 0.01, prof: 0.02, aniso: 0.02, fside: 0.006, fup: 0.006, frot: 0.01, fscale: 0.01, fprof: 0.02, faniso: 0.02 };
const M = 'measured', E = 'estimate';
/** paw-5r1: per view, the axes whose sign the painted sides decide (the ones a mirror image flips), and how much of the Bottom's painted
 *  left / right must lie along the reference (cosine) before it counts. */
export const SIDE_AXES = { rear: ['sway', 'twist'], front: ['sway', 'twist'], top: ['sway', 'roll'] };
export const SIDE_MIN_COS = 0.3;
/** view -> axis -> [measurement, sign, kind]. An axis missing from a view is not seen there: no data. */
export const VIEW_TABLE = {
  side: { surge: ['across', 1, M], pitch: ['rot', 1, M], sway: ['scale', 1, E], twist: ['prof', 1, E], roll: ['aniso', 1, E] },
  rear: { sway: ['horiz', 1, M], surge: ['vert', 1, M], twist: ['rot', 1, M], pitch: ['aniso', 1, E] },
  front: { sway: ['horiz', -1, M], surge: ['vert', 1, M], twist: ['rot', -1, M], pitch: ['aniso', 1, E] },
  top: { sway: ['across', 1, M], roll: ['rot', 1, M], surge: ['scale', 1, E], twist: ['prof', 1, E], pitch: ['aniso', 1, E] },
};
/** Words for the tooltip: what each measurement is made from. */
export const FROM = {
  across: 'the Bottom\'s hips moving across the stroke, relative to the Top', horiz: 'the Bottom\'s hips moving sideways in the picture, relative to the Top',
  vert: 'the Bottom\'s hips moving up and down in the picture, relative to the Top', rot: 'the Bottom\'s hips turning in the picture, relative to the Top',
  scale: 'the Bottom\'s size changing against the Top\'s (toward / away from the camera)', prof: 'the Bottom\'s surface points shifting middle vs edges (experimental)',
  aniso: 'the Bottom\'s outline stretching across vs along (foreshortening)',
  // paw-jyde.11: the solo reading (one character's hips vs the frame, in its own body frame)
  fside: 'the hips moving sideways across the body against the frame (hips vs frame)', fup: 'the hips moving up and down the body against the frame (hips vs frame)',
  frot: 'the hips turning in the picture (hips vs frame)', fscale: 'the hips\' size changing (toward / away from the camera; hips vs frame)',
  fprof: 'the hips\' surface points shifting middle vs edges (experimental; hips vs frame)', faniso: 'the hips\' outline stretching across vs along the body (foreshortening; hips vs frame)',
};
/** paw-jyde.11: the solo reading's table, view -> axis -> [measurement, sign, kind], in the lone body's own frame (S = its up: the
 *  stroke runs along it; F = its front-back; L = its left-right): rear / front look along F, side along L, top along S. */
export const SOLO_TABLE = {
  side: { surge: ['fside', 1, M], pitch: ['frot', 1, M], sway: ['fscale', 1, E], twist: ['fprof', 1, E], roll: ['faniso', 1, E] },
  rear: { sway: ['fside', 1, M], roll: ['frot', 1, M], surge: ['fscale', -1, E], twist: ['fprof', 1, E], pitch: ['faniso', 1, E] },
  front: { sway: ['fside', -1, M], roll: ['frot', -1, M], surge: ['fscale', 1, E], twist: ['fprof', -1, E], pitch: ['faniso', 1, E] },
  top: { sway: ['fside', 1, M], twist: ['frot', 1, M], surge: ['fup', 1, E], pitch: ['faniso', 1, E] },
};
/** The solo axes whose sign the character's painted sides decide (a mirror image flips them). */
export const SOLO_SIDE_AXES = { rear: ['sway', 'roll', 'twist'], front: ['sway', 'roll', 'twist'], top: ['sway', 'twist'] };
/** Hips groups a solo reading stands on, first seen in the shot wins: the Bottom (or the only character), the Top, the Extra, unassigned. */
export const SOLO_HIPS = ['c1_hips', 'c2_hips', 'x_hips', 'hips'];
/** A torso / head nearer the hips than this (frame heights, shot average) gives no up direction (seen from above it sits on them). */
export const SOLO_REF_MIN = 0.01;
/** paw-jyde.13: the leg chain (below the hips along the body): thighs and shins give the up, paws only its sign. */
const LEGS = ['thighs_l', 'thighs_r', 'shin_l', 'shin_r', 'paws_l', 'paws_r'];
/** Solo measurements that rest on the body's up direction (a guessed one caps them at estimate). */
const REF_DEP = new Set(['fside', 'fup', 'fprof', 'faniso']);
export const BOTTOM = ['c1_hips', 'c1_torso'];
export const TOP = ['c2_hips', 'c2_penis', 'c2_sheath', 'c2_torso'];
/** The table a shot reads: its angle, else POV -> top, else side as a guess. */
export const viewFor = (angle, camera) => (VIEWS.includes(angle) ? { view: angle, guessed: false } : camera === 'pov' ? { view: 'top', guessed: false, pov: true } : { view: 'side', guessed: true });

// ---- small maths ----
const mean = (a) => { let s = 0; for (const x of a) s += x; return a.length ? s / a.length : 0; };
const sd = (a) => { const m = mean(a); let s = 0; for (const x of a) s += (x - m) ** 2; return a.length ? Math.sqrt(s / a.length) : 0; };
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
const fin = (a) => Array.from(a).filter((x) => x === x);
function solve(A, b) {
  const k = b.length;
  for (let p = 0; p < k; p++) {
    let m = p;
    for (let q = p + 1; q < k; q++) if (Math.abs(A[q][p]) > Math.abs(A[m][p])) m = q;
    [A[p], A[m]] = [A[m], A[p]]; [b[p], b[m]] = [b[m], b[p]];
    if (Math.abs(A[p][p]) < 1e-15) A[p][p] = 1e-15;
    for (let q = p + 1; q < k; q++) { const f = A[q][p] / A[p][p]; for (let z = p; z < k; z++) A[q][z] -= f * A[p][z]; b[q] -= f * b[p]; }
  }
  const w = new Array(k).fill(0);
  for (let p = k - 1; p >= 0; p--) { let s = b[p]; for (let q = p + 1; q < k; q++) s -= A[p][q] * w[q]; w[p] = s / A[p][p]; }
  return w;
}
/** R^2 of y on [1, ...X] (rows where everything is finite). */
function r2(y, X) {
  const k = X.length + 1, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0), rows = [];
  for (let i = 0; i < y.length; i++) { const r = [1, ...X.map((c) => c[i])]; if (y[i] === y[i] && r.every((v) => v === v)) rows.push([r, y[i]]); }
  if (rows.length < k + 3) return 0;
  for (const [r, v] of rows) for (let p = 0; p < k; p++) { b[p] += r[p] * v; for (let q = 0; q < k; q++) A[p][q] += r[p] * r[q]; }
  const w = solve(A, b), my = mean(rows.map((x) => x[1]));
  let ss = 0, se = 0;
  for (const [r, v] of rows) { const yh = r.reduce((s, x, p) => s + x * w[p], 0); ss += (v - my) ** 2; se += (v - yh) ** 2; }
  return ss > 0 ? 1 - se / ss : 0;
}
const deriv = (v) => v.map((_, i) => (v[Math.min(v.length - 1, i + 1)] - v[Math.max(0, i - 1)]) / 2);
/** Stroke-locked share of y: R^2 on [s, ds, s^2], and the same against circularly shifted strokes (chance). */
export function lockR2(y, s) {
  const X = (q) => [q, deriv(q), q.map((v) => v * v)], n = s.length;
  const shift = (k) => s.map((_, i) => s[(i + k) % n]);
  return { real: r2(y, X(s)), chance: mean([0.23, 0.37, 0.51, 0.66, 0.79].map((f) => r2(y, X(shift(Math.round(f * n)))))) };
}
/** White-noise share: second-difference jitter over the spread (finite stretches only). */
export function noiseShare(v) {
  const d = [];
  for (let i = 1; i < v.length - 1; i++) { const x = v[i + 1] - 2 * v[i] + v[i - 1]; if (x === x) d.push(x); }
  const s = sd(fin(v));
  return s > 0 && d.length > 4 ? sd(d) / Math.sqrt(6) / s : 1;
}
/** Pearson r at lag k (y shifted by k samples). */
export function corrAt(a, b, k = 0) {
  const xs = [], ys = [];
  for (let i = 0; i < a.length; i++) { const j = i + k; if (j >= 0 && j < b.length && a[i] === a[i] && b[j] === b[j]) { xs.push(a[i]); ys.push(b[j]); } }
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const p = xs[i] - mx, q = ys[i] - my; sxy += p * q; sxx += p * p; syy += q * q; }
  return xs.length > 5 && sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

// ---- signal plumbing on the graph kernels ----
const gridCtx = (n, dt) => ({ grid: () => ({ i0: 0, n, dt }) });
const run1 = (node, v, p, dt) => node.eval({ signal: { i0: 0, dt, v } }, p, gridCtx(v.length, dt)).signal.v;
/** gaps <= GAP_MS bridged, high-passed (slow drift out), jitter smoothed -> {hp (before smoothing), y}. */
export function condition(v, dt) {
  const f = run1(fillGaps, Float32Array.from(v), { maxGapMs: SIX.GAP_MS, mode: 'linear' }, dt);
  const slow = run1(smooth, f, { method: 'gaussian', windowMs: SIX.HP_MS }, dt);
  const hp = Float32Array.from(f, (x, i) => x - slow[i]);
  return { hp, y: run1(smooth, hp, { method: 'gaussian', windowMs: SIX.SMOOTH_MS }, dt) };
}
/** 0..1 per sample: 1 inside known data, easing to 0 over FADE_MS at the ends and at every gap. */
export function fadeEnvelope(v, dt) {
  const n = v.length, d = new Float64Array(n).fill(Infinity), F = SIX.FADE_MS;
  let last = -Infinity;
  for (let i = 0; i < n; i++) { if (v[i] !== v[i]) last = i; d[i] = v[i] === v[i] ? (i - (last === -Infinity ? -1 : last)) * dt : 0; }
  last = Infinity;
  for (let i = n - 1; i >= 0; i--) { if (v[i] !== v[i]) last = i; if (v[i] === v[i]) d[i] = Math.min(d[i], ((last === Infinity ? n : last) - i) * dt); }
  return Float64Array.from(d, (x) => { const u = clamp01(x / F); return u * u * (3 - 2 * u); });
}
const p95abs = (v) => { const a = fin(v).map(Math.abs).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(0.95 * a.length))] : 0; };

// ---- group geometry ----
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
/** A group's member point indices in the overlay's pts: by pinned id (pts[5]); runs saved before the ids: the points
 *  inside the group's painted polygon on its seed frame (poly {poly, t_ms}). -> {ids: Set, how: 'pinned' | 'poly'} | null */
export function members(frames, id, poly, k0 = 0, k1 = frames?.t?.length ?? 0) {
  const ids = new Set();
  if (!frames?.ov) return null;
  if (id) for (let i = k0; i < k1; i++) frames.ov[i]?.pts?.forEach((q, j) => { if (q[5] === id) ids.add(j); });
  if (ids.size) return { ids, how: 'pinned' };
  if (!poly?.poly?.length) return null;
  let k = k0;
  for (let i = k0; i < k1; i++) if (Math.abs(frames.t[i] - poly.t_ms) < Math.abs(frames.t[k] - poly.t_ms)) k = i;
  frames.ov[k]?.pts?.forEach((q, j) => { if (q[2] && inPoly(q[0], q[1], poly.poly)) ids.add(j); });
  return ids.size ? { ids, how: 'poly' } : null;
}
/**
 * Similarity fit of a group's members per frame against its fullest frame. fi: frame index per sample (-1 = none);
 * u: stroke axis (aspect-corrected). -> {rot, lsz, prof, aniso, anisoXY} (Float64Array per sample, NaN where < 3 shared
 * members) | null (fewer than 3 members anywhere).
 */
export function groupFit(frames, fi, mset, aspect, u) {
  const n = [-u[1], u[0]], T = fi.length;
  const mem = fi.map((k) => { const m = new Map(), p = k >= 0 ? frames.ov[k]?.pts : null; if (p) for (const j of mset) { const q = p[j]; if (q && q[2]) m.set(j, [q[0] * aspect, q[1]]); } return m; });
  let r0 = 0;
  mem.forEach((m, i) => { if (m.size > mem[r0].size) r0 = i; });
  const ref = mem[r0];
  if (!ref || ref.size < 3) return null;
  const out = { rot: new Float64Array(T).fill(NaN), lsz: new Float64Array(T).fill(NaN), prof: new Float64Array(T).fill(NaN), aniso: new Float64Array(T).fill(NaN), anisoXY: new Float64Array(T).fill(NaN) };
  for (let i = 0; i < T; i++) {
    const both = [...mem[i].keys()].filter((j) => ref.has(j)), N = both.length;
    if (N < 3) continue;
    let cx0 = 0, cy0 = 0, cx = 0, cy = 0;
    for (const j of both) { cx0 += ref.get(j)[0]; cy0 += ref.get(j)[1]; cx += mem[i].get(j)[0]; cy += mem[i].get(j)[1]; }
    cx0 /= N; cy0 /= N; cx /= N; cy /= N;
    const A = both.map((j) => [ref.get(j)[0] - cx0, ref.get(j)[1] - cy0]), B = both.map((j) => [mem[i].get(j)[0] - cx, mem[i].get(j)[1] - cy]);
    let re = 0, im = 0, den = 0;
    for (let k = 0; k < N; k++) { re += A[k][0] * B[k][0] + A[k][1] * B[k][1]; im += A[k][0] * B[k][1] - A[k][1] * B[k][0]; den += A[k][0] ** 2 + A[k][1] ** 2; }
    if (!(den > 0)) continue;
    const ar = re / den, ai = im / den, R = Math.sqrt(den / N);
    out.rot[i] = Math.atan2(ai, ar); out.lsz[i] = Math.log(Math.hypot(ar, ai));
    const ra = [], an = [];
    for (let k = 0; k < N; k++) {
      const px = ar * A[k][0] - ai * A[k][1], py = ai * A[k][0] + ar * A[k][1];
      ra.push(((B[k][0] - px) * n[0] + (B[k][1] - py) * n[1]) / R);
      an.push((A[k][0] * n[0] + A[k][1] * n[1]) / R);
    }
    const f = an.map((v) => v * v), mf = mean(f), fc = f.map((v) => v - mf), dd = fc.reduce((s, v) => s + v * v, 0);
    if (dd > 1e-9) out.prof[i] = fc.reduce((s, v, k) => s + v * ra[k], 0) / dd;
    // the stretch on the de-rotated cloud: an in-plane turn of an oblong body is not a foreshortening
    const c = ar / Math.hypot(ar, ai), s = ai / Math.hypot(ar, ai), Bd = B.map((b) => [c * b[0] + s * b[1], -s * b[0] + c * b[1]]);
    const sp = (w) => Math.sqrt(mean(Bd.map((b) => (b[0] * w[0] + b[1] * w[1]) ** 2)));
    const su = sp(u), sn = sp(n), sx = sp([1, 0]), sy = sp([0, 1]);
    if (su > 0 && sn > 0) out.aniso[i] = Math.log(sn / su);
    if (sx > 0 && sy > 0) out.anisoXY[i] = Math.log(sy / sx);
  }
  return out;
}

/** Unit stroke axis (aspect-corrected) in [t0, t1): shaft base -> entry, else the run's custom axis, else the major axis
 *  of the high-passed relative motion. -> {u, from} */
function strokeAxis(run, dx, dy, dt, t0, t1, aspect) {
  const C = run.channels || {};
  for (const k of Object.keys(C)) {
    const m = /^sem_(.+)_bx$/.exec(k);
    if (!m || !C[`sem_${m[1]}_ex`]) continue;
    const bx = C[k], by = C[`sem_${m[1]}_by`], ex = C[`sem_${m[1]}_ex`], ey = C[`sem_${m[1]}_ey`];
    let sx = 0, sy = 0, c = 0;
    for (let i = 0; i < bx.t.length; i++) if (bx.t[i] >= t0 && bx.t[i] < t1) { const a = (ex.v[i] - bx.v[i]) * aspect, b = ey.v[i] - by.v[i]; if (a === a && b === b) { sx += a; sy += b; c++; } }
    const L = Math.hypot(sx, sy);
    if (c >= SIX.MIN_FRAMES && L > 0) return { u: [sx / L, sy / L], from: 'shaft' };
  }
  const p = run.params || {};
  if (p.axis === 'custom' && [p.axis_x0, p.axis_y0, p.axis_x1, p.axis_y1].every(Number.isFinite)) {
    const a = (p.axis_x1 - p.axis_x0) * aspect, b = p.axis_y1 - p.axis_y0, L = Math.hypot(a, b);
    if (L > 0) return { u: [a / L, b / L], from: 'axis' };
  }
  const hx = condition(dx, dt).hp, hy = condition(dy, dt).hp;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < hx.length; i++) if (hx[i] === hx[i] && hy[i] === hy[i]) { sxx += hx[i] * hx[i]; syy += hy[i] * hy[i]; sxy += hx[i] * hy[i]; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { u: [Math.cos(th), Math.sin(th)], from: 'motion' };
}
/** A direction (or its opposite) pointing up in the picture, else right when it lies nearly flat. */
const upOrRight = (a) => ((Math.abs(a[1]) >= 0.2 ? a[1] > 0 : a[0] < 0) ? [-a[0], -a[1]] : a);
const upPerp = (u) => { let n = [-u[1], u[0]]; if (Math.abs(n[1]) >= 0.2 ? n[1] > 0 : n[0] < 0) n = [-n[0], -n[1]]; return n; };

const pick = (C, names) => names.find((g) => C[`sem_${g}_x`] && C[`sem_${g}_y`]) || null;

/**
 * The picture measurements of run over [t0, t1) (a shot inside one run scene). opts: aspect (width / height), polys
 * ({name: {poly, t_ms}}: painted groups for runs without pinned ids). -> {t (ms), dt, s (stroke proxy), m: {across, horiz,
 * vert, rot, scale, prof, aniso, anisoXY} (Float64Array, NaN gaps), bottom, top, solo (no Top fit), axis: 'shaft' | 'axis'
 * | 'motion', members: {bottom, top}} | null (no Bottom / Top pair, or too short).
 */
export function measure(run, t0, t1, opts = {}) {
  const C = run?.channels || {}, B = pick(C, BOTTOM), T = pick(C, TOP);
  return (B && T ? measurePair(run, t0, t1, opts, B, T) : null) || measureSolo(run, t0, t1, opts);
}

/** The shot's samples of channel c ([t0, t1)) -> {idx, t, dt, val (any channel at sample i of c)} | null (too short). */
function samplesOf(c, t0, t1) {
  const idx = [];
  for (let i = 0; i < c.t.length; i++) if (c.t[i] >= t0 && c.t[i] < t1) idx.push(i);
  if (idx.length < SIX.MIN_FRAMES) return null;
  const t = idx.map((i) => c.t[i]), dt = (t[t.length - 1] - t[0]) / (t.length - 1) || 1000 / 30;
  if (t[t.length - 1] - t[0] < SIX.MIN_MS) return null;
  const same = (x) => x.t.length === c.t.length;   // the sidecar's channels share the frame times
  const val = (x, i) => { if (same(x) && x.t[i] === c.t[i]) return x.v[i]; const j = lowerBound(x.t, c.t[i]); return Math.abs((x.t[j] ?? Infinity) - c.t[i]) <= dt / 2 ? x.v[j] : NaN; };
  return { idx, t, dt, val };
}

/** A shot's group fitting: grp(name) -> its members (per seed when seeded on several frames), fitOf(members, u) -> groupFit
 *  (stitched across seeds), longAxis(members) -> the unit major axis of its points on its fullest frame (up in the picture,
 *  else right) | null (fewer than 3, or not oblong: major / minor spread under 1.2). */
function groupFits(run, t0, t1, t, dt, polys, aspect) {
  const fr = run.frames;
  const fi = t.map((x) => { if (!fr?.t?.length) return -1; const j = lowerBound(fr.t, x), k = j > 0 && (j >= fr.t.length || x - fr.t[j - 1] < fr.t[j] - x) ? j - 1 : j; return Math.abs(fr.t[k] - x) <= dt / 2 ? k : -1; });
  const k0 = Math.max(0, Math.min(...fi.filter((k) => k >= 0))), k1 = Math.max(...fi) + 1;
  const sc = (run.scenes || []).find((s) => t0 >= s.start_ms - 1 && t0 < s.end_ms) || run.scenes?.[0];
  const ks = sceneAt(run.scenes || [], t0);
  const grp = (g) => {
    if (!fr || k1 <= k0) return null;
    const ss = (run.groupSeeds || []).filter((s) => s?.name === g && Number.isInteger(s.id) && s.own !== null && Number.isFinite(s.t_ms) && sceneAt(run.scenes || [], s.t_ms) === ks && (!Array.isArray(s.own) || s.own.some((r) => r[1] >= t0 && r[0] < t1)));
    const per = ss.length > 1 ? ss.map((s) => ({ t: s.t_ms, m: members(fr, s.id, null, k0, k1) })).filter((x) => x.m) : [];
    if (per.length > 1) return { seeds: per, ids: new Set(per.flatMap((x) => [...x.m.ids])), how: 'pinned' };
    return members(fr, sc?.groups?.[`sem_${g}`]?.id, polys[g], k0, k1);
  };
  const fitOf = (m, u) => {
    if (!m) return null;
    if (!m.seeds) return groupFit(fr, fi, m.ids, aspect, u);
    const fs = m.seeds.map((x) => ({ t: x.t, v: groupFit(fr, fi, x.m.ids, aspect, u) })).filter((x) => x.v);
    return fs.length > 1 ? stitch(t, fs, { key: 'rot', sfx: ['rot', 'lsz', 'prof', 'aniso', 'anisoXY'] }).v : fs[0]?.v || null;
  };
  const longAxis = (m) => {
    if (!m || !fr || k1 <= k0) return null;
    let best = -1, bn = 0;
    for (let k = k0; k < k1; k++) { const p = fr.ov[k]?.pts; let c = 0; if (p) for (const j of m.ids) if (p[j]?.[2]) c++; if (c > bn) { bn = c; best = k; } }
    if (bn < 3) return null;
    const P = [...m.ids].map((j) => fr.ov[best].pts[j]).filter((q) => q?.[2]).map((q) => [q[0] * aspect, q[1]]);
    const mx = mean(P.map((q) => q[0])), my = mean(P.map((q) => q[1]));
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of P) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    const h = Math.hypot((sxx - syy) / 2, sxy), l1 = (sxx + syy) / 2 + h, l2 = (sxx + syy) / 2 - h;
    if (!(l1 > 0) || l2 * 1.44 > l1) return null;
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return upOrRight([Math.cos(th), Math.sin(th)]);
  };
  return { grp, fitOf, longAxis };
}

/** The pair reading (Bottom against Top). null when too short or when the two are never both seen in the shot (paw-jyde.11:
 *  the solo reading takes over then). */
function measurePair(run, t0, t1, { aspect = 16 / 9, polys = {} } = {}, B, T) {
  const C = run.channels;
  const bx = C[`sem_${B}_x`], by = C[`sem_${B}_y`], tx = C[`sem_${T}_x`], ty = C[`sem_${T}_y`];
  const S = samplesOf(bx, t0, t1);
  if (!S) return null;
  const { idx, t, dt, val } = S;
  const dx = Float64Array.from(idx, (i) => (bx.v[i] - val(tx, i)) * aspect), dy = Float64Array.from(idx, (i) => by.v[i] - val(ty, i));
  let both = 0;
  for (let i = 0; i < dx.length; i++) if (dx[i] === dx[i] && dy[i] === dy[i]) both++;
  if (both < SIX.MIN_FRAMES) return null;
  const ax = strokeAxis(run, dx, dy, dt, t0, t1, aspect), u = ax.u, n = upPerp(u);
  const { grp, fitOf } = groupFits(run, t0, t1, t, dt, polys, aspect);
  const mB = grp(B), mT = grp(T);
  const fB = fitOf(mB, u), fT = fitOf(mT, u);
  const N = t.length, nan = () => new Float64Array(N).fill(NaN);
  const m = {
    across: Float64Array.from(dx, (x, i) => x * n[0] + dy[i] * n[1]), horiz: Float64Array.from(dx, (x) => -x), vert: Float64Array.from(dy, (y) => -y),
    rot: fB ? Float64Array.from(fB.rot, (r, i) => -(r - (fT ? fT.rot[i] : 0))) : nan(),
    scale: fB ? Float64Array.from(fB.lsz, (l, i) => l - (fT ? fT.lsz[i] : 0)) : nan(),
    prof: fB ? fB.prof : nan(), aniso: fB ? fB.aniso : nan(), anisoXY: fB ? fB.anisoXY : nan(),
  };
  // paw-5r1: where the Bottom's own left is in the picture, from its painted paired parts (sem_c1_<part>_l / _r): mean vectors over the shot
  const mean2 = (xs, ys) => { let sx = 0, sy = 0, c = 0; for (let i = 0; i < xs.length; i++) if (xs[i] === xs[i] && ys[i] === ys[i]) { sx += xs[i]; sy += ys[i]; c++; } return c >= SIX.MIN_FRAMES ? [sx / c, sy / c] : null; };
  const centre = (g) => (C[`sem_${g}_x`] && C[`sem_${g}_y`] ? mean2(idx.map((i) => val(C[`sem_${g}_x`], i) * aspect), idx.map((i) => val(C[`sem_${g}_y`], i))) : null);
  const c0 = centre(B);
  let lside = null;
  for (const p of PAIRED) {
    const L = centre(`c1_${p}_l`), R = centre(`c1_${p}_r`);
    const v = L && R ? [L[0] - R[0], L[1] - R[1]] : L && c0 ? [L[0] - c0[0], L[1] - c0[1]] : R && c0 ? [c0[0] - R[0], c0[1] - R[1]] : null;
    if (v) lside = lside ? [lside[0] + v[0], lside[1] + v[1]] : v;
  }
  const dmean = mean2(dx, dy);
  return { t, dt, s: Float64Array.from(dx, (x, i) => x * u[0] + dy[i] * u[1]), m, bottom: B, top: T, solo: !fT, axis: ax.from, u, n, lside, d: dmean,
    members: { bottom: mB ? mB.ids.size + (mB.how === 'poly' ? 'p' : '') : 0, top: mT ? mT.ids.size + (mT.how === 'poly' ? 'p' : '') : 0 } };
}

/**
 * paw-jyde.11: the solo reading: one character's hips against the frame, expressed in its own body frame (see the header).
 * opts.cam = {run (or () => run): the run with its centres camera-handled as the shot says (runs-channel.js camInput), removed:
 * the camera is taken out of them, tag: the shot's camera tag}; absent: the stored centres (camera removed when the run has a
 * camera path, cam_x). -> the measure() shape with m: {fside, fup, frot, fscale, fprof, faniso}, s = fup (the bounce), u = the
 * body's up, n = its picture-left, top: null, and vsFrame {who, ref, refGuess, removed, tag, camLeak, others} | null.
 */
function measureSolo(run, t0, t1, { aspect = 16 / 9, polys = {}, cam = null, view = null } = {}) {
  const C0 = run?.channels || {}, cr = typeof cam?.run === 'function' ? cam.run() : cam?.run, C = cr?.channels || C0;
  const seen = (c) => { let k = 0; for (let i = 0; i < c.t.length; i++) if (c.t[i] >= t0 && c.t[i] < t1 && c.v[i] === c.v[i]) k++; return k; };
  const H = SOLO_HIPS.find((g) => C[`sem_${g}_x`] && C[`sem_${g}_y`] && seen(C[`sem_${g}_x`]) >= SIX.MIN_FRAMES);
  if (!H) return null;
  const who = H === 'hips' ? null : H.slice(0, -5), pre = who ? who + '_' : '';
  const hx = C[`sem_${H}_x`], hy = C[`sem_${H}_y`], S = samplesOf(hx, t0, t1);
  if (!S) return null;
  const { idx, t, dt, val } = S;
  const cx = Float64Array.from(idx, (i) => hx.v[i] * aspect), cy = Float64Array.from(idx, (i) => hy.v[i]);
  const mean2 = (xs, ys) => { let sx = 0, sy = 0, c = 0; for (let i = 0; i < xs.length; i++) if (xs[i] === xs[i] && ys[i] === ys[i]) { sx += xs[i]; sy += ys[i]; c++; } return c >= SIX.MIN_FRAMES ? [sx / c, sy / c] : null; };
  /** part g of the same character relative to the hips, averaged over the shot (frame heights) | null */
  const offset = (g) => { const k = `sem_${pre}${g}`; return C[k + '_x'] && C[k + '_y'] ? mean2(idx.map((i, q) => val(C[k + '_x'], i) * aspect - cx[q]), idx.map((i, q) => val(C[k + '_y'], i) - cy[q])) : null; };
  const { grp, fitOf, longAxis } = groupFits(run, t0, t1, t, dt, polys, aspect);
  const mH = grp(H);
  let U = null, ref = null;
  for (const g of ['torso', 'head']) { const v = offset(g), L = v ? Math.hypot(v[0], v[1]) : 0; if (L > SOLO_REF_MIN) { U = [v[0] / L, v[1] / L]; ref = g; break; } }
  // paw-jyde.13: no torso / head: the up from evidence, not the hips' long axis (seen from behind, hips are wider than tall)
  const vt = view && !view.guessed ? (view.pov && view.view === 'top' ? 'rear' : view.view) : null;   // tagged (POV alone reads as rear)
  const len = (v) => (v ? Math.hypot(v[0], v[1]) : 0), unit = (v) => [v[0] / len(v), v[1] / len(v)], dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const up = {
    // the legs lie below the hips: up = from them to the hips, only when two thighs or a thigh and a shin agree within 45 deg
    legs: () => {
      const V = {}, use = new Set();
      for (const g of LEGS.slice(0, 4)) { const v = offset(g); if (len(v) > SOLO_REF_MIN) V[g] = unit([-v[0], -v[1]]); }
      for (const a of ['thighs_l', 'thighs_r']) for (const b in V) if (a !== b && V[a] && dot(V[a], V[b]) >= Math.SQRT1_2) use.add(a).add(b);
      return use.size ? unit([...use].reduce((s, g) => [s[0] + V[g][0], s[1] + V[g][1]], [0, 0])) : null;
    },
    // painted left / right pairs give the left-right line: up across it, toward the hips from the legs, else up in the picture
    sides: () => {
      let lr = [0, 0];
      for (const p of PAIRED) { const L = offset(`${p}_l`), R = offset(`${p}_r`); if (L && R) lr = [lr[0] + L[0] - R[0], lr[1] + L[1] - R[1]]; }
      if (len(lr) <= SOLO_REF_MIN) return null;
      const a = unit([-lr[1], lr[0]]), down = LEGS.map(offset).filter(Boolean).reduce((s, v) => [s[0] + v[0], s[1] + v[1]], [0, 0]);
      return len(down) > SOLO_REF_MIN ? (dot(a, down) > 0 ? [-a[0], -a[1]] : a) : upOrRight(a);
    },
    // rear / front / top: the hips' long axis is their left-right, so up is the short one
    'short axis': () => { const a = longAxis(mH); return a && upOrRight([a[1], -a[0]]); },
  };
  // rear / front / top: the left-right line lies in the picture (the strongest cue); side: it runs along the camera, and so does the long axis
  for (const g of U ? [] : vt === 'side' ? ['legs'] : vt ? ['sides', 'legs', 'short axis'] : ['legs', 'sides']) { const v = up[g](); if (v) { U = v; ref = g; break; } }
  if (!U) { U = [0, -1]; ref = 'vertical'; }
  const n = [U[1], -U[0]], fH = fitOf(mH, U), N = t.length, nan = () => new Float64Array(N).fill(NaN);
  const fup = Float64Array.from(cx, (x, i) => x * U[0] + cy[i] * U[1]);
  const m = {
    fside: Float64Array.from(cx, (x, i) => x * n[0] + cy[i] * n[1]), fup,
    frot: fH ? Float64Array.from(fH.rot, (r) => -r) : nan(), fscale: fH ? fH.lsz : nan(), fprof: fH ? fH.prof : nan(), faniso: fH ? fH.aniso : nan(),
  };
  const c0 = mean2(cx, cy);
  const centre = (g) => (C[`sem_${g}_x`] && C[`sem_${g}_y`] ? mean2(idx.map((i) => val(C[`sem_${g}_x`], i) * aspect), idx.map((i) => val(C[`sem_${g}_y`], i))) : null);
  let lside = null;
  for (const p of PAIRED) {
    const L = centre(`${pre}${p}_l`), R = centre(`${pre}${p}_r`);
    const v = L && R ? [L[0] - R[0], L[1] - R[1]] : L && c0 ? [L[0] - c0[0], L[1] - c0[1]] : R && c0 ? [c0[0] - R[0], c0[1] - R[1]] : null;
    if (v) lside = lside ? [lside[0] + v[0], lside[1] + v[1]] : v;
  }
  const others = ['c1', 'c2', 'x'].filter((w) => w !== who && Object.keys(C0).some((k) => k.startsWith(`sem_${w}_`) && k.endsWith('_x') && seen(C0[k]) >= SIX.MIN_FRAMES));
  const removed = cam && 'removed' in cam ? !!cam.removed : !!C0.cam_x, tag = cam?.tag || null;
  return { t, dt, s: fup, m, bottom: H, top: null, solo: true, axis: 'body', u: U, n, lside, d: null,
    vsFrame: { who, ref, refGuess: ref !== 'torso' && ref !== 'head', removed, tag, camLeak: !removed && !!tag && tag !== 'static', others },
    members: { bottom: mH ? mH.ids.size + (mH.how === 'poly' ? 'p' : '') : 0, top: 0 } };
}

/**
 * One shot's secondary axes. meas = measure(...); view / guessed = viewFor(...); flips = axes to negate (shot.axflip).
 * -> {view, guessed, axes: {axis: {label: 'measured' | 'estimate' | 'none', kind, conf, from (measurement), amp (0..100
 * half-range of the output), stats {lock, chance, noise, coverage}, y (Float64Array 0..100 | null), script [{at, pos}]}}}
 */
export function deriveShot(meas, { view = 'side', guessed = false, flips = [], pov = false, skip = null } = {}) {
  const out = { view, guessed, axes: {} };
  // paw-2lp7.1: a positioning range (skip [[t0, t1]], the shot's) is a gap in every measurement: no amplitude, lock or noise
  // is read there and the axis fades to 50 around it like an untracked stretch; coverage counts the rest of the shot only
  const inSkip = skip?.length ? Array.from(meas.t, (t) => skip.some(([a, b]) => t >= a && t < b)) : null, nSkip = inSkip ? inSkip.filter(Boolean).length : 0;
  const gap = (x) => (inSkip ? Float64Array.from(x, (v, i) => (inSkip[i] ? NaN : v)) : x);
  // paw-jyde.11: a solo reading has its own table; a POV shot with no angle reads like rear (the dancer faces or backs the camera,
  // which of the two only the painted sides tell: without them it is capped at estimate)
  const F = meas.vsFrame, sv = F && pov && view === 'top' ? 'rear' : view;
  const table = F ? SOLO_TABLE[sv] || SOLO_TABLE.side : VIEW_TABLE[view] || VIEW_TABLE.side, bySides = sideSigns(meas, sv);
  const facing = F && sv !== view && !Object.keys(bySides).length;
  if (F) out.frame = { ...F, facing: !!facing, view: sv };
  const sC = condition(meas.s, meas.dt).y;
  for (const axis of SECONDARY) {
    const row = table[axis];
    if (!row) { out.axes[axis] = { label: 'none', kind: null, conf: 0, from: null, amp: 0, y: null, script: [] }; continue; }
    const [name, sign0, kind] = row, raw = gap(name === 'aniso' && (view === 'rear' || view === 'front') ? meas.m.anisoXY : meas.m[name]);
    const valid = fin(raw).length, coverage = valid / Math.max(1, raw.length - nSkip);
    if (valid < SIX.MIN_FRAMES) { out.axes[axis] = { label: 'none', kind, conf: 0, from: name, amp: 0, y: null, script: [] }; continue; }
    const { hp, y: x } = condition(raw, meas.dt);
    const L = lockR2(Array.from(x), Array.from(sC)), noise = noiseShare(Array.from(hp));
    const lock = clamp01((L.real - L.chance) / (1 - L.chance || 1));
    const relative = name === 'rot' || name === 'scale';
    let conf = clamp01(1 - noise / SIX.NOISE) * (0.5 + 0.5 * lock) * coverage * (kind === E ? SIX.ESTIMATE_W : 1) * (guessed ? SIX.GUESS_W : 1) * (relative && meas.solo ? SIX.SOLO_W : 1);
    const refGuess = F && F.refGuess && REF_DEP.has(name);   // paw-jyde.11: rot / scale need no up direction; the rest do
    if (F) conf *= (refGuess ? SIX.GUESS_W : 1) * (facing ? SIX.GUESS_W : 1) * (F.camLeak ? SIX.CAM_W : 1);
    const label = conf >= SIX.MEASURED && kind === M && !guessed && !refGuess && !facing ? 'measured' : conf >= SIX.ESTIMATE ? 'estimate' : 'none';
    const stats = { lock: +L.real.toFixed(3), chance: +L.chance.toFixed(3), noise: +noise.toFixed(3), coverage: +coverage.toFixed(3) };
    if (label === 'none') { out.axes[axis] = { label, kind, conf, from: name, amp: 0, stats, y: null, script: [] }; continue; }
    const sign = (bySides[axis] ?? sign0) * (flips.includes(axis) ? -1 : 1), band = BAND[axis], gain = (band * conf) / Math.max(p95abs(x), FLOOR[name]);
    const env = fadeEnvelope(raw.map((v, i) => (v === v || x[i] === x[i] ? 0 : NaN)), meas.dt);   // NaN only where the bridge did not reach
    let y = Float32Array.from(x, (v, i) => (v === v ? Math.max(-band, Math.min(band, sign * v * gain)) * env[i] : 0));
    y = run1(slew, y, { maxPerSec: SPEED[axis] }, meas.dt);
    const yy = Float64Array.from(y, (v) => 50 + v), amp = +Math.max(...Array.from(yy, (v) => Math.abs(v - 50))).toFixed(1);
    if (amp < SIX.MIN_AMP) { out.axes[axis] = { label: 'none', kind, conf, from: name, amp, stats, y: null, script: [] }; continue; }   // confident but nothing moves
    out.axes[axis] = { label, kind, conf, from: name, amp, stats, y: yy, script: pointsOf(yy, meas.t[0], meas.dt, meas.t[meas.t.length - 1]), ...(axis in bySides ? { signFrom: 'sides' } : {}) };
  }
  return out;
}

/** paw-5r1: {axis: +1 | -1} for the axes of this view whose sign the Bottom's painted sides decide (SIDE_AXES), {} when they cannot
 *  (no painted paired part of the Bottom, a side view, or its left lies too much across the reference to tell). */
export function sideSigns(meas, view) {
  const L = meas?.lside, axes = (meas?.vsFrame ? SOLO_SIDE_AXES : SIDE_AXES)[view], out = {};
  if (!L || !axes) return out;
  const len = Math.hypot(L[0], L[1]);
  if (!(len > 1e-6)) return out;
  const along = (r) => { const c = (L[0] * r[0] + L[1] * r[1]) / (len * Math.hypot(r[0], r[1])); return Math.abs(c) >= SIDE_MIN_COS ? Math.sign(c) : 0; };
  if (meas.vsFrame) { const h = along(meas.n); if (h) for (const a of axes) out[a] = h; return out; }   // paw-jyde.11: + = its left on its picture-left (n)
  if (view === 'rear' || view === 'front') { const h = along([-1, 0]); if (h) for (const a of axes) out[a] = h; return out; }   // + = the Bottom's left on the picture's left (seen from behind)
  const sway = along(meas.n);
  if (sway) out.sway = sway;
  const S = meas.d, ls = S && Math.hypot(S[0], S[1]);
  if (ls > 1e-6) { const det = (S[0] * L[1] - S[1] * L[0]) / (ls * len); if (Math.abs(det) >= SIDE_MIN_COS) out.roll = Math.sign(det); }
  return out;
}

/** Editable points from a 0..100 series on a uniform grid: the extremes (graph sig.toScript), 50 at both ends. */
export function pointsOf(y, t0, dt, tEnd) {
  const s = toScript.eval({ signal: { i0: 0, dt, v: Float32Array.from(y) } }, { mode: 'extremes', minProminence: 1, minGapMs: 80, everyMs: 100, tolerance: 1, gaps: 'break', maxBridgeMs: 400 }, gridCtx(y.length, dt)).script;
  const pts = s.map((a) => ({ at: Math.round(t0 + a.at), pos: Math.round(Math.max(0, Math.min(100, a.pos))) }));
  const out = [{ at: Math.round(t0), pos: 50 }];
  for (const p of pts) if (p.at > out[out.length - 1].at && p.at < Math.round(tEnd)) out.push(p);
  out.push({ at: Math.round(tEnd), pos: 50 });
  return out.filter((p, i) => i === 0 || i === out.length - 1 || !(p.pos === 50 && out[i - 1].pos === 50 && out[i + 1].pos === 50));
}
