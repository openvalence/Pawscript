// Flow nodes (DESIGN §7 "Flow"): generic over the `any` type, resolved by the engine from the first connected input.
// The value's concrete type is recovered at run time with types.js typeOfValue (an empty array is ambiguous between
// script and spans, and either reading of [] gives the same result here).

import { defineNode } from '../model.js';
import { posAt, clampPos, lowerBound } from '../../core/script.js';
import { typeOfValue, intersectSpans, invertSpans, normSpans, flattenSpans } from '../types.js';
import { num, int, any, req, genSignal, reader, spanStep, splice } from './util.js';
import { trimTo, needWhere } from './script.js';

const G = 'Flow';
const NOT_NUMBER = ['script', 'signal', 'spans'];

/** Spans minus `where` within the extent of `list`. */
function minusSpans(list, where) {
  if (!list.length) return [];
  const lo = Math.min(...list.map((s) => s.t0)), hi = Math.max(...list.map((s) => s.t1)) + 1;
  return intersectSpans(list, invertSpans(where, lo, hi));
}

/** Script crossfade: A outside, B inside, pointwise mix over fadeMs around each boundary (weight = box-averaged indicator). */
function crossfadeScripts(a, b, where, fadeMs) {
  const w = spanStep(where, () => 1, 0, fadeMs);
  const flat = flattenSpans(where).filter((s) => s.t1 > s.t0), h = fadeMs / 2;
  const inFade = (t) => { // within h of a boundary
    let lo = 0, hi = flat.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (flat[m].t1 + h < t) lo = m + 1; else hi = m; }
    for (let i = lo; i < flat.length && flat[i].t0 - h <= t; i++) if (Math.abs(t - flat[i].t0) <= h || Math.abs(t - flat[i].t1) <= h) return true;
    return false;
  };
  const has = (s, t) => s.length && t >= s[0].at && t <= s[s.length - 1].at;
  const ts = [...new Set([...a.map((x) => x.at), ...b.map((x) => x.at)])].sort((x, y) => x - y);
  const out = [];
  for (const t of ts) {
    const k = w(t);
    if (k === 0) { const i = lowerBound(a, t); if (a[i]?.at === t) out.push(a[i]); continue; }
    if (k === 1) { const i = lowerBound(b, t); if (b[i]?.at === t) out.push(b[i]); continue; }
    if (!inFade(t)) continue;
    const ha = has(a, t), hb = has(b, t);
    if (!ha && !hb) continue;
    const pos = ha && hb ? (1 - k) * posAt(a, t) + k * posAt(b, t) : ha ? posAt(a, t) : posAt(b, t);
    out.push({ at: t, pos: clampPos(pos) });
  }
  return out;
}

export const switchNode = defineNode({
  type: 'flow.switch', title: 'Switch by spans', group: G, icon: 'split',
  aliases: ['choose', 'if', 'per kind', 'replace inside', 'route', 'select by spans'],
  help: 'B inside the spans, A outside. Scripts are spliced (cut with exact edge points, or crossfaded over Fade); signals are selected or crossfaded; spans are clipped and merged.',
  ins: [any('a', { required: true, accepts: NOT_NUMBER }), any('b', { required: true, accepts: NOT_NUMBER })], outs: [any('out')],
  perSpan: true, // 'where' (required here) is the engine-added input
  params: [num('fadeMs', 'Fade', 0, 0, 60000, 10, { unit: 'ms', inline: true })],
  halo: (p) => p.fadeMs, local: true, bypass: { out: 'a' },
  eval({ a, b, where }, p, ctx) {
    needWhere(where);
    const T = typeOfValue(a) ?? typeOfValue(b);
    if (T === 'number') throw new Error('switch needs scripts, signals or spans');
    if (T === 'signal') {
      const g = ctx.grid(), ra = reader(a), rb = reader(b), w = spanStep(where, () => 1, 0, p.fadeMs);
      return { out: genSignal(ctx, (k, t) => { const x = w(t), i = g.i0 + k; return x === 0 ? ra(i) : x === 1 ? rb(i) : (1 - x) * ra(i) + x * rb(i); }) };
    }
    if (T === 'spans') return { out: normSpans([...minusSpans(a, where), ...intersectSpans(b, where)]) };
    if (T === null) return { out: [] };
    return { out: p.fadeMs > 0 ? crossfadeScripts(a, b, where, p.fadeMs) : splice(a, b, where, { seam: 'cut' }) };
  },
});

export const gate = defineNode({
  type: 'flow.gate', title: 'Gate by spans', group: G, icon: 'filter',
  aliases: ['only inside', 'mask', 'restrict', 'keep inside', 'crop'],
  help: 'Restricts a value to the spans: scripts keep their actions inside (with exact edge points), signals become unknown (NaN) outside, spans are intersected.',
  ins: [any('in', { required: true, accepts: NOT_NUMBER })], outs: [any('out')],
  perSpan: true,
  params: [],
  halo: () => 0, local: true, bypass: { out: 'in' },
  eval({ in: x, where }, _p, ctx) {
    needWhere(where);
    const T = typeOfValue(x);
    if (T === 'number') throw new Error('gate needs a script, signal or spans');
    if (T === 'signal') {
      const g = ctx.grid(), rd = reader(x), w = spanStep(where, () => 1, 0, 0);
      return { out: genSignal(ctx, (k, t) => (w(t) ? rd(g.i0 + k) : NaN)) };
    }
    if (T === 'spans') return { out: intersectSpans(x, where) };
    if (T === null) return { out: [] };
    return { out: trimTo(x, where, true) };
  },
});

export const select = defineNode({
  type: 'flow.select', title: 'Select input', group: G, icon: 'list',
  aliases: ['a/b', 'ab', 'choose', 'switch chain', 'compare', 'variant'],
  help: 'Passes input number Pick on: a one-key A/B between whole chains, saved with the graph.',
  ins: [any('in0'), any('in1'), any('in2'), any('in3')], outs: [any('out')],
  params: [int('pick', 'Pick', 0, 0, 3, { inline: true })],
  halo: () => 0, local: true, bypass: { out: 'in0' },
  eval(ins, p) {
    const v = ins[`in${p.pick}`];
    if (v === undefined) throw new Error(`input in${p.pick} is not connected`);
    return { out: v };
  },
});

export const reroute = defineNode({
  type: 'flow.reroute', title: 'Reroute', group: G, icon: 'dot',
  aliases: ['dot', 'relay', 'wire', 'pass'],
  help: 'A dot on a wire: passes its input on unchanged.',
  ins: [any('in', req)], outs: [any('out')],
  params: [],
  halo: () => 0, local: true, bypass: { out: 'in' },
  eval: ({ in: x }) => ({ out: x }),
});

export const FLOW = [switchNode, gate, select, reroute];

