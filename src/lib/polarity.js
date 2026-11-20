// polarity.js -- paw-57ve, pure (test/polarity.test.mjs): stretches of a run whose direction is flipped relative to the
// rest of their run scene, for a measured signal whose sense flops mid-shot (the motion right, upside down from some
// frame on). A whole-scene flip (F) cannot fix that; the owner drags the stretch on the Tracker row's direction strip.
//   stretches   [[t0, t1), ...] absolute ms, sorted, never overlapping or touching (touching ones merge), never across
//               a run scene cut (split there). Stored on the shots, per run (shot.polarity = {[runId]: [[t0, t1]]}),
//               like the per-run Adjust settings: undoable, saved in the .pawproj.
//   flipChannel the run scene's signal mirrored about the middle of its range inside each stretch (so it stays in the
//               scene's fitted range). At a stretch end the mirrored signal continues the unflipped one: the gap between
//               the unflipped side's next value (extrapolated from its last two samples) and the mirrored value fades
//               out over BLEND_MS inside the stretch. A measurement that jumped at the flop (the mirror already joins)
//               gets no correction; one that turned there (continuous, its sense inverted) is joined without a jump.
import { lowerBound } from './lane.js';
import { BLEND_MS } from './signal-source.js';

const fin = Number.isFinite;

/** Any list -> clean stretches: [t0, t1] pairs, rounded to ms, split at `cuts`, sorted, overlapping / touching merged
 *  (never across a cut). */
export function flipsClean(list, cuts = []) {
  const cs = [...new Set((cuts || []).filter(fin).map(Math.round))].sort((a, b) => a - b), out = [];
  const parts = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!Array.isArray(s) || !fin(s[0]) || !fin(s[1])) continue;
    let a = Math.round(Math.min(s[0], s[1])), b = Math.round(Math.max(s[0], s[1]));
    for (const c of cs) if (c > a && c < b) { parts.push([a, c]); a = c; }
    if (b > a) parts.push([a, b]);
  }
  parts.sort((p, q) => p[0] - q[0]);
  for (const [a, b] of parts) {
    const L = out[out.length - 1];
    if (L && a <= L[1] && !(a === L[1] && cs.includes(a))) L[1] = Math.max(L[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The stretches with [a, b) toggled: flipped parts there un-flip, the rest flips (two gestures never stack). */
export function xorFlips(list, a, b, cuts = []) {
  if (!(b > a)) return flipsClean(list, cuts);
  const out = [];
  for (const [u, v] of flipsClean(list, cuts)) {   // the old ones minus [a, b)
    if (v <= a || u >= b) { out.push([u, v]); continue; }
    if (u < a) out.push([u, a]);
    if (v > b) out.push([b, v]);
  }
  let x = a;   // plus the parts of [a, b) no old one covered
  for (const [u, v] of flipsClean(list, cuts)) {
    if (v <= a || u >= b) continue;
    if (u > x) out.push([x, u]);
    x = Math.max(x, v);
  }
  if (b > x) out.push([x, b]);
  return flipsClean(out, cuts);
}

/** The stretches inside [a, b), clipped. */
export const flipsIn = (list, a, b) => (list || []).filter(([u, v]) => v > a && u < b).map(([u, v]) => [Math.max(u, a), Math.min(v, b)]);

/** Is t inside a stretch? */
export const flippedAt = (list, t) => (list || []).some(([u, v]) => t >= u && t < v);

/**
 * paw-vtec: ONE notion of a run's direction, relative to its tracked signal (the sidecar's scene sign is already in its
 * points and samples; a raw channel takes it in pointsFromChannel). The owner's whole-scene flips (run.flips: F, a strip
 * click, flipRun, the repeat-direction pass), Assist's span orientations (run.orient [{t0, t1, sign}]: absolute inside
 * their span, over the scene flips) and the polarity stretches (relative to their scene, xor) give one played-mirrored
 * map, applied to the SIGNAL before anything direction-dependent reads it (runs-channel.js channelPatch): never to the
 * finished points. Per run scene i (span = the scene clipped to the run's range): whole (the scene's direction is
 * mirrored: the scene's sign times -1) when the map covers the scene, not when it is empty, else the owner's scene flip;
 * partial = where the map differs from that (mirrored at the signal by flipChannel, the joins continuous). So a stretch
 * over a whole scene IS a whole-scene flip downstream. -> {whole: Set of scene indices (0 for a run without scenes),
 * partial: clean stretches}.
 */
export function directionOf(run, stretches = []) {
  const sc = run?.scenes?.length ? run.scenes : null, n = sc ? sc.length : 1, flips = new Set(run?.flips || []), orient = (run?.orient || []).filter((o) => fin(o?.t0) && fin(o?.t1) && o.t1 > o.t0);
  const r0 = fin(run?.range?.start) ? run.range.start : -Infinity, r1 = fin(run?.range?.end) ? run.range.end : Infinity;
  const whole = new Set(), partial = [], st = flipsClean(stretches, sc ? sc.slice(1).map((s) => s.start_ms) : []);
  for (let i = 0; i < n; i++) {
    const a = Math.max(r0, sc ? sc[i].start_ms : -Infinity), b = Math.min(r1, sc ? (i + 1 < n ? sc[i + 1].start_ms : sc[i].end_ms) : Infinity);
    if (!(b > a)) continue;
    let m = flips.has(i) ? [[a, b]] : [];   // the map: the scene flip, Assist's spans over it, the stretches xor'd in
    for (const o of orient) {
      const u = Math.max(a, o.t0), v = Math.min(b, o.t1);
      if (!(v > u)) continue;
      m = flipsClean([...m.flatMap(([p, q]) => (q <= u || p >= v ? [[p, q]] : [p < u && [p, u], q > v && [v, q]].filter(Boolean))), ...(o.sign < 0 ? [[u, v]] : [])]);
    }
    for (const [u, v] of flipsIn(st, a, b)) m = xorFlips(m, u, v);
    const all = m.length === 1 && m[0][0] <= a + 1 && m[0][1] >= b - 1, w = all || (m.length > 0 && flips.has(i));
    if (w) whole.add(i);
    partial.push(...(w ? (all ? [] : xorFlips(m, a, b).filter(([u, v]) => v - u >= 1)) : m));
  }
  return { whole, partial: flipsClean(partial, sc ? sc.slice(1).map((s) => s.start_ms) : []) };
}
/** paw-vtec (paw-403x): the stretches of an averaged loop apply at the same phase in every pass (its passes carry one
 *  averaged signal, so a part upside down in one is upside down in all). plans [{passes, maps}] (loop-average.js loopPlan
 *  of the loops that are on) -> the stretches with each one's copies in the other passes (by picture: the phase maps). */
export function loopFlips(list, plans = []) {
  const out = [...(list || [])];
  for (const { passes, maps } of plans || []) for (const [u, v] of list || []) passes.forEach((p, k) => {
    const a = Math.max(u, p.t0), b = Math.min(v, p.t1);
    if (!(b > a)) return;
    const ya = maps[k].at(a), yb = maps[k].at(b);
    // (whole ms, down: a frame time maps to a frame time, and a copy keeps the same frames as its stretch)
    passes.forEach((q, m) => { if (m === k) return; const x0 = Math.floor(Math.max(q.t0, maps[m].inv(ya)) + 1e-6), x1 = Math.floor(Math.min(q.t1, maps[m].inv(yb)) + 1e-6); if (x1 > x0) out.push([x0, x1]); });
  });
  return out;
}
/** The direction the script plays at time t relative to the tracker's own signal (+1 / -1): the scene's sidecar sign
 *  times the run's direction map (run.dir, channelPatch's; else directionOf on its stored stretches). */
export function signAt(run, t) {
  const sc = run?.scenes || [], k = sc.length ? Math.max(0, sc.reduce((q, s, i) => (s.start_ms <= t ? i : q), 0)) : 0, d = run?.dir || directionOf(run, run?.flipSpans);
  return (sc[k]?.sign ?? 1) * ((d.whole instanceof Set ? d.whole.has(k) : (d.whole || []).includes(k)) ? -1 : 1) * (flippedAt(d.partial, t) ? -1 : 1);
}

/** paw-s80k: the direction strip's words for a run scene's match record (runs-channel.js channelPatch extra.match:
 *  {ref, r, flip, weak}) -> '' when the scene plays its own channel. */
export function matchText(m, key = 'F') {
  if (!m) return '';
  const ref = m.ref === 'primary' ? "the tracker's own signal" : m.ref === 'fused' ? 'Fused' : m.ref;
  if (m.weak) return `this signal and ${ref} do not move together (r ${m.r}), so it is left as it comes: ${key} if it is upside down`;
  return `plays the same way up as ${ref} (r ${Math.abs(m.r)}${m.flip ? ', turned over to match' : ''})`;
}

const smooth = (x) => x * x * (3 - 2 * x);
/**
 * base (a channel {t, v, conf?, timing?, how?}) with `stretches` mirrored inside [lo, hi) (the run scene): v -> L + H - v
 * (L..H = the base's range there), joined at each stretch end (header); `scaled` on the base's scale. timing follows the flipped signal inside (it
 * times itself, as a range override's does). -> {t, v, min, max, scaled, conf?, timing?, how?} on the base's grid.
 */
export function flipChannel(base, stretches, { lo = -Infinity, hi = Infinity, blendMs = BLEND_MS } = {}) {
  const t = base.t, n = t.length, x = base.v, v = Float32Array.from(x), timing = base.timing ? Float32Array.from(base.timing) : null;
  let L = Infinity, H = -Infinity;
  for (let j = 0; j < n; j++) if (t[j] >= lo && t[j] < hi && x[j] === x[j]) { if (x[j] < L) L = x[j]; if (x[j] > H) H = x[j]; }
  const ok = (j) => j >= 0 && j < n && t[j] >= lo && t[j] < hi && x[j] === x[j];
  // the unflipped side's next value: its last sample continued by its last step (one sample: itself)
  const ahead = (k, d) => (!ok(k) ? NaN : ok(k + d) ? 2 * x[k] - x[k + d] : x[k]);
  if (H >= L) for (const [a, b] of stretches || []) {
    const s0 = Math.max(lo, a), s1 = Math.min(hi, b), j0 = lowerBound(t, s0), j1 = lowerBound(t, s1);
    if (!(s1 > s0) || j1 <= j0) continue;
    const m = (j) => L + H - x[j], g0 = ahead(j0 - 1, -1) - m(j0), g1 = ahead(j1, 1) - m(j1 - 1);
    const B = Math.max(1, Math.min(blendMs, (s1 - s0) / 2));
    for (let j = j0; j < j1; j++) {
      if (x[j] !== x[j]) continue;
      const w0 = g0 === g0 ? 1 - smooth(Math.min(1, (t[j] - t[j0]) / B)) : 0, w1 = g1 === g1 ? 1 - smooth(Math.min(1, (t[j1 - 1] - t[j]) / B)) : 0;
      v[j] = m(j) + (w0 ? w0 * g0 : 0) + (w1 ? w1 * g1 : 0);
      if (timing) timing[j] = v[j];
    }
  }
  let min = Infinity, max = -Infinity;
  for (const y of v) if (y === y) { if (y < min) min = y; if (y > max) max = y; }
  if (min > max) min = max = 0;
  const s0 = base.scaled && Number.isFinite(base.min) ? base.min : min, s1 = base.scaled && Number.isFinite(base.max) ? base.max : max;   // the lane keeps the base's scale
  return { t, v, min, max, scaled: Float32Array.from(v, (y) => (y - s0) / (s1 - s0 || 1)), ...(base.conf ? { conf: base.conf } : {}), ...(timing ? { timing } : {}), ...(base.how ? { how: base.how } : {}), ...(base.signed ? { signed: true } : {}), ...(base.absolute ? { absolute: true } : {}) };
}
