// paw-h83k: the Machine panel's time-to-ready and bulge peak run on a Worker while playing (offload.js, machine.worker.js).
// The worker gets structured clones (the context, the script and the mesh once, then only the state / the pose): it must
// give the very numbers the main thread gives. Node has no Worker: the worker module runs here on a fake `self`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TOYS } from '../src/features/machine/toys.js';
import { MachineSim, params, timeToReady, copyState, simulateKnots } from '../src/features/machine/physics.js';
import { toyCentreline, bulgeStations, bulgeAt, bulgeSample, bodyWall } from '../src/features/machine/centreline.js';
import { rearMesh, boneLine } from '../src/features/machine/body.js';
import { bulgePeak, createOffload } from '../src/features/machine/offload.js';

const knotted = BUILTIN_TOYS.find((t) => t.id === 'b-knot'), RIG = { strokeMm: 180, offsetMm: -10 };
const out = [];
globalThis.self = { postMessage: (m) => out.push(m) };
await import('../src/features/machine/machine.worker.js');
/** One message through the worker, as postMessage would carry it (a structured clone each way). */
const send = (msg) => { out.length = 0; self.onmessage({ data: structuredClone(msg) }); return structuredClone(out[0]); };

test('worker: time to ready from a cloned context and script is the main thread\'s, call after call', () => {
  const P = params({ bodyGive: 0, xiIn: [0, 0], xiOut: [0, 0], firmness: 'rigid' });
  const script = Array.from({ length: 80 }, (_, i) => ({ at: i * 500, pos: i % 2 ? 0 : 100 }));
  const sim = new MachineSim().configure(script, knotted, RIG, P);
  let id = 0, first = true;
  for (const t of [4000, 9000, 15500, 22000, 39000]) {
    const s = sim.stateAt(t).state, want = timeToReady(copyState(s), script, s.t, sim.ctx);
    const got = send({ id: ++id, fn: 'ttr', a: { s, t: s.t, ctx: first ? sim.ctx : null, script: first ? script : null } });
    first = false;
    assert.deepEqual(got, { id, r: want }, `t ${t}`);
    assert.ok(!want.idle && want.ms > 0, JSON.stringify(want));   // (a real forward run, not an early answer)
  }
});

test('worker: the bulge peak from a cloned mesh and pose is the main thread\'s (and the old inline loop\'s)', () => {
  const n = 151, path = { n, step: 4, P: new Float32Array(n * 3), T: new Float32Array(n * 3), U: new Float32Array(n * 3), V: new Float32Array(n * 3) };
  const ca = Math.cos(0.6), sa = Math.sin(0.6);   // (a straight path heading toward the belly: the toy pushes its skin)
  for (let i = 0; i < n; i++) { path.P.set([0, i * 4 * ca, -i * 4 * sa], i * 3); path.T.set([0, ca, -sa], i * 3); path.U.set([1, 0, 0], i * 3); path.V.set([0, sa, ca], i * 3); }
  const L = knotted.length_mm, m = rearMesh({ scale: 1 }), ix = bulgeSample(m, 1), bl = boneLine(1), wl = bodyWall(1, 0.25);
  let id = 100, sentMesh = false, any = 0;
  for (const d of [140, 170, 200]) {
    const tc = toyCentreline({ path, d, dc: d, xb: 0, L }), wallSt = bulgeStations(tc, knotted, wl, 1), wall = [wl, 1.3 * 30 + wl, 60, 0.5 * (L * tc.scale) / 39];
    const o = { from: wall[2], cap: wall[1], h: wall[3] };
    let old = 0;   // the panel's loop before paw-h83k (the whole tc)
    for (const i of ix) old = Math.max(old, bulgeAt([m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]], tc, wallSt, 0.3, wall[0], { ...o, bone: bl, nor: m.nor ? [m.nor[i * 3], m.nor[i * 3 + 1], m.nor[i * 3 + 2]] : null }));
    const job = { ix, tc: { C: tc.C, Q: tc.Q }, wallSt, roll: 0.3, wall, o, bl, bxb: 0 };
    assert.equal(bulgePeak({ ...job, mesh: m }), old);
    const got = send({ id: ++id, fn: 'bulge', a: { ...job, mesh: sentMesh ? null : { pos: m.pos, nor: m.nor || null } } });
    sentMesh = true;
    assert.deepEqual(got, { id, r: old }, `d ${d}`);
    any = Math.max(any, old);
  }
  assert.ok(any > 1, `the toy bulges the belly (${any} mm)`);
});

test('paw-mnd8: worker: the knot events from a cloned script, toy, rig and params are those of the main thread', async () => {
  const script = Array.from({ length: 120 }, (_, i) => ({ at: i * 450, pos: i % 2 ? 0 : 100 })), off = createOffload();
  let id = 200, first = true;
  for (const P of [params(), params({ tone: 95, lube: 0.3 })]) {
    const want = simulateKnots(script, knotted, RIG, P);
    assert.ok(want.length > 0, 'events to compare');
    assert.deepEqual(send({ id: ++id, fn: 'knots', a: { toy: knotted, rig: RIG, P, script: first ? script : null } }), { id, r: want });
    assert.deepEqual(await off.knots(script, knotted, RIG, P), want, 'inline (no Worker)');
    first = false;
  }
});

test('offload: no Worker (node) runs the same calls inline; one at a time, a newer ask replaces the one waiting', async () => {
  const P = params(), script = Array.from({ length: 40 }, (_, i) => ({ at: i * 400, pos: i % 2 ? 10 : 90 }));
  const sim = new MachineSim().configure(script, knotted, RIG, P), s = sim.stateAt(12000).state, s2 = sim.stateAt(14000).state, off = createOffload();
  assert.deepEqual(await off.ready(s, script, s.t, sim.ctx), timeToReady(s, script, s.t, sim.ctx));
  const empty = { mesh: { pos: new Float32Array(3) }, ix: [], tc: null };
  const [a, b, c] = [off.bulge(empty), off.bulge(empty), off.bulge(empty)];   // a runs, b waits, c replaces b
  assert.deepEqual(await Promise.all([a, b, c]), [0, null, 0]);
  const [x, y] = [off.ready(s, script, s.t, sim.ctx), off.ready(s2, script, s2.t, sim.ctx)];
  assert.deepEqual(await Promise.all([x, y]), [timeToReady(s, script, s.t, sim.ctx), timeToReady(s2, script, s2.t, sim.ctx)]);
  off.close();
});
