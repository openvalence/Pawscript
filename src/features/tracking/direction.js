// direction.js -- Track forward / backward / both from the seed frame (paw-bh2; sidecar PROTOCOL v4.15). Pure
// (test/tracking-direction.test.mjs). The seed is the frame the ROI / groups were drawn on, else the playhead.
// both: the range as today. forward: [seed, the end of its take); backward: [the start of its take, seed]. A seed
// within NEAR_MS of its take's edge in the direction of travel goes on past that edge into the take beyond it (the
// pan that arrives at the action: a cut the detector put there, or a shot the owner split), up to the next hard cut
// beyond. An owner range (I / O, or a shot selection) replaces those limits. Every cut inside the span is tracked
// through (sent as soft: one run, a normalisation boundary); the hard ones crossed are returned so the app can offer
// to make them camera moves (never applied silently).
import { takeRange, sameTake } from '../timeline/shots.js';
import { sceneAt } from '../../lib/runs.js';

export const DIRECTIONS = ['both', 'forward', 'backward'];
export const NEAR_MS = 500;

/**
 * shots = app.doc.scenes; seed ms; dir; range {t0, t1} | null (the owner's limits); duration (the video's).
 * -> {t0, t1 (the request's start / end: backward ends one ms past the seed so its frame is in), crossed: [shot index
 * whose start is a hard cut inside the span]} | null for 'both' (the caller keeps its own range).
 */
export function directionSpan(shots = [], seed, dir, { range = null, near = NEAR_MS, duration = Infinity } = {}) {
  if (dir !== 'forward' && dir !== 'backward') return null;
  let lo = range ? range.t0 : 0, hi = range ? range.t1 : duration;
  const k = sceneAt(shots, seed);
  if (!range && k >= 0 && shots[k].start_ms <= seed && shots[k].end_ms > seed) {
    let [a, b] = takeRange(shots, k);
    if (dir === 'backward' && seed - shots[a].start_ms <= near && a > 0) a = takeRange(shots, a - 1)[0];
    if (dir === 'forward' && shots[b].end_ms - seed <= near && b + 1 < shots.length) b = takeRange(shots, b + 1)[1];
    lo = shots[a].start_ms; hi = shots[b].end_ms;
  }
  const t0 = dir === 'forward' ? seed : Math.min(lo, seed), t1 = dir === 'forward' ? Math.max(hi, seed + 1) : seed + 1;
  const crossed = [];
  shots.forEach((s, i) => { if (i && s.start_ms > t0 && s.start_ms < t1 && !sameTake(s)) crossed.push(i); });
  return { t0: Math.round(t0), t1: Math.round(t1), crossed };
}

/** The document cuts of a one-way run, every one tracked through (soft): -> cuts (protocol.js trackCuts shape). */
export const throughCuts = (cuts) => (Array.isArray(cuts) ? cuts.map((c) => (c.kind === 'hard' ? { ...c, kind: 'soft', why: 'tracked through: ' + c.why } : c)) : []);

/** The lane's band for a one-way job in flight: from the seed outwards by the progress fraction. -> {t0, t1} | null. */
export function progressBand(job, frac) {
  if (!job || (job.dir !== 'forward' && job.dir !== 'backward')) return null;
  const f = Math.min(1, Math.max(0, frac || 0));
  return job.dir === 'backward' ? { t0: job.seed - f * (job.seed - job.t0), t1: job.seed } : { t0: job.seed, t1: job.seed + f * (job.t1 - job.seed) };
}
