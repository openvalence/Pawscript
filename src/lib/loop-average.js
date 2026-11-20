// loop-average.js -- paw-ef73.5, pure: a loop's passes layered BY PICTURE and averaged, then that one pass repeated.
// The repeated frames (timeline/repeats.js) say exactly which frame of pass k shows the picture frame p of the first
// pass; those are the anchors of a piecewise-linear map pass time -> phase (ms into the reference pass); a frame with
// no repeated picture is placed by time between its anchors. The same map puts a loop's averaged pass onto reused
// footage elsewhere ('looped from shot 3.2': derivedChannel).
//   loopPasses(loop, fm)                 the loop's whole passes [{t0, t1}]
//   phaseMap(ix, ref, win, fm)           win's time -> phase in ref, by picture
//   averagePass(ch, passes, maps)        per-phase MEDIAN across passes (+ the spread across them)
//   loopStates(run, loops, ix, fm)       per loop over the run: {id, n, spread, on, why}
//   averagedRun(run, {loops, ix, fm})    the run with every channel (and samples) averaged over the loops that are on
//   derivedChannel(src, ix, loop, span)  a channel over span: the source loop's averaged pass mapped by picture
import { periodOf, repetitions } from '../features/timeline/loops.js';
import { BLEND_MS } from './signal-source.js';
import { lowerBound, frameLen } from './lane.js';
import { pictureAt } from '../features/timeline/repeats.js';
// fm everywhere here: the frame grid (lane.js: the player's clock, or a frame length; paw-kxz4)

/** Passes differ beyond this (median spread across passes / the averaged pass's range): not averaged by default. */
export const SPREAD_MAX = 0.15;
/** An automatic loop is averaged by default from this many passes. */
export const AVG_MIN_PASSES = 3;

const isAuto = (l) => !!l?.auto && l.t0 === l.auto.t0 && l.t1 === l.auto.t1 && !(l.tiledTo > l.t1);   // = repeat-offers isAutoLoop

/** A loop's whole passes [{t0, t1}]: an automatic one's n passes up to its end, a hand-made one's tiles. */
export function loopPasses(loop, fm = 1000 / 30) {
  const auto = isAuto(loop), end = auto ? loop.auto.end : Math.max(loop.t1, loop.tiledTo || 0);
  // paw-ef73.33: an automatic loop's last pass cut short (autoLoops' end: where its pictures stop) made (end - t0) / n a
  // period too short, every pass sliding off its pictures; one cycle then, the n-pass mean only when it agrees. Agrees = over
  // all n passes (an owner clip, shot 76: 8 frames x 16.6 was 7 ms a pass short, inside half a frame, 2.8 frames off by the
  // 17th pass); the cycle on the clock (periodOf: 333.33 ms, not the integer 333 of t1 - t0)
  const P1 = periodOf(loop, fm), Pn = auto ? (end - loop.t0) / loop.auto.n : 0;
  const P = auto ? (Math.abs(Pn - P1) * loop.auto.n <= (frameLen(fm) || 1000 / 30) / 2 ? Pn : P1) : P1;
  return repetitions(loop, end + 1, 10000, P).filter((r) => !r.partial).map((r) => ({ t0: r.t0, t1: r.t1 }));
}

/** The occurrences starting in [w.t0, w.t1), in order: ix.occ is sorted by frame (repeats.js), so by t: a binary search (paw-o60v.6). */
function occIn(ix, w) {
  const o = ix?.occ || [];
  let lo = 0, hi = o.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (o[m].t < w.t0) lo = m + 1; else hi = m; }
  let e = lo;
  while (e < o.length && o[e].t < w.t1) e++;
  return o.slice(lo, e);
}

/** Window w's time (absolute ms) -> phase (ms into ref, unwrapped: may run past ref's length on reused footage that
 *  starts mid-loop). Anchors = w's frames whose picture shows in ref (a held picture anchors its start and its end, the
 *  hold no longer than ref's own: a longer hold stalls the phase); between anchors linear, outside them slope 1. */
export function phaseMap(ix, ref, w, fm = 1000 / 30) {
  const R = ref.t1 - ref.t0, inRef = new Map(), seen = new Map();
  for (const o of occIn(ix, ref)) { seen.set(o.id, (seen.get(o.id) || 0) + 1); if (!inRef.has(o.id)) inRef.set(o.id, o); }
  // paw-ef73.33: a drawing shown twice in one cycle (the owner's 51-frame loop reuses 7 of its pictures) names two phases: its
  // second showing read as the first came round again and slid every later pass by a cycle. Only pictures shown once per
  // cycle anchor (the others are placed by time between them), unless that leaves fewer than two in w
  const once = [...seen.values()].some((n) => n > 1) && occIn(ix, w).filter((o) => seen.get(o.id) === 1).length >= 2;
  const u = [], p = [];
  let wrap = 0;
  const push = (x, y) => {
    if (u.length && y + wrap < p[p.length - 1] - R / 2) wrap += R;   // the picture came round again: the next pass
    y += wrap;
    if (!u.length || (x > u[u.length - 1] && y >= p[p.length - 1])) { u.push(x); p.push(y); }
  };
  for (const o of occIn(ix, w)) {
    const r = inRef.get(o.id);
    if (!r || (once && seen.get(o.id) > 1)) continue;
    const y = r.t - ref.t0;
    push(o.t, y);
    if (o.f1 > o.f0) push(o.t + (o.f1 - o.f0) * frameLen(fm), y + Math.min(o.f1 - o.f0, r.f1 - r.f0) * frameLen(fm));
  }
  return { u, p, R, at: (t) => {
    if (!u.length) return t - w.t0;
    if (t <= u[0]) return p[0] + (t - u[0]);
    if (t >= u[u.length - 1]) return p[p.length - 1] + (t - u[u.length - 1]);
    const j = lowerBound(u, t), a = j - 1;
    return p[a] + ((t - u[a]) / (u[j] - u[a])) * (p[j] - p[a]);
  }, inv: (y) => {   // phase -> time (the first time it is reached)
    if (!u.length) return w.t0 + y;
    if (y <= p[0]) return u[0] + (y - p[0]);
    if (y >= p[p.length - 1]) return u[u.length - 1] + (y - p[p.length - 1]);
    const j = lowerBound(p, y), a = Math.max(0, j - 1);
    return p[j] === p[a] ? u[a] : u[a] + ((y - p[a]) / (p[j] - p[a])) * (u[j] - u[a]);
  } };
}

/** Linear value of channel {t, v} at time x (NaN outside / in a gap). */
function valAt(ch, x) {
  const t = ch.t, n = t.length;
  if (!n || x < t[0] || x > t[n - 1]) return NaN;
  const j = lowerBound(t, x);
  if (t[j] === x) return ch.v[j];
  const a = ch.v[j - 1], b = ch.v[j];
  return a + ((x - t[j - 1]) / (t[j] - t[j - 1])) * (b - a);
}
const median = (xs) => { const s = xs.filter((x) => x === x).sort((a, b) => a - b), n = s.length; return !n ? NaN : n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** The averaged pass of channel ch: phase grid = ch's samples inside passes[0] (ms from its start); v = the median
 *  across passes at each phase (the robust mean: one wild pass never moves it), spread = the trimmed mean |pass - median|;
 *  per = each pass's values on the grid (the raw passes, for drawing behind). */
export function averagePass(ch, passes, maps) {
  const ref = passes[0], a = lowerBound(ch.t, ref.t0), b = lowerBound(ch.t, ref.t1);
  const t = Float64Array.from(ch.t.subarray ? ch.t.subarray(a, b) : ch.t.slice(a, b), (x) => x - ref.t0);
  const per = passes.map((_, k) => Float64Array.from(t, (y) => valAt(ch, maps[k].inv(y))));
  const v = new Float64Array(t.length), spread = new Float64Array(t.length);
  for (let j = 0; j < t.length; j++) {
    const xs = per.map((q) => q[j]), m = median(xs);
    // spread: the mean |pass - median| with the single largest dropped (one wild pass is the median's job, not the gate's;
    // two that disagree are not)
    const d = xs.filter((x) => x === x).map((x) => Math.abs(x - m)).sort((a, b) => a - b);
    if (d.length > 2) d.pop();
    v[j] = m; spread[j] = d.length ? d.reduce((a, b) => a + b, 0) / d.length : NaN;
  }
  return { t, v, spread, per, R: ref.t1 - ref.t0 };
}

/** The averaged pass's value at phase y (cyclic over its length R). (link-fill.js reads cycles with it too.) */
export function cyc(avg, y) {
  const { t, v, R } = avg, n = t.length;
  if (!n) return NaN;
  y = ((y % R) + R) % R;
  const j = lowerBound(t, y);
  const ia = j === 0 ? n - 1 : j - 1, ib = j === n ? 0 : j;
  const ta = j === 0 ? t[n - 1] - R : t[ia], tb = j === n ? t[0] + R : t[ib], va = v[ia], vb = v[ib];
  if (va !== va) return vb;
  if (vb !== vb || tb === ta) return va;
  return va + ((y - ta) / (tb - ta)) * (vb - va);
}

/** Spread of an averaged pass as one number: the median per-phase spread over the averaged pass's range. */
export function spreadOf(avg) {
  let lo = Infinity, hi = -Infinity;
  for (const x of avg.v) if (x === x) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  return hi > lo ? median(Array.from(avg.spread)) / (hi - lo) : 0;
}

const smooth = (x) => x * x * (3 - 2 * x);
/** Channel ch with the loop's averaged pass written over every pass, cross-faded into the raw signal over blendMs just
 *  outside the loop at both ends (the average carried on cyclically there). -> a new Float32Array of values. */
export function repeatAveraged(ch, passes, maps, avg, blendMs = BLEND_MS, tail = null) {
  const v = Float32Array.from(ch.v), first = passes[0].t0, whole = passes[passes.length - 1].t1, last = tail ? tail.t1 : whole;   // tail {t1, map}: the matching frames after the last whole pass (loopPlan)
  for (let j = lowerBound(ch.t, first - blendMs); j < ch.t.length && ch.t[j] < last + blendMs; j++) {
    const x = ch.t[j];
    let y, w = 1;
    if (x < first) { y = cyc(avg, maps[0].at(x)); w = smooth(1 - (first - x) / blendMs); }
    else if (x >= last) { y = cyc(avg, (tail ? tail.map : maps[passes.length - 1]).at(x)); w = smooth(1 - (x - last) / blendMs); }
    else if (x >= whole) y = cyc(avg, tail.map.at(x));
    else { const k = Math.max(0, passes.findIndex((p) => x >= p.t0 && x < p.t1)); y = cyc(avg, maps[k].at(x)); }
    if (y !== y) continue;
    v[j] = v[j] === v[j] ? v[j] + w * (y - v[j]) : w >= 0.5 ? y : v[j];
  }
  return v;
}

/** The loop's passes inside the run's range and their maps, or null (fewer than 2). */
export function loopPlan(run, loop, ix, fm) {
  const r = run?.range, passes = loopPasses(loop, fm).filter((p) => !r || (p.t0 >= r.start && p.t1 <= r.end));
  if (passes.length < 2) return null;
  // paw-imsi: the frames after the last whole pass that still show the cycle's picture at their phase (a shot that ends a few
  // frames into a pass: that clip's shot 76 (16.6), shot 47's cut-short 5th): averaged too, so the last stroke is the cycle's
  const last = passes[passes.length - 1], ref = passes[0], F = frameLen(fm) || 1000 / 30, stop = r ? r.end : Infinity, pic = ix ? pictureAt(ix, fm) : null;
  let tail = last.t1;
  for (let m = 0; pic && (m + 1) * F <= ref.t1 - ref.t0 + 0.5; m++) {
    const x = last.t1 + m * F + 1, id = pic(x);   // (pictureAt reads the frame starting within half a frame of x)
    if (x >= stop || !(id >= 0) || id !== pic(ref.t0 + m * F + 1)) break;
    tail = Math.min(stop, last.t1 + (m + 1) * F);
  }
  return { passes, maps: passes.map((p) => phaseMap(ix, passes[0], p, fm)), tail: tail > last.t1 ? { t1: tail, map: phaseMap(ix, ref, { t0: last.t1, t1: tail }, fm) } : null };
}
/** The channel the gate measures the spread on: the run's pick, else the sidecar's signal, else fused, else any. */
const gateOf = (run) => (run.channel !== 'primary' && run.channels?.[run.channel]) || (run.samples?.t?.length ? run.samples : null) || run.channels?.fused || Object.values(run.channels || {}).find((c) => c?.t?.length);

const memo = new WeakMap();
/** Per loop over run: {id, n (passes), spread, on, why}. On: the owner's toggle (loop.avg) when set, else an automatic
 *  loop with >= AVG_MIN_PASSES passes and spread <= SPREAD_MAX. */
export function loopStates(run, loops = [], ix = null, fm = 1000 / 30) {
  const m = memo.get(run);
  if (m && m.loops === loops && m.ix === ix && m.fm === fm) return m.out;
  const out = [];
  const g = run && gateOf(run);
  for (const l of loops || []) {
    const plan = g ? loopPlan(run, l, ix, fm) : null;
    if (!plan) continue;
    const spread = spreadOf(averagePass(g, plan.passes, plan.maps)), n = plan.passes.length;
    const dflt = isAuto(l) && n >= AVG_MIN_PASSES && spread <= SPREAD_MAX;
    const on = typeof l.avg === 'boolean' ? l.avg : dflt;
    const why = on ? `${n} passes averaged (spread ${Math.round(spread * 100)}%)` : spread > SPREAD_MAX ? `passes differ: not averaged (spread ${Math.round(spread * 100)}%)` : `${n} passes, not averaged`;
    out.push({ id: l.id, n, spread, on, why, plan });
  }
  if (run) memo.set(run, { loops, ix, fm, out });
  return out;
}

/** paw-zhn4: per run scene of run (index = max(0, sceneAt)), the period (ms: the passes' span over their count, the cycle the
 *  passes are laid on: loopPasses) of the exact loop covering
 *  at least half of it (a loop averaged, or whose passes agree within SPREAD_MAX); 0 = none. null when no scene has one. */
export function loopPeriods(run, { loops, ix, fm } = {}) {
  const st = loopStates(run, loops, ix, fm).filter((s) => s.on || s.spread <= SPREAD_MAX);
  if (!st.length || !run?.range) return null;
  const sc = run.scenes?.length ? run.scenes : [{ start_ms: run.range.start }];
  const out = sc.map((s, i) => {
    const a = Math.max(i ? s.start_ms : -Infinity, run.range.start), b = Math.min(i + 1 < sc.length ? sc[i + 1].start_ms : Infinity, run.range.end);
    let best = 0, L = 0;
    for (const { plan: { passes } } of st) {
      const o = Math.min(b, passes[passes.length - 1].t1) - Math.max(a, passes[0].t0);
      if (o >= 0.5 * (b - a) && o > best) { best = o; L = (passes[passes.length - 1].t1 - passes[0].t0) / passes.length; }
    }
    return L;
  });
  return out.some((x) => x > 0) ? out : null;
}

/** run with every channel (and its samples) averaged over each loop that is on; the same run when none is. The raw
 *  channels stay on the stored run (channelPatch composes from this copy only). */
export function averagedRun(run, { loops, ix, fm } = {}) {
  const on = loopStates(run, loops, ix, fm).filter((s) => s.on);
  if (!on.length) return run;
  const channels = Object.fromEntries(Object.entries(run.channels || {}).map(([k, c]) => [k, avgOver(c, on)]));
  return { ...run, channels, ...(run.samples?.t?.length ? { samples: avgOver(run.samples, on) } : {}) };
}
/** Channel ch (keys: its value arrays on ch.t) averaged over the loop passes that are on (`on`: loopStates entries). */
function avgOver(ch, on, keys = ['v']) {
  if (!ch?.t?.length) return ch;
  const out = { ...ch };
  for (const k of keys) {
    if (!ch[k]) continue;
    let v = ch[k];
    for (const s of on) v = repeatAveraged({ t: ch.t, v }, s.plan.passes, s.plan.maps, averagePass({ t: ch.t, v }, s.plan.passes, s.plan.maps), BLEND_MS, s.plan.tail);
    out[k] = v;
  }
  if (ch.scaled) { const span = ch.max - ch.min || 1; out.scaled = Float32Array.from(out.v, (y) => (y - ch.min) / span); }
  return out;
}
/** A channel built from an averaged run (fusion's: it weighs its rows per window, and windows that do not line up with the
 *  loop make each pass come out different) averaged over the same passes as averagedRun (run: the run before averaging, its
 *  loop decision memoised) -> ch, or the same ch when no loop is on. */
export function averagedChannel(run, ch, { loops, ix, fm } = {}, keys = ['v']) {
  const on = loopStates(run, loops, ix, fm).filter((s) => s.on);
  return on.length ? avgOver(ch, on, keys) : ch;
}

/** A channel over span {t0, t1} (reused footage of the source loop): at each of the source channel's frame times
 *  (spaced as in the source) the source loop's averaged pass at the phase the picture says. -> {t, v} | null. */
export function derivedChannel(src, ix, loop, span, fm = 1000 / 30) {
  const plan = loopPlan(src, loop, ix, fm);
  if (!plan || !src?.t?.length) return null;
  const avg = averagePass(src, plan.passes, plan.maps), map = phaseMap(ix, plan.passes[0], span, fm);
  const dt = src.t.length > 1 ? (src.t[src.t.length - 1] - src.t[0]) / (src.t.length - 1) : frameLen(fm);
  const n = Math.max(1, Math.floor((span.t1 - span.t0) / dt));
  const t = Float64Array.from({ length: n }, (_, j) => span.t0 + j * dt);
  return { t, v: Float32Array.from(t, (x) => cyc(avg, map.at(x))) };
}
