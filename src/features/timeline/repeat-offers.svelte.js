// repeat-offers.svelte.js -- the repeated frames acting on the scene structure (paw-ef73.4; the rules: repeat-scenes.js).
//   joinLoopMoves(app)    after Detect scenes: camera-move boundaries inside one loop, phase continuous, are joined
//                         (one undo step, a toast with Undo; fix log auto:shots.loopJoin). Measured: 10 of 10 such
//                         boundaries on the owner's four projects were joined by hand.
//   offersOf(app)         one-press offers drawn on the Scenes row's boundaries: join (weaker evidence of the same cycle
//                         on both sides of a camera move), snap (a cut 1-2 frames from the picture change), same scene
//                         (shots that show the same footage). Click applies (one undo step), right-click drops it (saved:
//                         doc.repeats.no).
//   markAutoLoops(app)    every loop the repeats show back to back, marked on its shot (the Shots row) as an automatic loop
//                         ({id, t0, t1, auto: {key, t0, t1, end, n}}): never over a loop already there, never one the owner
//                         removed (doc.repeats.off); moved / resized / tiled = the owner's (isAutoLoop false).
import { repeatsOf } from './repeats.svelte.js';
import { falseMoves, cutSnaps, sameFootage, autoLoops, cropOffers } from './repeat-scenes.js';
import { scenesOf, setScenes, newId } from './state.svelte.js';
import { mergeShots, mergeScenesIn, shotLabel, cutsOf } from './shots.js';
import { moveCut } from './scenes.js';
import { X } from './draw.js';
import { gridOf } from '../../lib/lane.js';
import { trackingOf } from './deps.js';
import { extendTo } from './regions.js';   // paw-2lp7.5: the footage offers extend the action region

const fmOf = (app) => app.player?.frameMs || 1000 / 30;
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const repeatsDoc = (app) => app.doc.repeats || {};

/** Join the exact false camera moves of the current scenes (one undo step). -> how many were joined. */
export function joinLoopMoves(app) {
  const ix = repeatsOf(app), list = app.doc.scenes || [], fm = fmOf(app);
  const hits = falseMoves(ix, list, fm).filter((x) => x.exact);
  if (!hits.length) return 0;
  let out = list;
  for (const h of [...hits].reverse()) out = mergeShots(out, h.i - 1) ?? out;   // from the last: earlier indices stay valid
  if (out === list) return 0;
  app.transact('Camera moves inside a loop joined', () => setScenes(app, out));
  app.usage?.note?.('scenes:loopJoin', { n: hits.length, t: hits.map((h) => Math.round(h.t)), loops: hits.map((h) => h.loop) });
  app.toast(`${hits.length} camera move${hits.length > 1 ? 's' : ''} inside a loop joined: the same cycle goes on across ${hits.length > 1 ? 'them' : 'it'}`, 'ok',
    { timeout: 8000, action: { label: 'Undo', run: () => app.undo() } });
  return hits.length;
}

let memo = { ix: null, cuts: null, fm: 0, no: null, crops: null, offers: [] };   // paw-o60v.6: on the cuts, not the list (the offers read nothing else of the shots)
/** The offers on the current scenes: [{kind: 'join' | 'snap' | 'scene', key, t (the boundary), text, label (the undo
 *  step), run(list) -> new list | null}], at most one per boundary, none the owner dropped. paw-3uyu: a shot that is an
 *  earlier shot's footage re-framed (tracking shotLinks, lib/crop-match.js) offers "same footage as shot N · crop ×s",
 *  taken like the same-footage offer. */
export function offersOf(app) {
  const ix = repeatsOf(app), list = scenesOf(app), cuts = cutsOf(list), fm = fmOf(app), no = repeatsDoc(app).no, crops = trackingOf(app)?.shotLinks?.links ?? null;
  if (memo.ix === ix && memo.cuts === cuts && memo.fm === fm && memo.no === no && memo.crops === crops) return memo.offers;
  const out = [], seen = new Set(), drop = new Set(no || []);
  const add = (o) => { if (!seen.has(o.t) && !drop.has(o.key)) { seen.add(o.t); out.push(o); } };
  if (ix && list.length > 1) {
    for (const f of falseMoves(ix, list, fm)) add({ kind: 'join', key: `join:${Math.round(f.t)}`, t: f.t, label: 'Join: the loop continues across the camera move',
      text: `${f.exact ? 'The same loop goes on' : 'The same pictures show'} on both sides of this camera move${f.n ? ` (${f.n} shared)` : ''}: a moving close-up read as a zoom / pan? Click: join the shots · right-click: no`,
      run: (l) => { const k = l.findIndex((s) => Math.abs(s.start_ms - f.t) < 1); return k > 0 ? mergeShots(l, k - 1) : null; }, cuts: true });
    for (const c of cutSnaps(ix, list, fm, 2, gridOf(app.player))) add({ kind: 'snap', key: `snap:${Math.round(c.t)}`, t: c.t, label: 'Move cut',
      text: `The picture changes ${Math.abs(c.d)} frame${Math.abs(c.d) > 1 ? 's' : ''} ${c.d < 0 ? 'before' : 'after'} this cut (the repeated frames say so). Click: move the cut there · right-click: no`,
      run: (l) => { const k = l.findIndex((s) => Math.abs(s.start_ms - c.t) < 1); return k > 0 ? moveCut(l, k, c.to, 1) : null; }, cuts: true });
    const done = new Set();
    for (const p of sameFootage(ix, list, fm)) {
      if (done.has(p.b)) continue;
      done.add(p.b);
      const ta = list[p.a].start_ms, tb = list[p.b].start_ms;
      // the offer sits on the scene boundary in front of shot b's scene
      let k = p.b; while (k > 0 && list[k].join === true) k--;
      if (k < 1) continue;
      add({ kind: 'scene', key: `scene:${Math.round(ta)}:${Math.round(tb)}`, t: list[k].start_ms, label: 'Extend the action: same footage',
        text: `Shot ${shotLabel(list, p.b)} shows the same footage as shot ${shotLabel(list, p.a)} (${mmss(ta)}, ${p.n} pictures in common). Click: extend the action at shot ${shotLabel(list, p.a)} across to the end of shot ${shotLabel(list, p.b)} (the shots between: cutaway candidates) · right-click: no, another action`,
        run: (l) => mergeScenesIn(l, ta, l.find((s) => Math.abs(s.start_ms - tb) < 1)?.end_ms ?? tb + 1), acts: extendTo(ta, tb) });
    }
  }
  if (crops?.length && list.length > 1) for (const o of cropOffers(list, crops)) {   // after the repeats' own: theirs win a boundary
    const [, ta, tb] = o.key.split(':').map(Number), a = list.findIndex((s) => Math.abs(s.start_ms - ta) < 1), b = list.findIndex((s) => Math.abs(s.start_ms - tb) < 1);
    add({ ...o, label: 'Extend the action: same footage (crop)', acts: extendTo(ta, tb),
      text: o.text.replace(/Click: .*$/, `Click: extend the action at shot ${shotLabel(list, a)} across to the end of shot ${shotLabel(list, b)} (the shots between: cutaway candidates) · right-click: no, another action`) });
  }
  memo = { ix, cuts, fm, no, crops, offers: out.sort((a, b) => a.t - b.t) };
  return memo.offers;
}
/** Apply offer o (one undo step). paw-2lp7.5: an offer that joins footage (o.acts) extends the action region instead. */
export function takeOffer(app, o) {
  if (o.acts) {
    const a = o.acts(app.doc.acts || [], scenesOf(app));
    if (!a) return app.toast('That offer no longer fits (the action already reaches there)', 'quiet');
    app.transact(o.label, () => { app.doc.acts = a; });
    app.usage?.note?.('scenes:repeatOffer', { kind: o.kind, t: Math.round(o.t), took: true, acts: true });
    return;
  }
  const r = o.run(scenesOf(app));
  if (!r) return app.toast('That offer no longer fits the scenes', 'quiet');
  app.transact(o.label, () => setScenes(app, r, { cuts: !!o.cuts }));   // a snap / a join across a camera move: the cuts only
  app.usage?.note?.('scenes:repeatOffer', { kind: o.kind, t: Math.round(o.t), took: true });
}
/** Drop offer o: it does not come back for this project (one undo step). */
export function dropOffer(app, o) {
  app.transact('Drop offer', () => { app.doc.repeats = { ...repeatsDoc(app), no: [...(repeatsDoc(app).no || []), o.key] }; });
  app.usage?.note?.('scenes:repeatOffer', { kind: o.kind, t: Math.round(o.t), took: false });
}

const R = 4;   // the offer badge's radius (px), on the boundary at the top of the Scenes strip
/** Draw the offers' badges on the Scenes row (an accent dot with a white core on each boundary that has one). */
export function drawOffers(ctx, app, w, T) {
  for (const o of offersOf(app)) {
    const x = X(app.view, w, o.t);
    if (x < -R || x > w + R) continue;
    ctx.beginPath(); ctx.arc(x, R + 1, R, 0, Math.PI * 2); ctx.fillStyle = T.reality; ctx.fill();
    ctx.beginPath(); ctx.arc(x, R + 1, 1.5, 0, Math.PI * 2); ctx.fillStyle = T.bg; ctx.fill();
  }
}
/** The offer whose badge is under (x, y) in the Scenes row, or null. */
export function offerAt(app, x, y, w) {
  if (y > 2 * R + 4) return null;
  return offersOf(app).find((o) => Math.abs(X(app.view, w, o.t) - x) <= R + 2) ?? null;
}

// ---- loops ----
/** Is loop l an automatic one still as it was marked (the owner's once moved, resized or tiled)? */
export const isAutoLoop = (l) => !!l?.auto && l.t0 === l.auto.t0 && l.t1 === l.auto.t1 && !(l.tiledTo > l.t1);
/** Would candidate c (autoLoops) go over a loop already there? The owner's (or one they moved): not anywhere over its
 *  cycle or tiles; another automatic one: not over its cycle (neighbouring passes may touch, autoLoops settled that). */
const taken = (loops, c) => loops.some((l) => (isAutoLoop(l) ? l.t0 < c.t1 && c.t0 < l.t1 : l.t0 < c.end && c.t0 < Math.max(l.t1, l.tiledTo || 0)));
// paw-llaa (paw-xclk item 4): marked once per OPENED DOCUMENT (its media object: a new one on every open / new / recover),
// not once per video path per session. Keyed by path, a video reopened (a project of it, the same file again) after its
// loops were undone found the path already marked and showed none until a restart. Within a document an undo of the marking
// is still not redone at once; the owner's removals stay out (doc.repeats.off), loops already there are never doubled.
const markedFor = new WeakMap();   // doc.media -> the repeats index it was marked from
/** Mark the current video's back-to-back loops (one undo step, a toast with Remove). -> how many were marked. */
export function markAutoLoops(app) {
  const ix = repeatsOf(app), media = app.doc.media;
  if (!ix || !media?.path || markedFor.has(media)) return 0;
  markedFor.set(media, ix);
  const loops = app.doc.loops || [], off = new Set(repeatsDoc(app).off || []), have = new Set(loops.map((l) => l.auto?.key).filter(Boolean));
  const add = [];
  for (const c of autoLoops(ix, fmOf(app), gridOf(app.player))) {
    if (off.has(c.key) || have.has(c.key) || taken([...loops, ...add], c)) continue;
    add.push({ id: newId('lp'), t0: c.t0, t1: c.t1, auto: { key: c.key, t0: c.t0, t1: c.t1, end: c.end, n: c.n } });
  }
  if (!add.length) return 0;
  app.transact('Loops from repeated frames', () => { app.doc.loops = [...loops, ...add].sort((a, b) => a.t0 - b.t0); });
  app.usage?.note?.('repeats:autoLoops', { n: add.length });
  app.toast(`${add.length} loop${add.length > 1 ? 's' : ''} marked from the repeated frames (on their shots)`, 'quiet', { timeout: 6000, action: { label: 'Remove', run: () => removeAutoLoops(app, add.map((l) => l.id)) } });
  return add.length;
}
/** Remove automatic loops by id (one undo step; the owner's own, or one they moved, stay); they are not marked again
 *  for this project. */
export function removeAutoLoops(app, ids) {
  const gone = (app.doc.loops || []).filter((l) => ids.includes(l.id) && isAutoLoop(l));
  if (!gone.length) return;
  app.transact(gone.length > 1 ? 'Remove automatic loops' : 'Remove automatic loop', () => {
    app.doc.loops = app.doc.loops.filter((l) => !gone.includes(l));
    app.doc.repeats = { ...repeatsDoc(app), off: [...(repeatsDoc(app).off || []), ...gone.map((l) => l.auto.key)] };
  });
}
