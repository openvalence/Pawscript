// Plan -> script compiler. A plan is a list of segments [{id, t0, t1, kind, recipe?, params?}] (ms, may have
// gaps, must not overlap). Each segment is generated over its own span by its recipe, then the pieces are
// joined in time order: at every join, points near the boundary are removed (outgoing side first, at most
// blendMs away) until the crossing step respects maxSpeed and minGapMs. Joins only touch their own window,
// so recompiling one segment changes nothing outside its span and its two join windows.

import { lowerBound } from '../core/script.js';
import { GENERATORS } from './generators.js';
import { resolveSegment } from './recipes.js';
import { DEFAULTS, hashSeed, joinPlan } from './util.js';

const EXTRA_KEYS = new Set(['spm', 'times']); // accepted params that are not in a schema

function check(plan) {
  const issues = [], cands = [], seen = new Set();
  for (const s of Array.isArray(plan) ? plan : []) {
    const id = s?.id;
    if (id == null || id === '') { issues.push({ id: null, level: 'error', msg: 'segment without an id' }); continue; }
    if (seen.has(id)) { issues.push({ id, level: 'error', msg: `duplicate id ${JSON.stringify(id)}` }); continue; }
    seen.add(id);
    if (!Number.isFinite(s.t0) || !Number.isFinite(s.t1) || s.t0 < 0 || Math.round(s.t1) <= Math.round(s.t0)) {
      issues.push({ id, level: 'error', msg: `bad span ${s.t0}..${s.t1} (need 0 <= t0 < t1)` }); continue;
    }
    let r;
    try { r = resolveSegment(s); } catch (e) { issues.push({ id, level: 'error', msg: e.message }); continue; }
    const known = new Set(GENERATORS[r.genId].schema.map((x) => x.key));
    const unknown = Object.keys(r.params).filter((k) => !known.has(k) && !EXTRA_KEYS.has(k));
    if (unknown.length) issues.push({ id, level: 'warn', msg: `ignored params: ${unknown.join(', ')}` });
    cands.push({ id, seg: s, t0: Math.round(s.t0), t1: Math.round(s.t1), r, key: JSON.stringify([Math.round(s.t0), Math.round(s.t1), r.recipeId, r.params]) });
  }
  cands.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  const ok = [];
  for (const c of cands) {
    const prev = ok[ok.length - 1];
    if (prev && c.t0 < prev.t1) { issues.push({ id: c.id, level: 'error', msg: `overlaps ${JSON.stringify(prev.id)} (${c.t0} < ${prev.t1}); skipped` }); continue; }
    ok.push(c);
  }
  return { ok, issues };
}

/** Problems in a plan: [{id, level: 'error'|'warn', msg}]. Errors make compilePlan skip that segment. */
export const validatePlan = (plan) => check(plan).issues;

/** opts (e.g. from the device profile) override the same fields of ctx: { maxSpeed, minGapMs, blendMs }. */
const withOpts = (ctx, opts) => (opts ? { ...ctx, ...opts } : ctx);
const ctxKey = (ctx) => JSON.stringify([ctx.seed ?? 0, ctx.maxSpeed ?? DEFAULTS.maxSpeed, ctx.minGapMs ?? DEFAULTS.minGapMs, ctx.intensity ?? 1, !!ctx.invert]);

const generate = (c, ctx) => c.r.gen(c.t0, c.t1, c.r.params, { ...ctx, seed: hashSeed(ctx.seed ?? 0, c.id) });

const joinOpts = (ctx) => ({
  maxSpeed: ctx.maxSpeed ?? DEFAULTS.maxSpeed,
  minGapMs: Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs),
  windowMs: ctx.blendMs ?? DEFAULTS.blendMs,
});

/** Append `piece` to `out` (in place) through a join; a cap violation that cannot be fixed is reported. */
function appendJoined(out, piece, opts, issues, id) {
  if (!piece.length) return;
  const { dropLeft, dropRight, ok } = joinPlan(out, piece, opts);
  out.length -= dropLeft;
  if (!ok && out.length) {
    const p = out[out.length - 1], q = piece[dropRight];
    issues?.push({ id, level: 'warn', at: q.at, msg: `join at ${q.at} ms: ${q.at - p.at} ms after the previous point, ${Math.round((Math.abs(q.pos - p.pos) * 1000) / (q.at - p.at))} pos/s (over the min gap or the cap; segments too short to blend)` });
  }
  for (let j = dropRight; j < piece.length; j++) out.push(piece[j]);
}

function assemble(ok, raw, keys, ctx, issues) {
  const opts = joinOpts(ctx), script = [];
  for (const c of ok) appendJoined(script, raw[c.id], opts, issues, c.id);
  const segments = ok.map((c, i) => {
    const sharedEnd = ok[i + 1]?.t0 === c.t1;
    const count = lowerBound(script, sharedEnd ? c.t1 : c.t1 + 1) - lowerBound(script, c.t0);
    return { id: c.id, t0: c.t0, t1: c.t1, count, recipe: c.r.recipeId, gen: c.r.genId };
  });
  return { script, segments, issues, raw, keys, ctxKey: ctxKey(ctx) };
}

/**
 * plan -> { script, segments: [{id, t0, t1, count, recipe, gen}], issues, raw, keys }.
 * `raw` (each segment's own output before joining) and `keys` are what recompileSegment reuses.
 */
export function compilePlan(plan, ctx = {}, opts) {
  ctx = withOpts(ctx, opts);
  const { ok, issues } = check(plan);
  const raw = {}, keys = {};
  for (const c of ok) { raw[c.id] = generate(c, ctx); keys[c.id] = c.key; }
  return assemble(ok, raw, keys, ctx, issues);
}

/**
 * Re-run after editing segment `id` of the plan: only that segment (and any other whose span, kind, recipe
 * or params changed since `prev`) is regenerated; its two joins are redone. Same result as compilePlan(plan,
 * ctx). Pass the same ctx as for `prev` (a changed seed / turns / maxSpeed needs a full compilePlan).
 */
export function recompileSegment(prev, plan, id, ctx = {}, opts) {
  ctx = withOpts(ctx, opts);
  if (!prev?.raw || !prev?.keys || prev.ctxKey !== ctxKey(ctx)) return compilePlan(plan, ctx);
  const { ok, issues } = check(plan);
  const raw = {}, keys = {};
  for (const c of ok) {
    const reuse = c.id !== id && prev.keys[c.id] === c.key && prev.raw[c.id];
    raw[c.id] = reuse || generate(c, ctx);
    keys[c.id] = c.key;
  }
  return assemble(ok, raw, keys, ctx, issues);
}

/**
 * Put a compiled plan into an existing script: base points inside each segment span are replaced by the
 * compiled ones; base points outside every span are kept and never removed (joins to them only trim the
 * compiled side). -> Script.
 */
export function applyPlan(base, res, ctx = {}, opts) {
  ctx = withOpts(ctx, opts);
  const jo = joinOpts(ctx), out = [], segs = [...res.segments].sort((a, b) => a.t0 - b.t0);
  let bi = 0, lastLocked = false;
  const push = (piece, locked) => {
    if (!piece.length) return;
    appendJoined(out, piece, { ...jo, lockLeft: lastLocked, lockRight: locked });
    lastLocked = locked;
  };
  for (const s of segs) {
    const b0 = lowerBound(base, s.t0);
    push(base.slice(bi, b0), true);
    bi = Math.max(bi, lowerBound(base, s.t1 + 1));
    push(res.script.slice(lowerBound(res.script, s.t0), lowerBound(res.script, s.t1 + 1)), false);
  }
  push(base.slice(bi), true);
  return out;
}
