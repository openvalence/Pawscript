// paw-wfd2.3: the sustained decoder drop rate
import test from 'node:test';
import assert from 'node:assert/strict';
import { dropRate } from '../src/features/video/drops.js';

test('drops: a rate needs 3 s and 60 frames, follows the last 10 s, and a pause starts it over', () => {
  const w = [];
  let d = 0, n = 0, r = 0;
  for (let t = 0; t <= 2500; t += 500) { n += 15; r = dropRate(w, t, d, n); }
  assert.equal(r, 0, 'too early to call');
  for (let t = 3000; t <= 6000; t += 500) { n += 15; d += 1; r = dropRate(w, t, d, n); }   // 1 in 15 = 7 %
  assert.equal(r, 4, '7 drops in 195 frames, the clean start included');
  for (let t = 6500; t <= 30000; t += 500) { n += 15; r = dropRate(w, t, d, n); }   // clean now: the bad stretch ages out
  assert.equal(r, 0);
  assert.ok(w.length <= 22, 'the window stays bounded');
  n += 15; d += 15; dropRate(w, 40000, d, n);   // a 10 s gap = a pause: nothing carries over
  assert.equal(w.length, 1);
  assert.equal(dropRate([[0, 5, 100]], 500, 0, 10), 0, 'counters that went backwards (a new video) reset');
});

import health from '../src/features/video/health.js';
test('health video.drops: only while playing, above 2 %, the action only when the backend can transcode', () => {
  const c = health.find((h) => h.id === 'video.drops'), mk = (p, be = {}) => ({ player: { playing: true, shuttle: 0, dropPct: 6, makeProxy() {}, ...p }, backend: be });
  assert.deepEqual([c.read(mk({ playing: false })), c.read(mk({ dropPct: 2 })), c.read(mk({ shuttle: 1 }))], [null, null, null]);
  const r = c.read(mk({}, { transcodePreview() {} }));
  assert.equal(r.text, 'Dropping frames, 6 %');
  assert.equal(r.action.label, 'Make a proxy');
  assert.equal(c.read(mk({})).action, undefined);
});
