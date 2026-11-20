// Compare logic (pure): shaping of quick/score results for display and the difference view.
import { posAt } from '../../../lib/core/script.js';

const pct = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`);
const ms = (v) => (v == null ? '-' : `${Math.round(v)} ms`);
const num = (v, d = 2) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d));

/** Rows common to the quick (in-browser) and sidecar results: [key, label, formatter, hint]. */
const ROWS = [
  ['f1', 'Turning-point F1', pct, 'Headline: extremes matched within 150 ms'],
  ['precision', 'Precision', pct, 'Share of your extremes that exist in the reference'],
  ['recall', 'Recall', pct, 'Share of reference extremes you have'],
  ['dt_median_ms', 'Timing error (median)', ms, 'Of matched extremes'],
  ['dt_p90_ms', 'Timing error (90th pct)', ms, ''],
  ['dt_bias_ms', 'Timing bias', ms, '> 0 means your extremes arrive late'],
  ['lag_ms', 'Best lag', ms, '> 0 means your script is late'],
  ['r_pos', 'Position correlation', (v) => num(v, 3), 'Pearson r at 100 Hz'],
  ['r_vel', 'Velocity correlation', (v) => num(v, 3), ''],
];

/** Normalise quick-compare or sidecar SCORE objects: accepts camelCase and snake_case spellings. */
const ALIAS = { dtMedianMs: 'dt_median_ms', dtP90Ms: 'dt_p90_ms', lagMs: 'lag_ms', rPos: 'r_pos', rVel: 'r_vel', ampRatio: 'amp_ratio', spmCand: 'spm_cand', spmRef: 'spm_ref', timingErrorMs: 'dt_median_ms', correlation: 'r_pos', f1Score: 'f1' };
export function normalizeScore(raw) {
  if (!raw) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[ALIAS[k] ?? k] = v;
  return out;
}

export function shapeScore(raw) {
  const s = normalizeScore(raw);
  if (!s) return [];
  const counts = s.tp != null ? [{ key: 'counts', label: 'Matched / extra / missing', value: `${s.tp} / ${s.fp} / ${s.fn}`, raw: s.tp, hint: 'Your extremes: matched, not in the reference; reference extremes you lack' }] : [];
  return [...counts, ...ROWS.filter(([k]) => k in s).map(([k, label, f, hint]) => ({ key: k, label, value: f(s[k]), raw: s[k], hint }))];
}

export function shapeScenes(scenes = []) {
  return scenes.map((raw, i) => {
    const s = normalizeScore(raw);
    return { i, t0: s.t0 ?? s.start_ms ?? 0, t1: s.t1 ?? s.end_ms ?? 0, f1: s.f1, precision: s.precision, recall: s.recall, lag_ms: s.lag_ms, sign: s.sign };
  });
}

/** Colour band for an F1-like score: lets the headline read at a glance. */
export const grade = (f1) => (f1 == null ? 'none' : f1 >= 0.8 ? 'good' : f1 >= 0.55 ? 'fair' : 'poor');

/**
 * Where two scripts disagree most: mean |pos difference| sampled every `stepMs` per `binMs` window.
 * Returns the worst `top` windows (sorted worst first), skipping those below `minErr`.
 */
export function disagreements(a, b, t0, t1, { binMs = 2000, stepMs = 50, top = 25, minErr = 8 } = {}) {
  if (!a.length || !b.length) return [];
  const out = [];
  for (let s = t0; s < t1; s += binMs) {
    const e = Math.min(t1, s + binMs);
    let sum = 0, n = 0, peak = 0;
    for (let t = s; t < e; t += stepMs) { const d = Math.abs(posAt(a, t) - posAt(b, t)); sum += d; n++; if (d > peak) peak = d; }
    if (n && sum / n >= minErr) out.push({ t0: s, t1: e, err: sum / n, peak });
  }
  return out.sort((x, y) => y.err - x.err).slice(0, top);
}

export const compareAsText = (title, rows, scenes) =>
  [title, ...rows.map((r) => `${r.label.padEnd(28)}${r.value}`),
    ...(scenes?.length ? ['', 'Scenes', ...scenes.map((s) => `${s.i + 1}\t${(s.t0 / 1000).toFixed(1)}-${(s.t1 / 1000).toFixed(1)} s\tF1 ${pct(s.f1)}`)] : [])].join('\n');

/** compare() leftovers as one time-sorted list: extra = yours has an extreme the reference lacks; missing = the reverse. */
export function mismatches(cmp, { windowMs = 400 } = {}) {
  if (!cmp) return [];
  const m = [...(cmp.unmatchedCand ?? []).map((u) => ({ at: u.at, what: 'extra', kind: u.kind })), ...(cmp.unmatchedRef ?? []).map((u) => ({ at: u.at, what: 'missing', kind: u.kind }))];
  return m.sort((a, b) => a.at - b.at).map((u) => ({ ...u, t0: Math.max(0, u.at - windowMs / 2), t1: u.at + windowMs / 2, id: `${u.what}@${u.at}` }));
}
