// Jerk-, acceleration- and velocity-limited motion: exact move times, per-stroke checks and a device simulation.
// Pure maths. Limits are {v, a, j} in ANY consistent unit system (mm, mm/s, mm/s^2, mm/s^3 or pos units); the
// profile helpers in profiles.js (`toUnits`) give them in pos units. a and v must be finite; j may be Infinity.
//
// Conventions: a move is rest-to-rest (start and end velocity zero). At a turning point of a funscript the
// device must reverse, so velocity there IS zero: each stroke between turning points is one rest-to-rest move.
import { arrays, turns } from './util.js';
import { toUnits, withStroke } from './profiles.js';
import { kineticLoaded, loadKinetic, renderKinetic, kineticRun, FLAG_CLAMPED } from './kinetic/driver.js';

const JMAX = 1e18;
const cbrt = Math.cbrt;

/** Limits usable by the maths: j clamped, a capped so that a jerk-only ramp can still reach it before v (aEff <= sqrt(v j)). */
function norm({ v, a, j }) {
  if (!(v > 0) || !(a > 0) || !(j > 0)) throw new Error(`limits need v, a, j > 0, got ${JSON.stringify({ v, a, j })}`);
  const jj = Math.min(j, JMAX);
  return { v, a: Math.min(a, Math.sqrt(v * jj)), j: jj };
}

/**
 * Rest-to-rest S-curve move of distance d: -> { T, regime, vPeak }.
 *  regime 'j': jerk-only            (d <= 2 a^3 / j^2)        T = 4 cbrt(d / 2j)
 *  regime 'a': acceleration-limited (peak velocity vp < v)    T = 2 (vp / a + a / j),  vp = (-a^2/j + sqrt(a^4/j^2 + 4 a d)) / 2
 *  regime 'v': with cruise at v                               T = d / v + v / a + a / j
 * If v < a^2/j the acceleration limit can never be reached; a is then replaced by sqrt(v j) (jerk-limited all the way).
 */
export function minMoveTimeInfo(d, limits) {
  if (!(d > 0)) return { T: 0, regime: 'j', vPeak: 0 };
  const { v, a, j } = norm(limits);
  if (d <= (2 * a ** 3) / (j * j)) return { T: 4 * cbrt(d / (2 * j)), regime: 'j', vPeak: j * cbrt(d / (2 * j)) ** 2 };
  const vp = (-(a * a) / j + Math.sqrt((a ** 4) / (j * j) + 4 * a * d)) / 2;
  if (vp < v) return { T: 2 * (vp / a + a / j), regime: 'a', vPeak: vp };
  return { T: d / v + v / a + a / j, regime: 'v', vPeak: v };
}
export const minMoveTime = (d, limits) => minMoveTimeInfo(d, limits).T;

/** Largest rest-to-rest distance coverable in T seconds (inverse of minMoveTime; bisection). */
export function maxReach(T, limits) {
  if (!(T > 0)) return 0;
  let lo = 0, hi = norm(limits).v * T;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (minMoveTime(m, limits) <= T) lo = m; else hi = m; }
  return lo;
}

/** Highest sustainable strokes (full cycles) per minute at an amplitude: two back-to-back rest-to-rest moves per cycle. */
export const maxStrokesPerMin = (amplitude, limits) => 60 / (2 * minMoveTime(amplitude, limits));

// ---- reach: distance covered from rest by full-throttle acceleration (end velocity free) ----
function reachPlan(limits) {
  const { v, a, j } = norm(limits);
  const tau = a / j, t2 = Math.max(0, v / a - tau), v1 = (a * tau) / 2, x1 = (j * tau ** 3) / 6;
  const v2 = v1 + a * t2, x2 = x1 + v1 * t2 + (a * t2 * t2) / 2;
  const x3 = x2 + v2 * tau + (a * tau * tau) / 2 - (j * tau ** 3) / 6;
  return { v, a, j, tau, t2, v1, x1, v2, x2, x3, tEnd: 2 * tau + t2 };
}
/** [distance, regime] after t of full-throttle acceleration from rest. */
function xReach(t, P) {
  if (t <= P.tau) return [(P.j * t ** 3) / 6, 'j'];
  if (t <= P.tau + P.t2) { const s = t - P.tau; return [P.x1 + P.v1 * s + (P.a * s * s) / 2, 'a']; }
  if (t <= P.tEnd) { const s = t - P.tau - P.t2; return [P.x2 + P.v2 * s + (P.a * s * s) / 2 - (P.j * s ** 3) / 6, 'j']; }
  return [P.x3 + P.v * (t - P.tEnd), 'v'];
}
/** Minimum time to cover distance d starting at rest, free end velocity (also: the time to stop from full speed over d, reversed). -> {T, regime}. */
export function reachTime(d, limits) {
  if (!(d > 0)) return { T: 0, regime: 'j' };
  const P = reachPlan(limits);
  let lo = 0, hi = P.tEnd + d / P.v + 1e-9;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (xReach(m, P)[0] < d) lo = m; else hi = m; }
  return { T: hi, regime: xReach(hi, P)[1] };
}

/**
 * Check one script against kinematic limits stroke by stroke (limits in pos units, times in seconds internally, results in ms).
 * Rest points = first/last action, turning points (prominence >= minProm) and both ends of holds. For each stroke between
 * rest points (net distance D, duration T):  T >= minMoveTime(D)  and, at every interior action k,
 * t_k >= reachTime(d_k) (getting there from rest) and T - t_k >= reachTime(D - d_k) (stopping after it).
 * All are exact NECESSARY conditions for a monotone stroke; small counter-wiggles inside a stroke are ignored
 * (net displacement is used). Sufficiency is not claimed: a stroke that passes may still need a slower middle.
 * -> [{ i0, i1, t0, t1, D, durationMs, requiredMs, shortfallMs, limiting: 'j'|'a'|'v', shortfallUnits, sub }] for failing strokes, in time order.
 * `sub` = the part that sets the shortfall: `{ i0, i1, t0, t1, d, durationMs, requiredMs, whole }` (the whole stroke, or rest -> interior
 * action k, or interior action k -> rest); `shortfallUnits` = how far short of sub's far end the time-optimal motion stays (a lower bound).
 */
export function strokeShortfalls(script, limits, { minProm = 3, toleranceMs = 0.5 } = {}) {
  const { at, pos, n } = arrays(script);
  if (n < 2) return Object.assign([], { total: 0 });
  const rest = new Set([0, n - 1]);
  for (const i of turns(at, pos, minProm).idx) rest.add(i);
  for (let i = 0; i + 1 < n; i++) if (pos[i] === pos[i + 1]) { rest.add(i); rest.add(i + 1); }
  const r = [...rest].sort((x, y) => x - y), out = [];
  let total = 0;
  for (let s = 0; s + 1 < r.length; s++) {
    const p = r[s], q = r[s + 1], D = Math.abs(pos[q] - pos[p]);
    if (!(D > 0)) continue;
    total++;
    const T = (at[q] - at[p]) / 1000;
    const whole = minMoveTimeInfo(D, limits);
    let worst = whole.T - T, limiting = whole.regime, si = p, sj = q, sReq = whole.T;
    for (let k = p + 1; k < q; k++) {
      const dk = Math.abs(pos[k] - pos[p]), tk = (at[k] - at[p]) / 1000;
      const a = reachTime(dk, limits), b = reachTime(Math.abs(pos[q] - pos[k]), limits);
      if (a.T - tk > worst) { worst = a.T - tk; limiting = a.regime; si = p; sj = k; sReq = a.T; }
      if (b.T - (T - tk) > worst) { worst = b.T - (T - tk); limiting = b.regime; si = k; sj = q; sReq = b.T; }
    }
    if (worst * 1000 > toleranceMs) {
      const isWhole = si === p && sj === q, d = Math.abs(pos[sj] - pos[si]), sT = (at[sj] - at[si]) / 1000;
      const reach = isWhole ? maxReach(sT, limits) : xReach(sT, reachPlan(limits))[0];
      out.push({ i0: p, i1: q, t0: at[p], t1: at[q], D, durationMs: T * 1000, requiredMs: (T + worst) * 1000, shortfallMs: worst * 1000, limiting,
        shortfallUnits: Math.max(0, d - reach),
        sub: { i0: si, i1: sj, t0: at[si], t1: at[sj], d, durationMs: sT * 1000, requiredMs: sReq * 1000, whole: isWhole } });
    }
  }
  out.total = total;   // strokes (rest-to-rest moves with D > 0) examined
  return out;
}

// ---- Kinetic2 rules, analytically (what the 'scurve' engine reproduces; interior free knots reach ~15% less, measured on a dense ramp; see kinetic/PROVENANCE.md and the README) ----
// From the planner's source and measurements of the vendored wasm: every knot keeps its TIME; a knot the ceilings cannot reach moves
// toward the previous achieved position by the least legal amount (forward greedy pass, never corrected later); a hold after a trimmed
// knot stays where it is; the last knot is never trimmed; rest-to-rest legs render as smoothstep (peak 1.5x chord).
// Rests are declared by the host like this (scheduler.js knotVel): last knot, a successor > 500 ms away, a reversal or a hold edge.
/**
 * plannerShape(script, limits, {reachFactor=0.9, smooth=true}) -> { at: number[], pos: number[] } the reference the machine is expected to
 * follow: strokes (rest to rest) trimmed to what can be reached in their span (reachFactor x the time-optimal reach: the real planner
 * reaches ~90% of it, measured), 2-point strokes densified as smoothstep. Positions are floats, not a core Script.
 */
export function plannerShape(script, limits, { reachFactor = 0.9, smooth = true } = {}) {
  const n = script.length;
  if (n < 2) return { at: script.map((a) => a.at), pos: script.map((a) => a.pos) };
  const rest = [0];
  for (let j = 1; j < n; j++) {
    const d1 = j < n - 1 ? script[j + 1].pos - script[j].pos : 0, d0 = script[j].pos - script[j - 1].pos;
    if (j === n - 1 || script[j + 1].at - script[j].at > 500 || d0 * d1 <= 0) rest.push(j);
  }
  const ach = new Float64Array(n);
  ach[0] = script[0].pos;
  for (let s = 0; s + 1 < rest.length; s++) {
    const p = rest[s], q = rest[s + 1], aP = ach[p], chord = script[q].pos - script[p].pos;
    if (Math.abs(chord) <= 0.5) { for (let k = p + 1; k <= q; k++) ach[k] = aP; continue; }
    let aQ;
    if (q === n - 1) aQ = script[q].pos;
    else {
      const D = Math.abs(script[q].pos - aP), reach = reachFactor * (q - p > 1 ? 0.85 : 1) * maxReach((script[q].at - script[p].at) / 1000, limits);
      aQ = aP + Math.sign(script[q].pos - aP) * Math.min(D, reach);
    }
    for (let k = p + 1; k < q; k++) ach[k] = aP + (aQ - aP) * Math.max(0, Math.min(1, (script[k].pos - script[p].pos) / chord));
    ach[q] = aQ;
  }
  const at = [script[0].at], pos = [ach[0]];
  for (let k = 1; k < n; k++) {
    const T = script[k].at - script[k - 1].at, a = ach[k - 1], b = ach[k];
    if (smooth && T >= 20 && a !== b && rest.includes(k) && rest.includes(k - 1)) {
      const m = Math.min(50, Math.ceil(T / 8));
      for (let i = 1; i < m; i++) { const u = i / m; at.push(script[k - 1].at + T * u); pos.push(a + (b - a) * u * u * (3 - 2 * u)); }
    }
    at.push(script[k].at); pos.push(b);
  }
  return { at, pos };
}

// ---- device simulation ----
/**
 * Engine 'scurve' (dependency-free fallback; the name is historical: it is a tracking controller, not a per-stroke S-curve). Model: a third-order TRACKING controller, integrated at 1 ms (or dtMs if smaller), sampled every dtMs. Per step:
 *   position loop   desired velocity = commanded slope + e / 10 ms, with the closing speed capped by a braking curve
 *                   (stopping distance of the jerk-limited axis, 85% of the limits) and by v;
 *   velocity loop   desired acceleration = min(a, dv / 2 ms, sqrt(2 * 0.85 j |dv|)) (braking curve in acceleration, so velocity does not overshoot);
 *   plant           acceleration slews towards the desired one at <= j, |a| <= a, |v| <= v, position clamped to 0..100.
 * Chosen over per-stroke S-curve replanning because it tracks ANY commanded signal (slow, fast, held, overlapping strokes)
 * with no special cases and respects all three limits by construction; the price is a following lag of a few ms and
 * ~10-30% slower than the ideal time-optimal move on a saturated stroke (the margins above). The machine starts at rest at
 * script[0].pos. 10 minutes at 1 ms sampling takes well under a second.
 */
function simulateScurve(script, limits, { t0, t1, dtMs = 1, shape = true } = {}) {
  const L = norm(limits);
  const n0 = script.length, first = n0 ? script[0].at : 0, last = n0 ? script[n0 - 1].at : 0;
  const a0 = t0 ?? first, a1 = t1 ?? last;
  const count = a1 > a0 ? Math.floor((a1 - a0) / dtMs) + 1 : 1;
  const out = { dtMs, t: new Float64Array(count), pos: new Float64Array(count), vel: new Float64Array(count), acc: new Float64Array(count) };
  const h = Math.min(dtMs, 1) / 1000, sub = Math.max(1, Math.round(dtMs / 1000 / h));
  const sh = shape && n0 >= 2 ? plannerShape(script, limits) : null;
  const at = sh ? sh.at : arrays(script).at, sp = sh ? sh.pos : arrays(script).pos, n = at.length;
  const Aj = 0.85 * L.a, Jj = 0.85 * L.j, Dv = 0.002, Dp = 0.01;
  // stopping distance of the jerk-limited axis from speed w: w^2/(2a) + w a/(2j)  ->  speed that can still stop within e
  const vBrake = (e) => Aj * (-Aj / (2 * Jj) + Math.sqrt((Aj * Aj) / (4 * Jj * Jj) + (2 * e) / Aj));
  let x = n ? sp[0] : 50, v = 0, a = 0, seg = 0;
  if (n) { while (seg < n && at[seg] < a0) seg++; if (seg < n && seg > 0) x = sp[seg - 1] + ((sp[seg] - sp[seg - 1]) * (a0 - at[seg - 1])) / (at[seg] - at[seg - 1]); else if (seg === n) x = sp[n - 1]; }
  let k = 0;
  const total = (count - 1) * sub;
  for (let step = 0; step <= total; step++) {
    const t = a0 + (step * dtMs) / sub;
    if (step % sub === 0) { out.t[k] = t; out.pos[k] = x; out.vel[k] = v; out.acc[k] = a; k++; }
    if (step === total) break;
    // reference
    while (seg < n && at[seg] < t) seg++;
    let r, rv;
    if (!n) { r = 50; rv = 0; } else if (seg === 0) { r = sp[0]; rv = 0; } else if (seg === n) { r = sp[n - 1]; rv = 0; } else {
      rv = ((sp[seg] - sp[seg - 1]) * 1000) / (at[seg] - at[seg - 1]);
      r = sp[seg - 1] + ((sp[seg] - sp[seg - 1]) * (t - at[seg - 1])) / (at[seg] - at[seg - 1]);
    }
    const e = r - x;
    let vd = rv + Math.sign(e) * Math.min(Math.abs(e) / Dp, vBrake(Math.abs(e)));
    vd = Math.max(-L.v, Math.min(L.v, vd));
    const dv = vd - v;
    const at_ = Math.sign(dv) * Math.min(Aj, Math.abs(dv) / Dv, Math.sqrt(2 * Jj * Math.abs(dv)));
    const dj = Math.max(-L.j * h, Math.min(L.j * h, at_ - a));
    a = Math.max(-L.a, Math.min(L.a, a + dj));
    const vn = Math.max(-L.v, Math.min(L.v, v + a * h));
    x += ((v + vn) / 2) * h;
    v = vn;
    if (x < 0) { x = 0; v = Math.max(0, v); if (a < 0) a = 0; } else if (x > 100) { x = 100; v = Math.min(0, v); if (a > 0) a = 0; }
  }
  out.engine = 'scurve';
  return out;
}

/** Engine 'kinetic': the machine's own planner (kinetic/driver.js). Limits in pos units; mm via limits.strokeMm / opts.strokeMm (default 100). */
function simulateKinetic(script, limits, { t0, t1, dtMs = 1, strokeMm } = {}) {
  const L = limits.strokeMm ?? strokeMm ?? 100, f = L / 100;
  const r = renderKinetic(script, { v: limits.v * f, a: limits.a * f, j: Math.min(limits.j, 1e18) * f }, L);
  const first = script[0].at, last = script[script.length - 1].at, a0 = t0 ?? first, a1 = t1 ?? last;
  const count = a1 > a0 ? Math.floor((a1 - a0) / dtMs) + 1 : 1, g = 100 / L;
  const out = { dtMs, t: new Float64Array(count), pos: new Float64Array(count), vel: new Float64Array(count), acc: new Float64Array(count), engine: 'kinetic', anomalies: r.anomalies, strokeMm: L };
  for (let k = 0; k < count; k++) {
    const t = a0 + k * dtMs, i = Math.max(0, Math.min(r.steps - 1, Math.round(t - r.first)));
    out.t[k] = t; out.pos[k] = r.pos[i] * g; out.vel[k] = r.vel[i] * g; out.acc[k] = r.acc[i] * g;
  }
  return out;
}

/**
 * simulateDevice(script, limits, {t0, t1, dtMs=1, engine='auto', strokeMm}) -> { dtMs, t, pos, vel, acc, engine, ... } (Float64Arrays,
 * pos units, units/s, units/s^2). `limits` = {v, a, j} in pos units (toUnits(profile), which also carries strokeMm).
 *  engine 'kinetic'  the machine's planner (vendored wasm), fed as the real host feeds it; throws if not loaded (await loadKinetic()).
 *  engine 'scurve'   dependency-free analytic tracker (see simulateScurve above for the model).
 *  engine 'auto'     kinetic when already loaded, else scurve. `result.engine` says which ran.
 * Synchronous; 10 minutes with the kinetic engine takes ~0.5 s.
 */
export function simulateDevice(script, limits, opts = {}) {
  const engine = opts.engine ?? 'auto';
  if (engine === 'kinetic' && !kineticLoaded()) throw new Error('Kinetic planner not loaded: await loadKinetic() first');
  if ((engine === 'kinetic' || (engine === 'auto' && kineticLoaded())) && script.length >= 2) return simulateKinetic(script, limits, opts);
  return simulateScurve(script, limits, opts);
}
/** Load the planner (if it can be loaded) then simulate; falls back to scurve when it cannot. */
export async function simulateDeviceAsync(script, limits, opts = {}) {
  if (opts.engine !== 'scurve') await loadKinetic();
  return simulateDevice(script, limits, opts);
}

// ---- the whole script's motion (the machine preview and the Machine panel) ----
/**
 * planDevice(script, limits, {engine='auto', strokeMm}) -> a generator that yields between chunks (~4k planner ms each)
 * and returns the motion over the whole script at 1 ms: { t0 (media ms of pos[0]), dtMs: 1, pos: Float32Array (units),
 * flags: Uint8Array | null (the planner's KINETIC_FLAG_* per ms), engine, anomalies }. This is what the machine does when
 * the script plays from its start: the planner carries history (an over-limit run stays on the side of the rail it began
 * on until a rest), so a render started anywhere else can be on the wrong half. Same engine choice as simulateDevice.
 */
export function* planDevice(script, limits, opts = {}) {
  const engine = opts.engine ?? 'auto';
  if ((engine === 'kinetic' || (engine === 'auto' && kineticLoaded())) && script.length >= 2) {
    const L = limits.strokeMm ?? opts.strokeMm ?? 100, f = L / 100, g = 100 / L;
    const r = yield* kineticRun(script, { v: limits.v * f, a: limits.a * f, j: Math.min(limits.j, 1e18) * f }, L);
    for (let i = 0; i < r.pos.length; i++) r.pos[i] *= g;
    return { t0: r.first, dtMs: 1, pos: r.pos, flags: r.flags, engine: 'kinetic', anomalies: r.anomalies };
  }
  const s = simulateScurve(script, limits, { dtMs: 1, t1: (script.length ? script[script.length - 1].at : 0) + 1000 });
  return { t0: s.t[0], dtMs: 1, pos: Float32Array.from(s.pos), flags: null, engine: 'scurve', anomalies: {} };
}

/** Position of a plan at media ms t (linear between its samples, held past either end). */
export function planAt(plan, t) {
  const P = plan.pos, x = (t - plan.t0) / plan.dtMs, i = Math.floor(x);
  if (i < 0) return P[0];
  if (i >= P.length - 1) return P[P.length - 1];
  return P[i] + (P[i + 1] - P[i]) * (x - i);
}

/**
 * A plan as a Script that stays within `tol` units of every sample (an O(n) slope cone: each kept point is on the
 * line, not necessarily on a sample). ints: whole ms and pos 0..100 integers (a core Script; the error is then up
 * to tol + 0.5). Covers the plan's samples from `from` ms on (default: all).
 */
export function planScript(plan, tol = 0.05, { ints = false, from = -Infinity } = {}) {
  const P = plan.pos, dt = plan.dtMs, n = P.length, out = [];
  let a = Math.max(0, Math.ceil((from - plan.t0) / dt));
  if (a >= n) return out;
  const put = (i, p) => out.push(ints ? { at: Math.round(plan.t0 + i * dt), pos: Math.max(0, Math.min(100, Math.round(p))) } : { at: plan.t0 + i * dt, pos: p });
  let pa = P[a], lo = -Infinity, hi = Infinity;
  put(a, pa);
  for (let i = a + 1; i < n; i++) {
    const d = i - a, l = (P[i] - tol - pa) / d, u = (P[i] + tol - pa) / d;
    if (Math.max(lo, l) > Math.min(hi, u)) {   // sample i does not fit: end the piece at i - 1 on the cone's middle line
      const m = (lo + hi) / 2;
      pa += m * (i - 1 - a); a = i - 1;
      put(a, pa);
      lo = P[i] - tol - pa; hi = P[i] + tol - pa;   // d = 1
    } else { lo = Math.max(lo, l); hi = Math.min(hi, u); }
  }
  if (a < n - 1) put(n - 1, pa + ((lo + hi) / 2) * (n - 1 - a));
  if (ints) for (let k = out.length - 1; k > 0; k--) if (out[k].at <= out[k - 1].at) out.splice(k, 1);
  return out;
}

/** The script's points the plan misses by more than tol units at their own time: [{at, pos (commanded), got (planned)}]. */
export function planMisses(script, plan, tol = 2) {
  const out = [];
  for (const a of script) { const got = planAt(plan, a.at); if (Math.abs(got - a.pos) > tol) out.push({ at: a.at, pos: a.pos, got }); }
  return out;
}

/** Where the plan left the window and the planner held it at the edge for at least minMs: [{t0, t1, edge: 'out' |
 *  'deep'}] (kinetic only; a knot placed exactly on an edge flags a single ms of rounding, which is not a clip). */
export function planClamps(plan, minMs = 10) {
  const F = plan.flags, out = [];
  if (!F) return out;
  for (let i = 0; i < F.length; i++) {
    if (!(F[i] & FLAG_CLAMPED)) continue;
    let j = i;
    while (j + 1 < F.length && F[j + 1] & FLAG_CLAMPED) j++;
    if ((j - i + 1) * plan.dtMs >= minMs) out.push({ t0: plan.t0 + i * plan.dtMs, t1: plan.t0 + j * plan.dtMs, edge: plan.pos[i] > 50 ? 'out' : 'deep' });
    i = j;
  }
  return out;
}

/**
 * Following error of a simulation against the commanded script, over the simulated range.
 * -> { max, rms (pos units), lagAtExtremesMs: {n, mean, max, p90}, extremeShortfall: {mean, max} (pos units the device falls short of
 *      the commanded peak/valley) }. Extremes are the script's turning points (prominence >= minProm) inside the range; the device's
 *      extreme is searched within +-min(300 ms, half the neighbouring stroke).
 */
export function trackingError(script, sim, { minProm = 10 } = {}) {
  const { at, pos, n } = arrays(script);
  const m = sim.t.length;
  let max = 0, sq = 0, j = 0;
  for (let i = 0; i < m; i++) {
    const t = sim.t[i];
    while (j < n && at[j] < t) j++;
    const c = !n ? 50 : j === 0 ? pos[0] : j === n ? pos[n - 1] : pos[j - 1] + ((pos[j] - pos[j - 1]) * (t - at[j - 1])) / (at[j] - at[j - 1]);
    const err = Math.abs(sim.pos[i] - c);
    if (err > max) max = err;
    sq += err * err;
  }
  const tp = turns(at, pos, minProm), lags = [], miss = [];
  const t0 = sim.t[0], dt = sim.dtMs;
  for (let q = 0; q < tp.idx.length; q++) {
    const i = tp.idx[q], T = at[i];
    const prev = q ? T - at[tp.idx[q - 1]] : Infinity, next = q + 1 < tp.idx.length ? at[tp.idx[q + 1]] - T : Infinity;
    const w = Math.min(300, prev / 2, next / 2);
    if (!Number.isFinite(w) || T - w < t0 || T + w > sim.t[m - 1]) continue;
    const a = Math.round((T - w - t0) / dt), b = Math.round((T + w - t0) / dt);
    let bi = a;
    for (let s = a; s <= b; s++) if (tp.kind[q] === 1 ? sim.pos[s] > sim.pos[bi] : sim.pos[s] < sim.pos[bi]) bi = s;
    lags.push(sim.t[bi] - T);
    miss.push(Math.abs(pos[i] - sim.pos[bi]));
  }
  const sorted = Float64Array.from(lags).sort(), mean = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : null);
  return {
    max, rms: m ? Math.sqrt(sq / m) : 0,
    lagAtExtremesMs: { n: lags.length, mean: mean(lags), max: lags.reduce((m, v) => Math.max(m, v), -Infinity) === -Infinity ? null : lags.reduce((m, v) => Math.max(m, v), -Infinity), p90: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))] : null },
    extremeShortfall: { mean: mean(miss), max: miss.length ? miss.reduce((m, v) => Math.max(m, v), 0) : null },
  };
}

/**
 * "At which window size does this script start to get reshaped?": for each stroke length (mm) re-evaluate the script on the profile.
 * -> [{ strokeMm, strokes, reshaped, share (0..1), worstShortfallMs, worstShortfallUnits (analytic, a lower bound), rms, maxError, engine }]
 * rms / maxError are pos units from simulateDevice + trackingError (null with {tracking:false}). Cheap without tracking (strokes only).
 */
export function sweepStroke(script, profile, lengths = [100, 150, 200, 250, 300], { tracking = true, engine = 'auto', minProm = 3, dtMs = 2 } = {}) {
  return lengths.map((strokeMm) => {
    const lim = toUnits(withStroke(profile, strokeMm));
    const bad = strokeShortfalls(script, lim, { minProm });
    let wu = 0, wm = 0;
    for (const b of bad) { wm = Math.max(wm, b.shortfallMs); wu = Math.max(wu, b.shortfallUnits); }
    const row = { strokeMm, strokes: bad.total, reshaped: bad.length, share: bad.total ? bad.length / bad.total : 0, worstShortfallMs: wm, worstShortfallUnits: wu, rms: null, maxError: null, engine: null };
    if (tracking && script.length >= 2) {
      const sim = simulateDevice(script, lim, { engine, dtMs });
      const te = trackingError(script, sim);
      row.rms = te.rms; row.maxError = te.max; row.engine = sim.engine;
    }
    return row;
  });
}
