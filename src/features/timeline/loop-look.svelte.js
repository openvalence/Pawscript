// loop-look.svelte.js -- the loops as the timeline shows them (paw-llaa; the pure rules: loop-marks.js), for the ruler, the
// Shots strip, the Overview, the Inspector, the commands and the Groups tool:
//   loopLooks(app, light)   -> Map loop id -> {l, group, color, g (passes), pick (preferred frame), ticks: [{t, k}]}
//   setLoopPick(app, id, p) the preferred frame (one undo step); the same footage's other loops take the same picture
//   preferredPictures(app)  -> Set of bucket ids: the loops' preferred pictures (seed frames, best frame to paint, fills)
//   caretsOf(app)           -> the repeated pictures outside the loops, one caret per run
//   linksOf(app)            -> Map shot -> {fams, others, crops}: shots that hold the same loop footage, or the same
//                              animation re-framed (paw-hvbf: tracking's shotLinks, a crop / zoom): the chain
//   setCropLinks(app, links) the crop links (tracking shotLinks.links; they arrive after Detect): the Ruler feeds them
//   showMatch / clearMatch  where a set of pictures plays, highlighted (tl.match)
//   seekSame(app, dir)      the playhead to the next / previous occurrence of the picture under it (tl.seek: the readout)
import { untrack } from 'svelte';
import { tl, listOf, scenesOf } from './state.svelte.js';
import { repeatsOf } from './repeats.svelte.js';
import { bucketOf, familyMembers, runEnd } from './repeats.js';
import { loopGroup } from './loop-info.js';
import { shotPictures } from './repeat-scenes.js';
import { shotLabel, cutsOf } from './shots.js';
import { LOOP_PALETTE, loopColorIndex, passGeom, clampEnd, pickOf, pickTicks, pickTime, pickOfPicture, loopEnd, caretRuns, spansOf, linkedShots, sameTimes, stepTimes, seekWords } from './loop-marks.js';
import { gridOf, frameAt, frameLen } from '../../lib/lane.js';

// paw-hvbf: the crop links (tracking.svelte.js shotLinks.links: {a, b: {start_ms, end_ms}, kind 'crop', scale, tighter,
// loops: [{a, b: Loops-row loop keys}]}), set by the Ruler (always mounted) from the tracking store: reactive here, so the
// chain and the shared loop colour appear when they arrive (about 12 s after Detect), without a restart
// paw-shgb: one per app (a tab each): a hidden tab's loop looks keep its own links
class Crops { v = $state.raw(null); }   // raw: the store's own array, compared by identity
const crops = new WeakMap();
const cropBox = (app) => { let b = crops.get(app); if (!b) crops.set(app, (b = new Crops())); return b; };
export const setCropLinks = (app, links) => { const b = cropBox(app); if (untrack(() => b.v) !== (links ?? null)) b.v = links ?? null; };
const gridFor = (app) => gridOf(app.player) || 1000 / 30;
const isLight = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';

/** A pick saved before paw-llaa (doc.repeats.loops: findLoops key -> bucket id) for loop l of footage group. */
function legacyPick(app, ix, l, g, group) {
  const picks = app.doc.repeats?.loops;
  if (!ix || !picks || !(group >= 0)) return 0;
  for (const [k, id] of Object.entries(picks)) if ((ix.family?.get(+k) ?? +k) === group) { const p = pickOfPicture(ix, l, g, id, gridFor(app)); if (p >= 0) return p; }
  return 0;
}

let memo = { loops: null, ix: null, grid: null, light: null, picks: null, crops: null, out: new Map() };
/** Every loop's look (see the top), the same Map until the loops, the repeats, the clock, the theme or old picks change. */
export function loopLooks(app, light = isLight()) {
  const loops = listOf(app, 'loops'), ix = repeatsOf(app), grid = gridFor(app), picks = app.doc.repeats?.loops ?? null, crops = cropBox(app).v;
  if (memo.loops === loops && memo.ix === ix && memo.grid === grid && memo.light === light && memo.picks === picks && memo.crops === crops) return memo.out;
  const fm = frameLen(grid) || 1000 / 30, groups = loops.map((l) => ({ id: l.id, t0: l.t0, group: loopGroup(ix, l, fm) }));
  // a crop link's loops (the same animation re-framed: other pictures, so another footage group) share one colour
  const shade = groups.map((g) => ({ ...g })), byKey = (k) => shade[loops.findIndex((l) => l.auto?.key === k)];
  for (const k of crops || []) for (const p of k.loops || []) {
    const a = byKey(p.a), b = byKey(p.b);
    if (a && b) { if (a.group >= 0) b.group = a.group; else if (b.group >= 0) a.group = b.group; }
  }
  const fams = [...new Set((ix?.loops || []).map((L) => ix.family?.get(L.key) ?? L.key))];
  const ci = loopColorIndex(shade, fams), pal = LOOP_PALETTE[light ? 'light' : 'dark'], out = new Map();
  const order = [...loops].sort((a, b) => a.t0 - b.t0);
  loops.forEach((l, i) => {
    const group = groups[i].group, g0 = passGeom(l, grid);
    // where its pictures stop: the last held run of its footage inside it; the next loop's start
    let stop = order.find((o) => o.t0 > l.t0)?.t0 ?? Infinity;
    if (ix && group >= 0 && loopEnd(l) > l.t1) {
      let last = -Infinity;
      for (const id of familyMembers(ix, group)) for (const o of ix.buckets[id].occ) if (o.t >= l.t0 && o.t < g0.end) last = Math.max(last, runEnd(o, grid));
      if (last > l.t0) stop = Math.min(stop, last);
    }
    const g = clampEnd(g0, l, stop), pick = pickOf(l, g, l.pick == null ? legacyPick(app, ix, l, g, group) : 0);
    out.set(l.id, { l, group, ci: ci.get(l.id), color: pal[ci.get(l.id)], g, pick, ticks: pickTicks(l, g, pick, grid) });
  });
  memo = { loops, ix, grid, light, picks, crops, out };
  return out;
}

/** Loop id's preferred frame -> pick (frames into its cycle): one undo step. The same footage's other loops (the same
 *  pictures in another shot) take the same picture. */
export function setLoopPick(app, id, pick) {
  const looks = loopLooks(app), me = looks.get(id);
  if (!me || me.pick === pick) return;
  const ix = repeatsOf(app), grid = gridFor(app), b = ix ? bucketOf(ix, frameAt(pickTime(me.l, me.g, 0, pick, grid), grid)) : -1;
  const next = new Map([[id, pick]]);
  if (b >= 0 && me.group >= 0) for (const o of looks.values()) if (o.l.id !== id && o.group === me.group) { const p = pickOfPicture(ix, o.l, o.g, b, grid); if (p >= 0) next.set(o.l.id, p); }
  app.transact('Preferred loop frame', () => { app.doc.loops = app.doc.loops.map((l) => (next.has(l.id) ? { ...l, pick: next.get(l.id) } : l)); });
  app.usage?.note?.('loops:pick', { pick, of: me.g.frames, linked: next.size - 1 });
}

/** The loops' preferred pictures (bucket ids), and picks saved before paw-llaa: the Groups tool prefers these frames. */
export function preferredPictures(app) {
  const ix = repeatsOf(app), out = new Set(Object.values(app.doc.repeats?.loops || {}));
  if (!ix) return out;
  const grid = gridFor(app);
  for (const o of loopLooks(app).values()) { const b = bucketOf(ix, frameAt(pickTime(o.l, o.g, 0, o.pick, grid), grid)); if (b >= 0) out.add(b); }
  return out;
}

let cm = { ix: null, looks: null, out: [] };
/** The carets: repeated pictures outside every loop (loop-marks.js caretRuns), each {t, t1, ids, fam}. */
export function caretsOf(app) {
  const ix = repeatsOf(app), looks = loopLooks(app);
  if (cm.ix === ix && cm.looks === looks) return cm.out;
  const grid = gridFor(app), spans = [...looks.values()].map((o) => ({ t0: o.l.t0, t1: o.g.end }));
  cm = { ix, looks, out: ix ? caretRuns(ix, spans, (o) => runEnd(o, grid)) : [] };
  return cm.out;
}

let lm = { ix: null, cuts: null, looks: null, crops: null, out: new Map() };   // paw-o60v.6: on the cuts, not the list
/** Shots linked by the same loop footage (loop-marks.js linkedShots) and, paw-hvbf, by a crop link (the same animation
 *  re-framed): Map shot -> {fams, others, crops: [{j, scale, tighter (this shot is the crop), via? 'loops', frames?, checks?}]}. */
export function linksOf(app) {
  const ix = repeatsOf(app), list = scenesOf(app), cuts = cutsOf(list), looks = loopLooks(app), crops = cropBox(app).v;
  if (lm.ix === ix && lm.cuts === cuts && lm.looks === looks && lm.crops === crops) return lm.out;
  const fams = [...looks.values()].map((o) => o.group);
  const out = ix && list.length > 1 ? linkedShots(ix, shotPictures(ix, list, frameLen(gridFor(app)) || 1000 / 30), fams) : new Map();
  const at = (s) => list.findIndex((q) => Math.abs(q.start_ms - s?.start_ms) < 1);
  for (const k of crops || []) {
    if (k.kind && k.kind !== 'crop') continue;
    const a = at(k.a), b = at(k.b);
    if (a < 0 || b < 0 || a === b) continue;
    for (const [i, j, me] of [[a, b, 'a'], [b, a, 'b']]) {
      const e = out.get(i) ?? { fams: [], others: [], crops: [] };
      e.crops ??= [];
      if (!e.others.includes(j)) e.others.push(j);
      e.others.sort((x, y) => x - y);
      e.crops.push({ j, scale: k.scale, tighter: k.tighter === me, ...(k.via === 'loops' ? { via: 'loops', frames: k.frames, checks: k.checks } : {}) });   // paw-0zwb: found by the loop-pair search (a hollow chain)
      out.set(i, e);
    }
  }
  lm = { ix, cuts, looks, crops, out };
  return lm.out;
}

/** Highlight where pictures `ids` play (or explicit spans), with a colour and words, until Esc / a click elsewhere. */
export function showMatch(app, { ids = null, spans = null, color = null, text = '', shots = null } = {}) {
  const ix = repeatsOf(app), list = scenesOf(app), sp = [...(spans ?? (ix && ids ? spansOf(ix, ids, (o) => runEnd(o, gridFor(app))) : [])), ...(shots || []).filter((i) => list[i]).map((i) => ({ t0: list[i].start_ms, t1: list[i].end_ms }))];
  tl.match = sp.length ? { spans: sp, color, text, shots } : null;
  return tl.match;
}
export const clearMatch = () => { tl.match = null; };
/** Where loop id's footage plays (its family's pictures; no repeats: its own passes). */
export function showLoopMatch(app, id) {
  const o = loopLooks(app).get(id), ix = repeatsOf(app);
  if (!o) return null;
  const ids = ix && o.group >= 0 ? familyMembers(ix, o.group) : [];
  return showMatch(app, ids.length ? { ids, color: o.color, text: 'loop' } : { spans: [{ t0: o.l.t0, t1: o.g.end }], color: o.color, text: 'loop' });
}

const shotIndexAt = (list, t) => list.findIndex((s) => t >= s.start_ms && t < s.end_ms);
/** Step the playhead to the next (dir 1) / previous (-1) occurrence of the picture at t (default: the playhead; inside a
 *  loop without repeats: its passes at that phase), wrapping; tl.seek says where it is ("3 of 29 in shot 21.1 · +12 in 1
 *  other shot"). -> true when it moved. */
export function seekSame(app, dir, t = app.player.timeMs) {
  const grid = gridFor(app), fm = frameLen(grid) || 1000 / 30, loops = listOf(app, 'loops');
  const s = sameTimes(repeatsOf(app), t, grid, loops);
  if (s.times.length < 2) { app.toast('This frame\'s picture does not repeat', 'quiet'); return false; }
  const st = stepTimes(s.times, t, dir, fm / 2);
  if (!st) return false;
  app.player.seek(st.t);
  const list = scenesOf(app), v = app.view;
  if (st.t < v.start || st.t > v.start + v.span) app.setView({ start: Math.max(0, st.t - v.span / 2), span: v.span });
  const crops = linksOf(app).get(shotIndexAt(list, st.t))?.crops?.length;   // paw-hvbf: a crop shows other pictures: not stepped through
  tl.seek = { t: st.t, text: seekWords(s.times, st.t, (x) => shotIndexAt(list, x), (i) => shotLabel(list, i)) + (crops ? ' · exact repeats only (not the cropped shot)' : ''), at: Date.now() };
  return true;
}
