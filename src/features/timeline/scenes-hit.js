// scenes-hit.js -- paw-ef73.18 (owner: "the drag to select video and drag scene and drag shot and drag is not obvious, it's
// super jank"): one meaning per gesture on the Scenes / Shots strips and the filmstrip, readable before the press. Pure
// (test/scenes-row.test.mjs):
//   a press on a block's body selects (a click) or selects a range (a drag, drawn as a band), never anything else;
//   a cut moves only from its grip (a pill on the line in a strip of its own, under the fades' band and the offer
//     badges, so a grip never overlaps a fade handle or an offer; paw-ef73.28: a cut with no fade handle near grips over
//     the whole Shots strip, the filmstrip's over its whole line, and a grip grows as the pointer comes within NEAR_PX);
//   a fade changes only from its handles (transitions.js hitAt); a cutaway is made by Alt+C / the menu / the small button on
//     the hovered or selected shot, never by a drag.
import { hitAt, fadeBand, cutGrip, gripsOf, CUT_REACH, GRIP_W, GRAB_PX } from './transitions.js';
import { selBox, sceneRange } from './shots.js';

export { CUT_REACH };
export const OFFER_H = 12;   // the offer badges' strip at the top of the Scenes strip (repeat-offers.svelte.js offerAt: y <= 2R + 4)
/** The grip strips: the Scenes strip's (scene boundaries, under the offer badges), the Shots strip's (transitions.js
 *  cutGrip: under the fades' band), the filmstrip's (its middle). -> {y0, y1} px. */
export const scenesGrip = (sh) => ({ y0: OFFER_H + 1, y1: sh });
export const shotsGrip = cutGrip;
// paw-ef73.28: the filmstrip has the height and nothing else on its lines: the whole line is the grip.
export const filmGrip = (h) => ({ y0: 0, y1: h });
/** paw-ef73.28: a cut no fade handle is near grips over the whole Shots strip, not only the strip under the fades' band. */
export const tallGrip = (y1, H) => ({ y0: y1, y1: H });
/** The pointer this near a grip's line (in its strip) grows the grip, before it is on it. */
export const NEAR_PX = 12;
const HANDLE_REACH = GRIP_W / 2 + GRAB_PX;   // transitions.js hitAt: a fade handle answers this far either side
/** The cuts with no fade handle near (none within its reach + CUT_REACH + 2 px of the line). */
export function clearCuts(cuts, fades, view, w, dur) {
  const gx = (fades || []).flatMap((f) => gripsOf(f, view, w, dur).map((g) => g.gx));
  return cuts.filter((c) => gx.every((x) => Math.abs(x - c.x) > HANDLE_REACH + CUT_REACH + 2));
}
/** The cut whose grip is under (px, py): cuts [{i, x (px)}], g {y0, y1}; reach: px either side (NEAR_PX: approach). -> i | -1 */
export function gripAt(cuts, px, py, g, reach = CUT_REACH) {
  if (!(py >= g.y0 && py < g.y1)) return -1;
  let best = -1, bd = reach + 0.01;
  for (const c of cuts) { const d = Math.abs(c.x - px); if (d < bd) { bd = d; best = c.i; } }
  return best;
}
/** A grip's pill (drawn): centred in g on the line at x; bigger when the pointer is on it or near (rowNear / NEAR_PX). */
export const pillOf = (x, g, grow) => { const h = Math.max(4, Math.min(grow ? 28 : 16, g.y1 - g.y0 - 2)), w = grow ? 9 : 6; return { x: x - w / 2, y: (g.y0 + g.y1 - h) / 2, w, h }; };
/** Each Shots-strip cut's grip: the whole strip (tallGrip) when no fade handle is near, else under the band. -> Map i -> {y0, y1} */
export function shotGrips(r) {
  const y1 = r.sh + 1, tall = new Set(clearCuts(r.cuts || [], r.fades, r.view, r.w, r.dur).map((c) => c.i));
  return new Map((r.cuts || []).map((c) => [c.i, tall.has(c.i) ? tallGrip(y1, r.H) : cutGrip(y1, r.H)]));
}
/** The grip the pointer is near (within NEAR_PX of its line, in its strip), to grow it: {i, strip} | null. r as rowHit. */
export function rowNear(r) {
  const { px, py, sh } = r;
  if (py < sh + 1) { const i = gripAt(r.sceneCuts || [], px, py, scenesGrip(sh), NEAR_PX); return i > 0 ? { i, strip: 'scenes' } : null; }
  const G = shotGrips(r);
  let best = null, bd = NEAR_PX + 0.01;
  for (const c of r.cuts || []) { const g = G.get(c.i), d = Math.abs(c.x - px); if (py >= g.y0 && py < g.y1 && d < bd) { bd = d; best = { i: c.i, strip: 'shots' }; } }
  return best;
}

/** The small buttons on shot rect r ({x0, x1, y0, y1, cut}: layerRects), clear of the cut grips at both ends (paw-2lp7.4): a
 *  plain shot 'cutaway' / 'offscreen' (the two marks) in the Shots strip's grip strip g; a card along its top 'convert' (to the
 *  other mark), 'timing' (the bridge's option; on = set) and, when `extend` (no action over it, one next to it), 'extend'
 *  (carry the action across). [] when the shot is too narrow. -> [{id, label, x0, x1, y0, y1, on}] */
export function shotButtons(r, g, { timing = false, extend = false } = {}) {
  const right = r.x1 - CUT_REACH - 3, y0 = r.cut ? r.y0 + 2 : g.y0 + 1, y1 = Math.min(r.cut ? r.y1 - 2 : g.y1 - 2, y0 + (r.cut ? 11 : 12));
  if (y1 - y0 < 7) return [];
  const want = !r.cut ? [['cutaway', '⤒ cutaway', 52], ['offscreen', '⤒ off-screen', 62]]
    : [['convert', r.cut === 'offscreen' ? '→ cutaway' : '→ off-screen', r.cut === 'offscreen' ? 52 : 62], ['timing', 'timing', 36], ...(extend ? [['extend', 'carry ↔', 44]] : [])];
  const need = want.reduce((n, [, , bw]) => n + bw + 2, 0);
  if (right - (r.x0 + CUT_REACH + 3) < need + 8) return [];
  let x = right;
  return want.map(([id, label, bw]) => { const b = { id, label, x0: x - bw, x1: x, y0, y1, on: id === 'timing' && timing }; x -= bw + 2; return b; });
}
const inBox = (b, px, py) => px >= b.x0 && px < b.x1 && py >= b.y0 && py < b.y1;

/**
 * What a press / the pointer at (px, py) is on in the Scenes row, in this order:
 *   {kind: 'offer', o}                         an offer badge (Scenes strip, top);
 *   {kind: 'button', b, shot}                  a button on the hovered / selected shot (placed off the cut grips);
 *   {kind: 'handle', x, h, t}                  a fade's handle (Shots strip, the fades' band);
 *   {kind: 'cut', i, strip}                    a cut's grip: strip 'scenes' (a scene boundary, Scenes strip) | 'shots';
 *   {kind: 'proposal', p}                      a proposed cutaway's raised part (over the Scenes strip);
 *   {kind: 'body', strip, card}                anything else: a scene block ('scenes') or a shot ('shots'; card = the
 *                                              raised cutaway's index when the press is on its part over the Scenes strip).
 * r: {px, py, sh (the Scenes strip's height; the Shots strip is [sh + 1, H)), H, w, view, dur, fades (transitions),
 *   cuts: [{i, x}] every cut's line px, sceneCuts: [{i, x}] the scene boundaries', buttons: [{...shotButtons, shot}],
 *   offerAt(px, py) -> o | null, proposalAt(px, py) -> p | null, cardAt(px, py) -> i | -1}.
 */
export function rowHit(r) {
  const { px, py, sh, H } = r, y1 = sh + 1;
  const o = py < y1 ? r.offerAt?.(px, py) : null;
  if (o) return { kind: 'offer', o };
  const btn = (r.buttons || []).find((q) => inBox(q, px, py));
  if (btn) return { kind: 'button', b: btn, shot: btn.shot };
  if (py < y1) {
    const card = r.cardAt?.(px, py) ?? -1;
    const i = card >= 0 ? -1 : gripAt(r.sceneCuts || [], px, py, scenesGrip(sh));
    if (i > 0) return { kind: 'cut', i, strip: 'scenes' };
    const p = r.proposalAt?.(px, py);
    if (p) return { kind: 'proposal', p };
    return card >= 0 ? { kind: 'body', strip: 'shots', card } : { kind: 'body', strip: 'scenes' };
  }
  const b = fadeBand(y1, H), inBand = py >= b.y0 - 2 && py < b.y0 + b.h + 2;
  const hit = hitAt(r.fades || [], r.view, r.w, px, r.cuts || [], inBand, r.dur, { py, ...cutGrip(y1, H) });
  if (hit?.kind === 'handle') return hit;
  if (hit?.kind === 'cut') return { kind: 'cut', i: hit.i, strip: 'shots' };
  const i = gripAt(clearCuts(r.cuts || [], r.fades, r.view, r.w, r.dur), px, py, tallGrip(y1, H));   // paw-ef73.28
  if (i > 0) return { kind: 'cut', i, strip: 'shots' };
  return { kind: 'body', strip: 'shots', card: -1 };
}

/** The selection a range drag over [t0, t1) gives (shots.js selBox: the shots it touches; mode 'replace' | 'add' | 'sub');
 *  from the Scenes strip, their whole scenes. */
export function boxSelect(list, t0, t1, mode, sel0, strip) {
  const s = selBox(list, t0, t1, mode, sel0);
  if (strip !== 'scenes' || !s.shots.length || mode === 'sub') return s;
  const lo = sceneRange(list, s.shots[0])[0], hi = sceneRange(list, s.shots[s.shots.length - 1])[1];
  return { active: s.active, shots: [...new Set([...s.shots, ...Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)])].sort((a, b) => a - b) };
}
