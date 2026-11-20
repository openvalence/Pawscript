// plan.js -- plan segments on top of intervals.js, in gen-lib's shape:
//   {id, t0, t1, kind, recipe, params, name?, locked?, genKey?}
// params are SPARSE overrides of the recipe (gen: schema default < recipe params < segment params); intensity
// is the param `intensity` (0..1, default 1). genKey = segKey() when the segment was last generated into the
// script: a segment is 'new' (never generated), 'fresh', 'stale' (edited since) or 'locked' (skipped).
// Import/export: plan <-> sidecar spans <-> director timeline JSON. Pure.
import { RECIPES, recipeSchema } from '../../lib/gen/recipes.js';
import { COMMON_SCHEMA } from '../../lib/gen/generators.js';
import { kindOf, kindFromName, SPAN_KIND } from './kinds.js';
import { sorted, patch } from './intervals.js';

const COMMON = new Set(COMMON_SCHEMA.map((p) => p.key));
export const recipeIds = () => Object.keys(RECIPES);
export const recipeLabel = (id) => RECIPES[id]?.label ?? id ?? '?';
/** The recipe's form schema (generator schema with the recipe's defaults), [] for an unknown recipe. */
export const schemaOf = (id) => (RECIPES[id] ? recipeSchema(id) : []);
/** Recipe names the plan uses that the recipe registry does not know (sorted, unique). */
export const unknownRecipes = (plan) => [...new Set((plan ?? []).map((s) => s?.recipe).filter((r) => r != null && !RECIPES[r]))].sort();
/** Effective value of a param: the segment's override, else the recipe's default. */
export const paramValue = (s, key) => s.params?.[key] ?? schemaOf(s.recipe).find((p) => p.key === key)?.default;
export const intensityOf = (s) => { const v = Number(s.params?.intensity ?? 1); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1; };

/** Overrides made valid for the recipe's schema: unknown keys dropped, numbers clamped, bad choices dropped. */
export function coerceParams(recipe, params = {}) {
  const out = {};
  for (const p of schemaOf(recipe)) {
    let v = params[p.key];
    if (v === undefined) continue;
    if (p.type === 'bool') v = !!v;
    else if (p.type === 'choice') { if (!(p.choices || []).some((c) => (c?.value ?? c) === v)) continue; }
    else if (p.type === 'number' || p.type === 'int' || p.type === 'float') {
      v = Number(v);
      if (!Number.isFinite(v)) continue;
      if (p.type === 'int') v = Math.round(v);
      if (p.min != null) v = Math.max(p.min, v);
      if (p.max != null) v = Math.min(p.max, v);
    }
    out[p.key] = v;
  }
  return out;
}

export function makeSegment({ id, t0, t1, kind = 'penetration', name, params }) {
  const k = kindOf(kind);
  const s = { id, t0: Math.round(t0), t1: Math.round(t1), kind: k.id, recipe: k.recipe, params: coerceParams(k.recipe, params) };
  if (name) s.name = name;
  return s;
}

/** Change kind. A segment on its old kind's default recipe moves to the new kind's; a custom recipe stays. Overrides that still apply are kept. */
export function setKind(plan, ids, kind) {
  const k = kindOf(kind);
  return patch(plan, ids, (s) => (s.recipe !== kindOf(s.kind).recipe ? { kind: k.id } : { kind: k.id, recipe: k.recipe, params: coerceParams(k.recipe, s.params) }));
}
export const setRecipe = (plan, ids, recipe) => patch(plan, ids, (s) => ({ recipe, params: coerceParams(recipe, s.params) }));
/** Merge overrides; a value of undefined removes the override (back to the recipe default). */
export const setParams = (plan, ids, params) => patch(plan, ids, (s) => {
  const next = { ...s.params, ...params };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return { params: coerceParams(s.recipe, next) };
});

// ---- generation state ----
export const segKey = (s) => JSON.stringify([s.t0, s.t1, s.kind, s.recipe, s.params ?? {}]);

// Segments that follow tracked strokes (gen follow / knot) also go stale when the turns of the run they follow
// change: their stamp carries a signature of that run's turns inside [t0 - 10 s, t1 + 10 s]. The turns come from
// setTurns: a function seg -> turns of its chosen run (generate.js planCtx.turnsFor), an array (one run for all),
// or null. No turns for a segment = unknown (no run loaded): turn changes are not flagged.
const TURN_GENS = new Set(['follow', 'knot']), CONTEXT_MS = 10000;
let turnsFor = null;
export const setTurns = (t) => { turnsFor = typeof t === 'function' ? t : t?.length ? () => t : null; };
export function turnsSig(s, turns = turnsFor?.(s)) {
  if (!turns?.length || !TURN_GENS.has(RECIPES[s.recipe]?.gen)) return '';
  const at = (i) => turns[i].at ?? turns[i];
  let lo = 0, hi = turns.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (at(m) < s.t0 - CONTEXT_MS) lo = m + 1; else hi = m; }
  let h = 2166136261, n = 0;
  for (let i = lo; i < turns.length && at(i) <= s.t1 + CONTEXT_MS; i++, n++) h = Math.imul(h ^ Math.round(at(i)), 16777619) >>> 0;
  return n + ':' + h.toString(36);
}
const genKeyOf = (s) => { const t = turnsSig(s); return t ? segKey(s) + '|' + t : segKey(s); };
export function segState(s) {
  if (s.locked) return 'locked';
  if (s.genKey == null) return 'new';
  const key = segKey(s), t = turnsSig(s);
  if (s.genKey === (t ? key + '|' + t : key)) return 'fresh';
  return !t && s.genKey.startsWith(key + '|') ? 'fresh' : 'stale';
}
/** Segments a Generate should write. scope: 'needed' (new + stale) | 'all' | 'selected'. Locked never. */
export function genTargets(plan, scope = 'needed', selIds = []) {
  const sel = new Set(selIds);
  return plan.filter((s) => !s.locked && (scope === 'all' || (scope === 'selected' ? sel.has(s.id) : segState(s) !== 'fresh')));
}
export const stamp = (plan, ids) => patch(plan, ids, (s) => ({ genKey: genKeyOf(s) }));

const fmtVal = (v, p) => {
  if (v && typeof v === 'object') return v.name ?? 'custom';
  if (typeof v === 'number') return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + (p?.unit && p.unit.length <= 3 && p.unit !== p.key ? p.unit : '');
  return v === true ? 'on' : v === false ? 'off' : String(v);
};
/** Short summary for the block label: the range (lo-hi) first, then the first other recipe params. */
export function paramSummary(s, max = 3) {
  const sch = schemaOf(s.recipe).filter((p) => !COMMON.has(p.key));
  const out = [], lo = sch.find((p) => p.key === 'lo'), hi = sch.find((p) => p.key === 'hi');
  if (lo && hi) out.push(`${paramValue(s, 'lo')}–${paramValue(s, 'hi')}`);
  for (const p of sch) {
    if (out.length >= max) break;
    if (p.key === 'lo' || p.key === 'hi' || p.type === 'json') continue;
    out.push(`${p.short || p.key} ${fmtVal(paramValue(s, p.key), p)}`);
  }
  return out.join(' · ');
}

// ---- spans (track request `spans`, and the v3 activity events) ----
/** Plan -> [{start_ms, end_ms, state}], touching equal states merged. */
export function toSpans(plan) {
  const out = [];
  for (const s of sorted(plan)) {
    const state = kindOf(s.kind).span, last = out[out.length - 1];
    if (last && last.state === state && last.end_ms === s.t0) last.end_ms = s.t1;
    else out.push({ start_ms: s.t0, end_ms: s.t1, state });
  }
  return out;
}

/**
 * Anything timeline-shaped -> {plan, warnings, format}. Accepts:
 *   sidecar spans      [{start_ms, end_ms, state}]  or {spans: [...]}
 *   track events       [{t_ms, end_ms, kind}]  (only span kinds: idle/carry/still/climax/orgasm)
 *   director timeline  [{start_ms, end_ms, kind, intensity?, recipe?, params?, name?}]  or {segments|timeline|plan: [...]}
 * Overlaps are trimmed (earlier wins), everything is clamped to [0, dur] and rounded to ms.
 */
export function importTimeline(input, { dur = Infinity, newId, minLen = 1 } = {}) {
  const warnings = [];
  let data = typeof input === 'string' ? JSON.parse(input) : input;
  let format = 'director';
  if (data && !Array.isArray(data)) {
    if (Array.isArray(data.spans)) { data = data.spans; format = 'spans'; }
    else data = data.segments || data.timeline || data.plan || data.events;
  }
  if (!Array.isArray(data)) throw new Error('expected an array of segments (or {segments|spans|timeline: [...]})');
  const rows = [];
  for (const [i, e] of data.entries()) {
    if (!e || typeof e !== 'object') { warnings.push(`#${i + 1}: not an object, skipped`); continue; }
    const t0 = Number(e.start_ms ?? e.t_ms ?? e.t0 ?? (e.start != null ? e.start * 1000 : NaN));
    const t1 = Number(e.end_ms ?? e.t1 ?? (e.end != null ? e.end * 1000 : NaN));
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) { warnings.push(`#${i + 1}: bad start/end, skipped`); continue; }
    let kind, name;
    if (e.state != null && e.kind == null) { format = 'spans'; kind = SPAN_KIND[e.state]; if (!kind) { warnings.push(`#${i + 1}: unknown state "${e.state}", skipped`); continue; } }
    else if (e.t_ms != null && SPAN_KIND[e.kind]) { format = 'events'; kind = SPAN_KIND[e.kind]; }
    else {
      kind = kindFromName(e.kind);
      if (!kind) { kind = 'custom'; name = String(e.kind ?? ''); if (name) warnings.push(`#${i + 1}: unknown kind "${name}", used Custom`); }
    }
    const s = makeSegment({ id: newId(), t0, t1, kind, name: e.name || name });
    if (e.recipe != null) {
      if (RECIPES[e.recipe]) s.recipe = e.recipe;
      else warnings.push(`#${i + 1}: unknown recipe "${e.recipe}", used ${s.recipe}`);
    }
    const params = { ...(e.params || {}) };
    let it = Number(e.intensity ?? params.intensity);
    if (Number.isFinite(it)) { if (it > 10) it /= 100; else if (it > 1) it /= 10; params.intensity = Math.max(0, Math.min(1, it)); }
    s.params = coerceParams(s.recipe, params);
    if (e.locked) s.locked = true;
    rows.push(s);
  }
  rows.sort((a, b) => a.t0 - b.t0);
  const plan = [];
  for (const s of rows) {
    const t0 = Math.max(s.t0, plan.length ? plan[plan.length - 1].t1 : 0, 0), t1 = Math.min(s.t1, dur);
    if (t1 - t0 < minLen) { warnings.push(`segment at ${s.t0} ms overlaps or lies outside the video, dropped`); continue; }
    if (t0 !== s.t0 || t1 !== s.t1) warnings.push(`segment at ${s.t0} ms trimmed to ${t0}-${t1} ms`);
    plan.push({ ...s, t0, t1 });
  }
  return { plan, warnings, format };
}

/** Plan -> director timeline JSON rows (intensity also lifted to the top level). */
export const toDirector = (plan) => sorted(plan).map((s) => ({
  start_ms: s.t0, end_ms: s.t1, kind: s.kind, intensity: intensityOf(s), recipe: s.recipe, params: { ...s.params },
  ...(s.name ? { name: s.name } : {}), ...(s.locked ? { locked: true } : {}),
}));
