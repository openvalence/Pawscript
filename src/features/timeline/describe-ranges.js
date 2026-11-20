// describe-ranges.js -- "Describe by ranges" (paw-2lp7.3; the owner: "it just checks every few frames and marks what it sees
// in a range ... instead of marking into a scene it marks based on first and last contiguous detection"). Pure.
// The sidecar tags frames on a time grid (PROTOCOL v4.49 describe `grid`: every `step` frames of each shot plus its first /
// middle / last frame, scores >= 0.2); this module turns those samples into proposed action regions (regions.js shape,
// auto: true) and modifier ranges, and names the few frames worth tagging to place each edge (the refine round trip).
//   per sample  the act ids at the on- and at the off-threshold, mapped exactly as acts.js maps a shot's describe (names,
//               umbrellas, hides, the `fallback` exposed, the modifiers through detectedMods)
//   per id      ranges by first and last contiguous detection: a run of samples at the off-threshold holding at least one
//               at the on-threshold; up to `bridge` missed samples are bridged, and so is any stretch of carry shots (blank,
//               off-screen, filled, or a shot of at most carryMs where no act is seen at all: a cutaway inside an action
//               keeps the action going, the owner's rule)
//   edges       a range that starts on a shot's first sample (the grid always samples it) starts on that cut, likewise its
//               end on the shot's end; otherwise the edge lies between the last negative and the first positive sample: in
//               the middle, on a frame start, or, with refine samples there (refineTimes: at most 4 frames an edge, one
//               request), between the refined ones
//   actions     the wheres and the whats that happen in one (WHERE_WHATS: penetration, licking ...) seen together are one
//               action (oral + penetration = fellatio; as regions.js splitActs groups a scene's tags), cut where the set of
//               those whats changes (rimming, then anal); every other what (handjob, grinding ...) is an action of its own
//   layers      a SUGGESTION: the penetration family (a where + penetration / tonguefucking / fisting / toy / tail) first,
//               then the longest, each on the lowest layer where it overlaps no other proposal; an ACCEPTED region (any in
//               doc.acts) is never overlapped on its layer (the proposal is cut around it, or moves up when more than half
//               of it lies inside accepted actions there), and a proposal with the same tags as an accepted region is
//               dropped where that one is
import { TAG, tagsOf, detectedMods, WHERE_WHATS, TAG_CATEGORIES } from './acts.js';
import { frameStartOf, frameAt, frameTime } from '../../lib/lane.js';
import { normActs } from './regions.js';

/** Measured on the owner's 8 projects (trackers/experiments/descranges/RESULTS.md): sample every 24 frames, a range needs a
 *  raw score >= 0.9 once and holds while >= 0.5 (6 misses bridged), at least 8 s, same action within 8 s merged, an edge within
 *  4 s of a cut goes to the cut. Few, confident proposals: the tagger misses or confuses slit, grinding, handjob, licking. */
export const DEFAULTS = { step: 24, on: 0.9, off: 0.5, bridge: 6, minMs: 8000, carryMs: 8000, cover: 0.7, mergeMs: 8000, snapMs: 4000, calibrated: false };
/** Every name pattern the vocabulary reads (the request's `only`: the sidecar returns nothing else). */
export const VOCAB = [...new Set(TAG_CATEGORIES.flatMap((c) => c.tags.flatMap((t) => [...(t.names || []), ...(t.umbrella || [])])))];
const SEX_WHATS = new Set(['penetration', 'tonguefucking', 'fisting', 'toy', 'tailpen']);
const isWhere = (id) => TAG[id]?.cat === 'where';
const isWhat = (id) => TAG[id]?.cat === 'what';
const inWhere = (id) => WHERE_WHATS.has(id) || !!TAG[id]?.needsWhere;
const hit = (p, n) => (p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : p.startsWith('*') ? n.endsWith(p.slice(1)) : n === p);
const gives = (id, n) => [...(TAG[id]?.names || []), ...(TAG[id]?.umbrella || [])].some((p) => hit(p, n));
const over = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const sameTags = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const ORDER = Object.fromEntries(Object.keys(TAG).map((id, i) => [id, i]));

/** The sidecar requests (PROTOCOL v4.49). shots: [[start_ms, end_ms]] (cuts are sample boundaries). */
export const gridRequest = (video, { step = DEFAULTS.step, shots = null, start_ms = null, end_ms = null, params = {} } = {}) =>
  ({ cmd: 'describe', video, params, grid: { step, only: VOCAB, ...(shots?.length ? { shots } : {}), ...(start_ms != null ? { start_ms } : {}), ...(end_ms != null ? { end_ms } : {}) } });
export const refineRequest = (video, times, params = {}) => ({ cmd: 'describe', video, params, grid: { times, only: VOCAB } });

/** One sample's act ids and modifier ids at threshold th. Calibrated: a score counts relative to its tag's own threshold
 *  (the sidecar's `thresholds`, the confidence slider's per-tag F1 point): s x 0.5 / thr. */
function idsAt(tags, th, thr) {
  const on = Object.entries(tags || {}).filter(([n, s]) => (thr?.[n] ? (s * 0.5) / thr[n] : s) >= th).map(([tag]) => ({ tag, score: 1 }));
  const d = { tags: on };
  return { acts: tagsOf(d).filter((id) => isWhere(id) || isWhat(id)), mods: detectedMods({ describe: d }) };
}
/** The best score of a label that gives id (its names or umbrellas) in one sample. */
const scoreOf = (tags, id, thr) => Math.max(0, ...Object.entries(tags || {}).filter(([n]) => gives(id, n)).map(([n, s]) => (thr?.[n] ? (s * 0.5) / thr[n] : s)));

/** Per sample (sorted by time): {t, shot (index), hi: Set of ids at `on`, lo: Set at `off` (incl. hi), tags}. */
function readSamples(samples, shots, o, thr) {
  const S = [...samples].sort((a, b) => a.t_ms - b.t_ms);
  let k = 0;
  return S.map((s) => {
    while (k < shots.length - 1 && s.t_ms >= shots[k].end_ms) k++;
    const hi = idsAt(s.tags, o.on, thr), lo = idsAt(s.tags, o.off, thr);
    return { t: s.t_ms, shot: shots.length && s.t_ms >= shots[k].start_ms && s.t_ms < shots[k].end_ms ? k : -1, tags: s.tags,
      hi: new Set([...hi.acts, ...hi.mods]), lo: new Set([...lo.acts, ...lo.mods, ...hi.acts, ...hi.mods]) };
  });
}
/** Shot indices the ranges carry through: blank, off-screen, cutaway, filled (any view / fill tag the owner set), or short with no act
 *  seen at the on-threshold in any of its samples. */
function carryShots(shots, R, o) {
  const seen = new Set(R.filter((r) => [...r.hi].some((id) => isWhere(id) || isWhat(id))).map((r) => r.shot));
  return new Set(shots.flatMap((s, i) => {
    const own = (s.tags || []).map((e) => (typeof e === 'string' ? e : e?.id));
    const flagged = s.kind === 'blank' || !!s.fill || own.includes('offscreen') || own.includes('cutaway') || own.includes('blank');
    return flagged || (!seen.has(i) && s.end_ms - s.start_ms <= o.carryMs && R.some((r) => r.shot === i)) ? [i] : [];
  }));
}
/** Runs of sample indices for id: [first positive, last positive], contiguous at the off-threshold with bridging; each holds
 *  a sample at the on-threshold. */
function runsOf(id, R, carry, o) {
  const out = [];
  let cur = null, miss = 0;
  R.forEach((r, i) => {
    if (r.lo.has(id)) {
      if (cur && miss <= o.bridge) { cur.b = i; cur.strong ||= r.hi.has(id); }
      else { if (cur?.strong) out.push(cur); cur = { a: i, b: i, strong: r.hi.has(id) }; }
      miss = 0;
    } else if (!carry.has(r.shot)) miss++;
  });
  if (cur?.strong) out.push(cur);
  return out;
}
/** The edges of run [a, b] (sample indices of R) on frame starts: {t0, t1, open: [[lo, hi] per edge not on a cut]}. An edge
 *  on a shot's first / last sample (no negative sample between it and the cut) and within one step of the cut is that cut;
 *  else it lies between the last negative and the first positive sample, refined by the refine samples (ref) there. */
function edgesOf(id, { a, b }, R, shots, ref, o) {
  const A = R[a], B = R[b], sA = shots[A.shot], sB = shots[B.shot], open = [];
  const mid = (x, y) => frameStartOf((x + y) / 2, o.grid);
  let t0, t1;
  if (sA && A.t - sA.start_ms <= o.stepMs && (a === 0 || R[a - 1].t < sA.start_ms)) t0 = sA.start_ms;
  else if (a === 0) t0 = A.t;
  else {
    let first = A.t, prev = R[a - 1].t;   // refined frames between: the edge follows the last negative one
    const between = ref.filter((r) => r.t > prev && r.t < A.t);
    for (let k = between.length - 1; k >= 0; k--) { if (between[k].lo.has(id)) first = between[k].t; else { prev = between[k].t; break; } }
    t0 = mid(prev, first);
    open.push([R[a - 1].t, A.t]);
  }
  if (sB && sB.end_ms - B.t <= o.stepMs && (b === R.length - 1 || R[b + 1].t >= sB.end_ms)) t1 = sB.end_ms;
  else if (b === R.length - 1) t1 = sB ? sB.end_ms : B.t + o.stepMs;
  else {
    let last = B.t, next = R[b + 1].t;
    for (const r of ref.filter((x) => x.t > last && x.t < next)) { if (r.lo.has(id)) last = r.t; else { next = r.t; break; } }
    t1 = mid(last, next);
    open.push([B.t, R[b + 1].t]);
  }
  if (o.snapMs > 0) {   // an edge between samples near a cut goes to the cut (an action often changes with the angle)
    const cut = (t) => { let best = null; for (const s of shots) for (const c of [s.start_ms, s.end_ms]) if (Math.abs(c - t) <= o.snapMs && (best == null || Math.abs(c - t) < Math.abs(best - t))) best = c; return best; };
    const c0 = open.length && open[0][1] === A.t ? cut(t0) : null, c1 = open.length && open.at(-1)[0] === B.t ? cut(t1) : null;
    if (c0 != null && c0 < t1) t0 = c0;
    if (c1 != null && c1 > t0) t1 = c1;
  }
  return { t0, t1, open };
}

/** Per id (act or modifier): its ranges [{id, t0, t1, samples, positives, mean, open}] (open: the gaps a refine sample may
 *  land in, one per edge not on a cut). */
function idRanges(R, shots, ref, o) {
  const carry = carryShots(shots, R, o), ids = new Set(R.flatMap((r) => [...r.lo])), out = [];
  for (const id of ids) {
    for (const run of runsOf(id, R, carry, o)) {
      const { t0, t1, open } = edgesOf(id, run, R, shots, ref, o);
      if (!(t1 > t0)) continue;
      const span = R.slice(run.a, run.b + 1), pos = span.filter((r) => r.lo.has(id));
      out.push({ id, t0, t1, samples: span.length, positives: pos.length, mean: pos.reduce((s, r) => s + scoreOf(r.tags, id, o.thr), 0) / pos.length, open });
    }
  }
  return out;
}

/** Ranges of ids composed into actions (tag lists): see the header. The where family (wheres + the whats that happen in one)
 *  is one channel: each stretch of it is cut where its main in-where what changes (of the whats over a moment, the one seen
 *  longest in the stretch), a piece shorter than minMs goes to its longer neighbour, and a piece's tags = the ids over at
 *  least `cover` of it, always with its main what and a where (the one seen most). Every other what is an action of its own;
 *  `exposed` (dick out, no act) only where no other action is. Same tags closer than mergeMs on a layer: one action.
 *  -> [{tags, t0, t1, parts: [id ranges]}] */
function actions(ranges, o) {
  const fam = ranges.filter((r) => isWhere(r.id) || (isWhat(r.id) && inWhere(r.id))), out = [];
  const comps = [];
  for (const r of [...fam].sort((x, y) => x.t0 - y.t0)) { const c = comps.at(-1); if (c && r.t0 <= c.t1) { c.t1 = Math.max(c.t1, r.t1); c.rs.push(r); } else comps.push({ t0: r.t0, t1: r.t1, rs: [r] }); }
  for (const c of comps) {
    const tot = new Map();
    for (const r of c.rs) tot.set(r.id, (tot.get(r.id) || 0) + r.t1 - r.t0);
    const cuts = [...new Set([c.t0, c.t1, ...c.rs.flatMap((r) => [r.t0, r.t1])])].sort((x, y) => x - y);
    let pieces = cuts.slice(1).map((t1, i) => {
      const t0 = cuts[i], whats = c.rs.filter((r) => isWhat(r.id) && r.t0 <= t0 && r.t1 >= t1).map((r) => r.id);
      return { t0, t1, main: whats.sort((x, y) => tot.get(y) - tot.get(x))[0] ?? '' };
    });
    const merge = (P) => P.reduce((m, p) => { const q = m.at(-1); if (q && q.main === p.main) q.t1 = p.t1; else m.push({ ...p }); return m; }, []);
    pieces = merge(pieces);
    for (let short; (short = pieces.filter((p) => p.t1 - p.t0 < o.minMs)).length && pieces.length > 1;) {   // the shortest goes to its longer neighbour
      const p = short.sort((x, y) => (x.t1 - x.t0) - (y.t1 - y.t0))[0], i = pieces.indexOf(p), L = pieces[i - 1], R = pieces[i + 1];
      const n = !L ? R : !R ? L : (L.t1 - L.t0 >= R.t1 - R.t0 ? L : R);
      n.t0 = Math.min(n.t0, p.t0); n.t1 = Math.max(n.t1, p.t1); pieces.splice(i, 1);
      pieces = merge(pieces);
    }
    for (const p of pieces) {
      const len = p.t1 - p.t0, cov = (r) => over(p.t0, p.t1, r.t0, r.t1), sum = new Map();
      for (const r of c.rs) sum.set(r.id, (sum.get(r.id) || 0) + cov(r));
      const ids = new Set([...sum].filter(([, v]) => v >= o.cover * len).map(([id]) => id));
      if (p.main) ids.add(p.main);
      const wh = [...sum].filter(([id, v]) => isWhere(id) && v > 0).sort((x, y) => y[1] - x[1]);
      if (![...ids].some(isWhere) && wh.length) ids.add(wh[0][0]);
      if (!ids.size) continue;
      out.push({ tags: [...ids].sort((x, y) => ORDER[x] - ORDER[y]), t0: p.t0, t1: p.t1, parts: c.rs.filter((r) => ids.has(r.id) && cov(r) > 0) });
    }
  }
  const own = ranges.filter((r) => isWhat(r.id) && !inWhere(r.id) && r.id !== 'exposed');
  for (const w of own) out.push({ tags: [w.id], t0: w.t0, t1: w.t1, parts: [w] });
  const busy = out.map((x) => [x.t0, x.t1]);
  for (const w of ranges.filter((r) => r.id === 'exposed')) for (const [t0, t1] of minus(w.t0, w.t1, busy, o.minMs)) out.push({ tags: ['exposed'], t0, t1, parts: [w] });
  out.sort((x, y) => x.t0 - y.t0);
  const merged = [];   // same tags, a short gap: one action
  for (const x of out) {
    const q = merged.findLast((m) => sameTags(m.tags, x.tags));
    if (q && x.t0 - q.t1 <= o.mergeMs && x.t0 >= q.t0) { q.t1 = Math.max(q.t1, x.t1); q.parts = [...q.parts, ...x.parts]; } else merged.push({ ...x });
  }
  return merged.filter((x) => x.t1 - x.t0 >= o.minMs);
}
/** [t0, t1) without the spans `cut` -> pieces of at least minMs. */
function minus(t0, t1, cut, minMs) {
  let pieces = [[t0, t1]];
  for (const [a, b] of cut) pieces = pieces.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]].filter(([p, q]) => q > p)));
  return pieces.filter(([x, y]) => y - x >= minMs);
}
/** The layer suggestion and the accepted regions (see the header). */
function place(cands, accepted, o) {
  const prio = (c) => (c.tags.some(isWhere) && c.tags.some((t) => SEX_WHATS.has(t)) ? 0 : 1);
  const pieces = cands.flatMap((c) => minus(c.t0, c.t1, accepted.filter((r) => r.kind === 'act' && sameTags(r.tags || [], c.tags)).map((r) => [r.t0, r.t1]), o.minMs).map(([t0, t1]) => ({ ...c, t0, t1 })));
  pieces.sort((x, y) => prio(x) - prio(y) || (y.t1 - y.t0) - (x.t1 - x.t0) || x.t0 - y.t0);
  const placed = [];
  for (const c of pieces) {
    for (let L = 0; L < 16; L++) {
      if (placed.some((p) => p.layer === L && over(p.t0, p.t1, c.t0, c.t1) > 0)) continue;
      const onL = accepted.filter((r) => (r.layer || 0) === L), acc = onL.map((r) => [r.t0, r.t1]);
      if (onL.filter((r) => r.kind === 'act').reduce((s, r) => s + over(r.t0, r.t1, c.t0, c.t1), 0) > 0.5 * (c.t1 - c.t0)) continue;   // mostly inside another action: a secondary one
      for (const [t0, t1] of minus(c.t0, c.t1, acc, o.minMs)) placed.push({ ...c, t0, t1, layer: L });
      break;
    }
  }
  return placed.sort((a, b) => a.layer - b.layer || a.t0 - b.t0);
}

/**
 * Samples (the sidecar's v4.49 `samples`) -> proposals.
 * opts: shots (the shot list, app.doc.scenes: cuts, blank / off-screen / fill), accepted (app.doc.acts: never overlapped on
 * their layer), fx (app.doc.fx: a modifier range is offered only where none of its kind is), refined (the refine request's
 * samples), thresholds (the sidecar's, for `calibrated`), grid (the player's clock or a frame length: edges on frame starts),
 * step (frames between grid samples; with the grid's frame length: the snap distance) and DEFAULTS' knobs.
 * -> {regions: [{kind 'act', t0, t1, layer, tags, auto: true, mix? ('mix' on layer >= 1), confidence, evidence: {samples,
 *     positives, mean}}], mods: [{kind, t0, t1, auto: true, confidence, evidence}], refine: [times (ms)]: the frames to
 *     tag to place the open edges (refineTimes), empty when `refined` was given}.
 */
export function proposeRanges(samples, { shots = [], accepted = [], fx = [], refined = null, thresholds = null, grid = 0, ...knobs } = {}) {
  const o = { ...DEFAULTS, ...knobs, grid };
  o.thr = o.calibrated ? thresholds : null;
  const fl = typeof grid === 'object' ? grid?.frameMs : grid;
  o.stepMs = o.stepMs ?? (fl > 0 ? fl * o.step : (1000 / 24) * o.step);
  const L = [...shots].sort((a, b) => a.start_ms - b.start_ms);
  const R = readSamples(samples || [], L, o, o.thr), ref = refined ? readSamples(refined, L, o, o.thr) : [];
  const ranges = idRanges(R, L, ref, o);
  const ev = (parts) => {
    const n = parts.reduce((s, p) => s + p.positives, 0);
    return { samples: Math.max(...parts.map((p) => p.samples)), positives: Math.max(...parts.map((p) => p.positives)), mean: +(parts.reduce((s, p) => s + p.mean * p.positives, 0) / (n || 1)).toFixed(3) };
  };
  const conf = (e) => +(e.mean * (e.positives / Math.max(1, e.samples))).toFixed(3);
  const regions = place(actions(ranges, o), accepted || [], o).map(({ tags, t0, t1, layer, parts }) => {
    const e = ev(parts);
    return { kind: 'act', t0, t1, layer, tags, auto: true, ...(layer > 0 ? { mix: 'mix' } : {}), confidence: conf(e), evidence: e };
  });
  const mods = ranges.filter((r) => TAG[r.id]?.cat === 'modifier' && r.t1 - r.t0 >= o.minMs && !(fx || []).some((e) => e.kind === r.id && e.t1 > r.t0 && e.t0 < r.t1))
    .map((r) => { const e = ev([r]); return { kind: r.id, t0: r.t0, t1: r.t1, auto: true, confidence: conf(e), evidence: e }; }).sort((a, b) => a.t0 - b.t0);
  const open = refined ? [] : ranges.filter((r) => r.t1 - r.t0 >= o.minMs).flatMap((r) => r.open);
  return { regions, mods, refine: refineTimes(open, grid) };
}

/** The frames to tag to place edges, one request for all: per open edge (lo, hi) = (last negative, first positive sample time)
 *  up to `per` frames evenly between them (on frame starts with a grid, else evenly in ms), sorted, once each. */
export function refineTimes(edges, grid = 0, per = 4) {
  const out = new Set();
  for (const [lo, hi] of edges) {
    if (grid) {
      const a = frameAt(lo, grid), b = frameAt(hi, grid), n = b - a - 1, k = Math.min(per, n);
      for (let j = 1; j <= k; j++) out.add(frameTime(a + Math.round((j * (n + 1)) / (k + 1)), grid) + 1);   // +1: the sidecar takes the frame at or before
    } else for (let j = 1; j <= per; j++) out.add(Math.round(lo + ((hi - lo) * j) / (per + 1)));
  }
  return [...out].sort((a, b) => a - b);
}

/** app.doc.acts with `regions` (proposeRanges') as the proposals, in place of the earlier ones (stage 2's contract: auto: true,
 *  regions.js shape; accepted regions untouched: proposeRanges never overlaps them on their layer). */
export const withRangeProposals = (acts, regions) => normActs([...(acts || []).filter((r) => !r.auto),
  ...regions.map(({ kind, t0, t1, layer, tags, mix }) => ({ kind, t0, t1, layer, tags, ...(mix ? { mix } : {}), auto: true }))]);
