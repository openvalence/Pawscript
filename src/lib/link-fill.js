// link-fill.js -- paw-ef73.33, pure: linked shots fill each other. A shot T that holds the same loop footage as a shot S
// with a tracked run gets a DERIVED run ("looped from shot 42"): no tracking, no sidecar. Its signals are S's over one cycle,
// laid over T's own frames by PHASE (the same picture gets the same value), on T's real frame times (the player clock).
//   fillTargets(o)      per shot that can be filled: {i (target shot), j (source shot), src (run), plan} (see below)
//   deriveFill(S, plan, o)   the derived run's data: channels, samples, the sidecar's points, direction, level, info
//   levelRef / carryLevel    S's depth level and range carried onto T's composed points
// Phase, per mapping kind:
//   exact  the repeated frames (timeline/repeats.js): T's frames whose picture shows in S's reference pass are the anchors
//          (loop-average.js phaseMap, by picture); a held picture stalls the phase, a cut-short last pass just ends.
//   crop   a crop link's loop pair (crop-match.js loopLinks: B's frame k shows A's frame (k + shift) mod pA): frame counts.
//          A 2:1 period ratio: T's cycle twice S's -> T takes S's cycle twice; T's half of S's -> T's frame takes the MEAN of
//          S's frames that show it (S's two halves, redrawn slightly differently on the owner's shots 14 / 15:
//          experiments/cropscene/RESULTS.md, luma 0.4-1.3 / 255 in 4 of 9 pictures): one motion per T pass, as its pictures say.
// The cycle: S's own loop decision (loop-average.js loopStates): its passes averaged when S's loop is averaged (the median
// per phase, exactly what S shows), else S's cleanest pass (the one nearest that median). T itself is never averaged again.
// Direction: S's direction map (polarity.js: flips, stretches) laid on T's time as stretches (dirMap), xor'd with T's own.
import { linkedShots } from '../features/timeline/loop-marks.js';
import { shotPictures } from '../features/timeline/repeat-scenes.js';
import { loopGroup } from '../features/timeline/loop-info.js';
import { loopPasses, phaseMap, averagePass, loopStates, cyc, spreadOf, SPREAD_MAX } from './loop-average.js';
import { frameAt, frameTime, frameLen, lowerBound } from './lane.js';
import { directionOf, flipsClean, flippedAt } from './polarity.js';
import { sceneAt } from './runs.js';
import { deriveOf } from './rederive.js';
import { detailClean, detailAt } from './detail.js';
import { sceneRange, cutsOf } from '../features/timeline/shots.js';

/** A run covers a shot when it overlaps this share of it. */
export const OWN = 0.5;
/** Fewer anchors (pictures of S's pass seen in T) than this: no exact correspondence. */
export const MIN_ANCHORS = 3;
/** Less of the loop than this (passes) in the target: a fragment (an owner clip: 0.6 pass, 1 point): offered. */
export const MIN_PASS = 1;
export const fillId = (shot) => `fill-${Math.round(shot.start_ms)}`;
/** The shot's flag: undefined = automatic, 'off' = dismissed (never refilled until asked), 'on' = asked (fills past the
 *  guard), 'detached' = its derived run is an independent copy (stored like a tracked run, never follows). */
export const FLAGS = ['off', 'on', 'detached'];

const md = (x, m) => ((x % m) + m) % m;
const over = (r, s) => Math.max(0, Math.min(r.range.end, s.end_ms) - Math.max(r.range.start, s.start_ms));
const covers = (r, s) => !!r?.range && over(r, s) >= OWN * (s.end_ms - s.start_ms);
/** A run that can feed others: tracked by the owner (not the reference, a modifier's, a camera / tagged helper, a derived). */
const feeds = (r) => !!r && !r.ref && !r.mod && !r.tag && !r.derived && !!(Object.keys(r.channels || {}).length || r.points0Primary?.at?.length || r.points?.at?.length);
const shotSpan = (s) => ({ t0: s.start_ms, t1: s.end_ms });
/** paw-2lp7.4: an off-screen or cutaway shot is never a fill source or target (it is bridged, or an intermission): un-mark it first. */
const unseen = (s) => !!s?.tags?.includes('offscreen') || !!s?.tags?.includes('cutaway');

/** The run shot s's signal comes from: its linked run (linkRun id) when it feeds, else the newest feeding run covering it. */
export function sourceRun(runs, s, linkRun = '') {
  const c = (runs || []).filter((r) => feeds(r) && covers(r, s));
  return c.find((r) => r.id === linkRun) || c.sort((a, b) => (b.n || 0) - (a.n || 0))[0] || null;
}
/** Does shot i have a run of its own (tracked, or its derived run detached), or a live link to another run? */
function hasOwn(runs, shots, i, linkRun) {
  const s = shots[i], me = fillId(s);
  if (linkRun && linkRun !== me) return true;
  return (runs || []).some((r) => !r.ref && !r.mod && r.tag !== 'camera' && covers(r, s) && (!r.derived || (r.id === me && s.linkfill === 'detached')));
}

let lm = { ix: undefined };
/** S's passes of loop l inside its run and its shot. */
const passesIn = (l, run, s, fm) => loopPasses(l, fm).filter((p) => p.t0 >= Math.max(run.range.start, s.start_ms) - 1 && p.t1 <= Math.min(run.range.end, s.end_ms) + 1);

/**
 * Every shot that can be filled from a linked shot. o = {shots (doc.scenes as shots), ix (repeats index | null), loops
 * (doc.loops), grid (the clock), crops (tracking shotLinks.links), autos (repeat-scenes.js autoLoops: crop keys), runs,
 * linkOf(i) -> the run id shot i's live link names | ''}. -> [{i, j, src, plan: {kind: 'exact', loop, passes, fam} | {kind:
 * 'crop', loop, passes, tLoop: {t0, end, n}, pS, pT, shift, tIsB, ratio, scale}}], at most one per target; exact repeats
 * before crops; the source with the most passes. Shots flagged 'off' are left out.
 */
export function fillTargets({ shots = [], ix = null, loops = [], grid = 1000 / 30, crops = null, autos = [], runs = [], linkOf = () => '' } = {}) {
  const fm = frameLen(grid) || 1000 / 30, out = [];
  if (shots.length < 2) return out;
  const src = shots.map((s, j) => (unseen(s) ? null : sourceRun(runs, s, linkOf(j))));
  if (!src.some(Boolean)) return out;
  // the loops' footage groups and the linked shots: the same until the repeats, the shots, the loops or the clock change (a
  // sync runs on every run change, a drag's preview included)
  const cuts = cutsOf(shots);   // paw-o60v.6: the linked shots read the cuts alone: a stroke / tag / who edit keeps them
  if (lm.ix !== ix || lm.cuts !== cuts || lm.loops !== loops || lm.grid !== grid) {
    const groups = loops.map((l) => (ix ? loopGroup(ix, l, grid) : -1));
    lm = { ix, cuts, loops, grid, groups, L: ix ? linkedShots(ix, shotPictures(ix, shots, fm), groups) : new Map() };
  }
  const { groups, L } = lm;
  const loopIn = (j, ok) => loops.map((l, k) => ({ l, g: groups[k] })).filter(({ l, g }) => l.t0 >= shots[j].start_ms - fm && l.t0 < shots[j].end_ms && ok(l, g));
  const byKey = (k) => loops.find((l) => l.auto?.key === k) || (() => { const a = autos.find((x) => x.key === k); return a && { id: `auto:${a.key}`, t0: a.t0, t1: a.t1, auto: { key: a.key, t0: a.t0, t1: a.t1, end: a.end, n: a.n } }; })();
  const at = (sp) => shots.findIndex((q) => Math.abs(q.start_ms - sp?.start_ms) < 1);
  shots.forEach((T, i) => {
    if (T.linkfill === 'off' || unseen(T) || src[i] || hasOwn(runs, shots, i, linkOf(i))) return;
    let best = null;
    const take = (c) => { if (c.plan.passes.length && (!best || (c.plan.kind === 'exact') > (best.plan.kind === 'exact') || ((c.plan.kind === 'exact') === (best.plan.kind === 'exact') && c.plan.passes.length > best.plan.passes.length))) best = c; };
    const e = L.get(i);
    for (const j of e?.others || []) {
      const S = src[j];
      if (!S) continue;
      for (const f of e.fams.filter((x) => L.get(j)?.fams.includes(x))) {
        for (const { l } of loopIn(j, (_, g) => g === f)) take({ i, j, src: S, plan: { kind: 'exact', loop: l, passes: passesIn(l, S, shots[j], fm), fam: f } });
      }
    }
    for (const k of crops || []) {
      if (k.kind && k.kind !== 'crop') continue;
      const a = at(k.a), b = at(k.b), j = a === i ? b : b === i ? a : -1, tIsB = b === i;
      if (j < 0 || j === i || !src[j]) continue;
      for (const lp of k.loops || []) {
        if (lp.ratio == null) continue;
        const lT = byKey(tIsB ? lp.b : lp.a), lS = byKey(tIsB ? lp.a : lp.b);
        if (!lT || !lS) continue;
        const pS = tIsB ? lp.periodA : lp.periodB, pT = tIsB ? lp.periodB : lp.periodA;
        take({ i, j, src: src[j], plan: { kind: 'crop', loop: lS, passes: passesIn(lS, src[j], shots[j], fm), tLoop: { t0: lT.t0, end: lT.auto?.end ?? lT.t1, n: lT.auto?.n ?? 1 }, pS, pT, shift: lp.shift, tIsB, ratio: lp.ratio, scale: k.scale, score: lp.score, ...(lp.weak ? { weak: true } : {}) } });
      }
    }
    if (best) out.push(best);
  });
  return out;
}

/** The S frame indices (into S's cycle) that show T's frame c (frames from T's loop start), crop link. */
export function cropIdx(c, { pS, pT, shift, tIsB }) {
  if (tIsB) {   // S = A: B's frame k shows A's (k + shift) mod pA
    if (pT >= pS) return [md(c + shift, pS)];
    const j = md(c, pT), n = Math.round(pS / pT);
    return Array.from({ length: n }, (_, m) => md(j + shift + m * pT, pS));
  }
  if (pT >= pS) return [md(c - shift, pS)];   // S = B, T = A: A's frame i shows B's (i - shift) mod pB
  const i = md(c, pT), n = Math.round(pS / pT);
  return Array.from({ length: n }, (_, m) => md(i - shift, pT) + m * pT);
}

/** T's frame times [t0, t1) on the clock. */
function framesIn(t0, t1, grid) {
  const out = [];
  for (let f = frameAt(t0 + 0.5, grid); ; f++) { const t = frameTime(f, grid); if (t >= t1) break; if (t >= t0 - 0.5) out.push(t); if (out.length > 1e6) break; }
  return Float64Array.from(out);
}

/** The channel the cleanest pass is chosen on (loop-average.js gateOf's order). */
const gateOf = (run) => (run.channel !== 'primary' && run.channels?.[run.channel]) || (run.samples?.t?.length ? run.samples : null) || Object.values(run.channels || {}).find((c) => c?.t?.length);
const mean = (xs) => { let s = 0, n = 0; for (const x of xs) if (x === x) { s += x; n++; } return n ? s / n : NaN; };
/** Channel ch over one cycle of S: {t (phase grid), v, R}: the per-phase median of the passes (on), else pass k's values. */
function cycleOf(ch, passes, maps, on, k) {
  if (passes.length >= 2) { const a = averagePass(ch, passes, maps); return { t: a.t, v: on ? a.v : a.per[k], R: a.R }; }
  const p = passes[0], a = lowerBound(ch.t, p.t0), b = lowerBound(ch.t, p.t1);
  return { t: Float64Array.from(ch.t.slice(a, b), (x) => x - p.t0), v: Float64Array.from(ch.v.slice(a, b)), R: p.t1 - p.t0 };
}

/**
 * The derived run's data for target shot shots[plan.i] from run S (fillTargets' entry). o = {shots, ix, loops, grid, flips
 * (S's polarity stretches)}. -> {range, scenes, channels, samples, points0Primary, dirMap, notes, levelRef, ys (per T frame
 * the phases, for tests), info: {kind, from, j, n (T's passes), spread, avg, anchors, cover, ok, why, ratio?, scale?}} |
 * null (no correspondence at all). ok false = the guard (passes that differ, too few anchors): offered, not filled.
 */
export function deriveFill(S, { i, j, plan }, { shots = [], ix = null, loops = [], grid = 1000 / 30, flips = [] } = {}) {
  const fm = frameLen(grid) || 1000 / 30, T = shots[i], passes = plan.passes;
  if (!T || !passes?.length) return null;
  const R = passes[0].t1 - passes[0].t0, maps = passes.map((p) => phaseMap(ix, passes[0], p, grid));
  // S's own averaging decision for this loop (the same function S's compose uses): the average, or its cleanest pass
  const st = loopStates(S, loops, ix, grid).find((s) => s.id === plan.loop.id);
  const g = gateOf(S), P = S.points0Primary || S.points0 || S.points;
  // paw-mawd (linkfill): T's points are the chosen pass's own; a pass where the sidecar missed a turn (a lost frame beside it)
  // gave T one point per pass, a flat line. Only passes with the usual number of points compete
  const nIn = (p) => { let n = 0; for (let q = 0; q < (P?.at?.length || 0); q++) if (P.at[q] >= p.t0 && P.at[q] < p.t1) n++; return n; };
  const cnt = passes.map(nIn), usual = [...cnt].sort((u, v) => u - v)[Math.floor(cnt.length / 2)];
  let k = Math.max(0, cnt.indexOf(usual)), spread = 0;
  if (g && passes.length >= 2) {
    const a = averagePass(g, passes, maps);
    spread = spreadOf(a);
    let bestD = Infinity;
    a.per.forEach((q, m) => { if (cnt[m] !== usual) return; let d = 0, n = 0; for (let x = 0; x < q.length; x++) if (q[x] === q[x] && a.v[x] === a.v[x]) { d += Math.abs(q[x] - a.v[x]); n++; } if (n && d / n < bestD) { bestD = d / n; k = m; } });
  }
  const on = passes.length >= 2 && (st ? st.on : spread <= SPREAD_MAX && passes.length >= 3);
  // per T frame: the phases (ms into S's reference pass) its picture shows, or null (no correspondence: stays empty)
  const ts = framesIn(T.start_ms, T.end_ms, grid), ys = new Array(ts.length).fill(null);
  let anchors = 0, cover = 0;
  if (plan.kind === 'exact') {
    const m = phaseMap(ix, passes[0], { t0: T.start_ms, t1: T.end_ms }, grid);
    anchors = m.u.length;
    if (anchors >= MIN_ANCHORS) {
      const a = m.u[0], b = frameTime(frameAt(m.u[anchors - 1] + 0.5, grid) + 1, grid);   // to the last anchor's frame's end
      for (let x = 0; x < ts.length; x++) {
        const t = ts[x];
        if (t < a - 0.5 || t >= b) continue;
        const q = lowerBound(m.u, t);
        if (q > 0 && q < anchors && m.u[q] - m.u[q - 1] > R + 2 * fm) continue;   // other footage between two runs of it
        ys[x] = [m.at(t)];
      }
    }
  } else {
    const L = plan.tLoop, f0 = frameAt(L.t0 + 0.5, grid), s0 = frameAt(plan.loop.t0 + 0.5, grid), base = frameTime(s0, grid);
    const off = md(base - passes[0].t0, R);   // S's loop start, as a phase of the reference pass
    for (let x = 0; x < ts.length; x++) {
      if (ts[x] < L.t0 - 0.5 || ts[x] >= L.end) continue;
      ys[x] = cropIdx(frameAt(ts[x] + 0.5, grid) - f0, plan).map((idx) => md(off + frameTime(s0 + idx, grid) - base, R));
    }
    anchors = ys.filter(Boolean).length;
  }
  const shown = ys.reduce((n, y) => n + (y ? 1 : 0), 0);
  if (!shown) return null;
  cover = shown / ts.length;
  const at = (c) => Float32Array.from(ys, (y) => (y ? mean(y.map((p) => cyc(c, p))) : NaN));
  const mapCh = (ch) => {
    const v = at(cycleOf(ch, passes, maps, on, k));
    if (!Number.isFinite(ch.min) || !Number.isFinite(ch.max)) return { t: ts, v, ...(ch.signed ? { signed: true } : {}) };
    const span = ch.max - ch.min || 1;
    return { t: ts, v, min: ch.min, max: ch.max, scaled: Float32Array.from(v, (y) => (y - ch.min) / span), ...(ch.signed ? { signed: true } : {}) };
  };
  const channels = {};
  for (const [n, ch] of Object.entries(S.channels || {})) if (ch?.t?.length && !n.startsWith('rel:') && !n.startsWith('__') && n !== 'fused') channels[n] = mapCh(ch);
  const samples = S.samples?.t?.length ? (({ t, v }) => ({ t, v }))(mapCh(S.samples)) : { t: new Float64Array(0), v: new Float32Array(0) };
  // the sidecar's own points (its sign in them, no direction): S's chosen pass's, placed where T reaches their phase
  const pk = passes[k], pm = maps[k], pa = [], pp = [];
  if (P?.at?.length) {
    const yp = [];
    for (let q = 0; q < P.at.length; q++) if (P.at[q] >= pk.t0 && P.at[q] < pk.t1) yp.push([md(pm.at(P.at[q]), R), P.pos[q]]);
    for (let x = 0; x + 1 < ts.length; x++) {
      if (!ys[x] || !ys[x + 1]) continue;
      const y0 = ys[x][0], d = md(ys[x + 1][0] - y0, R);
      if (!(d > 0) || d > R / 2) continue;
      for (const [y, pos] of yp) { const o = md(y - y0, R); if (o < d) { pa.push(Math.round(ts[x] + (o / d) * (ts[x + 1] - ts[x]))); pp.push(pos); } }
    }
  }
  const ord = pa.map((_, q) => q).sort((u, v) => pa[u] - pa[v]), pts = { at: [], pos: [] };
  for (const q of ord) if (!pts.at.length || pa[q] > pts.at[pts.at.length - 1]) { pts.at.push(pa[q]); pts.pos.push(pp[q]); }
  // S's direction (relative to its tracked signal) at the source of each T frame, as stretches over T
  const dir = S.dir?.whole instanceof Set ? S.dir : directionOf(S, flips), src = (y) => pm.inv(y);
  const flippedSrc = (x) => (dir.whole.has(Math.max(0, sceneAt(S.scenes || [], x))) || (!S.scenes?.length && dir.whole.has(0))) !== flippedAt(dir.partial, x);
  const dm = [];
  for (let x = 0; x < ts.length; x++) if (ys[x] && flippedSrc(src(md(ys[x][0], R)))) dm.push([ts[x], x + 1 < ts.length ? ts[x + 1] : ts[x] + fm]);
  const first = ys.findIndex(Boolean), last = ys.length - 1 - [...ys].reverse().findIndex(Boolean);
  const range = { start: ts[first], end: last + 1 < ts.length ? ts[last + 1] : T.end_ms };
  const kS = Math.max(0, sceneAt(S.scenes || [], passes[0].t0 + R / 2)), sc = S.scenes?.[kS];
  const notes = (S.notes || []).filter((n) => n.scene_index === kS || (n.scene_index == null && (S.scenes?.length || 0) < 2)).map((n) => ({ ...n, scene_index: 0 }));
  const nT = Math.round(((range.end - range.start) / R) * 10) / 10;
  // paw-0zwb: a loop-pair crop link whose phase barely wins over another (crop-match.js LOOP_MATCH.strong): offered only
  const why = plan.weak ? 'the crop match is weak (its phase barely wins)' : plan.kind === 'exact' && anchors < MIN_ANCHORS ? 'too few of the same pictures' : nT < MIN_PASS ? `less than one pass of the loop here (${nT})` : passes.length >= 2 && !on && spread > SPREAD_MAX ? `the source's passes differ (spread ${Math.round(spread * 100)} %)` : '';
  return {
    range, ts, ys, channels, samples, points0Primary: { at: Float64Array.from(pts.at), pos: Float64Array.from(pts.pos) },
    scenes: [{ start_ms: T.start_ms, end_ms: T.end_ms, ...(sc?.sign != null ? { sign: sc.sign } : {}), ...(sc?.groups ? { groups: sc.groups } : {}) }],
    dirMap: flipsClean(dm), notes, levelRef: levelRef(S.points, passes[0].t0, passes[passes.length - 1].t1),
    info: { kind: plan.kind, from: S.id, j, n: nT, passes: passes.length, pass: k, spread: Math.round(spread * 1000) / 1000, avg: on, anchors, cover: Math.round(cover * 1000) / 1000, ok: !why, why,
      ...(plan.kind === 'crop' ? { ratio: plan.ratio, scale: plan.scale } : {}) },
  };
}

/** The shots as derived run tId (target shot i) composes them while it follows: its shot without Adjust settings of its own
 *  takes the source shot j's (run sId), and without a Detail of its own (its scene's default unset, no override over it)
 *  the source's Detail there: the same settings give the same points. -> shots (the same array when nothing is taken). */
export function inheritShots(shots, i, j, sId, tId) {
  const T = shots[i], S = shots[j];
  if (!T || !S) return shots;
  let out = shots;
  const put = (k, v) => { if (out === shots) out = shots.slice(); out[k] = v; };
  if (!deriveOf(T, tId) && deriveOf(S, sId)) put(i, { ...T, derive: deriveOf(S, sId) });
  const lo = sceneRange(shots, i)?.[0] ?? i, own = detailClean(shots[lo].detail), sd = detailAt(shots, (S.start_ms + S.end_ms) / 2);
  const mine = own?.shape !== undefined || own?.spans?.some((x) => x.t0 < T.end_ms && x.t1 > T.start_ms);
  if (!mine && sd) put(lo, { ...out[lo], detail: { ...(own || {}), spans: [...(own?.spans || []), { t0: T.start_ms, t1: T.end_ms, shape: sd.shape, sens: sd.sens }] } });
  return out;
}

const pct = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
/** S's depth level and range over [t0, t1): the 10th / 90th percentile of its points' positions | null. */
export function levelRef(points, t0, t1) {
  if (!points?.at?.length) return null;
  const s = [];
  for (let q = 0; q < points.at.length; q++) if (points.at[q] >= t0 && points.at[q] < t1) s.push(points.pos[q]);
  if (s.length < 4) return null;
  s.sort((a, b) => a - b);
  return { lo: pct(s, 0.1), hi: pct(s, 0.9) };
}
/** T's points moved and scaled so their 10th / 90th percentiles sit at ref's (S's level and range); the same points when
 *  either side is too flat or too short to say. */
export function carryLevel(points, ref) {
  const me = ref && levelRef(points, -Infinity, Infinity);
  if (!me || me.hi - me.lo < 5 || ref.hi - ref.lo < 5) return points;
  const k = (ref.hi - ref.lo) / (me.hi - me.lo);
  if (Math.abs(k - 1) < 0.02 && Math.abs(ref.lo - me.lo) < 1) return points;
  return { ...points, at: points.at, pos: Float64Array.from(points.pos, (p) => Math.round(Math.min(100, Math.max(0, ref.lo + (p - me.lo) * k)))) };
}

/** The words for a derived run: 'looped from shot 42', '5 passes · exact repeats' / '4.5 passes · cropped ×1.8'. */
export function fillWords(info, label) {
  const how = info.kind === 'crop' ? `cropped ×${(+info.scale || 1).toFixed(1)}${info.ratio && info.ratio !== 1 ? ` · cycle ×${info.ratio >= 1 ? info.ratio : `1/${Math.round(1 / info.ratio)}`}` : ''}` : 'exact repeats';
  return { name: `looped from shot ${label}`, what: `${info.n} pass${info.n === 1 ? '' : 'es'} · ${how}${info.avg ? ' · averaged' : ''}` };
}
