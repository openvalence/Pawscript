// loop-marks.js -- a loop as ONE thing on the timeline (paw-llaa), pure. Owner: "each loop gets a tint, so the entire section
// with the orange frames is tinted, and there's only the orange, and you can drag the orange frame anywhere within one loop,
// to pick the preferred frame ... matching frames across scenes or the whole script become a caret ... if a loop in one
// scene/cut is found elsewhere, those shots are linked ... we merge the loops at the bottom into the shots, they get the
// solid then dashed for every repeat".
//   colours      one colour per loop footage (repeats.js families): a fixed colour-blind-safe palette (Okabe-Ito order),
//                the video's loop footages in time order take it in turn, so neighbours differ; the same footage shares it
//   passes       a Loops-row loop {t0, t1, tiledTo?, auto?} as passes on the frames: the cycle, then its repeats
//   pick         the preferred frame: frames into the cycle (loop.pick), the same phase in every pass; not its start or end
//   carets       the repeated pictures outside every loop: runs of consecutive frames, one caret each
//   spans        where a set of pictures plays (merged frame runs): what a click on a caret / a loop highlights
//   links        shots holding the same loop footage (reused footage): the chain on their labels
//   sameTimes    every occurrence of the picture at t (else the same phase of the loop at t): seek through them
//   band         the merged drawing on the Shots strip: the first pass solid, one dash-box per repeat, tint only zoomed out
//   splitAt      an automatic loop over a cut becomes one per shot (a cut added or moved inside it)
// grid everywhere = lane.js gridOf (the player's clock, else a frame length); times ms, frames the clock's.
import { frameAt, frameTime, frameLen, msToX } from '../../lib/lane.js';
import { loopInfo, periodOf, isTiled, toFrame } from './loops.js';
import { occurrencesOf, occurrenceAt, familyOf, familyMembers } from './repeats.js';

// ---- colours ----
/** Okabe-Ito (colour-blind safe as a set); consecutive entries are safe pairs side by side. Dark ground, light ground. */
export const LOOP_PALETTE = {
  dark: ['#E69F00', '#56B4E9', '#F0E442', '#CC79A7', '#2FC79A', '#F07A3A', '#6E9CFF'],
  light: ['#B07800', '#1F7FB8', '#8C8000', '#A8528A', '#007A5A', '#C24E00', '#2F5FC8'],
};
/** An automatic loop as the timeline marked it (moved, resized or tiled = the owner's). = repeat-offers isAutoLoop */
export const isAuto = (l) => !!l?.auto && l.t0 === l.auto.t0 && l.t1 === l.auto.t1 && !(l.tiledTo > l.t1);
/** Where a loop's passes end: its tiles, an automatic loop's last pass, else its cycle. */
export const loopEnd = (l) => (isTiled(l) ? l.tiledTo : isAuto(l) ? l.auto.end : l.t1);

/** Colour index per loop. loops: [{id, t0, group}] (group: footage family key, -1 = none); families: every family key of
 *  the video in time order (repeats: its loops' order), so a footage keeps its colour whatever loops are marked. A loop
 *  with no footage takes the next free entry after its neighbour. Neighbours in time (different footage) never share one.
 *  -> Map id -> index into LOOP_PALETTE. */
export function loopColorIndex(loops = [], families = []) {
  const N = LOOP_PALETTE.dark.length, rank = new Map(), byGroup = new Map(), out = new Map();
  families.forEach((k) => { if (!rank.has(k)) rank.set(k, rank.size); });
  let prev = null;
  for (const l of [...loops].sort((a, b) => a.t0 - b.t0)) {
    let c = l.group >= 0 ? byGroup.get(l.group) ?? (rank.has(l.group) ? rank.get(l.group) % N : (rank.size + byGroup.size) % N) : prev ? (prev.c + 1) % N : 0;
    if (prev && prev.group !== l.group && prev.c === c && !(l.group >= 0 && byGroup.has(l.group))) c = (c + 1) % N;
    if (l.group >= 0 && !byGroup.has(l.group)) byGroup.set(l.group, c);
    out.set(l.id, c);
    prev = { group: l.group, c };
  }
  return out;
}

// ---- passes and the preferred frame ----
/** Loop l's passes: {f0 (its first frame), pf (frames per pass; 0 when its cycle is not a whole number of frames), P (ms),
 *  n (passes; a partial last tile counts), end (ms), start(k) (pass k's first frame start, ms)}. */
export function passGeom(l, grid) {
  const info = loopInfo(l, grid), P = periodOf(l, grid), end = loopEnd(l), fm = frameLen(grid);
  const f0 = fm ? frameAt(l.t0, grid) : 0, pf = info.exact ? info.frames : 0;
  const n = isAuto(l) ? Math.max(1, l.auto.n | 0) : isTiled(l) && P > 0 ? Math.max(1, Math.ceil((end - l.t0) / P - 1e-6)) : 1;
  const start = (k) => (pf ? frameTime(f0 + k * pf, grid) : Math.round(l.t0 + k * P));
  return { f0, pf, P, n, end, start, frames: pf || Math.max(1, Math.round(P / (fm || 1000 / 30))) };
}
/** The pass of loop l (passGeom g) that time t is in, 0..n-1 (by frames when the cycle is a whole number of them). */
export function passAt(l, g, t, grid) {
  const k = g.pf ? Math.floor((frameAt(t, grid) - g.f0) / g.pf) : Math.floor((t - l.t0) / g.P);
  return Math.max(0, Math.min(g.n - 1, k));
}
/** g with its end pulled in to where the loop's pictures stop (ends: the end of the last held run of its footage's pictures
 *  inside it, or the next loop's start): an automatic loop counts a last pass that a cut or the next loop stops half-way
 *  as whole. Never later than g.end. -> g itself when nothing moved. */
export function clampEnd(g, l, stop) {
  const e = Math.max(g.start(1) > l.t0 ? Math.min(g.start(1), g.end) : g.end, Math.min(g.end, stop));
  return e < g.end ? { ...g, end: e } : g;
}
/** Passes of g as a number to read: whole, or one decimal for a part pass (28.5). */
export const passesText = (g) => { const n = Math.round(((g.end - g.start(0)) / g.P) * 10) / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1); };
/** The preferred frame: frames into the cycle, 0 <= pick < frames; `fallback` (a pick saved before paw-llaa) else 0. */
export function pickOf(l, g, fallback = 0) {
  const ok = (p) => Number.isInteger(p) && p >= 0 && p < g.frames;
  return ok(l?.pick) ? l.pick : ok(fallback) ? fallback : 0;
}
/** The preferred frame of pass k, ms (a frame start). */
export function pickTime(l, g, k, pick, grid) {
  if (g.pf) return frameTime(g.f0 + k * g.pf + pick, grid);
  const fm = frameLen(grid) || 1000 / 30;
  return toFrame(l.t0 + k * g.P + pick * fm, grid);
}
/** Every pass's preferred frame inside the loop: [{t, k}]. */
export function pickTicks(l, g, pick, grid) {
  const out = [];
  for (let k = 0; k < g.n; k++) { const t = pickTime(l, g, k, pick, grid); if (t >= g.end) break; out.push({ t, k }); }
  return out;
}
/** Dragging pass k's tick to time t: the frame of that pass under t, clamped to the cycle (it does not wrap). */
export function pickFromTime(l, g, k, t, grid) {
  const p = g.pf ? frameAt(t, grid) - (g.f0 + k * g.pf) : Math.round((t - (l.t0 + k * g.P)) / (frameLen(grid) || 1000 / 30));
  return Math.max(0, Math.min(g.frames - 1, p));
}
/** The pick one frame on (dir +-1), wrapping inside the cycle (the nudge keys). */
export const pickStep = (g, pick, dir) => (((pick + dir) % g.frames) + g.frames) % g.frames;
/** The pick in loop l that shows bucket `id` (its first occurrence in l's first pass), or -1. */
export function pickOfPicture(ix, l, g, id, grid) {
  const a = l.t0, b = g.start(1);
  const o = occurrencesOf(ix, id).find((x) => x.t >= a - 0.5 && x.t < b - 0.5);
  return o ? (g.pf ? o.f0 - g.f0 : pickFromTime(l, g, 0, o.t, grid)) : -1;
}

// ---- matches: carets, spans, links ----
const inSpans = (spans, t) => spans.some((s) => t >= s.t0 && t < s.t1);
/** Runs of repeated pictures outside the loops (spans [{t0, t1}]): consecutive frames (a frame of gap allowed) whose
 *  picture repeats elsewhere, one run each. -> [{t (its first frame), t1 (end), ids: [bucket ids], fam: the loop family
 *  of its pictures or -1}]. runEnd(o) -> where occurrence o's held run ends (ms). */
export function caretRuns(ix, spans = [], runEnd) {
  const out = [];
  let cur = null;
  for (const o of ix?.occ || []) {
    if (inSpans(spans, o.t)) { cur = null; continue; }
    if (cur && o.f0 <= cur.f1 + 2) { cur.f1 = Math.max(cur.f1, o.f1); cur.t1 = Math.max(cur.t1, runEnd(o)); cur.ids.add(o.id); continue; }
    cur = { t: o.t, t1: runEnd(o), f1: o.f1, ids: new Set([o.id]) };
    out.push(cur);
  }
  return out.map((r) => {
    let fam = -1;
    for (const id of r.ids) { const f = familyOf(ix, id); if (f >= 0) { fam = f; break; } }
    return { t: r.t, t1: r.t1, ids: [...r.ids], fam };
  });
}
/** Where pictures `ids` play: their occurrences as time spans, neighbours within a frame merged. -> [{t0, t1}]. */
export function spansOf(ix, ids, runEnd) {
  const all = [...new Set(ids)].flatMap((id) => occurrencesOf(ix, id)).sort((a, b) => a.t - b.t), out = [];
  for (const o of all) {
    const e = runEnd(o), last = out.at(-1);
    if (last && o.t <= last.t1 + 1) last.t1 = Math.max(last.t1, e); else out.push({ t0: o.t, t1: e });
  }
  return out;
}
/** A family's pictures (repeats.js familyMembers). */
export const picturesOfFamily = familyMembers;

/** Linked shots: per loop family on the timeline (fams), the shots where >= min(3, its pictures) of its pictures start
 *  (pics: repeat-scenes.js shotPictures, a Set per shot). -> Map shot index -> {fams: [family keys], others: [shot indices]}
 *  for every shot sharing a family with another. */
export function linkedShots(ix, pics = [], fams = []) {
  const out = new Map();
  for (const f of new Set(fams)) {
    if (!(f >= 0)) continue;
    const m = familyMembers(ix, f), need = Math.min(3, m.length);
    if (!need) continue;
    const shots = [];
    pics.forEach((P, i) => { let n = 0; for (const id of m) if (P.has(id) && ++n >= need) break; if (n >= need) shots.push(i); });
    if (shots.length < 2) continue;
    for (const i of shots) {
      const e = out.get(i) ?? { fams: [], others: [] };
      e.fams.push(f);
      for (const j of shots) if (j !== i && !e.others.includes(j)) e.others.push(j);
      out.set(i, e);
    }
  }
  for (const e of out.values()) e.others.sort((a, b) => a - b);
  return out;
}

// ---- seeking through the same picture ----
/** The times to step through from t: every occurrence of the picture shown at frame frameAt(t) (repeats), else, inside a
 *  loop, its passes at the phase of t. -> {times: [ms] ascending, id (bucket | -1), loop (id | null)}. */
export function sameTimes(ix, t, grid, loops = []) {
  const f = frameLen(grid) ? frameAt(t, grid) : 0, o = ix ? occurrenceAt(ix, f) : null;
  if (o) return { times: occurrencesOf(ix, o.id).map((x) => x.t), id: o.id, loop: null };
  const l = loops.find((x) => t >= x.t0 && t < loopEnd(x));
  if (!l) return { times: [], id: -1, loop: null };
  const g = passGeom(l, grid), pick = pickFromTime(l, g, passAt(l, g, t, grid), t, grid);
  return { times: pickTicks(l, g, pick, grid).map((x) => x.t), id: -1, loop: l.id };
}
/** The next (dir 1) / previous (-1) time after / before now (half a frame of slack), wrapping. -> {t, i, n} | null. */
export function stepTimes(times, now, dir, slack = 1) {
  const n = times.length;
  if (!n) return null;
  let i = dir > 0 ? times.findIndex((t) => t > now + slack) : times.findLastIndex((t) => t < now - slack);
  if (i < 0) i = dir > 0 ? 0 : n - 1;
  return { t: times[i], i, n };
}
/** "3 of 29 in shot 21.1 · +12 in 2 other shots": where time t sits among times, counted per shot (shotOf(t) -> index, label(i)). */
export function seekWords(times, t, shotOf, label) {
  const here = shotOf(t), mine = times.filter((x) => shotOf(x) === here), rest = times.filter((x) => shotOf(x) !== here);
  const others = new Set(rest.map(shotOf)), i = mine.findIndex((x) => Math.abs(x - t) < 1) + 1;
  const where = here >= 0 ? ` in shot ${label(here)}` : '';
  return `${i || '?'} of ${mine.length}${where}` + (rest.length ? ` · +${rest.length} in ${others.size} other shot${others.size === 1 ? '' : 's'}` : '');
}

// ---- the merged drawing on the Shots strip ----
/** Loop l drawn over [view] at w px: {x0, x1 (its cycle), xe (its end), passes: [{x0, x1, k}] for k >= 1, or null when a
 *  pass is narrower than minPx (the repeats then a tint only)}. */
export function loopBand(l, g, view, w, minPx = 3) {
  const X = (t) => msToX(view, w, t), x0 = X(l.t0), x1 = X(Math.min(g.end, g.start(1))), xe = X(g.end);
  const pw = (g.P / view.span) * w;
  if (pw < minPx) return { x0, x1, xe, passes: null };
  const passes = [];
  const k0 = Math.max(1, Math.floor((view.start - l.t0) / g.P)), tEnd = Math.min(g.end, view.start + view.span + g.P);
  for (let k = k0; k < g.n; k++) {
    const a = g.start(k);
    if (a >= tEnd) break;
    passes.push({ x0: X(a), x1: X(Math.min(g.end, g.start(k + 1))), k });
  }
  return { x0, x1, xe, passes };
}

// ---- a cut inside an automatic loop ----
/** Automatic loops (isAuto) over a cut become one per side: the whole passes before it, the whole passes after it (the
 *  same phase, so the same pick), each kept with >= minPasses passes. The owner's loops are left alone. -> the same array
 *  when nothing changed. */
export function splitAt(loops = [], cuts = [], grid = 0, minPasses = 2) {
  let changed = false, out = loops;
  for (let guard = 0; guard < 64; guard++) {
    let hit = null;
    for (const l of out) {
      if (!isAuto(l)) continue;
      const c = cuts.find((x) => x > l.t0 + 0.5 && x < l.auto.end - 0.5);
      if (c != null) { hit = { l, c }; break; }
    }
    if (!hit) break;
    changed = true;
    const { l, c } = hit, g = passGeom(l, grid), parts = [];
    let n1 = 0;
    while (n1 < g.n && g.start(n1 + 1) <= c + 0.5) n1++;
    if (n1 >= minPasses) parts.push({ ...l, auto: { ...l.auto, end: g.start(n1), n: n1 } });
    let k2 = n1;
    while (k2 < g.n && g.start(k2) < c - 0.5) k2++;
    const n2 = g.n - k2;
    if (n2 >= minPasses) {
      const t0 = g.start(k2), t1 = g.start(k2 + 1), m = /^(\d+):(\d+)$/.exec(String(l.auto.key));
      // the key names it in doc.repeats.off: a repeats loop '<loop key>:<pass>', the search's 'search:<shot start>' (the new shot's)
      const key = m ? `${m[1]}:${+m[2] + k2}` : String(l.auto.key).startsWith('search:') ? `search:${Math.round(c)}` : `${l.auto.key}@${t0}`;
      parts.push({ ...l, id: `${l.id}s${k2}`, t0, t1, auto: { ...l.auto, key, t0, t1, end: l.auto.end, n: n2 } });
    }
    out = out.flatMap((x) => (x === l ? parts : [x]));
  }
  return changed ? out.sort((a, b) => a.t0 - b.t0) : loops;
}
