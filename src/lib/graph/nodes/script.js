// Script analysis and structure nodes (DESIGN §7 "Script analysis", "Script structure").

import { defineNode } from '../model.js';
import { posAt, lowerBound, normalize, clampPos, upsert } from '../../core/script.js';
import { turns as editTurns, strokes as editStrokes, snapToTimes } from '../../edit/index.js';
import { tile } from '../../gen/loops.js';
import { sampleScript, normSpans, flattenSpans } from '../types.js';
import { num, bool, choice, modNum, seedParam, script, signal, spans, req, points, genSignal, splice, sliceHalfOpen, edgePoint } from './util.js';

/** perSpan nodes whose 'where' is required by meaning: the engine adds it as optional, so check it here. */
export function needWhere(where) {
  if (!where) throw new Error('connect the spans to work inside ("Only inside")');
  return where;
}

const A = 'Script · analysis';
const S = 'Script · structure';

// ---------------------------------------------------------------- analysis

export const sample = defineNode({
  type: 'script.sample', title: 'Script → Signal', group: A, icon: 'wave',
  aliases: ['sample', 'to signal', 'resample', 'convert'],
  help: 'Reads a script as a signal on the graph grid (the explicit form of the automatic adapter). NaN outside the script.',
  ins: [script('script', req)], outs: [signal()],
  params: [choice('interp', 'Interpolation', 'linear', ['linear', 'step', 'cosine'])],
  halo: () => 0, local: true,
  eval({ script: s }, p, ctx) {
    const g = ctx.grid();
    if (p.interp === 'linear') { const sig = sampleScript(s, g); sig.range = [0, 100]; return { signal: sig }; }
    const last = s.length ? s[s.length - 1].at : -1;
    return { signal: genSignal(ctx, (_k, t) => {
      if (!s.length || t < s[0].at || t > last) return NaN;
      const i = lowerBound(s, t + 1) - 1, a = s[i], b = s[i + 1];
      if (!b || a.at === t) return a.pos;
      if (p.interp === 'step') return a.pos;
      const u = (1 - Math.cos((Math.PI * (t - a.at)) / (b.at - a.at))) / 2;
      return a.pos + (b.pos - a.pos) * u;
    }, [0, 100]) };
  },
});

/** Turning points of a script: [{at, pos, kind:'top'|'bottom'}] (endpoints excluded). */
export function turnList(s, minProminence) {
  return editTurns(s, minProminence, { endpoints: false }).map((t) => ({ at: s[t.i].at, pos: s[t.i].pos, kind: t.kind }));
}

export const turns = defineNode({
  type: 'script.turns', title: 'Turning points', group: A, icon: 'marker',
  aliases: ['extremes', 'tops', 'bottoms', 'peaks', 'valleys', 'times'],
  help: 'Tops and bottoms of a script as points (kind top/bottom, value = pos). Feed them to "Follow", "Sample at" or any "Only inside".',
  ins: [script('script', req)], outs: [spans('points', points)],
  params: [num('minProminence', 'Min prominence', 5, 0, 100, 1, { inline: true }), choice('which', 'Which', 'both', ['both', 'tops', 'bottoms'])],
  eval({ script: s }, p) {
    const T = turnList(s, p.minProminence).filter((t) => p.which === 'both' || (p.which === 'tops') === (t.kind === 'top'));
    return { points: T.map((t) => ({ t0: t.at, t1: t.at, kind: t.kind, value: t.pos })) };
  },
});

export const strokes = defineNode({
  type: 'script.strokes', title: 'Strokes', group: A, icon: 'stroke',
  aliases: ['moves', 'half strokes', 'up', 'down'],
  help: 'Every move between turning points as a span (kind up/down, value = amplitude).',
  ins: [script('script', req)], outs: [spans()],
  params: [num('minProminence', 'Min prominence', 5, 0, 100, 1, { inline: true })],
  eval({ script: s }, p) {
    return { spans: normSpans(editStrokes(s, p.minProminence).map((k) => ({ t0: s[k.i0].at, t1: s[k.i1].at, kind: k.dir > 0 ? 'up' : 'down', value: k.amplitude }))) };
  },
});

export const phase = defineNode({
  type: 'script.phase', title: 'Stroke phase', group: A, icon: 'refresh',
  aliases: ['phase', 'cycle', 'roll', 'twist', 'pitch', 'derive', 'amplitude', 'period'],
  help: 'Phase of the stroke cycle (0 at a top/out turn, 0.5 at a bottom/deep turn, linear in time between), stroke amplitude 0..1 and period in ms. NaN outside the first and last turn. Drive roll/twist with "Phase → wave".',
  ins: [script('script', req)], outs: [signal('phase'), signal('amp'), signal('period')],
  params: [num('minProminence', 'Min prominence', 5, 0, 100, 1, { inline: true })],
  eval({ script: s }, p, ctx) {
    const T = turnList(s, p.minProminence);
    const tt = T.map((t) => t.at);
    // amplitude per half-stroke, placed at its midpoint, linear between midpoints
    const mids = [], amps = [];
    for (let k = 0; k + 1 < T.length; k++) { mids.push((tt[k] + tt[k + 1]) / 2); amps.push(Math.abs(T[k + 1].pos - T[k].pos) / 100); }
    const seg = (t) => { const k = lowerBound(T, t + 0.5) - 1; return k >= 0 && k + 1 < T.length ? k : -1; };
    const lbAt = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; } return lo; };
    const ph = genSignal(ctx, (_k, t) => {
      if (!T.length || t < tt[0] || t > tt[tt.length - 1]) return NaN;
      if (t === tt[tt.length - 1]) return T[T.length - 1].kind === 'top' ? 0 : 0.5;
      const k = seg(t), u = (t - tt[k]) / (tt[k + 1] - tt[k]);
      return T[k].kind === 'top' ? 0.5 * u : (0.5 + 0.5 * u) % 1;
    }, [0, 1]);
    const amp = genSignal(ctx, (_k, t) => {
      if (!mids.length || t < tt[0] || t > tt[tt.length - 1]) return NaN;
      const j = lbAt(mids, t);
      if (j === 0) return amps[0];
      if (j === mids.length) return amps[amps.length - 1];
      return amps[j - 1] + ((amps[j] - amps[j - 1]) * (t - mids[j - 1])) / (mids[j] - mids[j - 1]);
    }, [0, 1]);
    const period = genSignal(ctx, (_k, t) => {
      if (T.length < 2 || t < tt[0] || t > tt[tt.length - 1]) return NaN;
      const k = Math.min(seg(t) < 0 ? T.length - 2 : seg(t), T.length - 2);
      return 2 * (tt[k + 1] - tt[k]);
    });
    return { phase: ph, amp, period };
  },
});

export const speed = defineNode({
  type: 'script.speed', title: 'Speed', group: A, icon: 'speed',
  aliases: ['velocity', 'heat', 'intensity', 'pos/s'],
  help: 'Speed in pos/s. Window 0 = the speed of the move under each instant; a window gives the mean speed (travel ÷ time) over it, the heatmap value.',
  ins: [script('script', req)], outs: [signal()],
  params: [num('windowMs', 'Window', 0, 0, 60000, 10, { unit: 'ms', inline: true })],
  halo: (p) => p.windowMs, local: true,
  eval({ script: s }, p, ctx) {
    const n = s.length, last = n ? s[n - 1].at : -1;
    const seg = (t) => Math.min(n - 2, Math.max(0, lowerBound(s, t + 1) - 1));
    if (!(p.windowMs > 0)) {
      return { signal: genSignal(ctx, (_k, t) => {
        if (n < 2 || t < s[0].at || t > last) return NaN;
        const i = seg(t), a = s[i], b = s[i + 1];
        return (Math.abs(b.pos - a.pos) * 1000) / (b.at - a.at);
      }) };
    }
    const h = p.windowMs / 2;
    // travel prefix sums (integers, so exact): travel over [a, b] = C(b) - C(a), O(log n) per sample
    const P = new Float64Array(n);
    for (let i = 1; i < n; i++) P[i] = P[i - 1] + Math.abs(s[i].pos - s[i - 1].pos);
    const C = (t) => { const i = seg(t), x = s[i], y = s[i + 1]; return P[i] + (Math.abs(y.pos - x.pos) * (t - x.at)) / (y.at - x.at); };
    return { signal: genSignal(ctx, (_k, t) => {
      if (n < 2 || t < s[0].at || t > last) return NaN;
      const a = Math.max(s[0].at, t - h), b = Math.min(last, t + h);
      if (!(b > a)) return 0;
      return ((C(b) - C(a)) * 1000) / (b - a);
    }) };
  },
});

export const rate = defineNode({
  type: 'script.rate', title: 'Stroke rate', group: A, icon: 'heart-rate',
  aliases: ['spm', 'strokes per minute', 'tempo', 'bpm', 'frequency'],
  help: 'Strokes per minute (one stroke = down + up), from the duration of each move, linear between move midpoints.',
  ins: [script('script', req)], outs: [signal()],
  params: [num('minProminence', 'Min prominence', 5, 0, 100, 1, { inline: true })],
  eval({ script: s }, p, ctx) {
    const T = turnList(s, p.minProminence), mids = [], spm = [];
    for (let k = 0; k + 1 < T.length; k++) { mids.push((T[k].at + T[k + 1].at) / 2); spm.push(30000 / (T[k + 1].at - T[k].at)); }
    return { signal: genSignal(ctx, (_k, t) => {
      if (!mids.length || t < T[0].at || t > T[T.length - 1].at) return NaN;
      let j = 0;
      { let lo = 0, hi = mids.length; while (lo < hi) { const m = (lo + hi) >> 1; if (mids[m] <= t) lo = m + 1; else hi = m; } j = lo; }
      if (j === 0) return spm[0];
      if (j === mids.length) return spm[spm.length - 1];
      return spm[j - 1] + ((spm[j] - spm[j - 1]) * (t - mids[j - 1])) / (mids[j] - mids[j - 1]);
    }) };
  },
});

// ---------------------------------------------------------------- structure

export const spliceNode = defineNode({
  type: 'script.splice', title: 'Splice', group: S, icon: 'split',
  aliases: ['insert', 'replace inside', 'combine', 'patch', 'paste'],
  help: '"Insert" inside the spans, "Base" outside. A blend seam removes points near each join until it respects the speed cap (gen/util blend); a cut seam joins with a 1 ms step.',
  ins: [script('base', req), script('insert', req)], outs: [script()], perSpan: true, // 'where' (required here) is the engine-added perSpan input
  params: [choice('seam', 'Seam', 'blend', ['blend', 'cut']), num('seamMs', 'Seam window', 150, 0, 5000, 10, { unit: 'ms' }), num('maxSpeed', 'Max speed at seams', 450, 10, 2000, 5, { unit: 'pos/s' })],
  bypass: { script: 'base' },
  eval({ base, insert, where }, p, ctx) {
    needWhere(where);
    return { script: splice(base, insert, where, { seam: p.seam, seamMs: p.seamMs, maxSpeed: p.maxSpeed, minGapMs: 1, warn: (m) => ctx.warn(m) }) };
  },
});

/** Actions of `s` inside the flattened spans; bridge adds interpolated points at each span's edges. */
export function trimTo(s, where, bridge) {
  const out = [];
  for (const sp of flattenSpans(where || [])) {
    if (sp.t1 === sp.t0) { const i = lowerBound(s, sp.t0); if (s[i]?.at === sp.t0) out.push(s[i]); continue; }
    const inner = sliceHalfOpen(s, sp.t0, sp.t1);
    if (bridge) { const e = edgePoint(s, sp.t0); if (e && inner[0]?.at !== sp.t0) out.push(e); }
    out.push(...inner);
    if (bridge) { const e = edgePoint(s, sp.t1 - 1); if (e && (!inner.length || inner[inner.length - 1].at < sp.t1 - 1)) out.push(e); }
  }
  return normalize(out);
}

export const trim = defineNode({
  type: 'script.trim', title: 'Keep inside', group: S, icon: 'scissors',
  aliases: ['trim', 'crop', 'cut to', 'restrict', 'mask'],
  help: 'Keeps only the actions inside the spans. Bridge adds interpolated points at the span edges so the motion ends exactly there.',
  ins: [script('script', req)], outs: [script()], perSpan: true,
  params: [bool('bridge', 'Bridge edges', true)],
  halo: () => 0, local: true, bypass: { script: 'script' },
  eval: ({ script: s, where }, p) => ({ script: trimTo(s, needWhere(where), p.bridge) }),
});

export const merge = defineNode({
  type: 'script.merge', title: 'Merge', group: S, icon: 'link',
  aliases: ['union', 'combine', 'overlay', 'upsert'],
  help: 'Both scripts\' actions together. On a collision (same time, or closer than Min gap) the priority side wins.',
  ins: [script('a', req), script('b', req)], outs: [script()],
  params: [choice('priority', 'Priority', 'b', ['a', 'b']), num('minGapMs', 'Min gap', 0, 0, 5000, 1, { unit: 'ms' })],
  halo: (p) => p.minGapMs, local: true, bypass: { script: 'a' },
  eval({ a, b }, p) {
    const [hi, lo] = p.priority === 'a' ? [a, b] : [b, a];
    if (!(p.minGapMs > 0)) return { script: p.priority === 'a' ? upsert(b, a) : upsert(a, b) };
    const keep = lo.filter((x) => {
      const i = lowerBound(hi, x.at);
      return !((i < hi.length && hi[i].at - x.at < p.minGapMs) || (i > 0 && x.at - hi[i - 1].at < p.minGapMs));
    });
    return { script: normalize([...keep, ...hi]) };
  },
});

export const mix = defineNode({
  type: 'script.mix', title: 'Mix scripts', group: S, icon: 'sliders',
  aliases: ['crossfade', 'blend', 'average', 'weight'],
  help: 'Pointwise mix at the union of both scripts\' times: (1 − w)·A + w·B. Where only one script exists, it is used as is. For clean strokes from two trackers, blend their signals and use "Signal → Script" instead.',
  ins: [script('a', req), script('b', req)], outs: [script()],
  params: [modNum('w', 'Weight of B', 0.5, 0, 1, 0.01, { inline: true })],
  halo: () => 0, local: true, bypass: { script: 'a' },
  eval({ a, b }, _p, ctx) {
    const w = ctx.param('w');
    const inA = (t) => a.length && t >= a[0].at && t <= a[a.length - 1].at;
    const inB = (t) => b.length && t >= b[0].at && t <= b[b.length - 1].at;
    const ts = [...new Set([...a.map((x) => x.at), ...b.map((x) => x.at)])].sort((x, y) => x - y);
    return { script: ts.map((t) => {
      const ha = inA(t), hb = inB(t);
      const k = Math.min(1, Math.max(0, w(t)));
      const pos = ha && hb ? (1 - k) * posAt(a, t) + k * posAt(b, t) : ha ? posAt(a, t) : posAt(b, t);
      return { at: t, pos: clampPos(pos) };
    }) };
  },
});

export const tileNode = defineNode({
  type: 'script.tile', title: 'Tile loop', group: S, icon: 'repeat-stroke',
  aliases: ['loop', 'repeat', 'cycle', 'pattern fill'],
  help: 'Repeats one cycle (the template from its first action to its last; the last action is the start of the next cycle) across every span, drift-free (gen/loops tile). Variation adds seeded per-repeat depth and timing changes.',
  ins: [script('template', req)], outs: [script()], perSpan: true,
  params: [
    choice('partial', 'Partial tiles', 'clip', ['clip', 'drop']),
    choice('join', 'Join', 'keep', ['keep', 'meet'], { hint: 'meet: a last point within 50 ms of the end takes the first\'s position' }),
    num('variation', 'Depth variation', 0, 0, 0.5, 0.01, { inline: true }),
    num('jitterMs', 'Timing variation', 0, 0, 200, 1, { unit: 'ms' }),
    seedParam(),
  ],
  eval({ template, where }, p, ctx) {
    needWhere(where);
    if (template.length < 2) throw new Error('the template needs at least two actions (one cycle)');
    const c0 = template[0].at, len = template[template.length - 1].at - c0;
    const out = [];
    for (const sp of flattenSpans(where)) {
      if (sp.t1 <= sp.t0) continue;
      const r = tile(template, c0, len, sp.t0, sp.t1 - 1, { partial: p.partial, join: p.join, gridT0: sp.t0, vary: p.variation > 0 || p.jitterMs > 0 ? { seed: p.seed, amp: p.variation, timeMs: p.jitterMs } : {} });
      for (const i of r.issues) if (i.level === 'error') ctx.warn(i.msg);
      out.push(...r.script);
    }
    return { script: normalize(out) };
  },
});

export const snap = defineNode({
  type: 'script.snap', title: 'Snap to times', group: S, icon: 'snap',
  aliases: ['align', 'beats', 'quantise to times', 'magnet', 'sync'],
  help: 'Moves every action (or only the turning points) onto the nearest given time within the tolerance (edit snapToTimes). Feed it beats, bookmarks or another script\'s turns.',
  ins: [script('script', req), spans('times', { required: true, ...points })], outs: [script()],
  params: [num('toleranceMs', 'Tolerance', 80, 1, 5000, 1, { unit: 'ms', inline: true }), choice('which', 'Which actions', 'turns', ['turns', 'all']), num('minProminence', 'Turn prominence', 5, 0, 100, 1)],
  halo: (p) => (p.which === 'all' ? p.toleranceMs : Infinity), local: true, bypass: { script: 'script' }, // turn detection is global
  eval({ script: s, times }, p) {
    const sel = p.which === 'all' ? null : { ats: turnList(s, p.minProminence).map((t) => t.at) };
    return { script: snapToTimes(s, sel, { times: times.map((x) => x.t0), tolerance: p.toleranceMs, collide: 'clamp' }).script };
  },
});

export const SCRIPT = [sample, turns, strokes, phase, speed, rate, spliceNode, trim, merge, mix, tileNode, snap];
