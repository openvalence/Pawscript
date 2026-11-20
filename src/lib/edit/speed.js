// Speed and device limits (fixing, not reporting: reports live in lib/analyze).
import { selInfo, compose, O, fin } from './util.js';
import { thinMinGap } from './density.js';

/** Walk the script from the first selected action. need(prev, a) = minimum dt (ms) between prev and a. Selected actions are delayed
 *  to honour it. ripple true: every later action (selected or not) slides by the accumulated delay, so nothing after is overrun;
 *  false: only selected actions move (an unselected action that gets overrun is replaced or passed). */
export function cascadeRetime(script, sel, need, ripple) {
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const first = info.idx[0], n = script.length;
  let carry = 0, prev = first > 0 ? script[first - 1] : null;
  if (ripple) {
    const out = script.slice(0, first), ats = [];
    for (let i = first; i < n; i++) {
      const a = script[i];
      let t = a.at + carry;
      if (info.m[i]) {
        if (prev) t = Math.max(t, Math.ceil(prev.at + need(prev, a)));   // need() may be fractional (minGapMs from a graph param)
        carry = t - a.at; ats.push(t);
      }
      prev = { at: t, pos: a.pos };
      out.push(t === a.at ? a : prev);
    }
    return { script: out, ats };
  }
  const moved = [];
  for (let i = first; i < n; i++) {
    const a = script[i];
    if (info.m[i]) {
      let t = a.at;
      if (prev) t = Math.max(t, Math.ceil(prev.at + need(prev, a)));
      prev = { at: t, pos: a.pos }; moved.push(prev);
    } else prev = a;
  }
  return compose(script, info.m, moved);
}

const needMs = (prev, a, max) => Math.ceil((Math.abs(a.pos - prev.pos) * 1000) / max - 1e-9);

/** Cap speed at maxSpeed (pos units/s). method 'pull': positions are pulled towards the previous point (times kept);
 *  'retime': positions kept, points delayed (ripple: slide the rest of the script along). Only selected actions change; with 'pull'
 *  the action after the selection is not re-checked. */
export function capSpeed(script, sel, opts) {
  const { maxSpeed = 400, method = 'pull', ripple = false } = O(opts), max = Math.max(1e-6, fin(maxSpeed, 400));
  if (method === 'retime') return cascadeRetime(script, sel, (p, a) => needMs(p, a, max), ripple);
  const info = selInfo(script, sel);
  if (!info.n) return { script, ats: [] };
  const out = script.slice(), ats = [];
  for (const i of info.idx) {
    const a = script[i];
    ats.push(a.at);
    if (i === 0) continue;
    const p = out[i - 1], maxd = Math.floor((max * (a.at - p.at)) / 1000 + 1e-9), d = a.pos - p.pos;
    if (Math.abs(d) > maxd) out[i] = { at: a.at, pos: p.pos + Math.sign(d) * maxd };
  }
  return { script: out, ats };
}

/** Make sure consecutive selected actions are at least minGapMs apart. method 'push' delays later points (ripple option);
 *  'drop' removes points that are too close (keep 'first' | 'extreme', see thinMinGap). */
export function enforceMinSpacing(script, sel, opts) {
  const { minGapMs = 50, method = 'push', ripple = false, keep = 'first' } = O(opts);
  if (method === 'drop') return thinMinGap(script, sel, { minGapMs, keep });
  return cascadeRetime(script, sel, () => minGapMs, ripple);
}

