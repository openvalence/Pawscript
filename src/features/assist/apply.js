// apply.js -- what an answer does to the document, pure (test/assist-model.test.mjs). The store wraps each result in
// one undo entry (app.edit / app.transact). Spans are [t0, t1): an action exactly at t1 belongs to the next span.

import { invert, remapRange } from '../../lib/edit/amplitude.js';
import { turns } from '../../lib/edit/strokes.js';
import { posAt, slice } from '../../lib/core/script.js';
import { compilePlan, applyPlan } from '../../lib/gen/index.js';
import { agrees, DEPTH_PRESETS, turnList } from './model.js';
import { acceptGhost } from '../tracking/accept.js';

/** pos -> 100 - pos for the actions in [t0, t1). */
export const invertSpan = (script, t0, t1) => invert(script, { t0, t1: t1 - 1 }).script;

/**
 * A direction answer: the user says the frame of `choice` ('left' = pair.a, 'right' = pair.b) is the deeper one.
 * Inverts [q.t0, q.t1) when the script disagrees; asking twice is a no-op. -> {script, fact, flipped}
 */
export function applyDirection(script, q, choice, pairIndex = 0) {
  const p = q.pairs[pairIndex] || q.pairs[0];
  const [deep, shallow] = choice === 'left' ? [p.a.at, p.b.at] : [p.b.at, p.a.at];
  const fact = { deep, shallow };
  const ok = agrees(script, fact);
  return ok === false ? { script: invertSpan(script, q.t0, q.t1), fact, flipped: true } : { script, fact, flipped: false };
}

/** The choice ('left' | 'right') a "flip / no flip" suggestion means for the pair shown. */
export function choiceFor(script, q, pairIndex, flip) {
  const p = q.pairs[pairIndex] || q.pairs[0];
  const aDeeperNow = posAt(script, p.a.at) < posAt(script, p.b.at);
  return aDeeperNow !== flip ? 'left' : 'right';
}

/** Every recorded direction fact the script disagrees with gets its span inverted. -> {script, spans:[{t0,t1}]} */
export function orientTo(script, facts) {
  let s = script;
  const spans = [];
  for (const f of facts) if (agrees(s, f) === false) { s = invertSpan(s, f.t0, f.t1); spans.push({ t0: f.t0, t1: f.t1 }); }
  return { script: s, spans };
}

/** Plan without [t0, t1) (segments partly inside are trimmed, wholly inside dropped). */
export function cutPlan(plan, t0, t1) {
  const out = [];
  for (const p of plan) {
    if (p.t1 <= t0 || p.t0 >= t1) { out.push(p); continue; }
    if (p.t0 < t0) out.push({ ...p, t1: t0 });
    if (p.t1 > t1) out.push({ ...p, id: p.t0 < t0 ? p.id + '-b' : p.id, t0: t1 });
  }
  return out;
}

const KIND_OF = { carry: 'offscreen', idle: 'idle', orgasm: 'orgasm', climax: 'orgasm' };   // 'climax' = saved answers from before the split
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/**
 * An activity answer ('carry' | 'idle' | 'orgasm') over [q.t0, q.t1): a plan segment (lib/gen KINDS) is generated into
 * the span and recorded in the plan. carry keeps the rhythm and depth of the strokes within 10 s; idle holds the
 * position the script had at the span start. -> {script, plan, segment}
 */
export function applyActivity(script, plan, q, state, { maxSpeed = 450 } = {}) {
  const { t0, t1 } = q;
  const kind = KIND_OF[state];
  const params = {};
  if (state === 'idle') params.pos = Math.round(Number.isFinite(posAt(script, t0)) ? posAt(script, t0) : 100);
  if (state === 'carry') {
    const near = [...turnList(script, t0 - 10000, t0), ...turnList(script, t1, t1 + 10000)];
    const tops = near.filter((x) => x.kind === 'top').map((x) => x.pos), bots = near.filter((x) => x.kind === 'bottom').map((x) => x.pos);
    if (tops.length && bots.length) { params.lo = median(bots); params.hi = Math.max(median(tops), params.lo + 10); }
  }
  const segment = { id: `assist-${state}-${t0}`, t0, t1, kind, params };
  const ctxTurns = turns(script, 10, { endpoints: false }).map(({ i, kind: k }) => ({ at: script[i].at, kind: k }))
    .filter((x) => x.at < t0 || x.at >= t1);
  const ctx = { seed: t0, maxSpeed, turns: ctxTurns };
  const res = compilePlan([segment], ctx);
  const next = applyPlan(script, res, ctx);
  return { script: next, plan: [...cutPlan(plan, t0, t1), segment].sort((a, b) => a.t0 - b.t0), segment };
}

/** A depth answer: the span's positions remapped to the preset's lo..hi. */
export function applyDepth(script, q, presetId) {
  const p = DEPTH_PRESETS.find((x) => x.id === presetId);
  if (!p || !slice(script, q.t0, q.t1 - 1).length) return script;
  const next = remapRange(script, { t0: q.t0, t1: q.t1 - 1 }, { lo: p.lo, hi: p.hi }).script;
  return next.length === script.length && next.every((a, i) => a.pos === script[i].pos && a.at === script[i].at) ? script : next;   // already so: no edit
}

/** Fallback: the other run's actions replace the span. */
export const applyFallback = (script, ghostScript, t0, t1) => acceptGhost(script, ghostScript, { range: { t0, t1: t1 - 1 }, mode: 'replace' }).script;
