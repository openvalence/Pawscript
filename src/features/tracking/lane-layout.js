// lane-layout.js -- paw-unuy: pure helpers of the Track tab's combined lane (TrackingLane.svelte with `lane`: the stroke lane is the
// tracker lane). The span labels have no strip of their own there: the lane's right-click offers their ranges; a seed mark is
// clicked by its label row only, so a press anywhere else on the lane stays the lane's (seek, box select, a point).
import { fmtTime } from '../../lib/funscript.js';

/** The seed mark whose line is within px of x, if y is in its label row (y <= maxY). marks: [{t}], X: t -> x. */
export function seedHit(marks, x, y, X, { px = 4, maxY = 30 } = {}) {
  if (!(y <= maxY)) return null;
  return marks.find((m) => Math.abs(X(m.t) - x) <= px) ?? null;
}

/** The right-click items for the span labels (tr.spans: {start_ms, end_ms, state}) under t: set the range to each. */
export function spanItems(spans, t, setRange) {
  const here = (spans || []).filter((s) => t >= s.start_ms && t < s.end_ms);
  return here.map((s) => ({ label: `Range to this ${s.state} span (${fmtTime(s.start_ms)}–${fmtTime(s.end_ms)})`, run: () => setRange(s.start_ms, s.end_ms) }));
}
