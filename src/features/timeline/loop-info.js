// loop-info.js -- what a loop is, in footage and words (paw-ef73.7), pure. A loop's footage group is the repeated-frame
// group it plays (repeats.js: a findLoops loop's family key, paw-llaa, else the first repeating picture's bucket id), so
// loops of the same footage match wherever they are (one colour: loop-marks.js loopColorIndex) and unrelated ones differ.
// A hand-made loop with no repeated frames under it has no group (-1).
import { bucketOf, loopOfBucket, occurrencesOf } from './repeats.js';
import { frameAt, frameLen } from '../../lib/lane.js';

const SCAN = 3000;   // frames of a loop's cycle looked at (a 100 s cycle at 30 fps)

/** The footage group of loop l: an automatic loop's own (auto.key '<loop key>:<pass>'), else the first repeated picture
 *  in its cycle: that picture's findLoops loop, else its bucket id; a findLoops loop by its family's key (repeats.js
 *  loopFamilies: the two halves of a cycle cut mid-pass are one footage); -1 = none (or no repeats index). */
export function loopGroup(ix, l, frameMs = 1000 / 30) {
  const k = l?.auto?.key != null ? parseInt(String(l.auto.key).split(':')[0], 10) : NaN;
  if (Number.isFinite(k) && /^\d+:/.test(String(l.auto.key))) return ix?.family?.get(k) ?? k;
  if (!ix || !l) return -1;
  const f0 = frameAt(l.t0, frameMs), f1 = Math.min(frameAt(l.t1, frameMs), f0 + SCAN);   // frameMs: the grid (the repeats index is on its frames)
  let first = -1;
  for (let f = f0; f < f1; f++) {
    const b = bucketOf(ix, f);
    if (b < 0) continue;
    const L = loopOfBucket(ix, b);
    if (L) return ix.family?.get(L.key) ?? L.key;
    if (first < 0) first = b;
  }
  return first;
}

/** When the group's footage is first seen (ms), from the repeats index; null without one. */
export const firstSeen = (ix, group) => (group >= 0 ? occurrencesOf(ix, group)[0]?.t ?? null : null);

/** Passes of a loop: an automatic one's, a tiled one's whole cycles, else 1. */
export function passesOf(l, P = l.t1 - l.t0) {
  if (l.auto && !(l.tiledTo > l.t1)) return l.auto.n || 1;
  if (l.tiledTo > l.t1 && P > 0) return Math.max(1, Math.round((l.tiledTo - l.t0) / P));
  return 1;
}

const mss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const shotWords = (lab) => `shot ${lab}`;   // paw-2lp7.5: shots numbered 1, 2, 3 through the video

/** Loop l in words. c: {frameMs, auto (an untouched automatic loop), P (cycle ms), group, others: [{t0, group}] (the other
 *  loops), seen (firstSeen of the group, ms | null), shotAt(t) -> '3.2' | '3' | '', pick (its preferred frame, frames into
 *  the cycle; paw-llaa)}. -> {short (on the loop in the Shots row: "8 f × 28"), long (its tip and the Inspector), origin:
 *  {shot, t} | null (the footage first seen in an earlier shot)}. */
export function loopWords(l, c) {
  const fm = frameLen(c.frameMs) || 1000 / 30, P = c.P || l.t1 - l.t0, frames = Math.round(P / fm), n = passesOf(l, P);
  const shot = c.shotAt?.(l.t0) || '';
  const same = c.group >= 0 ? (c.others || []).filter((o) => o.group === c.group && o.t0 !== l.t0).map((o) => o.t0).sort((a, b) => a - b) : [];
  const early = [c.seen, ...same].filter((t) => t != null && t < l.t0 - P / 2);
  const ot = early.length ? Math.min(...early) : null, oshot = ot != null ? c.shotAt?.(ot) || '' : '';
  const origin = ot != null && oshot && oshot !== shot ? { shot: oshot, t: ot } : null;
  const ap = !!(c.auto && l.auto?.approx);   // paw-ef73.10: found by the sidecar's loop search, not from repeated pictures
  const short = `${ap ? '~' : ''}${frames} f × ${n}`;
  const long = [
    ap ? `Approximate loop of about ${frames} frames, ${n} passes, found by the loop search (confidence ${l.auto.confidence ?? '?'})${shot ? ` in ${shotWords(shot)}` : ''}; it starts at the shot's start.`
      : `${c.auto ? 'Automatic loop' : 'Loop'} of ${frames} frame${frames === 1 ? '' : 's'}, ${n} pass${n === 1 ? '' : 'es'}${c.auto ? ', found from the repeated frames' : ''}${shot ? ` in ${shotWords(shot)}` : ''}.`,
    origin && `Same loop as shot ${origin.shot} (${mss(origin.t)}).`,
    same.length && `The same loop also plays at ${andList(same.map(mss))}.`,
    c.pick != null && frames > 1 && `Preferred frame: ${c.pick + 1} of ${frames} (drag its tick on the ruler).`,
    c.auto && '× removes it; move, resize or tile it to make it yours.',
  ].filter(Boolean).join(' ');
  return { short, long, origin };
}
