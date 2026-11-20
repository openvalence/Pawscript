// Analysis nodes (DESIGN §7 "Analyze"): numbers and problem spans from scripts and signals (lib/analyze).

import { defineNode } from '../model.js';
import { findProblems, compare, BUILTIN_PROFILES, getProfile } from '../../analyze/index.js';
import { sampleScript, normSpans, typeOfValue, gridFor } from '../types.js';
import { num, choice, any, script, spans, number, req, points, percentileOf, spanStep } from './util.js';

const G = 'Analyze';
const FNS = { mean: 'Mean', median: 'Median', min: 'Minimum', max: 'Maximum', p5: '5th percentile', p10: '10th percentile', p90: '90th percentile', p95: '95th percentile', std: 'Standard deviation' };

export const stat = defineNode({
  type: 'an.stat', title: 'Statistic', group: G, icon: 'percent',
  aliases: ['mean', 'average', 'median', 'min', 'max', 'percentile', 'number', 'measure'],
  help: 'One number from a script or signal (optionally only inside the spans): scripts are time-weighted (sampled on the graph grid through their interpolation), signals ignore unknown samples. Wire it into a param socket.',
  ins: [any('in', { required: true, accepts: ['script', 'signal'] })], outs: [number()],
  perSpan: true,
  params: [choice('fn', 'Statistic', 'mean', Object.entries(FNS).map(([value, label]) => ({ value, label })))],
  eval({ in: x, where }, p, ctx) {
    const T = typeOfValue(x);
    let sig;
    if (T === 'signal') sig = x;
    else if (Array.isArray(x)) {
      if (!x.length) throw new Error('the script is empty');
      sig = sampleScript(x, gridFor({ t0: x[0].at, t1: x[x.length - 1].at }, ctx.dt));
    } else throw new Error('needs a script or a signal');
    let v = sig.v;
    if (where) {
      const inside = spanStep(where, () => 1, 0);
      v = v.map((y, k) => (inside((sig.i0 + k) * sig.dt) ? y : NaN));
    }
    let r;
    switch (p.fn) {
      case 'median': r = percentileOf(v, 50); break;
      case 'min': r = percentileOf(v, 0); break;
      case 'max': r = percentileOf(v, 100); break;
      case 'p5': r = percentileOf(v, 5); break;
      case 'p10': r = percentileOf(v, 10); break;
      case 'p90': r = percentileOf(v, 90); break;
      case 'p95': r = percentileOf(v, 95); break;
      default: {
        let s = 0, s2 = 0, n = 0;
        for (const y of v) if (y === y) { s += y; s2 += y * y; n++; }
        r = !n ? NaN : p.fn === 'std' ? Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) : s / n;
      }
    }
    if (!Number.isFinite(r)) throw new Error(where ? 'no known values inside the spans' : 'no known values');
    return { value: r };
  },
});

const SEV = { error: 3, warn: 2, info: 1 };

export const problems = defineNode({
  type: 'an.problems', title: 'Problems', group: G, icon: 'warning',
  aliases: ['check', 'lint', 'issues', 'speed limit', 'errors', 'validate'],
  help: 'Script problems for a device profile (lib/analyze findProblems) as spans: kind = problem kind, label = message, value = severity (3 error, 2 warn, 1 info). Feed them to "Only inside" to fix only where problems are.',
  ins: [script('script', req)], outs: [spans()],
  params: [choice('profile', 'Device profile', 'generic', BUILTIN_PROFILES.map((x) => ({ value: x.id, label: x.name }))),
    choice('minSeverity', 'At least', 'info', ['info', 'warn', 'error'])],
  eval({ script: s }, p, ctx) {
    const list = findProblems(s, getProfile(p.profile), { mediaDurationMs: ctx.media?.durationMs ?? undefined });
    return { spans: normSpans(list.filter((q) => SEV[q.severity] >= SEV[p.minSeverity]).map((q) => ({ t0: q.t0, t1: q.t1, kind: q.kind, label: q.message, value: SEV[q.severity], data: { id: q.id, severity: q.severity, fix: q.fix ?? null } }))) };
  },
  summary: ({ spans: s }) => `${s.length} problem${s.length === 1 ? '' : 's'}`,
});

export const compareNode = defineNode({
  type: 'an.compare', title: 'Compare scripts', group: G, icon: 'target',
  aliases: ['score', 'f1', 'lag', 'accuracy', 'a/b', 'reference', 'diff'],
  help: 'Matches turning points of Candidate against Reference within the tolerance (lib/analyze compare): score = F1 (0..1), lag in ms (> 0: candidate late), diff = the unmatched turns as points (kind cand/ref).',
  ins: [script('cand', { required: true, label: 'Candidate' }), script('ref', { required: true, label: 'Reference' })],
  outs: [number('score'), number('lag'), spans('diff', points)],
  params: [num('tolMs', 'Tolerance', 150, 1, 2000, 5, { unit: 'ms', inline: true }), num('minProm', 'Min prominence', 10, 0, 100, 1)],
  eval({ cand, ref }, p) {
    const r = compare(cand, ref, { tolMs: p.tolMs, minProm: p.minProm });
    const diff = normSpans([...r.unmatchedCand.map((u) => ({ t0: u.at, t1: u.at, kind: 'cand', label: 'only in candidate' })), ...r.unmatchedRef.map((u) => ({ t0: u.at, t1: u.at, kind: 'ref', label: 'only in reference' }))]);
    return { score: Number.isFinite(r.f1) ? r.f1 : 0, lag: Number.isFinite(r.lag_ms) ? r.lag_ms : 0, diff };
  },
  summary: ({ score, lag }) => (score === undefined ? '—' : `F1 ${score.toFixed(2)} · lag ${Math.round(lag)} ms`),
});

export const ANALYZE = [stat, problems, compareNode];
