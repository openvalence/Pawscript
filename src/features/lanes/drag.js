// drag.js -- pure drag maths: moving a selection (clamp / push / duplicate), snapping and constraints,
// and applying the transform box. All functions take sorted selected indices and return new Scripts.
import { snapTime, snapFrame, mapThroughBox } from './geom.js';
import { frameLen } from '../../lib/lane.js';
import { lowerBound } from '../../lib/core/script.js';

/**
 * Allowed time and pos offsets for moving the selected indices as one block.
 *  clamp: points never cross or touch an unselected neighbour (minGap ms apart).
 *  push:  everything in the direction of travel moves with the block (dt>0: all after the first selected;
 *         dt<0: all before the last selected), so nothing ever crosses.
 *  dup:   copies move; originals stay.
 * The block keeps its shape: pos offsets stop when the highest or lowest point reaches the edge.
 * dur: nothing moves past the video's end (paw-g56v: the view pans past it; a point there would not play).
 */
export function moveLimits(script, idx, mode, minGap = 1, dur = Infinity) {
  let dtMin = -Infinity, dtMax = Infinity, pMin = 100, pMax = 0;
  for (const i of idx) { const p = script[i].pos; if (p < pMin) pMin = p; if (p > pMax) pMax = p; }
  if (!idx.length) return { dtMin: 0, dtMax: 0, dpMin: 0, dpMax: 0 };
  if (mode === 'dup') dtMin = -script[idx[0]].at;
  else if (mode === 'push') dtMin = -script[0].at;
  else {
    for (let k = 0; k < idx.length; k++) {
      const f = idx[k];
      let l = f;
      while (k + 1 < idx.length && idx[k + 1] === l + 1) l = idx[++k];
      dtMin = Math.max(dtMin, f > 0 ? script[f - 1].at + minGap - script[f].at : -script[f].at);
      if (l < script.length - 1) dtMax = Math.min(dtMax, script[l + 1].at - minGap - script[l].at);
    }
  }
  dtMax = Math.min(dtMax, dur - (mode === 'push' ? script[script.length - 1].at : script[idx[idx.length - 1]].at));
  return { dtMin: Math.min(dtMin, 0) + 0, dtMax: Math.max(dtMax, 0), dpMin: 0 - pMin + 0, dpMax: 100 - pMax };   // +0: no -0
}

/** Apply a block move (dt, dp assumed within moveLimits). Returns the new Script. */
export function applyMove(script, idx, dt, dp, mode) {
  if (!idx.length || (!dt && !dp)) return script;
  if (mode === 'dup') {
    const copies = idx.map((i) => ({ at: script[i].at + dt, pos: script[i].pos + dp }));
    const a = lowerBound(script, copies[0].at), b = lowerBound(script, copies[copies.length - 1].at + 1);
    return [...script.slice(0, a), ...copies, ...script.slice(b)];
  }
  const out = script.slice();
  if (mode === 'push' && dt) {
    const [i0, i1] = dt > 0 ? [idx[0], out.length] : [0, idx[idx.length - 1] + 1];
    for (let i = i0; i < i1; i++) out[i] = { at: out[i].at + dt, pos: out[i].pos };
    for (const i of idx) out[i] = { at: out[i].at, pos: out[i].pos + dp };
    return out;
  }
  for (const i of idx) out[i] = { at: script[i].at + dt, pos: script[i].pos + dp };
  return out;
}

/**
 * Pointer -> block offset. o = { script, idx, anchor (index grabbed), t, pos (pointer, unsnapped float),
 *   mode, fms (frame ms), snap (bool), targets (sorted ms snap targets), tolMs, constrain (bool),
 *   dxPx, dyPx (pointer travel, for the dominant direction), minGap, dur (the video's end: never past it) }.
 * Returns { dt, dp, target } where target says the time locked onto a snap target (not just a frame).
 */
export function resolveMove(o) {
  const a = o.script[o.anchor];
  let t = o.t, pos = o.pos;
  if (o.constrain) { if (Math.abs(o.dxPx) >= Math.abs(o.dyPx)) pos = a.pos; else t = a.at; }
  let target = false, tt;
  if (o.constrain && t === a.at) tt = a.at;
  else if (o.snap) ({ t: tt, target } = snapTime(t, o.fms, o.targets, o.tolMs));
  else tt = Math.round(t);
  const L = moveLimits(o.script, o.idx, o.mode, o.minGap, o.dur);
  let dt = tt - a.at;
  if (dt < L.dtMin || dt > L.dtMax) {
    dt = Math.max(L.dtMin, Math.min(L.dtMax, dt));
    target = false;
    if (o.snap && frameLen(o.fms)) {   // stay on the frame grid if a frame fits inside the limits
      const f = snapFrame(a.at + dt, o.fms) - a.at, step = Math.round(frameLen(o.fms)) * Math.sign(dt - f || 1);
      for (const c of [f, f + step, f - step]) if (c >= L.dtMin && c <= L.dtMax) { dt = c; break; }
    }
  }
  const dp = Math.max(L.dpMin, Math.min(L.dpMax, Math.round(pos - a.pos)));
  return { dt, dp, target };
}

/** Smallest time span the box may have so no two selected points merge after rounding. */
export function minBoxSpan(script, idx) {
  let g = Infinity;
  for (let k = 1; k < idx.length; k++) g = Math.min(g, script[idx[k]].at - script[idx[k - 1]].at);
  const span = script[idx[idx.length - 1]].at - script[idx[0]].at;
  return g === Infinity || !span ? 1 : span / g;
}

/** Time limits for the box edges: strictly between the unselected neighbours (dur = upper bound). */
export function boxLimits(script, idx, dur = Infinity) {
  const f = idx[0], l = idx[idx.length - 1];
  return { tMin: f > 0 ? script[f - 1].at + 1 : 0, tMax: l < script.length - 1 ? script[l + 1].at - 1 : dur, minSpan: minBoxSpan(script, idx) };
}

/** Map the selected indices through box `from` -> `to`; unselected points stay. Selected wins on equal time. */
export function applyBox(script, idx, from, to) {
  const sel = new Set(idx), moved = [], rest = [];
  for (let i = 0; i < script.length; i++) {
    if (!sel.has(i)) { rest.push(script[i]); continue; }
    const m = mapThroughBox(script[i], from, to);
    moved.push({ at: Math.max(0, Math.round(m.at)), pos: Math.max(0, Math.min(100, Math.round(m.pos))) });
  }
  const out = [];
  let i = 0, j = 0;
  while (i < rest.length || j < moved.length) {
    if (j >= moved.length || (i < rest.length && rest[i].at < moved[j].at)) out.push(rest[i++]);
    else { if (i < rest.length && rest[i].at === moved[j].at) i++; const m = moved[j++]; if (!out.length || out[out.length - 1].at < m.at) out.push(m); }
  }
  return { script: out, ats: moved.map((m) => m.at) };
}
