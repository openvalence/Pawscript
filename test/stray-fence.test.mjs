import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsFromChannel } from '../src/lib/runs-channel.js';
import { strayFence, channelOf } from '../src/lib/runs.js';

const strokes = (n, amp = 1) => Array.from({ length: n }, (_, k) => amp * Math.sin(k / 3));

test('one frame of the next shot at the end is a stray; clean strokes and a deep section are not', () => {
  const v = strokes(280); v[279] = 40;
  const f = strayFence(v);
  assert.ok(f && 40 > f[1] && f[1] >= 1 && f[0] <= -1);
  assert.equal(strayFence(strokes(280)), null);
  assert.equal(strayFence([...strokes(200), ...strokes(60, 20)]), null);   // many samples: real motion
});

test('the stray frame no longer sets the run range: the strokes keep their full height', () => {
  const v = strokes(280); v[279] = 40;
  const run = { range: { start: 0, end: 9333 }, scenes: [], channels: { a: { t: v.map((_, k) => k * 33), v } } };
  const { pos } = pointsFromChannel(run, 'a');
  assert.ok(Math.max(...pos) - Math.min(...pos) > 90);
  assert.ok(pos.filter((p) => p > 90).length > 5);   // every stroke reaches the top, not just the last frame
});

test('a stored channel drops the stray frame for every reader: a gap, and its own min / max', () => {
  const v = strokes(280); v[279] = 40;
  const c = channelOf(v.map((y, k) => [k * 33, y]));
  assert.ok(Number.isNaN(c.v[279]) && c.max <= 1.001 && c.min >= -1.001);
  assert.ok(Math.max(...Array.from(c.scaled).filter((y) => y === y)) > 0.99);
});
