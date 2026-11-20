// Seeded variation. The random value of an action depends only on (seed, its original timestamp), so results are reproducible and
// do not change when the selection around it does.
import { retime, hash01, O, fin } from './util.js';

function draw(seed, at, salt, gaussian) {
  const u = hash01(seed, at, salt);
  if (!gaussian) return u * 2 - 1;
  const z = Math.sqrt(-2 * Math.log(hash01(seed, at, salt + 100) || 1e-9)) * Math.cos(2 * Math.PI * u);
  return Math.max(-1, Math.min(1, z / 2));
}

/** Random offsets: time +-timeMs, pos +-amp. distribution 'uniform' | 'gaussian' (sigma = half the bound, clipped to it).
 *  collide 'clamp' (default: order is kept) | 'moved'. keepEnds leaves the first and last selected action alone. */
export function jitter(script, sel, opts) {
  const { timeMs = 0, amp = 0, seed = 1, distribution = 'uniform', collide = 'clamp', keepEnds = false } = O(opts);
  const g = distribution === 'gaussian', tm = Math.max(0, fin(timeMs, 0)), am = Math.max(0, fin(amp, 0));
  const edge = (k, info) => keepEnds && (k === 0 || k === info.n - 1);
  return retime(script, sel, (a, k, info) => (edge(k, info) ? a.at : a.at + draw(seed, a.at, 0, g) * tm), {
    collide, fPos: (a, k, info) => (edge(k, info) ? a.pos : a.pos + draw(seed, a.at, 1, g) * am),
  });
}

export const HUMANISE_PRESETS = { subtle: { timeMs: 8, amp: 1 }, natural: { timeMs: 20, amp: 3 }, loose: { timeMs: 40, amp: 6 } };

/** Preset jitter: preset 'subtle' | 'natural' | 'loose', amount scales both, always gaussian + order-preserving. */
export function humanise(script, sel, opts) {
  const { preset = 'natural', amount = 1, seed = 1, keepEnds = true } = O(opts), p = HUMANISE_PRESETS[preset] || HUMANISE_PRESETS.natural;
  return jitter(script, sel, { timeMs: p.timeMs * amount, amp: p.amp * amount, seed, distribution: 'gaussian', collide: 'clamp', keepEnds });
}
