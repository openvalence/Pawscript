// rederive.js -- a finished points run's derived channels recomputed from what it stored, no sidecar, no GPU (paw-a3n).
// Pure (test/rederive.test.mjs; parity with the sidecar: test/fixtures/rederive-run.json from trackers/tests/rederive_fixture.py).
//
// What a points run stores (cotracker_points / tapnext_points, kept in the .pawruns): per frame the seed-anchored image
// centroid (centroid_x / _y), the camera path (cam_x / _y: cumulative background motion since the run scene's start,
// cam_conf), every group's / part's / pinned group's / character's centre in the BACKGROUND frame ({X}_x / _y, camera
// removed: + cam = image position), and the point tracks (frames.ov[i].pts [x, y, visible, motion group]). The projected
// channels (proj, proj_cam, {X}_proj, pair_proj, who_*_proj) are stroke_proj over those, per run scene: this module redoes
// that with other post-tracking choices, per run scene:
//   derive = {cam?: {mode, strength, source, smoothMs}, axis?: {mode, x0, y0, x1, y1}} (a shot's `derive`; absent = as tracked)
//   cam.mode  auto = the sidecar's camera path (translation), as tracked | off = no camera removal (image positions) |
//             move / zoom / full = the camera re-estimated from the stored point tracks: translation / + scale / + rotation
//   cam.source (move / zoom / full)  background = the static points (motion group 0) | all = every visible point
//   cam.strength 0..100 % of the camera removed (the transform's parameters scaled), cam.smoothMs = the camera path's
//             moving average (ms) before removal
//   axis.mode auto = the principal axis of the motion | vertical (up = out) | horizontal (right = out) | custom (the
//             arrow x0,y0 = out end -> x1,y1 = in end, normalised: toward the in end = lower)
// With a camera override every signal of the scene is "camera handled" the same way, so proj = proj_cam there.

import { sceneAt } from './runs.js';
import { detailSpans } from './detail.js';
import { sceneCamera, sceneWheres, sceneWhats } from '../features/timeline/acts.js';
import { anchorsIn } from './anchors.js';

export const CAM_MODES = ['auto', 'off', 'move', 'zoom', 'full'];
export const CAM_SOURCES = ['background', 'all'];
export const CAM_DEFAULT = { mode: 'auto', strength: 100, source: 'background', smoothMs: 0 };
/** paw-hiq5: a camera TAG's default camera removal: a turntable orbits the action and a rides-the-stroke camera carries the
 *  stroke, so removing the camera there is wrong unless asked for. A default only: anything chosen beats it (effectiveCam). */
export const CAM_TAG_DEFAULT = { orbit: 'off', reciprocal: 'off', pov: 'off' };   // pov: the camera is a character's eyes (paw-2vd5)
export const CAM_TAG_LABEL = { orbit: 'turntable', reciprocal: 'rides the stroke', pov: 'POV' };
/** Shot's camera-tag default {tag, label, cam} (cam = a full camera object, mode per CAM_TAG_DEFAULT) or null. */
export function camTagDefault(shot) {
  const tag = shot ? sceneCamera(shot) : null;
  return tag && CAM_TAG_DEFAULT[tag] ? { tag, label: CAM_TAG_LABEL[tag], cam: { ...CAM_DEFAULT, mode: CAM_TAG_DEFAULT[tag] } } : null;
}
/**
 * The camera removal that applies, by precedence: the range override's own `cam` > the shot's Adjust `cam` > the camera tag's
 * default > as tracked. Whatever the owner chose is explicit and wins; the tag is only inferred. -> {cam (full object), from:
 * 'override' | 'adjust' | 'tag' | 'tracked', tag: the tag default | null}. tagDef = camTagDefault(shot); derive / span may be null.
 */
export function effectiveCam(tagDef, derive, span) {
  const base = { ...CAM_DEFAULT }, tag = tagDef || null;
  if (span?.cam) return { cam: { ...base, ...span.cam }, from: 'override', tag };
  if (derive?.cam && !derive.cam.tag) return { cam: { ...base, ...derive.cam }, from: 'adjust', tag };
  if (tag) return { cam: { ...tag.cam }, from: 'tag', tag };
  return { cam: base, from: 'tracked', tag };
}
export const DERIVE_AXES = ['auto', 'vertical', 'horizontal', 'custom'];
const PTS_MODES = new Set(['move', 'zoom', 'full']);
// paw-9qm (lib/signal-source.js): a shot's signal source and what it is measured against
export const AGAINST_KEY = /^(sem_[a-z0-9_]+|g[1-4](p[12])?)$/;
const SOURCE_ID = /^[A-Za-z0-9_:~.-]{1,160}$/;
/** The derive with its `against` applied to the camera: 'none' = no camera removal (image positions). */
export const withAgainst = (d) => (d?.against === 'none' ? { ...d, cam: { ...CAM_DEFAULT, mode: 'off' } } : d);
const BASE = /^(g[1-4](p[12])?|sem_[a-z0-9_]+|who_(?:c[12]|x))$/;
const fin = Number.isFinite;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Shot's derive for run `id` (paw-xyu9): the run's own entry (shot.derives[id], `{}` = as tracked on purpose), else the shot's
 *  shared `derive` (older projects: every run of the shot). */
export const deriveOf = (shot, id) => (id && shot?.derives && id in shot.derives ? shot.derives[id] : shot?.derive);
/** The shots as run `id` sees them: `derive` = its own. Same array when no shot has run entries. */
export const shotsFor = (shots, id) => (id && shots.some((s) => s?.derives && id in s.derives) ? shots.map((s) => (s?.derives && id in s.derives ? { ...s, derive: s.derives[id] } : s)) : shots);

/** Shot x with run `id`'s derive set to `next` (null = as tracked): only that run's entry changes; with no run (nothing covers
 *  the shot) the shared `derive`. An empty entry is dropped unless a shared `derive` is there to be overridden. */
export function withDerive(x, id, next) {
  const { derive, derives, ...rest } = x;
  if (!id) return { ...rest, ...(derives ? { derives } : {}), ...(next ? { derive: next } : {}) };
  const own = { ...(derives || {}) };
  if (next || derive) own[id] = next || {}; else delete own[id];
  return { ...rest, ...(derive ? { derive } : {}), ...(Object.keys(own).length ? { derives: own } : {}) };
}

/**
 * paw-lji3 / paw-83sq: a new run's settings on the shots it covers (middle inside its range, skip(i) false), written once when
 * it arrives. A shot takes what it had on the run it re-tracks (prev(i): that run's id; else its own entry for this id: a
 * discarded run of the same number left it) without that run's own flip (unflip) or a source this run lacks (source(name)
 * false), and Smart stroke on where this run can fuse (fuse) unless that says on or off. With no earlier run and no fusion
 * nothing is written (older runs and absent flags play as they did). -> shots (the same array when nothing changes).
 */
export function arrivalShots(shots, run, { prev = () => null, fuse = false, source = () => true, skip = () => false } = {}) {
  const J = JSON.stringify;
  let hit = false;
  const out = shots.map((s, i) => {
    const m = (s.start_ms + s.end_ms) / 2, p = run?.id && m >= run.range.start && m < run.range.end && !skip(i) ? prev(i) : undefined;
    if (p === undefined || (!p && !fuse)) return s;
    const { unflip: _u, ...d } = deriveClean(deriveOf(s, p || run.id)) || {};   // eslint-disable-line no-unused-vars
    if (d.source && !source(d.source)) delete d.source;
    if (typeof d.smart !== 'boolean' && fuse) d.smart = true;
    const next = deriveClean({ ...d, match: true });   // paw-s80k: written now, so it plays the way up of the scene's channel (setDerive)
    if (!next || J(next) === J(deriveClean(deriveOf(s, run.id)))) return s;
    hit = true;
    return withDerive(s, run.id, next);
  });
  return hit ? out : shots;
}

/** A shot's derive from a file / an edit -> the overrides only ({cam?, axis?}), or null (as tracked). */
export function deriveClean(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {}, c = d.cam;
  if (c && typeof c === 'object') {
    const cam = {
      mode: CAM_MODES.includes(c.mode) ? c.mode : 'auto',
      strength: fin(+c.strength) ? clamp(Math.round(+c.strength), 0, 100) : 100,
      source: CAM_SOURCES.includes(c.source) ? c.source : 'background',
      smoothMs: fin(+c.smoothMs) ? clamp(Math.round(+c.smoothMs), 0, 5000) : 0,
    };
    const diff = Object.fromEntries(Object.entries(cam).filter(([k, v]) => v !== CAM_DEFAULT[k]));
    if (Object.keys(diff).length) out.cam = { ...CAM_DEFAULT, ...diff };
    else if (c.explicit === true) out.cam = { ...CAM_DEFAULT, explicit: true };   // paw-hiq5: a chosen 'auto' beats a camera tag's default off
  }
  const a = d.axis;
  if (a && DERIVE_AXES.includes(a.mode)) {
    if (a.mode !== 'custom') out.axis = { mode: a.mode };
    else if ([a.x0, a.y0, a.x1, a.y1].every((v) => fin(v) && v >= 0 && v <= 1) && (a.x0 !== a.x1 || a.y0 !== a.y1)) {
      const r = (v) => Math.round(v * 1e4) / 1e4;
      out.axis = { mode: 'custom', x0: r(a.x0), y0: r(a.y0), x1: r(a.x1), y1: r(a.y1) };
    }
  }
  if (typeof d.source === 'string' && SOURCE_ID.test(d.source)) out.source = d.source;   // paw-9qm: the shot's signal source
  if (d.against === 'none' || (typeof d.against === 'string' && AGAINST_KEY.test(d.against))) out.against = d.against;   // 'camera' = the default
  // paw-e3i: Smart stroke (fused parts + new strokes). paw-lji3: false = turned off on purpose (a new run arrives with it on:
  // arrivalShots); absent = off too, as every run tracked before that keeps playing. Only true is on, everywhere.
  if (typeof d.smart === 'boolean') out.smart = d.smart;
  if (d.unflip === true && (out.source === 'shaft' || String(out.source || '').startsWith('part:'))) out.unflip = true;   // paw-4c48.10: picking Shaft (or a depth part, paw-4c48.19) cleared the shot's earlier flip (runs-channel.js)
  if (d.anchorTo === 'in' || d.anchorTo === 'out') out.anchorTo = d.anchorTo;   // paw-2ntn: shorter strokes pinned fully in / out (runs-channel.js anchorStrokes; absent = the middle)
  if (typeof d.held === 'boolean') out.held = d.held;   // paw-rnv1: the twos / threes retime chosen for this shot (lib/held.js; absent = its default)
  if (d.strokes && typeof d.strokes === 'object') {   // paw-e3i: the new strokes step on this shot (strokes.js), its overrides
    const S = { minStroke: [0, 0.5], minMs: [0, 1000], detail: [0, 50], maxSpeed: [0, 2000], smoothMs: [0, 1000], amount: [0, 0.9], centreMs: [1000, 120000] }, o = {};   // paw-woz5: + the compressor's two handles
    for (const [k, [a, b]] of Object.entries(S)) if (fin(+d.strokes[k])) o[k] = clamp(+d.strokes[k], a, b);
    if (['scene', 'follow', 'local', 'shaft', 'compress'].includes(d.strokes.range)) o.range = d.strokes.range;
    out.strokes = o;
  }
  // paw-azd: the owner's shaft marks on this shot: the frame (ms) where it is fully out / hilted (lib/shaft.js)
  // paw-4c48: + the knot place the owner dragged on the shaft strip (a share of the full length; shown only, never used)
  const sh = d.shaft, ms = (x) => (x != null && fin(+x) && +x >= 0 ? Math.round(+x) : null), kn = sh?.knot != null && fin(+sh.knot) && +sh.knot > 0 && +sh.knot < 1.5 ? Math.round(+sh.knot * 1e4) / 1e4 : null;
  if (sh && typeof sh === 'object' && (ms(sh.out) != null || ms(sh.hilt) != null || kn != null)) out.shaft = { ...(ms(sh.out) != null ? { out: ms(sh.out) } : {}), ...(ms(sh.hilt) != null ? { hilt: ms(sh.hilt) } : {}), ...(kn != null ? { knot: kn } : {}) };
  const fu = fuseClean(d.fuse);
  if (fu) out.fuse = fu;   // paw-e3i / paw-iasp: fusion.js controls
  // paw-s80k: the shot's own signal plays the same way up as its scene's channel (runs-channel.js channelPatch); written by
  // every edit since, kept only beside a setting that changes the signal (older derives: their own orientation, as saved)
  if (d.match === true && (out.smart || out.source || out.against || out.cam || out.axis)) out.match = true;
  return Object.keys(out).length ? out : null;
}
/** A derive's (or a range override's) fusion controls -> {exclude?, pin?, pad?: {x, y} (-1..1), prior? (0..1, the act tags'
 *  strength; 1 = as designed, omitted), w?: {rowId: multiplier 0..8}, actsOff?: [act id] (paw-439e)} | null (all at their defaults). */
export function fuseClean(f) {
  if (!f || typeof f !== 'object') return null;
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && x))].sort() : []), r2 = (v) => Math.round(v * 100) / 100;
  const out = {}, ex = ids(f.exclude), pin = ids(f.pin), ao = ids(f.actsOff);
  if (ex.length) out.exclude = ex;
  if (pin.length) out.pin = pin;
  if (ao.length) out.actsOff = ao;   // paw-439e: act tags of the scene that do not apply to this shot / run
  const p = f.pad;
  if (p && typeof p === 'object') { const x = fin(+p.x) ? r2(clamp(+p.x, -1, 1)) : 0, y = fin(+p.y) ? r2(clamp(+p.y, -1, 1)) : 0; if (x || y) out.pad = { x, y }; }
  if (fin(+f.prior) && f.prior !== null && +f.prior !== 1) out.prior = r2(clamp(+f.prior, 0, 1));
  const w = f.w && typeof f.w === 'object' ? Object.entries(f.w).filter(([k, v]) => typeof k === 'string' && k && fin(+v) && v !== null && Math.abs(+v - 1) > 1e-3) : [];
  if (w.length) out.w = Object.fromEntries(w.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, r2(clamp(+v, 0, 8))]));
  // paw-0sn8: the fusion panel's Signal chips (lib/fusion.js FUSE.JIT), only what differs from the defaults: direction on, smoothing off
  const j = f.jit && typeof f.jit === 'object' ? { ...(f.jit.dir === true ? { dir: true } : {}), ...(f.jit.refine === 0 ? { refine: 0 } : {}) } : {};
  if (Object.keys(j).length) out.jit = j;
  if (['pick', 'pair', 'shaft'].includes(f.depth) || /^part:[a-z0-9_]+$/.test(f.depth || '')) out.depth = f.depth;   // paw-gy1r: the level / size of the strokes from this reference (lib/depth-seat.js); absent = fusion's own; paw-4c48.19: a depth part 'part:<name>'
  return Object.keys(out).length ? out : null;
}
/** The derive changes the projected channels (camera or axis; a fuse override alone does not). */
export const reprojects = (d) => !!(d?.cam || d?.axis || d?.against === 'none');
/** ... because of something the owner set: a camera tag's default (cam.tag, runDerives) alone never swaps a shot's sidecar points. */
export const userReprojects = (d) => !!(d?.axis || d?.against === 'none' || (d?.cam && !d.cam.tag));
/** The camera part is not the tracked one (proj = proj_cam then). */
export const camOverride = (d) => !!(d?.cam || d?.against === 'none');

/** Does run scene k carry point tracks (a frame with `pts`)? */
export function hasPts(run, k = -1) {
  const fr = run?.frames, sc = run?.scenes || [];
  if (!fr?.ov?.length) return false;
  for (let i = 0; i < fr.ov.length; i++) if (fr.ov[i]?.pts?.length && (k < 0 || !sc.length || sceneAt(sc, fr.t[i]) === k)) return true;
  return false;
}

/** Why `run` cannot be re-derived ('' = it can). needPts: the asked camera mode needs the point tracks (move / zoom /
 *  full); k = the run scene (-1: any). */
export function deriveBlock(run, { needPts = false, k = -1 } = {}) {
  const ch = run?.channels || {};
  if (!run) return 'No run here';
  if (run.restored) return 'This run was rebuilt from the project without its .pawruns file (no stored tracks): re-track to adjust it';
  if (!ch.centroid_x || !ch.centroid_y) return 'This run stored no point centroid (not a points tracker, or tracked by an older sidecar): re-track with TAPNext++ to adjust it';
  if (!ch.cam_x || !ch.cam_y) return 'This run stored no camera path (older sidecar): re-track to adjust it';
  if (needPts && !hasPts(run, k)) return 'No stored point tracks in this scene (the camera from chosen points needs them): re-track; Auto / Off still work';
  return '';
}

// ---- the camera: per frame a similarity p -> c + s R(th) (p - c) + d (aspect-scaled frame units, c = frame centre) ----
const median = (a) => { const b = Float64Array.from(a).sort(), m = b.length >> 1; return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : NaN; };

/** One frame step from co-visible reference points (aspect-scaled) P (prev) -> Q (cur): [a, b, tx, ty] (q = [a -b; b a] p
 *  + t). move: median translation; zoom: + scale; full: + rotation. Least squares about the centroids, one refit
 *  without the points whose residual is over 3 x the median (and 1 px at 384). */
function stepOf(P, Q, mode) {
  const n = P.length / 2;
  if (mode === 'move') {
    const dx = new Float64Array(n), dy = new Float64Array(n);
    for (let i = 0; i < n; i++) { dx[i] = Q[2 * i] - P[2 * i]; dy[i] = Q[2 * i + 1] - P[2 * i + 1]; }
    return [1, 0, median(dx), median(dy)];
  }
  const fit = (use) => {
    let mx = 0, my = 0, nx = 0, ny = 0, m = 0;
    for (let i = 0; i < n; i++) if (use[i]) { mx += P[2 * i]; my += P[2 * i + 1]; nx += Q[2 * i]; ny += Q[2 * i + 1]; m++; }
    if (m < 3) return null;
    mx /= m; my /= m; nx /= m; ny /= m;
    let sab = 0, scr = 0, spp = 0;
    for (let i = 0; i < n; i++) if (use[i]) {
      const px = P[2 * i] - mx, py = P[2 * i + 1] - my, qx = Q[2 * i] - nx, qy = Q[2 * i + 1] - ny;
      sab += px * qx + py * qy; scr += px * qy - py * qx; spp += px * px + py * py;
    }
    if (spp < 1e-12) return [1, 0, nx - mx, ny - my];
    let a = sab / spp, b = scr / spp;
    if (mode === 'zoom') { a = Math.hypot(a, b); b = 0; }
    return [a, b, nx - (a * mx - b * my), ny - (b * mx + a * my)];
  };
  const all = new Uint8Array(n).fill(1);
  const s0 = fit(all);
  if (!s0) return null;
  const res = new Float64Array(n);
  for (let i = 0; i < n; i++) res[i] = Math.hypot(s0[0] * P[2 * i] - s0[1] * P[2 * i + 1] + s0[2] - Q[2 * i], s0[1] * P[2 * i] + s0[0] * P[2 * i + 1] + s0[3] - Q[2 * i + 1]);
  const cut = Math.max(3 * median(res), 1 / 384);
  return fit(Uint8Array.from(res, (r) => (r <= cut ? 1 : 0))) || s0;
}

const estCache = new WeakMap();
/** The raw camera of run scene samples t (sorted ms) from the point tracks: {s, th, dx, dy} Float64Arrays (cumulative from
 *  the first sample). Frames without enough reference points hold the camera. Cached per frames object. */
function estimate(run, t, mode, source, aspect) {
  const fr = run.frames, key = `${t[0]}:${t.length}:${mode}:${source}:${aspect}`;
  let c = estCache.get(fr);
  if (!c) estCache.set(fr, (c = new Map()));
  if (c.has(key)) return c.get(key);
  const at = new Map();
  for (let i = 0; i < fr.t.length; i++) if (fr.ov[i]?.pts) at.set(fr.t[i], fr.ov[i].pts);
  const n = t.length, s = new Float64Array(n).fill(1), th = new Float64Array(n), dx = new Float64Array(n), dy = new Float64Array(n);
  const cx = aspect / 2, cy = 0.5;
  let A = [1, 0, 0, 0], prev = at.get(t[0]);
  const ref = (p) => p && p[2] && (source === 'all' || p[3] === 0);
  for (let j = 1; j < n; j++) {
    const cur = at.get(t[j]);
    if (prev && cur) {
      const P = [], Q = [];
      for (let i = 0; i < Math.min(prev.length, cur.length); i++) if (ref(prev[i]) && ref(cur[i])) { P.push(prev[i][0] * aspect, prev[i][1]); Q.push(cur[i][0] * aspect, cur[i][1]); }
      const S = P.length >= 6 ? stepOf(P, Q, mode) : null;
      if (S && S.every(fin)) A = [S[0] * A[0] - S[1] * A[1], S[0] * A[1] + S[1] * A[0], S[0] * A[2] - S[1] * A[3] + S[2], S[1] * A[2] + S[0] * A[3] + S[3]];
    }
    if (cur) prev = cur;
    s[j] = Math.hypot(A[0], A[1]); th[j] = Math.atan2(A[1], A[0]);
    dx[j] = A[0] * cx - A[1] * cy + A[2] - cx; dy[j] = A[1] * cx + A[0] * cy + A[3] - cy;
  }
  const out = { s, th, dx, dy };
  c.set(key, out);
  return out;
}

/** Centred moving average of x over w samples (edge-clamped); w < 2: x. */
function movAvg(x, w) {
  const n = x.length;
  if (w < 2 || n < 2) return x;
  const h = Math.floor(w / 2), cs = new Float64Array(n + 1), out = new Float64Array(n);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); out[i] = (cs[b] - cs[a]) / (b - a); }
  return out;
}

/**
 * The camera to remove over one run scene's samples: {s, th, dx, dy} per sample (strength and smoothing applied), or
 * null = nothing to remove (off, strength 0). idx = the samples' indices into the run's channels; cam = derive.cam
 * (absent = auto at 100 %). auto = the sidecar's cam_x / cam_y (translation only).
 */
export function cameraPath(run, idx, cam, aspect) {
  const c = { ...CAM_DEFAULT, ...(cam || {}) }, k = c.strength / 100, ch = run.channels, n = idx.length;
  if (c.mode === 'off' || k <= 0 || !n) return null;
  let p;
  if (PTS_MODES.has(c.mode) && hasPts(run)) p = estimate(run, idx.map((j) => ch.centroid_x.t[j]), c.mode, c.source, aspect);
  else {
    const dx = new Float64Array(n), dy = new Float64Array(n);
    let lx = 0, ly = 0;
    for (let q = 0; q < n; q++) {
      const x = ch.cam_x.v[idx[q]], y = ch.cam_y.v[idx[q]];
      if (fin(x) && fin(y)) { lx = x * aspect; ly = y; }
      dx[q] = lx; dy[q] = ly;
    }
    p = { s: new Float64Array(n).fill(1), th: new Float64Array(n), dx, dy };
  }
  const t = ch.centroid_x.t, dt = n > 1 ? (t[idx[n - 1]] - t[idx[0]]) / (n - 1) || 1000 / 30 : 1000 / 30;
  const w = Math.round(c.smoothMs / dt) | 1;
  const ls = movAvg(Float64Array.from(p.s, Math.log), w), th = movAvg(p.th, w), dx = movAvg(p.dx, w), dy = movAvg(p.dy, w);
  return { s: Float64Array.from(ls, (v) => Math.exp(k * v)), th: Float64Array.from(th, (v) => k * v), dx: Float64Array.from(dx, (v) => k * v), dy: Float64Array.from(dy, (v) => k * v) };
}

/** Image position (aspect-scaled) -> the background frame at sample q of a cameraPath: c + R(-th) (p - c - d) / s. */
export function unwarp(path, q, x, y, aspect) {
  if (!path) return [x, y];
  const cx = aspect / 2, cy = 0.5, s = path.s[q], c = Math.cos(path.th[q]), sn = Math.sin(path.th[q]);
  const ux = (x - cx - path.dx[q]) / s, uy = (y - cy - path.dy[q]) / s;
  return [cx + c * ux + sn * uy, cy - sn * ux + c * uy];
}

// ---- projection (pawtrack cotracker_points.stroke_proj, one run scene) ----
/** Unit stroke direction for axis {mode, x0..y1} (aspect-scaled), or null for auto. Rising value = out. */
export function axisDir(axis, aspect) {
  const m = axis?.mode;
  if (m === 'vertical') return [0, -1];
  if (m === 'horizontal') return [1, 0];
  if (m === 'custom') { const dx = (axis.x1 - axis.x0) * aspect, dy = axis.y1 - axis.y0, L = Math.hypot(dx, dy); return L > 1e-6 ? [-dx / L, -dy / L] : null; }
  return null;
}
/** pawtrack pipeline.pca_axis: principal axis of rows (x, y), signed so up (else right) is positive. */
function pcaAxis(X, Y, use) {
  let n = 0, mx = 0, my = 0;
  for (let i = 0; i < X.length; i++) if (use[i]) { mx += X[i]; my += Y[i]; n++; }
  mx /= n || 1; my /= n || 1;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < X.length; i++) if (use[i]) { const a = X[i] - mx, b = Y[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ax = Math.cos(th), ay = Math.sin(th);
  if ((Math.abs(ay) >= Math.abs(ax) && ay > 0) || (Math.abs(ax) > Math.abs(ay) && ax < 0)) { ax = -ax; ay = -ay; }
  return { u: [ax, ay], mx, my };
}

/**
 * stroke_proj: one scene's track (X, Y aspect-scaled, NaN = lost; t ms) -> Float32Array 0..1 (NaN where lost). Gaps up to
 * gapMs inside the scene are bridged (linear), longer ones stay NaN; u = the unit direction (null: PCA, up / right
 * positive); normalised by the scene's min..max (flat: 0.5).
 */
export function strokeProj(t, X, Y, u, gapMs = 1000) {
  const n = t.length, out = new Float32Array(n).fill(NaN);
  const ok = Array.from({ length: n }, (_, i) => fin(X[i]) && fin(Y[i]));
  if (ok.filter(Boolean).length < 2) return out;
  const qx = new Float64Array(n), qy = new Float64Array(n), next = new Int32Array(n);
  for (let i = n - 1, b = -1; i >= 0; i--) { if (ok[i]) b = i; next[i] = b; }
  for (let i = 0, a = -1; i < n; i++) {   // np.interp: linear between good samples, clamped at the ends
    if (ok[i]) { qx[i] = X[i]; qy[i] = Y[i]; a = i; continue; }
    const b = next[i], j = a < 0 ? b : b < 0 ? a : -1;
    if (j >= 0) { qx[i] = X[j]; qy[i] = Y[j]; continue; }
    const f = (t[i] - t[a]) / (t[b] - t[a] || 1);
    qx[i] = X[a] + f * (X[b] - X[a]); qy[i] = Y[a] + f * (Y[b] - Y[a]);
  }
  const keep = ok.slice();
  for (let i = 0; i < n;) {
    if (ok[i]) { i++; continue; }
    let j = i;
    while (j < n && !ok[j]) j++;
    const span = (j < n ? t[j] : t[n - 1]) - (i > 0 ? t[i - 1] : t[0]);
    if (i > 0 && j < n && span <= gapMs) for (let q = i; q < j; q++) keep[q] = true;
    i = j;
  }
  let ux, uy, mx = 0, my = 0;
  if (u) [ux, uy] = u;
  else ({ u: [ux, uy], mx, my } = pcaAxis(qx, qy, keep));
  let lo = Infinity, hi = -Infinity;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) if (keep[i]) { s[i] = (qx[i] - mx) * ux + (qy[i] - my) * uy; if (s[i] < lo) lo = s[i]; if (s[i] > hi) hi = s[i]; }
  for (let i = 0; i < n; i++) if (keep[i]) out[i] = hi - lo > 1e-12 ? (s[i] - lo) / (hi - lo) : 0.5;
  return out;
}

/** groups.axis_dist / pair_dist + group_channels' 0..1: (A - B) on u (null: their difference's principal axis), sign so the
 *  mean is >= 0 (smaller = closer), min..max -> 0..1 (flat: 0.5). Arrays aspect-scaled, NaN = absent. */
function pairProj(AX, AY, BX, BY, u) {
  const n = AX.length, rx = new Float64Array(n), ry = new Float64Array(n), ok = new Uint8Array(n), out = new Float32Array(n).fill(NaN);
  let m = 0;
  for (let i = 0; i < n; i++) { rx[i] = AX[i] - BX[i]; ry[i] = AY[i] - BY[i]; if (fin(rx[i]) && fin(ry[i])) { ok[i] = 1; m++; } }
  if (m < 2) return out;
  let v = u;
  if (!v) {
    if (m >= 3) { const p = pcaAxis(rx, ry, ok); v = p.u; }
    else { let sx = 0, sy = 0; for (let i = 0; i < n; i++) if (ok[i]) { sx += rx[i]; sy += ry[i]; } v = [sx, sy]; }
  }
  const L = Math.hypot(v[0], v[1]) + 1e-12, d = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) if (ok[i]) { d[i] = (rx[i] * v[0] + ry[i] * v[1]) / L; sum += d[i]; }
  const sg = sum < 0 ? -1 : 1;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) if (ok[i]) { d[i] *= sg; lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
  for (let i = 0; i < n; i++) if (ok[i]) out[i] = hi - lo > 1e-12 ? (d[i] - lo) / (hi - lo) : 0.5;
  return out;
}

/** The run's axis as tracked (its params) in derive.axis shape. */
export function trackedAxis(run) {
  const p = run?.params || {};
  return p.axis === 'custom' ? { mode: 'custom', x0: p.axis_x0, y0: p.axis_y0, x1: p.axis_x1, y1: p.axis_y1 } : { mode: ['vertical', 'horizontal'].includes(p.axis) ? p.axis : 'auto' };
}

function chan(t, v) {
  let min = Infinity, max = -Infinity;
  for (const y of v) if (y === y) { if (y < min) min = y; if (y > max) max = y; }
  if (min > max) min = max = 0;
  const span = max - min || 1;
  return { t, v, min, max, scaled: Float32Array.from(v, (y) => (y - min) / span) };
}

/**
 * The run's channels with every run scene that has a derive (derives[k], k = run scene index; key -1 = a run without
 * scenes) recomputed: proj / proj_cam, every {X}_proj with a stored centre, and with an axis that is not auto or a zoom /
 * rotation camera also pair_proj and the characters' distances (who_pair / p1h2 / p2h1). Scenes without a derive keep
 * the stored values. force: recompute those scenes too, as tracked (the parity check). -> {channels, changed: [names]}.
 * Channels that are not pure functions of the stored centres (a part's _rel, _scale, _rot, cam_*) are never touched.
 */
export function deriveChannels(run, derives = [], { aspect = 16 / 9, force = false } = {}) {
  const ch = run?.channels || {}, cx = ch.centroid_x, cy = ch.centroid_y;
  const dOf = (k) => withAgainst(derives[k] ?? (k < 0 ? derives[0] : null) ?? null), want = (k) => force || reprojects(dOf(k));
  if (!cx || !cy || deriveBlock(run) || !(force || derives.some(reprojects) || reprojects(derives[-1]))) return { channels: ch, changed: [] };
  const t = cx.t, n = t.length, scenes = run.scenes || [], gapMs = fin(run.params?.gap_ms) ? run.params.gap_ms : 1000;
  const val = (c, j) => (c && c.t[j] === t[j] ? c.v[j] : NaN);   // channels share the frame times (one entry per frame)
  const bases = Object.keys(ch).filter((k) => k.endsWith('_proj') && BASE.test(k.slice(0, -5)) && ch[k.slice(0, -5) + '_x'] && ch[k.slice(0, -5) + '_y']).map((k) => k.slice(0, -5));
  const out = {}, put = (name, idx, vals) => {
    if (!ch[name]) return;
    if (!out[name]) out[name] = Float32Array.from(ch[name].v);
    idx.forEach((j, q) => { out[name][j] = vals[q]; });
  };
  const per = new Map();
  for (let j = 0; j < n; j++) { const k = sceneAt(scenes, t[j]); if (!per.has(k)) per.set(k, []); per.get(k).push(j); }
  for (const [k, idx] of per) {
    if (!want(k)) continue;
    const d = dOf(k), m = idx.length, ts = idx.map((j) => t[j]);
    const axis = d?.axis || trackedAxis(run), u = axisDir(axis, aspect);
    const over = camOverride(d), path = over ? cameraPath(run, idx, d.cam, aspect) : null;
    const K = idx.map((j) => [val(ch.cam_x, j) * aspect, val(ch.cam_y, j)]);
    /** image positions of base b (aspect-scaled) -> camera handled; auto: the stored background frame as is */
    const track = (b) => {
      const X = new Float64Array(m), Y = new Float64Array(m);
      for (let q = 0; q < m; q++) {
        const j = idx[q], x = val(ch[b + '_x'], j), y = val(ch[b + '_y'], j);
        if (!fin(x) || !fin(y)) { X[q] = Y[q] = NaN; continue; }
        let px = x * aspect, py = y;
        if (over) { if (b !== 'centroid') { px += K[q][0]; py += K[q][1]; } [px, py] = unwarp(path, q, px, py, aspect); }
        X[q] = px; Y[q] = py;
      }
      return [X, Y];
    };
    const [CX, CY] = track('centroid');
    put('proj', idx, strokeProj(ts, CX, CY, u, gapMs));
    if (over) put('proj_cam', idx, strokeProj(ts, CX, CY, u, gapMs));
    else put('proj_cam', idx, strokeProj(ts, CX.map((x, q) => x - K[q][0]), CY.map((y, q) => y - K[q][1]), u, gapMs));
    const tr = {};
    for (const b of bases) { tr[b] = track(b); put(b + '_proj', idx, strokeProj(ts, tr[b][0], tr[b][1], u, gapMs)); }
    if ((d?.axis && d.axis.mode !== 'auto') || ['zoom', 'full'].includes(d?.cam?.mode) || (force && axis.mode === 'custom')) {
      const pu = axis.mode === 'custom' ? [-u[0], -u[1]] : u;   // the sidecar passes the custom arrow itself (sign is fixed by the mean anyway)
      const two = largestTwo(ch, idx);
      if (two && ch.pair_proj) put('pair_proj', idx, pairProj(tr[two[0]][0], tr[two[0]][1], tr[two[1]][0], tr[two[1]][1], pu));
      const pairs = [['who_pair_proj', 'who_c1', 'who_c2'], ['who_p1h2_proj', 'sem_c1_penis', 'sem_c2_hips'], ['who_p2h1_proj', 'sem_c2_penis', 'sem_c1_hips']];
      for (const [name, a, b] of pairs) if (ch[name] && tr[a] && tr[b]) put(name, idx, pairProj(tr[a][0], tr[a][1], tr[b][0], tr[b][1], pu));
    }
  }
  const channels = { ...ch };
  for (const [name, v] of Object.entries(out)) channels[name] = chan(ch[name].t, v);
  return { channels, changed: Object.keys(out) };
}

/** The scene's two largest bodies (g{k}_n summed over idx), sorted: ['g1', 'g2'] | null. */
function largestTwo(ch, idx) {
  const tot = [1, 2, 3, 4].map((k) => { let s = 0; const c = ch[`g${k}_n`]; for (const j of idx) { const y = c?.v[j]; if (y > 0) s += y; } return [`g${k}`, s]; });
  const two = tot.filter(([g, s]) => s > 0 && ch[g + '_x']).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g).sort();
  return two.length === 2 ? two : null;
}

/**
 * Per run scene the derive of the document shot under its middle (shots = app.doc.scenes, each maybe with `derive`):
 * [derive | null] indexed like run.scenes (a run without scenes: one entry). preview = {t0, t1, derive} (a drag in
 * progress): wins for the run scenes whose middle is in [t0, t1). Every run scene under a shot carries the Detail over its
 * time (`detail`, whatever path makes its points: paw-otoh). Nothing anywhere: [].
 */
export function runDerives(run, shots = [], preview = null) {
  shots = shotsFor(shots, run?.id);
  if (preview?.run && preview.run !== run?.id) preview = null;
  const sc = run?.scenes?.length ? run.scenes : run?.range ? [{ start_ms: run.range.start, end_ms: run.range.end }] : [];
  // paw-izk: a run scene carries the Detail settings over its time (scene defaults, shot / area overrides: lib/detail.js)
  // as `detail`: strokes.js `shapes` on the strokes step, stroke-shape.js dressPoints on the sidecar's / classic points
  // paw-iasp: + the shot's act tags (`acts`: where + what), the scene type fusion.js leans on
  // paw-wg2d: + the owner's anchors inside the run scene (`anchors` [{ms, pos}], lib/anchors.js: every shot's, so the shots of
  // one tracked scene share them), fusion.js solves the scene backwards to them
  const withDetail = (d, s, shot) => { const acts = shot ? [...sceneWheres(shot), ...sceneWhats(shot)] : [], an = anchorsIn(shots, s.start_ms, s.end_ms); return { ...(d || {}), detail: detailSpans(shots, s.start_ms, s.end_ms), ...(acts.length ? { acts } : {}), ...(an.length ? { anchors: an } : {}) }; };
  const out = sc.map((s) => {
    const m = (s.start_ms + s.end_ms) / 2, k = sceneAt(shots, m), shot = shots[k], hit = shot && shot.start_ms <= m && shot.end_ms > m ? shot : null;
    const pv = preview && m >= preview.t0 && m < preview.t1, d = pv ? deriveClean(preview.derive) : hit ? deriveClean(hit.derive) : null;
    const tag = hit && !d?.cam ? camTagDefault(hit) : null;   // paw-hiq5: the camera tag's default, flagged so it never counts as a choice
    if (!pv && !hit) return null;
    return withDetail(tag ? { ...(d || {}), cam: { ...tag.cam, tag: true } } : d, s, hit);
  });
  return out.some(Boolean) ? out : [];
}

/** For the stabilised preview: the camera of run scene k at t as {x, y, s, th} (x, y frame widths / heights; s, th the
 *  zoom and rotation, 1 / 0 for a translation), with the shot's camera settings; null = nothing to remove there. */
export function cameraAtT(run, derive, t, aspect = 16 / 9) {
  const ch = run?.channels, cx = ch?.centroid_x;
  if (!cx || !ch.cam_x) return null;
  const k = sceneAt(run.scenes || [], t), sc = run.scenes || [];
  const key = JSON.stringify([k, derive?.cam || null, aspect]);
  let c = stabCache.get(run);
  if (!c || c.key !== key) {
    const idx = [];
    for (let j = 0; j < cx.t.length; j++) if (!sc.length || sceneAt(sc, cx.t[j]) === k) idx.push(j);
    c = { key, idx, path: cameraPath(run, idx, derive?.cam, aspect) };
    stabCache.set(run, c);
  }
  if (!c.path || !c.idx.length) return null;
  let lo = 0, hi = c.idx.length - 1;
  if (t < cx.t[c.idx[0]] - 1000 || t > cx.t[c.idx[hi]] + 1000) return null;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cx.t[c.idx[mid]] <= t) lo = mid; else hi = mid; }
  const q = cx.t[c.idx[hi]] <= t ? hi : lo;
  return { x: c.path.dx[q] / aspect, y: c.path.dy[q], s: c.path.s[q], th: c.path.th[q] };
}
const stabCache = new WeakMap();
