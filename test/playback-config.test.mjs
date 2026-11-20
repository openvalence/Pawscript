// playback-config.test.mjs -- src/features/playback/config.js (profile limits -> scheduler config) and
// bridge.js toSteps (0..1 -> the feature's steps) and the fake bridge's upstream-like range refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configFor, rangeOf } from '../src/features/playback/config.js';
import { toSteps, fakeBridge } from '../src/features/playback/bridge.js';
import { getProfile, withStroke } from '../src/lib/analyze/profiles.js';

const settings = (v = {}) => ({ get: (k, d) => (k in v ? v[k] : d) });

test('planner profile (Nucleus Capstan): no speed clamp, no profile interval; only the device gap', () => {
  const c = configFor(settings(), getProfile('nucleus-capstan'), { gap_ms: 8 });
  assert.equal(c.maxSpeed, 0);
  assert.equal(c.minIntervalMs, 8);
  const w = configFor(settings(), withStroke(getProfile('nucleus-capstan'), 100), null);   // stroke window changes nothing here
  assert.equal(w.maxSpeed, 0);
});

test('hard profiles clamp to their limits; latency from the profile, offset clamped to +-500', () => {
  const h = configFor(settings({ 'playback.offsetMs': 9000 }), getProfile('handy'), { gap_ms: 0 });
  assert.equal(h.maxSpeed, 360);
  assert.equal(h.minIntervalMs, 60);
  assert.equal(h.latencyMs, 100);
  assert.equal(h.offsetMs, 500);
  assert.equal(configFor(settings({ 'playback.offsetMs': -9000 }), getProfile('generic'), null).offsetMs, -500);
  assert.equal(configFor(settings(), getProfile('generic'), { gap_ms: 120 }).minIntervalMs, 120);
});

test('user range sits inside the profile range; bad stored ranges are repaired', () => {
  const p = { ...getProfile('generic'), range: [10, 90] };
  const c = configFor(settings({ 'playback.range': [50, 100], 'playback.invert': true }), p, null);
  assert.deepEqual([c.lo, c.hi, c.invert], [50, 90, true]);
  assert.deepEqual(rangeOf(settings({ 'playback.range': 'x' })), [0, 100]);
  assert.deepEqual(rangeOf(settings({ 'playback.range': [90, 20] })), [90, 95]);
  assert.deepEqual(rangeOf(settings({ 'playback.range': [-5, 400] })), [0, 100]);
});

test('toSteps: clamped to the feature range and duration range, never NaN', () => {
  const lin = { feature: 0, range: [0, 100], ms: [10, 5000] };
  assert.deepEqual(toSteps(lin, 0.5, 300), { position: 50, ms: 300 });
  assert.deepEqual(toSteps(lin, 2, 1e6), { position: 100, ms: 5000 });
  assert.deepEqual(toSteps(lin, -1, 0), { position: 0, ms: 10 });
  assert.deepEqual(toSteps(lin, NaN, NaN), { position: 0, ms: 10 });
  assert.deepEqual(toSteps({ feature: 1, range: [20, 120], ms: null }, 1, 250), { position: 120, ms: 250 });
});

test('fake bridge refuses positions outside the feature range (as upstream)', async () => {
  const F = fakeBridge({ scanDelayMs: 0 });
  await F.start();
  await F.scan(true);
  await new Promise((r) => setTimeout(r, 5));
  await F.linear(0, 0, 10000, 100);
  await assert.rejects(F.linear(0, 0, 10001, 100));
  await assert.rejects(F.linear(1, 0, 5, 100));   // the vibrator has no position feature
  assert.equal(F.log.length, 1);
});
