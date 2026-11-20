// paw-h83k: the Machine panel's traced stateAt continues from the previous frame instead of re-integrating its 10 s
// strain trace every frame. It must give, bit for bit, what the full re-integration from a checkpoint gave (the
// reference below is the old MachineSim.stateAt, verbatim) over a long playback with seeks, pauses, speed changes,
// loop wraps, scrubs (untraced calls), a script edit and a params change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TOYS } from '../src/features/machine/toys.js';
import { MachineSim, params, paramsFor, copyState, step, depthOf } from '../src/features/machine/physics.js';

const knotted = BUILTIN_TOYS.find((t) => t.id === 'b-knot');
const RIG = { strokeMm: 180, offsetMm: -10 };

/** The old MachineSim.stateAt (before paw-h83k), on a sim's checkpoints. */
function oldStateAt(sim, t, { traceMs = 0, every = 50 } = {}) {
  const P = sim.ctx.P, dt = P.dtMs, CK = P.checkpointMs, tg = Math.max(0, Math.floor(t / dt) * dt);
  const from = Math.max(0, tg - traceMs), k = Math.min(sim.cps.length - 1, Math.floor(from / CK));
  const s = copyState(sim.cps[k]), sc = sim.script, n = sc.length;
  const tr0 = Math.floor((tg - traceMs) / every) * every, values = traceMs ? new Float32Array(Math.ceil(traceMs / every) + 1) : null;
  const forces = traceMs ? new Float32Array(values.length) : null;
  let j = 0;
  if (n) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sc[m].at <= s.t) lo = m + 1; else hi = m; } j = Math.max(0, lo - 1); }
  while (s.t < tg) {
    const tt = s.t + dt;
    let pos = 50;
    if (n) {
      while (j < n - 1 && sc[j + 1].at <= tt) j++;
      const A = sc[j], B = sc[j + 1];
      pos = tt <= sc[0].at ? sc[0].pos : !B ? A.pos : A.pos + ((B.pos - A.pos) * (tt - A.at)) / (B.at - A.at);
    }
    step(s, pos, sim.ctx);
    if (s.t % CK === 0 && s.t / CK === sim.cps.length) sim.cps.push(copyState(s));
    if (values && s.t > tg - traceMs) { const b = Math.floor((s.t - tr0) / every); if (b >= 0 && b < values.length) { if (s.strain > values[b]) values[b] = s.strain; if (Math.abs(s.F) > forces[b]) forces[b] = Math.abs(s.F); } }
  }
  if (!Number.isFinite(s.d)) { const pos = !n ? 50 : sc[0].pos; s.d = s.dc = s.dt = Math.min(depthOf(sim.ctx.rig, pos), sim.ctx.len); }
  return values ? { state: s, trace: { t0: tr0, every, values, forces } } : { state: s };
}

/** A dense script: strokes of varying speed and depth (some into the knot), with holds. */
function dense(ms) {
  const out = [];
  let t = 0, i = 0;
  while (t < ms) { const half = 120 + ((i * 37) % 380); out.push({ at: t, pos: i % 2 ? (i * 13) % 30 : 70 + ((i * 7) % 31) }); t += half; i++; if (i % 41 === 0) t += 1500; }
  return out;
}

test('trace cursor: a long playback (seeks, pauses, speeds, loop wraps, scrubs, an edit, a params change) is bit-identical to re-integrating', () => {
  const LOOP = 75000;
  let script = dense(LOOP + 2000), P = params();
  const sim = new MachineSim().configure(script, knotted, RIG, P), ref = new MachineSim().configure(script, knotted, RIG, P);
  const opts = { traceMs: 10000, every: 50 };
  let t = 0, speed = 1, frames = 0, continued = 0, compared = 0, hot = 0, wasPaused = false;
  for (let f = 0; f < 9000; f++) {
    // the owner's session: 60 fps, a pause every so often, speed changes, a few seeks, the loop wrapping at LOOP
    if (f % 1700 === 900) { speed = [1, 0.5, 2, 1.5, 0.25][(f / 1700) | 0] ?? 1; hot = 4; }
    const paused = f % 1100 > 1040;
    if (paused !== wasPaused) { wasPaused = paused; hot = 4; }
    if (f === 2500) { t = 61234.5; hot = 4; }          // seek forward
    else if (f === 3100) { t = 4321; hot = 4; }        // seek back
    else if (!paused) t += 16.667 * speed;
    if (t > LOOP) { t -= LOOP; hot = 4; }              // loop wrap
    if (f === 5000) {                                  // an edit ahead of the playhead, then one behind it
      script = script.map((p) => (p.at > t + 3000 && p.at < t + 9000 ? { ...p, pos: 100 - p.pos } : p));
      sim.configure(script, knotted, RIG, P); ref.configure(script, knotted, RIG, P); hot = 4;
    }
    if (f === 6000) { script = script.map((p, i) => (i === 3 ? { ...p, pos: 55 } : p)); sim.configure(script, knotted, RIG, P); ref.configure(script, knotted, RIG, P); hot = 4; }
    if (f === 7000) { P = params({ restMm: 14 }); sim.configure(script, knotted, RIG, P); ref.configure(script, knotted, RIG, P); hot = 4; }
    const scrub = f > 4000 && f < 4060;   // a drag: untraced calls (the pose only)
    if (f === 4001 || f === 4060) hot = 4;
    const tq = scrub ? t + (f - 4000) * 40 : t;
    const before = sim.cur?.s;
    const a = sim.stateAt(tq, scrub ? {} : opts);
    if (!scrub && before && sim.cur?.s === before) continued++;
    frames++;
    // (the reference re-integrates 10 s a call: every 7th frame and every frame just after an event)
    if (hot-- > 0 || f % 7 === 0) { compared++; assert.deepEqual(a, oldStateAt(ref, tq, scrub ? {} : opts), `frame ${f} t ${tq}`); }
  }
  assert.ok(continued > frames * 0.9, `the cursor continued on ${continued} of ${frames} frames`);
  assert.ok(compared > 1300, String(compared));
});

test('trace cursor: the tube model and a warmed start, played through, match re-integration; the returned state is a copy', () => {
  const P = paramsFor('experienced', { firmness: '5', warmup: 'light' }), script = dense(40000);
  const sim = new MachineSim().configure(script, knotted, RIG, P), ref = new MachineSim().configure(script, knotted, RIG, P);
  let f = 0;
  for (let t = 0; t < 40000; t += 16.667) { const a = sim.stateAt(t, { traceMs: 10000 }); if (f++ % 9 === 0 || t < 200) assert.deepEqual(a, oldStateAt(ref, t, { traceMs: 10000 }), `t ${t}`); }
  const { state } = sim.stateAt(40000, { traceMs: 10000 });
  state.d = NaN; state.ap.fill(0);   // a caller mutating its state does not move the cursor
  assert.deepEqual(sim.stateAt(40100, { traceMs: 10000 }), oldStateAt(ref, 40100, { traceMs: 10000 }));
});
