// The machine preview: what the device planner (Kinetic2, vendored wasm) does with the script, and how it is drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateDevice, toUnits, withStroke, getProfile, loadKinetic, planDevice, planAt, planScript, planMisses, planClamps } from '../src/lib/analyze/index.js';
import { renderKinetic, segmentsOf, DUR_MAX } from '../src/lib/analyze/kinetic/driver.js';
import { isValid, posAt } from '../src/lib/core/script.js';
import { drawBase, readTheme } from '../src/features/lanes/render.js';

const P = getProfile('nucleus-capstan'), lim = toUnits(P);
const alt = (n, per, lo = 0, hi = 100) => Array.from({ length: n }, (_, i) => ({ at: i * per, pos: i % 2 ? hi : lo }));
const plan = (s, l = lim) => { const it = planDevice(s, l); let r, yields = 0; while (!(r = it.next()).done) yields++; return Object.assign(r.value, { yields }); };
const band = (p, t0, t1) => { let lo = Infinity, hi = -Infinity; for (let t = t0; t <= t1; t++) { const v = planAt(p, t); lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };

test('planner samples sit on the engine clock: sample 0 is engine ms 1 (kinetic_step advances, then evaluates)', async () => {
  assert.ok(await loadKinetic(), 'the vendored planner loads');
  const s = [{ at: 0, pos: 0 }, { at: 1000, pos: 0 }, { at: 3000, pos: 100 }, { at: 5000, pos: 100 }];
  const r = renderKinetic(s, { v: P.kinematics.vMax, a: P.kinematics.aMax, j: P.kinematics.jMax }, 200);
  assert.equal(r.first, r.t0 + 1, 'the engine clock read back');
  // a slow rest-to-rest move crosses its middle at the commanded middle (the emitter trails the plan by ~1 ms)
  const k = simulateDevice(s, lim, { engine: 'kinetic', t0: 1000, t1: 3000, dtMs: 1 });
  const i = k.pos.findIndex((p) => p >= 50), cross = k.t[i - 1] + (50 - k.pos[i - 1]) / (k.pos[i] - k.pos[i - 1]);
  assert.ok(Math.abs(cross - 2000) <= 1.5, 'crosses 50 at ' + cross);
  assert.ok(Math.abs(k.pos[0]) < 0.01 && Math.abs(k.pos.at(-1) - 100) < 0.5, 'starts and ends on the knots');
});

test('a span over 65.5 s is clamped as the host clamps dur_ms (u16), not wrapped by the wasm', async () => {
  await loadKinetic();
  const s = [{ at: 0, pos: 0 }, { at: 1000, pos: 0 }, { at: 71000, pos: 100 }, { at: 72000, pos: 0 }];
  assert.deepEqual(segmentsOf(s).segs.map((g) => g[2]), [1200, 1000, DUR_MAX, 1000]);
  const k = simulateDevice(s, lim, { engine: 'kinetic', dtMs: 1 });
  // the piece ends where the host's clamped dur puts it, 65.5 s after its start (wrapped to 4464 ms, the planner
  // stretched it to the next segment instead: 93.4 at 60 s, 98.5 at 66 s)
  assert.ok(k.pos[60000] > 96 && k.pos[66000] > 99.5, `60 s: ${k.pos[60000]}, 66 s: ${k.pos[66000]}`);
});

test('whole-script plan: in chunks, the same as one go; an over-limit run keeps to the side it began on', async () => {
  await loadKinetic();
  const s = alt(1500, 120);   // 0/100 every 120 ms: far past 1200 mm/s over 200 mm
  const p = plan(s), one = simulateDevice(s, lim, { t0: p.t0, t1: p.t0 + p.pos.length - 1, dtMs: 1 });
  assert.equal(p.engine, 'kinetic'); assert.ok(p.yields > 10, 'yields between chunks: ' + p.yields);
  assert.equal(p.t0, -1499); assert.equal(p.dtMs, 1);
  for (let i = 0; i < p.pos.length; i += 997) assert.ok(Math.abs(p.pos[i] - one.pos[i]) < 1e-4);
  // played from the start the machine swings 0..55 for the whole run, at 1 s as at 170 s
  for (const t of [1000, 90000, 170000]) { const [lo, hi] = band(p, t, t + 1000); assert.ok(lo < 1 && hi > 50 && hi < 60, `${t}: ${lo}..${hi}`); }
  // the same strokes started on a 100 knot (what a render cut at the view did) swing 45..100: the wrong half
  const [lo, hi] = band(plan(s.slice(751)), 92000, 93000);
  assert.ok(lo > 40 && hi > 99, `cut mid-run: ${lo}..${hi}`);
});

test('the plan keeps to the profile limits at every stroke length', async () => {
  await loadKinetic();
  for (const L of [100, 200, 300]) {
    const l = toUnits(withStroke(P, L)), p = plan([...alt(300, 140), ...alt(300, 450).map((a) => ({ at: a.at + 42000, pos: a.pos }))], l);
    let v = 0, a = 0;
    for (let i = 2; i < p.pos.length; i++) {
      const d1 = p.pos[i] - p.pos[i - 1], d0 = p.pos[i - 1] - p.pos[i - 2];
      v = Math.max(v, Math.abs(d1) * 1000 * L / 100); a = Math.max(a, Math.abs(d1 - d0) * 1e6 * L / 100);
    }
    assert.ok(v <= P.kinematics.vMax * 1.01, `${L} mm: ${v.toFixed(0)} mm/s`);
    assert.ok(a <= P.kinematics.aMax * 1.05, `${L} mm: ${a.toFixed(0)} mm/s^2`);
  }
});

test('plan helpers: a Script within tolerance, misses where the planner trims, clamps only when held at an edge', async () => {
  await loadKinetic();
  const slow = alt(200, 450, 10, 90), p = plan(slow);
  for (const [tol, ints] of [[0.05, false], [0.5, true]]) {
    const d = planScript(p, tol, { ints, from: 0 });
    let mx = 0;
    for (let t = 0; t < p.t0 + p.pos.length - 1; t += 1) mx = Math.max(mx, Math.abs(posAt(d, t) - planAt(p, t)));
    assert.ok(mx <= tol + (ints ? 0.5 : 1e-4), `tol ${tol}: ${mx}`);
    assert.ok(d.length < p.pos.length / 8, 'decimated: ' + d.length);
    if (ints) assert.ok(isValid(d));
  }
  assert.deepEqual(planMisses(slow, p), []);
  const fast = alt(200, 120), m = planMisses(fast, plan(fast));
  assert.ok(m.length >= 99 && m.every((x) => Math.abs(x.got - x.pos) > 2), 'every 100 knot is short: ' + m.length);
  assert.deepEqual(planClamps(plan(alt(100, 250))), [], 'knots exactly on the edges are not clips');
  assert.deepEqual(planClamps({ t0: 0, dtMs: 1, pos: new Float32Array(30).fill(100), flags: new Uint8Array(30).fill(4) }), [{ t0: 0, t1: 29, edge: 'out' }]);
});

// a 2D context that records the machine curve's path (the lane draws it in T.machine)
function recorder(dpr) {
  let style = '', pts = 0, width = 0;
  const ctx = new Proxy({}, {
    get: (o, k) => k === 'getTransform' ? () => ({ a: dpr }) : k === 'measureText' ? () => ({ width: 40 })
      : k === 'lineTo' ? () => { if (style === T.machine && width < 2) pts++; } : k in o ? o[k] : () => {},
    set: (o, k, v) => { if (k === 'strokeStyle') style = v; if (k === 'lineWidth') width = v; o[k] = v; return true; },
  });
  return { ctx, points: () => pts };
}
const T = readTheme();

test('the lane draws the plan at device-pixel resolution: every sample zoomed in, two per device column zoomed out', async () => {
  await loadKinetic();
  const s = alt(400, 400, 10, 90), p = plan(s), g = { id: 'device-preview', source: 'device-preview', samples: p, misses: [], clamps: [], script: [] };
  const L = (script) => ({ theme: T, script, ghosts: [g], selIdx: [], bookmarks: [], chapters: [], loops: [] });
  const count = (span, dpr, w = 800) => { const r = recorder(dpr); drawBase(r.ctx, w, 120, { start: 20000, span }, L(s)); return r.points(); };
  const near = (x, want, tol) => assert.ok(Math.abs(x - want) <= tol, `${x} vs ${want}`);
  near(count(1000, 2), 1000, 3);          // 1 s on 1600 device px: every 1 ms sample
  near(count(8000, 1), 2 * 800, 4);       // 8 s on 800 px: min + max per column
  near(count(8000, 2), 2 * 1600, 8);      // the same at dpr 2: twice the columns
  // dense script (strokes under 4 px apart): no curve, only the misses
  assert.equal(count(180000, 1), 0);
});
