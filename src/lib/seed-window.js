// seed-window.js -- where a take is best seeded (paw-ef73.9), pure. The trackers run both ways from the seed frame, so
// the seed belongs on good data: after a fade / dissolve INTO the take (at or after its first clean frame), before a fade
// out of it, and past a camera lead-in (a pan / zoom opening the take: a shot tagged as a moving camera joined to the
// static part by a camera move, or the sidecar's camera estimate starting with a move). The track then runs back into
// the fade / through the lead-in from there (camera splits and camera segments are soft cuts: no reseed, protocol.js
// trackCuts). Only a suggestion: the owner can seed anywhere.
import { edgeFades } from '../features/timeline/transitions.js';
import { takeRange } from '../features/timeline/shots.js';
import { CAMERA_MOVES } from './protocol.js';

const tagsOf = (s) => (s?.tags || []).map((t) => t?.id ?? t);
const moving = (k) => CAMERA_MOVES.includes(k);
export const HINT = {
  fade: 'Seed after the fade: it is tracked back into it',
  'lead-in': 'Seed where the action is fully visible: the lead-in is tracked backward',
  out: 'Seed before the fade out: it is tracked forward into it',
};

/** Where the static part of shot s starts: s.start_ms (no lead-in), a later time (its camera estimate opens with a move),
 *  or null (the whole shot moves: tagged pan / zoom / orbit / handheld, or every camera segment is a move). */
function staticStart(s) {
  if (tagsOf(s).some(moving)) return null;
  const cam = s.camera || [];
  if (!cam.length || !moving(cam[0].kind)) return s.start_ms;
  const c = cam.find((x) => !moving(x.kind));
  return c ? Math.max(s.start_ms, Math.round(c.t0)) : null;
}

/** The take of shot i -> {a, b (seed in [a, b), ms), why: '' | 'fade' | 'lead-in' (what moved a off the take's start),
 *  t0, t1 (the take), fadeIn, fadeOut (the transitions at its edges or null)} | null. transitions: transitions.js list. */
export function seedWindow(shots, i, transitions = [], fm = 1000 / 30, dur = Infinity) {
  const r = takeRange(shots, i);
  if (!r) return null;
  const t0 = shots[r[0]].start_ms, t1 = shots[r[1]].end_ms;
  let a = t0, why = '';
  for (let k = r[0]; k <= r[1]; k++) {
    const st = staticStart(shots[k]);
    if (st == null) continue;
    if (k > r[0] || st > shots[k].start_ms) { a = st; why = 'lead-in'; }
    break;
  }
  const fadeIn = edgeFades(shots[r[0]], transitions, fm, dur).in, fadeOut = edgeFades(shots[r[1]], transitions, fm, dur).out;
  if (fadeIn?.t1 != null && fadeIn.t1 > a && fadeIn.t1 < t1 - fm) { a = fadeIn.t1; why ||= 'fade'; }
  let b = t1;
  if (fadeOut?.t0 != null && fadeOut.t0 + fm > a && fadeOut.t0 < t1) b = fadeOut.t0 + fm;   // the last clean frame, inclusive
  return { a, b, why, t0, t1, fadeIn, fadeOut };
}

/** t moved into the window (a frame before its end at most); t itself when already inside or no window. */
export const seedAt = (w, t, fm = 1000 / 30) => (!w ? t : Math.min(Math.max(w.a, w.b - fm), Math.max(w.a, t)));
