// paw-ef73.9: the Autorange soft start / stop over a fade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fadeEnvelopes, fadeShare, setFadeEnv, envelope, FADE_SHARE } from '../src/lib/autorange-env.js';

const fm = 40, shots = [{ start_ms: 0, end_ms: 6000 }];
const fadeIn = (t1 = 400) => ({ kind: 'fade-in', f0: -1, f1: t1 / fm, t0: null, ts: 0, tm: 0, t1, b0: 0, b1: 80 });

test('a shot that fades in gets a soft start over the fade, from the end of the black to the first clean frame', () => {
  const [f] = fadeEnvelopes(shots, [fadeIn()], fm, 6000);
  assert.deepEqual([f.side, f.t0, f.t1, f.share, f.off, f.key], ['in', 80, 400, FADE_SHARE, false, 'in:0']);
  assert.equal(fadeShare(f, 80), FADE_SHARE); assert.equal(fadeShare(f, 400), 1);
  assert.ok(fadeShare(f, 240) > FADE_SHARE && fadeShare(f, 240) < 1);
  // the fade's handles move: the envelope follows, the owner's edit stays (keyed by the cut)
  const [g] = fadeEnvelopes(shots, [fadeIn(800)], fm, 6000, { 'in:0': { share: 0.5 } });
  assert.deepEqual([g.t1, g.share], [800, 0.5]);
  // a fade out: a soft stop, mirrored
  const out = { kind: 'fade-out', f0: 140, f1: 151, t0: 5600, ts: 5640, tm: 6000, t1: null, b0: 5900, b1: 6000 };
  const [o] = fadeEnvelopes(shots, [out], fm, 6000);
  assert.deepEqual([o.side, o.t0, o.t1], ['out', 5600, 5900]);
  assert.equal(fadeShare(o, 5600), 1); assert.equal(fadeShare(o, 5900), FADE_SHARE);
  // a dissolve: offered, off by default
  const dis = { kind: 'dissolve', f0: 0, f1: 10, t0: 0, ts: 40, tm: 200, t1: 400, b0: null, b1: null };
  assert.equal(fadeEnvelopes([{ start_ms: 0, end_ms: 200 }, { start_ms: 200, end_ms: 6000 }], [dis], fm, 6000).every((e) => e.off), true);
});

test('editable and removable: share / off patches, null back to the default', () => {
  let e = setFadeEnv({}, 'in:0', { share: 0.4 });
  e = setFadeEnv(e, 'in:0', { off: true });
  assert.deepEqual(e, { 'in:0': { share: 0.4, off: true } });
  assert.deepEqual(setFadeEnv(e, 'in:0', null), {});
});

test('the envelope narrows the band from its top over the fade (the auto band elsewhere)', () => {
  const plan = [{ i: 0, t0: 0, t1: 6000, source: 'tracked', stats: { turns: 8 }, rule: 'x', pieces: [{ t0: 0, t1: 6000, lo: 10, lo1: 10, hi: 90, hi1: 90 }] }];
  const fades = fadeEnvelopes(shots, [fadeIn()], fm, 6000);
  const env = envelope(plan, [], { scenes: shots, fades });
  assert.deepEqual(env.auto(80), [90 - 80 * FADE_SHARE, 90]);
  assert.deepEqual(env.auto(1000), [10, 90]);
  const off = envelope(plan, [], { scenes: shots, fades: fadeEnvelopes(shots, [fadeIn()], fm, 6000, { 'in:0': { off: true } }) });
  assert.deepEqual(off.auto(80), [10, 90]);
});
