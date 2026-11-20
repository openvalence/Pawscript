// transitions.svelte.js -- fades and dissolves (paw-ef73.3) for the rest of the app: the current video's list (transitions.js
// shape), from the repeated-frames pass (repeats.svelte.js loadRepeats hands it over: one decode for both) and kept in
// the project (a `transitions` block, so a project shows them before the pass is back and the Track pass can read them
// with the cuts; a project without it shows nothing until the pass has run). The owner's hand edits (paw-ef73.13) lie
// over it: doc.repeats.fades (transitions.js withEdits), undoable, never overwritten by a re-run.
//
//   transitionsOf(app)       -> the current video's list, edits applied ([] when none / not run)
//   shownTransitions(app)    -> the same, [] when hidden (View › Ruler: show / hide fades and dissolves)
//   fadeSnaps(app)           -> the cut drag's snap targets (interact.js snapContext)
//   landAt(app, t, end)      -> where a click on / jump to the shot [t, end) lands: its fade in's first clean frame, else t
//   The Shots strip (ScenesLane calls these with the strip's band): paintFades, fadeGesture, fadeCursor, fadeTip;
//   addFade / removeFade (the shot's right-click menu and the commands).
import { cleanTransitions, snapTargets, withEdits, replaceFade, hitAt, dragFade, defaultFade, edgeFades, landingOf, transitionAt,
  transitionText, transitionOfCut, drawShotFades, fadeBand, cutGrip, GRIP_W, GRAB_PX } from './transitions.js';
import { xToMs, msToX } from '../../lib/lane.js';

// paw-shgb: per video path (several tabs open): a hidden tab's write keeps its own list, never the shown one's
let st = $state.raw({});                         // path -> list; replaced whole: plain arrays, stable identity
let live = $state.raw(null);                     // a drag in progress: {orig, next} laid over the list
// the selected / hovered fade (its ts, to find it again after edits), per app (paw-gw8y: each tab its own)
const uis = new WeakMap();
function uiOf(app) {
  let u = uis.get(app);
  if (!u) { const fresh = $state({ sel: null, hot: null, hotH: null }); uis.set(app, (u = fresh)); }
  return u;
}

/** Shown on the ruler and snapped to (setting timeline.transitions, default on). */
export const transitionsShown = (app) => app.settings?.get?.('timeline.transitions', true) !== false;
const NONE = [];
const detectedOf = (app) => st[app.doc.media?.path] || NONE;
export const fadeEdits = (app) => app.doc.repeats?.fades || NONE;
const durOf = (app) => Math.max(1, Math.round(app.durationMs || app.doc.media?.durationMs || 1));
const fmOf = (app) => app.player?.frameMs || 1000 / 30;
let memo = { d: null, e: null, l: null, out: NONE };
export function transitionsOf(app) {
  const d = detectedOf(app), e = fadeEdits(app), l = live;
  if (memo.d !== d || memo.e !== e || memo.l !== l) {
    const dur = durOf(app);
    memo = { d, e, l, out: withEdits(d, l ? replaceFade(e, l.orig, l.next, dur) : e, dur) };
  }
  return memo.out;
}
export const shownTransitions = (app) => (transitionsShown(app) ? transitionsOf(app) : NONE);

let snaps = { list: null, targets: [] };
export function fadeSnaps(app) {
  const l = shownTransitions(app);
  if (snaps.list !== l) snaps = { list: l, targets: snapTargets(l) };
  return snaps.targets;
}
/** Where a click on / jump to the shot [t, end) lands (transitions.js landingOf). */
export const landAt = (app, t, end = Infinity) => landingOf(transitionsOf(app), t, end, fmOf(app), durOf(app));

/** paw-gw8y: only the videos in `paths` (a Set: the ones open tabs hold) keep their list. */
export function keepTransitions(paths) {
  if (Object.keys(st).some((p) => !paths.has(p))) st = Object.fromEntries(Object.entries(st).filter(([p]) => paths.has(p)));
}
/** The pass's result for `path` (repeats.svelte.js). */
export function adoptTransitions(path, list) {
  if (path) st = { ...st, [path]: cleanTransitions(list) };
}

const bound = new WeakSet();
/** Keep the detected list in the project (once per app; the Ruler binds it on mount, as the lanes bind the timeline block). */
export function bindTransitions(app) {
  if (!app || bound.has(app) || typeof app.registerBlock !== 'function') return;
  bound.add(app);
  app.registerBlock('transitions', {
    save: (a) => { const l = detectedOf(a); return l.length ? { v: 1, list: l } : null; },
    load: (a, v) => { uiOf(a).sel = null; const l = cleanTransitions(v?.list); if (l.length && a.doc.media?.path) adoptTransitions(a.doc.media.path, l); },
  });
}

// ---- the Shots strip (paw-ef73.13, .22): the fades drawn on their shots, their grips dragged ----
// band = [top, bottom) px of the Shots strip (the lane's geometry); the fades sit in its upper part. A fade is made from the
// shot's right-click menu / a command (addFade), never by dragging from a shot edge (paw-ef73.22: that grabbed by accident).
const bandOf = ([y1, ym]) => fadeBand(y1, ym);
const inBand = (band, y) => { const b = bandOf(band); return y >= b.y0 - 2 && y < b.y0 + b.h + 2; };
const find = (app, ts) => (ts == null ? null : transitionsOf(app).find((x) => Math.abs(x.ts - ts) < 1) ?? null);
export const selectedFade = (app) => find(app, uiOf(app).sel);

export function paintFades(ctx, app, view, w, band, T) {
  if (!transitionsShown(app)) return;
  const b = bandOf(band), hx = uiOf(app).hotH && find(app, uiOf(app).hotH.ts), hotH = hx ? { x: hx, h: uiOf(app).hotH.h } : null;
  drawShotFades(ctx, view, w, transitionsOf(app), { ...b, dur: durOf(app), ink: T.intent, black: '#000', hi: T.txHi, sel: selectedFade(app), hot: find(app, uiOf(app).hot), hotH });
}

/** What is under the pointer on the Shots strip: {kind: 'handle', x, h, t} | {kind: 'cut', i} (on the cut's grip, paw-ef73.18)
 *  | null (transitions.js hitAt). */
export function stripHit(app, shots, w, px, y, band) {
  const cuts = shots.map((s, i) => ({ i, x: msToX(app.view, w, s.start_ms) })).slice(1);
  return hitAt(transitionsShown(app) ? transitionsOf(app) : NONE, app.view, w, px, cuts, !!band && inBand(band, y), durOf(app), band ? { py: y, ...cutGrip(band[0], band[1]) } : { py: y, y0: 1, y1: 0 });
}

/** A press on the lane. On a fade's grip in the Shots strip's band: drag it (frame-snapped, the video shows the frame, one
 *  undo step; back onto the other end = removed). A plain click on a grip selects that fade (Alt+left / right nudge its
 *  first clean frame). -> the gesture {move(px), end(), cancel()} or null (a cut, a body: the fade selection is dropped). */
export function fadeGesture(app, shots, w, px, y, band) {
  const hit = stripHit(app, shots, w, px, y, band);
  if (hit?.kind !== 'handle') { uiOf(app).sel = null; return null; }
  const fm = fmOf(app), dur = durOf(app), time0 = app.player.timeMs, x0 = px, orig = hit.x;
  let moved = false;
  const at = (p) => { const t = xToMs(app.view, w, p); return app.player.snap ? app.player.snap(Math.max(0, Math.min(dur, t))) : Math.round(t / fm) * fm; };
  return {
    move(p) {
      if (!moved && Math.abs(p - x0) <= 3) return;   // a click that stays within 3 px changes nothing
      moved = true;
      const t = at(p);
      live = { orig, next: dragFade(orig, hit.h, t, fm, dur) };
      app.player.seek(t);   // the frame under the handle
    },
    end() {
      const l = live; live = null;
      if (!moved) { uiOf(app).sel = orig.ts; app.player.seek(orig.t1 ?? orig.ts); return; }
      if (!l) return;
      app.transact(!l.next ? 'Remove fade' : 'Adjust fade', () => { app.doc.repeats = { ...(app.doc.repeats || {}), fades: replaceFade(fadeEdits(app), l.orig, l.next, dur) }; });
      uiOf(app).sel = l.next?.ts ?? null;
      app.usage?.note?.('transitions:edit', { how: !l.next ? 'remove' : hit.h, kind: orig.kind });
    },
    cancel() { live = null; if (moved) app.player.seek(time0); },
  };
}
/** The cursor on the Shots strip: 'ew-resize' over a grip (it highlights), 'col-resize' over a cut line, null elsewhere.
 *  Also sets the hovered fade / grip (the highlight). */
export function fadeCursor(app, shots, w, px, y, band) {
  const hit = stripHit(app, shots, w, px, y, band), list = transitionsShown(app) ? transitionsOf(app) : NONE;
  const over = band && inBand(band, y) ? transitionAt(list, xToMs(app.view, w, px), ((GRIP_W / 2 + GRAB_PX + 8) * app.view.span) / w, durOf(app)) : null;
  uiOf(app).hot = hit?.kind === 'handle' ? hit.x.ts : over?.ts ?? null;
  uiOf(app).hotH = hit?.kind === 'handle' ? { ts: hit.x.ts, h: hit.h } : null;
  return hit?.kind === 'handle' ? 'ew-resize' : hit?.kind === 'cut' ? 'col-resize' : null;
}
/** The hover words in the band, or null. */
export function fadeTip(app, shots, w, px, y, band) {
  if (!band || !inBand(band, y)) return null;
  const hit = stripHit(app, shots, w, px, y, band), fm = fmOf(app), dur = durOf(app);
  if (hit?.kind === 'cut') return null;
  const x = hit?.x ?? transitionAt(transitionsOf(app), xToMs(app.view, w, px), ((GRIP_W / 2 + GRAB_PX) * app.view.span) / w, dur);
  if (!x) return null;
  const cut = shots.slice(1).map((s) => s.start_ms).find((c) => transitionOfCut([x], c, fm, dur)) ?? null;
  const what = { start: 'its start', clean: 'its first clean frame', b0: 'where the black starts', b1: 'where the black ends' }[hit?.h];
  return transitionText(x, { frameMs: fm, dur, cut }) + (what ? ` · drag: move ${what} (onto the other end: remove it) · click: select (Alt+left / right: nudge the clean frame)` : ' · drag a grip to adjust');
}

/** The fades at shot i's two edges: {in, out}, each a transition or null (transitions.js shotFades). */
export const fadesOfShot = (app, shots, i) => edgeFades(shots[i], transitionsOf(app), fmOf(app), durOf(app));
const commitFades = (app, label, orig, next) => {
  app.transact(label, () => { app.doc.repeats = { ...(app.doc.repeats || {}), fades: replaceFade(fadeEdits(app), orig, next, durOf(app)) }; });
  uiOf(app).sel = next?.ts ?? null;
};
/** A fade in / out on shot i (menu, command): the default length (0.3 s, at most the shot), then adjusted by its grip. -> the fade | null. */
export function addFade(app, shots, i, side) {
  const s = shots[i];
  if (!s || fadesOfShot(app, shots, i)[side]) return null;
  const next = defaultFade(side, s, fmOf(app));
  if (!next) { app.toast?.('The shot is too short for a fade', 'quiet'); return null; }
  commitFades(app, `Fade ${side}`, null, next);
  app.usage?.note?.('transitions:edit', { how: 'add-' + side, kind: next.kind });
  return next;
}
/** Remove fade x (one undo step; a detected one stays hidden, transitions.js replaceFade). */
export function removeFade(app, x) {
  if (!x) return;
  commitFades(app, 'Remove fade', x, null);
  app.usage?.note?.('transitions:edit', { how: 'remove-menu', kind: x.kind });
}

/** Alt+← / →: the selected fade's first clean frame one frame earlier / later (its start when it has none). */
export function nudgeFade(app, dir) {
  const x = selectedFade(app);
  if (!x) return;
  const fm = fmOf(app), dur = durOf(app), h = x.t1 != null ? 'clean' : 'start', t0 = h === 'clean' ? x.t1 : x.ts;
  const t = app.player.snap ? app.player.snap(t0 + dir * fm) : t0 + dir * fm, next = dragFade(x, h, t, fm, dur);
  if (!next) return;
  app.transact('Nudge fade', () => { app.doc.repeats = { ...(app.doc.repeats || {}), fades: replaceFade(fadeEdits(app), x, next, dur) }; }, { coalesce: true });
  uiOf(app).sel = next.ts;
  app.player.seek(h === 'clean' ? next.t1 : next.ts);
}
export const fadeSelected = (app) => !!selectedFade(app);
