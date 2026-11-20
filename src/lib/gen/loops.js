// Loop tiling: script one cycle, repeat it across a range with exact (drift-free) timing.
// Pure, no DOM, no deps. See README.md "Loops" for the published API.

import { clampPos, lowerBound, posAt, replaceRange } from '../core/script.js';
import { rngFor, DEFAULTS } from './util.js';

const NO_SEAM = Object.freeze({ speed: 0, spike: false, gapMs: 0, fromPos: null, toPos: null });

/** Points of one cycle: round(t0) <= at < round(t0) + lenMs, plus (includeStart) an interpolated point at round(t0). */
export function extractCycle(script, t0, lenMs, { includeStart = true } = {}) {
  const s0 = Math.round(t0);
  const out = script.slice(lowerBound(script, s0), lowerBound(script, s0 + lenMs));
  if (includeStart && script.length && s0 >= 0 && out[0]?.at !== s0) out.unshift({ at: s0, pos: clampPos(posAt(script, s0)) });
  return out;
}

/**
 * Repeat `cycle` (absolute times, cycleT0 <= at < cycleT0 + cycleLenMs) over [rangeT0, rangeT1].
 * Tile k starts at round(gridT0 + k * cycleLenMs) (or opts.starts[k]); its points are start + offset.
 * opts: { partial: 'clip'|'drop', join: 'keep'|'meet', joinTolMs, vary: { seed, amp, timeMs, anchor },
 *         stretch, maxSpeed (seam report only), gridT0, starts }.
 * -> { script, tiles: [{ k, start, end, partial }], seam: { speed, spike, gapMs, fromPos, toPos }, issues }
 */
export function tile(cycle, cycleT0, cycleLenMs, rangeT0, rangeT1, opts = {}) {
  const { partial = 'clip', join = 'keep', joinTolMs = 50, vary = {}, stretch = false, maxSpeed = DEFAULTS.maxSpeed, gridT0 = cycleT0 } = opts;
  const P = cycleLenMs, c0 = Math.round(cycleT0);
  const r0 = Math.max(0, Math.ceil(rangeT0)), r1 = Math.floor(rangeT1);
  const issues = [];
  const fail = (level, msg) => ({ script: [], tiles: [], seam: { ...NO_SEAM }, issues: [...issues, { level, msg }] });
  if (!(P > 0)) return fail('error', 'cycleLenMs must be > 0');
  const pts = cycle.filter((a) => a.at >= c0 && a.at < c0 + P);
  if (!pts.length) return fail('error', 'cycle has no points in [cycleT0, cycleT0 + cycleLenMs)');
  if (r1 < r0) return fail('error', 'empty range');

  const n = pts.length, offs = pts.map((a) => a.at - c0), pos = pts.map((a) => a.pos);
  if (join === 'meet') {
    if (n === 1 || P - offs[n - 1] <= joinTolMs) pos[n - 1] = pos[0];
    else issues.push({ level: 'warn', msg: `join 'meet': no closing point within ${joinTolMs} ms of the cycle end` });
  }

  // Kept { i, r } (cycle index, offset) for a tile of length L: offsets stretched if asked; anything on or past
  // the next tile's start is dropped (the later tile wins); equal stretched offsets keep the later point.
  const byLen = new Map();
  const offsFor = (L) => {
    let o = byLen.get(L);
    if (o) return o;
    o = [];
    for (let i = 0; i < n; i++) {
      const r = stretch ? Math.round((offs[i] * L) / P) : offs[i];
      if (r >= L) break;
      if (o.length && o[o.length - 1].r === r) o[o.length - 1] = { i, r }; else o.push({ i, r });
    }
    byLen.set(L, o);
    return o;
  };

  // ---- variation (off unless amp or timeMs > 0): seeded per k, so tile k never depends on the range
  const amp = vary.amp > 0 ? vary.amp : 0, tMax = vary.timeMs > 0 ? Math.floor(vary.timeMs) : 0;
  const lo = Math.min(...pos), hi = Math.max(...pos), anchor = vary.anchor ?? 'hi';
  const aPos = typeof anchor === 'number' ? anchor : anchor === 'lo' ? lo : anchor === 'mid' ? (lo + hi) / 2 : hi;

  const buildTile = (k, start, L, out) => {
    const o = offsFor(L);
    let s = 1, jit = null;
    if (amp || tMax) {
      const rng = rngFor(vary.seed ?? 0, 'tile', k);
      s = 1 + amp * (2 * rng() - 1);
      jit = Array.from({ length: n }, rng); // one draw per cycle point, kept or not
    }
    for (let j = 0; j < o.length; j++) {
      const { i, r } = o[j];
      let at = start + r;
      if (j > 0 && tMax) { // first point stays on its anchor; others move < half the room to each neighbour
        const room = Math.min(r - o[j - 1].r, (j + 1 < o.length ? o[j + 1].r : L) - r);
        at += Math.round((2 * jit[i] - 1) * Math.min(tMax, Math.ceil(room / 2) - 1));
      }
      out.push({ at, pos: s === 1 ? pos[i] : clampPos(aPos + (pos[i] - aPos) * s) });
    }
  };

  // ---- tile grid
  let starts = null;
  if (opts.starts) starts = [...new Set(opts.starts.map(Math.round))].sort((a, b) => a - b);
  const startOf = starts ? (k) => starts[k] : (k) => Math.round(gridT0 + k * P);
  const endOf = starts ? (k) => (k + 1 < starts.length ? starts[k + 1] : Math.round(starts[k] + P)) : (k) => startOf(k + 1);
  let kLo, kHi, kMin = -Infinity, kMax = Infinity;
  if (starts) {
    kMin = 0; kMax = starts.length - 1;
    kLo = 0; while (kLo <= kMax && endOf(kLo) <= r0) kLo++;
    kHi = kMax; while (kHi >= 0 && starts[kHi] > r1) kHi--;
  } else {
    kLo = Math.floor((r0 - gridT0) / P); while (endOf(kLo) <= r0) kLo++;
    kHi = Math.floor((r1 - gridT0) / P); while (startOf(kHi + 1) <= r1) kHi++;
  }
  if (kLo > kHi) return fail('warn', 'no tile overlaps the range');

  // ---- build: clip builds one neighbour tile each side so edge points interpolate along the tiled motion
  const tiles = [], full = [];
  let dropped = 0;
  const kA = partial === 'drop' ? kLo : Math.max(kMin, kLo - 1), kB = partial === 'drop' ? kHi : Math.min(kMax, kHi + 1);
  for (let k = kA; k <= kB; k++) {
    const start = startOf(k), end = endOf(k);
    const inRange = k >= kLo && k <= kHi, part = start < r0 || end > r1 + 1;
    if (partial === 'drop' && part) continue;
    if (inRange) { tiles.push({ k, start, end, partial: part }); dropped += n - offsFor(end - start).length; }
    buildTile(k, start, end - start, full);
  }
  if (dropped) issues.push({ level: 'warn', msg: `${dropped} cycle point(s) fell on or past the next tile's start and were dropped (the later tile wins)` });

  let script = full;
  if (partial !== 'drop') {
    script = full.slice(lowerBound(full, r0), lowerBound(full, r1 + 1));
    if (script[0]?.at !== r0) script.unshift({ at: r0, pos: clampPos(posAt(full, r0)) });
    if (script[script.length - 1].at !== r1) script.push({ at: r1, pos: clampPos(posAt(full, r1)) });
  }

  // ---- seam: cycle's last point -> next tile's first, over the shortest spacing that occurs (worst case)
  let lens;
  if (starts) {
    lens = new Set();
    for (let k = 0; k + 1 < starts.length; k++) lens.add(starts[k + 1] - starts[k]);
    if (!lens.size) lens.add(Math.round(P));
  } else lens = [Math.floor(P)];
  let seam = { ...NO_SEAM, speed: -1 };
  for (const L of lens) {
    const o = offsFor(L);
    if (!o.length) continue;
    const a = o[o.length - 1], b = o[0], gapMs = L - a.r + b.r;
    const speed = (Math.abs(pos[b.i] - pos[a.i]) * 1000) / gapMs;
    if (speed > seam.speed) seam = { speed, spike: maxSpeed > 0 && speed > maxSpeed, gapMs, fromPos: pos[a.i], toPos: pos[b.i] };
  }
  if (seam.speed < 0) seam = { ...NO_SEAM };
  if (seam.spike) issues.push({ level: 'warn', msg: `loop seam moves at ${Math.round(seam.speed)} pos/s (cap ${maxSpeed})` });

  return { script, tiles, seam, issues };
}

/**
 * Re-extract the source cycle and replace loop.tiledTo with fresh tiles (call after editing the source).
 * loop = { t0, t1, periodMs?, tiledTo: { t0, t1 } | t1, starts? }; opts as for tile().
 * -> { script, report: { cycle, periodMs, tiledTo, tiles, seam, issues } }. On an error the script is returned unchanged.
 */
export function retile(script, loop, opts = {}) {
  const periodMs = loop.periodMs ?? loop.t1 - loop.t0;
  const tiledTo = typeof loop.tiledTo === 'number' ? { t0: loop.t0, t1: loop.tiledTo } : { t0: loop.t0, t1: loop.t1, ...loop.tiledTo };
  const cycle = extractCycle(script, loop.t0, periodMs);
  const res = tile(cycle, loop.t0, periodMs, tiledTo.t0, tiledTo.t1, loop.starts ? { ...opts, starts: loop.starts } : opts);
  const failed = res.issues.some((x) => x.level === 'error') || !res.tiles.length;
  return {
    script: failed ? script.slice() : replaceRange(script, tiledTo.t0, tiledTo.t1, res.script),
    report: { cycle, periodMs, tiledTo, tiles: res.tiles, seam: res.seam, issues: res.issues },
  };
}
