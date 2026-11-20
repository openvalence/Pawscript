// overlay-pick.js -- which stored run frame the video overlay shows at time t. Pure (test/tracking-overlay-pick.test.mjs).
// Rule: only data that belongs to the frame on show. A run draws only inside its own range, and only its frame at t
// (within 1.5 frames: never a frame of another time). follow 'selection' (settings tracking.blobs.follow, the default):
// while shots are selected in the timeline, nothing outside their span (selecting the next shot hides the previous
// shot's trackers, wherever the playhead is); 'playhead': every scene's trackers as the video plays through them,
// whatever is selected. Several runs over t: the selected run, else the run linked to the shot at t (its signal), else
// the newest visible one. The selection is never changed here.
import { overlayIndex, sceneAt } from '../../lib/runs.js';

export const FOLLOW = ['selection', 'playhead'];

/** The time span of the selected shots ({t0, t1}: their hull) or null (nothing selected). shots = app.doc.scenes. */
export function selectionSpan(shots = [], sel = []) {
  const ks = sel.filter((k) => shots[k]);
  return ks.length ? { t0: Math.min(...ks.map((k) => shots[k].start_ms)), t1: Math.max(...ks.map((k) => shots[k].end_ms)) } : null;
}

/**
 * {runs, selected, linked (the run linked to the shot at t, or null), visible(run) -> bool, t, frameMs, follow, span
 * (selectionSpan)} -> {run, fr, i, tMin, tMax} (fr.ov[i] is the frame at t; tMin / tMax its run scene's bounds) | null.
 */
export function overlayPick({ runs = [], selected = null, linked = null, visible = () => true, t, frameMs = 1000 / 30, follow = 'selection', span = null }) {
  if (follow !== 'playhead' && span && !(t >= span.t0 && t < span.t1)) return null;
  const covers = (r) => !!r?.frames?.t?.length && (!r.tag || (r === selected && !!r.mod)) && visible(r) && t >= r.range.start && t < r.range.end;   // a modifier's own run: while selected (its masks)
  const run = [selected, linked, ...[...runs].reverse()].find(covers);
  if (!run) return null;
  const i = overlayIndex(run.frames, t, 1.5 * (frameMs || 1000 / 30));
  if (i < 0) return null;
  const k = sceneAt(run.scenes || [], t);
  return { run, fr: run.frames, i, tMin: run.scenes?.[k]?.start_ms ?? -Infinity, tMax: run.scenes?.[k + 1]?.start_ms ?? Infinity };
}
