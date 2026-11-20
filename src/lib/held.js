// held.js -- characters drawn on twos / threes over a picture that changes every frame (paw-rnv1). Pure, CPU only, from
// what a points run stored; never written back (channelPatch / six-axis apply it at compose time, the .pawruns keeps the
// tracks as tracked). Tested by test/held.test.mjs; measured in trackers/experiments/held2 (RESULTS.md).
//
// The sidecar's held detection (loops.held_frames, held_input) reads the WHOLE picture: a background that pans, grain or an
// effect layer changes every frame, so it calls every frame new and nothing is retimed. The painted parts then move as a
// staircase (a drawing held 2, 3, 2 ... frames, then a jump), which turn timing, smoothing and the rhythm read as stop-go.
// Here the held frames come from the parts' own stored centres, per character (a character's drawing changes as a whole):
//  1. per part, its frame-to-frame motion minus the layer's: the layer motion (a camera path left in the centres, a layer
//     sliding with a pan) is the median of the slower half of the motions within +-LAYER frames, so a smooth motion,
//     sampled every frame, is all layer and leaves nothing; on a staircase the held frames are the slower half
//  2. per character, the mean over its visible parts -> e; floor = its 25th percentile (on a staircase the held frames,
//     at least a third of all, are tracker noise), never below FLOOR frame heights; a frame is a hit over K x floor
//  3. only where the staircase pattern holds over a WIN-frame window does a stretch count as drawn on twos / threes: at
//     least MIN_HITS hits, ISO of them in runs of at most TRANS (a change shows on one frame, or two when a frame-rate
//     conversion blended it; never three in a row), a SHARE of the frames moving, the hits CONTRAST times above the quiet
//     frames, REG of the gaps between changes 2..MAX_GAP + 1 frames. Slow continuous motion (every frame moves: long runs),
//     a pause or a hold at depth (no hits), noise (hits barely above it, gaps at random) fail it and are left as tracked
//  4. a stretch grows over the character's slower frames (a slow sway on twos: steps too small for the test, its staircase
//     still reads as a rhythm) while changes (over LOW x the floor: the drawing at a turn moves little) keep coming at most
//     MAX_GAP frames apart; a run of more than TRANS hits (ones) or a longer quiet gap (a pause, a slow motion on ones)
//     stops it. Inside, a sample = a frame over LOW x the floor; a gap longer than MAX_GAP is a hold (flat until a step
//     before the next drawing). retime: one sample per drawing, where it first appears, linear in between (loops.retime)
// The channels of a character's parts (sem_<who>_<part>_*), its centre (who_<who>_*), the pairs (who_pair / p1h2 / p2h1,
// rel:a:b: the union of both sides' drawings) are retimed; everything else (the box / motion groups, the sidecar's own
// signal and points) is left as tracked.

import { sceneAt } from './runs.js';
import { splitName } from '../features/tracking/groups.js';

const fin = Number.isFinite;
export const HELD = {
  LAYER: 4,          // frames each side for the layer motion
  K: 4,              // a hit: e over K x its floor (the floor = its 25th percentile: K x it ~ the noise's 99th percentile)
  FLOOR: 2e-4,       // frame heights: the floor never goes below (0.2 px at 1080)
  WIN: 30,           // frames per pattern window (1 s at 30 fps)
  MIN_HITS: 4,
  TRANS: 2,          // a run of this many hits or fewer is one change (two: a blended frame-rate conversion)
  ISO: 0.8,          // share of the hits in such short runs
  SHARE: [0.15, 0.7],
  CONTRAST: 6,       // median e of the hits over the quiet frames'
  REG: 0.6,          // share of the gaps between changes that are 2..MAX_GAP + 1 frames
  LOW: 3,          // x floor: a drawing inside a stretch
  MAX_GAP: 4,        // frames: a longer gap between drawings is a hold (flat until a step before the next drawing)
  DEFAULT: true,     // a shot without derive.held: on (paw-rnv1 RESULTS.md: strictly better on the synthetic cases, nothing on ones)
};

// (a typed sort, paw-o60v.5: the same values in order; only -0 / 0 may swap, which no use here can see)
const quantile = (a, q) => { const b = Float64Array.from(a.filter(fin)).sort(); if (!b.length) return NaN; const p = (b.length - 1) * q, i = Math.floor(p); return b[i] + (b[Math.min(i + 1, b.length - 1)] - b[i]) * (p - i); };
const median = (a) => quantile(a, 0.5);

/** One part's motion beyond the layer: X, Y (aspect-scaled, NaN = lost) -> Float64Array e per frame (NaN at 0 and where lost).
 *  (paw-o60v.5: the window's stable sort and medians done in place on at most 2 LAYER + 1 entries, no arrays a frame: the
 *  same order, the same medians, the same numbers as Array sort + quantile; test/held.test.mjs) */
export function partMotion(X, Y) {
  const n = X.length, ux = new Float64Array(n).fill(NaN), uy = new Float64Array(n).fill(NaN), out = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n; i++) if (fin(X[i]) && fin(X[i - 1]) && fin(Y[i]) && fin(Y[i - 1])) { ux[i] = X[i] - X[i - 1]; uy[i] = Y[i] - Y[i - 1]; }
  const L = HELD.LAYER, h = new Float64Array(n), w = new Int32Array(2 * L + 1), a = new Float64Array(L + 1);
  for (let i = 1; i < n; i++) if (fin(ux[i])) h[i] = Math.hypot(ux[i], uy[i]);
  // the median of the first m entries of w by `of` (quantile 0.5 of a stable numeric sort)
  const med = (of, m) => {
    for (let k = 0; k < m; k++) { const v = of[w[k]]; let b = k - 1; while (b >= 0 && a[b] - v > 0) { a[b + 1] = a[b]; b--; } a[b + 1] = v; }
    const p = (m - 1) * 0.5, q = Math.floor(p);
    return a[q] + (a[Math.min(q + 1, m - 1)] - a[q]) * (p - q);
  };
  for (let i = 1; i < n; i++) {
    if (!fin(ux[i])) continue;
    let c = 0;
    for (let j = Math.max(1, i - L); j <= Math.min(n - 1, i + L); j++) if (fin(ux[j])) {
      let b = c - 1;   // (insertion by |u|, after its equals: Array sort is stable)
      while (b >= 0 && h[w[b]] - h[j] > 0) { w[b + 1] = w[b]; b--; }
      w[b + 1] = j; c++;
    }
    const m = Math.ceil(c / 2);
    out[i] = Math.hypot(ux[i] - med(ux, m), uy[i] - med(uy, m));
  }
  return out;
}

/**
 * One character over one scene: parts [{X, Y}] (Float64Array, aspect-scaled frame units, NaN = lost), all of the scene's
 * frames -> {nw: Uint8Array (1 = a sample: a new drawing, or a frame outside every stretch), stretch: Uint8Array,
 * drawings, frames (in stretches), steps {2: n, 3: n, ...} (frames per drawing inside stretches), floor, e}.
 */
export function detectHeld(parts) {
  const n = parts[0]?.X.length || 0, H = HELD;
  const nw = new Uint8Array(n).fill(1), stretch = new Uint8Array(n), none = { nw, stretch, drawings: 0, frames: 0, steps: {}, floor: NaN, e: null };
  if (n < H.WIN) return none;
  // each part weighs by how much it moves (its 90th percentile): a part that barely moves (a torso while the hips stroke)
  // does not water the character's changes down to its own noise
  const es = parts.map((p) => partMotion(p.X, p.Y)), ws = es.map((q) => quantile(Array.from(q), 0.9) || 0), e = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { let s = 0, c = 0; es.forEach((q, p) => { if (fin(q[i]) && ws[p] > 0) { s += ws[p] * q[i]; c += ws[p]; } }); if (c) e[i] = s / c; }
  const floor = Math.max(H.FLOOR, quantile(Array.from(e), 0.25) || 0), thr = H.K * floor;
  const hit = Uint8Array.from(e, (x) => (fin(x) && x > thr ? 1 : 0));
  // a new drawing shows as one moving frame, or two when the frame-rate conversion blended the change (24 -> 30 fps: the
  // owner's held_input runs show ". x . . x x . . x x"): a run of TRANS hits or fewer is one change; a longer run is
  // drawn on ones
  const run = new Uint8Array(n);
  for (let i = 0; i < n;) { if (!hit[i]) { i++; continue; } let j = i; while (j < n && hit[j]) j++; run.fill(Math.min(255, j - i), i, j); i = j; }
  const half = H.WIN >> 1;
  for (let c = half; c + half <= n; c += 2) {
    const a = c - half, b = c + half;
    let nv = 0, nh = 0, short = 0;
    const he = [], qe = [], starts = [];
    for (let i = a; i < b; i++) {
      if (!fin(e[i])) continue;
      nv++;
      if (hit[i]) { nh++; he.push(e[i]); if (run[i] <= H.TRANS) short++; if (!hit[i - 1]) starts.push(i); } else qe.push(e[i]);
    }
    if (nh < H.MIN_HITS || short < H.ISO * nh || nh < H.SHARE[0] * nv || nh > H.SHARE[1] * nv) continue;
    if (median(he) < H.CONTRAST * Math.max(floor, median(qe) || 0)) continue;
    let reg = 0;
    for (let k = 1; k < starts.length; k++) if (starts[k] - starts[k - 1] >= 2 && starts[k] - starts[k - 1] <= H.MAX_GAP + 1) reg++;
    if (starts.length < 3 || reg < H.REG * (starts.length - 1)) continue;
    stretch.fill(1, a, b);
  }
  if (!stretch.some(Boolean)) return { ...none, floor, e };
  // a stretch grows over the character's slower stretches (a slow sway drawn on twos makes steps too small for the
  // pattern test, and its staircase still reads as a rhythm) while drawings (over LOW x the floor: the drawing at a turn
  // moves little; noise passes it ~1 % of the time) keep coming at most MAX_GAP frames apart, and stops before two frames in
  // a row move over K (drawn on ones there) or a longer quiet gap (a pause, or a slow motion on ones: left as tracked)
  const low = Uint8Array.from(e, (x) => (fin(x) && x > H.LOW * floor ? 1 : 0));
  for (const dir of [1, -1]) {
    for (let i = dir > 0 ? 1 : n - 2; i >= 0 && i < n; i += dir) {
      if (!stretch[i - dir] || stretch[i]) continue;
      let j = i;
      while (j >= 0 && j < n && !low[j] && Math.abs(j - i) < H.MAX_GAP) j += dir;   // the next drawing within MAX_GAP
      if (j < 0 || j >= n || !low[j] || run[j] > H.TRANS) continue;
      for (let q = i; q !== j + dir; q += dir) stretch[q] = 1;
      i = j;
    }
  }
  let frames = 0;
  for (let i = 0; i < n; i++) if (stretch[i]) { frames++; if (!low[i]) nw[i] = 0; }
  nw[0] = 1;
  // drawings = changes inside the stretches (a blended pair of samples is one), steps = frames from one change to the next
  const steps = {}, st = [];
  for (let i = 0; i < n; i++) if (stretch[i] && nw[i] && !(i && nw[i - 1] && stretch[i - 1])) st.push(i);
  for (let k = 1; k < st.length; k++) if (st[k] - st[k - 1] <= 2 * H.WIN) { let gap = false; for (let i = st[k - 1]; i < st[k] && !gap; i++) gap = !stretch[i]; if (!gap) steps[st[k] - st[k - 1]] = (steps[st[k] - st[k - 1]] || 0) + 1; }
  const drawings = st.length;
  return { nw, stretch, drawings, frames, steps, floor, e };
}

/** loops.retime per scene: v at the samples (nw, finite), linear in between; a hold longer than MAX_GAP stays flat until
 *  `step` frames before the next drawing; NaN stays NaN. Returns v itself when nothing changes. */
export function retimeHeld(t, v, nw, step = 2) {
  const n = v.length, keep = [];
  for (let i = 0; i < n; i++) if (nw[i] && fin(v[i])) keep.push(i);
  if (keep.length < 2 || keep.length === n) return v;
  const k2 = [];
  for (let q = 0; q < keep.length; q++) {
    const a = keep[q], b = keep[q + 1];
    k2.push(a);
    if (b != null && b - a > HELD.MAX_GAP && fin(v[b - step])) k2.push(b - step);
  }
  const out = Float64Array.from(v);
  for (let i = 0, q = 0; i < n; i++) {
    if (!fin(v[i])) { out[i] = NaN; continue; }
    while (q + 1 < k2.length && k2[q + 1] <= i) q++;
    const a = k2[q], b = k2[q + 1];
    if (i <= k2[0]) out[i] = v[i < k2[0] ? k2[0] : i];
    else if (b == null) out[i] = v[a];
    else out[i] = v[a] + ((v[b] - v[a]) * (t[i] - t[a])) / (t[b] - t[a] || 1);
  }
  return out;
}

const WHO = /^who_(c1|c2|x)_/, PAIR = /^who_(pair|p1h2|p2h1)_/, REL = /^rel:([^:]+):([^:]+)$/;
/** The derive's switch for a run scene: derive.held (boolean) else the default. */
export const heldOn = (d) => (typeof d?.held === 'boolean' ? d.held : HELD.DEFAULT);

// cached per the first painted group's stored x channel (the stored tracks of one run: the same object on every compose)
// and what else the detection reads; entry.memo keeps each retimed channel, so a compose hands fusion / six-axis the same
// objects again and their own caches (keyed on channel objects) still hit
const cache = new WeakMap();
const groupsOf = (ch) => Object.keys(ch).filter((k) => /^sem_[a-z0-9_]+_x$/.test(k) && ch[k.slice(0, -2) + '_y']).map((k) => { const name = k.slice(4, -2); return { key: k.slice(0, -2), name, who: splitName(name).who || 'sem_' + name }; });
function entryOf(run, aspect) {
  const ch = run?.channels;
  if (!ch) return null;
  const groups = groupsOf(ch), ref = groups.length ? ch[groups[0].key + '_x'] : null;
  if (!ref?.t?.length) return null;
  const key = JSON.stringify([groups.map((g) => g.name), aspect, (run.scenes || []).map((s) => s.start_ms)]);
  let m = cache.get(ref);
  if (!m) cache.set(ref, (m = new Map()));
  if (m.has(key)) return m.get(key);
  const t = ref.t, scenes = run.scenes || [], per = new Map(), out = [];
  for (let j = 0; j < t.length; j++) { const k = scenes.length ? sceneAt(scenes, t[j]) : 0; if (!per.has(k)) per.set(k, []); per.get(k).push(j); }
  const at = (c, j) => { const v = c && c.t.length === t.length ? c.v[j] : NaN; return v == null ? NaN : v; };
  for (const [k, idx] of per) {
    const chars = {}, nw = {};
    for (const who of new Set(groups.map((g) => g.who))) {
      const ps = groups.filter((g) => g.who === who).map((g) => ({ X: Float64Array.from(idx, (j) => at(ch[g.key + '_x'], j) * aspect), Y: Float64Array.from(idx, (j) => at(ch[g.key + '_y'], j)) }));
      const r = detectHeld(ps);
      if (r.frames) { const { e: _, nw: f, stretch, ...rest } = r; chars[who] = { ...rest, stretch }; nw[who] = f; }
    }
    out.push({ k, chars, nw, idx, t: idx.map((j) => t[j]) });
  }
  const e = { scenes: out, groups, memo: new Map() };
  m.set(key, e);
  return e;
}
/**
 * Detection over every run scene of `run` (cached): [{k (run scene index; 0 for a run without scenes), chars: {who:
 * {drawings, frames, steps, floor, stretch}}, nw: {who: Uint8Array over the scene (1 = a sample)}, idx (channel indices),
 * t}]. who = 'c1' | 'c2' | 'x', or 'sem_<name>' for a painted group without a character (on its own).
 */
export const heldScenes = (run, aspect = 16 / 9) => entryOf(run, aspect)?.scenes || [];

/** Plain words for a scene's detection (chars of heldScenes), '' when nothing: 'Bottom on twos / threes: 41 drawings in
 *  98 frames (2×19, 3×20)'. */
export function heldText(chars, whoName = (w) => w) {
  return Object.entries(chars || {}).map(([w, r]) => {
    // named: the steps of 2 / 3 frames with at least a tenth of the changes (a longer gap is a hold or a drawing lost in the noise)
    const st = Object.entries(r.steps).sort((a, b) => b[1] - a[1]), tot = st.reduce((s, [, c]) => s + c, 0), names = { 2: 'twos', 3: 'threes' };
    const top = st.filter(([s, c]) => names[s] && c >= 0.1 * tot).map(([s]) => +s).sort().map((s) => names[s]).join(' / ') || 'held drawings';
    return `${whoName(w)} on ${top}: ${r.drawings} drawings in ${r.frames} frames (${st.map(([s, c]) => `${s}×${c}`).join(', ')})`;
  }).join(' · ');
}

const sceneDerive = (run, derives, k) => derives[k] ?? (!run.scenes?.length ? derives[-1] ?? derives[0] : null) ?? null;
/**
 * run with the held stretches retimed in every run scene whose derive has the switch on (derives as runDerives; heldOn).
 * -> {run (a new object; the retimed channels replaced), scenes: [{k, chars}] (the scenes retimed)} | null (nothing to
 * retime). The run passed in, and its channels, are never changed.
 */
export function heldRun(run, derives = [], aspect = 16 / 9) {
  const E = entryOf(run, aspect), det = (E?.scenes || []).filter((s) => Object.keys(s.chars).length && heldOn(sceneDerive(run, derives, s.k)));
  if (!det.length) return null;
  const ch = run.channels, next = { ...ch }, on = det.map((s) => s.k).join(',');
  const byKey = new Map(E.groups.map((g) => [g.key, g.who]));
  const sideWho = (key) => byKey.get(key) || (WHO.exec(key + '_') || [])[1] || null;
  const whosOf = (name) => {
    if (name.startsWith('sem_')) { let best = null; for (const key of byKey.keys()) if (name.startsWith(key + '_') && (!best || key.length > best.length)) best = key; return best ? [byKey.get(best)] : []; }
    const w = WHO.exec(name);
    if (w) return [w[1]];
    if (PAIR.test(name)) return ['c1', 'c2'];
    const r = REL.exec(name);
    return r ? [sideWho(r[1]), sideWho(r[2])].filter(Boolean) : [];
  };
  const memo = (name, c, make) => { const k = name + '|' + on, h = E.memo.get(k); if (h && h.src === c) return h.out; const out = make(); E.memo.set(k, { src: c, out }); return out; };
  let changed = 0;
  for (const name of Object.keys(ch)) {
    const whos = whosOf(name), c = ch[name];
    if (!whos.length || !c?.t || !c.v) continue;
    const out = memo(name, c, () => {
      let v = null;
      for (const s of det) {
        // a pair changes whenever either side does: a sample where any side has a new drawing; a side not drawn on twos /
        // threes here changes every frame, so the pair is left as tracked there
        const fl = whos.map((w) => s.nw[w]);
        if (fl.some((f) => !f) || c.t.length <= s.idx[s.idx.length - 1] || c.t[s.idx[0]] !== s.t[0]) continue;
        const nw = Uint8Array.from(s.idx, (_, q) => (fl.some((f) => f[q]) ? 1 : 0));
        const step = Math.round(median(whos.flatMap((w) => Object.entries(s.chars[w]?.steps || {}).flatMap(([k, m]) => Array(m).fill(+k)))) || 2);
        const sv = Float64Array.from(s.idx, (j) => (c.v[j] == null ? NaN : c.v[j]));
        const r = retimeHeld(s.t, sv, nw, Math.min(step, HELD.MAX_GAP));
        if (r === sv) continue;
        if (!v) v = Float32Array.from(c.v, (y) => (y == null ? NaN : y));
        s.idx.forEach((j, q) => { v[j] = r[q]; });
      }
      if (!v) return null;
      let min = Infinity, max = -Infinity;
      for (const y of v) if (y === y) { if (y < min) min = y; if (y > max) max = y; }
      if (min > max) min = max = 0;
      return { ...c, v, min, max, scaled: Float32Array.from(v, (y) => (y - min) / (max - min || 1)) };
    });
    if (out) { next[name] = out; changed++; }
  }
  if (!changed) return null;
  // every painted group's x channel is a new object while retimed (a copy where unchanged): fusion's analysis is cached on
  // the first group's (which may be an empty one, never retimed)
  for (const g of E.groups) { const k = g.key + '_x'; if (next[k] === ch[k]) next[k] = memo(k + '#', ch[k], () => ({ ...ch[k] })); }
  return { run: { ...run, channels: next }, scenes: det.map((s) => ({ k: s.k, chars: s.chars })) };
}
