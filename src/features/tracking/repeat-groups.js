// repeat-groups.js -- painted seeding groups and repeated frames (paw-8yip), pure. A frame that repeats exactly elsewhere
// (timeline/repeats.js) shows the same pixels there, so the groups painted on it fit the repeat unchanged.
// Groups are consumed per take (groups.js: a take's groups sit on one frame, t_ms, and the tracker seeds the take there),
// so a copy goes to the takes that contain a repeat and have no groups of their own: one copy per take, on its first
// repeat. A take that already has groups is never overwritten (it is counted as skipped).
// paw-8mf4: a take without groups is filled from a matching frame elsewhere (findFill): painted groups copied as they are,
// or a stored run's seeded points rebuilt as groups that seed exactly those points (seedGroups, PROTOCOL v4.21). Copies
// carry source 'repeat' / 'run' and `from` (groups.js isCopy): never extra training examples of the same picture.
import { takeGroups, setTakeGroups, isSuggested, newMask, stroke, fitPoly, encodeMask, splitName } from './groups.js';
import { takeRange } from '../timeline/shots.js';
import { sceneIndexAt } from '../timeline/scenes.js';
import { occurrenceAt } from '../timeline/repeats.js';
import { frameAt, frameLen } from '../../lib/lane.js';
import { overlayIndex, sceneAt } from '../../lib/runs.js';
import { sceneGroups } from '../../lib/runs-channel.js';
import { seedIds, ownsAt } from '../../lib/runs-add.js';

const takeOf = (scenes, i) => takeRange(scenes, i)?.[0] ?? -1;   // a take by its first shot
/** Frame time -> a group's t_ms inside that frame (the sidecar takes the frame at or before a time). */
export const stampIn = (t) => Math.ceil(t - 1e-6);
/** The repeat occurrence (repeats.js) of the frame at time t, or null. frameMs here and below: the frame grid (lane.js: the
 *  player's clock, the repeats index is on its frames; paw-kxz4: n x frameMs put a run's frame 2-3 pictures off on a file whose
 *  frames are not at n x 1000 / fps). */
export const occurrenceAtTime = (ix, t, frameMs) => (ix && frameLen(frameMs) ? occurrenceAt(ix, frameAt(t, frameMs)) : null);

/** Where groups painted on a frame of shot i can be copied: its bucket's other occurrences `occ` ([{t}]) -> {targets:
 *  [{shot, t}] one per other take without groups (its first repeat), skipped: [{shot, t}] takes with groups}. */
export function repeatTargets(scenes, i, occ) {
  const seen = new Set([takeOf(scenes, i)]), targets = [], skipped = [];
  for (const o of occ) {
    const j = sceneIndexAt(scenes, stampIn(o.t));
    if (j < 0) continue;
    const k = takeOf(scenes, j);
    if (seen.has(k)) continue;
    seen.add(k);
    (takeGroups(scenes, j).length ? skipped : targets).push({ shot: j, t: o.t });
  }
  return { targets, skipped };
}

/** Scene list with `groups` copied onto every target's take, re-stamped onto its repeat frame (outlines, masks, names
 *  and assignments unchanged: the same pixels). The copies are source 'repeat' (a run-derived one stays 'run', a
 *  suggestion keeps its own source) with `from` = the painted frame: the seeder trains on the painted original only. */
export const asCopies = (groups, t) => groups.map((g) => ({ ...g, t_ms: t, source: isSuggested(g) ? g.source : g.source === 'run' ? 'run' : 'repeat', from: g.from ?? g.t_ms }));
export function copyGroupsTo(scenes, groups, targets) {
  let list = scenes;
  for (const { shot, t } of targets) list = setTakeGroups(list, shot, asCopies(groups, stampIn(t)));
  return list;
}

/** Seed-frame priority (Suggest's v4.18 candidates, PROTOCOL v4.20 candidate_bonus): a frame that repeats elsewhere is
 *  worth more (its groups go to every repeat), the owner's loop frame most. Adds up to 2 frames of the take's first
 *  `span` ms (its first candidate on) that repeat: a picked loop frame first, then the most repeated picture; and weighs
 *  every candidate: min(1.5, 0.5 log2 repeats), + 2 on a picked loop frame (the parts count stays the main criterion:
 *  a frame showing two more parts still wins). `chosen`: bucket ids the owner picked as loop frames.
 *  -> {candidates, bonus: [per candidate], why: {[t]: {repeats, loop}}} (unchanged candidates, bonus [] when nothing repeats). */
export function repeatCandidates(ix, candidates, frameMs, chosen = new Set(), span = 2000, best = null) {
  if (!ix || !candidates.length || !frameLen(frameMs)) return { candidates, bonus: [], why: {} };
  const a = Math.min(...candidates), frame = (t) => frameAt(t, frameMs);
  const have = new Set(candidates.map(frame)), extra = [];
  // paw-8mf4: the take's best frame to paint (bestPaintFrame, anywhere in it) is a candidate too, worth the empty takes
  // its repeats would fill: + min(1.5, 0.5 covers)
  const bt = best && best.covers > 0 && !have.has(frame(best.t)) ? best.t : null;
  const win = (ix.occ || []).filter((o) => o.t >= a - frameLen(frameMs) / 2 && o.t < a + span && !have.has(o.f0));
  const n = (id) => ix.buckets[id].occ.length;
  for (const o of [...win.filter((o) => chosen.has(o.id)), ...[...win].sort((x, y) => n(y.id) - n(x.id))]) {
    if (extra.length >= 2) break;
    if (!extra.some((e) => e.id === o.id)) extra.push(o);
  }
  const out = [...candidates, ...extra.map((o) => stampIn(o.t)).filter((t) => bt == null || frame(t) !== frame(bt)), ...(bt != null ? [bt] : [])], why = {};
  const bonus = out.map((t) => {
    const o = occurrenceAtTime(ix, t, frameMs);
    if (!o) return 0;
    const k = n(o.id), loop = chosen.has(o.id), covers = best && frame(best.t) === frame(t) ? best.covers : 0;
    why[t] = { repeats: k, loop, ...(covers ? { covers } : {}) };
    return Math.round((Math.min(1.5, 0.5 * Math.log2(k)) + (loop ? 2 : 0) + Math.min(1.5, 0.5 * covers)) * 100) / 100;
  });
  return bonus.some((b) => b > 0) ? { candidates: out, bonus, why } : { candidates, bonus: [], why: {} };
}

// ---- filling an empty take from a matching frame (paw-8mf4) ----
/** [t0, t1) of the take shot i is in. */
const takeSpan = (scenes, i) => { const r = takeRange(scenes, i); return r ? [scenes[r[0]].start_ms, scenes[r[1]].end_ms] : null; };
/** [t0, t1) of shot i itself: a take of several shots (camera moves) is filled / painted from the selected shot's frames (paw-do8a). */
const shotSpan = (scenes, i) => (scenes?.[i] ? [scenes[i].start_ms, scenes[i].end_ms] : null);
/** A take's key (its first shot's start, ms): what the project remembers per take. */
export const takeKey = (scenes, i) => { const r = takeRange(scenes, i); return r ? Math.round(scenes[r[0]].start_ms) : null; };
/** Frame time t as a group stamp inside [t0, t1) (stampIn, never past the take's ends). */
const stampInside = (t, sp) => Math.min(Math.ceil(sp[1]) - 1, Math.max(Math.ceil(sp[0]), stampIn(t)));
/** The occurrences starting inside [t0, t1), by bucket id (time order). */
function occIn(ix, t0, t1) {
  const m = new Map();
  for (const o of ix?.occ || []) if (o.t >= t0 && o.t < t1) { if (!m.has(o.id)) m.set(o.id, []); m.get(o.id).push(o); }
  return m;
}

/** A stored run's seeded points of the owner's painted groups on its frame at t (within 1.5 frames): {name: [[x, y], ...]},
 *  visible points only (pts[2]; occluded / lost ones left out), named by pts[5] through scenes[].groups.sem_<name> with
 *  source 'user' (PROTOCOL v4.11); the tagger's pinned groups never. null without a frame there. */
export function runSeeds(run, t, frameMs) {
  const i = overlayIndex(run?.frames, t, 1.5 * (frameLen(frameMs) || 1000 / 30)), pts = i >= 0 ? run.frames.ov[i]?.pts : null;
  if (!pts?.length) return null;
  const names = {};
  for (const [key, r] of Object.entries(sceneGroups(run, sceneAt(run.scenes || [], t)))) if (key.startsWith('sem_') && r?.source === 'user' && Number.isInteger(r.id)) names[r.id] = key.slice(4);
  const out = {};
  const own = new Set(Object.values(names));
  for (const [id, l] of seedIds(run)) if (!names[id] && own.has(l[0].name)) names[id] = l[0].name;   // paw-o74b.1: a part's other seeds (their own ids)
  const tt = run.frames.t[i];
  for (const q of pts) { const n = names[q[5]]; if (n && q[2] > 0 && ownsAt(run, q[5], tt)) (out[n] ||= []).push([q[0], q[1]]); }   // a seed's points where it owns the frames
  return out;
}

/** What fills take i: every frame of shot i (the selected one, of a take of several) that is an exact repeat of (1) a frame another take's groups are painted on, or
 *  (2) a frame inside a stored run (runs: makeRun records with frames) of another take that seeded the owner's groups
 *  (runSeeds, groups with >= 3 visible points). Best first: the owner's picked loop frame (chosen: bucket ids), then the
 *  match nearest the take's start, then painted over a run, then the most parts. -> {kind: 'repeat' | 'run', t (the
 *  matching frame here: the take's seed frame), from (the source frame), id (bucket), loop, parts, groups (repeat) |
 *  seeds {name: points} (run), shot | run (the source)} or null. */
export function findFill(scenes, i, ix, frameMs, { runs = [], chosen = new Set() } = {}) {
  const sp = shotSpan(scenes, i), tk = takeSpan(scenes, i);
  if (!sp || !ix || !frameLen(frameMs)) return null;
  const own = takeOf(scenes, i), mine = occIn(ix, sp[0], sp[1]), out = [];
  if (!mine.size) return null;
  const add = (id, c) => { for (const o of mine.get(id) || []) out.push({ ...c, t: stampInside(o.t, sp), id, loop: chosen.has(id) }); };
  for (let j = 0; j < (scenes?.length || 0); j++) {
    if (takeOf(scenes, j) !== j || j === own) continue;
    const gs = takeGroups(scenes, j), g = gs.find((x) => Number.isFinite(x.t_ms)), o = g && occurrenceAtTime(ix, g.t_ms, frameMs);
    if (o) add(o.id, { kind: 'repeat', shot: j, from: g.t_ms, groups: gs, parts: gs.length });
  }
  for (const r of runs || []) {
    if (r.restored || r.tag || !r.frames?.t?.length) continue;
    const seen = new Set();
    for (const t of r.frames.t) {
      if (t >= tk[0] && t < tk[1]) continue;   // this take's own run
      const o = occurrenceAtTime(ix, t, frameMs);
      if (!o || seen.has(o.id) || !mine.has(o.id)) continue;
      const parts = Object.entries(runSeeds(r, t, frameMs) || {}).filter(([, p]) => p.length >= 3);
      if (!parts.length) continue;
      seen.add(o.id);
      add(o.id, { kind: 'run', run: r.id, from: Math.round(t), seeds: Object.fromEntries(parts), parts: parts.length });
    }
  }
  out.sort((a, b) => b.loop - a.loop || a.t - b.t || (a.kind === 'repeat' ? 0 : 1) - (b.kind === 'repeat' ? 0 : 1) || b.parts - a.parts);
  return out[0] || null;
}

/** A run's seed points -> groups on frame t (source 'run', from, points: what Track seeds, PROTOCOL v4.21); mask = discs
 *  around the points (radius 0.6 x their median nearest-neighbour spacing, 1.5 px .. 4 % of the height) and poly its
 *  outline: their footprint for drawing and editing (a convex hull would swallow the background between parts), never
 *  a reshaped outline. size = the masks' size (groups.js maskSize). */
export function seedGroups(seeds, t, from, size) {
  const out = [], r4 = (x) => Math.round(x * 1e4) / 1e4;
  for (const [name, pts] of Object.entries(seeds || {})) {
    const m = newMask(size), P = pts.map(([x, y]) => [x * m.w, y * m.h]);
    const nn = P.map((p, k) => Math.min(...P.map((q, j) => (j === k ? Infinity : Math.hypot(p[0] - q[0], p[1] - q[1]))))).sort((a, b) => a - b);
    const rad = Math.min(0.04 * m.h, Math.max(1.5, 0.6 * (nn[nn.length >> 1] || 0)));
    for (const p of P) stroke(m, p, p, rad);
    const { poly } = fitPoly(m);
    if (!poly) continue;
    const q = splitName(name);
    out.push({ name, poly, pinned: true, t_ms: t, source: 'run', from, points: pts.map(([x, y]) => [r4(x), r4(y)]), mask: encodeMask(m),
      ...(q.who ? { who: q.who, part: q.part, ...(q.side ? { side: q.side } : {}) } : {}) });
  }
  return out;
}

/** Scene list with take i filled from findFill's f (one copy on the matching frame); size: seedGroups' mask size. */
export function fillTake(scenes, i, f, size) {
  return setTakeGroups(scenes, i, f.kind === 'run' ? seedGroups(f.seeds, f.t, f.from, size) : asCopies(f.groups, f.t));
}

/** The best frame of take i to paint on (paw-8mf4), from shot i's own frames (paw-do8a): those that repeat elsewhere, ranked by the other takes without
 *  groups their repeats reach (each fills from it), then the owner's picked loop frame (chosen), then how often the
 *  picture repeats, then the earliest. -> {t (a stamp inside the take), id, covers, repeats, loop} or null (no frame of
 *  the take repeats: the old seed-frame behaviour). win: {a, b} (seed-window.js): only frames in it (after a fade in, past a
 *  lead-in). */
export function bestPaintFrame(scenes, i, ix, chosen = new Set(), win = null) {
  let sp = shotSpan(scenes, i);
  if (sp && win) sp = [Math.max(sp[0], win.a), Math.min(sp[1], win.b)];   // paw-ef73.9: the take's seed window (lib/seed-window.js)
  if (!sp || !ix || !(sp[1] > sp[0])) return null;
  const own = takeOf(scenes, i);
  let best = null;
  for (const [id, occ] of occIn(ix, sp[0], sp[1])) {
    const takes = new Set();
    for (const o of ix.buckets[id].occ) {
      const j = sceneIndexAt(scenes, stampIn(o.t)), k = j >= 0 ? takeOf(scenes, j) : -1;
      if (k >= 0 && k !== own && !takeGroups(scenes, j).length) takes.add(k);
    }
    const c = { t: occ[0].t, id, covers: takes.size, repeats: ix.buckets[id].occ.length, loop: chosen.has(id) };
    if (!best || (c.covers - best.covers || c.loop - best.loop || c.repeats - best.repeats) > 0) best = c;   // ties: the earlier
  }
  return best && { ...best, t: stampInside(best.t, sp) };
}
