// paw-xyu9: the shot's after-tracking settings (derive) are per RUN: two runs on one shot keep their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOf, withDerive, runDerives, shotsFor } from '../src/lib/rederive.js';

const shots = () => [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000 }];
const runA = { id: 'A', range: { start: 0, end: 2000 }, scenes: [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000 }] };
const runB = { ...runA, id: 'B' };
const cam = (s) => ({ cam: { mode: 'off', strength: s } });

test('withDerive writes only the run\'s own entry; another run sees none of it', () => {
  const x = withDerive(shots()[0], 'A', { axis: { mode: 'horizontal' } });
  assert.deepEqual(deriveOf(x, 'A'), { axis: { mode: 'horizontal' } });
  assert.equal(deriveOf(x, 'B'), undefined);
  assert.equal(x.derive, undefined);
});

test('two runs on one shot: each run\'s derives differ, edits stay apart, a reset removes only its own', () => {
  let s = shots();
  s = s.map((x) => withDerive(x, 'A', cam(20)));
  s = s.map((x, k) => (k ? x : withDerive(x, 'B', { axis: { mode: 'vertical' } })));
  const dA = runDerives(runA, s), dB = runDerives(runB, s);
  assert.equal(dA[0].cam.strength, 20); assert.equal(dA[0].axis, undefined);
  assert.equal(dB[0].axis.mode, 'vertical'); assert.equal(dB[0].cam, undefined);
  assert.equal(dB[1].axis ?? dB[1].cam, undefined);            // B has nothing on shot 2
  s = s.map((x) => withDerive(x, 'A', null));
  assert.equal(runDerives(runA, s)[0].cam ?? runDerives(runA, s)[0].axis, undefined);
  assert.equal(runDerives(runB, s)[0].axis.mode, 'vertical');
  assert.equal(s[0].derives.A, undefined); assert.ok(s[0].derives.B);
});

test('an older project\'s shared derive still reaches every run until one is edited, then only that run forks', () => {
  const s = [{ start_ms: 0, end_ms: 1000, derive: cam(40) }];
  assert.equal(runDerives(runA, s)[0].cam.strength, 40); assert.equal(runDerives(runB, s)[0].cam.strength, 40);
  const t = [withDerive(s[0], 'A', cam(70))];
  assert.equal(runDerives(runA, t)[0].cam.strength, 70); assert.equal(runDerives(runB, t)[0].cam.strength, 40);
  const u = [withDerive(t[0], 'A', null)];                      // A back to "as tracked" on purpose: {} beats the shared one
  assert.equal(runDerives(runA, u)[0].cam, undefined); assert.equal(runDerives(runB, u)[0].cam.strength, 40);
});

test('a drag preview for run A does not reach run B; shotsFor keeps the array when no entry exists', () => {
  const s = shots(), pv = { t0: 0, t1: 1000, derive: cam(10), run: 'A' };
  assert.equal(runDerives(runA, s, pv)[0].cam.strength, 10);
  assert.equal(runDerives(runB, s, pv)[0].cam, undefined);
  assert.equal(shotsFor(s, 'A'), s);
});
