// Cap a selection to a device profile's kinematics (speed + acceleration + jerk, lib/analyze/kinematics.js), not just
// its chord speed (capSpeed). Limits come from the profile (toUnits(withStroke(profile, strokeMm))); a profile without
// kinematics degrades to its max speed with unbounded a / j, so this is capSpeed with a different parameterisation.
import { selInfo, O, fin } from './util.js';
import { cascadeRetime } from './speed.js';
import { turns } from './strokes.js';
import { minMoveTime, maxReach } from '../analyze/kinematics.js';
import { toUnits, withStroke, getProfile, effectiveMaxSpeed } from '../analyze/profiles.js';

/** {v, a, j} in pos units for a profile (object or built-in id) at a stroke window; velocity-only for profiles without kinematics. */
export function limitsFor(profile, strokeMm) {
  const p = typeof profile === 'string' ? getProfile(profile) : profile || getProfile('generic');
  if (p.kinematics) return toUnits(withStroke(p, fin(strokeMm, 0) > 0 ? strokeMm : p.kinematics.strokeMm));
  return { v: effectiveMaxSpeed(p), a: 1e9, j: 1e18 };
}

/**
 * capKinematics(script, sel, {profile, strokeMm, method, ripple, minProminence}) -> {script, ats}
 *  'pull'   every rest-to-rest stroke (rests = turning points of `minProminence`, hold edges, the ends; the same set as
 *           strokeShortfalls) keeps its times and has its reached amplitude clamped to maxReach(T); interior points are scaled
 *           along the chord; forward greedy from the previously achieved position (as the device's planner, reach factor 1).
 *           Only selected actions change; an unselected action stays and is the achieved position from then on.
 *  'retime' positions kept, selected actions delayed until each move fits minMoveTime (every point treated as a rest:
 *           conservative; ripple slides the rest of the script along).
 */
export function capKinematics(script, sel, opts) {
  const { profile = 'nucleus-capstan', strokeMm = 200, method = 'pull', ripple = false, minProminence = 3 } = O(opts);
  const limits = limitsFor(profile, strokeMm);
  // ponytail: 'retime' treats every point as rest-to-rest (ceiling: a through-move at speed is delayed more than the device needs);
  // a per-stroke retime (rests only, interior points scaled in time) would be the upgrade.
  if (method === 'retime') return cascadeRetime(script, sel, (p, a) => Math.ceil(minMoveTime(Math.abs(a.pos - p.pos), limits) * 1000), ripple);
  const info = selInfo(script, sel), n = script.length;
  if (!info.n || n < 2) return { script, ats: [] };
  const rest = new Set([0, n - 1]);
  for (const t of turns(script, minProminence)) rest.add(t.i);
  for (let i = 0; i + 1 < n; i++) if (script[i].pos === script[i + 1].pos) { rest.add(i); rest.add(i + 1); }
  const r = [...rest].sort((x, y) => x - y), ach = new Float64Array(n);
  ach[0] = script[0].pos;
  for (let s = 0; s + 1 < r.length; s++) {
    const p = r[s], q = r[s + 1], aP = ach[p], chord = script[q].pos - script[p].pos;
    let aQ = script[q].pos;
    if (info.m[q] && chord !== 0) {
      const D = Math.abs(script[q].pos - aP), reach = Math.floor(maxReach((script[q].at - script[p].at) / 1000, limits));
      aQ = aP + Math.sign(script[q].pos - aP) * Math.min(D, reach);
    } else if (info.m[q] && chord === 0) aQ = aP;   // a hold stays a hold (at the achieved level)
    for (let k = p + 1; k < q; k++) ach[k] = !info.m[k] ? script[k].pos : chord === 0 ? aP : aP + (aQ - aP) * Math.max(0, Math.min(1, (script[k].pos - script[p].pos) / chord));
    ach[q] = aQ;
  }
  const out = script.slice(), ats = [];
  for (const i of info.idx) {
    ats.push(script[i].at);
    const pos = Math.max(0, Math.min(100, Math.round(ach[i])));
    if (pos !== script[i].pos) out[i] = { at: script[i].at, pos };
  }
  return { script: out, ats };
}
