// Statistics of a script (or a time range of it). Pure; see README.md for every field.
//
// Vocabulary: a *move* is one reversal-to-reversal movement (up or down); a *stroke* is a full cycle
// (down + up), so cycles = moves / 2 and `strokesPerMin` is the number people quote (60..180 typical).
import { clipped, turns, percentile, weightedPercentiles, lb } from './util.js';

const nul = (v) => (Number.isFinite(v) ? v : null);

function histPercentile(hist, total, p) {
  if (!(total > 0)) return null;
  const target = (p / 100) * total;
  let acc = 0;
  for (let k = 0; k < hist.length; k++) {
    if (hist[k] > 0 && acc + hist[k] >= target) return k + (target - acc) / hist[k];
    acc += hist[k];
  }
  return hist.length;
}

function summary(values) {
  const s = Float64Array.from(values).sort();
  if (!s.length) return { n: 0, mean: null, p10: null, p50: null, p90: null, min: null, max: null };
  let sum = 0;
  for (const v of s) sum += v;
  return { n: s.length, mean: sum / s.length, p10: percentile(s, 10), p50: percentile(s, 50), p90: percentile(s, 90), min: s[0], max: s[s.length - 1] };
}

/**
 * statistics(script, {t0, t1, minProm=10, restSpeed=2, windowMs=60000, stepMs=windowMs, ampBins=10, posBins=20})
 * Range defaults to first..last action. Times in ms, speeds in pos units/s, positions in 0..100.
 */
export function statistics(script, opts = {}) {
  const { minProm = 10, restSpeed = 2, windowMs = 60000, ampBins = 10, posBins = 20 } = opts;
  const stepMs = opts.stepMs || windowMs;
  const first = script.length ? script[0].at : 0, last = script.length ? script[script.length - 1].at : 0;
  const t0 = opts.t0 ?? first, t1 = opts.t1 ?? last;
  const durationMs = Math.max(0, t1 - t0);
  const c = clipped(script, t0, t1), { at, pos, n } = c;
  let inRange = 0;
  for (const a of script) if (a.at >= t0 && a.at <= t1) inRange++;

  // segment pass
  let dist = 0, coveredMs = 0, restMs = 0, upMs = 0, downMs = 0, upDist = 0, downDist = 0, at0Ms = 0, at100Ms = 0;
  let gap = { ms: 0, at: null };
  const segV = [], segW = [], fine = new Float64Array(100);
  for (let j = 1; j < n; j++) {
    const dt = at[j] - at[j - 1], p0 = pos[j - 1], p1 = pos[j], d = Math.abs(p1 - p0), v = (d * 1000) / dt;
    dist += d; coveredMs += dt;
    segV.push(v); segW.push(dt);
    if (v <= restSpeed) restMs += dt;
    if (p1 > p0) { upMs += dt; upDist += d; } else if (p1 < p0) { downMs += dt; downDist += d; }
    if (p0 === p1) { if (p0 === 0) at0Ms += dt; else if (p0 === 100) at100Ms += dt; }
    if (dt > gap.ms) gap = { ms: dt, at: at[j - 1] };
    if (p0 === p1) fine[Math.min(99, Math.floor(p0))] += dt;
    else {                                   // spread dt over the 1-unit bins the segment sweeps through
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      for (let k = Math.floor(lo); k < hi && k < 100; k++) fine[k] += (dt * (Math.min(hi, k + 1) - Math.max(lo, k))) / (hi - lo);
    }
  }
  restMs += Math.max(0, durationMs - coveredMs);   // outside the script the device just holds
  const [p50, p90, p99] = weightedPercentiles(segV, segW, [50, 90, 99]);
  let maxSpeed = 0;
  for (const v of segV) if (v > maxSpeed) maxSpeed = v;

  // strokes
  const tp = turns(at, pos, minProm);
  const T = tp.idx.length, moves = Math.max(0, T - 1), cycles = moves / 2;
  const amps = [], durs = [];
  for (let k = 1; k < T; k++) {
    amps.push(Math.abs(pos[tp.idx[k]] - pos[tp.idx[k - 1]]));
    durs.push(at[tp.idx[k]] - at[tp.idx[k - 1]]);
  }
  const ampHist = new Array(ampBins).fill(0);
  for (const a of amps) ampHist[Math.min(ampBins - 1, Math.floor((a / 100) * ampBins))]++;
  const activeMs = Math.max(0, durationMs - restMs);
  const perMin = (count, ms) => (ms > 0 ? (count / 2 / ms) * 60000 : null);

  const turnAt = Float64Array.from(tp.idx, (i) => at[i]);
  const series = [];
  if (durationMs > 0) {
    for (let ws = t0; ws < t1; ws += stepMs) {
      const we = Math.min(ws + windowMs, t1);
      const count = lb(turnAt, we) - lb(turnAt, ws);
      series.push({ t0: ws, t1: we, count, spm: perMin(count, we - ws) });
      if (we >= t1) break;
    }
  }

  const posHist = new Array(posBins).fill(0);
  let posTotal = 0;
  for (let k = 0; k < 100; k++) { posHist[Math.min(posBins - 1, Math.floor((k * posBins) / 100))] += fine[k]; posTotal += fine[k]; }
  let a0 = 0, a100 = 0;
  for (const a of script) { if (a.at < t0 || a.at > t1) continue; if (a.pos === 0) a0++; else if (a.pos === 100) a100++; }

  const upSpeed = upMs ? (upDist * 1000) / upMs : null, downSpeed = downMs ? (downDist * 1000) / downMs : null;
  return {
    t0, t1, durationMs,
    actions: inRange,
    strokes: { turns: T, moves, cycles },
    strokesPerMin: perMin(moves, durationMs),            // full cycles per minute over the whole range
    activeStrokesPerMin: perMin(moves, activeMs),        // ... over the time not at rest
    strokesPerMinSeries: series,                         // [{t0, t1, count (turns), spm}]
    amplitude: { ...summary(amps), hist: ampHist },      // per move, pos units; hist over 0..100 in ampBins bins
    positionHist: posHist.map((v) => (posTotal ? v / posTotal : 0)),   // time-weighted share per bin over 0..100
    range: {
      p5: nul(histPercentile(fine, posTotal, 5)), p95: nul(histPercentile(fine, posTotal, 95)),
      shareAt0: posTotal ? at0Ms / coveredMs : 0, shareAt100: posTotal ? at100Ms / coveredMs : 0,   // time held exactly there
      actionShareAt0: inRange ? a0 / inRange : 0, actionShareAt100: inRange ? a100 / inRange : 0,
    },
    speed: { mean: durationMs > 0 ? (dist * 1000) / durationMs : 0, p50: nul(p50), p90: nul(p90), p99: nul(p99), max: maxSpeed },
    rest: { ms: restMs, share: durationMs > 0 ? Math.min(1, restMs / durationMs) : 0 },
    longestGap: gap,
    avgStrokeMs: durs.length ? summary(durs).mean : null,       // mean duration of one move
    medianStrokeMs: durs.length ? summary(durs).p50 : null,
    avgCycleMs: durs.length ? 2 * summary(durs).mean : null,
    asymmetry: {
      upMs, downMs, upShare: upMs + downMs ? upMs / (upMs + downMs) : null,
      upSpeed, downSpeed, speedRatio: upSpeed && downSpeed ? upSpeed / downSpeed : null,   // up = pos increasing (out)
    },
  };
}
