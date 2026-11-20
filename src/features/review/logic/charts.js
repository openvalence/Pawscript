// Chart data and text formatting for the statistics panel (pure). The numbers themselves come from
// src/lib/analyze `statistics()`; this file adds what that does not give: speed distribution and amplitude over time.
import { fmtDuration } from '../../../lib/time-format.js';
import { clipped, turns } from '../../../lib/analyze/util.js';
import { lowerBound } from '../../../lib/core/script.js';

/** The actions that matter for [t0,t1]: those inside plus one neighbour each side (for the interpolated ends).
 *  statistics / speedHistogram over this slice with explicit t0,t1 equal those over the whole script. */
export function around(script, t0, t1) {
  return script.slice(Math.max(0, lowerBound(script, t0) - 1), lowerBound(script, Math.floor(t1) + 1) + 1);
}

/** Integer with thin-space thousands grouping (same as the lane header: 2 503). */
export const fmtCount = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Segment speeds (pos units/s) inside [t0,t1], with interpolated end points like analyze's statistics. */
export function segmentSpeeds(script, t0, t1) {
  const { at, pos, n } = clipped(script, t0, t1), out = [];
  for (let i = 1; i < n; i++) out.push(Math.abs(pos[i] - pos[i - 1]) * 1000 / (at[i] - at[i - 1]));
  return out;
}

/** Speed distribution, last bin = "cap and above". `over` = share of time-unweighted segments above `limit`. */
export function speedHistogram(script, t0, t1, { bins = 24, cap = 600, limit = Infinity } = {}) {
  const counts = new Array(bins).fill(0), sp = segmentSpeeds(script, t0, t1);
  let over = 0;
  for (const s of sp) { counts[Math.min(bins - 1, Math.floor(s * bins / cap))]++; if (s > limit) over++; }
  return { counts, min: 0, max: cap, n: sp.length, over, overShare: sp.length ? over / sp.length : 0 };
}

/** Mean move amplitude per time bin (null where there is no move). A move belongs to the bin it ends in. */
export function amplitudeSeries(script, t0, t1, bins = 40, minProm = 10) {
  const { at, pos, n } = clipped(script, t0, t1), binMs = Math.max(1, (t1 - t0) / bins);
  const sum = new Array(bins).fill(0), cnt = new Array(bins).fill(0), tp = turns(at, pos, minProm);
  for (let k = 1; k < tp.idx.length; k++) {
    const t = at[tp.idx[k]];
    if (t < t0 || t > t1) continue;
    const b = Math.min(bins - 1, Math.floor((t - t0) / binMs));
    sum[b] += Math.abs(pos[tp.idx[k]] - pos[tp.idx[k - 1]]); cnt[b]++;
  }
  return { t0, t1, binMs, values: sum.map((s, i) => (cnt[i] ? s / cnt[i] : null)) };
}

/** Strokes-per-minute series resampled to `bins` equal bins from analyze's `strokesPerMinSeries` ([{t0,t1,spm}]). */
export function spmSeries(series, t0, t1, bins = 40) {
  const values = new Array(bins).fill(null), span = Math.max(1, t1 - t0);
  for (const s of series) {
    if (s.spm == null) continue;
    const b0 = Math.floor(((s.t0 - t0) / span) * bins), b1 = Math.max(b0 + 1, Math.ceil(((s.t1 - t0) / span) * bins));
    for (let b = Math.max(0, b0); b < Math.min(bins, b1); b++) values[b] = s.spm;
  }
  return { t0, t1, values };
}

export const fmtDur = (ms) => {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(r).padStart(2, '0')}`;
};
const f = (v, d = 0) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d));
const pc = (v) => (v == null ? '-' : `${(v * 100).toFixed(0)}%`);

/** [label, formatter(statistics-result, extra)] rows for the table and the text export. `extra.overShare` optional. */
export const STAT_ROWS = [
  ['Duration', (s) => fmtDuration(s.durationMs)],
  ['Actions', (s) => fmtCount(s.actions)],
  ['Strokes/min', (s) => f(s.strokesPerMin, 1)],
  ['Strokes/min (active)', (s) => f(s.activeStrokesPerMin, 1)],
  ['Strokes (cycles)', (s) => f(s.strokes.cycles, 0)],
  ['Avg speed', (s) => `${f(s.speed.mean)} u/s`],
  ['Median speed', (s) => `${f(s.speed.p50)} u/s`],
  ['90th pct speed', (s) => `${f(s.speed.p90)} u/s`],
  ['Peak speed', (s) => `${f(s.speed.max)} u/s`],
  ['Over speed limit', (s, x) => (x?.overShare == null ? '-' : `${pc(x.overShare)} of segments`)],
  ['Mean amplitude', (s) => f(s.amplitude.mean, 1)],
  ['Typical range (p5–p95)', (s) => `${f(s.range.p5)} – ${f(s.range.p95)}`],
  ['Time at rest', (s) => pc(s.rest.share)],
  ['Longest gap', (s) => `${f(s.longestGap.ms / 1000, 1)} s`],
  ['Mean move', (s) => `${f(s.avgStrokeMs)} ms`],
  ['Up / down speed', (s) => `${f(s.asymmetry.upSpeed)} / ${f(s.asymmetry.downSpeed)} u/s`],
];

export const statsAsText = (title, s, extra) => [title, ...STAT_ROWS.map(([k, fn]) => `${k.padEnd(24)}${fn(s, extra)}`)].join('\n');
