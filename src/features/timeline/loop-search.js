// loop-search.js -- the sidecar's loop search run by itself after Detect scenes (paw-ef73.10), pure: which shots it looks
// in and what a result becomes. The repeated frames (repeat-offers.svelte.js markAutoLoops) mark exact loops first; the
// search covers the shots they left without a loop. Its finds go on their shots (the Shots row) as automatic loops (the same `auto`
// handling: dashed, x removes it and the shot is not searched again, doc.repeats.off), marked approximate: the period
// is measured, the start is the shot's.

/** The key of the search's loop in shot s (doc.repeats.off holds it once the owner removed that loop). */
export const searchKey = (s) => `search:${Math.round(s.start_ms)}`;

const spanEnd = (l) => Math.max(l.t1, l.tiledTo || 0, l.auto?.end || 0);
/** Shot indices to search: no loop of any kind over it, no search result on it yet (s.loop), its loop not removed. */
export function searchTargets(list = [], loops = [], off = []) {
  const gone = new Set(off);
  return list.flatMap((s, i) => (s.loop || gone.has(searchKey(s)) || loops.some((l) => l.t0 < s.end_ms && s.start_ms < spanEnd(l)) ? [] : [i]));
}

/** A search result r for shot s -> the Loops-row loop, or null: no period, under minConfidence (the scene option
 *  loop_min_confidence), or fewer than 2 passes in the shot. */
export function searchLoop(s, r, { minConfidence = 0.5, id = '' } = {}) {
  const conf = +r?.confidence || 0, P = r?.period_ms ?? r?.motion_period_ms;
  if (!r || conf < minConfidence || !(P > 0)) return null;
  const n = Math.min(r.cycles || Infinity, Math.floor((s.end_ms - s.start_ms) / P));
  if (!(n >= 2)) return null;
  const t0 = Math.round(s.start_ms), t1 = Math.round(t0 + P);
  return { id, t0, t1, auto: { key: searchKey(s), t0, t1, end: Math.round(t0 + n * P), n, approx: true, confidence: Math.round(conf * 100) / 100 } };
}
