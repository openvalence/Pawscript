// paw-ef73.10: the loop search after Detect scenes (loop-search.js, pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTargets, searchLoop, searchKey } from '../src/features/timeline/loop-search.js';
import { loopWords } from '../src/features/timeline/loop-info.js';

const shots = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }, { start_ms: 10000, end_ms: 15000 }, { start_ms: 15000, end_ms: 20000, loop: { kind: 'exact' } }];

test('queued only for shots without a loop (repeat, own or searched), never one whose loop the owner removed', () => {
  const repeat = { t0: 5500, t1: 6500, auto: { key: '3:0', t0: 5500, t1: 6500, end: 9000, n: 3 } };
  assert.deepEqual(searchTargets(shots, [repeat], []), [0, 2], 'shot 2 has a repeat loop, shot 4 a result');
  assert.deepEqual(searchTargets(shots, [{ t0: 12000, t1: 13000 }], [searchKey(shots[0])]), [1], 'removed: shot 1; the owner\'s loop: shot 3');
});

test('a result becomes an automatic, approximate loop (drawn on its shot); weak or single-pass ones are dropped', () => {
  const l = searchLoop(shots[0], { kind: 'exact', period_ms: 1200, confidence: 0.93, cycles: 4 }, { minConfidence: 0.5, id: 'lp1' });
  assert.deepEqual(l, { id: 'lp1', t0: 0, t1: 1200, auto: { key: 'search:0', t0: 0, t1: 1200, end: 4800, n: 4, approx: true, confidence: 0.93 } });
  assert.ok(l.auto.t0 === l.t0 && l.auto.t1 === l.t1, 'automatic: the x removes it');
  assert.equal(searchLoop(shots[0], { period_ms: 1200, confidence: 0.4, cycles: 4 }, { minConfidence: 0.5 }), null, 'under loop_min_confidence');
  assert.equal(searchLoop(shots[0], { period_ms: 3000, confidence: 0.9, cycles: 1 }), null, 'one pass is no loop');
  assert.equal(searchLoop(shots[0], { kind: null, period_ms: null, confidence: 0 }), null);
  const w = loopWords(l, { frameMs: 1000 / 30, auto: true, group: -1, shotAt: () => '9' });   // paw-2lp7.5: shots numbered through the video
  assert.equal(w.short, '~36 f × 4', 'paw-llaa: the compact words on the Shots strip; the rest in its tip');
  assert.match(w.long, /^Approximate loop of about 36 frames, 4 passes, found by the loop search \(confidence 0\.93\) in shot 9; it starts at the shot's start\. × removes it/);
});
