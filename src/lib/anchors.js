// anchors.js -- the owner's anchors (paw-wg2d): on a tracked shot, a frame marked fully in (pos 0), fully out (pos 100) or
// the middle (pos 50), as many of each as he likes. Pure (test/anchors.test.mjs).
// Stored on the shot: app.doc.scenes[i].anchors = [{ms, pos}] (undoable, in the .pawproj, independent of any run: a re-track
// keeps them). Read by
//  - rederive.js runDerives: a run scene's derive carries `anchors`, every anchor inside it (the shots of one tracked scene
//    share them, as they share its settings)
//  - fusion.js fuseScene: anchors are LOCAL evidence (anchorLocal below; paw-ze8n, the owner's "a signal to fusion that it
//    needs to look elsewhere for the motion"). Each section of the shot is solved on its own: where fusion's automatic mix
//    already puts the anchored extremes on the anchored frames nothing changes; where it does not, the section takes the
//    rows that do (any sign: polarity, time shift and level are per section), and only as far as the anchors' evidence
//    reaches: a section with no anchors is the automatic result exactly
//  - autorange.js rangePlan: an anchor at 0 / 100 is a known depth around it (the band reaches 0 / 100 there)
//  - anchorsOf(doc): the datapoints, for scripts that score fusion defaults against them
import { signalTurns, savgol } from './strokes.js';

export const ANCHOR_POS = [0, 50, 100];
export const ANCHOR_WORD = { 0: 'fully in', 50: 'middle', 100: 'fully out' };
/** The local solve's knobs (anchorLocal):
 *  SEARCH  frames around an in / out anchor its turn may sit (the section's shift takes the rest up)
 *  SNAP    frames a turn is still moved locally after the section's shift
 *  STILL   a shift or snap of this many frames or less is no change (an anchor that agrees changes nothing)
 *  OK      a candidate meets an anchor at this fit (0..1: an extreme of the right kind on the frame)
 *  TIE     the automatic mix stays when it is this close to the best candidate
 *  NEAR    candidates this close to the best share the section's motion
 *  ELSE    weight of agreeing with the automatic mix away from the anchors (look elsewhere, keep what works elsewhere)
 *  TIMING  price per frame of a candidate's turns wandering around the anchors (beyond one steady lag)
 *  Q       a row's data-only quality -> its standing (a noisy row never wins on luck)
 *  SPLIT   the automatic mix's weights from one window to the next sharing less than this = a section edge
 *  AGREE   windowed correlation with the automatic mix: below [0] = disagrees, above [1] = agrees (the reach) */
export const ANCHOR_FIT = { SEARCH: 4, SNAP: 3, STILL: 2, OK: 0.7, TIE: 0.05, NEAR: 0.08, ELSE: 0.15, TIMING: 0.1, Q: [0.05, 0.4], SPLIT: 0.5, AGREE: [0.4, 0.6] };

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
/** An anchor of pos at ms (a frame start): the same kind on that frame (within tol) = removed (the key again takes it off),
 *  another kind on that frame = replaced, any other frame = one more (any number of each kind).
 *  -> {list, did: 'add' | 'replace' | 'remove', shot} | null (no shot at ms). */
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

// ---- the local solve ----
const sstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, [a, b]) => sstep((x - a) / (b - a));
const pctl = (v, p, a = 0, b = v.length) => { const s = []; for (let q = a; q < b; q++) if (fin(v[q])) s.push(v[q]); s.sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] : NaN; };
/** Pearson r of x and y over samples [a, b) where both are finite (NaN: under 8 such samples or no spread). */
function corr(x, y, a = 0, b = x.length) {
  let n = 0, sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let q = Math.max(0, a); q < Math.min(b, x.length); q++) { const u = x[q], v = y[q]; if (!fin(u) || !fin(v)) continue; n++; sx += u; sy += v; sxy += u * v; sxx += u * u; syy += v * v; }
  if (n < 8) return NaN;
  const vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
  return vx > 1e-12 && vy > 1e-12 ? (sxy - (sx * sy) / n) / Math.sqrt(vx * vy) : NaN;
}
/** v resampled at fractional sample positions s(q) (linear, clamped at the ends). */
const warp = (v, s) => Float64Array.from(s, (x) => { const n = v.length, a = Math.max(0, Math.min(n - 1, Math.floor(x))), b = Math.min(n - 1, a + 1), f = Math.max(0, Math.min(1, x - a)); return f ? v[a] * (1 - f) + v[b] * f : v[a]; });
/** The turn of kind k (+1 top, -1 bottom of v) nearest sample q within r samples -> its offset (samples) | null. */
const turnNear = (turns, q, k, r) => { let best = null; for (const [i, kk] of turns) if (kk === k && Math.abs(i - q) <= r && (best == null || Math.abs(i - q) < Math.abs(best))) best = i - q; return best; };
const median = (a) => { const s = a.filter(fin).sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
/** How well x has an extreme of kind k (+1 top / -1 bottom / 0 middle level) on sample q: 0..1, against x's own range over +-H
 *  samples; a top / bottom may sit within S samples of q (its timing is the section's shift's business). */
function fitAt(x, q, k, H, S) {
  const a = Math.max(0, q - H), b = Math.min(x.length, q + H + 1);
  let lo = Infinity, hi = -Infinity;
  for (let i = a; i < b; i++) if (fin(x[i])) { if (x[i] < lo) lo = x[i]; if (x[i] > hi) hi = x[i]; }
  if (!(hi - lo > 1e-9)) return 0;
  if (!k) return fin(x[q]) ? 1 - 2 * Math.abs((x[q] - lo) / (hi - lo) - 0.5) : 0;
  let z = k > 0 ? -Infinity : Infinity;
  for (let i = Math.max(0, q - S); i <= Math.min(x.length - 1, q + S); i++) if (fin(x[i])) z = k > 0 ? Math.max(z, x[i]) : Math.min(z, x[i]);
  return fin(z) ? (k > 0 ? (z - lo) / (hi - lo) : (hi - z) / (hi - lo)) : 0;
}
/** Savitzky-Golay over each gap-free stretch (fusion's own smoothing of the mix, half-width h samples). */
function smoothed(x, h) {
  const out = Float64Array.from(x);
  if (h < 2) return out;
  for (let i = 0; i < x.length;) { if (!fin(x[i])) { i++; continue; } let j = i; while (j < x.length && fin(x[j])) j++; if (j - i > 2 * h + 2) out.set(savgol(x.subarray ? x.subarray(i, j) : Float64Array.from(x.slice(i, j)), h), i); i = j; }
  return out;
}
/** The automatic mix's own sections: [[a, b)] sample ranges, cut where its window weights (fusion's per-window row shares,
 *  info.windows) drift so far from where the section started that they share less than SPLIT (the dominant rows changed), or
 *  where a window has no weight at all (its confidence collapsed). */
function forwardSections(t, windows, split, on = {}) {
  const m = t.length, idx = (ms) => { let lo = 0, hi = m - 1; while (lo < hi) { const c = (lo + hi) >> 1; if (t[c] < ms) lo = c + 1; else hi = c; } return lo; };
  const share = (a, b) => { let s = 0; for (const k in a) if (k in b) s += Math.min(a[k], b[k]); return s; };
  const top = (w) => Object.entries(w || {}).sort((x, y) => y[1] - x[1])[0]?.[0];
  const cuts = [];
  let ref = null;
  (windows || []).forEach((w, k) => {
    const empty = !Object.keys(w.w || {}).length;
    if (k && (empty || !ref || share(ref, w.w) < split)) {
      const p = windows[k - 1], c = idx(((p.t + p.t1) / 2 + (w.t + w.t1) / 2) / 2), r = idx(w.t1) - idx(w.t);
      // the windows place a change within a window's length: the cut goes to where the leading rows really come or go (their
      // presence), the nearest such frame within a window of it
      const d0 = on[top(ref)], d1 = on[top(w.w)];
      let best = c, bd = Infinity;
      for (let q = Math.max(1, c - r); q < Math.min(m, c + r); q++) if ((d1 && d1[q] && !d1[q - 1]) || (d0 && !d0[q] && d0[q - 1])) { if (Math.abs(q - c) < bd) { bd = Math.abs(q - c); best = q; } }
      cuts.push(best); ref = empty ? null : w.w;
    } else if (!ref) ref = empty ? null : w.w;
  });
  const b = [0, ...[...new Set(cuts)].filter((c) => c > 0 && c < m).sort((x, y) => x - y), m];
  return b.slice(1).map((e, i) => [b[i], e]).filter(([a, e]) => e > a);
}

/**
 * The fused signal of one run scene with the owner's anchors as LOCAL evidence. s = {t (ms), v (the automatic fused signal),
 * raw, tim, conf, rows: [{id, label, f (the row as fusion mixes it), q (its data-only quality)}], windows (info.windows),
 * periodMs}; anchors [{ms, y (the value it should read, 0..1, larger = the signal's top), sign?, pos?}].
 * 1. the automatic mix's sections (forwardSections); each section's anchors in groups that one candidate can meet together
 *    (a run of anchors no single candidate meets is split between them).
 * 2. per group the candidates: the automatic mix itself and every row with either sign. Score = standing x mean fit at the
 *    group's anchors (fitAt) + ELSE x its agreement with the automatic mix away from the anchors. The automatic mix stays
 *    when within TIE of the best (then only its timing may move); else the best candidates (within NEAR) are mixed, smoothed,
 *    set to the automatic mix's level and size there, shifted by the anchors' median turn offset, snapped locally.
 * 3. reach: the group's range, and when the chosen motion disagrees with the automatic mix at the anchors, only as far as it
 *    keeps disagreeing (where the automatic mix "corrects" itself the anchors stop); a half-window ramp inside each end
 *    (no step), nothing outside: there the automatic result is returned untouched, sample for sample. A group whose
 *    anchors agree with the automatic mix (within STILL frames) changes nothing.
 * -> null (no anchor on the signal) | {v, raw, tim, conf (new arrays), range [lo, hi] (the automatic signal's: the channel
 *    keeps its scale), info: {list: [{ms, pos, want, before, reads, moved, section}], sections: [{t0, t1, n, met, use, flipped,
 *    shift, compromise, unchanged}], rms: {before, after}}}.
 */
export function anchorLocal(s, anchors, o = ANCHOR_FIT) {
  const { t, v } = s, m = t.length;
  if (!m || !anchors?.length) return null;
  const dt = m > 1 ? (t[m - 1] - t[0]) / (m - 1) : 1000 / 30;
  const idx = (ms) => { let lo = 0, hi = m - 1; while (hi - lo > 1) { const c = (lo + hi) >> 1; if (t[c] <= ms) lo = c; else hi = c; } return Math.abs(t[hi] - ms) < Math.abs(t[lo] - ms) ? hi : lo; };
  const kind = (a) => (a.y > 0.5 ? 1 : a.y < 0.5 ? -1 : 0);
  const A = anchors.map((a) => ({ ...a, q: idx(a.ms) })).filter((a) => Math.abs(t[a.q] - a.ms) <= dt && fin(v[a.q]) && fin(a.y)).sort((x, y) => x.q - y.q);
  if (!A.length) return null;
  const per = s.periodMs > 0 ? s.periodMs : 1000, H = Math.max(4, Math.round(per / 2 / dt)), S = Math.round(o.SEARCH), W = Math.max(8, Math.round(2000 / dt)), R = W >> 1;
  let vlo = Infinity, vhi = -Infinity;
  for (const x of v) if (fin(x)) { if (x < vlo) vlo = x; if (x > vhi) vhi = x; }
  const cands = [{ id: '', label: 'the automatic mix', x: v, fwd: true, stand: 1 }, ...(s.rows || []).flatMap((r) => [1, -1].map((sg) => ({ id: r.id, label: r.label || r.id, sign: sg, x: Float64Array.from(r.f, (y) => sg * y), stand: 0.5 + 0.5 * ramp(r.q ?? 0, o.Q) })))];
  const fits = cands.map((c) => A.map((a) => fitAt(c.x, a.q, kind(a), H, S)));
  // 1. sections, and in each the anchors grouped so one candidate meets them all
  const groups = [];
  for (const [a, b] of forwardSections(t, s.windows, o.SPLIT, Object.fromEntries((s.rows || []).filter((r) => r.on).map((r) => [r.id, r.on])))) {
    const inS = A.map((x, k) => k).filter((k) => A[k].q >= a && A[k].q < b), mine = [];
    let g = [];
    const can = (ks) => cands.some((_, c) => ks.every((k) => fits[c][k] >= o.OK));
    // (anchors within a window of each other that no one candidate meets are a conflict, solved as one compromise, not split)
    for (const k of inS) { if (g.length && A[k].q - A[g.at(-1)].q >= W && can(g) && !can([...g, k])) { mine.push({ ks: g }); g = []; } g.push(k); }
    if (g.length) mine.push({ ks: g });
    // the groups of this section share it, cut half way between them
    mine.forEach((G, j) => { G.a = j ? Math.round((A[mine[j - 1].ks.at(-1)].q + A[G.ks[0]].q) / 2) : a; G.b = j + 1 < mine.length ? Math.round((A[G.ks.at(-1)].q + A[mine[j + 1].ks[0]].q) / 2) : b; groups.push(G); });
  }
  const V = Float64Array.from(v), Rw = Float64Array.from(s.raw || v), T = Float64Array.from(s.tim || v), moved = new Float64Array(m), sect = new Int16Array(m).fill(-1), sections = [];
  groups.forEach((G, gi) => {
    const ks = G.ks, c0 = Math.max(G.a, A[ks[0]].q - H), c1 = Math.min(G.b, A[ks.at(-1)].q + H + 1);
    // 2. the candidates for this group
    const away = (c) => (c.fwd ? 1 : (() => { const r1 = corr(c.x, v, 0, c0), r2 = corr(c.x, v, c1, m), n1 = c0, n2 = m - c1; const r = (fin(r1) ? r1 * n1 : 0) + (fin(r2) ? r2 * n2 : 0), n = (fin(r1) ? n1 : 0) + (fin(r2) ? n2 : 0); return n ? r / n : 0; })());
    // timing: a candidate whose turns sit at one steady offset from the anchors (a lag the section's shift removes) beats one
    // whose turns wander around them (TIMING per frame of spread, from two timed anchors on)
    const tk = ks.filter((k) => kind(A[k]));
    const spread = (c) => { if (tk.length < 2) return 0; const tu = signalTurns(t, c.x).turns, e = tk.map((k) => turnNear(tu, A[k].q, kind(A[k]), S) ?? S * 2), md = median(e); return Math.min(o.SEARCH, e.reduce((z, x) => z + Math.abs(x - md), 0) / e.length); };
    const score = cands.map((c, ci) => c.stand * ks.reduce((z, k) => z + fits[ci][k], 0) / ks.length + o.ELSE * away(c) - o.TIMING * spread(c));
    let best = 0;
    score.forEach((z, ci) => { if (z > score[best]) best = ci; });
    const useFwd = score[0] >= score[best] - o.TIE, ch = useFwd ? 0 : best, met = ks.filter((k) => fits[ch][k] >= o.OK).length;
    let x, xr;
    if (useFwd) { x = v; xr = s.raw || v; }
    else {
      // the best candidates (one sign per row), mixed by how far above the bar they are; smoothed; at the automatic mix's level / size here
      const pick = cands.map((c, ci) => ({ c, z: score[ci] })).filter(({ c, z }, ci) => !c.fwd && z >= score[best] - o.NEAR && !cands.some((d, di) => di !== ci && d.id === c.id && score[di] > z));
      const mix = new Float64Array(m).fill(NaN);
      for (let q = 0; q < m; q++) { let a = 0, w = 0; for (const { c, z } of pick) { const y = c.x[q]; if (fin(y)) { const ww = z - (score[best] - o.NEAR) + 1e-3; a += ww * y; w += ww; } } if (w > 0) mix[q] = a / w; }
      const lv = (y) => [pctl(y, 0.5, G.a, G.b), pctl(y, 0.9, G.a, G.b) - pctl(y, 0.1, G.a, G.b)], [mv, av] = lv(v), [mx, ax] = lv(mix), k = av > 1e-9 && ax > 1e-9 ? av / ax : 1;
      const fit = (y, q) => (fin(y) ? mv + (y - mx) * k : v[q]);
      xr = Float64Array.from(mix, fit);
      x = Float64Array.from(smoothed(mix, Math.round((0.15 * per) / dt)), fit);
    }
    // timing: the median turn offset at the group's in / out anchors shifts it, what is left is snapped locally
    const timed = ks.filter((k) => kind(A[k]));
    const off = (y, r) => { const tu = signalTurns(t, y).turns; return timed.map((k) => turnNear(tu, A[k].q, kind(A[k]), r)); };
    let D = median(off(x, S));
    if (Math.abs(D) <= o.STILL) D = 0;
    const sh = (y) => (D ? warp(y, Float64Array.from({ length: m }, (_, q) => q + D)) : y);
    let xs = sh(x), xrs = sh(xr), xts = useFwd ? sh(s.tim || v) : xs;
    const e1 = off(xs, o.SNAP), tu1 = signalTurns(t, xs).turns, snap = new Float64Array(m);
    timed.forEach((k, j) => {
      const e = e1[j], q0 = A[k].q;
      if (e == null || Math.abs(e) <= o.STILL) return;
      let half = Infinity;
      for (const [i, kk] of tu1) if (kk !== kind(A[k])) half = Math.min(half, Math.abs(i - (q0 + e)));
      const h = Math.max(3, Math.abs(e) + 2, fin(half) ? half / 2 : 6);
      for (let q = Math.max(0, Math.floor(q0 - h)); q <= Math.min(m - 1, Math.ceil(q0 + h)); q++) snap[q] += e * Math.max(0, 1 - Math.abs(q - q0) / h);
    });
    const snapped = snap.some((y) => y);
    if (snapped) { const sm = Float64Array.from({ length: m }, (_, q) => q + snap[q]); xs = warp(xs, sm); xrs = warp(xrs, sm); xts = warp(xts, sm); }
    const unchanged = useFwd && !D && !snapped;
    // 3. reach: where the chosen motion disagrees with the automatic mix at the anchors, only as far as that lasts
    let ra = G.a, rb = G.b;
    const rw = (q) => corr(xs, v, q - R, q + R);
    if (!useFwd) {
      const at = ks.map((k) => rw(A[k].q)).filter(fin);
      if (at.length && median(at) < o.AGREE[0]) {
        for (let q = c0; q > G.a; q -= Math.max(1, R >> 1)) { if (rw(q) >= o.AGREE[1]) { ra = q; break; } }
        for (let q = c1; q < G.b; q += Math.max(1, R >> 1)) { if (rw(q) >= o.AGREE[1]) { rb = q; break; } }
      }
    }
    const lo = ra > 0 ? ra : -Infinity, hi = rb < m ? rb : Infinity;   // a scene edge needs no ramp
    if (!unchanged) for (let q = ra; q < rb; q++) {
      const al = Math.min(lo === -Infinity ? 1 : sstep((q - lo + 0.5) / R), hi === Infinity ? 1 : sstep((hi - q - 0.5) / R));
      if (!(al > 0) || !fin(v[q])) continue;
      V[q] = Math.min(vhi, Math.max(vlo, v[q] + al * (xs[q] - v[q])));
      if (fin(Rw[q]) && fin(xrs[q])) Rw[q] = Rw[q] + al * (xrs[q] - Rw[q]);
      if (fin(T[q]) && fin(xts[q])) T[q] = T[q] + al * (xts[q] - T[q]);
      moved[q] = al * (D + snap[q]); sect[q] = gi;
    }
    const fl = !useFwd && (corr(xs, v, ra, rb) || 0) < -0.3;
    sections.push({ t0: Math.round(t[ra]), t1: Math.round(t[Math.min(m - 1, rb - 1)]), n: ks.length, met, use: useFwd ? null : [...new Set(cands.filter((c, ci) => !c.fwd && score[ci] >= score[best] - o.NEAR).map((c) => c.label))].slice(0, 3), flipped: fl, shift: D, compromise: met < ks.length, unchanged });
    for (const k of ks) A[k].section = gi;
  });
  const at01 = (y, q) => (vhi > vlo ? (Math.min(vhi, Math.max(vlo, y[q])) - vlo) / (vhi - vlo) : 0.5);
  const pos = (a, z) => Math.round(100 * (a.sign < 0 ? 1 - z : z));
  const list = A.map((a) => ({ ms: a.ms, pos: a.pos ?? pos(a, a.y), want: pos(a, a.y), before: pos(a, at01(v, a.q)), reads: pos(a, at01(V, a.q)), moved: +moved[a.q].toFixed(1), section: a.section ?? -1 }));
  const rms = (key) => Math.round(Math.sqrt(list.reduce((z, x) => z + (x[key] - x.want) ** 2, 0) / list.length));
  return { v: V, raw: Rw, tim: T, conf: s.conf ? Float64Array.from(s.conf) : null, range: [vlo, vhi], info: { list, sections, rms: { before: rms('before'), after: rms('reads') } } };
}

const frames = (n) => `${Math.abs(n)} frame${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'earlier' : 'later'}`;
/** One anchor's residual in plain words (the fusion panel): 'fully in: reads 4 (was 31), its turn moved 2 frames earlier'. */
export const anchorLine = (x) => `${ANCHOR_WORD[x.pos] ?? x.pos}: reads ${x.reads}${x.reads === x.before ? '' : ` (was ${x.before})`}${Math.abs(x.moved) >= 0.5 ? `, its turn moved ${frames(Math.round(x.moved))}` : ''}`;
/** One section's line for the fusion panel, in plain words: where, how many anchors, what it did and why. */
export function sectionText(sc, fmt = (ms) => `${(ms / 1000).toFixed(1)} s`) {
  const where = `${fmt(sc.t0)}–${fmt(sc.t1)} (${sc.n} anchor${sc.n === 1 ? '' : 's'})`;
  if (sc.unchanged) return `${where}: the automatic mix already meets them, unchanged`;
  const what = sc.use ? `moved to ${sc.use.join(' + ')}${sc.flipped ? ', the other way up from the automatic mix' : ''} (the automatic mix did not put its turns on these frames)` : 'kept the automatic mix';
  const shift = sc.shift ? ` · shifted ${frames(sc.shift)}` : '';
  const conflict = sc.compromise ? ` · the anchors here disagree with each other: best compromise, ${sc.met} of ${sc.n} met` : '';
  return `${where}: ${what}${shift}${conflict}`;
}
/** paw-tymw: what the anchor at ms did, for its toast, from the shot's anchors record (anchorLocal's info; tol ms): '' when it
 *  changed the fused stroke, else why not, in a few words. */
export function anchorEffect(a, ms, tol = 17) {
  const x = a?.list?.find((y) => Math.abs(y.ms - ms) <= tol);
  if (!x) return ' · the fused stroke has no data on this frame: it changes nothing';
  return a.sections?.[x.section]?.unchanged ? ' · the automatic mix already fits these frames best: nothing changed' : '';
}
/** The anchors' summary for the fusion panel ('' = none). */
export function anchorsText(a) {
  if (!a?.list?.length) return '';
  const ch = a.sections.filter((x) => !x.unchanged).length;
  return `${a.sections.length} section${a.sections.length === 1 ? '' : 's'}, ${ch ? `${ch} changed` : 'none changed'} · off by ${a.rms.after} on average (automatic: ${a.rms.before})`;
}
