// Problem finder for the Review-mode problems panel. Pure.
//
//   findProblems(script, profile, ctx) -> Problem[]
//   Problem = { id, severity: 'error'|'warn'|'info', kind, t0, t1, ats: number[], message, fix?: {op, opts} }
//
// ids are `${kind}@${t0}` (+ `#n` on collision), so a selected problem keeps its id while edits elsewhere
// happen. The list is sorted by t0, then severity, then kind.
//
// fix = { op, opts, sel? }: `op` is an export of src/lib/edit/ (called as op(script, sel, opts), see FIX_OPS for the
// module of each), `sel` is the selection to pass ({t0, t1}; absent = whole script) and `opts` its options.
// The one exception is `normalize` (src/lib/core/script.js, called as normalize(script)).
// Problems without a mechanical fix (gaps, empty chapters, cut sync) have no `fix`: they need a human.
import { isValid, normalize, posAt, cleanMicro, MICRO } from '../core/script.js';
import { fmtTime } from '../funscript.js';
import { GENERIC, effectiveMaxSpeed, toUnits, limitsMode } from './profiles.js';
import { strokeShortfalls } from './kinematics.js';
import { arrays, lb, turns } from './util.js';

/** op name -> where it lives. Mapped from the edit-lib's real exports. */
export const FIX_OPS = Object.freeze({
  normalize: 'core/script.js', capSpeed: 'edit/speed.js', thinMinGap: 'edit/density.js', simplify: 'edit/density.js',
  removeMicroReversals: 'edit/density.js', cleanMicro: 'edit/density.js', limitRange: 'edit/amplitude.js', deletePoints: 'edit/points.js',
});

/** Thresholds; override any via ctx.thresholds. */
export const DEFAULTS = Object.freeze({
  gapMs: 5000,            // a hole this long inside an active section is a problem
  activeLookMs: 10000,    // "active" = at least activeMinTurns reversals within this window on BOTH sides of the gap
  activeMinTurns: 2,
  minProm: 10,            // reversal prominence used for turning points
  jitterAmp: 2,           // reversals of at most this many units ...
  jitterMinRun: 3,        // ... repeated this many times in a row are jitter
  microGapMs: MICRO.gapMs, // micro glitch (core/script.js cleanMicro): a blip / back-step / stall closer than this ...
  microPos: MICRO.posTol,  // ... and smaller than this many units (settings edit.cleanMicroMs / edit.cleanMicroPos)
  cutJumpUnits: 50,       // position change across a cut/chapter boundary that is worth a look
  cutWindowMs: 150,
  syncTolerance: 0.06,    // cut-sync: interval across the cut within 6% of the usual stroke period
  minChapterMs: 3000,     // chapters shorter than this are not expected to have motion
  minChapterTurns: 2,
  kinProm: 3,             // kinematic-limit: reversals of at least this many units split strokes
  speedErrorFactor: 1.5,  // speed beyond maxSpeed * factor is an error, otherwise a warning
});

const SEV = { error: 0, warn: 1, info: 2 };
const t = (ms) => fmtTime(ms);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Merge consecutive indices into [first, last] runs. */
function runs(indices) {
  const out = [];
  for (const i of indices) {
    const r = out[out.length - 1];
    if (r && i === r[1] + 1) r[1] = i; else out.push([i, i]);
  }
  return out;
}

/**
 * findProblems(script, profile = GENERIC, ctx = {})
 * ctx: { mediaDurationMs, simulation (a simulateDevice result, for measured planner shortfalls), limits ({v,a,j} units), cuts: [ms | {t}], chapters: [{id,t0,t1,name,expectMotion?}], thresholds: {...} }
 * `script` may be an unnormalised imported list: order/duplicate/invalid problems are reported first and every
 * other check then runs on its normalised form.
 */
export function findProblems(script, profile = GENERIC, ctx = {}) {
  const th = { ...DEFAULTS, ...(ctx.thresholds || {}) };
  const prof = { ...GENERIC, ...(profile || {}), maxSpeed: effectiveMaxSpeed(profile) };
  const found = [];
  const planner = limitsMode(profile) === 'planner';
  // Under a planner profile over-limit findings are informational: the machine reshapes the input predictably. They carry
  // planner: true (summarize counts them apart), no `fix` (never part of fix-all) and the would-be fix as `optionalFix`.
  const add = (p) => {
    if (!planner || !['speed-limit', 'too-close', 'kinematic-limit'].includes(p.kind)) { found.push({ ats: [], ...p }); return; }
    const { fix, ...rest } = p;
    found.push({ ats: [], ...rest, kind: p.kind === 'kinematic-limit' ? 'planner-reshaped' : p.kind, severity: 'info', planner: true, optionalFix: fix,
      message: p.kind === 'kinematic-limit' ? p.message : `The planner will reshape this: ${p.message[0].toLowerCase()}${p.message.slice(1)}` });
  };
  const raw = Array.isArray(script) ? script : [];

  // ---- raw-input hygiene (only fires for files that were not normalised) ----
  if (!isValid(raw)) {
    let prev = null;
    const bad = { order: [], dup: [], invalid: [], range: [], neg: [] };
    raw.forEach((a, i) => {
      if (!a || !Number.isFinite(a.at) || !Number.isFinite(a.pos)) { bad.invalid.push(i); return; }
      if (a.at < 0) bad.neg.push(a.at);
      if (a.pos < 0 || a.pos > 100) bad.range.push(a.at);
      if (prev) { if (a.at < prev.at) bad.order.push(a.at); else if (a.at === prev.at) bad.dup.push(a.at); }
      prev = a;
    });
    const group = (kind, severity, list, msg) => {
      if (!list.length) return;
      add({ kind, severity, t0: Math.min(...list), t1: Math.max(...list), ats: list.slice(0, 500), message: msg(list.length),
        fix: { op: 'normalize', opts: {} } });
    };
    if (bad.invalid.length) {
      add({ kind: 'invalid-action', severity: 'error', t0: 0, t1: 0, ats: [], message: `${plural(bad.invalid.length, 'action')} without a usable time or position (first at index ${bad.invalid[0]})`, fix: { op: 'normalize', opts: {} } });
    }
    group('out-of-order', 'error', bad.order, (n) => `${plural(n, 'action')} out of time order`);
    group('duplicate-time', 'error', bad.dup, (n) => `${plural(n, 'action')} share a timestamp with the previous one (the later one wins)`);
    group('negative-time', 'error', bad.neg, (n) => `${plural(n, 'action')} before time 0`);
    group('invalid-position', 'error', bad.range, (n) => `${plural(n, 'action')} with a position outside 0..100`);
  }
  const s = isValid(raw) ? raw : normalize(raw.filter((a) => a && Number.isFinite(a.at) && Number.isFinite(a.pos)));
  const { at, pos, n } = arrays(s);
  const tp = turns(at, pos, th.minProm);
  const turnT = tp.idx.map((i) => at[i]);
  const turnsIn = (a, b) => lb(turnT, b + 1) - lb(turnT, a);   // turning points with a <= time <= b

  // ---- speed over the device limit ----
  const fast = [];
  for (let j = 1; j < n; j++) if ((Math.abs(pos[j] - pos[j - 1]) * 1000) / (at[j] - at[j - 1]) > prof.maxSpeed) fast.push(j);
  for (const [a, b] of runs(fast)) {
    let peak = 0;
    for (let j = a; j <= b; j++) peak = Math.max(peak, (Math.abs(pos[j] - pos[j - 1]) * 1000) / (at[j] - at[j - 1]));
    const ats = Array.from({ length: b - a + 2 }, (_, k) => at[a - 1 + k]);
    add({ kind: 'speed-limit', severity: peak > prof.maxSpeed * th.speedErrorFactor ? 'error' : 'warn', t0: at[a - 1], t1: at[b], ats,
      message: `Peak ${Math.round(peak)} units/s exceeds the ${prof.name || 'device'} limit of ${prof.maxSpeed} (${plural(b - a + 1, 'segment')} at ${t(at[a - 1])})`,
      fix: { op: 'capSpeed', opts: { maxSpeed: prof.maxSpeed, method: 'pull' }, sel: { t0: at[a - 1], t1: at[b] } } });
  }

  // ---- points closer than the device can follow (only where something moves; flat pairs are 'redundant') ----
  const close = [];
  for (let j = 1; j < n; j++) if (at[j] - at[j - 1] < prof.minIntervalMs && pos[j] !== pos[j - 1]) close.push(j);
  for (const [a, b] of runs(close)) {
    let shortest = Infinity;
    for (let j = a; j <= b; j++) shortest = Math.min(shortest, at[j] - at[j - 1]);
    add({ kind: 'too-close', severity: 'warn', t0: at[a - 1], t1: at[b], ats: Array.from({ length: b - a + 2 }, (_, k) => at[a - 1 + k]),
      message: `${plural(b - a + 1, 'interval')} shorter than ${prof.minIntervalMs} ms (shortest ${shortest} ms) at ${t(at[a - 1])}`,
      fix: { op: 'thinMinGap', opts: { minGapMs: prof.minIntervalMs, keep: 'extreme' }, sel: { t0: at[a - 1], t1: at[b] } } });
  }

  // ---- kinematic limits (profiles with kinematics, or ctx.limits = {v,a,j} in pos units): strokes too fast for a/j ----
  // One problem per failing stroke. limiting: 'j' | 'a' | 'v' = which regime of the S-curve makes it impossible.
  // Fix: no existing edit op expresses accel/jerk limits. Nearest is capSpeed method 'retime' (ripple) with the stroke's average
  // required speed D / requiredTime, which makes the stroke take at least the required time (approximation: the middle is
  // slower than strictly needed). `fix.needs` names the op that would do it exactly: capKinematics(script, sel, {limits, method}).
  if (ctx.limits || prof.kinematics) {
    const lim = ctx.limits || toUnits(prof);
    for (const st of strokeShortfalls(s, lim, { minProm: th.kinProm })) {
      const ratio = st.shortfallMs / st.sub.durationMs;
      const sgn = Math.sign(pos[st.i1] - pos[st.i0]), sub = st.sub, aim = sub.i1;   // aim: the knot the device cannot reach in time
      let units = st.shortfallUnits, measured = false;   // analytic estimate for the limiting part (time-optimal reach: a lower bound)
      if (ctx.simulation) {   // measured on a simulateDevice() result: how far short of the commanded knot the machine stays
        const sm = ctx.simulation, at0 = sm.t[0], idx = (ms) => Math.round((ms - at0) / sm.dtMs);
        if (aim === st.i1) {   // the stroke's extreme: the peak reached around it
          const lo = Math.max(0, Math.floor((st.t1 - 50 - at0) / sm.dtMs)), hi = Math.min(sm.t.length - 1, Math.ceil((st.t1 + 100 - at0) / sm.dtMs));
          if (hi > lo) { let best = -Infinity; for (let q = lo; q <= hi; q++) best = Math.max(best, sgn * sm.pos[q]); units = Math.max(0, sgn * pos[st.i1] - best); measured = true; }
        } else if (idx(at[aim]) >= 0 && idx(at[aim]) < sm.t.length) {   // an interior knot: where the machine is at its time
          units = Math.max(0, sgn * (pos[aim] - sm.pos[idx(at[aim])])); measured = true;
        }
      }
      // Under a planner a shortfall below one position unit (the script's own resolution) is not worth a note.
      if (planner && units < 1) continue;
      const regime = `${{ j: 'jerk', a: 'acceleration', v: 'velocity' }[st.limiting]}-limited`;
      const part = sub.whole ? '' : ` (${sub.i0 === st.i0 ? 'first' : 'last'} part of a ${Math.round(st.D)}-unit, ${Math.round(st.durationMs)} ms stroke)`;
      const verb = `${Math.round(sub.d)} units in ${Math.round(sub.durationMs)} ms${part} needs at least ${Math.round(sub.requiredMs)} ms on ${prof.name || 'the device'}`;
      add({ kind: 'kinematic-limit', severity: ratio > 0.2 ? 'error' : 'warn', t0: st.t0, t1: st.t1,
        ats: Array.from({ length: st.i1 - st.i0 + 1 }, (_, k) => at[st.i0 + k]), limiting: st.limiting, shortfallMs: st.shortfallMs, shortfallUnits: units,
        message: planner
          ? `The planner will reshape this stroke: ${verb} (${regime}), has ${Math.round(sub.durationMs)} ms; expected peak position shortfall ${measured ? '' : '>= '}${units.toFixed(1)} units at ${t(sub.t0)}`
          : `Stroke of ${verb} (${regime}), short by ${st.shortfallMs.toFixed(1)} ms at ${t(st.t0)}`,
        fix: { op: 'capSpeed', opts: { maxSpeed: (st.D * 1000) / st.requiredMs, method: 'retime', ripple: true }, sel: { t0: st.t0, t1: st.t1 }, needs: 'capKinematics' } });
    }
  }

  // ---- long gaps inside an active section ----
  for (let j = 1; j < n; j++) {
    const gap = at[j] - at[j - 1];
    if (gap < th.gapMs) continue;
    if (turnsIn(at[j - 1] - th.activeLookMs, at[j - 1]) >= th.activeMinTurns && turnsIn(at[j], at[j] + th.activeLookMs) >= th.activeMinTurns) {
      add({ kind: 'long-gap', severity: 'warn', t0: at[j - 1], t1: at[j], ats: [at[j - 1], at[j]],
        message: `${(gap / 1000).toFixed(1)} s with no points between ${t(at[j - 1])} and ${t(at[j])}, inside an active section` });
    }
  }

  // ---- zero-movement points: middle of a flat hold ----
  const flat = [];
  for (let i = 1; i < n - 1; i++) if (pos[i] === pos[i - 1] && pos[i] === pos[i + 1]) flat.push(i);
  for (const [a, b] of runs(flat)) {
    add({ kind: 'redundant', severity: 'info', t0: at[a], t1: at[b], ats: Array.from({ length: b - a + 1 }, (_, k) => at[a + k]),
      message: `${plural(b - a + 1, 'point')} in a flat hold at ${pos[a]} add nothing (${t(at[a])})`,
      fix: { op: 'simplify', opts: { tolerance: 0 }, sel: { t0: at[a - 1], t1: at[b + 1] } } });
  }

  // ---- positions outside the profile's usable range ----
  const [lo, hi] = prof.range;
  if (lo > 0 || hi < 100) {
    const out = [];
    for (let i = 0; i < n; i++) if (pos[i] < lo || pos[i] > hi) out.push(i);
    for (const [a, b] of runs(out)) {
      add({ kind: 'out-of-range', severity: 'warn', t0: at[a], t1: at[b], ats: Array.from({ length: b - a + 1 }, (_, k) => at[a + k]),
        message: `${plural(b - a + 1, 'point')} outside the device range ${lo}..${hi} at ${t(at[a])}`,
        fix: { op: 'limitRange', opts: { lo, hi, mode: 'clamp' }, sel: { t0: at[a], t1: at[b] } } });
    }
  }

  // ---- micro-jitter: runs of tiny alternating reversals ----
  {
    let start = -1, prevSign = 0;
    const flush = (end) => {
      if (start >= 0 && end - start + 1 >= th.jitterMinRun) {
        add({ kind: 'jitter', severity: 'info', t0: at[start - 1], t1: at[end], ats: Array.from({ length: end - start + 2 }, (_, k) => at[start - 1 + k]),
          message: `${plural(end - start + 1, 'tiny reversal')} of at most ${th.jitterAmp} units at ${t(at[start - 1])}`,
          fix: { op: 'removeMicroReversals', opts: { threshold: th.jitterAmp + 1 }, sel: { t0: at[start - 1], t1: at[end] } } });
      }
      start = -1; prevSign = 0;
    };
    for (let j = 1; j < n; j++) {
      const d = pos[j] - pos[j - 1], small = d !== 0 && Math.abs(d) <= th.jitterAmp;
      if (small && (start < 0 || Math.sign(d) !== prevSign)) { if (start < 0) start = j; prevSign = Math.sign(d); }
      else { flush(j - 1); if (small) { start = j; prevSign = Math.sign(d); } }
    }
    flush(n - 1);
  }

  // ---- micro glitches a join left (what cleanMicro would remove; the joins clean themselves, old scripts need this) ----
  {
    const left = new Set(cleanMicro(s, { gapMs: th.microGapMs, posTol: th.microPos }).map((a) => a.at)), gone = [];
    for (let i = 0; i < n; i++) if (!left.has(at[i])) gone.push(i);
    for (const [a, b] of runs(gone)) {
      add({ kind: 'micro', severity: 'info', t0: at[a], t1: at[b], ats: Array.from({ length: b - a + 1 }, (_, k) => at[a + k]),
        message: `Micro glitch: ${plural(b - a + 1, 'point')} wiggling under ${th.microPos} units in under ${th.microGapMs} ms at ${t(at[a])}`,
        fix: { op: 'cleanMicro', opts: { gapMs: th.microGapMs, posTol: th.microPos }, sel: { t0: at[a], t1: at[b] } } });
    }
  }

  // ---- script extends past the media ----
  if (Number.isFinite(ctx.mediaDurationMs) && n) {
    const k = lb(at, ctx.mediaDurationMs + 1);
    if (k < n) {
      const ats = Array.from(at.subarray(k, Math.min(n, k + 500)));
      add({ kind: 'past-media', severity: 'error', t0: at[k], t1: at[n - 1], ats,
        message: `${plural(n - k, 'point')} after the end of the media (${t(ctx.mediaDurationMs)})`,
        fix: { op: 'deletePoints', opts: {}, sel: { t0: ctx.mediaDurationMs + 1 } } });
    }
  }

  // ---- cut and chapter boundaries ----
  const cuts = (ctx.cuts || []).map((c) => (typeof c === 'number' ? c : c && c.t)).filter(Number.isFinite);
  const chapters = ctx.chapters || [];
  const boundaries = [...cuts.map((c) => [c, 'cut']), ...chapters.filter((c) => c.t0 > 0).map((c) => [c.t0, 'chapter'])];
  if (n >= 2) {
    for (const [c, what] of boundaries) {
      if (c <= at[0] || c >= at[n - 1]) continue;
      const before = posAt(s, c - th.cutWindowMs), after = posAt(s, c + th.cutWindowMs), jump = Math.abs(after - before);
      if (jump >= th.cutJumpUnits) {
        add({ kind: `${what}-jump`, severity: 'warn', t0: c, t1: c, ats: [],
          message: `Position jumps ${Math.round(jump)} units (${Math.round(before)} -> ${Math.round(after)}) across the ${what} at ${t(c)}: check the sync` });
      }
    }
    for (const c of cuts) {
      // Unbroken rhythm across a cut: the stroke interval spanning it equals the usual period, so the script
      // probably ignores the cut (the video's motion usually changes phase there).
      const k = lb(turnT, c);
      if (k < 3 || k + 3 > turnT.length) continue;
      const per = (a, b) => { const d = []; for (let i = a + 1; i <= b; i++) d.push(turnT[i] - turnT[i - 1]); return d.sort((x, y) => x - y)[d.length >> 1]; };
      const pb = per(k - 3, k - 1), pa = per(k, k + 2), across = turnT[k] - turnT[k - 1];
      if (pb >= 200 && Math.abs(pa - pb) <= 0.15 * pb && Math.abs(across - pb) <= th.syncTolerance * pb) {
        add({ kind: 'cut-sync', severity: 'info', t0: c, t1: c, ats: [turnT[k - 1], turnT[k]],
          message: `Rhythm continues unbroken across the cut at ${t(c)} (interval ${Math.round(across)} ms vs usual ${Math.round(pb)} ms): re-check the sync if the video changes phase here` });
      }
    }
  }

  // ---- chapters that should have motion but do not ----
  for (const ch of chapters) {
    if (ch.expectMotion === false || !(ch.t1 - ch.t0 >= th.minChapterMs)) continue;
    if (turnsIn(ch.t0, ch.t1) < th.minChapterTurns) {
      add({ kind: 'empty-chapter', severity: 'warn', t0: ch.t0, t1: ch.t1, ats: [], id: `empty-chapter@${ch.id ?? ch.t0}`,
        message: `Chapter "${ch.name || ch.id || t(ch.t0)}" (${t(ch.t0)}-${t(ch.t1)}) has no motion` });
    }
  }

  // ---- ids, dedupe, order ----
  const seen = new Map(), out = [];
  for (const p of found) {
    const base = p.id || `${p.kind}@${p.t0}`;
    const k = (seen.get(base) || 0) + 1;
    seen.set(base, k);
    out.push({ ...p, id: k === 1 ? base : `${base}#${k}` });
  }
  return out.sort((a, b) => a.t0 - b.t0 || SEV[a.severity] - SEV[b.severity] || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : 1));
}

/** Counts for a badge: { error, warn, info, planner }. `planner` = informational planner findings (counted ONLY there, not in info). */
export function summarize(problems) {
  const c = { error: 0, warn: 0, info: 0, planner: 0 };
  for (const p of problems) c[p.planner ? 'planner' : p.severity]++;
  return c;
}
