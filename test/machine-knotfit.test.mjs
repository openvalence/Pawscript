// Machine knot timing for the timeline (paw-i86, paw-kwq; src/features/machine/knotfit.js): events -> lane marks, the
// verdict on a Knotting effect's span, and the One knot fit that makes the simulated knot go in when the effect pops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TOYS } from '../src/features/machine/toys.js';
import { paramsFor, simulateKnots } from '../src/features/machine/physics.js';
import { knotInKeys } from '../src/lib/fx.js';
import { eventMarks, knotVerdict, verdictText, fitKnotTiming } from '../src/features/machine/knotfit.js';

test('knot events become lane marks: in / pop paired with the stroke that caused them, fails, bends, force-limit spans', () => {
  const m = eventMarks([{ kind: 'in', t: 1200, tRigid: 1000, lag: 200 }, { kind: 'pop', t: 3100, tRigid: 3000 }, { kind: 'fail', t: 5000, tRigid: 4000, need: 800 },
    { kind: 'popfail', t: 6000, tRigid: 5800 }, { kind: 'bend', t: 7000, forced: false }, { kind: 'bend', t: 7100, forced: true }, { kind: 'bendstall', t: 7200 },
    { kind: 'limit', t: 9000, tRigid: 8500 }, { kind: 'hilt', t: 9500, tRigid: 9400 }]);
  assert.deepEqual(m.map((x) => x.kind), ['in', 'pop', 'fail', 'fail', 'pass', 'forced', 'stall', 'span']);
  assert.deepEqual(m[0], { t: 1200, t0: 1000, kind: 'in' });
  assert.deepEqual(m[7], { t: 9000, t0: 8500, kind: 'span' });
});

test('the verdict on a Knotting span: in, failed with how much longer, still pressing, or nothing for a knotless toy', () => {
  const ev = [{ kind: 'in', t: 5300, lag: 300 }, { kind: 'fail', t: 12500, need: 800 }];
  assert.deepEqual(knotVerdict(ev, 4000, 6000), { ok: true, at: 5300, lag: 300 });
  assert.deepEqual(knotVerdict(ev, 10000, 12000), { ok: false, need: 800 });
  assert.equal(verdictText(knotVerdict(ev, 10000, 12000)), 'knot would not go in: needs 0.8 s more held deep');
  assert.ok(Number.isNaN(knotVerdict(ev, 20000, 22000).need));
  assert.equal(verdictText(knotVerdict(ev, 20000, 22000)), 'knot would not go in within this modifier');
  assert.equal(knotVerdict(ev, 20000, 22000, false), null);
  assert.equal(verdictText(knotVerdict(ev, 4000, 6000)), '');
});

// a knotted toy, warm-up strokes, then a One knot effect over [t0, t1] drawn by fx.js knotInKeys
const toy = BUILTIN_TOYS.find((t) => t.id === 'b-knot'), rig = { offsetMm: -10, strokeMm: 180 }, t0 = 30000, t1 = 36000;
const base = [];
for (let k = 0; k < 20; k++) base.push({ at: k * 1500, pos: 100 }, { at: k * 1500 + 750, pos: 25 });
const P0 = { push: 0.3, popAt: 0.6, from: 100, lo: 0, knotIn: 30, press: 10, pressTakes: 0, settle: 0.08, knotOut: 5, popTo: 64, pullOut: 0 };
const scriptFor = (q) => [...base, ...knotInKeys({ ...P0, ...q }, 100, 0.02).map(([u, pos]) => ({ at: Math.round(t0 + u * (t1 - t0)), pos })).filter((x, i, a) => !i || x.at > a[i - 1].at)];
const tPop = t0 + P0.popAt * (t1 - t0);

test('Fit from Machine: the knot that went in late now goes in at the effect\'s pop; the simulation agrees', () => {
  const P = paramsFor('very', { firmness: '5', forceLimitN: 267, w0: 0.5 });
  const before = knotVerdict(simulateKnots(scriptFor({}), toy, rig, P), t0, t1);
  assert.ok(before.ok && before.at > tPop + 60, `late before: ${JSON.stringify(before)}`);
  const r = fitKnotTiming({ toy, rig, P }, scriptFor, t0, t1, P0);
  assert.ok(r.params && r.at >= tPop - 150 && r.at <= tPop + 60, JSON.stringify(r));
  const after = knotVerdict(simulateKnots(scriptFor(r.params), toy, rig, P), t0, t1);
  assert.equal(after.at, r.at, 'the fitted effect plays as the fit said');
});

test('Fit from Machine: a knot this receiver cannot take says so instead of guessing', () => {
  const r = fitKnotTiming({ toy, rig, P: paramsFor('beginner', { firmness: '8', forceLimitN: 267 }) }, scriptFor, t0, t1, P0);
  assert.ok(r.fail && !r.params, JSON.stringify(r));
});
