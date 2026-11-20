// loops.js -- loop regions (outline §8): {id, t0, t1, tiledTo?: ms, srcKey?, axis?, join?, variation?}.
// [t0, t1) is ONE clean cycle; tiledTo (the .pawproj shape: a number) is where the tiles end. Tiling repeats the
// cycle forward with exact timing: rep k starts at round(t0 + k * P), computed from t0, never accumulated, so
// nothing drifts. P is the period: a whole number of frames * frameMs when the region is frame-exact (so a
// 72-frame cycle at 29.97 fps is 2402.4 ms, not the 2402 ms the integer t1 says), else t1 - t0. Pure.
// `frameMs` everywhere here is the frame grid (lane.js: the player's clock, or a frame length): paw-kxz4, loops sit on the
// video's real frames (a file whose frames are not at n x 1000 / fps put the loop's bars between frames).
import { lowerBound, removeRange, upsert } from '../../lib/core/script.js';
import { frameAt, frameTime, frameStart, frameLen } from '../../lib/lane.js';

/** Cycle length in ms and frames; exact when both edges sit on frame starts (to 0.5 ms). real: the cycle's length on the
 *  clock, unrounded (= ms when not exact). */
export function loopInfo(loop, frameMs) {
  const ms = loop.t1 - loop.t0, fm = frameLen(frameMs);
  if (!fm) return { ms, frames: 0, exact: false, real: ms };
  const f0 = frameAt(loop.t0, frameMs), f1 = frameAt(loop.t1, frameMs);
  const exact = f1 > f0 && Math.abs(loop.t0 - frameTime(f0, frameMs)) <= 0.5 && Math.abs(loop.t1 - frameTime(f1, frameMs)) <= 0.5;
  return exact ? { ms, frames: f1 - f0, exact, real: frameStart(f1, frameMs) - frameStart(f0, frameMs) } : { ms, frames: Math.round(ms / fm), exact, real: ms };
}
/** The start of the frame nearest t (no grid: t rounded). */
export const toFrame = (t, frameMs) => (frameLen(frameMs) ? frameTime(frameAt(t + frameLen(frameMs) / 2, frameMs), frameMs) : Math.round(t));

/** The tiling period (see top). */
export const periodOf = (loop, frameMs) => loopInfo(loop, frameMs).real;
/** Start of tile 1 = end of the source cycle in whole ms: the cycle is [t0, cycleEnd). */
export const cycleEnd = (loop, P) => Math.round(loop.t0 + P);

/** Repetitions of the cycle from t0 up to `end`: [{k, t0, t1, partial}] (k = 0 is the source cycle). */
export function repetitions(loop, end, max = 10000, P = loop.t1 - loop.t0) {
  const out = [];
  if (!(P > 0) || !(end > loop.t0)) return out;
  for (let k = 0; out.length < max; k++) {
    const t0 = loop.t0 + k * P;
    if (t0 >= end) break;
    const t1 = Math.min(t0 + P, end);
    out.push({ k, t0: Math.round(t0), t1: Math.round(t1), partial: t1 < t0 + P - 0.5 });
  }
  return out;
}
/** Repetition index under t (0 = source), or -1 outside [t0, tiledTo). */
export function repAt(loop, t, P) {
  const end = Math.max(loop.t1, loop.tiledTo || 0);
  if (t < loop.t0 || t >= end || !(P > 0)) return -1;
  const k = Math.floor((t - loop.t0) / P);
  return Math.round(loop.t0 + (k + 1) * P) <= t ? k + 1 : Math.round(loop.t0 + k * P) > t ? k - 1 : k;
}

/** The cycle's actions [t0, cycleEnd) of a script. */
export const cycleOf = (script, loop, P = loop.t1 - loop.t0) => script.slice(lowerBound(script, loop.t0), lowerBound(script, cycleEnd(loop, P)));

/** The join from the cycle's last point to the next cycle's first: {dt, dpos, speed (pos/s)} or null (< 2 points). */
export function seam(cycle, period) {
  if (cycle.length < 2) return null;
  const a = cycle[cycle.length - 1], b = cycle[0], dt = b.at + period - a.at, dpos = Math.abs(b.pos - a.pos);
  return { dt, dpos, speed: dt > 0 ? (dpos * 1000) / dt : Infinity };
}
/** Warn when the seam is faster than the cycle's own fastest move (and > minSpeed), or has no time at all. */
export function seamWarning(cycle, period, minSpeed = 120) {
  const s = seam(cycle, period);
  if (!s) return null;
  let peak = 0;
  for (let i = 1; i < cycle.length; i++) peak = Math.max(peak, (Math.abs(cycle[i].pos - cycle[i - 1].pos) * 1000) / (cycle[i].at - cycle[i - 1].at));
  return s.dt <= 0 || (s.speed > minSpeed && s.speed > peak * 1.25) ? { ...s, peak } : null;
}

/** Fingerprint of the cycle (period + content relative to t0): tiles go stale when it changes. */
export const srcKey = (script, loop, P = loop.t1 - loop.t0) => `${P.toFixed(3)}|` + cycleOf(script, loop, P).map((a) => `${a.at - loop.t0}:${a.pos}`).join(',');
export const isTiled = (loop) => loop.tiledTo > loop.t1;
export const needsRetile = (script, loop, P = loop.t1 - loop.t0) => isTiled(loop) && loop.srcKey != null && loop.srcKey !== srcKey(script, loop, P);

/** Period suggestions from scene loop results ({period_ms, motion_period_ms, kind, confidence}) at scene starts. */
export function suggestions(scenes = []) {
  const out = [];
  for (const s of scenes) {
    const l = s.loop;
    const p = l?.kind === 'exact' ? l.period_ms : l?.motion_period_ms;
    if (p > 0) out.push({ t0: s.start_ms, t1: Math.round(s.start_ms + p), period: p, frames: l.kind === 'exact' ? l.period_frames : l.motion_period_frames, kind: l.kind, confidence: l.confidence, sceneEnd: s.end_ms });
  }
  return out;
}
/** A suggestion's period in ms on this video's frame grid (its frame count wins when it has one). */
export const sugPeriod = (sug, frameMs) => (sug.frames > 0 && frameLen(frameMs) ? sug.frames * frameLen(frameMs) : sug.period);
/** Frame-snapped loop region {t0, t1} for a period starting at t. */
export function regionAt(t, period, frameMs) {
  const t0 = toFrame(t, frameMs);
  return { t0, t1: Math.max(t0 + 1, toFrame(t0 + period, frameMs)) };
}
/** True if [t0, t1) overlaps any loop (except `exceptId`). */
export const overlaps = (loops, t0, t1, exceptId) => loops.some((l) => l.id !== exceptId && l.t0 < t1 && t0 < l.t1);

/** Room for a loop's cycle and tiles: from the previous loop's end to the next loop's start (or dur). */
export function roomOf(loops, loop, dur) {
  let lo = 0, hi = dur;
  for (const l of loops) {
    if (l.id === loop.id) continue;
    if (l.t0 >= loop.t1) hi = Math.min(hi, l.t0);
    else if (l.t1 <= loop.t0) lo = Math.max(lo, Math.max(l.t1, l.tiledTo || 0));
  }
  return { lo, hi };
}

/**
 * Where "Tile across range" ends: the range end when the range ends after the cycle, else the end of the scene
 * containing the loop, else null (ask). Capped at the next loop. -> {end, why: 'range'|'scene'} | null.
 */
export function tileTarget(loop, { range, scenes = [], loops = [], dur = Infinity }) {
  const { hi } = roomOf(loops, loop, dur), c = (end, why) => (Math.min(end, hi) > loop.t1 ? { end: Math.min(end, hi), why } : null);
  if (range && range.t1 > loop.t1) return c(Math.round(range.t1), 'range');
  const sc = scenes.find((s) => s.start_ms <= loop.t0 && loop.t0 < s.end_ms && s.end_ms > loop.t1);
  return sc ? c(sc.end_ms, 'scene') : null;
}

// ---- paw-j3to: tiling ends where the loop ends (an owner clip, shot 65: 29 tiles ran 7.8 s past the repeated
// pictures, through the orgasm). Measured there (whole-frame grey difference to the cycle's frame at the same phase, 0..255):
// exact passes 0.0-0.1, a neighbouring frame 2.0, the passes after the slip 2.1-2.7 at the same phase, 0.2-0.9 one frame later.
/** ratio: a pass matches while its mean distance to the cycle at its phase is <= ratio x its mean frame-to-frame change;
 *  shiftMax: the phase shifts (frames, either way) looked at when a pass fails. */
export const TILE_MATCH = Object.freeze({ ratio: 0.5, shiftMax: 3 });
/**
 * How far a loop's passes still show its cycle. d(a, b) = the picture distance of frames a and b (frame numbers; null =
 * unknown); the cycle = frames f0 .. f0 + F - 1; frames up to f0 + maxFrames are looked at (a last part pass counts by its
 * frames). From pass k0 (1 = the first after the cycle) at shift s0 (frame x showing the cycle's phase of x - s0), the first
 * pass that fails ends the match; that pass (or the next) at another shift s (|s| <= shiftMax) -> shift, from (the pass it matched). -> {end (frames after f0 that
 * match, the cycle included), passes (whole passes after the cycle), shift (0 = none), known (false: no pictures)}.
 */
export function passMatch(f0, F, maxFrames, d, o = TILE_MATCH, { k0 = 1, s0 = 0 } = {}) {
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const at = (x, s) => f0 + ((((x - f0 - s) % F) + F) % F);   // the cycle's frame for frame x at shift s
  const passAt = (k, s) => {
    const dd = [], cc = [];
    for (let j = 0; j < F && k * F + j < maxFrames; j++) {
      const x = f0 + k * F + j, a = d(x, at(x, s)), c = d(x, x - 1);
      if (a == null || c == null) return null;
      dd.push(a); cc.push(c);
    }
    const dist = mean(dd);
    return { ok: dd.length > 0 && dist <= o.ratio * mean(cc) + 1e-9, dist, n: dd.length };
  };
  let end = k0 * F;
  for (let k = k0; k * F < maxFrames; k++) {
    const p = passAt(k, s0);
    if (!p) return { end, passes: Math.floor(end / F) - 1, shift: 0, known: k > k0 };
    if (!p.ok) {
      let best = null;
      // (the pass where it slips can be half the old phase, half the new: the next pass decides too; the same shot 65)
      for (const kk of [k, k + 1]) for (let m = 1; m <= Math.min(o.shiftMax, F - 1); m++) for (const s of [s0 + m, s0 - m]) { const q = kk * F < maxFrames ? passAt(kk, s) : null; if (q?.ok && (!best || q.dist < best.dist)) best = { s, dist: q.dist, kk }; }
      return { end, passes: Math.floor(end / F) - 1, shift: best ? best.s : 0, from: best ? best.kk : k, known: true };
    }
    end += p.n;
  }
  return { end, passes: Math.floor(end / F) - 1, shift: 0, known: true };
}
/** The first modifier boundary after time c (a span's start or end, a point modifier such as a spurt marker): tiles never
 *  cross one (fx: doc.fx). -> ms | Infinity. */
export function fxStop(fx = [], c) {
  let e = Infinity;
  for (const m of fx || []) for (const x of [m?.t0, m?.t1]) if (Number.isFinite(x) && x > c && x < e) e = x;
  return e;
}

/** The tiled end for a handle dragged to t: snapped to a repetition boundary (unless snap is false), in (t1, max]; <= t1 means no tiles. */
export function tiledEndAt(loop, t, { P, snap = true, max = Infinity }) {
  let e = t;
  if (snap) e = Math.round(loop.t0 + Math.max(1, Math.round((t - loop.t0) / P)) * P);
  if (snap && e > max) e = Math.round(loop.t0 + Math.max(1, Math.floor((max - loop.t0) / P)) * P);
  return Math.round(Math.min(max, Math.max(cycleEnd(loop, P), e)));
}

/** Move one edge by dir frames (on the frame grid first); keeps >= 1 frame and stays inside [lo, hi]. null if unchanged. */
export function nudgeEdge(loop, edge, dir, frameMs, { lo = 0, hi = Infinity } = {}) {
  const g = frameLen(frameMs) ? frameMs : 1, near = (t) => frameAt(t + frameLen(g) / 2, g);
  let t = frameTime(near(loop[edge]) + dir, g);
  t = edge === 't0' ? Math.max(lo, Math.min(t, frameTime(near(loop.t1) - 1, g)))
    : Math.min(hi, Math.max(t, frameTime(near(loop.t0) + 1, g)));
  return t === loop[edge] ? null : { ...loop, [edge]: t };
}
/** Both edges on the frame grid (at least one frame long). */
export function snapToFrames(loop, frameMs) {
  const t0 = toFrame(loop.t0, frameMs);
  return { ...loop, t0, t1: Math.max(toFrame(loop.t1, frameMs), toFrame(t0 + (frameLen(frameMs) || 1), frameMs)) };
}

/**
 * Tile the loop's source cycle from cycleEnd to `end` on `script`. gen = {tile, extractCycle} (src/lib/gen/loops.js).
 * The source cycle is never re-generated (so variation cannot compound across re-tiles); old tiles [cycleEnd,
 * loop.tiledTo] are cleared first. join 'meet': the cycle's last point (within joinTolMs of its end) takes the
 * first point's pos, in the source too, so every join closes. vary: {seed, amp, timeMs} (off when both 0).
 * -> {script, P, end, tiles, seam (gen's report), warn (seamWarning), issues, key (srcKey of the result)} or
 *    {error, issues} (script untouched).
 */
export function buildTiles(script, loop, end, gen, { frameMs = 0, join = 'keep', vary = null, joinTolMs = 50, maxSpeed } = {}) {
  const P = periodOf(loop, frameMs), c1 = cycleEnd(loop, P), issues = [];
  let s = isTiled(loop) ? removeRange(script, c1, loop.tiledTo) : script;
  let cycle = gen.extractCycle(s, loop.t0, c1 - loop.t0).filter((a) => a.at < c1);
  if (cycle.length < 2) return { error: 'Script the cycle first: it needs at least two points', issues };
  if (cycle[0].at !== s[lowerBound(s, loop.t0)]?.at) s = upsert(s, [cycle[0]]);   // the interpolated start point, so tile 0 == every tile
  if (join === 'meet') {
    const last = cycle[cycle.length - 1];
    if (c1 - last.at <= joinTolMs && last.pos !== cycle[0].pos) {
      const fixed = { at: last.at, pos: cycle[0].pos };
      cycle = [...cycle.slice(0, -1), fixed];
      s = upsert(s.filter((a) => a.at !== last.at), [fixed]);
    } else if (c1 - last.at > joinTolMs) issues.push({ level: 'warn', msg: `join 'meet': no point within ${joinTolMs} ms of the cycle end` });
  }
  end = Math.round(end);
  if (end <= c1) return { script: s, P, end: loop.t1, tiles: [], seam: null, warn: seamWarning(cycle, P), issues, key: srcKey(s, loop, P) };
  const opts = { partial: 'clip' };
  if (vary && (vary.amp > 0 || vary.timeMs > 0)) opts.vary = { seed: vary.seed ?? 0, amp: vary.amp || 0, timeMs: vary.timeMs || 0 };
  if (maxSpeed != null) opts.maxSpeed = maxSpeed;
  // paw-j3to: loop.shifted {at, ms}: from `at` the footage shows the cycle ms later (the owner's "continue from here, shifted")
  const sh = loop.shifted && loop.shifted.at > c1 && loop.shifted.at < end ? loop.shifted : null;
  const r = gen.tile(cycle, loop.t0, P, c1, sh ? sh.at : end, opts), r2 = sh ? gen.tile(cycle, loop.t0, P, sh.at, end, { ...opts, gridT0: loop.t0 + sh.ms }) : null;
  const err = [...r.issues, ...(r2?.issues || [])].find((x) => x.level === 'error');
  if (err) return { error: err.msg, issues: [...issues, ...r.issues] };
  // replace [c1, end); the clipped end point at `end` is kept only if nothing of the user's sits there
  const all = r2 ? [...r.script.filter((a) => a.at < sh.at), ...r2.script.filter((a) => a.at >= sh.at)] : r.script;
  if (r2) r.tiles.push(...r2.tiles);
  const pts = all.filter((a) => a.at < end), tail = all.find((a) => a.at === end);
  s = removeRange(s, c1, end - 1);
  s = upsert(s, s[lowerBound(s, end)]?.at === end || !tail ? pts : [...pts, tail]);
  return { script: s, P, end, tiles: r.tiles, seam: r.seam, warn: seamWarning(cycle, P), issues: [...issues, ...r.issues], key: srcKey(s, loop, P) };
}

/** The script without the loop's tiles (cycleEnd .. tiledTo). */
export const withoutTiles = (script, loop, P) => (isTiled(loop) ? removeRange(script, cycleEnd(loop, P), loop.tiledTo) : script);

/** Short readout: "72 f · 2400.0 ms" (frames prefixed with ~ when the length is not a whole number of frames). */
export function loopLabel(loop, frameMs) {
  const i = loopInfo(loop, frameMs);
  return `${i.exact ? '' : '~'}${i.frames} f · ${i.real.toFixed(1)} ms`;
}
