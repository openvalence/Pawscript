// logic.js -- "Fix a goofed section", the pure half: which span, the splice with clean seams, the per-fix pieces,
// and carving a plan so one span can be regenerated. Everything returns new values; fix.svelte.js wires it to the app.
// Reuses: lib/gen/plan.js applyPlan (locked joins = outside points never move), lib/edit OPS, timeline plan helpers.
import { slice, normalize, posAt } from '../../lib/core/script.js';
import { applyPlan, compilePlan } from '../../lib/gen/plan.js';
import { planCtx, generatePlan } from '../timeline/generate-logic.js';

const GEN = { compilePlan, applyPlan };
import { runOp } from '../../lib/edit/index.js';
import { KINDS, RECIPES } from '../../lib/gen/recipes.js';
import { makeSegment, segState, stamp, coerceParams, setTurns } from '../timeline/plan.js';
import { sorted } from '../timeline/intervals.js';

/** The span a fix works on: the I/O range, else the first..last selected point of the active axis. -> {t0, t1} | null */
export function fixRange(doc) {
  const r = doc.range;
  if (r && r.t1 > r.t0) return { t0: Math.round(r.t0), t1: Math.round(r.t1) };
  const s = doc.selection;
  if (s?.axis !== doc.activeAxis || !(s.ats?.size >= 2)) return null;
  let t0 = Infinity, t1 = -Infinity;
  for (const t of s.ats) { if (t < t0) t0 = t; if (t > t1) t1 = t; }
  return { t0, t1 };
}

/**
 * Put `piece` into `base` over [t0, t1] (inclusive): base points inside are replaced, base points outside never
 * move or disappear; at both seams piece points near the edge are dropped until the crossing step is at least
 * minGapMs long and within maxSpeed (0 = no cap). -> Script.
 */
export function spliceRange(base, t0, t1, piece, { maxSpeed = 0, minGapMs = 20 } = {}) {
  const p = slice(normalize(piece || []), t0, t1);
  return applyPlan(base, { segments: [{ t0, t1 }], script: p }, {}, { maxSpeed, minGapMs: Math.max(1, minGapMs) });
}

/** The range's own points (the piece every in-place fix rewrites). */
export const piece = (base, { t0, t1 }) => slice(base, t0, t1);

/** pos -> 100 - pos inside the span. */
export const flipPiece = (p) => runOp('invert', p, null).script;
/** Depth × factor about the out end (pos 100, the generators' default anchor 'hi'). */
export const scalePiece = (p, factor) => runOp('scale', p, null, { factor, pivot: 'top' }).script;
/** Stretch the inner points about t0 by `factor`, then shift them by dt ms; the first and last points (the seams) keep their
 *  times and nothing crosses them (collide clamp). */
export function retimePiece(p, t0, { factor = 1, dt = 0 } = {}) {
  if (p.length < 3) return p;
  const inner = (s) => ({ ats: s.slice(1, -1).map((a) => a.at) });
  let s = p;
  if (factor !== 1) s = runOp('stretch', s, inner(s), { factor, anchor: 'custom', at: t0, collide: 'clamp' }).script;
  if (dt) s = runOp('shift', s, inner(s), { dt, collide: 'clamp' }).script;
  return s;
}

/**
 * Regenerate [t0, t1] of `axis` with `recipe`. With plan segments over the range the plan is carved (carvePlan) and
 * only the new segment is generated (the plan lane stays the source of truth: the result carries the new plan);
 * with none, a one-segment plan is generated straight into the span and the document's plan is left alone.
 * Seams: the first move goes away from the script's position at t0, joins respect minGapMs and maxSpeed, outside
 * points never move. -> {script, plan (null = unchanged), id, issues} | {error}.
 */
export function regenerateSpan(doc, axis, { t0, t1 }, { recipe, maxSpeed = 0, minGapMs = 20, ids }) {
  if (!RECIPES[recipe]) return { error: `Unknown recipe ${recipe}.` };
  const base = doc.axes[axis] || [], params = { start: startFor(base, t0) };
  const inPlan = overlapping(doc.plan, t0, t1).length > 0;
  let plan;
  if (inPlan) { const c = carvePlan(doc.plan, t0, t1, { recipe, params, ids }); if (c.error) return c; plan = c.plan; }
  else plan = [{ ...makeSegment({ id: ids.seg, t0, t1, kind: kindForRecipe(recipe) }), recipe, params: coerceParams(recipe, params) }];
  const { ctx, turnsFor } = planCtx({ ...doc, activeAxis: axis }, { maxSpeed, plan });
  setTurns(turnsFor);   // the staleness stamps follow the same runs (as timeline/generate.js ctxOf does)
  const r = generatePlan(base, plan, { scope: 'selected', sel: [ids.seg], ctx: { ...ctx, minGapMs }, gen: GEN });
  return { script: r.script, plan: inPlan ? r.plan : null, id: ids.seg, issues: r.issues };
}

/** The plan kind a recipe belongs to: the kind whose default it is, else `fallback` (the carved segment's), else custom. */
export const kindForRecipe = (recipe, fallback) => Object.keys(KINDS).find((k) => KINDS[k].recipe === recipe) ?? fallback ?? 'custom';

/** Recipe picker rows: every recipe, labelled, the kind defaults first. */
export function recipeChoices() {
  const defaults = [...new Set(Object.values(KINDS).map((k) => k.recipe))];
  return [...defaults, ...Object.keys(RECIPES).filter((r) => !defaults.includes(r))].map((value) => ({ value, label: RECIPES[value].label }));
}

/** First move of a regenerated span: away from where the script is when the span starts (pos >= 50 -> go in). */
export const startFor = (base, t0) => (base.length && posAt(base, t0) < 50 ? 'out' : 'in');

/** Plan segments overlapping [t0, t1). */
export const overlapping = (plan, t0, t1) => (plan || []).filter((s) => s.t0 < t1 && s.t1 > t0);

/**
 * Carve [t0, t1] out of a plan and put one new segment there. Overlapping segments are trimmed to the outside
 * (a segment spanning the whole range is split in two, the right half under `ids.right`); a trimmed piece that was
 * up to date is re-stamped (its points are still right), the others keep their state. The new segment inherits the
 * run link (`source`) of the first segment it replaces. -> {plan, id} | {error}.
 */
export function carvePlan(plan, t0, t1, { recipe, params = {}, ids }) {
  const over = sorted(overlapping(plan, t0, t1));
  if (over.some((s) => s.locked)) return { error: 'A locked plan segment overlaps the range: unlock it first.' };
  const out = (plan || []).filter((s) => !over.includes(s)), fresh = [];
  for (const s of over) {
    const was = segState(s) === 'fresh';
    if (s.t0 < t0) { out.push({ ...s, t1: t0 }); if (was) fresh.push(s.id); }
    if (s.t1 > t1) { const id = s.t0 < t0 ? ids.right : s.id; out.push({ ...s, id, t0: t1 }); if (was) fresh.push(id); }
  }
  const seg = { ...makeSegment({ id: ids.seg, t0, t1, kind: kindForRecipe(recipe, over[0]?.kind) }), recipe, params: coerceParams(recipe, params) };
  if (over[0]?.source) seg.source = over[0].source;
  out.push(seg);
  return { plan: stamp(sorted(out), fresh), id: ids.seg };
}