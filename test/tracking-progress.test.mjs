// A running job's progress text and time left (src/lib/progress.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressText, rateStep, fmtLeft, stageClock } from '../src/lib/progress.js';

test('fmtLeft: m:ss, h:mm:ss', () => {
  assert.equal(fmtLeft(80000), '1:20'); assert.equal(fmtLeft(3725000), '1:02:05'); assert.equal(fmtLeft(-5), '0:00');
});

test('rateStep: EMA over events, restarted by a stage change or done going back; no new frames keeps it', () => {
  let r = rateStep(null, { done: 0 }, 0);
  r = rateStep(r, { done: 100 }, 1000);
  assert.equal(r.rate, 0.1);
  r = rateStep(r, { done: 100 }, 1500);                  // nothing new: the same state
  assert.equal(r.t, 1000);
  r = rateStep(r, { done: 400 }, 2000);                  // 300 in 1 s = 0.3 /ms -> 0.1 + 0.3 * 0.2
  assert.ok(Math.abs(r.rate - 0.16) < 1e-9);
  assert.equal(rateStep(r, { done: 410, stage: 'groups' }, 2100).rate, 0);
  assert.equal(rateStep(r, { done: 5 }, 2100).rate, 0);
});

test('progressText: before frames, percentage + time left, stages, finishing', () => {
  assert.equal(progressText({}), 'starting the tracker');
  assert.equal(progressText({ busy: 'describe' }), 'waiting for the GPU');
  assert.equal(progressText({ total: 900, lastLog: 'waiting for the GPU lock' }), 'waiting for the GPU lock');
  assert.equal(progressText({ total: 900, stage: 'model load', lastLog: 'x' }), 'loading the model');
  assert.equal(progressText({ done: 430, total: 1000, rate: 570 / 80000 }), '43 % · 1:20 left');
  // no rate yet: from the mean so far (430 in 60 s -> 570 more in ~79.5 s)
  assert.equal(progressText({ done: 430, total: 1000, startedAt: 1000, now: 61000 }), '43 % · 1:20 left');
  assert.equal(progressText({ done: 430, total: 1000 }), '43 %');
  assert.equal(progressText({ done: 500, total: 1000, stage: 'groups', rate: 1 }), '50 % · motion groups');
  assert.equal(progressText({ done: 1000, total: 1000, stage: 'tracking' }), '99 % · finishing');
  // describe all (ranges): the scene leads once frames move; the model load stays as it is
  assert.equal(progressText({ done: 13, total: 30, range: 2, ranges: 6, stage: 'describe', rate: 0.001 }), 'scene 3/6 · 43 % · 0:17 left');
  assert.equal(progressText({ done: 0, total: 30, stage: 'model load', ranges: 6 }), 'loading the model');
  assert.equal(progressText({ done: 3, total: 5, range: 0, ranges: 1 }), '60 %');
});

test('progressText: every stage before the first tracked frame has its own words (paw-mhme, sidecar v4.43)', () => {
  const at = (stage, done = 0) => progressText({ done, total: 1000, stage });
  assert.deepEqual(['starting', 'freeing', 'levels', 'model read', 'model gpu', 'tagger', 'labels'].map((s) => at(s)),
    ['starting the tracker', 'freeing GPU memory', 'adjusting levels', 'reading the model weights', 'moving the model to the GPU',
      'loading the tagger', 'naming the groups']);
  assert.equal(at('reading', 120), '12 % · reading frames');
  assert.equal(at('inference', 370), '37 % · tracking the scene');   // a buffered scene counts its tracked frames
  assert.equal(at('model read', 400), '40 % · reading the model weights');   // a first load inside it names itself
});

test('stageClock: each label\'s time, summed when a stage comes back', () => {
  const c = stageClock(0);
  c.mark('', 500); c.mark('starting', 4200); c.mark('inference', 5000); c.mark('model read', 6000); c.mark('model gpu', 9500);
  c.mark('inference', 9900); c.mark('inference', 20000); c.mark('read', 30000);
  assert.equal(c.text(31000), 'start 4.2 s, starting the tracker 0.8 s, tracking the scene 21.1 s, reading the model weights 3.5 s, '
    + 'moving the model to the GPU 0.4 s, reading the result 1.0 s');
});
