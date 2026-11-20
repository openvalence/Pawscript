// cmdlogic.js -- pure helpers behind the lane keyboard commands and the recorder (test/lanes-commands.test.mjs).
import { normalize } from '../../lib/core/script.js';
import { snapFrame } from './geom.js';
import { moveLimits, applyMove } from './drag.js';
import { indices } from './select.js';
import { fitRecording } from './record.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Time for a new point: the playhead, minus the reaction latency while playing, frame-snapped when frameMs (a frame grid, lane.js) is set. */
export function pointTime(t, { playing = false, latency = 0, frameMs = 0 } = {}) {
  return Math.max(0, snapFrame(t - (playing ? latency : 0), frameMs));
}

/** The playhead as the user sees it. Paused: the start of the frame on screen or being sought (a step or a click
 *  updates the transport at once, but timeMs only follows when that frame is presented, 60-100 ms later; a seek
 *  target sits mid-frame). Playing, or the shell's fallback player without a frame clock: timeMs. */
export function playheadMs(p) {
  if (!p.playing && p.restMs != null) return p.restMs;   // paw-ef73.14: resting between frames after a smooth scrub (a point keeps it; Snap snaps it)
  if (p.playing || typeof p.frameAt !== 'function' || typeof p.timeOfFrame !== 'function') return p.timeMs;
  return p.timeOfFrame(p.frameAt(p.displayMs ?? p.timeMs));
}

/** Same actions (at and pos) in the same order: an edit that would change nothing. */
export function sameScript(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].at !== b[i].at || a[i].pos !== b[i].pos) return false;
  return true;
}

/** Drop the points an edit put past `end` (the video's end), keeping any that were already there unchanged
 *  (a script longer than its video is not ours to trim). -> {script, dropped}. */
export function clipToEnd(next, prev, end) {
  if (!(end > 0) || !next.length || next[next.length - 1].at <= end) return { script: next, dropped: 0 };
  const had = new Map();
  for (let i = prev.length - 1; i >= 0 && prev[i].at > end; i--) had.set(prev[i].at, prev[i].pos);
  const script = next.filter((a) => a.at <= end || had.get(a.at) === a.pos);
  return { script, dropped: next.length - script.length };
}

/** The frame start one frame after (dir > 0) / before t. On the grid (within 1 ms rounding) that is exactly one frame;
 *  off the grid, the next / previous frame start. Stays on the grid however often it repeats (no 33-vs-33.3 drift). */
export function frameStep(t, dir, f) {
  if (!(f > 0)) return Math.max(0, t + dir);
  const k = Math.round(t / f), on = Math.abs(Math.round(k * f) - t) <= 1;
  const n = on ? k + dir : dir > 0 ? Math.floor(t / f) + 1 : Math.ceil(t / f) - 1;
  return Math.max(0, Math.round(n * f));
}

/**
 * Move the selected ats (Set) by dt ms / dp pos as one rigid block, clamped so nothing crosses or touches an
 * unselected neighbour and the block keeps its shape at 0 / 100. -> {script, ats, dt, dp} (dt, dp as applied).
 */
export function nudgeBlock(script, ats, dt, dp, dur = Infinity) {
  const idx = indices(script, ats), lim = moveLimits(script, idx, 'clamp', 1, dur);
  const t = clamp(dt, lim.dtMin, lim.dtMax) + 0, p = clamp(dp, lim.dpMin, lim.dpMax) + 0;
  if (!t && !p) return { script, ats: idx.map((i) => script[i].at), dt: 0, dp: 0 };
  return { script: applyMove(script, idx, t, p, 'clamp'), ats: idx.map((i) => script[i].at + t), dt: t, dp: p };
}

/**
 * paw-5zpf: E (extrude): where the new point goes, pulled dt ms / dp pos out of point p. Two points never share a time: a pull
 * that stays within `minDt` of p (a level-only `E Y 2 0`) puts it minDt later (earlier at the video's end); the time stays in
 * [0, dur], the level in 0..100. A point already at that exact time is replaced (p never is). -> {script, at}.
 */
export function extrudeFrom(script, p, dt, dp, { dur = Infinity, minDt = 1 } = {}) {
  let at = clamp(Math.round(p.at + dt), 0, dur);
  if (Math.abs(at - p.at) < minDt) at = Math.round(dt < 0 || p.at + minDt > dur ? p.at - minDt : p.at + minDt);
  at = clamp(at, 0, dur);
  if (at === p.at) return { script, at: null };   // nowhere to put it (a zero-length video)
  const q = { at, pos: clamp(Math.round(p.pos + dp), 0, 100) }, out = script.filter((a) => a.at !== at);
  let i = 0;
  while (i < out.length && out[i].at < at) i++;
  out.splice(i, 0, q);
  return { script: out, at };
}

/** {t0, t1} of a set of times, or null when empty. */
export function timeSpan(ats) {
  let t0 = Infinity, t1 = -Infinity;
  for (const t of ats) { if (t < t0) t0 = t; if (t > t1) t1 = t; }
  return t0 <= t1 ? { t0, t1 } : null;
}

/** View {start, span} that shows [t0, t1] with pad (fraction per side) and at least minSpan ms. */
export function fitSpan(t0, t1, pad = 0.08, minSpan = 400) {
  const span = Math.max(minSpan, (t1 - t0) * (1 + 2 * pad));
  return { start: (t0 + t1) / 2 - span / 2, span };
}

/** A finished recording -> Script. live: RDP fit of the dense samples; tap: the taps, frame-snapped, later tap wins a frame. */
export function recordingToScript(rec, { eps = 4, frameMs = 0 } = {}) {
  if (!rec?.samples?.length) return [];
  if (rec.mode === 'tap') return normalize(rec.samples.map((s) => ({ at: Math.max(0, snapFrame(s.t, frameMs)), pos: s.pos })));
  return fitRecording(rec.samples, { eps });
}
