// blobs.js -- the blobs view of point runs with motion groups (settings 'tracking.trails' = 'blobs'): what the
// tracker sees, layered over the video by TrackingOverlay (heatmap, points, pinned parts, bodies, camera, primary,
// axis + pair; each its own option). Display only: nothing here changes a run. Every drawn centre, path and velocity
// is the seed-anchored one (the run's sem_<name>_x / who_<c>_x channel + cam, else the same anchoring over the pts:
// anchoredPath), never a hull centroid, so a point dropping out (a thumb behind a shaft) does not move its group.
// Pure parts (node-tested, test/tracking-overlay-blobs.test.mjs): blobOpts, lattice, velocity, polyArea, clipLine,
// pcaAxis, sampleAt, sparkSeries, primaryName, primaryTarget, cameraAt, hudRows, pointInfo, ptsCentres, anchoredPath,
// frameBodies, heatSplats, partAt, groupCentroid, similarity, robustSimilarity, carriedPoly, carriedOutline (a pinned group
// drawn as its painting carried by its live points, paw-9qim; paw-rrtw: never off them, faint when unsure).
// drawBlobsView paints one frame. Inputs are PROTOCOL data only: overlay pts [[x, y, v, g, part?, sem?, ...extra]] (v3.1;
// g = the group pass' moving group, part = 1 | 2 of body g, v3.4; sem = the pinned group, v4.6), boxes, the run's channels
// (sem_<name>_*, who_*, cam_*, proj*, dist01, ...) and its scenes' group records (runs-channel sceneGroups).

import { hull, inHull } from '../video/roi.js';
import { pathPoly, pathRect } from '../video/overlays.svelte.js';
import { lowerBound } from '../../lib/lane.js';
import { sceneAt } from '../../lib/runs.js';
import { sceneGroups, relParse, relLabel } from '../../lib/runs-channel.js';
import { seedIds, ownsAt } from '../../lib/runs-add.js';
import { lighter, semPaint, whoPaint, SEM_NAMES } from './colors.js';
import { partLabel, WHOS, whoName, whoShort, inPoly } from './groups.js';
import { placeLabels } from '../../ui/kit/curve.js';
import { SCHEMA } from '../../app/settings.svelte.js';
import { plate } from './plate.js';
import { heatGL } from './heat-gl.js';

// ---- options (settings 'tracking.blobs.<key>'; defaults and docs live in settings SCHEMA) ----
const SMOOTH_MS = { off: 0, '0.2 s': 200, '0.5 s': 500, '1 s': 1000 }, DECIM = { all: 1, '1 in 4': 4, '1 in 9': 9 }, HEAT_SHOWS = ['density', 'speed', 'both'];
const OPT = (key, label, group, extra = {}) => {
  const sc = SCHEMA['tracking.blobs.' + key];
  return { key, label, group, type: typeof sc.default === 'boolean' ? 'bool' : 'choice', default: sc.default, hint: sc.doc, ...extra };
};
/** A layer's opacity slider (0..100 %), right under its switch. */
const PCT = (key, label, group) => OPT(key, label, group, { type: 'int', control: 'slider', min: 0, max: 100, step: 5, unit: '%' });
/** Layers with their own opacity: option key -> its opacity key. */
const OPACITY = { heat: 'heatOpacity', points: 'pointsOpacity', seeded: 'seededOpacity', bodies: 'bodiesOpacity', camera: 'cameraOpacity', hulls: 'hullsOpacity' };
/** The display-options form (kit ParamForm schema). */
export const BLOB_SCHEMA = [
  OPT('follow', 'Show trackers of', 'Layers', { choices: ['selection', 'playhead'], control: 'segmented' }),
  PCT('opacity', 'Overlay opacity', 'Layers'),
  OPT('heat', 'Heatmap', 'Layers'), PCT('heatOpacity', 'Heatmap opacity', 'Layers'),
  OPT('heatSize', 'Heat size', 'Layers', { type: 'float', control: 'slider', min: 0.5, max: 4, step: 0.1, unit: '×' }),
  OPT('heatShows', 'Heat shows', 'Layers', { choices: HEAT_SHOWS, control: 'segmented' }),
  OPT('points', 'Points', 'Layers'), PCT('pointsOpacity', 'Points opacity', 'Layers'),
  OPT('seeded', 'Parts', 'Layers'), PCT('seededOpacity', 'Parts opacity', 'Layers'),
  OPT('bodies', 'Bodies', 'Layers'), PCT('bodiesOpacity', 'Bodies opacity', 'Layers'),
  OPT('camera', 'Camera', 'Layers'), PCT('cameraOpacity', 'Camera opacity', 'Layers'),
  OPT('primary', 'Primary', 'Layers'), OPT('axis', 'Axis', 'Layers'),
  OPT('labels', 'Labels', 'Layers', { choices: ['off', 'short', 'full'], control: 'segmented' }), OPT('fusion', 'Fusion view', 'Layers'),
  OPT('trails', 'Centre paths', 'Bodies'), OPT('hulls', 'Hulls', 'Bodies'), PCT('hullsOpacity', 'Hulls opacity', 'Bodies'),
  OPT('occluded', 'Occluded points', 'Points'), OPT('extra', 'Extra point flags', 'Points'), OPT('decimate', 'Points shown', 'Points', { choices: Object.keys(DECIM), control: 'segmented' }),
  OPT('smooth', 'Smoothing', 'Bodies', { choices: Object.keys(SMOOTH_MS), control: 'segmented' }),
  OPT('hud', 'Info card', 'Info'), OPT('spark', 'Sparkline', 'Info'),
];
/** get(key, fallback) (app.settings.get) -> {hulls, ..., smoothMs, decim, alpha: {heat, points, seeded, bodies, camera,
 *  hulls, other}: each layer's opacity x the overlay's, 0..1 (other = the layers without their own: primary, axis)}. */
export function blobOpts(get) {
  const o = Object.fromEntries(BLOB_SCHEMA.map((p) => [p.key, get('tracking.blobs.' + p.key, p.default)]));
  const u = (v) => (fin(v) ? Math.max(0, Math.min(1, v / 100)) : 1), all = u(o.opacity);
  const alpha = { other: all, ...Object.fromEntries(Object.entries(OPACITY).map(([k, a]) => [k, all * u(o[a])])) };
  return { ...o, smoothMs: SMOOTH_MS[o.smooth] ?? 0, decim: DECIM[o.decimate] ?? 1, alpha };
}

// ---- geometry ----
const JUMP = 0.1;   // as roi.js: a step > 0.1 frame is a re-seed (cut, chunk border), not motion
const fin = (v) => typeof v === 'number' && v === v;

/** Shoelace area of a polygon [[x, y], ...] (normalised coords: the frame fraction). */
export function polyArea(h) {
  let a = 0;
  for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}
/** The line through (px, py) along (dx, dy), clipped to the unit square -> [x0, y0, x1, y1] | null. */
export function clipLine(px, py, dx, dy) {
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d] of [[px, dx], [py, dy]]) {
    if (Math.abs(d) < 1e-12) { if (p < 0 || p > 1) return null; continue; }
    const a = (0 - p) / d, b = (1 - p) / d;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 && Number.isFinite(t0) ? [px + dx * t0, py + dy * t0, px + dx * t1, py + dy * t1] : null;
}
/** Principal axis of points xs/ys (normalised; aspect = w / h so the fit is in square pixels) -> {x, y, dx, dy} | null. */
export function pcaAxis(xs, ys, aspect = 1) {
  let n = 0, mx = 0, my = 0;
  for (let i = 0; i < xs.length; i++) if (fin(xs[i]) && fin(ys[i])) { n++; mx += xs[i]; my += ys[i]; }
  if (n < 3) return null;
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) if (fin(xs[i]) && fin(ys[i])) { const a = (xs[i] - mx) * aspect, b = ys[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
  if (sxx + syy < 1e-12) return null;
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x: mx, y: my, dx: Math.cos(th) / aspect, dy: Math.sin(th) };
}

/**
 * Decimation on a coarse lattice of the seed positions: seeds[j] = [x, y] | null -> Uint8Array keep (1 = shown),
 * about 1 in k: square cells sized so the seeds' bounding box holds n / k of them, the seed nearest each cell's centre.
 */
export function lattice(seeds, k) {
  const keep = new Uint8Array(seeds.length);
  let n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of seeds) if (s) { n++; x0 = Math.min(x0, s[0]); y0 = Math.min(y0, s[1]); x1 = Math.max(x1, s[0]); y1 = Math.max(y1, s[1]); }
  if (!n) return keep;
  const side = Math.sqrt((k * Math.max((x1 - x0) * (y1 - y0), 1e-6)) / n), best = new Map();
  seeds.forEach((s, j) => {
    if (!s) return;
    const cx = Math.floor((s[0] - x0) / side), cy = Math.floor((s[1] - y0) / side), key = cx * 65536 + cy;
    const d = (s[0] - x0 - (cx + 0.5) * side) ** 2 + (s[1] - y0 - (cy + 0.5) * side) ** 2, b = best.get(key);
    if (!b || d < b[1]) best.set(key, [j, d]);
  });
  for (const [j] of best.values()) keep[j] = 1;
  return keep;
}

/** Velocity of a path X/Y (NaN = absent) at frame i from the last ms of it: [vx, vy] per second | null. */
export function velocity(X, Y, t, i, ms = 150) {
  if (!fin(X[i])) return null;
  let k = i;
  for (let j = i - 1; j >= 0 && t[i] - t[j] <= ms; j--) {
    if (!fin(X[j]) || Math.abs(X[j] - X[j + 1]) > JUMP || Math.abs(Y[j] - Y[j + 1]) > JUMP) break;
    k = j;
  }
  const dt = (t[i] - t[k]) / 1000;
  return k < i && dt > 0 ? [(X[i] - X[k]) / dt, (Y[i] - Y[k]) / dt] : null;
}

// ---- series (run channels / samples: {t, v} typed arrays) ----
/** The value at or just before t (within maxGap ms), else NaN. */
export function sampleAt(s, t, maxGap = 250) {
  if (!s?.t?.length) return NaN;
  const i = lowerBound(s.t, t + 1) - 1;
  return i >= 0 && t - s.t[i] <= maxGap ? s.v[i] : NaN;
}
/** n evenly spaced samples of s over [t0, t1] (sampleAt each) -> Float32Array. */
export function sparkSeries(s, t0, t1, n) {
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = sampleAt(s, t0 + ((t1 - t0) * k) / Math.max(1, n - 1));
  return out;
}

// ---- the run's numbers ----
const USED = ['proj', 'dist01'];   // primary_used codes (trackers: 0 proj, 1 dist01, 2 the requested primary)
/** The data of the run's v3.2 `primary` note for the scene at t ({chosen, rule, candidates, axis, camera, sign, ...}) | null. */
export function primaryNote(run, t) {
  const k = sceneAt(run?.scenes || [], t);
  const n = (run?.notes || []).find((x) => x.code === 'primary' && x.data && typeof x.data === 'object' && (x.scene_index ?? 0) === Math.max(0, k));
  return n?.data || null;
}
/** The primary signal's name at t: the sidecar's decision record (v3.2 note), else the requested primary, else what
 *  `auto` resolved to (primary_used channel). */
export function primaryName(run, t) {
  const chosen = primaryNote(run, t)?.chosen;
  if (typeof chosen === 'string') return chosen;
  const p = run?.params?.primary;
  if (p && p !== 'auto') return p;
  const u = sampleAt(run?.channels?.primary_used, t, Infinity);
  return fin(u) ? USED[u] || 'other' : p || 'primary';
}
export const KNOWN = new Set(['proj', 'proj_cam', 'vis_frac', 'vis_extent', 'vis_len', 'dist01', 'centroid_x', 'centroid_y', 'raw_px_cam', 'raw_px', 'primary_used',
  'cam_x', 'cam_y', 'cam_conf', ...[0, 1, 2, 3].flatMap((k) => [`p${k}_x`, `p${k}_y`])]);
const SEM_CH = /^sem_/;
export const fmt = (v, d = 3) => (fin(v) ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d)) : '–');
const pct = (v) => (fin(v) ? (v * 100).toFixed(1) + ' %' : '–');

export const HUD_NAMES = { proj: 'stroke', proj_cam: 'stroke, camera out', dist01: 'click distance',
  cam_conf: 'camera confidence', vis_frac: 'points visible', confidence: 'tracker confidence' };
/**
 * The HUD's rows at time t: [{k, v, c?, sec?}] (sec starts a section). run = the selected run (null while live);
 * lane = the channel the lane uses ('primary' or a channel); body = the hovered group's frameBodies entry +
 * {g, vel}; sem = the hovered pinned group's (frameBodies S entry, hover {s}); point = pointInfo of the hovered point; aspect = w / h (speed in frame heights per second).
 */
export function hudRows({ run, t, lane = 'primary', hover = null, body = null, sem = null, point = null, aspect = 1 }) {
  const ch = run?.channels || {}, at = (k) => sampleAt(ch[k], t), rows = [];
  if (!run) return rows;
  const prim = primaryName(run, t);
  rows.push({ k: 'primary', v: `${prim} ${fmt(sampleAt(run.samples, t))}`, c: 'hi' });
  const note = primaryNote(run, t), sg = note?.sign;
  if (typeof note?.rule === 'string') rows.push({ k: 'why', v: note.rule, wide: true });
  if (sg && typeof sg === 'object') rows.push({ k: 'direction', v: [sg.applied > 0 ? '+1' : sg.applied < 0 ? '−1' : '–', sg.mode, fin(sg.score) ? 'score ' + fmt(sg.score, 2) : sg.why].filter(Boolean).join(' · ') });
  if (lane !== 'primary') rows.push({ k: 'lane', v: `${lane} ${fmt(at(lane))}`, c: 'hi' });
  // the run's numbers under short plain names (HUD_NAMES; the channel keys are in the lane picker and the Why panel)
  for (const k of ['proj', 'proj_cam', 'dist01']) if (ch[k]) rows.push({ k: HUD_NAMES[k], v: fmt(at(k)) });
  if (ch.cam_conf) rows.push({ k: HUD_NAMES.cam_conf, v: fmt(at('cam_conf'), 2) });
  if (ch.vis_frac) rows.push({ k: HUD_NAMES.vis_frac, v: fmt(at('vis_frac'), 2) });
  if (run.confidence) rows.push({ k: HUD_NAMES.confidence, v: fmt(sampleAt(run.confidence, t), 2) });
  const names = sceneGroups(run, sceneAt(run.scenes || [], t));
  const part = hover?.g && hover.p ? body?.parts?.[hover.p - 1] : null, sn = semNames(run);
  if (hover?.s && sem) {   // a pinned group (v4.6): its points, its stroke, its contraction, its share
    const key = 'sem_' + sem.name;
    rows.push({ k: `${partLabel(names[key]?.label || sem.name)} (${names[key]?.source === 'user' ? 'drawn' : 'seeded'})`, v: `${sem.n} pts`, c: 'sem-' + sem.name, sec: true });
    for (const s of ['proj', 'scale', 'n']) if (ch[`${key}_${s}`]) rows.push({ k: `${key}_${s}`, v: s === 'n' ? pct(at(`${key}_n`)) : fmt(at(`${key}_${s}`)) });
  } else if (part) {   // a part of a moving group (the overlay pts' 5th element)
    rows.push({ k: `g${hover.g}p${hover.p}`, v: `${part.n} pts`, c: 'g' + hover.g, sec: true });
  } else if (hover?.g && body) {   // a moving group of the group pass (pts' 4th element): no channels of its own
    const g = hover.g;
    rows.push({ k: `g${g}`, v: `${body.n} pts`, c: 'g' + g, sec: true });
    if (body.c) rows.push({ k: 'centroid', v: `${fmt(body.c[0])}, ${fmt(body.c[1])}` });
    if (body.vel) rows.push({ k: 'speed', v: `${fmt(Math.hypot(body.vel[0] * aspect, body.vel[1]), 2)} h/s` });
    if (body.area) rows.push({ k: 'hull area', v: pct(body.area) });
  }
  if (hover?.j != null && point) {
    rows.push({ k: `point ${point.j}`, v: point.sem ? `${partLabel(sn[point.sem - 1] || '#' + point.sem)} (${names['sem_' + sn[point.sem - 1]]?.source === 'user' ? 'drawn' : 'seeded'})` : point.g > 0 ? `g${point.g}${point.part ? ' · p' + point.part : ''}` : point.g === 0 ? 'static' : 'unassigned',
      c: point.sem ? 'sem-' + (sn[point.sem - 1] || '') : point.g > 0 ? 'g' + point.g : '', sec: true });
    rows.push({ k: point.v ? 'visible' : 'occluded', v: `${point.runFrames} fr · ${(point.runMs / 1000).toFixed(2)} s` });
    if (fin(point.speed)) rows.push({ k: 'speed', v: `${fmt(point.speed, 2)} h/s` });
    if (point.hist) rows.push({ k: 'groups', v: point.hist });
    point.extra.forEach((e, n) => rows.push({ k: `pts[${n + 6}]`, v: fmt(e) }));
  }
  if (hover) {
    const other = Object.keys(ch).filter((k) => !KNOWN.has(k) && !SEM_CH.test(k));
    if (other.length) { rows.push({ k: 'other', v: '', sec: true }); for (const k of other) rows.push({ k, v: fmt(at(k)) }); }
  }
  return rows;
}

/** Point j on frame i: {j, g, part (1 | 2 of body g, else 0), sem (its pinned group 1..3, else 0), v, runFrames / runMs
 *  (how long its current visibility has lasted, in the scene), speed (frame heights / s since the previous frame;
 *  aspect = w / h; NaN when either is occluded), hist (its group labels through the scene, run-length coded, the last
 *  5 runs), extra (pts elements beyond the pinned group, pts[6]+)}. */
export function pointInfo(fr, i, j, tMin = -Infinity, tMax = Infinity, aspect = 1) {
  const p = fr.ov[i]?.pts?.[j];
  if (!p) return null;
  let a = i, b = i;
  while (a > 0 && fr.t[a - 1] >= tMin && !!fr.ov[a - 1]?.pts?.[j]?.[2] === !!p[2]) a--;
  while (b + 1 < fr.ov.length && fr.t[b + 1] < tMax && !!fr.ov[b + 1]?.pts?.[j]?.[2] === !!p[2]) b++;
  const runs = [];
  for (let k = lowerBound(fr.t, tMin); k < fr.ov.length && fr.t[k] < tMax; k++) {
    const g = fr.ov[k]?.pts?.[j]?.[3];
    if (g == null) continue;
    if (runs.length && runs[runs.length - 1][0] === g) runs[runs.length - 1][1]++;
    else runs.push([g, 1]);
  }
  const name = (g) => (g > 0 ? 'g' + g : g === 0 ? 'static' : '–');
  return { j, g: p[3] ?? -1, part: partOf(p), sem: semOf(p), v: !!p[2], runFrames: b - a + 1, runMs: fr.t[b] - fr.t[a], extra: p.slice(6), speed: pointSpeed(fr, i, j, aspect),
    hist: runs.slice(-5).map(([g, n]) => `${name(g)}×${n}`).join(' → ') };
}

/** Point j's speed on frame i (frame heights / s from the previous frame; aspect = w / h): NaN when either frame has
 *  it occluded or it jumped (a re-seed). */
export function pointSpeed(fr, i, j, aspect = 1) {
  const p = fr.ov[i]?.pts?.[j], q = fr.ov[i - 1]?.pts?.[j], dt = (fr.t[i] - fr.t[i - 1]) / 1000;
  if (!p?.[2] || !q?.[2] || !(dt > 0) || Math.abs(p[0] - q[0]) > JUMP || Math.abs(p[1] - q[1]) > JUMP) return NaN;
  return Math.hypot((p[0] - q[0]) * aspect, p[1] - q[1]) / dt;
}

// ---- anchored centres: groups g1..g4, parts g{k}p{j}, pinned groups by id (sem#<id>: the run names them, semNames) ----
export const MAX_SEM = 32;   // pinned group ids 1..MAX_SEM (v4.6 penis / balls / hips 1..3, v4.11 user groups 4, 5, ...)
export const CENTRE_KEYS = ['g1', 'g2', 'g3', 'g4', ...[1, 2, 3, 4].flatMap((g) => [`g${g}p1`, `g${g}p2`]), ...Array.from({ length: MAX_SEM }, (_, k) => 'sem#' + (k + 1))];
const NK = CENTRE_KEYS.length, HOLD_MS = 2000;
/** The centre keys (CENTRE_KEYS indices) a pts entry belongs to, written into out (length 2); -> how many. */
function keysOf(p, out) {
  const s = semOf(p);
  if (s) { out[0] = 11 + s; return 1; }
  if (!(p[3] > 0 && p[3] <= 4)) return 0;
  out[0] = p[3] - 1;
  const pj = partOf(p);
  if (!pj) return 1;
  out[1] = 4 + (p[3] - 1) * 2 + pj - 1;
  return 2;
}
const ptsCache = new WeakMap();
/**
 * Seed-anchored centres from the pts alone (live frames carry no channels; runs without a key's channel): per key
 * and frame the mean over its members of the visible ones' positions and the hidden ones' last seen position
 * carried by the key's displacement since (the mean step of its members visible on both frames). All visible: the
 * plain mean; a member hiding moves nothing; one coming back counts where it really is. NaN while no member is
 * visible. -> {n, x: [key][frame], y}, extended when the frames grow (live), never recomputed.
 */
// ponytail: a member hidden longer than HOLD_MS (retire_ms' default) drops out of the mean (a small step then); the
// sidecar's per-window seed anchors (groups.centroid) have no such cap -- a stored run uses its channels anyway
export function ptsCentres(fr) {
  let c = ptsCache.get(fr);
  if (!c) ptsCache.set(fr, (c = { n: 0, x: CENTRE_KEYS.map(() => []), y: CENTRE_KEYS.map(() => []),
    D: CENTRE_KEYS.map(() => [0, 0]), last: CENTRE_KEYS.map(() => ({ x: [], y: [], dx: [], dy: [], t: [] })) }));
  const ks = [0, 0], sx = new Float64Array(NK), sy = new Float64Array(NK), sn = new Float64Array(NK), cx = new Float64Array(NK), cy = new Float64Array(NK), m = new Float64Array(NK), v = new Float64Array(NK);
  for (; c.n < fr.ov.length; c.n++) {
    const f = c.n, t = fr.t[f], pts = fr.ov[f]?.pts || [], prev = fr.ov[f - 1]?.pts;
    sx.fill(0); sy.fill(0); sn.fill(0); cx.fill(0); cy.fill(0); m.fill(0); v.fill(0);
    if (prev) for (let j = 0; j < pts.length; j++) {
      const p = pts[j], q = prev[j];
      if (!p[2] || !q?.[2] || Math.abs(p[0] - q[0]) > JUMP || Math.abs(p[1] - q[1]) > JUMP) continue;
      for (let e = keysOf(p, ks) - 1; e >= 0; e--) { sx[ks[e]] += p[0] - q[0]; sy[ks[e]] += p[1] - q[1]; sn[ks[e]]++; }
    }
    for (let k = 0; k < NK; k++) if (sn[k]) { c.D[k][0] += sx[k] / sn[k]; c.D[k][1] += sy[k] / sn[k]; }
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j];
      for (let e = keysOf(p, ks) - 1; e >= 0; e--) {
        const k = ks[e], L = c.last[k], D = c.D[k];
        if (p[2]) { L.x[j] = p[0]; L.y[j] = p[1]; L.dx[j] = D[0]; L.dy[j] = D[1]; L.t[j] = t; cx[k] += p[0]; cy[k] += p[1]; m[k]++; v[k]++; }
        else if (t - L.t[j] <= HOLD_MS) { cx[k] += L.x[j] + D[0] - L.dx[j]; cy[k] += L.y[j] + D[1] - L.dy[j]; m[k]++; }
      }
    }
    for (let k = 0; k < NK; k++) { c.x[k].push(v[k] ? cx[k] / m[k] : NaN); c.y[k].push(v[k] ? cy[k] / m[k] : NaN); }
  }
  return c;
}
const chanCache = new WeakMap();
/**
 * Key k's anchored path in image space over the frames (k = a CENTRE_KEYS index, or the stem 'centroid'):
 * {x, y} per frame index, NaN = absent. The run's own channel when it has one (the sidecar's seed-anchored centre;
 * camera-removed ones + cam_x / cam_y = image position, PROTOCOL v3.1), else ptsCentres (a stem without a channel:
 * null).
 */
export function anchoredPath(fr, run, k) {
  const key = typeof k === 'number' ? CENTRE_KEYS[k] : k, sid = key.startsWith('sem#') ? +key.slice(4) : 0;
  const stem = sid ? 'sem_' + (semNames(run)[sid - 1] || key) : key, ch = run?.channels, X = ch?.[stem + '_x'], Y = ch?.[stem + '_y'];
  if (!X || !Y) { if (typeof k !== 'number') return null; const p = ptsCentres(fr); return { x: p.x[k], y: p.y[k] }; }
  const hit = chanCache.get(X);
  if (hit?.fr === fr) return hit;
  const n = fr.t.length, x = new Float64Array(n), y = new Float64Array(n), cam = stem !== 'centroid';   // centroid_x / _y are image space
  for (let i = 0; i < n; i++) {
    const t = fr.t[i], ox = cam ? sampleAt(ch.cam_x, t) : 0, oy = cam ? sampleAt(ch.cam_y, t) : 0;
    x[i] = sampleAt(X, t) + (fin(ox) ? ox : 0); y[i] = sampleAt(Y, t) + (fin(oy) ? oy : 0);
  }
  const out = { fr, x, y };
  chanCache.set(X, out);
  return out;
}

// ---- per-frame bodies (cached per frames object, per frame index, per option set) ----
const seedCache = new WeakMap(), bodyCache = new WeakMap();
function keepMask(fr, i0, k) {
  let m = seedCache.get(fr);
  if (!m) seedCache.set(fr, (m = new Map()));
  const key = i0 + ':' + k;
  if (!m.has(key)) {
    const n = fr.ov[i0]?.pts?.length || 0, seeds = new Array(n).fill(null);
    let left = n;
    for (let f = i0; f < fr.ov.length && f < i0 + 600 && left; f++) {
      const pts = fr.ov[f]?.pts;
      if (!pts) continue;
      for (let j = 0; j < n; j++) if (!seeds[j] && pts[j]?.[2]) { seeds[j] = [pts[j][0], pts[j][1]]; left--; }
    }
    m.set(key, lattice(seeds, k));
  }
  return m.get(key);
}
function smoothPos(fr, i, j, h, tMin, tMax) {
  const p = fr.ov[i].pts[j];
  let sx = p[0], sy = p[1], n = 1;
  for (const dir of [-1, 1]) {
    let px = p[0], py = p[1];
    for (let k = i + dir; k >= 0 && k < fr.ov.length && Math.abs(fr.t[k] - fr.t[i]) <= h && fr.t[k] >= tMin && fr.t[k] < tMax; k += dir) {
      const q = fr.ov[k]?.pts?.[j];
      if (!q || !q[2] || Math.abs(q[0] - px) > JUMP || Math.abs(q[1] - py) > JUMP) break;
      sx += q[0]; sy += q[1]; n++; px = q[0]; py = q[1];
    }
  }
  return [sx / n, sy / n];
}
function smoothPath(X, t, i, h, tMin, tMax) {
  if (!h || !fin(X[i])) return X[i];
  let s = 0, n = 0;
  for (let k = i; k >= 0 && t[i] - t[k] <= h && t[k] >= tMin; k--) if (fin(X[k])) { s += X[k]; n++; }
  for (let k = i + 1; k < X.length && t[k] - t[i] <= h && t[k] < tMax; k++) if (fin(X[k])) { s += X[k]; n++; }
  return s / n;
}

/** A pts entry's part (v3.4 5th element: 1 | 2 of its body), else 0. */
export const partOf = (p) => (p[3] > 0 && (p[4] === 1 || p[4] === 2) ? p[4] : 0);
/** A pts entry's pinned group (6th element: v4.6 1 penis, 2 balls, 3 hips; v4.11 user groups 4, 5, ...: semNames),
 *  else 0. */
export const semOf = (p) => (Number.isInteger(p[5]) && p[5] >= 1 && p[5] <= MAX_SEM ? p[5] : 0);
const semCache = new WeakMap();
/** The run's pinned group names by id - 1: penis, balls, hips, then its scenes' groups (scenes[].groups.sem_<name>.id,
 *  PROTOCOL v4.11: any name, 'c1_penis' with v4.12). No run (live): the three. Missing ids are holes. */
export function semNames(run) {
  if (!run) return SEM_NAMES;
  let n = semCache.get(run);
  if (!n) {
    n = [...SEM_NAMES];
    (run.scenes?.length ? run.scenes : [null]).forEach((_, k) => {
      for (const [key, r] of Object.entries(sceneGroups(run, k))) if (key.startsWith('sem_') && Number.isInteger(r?.id) && r.id >= 1 && r.id <= MAX_SEM) n[r.id - 1] = key.slice(4);
    });
    for (const [id, l] of seedIds(run)) if (id >= 1 && id <= MAX_SEM) n[id - 1] = l[0].name;   // paw-o74b.1: another seed of a part: its own id, the part's name
    semCache.set(run, n);
  }
  return n;
}
// ---- a painted group's outline carried by its points (paw-9qim) ----
// The hull of a pinned group's visible points is smaller than what was painted (its points keep a seeding inset off the
// outline, ~20 of them never reach it) and shrinks as points are lost and re-seeded inside it (owner runs: hull / painted
// 0.58 on the seed frame, 0.36 at the shot's end while the part kept its size). The outline drawn is the painted
// polygon moved by the similarity its points made since their seed frame; the hull only without a painting / pairs.
// paw-rrtw: the owner's "these islands are very rigid and tend to fly around". The fit was least squares refitted once
// without the pairs off by 2.5x the median residual: a first fit dragged by many bad pairs (members slid onto the
// background, slots the tracker re-seeded elsewhere: the same index, another point) trims the wrong ones, and nothing
// checked that the moved painting still sat on the group's live members. The outline drawn is
// now the painting moved by a robust fit (least median of squares over two-pair hypotheses, refitted on the members that
// agree), drawn sure only while enough members agree, most of its seed's members are still there, its scale is
// plausible and half its live members are inside it;
// else unsure (faint, dashed): the fitted shape while it still holds half the live members, otherwise their own hull. It
// never sits where its members are not. No live members: nothing (frameBodies drops the group).
/** The k-th smallest (0-based) of a[0..n) (reordered in place; Hoare selection, no NaN). */
export function kth(a, n, k) {
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const p = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) { while (a[i] < p) i++; while (a[j] > p) j--; if (i <= j) { const x = a[i]; a[i] = a[j]; a[j] = x; i++; j--; } }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
  }
  return a[k];
}
export const OUT_IN = 0.5, OUT_MIN = 4, OUT_KEEP = 0.5, OUT_SCALE = [0.5, 2], OUT_HYP = 64;   // sure: live members inside, agreeing pairs, the seed's members still there, fit scale range; hypotheses tried
/** The similarity taking A to B (paired, normalised; aspect = w / h) fitted robustly: the two-pair hypothesis (at most
 *  OUT_HYP, spread over the pairs) with the least median residual of the other pairs, refitted by least squares on the pairs within 3x that
 *  median (at least 0.4 % of the frame height). -> {f: (p) => [x, y], n (pairs), inl (agreeing), scale} | null (< 2 pairs). */
export function robustSimilarity(A, B, aspect = 1) {
  const n = A.length;
  if (n < 2) return null;
  const X = (p) => [p[0] * aspect, p[1]], a2 = A.map(X), b2 = B.map(X);
  const lsq = (I) => {   // least squares on pairs I (as similarity(): centroids, then the complex ratio)
    let ax = 0, ay = 0, bx = 0, by = 0;
    for (const k of I) { ax += a2[k][0]; ay += a2[k][1]; bx += b2[k][0]; by += b2[k][1]; }
    ax /= I.length; ay /= I.length; bx /= I.length; by /= I.length;
    let re = 0, im = 0, den = 0;
    for (const k of I) { const p = a2[k][0] - ax, q = a2[k][1] - ay, u = b2[k][0] - bx, v = b2[k][1] - by; re += p * u + q * v; im += p * v - q * u; den += p * p + q * q; }
    return den > 0 ? { a: re / den, b: im / den, ax, ay, bx, by } : null;
  };
  // paw-bz1t: squared residuals in a reused typed array, the median by selection (the same value as sorting; the
  // comparator sort of boxed numbers and Math.hypot were ~90 % of a frame's bodies at 4096 points)
  const res2 = (m, k) => { const p = a2[k][0] - m.ax, q = a2[k][1] - m.ay, u = m.a * p - m.b * q + m.bx - b2[k][0], v = m.b * p + m.a * q + m.by - b2[k][1]; return u * u + v * v; };
  const R = new Float64Array(Math.max(1, n - 2));
  const med = (m, h, l) => { let c = 0; for (let k = 0; k < n; k++) if (k !== h && k !== l) R[c++] = res2(m, k); return c ? Math.sqrt(kth(R, c, (c - 1) >> 1)) : 0; };   // over the other pairs: three pairs judge the two-pair fit by the third
  const all = n * (n - 1) / 2, stride = Math.max(1, Math.floor(all / OUT_HYP));
  let best = null, bm = Infinity, c = 0;
  for (let h = 0, e = 0; h < n; h++) for (let l = h + 1; l < n; l++, e++) {
    if (e % stride || c >= OUT_HYP) continue;
    c++;
    const m = lsq([h, l]);
    if (!m) continue;
    const r = med(m, h, l);
    if (r < bm) { bm = r; best = m; }
  }
  if (!best) return null;
  const lim = Math.max(3 * bm, 0.004), I = [];
  for (let k = 0; k < n; k++) if (Math.sqrt(res2(best, k)) <= lim) I.push(k);
  const m = (I.length >= 2 && lsq(I)) || best;
  return { f: ([x, y]) => { const p = x * aspect - m.ax, q = y - m.ay; return [(m.a * p - m.b * q + m.bx) / aspect, m.b * p + m.a * q + m.by]; }, n, inl: I.length, scale: Math.hypot(m.a, m.b) };
}
/** Member pairs of pinned group s (pts[5] = s, visible on both) between the run frame nearest t0 (within 1.5 frames) and
 *  frame i -> {A, B, n0 (its members visible on the seed frame)} | null (no run frame at t0). */
function seedPairs(fr, i, s, t0) {
  if (!fin(t0) || !fr.t.length) return null;
  let k = Math.min(fr.t.length - 1, lowerBound(fr.t, t0));
  if (k > 0 && Math.abs(fr.t[k - 1] - t0) < Math.abs(fr.t[k] - t0)) k--;
  const step = fr.t.length > 1 ? (fr.t[fr.t.length - 1] - fr.t[0]) / (fr.t.length - 1) : 40;
  const p0 = fr.ov[k]?.pts, p1 = fr.ov[i]?.pts;
  if (!p0 || !p1 || Math.abs(fr.t[k] - t0) > 1.5 * step) return null;
  const A = [], B = [];
  let n0 = 0;
  for (let j = 0; j < p0.length; j++) if (semOf(p0[j]) === s && p0[j][2]) { n0++; if (j < p1.length && semOf(p1[j]) === s && p1[j][2]) { A.push(p0[j]); B.push(p1[j]); } }
  return { A, B, n0 };
}
/** Pinned group s's painted polygon `poly` (seeded on frame time t0) on frame i: moved by the robust similarity of its
 *  members from the run frame nearest t0 to frame i. -> poly | null (fewer than 3 pairs, no run frame at t0). */
export function carriedPoly(fr, i, s, poly, t0, aspect = 1) {
  if (!(poly?.length >= 3)) return null;
  const P = seedPairs(fr, i, s, t0), m = P && P.A.length >= 3 ? robustSimilarity(P.A, P.B, aspect) : null;
  return m ? poly.map(m.f) : null;
}
/** What frame i draws for pinned group s with live members `live` ([[x, y], ...], the ones drawn; default: its visible
 *  points) and its painting `poly` seeded at t0: {poly, sure, why} (why: '' when sure, else what makes it unsure, for the
 *  label's hover) | null (no live members: nothing; fewer than 3 and no fit: the points alone). */
export function carriedOutline(fr, i, s, poly, t0, aspect = 1, live = null) {
  live = live || (fr.ov[i]?.pts || []).filter((p) => semOf(p) === s && p[2]);
  if (!live.length) return null;
  const P = poly?.length >= 3 ? seedPairs(fr, i, s, t0) : null, m = P && P.A.length >= 3 ? robustSimilarity(P.A, P.B, aspect) : null;
  const own = (why) => { const h = live.length >= 3 ? hull(live) : []; return h.length >= 3 ? { poly: h, sure: false, why } : null; };
  if (!m) return own(P ? `${P.A.length} of its points still on the painted frame: their own outline` : 'its painted frame is not in this run: their own outline');
  const out = poly.map(m.f), inside = live.filter((p) => inPoly(out, p[0], p[1])).length / live.length;
  if (inside < OUT_IN) return own(`the painted shape would hold ${Math.round(inside * 100)} % of its points: their own outline`);
  const why = m.inl < OUT_MIN || m.inl < 0.5 * m.n ? `${m.inl} of ${m.n} points agree on the move` : m.inl < OUT_KEEP * P.n0 ? `${m.inl} of its ${P.n0} seeded points left` : m.scale < OUT_SCALE[0] || m.scale > OUT_SCALE[1] ? `scaled ${m.scale.toFixed(2)}x` : '';
  return { poly: out, sure: !why, why };
}

/** The painting a pinned group's outline is carried from: the one seeded on its own seed's frame (paw-o74b.1: a part
 *  painted on several frames, each seed's points under their own id), else the one nearest frame t by name. */
function paintOf(paint, name, run, id, t) {
  const l = paint?.filter((q) => q.name === name);
  if (!l?.length) return null;
  const s = seedIds(run).get(id)?.find((x) => x.own !== null), near = (x) => Math.abs(x.t_ms - (s ? s.t_ms : t));
  return l.reduce((b, q) => (near(q) < near(b) ? q : b), l[0]);
}

/**
 * What the blobs view shows of groups 1..4 on frame i: {G: [body | null] x 4, keep: Uint8Array | null}, body =
 * {n (visible members), pts (the members drawn: decimated, smoothed), hull, area (frame fraction), c (its anchored
 * centre, smoothed; image space: anchoredPath), vel ([vx, vy] /s of that path), parts: [part | null] x 2}, part =
 * {j, n, hull, c (anchored)} of all its visible members (never decimated: parts are small); S: [sem | null] x 3, the
 * pinned groups (penis, balls, hips): {s, name, n, pts, hull, c (anchored), outline?} of their visible members; outline =
 * the painted polygon carried by them (carriedPoly) when paint ([{name, poly, t_ms}]: the take's painted groups) holds
 * one by that name. run = the run
 * the frames belong to (its channels give the centres; null live). Hulls are hit areas (and the opt-in Hulls layer),
 * never a centre. Cached per frame; frames whose smoothing window is not complete yet (live) are recomputed.
 */
export function frameBodies(fr, i, { smoothMs = 0, decim = 1, tMin = -Infinity, tMax = Infinity, run = null, paint = null, aspect = 1 } = {}) {
  const key = `${smoothMs}:${decim}:${tMin}:${tMax}:${aspect}`;
  let c = bodyCache.get(fr);
  if (!c || c.key !== key || c.run !== run || c.paint !== paint) bodyCache.set(fr, (c = { key, run, paint, m: new Map() }));
  const hit = c.m.get(i);
  if (hit) return hit;
  const head = fr.ov[i]?.pts || [], h = smoothMs / 2;
  const keep = decim > 1 && head.length ? keepMask(fr, Math.min(i, lowerBound(fr.t, tMin)), decim) : null;
  const members = [[], [], [], []], n = [0, 0, 0, 0], parts = members.map(() => [[], []]), sems = Array.from({ length: MAX_SEM }, () => []), sn = semNames(run);
  for (let j = 0; j < head.length; j++) {
    const p = head[j], s = semOf(p);
    if (s && p[2] && (!run?.groupSeeds || ownsAt(run, s, fr.t[i]))) sems[s - 1].push(h ? smoothPos(fr, i, j, h, tMin, tMax) : p);   // paw-o74b.1: a seed's points where it owns the frames
    if (!p[2] || !(p[3] > 0 && p[3] <= 4)) continue;
    n[p[3] - 1]++;
    const pj = partOf(p), q = pj || !keep || keep[j] ? (h ? smoothPos(fr, i, j, h, tMin, tMax) : p) : null;
    if (pj) parts[p[3] - 1][pj - 1].push(q);
    if (q && (!keep || keep[j])) members[p[3] - 1].push(q);
  }
  const centre = (k) => {
    const P = anchoredPath(fr, run, k), x = smoothPath(P.x, fr.t, i, h, tMin, tMax), y = smoothPath(P.y, fr.t, i, h, tMin, tMax);
    return fin(x) && fin(y) ? [x, y] : null;
  };
  const partBody = (pp, j, k) => (pp.length ? { j, n: pp.length, hull: hull(pp), c: centre(k) } : null);
  const G = members.map((pts, g) => {
    if (!n[g]) return null;
    const hl = hull(pts), P = anchoredPath(fr, run, g);
    return { n: n[g], pts, hull: hl, area: hl.length >= 3 ? polyArea(hl) : 0, c: centre(g),
      vel: velocity(P.x, P.y, fr.t, i, Math.max(150, smoothMs)), parts: parts[g].map((pp, k) => partBody(pp, k + 1, 4 + g * 2 + k)) };
  });
  const S = sems.map((pp, k) => {
    if (!pp.length) return null;
    const name = sn[k] || '#' + (k + 1), g = paintOf(paint, name, run, k + 1, fr.t[i]), o = g ? carriedOutline(fr, i, k + 1, g.poly, g.t_ms, aspect, pp) : null;
    return { s: k + 1, name, pts: pp, ...partBody(pp, k + 1, 12 + k), ...(o ? { outline: o.poly, unsure: o.sure ? '' : o.why } : {}) };
  });
  const out = { G, S, keep };
  const last = fr.t[fr.t.length - 1];
  if (fr.t[i] + h < last || h === 0) c.m.set(i, out);
  return out;
}

// ---- heatmap: a soft field over each group's area ----
// Each group's splat radius follows its own point spacing (k x the median nearest-neighbour distance), so a dense grid
// merges into one surface over the body and a sparse hand still reads as a blob; the per-splat alpha is set from the
// expected overlap (pi r^2 / spacing^2 splats cover a spot) so every group's plateau reaches HEAT_TOP, dense or sparse,
// instead of saturating. Brightness: density (flat), speed, or both (speed over a floor).
export const HEAT_K = 1.6, HEAT_R_MIN = 0.015, HEAT_R_MAX = 0.08, HEAT_MAX = 2048, HEAT_FULL = 1, HEAT_TOP = 0.85;   // k; radius clamp (frame heights); decimate above; speed (h/s) at full brightness; field plateau
const HEAT_FLOOR = { both: 0.35, speed: 0.05 };   // a slow body still shows (both); speed: motion only
const HEAT_BG = 0.4;   // static / unassigned points glow dimmer: the background is not the action
/** A pts entry's colour slot: 0..3 group, 4 static, 5 unassigned, 5 + id a pinned group (6..8 penis / balls / hips). */
export const slotOf = (p) => { const s = semOf(p); return s ? 5 + s : p[3] > 0 && p[3] <= 4 ? p[3] - 1 : p[3] === 0 ? 4 : 5; };
/** Median nearest-neighbour distance of points (xs, ys; frame heights), from up to ~48 query points: NaN with < 2. */
// ponytail: sampled queries x all members (~50k distance tests at 1024 points); a grid hash if groups get much bigger
export function medianNN(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const d = [];
  for (let q = 0, step = Math.max(1, Math.floor(n / 48)); q < n; q += step) {
    let b = Infinity;
    for (let j = 0; j < n; j++) { const dx = xs[j] - xs[q], dy = ys[j] - ys[q], e = dx * dx + dy * dy; if (e > 0 && e < b) b = e; }
    d.push(b);
  }
  d.sort((a, b) => a - b);
  return Math.sqrt(d[d.length >> 1]);
}
/** A group's splat radius (frame heights) from its spacing: k x nn, clamped; no spacing (one point): the largest. */
export const heatRadius = (nn, k = HEAT_K) => (fin(nn) && nn < Infinity ? Math.max(HEAT_R_MIN, Math.min(HEAT_R_MAX, k * nn)) : HEAT_R_MAX);
/** Per-splat alpha so that the ~pi r^2 / nn^2 splats over a spot sum (source-over) to HEAT_TOP. */
export const heatAlpha = (r, nn) => { const over = fin(nn) && nn > 0 && nn < Infinity ? Math.max(1, (Math.PI * r * r) / (nn * nn)) : 1; return 1 - (1 - HEAT_TOP) ** (1 / over); };
/**
 * Frame i's splats: [{x, y, c (slotOf), r (frame heights), a (alpha)}] of the visible points (every k-th above max).
 * k = the spacing factor (Heat size), shows = 'density' | 'speed' | 'both' (speed: frame heights / s over HEAT_FULL,
 * 1 when unknown). aspect = w / h (spacing and speed in square frame heights).
 */
export function heatSplats(fr, i, aspect = 1, { k = HEAT_K, shows = 'both', max = HEAT_MAX } = {}) {
  const head = fr.ov[i]?.pts || [], out = [], X = [], Y = [], J = [];
  for (let c = 0; c < 6 + MAX_SEM; c++) { X.push([]); Y.push([]); J.push([]); }
  let nv = 0;
  for (const p of head) if (p[2]) nv++;
  const step = Math.max(1, Math.ceil(nv / max)), prev = !!fr.ov[i - 1], floor = HEAT_FLOOR[shows] ?? 0;
  for (let j = 0, n = 0; j < head.length; j++) {
    const p = head[j];
    if (!p[2] || n++ % step) continue;
    const c = slotOf(p);
    X[c].push(p[0] * aspect); Y[c].push(p[1]); J[c].push(j);
  }
  for (let c = 0; c < 6 + MAX_SEM; c++) {
    if (!J[c].length) continue;
    const nn = medianNN(X[c], Y[c]), r = heatRadius(nn, k), a0 = heatAlpha(r, nn) * (c === 4 || c === 5 ? HEAT_BG : 1);
    for (let q = 0; q < J[c].length; q++) {
      let b = 1;
      if (shows !== 'density') { const sp = prev ? pointSpeed(fr, i, J[c][q], aspect) : NaN; b = fin(sp) ? floor + (1 - floor) * Math.min(1, sp / HEAT_FULL) : 1; }
      out.push({ x: X[c][q] / aspect, y: Y[c][q], c, r, a: a0 * b });
    }
  }
  return out;
}
const sprites = new Map();
let heatCv = null, heatGl;   // heatGl: undefined until first asked, null = no WebGL2
const canvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null);
/** One soft round sprite per colour (64 px: drawImage scales it to any radius, so no radius buckets are needed). */
function sprite(color) {
  let s = sprites.get(color);
  if (!s && (s = canvas(64, 64))) {
    const x = s.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    x.fillStyle = '#888888'; x.fillStyle = color;   // the canvas normalises it to #rrggbb (an unresolved token stays grey)
    const c = /^#[0-9a-f]{6}$/i.test(x.fillStyle) ? x.fillStyle : '#888888';
    for (const [o, a] of [[0, 'ff'], [0.35, 'b0'], [0.7, '40'], [1, '00']]) g.addColorStop(o, c + a);   // a soft, roughly Gaussian falloff
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    if (sprites.size > 64) sprites.clear();   // theme switches mint new colours
    sprites.set(color, s);
  }
  return s;
}
/** Paint splats into a small offscreen canvas in picture space, then composite it at opacity through env.map (zoom,
 *  pan, rotation, flips). No canvas (node tests): nothing. */
function drawHeat(ctx, env, splats, palette, aspect, opacity = 1) {
  const H = 270, W = Math.max(1, Math.round(H * aspect));
  if (!splats.length || !(opacity > 0)) return;
  // paw-bz1t: the splats in one WebGL2 draw (heat-gl.js: the same sprites, filtering and blending), else one drawImage each
  if (heatGl === undefined) heatGl = heatGL();
  let src = heatGl?.draw(W, H, splats, (c) => sprite(palette[c])) || null;
  if (!src) {
    if (!heatCv) heatCv = canvas(W, H);
    if (!heatCv) return;
    if (heatCv.width !== W || heatCv.height !== H) { heatCv.width = W; heatCv.height = H; }
    const h = heatCv.getContext('2d');
    h.setTransform(1, 0, 0, 1, 0, 0); h.clearRect(0, 0, W, H);
    for (const s of splats) { const sp = sprite(palette[s.c]), r = s.r * H; if (sp) { h.globalAlpha = s.a; h.drawImage(sp, s.x * W - r, s.y * H - r, 2 * r, 2 * r); } }
    src = heatCv;
  }
  const [x0, y0] = env.map(0, 0), [x1, y1] = env.map(1, 0), [x2, y2] = env.map(0, 1);
  ctx.save(); ctx.globalAlpha = opacity; ctx.transform((x1 - x0) / W, (y1 - y0) / W, (x2 - x0) / H, (y2 - y0) / H, x0, y0); ctx.drawImage(src, 0, 0); ctx.restore();
}

/** The part whose hull holds (x, y): {g (1..4), p (1 | 2)}, else null. */
export function partAt(F, x, y) {
  for (let g = 0; g < 4; g++) for (const pa of F?.G[g]?.parts || []) if (pa && inHull(pa.hull, x, y)) return { g: g + 1, p: pa.j };
  return null;
}
/** The pinned group (its id) whose drawn outline (carried painting, else hull) holds (x, y), else 0. */
export function semAt(F, x, y) {
  const k = F?.S?.findIndex((b) => b && (b.outline ? inPoly(b.outline, x, y) : b.hull.length >= 3 && inHull(b.hull, x, y))) ?? -1;
  return k + 1;
}
/** A chip group's centroid on frame F (frameBodies; image space): 'sem_hips' -> the pinned group's; else null. */
export function groupCentroid(F, key) {
  const s = /^sem_(\w+)$/.exec(key || '');
  return (s && (F?.S?.find((b) => b?.name === s[1]) || F?.S?.[SEM_NAMES.indexOf(s[1])])?.c) || null;
}
/** The group (1..4) whose drawn hull holds (x, y), else 0. */
export function bodyAt(F, x, y) {
  const k = F?.G.findIndex((b) => b && inHull(b.hull, x, y)) ?? -1;
  return k + 1;
}

// ---- the run's stroke axis on the picture ----
const axisCache = new WeakMap();
/** run.params' axis: custom -> its arrow; else through the scene's mean centroid: the direction the sidecar reports
 *  (v3.2 primary note axis.deg: rising value, 0 = right, 90 = up), else vertical / horizontal, else the principal
 *  axis of the centroid channels over the scene (an estimate of the sidecar's own fit). */
export function runAxis(run, tMin, tMax, aspect = 1) {
  const p = run?.params || {};
  if (p.axis === 'custom' && [p.axis_x0, p.axis_y0, p.axis_x1, p.axis_y1].every(fin))
    return { x: p.axis_x0, y: p.axis_y0, dx: p.axis_x1 - p.axis_x0, dy: p.axis_y1 - p.axis_y0, kind: 'custom' };
  let m = axisCache.get(run);
  if (!m) axisCache.set(run, (m = new Map()));
  const key = tMin + ':' + tMax + ':' + aspect;
  if (!m.has(key)) {
    const cx = run.channels?.centroid_x, cy = run.channels?.centroid_y, ax = primaryNote(run, tMin)?.axis, deg = ax?.deg;
    let xs = [], ys = [];
    if (cx && cy) { const i0 = lowerBound(cx.t, tMin), i1 = lowerBound(cx.t, tMax); xs = cx.v.subarray(i0, i1); ys = cy.v.subarray(i0, i1); }
    let a = pcaAxis(xs, ys, aspect);
    const mean = (v) => { let s = 0, n = 0; for (const x of v) if (fin(x)) { s += x; n++; } return n ? s / n : 0.5; };
    const at = a || { x: mean(xs), y: mean(ys) };
    if (fin(deg)) a = { x: at.x, y: at.y, dx: Math.cos((deg * Math.PI) / 180) / aspect, dy: -Math.sin((deg * Math.PI) / 180), kind: `${ax.mode || 'sidecar'} ${Math.round(deg)}°` };
    else if (p.axis === 'vertical' || p.axis === 'horizontal') a = { x: at.x, y: at.y, dx: p.axis === 'horizontal' ? 1 : 0, dy: p.axis === 'vertical' ? 1 : 0, kind: p.axis };
    else if (a) a.kind = 'PCA est.';
    m.set(key, a);
  }
  return m.get(key);
}

// ---- what the sidecar picked, what the camera did ----
/** The primary signal's source on the picture: {kind: 'sem', s} (sem_<name>_*) | {kind: 'clicks'} (dist01, p{k}_*) |
 *  {kind: 'cloud'} (proj, proj_cam, centroid_*: every point). */
export function primaryTarget(name, run = null) {
  let m;
  if ((m = /^sem_([a-z0-9_]+?)_(x|y|n|proj|rel|scale|area)$/.exec(name || '')) && semNames(run).includes(m[1])) return { kind: 'sem', s: semNames(run).indexOf(m[1]) + 1 };
  if (name === 'dist01' || /^p[0-3]_[xy]$/.test(name || '')) return { kind: 'clicks' };
  return { kind: 'cloud' };
}
/** The camera's drift at t for the stabilised preview: {x, y} (cam_x / cam_y, frame widths / heights since the run
 *  scene's first frame; a lost sample holds the last one within 1 s), else null (no camera path there). */
export function cameraDrift(run, t) {
  const ch = run?.channels;
  if (!ch?.cam_x || !ch?.cam_y) return null;
  const x = sampleAt(ch.cam_x, t, 1000), y = sampleAt(ch.cam_y, t, 1000);
  return fin(x) && fin(y) ? { x, y } : null;
}
/** The camera at t: {x, y (cam_x / cam_y: drift since the scene start), vx, vy (per second over the last 150 ms; NaN
 *  across a re-seed or without a camera path), conf (cam_conf), kind ('pan left', 'static', ...: the scene's v4.4
 *  camera segment at t, else '')} | null when the run has neither. */
export function cameraAt(run, t) {
  const ch = run?.channels || {}, at = (k, u = t) => sampleAt(ch[k], u);
  const k = sceneAt(run?.scenes || [], t), seg = (run?.scenes?.[k]?.camera || []).find((s) => t >= s.t0 && t < s.t1);
  const kind = seg ? [seg.kind, seg.dir].filter(Boolean).join(' ') : '';
  const x = at('cam_x'), y = at('cam_y');
  if (!fin(x) && !kind) return null;
  const x0 = at('cam_x', t - 150), y0 = at('cam_y', t - 150), ok = fin(x0) && Math.abs(x - x0) <= JUMP && Math.abs(y - y0) <= JUMP;
  return { x, y, vx: ok ? (x - x0) / 0.15 : NaN, vy: ok ? (y - y0) / 0.15 : NaN, conf: at('cam_conf'), kind };
}

// ---- drawing ----
function arrow(ctx, x0, y0, x1, y1) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 1) return;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L, h = Math.min(7, L / 2);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * h - uy * h * 0.5, y1 - uy * h + ux * h * 0.5); ctx.lineTo(x1 - ux * h + uy * h * 0.5, y1 - uy * h - ux * h * 0.5); ctx.closePath(); ctx.fill();
}
/** The device-px box [x, y, w, h] (whole pixels, inside W x H) around mapped points xy [x0, y0, ...] (ctx px) padded by
 *  pad, under transform T (scale + translate) | null (nothing inside). */
export function deviceBox(xy, pad, T, W, H) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < xy.length; k += 2) { const x = xy[k], y = xy[k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const ax = [T.a * (x0 - pad) + T.e, T.a * (x1 + pad) + T.e], ay = [T.d * (y0 - pad) + T.f, T.d * (y1 + pad) + T.f];
  const bx = Math.max(0, Math.floor(Math.min(...ax))), by = Math.max(0, Math.floor(Math.min(...ay))), ex = Math.min(W, Math.ceil(Math.max(...ax))), ey = Math.min(H, Math.ceil(Math.max(...ay)));
  return ex > bx && ey > by ? [bx, by, ex - bx, ey - by] : null;
}
let dotsCv = null;
/**
 * Dots of radius r at the normalised points a [x0, y0, ...], filled in ctx's fillStyle and globalAlpha. paw-bz1t: as one
 * path of n circles the GPU tessellates them all (~5 ms a frame for 4096 points); each circle on its own is the GPU's
 * analytic circle (~4x cheaper). Drawn so on a scratch layer at full opacity, then that layer's box composited at ctx's
 * alpha: overlapping dots still read as one shape, as in the path (only their edge pixels' antialiasing differs). No real
 * canvas (tests) or a rotated / skewed view: the one path.
 */
function dots(ctx, env, a, r) {
  const xy = new Float64Array(a.length);
  for (let k = 0; k < a.length; k += 2) { const p = env.map(a[k], a[k + 1]); xy[k] = p[0]; xy[k + 1] = p[1]; }
  const cv = typeof HTMLCanvasElement !== 'undefined' && ctx.canvas instanceof HTMLCanvasElement ? ctx.canvas : null, T = cv && ctx.getTransform();
  if (!cv || T.b || T.c) {
    ctx.beginPath();
    for (let k = 0; k < xy.length; k += 2) { ctx.moveTo(xy[k] + r, xy[k + 1]); ctx.arc(xy[k], xy[k + 1], r, 0, 2 * Math.PI); }
    ctx.fill();
    return;
  }
  const box = deviceBox(xy, r + 2, T, cv.width, cv.height);
  if (!box) return;
  if (!dotsCv) dotsCv = document.createElement('canvas');
  if (dotsCv.width !== cv.width || dotsCv.height !== cv.height) { dotsCv.width = cv.width; dotsCv.height = cv.height; }
  const s = dotsCv.getContext('2d');
  s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(...box);
  s.setTransform(T); s.globalAlpha = 1; s.fillStyle = ctx.fillStyle;
  for (let k = 0; k < xy.length; k += 2) { s.beginPath(); s.arc(xy[k], xy[k + 1], r, 0, 2 * Math.PI); s.fill(); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(dotsCv, ...box, ...box); ctx.restore();
}
function cross(ctx, x, y, r) { ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); }
/** Stroke the current path twice: a dark solid under-stroke (so pale dashes survive on fur and bright skin), then the colour. */
function duo(ctx, w, dash = []) {
  const a = ctx.globalAlpha, c = ctx.strokeStyle;
  ctx.globalAlpha = a * 0.7; ctx.strokeStyle = 'rgba(0, 0, 0, .75)'; ctx.lineWidth = w + 2.5; ctx.setLineDash([]); ctx.stroke();
  ctx.globalAlpha = a; ctx.strokeStyle = c; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
}
/** A small vertical 0..1 gauge (a group's _proj) with its top-left corner at (x, y - 13). */
function gauge(ctx, x, y, v, col) {
  ctx.lineWidth = 1; ctx.fillStyle = 'rgba(0, 0, 0, .55)'; ctx.fillRect(x - 1, y - 14, 7, 28);
  ctx.strokeStyle = ctx.fillStyle = col; ctx.strokeRect(x, y - 13, 5, 26);
  if (fin(v)) { const f = Math.max(0, Math.min(1, v)); ctx.fillRect(x, y + 13 - 26 * f, 5, 26 * f); }
}
// the 3D trackers ring: g*_scale / g{k}p{j}_scale are ~log size changes near 0 (+ = bigger), g*_rot radians (+ =
// clockwise); both are small, so the ring shows them exaggerated (radius x e^(3 s), tick turned 4 x the rotation)
/** A generic colour for an unknown per-point value: 0..1 -> blue..red; other numbers -> a hue by value. */
export const valueColor = (v) => `hsl(${Math.round(v >= 0 && v <= 1 ? 210 - 210 * v : (((v * 67) % 360) + 360) % 360)} 90% 60%)`;
const LOST_FRAMES = 6;   // a point that just went occluded draws hollow this many frames
// labels: every one on a dark plate, placed beside its thing clear of the others and of every centre marker (kit
// curve.js placeLabels), inside the picture; drawn in priority order, so the selected / primary thing's label is placed
// first, then pinned groups, bodies, the camera / axis; a low-priority label with no clear place is hidden
const P_SEL = 4, P_GROUP = 3, P_BODY = 2, P_CAM = 1;
const LFONT = '600 12px Chakra Petch, sans-serif', LFONT_BIG = '700 13px Chakra Petch, sans-serif', LH = 18, LPAD = 5;
const DIM_FOCUS = 0.35, DIM_SOLO = 0.1;   // the rest while something is hovered / soloed
const FIT_LOW = 0.6;   // v4.14 sem_<name>_fit below this: the short label says so (the group is unreliable there)
/** A thing on the picture: {g} body, {g, p} its part, {s} pinned group, {w} a character; same() compares two. */
const same = (a, b) => !!a && !!b && a.g === b.g && a.p === b.p && a.s === b.s && a.w === b.w;

/**
 * One frame of the blobs view, bottom to top: camera grid, heatmap, hulls (opt-in), points, centre paths, bodies
 * (+ their v3.4 parts), pinned parts, primary, axis, the lane's relative pair, extra flags, occluded points,
 * the hovered point, then the labels. o = {colors: [g1..g4, static], ink: {text, axis, pair, grid}, opts (blobOpts;
 * opts.detail or opts.labels 'full': every label in full), run (selected run | null), lane ('primary' | channel: its
 * source is the selected thing), hi (group 1..4 highlighted), hiPart ({g, p} hovered part | null), hiSem (pinned group
 * hovered | 0), solo (a thing {g} | {g, p} | {s} shown alone, the rest faint | null), hoverPt (point index | null),
 * tMin, tMax (the scene), nextMs (dashed path ahead; 0 = none), aspect (w / h), hide (a flag per colour slot, slotOf:
 * those channels are not drawn; the dock's channel toggles, paw-ufv) | null, weight (by pinned id, 0..1: the fusion view's
 * say per part; its points drawn bigger and the rest fainter) | null}.
 * Hierarchy: the primary's thing emphasised (its own colour, thicker), the hovered / soloed thing at full strength and
 * the rest dimmed; labels short ("Bottom hips", "Bottom body 2") unless hovered, selected (the lane's), or in detail mode.
 * A body holding a character's centre takes that character's colour. -> the frame's bodies (hit tests) + labels:
 * [{key (a thing), x, y, w, h}] the placed label boxes in px (hover / click a label).
 */
export function drawBlobsView(ctx, env, fr, i, o) {
  const ov = fr.ov[i], head = ov?.pts;
  if (!head) return null;
  const { colors, ink, opts, run, hi = 0, tMin = -Infinity, tMax = Infinity, nextMs = 2000, aspect = 1, hide = null, weight = null, paint = null } = o;
  const t = fr.t[i], ch = run?.channels || {}, at = (k) => sampleAt(ch[k], t);
  const names = run ? sceneGroups(run, sceneAt(run.scenes || [], t)) : {};
  const F = frameBodies(fr, i, { smoothMs: opts.smoothMs, decim: opts.decim, tMin, tMax, run, paint, aspect });
  const sn = semNames(run);
  const prim = run && opts.primary ? primaryName(run, t) : '', pt = prim ? primaryTarget(prim, run) : null;
  const primVal = run ? fmt(sampleAt(run.samples, t), 2) : '';
  const lane = o.lane || 'primary', detail = !!opts.detail || opts.labels === 'full';
  // the selected thing: the lane's source (a group chip / lane channel picked in the panel)
  const ls = /^sem_([a-z0-9_]+?)_(proj|rel|area)$/.exec(lane);
  const sel = ls && sn.includes(ls[1]) ? { s: sn.indexOf(ls[1]) + 1 } : null;
  const focus = o.solo || (o.hiPart ? { g: o.hiPart.g, p: o.hiPart.p } : o.hiSem ? { s: o.hiSem } : hi ? { g: hi } : null);
  const covers = (f, k) => same(f, k) || (!!f.g && f.p == null && k.g === f.g);   // a body covers its parts
  const dimOf = (k) => (o.solo ? (covers(o.solo, k) ? 1 : DIM_SOLO) : focus && !covers(focus, k) ? DIM_FOCUS : 1);
  const isPrim = (k) => pt?.kind === 'sem' && k.s === pt.s;
  // characters (v4.12 who_c1 / who_c2 / who_x centres) and the bodies holding them: those bodies wear the character's colour
  const whoC = {}, bodyWho = {}, bodyCol = [...colors.slice(0, 4)];
  for (const w of WHOS) {
    const P = anchoredPath(fr, run, 'who_' + w), c = P && fin(P.x[i]) && fin(P.y[i]) ? [P.x[i], P.y[i]] : null;
    if (c) { whoC[w] = c; const g = bodyAt(F, c[0], c[1]); if (g) bodyWho[g] = bodyWho[g] ? [...bodyWho[g], w] : [w]; }
  }
  for (const [g, ws] of Object.entries(bodyWho)) if (ws.length === 1) bodyCol[g - 1] = whoPaint(ws[0]);
  const palette = [...bodyCol, ...colors.slice(4), ink.text, ...Array.from({ length: MAX_SEM }, (_, k) => (sn[k] ? semPaint(sn[k]) : ink.text))];   // slotOf
  // each layer's opacity (opts.alpha: its slider x the overlay's) multiplies every alpha it sets
  const al = opts.alpha || {}, lay = (k) => { L = al[k] ?? al.other ?? 1; };
  let L = 1;
  const A = (a) => { ctx.globalAlpha = a * L; };
  // labels and centre markers are queued and placed last
  const labels = [], marks = [];
  const label = (short, full, ax, ay, col, prio, key = null, big = false) => {
    const on = key && (same(key, focus) || same(key, sel) || same(key, o.solo));
    labels.push({ str: detail || on ? full : short, ax, ay, col, prio: on ? P_SEL : prio, key, ga: ctx.globalAlpha, font: big ? LFONT_BIG : LFONT });
  };
  const mark = (x, y, r = 8) => marks.push([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]]);
  ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.font = LFONT; ctx.textBaseline = 'middle';

  // camera: a grid glued to the background (shifted by cam, dimmer when cam_conf is low), the camera's motion as an
  // arrow from the frame centre (0.5 s of travel), its kind from the scene's camera segments
  const cam = opts.camera ? cameraAt(run, t) : null;
  lay('camera');
  if (cam) {
    const [x0, y0] = env.map(0.5, 0.5);
    if (fin(cam.x) && fin(cam.y)) {
      ctx.strokeStyle = ink.grid; ctx.lineWidth = 1; A((0.1 + 0.25 * (fin(cam.conf) ? cam.conf : 0)) * (focus ? 0.5 : 1));
      if (!(cam.conf > 0)) ctx.setLineDash([3, 5]);
      const S = 0.1, ox = ((cam.x % S) + S) % S, oy = ((cam.y % S) + S) % S;
      ctx.beginPath();
      for (let x = ox; x <= 1; x += S) { const [a, b] = [env.map(x, 0), env.map(x, 1)]; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      for (let y = oy; y <= 1; y += S) { const [a, b] = [env.map(0, y), env.map(1, y)]; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    A(focus ? 0.4 : 0.8); ctx.lineWidth = 1.5; ctx.strokeStyle = ctx.fillStyle = ink.grid;
    ctx.beginPath(); ctx.arc(x0, y0, 3, 0, 2 * Math.PI); ctx.stroke();
    if (fin(cam.vx)) { const [x1, y1] = env.map(0.5 + cam.vx * 0.5, 0.5 + cam.vy * 0.5); arrow(ctx, x0, y0, x1, y1); }
    mark(x0, y0, 5);
    label(['cam', cam.kind].filter(Boolean).join(' '), ['cam', cam.kind, fin(cam.vx) ? `${fmt(Math.hypot(cam.vx * aspect, cam.vy), 2)} h/s` : '', fin(cam.conf) ? `conf ${fmt(cam.conf, 2)}` : ''].filter(Boolean).join(' · '), x0, y0, ink.grid, P_CAM);
  }

  // heatmap: every visible point a soft splat in its group's colour, brighter the faster it moves
  if (opts.heat) drawHeat(ctx, env, hide ? heatSplats(fr, i, aspect, { k: opts.heatSize, shows: opts.heatShows }).filter((h) => !hide[h.c]) : heatSplats(fr, i, aspect, { k: opts.heatSize, shows: opts.heatShows }), palette, aspect, (al.heat ?? 1) * (focus ? 0.6 : 1));

  // hulls (opt-in): a filled translucent hull per body, its parts' nested and dashed
  lay('hulls');
  if (opts.hulls) for (let g = 0; g < 4; g++) {
    const b = F.G[g];
    if (!b || hide?.[g]) continue;
    const dim = dimOf({ g: g + 1 }), on = same(focus, { g: g + 1 });
    ctx.strokeStyle = ctx.fillStyle = bodyCol[g];
    if (b.hull.length >= 3) { ctx.beginPath(); pathPoly(ctx, env, b.hull); A((on ? 0.35 : 0.25) * dim); ctx.fill(); A(0.9 * dim); duo(ctx, on ? 2.5 : 1.5); }
    ctx.strokeStyle = ctx.fillStyle = lighter(bodyCol[g]);
    for (const pa of b.parts) {
      if (!pa || pa.hull.length < 3) continue;
      const pon = o.hiPart?.g === g + 1 && o.hiPart?.p === pa.j;
      ctx.beginPath(); pathPoly(ctx, env, pa.hull);
      A((pon ? 0.45 : 0.3) * dim); ctx.fill(); A(dim); duo(ctx, pon ? 2.5 : 1.5, [3, 2]);
    }
  }

  // points: every visible point a dot in its group's colour (a part's lighter, static grey, unassigned ink), pinned
  // members ringed in their part's colour, points that just went occluded hollow for a few frames. Batched per colour;
  // while something is hovered / soloed, the points of everything else are faint.
  lay('points');
  if (opts.points) {
    // batches keyed by colour and dim factor (the rest's points faint while something is hovered / soloed)
    const fills = new Map(), rings = new Map(), add = (m, c, d, x, y, r = 1) => { const k = c + '|' + d + '|' + r; let a = m.get(k); if (!a) m.set(k, (a = [c, d, r])); a.push(x, y); };
    for (let j = 0; j < head.length; j++) {
      const p = head[j], s = semOf(p);
      if ((F.keep && !F.keep[j] && !s) || hide?.[slotOf(p)]) continue;
      const col = partOf(p) ? lighter(bodyCol[p[3] - 1]) : palette[slotOf(p)];
      const k = s ? { s } : p[3] > 0 ? (partOf(p) ? { g: p[3], p: partOf(p) } : { g: p[3] }) : null, d = focus ? (k ? dimOf(k) : o.solo ? DIM_SOLO : DIM_FOCUS) : 1;
      if (p[2]) {
        const w = weight ? (s ? Math.round(4 * weight[s]) / 4 : 0) : 1;   // the fusion view: a part's say, in quarters
        add(fills, col, weight ? d * (0.3 + 0.7 * w) : d, p[0], p[1], weight ? 0.8 + 0.9 * w : 1); if (s) add(rings, col, d, p[0], p[1]); continue;
      }
      let n = 1;
      while (n <= LOST_FRAMES && !fr.ov[i - n]?.pts?.[j]?.[2] && i - n >= 0) n++;
      if (n <= LOST_FRAMES && i - n >= 0) add(rings, col, d, p[0], p[1]);
    }
    ctx.lineWidth = 1.25;
    for (const [col, d, rs, ...a] of fills.values()) { ctx.fillStyle = col; A((col === palette[4] || col === palette[5] ? 0.55 : 0.9) * d); dots(ctx, env, a, 1.8 * rs); }
    // rings stay one path: as analytic circles their crossings (a part's packed members) antialias visibly differently
    for (const [col, d, , ...a] of rings.values()) {
      ctx.strokeStyle = col; A(0.9 * d); ctx.beginPath();
      for (let k = 0; k < a.length; k += 2) { const [x, y] = env.map(a[k], a[k + 1]); ctx.moveTo(x + 3.5, y); ctx.arc(x, y, 3.5, 0, 2 * Math.PI); }
      ctx.stroke();
    }
  }

  // bodies: centre paths, the anchored centre (crosshair), a label, a velocity arrow (0.25 s of travel), the 3D ring;
  // their parts (v3.4): a small crosshair on the part's anchored centre, "p1 · balls", its own size change as a ring;
  // the characters: a ring and "B" / "T" / "X" in their colour
  lay('bodies');
  if (opts.bodies) for (const [w, c] of Object.entries(whoC)) {
    const [x, y] = env.map(c[0], c[1]), col = whoPaint(w), dim = focus ? DIM_FOCUS : 1;
    ctx.strokeStyle = ctx.fillStyle = col; A(0.95 * dim);
    ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI); duo(ctx, 2.5);
    mark(x, y, 12);
    label(whoShort(w), whoName(w), x, y, col, P_BODY, { w }, true);
  }
  for (let g = 0; g < 4; g++) {
    const b = F.G[g];
    if (!b || hide?.[g]) continue;
    const key = { g: g + 1 }, dim = dimOf(key), on = same(focus, key) || same(sel, key), P = anchoredPath(fr, run, g), X = P.x, Y = P.y, col = bodyCol[g];
    ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 1.5;
    if (opts.trails) {
      // path: segments between consecutive known centres; a jump (re-seed, cut) or a gap ends it
      const seg = (dir, limit, fade) => {
        if (!fade) ctx.beginPath();
        for (let j = i + dir; j >= 0 && j < X.length; j += dir) {
          const a = j - dir, dt = Math.abs(fr.t[j] - t);
          if (dt > limit || fr.t[j] < tMin || fr.t[j] >= tMax || !fin(X[j]) || !fin(X[a]) || Math.abs(X[j] - X[a]) > JUMP || Math.abs(Y[j] - Y[a]) > JUMP) break;
          const [x0, y0] = env.map(X[a], Y[a]), [x1, y1] = env.map(X[j], Y[j]);
          if (fade) { A(0.9 * (1 - dt / limit) * dim); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
          else { if (a === i) ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
        }
        if (!fade) { A(0.6 * dim); ctx.stroke(); }
      };
      ctx.lineWidth = 2;
      seg(-1, 2000, true);
      if (nextMs > 0) { ctx.setLineDash([4, 4]); seg(1, nextMs, false); ctx.setLineDash([]); }
      ctx.lineWidth = 1.5;
    }
    if (!opts.bodies) continue;
    for (const pa of b.parts) {
      if (!pa?.c) continue;
      const [px, py] = env.map(pa.c[0], pa.c[1]), pd = dimOf({ g: g + 1, p: pa.j });
      ctx.strokeStyle = ctx.fillStyle = lighter(col); A(pd); ctx.lineWidth = 1.5;
      cross(ctx, px, py, 4);
      mark(px, py, 5);
      const nm = `p${pa.j}`;
      label(nm, `${nm} · ${pa.n}`, px, py, lighter(col), P_BODY, { g: g + 1, p: pa.j });
    }
    if (!b.c) continue;
    const [cx, cy] = env.map(b.c[0], b.c[1]), prim1 = isPrim(key);
    if (prim1 && b.hull.length >= 3) { ctx.strokeStyle = col; A(dim); ctx.beginPath(); pathPoly(ctx, env, b.hull); duo(ctx, 3); }   // the primary: its outline, emphasised
    ctx.strokeStyle = ctx.fillStyle = col; A(dim * (on || prim1 ? 1 : 0.85)); ctx.lineWidth = on ? 2.5 : 2;
    cross(ctx, cx, cy, on ? 8 : 6); ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 2 * Math.PI); ctx.fill();
    mark(cx, cy, on ? 9 : 7);
    if (b.vel) { const [ex, ey] = env.map(b.c[0] + b.vel[0] * 0.25, b.c[1] + b.vel[1] * 0.25); ctx.lineWidth = 2; arrow(ctx, cx, cy, ex, ey); }
    ctx.lineWidth = 1.5;
    const speed = b.vel ? Math.hypot(b.vel[0] * aspect, b.vel[1]) : NaN, who = (bodyWho[g + 1] || []).map((w) => w.toUpperCase()).join(' ');
    const short = `${who ? who + ' ' : ''}g${g + 1}${prim1 ? ` · primary ${primVal}` : ''}`;
    const full = [`g${g + 1}${who ? ' · ' + who : ''}`, `${b.n} pts`, fin(speed) ? `${speed.toFixed(2)} h/s` : '', prim1 ? `primary · ${prim} ${primVal}` : ''].filter(Boolean).join(' · ');
    A(dim);
    label(short, full, cx, cy, col, prim1 ? P_SEL : P_BODY, key);
  }

  // pinned parts (v4.6, pts[5]: seeded from the tagger or painted, fixed members): a dash-dot outline of their members in
  // their own colour (filled when hovered; the primary's thicker), the anchored centre as a crosshair, "Bottom hips", their
  // _proj as a gauge
  lay('seeded');
  if (opts.seeded) {
    for (const sb of F.S || []) {
      if (!sb || hide?.[5 + sb.s]) continue;
      const key = { s: sb.s }, on = same(focus, key) || same(sel, key), prim1 = isPrim(key), dim = dimOf(key);
      const col = semPaint(sb.name), c = sb.c || sb.hull[0] || sb.pts[0], [lx, ly] = env.map(c[0], c[1]);
      ctx.strokeStyle = ctx.fillStyle = col;
      const ol = sb.outline || sb.hull, un = !!sb.unsure;   // paw-9qim: the painting carried by the points, else their hull; paw-rrtw: unsure = faint, short dashes
      if (ol.length >= 3) {
        ctx.beginPath(); pathPoly(ctx, env, ol);
        if (same(focus, key)) { A(0.22 * dim); ctx.fill(); }
        A((prim1 || on ? 1 : 0.85) * (un ? 0.45 : 1) * dim); duo(ctx, prim1 ? 3 : on ? 2.5 : 1.5, un ? [2, 4] : prim1 ? [10, 3, 2, 3] : [7, 3, 2, 3]);
      }
      A(dim); ctx.lineWidth = 2;
      if (sb.c) { cross(ctx, lx, ly, 7); mark(lx, ly, 8); }
      const fq = ch[`sem_${sb.name}_fit`] ? at(`sem_${sb.name}_fit`) : NaN;   // v4.14 group_fit: the rigid fit's inlier share
      const nm = partLabel(names['sem_' + sb.name]?.label || sb.name), fit = fin(fq) ? `fit ${Math.round(fq * 100)}%` : '';
      const short = [nm, fin(fq) && fq < FIT_LOW ? fit : '', prim1 ? `primary ${primVal}` : ''].filter(Boolean).join(' · ');
      const full = [nm, `${sb.n} pts`, fit, sb.unsure ? `outline unsure: ${sb.unsure}` : '', prim1 ? `primary · ${prim} ${primVal}` : ''].filter(Boolean).join(' · ');
      label(short, full, lx, ly, col, prim1 ? P_SEL : P_GROUP, key);
      if (ch[`sem_${sb.name}_proj`]) { A(dim); gauge(ctx, lx - 17, ly, at(`sem_${sb.name}_proj`), col); }
    }
  }

  // primary of another kind (the clicks, the whole cloud): outlined in the accent and tagged; a pinned group primary is emphasised in its own drawing above and its label says "primary"
  lay('other');
  const accent = ink.axis;
  if (pt && (pt.kind === 'clicks' || pt.kind === 'cloud')) {
    ctx.strokeStyle = accent; A(focus ? DIM_FOCUS : 1);
    const tag = (c) => { if (c) { const [x, y] = env.map(c[0], c[1]); label(`primary ${primVal}`, `primary · ${prim} ${primVal}`, x, y, accent, P_SEL); } };
    if (pt.kind === 'clicks') {
      for (const p of head.slice(0, 2)) { const [x, y] = env.map(p[0], p[1]); ctx.beginPath(); ctx.arc(x, y, 9, 0, 2 * Math.PI); duo(ctx, 2.5); mark(x, y, 10); }
      tag(head[0]);
    } else {
      const P = anchoredPath(fr, run, 'centroid'), c = P && fin(P.x[i]) ? [P.x[i], P.y[i]] : null;
      if (c) { const [x, y] = env.map(c[0], c[1]); ctx.lineWidth = 2.5; cross(ctx, x, y, 11); ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); duo(ctx, 2.5); mark(x, y, 11); }
      tag(c);
    }
  }

  // the stroke axis through the frame, the lane's source projected on it
  if (opts.axis && run) {
    const ax = runAxis(run, tMin, tMax, aspect), seg = ax && clipLine(ax.x, ax.y, ax.dx, ax.dy);
    if (seg) {
      const [x0, y0] = env.map(seg[0], seg[1]), [x1, y1] = env.map(seg[2], seg[3]), D = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / D, uy = (y1 - y0) / D;
      ctx.strokeStyle = ctx.fillStyle = ink.axis; A(focus ? 0.35 : 0.7); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); duo(ctx, 1.5, [8, 4]);
      A(focus ? DIM_FOCUS : 1);
      // at the axis' right-hand end: the left end often sat under the tracker dock (paw-098)
      const [lx, ly] = x1 > x0 ? [x1 - ux * 24, y1 - uy * 24] : [x0 + ux * 24, y0 + uy * 24];
      label(`axis ${ax.kind.replace(/^\w+ /, '')}`, `axis (${ax.kind})`, lx, ly, ink.axis, P_CAM);
      // the lane's / primary's source point, projected on the axis (its value is in that thing's own label)
      const sm = /^sem_([a-z0-9_]+?)_(proj|rel)$/.exec(lane), wm = /^who_(c[12]|x)_proj$/.exec(lane);
      const cen = anchoredPath(fr, run, 'centroid');
      const src = sm ? F.S.find((b) => b?.name === sm[1])?.c : wm ? whoC[wm[1]] : cen && fin(cen.x[i]) ? [cen.x[i], cen.y[i]] : null;
      if (src && !relParse(lane)) {
        const [sx, sy] = env.map(src[0], src[1]), d = (sx - x0) * ux + (sy - y0) * uy, px = x0 + ux * d, py = y0 + uy * d;
        ctx.beginPath(); ctx.moveTo(px - uy * 9, py + ux * 9); ctx.lineTo(px + uy * 9, py - ux * 9); duo(ctx, 3);
        A(0.5); ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
        A(1);
        if (lane !== 'primary' && lane !== prim && !sel) label(`${lane} ${fmt(at(lane), 2)}`, `${lane} ${fmt(at(lane), 2)}`, px, py, ink.axis, P_SEL);
      }
    }
  }
  // a relative lane channel (rel:a:b, runs-channel.js relChannel): its two centres joined, its value on the line (always:
  // the lane's own signal, not an Axis extra)
  const rl = run && relParse(lane), ca = rl && groupCentroid(F, rl.a), cb = rl && groupCentroid(F, rl.b);
  if (ca && cb) {
    const [a, b] = [ca, cb].map((c) => env.map(c[0], c[1]));
    ctx.strokeStyle = ink.pair; A(1);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); duo(ctx, 2.5);
    ctx.lineWidth = 2.5;
    for (const q of [a, b]) { ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, 2 * Math.PI); ctx.stroke(); }
    const s = `${relLabel(sceneGroups(run, sceneAt(run.scenes || [], t)), lane)} ${fmt(at(lane), 2)}`;
    label(s, s, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ink.text, P_SEL);
  }

  // forward compatibility: pts elements beyond the pinned group (pts[6]+: future flags / residuals) -> a ring per element, by value
  lay('points');
  if (opts.extra) {
    ctx.lineWidth = 1.5;
    for (let j = 0; j < head.length; j++) {
      const p = head[j];
      for (let e = 6; e < p.length; e++) {
        if (!fin(p[e]) || p[e] === 0) continue;
        const [X, Y] = env.map(p[0], p[1]);
        ctx.strokeStyle = valueColor(p[e]); A(0.9);
        ctx.beginPath(); ctx.arc(X, Y, 5 + 2 * (e - 6), 0, 2 * Math.PI); ctx.stroke();
      }
    }
  }
  // occluded points (opt-in): small squares, and the overlay's boxes
  if (opts.occluded) {
    ctx.strokeStyle = ink.text; A(0.5); ctx.lineWidth = 1; ctx.beginPath();
    for (let j = 0; j < head.length; j++) { const p = head[j]; if (p[2] || (F.keep && !F.keep[j]) || hide?.[slotOf(p)]) continue; const [X, Y] = env.map(p[0], p[1]); ctx.rect(X - 1.5, Y - 1.5, 3, 3); }
    for (const b of ov.boxes || []) pathRect(ctx, env, b[0], b[1], b[2], b[3]);
    ctx.stroke();
  }

  // the hovered point
  lay('other');
  if (o.hoverPt != null && head[o.hoverPt]) {
    const [X, Y] = env.map(head[o.hoverPt][0], head[o.hoverPt][1]);
    ctx.strokeStyle = ink.text; A(1); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X, Y, 6, 0, 2 * Math.PI); ctx.stroke();
  }
  F.labels = drawLabels(ctx, env, opts.labels === 'off' ? labels.filter((l) => l.prio >= P_SEL) : labels, marks);   // off: only the hovered / selected / primary thing's
  ctx.restore();
  return F;
}

/** Place (kit curve.js placeLabels, highest priority first, inside the picture, clear of each other and of the centre
 *  marks) and draw the queued labels: a dark plate with a thin border in the label's colour, the text, and a leader line
 *  back to its thing when the plate sits away from it. A label below P_SEL with no clear place is hidden.
 *  -> [{key, x, y, w, h}] the drawn plates, px. */
function drawLabels(ctx, env, labels, marks) {
  const cs = [env.map(0, 0), env.map(1, 0), env.map(0, 1), env.map(1, 1)];
  const X0 = Math.min(...cs.map((c) => c[0])), Y0 = Math.min(...cs.map((c) => c[1])), X1 = Math.max(...cs.map((c) => c[0])), Y1 = Math.max(...cs.map((c) => c[1]));
  const order = labels.map((_, k) => k).sort((a, b) => labels[b].prio - labels[a].prio || a - b);
  const items = order.map((k) => {
    const l = labels[k];
    ctx.font = l.font;
    const m = ctx.measureText?.(l.str), w = (Number.isFinite(m?.width) ? m.width : l.str.length * 7) + 2 * LPAD;
    return { x: l.ax - X0, y: l.ay - Y0, w, h: LH };
  });
  const lines = marks.map((m) => m.map(([x, y]) => [x - X0, y - Y0]));
  const at = placeLabels(items, lines, X1 - X0, Y1 - Y0, 10), out = [];
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  order.forEach((k, n) => {
    const l = labels[k], r = at[n], { w, h } = items[n];
    if (r.bg && l.prio < P_SEL) return;
    const x = r.x + X0, y = r.y + Y0, nx = Math.max(x, Math.min(l.ax, x + w)), ny = Math.max(y, Math.min(l.ay, y + h));
    ctx.globalAlpha = l.ga;
    if (Math.hypot(nx - l.ax, ny - l.ay) > 14) {   // a leader back to the thing
      ctx.beginPath(); ctx.moveTo(l.ax, l.ay); ctx.lineTo(nx, ny);
      ctx.strokeStyle = 'rgba(0, 0, 0, .7)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = l.col; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = plate(.78); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 3); else ctx.rect(x, y, w, h); ctx.fill();
    ctx.strokeStyle = l.col; ctx.lineWidth = 1; ctx.globalAlpha = l.ga * 0.55; ctx.stroke(); ctx.globalAlpha = l.ga;
    ctx.font = l.font; ctx.fillStyle = l.col; ctx.fillText(l.str, x + LPAD, y + h / 2 + 0.5);
    if (l.key) out.push({ key: l.key, x, y, w, h });
  });
  return out;
}
