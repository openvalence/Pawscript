// repeat-scenes.js -- repeated frames (repeats.js) as evidence for the scene structure (paw-ef73.4), pure. Four rules,
// each measured on the owner's four projects (numbers in the commit / bead):
//   falseMoves   a camera-move boundary (split 'camera') whose frames on both sides are one loop, phase continuous:
//                the cycle simply continues across it (a moving close-up read as a zoom / pan). exact -> joined after
//                detection; weak (both sides repeat, or the two shots share pictures) -> a one-press offer.
//   cutSnaps     a hard cut 1-2 frames from where the pictures change: the frames just before it already belong to the
//                next shot's pictures (or the frames just after it to the previous shot's) -> a one-press snap.
//   sameFootage  shots in different scenes that show >= SAME_MIN of the same pictures -> "same scene as m:ss" offer.
//   autoLoops    every loop findLoops finds, as a Loops-row loop (one cycle, its iterations' extent).
// Times are ms; ix = repeats.js indexRepeats; list = the flat shots (timeline/shots.js).
import { frameAt, frameTime } from '../../lib/lane.js';
import { mergeScenesIn, shotLabel } from './shots.js';

/** Shared pictures that make two shots the same footage (the direction rule's floor, paw-zl3n; see the commit). */
export const SAME_MIN = 3;

/** The occurrence {f0, f1, t, id} shown at time ms, or null (pictureAt's lookup, returning the occurrence). */
export function occurrenceAtMs(ix, ms, frameMs = 1000 / 30) {
  const o = ix?.occ || [];
  let lo = 0, hi = o.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (o[m].t <= ms + frameMs / 2) lo = m + 1; else hi = m - 1; }
  return hi >= 0 && ms <= o[hi].t + (o[hi].f1 - o[hi].f0 + 0.5) * frameMs ? o[hi] : null;
}

/** Per shot, the ids of the repeated pictures that start inside it (Set), skipping `edge` frames at each end. */
export function shotPictures(ix, list = [], frameMs = 1000 / 30, edge = 0) {
  const o = ix?.occ || [];
  return list.map((s) => {
    const a = s.start_ms + edge * frameMs - frameMs / 2, b = s.end_ms - edge * frameMs - frameMs / 2, ids = new Set();
    let lo = 0, hi = o.length;   // occ is sorted by frame, so by t: from the first one at a (paw-o60v.6: was a scan from the start per shot)
    while (lo < hi) { const m = (lo + hi) >> 1; if (o[m].t < a) lo = m + 1; else hi = m; }
    for (let k = lo; k < o.length && o[k].t < b; k++) ids.add(o[k].id);
    return ids;
  });
}
const shared = (A, B) => { let n = 0; for (const id of A) if (B.has(id)) n++; return n; };

/** Is the picture pair (a just before, b just after) a step of one loop's cycle? Same held picture, or the loop's next
 *  member in the same iteration, or its last member to its first in the next one. -> the loop or null. */
function cycleStep(ix, a, b) {
  const k = ix.loopOf?.get(a.id);
  if (k == null || ix.loopOf.get(b.id) !== k) return null;
  const L = ix.loops[k], ia = ix.buckets[a.id].occ.findIndex((o) => o.f0 === a.f0), ib = ix.buckets[b.id].occ.findIndex((o) => o.f0 === b.f0);
  const ma = L.members.indexOf(a.id), mb = L.members.indexOf(b.id);
  if (a === b || (ia === ib && mb === ma + 1) || (ib === ia + 1 && ma === L.members.length - 1 && mb === 0)) return L;
  return null;
}

/** Camera-move boundaries inside a repeating cycle. -> [{i (the shot after it), t, exact, loop?: key, n: pictures the
 *  two shots share}]; exact = one loop on both sides, phase continuous; else weak (both frames repeat, or the shots share
 *  >= SAME_MIN pictures). Boundaries with no such evidence are left out. */
export function falseMoves(ix, list = [], frameMs = 1000 / 30) {
  if (!ix?.occ?.length) return [];
  const pics = shotPictures(ix, list, frameMs), out = [];
  for (let i = 1; i < list.length; i++) {
    if (list[i].split !== 'camera') continue;
    const t = list[i].start_ms, a = occurrenceAtMs(ix, t - frameMs, frameMs), b = occurrenceAtMs(ix, t, frameMs);
    const L = a && b ? cycleStep(ix, a, b) : null, n = shared(pics[i - 1], pics[i]);
    if (L) out.push({ i, t, exact: true, loop: L.key, n });
    else if ((a && b) || n >= SAME_MIN) out.push({ i, t, exact: false, n });
  }
  return out;
}

/** Hard cuts (not camera moves) 1..max frames from where the pictures change. A frame next to the cut belongs to a side
 *  when its picture recurs inside that side's shot (away from the cut) and not inside the other's. -> [{i, t, to (the
 *  corrected start, ms: a frame start on `grid`, lane.js, when given: paw-kxz4), d (frames: < 0 earlier, > 0 later), n (the
 *  frames' pictures that decided it)}]. */
export function cutSnaps(ix, list = [], frameMs = 1000 / 30, max = 2, grid = 0) {
  if (!ix?.occ?.length) return [];
  const pics = shotPictures(ix, list, frameMs, max), out = [];
  const side = (ms, i) => {   // 1: the next shot's picture, -1: the previous shot's, 0: neither / both / none
    const o = occurrenceAtMs(ix, ms, frameMs);
    if (!o) return 0;
    const p = pics[i - 1].has(o.id), n = pics[i].has(o.id);
    return p === n ? 0 : n ? 1 : -1;
  };
  for (let i = 1; i < list.length; i++) {
    if (list[i].split === 'camera') continue;
    const t = list[i].start_ms;
    let d = 0;
    for (let k = 1; k <= max && side(t - k * frameMs, i) === 1; k++) d = -k;   // frames before the cut show the next shot
    if (!d) for (let k = 0; k < max && side(t + k * frameMs, i) === -1; k++) d = k + 1;   // frames after it show the previous one
    if (!d) continue;
    const to = grid ? frameTime(frameAt(t, grid) + d, grid) : Math.round(t + d * frameMs);
    if (to <= list[i - 1].start_ms || to >= list[i].end_ms) continue;
    out.push({ i, t, to, d, n: Math.abs(d) });
  }
  return out;
}

/** Shots in different scenes (scene runs: join) that share >= min repeated pictures. -> [{a, b (shot indices, a < b),
 *  n}], the best partner first for each b. */
export function sameFootage(ix, list = [], frameMs = 1000 / 30, min = SAME_MIN) {
  if (!ix?.occ?.length) return [];
  const pics = shotPictures(ix, list, frameMs), scene = [];
  list.forEach((s, k) => scene.push(k && s.join === true ? scene[k - 1] : k));
  const out = [];
  for (let b = 1; b < list.length; b++) for (let a = 0; a < b; a++) {
    if (scene[a] === scene[b]) continue;
    const n = shared(pics[a], pics[b]);
    if (n >= min) out.push({ a, b, n });
  }
  return out.sort((x, y) => x.b - y.b || y.n - x.n);
}

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
/** paw-3uyu: the crop links' offers (tracking shotLinks.links, lib/crop-match.js: a shot that is an earlier shot's
 *  footage re-framed): each later shot of a link in another scene, once (its nearest earlier partner), on the scene
 *  boundary in front of its scene, taken like sameFootage's offer. -> offers (repeat-offers.svelte.js offersOf's shape). */
export function cropOffers(list = [], crops = []) {
  const at = (ms) => list.findIndex((s) => Math.abs(s.start_ms - ms) < 1), scene = [], done = new Set(), out = [];
  list.forEach((s, k) => scene.push(k && s.join === true ? scene[k - 1] : k));
  for (const L of [...crops].sort((x, y) => y.a.start_ms - x.a.start_ms)) {
    const a = at(L.a.start_ms), b = at(L.b.start_ms);
    if (a < 0 || b <= a || scene[a] === scene[b] || done.has(b)) continue;
    if (L.via === 'loops' && b - a > 3) continue;   // paw-0zwb: a loop link far away is the same loop reused, not this scene going on (3 = CROP_MATCH.gap)
    done.add(b);
    let k = b; while (k > 0 && list[k].join === true) k--;
    const ta = list[a].start_ms, tb = list[b].start_ms, sa = shotLabel(list, a), sb = shotLabel(list, b);
    out.push({ kind: 'scene', key: `crop:${Math.round(ta)}:${Math.round(tb)}`, t: list[k].start_ms, label: 'Join scenes: same footage (crop)',
      text: `Same footage as shot ${sa} · crop ×${L.scale.toFixed(1)}: shot ${L.tighter === 'b' ? `${sb} is shot ${sa}` : `${sa} is shot ${sb}`}'s picture cropped in (match ${L.score.toFixed(2)}). Click: same scene as ${mmss(ta)} (one scene from ${mmss(ta)} to the end of shot ${sb}) · right-click: no, another scene`,
      run: (l) => mergeScenesIn(l, ta, l.find((s) => Math.abs(s.start_ms - tb) < 1)?.end_ms ?? tb + 1) });
  }
  return out;
}

/** Back-to-back passes a loop needs to be marked: a picture recurring at one period twice in a row. Two passes alone
 *  are mostly the same footage used again elsewhere (a cut-back), not a cycle (see the commit). */
export const MIN_PASSES = 3;

/** The loops findLoops found (ix.loops), as Loops-row loops. A findLoops loop is n passes of the same pictures, anywhere
 *  in the video; a Loops-row loop is the stretch where they come back to back: runs of its first picture's occurrences at
 *  a steady period (each gap within max(2 frames, 10 %) of the one before), >= MIN_PASSES. Overlapping runs (one cycle
 *  seen through pictures shown once or twice per cycle) keep the one with the most pictures. -> [{key ('<loop key>:<first
 *  pass>', stable for a video), t0 (the first pass), t1 (one period later), end (the last pass's end: one period after
 *  its start, or the frame after the run's last picture when that is earlier), n (passes),
 *  members}], in time order. grid (lane.js, the clock the index is on): t1 / end on its frame starts (paw-kxz4). */
export function autoLoops(ix, frameMs = 1000 / 30, grid = 0) {
  const cand = [];
  for (const L of ix?.loops || []) {
    const F = ix.buckets[L.members[0]].occ;
    let r0 = 0;
    for (let k = 1; k <= F.length; k++) {
      const g = k < F.length ? F[k].f0 - F[k - 1].f0 : null, prev = k >= 2 ? F[k - 1].f0 - F[k - 2].f0 : null;
      if (g != null && (k === r0 + 1 || Math.abs(g - prev) <= Math.max(2, prev * 0.1))) continue;
      const n = k - r0;   // passes F[r0..k-1]
      if (n >= MIN_PASSES) {
        const P = (F[k - 1].t - F[r0].t) / (n - 1), Pf = Math.round((F[k - 1].f0 - F[r0].f0) / (n - 1));
        const at = (o, dt) => (grid ? frameTime(o.f0 + Pf, grid) : Math.round(o.t + dt));
        // paw-fc0r: the end is where the run's pictures stop when that comes before the last pass + one cycle (a last pass
        // cut short: the bar no longer reaches across the cut into the next shot)
        // and the start is the run's first picture: a run that begins mid-cycle (right after a cut) shows its other
        // pictures up to a cycle before its first picture's first pass
        let last = null, first = F[r0];
        for (const id of L.members) for (const o of ix.buckets[id].occ) {
          if (o.f0 >= F[r0].f0 && o.f0 < F[k - 1].f0 + Pf && (!last || o.f1 > last.f1)) last = o;
          if (o.f0 < first.f0 && o.f0 > F[r0].f0 - Pf) first = o;
        }
        const stop = last && (grid ? frameTime(last.f1 + 1, grid) : Math.round(last.t + (last.f1 - last.f0 + 1) * frameMs));
        cand.push({ key: `${L.key}:${r0}`, t0: Math.round(first.t), t1: at(first, P), end: Math.min(at(F[k - 1], P), stop ?? Infinity), n, members: L.members.length });
      }
      r0 = k;
    }
  }
  // overlapping = more than half a cycle in common (the last pass's end is an estimate: neighbours may touch)
  const clash = (a, b) => Math.min(a.end, b.end) - Math.max(a.t0, b.t0) > Math.min(a.t1 - a.t0, b.t1 - b.t0) / 2;
  const out = [];
  for (const c of cand.sort((a, b) => b.members - a.members || (b.end - b.t0) - (a.end - a.t0))) if (!out.some((o) => clash(o, c))) out.push(c);
  return out.sort((a, b) => a.t0 - b.t0);
}
