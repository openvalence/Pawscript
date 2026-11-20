// Auto-wrapped lib/gen generators (contract §7, DESIGN §7 "Generate"): every GENERATORS entry becomes `gen.<id>` with
// each matching RECIPES entry as a palette variant, plus `gen.plan` (plan spans -> script through the injected
// compilePlan, or a local per-segment fallback with the same semantics).
//
// Written against src/lib/gen/README.md: GENERATORS[id] = { id, label, description, schema, gen(t0, t1, params, ctx) },
// RECIPES[id] = { gen, label, params }. Entries without that shape are skipped (listed in the result's `skipped`).

import { defineNode } from '../model.js';
import { normalize } from '../../core/script.js';
import { hashSeed, DEFAULTS } from '../../gen/util.js';
import { resolveSegment } from '../../gen/recipes.js';
import { flattenSpans } from '../types.js';
import { num, script, spans, req, points, appendJoined, seedParam, SEED_MAX } from './util.js';

const TURN_GENS = new Set(['follow', 'knot']);
const BEAT_GENS = new Set(['beats']);
const ICON = { hold: 'pause', strokes: 'stroke', ramp: 'speed', smooth: 'smooth', pulses: 'bolt', follow: 'crosshair', knot: 'repeat-stroke', tease: 'wave', beats: 'heart-rate' };
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const turnsOf = (list) => (list || []).map((s) => ({ at: s.t0, kind: s.kind }));
const beatsOf = (list) => (list || []).map((s) => s.t0);
const joinOpts = (p) => ({ maxSpeed: p.maxSpeed ?? DEFAULTS.maxSpeed, minGapMs: DEFAULTS.minGapMs, windowMs: DEFAULTS.blendMs });

function paramsOf(g) {
  const out = g.schema.map((q) => {
    const p = { ...q, default: clone(q.default) };
    if (p.key === 'seed') Object.assign(p, { type: 'int', min: 0, max: SEED_MAX, step: 1, seed: true });
    if (p.type === 'shape') p.editor = 'shape';
    if (Array.isArray(p.choices)) p.choices = [...p.choices];
    return p;
  });
  out.push(num('maxSpeed', 'Speed cap', DEFAULTS.maxSpeed, 0, 2000, 5, { unit: 'pos/s', group: 'Joins', hint: 'Speed cap, also at joins between spans (0: off)' }));
  return out;
}

function wrapOne(g, RECIPES) {
  const id = g.id;
  const ins = [];
  if (TURN_GENS.has(id)) ins.push(spans('turns', points));
  if (BEAT_GENS.has(id)) ins.push(spans('beats', points));
  const variants = Object.entries(RECIPES || {}).filter(([, r]) => r && r.gen === id)
    .map(([rid, r]) => ({ id: rid, title: r.label || rid, params: clone(r.params || {}), aliases: [rid] }));
  return defineNode({
    type: `gen.${id}`, title: g.label || id, group: 'Generate', icon: ICON[id] ?? 'wand',
    aliases: [id, ...variants.map((v) => v.title.toLowerCase())],
    help: `${g.description || g.label}${TURN_GENS.has(id) ? ' Turns: tracker turning points (e.g. "Turning points" of a ghost).' : ''}${BEAT_GENS.has(id) ? ' Beats: tap/beat times (e.g. bookmarks).' : ''} Generated over each "Only inside" span (with that span's kind overrides), joined under the speed cap; the whole video when unconnected.`,
    ins, outs: [script()], params: paramsOf(g), variants, perSpan: true,
    reads: () => [['durationMs']], // unconnected 'Only inside' = the whole timeline, whose length is not in the cache key
    eval(inputs, p, ctx) {
      const turns = turnsOf(inputs.turns), beats = beatsOf(inputs.beats);
      const list = ctx.where ? ctx.where.filter((s) => s.t1 > s.t0) : [{ t0: ctx.full.t0, t1: ctx.full.t1 }];
      const out = [];
      for (const span of list) {
        const q = ctx.where ? ctx.paramsFor(span) : p;
        const { maxSpeed, ...params } = q;
        const seed = ctx.where ? hashSeed('span', span.data?.id ?? span.t0) : 0;
        const piece = g.gen(span.t0, span.t1, params, { seed, maxSpeed, minGapMs: DEFAULTS.minGapMs, turns, beats });
        appendJoined(out, piece, joinOpts(q), (m) => ctx.warn(m));
      }
      if (TURN_GENS.has(id) && !inputs.turns && p.timing !== 'rate') ctx.info('no turns connected: strokes run at the fallback rate');
      return { script: out };
    },
  });
}

/** GENERATORS, RECIPES -> NodeDef[] (gen.<id>, recipes as variants). Skipped ids are in the result's `skipped`. */
export function wrapGenerators(GENERATORS, RECIPES) {
  const defs = [], skipped = [];
  for (const [key, g] of Object.entries(GENERATORS || {})) {
    if (!g || typeof g.gen !== 'function' || !Array.isArray(g.schema)) { skipped.push(key); continue; }
    defs.push(wrapOne({ ...g, id: g.id || key }, RECIPES));
  }
  defs.skipped = skipped;
  return defs;
}

// ---------------------------------------------------------------- gen.plan

/** Plan spans -> plan segments for compilePlan: flattened (no overlaps), unique ids, kind/recipe/params from span data. */
export function planFromSpans(list) {
  const seen = new Map();
  return flattenSpans(list || []).filter((s) => s.t1 > s.t0).map((s) => {
    let id = String(s.data?.id ?? `${s.kind ?? 'seg'}@${s.t0}`);
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    if (n) id = `${id}#${n}`;
    const seg = { id, t0: s.t0, t1: s.t1, kind: s.kind ?? 'custom' };
    if (s.data?.recipe) seg.recipe = s.data.recipe;
    if (s.data?.params && typeof s.data.params === 'object') seg.params = s.data.params;
    return seg;
  });
}

/** compilePlan's semantics without lib/gen/plan.js: each segment by its recipe over its own span, joined under the cap. */
export function fallbackCompilePlan(plan, ctx = {}) {
  const issues = [], script = [];
  const opts = { maxSpeed: ctx.maxSpeed ?? DEFAULTS.maxSpeed, minGapMs: Math.max(1, ctx.minGapMs ?? DEFAULTS.minGapMs), windowMs: ctx.blendMs ?? DEFAULTS.blendMs };
  for (const seg of [...plan].sort((a, b) => a.t0 - b.t0)) {
    let r;
    try { r = resolveSegment(seg); } catch (e) { issues.push({ id: seg.id, level: 'error', msg: e.message }); continue; }
    const piece = r.gen(seg.t0, seg.t1, r.params, { ...ctx, seed: hashSeed(ctx.seed ?? 0, seg.id) });
    appendJoined(script, piece, opts, (msg) => issues.push({ id: seg.id, level: 'warn', msg }));
  }
  return { script: normalize(script), issues };
}

/** gen.plan with the given compiler (lib/gen compilePlan signature), or the local fallback. */
export function makePlanNode(compilePlan = null) {
  const compile = typeof compilePlan === 'function' ? compilePlan : fallbackCompilePlan;
  return defineNode({
    type: 'gen.plan', title: 'Compile plan', group: 'Generate', icon: 'layers',
    aliases: ['plan', 'segments', 'recipes', 'auto script', 'compile'],
    help: 'Generates every plan span with its own recipe (kind default, or the segment\'s recipe and params), joined under the speed cap. Gaps stay empty. Turns feed the follow/knot recipes.',
    ins: [spans('segments', req), spans('turns', points)], outs: [script()],
    params: [seedParam(), num('maxSpeed', 'Speed cap', DEFAULTS.maxSpeed, 0, 2000, 5, { unit: 'pos/s', inline: true })],
    eval({ segments, turns }, p, ctx) {
      const res = compile(planFromSpans(segments), { seed: p.seed, maxSpeed: p.maxSpeed, turns: turnsOf(turns) });
      for (const i of res.issues || []) ctx.warn(`${i.id ?? 'plan'}: ${i.msg}`);
      if (!compilePlan) ctx.info('using the built-in plan compiler (lib/gen compilePlan not injected)');
      return { script: res.script };
    },
  });
}
