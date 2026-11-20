// replay.js -- answers from a recorded trace (trace.js fromTrace2 -> {[id]: {value, rationale, conf}}). Exact ids
// first; hand-written traces give scene-level ids (`track:s0` matches `track:s0@4500`) and `story:v`, which is
// sliced to the scene. Never in a chain unless an override chain names it (fixtures, tests, answer.mjs --policy replay).
import { KINDS } from '../../../lib/director/decisions.js';

/** story:v segments clipped to [t0, t1); pieces under 250 ms join their neighbour. null when nothing overlaps. */
export function sliceStory(segments, t0, t1) {
  const out = [];
  for (const s of segments ?? []) {
    const a = Math.max(s.t0, t0), b = Math.min(s.t1, t1);
    if (b > a) out.push({ ...s, t0: a, t1: b });
  }
  for (let i = out.length - 1; i >= 0 && out.length > 1; i--) {
    if (out[i].t1 - out[i].t0 >= 250) continue;
    if (i > 0) out[i - 1].t1 = out[i].t1; else out[1].t0 = out[0].t0;
    out.splice(i, 1);
  }
  return out.length ? out : null;
}

export function lookup(replay, req) {
  const hit = replay[req.id] ?? (req.scope?.scene != null ? replay[`${req.kind}:s${req.scope.scene}`] : null);
  if (hit) return hit;
  const v = req.kind === 'story' && replay['story:v'];
  const segs = v && sliceStory(v.value?.segments, req.scope.t0, req.scope.t1);
  return segs ? { ...v, value: { segments: segs } } : null;
}

export function makeReplayBrain(replay = {}) {
  let map = replay;
  return {
    id: 'replay', kinds: KINDS,
    available: async () => Object.keys(map).length > 0,
    decide: async (reqs) => reqs.map((r) => {
      const h = lookup(map, r);
      return h ? { id: r.id, value: h.value, raw: h.conf ?? 0.99, rationale: 'replay' + (h.rationale ? ': ' + h.rationale : '') } : { id: r.id, abstain: 'not in the replay' };
    }),
    set(next) { map = next ?? {}; },
  };
}
