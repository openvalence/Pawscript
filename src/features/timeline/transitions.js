// transitions.js -- fades and dissolves (paw-ef73.3), pure: the backend's list (media_repeats, src-tauri/src/transitions.rs,
// the same decode as the repeated frames), the cuts that belong to one, where a cut can snap, the facts per shot, the
// ruler's drawing and words. State and loading: transitions.svelte.js.
//
// A transition, ms (file start = 0): {kind: 'fade-out' | 'fade-in' | 'through-black' | 'dissolve', f0, f1 (frames: last
// clean before, -1 = the video starts inside; first clean after, = frames: it ends the video), t0 (last clean frame,
// null = none), ts (its first frame), tm (darkest frame / a dissolve's half-way frame), t1 (first clean frame, null =
// none), b0, b1 (the full-black frames as [b0, b1), null = none)}. Clean = fully outside the transition.
//
// The owner's rule: a fade between two scenes belongs wherever the owner puts the cut. Nothing here moves a cut by itself;
// a cut inside or at the edge of a transition is only paired with it (the shot facts, the hover), and snaps to the three
// places (start / darkest / first clean frame) when the owner drags it near or asks for it.
import { msToX } from '../../lib/lane.js';
import { fmtMs } from '../../lib/video.js';
import { moveCut } from './scenes.js';

export const KIND = { 'fade-out': 'Fade out', 'fade-in': 'Fade in', 'through-black': 'Fade through black', dissolve: 'Dissolve' };

/** A loaded list (backend or project block) -> the valid transitions, sorted; [] for anything else. */
export function cleanTransitions(v) {
  const ok = (x) => x && KIND[x.kind] && Number.isFinite(x.ts) && Number.isFinite(x.tm) && Number.isInteger(x.f0) && Number.isInteger(x.f1) && x.f1 > x.f0;
  return Array.isArray(v) ? v.filter(ok).sort((a, b) => a.ts - b.ts) : [];
}

/** Where it ends on the timeline: its first clean frame, else the video's end. */
export const endOf = (x, dur) => x.t1 ?? Math.max(dur || 0, x.ts);
/** Frames inside it (black included): the fade's length. */
export const framesOf = (x) => x.f1 - x.f0 - 1;

/** The three places a cut can sit, in time order: [{t, place: 'start' | 'middle' | 'clean', label}]; a place at the
 *  video's start (the video opens inside it) or past its end (it ends the video) is left out. */
export function placesOf(x) {
  const d = x.kind === 'dissolve';
  return [
    { t: x.ts, place: 'start', label: d ? 'dissolve start' : 'fade start' },
    { t: x.tm, place: 'middle', label: d ? 'dissolve middle' : 'darkest frame' },
    { t: x.t1, place: 'clean', label: 'first clean frame' },
  ].filter((p) => p.t != null && p.t > 0);
}
/** Snap targets for a cut drag (interact.js snapContext): every place of every transition. */
export const snapTargets = (list) => list.flatMap((x) => placesOf(x).map(({ t, label }) => ({ t, label })));

/** Does the cut at t belong to x: inside it, or at its edge (a frame before its start, two after its first clean frame:
 *  where scene detection puts a fade's cut). */
export const pairs = (x, t, frameMs, dur) => t >= x.ts - frameMs - 0.5 && t <= endOf(x, dur) + 2 * frameMs + 0.5;

/** The transition the cut at t belongs to (the nearest by its darkest frame), or null. */
export function transitionOfCut(list, t, frameMs, dur) {
  let best = null;
  for (const x of list) if (pairs(x, t, frameMs, dur) && (!best || Math.abs(x.tm - t) < Math.abs(best.tm - t))) best = x;
  return best;
}

/** Per shot (the flat shots list, scenes.js / shots.js shape): the transitions at its two edges, as facts the Track pass
 *  reads (seeding on the first clean frame, tracking into the fade, the Autorange soft start: paw-ef73.3 follow-up).
 *  -> [{in, out}] with in = {x, clean: the first clean frame after (ms | null), ms: length, frames} | null (the
 *  transition its start belongs to), out = {x, clean: the last clean frame before (ms | null), ms, frames} | null. A
 *  shot that starts at 0 / ends at the video's end pairs with a transition the video opens / ends inside. Derived, not
 *  stored: the project keeps the transitions (block) and the cuts, so the facts follow a moved cut. */
export function shotFades(shots, list, frameMs, dur) {
  const fact = (x, clean) => x && { x, clean, ms: Math.round(endOf(x, dur) - x.ts), frames: framesOf(x) };
  return shots.map((s) => {
    const i = transitionOfCut(list, s.start_ms, frameMs, dur), o = transitionOfCut(list, s.end_ms, frameMs, dur);
    return { in: fact(i, i?.t1 ?? null), out: fact(o, o?.t0 ?? null) };
  });
}

/** Where the cut at t sits in x, in words: 'at the fade start', 'at the darkest frame', 'at the first clean frame',
 *  '3 frames into it', '1 frame before the first clean frame', '1 frame after the first clean frame'. */
export function cutWhere(x, t, frameMs) {
  const near = (u) => u != null && Math.abs(u - t) < frameMs / 2;
  const fr = (ms) => { const n = Math.round(Math.abs(ms) / frameMs); return `${n} frame${n === 1 ? '' : 's'}`; };
  for (const p of placesOf(x)) if (near(p.t)) return `at the ${p.label}`;
  if (x.t1 != null && t > x.t1) return `${fr(t - x.t1)} after the first clean frame`;
  if (t < x.ts) return `${fr(x.ts - t)} before it`;
  return x.t1 != null && x.t1 - t < t - x.ts ? `${fr(x.t1 - t)} before the first clean frame` : `${fr(t - x.ts)} into it`;
}

/** Move the cut at shots[i].start_ms (i >= 1) to x's `place` ('start' | 'middle' | 'clean'). -> the new list, the same
 *  list when it is there already, or null (no such place; it would cross a neighbouring cut or leave a shot under a
 *  frame: two cuts in one fade, the sidecar's blank scene between them). */
export function snapCut(shots, i, x, place, frameMs) {
  const p = placesOf(x).find((q) => q.place === place);
  if (!p || i < 1 || i >= shots.length) return null;
  const r = moveCut(shots, i, p.t, Math.max(1, Math.round(frameMs || 1)));
  return r && r[i].start_ms === Math.round(p.t) ? r : null;   // it would cross or squash a neighbouring cut: no
}

/** The cut a command works on: of the transition at (or else nearest) the playhead t, its cut nearest t. -> {i (shot
 *  index), x} | null (no transition, or none of its cuts). */
export function cutToSnap(shots, list, t, frameMs, dur) {
  if (!list.length) return null;
  const by = (x) => (t >= x.ts && t <= endOf(x, dur) ? 0 : Math.min(Math.abs(t - x.ts), Math.abs(t - endOf(x, dur))));
  const x = list.reduce((a, b) => (by(b) < by(a) ? b : a));
  let i = -1;
  for (let k = 1; k < shots.length; k++) if (pairs(x, shots[k].start_ms, frameMs, dur) && (i < 0 || Math.abs(shots[k].start_ms - t) < Math.abs(shots[i].start_ms - t))) i = k;
  return i < 0 ? null : { i, x };
}

/** The transition under time t (tol ms either side: a thin one stays hoverable), or null. */
export function transitionAt(list, t, tol, dur) {
  let best = null, bd = Infinity;
  for (const x of list) {
    const d = t < x.ts ? x.ts - t : t > endOf(x, dur) ? t - endOf(x, dur) : 0;
    if (d <= tol && d < bd) { best = x; bd = d; }
  }
  return best;
}

/** The hover words: kind, length in frames and ms, its black frames, the clean frames on both sides, the cut in it. */
export function transitionText(x, { frameMs, dur, cut = null } = {}) {
  const fr = (n) => `${n} frame${n === 1 ? '' : 's'}`, ms = Math.round(endOf(x, dur) - x.ts);
  const parts = [`${KIND[x.kind]}${x.user ? ' (your edit)' : ''}: ${fr(framesOf(x))} (${ms} ms)`];
  if (x.b0 != null) parts.push(`${fr(Math.max(1, Math.round((x.b1 - x.b0) / frameMs)))} full black`);
  parts.push(x.t0 != null ? `last clean frame ${fmtMs(x.t0)}` : 'the video opens inside it');
  parts.push(x.t1 != null ? `first clean frame at ${fmtMs(x.t1)}` : 'the video ends inside it');
  if (cut != null) parts.push(`cut ${cutWhere(x, cut, frameMs)}`);
  return parts.join(' · ');
}

/** Draw the list on a ruler band (y0, h px): a fade is the darkness ramp over its span (rising from its start to the
 *  black, falling to the first clean frame), its full-black frames solid; a dissolve is a cross. A transition thinner
 *  than MIN_W px is a small solid wedge at its darkest frame, so it reads at any zoom. */
export const MIN_W = 6;
export function drawTransitions(ctx, view, w, list, { y0, h, dur, ink, black }) {
  const X = (t) => msToX(view, w, t), top = y0 + 0.5, bot = y0 + h - 0.5;
  ctx.lineWidth = 1;
  for (const x of list) {
    const a = X(x.ts), b = X(endOf(x, dur));
    if (b < -MIN_W || a > w + MIN_W) continue;
    if (b - a < MIN_W) {
      const c = X(x.tm);
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.moveTo(c - MIN_W / 2, bot); ctx.lineTo(c, top); ctx.lineTo(c + MIN_W / 2, bot); ctx.fill();
      continue;
    }
    ctx.strokeStyle = ink; ctx.fillStyle = ink;
    ctx.beginPath();
    if (x.kind === 'dissolve') {
      ctx.moveTo(a, bot); ctx.lineTo(b, top); ctx.moveTo(a, top); ctx.lineTo(b, bot);
      ctx.stroke();
      continue;
    }
    // the darkness peak: a fade in opens dark, a fade out stays dark to its end; a through-black peaks over its black
    const p0 = x.kind === 'fade-in' ? a : X(x.b0 ?? x.tm), p1 = x.kind === 'fade-out' ? b : X(x.b1 ?? x.tm);
    ctx.moveTo(a, bot); ctx.lineTo(p0, top); ctx.lineTo(p1, top); ctx.lineTo(b, bot); ctx.closePath();
    ctx.globalAlpha = 0.4; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    if (x.b0 != null) {
      const k0 = X(x.b0), k1 = Math.max(X(x.b1), k0 + 2);
      ctx.fillStyle = black; ctx.fillRect(k0, top, k1 - k0, bot - top);
      ctx.strokeRect(k0 + 0.5, top, k1 - k0 - 1, bot - top);
    }
  }
}

// ---- the owner's hand edits (paw-ef73.13) ----
// Detection is a proposal. Edits are an overrides list (the project's repeats block: doc.repeats.fades, undoable, saved
// with the project), each a whole transition marked user: true, or {none: true, ts, t1} where the owner removed one.
// Keyed by time overlap, not by id: an edit hides every detected transition it overlaps, so a re-run of the pass (new
// detected list) never undoes it; the detected list itself is never written to.
const overlaps = (a, b, dur) => a.ts < endOf(b, dur) && b.ts < endOf(a, dur);
/** The detected list with the edits laid over it, sorted. */
export function withEdits(detected, edits, dur) {
  if (!edits?.length) return detected;
  const user = edits.filter((e) => e && !e.none && KIND[e.kind] && Number.isFinite(e.ts));
  return [...user, ...detected.filter((d) => !edits.some((e) => e && overlaps(d, e, dur)))].sort((a, b) => a.ts - b.ts);
}
/** The edits after replacing `orig` (a transition of the effective list, or null: a new one) with `next` (null: removed).
 *  The edits that overlap either are dropped; a removal leaves a none mark over orig's span (so the detected one stays
 *  hidden). */
export function replaceFade(edits, orig, next, dur) {
  const hit = (e) => (orig && overlaps(e, orig, dur)) || (next && overlaps(e, next, dur));
  const kept = (edits || []).filter((e) => e && !hit(e));
  if (next) return [...kept, { ...next, user: true }];
  return orig ? [...kept, { none: true, ts: orig.ts, t1: endOf(orig, dur) }] : kept;
}

/** A transition (kind, its first frame ts, first clean frame t1 | null, black [b0, b1) | null) with the derived fields
 *  (frames, last clean frame, darkest frame) worked out at frame duration fm. */
export function makeFade(kind, ts, t1, b0, b1, fm, tm = null, end = null) {
  const f0 = Math.round(ts / fm) - 1, f1 = Math.max(f0 + 2, Math.round((t1 ?? end ?? ts + fm) / fm));
  const dark = b0 != null ? b0 + Math.floor((Math.round((b1 - b0) / fm) - 1) / 2) * fm : kind === 'fade-out' ? (t1 ?? ts) - fm : kind === 'fade-in' ? ts : tm ?? (ts + (t1 ?? ts)) / 2;
  return { kind, f0, f1, t0: ts > 0 ? Math.round(ts - fm) : null, ts, tm: Math.round(Math.max(ts, dark)), t1, b0: b0 ?? null, b1: b0 != null ? b1 : null };
}

/** The handles of x: [{h: 'start' | 'clean' | 'b0' | 'b1', t}] (no clean handle when the video ends inside it). */
export function handlesOf(x) {
  return [{ h: 'start', t: x.ts }, ...(x.b0 != null ? [{ h: 'b0', t: x.b0 }, { h: 'b1', t: x.b1 }] : []), ...(x.t1 != null ? [{ h: 'clean', t: x.t1 }] : [])];
}
// paw-ef73.22: a handle is a small grip drawn INSIDE the fade (GRIP_OFF px in from the end it moves), so it never sits on
// the cut line a fade usually starts at. Grab area: the grip itself plus GRAB_PX; where that overlaps a cut line the cut
// wins, unless the pointer is on the grip proper.
export const GRIP_W = 6, GRIP_OFF = 8, GRAB_PX = 3, CUT_GRAB = 5;
/** The primary grip: the first-clean-frame end (the start when the video ends inside it). Always drawn. */
export const primaryOf = (x) => (x.t1 != null ? 'clean' : 'start');
/** The grips of x on screen: [{x, h, t, gx (px centre), always}]. A fade narrower than 4 * GRIP_OFF px pulls them in. */
export function gripsOf(x, view, w, dur) {
  const a = msToX(view, w, x.ts), b = msToX(view, w, endOf(x, dur)), off = Math.max(0, Math.min(GRIP_OFF, (b - a) / 4));
  return handlesOf(x).map((q) => {
    const px = msToX(view, w, q.t);
    return { x, h: q.h, t: q.t, gx: px + (q.h === 'start' ? off : q.h === 'clean' ? -off : 0), always: q.h === primaryOf(x) };
  });
}
/** The fades' band on the Shots strip [y1, ym): its upper part, {y0, h} px. */
export const fadeBand = (y1, ym) => ({ y0: y1 + 1, h: Math.max(6, Math.min(28, Math.round((ym - y1) * 0.3))) });
/** paw-ef73.18: a cut moves only from its grip: the lower part of the Shots strip, under the fades' band (so a cut's grip
 *  never overlaps a fade's), CUT_REACH px either side of the line. -> {y0, y1} px. */
export const CUT_REACH = 5;
export const cutGrip = (y1, ym) => { const b = fadeBand(y1, ym); return { y0: Math.min(b.y0 + b.h + 3, ym - 6), y1: ym }; };
/** What is under pointer px (px: x within the lane; cuts: [{i, x}] the cut lines' px; band: the pointer is in the fades'
 *  band): {kind: 'handle', x, h, t} | {kind: 'cut', i} | null (the body). The secondary grips answer only while the
 *  pointer is over their fade (the fade's span plus the grip's reach). grip {py, y0, y1} (paw-ef73.18): a cut answers
 *  only on its grip (py in [y0, y1), within CUT_REACH px of its line); without it, anywhere within CUT_GRAB px of the
 *  line. Pure: test/timeline-fade-hit.test.mjs. */
export function hitAt(list, view, w, px, cuts, band, dur, grip = null) {
  const reach = GRIP_W / 2 + GRAB_PX, grips = [];
  if (band) for (const x of list) {
    const a = msToX(view, w, x.ts), b = msToX(view, w, endOf(x, dur)), over = px >= a - reach - GRIP_OFF && px <= b + reach + GRIP_OFF;
    if (b < -20 || a > w + 20) continue;
    for (const g of gripsOf(x, view, w, dur)) if (g.always || over) grips.push(g);
  }
  const near = (lim) => { let best = null, bd = lim + 0.01; for (const g of grips) { const d = Math.abs(g.gx - px); if (d < bd) { bd = d; best = g; } } return best; };
  const on = near(GRIP_W / 2);
  if (on) return { kind: 'handle', x: on.x, h: on.h, t: on.t };
  let ci = null, cd = (grip ? CUT_REACH : CUT_GRAB) + 0.01;
  if (!grip || (grip.py >= grip.y0 && grip.py < grip.y1)) for (const c of cuts) { const d = Math.abs(c.x - px); if (d < cd) { cd = d; ci = c.i; } }
  if (ci != null) return { kind: 'cut', i: ci };
  const g = near(reach);
  return g ? { kind: 'handle', x: g.x, h: g.h, t: g.t } : null;
}

/** x with handle h dragged to t (frame-snapped by the caller), kept in order (start <= black <= clean); null when the
 *  span is gone (a fade in's clean frame dragged back onto its start, a fade out's start onto its end): removed. */
export function dragFade(x, h, t, fm, dur) {
  const end = endOf(x, dur);
  let { ts, t1, b0, b1 } = x;
  if (h === 'start') ts = Math.min(t, b0 ?? end);
  else if (h === 'clean') t1 = Math.max(t, b1 ?? ts);
  else if (h === 'b0') b0 = Math.max(ts, Math.min(t, b1));
  else if (h === 'b1') b1 = Math.min(end, Math.max(t, b0));
  if ((t1 ?? end) - ts < fm / 2) return null;
  if (b0 != null && b1 - b0 < fm / 2) b0 = b1 = null;
  return makeFade(x.kind, ts, t1, b0, b1, fm, x.kind === 'dissolve' ? Math.min(Math.max(x.tm, ts), (t1 ?? end) - fm) : null, end);
}

/** A new fade drawn from a shot's edge: from its start (a fade in, clean at t) or from its end (a fade out from t).
 *  null when it is under a frame. */
export function newFade(edge, shot, t, fm) {
  if (edge === 'in') return t - shot.start_ms >= fm / 2 ? makeFade('fade-in', shot.start_ms, Math.min(t, shot.end_ms), null, null, fm) : null;
  return shot.end_ms - t >= fm / 2 ? makeFade('fade-out', Math.max(t, shot.start_ms), shot.end_ms, null, null, fm) : null;
}

/** The fades at a shot's two edges: {in, out}, each a transition or null. A fade out belongs to the shot it darkens
 *  (the one ending there), a fade in to the one it opens; a dissolve / through-black to both. */
export function edgeFades(shot, list, frameMs, dur) {
  const f = shotFades([shot], list, frameMs, dur)[0];
  return { in: f.in && f.in.x.kind !== 'fade-out' ? f.in.x : null, out: f.out && f.out.x.kind !== 'fade-in' ? f.out.x : null };
}
/** A new fade at a shot's edge with the default length (0.3 s, at most the shot's length, at least a frame): 'in' | 'out'. */
export const DEFAULT_FADE_MS = 300;
export function defaultFade(side, shot, fm) {
  const len = Math.min(Math.max(fm, Math.round(DEFAULT_FADE_MS / fm) * fm), shot.end_ms - shot.start_ms);
  return side === 'in' ? newFade('in', shot, shot.start_ms + len, fm) : newFade('out', shot, shot.end_ms - len, fm);
}

/** Where a click on (or a jump to) the shot starting at t, ending at end, lands: the first clean frame of the fade or
 *  dissolve INTO it (it belongs to the shot: one shot that fades in), else t. A fade out never moves it; nor does a
 *  shot that ends within two frames of that clean frame (the black lead-in scene detection split off). */
export function landingOf(list, t, end, fm, dur) {
  const x = list.find((y) => y.kind !== 'fade-out' && y.t1 != null && y.t1 > t && y.t1 < end - 2 * fm && pairs(y, t, fm, dur));   // a black lead-in shot ending at the clean frame: its own start
  return x ? x.t1 : t;
}

/** Draw the fades on the Shots strip's band [y0, y0 + h): the ramps (transitions.js drawTransitions) and the grips: each
 *  fade's primary grip always (a solid light grip with a dark rim, readable on light and dark scenes), the others on
 *  `hot` (the fade under the pointer) / `sel`; the grip under the pointer (hotH: {x, h}) takes the accent colour. */
export function drawShotFades(ctx, view, w, list, { y0, h, dur, ink, black, hi, sel = null, hot = null, hotH = null }) {
  drawTransitions(ctx, view, w, list, { y0, h, dur, ink, black });
  for (const x of list) {
    const all = x === sel || x === hot;
    for (const g of gripsOf(x, view, w, dur)) {
      if (!g.always && !all) continue;
      const gx = Math.round(g.gx);
      if (gx < -GRIP_W || gx > w + GRIP_W) continue;
      const lit = hotH && hotH.x === x && hotH.h === g.h;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(gx - GRIP_W / 2, y0 - 1.5, GRIP_W, h + 3, 2); else ctx.rect(gx - GRIP_W / 2, y0 - 1.5, GRIP_W, h + 3);
      ctx.fillStyle = lit ? ink : x === sel ? hi : '#E8EAEE'; ctx.fill();
      ctx.strokeStyle = lit ? '#FFFFFF' : 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}
