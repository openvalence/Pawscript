// sim.js -- pure maths for the device simulator: where the device is at t (exactly posAt, the contract's
// linear interpolation), how fast it moves there, the speed colour, and the slice of actions in a time window.

import { lowerBound, posAt } from '../../lib/core/script.js';

// Phosphor's Color-by-speed ramp (dark chassis): rest -> the speed limit; `over` is past the limit.
export const SPEED_RAMP = ['#3D5AFE', '#2E8BFF', '#1FD0F0', '#1FE59A', '#6BF03D', '#D6EA28', '#FFC21F', '#FF7A1A', '#F0301E'];
export const SPEED_OVER = '#FF3DF2';

/** {pos, speed (units/s, >= 0), dir (+1 rising toward out, -1 going deeper, 0 held)} at t. pos NaN if empty. */
export function simAt(script, t) {
  if (!script || !script.length) return { pos: NaN, speed: 0, dir: 0 };
  const pos = posAt(script, t), i = lowerBound(script, t);
  if (i === 0 || i === script.length) return { pos, speed: 0, dir: 0 };
  const a = script[i - 1], b = script[i], dp = b.pos - a.pos;
  return { pos, speed: (Math.abs(dp) * 1000) / (b.at - a.at), dir: Math.sign(dp) };
}

/** Speed (units/s) -> ramp colour, with `limit` at the top of the ramp. */
export function speedColor(speed, limit = 400) {
  if (!(speed > 0)) return SPEED_RAMP[0];
  if (speed > limit) return SPEED_OVER;
  return SPEED_RAMP[Math.min(SPEED_RAMP.length - 1, Math.floor((speed / limit) * SPEED_RAMP.length))];
}

/** [i0, i1) of the actions in [t0, t1] plus one neighbour each side, so drawn lines run off the window edges. */
export function windowRange(script, t0, t1) {
  return [Math.max(0, lowerBound(script, t0) - 1), Math.min(script.length, lowerBound(script, t1 + 1) + 1)];
}
