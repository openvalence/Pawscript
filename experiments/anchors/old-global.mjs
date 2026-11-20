// experiments/anchors/old-global.mjs -- paw-wg2d's first anchors (1b1b592), kept to measure against: ONE mix / polarity /
// shift / gain for the whole shot (the owner: fixing the bad part broke the good part). Not used by the app.
// anchors.js -- the owner's anchors (paw-wg2d): on a tracked shot, a frame marked fully in (pos 0), fully out (pos 100) or
// the middle (pos 50). Pure (test/anchors.test.mjs).
// Stored on the shot: app.doc.scenes[i].anchors = [{ms, pos}] (undoable, in the .pawproj, independent of any run: a re-track
// keeps them). Read by
//  - rederive.js runDerives: a run scene's derive carries `anchors`, every anchor inside it (the shots of one tracked scene
//    share them, as they share its settings)
//  - fusion.js fuseScene: with anchors the fused signal is solved BACKWARDS (anchorFit below): the forward mix, its polarity
//    and a few rows' extra say chosen so the signal reads the anchored values on the anchored frames, ridged toward the
//    forward solution; then the turns near an in / out anchor land on its frame (a constant shift for the whole shot when
//    the anchors agree, the rest snapped locally). No anchors = the forward solution exactly
//  - autorange.js rangePlan: an anchor at 0 / 100 is a known depth of the shot (its band reaches 0 / 100)
//  - anchorsOf(doc): the datapoints, for scripts that score fusion defaults against them
import { signalTurns } from '../../src/lib/strokes.js';

export const ANCHOR_POS = [0, 50, 100];
export const ANCHOR_WORD = { 0: 'fully in', 50: 'middle', 100: 'fully out' };
/** The solver's knobs: LAMBDA = the price of a row's extra say (a full stroke of it costs as much as an anchor missed by a full
 *  stroke), divided by the row's own quality (a noisy or wandering row is dear: two anchors cannot recruit noise); G_PRICE =
 *  the price of moving the forward signal's gain off +-1; SEARCH = frames around an in / out anchor a turn is looked for;
 *  SNAP = frames a turn is moved locally after the shot's shift. */
export const ANCHOR_FIT = { LAMBDA: 2, Q_FLOOR: 0.05, G_PRICE: 1, SEARCH: 4, SNAP: 2.5 };

const fin = Number.isFinite;
/** Shot s's anchors, clean: {ms (int), pos 0 | 50 | 100} inside the shot, one per ms, sorted. */
export function shotAnchors(s) {
  if (!Array.isArray(s?.anchors)) return [];
  const by = new Map();
  for (const a of s.anchors) {
    const ms = Math.round(+a?.ms), pos = +a?.pos;
    if (fin(ms) && ANCHOR_POS.includes(pos) && ms >= s.start_ms && ms < s.end_ms) by.set(ms, pos);
  }
  return [...by].sort((x, y) => x[0] - y[0]).map(([ms, pos]) => ({ ms, pos }));
}
/** Every anchor of the document: [{shot (its index), ms, pos}], by time. The datapoints. */
export const anchorsOf = (doc) => (doc?.scenes || []).flatMap((s, i) => shotAnchors(s).map((a) => ({ shot: i, ...a })));
/** The anchors of the shots inside [t0, t1): [{ms, pos}]. */
export const anchorsIn = (shots, t0, t1) => (shots || []).flatMap(shotAnchors).filter((a) => a.ms >= t0 && a.ms < t1);

const shotAt = (scenes, ms) => scenes.findIndex((s) => s.start_ms <= ms && s.end_ms > ms);
const withList = (scenes, i, list) => scenes.map((s, k) => { if (k !== i) return s; const { anchors: _, ...rest } = s; return list.length ? { ...rest, anchors: list } : rest; });   // eslint-disable-line no-unused-vars
/** An anchor of pos at ms (a frame start): that kind already within tol there = removed (the key again takes it off),
 *  another kind there = replaced. -> {list, did: 'add' | 'replace' | 'remove', shot} | null (no shot at ms). */
export function putAnchor(scenes, ms, pos, tol = 1) {
  const i = shotAt(scenes, ms);
  if (i < 0 || !ANCHOR_POS.includes(pos)) return null;
  const own = shotAnchors(scenes[i]), here = own.find((a) => Math.abs(a.ms - ms) <= tol), rest = own.filter((a) => a !== here);
  const did = here ? (here.pos === pos ? 'remove' : 'replace') : 'add';
  const list = did === 'remove' ? rest : [...rest, { ms: Math.round(ms), pos }].sort((a, b) => a.ms - b.ms);
  return { list: withList(scenes, i, list), did, shot: i };
}
/** Anchor a ({ms, pos}) moved to toMs (kept inside its shot; an anchor already there is replaced), or removed (toMs null).
 *  -> the new scenes (the same array when a is not there). */
export function moveAnchor(scenes, a, toMs) {
  const i = shotAt(scenes, a.ms), own = i >= 0 ? shotAnchors(scenes[i]) : [], k = own.findIndex((x) => x.ms === a.ms);
  if (k < 0) return scenes;
  const s = scenes[i], rest = own.filter((_, j) => j !== k);
  if (toMs == null) return withList(scenes, i, rest);
  const ms = Math.round(Math.min(s.end_ms - 1, Math.max(s.start_ms, toMs)));
  return withList(scenes, i, [...rest.filter((x) => x.ms !== ms), { ms, pos: own[k].pos }].sort((x, y) => x.ms - y.ms));
}

// ---- the backwards solve ----
/** Least squares with a ridge: minimise sum_a (y_a - X_a theta)^2 + sum_j L_j (theta_j - p_j)^2 -> theta. */
function ridge(X, y, L, p) {
  const n = L.length, A = Array.from({ length: n }, () => new Float64Array(n + 1));
  X.forEach((row, a) => { for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += row[i] * row[j]; A[i][n] += row[i] * y[a]; } });
  for (let i = 0; i < n; i++) { A[i][i] += L[i]; A[i][n] += L[i] * p[i]; }
  for (let c = 0; c < n; c++) {   // Gauss-Jordan, partial pivoting (the ridge keeps it regular)
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / d; if (f) for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r, i) => r[n] / (r[i] || 1e-12));
}
const pctl = (v, p) => { const b = Array.from(v).filter(fin).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.max(0, Math.round(p * (b.length - 1))))] : NaN; };
/** v resampled at fractional sample positions s(q) (linear, clamped at the ends; NaN where a neighbour is NaN). */
const warp = (v, s) => Float64Array.from(s, (x) => { const n = v.length, a = Math.max(0, Math.min(n - 1, Math.floor(x))), b = Math.min(n - 1, a + 1), f = Math.max(0, Math.min(1, x - a)); return f ? v[a] * (1 - f) + v[b] * f : v[a]; });
/** The turn of kind k (+1 top, -1 bottom of v) nearest sample q within r samples -> its offset (samples) | null. */
const turnNear = (turns, q, k, r) => { let best = null; for (const [i, kk] of turns) if (kk === k && Math.abs(i - q) <= r && (best == null || Math.abs(i - q) < Math.abs(best))) best = i - q; return best; };
/** v (one scene, min..max) at q as 0..1. */
const at01 = (v, q) => { let lo = Infinity, hi = -Infinity; for (const x of v) if (x === x) { if (x < lo) lo = x; if (x > hi) hi = x; } return hi > lo ? (v[q] - lo) / (hi - lo) : 0.5; };

/**
 * The fused signal of one run scene solved backwards to the anchors. s = {t (ms), v (the forward fused signal), raw, tim,
 * conf (same length), rows: [{id, f (the row as fusion mixes it, NaN = absent), q (its data-only quality 0..1)}]}; anchors
 * [{ms, y (the value it should read, 0..1, larger = the signal's top), sign?, pos?}]. -> null (no anchor on the signal) |
 * {v, raw, tim, conf (new arrays), info: {list: [{ms, pos, want, before, reads, moved (frames)}], shift (frames, the whole
 * shot), flipped, mix: [{id, w}] (rows given extra say), rms: {before, after} (pos)}}.
 * 1. values: v' = c + g v + sum_i d_i f_i at the anchored samples vs the targets (on v's own scale), d ridged toward 0 by
 *    LAMBDA / quality, g toward +1 or -1 (both tried: the polarity falls out of the fit), c free.
 * 2. timing: each in / out anchor's nearest turn of that kind within SEARCH frames; their median offset shifts the whole
 *    shot (the tracked rows lag the picture by a constant); what is left within SNAP frames is snapped locally (a tent warp
 *    half a half-stroke wide), so the turn lands on the anchor's frame.
 */
export function anchorFit(s, anchors, o = ANCHOR_FIT) {
  const { t, v } = s, m = t.length;
  if (!m || !anchors?.length) return null;
  const dt = m > 1 ? (t[m - 1] - t[0]) / (m - 1) : 1000 / 30;
  const idx = (ms) => { let lo = 0, hi = m - 1; while (hi - lo > 1) { const c = (lo + hi) >> 1; if (t[c] <= ms) lo = c; else hi = c; } return Math.abs(t[hi] - ms) < Math.abs(t[lo] - ms) ? hi : lo; };
  const A = anchors.map((a) => ({ ...a, q: idx(a.ms) })).filter((a) => Math.abs(t[a.q] - a.ms) <= dt && fin(v[a.q]) && fin(a.y));
  if (!A.length) return null;
  // 1. values, on the forward signal's own scale (its 2nd..98th percentile = 0..1)
  const lo = pctl(v, 0.02), u = pctl(v, 0.98) - lo || 1;
  const rows = (s.rows || []).filter((r) => r.f && A.some((a) => fin(r.f[a.q])));
  const F = rows.map((r) => Array.from(r.f, (x) => (fin(x) ? x : 0))), sz = rows.map((r) => (pctl(r.f, 0.98) - pctl(r.f, 0.02)) / u || 1);
  const X = A.map((a) => [1, (v[a.q] - lo) / u, ...F.map((f) => f[a.q] / u)]), y = A.map((a) => a.y);
  const L = [1e-6, o.G_PRICE, ...rows.map((r, i) => (o.LAMBDA * sz[i] ** 2) / Math.max(o.Q_FLOOR, r.q ?? 0))];
  const cost = (th) => A.reduce((c, _, a) => c + (y[a] - X[a].reduce((z, x, j) => z + x * th[j], 0)) ** 2, 0) + L.reduce((c, l, j) => c + l * (th[j] - (j === 1 ? th.sg : 0)) ** 2, 0);
  const fits = [1, -1].map((sg) => { const p = L.map((_, j) => (j === 1 ? sg : 0)), th = ridge(X, y, L, p); th.sg = sg; return th; });
  const th = cost(fits[1]) < cost(fits[0]) - 1e-9 ? fits[1] : fits[0];
  // (the scale stays the forward signal's: theta acts on (v - lo) / u, mapped back)
  const mix = (base) => { const out = new Float64Array(m); for (let q = 0; q < m; q++) { let z = th[0] + (th[1] * (base[q] - lo)) / u; for (let i = 0; i < F.length; i++) z += (th[2 + i] * F[i][q]) / u; out[q] = fin(base[q]) ? lo + u * z : NaN; } return out; };
  let V = mix(v), R = s.raw ? mix(s.raw) : V, T = s.tim ? mix(s.tim) : V, C = s.conf ? Float64Array.from(s.conf) : null;
  // 2. timing: in / out anchors only (a middle says nothing about where a turn is)
  const fr = (s.frameMs || dt) / dt, kind = (a) => (a.y > 0.5 ? 1 : a.y < 0.5 ? -1 : 0);
  const timed = A.filter((a) => kind(a));
  let shift = 0;
  const off = (sig, r) => { const tu = signalTurns(t, sig).turns; return timed.map((a) => turnNear(tu, a.q, kind(a), r)); };
  const e0 = off(V, o.SEARCH * fr).filter((x) => x != null).sort((p, q) => p - q);
  if (e0.length) shift = e0.length % 2 ? e0[e0.length >> 1] : (e0[e0.length / 2 - 1] + e0[e0.length / 2]) / 2;
  const sMap = Float64Array.from({ length: m }, (_, q) => q + shift);
  if (shift) { V = warp(V, sMap); R = warp(R, sMap); T = warp(T, sMap); if (C) C = warp(C, sMap); }
  const e1 = off(V, o.SNAP * fr), tu1 = signalTurns(t, V).turns, snap = new Float64Array(m);
  timed.forEach((a, k) => {
    const e = e1[k];
    if (!e) return;
    // half a half-stroke: the distance to the nearest opposite turn, halved (at least 3 samples)
    let half = Infinity;
    for (const [i, kk] of tu1) if (kk !== kind(a)) half = Math.min(half, Math.abs(i - (a.q + e)));
    const H = Math.max(3, Math.abs(e) + 2, fin(half) ? half / 2 : 6);
    for (let q = Math.max(0, Math.floor(a.q - H)); q <= Math.min(m - 1, Math.ceil(a.q + H)); q++) snap[q] += e * Math.max(0, 1 - Math.abs(q - a.q) / H);
  });
  if (snap.some((x) => x)) { const sm = Float64Array.from({ length: m }, (_, q) => q + snap[q]); V = warp(V, sm); R = warp(R, sm); T = warp(T, sm); if (C) C = warp(C, sm); }
  // what it says: per anchor the pos it reads before / after (the scene's min..max, played the anchor's way up) and how far it moved
  const pos = (a, x) => Math.round(100 * (a.sign < 0 ? 1 - x : x));
  const list = A.map((a, k) => ({ ms: a.ms, pos: a.pos ?? pos(a, a.y), want: pos(a, a.y), before: pos(a, at01(v, a.q)), reads: pos(a, at01(V, a.q)), moved: +((shift + snap[a.q]) / fr).toFixed(1), ...(kind(a) && e1[k] == null && off(V, o.SEARCH * fr)[k] == null ? { noTurn: true } : {}) }));
  const rms = (key) => Math.round(Math.sqrt(list.reduce((z, x) => z + (x[key] - x.want) ** 2, 0) / list.length));
  return { v: V, raw: R, tim: T, conf: C, info: { list, shift: +(shift / fr).toFixed(1), flipped: th[1] < 0, mix: rows.map((r, i) => ({ id: r.id, w: +((th[2 + i] * sz[i]) / (Math.abs(th[1]) || 1)).toFixed(3) })).filter((x) => Math.abs(x.w) >= 0.05), rms: { before: rms('before'), after: rms('reads') } } };
}

const frames = (n) => `${Math.abs(n)} frame${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'earlier' : 'later'}`;
/** One anchor's residual in plain words (the fusion panel): 'fully in: reads 4 (was 31), its turn moved 2 frames earlier'. */
export const anchorLine = (x) => `${ANCHOR_WORD[x.pos] ?? x.pos}: reads ${x.reads}${x.reads === x.before ? '' : ` (was ${x.before})`}${x.moved ? `, its turn moved ${frames(x.moved)}` : ''}${x.noTurn ? ', no turn of that kind near it' : ''}`;
/** The anchors' summary for the fusion panel, in plain words ('' = none). */
export function anchorsText(a) {
  if (!a?.list?.length) return '';
  return [a.flipped ? 'they turned the shot over' : '', a.shift ? `the whole shot moved ${frames(a.shift)}` : '', `off by ${a.rms.after} on average (forward: ${a.rms.before})`].filter(Boolean).join(' · ');
}
