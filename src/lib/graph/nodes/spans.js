// Spans nodes (DESIGN §7 "Spans"): filter, combine, reshape spans, and turn them into signals (the depth-by-kind
// path: spans.kindRange → amp.remap). Span lists from sources are always complete, so per-span nodes are local.

import { defineNode } from '../model.js';
import { normSpans, unionSpans, intersectSpans, invertSpans, flattenSpans } from '../types.js';
import { CURVES } from '../../gen/util.js';
import { num, choice, text, json, spans, signal, req, points, spanStep, genSignal, finiteRuns } from './util.js';

const G = 'Spans';
const unary = { ins: [spans('spans', req)], outs: [spans()], bypass: { spans: 'spans' }, halo: () => 0, local: true };
const isPoint = (s) => s.t0 === s.t1;

export const filter = defineNode({
  ...unary, type: 'spans.filter', title: 'Filter spans', group: G, icon: 'filter',
  aliases: ['kind', 'only', 'select spans', 'climax', 'where', 'value'],
  help: 'Keeps spans by kind, label text, duration and value. Empty kinds = any kind; a max of 0 = no limit.',
  params: [
    json('kinds', 'Kinds', [], { editor: 'kinds', inline: true }),
    text('labelContains', 'Label contains', ''),
    num('minMs', 'Min duration', 0, 0, 1e9, 10, { unit: 'ms' }),
    num('maxMs', 'Max duration (0 = any)', 0, 0, 1e9, 10, { unit: 'ms' }),
    choice('value', 'Value test', 'any', ['any', 'above', 'below', 'between']),
    num('valueA', 'Value', 0, -1e9, 1e9, 0.01),
    num('valueB', 'Value (upper, between)', 1, -1e9, 1e9, 0.01),
  ],
  eval({ spans: list }, p) {
    const kinds = Array.isArray(p.kinds) && p.kinds.length ? new Set(p.kinds) : null;
    const needle = String(p.labelContains || '').toLowerCase();
    return { spans: list.filter((s) => {
      if (kinds && !kinds.has(s.kind)) return false;
      if (needle && !String(s.label ?? '').toLowerCase().includes(needle)) return false;
      const d = s.t1 - s.t0;
      if (d < p.minMs || (p.maxMs > 0 && d > p.maxMs)) return false;
      if (p.value !== 'any') {
        const v = s.value;
        if (typeof v !== 'number') return false;
        if (p.value === 'above' && !(v > p.valueA)) return false;
        if (p.value === 'below' && !(v < p.valueA)) return false;
        if (p.value === 'between' && !(v >= Math.min(p.valueA, p.valueB) && v <= Math.max(p.valueA, p.valueB))) return false;
      }
      return true;
    }) };
  },
});

export const not = defineNode({
  ...unary, type: 'spans.not', title: 'Invert spans', group: G, icon: 'flip',
  aliases: ['outside', 'gaps', 'complement', 'everything else'],
  help: 'The parts of the timeline (0 .. video end) no span covers.',
  params: [text('kind', 'Kind', 'outside')],
  reads: () => [['durationMs']], // the timeline end is an input (it is not part of the engine's cache key)
  eval: ({ spans: list }, p, ctx) => ({ spans: invertSpans(list, ctx.full.t0, ctx.full.t1).map((s) => (p.kind ? { ...s, kind: p.kind } : s)) }),
});

export const pad = defineNode({
  ...unary, type: 'spans.pad', title: 'Pad spans', group: G, icon: 'expand',
  aliases: ['grow', 'shrink', 'extend', 'margin', 'widen'],
  help: 'Moves each span\'s start earlier by Before and its end later by After (negative shrinks; spans shrunk below zero length disappear, points stay points when both are 0).',
  params: [num('beforeMs', 'Before', 0, -600000, 600000, 10, { unit: 'ms', inline: true }), num('afterMs', 'After', 0, -600000, 600000, 10, { unit: 'ms', inline: true })],
  eval({ spans: list }, p) {
    const out = [];
    for (const s of list) {
      const t0 = Math.max(0, s.t0 - p.beforeMs), t1 = s.t1 + p.afterMs;
      if (t1 < t0 || (t1 === t0 && !isPoint(s))) continue;
      out.push({ ...s, t0, t1 });
    }
    return { spans: normSpans(out) };
  },
});

export const mergeGaps = defineNode({
  ...unary, type: 'spans.mergeGaps', title: 'Close gaps', group: G, icon: 'link',
  aliases: ['merge', 'join', 'bridge', 'fill gaps', 'debounce'],
  help: 'Joins consecutive spans separated by less than Gap (overlaps join too). The merged span keeps the first span\'s kind and label.',
  params: [num('gapMs', 'Gap', 500, 0, 600000, 10, { unit: 'ms', inline: true })],
  halo: (p) => p.gapMs,
  eval({ spans: list }, p) {
    const out = [];
    for (const s of list) {
      if (isPoint(s)) continue;
      const last = out[out.length - 1];
      if (last && s.t0 - last.t1 < p.gapMs) { if (s.t1 > last.t1) last.t1 = s.t1; }
      else out.push({ ...s });
    }
    return { spans: out };
  },
});

export const shift = defineNode({
  ...unary, type: 'spans.shift', title: 'Shift spans', group: G, icon: 'arrow-right',
  aliases: ['offset', 'move', 'delay', 'lag'],
  help: 'Moves every span in time (positive = later). Clamped at 0.',
  params: [num('ms', 'Shift', 0, -600000, 600000, 1, { unit: 'ms', inline: true })],
  eval: ({ spans: list }, p) => ({ spans: normSpans(list.map((s) => ({ ...s, t0: Math.max(0, s.t0 + p.ms), t1: Math.max(0, s.t1 + p.ms) }))) }),
});

export const relabel = defineNode({
  ...unary, type: 'spans.relabel', title: 'Relabel spans', group: G, icon: 'pen',
  aliases: ['rename', 'kind', 'label', 'tag'],
  help: 'Sets the kind and/or label of every span (empty = keep).',
  params: [text('kind', 'Kind', ''), text('label', 'Label', '')],
  eval: ({ spans: list }, p) => ({ spans: list.map((s) => ({ ...s, ...(p.kind ? { kind: p.kind } : {}), ...(p.label ? { label: p.label } : {}) })) }),
});

export const between = defineNode({
  type: 'spans.between', title: 'Spans between points', group: G, icon: 'split',
  aliases: ['cuts to scenes', 'segments', 'intervals', 'gaps between'],
  help: 'The spans between consecutive points (e.g. cuts → scenes). With edges, also from the video start to the first point and from the last point to the end.',
  ins: [spans('spans', { required: true, ...points })], outs: [spans()],
  params: [choice('edges', 'Edges', 'include', ['include', 'exclude']), text('kind', 'Kind', 'between')],
  reads: (p) => (p.edges === 'include' ? [['durationMs']] : []),
  bypass: { spans: 'spans' },
  eval({ spans: list }, p, ctx) {
    let T = [...new Set(list.map((s) => s.t0))].sort((a, b) => a - b);
    if (p.edges === 'include') T = [...new Set([ctx.full.t0, ...T, ctx.full.t1])].sort((a, b) => a - b);
    const out = [];
    for (let k = 0; k + 1 < T.length; k++) if (T[k + 1] > T[k]) out.push({ t0: T[k], t1: T[k + 1], ...(p.kind ? { kind: p.kind } : {}) });
    return { spans: out };
  },
});

const binary = { ins: [spans('a', req), spans('b', req)], outs: [spans()], bypass: { spans: 'a' }, halo: () => 0, local: true };

export const and = defineNode({
  ...binary, type: 'spans.and', title: 'Intersect (and)', group: G, icon: 'layers',
  aliases: ['intersection', 'both', 'overlap', 'and'],
  help: 'Where both A and B are. Kind and label come from A.',
  params: [],
  eval: ({ a, b }) => ({ spans: intersectSpans(a, b) }),
});

export const or = defineNode({
  ...binary, type: 'spans.or', title: 'Union (or)', group: G, icon: 'add',
  aliases: ['union', 'either', 'combine', 'or'],
  help: 'Where A or B is (touching spans merge; a merged span keeps its earliest member\'s kind).',
  params: [],
  eval: ({ a, b }) => ({ spans: unionSpans(a, b) }),
});

export const minus = defineNode({
  ...binary, type: 'spans.minus', title: 'Subtract', group: G, icon: 'remove',
  aliases: ['difference', 'except', 'without', 'minus'],
  help: 'Where A is but B is not. Kind and label come from A.',
  params: [],
  eval({ a, b }) {
    if (!a.length) return { spans: [] };
    const lo = Math.min(...a.map((s) => s.t0)), hi = Math.max(...a.map((s) => s.t1)) + 1;
    return { spans: intersectSpans(a, invertSpans(b, lo, hi)) };
  },
});

export const threshold = defineNode({
  type: 'spans.threshold', title: 'Threshold → spans', group: G, icon: 'heatmap',
  aliases: ['gate', 'detect', 'above', 'below', 'confidence', 'hysteresis', 'condition'],
  help: 'Spans where a signal is above (or below, or between) a level, with hysteresis against chatter. Unknown samples end a span. Spans shorter than Min duration are dropped.',
  ins: [signal('signal', req)], outs: [spans()],
  params: [choice('mode', 'When', 'above', ['above', 'below', 'between', 'outside']),
    num('level', 'Level', 50, -1e6, 1e6, 0.01, { inline: true }), num('level2', 'Upper level (between/outside)', 80, -1e6, 1e6, 0.01),
    num('hysteresis', 'Hysteresis', 2, 0, 1e6, 0.01), num('minMs', 'Min duration', 0, 0, 1e9, 10, { unit: 'ms' }), text('kind', 'Kind', 'on')],
  eval({ signal: x }, p) {
    const lo = Math.min(p.level, p.level2), hi = Math.max(p.level, p.level2), h = p.hysteresis / 2;
    // on-test with hysteresis: enter beyond the level by h, leave beyond it by h the other way
    const test = (v, on) => {
      switch (p.mode) {
        case 'below': return on ? v < p.level + h : v < p.level - h;
        case 'between': return on ? v > lo - h && v < hi + h : v > lo + h && v < hi - h;
        case 'outside': return on ? v < lo + h || v > hi - h : v < lo - h || v > hi + h;
        default: return on ? v > p.level - h : v > p.level + h;
      }
    };
    const out = [], v = x.v;
    for (const [k0, k1] of finiteRuns(v)) {
      let on = false, start = 0;
      for (let k = k0; k < k1; k++) {
        const now = test(v[k], on);
        if (now && !on) start = k;
        if (!now && on) out.push([start, k]);
        on = now;
      }
      if (on) out.push([start, k1]);
    }
    const res = [];
    for (const [a, b] of out) {
      const t0 = (x.i0 + a) * x.dt, t1 = (x.i0 + b) * x.dt;
      if (t1 - t0 >= p.minMs && t1 > t0) res.push({ t0, t1, ...(p.kind ? { kind: p.kind } : {}) });
    }
    return { spans: res };
  },
});

const pair = (v, d) => {
  const f = (x) => (Array.isArray(x) && x.length >= 2 && Number.isFinite(+x[0]) && Number.isFinite(+x[1]) ? [+x[0], +x[1]] : Number.isFinite(+x) && x !== null && x !== '' ? [+x, +x] : null);
  return f(v) ?? f(d) ?? [10, 90];
};
const one = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' && !Array.isArray(v) ? +v : Array.isArray(v) && Number.isFinite(+v[0]) ? +v[0] : Number.isFinite(+d) ? +d : 0);
const tableOf = (t) => (t && typeof t === 'object' && !Array.isArray(t) ? t : {});
const row = (T, kind) => (kind != null && Object.hasOwn(T, kind) ? T[kind] : undefined);

export const kindRange = defineNode({
  type: 'spans.kindRange', title: 'Depth by kind', group: G, icon: 'sliders',
  aliases: ['range by kind', 'depth', 'plan', 'per kind', 'lo hi', 'table', 'segment kind'],
  help: 'A Deep-end and an Out-end signal from a table of [lo, hi] per span kind (rows not in the table use the default), crossfaded over Fade at every boundary. Wire lo/hi into "Remap depth" for exact per-action depth by plan kind.',
  ins: [spans('spans', req)], outs: [signal('lo'), signal('hi')],
  params: [json('table', 'Range per kind', { foreplay: [55, 95], oral: [40, 95], penetration: [0, 85], knotting: [0, 30], climax: [0, 90], orgasm: [0, 40], afterglow: [20, 90] }, { editor: 'kindTable' }), json('default', 'Default range', [10, 90]),
    num('fadeMs', 'Fade', 400, 0, 60000, 10, { unit: 'ms', inline: true })],
  halo: () => 0, local: true,
  eval({ spans: list }, p, ctx) {
    const T = tableOf(p.table), d = pair(p.default, [10, 90]);
    const loF = spanStep(list, (s) => pair(row(T, s.kind), d)[0], d[0], p.fadeMs);
    const hiF = spanStep(list, (s) => pair(row(T, s.kind), d)[1], d[1], p.fadeMs);
    return { lo: genSignal(ctx, (_k, t) => loF(t), [0, 100]), hi: genSignal(ctx, (_k, t) => hiF(t), [0, 100]) };
  },
});

export const kindValue = defineNode({
  type: 'spans.kindValue', title: 'Value by kind', group: G, icon: 'hash',
  aliases: ['per kind', 'table', 'lookup', 'map kinds', 'intensity'],
  help: 'A signal from a table of one value per span kind (others use the default), crossfaded over Fade at boundaries.',
  ins: [spans('spans', req)], outs: [signal()],
  params: [json('table', 'Value per kind', {}, { editor: 'kindTable' }), num('default', 'Default', 0, -1e6, 1e6, 0.01, { inline: true }),
    num('fadeMs', 'Fade', 400, 0, 60000, 10, { unit: 'ms' })],
  halo: () => 0, local: true,
  eval({ spans: list }, p, ctx) {
    const T = tableOf(p.table), f = spanStep(list, (s) => one(row(T, s.kind), p.default), p.default, p.fadeMs);
    return { signal: genSignal(ctx, (_k, t) => f(t)) };
  },
});

export const envelope = defineNode({
  type: 'spans.envelope', title: 'Span envelope', group: G, icon: 'bezier',
  aliases: ['ramp', 'build up', 'fade in out', 'attack release', 'intensity'],
  help: '0..1 inside each span: rises over Attack from its start, falls over Release to its end (along the curve); 0 outside. E.g. intensity ramps across build-ups.',
  ins: [spans('spans', req)], outs: [signal()],
  params: [num('attackMs', 'Attack', 2000, 0, 600000, 10, { unit: 'ms', inline: true }), num('releaseMs', 'Release', 2000, 0, 600000, 10, { unit: 'ms', inline: true }),
    choice('curve', 'Curve', 'linear', Object.keys(CURVES).filter((c) => c !== 'step'))],
  halo: () => 0, local: true,
  eval({ spans: list }, p, ctx) {
    const flat = flattenSpans(list).filter((s) => s.t1 > s.t0), c = CURVES[p.curve] ?? CURVES.linear;
    let j = 0;
    return { signal: genSignal(ctx, (_k, t) => {
      while (j < flat.length && flat[j].t1 <= t) j++;
      const s = flat[j];
      if (!s || t < s.t0) return 0;
      const up = p.attackMs > 0 ? Math.min(1, (t - s.t0) / p.attackMs) : 1;
      const dn = p.releaseMs > 0 ? Math.min(1, (s.t1 - t) / p.releaseMs) : 1;
      return c(Math.max(0, Math.min(up, dn)));
    }, [0, 1]) };
  },
});

export const toSignal = defineNode({
  type: 'spans.toSignal', title: 'Spans → Signal', group: G, icon: 'wave',
  aliases: ['gate signal', 'mask', 'indicator', 'boolean', 'convert'],
  help: 'Inside a span: Inside (or the span\'s own value), elsewhere: Outside, crossfaded over Fade.',
  ins: [spans('spans', req)], outs: [signal()],
  params: [num('inside', 'Inside', 1, -1e6, 1e6, 0.01, { inline: true }), num('outside', 'Outside', 0, -1e6, 1e6, 0.01, { inline: true }),
    choice('source', 'Inside value', 'constant', ['constant', 'span value']), num('fadeMs', 'Fade', 0, 0, 60000, 10, { unit: 'ms' })],
  halo: () => 0, local: true,
  eval({ spans: list }, p, ctx) {
    const f = spanStep(list, (s) => (p.source === 'span value' && typeof s.value === 'number' ? s.value : p.inside), p.outside, p.fadeMs);
    return { signal: genSignal(ctx, (_k, t) => f(t)) };
  },
});

export const SPANS = [filter, not, pad, mergeGaps, shift, relabel, between, and, or, minus, threshold, kindRange, kindValue, envelope, toSignal];

