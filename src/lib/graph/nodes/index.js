// The node catalogue (contract §7): built-in node definitions plus the auto-wrapped lib/edit ops and lib/gen
// generators. createCatalogue() is the registry the editor, the engine and the presets use.
//
// Palette groups, in registration order: Sources, Constants, Generate, Edit · …, Select, Script · analysis,
// Script · structure, Amplitude, Signal, Signal · generators, Spans, Flow, Analyze, Output.

import { createRegistry } from '../model.js';
import { OPS } from '../../edit/index.js';
import { GENERATORS } from '../../gen/generators.js';
import { RECIPES } from '../../gen/recipes.js';
import { SOURCES } from './sources.js';
import { SCRIPT } from './script.js';
import { AMP } from './amp.js';
import { SIGNAL } from './signal.js';
import { SPANS } from './spans.js';
import { FLOW } from './flow.js';
import { ANALYZE } from './analyze.js';
import { OUTPUTS } from './out.js';
import { FX } from './fx.js';
import { wrapEditOps } from './edit.js';
import { wrapGenerators, makePlanNode } from './gen.js';

export { wrapEditOps, EXCLUDED_OPS, EDIT_HALO, FOLD_HALO, TIME_SHIFT_OPS } from './edit.js';
export { wrapGenerators, makePlanNode, planFromSpans, fallbackCompilePlan } from './gen.js';
export { parseExpr, checkExpr, EXPR_FUNCS, EXPR_VARS } from './expr.js';

const FALLBACK_PLAN = makePlanNode(null);

/** Every hand-written node definition (gen.plan with its local fallback compiler). */
export const BUILTINS = Object.freeze([...SOURCES, ...SCRIPT, ...AMP, ...SIGNAL, ...SPANS, ...FLOW, ...ANALYZE, ...OUTPUTS, ...FX, FALLBACK_PLAN]);

const before = (list, type) => list.filter((d) => d.type !== type);

/**
 * BUILTINS + wrapEditOps(OPS) + wrapGenerators(GENERATORS, RECIPES) as one Registry.
 * compilePlan: lib/gen's plan compiler when the caller has it; without it gen.plan uses the local fallback.
 */
export function createCatalogue({ compilePlan } = {}) {
  const plan = typeof compilePlan === 'function' ? makePlanNode(compilePlan) : FALLBACK_PLAN;
  const sources = before(BUILTINS, 'gen.plan').filter((d) => d.type.startsWith('src.') || d.type.startsWith('const.'));
  const rest = before(BUILTINS, 'gen.plan').filter((d) => !d.type.startsWith('src.') && !d.type.startsWith('const.'));
  return createRegistry([...sources, ...wrapGenerators(GENERATORS, RECIPES), plan, ...wrapEditOps(OPS), ...rest]);
}
