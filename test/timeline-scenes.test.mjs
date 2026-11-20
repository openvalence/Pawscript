import assert from 'node:assert/strict';
import test from 'node:test';
import { sceneIndexAt, splitAt, mergeNext, mergeRange, scenesIn, moveCut, MIN_SHOT_MS, chipsOf } from '../src/features/timeline/scenes.js';

const L = () => [
  { start_ms: 0, end_ms: 1000, loop: { kind: 'exact', period_frames: 72 }, describe: { summary: { species: ['wolf'] } } },
  { start_ms: 1000, end_ms: 3000 }, { start_ms: 3000, end_ms: 4000 }];
const ok = (l) => l.every((s, i) => (i ? s.start_ms === l[i - 1].end_ms : s.start_ms === 0) && s.end_ms > s.start_ms);

test('index', () => { assert.equal(sceneIndexAt(L(), 1000), 1); assert.equal(sceneIndexAt(L(), 4000), 2); assert.equal(sceneIndexAt(L(), -1), -1); });
test('split', () => {
  const r = splitAt(L(), 400, 33);
  assert.ok(ok(r)); assert.equal(r.length, 4);
  assert.ok(!r[0].loop && !r[1].loop && r[0].describe && r[1].describe);
  assert.equal(splitAt(L(), 1000), null); assert.equal(splitAt(L(), 10, 33), null);
});
test('merge', () => {
  const r = mergeNext(L(), 0);
  assert.ok(ok(r)); assert.equal(r.length, 2); assert.equal(r[0].end_ms, 3000); assert.ok(r[0].loop);
  assert.equal(mergeNext(L(), 2), null);
});
test('mergeRange', () => {
  const r = mergeRange(L(), 500, 3500);   // overlaps all three
  assert.ok(ok(r)); assert.equal(r.length, 1); assert.equal(r[0].end_ms, 4000); assert.ok(r[0].loop && r[0].describe);
  const r2 = mergeRange(L(), 1000, 4000);   // exact bounds of scenes 2..3: the first scene only touches t0
  assert.ok(ok(r2)); assert.deepEqual(r2.map((s) => [s.start_ms, s.end_ms]), [[0, 1000], [1000, 4000]]);
  assert.equal(mergeRange(L(), 1000, 3000), null);   // one scene
  assert.equal(mergeRange(L(), 5000, 6000), null);   // none
  assert.deepEqual(scenesIn(L(), 999, 1001), [0, 1]); assert.equal(scenesIn([], 0, 1), null);
});
test('moveCut', () => {
  let r = moveCut(L(), 1, 1500, 33);
  assert.ok(ok(r)); assert.equal(r[0].end_ms, 1500);
  assert.equal(moveCut(L(), 1, -50, 10)[0].end_ms, MIN_SHOT_MS, 'paw-jfwv: stops MIN_SHOT_MS short of the neighbouring cut');
  assert.equal(moveCut(L(), 2, 9999, 10)[2].start_ms, 4000 - MIN_SHOT_MS);
  assert.equal(moveCut(L(), 0, 5), null);
});
test('chips', () => {
  assert.deepEqual(chipsOf(L()[0]).map((c) => c.text), ['loop 72 f', 'wolf']);
  assert.equal(chipsOf({ loop: { kind: null, motion_period_ms: 820 } })[0].text, '≈ 0.82 s');
  assert.deepEqual(chipsOf({ sign: -1, describe: { summary: { knot: true } } }).map((c) => c.tone), ['knot', 'sign']);
});
