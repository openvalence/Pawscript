// repeats.js -- repeated frames (paw-6dno), pure: the backend's buckets (media_repeats, src-tauri/src/repeats.rs: one
// bucket = one picture that occurs more than once, exactly, no transform) indexed for lookups, the loops they form
// (paw-8yip) and their families (paw-llaa); what the ruler draws of them: loop-marks.js. State and loading: repeats.svelte.js (the module the rest of the
// app reads).
import { clockOf, frameAt, frameTime } from '../../lib/lane.js';

/** paw-kxz4: an occurrence on the player's frames. The backend numbers DECODED frames and dates them by the file's frame table
 *  (or n x the probe's frame length when the table does not line up, or by an older build's rule: a cached result keeps its
 *  numbers): when the clock counts the same frames, decoded frame f IS clock frame f; else the frame containing t_ms. Its time
 *  is that frame's start on the clock (integer ms, as structure is stored), so the ticks, the loop bars, a click / drag to the
 *  loop frame and every consumer pairing passes by picture sit on the video's real frames. No grid: as the backend said. */
export function onClock(o, grid, frames) {
  const c = clockOf(grid);
  if (!c) return { f0: o.f0, f1: o.f1, t: o.t_ms };
  const f = c.count === frames ? o.f0 : frameAt(o.t_ms, grid);
  return { f0: f, f1: f + o.f1 - o.f0, t: frameTime(f, grid) };
}

/** Backend result {frames, exact, buckets: [[{f0, f1, t_ms}]]} -> {frames, exact, buckets: [{id, occ: [{f0, f1, t}]}],
 *  occ: every occurrence sorted by f0, each {f0, f1, t, id}, loops (findLoops), loopOf: bucket id -> loop index}. grid: the
 *  player's clock (lane.js gridOf), every occurrence on its frames (onClock). */
export function indexRepeats(r, grid = 0) {
  const buckets = (r?.buckets || []).map((list, id) => ({ id, occ: list.map((o) => ({ ...onClock(o, grid, r.frames), id })) }));
  const occ = buckets.flatMap((b) => b.occ).sort((a, b) => a.f0 - b.f0);
  const loops = findLoops(buckets), loopOf = new Map();
  loops.forEach((l, k) => l.members.forEach((id) => loopOf.set(id, k)));
  return { frames: r?.frames || 0, exact: r?.exact ?? null, buckets, occ, loops, loopOf, family: loopFamilies(buckets, loops) };
}

/** paw-llaa: findLoops loops that are one cycle -> one family. A loop whose last pass stops part-way (a cut mid-cycle, the
 *  same footage again in another shot) leaves its later pictures one occurrence short, so findLoops (same count) splits the
 *  cycle in two: each half drew its own colour of ticks on the ruler (the owner's "second purple" between the orange). Two
 *  loops are one family when the later one's first picture sits at one offset (+-1 frame) after the earlier one's, inside
 *  its cycle, in >= 80 % of the passes they share. -> Map loop key -> family key (the earliest loop's key). */
export function loopFamilies(buckets, loops = []) {
  const fam = new Map(loops.map((l) => [l.key, l.key]));
  const F = loops.map((l) => buckets[l.members[0]].occ.map((o) => o.f0));
  const gap = F.map((f) => { let g = Infinity; for (let i = 1; i < f.length; i++) g = Math.min(g, f[i] - f[i - 1]); return g; });
  const near = (f, x) => { let lo = 0, hi = f.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m] < x - 1) lo = m + 1; else if (f[m] > x + 1) hi = m - 1; else return true; } return false; };
  for (let b = 1; b < loops.length; b++) for (let a = 0; a < b; a++) {
    if (fam.get(loops[a].key) !== loops[a].key) continue;   // join roots only
    const A = F[a], B = F[b], prev = A.filter((x) => x <= B[0]).at(-1);
    if (prev == null) continue;
    const d = B[0] - prev;
    if (!(d > 0 && d < gap[a])) continue;
    let hit = 0;
    for (const x of B) if (near(A, x - d)) hit++;
    if (hit >= 2 && hit >= 0.8 * Math.min(A.length, B.length)) { fam.set(loops[b].key, loops[a].key); break; }
  }
  return fam;
}
/** A family's pictures: the bucket ids of every findLoops loop in it. */
export const familyMembers = (ix, key) => (ix?.loops || []).filter((l) => (ix.family?.get(l.key) ?? l.key) === key).flatMap((l) => l.members);
/** The family key of bucket id's loop, or -1. */
export const familyOf = (ix, id) => { const L = loopOfBucket(ix, id); return L ? ix.family?.get(L.key) ?? L.key : -1; };

/** Loops: in a perfect loop every frame repeats, so its buckets share one occurrence pattern shifted by a few frames.
 *  Buckets with the same number of occurrences whose i-th occurrences all sit at one offset (+-1 frame) from the first
 *  bucket's, inside its first iteration (offset < the shortest gap between its occurrences), are one loop; 2+ buckets.
 *  -> [{key: the first member's id (stable: names the loop in the project), members: bucket ids in phase order, n:
 *  iterations}], in time order. A bucket that also shows up outside the loop (one occurrence more) stays on its own. */
export function findLoops(buckets) {
  const open = [];
  for (const b of [...buckets].sort((x, y) => x.occ[0].f0 - y.occ[0].f0)) {
    const n = b.occ.length, f = (o, i) => o.occ[i].f0;
    const L = open.find((l) => {
      if (l.n !== n) return false;
      const d = f(b, 0) - f(l.first, 0);
      if (!(d > 0 && d < l.minGap)) return false;
      for (let i = 1; i < n; i++) if (Math.abs(f(b, i) - f(l.first, i) - d) > 1) return false;
      return true;
    });
    if (L) { L.members.push(b.id); continue; }
    let minGap = Infinity;
    for (let i = 1; i < n; i++) minGap = Math.min(minGap, f(b, i) - f(b, i - 1));
    open.push({ first: b, n, minGap, members: [b.id] });
  }
  return open.filter((l) => l.members.length >= 2).map((l) => ({ key: l.first.id, members: l.members, n: l.n }));
}

/** The occurrence covering frame f (its held run f0..f1), or null. */
export function occurrenceAt(ix, f) {
  const o = ix?.occ || [];
  let lo = 0, hi = o.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (o[m].f0 <= f) lo = m + 1; else hi = m - 1; }
  return hi >= 0 && o[hi].f1 >= f ? o[hi] : null;
}
/** paw-w7wr: time -> the id of the repeated picture shown then (-1: it does not repeat), for the Detail (stroke-shape.js
 *  PICTURES: a loop's passes get one layout); null without repeats. frameMs = the video's frame duration. */
export function pictureAt(ix, frameMs = 1000 / 30) {
  const o = ix?.occ || [];
  if (!o.length) return null;
  return (ms) => {
    let lo = 0, hi = o.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (o[m].t <= ms + frameMs / 2) lo = m + 1; else hi = m - 1; }
    return hi >= 0 && ms <= o[hi].t + (o[hi].f1 - o[hi].f0 + 0.5) * frameMs ? o[hi].id : -1;
  };
}
/** Frame -> bucket id, -1 when the frame's picture does not repeat. */
export const bucketOf = (ix, f) => occurrenceAt(ix, f)?.id ?? -1;
/** Bucket id -> its occurrences [{f0, f1, t}] in time order ([] for an unknown id). */
export const occurrencesOf = (ix, id) => ix?.buckets[id]?.occ ?? [];
/** Bucket id -> its loop {key, members, n} or null. */
export const loopOfBucket = (ix, id) => (ix?.loopOf?.has(id) ? ix.loops[ix.loopOf.get(id)] : null);

/** Where the loops' ticks and the carets sit in the ruler (paw-llaa, Ruler.svelte): from REPEAT_Y px (the shell's row
 *  splitter takes the top 4 px of a row); a pointer above REPEAT_HIT (+ a little slack) counts as on them. */
export const REPEAT_Y = 4;
export const REPEAT_HIT = 9;

const GOLDEN = 137.50776405;   // degrees: consecutive ids land far apart on the hue circle, no id ever repeats a hue
/** A bucket's colour: hue from the id by the golden angle (stable per id), lightness for the theme's ground. */
export function bucketColor(id, light = false) {
  const h = ((id * GOLDEN) % 360).toFixed(1);
  return light ? `hsl(${h} 85% 38%)` : `hsl(${h} 80% 64%)`;
}

/** Where an occurrence's held run ends: the start of the frame after its last (frameMs: the grid, lane.js). */
export const runEnd = (o, frameMs) => (clockOf(frameMs) ? frameTime(o.f1 + 1, frameMs) : o.t + (o.f1 - o.f0 + 1) * frameMs);
