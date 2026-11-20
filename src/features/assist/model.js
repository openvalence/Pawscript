// model.js -- the assist queue, pure (test/assist-model.test.mjs). Builds the short list of questions only a human can
// answer, from the document: stroke direction per scene (the most valuable), "is the track on the right thing?",
// "does the action continue here?" for low-motion spans, and the depth range of a scene. Each question is answered with
// one key; apply.js turns an answer into a document change; the decisions persist as the project block 'assist'.
//
// Question = {id, kind, t0, t1, axis, prompt, choices:[{id, key, alt?, label}], evidence, value, state, answer, ...}
//   kind 'direction' : pairs [{a:{at,pos}, b:{at,pos}}] (consecutive extremes of the script, time order), cues, label
//   kind 'track'     : ghost (id), times [4 ms]
//   kind 'activity'  : event ('still' | 'carry' | 'idle' | 'gap'), times [6 ms] (filmstrip)
//   kind 'depth'     : times [1 ms]
//   kind 'fallback'  : ghost (rejected), other (id) -- made by the store after a "no" to a track check
// state 'open' | 'answered' | 'skipped' | 'split';  memory: true = answered in an earlier session (from the block).
// value = expected gain of the fixed-direction stroke score (measured lifts below x the question's share of strokes).

import { lowerBound, posAt, nearest } from '../../lib/core/script.js';
import { turns } from '../../lib/edit/strokes.js';

/** Measured / estimated lift of one correct answer for a whole video, per kind (owner's reference set). */
export const LIFT = { direction: 0.12, track: 0.05, activity: 0.03, depth: 0.01 };

export const DIRECTION_CHOICES = [
  { id: 'left', key: 'ArrowLeft', alt: '1', label: 'Left is deeper' },
  { id: 'right', key: 'ArrowRight', alt: '2', label: 'Right is deeper' },
  { id: 'skip', key: 'ArrowDown', label: "Can't tell" },
  { id: 'split', key: 'S', label: 'Changes inside' },
];
export const TRACK_CHOICES = [
  { id: 'yes', key: 'Y', label: 'Yes, right thing' },
  { id: 'no', key: 'N', label: 'No, wrong thing' },
  { id: 'skip', key: 'ArrowDown', label: "Can't tell" },
];
export const ACTIVITY_CHOICES = [
  { id: 'carry', key: 'Y', label: 'Yes, keep the rhythm' },
  { id: 'idle', key: 'N', label: 'No, it stops' },
  { id: 'orgasm', key: 'C', label: 'Orgasm (cum)' },
  { id: 'skip', key: 'ArrowDown', label: 'Skip' },
];
/** Depth presets (pos 0 = deepest): lo..hi the span is remapped to. */
export const DEPTH_PRESETS = [
  { id: 'full', key: '1', label: 'All the way', lo: 0, hi: 100 },
  { id: 'deep', key: '2', label: 'Deep', lo: 0, hi: 70 },
  { id: 'middle', key: '3', label: 'Halfway', lo: 30, hi: 90 },
  { id: 'shallow', key: '4', label: 'Shallow', lo: 60, hi: 100 },
];
export const DEPTH_CHOICES = [...DEPTH_PRESETS.map(({ id, key, label }) => ({ id, key, label })), { id: 'skip', key: 'ArrowDown', label: 'Skip' }];
export const FALLBACK_CHOICES = [
  { id: 'use', key: 'Y', label: 'Use it here' },
  { id: 'retrack', key: 'R', label: 'Re-track (paint the part)' },
  { id: 'keep', key: 'N', label: 'Keep as is' },
];
/** A rejected track with no other run to fall back on: re-track or keep. */
export const RETRACK_CHOICES = FALLBACK_CHOICES.filter((c) => c.id !== 'use');

const median = (xs) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
export const fmtClock = (ms, d = 1) => { const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(d).padStart(d + 3, '0')}`; };

/** Turning points of `script` with t0 <= at < t1: [{at, pos, kind:'top'|'bottom'}] (prominence in pos units). */
export function turnList(script, t0, t1, minProm = 10) {
  const i0 = lowerBound(script, t0), i1 = lowerBound(script, t1), part = script.slice(i0, i1);
  return turns(part, minProm, { endpoints: false }).map(({ i, kind }) => ({ at: part[i].at, pos: part[i].pos, kind }));
}

/** Position near t: the action within tol ms (a turning point the pair was taken from), else interpolated. */
export function posNear(script, t, tol = 200) {
  const i = nearest(script, t, tol);
  return i >= 0 ? script[i].pos : posAt(script, t);
}

/** Does the script agree with a direction fact {deep, shallow} (ms)? true / false, null if it cannot tell. */
export function agrees(script, fact) {
  const d = posNear(script, fact.deep), s = posNear(script, fact.shallow);
  if (!Number.isFinite(d) || !Number.isFinite(s) || d === s) return null;
  return d < s;
}

/** Stretches of the script separated by gaps >= gapMs without any action (spans for scripts without scenes). */
export function stretches(script, gapMs = 4000) {
  if (!script.length) return [];
  const out = [];
  let t0 = script[0].at;
  for (let i = 1; i < script.length; i++) if (script[i].at - script[i - 1].at >= gapMs) { out.push({ t0, t1: script[i - 1].at + 1 }); t0 = script[i].at; }
  out.push({ t0, t1: script[script.length - 1].at + 1 });
  return out;
}

/** Direction spans: scenes (else script stretches), cut at the split times. */
export function directionSpans({ scenes = [], splits = [], script = [] }) {
  const base = scenes.length ? scenes.map((s) => ({ t0: s.t0, t1: s.t1 })) : stretches(script);
  const cuts = [...new Set(splits)].sort((a, b) => a - b);
  const out = [];
  for (const s of base) {
    let a = s.t0;
    for (const c of cuts) if (c > a && c < s.t1) { out.push({ t0: a, t1: c, split: true }); a = c; }
    out.push({ t0: a, t1: s.t1, split: a !== s.t0 });
  }
  return out;
}

/** Move each pair's times to the nearest turning point of the raw (tracker) script within tol ms; pos stays the user's. */
export function snapPairs(pairs, raw, tol) {
  if (!raw?.length) return pairs;
  const T = turnList(raw, -Infinity, Infinity);   // whole script: a turn needs its neighbours
  const snap = (e) => {
    const n = T.filter((x) => Math.abs(x.at - e.at) <= tol);
    return n.length ? { ...e, at: n.reduce((m, x) => (Math.abs(x.at - e.at) < Math.abs(m.at - e.at) ? x : m)).at } : e;
  };
  return pairs.map((p) => { const a = snap(p.a), b = snap(p.b); return a.at < b.at ? { ...p, a, b } : p; });
}

const CONTACT = /penetrat|sex|knot|penis|vulva|anus|cloaca|genital|sheath|balls|butt/;
/** Normalised box around where the contact is: union of the contact tags' boxes (score >= min), minus boxes far from the
 * score-weighted centre (other figures' CAMs), grown by `pad`, clamped, sides >= 0.3. null without a box. */
export function contactZone(tags, { min = 0.3, pad = 1.5 } = {}) {
  const bs = (tags || []).filter((t) => CONTACT.test(t.tag) && t.score >= min && t.box?.length === 4).map((t) => ({ w: t.score, x0: t.box[0], y0: t.box[1], x1: t.box[0] + t.box[2], y1: t.box[1] + t.box[3] }));
  const c = (k) => bs.reduce((s, b) => s + b.w * (b[k + '0'] + b[k + '1']) / 2, 0) / bs.reduce((s, b) => s + b.w, 0);
  if (!bs.length) return null;
  const cx = c('x'), cy = c('y');
  const keep = bs.filter((b) => Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy) <= 0.35);
  if (!keep.length) return null;
  const x0 = Math.min(...keep.map((b) => b.x0)), x1 = Math.max(...keep.map((b) => b.x1)), y0 = Math.min(...keep.map((b) => b.y0)), y1 = Math.max(...keep.map((b) => b.y1));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, w = Math.min(1, Math.max(0.3, (x1 - x0) * pad)), h = Math.min(1, Math.max(0.3, (y1 - y0) * pad));
  const x = Math.min(1 - w, Math.max(0, mx - w / 2)), y = Math.min(1 - h, Math.max(0, my - h / 2));
  return { x, y, w, h };
}

/**
 * Representative pairs of consecutive extremes (a top and a bottom) inside [t0, t1): large, at the span's usual tempo,
 * spread over the span (best per time bin), best first. A pair never straddles a boundary: the span's edges and the
 * `cuts` inside it (plan segments, tracker event spans, span labels) stay at least `margin` ms outside the pair, and
 * pairs further from every boundary score higher.
 */
export function pickPairs(script, t0, t1, { k = 5, frameMs = 1000 / 30, margin = 250, cuts = [] } = {}) {
  const T = turnList(script, t0, t1), c = [];
  const inner = cuts.filter((x) => x > t0 && x < t1), edges = [t0, t1, ...inner];
  for (let j = 0; j + 1 < T.length; j++) {
    const a = T[j], b = T[j + 1];
    if (a.kind === b.kind) continue;
    const dt = b.at - a.at;
    if (dt < 3 * frameMs || a.at < t0 + margin || b.at > t1 - margin) continue;
    if (inner.some((x) => x >= a.at - margin && x <= b.at + margin)) continue;
    const d = Math.min(...edges.map((e) => (e < a.at ? a.at - e : e > b.at ? e - b.at : 0)));
    c.push({ a: { at: a.at, pos: a.pos }, b: { at: b.at, pos: b.pos }, amp: Math.abs(a.pos - b.pos), dt, d });
  }
  if (!c.length) return [];
  const mDt = median(c.map((x) => x.dt));
  for (const x of c) x.score = x.amp * (1 - 0.5 * Math.min(1, Math.abs(x.dt - mDt) / mDt)) * (0.5 + 0.5 * Math.min(1, x.d / Math.max(1000, 2 * x.dt)));
  const bins = Math.min(k, c.length), best = new Array(bins).fill(null);
  for (const x of c) {
    const bi = Math.min(bins - 1, Math.floor(((x.a.at - t0) / (t1 - t0)) * bins));
    if (!best[bi] || x.score > best[bi].score) best[bi] = x;
  }
  const out = best.filter(Boolean);
  for (const x of [...c].sort((p, q) => q.score - p.score)) { if (out.length >= k) break; if (!out.includes(x)) out.push(x); }
  return out.sort((p, q) => q.score - p.score).map(({ a, b, score }) => ({ a, b, score: Math.round(score) }));
}

/** Pearson r of two scripts' positions over [t0, t1) sampled every stepMs (NaN if flat / too short). */
export function corr(s1, s2, t0, t1, stepMs = 100) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let t = t0; t < t1; t += stepMs) {
    const a = posAt(s1, t), b = posAt(s2, t);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  if (n < 5) return NaN;
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 1e-9 && vb > 1e-9 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : NaN;
}

/** Stroke asymmetry: median log(time going in / time going out) of the span's strokes; > 0 = slower in. */
export function asymmetry(script, t0, t1) {
  const T = turnList(script, t0, t1), r = [];
  for (let j = 0; j + 2 < T.length; j += 2) {
    const d1 = T[j + 1].at - T[j].at, d2 = T[j + 2].at - T[j + 1].at;
    const [din, dout] = T[j].kind === 'top' ? [d1, d2] : [d2, d1];   // from a top, the first half goes in
    if (din > 0 && dout > 0) r.push(Math.log(din / dout));
  }
  return r.length >= 3 ? median(r) : NaN;
}

/**
 * A likely direction change inside [t0, t1), or null: the windowed correlation with a second signal (another ghost)
 * flips sign and stays flipped (>= 3 windows each side, |mean r| >= 0.4). Snapped to the nearest turning point.
 */
export function flipHint(script, other, t0, t1, { winMs = 2500, stepMs = 500 } = {}) {
  if (!other?.length) return null;
  const w = [];
  for (let a = t0; a + winMs <= t1; a += stepMs) { const r = corr(script, other, a, a + winMs); w.push({ c: a + winMs / 2, r: Number.isFinite(r) ? r : 0 }); }
  let best = null;
  for (let k = 3; k <= w.length - 3; k++) {   // >= 3 windows each side
    const L = w.slice(0, k), R = w.slice(k);
    const mL = L.reduce((s, x) => s + x.r, 0) / L.length, mR = R.reduce((s, x) => s + x.r, 0) / R.length;
    if (Math.sign(mL) === Math.sign(mR) || Math.abs(mL) < 0.4 || Math.abs(mR) < 0.4) continue;
    const d = Math.abs(mL - mR);
    if (!best || d > best.d) best = { d, t: (w[k - 1].c + w[k].c) / 2 };
  }
  if (!best) return null;
  const T = turnList(script, t0, t1);
  let t = best.t, dmin = Infinity;
  for (const x of T) if (Math.abs(x.at - best.t) < dmin) { dmin = Math.abs(x.at - best.t); t = x.at; }
  return Math.round(t);
}

/** Gaps between consecutive turning points longer than max(factor x the local turn interval, minMs): [{t0, t1}]. */
export function scriptGaps(script, { minMs = 1500, factor = 3 } = {}) {
  if (script.length < 2) return [];
  const T = turnList(script, script[0].at, script[script.length - 1].at + 1), out = [];
  const iv = T.slice(1).map((x, j) => x.at - T[j].at);
  for (let j = 0; j < iv.length; j++) {
    const win = [];
    for (let m = Math.max(0, j - 6); m < Math.min(iv.length, j + 7); m++) if (m !== j) win.push(iv[m]);
    const local = median(win);
    if (iv[j] > Math.max(minMs, factor * (Number.isFinite(local) ? local : 0))) out.push({ t0: T[j].at, t1: T[j + 1].at });
  }
  return out;
}

// ---- decisions (the project block 'assist') ----
export const BLOCK_VERSION = 1;
export const emptyBlock = () => ({ v: BLOCK_VERSION, direction: [], splits: [], track: [], activity: [], depth: [] });
/** A stored block -> a valid block (unknown / broken entries dropped; a newer version is kept as is). */
export function readBlock(raw) {
  if (!raw || typeof raw !== 'object') return emptyBlock();
  if (raw.v > BLOCK_VERSION) return { ...emptyBlock(), ...raw };
  const span = (x) => x && Number.isFinite(x.t0) && Number.isFinite(x.t1) && x.t1 > x.t0;
  const arr = (k, ok) => (Array.isArray(raw[k]) ? raw[k].filter((x) => span(x) && ok(x)) : []);
  return {
    v: BLOCK_VERSION,
    direction: arr('direction', (x) => Number.isFinite(x.deep) && Number.isFinite(x.shallow)),
    splits: Array.isArray(raw.splits) ? raw.splits.filter(Number.isFinite) : [],
    track: arr('track', (x) => typeof x.ghost === 'string' && typeof x.ok === 'boolean'),
    activity: arr('activity', (x) => ['carry', 'idle', 'orgasm', 'climax'].includes(x.state)),   // 'climax' = an orgasm answer saved before the split
    depth: arr('depth', (x) => DEPTH_PRESETS.some((p) => p.id === x.preset)),
  };
}
/** The entry of `list` that covers most of [t0, t1) (>= half of the span and of itself), or null. */
export function decisionFor(list, t0, t1, pred = () => true) {
  let best = null, bo = 0;
  for (const x of list || []) {
    if (!pred(x)) continue;
    const o = overlap(t0, t1, x.t0, x.t1);
    if (o >= 0.5 * (t1 - t0) && o >= 0.5 * (x.t1 - x.t0) && o > bo) { best = x; bo = o; }
  }
  return best;
}
/** Block with `entry` in `kind`, replacing entries it mostly covers (same ghost for 'track'). */
export function withDecision(block, kind, entry) {
  const same = (x) => kind !== 'track' || x.ghost === entry.ghost;
  const keep = (block[kind] || []).filter((x) => !(same(x) && decisionFor([x], entry.t0, entry.t1)));
  return { ...block, [kind]: [...keep, entry].sort((a, b) => a.t0 - b.t0) };
}
/** The decision an answered question records (null for skips, splits and fallbacks). */
export function decisionOf(q) {
  const a = q.answer;
  if (!a || q.state !== 'answered' || q.memory) return null;
  if (q.kind === 'direction' && a.fact) return ['direction', { t0: q.t0, t1: q.t1, deep: a.fact.deep, shallow: a.fact.shallow }];
  if (q.kind === 'track') return ['track', { t0: q.t0, t1: q.t1, ghost: q.ghost, ok: a.choice === 'yes' }];
  if (q.kind === 'activity' && ['carry', 'idle', 'orgasm'].includes(a.choice)) return ['activity', { t0: q.t0, t1: q.t1, state: a.choice }];
  if (q.kind === 'depth' && a.choice !== 'skip') return ['depth', { t0: q.t0, t1: q.t1, preset: a.choice }];
  return null;
}
/**
 * The block to persist: what was loaded (`memory`), then this session's answers in queue order. live(q) says whether
 * an answer still stands (its undo entry was not undone). Splits: memory's plus the live split answers.
 */
export function blockOf(memory, questions, live = () => true) {
  let b = { ...readBlock(memory) };
  const splits = new Set(b.splits);
  for (const q of questions) {
    if (!live(q)) continue;
    if (q.state === 'split' && Number.isFinite(q.answer?.at)) splits.add(q.answer.at);
    const d = decisionOf(q);
    if (d) b = withDecision(b, d[0], d[1]);
  }
  b.splits = [...splits].sort((x, y) => x - y);
  return b;
}

// ---- the queue ----
const nStrokes = (script, t0, t1) => Math.max(0, turnList(script, t0, t1).length - 1);
const spread = (t0, t1, n) => Array.from({ length: n }, (_, i) => Math.round(t0 + ((i + 0.5) / n) * (t1 - t0)));

/** Questions in asking order: open ones by value (highest first), ties by time; answered / skipped keep that order too. */
export function orderQueue(qs) {
  return [...qs].sort((a, b) => b.value - a.value || a.t0 - b.t0 || a.kind.localeCompare(b.kind));
}

/**
 * The run that covers [t0, t1) the most (largest overlap of its range; a tie goes to the later run), or null when none
 * overlaps: the timeline's chooseRun rule (features/timeline/generate-logic.js), on run ranges.
 */
export function coverRun(runs, t0, t1) {
  let best = null, bo = 0;
  for (const r of runs || []) { const o = overlap(t0, t1, r.range?.t0 ?? -Infinity, r.range?.t1 ?? Infinity); if (o > 0 && o >= bo) { best = r; bo = o; } }
  return best;
}

/** Sign of the scene containing t (scenes [{t0, t1, sign}]), 0 if none. */
export const signAt = (scenes, t) => (scenes || []).find((s) => s.t0 <= t && t < s.t1)?.sign ?? 0;

/**
 * Build the queue. input = {
 *   script, axis, frameMs,
 *   scenes: [{t0, t1}],                    detected scenes (or a run's), [] = use script stretches
 *   runs:    [{id, name, range:{t0,t1}, scenes:[{t0,t1,sign}], overlays: bool}]   tracker runs: per scene, the one that
 *            covers it most gives the sign cue and is the run its track check shows (a scene no run covers: no check)
 *   primary: same shape | null              the selected run (the runs list when `runs` is not given; sign-cue fallback)
 *   cuts:    [ms] more boundaries a pair never crosses (span labels); plan segment and event edges always count
 *   other:   {id, name, script} | null     a second tracker run (flip hints, correlation cue, fallback)
 *   events:  [{t0, t1, kind:'still'|'carry'|'idle'}]
 *   plan:    doc.plan (activity spans already planned are not asked)
 *   block:   the stored decisions
 *   depth:   ask depth questions (default true)
 * }
 */
export function buildQueue(input) {
  const { script = [], axis = 'stroke', frameMs = 1000 / 30, scenes = [], primary = null, other = null, events = [], plan = [], depth = true } = input;
  const block = readBlock(input.block);
  const runs = input.runs || (primary ? [primary] : []);
  const cuts = [...new Set([...plan.flatMap((p) => [p.t0, p.t1]), ...events.flatMap((e) => [e.t0, e.t1]), ...(input.cuts || [])])].sort((a, b) => a - b);
  const cutsIn = (t0, t1) => cuts.filter((x) => x > t0 && x < t1);
  const qs = [];

  // direction
  const spans = [];
  for (const s of directionSpans({ scenes, splits: block.splits, script })) {
    const hint = s.split || decisionFor(block.direction, s.t0, s.t1) ? null : flipHint(script, other?.script, s.t0, s.t1);
    if (hint) spans.push({ t0: s.t0, t1: hint, presplit: hint }, { t0: hint, t1: s.t1, presplit: hint });
    else spans.push(s);
  }
  const counts = spans.map((s) => nStrokes(script, s.t0, s.t1));
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  spans.forEach((s, i) => {
    const qc = cutsIn(s.t0, s.t1), pairs = snapPairs(pickPairs(script, s.t0, s.t1, { frameMs, cuts: qc }), input.primaryScript, Math.max(120, 2 * frameMs));
    if (!pairs.length) return;
    const share = counts[i] / total, mid = (s.t0 + s.t1) / 2;
    const r = other?.script?.length ? corr(script, other.script, s.t0, s.t1) : NaN, as = asymmetry(script, s.t0, s.t1);
    const cues = {
      sign: signAt((coverRun(runs, s.t0, s.t1) || primary)?.scenes, mid),
      corr: Number.isFinite(r) && Math.abs(r) >= 0.3 ? Math.sign(r) : 0,
      asym: Number.isFinite(as) && Math.abs(as) >= 0.15 ? Math.sign(as) : 0,
    };
    const q = {
      id: `direction:${s.t0}-${s.t1}`, kind: 'direction', t0: s.t0, t1: s.t1, axis, label: `${fmtClock(s.t0)}–${fmtClock(s.t1)}`,
      prompt: 'Which frame is deeper?', choices: DIRECTION_CHOICES, pairs, cues, cuts: qc,
      evidence: { strokes: counts[i], share, corr: r, asym: as, presplit: s.presplit ?? null, split: !!s.split },
      value: LIFT.direction * share, state: 'open', answer: null,
    };
    const fact = decisionFor(block.direction, s.t0, s.t1);
    if (fact) {
      const ok = agrees(script, fact);
      if (ok !== false) Object.assign(q, { state: 'answered', memory: true, answer: { choice: 'memory', fact } });
      else q.suggest = { flip: true, reason: 'your earlier answer', source: 'memory' };
    }
    qs.push(q);
  });

  // track check: per scene, the run with stored overlays that covers it most; frames from the part it covers
  const tRuns = runs.filter((r) => r.overlays);
  if (tRuns.length) {
    const tScenes = scenes.length ? scenes : directionSpans({ script });
    const c2 = tScenes.map((s) => nStrokes(script, s.t0, s.t1)), tot2 = c2.reduce((a, b) => a + b, 0) || 1;
    tScenes.forEach((s, i) => {
      const run = coverRun(tRuns, s.t0, s.t1);
      if (!run || c2[i] < 2) return;
      const a = Math.max(s.t0, run.range?.t0 ?? -Infinity), b = Math.min(s.t1, run.range?.t1 ?? Infinity);
      const alt = coverRun(runs.filter((r) => r.id !== run.id), s.t0, s.t1) || (other && other.id !== run.id ? other : null);
      const q = {
        id: `track:${run.id}:${s.t0}-${s.t1}`, kind: 'track', t0: s.t0, t1: s.t1, axis, label: `${fmtClock(s.t0)}–${fmtClock(s.t1)}`,
        prompt: 'Is the highlighted region the thing that moves in and out?', choices: TRACK_CHOICES, ghost: run.id, ghostName: run.name,
        other: alt?.id ?? null, times: spread(a, b, 4), evidence: { strokes: c2[i] }, value: LIFT.track * (c2[i] / tot2), state: 'open', answer: null,
      };
      const d = decisionFor(block.track, s.t0, s.t1, (x) => x.ghost === run.id);
      if (d) Object.assign(q, { state: 'answered', memory: true, answer: { choice: d.ok ? 'yes' : 'no' } });
      qs.push(q);
    });
  }

  // activity: tracker events, then long gaps of the script that no event covers
  const spansA = [];
  for (const e of [...events].sort((a, b) => a.t0 - b.t0)) if (e.t1 > e.t0 && !spansA.some((x) => overlap(x.t0, x.t1, e.t0, e.t1) > 0)) spansA.push({ ...e });
  for (const g of scriptGaps(script)) if (!spansA.some((x) => overlap(x.t0, x.t1, g.t0, g.t1) > 0)) spansA.push({ ...g, kind: 'gap' });
  const scripted = script.length ? script[script.length - 1].at - script[0].at : 1;
  for (const s of spansA) {
    if (decisionFor(plan, s.t0, s.t1, (p) => ['idle', 'offscreen', 'climax', 'orgasm'].includes(p.kind))) continue;
    const q = {
      id: `activity:${s.t0}-${s.t1}`, kind: 'activity', t0: s.t0, t1: s.t1, axis, label: `${fmtClock(s.t0)}–${fmtClock(s.t1)}`, event: s.kind,
      prompt: 'Is the action continuing here?', choices: ACTIVITY_CHOICES, times: spread(s.t0, s.t1, 6),
      evidence: { kind: s.kind, ms: s.t1 - s.t0 }, value: LIFT.activity * Math.min(1, (s.t1 - s.t0) / Math.max(1, scripted) * 4), state: 'open', answer: null,
    };
    const d = decisionFor(block.activity, s.t0, s.t1);
    if (d) Object.assign(q, { state: 'answered', memory: true, answer: { choice: d.state } });
    qs.push(q);
  }

  // depth (lowest priority)
  if (depth) spans.forEach((s, i) => {
    if (counts[i] < 6) return;
    const T = turnList(script, s.t0, s.t1), deepest = T.reduce((m, x) => (x.pos < m.pos ? x : m), T[0]);
    const q = {
      id: `depth:${s.t0}-${s.t1}`, kind: 'depth', t0: s.t0, t1: s.t1, axis, label: `${fmtClock(s.t0)}–${fmtClock(s.t1)}`,
      prompt: 'How deep does this scene go?', choices: DEPTH_CHOICES, times: [deepest.at], evidence: { strokes: counts[i] },
      value: LIFT.depth * (counts[i] / total), state: 'open', answer: null,
    };
    const d = decisionFor(block.depth, s.t0, s.t1);
    if (d) Object.assign(q, { state: 'answered', memory: true, answer: { choice: d.preset } });
    qs.push(q);
  });

  return orderQueue(qs);
}

/** Two direction questions for the halves of q split at `at` (inserted right after q by the store). */
export function splitQuestion(q, at, script, frameMs) {
  return [[q.t0, at], [at, q.t1]].map(([t0, t1]) => {
    const pairs = pickPairs(script, t0, t1, { frameMs, cuts: q.cuts || [] });
    return {
      ...q, id: `direction:${t0}-${t1}`, t0, t1, label: `${fmtClock(t0)}–${fmtClock(t1)}`, pairs, state: pairs.length ? 'open' : 'skipped', answer: null,
      suggest: null, memory: false, value: q.value / 2, evidence: { ...q.evidence, split: true, presplit: null },
    };
  });
}

/** Open count, answered count and the estimated gain banked by the answers so far. */
export function progress(qs) {
  let open = 0, done = 0, gain = 0;
  for (const q of qs) {
    if (q.state === 'open') open++;
    else if (q.state === 'answered' || q.state === 'skipped' || q.state === 'split') { done++; if (q.state === 'answered') gain += q.value; }
  }
  return { open, done, total: open + done, gain };
}
