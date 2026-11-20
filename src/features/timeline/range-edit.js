// range-edit.js -- the pure half of the Range row (RangeLane.svelte): the band envelope's outline, handles and hit test
// (pieces with four corners, edge keys, sides), snapping, a band dragged by its edge or body, and the
// Autorange policy as CurveEditor models (kit CurveEditor: lines + handles, viewBox CW x CH; the knobs strip KW x KH).
// No DOM, no Svelte.
import { DEVICE, POLICY, KNOT_DENSITY, ladderAt, ladderOf, buildUpOf } from '../../lib/autorange.js';
import { kindOf } from './kinds.js';
import { frameAt, frameTime, frameLen } from '../../lib/lane.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const K4 = ['lo', 'hi', 'lo1', 'hi1'];

/** A band {lo, hi, lo1, hi1} moved by dv (pos): part 'hi' / 'lo' moves that edge at both ends (never past the other
 *  edge), 'body' shifts all four inside 0..100. slope (Alt): only the scene-end values move (hi1 / lo1, the body
 *  both) -- the band tilts. -> new band (rounded). */
export function dragBand(b, part, dv, { slope = false } = {}) {
  const r = { ...b };
  if (slope) {
    if (part === 'hi') r.hi1 = clamp(b.hi1 + dv, b.lo1, 100);
    else if (part === 'lo') r.lo1 = clamp(b.lo1 + dv, 0, b.hi1);
    else if (part === 'body') { const d = clamp(dv, -b.lo1, 100 - b.hi1); r.lo1 = b.lo1 + d; r.hi1 = b.hi1 + d; }
  } else if (part === 'body') {
    const d = clamp(dv, -Math.min(b.lo, b.lo1, b.hi, b.hi1), 100 - Math.max(b.lo, b.lo1, b.hi, b.hi1));
    for (const k of K4) r[k] = b[k] + d;
  } else if (part === 'hi') {
    const d = clamp(dv, Math.max(b.lo - b.hi, b.lo1 - b.hi1), 100 - Math.max(b.hi, b.hi1));
    r.hi = b.hi + d; r.hi1 = b.hi1 + d;
  } else if (part === 'lo') {
    const d = clamp(dv, -Math.min(b.lo, b.lo1), Math.min(b.hi - b.lo, b.hi1 - b.lo1));
    r.lo = b.lo + d; r.lo1 = b.lo1 + d;
  }
  for (const k of K4) r[k] = Math.round(r[k]);
  return r;
}

/** A dragged time snapped (off = Shift: as it is): to the nearest target within tolMs (cuts, scene / span ends, spurt
 *  markers), else to the nearest frame start (frameMs: the frame grid, lane.js: the player's clock; paw-kxz4). */
export function snapTime(t, { frameMs = 0, targets = [], tolMs = 0, off = false } = {}) {
  if (off) return Math.round(t);
  let best = null;
  for (const x of targets) if (Math.abs(x - t) <= tolMs && (best == null || Math.abs(x - t) < Math.abs(best - t))) best = x;
  if (best != null) return best;
  return frameLen(frameMs) ? frameTime(frameAt(t + frameLen(frameMs) / 2, frameMs), frameMs) : Math.round(t);
}
/** A dragged level snapped: to a neighbour corner's level within tol (adjacent pieces meet without a step), else to a
 *  multiple of 5 within tol, else rounded. */
export function snapLevel(v, { targets = [], tol = 0, off = false } = {}) {
  if (off) return Math.round(v);
  let best = null;
  for (const x of targets) if (Math.abs(x - v) <= tol && (best == null || Math.abs(x - v) < Math.abs(best - v))) best = x;
  if (best != null) return best;
  const r5 = Math.round(v / 5) * 5;
  return Math.abs(r5 - v) <= tol ? r5 : Math.round(v);
}

/** The band's edges at x share u (0..1) of the scene: [lo, hi]. */
export const bandAt = (b, u) => [b.lo + (b.lo1 - b.lo) * u, b.hi + (b.hi1 - b.hi) * u];
/** "20–80" or "20–80 → 10–90" (a sliding band). */
export const bandText = (b) => (b.lo === b.lo1 && b.hi === b.hi1 ? `${b.lo}–${b.hi}` : `${b.lo}–${b.hi} → ${b.lo1}–${b.hi1}`);

/** The policy with one handle's value: 'ladders.<family>.<lo0|hi0|lo1|hi1|at>' writes into that family's ladder. */
export function policyWith(P, key, v) {
  const [head, fam, k] = key.split('.');
  if (head !== 'ladders' || !k) return { ...P, [key]: v };
  return { ...P, ladders: { ...(P.ladders || {}), [fam]: { ...(P.ladders?.[fam] || {}), [k]: v } } };
}

// ---- the policy curve: x = progress through an act run (then the orgasm), y = pos (100 = out, top) ----
export const CW = 300, CH = 150;
export const FAMILIES = ['penetration', 'oral', 'foreplay'];
const PAD = 12, RUN = 0.8;   // the run takes the left 80 %, the orgasm band the right end
const xOf = (u) => PAD + u * (CW - 2 * PAD), uOf = (x) => (x - PAD) / (CW - 2 * PAD);
const xRun = (u) => xOf(u * RUN), uRun = (x) => uOf(x) / RUN;
const yOf = (pos) => PAD + (1 - pos / 100) * (CH - 2 * PAD), posOf = (y) => 100 * (1 - (y - PAD) / (CH - 2 * PAD));
const signed = (v) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);

/** -> {lines, handles} for CurveEditor: one band (out / deep edge) per act family over a run in its colour (the
 *  active family solid with its handles, the others faint), the width / offset applied; the orgasm band at the right;
 *  guides for the knot reserve, the tie level and (machine) the floor. Handles (active family): start band (out,
 *  deep), full band, when full depth arrives; then knot reserve, tie, orgasm deep end / ceiling, offset, floor. */
export function policyModel(policy, fam = 'penetration') {
  const P = { ...POLICY, ...policy }, machine = P.device === 'machine', dev = DEVICE[machine ? 'machine' : 'stroker'];
  const F = machine ? clamp(P.floor, 0, 90) : 0, sq = (v) => F + (v * (100 - F)) / 100, unsq = (p) => ((p - F) * 100) / (100 - F);
  const width = clamp(P.width ?? 1, 0.5, 1.2);
  const reachOf = (f) => { const bu = buildUpOf(f, P); return bu > 0 ? Math.min(1, bu * dev.reach) : 0; };
  // the band a family's run gets at u, in ladder space, width and offset applied like rangePlan does
  const bandOf = (f, u, off = P.offset || 0) => {
    const r = reachOf(f), b = ladderAt(ladderOf(f, P), r > 0 ? Math.min(1, u / r) : 1);
    const lo = b.hi - (b.hi - b.lo) * width;
    return { lo: clamp(lo + off, 0, 100), hi: clamp(b.hi + off, 0, 100) };
  };
  const edge = (f, k) => Array.from({ length: 33 }, (_, j) => { const u = j / 32; return [xRun(u), yOf(sq(bandOf(f, u)[k]))]; });
  const fams = [...FAMILIES.filter((f) => f !== fam), fam];   // the active one drawn last (on top)
  const L = ladderOf(fam, P), L0 = L[0], L1 = L[L.length - 1], reach = reachOf(fam);
  const tie = P.tie ?? P.knotReserve, oLo = P.orgasmLo ?? 0, oHi = P.orgasmHi ?? 45, oX = [xOf(0.86), CW - PAD];
  const ladderKey = (k) => `ladders.${fam}.${k}`, name = kindOf(fam).label;
  const lad = (k, label, u, v, text) => ({ key: ladderKey(k), label, shape: 'hpill', axis: 'y', x: xRun(u), y: yOf(sq(v)), value: Math.round(v), min: 0, max: 100, step: 1,
    text, toValue: (_, y) => clamp(unsq(posOf(y)), 0, 100), color: kindOf(fam).css });
  const mid = (o) => { const b = bandOf(fam, 0.5, o); return (b.lo + b.hi) / 2; };
  return {
    lines: [
      { pts: [[PAD, yOf(sq(P.knotReserve))], [xRun(1), yOf(sq(P.knotReserve))]], kind: 'guide' },
      { pts: [[xRun(0.3), yOf(sq(tie))], [xRun(0.5), yOf(sq(tie))]], kind: 'guide' },
      ...(machine ? [{ pts: [[PAD, yOf(F)], [CW - PAD, yOf(F)]], kind: 'guide' }] : []),
      ...fams.flatMap((f) => ['hi', 'lo'].map((k) => ({ pts: edge(f, k), kind: f === fam ? 'curve' : 'ghost', color: kindOf(f).css }))),
      ...[oLo, oHi].map((v) => ({ pts: [[oX[0], yOf(sq(v))], [oX[1], yOf(sq(v))]], color: kindOf('orgasm').css })),
    ],
    handles: [
      lad('hi0', `${name} start band, out end: where the first scene of a run begins`, 0.04, L0[2], `start ${Math.round(L0[1])}–${Math.round(L0[2])}`),
      lad('lo0', `${name} start band, deep end (tip only = high)`, 0.04, L0[1], ''),
      lad('hi1', `${name} full band, out end: the band once the run reaches full depth`, 1, L1[2], `full ${Math.round(L1[1])}–${Math.round(L1[2])}`),
      lad('lo1', `${name} full band, deep end`, 1, L1[1], ''),
      { key: ladderKey('at'), label: `${name} build-up to full depth (far left: none)`, shape: 'vpill', axis: 'x',
        x: xRun(reach), y: yOf(sq(L1[2])) + 18, value: buildUpOf(fam, P), min: 0, max: 1, step: 0.05, color: kindOf(fam).css,
        text: reach > 0 ? `full depth at ${Math.round(reach * 100)} %` : 'no build-up', toValue: (x) => clamp(uRun(x) / dev.reach, 0, 1) },
      { key: 'knotReserve', label: `Knot reserve: the bottom kept for knot pops (over ${Math.round(KNOT_DENSITY.high * 100)} % knotting)`,
        shape: 'hpill', axis: 'y', x: xRun(0.7), y: yOf(sq(P.knotReserve)), value: P.knotReserve, min: 0, max: 40, step: 1,
        text: P.knotReserve > 0 ? `knot ≤${Math.round(P.knotReserve)}` : 'no knot reserve', toValue: (_, y) => clamp(unsq(posOf(y)), 0, 40) },
      { key: 'tie', label: 'Tie level after a single knot', shape: 'hpill', axis: 'y',
        x: xRun(0.4), y: yOf(sq(tie)), value: tie, min: 0, max: 60, step: 1, text: `tie ≤${Math.round(tie)}`, toValue: (_, y) => clamp(unsq(posOf(y)), 0, 60) },
      { key: 'orgasmHi', label: 'Orgasm band, ceiling: the shallowest the orgasm scene goes', shape: 'hpill', axis: 'y', x: xOf(0.93), y: yOf(sq(oHi)), value: oHi, min: 5, max: 100, step: 1,
        color: kindOf('orgasm').css, text: `orgasm ${Math.round(oLo)}–${Math.round(oHi)}`, toValue: (_, y) => clamp(unsq(posOf(y)), oLo + 5, 100) },
      { key: 'orgasmLo', label: 'Orgasm band, deep end', shape: 'hpill', axis: 'y', x: xOf(0.93), y: yOf(sq(oLo)), value: oLo, min: 0, max: 95, step: 1,
        color: kindOf('orgasm').css, text: '', toValue: (_, y) => clamp(unsq(posOf(y)), 0, oHi - 5) },
      { key: 'offset', label: 'Depth offset: every act band up or down', shape: 'dot', axis: 'y',
        x: xRun(0.5), y: yOf(sq(mid(P.offset || 0))), value: P.offset || 0, min: -40, max: 40, step: 1,
        text: P.offset ? `offset ${signed(P.offset)}` : '', toValue: (_, y) => clamp(Math.round(unsq(posOf(y)) - mid(0)), -40, 40) },
      ...(machine ? [{ key: 'floor', label: 'Floor: the machine never goes deeper', shape: 'hpill', axis: 'y', x: xRun(0.15), y: yOf(F),
        value: P.floor, min: 0, max: 60, step: 1, text: `floor ${Math.round(F)}`, toValue: (_, y) => clamp(posOf(y), 0, 60) }] : []),
    ],
  };
}

// ---- the knobs strip: one track per scalar, a pill on each ----
export const KW = 300, KH = 148;
const KY = (i) => 20 + i * 24;   // track i's y (a label sits above its pill)
const KNOBS = [
  { key: 'strength', min: 0, max: 1, step: 0.05, label: 'Pass strength toward the bands (0: the points as they are)', text: (v) => `strength ${Math.round(v * 100)} %` },
  { key: 'keep', min: 0, max: 1, step: 0.05, label: 'Keep tracked depth (0: always stretch to the band)', text: (v) => `keep depth ${Math.round(v * 100)} %` },
  { key: 'width', min: 0.5, max: 1.2, step: 0.05, label: 'Band width, scaled from the deep end', text: (v) => `band ×${v.toFixed(2)}` },
  { key: 'ease', min: 0, max: 2, step: 0.25, label: 'Ease between runs, in strokes (0: a cut)', text: (v) => (v ? `ease ${+v.toFixed(2)} stroke${v === 1 ? '' : 's'}` : 'no ease between runs') },
  { key: 'teaseShare', min: 0.1, max: 0.4, step: 0.05, label: 'Tease reach, share of the band from the top', text: (v) => `tease top ${Math.round(v * 100)} %` },
  { key: 'teasePeriod', min: 1500, max: 5000, step: 250, label: 'Tease pace: one tease stroke every … (the dead-gap fill)', text: (v) => `tease ${(v / 1000).toFixed(1)} s / stroke` },
];
/** -> {lines, handles} for the knobs strip: pass strength, keep tracked depth, width, ease between runs, tease reach and
 *  pace (vpills on faint tracks:
 *  'ghost' lines, so the labels may sit over them). */
export function knobsModel(policy) {
  const P = { ...POLICY, ...policy }, x0 = PAD, x1 = KW - PAD - 60;   // the right end keeps room for the labels
  return {
    lines: KNOBS.map((_, i) => ({ pts: [[x0, KY(i)], [x1, KY(i)]], kind: 'ghost' })),
    handles: KNOBS.map((k, i) => {
      const v = clamp(P[k.key] ?? POLICY[k.key], k.min, k.max);
      return { key: k.key, label: k.label, shape: 'vpill', axis: 'x', x: x0 + ((v - k.min) / (k.max - k.min)) * (x1 - x0), y: KY(i),
        value: v, min: k.min, max: k.max, step: k.step, text: k.text(v), toValue: (x) => clamp(k.min + ((x - x0) / (x1 - x0)) * (k.max - k.min), k.min, k.max) };
    }),
  };
}

// ---- the band envelope on the canvas (lib/autorange-env.js): outlines, handles, hit test ----
export const PADY = 8, CORNER_PX = 7, KEY_PX = 6, EDGE_PX = 5, SIDE_PX = 5;
const msX = (v, w, t) => ((t - v.start) / v.span) * w;
/** pos -> y in a lane of height h (top = 100 = out). */
export const yOfPos = (h, pos) => PADY + (1 - pos / 100) * (h - 2 * PADY);
export const posOfY = (h, y) => 100 * (1 - (y - PADY) / Math.max(1, h - 2 * PADY));
/** The times to sample a piece's outline at: its ends, its keys (and a few steps on eased segments), the shot
 *  boundaries inside it (the auto band bends there). */
export function sampleTimes(env, p) {
  const ts = new Set([p.t0, p.t1]), k = env.keysIn(p);
  for (const edge of ['hi', 'lo']) {
    const pts = [p.t0, ...k[edge].map((e) => e.t), p.t1];
    k[edge].forEach((e, j) => {
      ts.add(e.t);
      const nx = pts[j + 2];
      if (e.ease === 'smooth') for (let s = 1; s < 8; s++) ts.add(Math.round(e.t + ((nx - e.t) * s) / 8));
      if (e.ease === 'hold') ts.add(nx - 1);
    });
  }
  for (const r of p.rows) for (const t of [r.t0, r.t1]) if (t > p.t0 && t < p.t1) ts.add(t);
  return [...ts].filter((t) => t >= p.t0 && t <= p.t1).sort((a, b) => a - b);
}
/** Outline of a piece: [{t, lo, hi}] (with keys). */
export const outlineOf = (env, p) => sampleTimes(env, p).map((t) => { const b = env.edgeAt(t, p) ?? [0, 100]; return { t, lo: b[0], hi: b[1] }; });
/**
 * What is under (x, y) in a lane w x h showing view: {piece, part, key?} | null. part: a corner 'hi0' | 'lo0' | 'hi1' |
 * 'lo1' (generous boxes), 'key' (an edge handle; key = {edge, t, d}), a side 't0' | 't1', an edge 'hi' | 'lo', 'body'.
 */
export function hitBand(env, view, w, h, x, y) {
  const t = view.start + (x / w) * view.span, p = env.pieces.find((q) => t >= q.t0 - (SIDE_PX * view.span) / w && t <= q.t1 + (SIDE_PX * view.span) / w && !(t > q.t1 && env.pieces.some((r) => r !== q && t >= r.t0 && t <= r.t1)));
  if (!p) return null;
  const x0 = msX(view, w, p.t0), x1 = msX(view, w, p.t1), b0 = env.edgeAt(p.t0, p), b1 = env.edgeAt(p.t1, p);
  const near = (cx, cy, r) => Math.abs(x - cx) <= r && Math.abs(y - cy) <= r;
  for (const [part, cx, pos] of [['hi0', x0, b0[1]], ['lo0', x0, b0[0]], ['hi1', x1, b1[1]], ['lo1', x1, b1[0]]]) if (near(cx, yOfPos(h, pos), CORNER_PX)) return { piece: p, part };
  const k = env.keysIn(p);
  for (const edge of ['hi', 'lo']) for (const key of k[edge]) { const b = env.edgeAt(key.t, p); if (near(msX(view, w, key.t), yOfPos(h, edge === 'hi' ? b[1] : b[0]), KEY_PX)) return { piece: p, part: 'key', key }; }
  const b = env.edgeAt(clamp(t, p.t0, p.t1), p), yh = yOfPos(h, b[1]), yl = yOfPos(h, b[0]);
  if (y > yh - EDGE_PX && y < yl + EDGE_PX) { if (Math.abs(x - x0) <= SIDE_PX) return { piece: p, part: 't0' }; if (Math.abs(x - x1) <= SIDE_PX) return { piece: p, part: 't1' }; }
  if (Math.abs(y - yh) <= EDGE_PX) return { piece: p, part: 'hi' };
  if (Math.abs(y - yl) <= EDGE_PX) return { piece: p, part: 'lo' };
  if (y > yh && y < yl) return { piece: p, part: 'body' };
  return null;
}
/** The two keys of edge around t inside p (the segment a drag on the edge moves), or null when t is not between two. */
export function segmentKeys(env, p, edge, t) {
  const ks = env.keysIn(p)[edge];
  for (let j = 0; j + 1 < ks.length; j++) if (t > ks[j].t && t < ks[j + 1].t) return [ks[j], ks[j + 1]];
  return null;
}
/** Levels a dragged corner may snap to: the touching corners of the neighbour pieces (both edges). */
export function neighbourLevels(env, p, side) {
  const q = env.pieces.find((r) => r !== p && (side === 't0' ? Math.abs(r.t1 - p.t0) <= 2 : Math.abs(r.t0 - p.t1) <= 2));
  if (!q) return [];
  const b = env.edgeAt(side === 't0' ? q.t1 : q.t0, q);
  return b ? [b[0], b[1]] : [];
}
