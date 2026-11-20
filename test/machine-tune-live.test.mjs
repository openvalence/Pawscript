// paw-mnd8: the Machine panel's tuning sliders are live. While the params change late in a script the frame shows the old
// history carried over its last 4 s under the new params (MachineSim.previewAt) and a second sim lays the new history
// in slices (advance); once it has caught up it takes over. What it shows from then on must be, bit for bit, what
// integrating the new params at once gave (today's path: configure, then a traced stateAt from 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TOYS } from '../src/features/machine/toys.js';
import { MachineSim, params, paramsFor } from '../src/features/machine/physics.js';

const knotted = BUILTIN_TOYS.find((t) => t.id === 'b-knot'), RIG = { strokeMm: 180, offsetMm: -10 };
const opts = { traceMs: 10000, every: 50 };
function dense(ms) {
  const out = [];
  let t = 0, i = 0;
  while (t < ms) { out.push({ at: t, pos: i % 2 ? (i * 13) % 30 : 70 + ((i * 7) % 31) }); t += 120 + ((i * 37) % 380); i++; if (i % 41 === 0) t += 1500; }
  return out;
}

for (const [name, P0, key, values] of [
  ['tightness', params(), 'tone', [60, 70, 85, 97, 110]],
  ['a warmed start, the tube, friction', paramsFor('experienced', { firmness: '5', warmup: 'light' }), 'muWet', [0.05, 0.12, 0.2]],
]) {
  test(`paw-mnd8: a slider dragged late in a script (${name}): previews each value, then the caught-up sim is the at-once integration, bit for bit`, () => {
    const script = dense(200000), T = 150000;
    const sim = new MachineSim().configure(script, knotted, RIG, P0);
    sim.stateAt(T, opts);   // the panel was showing the playhead
    let next = null, P = P0;
    for (const v of values) {   // the drag: a new value each tick
      P = { ...P0, [key]: v };
      (next ??= new MachineSim()).configure(script, knotted, RIG, P);
      assert.equal(next.advance(T, 0), false, 'not caught up yet: the frame previews');
      const pv = sim.previewAt(T, next.ctx);
      assert.ok(pv && pv.t === T && Number.isFinite(pv.d) && Number.isFinite(pv.a), `a preview at the playhead (${v})`);
      assert.equal(sim.cps.length, Math.floor(T / 2000) + 1, 'the old history is kept');
    }
    while (!next.advance(T, 5));   // let go: the new history in 5 ms slices
    const ref = new MachineSim().configure(script, knotted, RIG, P);   // today: everything again in one frame
    let t = T;
    for (let f = 0; f < 240; f++, t += 8.333) assert.deepEqual(next.stateAt(t, opts), ref.stateAt(t, opts), `frame ${f} t ${t}`);   // then playing on
  });
}

test('paw-mnd8: no preview for a state of another shape or far past the old history (integrated in the frame, as before)', () => {
  const script = dense(60000), sim = new MachineSim().configure(script, knotted, RIG, params()), ctx = new MachineSim().configure(script, knotted, RIG, params({ tone: 99 })).ctx;
  sim.stateAt(20000);
  assert.equal(sim.previewAt(20000, new MachineSim().configure(script, knotted, RIG, params({ canalN: params().canalN + 4 })).ctx), null);
  assert.ok(sim.previewAt(22000, ctx), 'a little past the old history (playing on while it catches up)');
  assert.equal(sim.previewAt(50000, ctx), null, 'a seek far ahead');
});

test('paw-mnd8: advance lays the same checkpoints as one integration', () => {
  const script = dense(60000), P = params({ tone: 90 }), a = new MachineSim().configure(script, knotted, RIG, P), b = new MachineSim().configure(script, knotted, RIG, P);
  while (!a.advance(55000, 1)) {}
  b.stateAt(55000);
  assert.deepEqual(a.cps, b.cps.slice(0, a.cps.length));
  assert.equal(a.cps.length, Math.floor(45000 / 2000) + 1);
});
