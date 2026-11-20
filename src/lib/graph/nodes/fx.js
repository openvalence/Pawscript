// The effects layer in the graph (lib/fx.js): `src.fx` emits the document's effects as spans (kind = effect kind,
// data = {id, params}), `fx.apply` runs applyFx over its script with the effects it gets on "Only inside". byKind
// overrides of fx.apply add to (and win over) each effect's own params.

import { defineNode } from '../model.js';
import { normSpans } from '../types.js';
import { applyFx, liveFx, FX_KINDS, isPointFx } from '../../fx.js';
import { DEFAULTS } from '../../gen/util.js';
import { num, script, spans, req } from './util.js';

export const srcFx = defineNode({
  type: 'src.fx', title: 'Modifiers', group: 'Sources', icon: 'layers',
  aliases: ['effects', 'fx', 'modifiers', 'knot', 'orgasm', 'shape', 'layer'],
  help: 'The Modifiers row as spans: kind = modifier kind (knotting, orgasm, throbbing, idle, shape; spurt as a point), data = {id, params}. Muted modifiers are left out.',
  ins: [], outs: [spans()], params: [],
  reads: () => [['fx']], halo: () => 0, local: true,
  eval: (_in, _p, ctx) => ({ spans: normSpans(liveFx(ctx.read('fx')).map((e) => ({ t0: e.t0, t1: e.t1, kind: e.kind,
    label: e.label || FX_KINDS[e.kind].label, data: { id: e.id, params: e.params || {} } }))) }),
  summary: ({ spans: s }) => `${s.length} modifiers`,
});

export const fxApply = defineNode({
  type: 'fx.apply', title: 'Apply modifiers', group: 'Generate', icon: 'wand',
  aliases: ['effects', 'fx', 'modifiers', 'layer', 'knot', 'orgasm', 'shape'],
  help: 'The modifiers over a script (usually the tracker): inside each "Only inside" span (from Modifiers) the script is re-shaped from its own turning points by the span\'s kind — knotting, orgasm, throbbing, idle, shape. Outside the spans the script passes through unchanged.',
  ins: [script('script', req)], outs: [script()],
  params: [num('maxSpeed', 'Speed cap', DEFAULTS.maxSpeed, 0, 2000, 5, { unit: 'pos/s', inline: true })],
  perSpan: true,
  bypass: { script: 'script' },
  eval({ script: s }, p, ctx) {
    if (!ctx.where) { ctx.info('connect Modifiers to "Only inside"'); return { script: s }; }
    const fx = ctx.where.filter((x) => x.t1 > x.t0 || isPointFx(x)).map((x) => {
      const { maxSpeed: _, ...over } = ctx.paramsFor(x);
      return { id: x.data?.id ?? `${x.kind}@${x.t0}`, kind: x.kind, t0: x.t0, t1: x.t1, params: { ...(x.data?.params || {}), ...over } };
    });
    const unknown = [...new Set(fx.filter((e) => !FX_KINDS[e.kind]).map((e) => e.kind))];
    if (unknown.length) ctx.info(`not modifier kinds, passed through: ${unknown.join(', ')}`);
    return { script: applyFx(s, fx, { maxSpeed: p.maxSpeed }) };
  },
});

export const FX = [srcFx, fxApply];
