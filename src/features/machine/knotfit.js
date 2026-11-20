// knotfit.js -- the Machine's knot timing for the timeline (paw-i86, paw-kwq). Pure (test/machine-knotfit.test.mjs):
//  - eventMarks: simulateKnots events -> marks the lanes draw over the stroke lane (lanes/render.js drawMarks);
//  - knotVerdict: what the simulation says of a Knotting effect's span (in at, lag, or a failure and how much longer);
//  - fitKnotTiming: the One knot push / ease timing that makes the simulated knot go in when the effect pops.
import { MachineSim } from './physics.js';

/** Events -> marks {t, t0?, kind}: 'in' / 'pop' (t0: when a rigid toy would have, the script stroke that caused it),
 *  'fail' (a knot or pop that did not happen), 'pass' / 'forced' (a bend), 'stall' (a bend that did not give), 'span'
 *  (t0..t: the machine at its force limit). */
export function eventMarks(events = []) {
  const out = [];
  for (const e of events) {
    if (e.kind === 'in' || e.kind === 'pop') out.push({ t: e.t, t0: e.tRigid, kind: e.kind });
    else if (e.kind === 'fail' || e.kind === 'popfail') out.push({ t: e.t, t0: e.tRigid, kind: 'fail' });
    else if (e.kind === 'bend') out.push({ t: e.t, kind: e.forced ? 'forced' : 'pass' });
    else if (e.kind === 'bendstall') out.push({ t: e.t, kind: 'stall' });
    else if (e.kind === 'limit') out.push({ t: e.t, t0: e.tRigid, kind: 'span' });
    else if (e.kind === 'prostate') out.push({ t: e.t, t0: e.tRigid, kind: 'stim', peak: e.peak });   // (paw-xdcy)
  }
  return out;
}

const AFTER = 2000;   // a knot-in up to this long after a span still belongs to it

/** A Knotting effect over [t0, t1] against the events: {ok: true, at, lag} (the knot went in at `at`), {ok: false, need}
 *  (it failed: ms more held deep, Infinity = never with this toy; NaN = it was still pressing when the span ended) or
 *  null (a toy without a knot, no events). */
export function knotVerdict(events, t0, t1, knotted = true) {
  if (!events || !knotted) return null;
  const inn = events.find((e) => e.kind === 'in' && e.t >= t0 && e.t <= t1 + AFTER);
  if (inn) return { ok: true, at: inn.t, lag: inn.lag };
  const f = events.find((e) => e.kind === 'fail' && e.t >= t0 && e.t <= t1 + AFTER);
  return f ? { ok: false, need: f.need } : { ok: false, need: NaN };
}

/** "knot would not go in: needs 0.8 s more held deep" (or never with this toy). */
export const verdictText = (v) => (!v || v.ok ? '' : Number.isFinite(v.need) ? (v.need < 100 ? 'knot would not go in: hold it deep a moment longer' : `knot would not go in: needs ${(v.need / 1000).toFixed(1)} s more held deep`)
  : Number.isNaN(v.need) ? 'knot would not go in within this modifier' : 'knot would not go in with this toy and experience');

/**
 * One knot timing for the Machine: candidates of the push share (longer = the carriage nears the knot sooner), the press
 * share (longer = it presses near the knot level longer), the knot depth (deeper = the push itself goes deep enough for
 * the real knot, the rim travelling in with it) and the tie (the full depth: the knot held deep long enough), each
 * simulated from the last checkpoint before the span
 * (MachineSim reuses the rest); the candidate whose knot goes in closest to the effect's pop (t0 + popAt x span) wins,
 * ties to the least change. scriptFor(params) -> the final script with those params on this effect.
 * -> {params: {push, pressTakes, press, knotOut}, at, lag, off (ms the knot goes in after the pop; < 0 before)} | {fail:
 * true, need} (no candidate gets it in).
 */
export function fitKnotTiming({ toy, rig, P }, scriptFor, t0, t1, p) {
  const span = t1 - t0, tPop = t0 + p.popAt * span, sim = new MachineSim(), drop = p.press - p.lo;
  const pushes = [], presses = [...new Set([p.pressTakes, 0.1, 0.2])], ties = [...new Set([p.knotOut, p.lo])], depths = [...new Set([drop, 0.6 * drop, 0.3 * drop, 0].map((x) => Math.round(p.lo + x)))];
  for (let x = Math.max(0.05, p.push); x <= p.popAt + 1e-9; x = +(x + 0.05).toFixed(2)) pushes.push(x);
  if (!pushes.includes(p.popAt)) pushes.push(p.popAt);
  let best = null, lastFail = null;
  for (const push of pushes) for (const pressTakes of presses) for (const press of depths) for (const knotOut of ties) {
    const q = { push, pressTakes, press, knotOut };
    sim.configure(scriptFor(q), toy, rig, P);
    sim.ctx.events = [];
    sim.stateAt(t1 + AFTER);
    const ev = sim.ctx.events;
    sim.ctx.events = null;
    const v = knotVerdict(ev, t0, t1);
    if (!v.ok) { if (Number.isFinite(v.need) || !lastFail) lastFail = v; continue; }
    const score = Math.abs(v.at - tPop) + 200 * (Math.abs(push - p.push) + Math.abs(pressTakes - p.pressTakes)) + 5 * Math.abs(press - p.press) + 5 * Math.abs(knotOut - p.knotOut);
    if (!best || score < best.score) best = { score, params: q, at: v.at, lag: v.lag };
  }
  return best ? { params: best.params, at: best.at, lag: best.lag, off: best.at - tPop } : { fail: true, need: lastFail?.need ?? Infinity };
}
