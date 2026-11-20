// tracker-schema.js -- the tracker's own params as a ParamForm schema, one place for the Tracker panel's "Tracker (Track ROI)" fold
// and the Track button's settings popover (paw-unuy: the tracker chip moved there). Every param left in shapes the tracking itself
// (↻ = applies at the next Track). Not here: primary / pipe_sign / pipe_invert (the run's lane channel, the source chips and Flip
// override the sidecar's pick per scene); cut_* and loop_min_confidence (the Scenes panel's options, sent with Track too); the
// script-shaping pipe_* (protocol.js isShapePipe: Runs > Adjust > Strokes > Advanced); the stroke axis keys while the tracker takes an
// axis (their own row in the panel).
import { groupParams, paramSchema, isShapePipe } from '../../lib/protocol.js';
import { AXIS_KEYS } from './axis.js';

export const COVERED = ['primary', 'pipe_sign', 'pipe_invert'], SCENE_KEYS = ['loop_min_confidence'];
export const RETRACK = '↻ Needs a re-track: applies at the next Track (the camera handling, stroke axis, direction and signal of a finished run adjust live in Runs → Adjust).';

/** tracker t ({params}) -> the ParamForm schema; hasAxis: the stroke axis keys are drawn elsewhere. */
export function trackerSchemaOf(t, hasAxis = false) {
  if (!t?.params) return [];
  return groupParams(t.params, SCENE_KEYS).filter((g) => g.id !== 'cut').flatMap((g) => paramSchema(g.params, g.open ? undefined : g.title))
    .filter((p) => !COVERED.includes(p.key) && !isShapePipe(p.key) && !(hasAxis && AXIS_KEYS.includes(p.key)))
    .map((p) => ({ ...p, label: p.label + ' ↻', hint: p.hint ? `${p.hint}\n${RETRACK}` : RETRACK }));
}
