// paw-wfd2.3: the one health slot's hysteresis (lib/health.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { healthStep, SHOW_MS, HIDE_MS } from '../src/lib/health.js';

test('health: a warning shows after SHOW_MS, a bad one at once, the most urgent first, and a blip never flaps', () => {
  const seen = new Map(), w = { id: 'models', pri: 4, tone: 'warn', text: 'Tracker models missing' }, b = { id: 'write', pri: 0, tone: 'bad', text: 'Not written' };
  let r = healthStep([w, b], seen, 0);
  assert.deepEqual(r.shown.map((c) => c.id), ['write'], 'bad at once, the warning waits');
  assert.equal(r.next, SHOW_MS);
  r = healthStep([w, b], seen, SHOW_MS);
  assert.deepEqual(r.shown.map((c) => c.id), ['write', 'models'], 'most urgent first');
  r = healthStep([w], seen, SHOW_MS + 100);
  assert.deepEqual(r.shown.map((c) => c.id), ['write', 'models'], 'a cleared one lingers, still first');
  r = healthStep([w], seen, SHOW_MS + 100 + HIDE_MS);
  assert.deepEqual(r.shown.map((c) => c.id), ['models'], 'gone after HIDE_MS');
  // a warning that blinks off and on inside HIDE_MS stays shown (no flap); one shorter than SHOW_MS never shows
  r = healthStep([], seen, SHOW_MS + 200 + HIDE_MS);
  assert.equal(r.shown[0]?.id, 'models');
  r = healthStep([w], seen, SHOW_MS + 300 + HIDE_MS);
  assert.equal(r.shown[0]?.id, 'models');
  const s2 = new Map(), blip = { id: 'x', pri: 1, tone: 'warn', text: 't' };
  healthStep([blip], s2, 0);
  assert.equal(healthStep([], s2, SHOW_MS / 2).shown.length, 0);
  assert.equal(healthStep([], s2, SHOW_MS / 2 + HIDE_MS).shown.length, 0);
  assert.equal(s2.size, 0, 'forgotten');
});
