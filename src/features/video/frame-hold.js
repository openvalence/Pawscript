// frame-hold.js -- a little hysteresis for the smooth scrub (paw-ef73.22, owner: "if you are between frames when moving it's
// one, when still it's another"): the frame shown is the frame whose span CONTAINS the playhead time (clock.frameAt), but a
// pointer resting on a frame boundary must not flip between the two frames from a pixel of hand jitter. So while scrubbing the
// shown frame only changes once the time has moved past the boundary by SCRUB_HOLD of a frame / one pixel's worth of time
// (the larger). The pink playhead itself keeps following the pointer exactly. Pure; the Player keeps the held frame.

/** The hold margin as a fraction of a frame (and never less than one pixel of time at the current zoom). */
export const SCRUB_HOLD = 0.1;
/** ms: max(1 px worth of time, SCRUB_HOLD of a frame), but never so wide that a pointer moving one pixel at a time jumps over a
 *  frame: margin + 1 px must stay inside a frame (less the clock's TOL_MS early acceptance), so once a pixel is more than half a
 *  frame the margin shrinks, and from a pixel per frame on there is none (every pixel is another frame anyway). paw-bf4o: one
 *  full pixel of margin on a long video (a pixel = a frame or more) held the frame for a pixel and then jumped two ("some
 *  frames get skipped entirely", "one pixel then back and forth"). pxMs = view.span / lane width (0 / unknown: the fraction). */
export const holdMargin = (pxMs, frameMs) => {
  const px = Number.isFinite(pxMs) && pxMs > 0 ? pxMs : 0;
  return Math.max(0, Math.min(Math.max(px, SCRUB_HOLD * frameMs), frameMs - px - 1));
};

/** The frame to show for time t while scrubbing: `prev` (the frame showing, -1 = none) while t is still within `margin` of its
 *  span, else the frame containing t. clock: makeClock (frameAt, timeOf, endOf). */
export function holdFrame(prev, t, clock, margin) {
  const n = clock.frameAt(t);
  // prev's span as the clock reads it (TOL_MS early accepted), widened by the margin: a margin of 0 never holds (paw-bf4o)
  if (prev >= 0 && n !== prev && clock.frameAt(t - margin) <= prev && clock.frameAt(t + margin) >= prev) return prev;
  return n;
}
/** The time to ask a frame source (the scrubber's own sample table, the <video>) for frame n: the middle of its span. The
 *  file's sample times are rounded to its timescale (22, 22, 23 ms at 45 fps), so near a frame's start they disagree with
 *  the clock by up to a tick: asking with the pointer's own time showed the frame before (owner: "one frame early then next
 *  then back when going slow ... fine for a few frames then back to that behavior"). */
export const askTime = (n, clock) => (clock.timeOf(n) + clock.endOf(n)) / 2;
/** Where the stored playhead rests after the release: t itself when it is inside the frame showing, else nudged just inside it. */
export function settleInside(t, n, clock) {
  const a = clock.timeOf(n), b = clock.endOf(n);
  return t >= a && t < b ? t : t < a ? a : Math.max(a, b - 1)   // (the clock accepts TOL_MS early: 1 ms in is safely this frame);
}
