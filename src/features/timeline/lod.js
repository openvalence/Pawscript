// lod.js -- paw-tog0 (owner: "you have to zoom in far to get to handles and names and markers to appear"): the timeline rows'
// level of detail, in one place (test/lod.test.mjs). A mark is never hidden by the zoom as a whole (one 6-frame shot anywhere
// used to turn every grip and number of the Shots strip off): each mark is kept while it has room, marks that would collide
// are thinned by priority (selected / hovered / near the pointer always, cuts before camera moves), a label takes its parts
// while they fit its room and keeps a few letters behind an ellipsis before it goes.

/** Greedy thinning: items [{x0, x1, pri = 0, force, skip}] (px), each kept when it stays `gap` px clear of every kept one; forced
 *  items first and always, then by priority, then left to right; skip: never kept. -> boolean[] (kept), in items' order. */
export function thin(items, gap = 0) {
  const order = items.map((_, i) => i).sort((a, b) => (items[b].force ? 1 : 0) - (items[a].force ? 1 : 0) || (items[b].pri ?? 0) - (items[a].pri ?? 0) || items[a].x0 - items[b].x0);
  const keep = new Array(items.length).fill(false), kept = [];   // kept: [x0, x1] sorted by x0
  for (const i of order) {
    const { x0, x1, force, skip } = items[i];
    if (skip) continue;
    let lo = 0, hi = kept.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (kept[m][0] < x0) lo = m + 1; else hi = m; }
    if (!force && ((lo > 0 && kept[lo - 1][1] + gap > x0) || (lo < kept.length && x1 + gap > kept[lo][0]))) continue;
    kept.splice(lo, 0, [x0, x1]); keep[i] = true;
  }
  return keep;
}

/** Two drawn grips (6 px pills, scenes-hit.js pillOf) stay this far apart; closer, the lower priority one is a plain line
 *  until the pointer comes near it (rowNear grows it: it is drawn whenever it is the one a press would take). */
export const GRIP_GAP = 8;
/** The boundaries whose grip is drawn: cuts [{i, x, move, force}] (sorted by x) -> Set(i). force: selected, hovered, near the
 *  pointer (always drawn). A boundary crowded on both sides (a run of shots under `gap` px: a long video zoomed out) is a
 *  plain line, so the run reads as lines and numbers, not a comb of pills; two that crowd only each other (a very short
 *  shot) keep one grip, the cut's before a camera move's. */
const denseAt = (cuts, k, gap) => k > 0 && k < cuts.length - 1 && cuts[k].x - cuts[k - 1].x < gap && cuts[k + 1].x - cuts[k].x < gap;
/** paw-7gwt: the cuts a press may take by their grip: cuts [{i, x, force}] (sorted by x) minus the crowded ones shownGrips draws as
 *  plain lines (a forced one, the selected cut, stays). Zoomed out on a long video every x is within reach of some cut: a press
 *  there selects shots, it does not grab a line that shows no grip. */
export const grippable = (cuts, gap = GRIP_GAP) => cuts.filter((c, k) => c.force || !denseAt(cuts, k, gap));
export function shownGrips(cuts, gap = GRIP_GAP) {
  const dense = (k) => denseAt(cuts, k, gap);
  const keep = thin(cuts.map((c, k) => ({ x0: c.x, x1: c.x, pri: c.move ? 0 : 1, force: !!c.force, skip: !c.force && dense(k) })), gap);
  return new Set(cuts.filter((c, k) => keep[k]).map((c) => c.i));
}

/** The labels along a strip: items [{x (start px), room (px it may run to), parts: [advance px] (the number first, then its
 *  glyphs), pri, force}]. Each takes its parts while they fit its room (no number: no label); labels that would overlap are
 *  thinned (thin, `gap` px). -> parts shown per item (0 = none). */
export function layoutLabels(items, gap = 3) {
  const n = items.map((it) => { let x = it.x, k = 0; for (const p of it.parts) { if (x + p > it.room) break; x += p; k++; } return k; });
  const idx = items.map((_, j) => j).filter((j) => n[j] > 0);
  const keep = thin(idx.map((j) => ({ x0: items[j].x, x1: items[j].x + items[j].parts.slice(0, n[j]).reduce((a, b) => a + b, 0), pri: items[j].pri ?? 0, force: items[j].force })), gap);
  const out = new Array(items.length).fill(0);
  idx.forEach((j, k) => { if (keep[k]) out[j] = n[j]; });
  return out;
}

/** paw-h2e2: where a `need` px wide control fits on a row without lying over anything that takes the pointer: busy [[x0, x1]]
 *  (px, any order, may run past the row), the row 0..right. -> the left px of the slot at the right end of the right-most free
 *  stretch that holds it, or null (no room: the caller folds the control away). */
export function freeSlot(busy, right, need) {
  let end = right;
  for (const [a, b] of [...busy].sort((p, q) => q[1] - p[1])) {   // by right end, right-most first
    if (b < end) { if (end - Math.max(0, b) >= need) return end - need; }
    end = Math.min(end, a);
    if (end < need) return null;
  }
  return end >= need ? end - need : null;
}

// text widths, cached per font (canvas measureText is the cost of a dense row): cleared when it grows past a few thousand
const widths = new Map();
/** ctx.measureText(s).width for ctx's current font, cached. */
export function textW(ctx, s) {
  const k = ctx.font + '\u0000' + s;
  let v = widths.get(k);
  if (v === undefined) { if (widths.size > 4000) widths.clear(); widths.set(k, (v = ctx.measureText(s).width)); }
  return v;
}
/** text fitted into room px: whole, else cut with an ellipsis keeping at least `min` characters, else ''. */
export function fitText(ctx, text, room, min = 3) {
  if (!text || !(room > 0)) return '';
  if (textW(ctx, text) <= room) return text;
  let lo = 0, hi = text.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (textW(ctx, text.slice(0, m).trimEnd() + '…') <= room) lo = m; else hi = m - 1; }
  return lo >= Math.min(min, text.length) ? text.slice(0, lo).trimEnd() + '…' : '';
}
