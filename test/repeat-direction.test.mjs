import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { valueAt, pictureValues, impliedSign, directionFromRepeats } from '../src/lib/repeat-direction.js';

// A loop of 6 pictures (0..5, one frame each at 40 ms) played in two takes: take A at 0-2 s, take B at 3-5 s. Every
// picture repeats in both; picture k sits at depth k * 20 in the finished script.
const FM = 40, PICS = 6;
const frames = [];
for (let f = 0; f < 125; f++) frames.push({ f, take: f < 50 ? 'A' : f >= 75 ? 'B' : null, pic: f % PICS });
const buckets = [...Array(PICS)].map((_, k) => frames.filter((x) => x.take && x.pic === k).map((x) => ({ f0: x.f, f1: x.f, t_ms: x.f * FM })));
const ix = indexRepeats({ frames: frames.length, buckets });
const script = (take, flip = false) => {
  const s = frames.filter((x) => x.take === take).map((x) => ({ at: x.f * FM, pos: flip ? 100 - x.pic * 20 : x.pic * 20 }));
  return { at: Float64Array.from(s, (p) => p.at), pos: Float64Array.from(s, (p) => p.pos) };
};
const A = { label: 'S1', ...script('A'), spans: [{ t0: 0, t1: 2000 }] };
const sceneB = [{ start_ms: 3000, end_ms: 5000 }];

test('valueAt: linear inside, NaN outside or across a gap wider than near', () => {
  const at = [0, 100, 5000], pos = [0, 100, 0];
  assert.equal(valueAt(at, pos, 50), 50);
  assert.equal(valueAt(at, pos, 100), 100);
  assert.ok(Number.isNaN(valueAt(at, pos, -1)));
  assert.ok(Number.isNaN(valueAt(at, pos, 2500, 1500)));   // 2.4 s from both neighbours
  assert.ok(Number.isNaN(valueAt(at, pos, 6000)));
});

test('pictureValues: one mean per picture over the occurrences in the spans', () => {
  const v = pictureValues(ix.occ, A.at, A.pos, A.spans);
  assert.equal(v.size, PICS);
  assert.equal(v.get(3), 60);
});

test('a take in the sidecar\'s inverted direction is flipped to agree with the decided take; an agreeing one is kept', () => {
  const inv = directionFromRepeats(ix, sceneB, script('B', true), [A]);
  assert.equal(inv.length, 1);
  assert.equal(inv[0].sign, -1);
  assert.equal(inv[0].from, 'S1');
  assert.equal(inv[0].n, PICS);
  assert.equal(inv[0].r, -1);
  const same = directionFromRepeats(ix, sceneB, script('B'), [A]);
  assert.equal(same[0].sign, 1);
});

test('no decision without enough shared pictures, spread or correlation', () => {
  const few = new Map([[0, 0], [1, 50]]);
  assert.equal(impliedSign(few, new Map([[0, 10], [1, 90]])).sign, 0);   // 2 shared < 3
  const flat = new Map([[0, 50], [1, 51], [2, 50]]);
  assert.equal(impliedSign(flat, new Map([[0, 0], [1, 50], [2, 100]])).sign, 0);   // the decided side does not move
  const noise = new Map([[0, 0], [1, 100], [2, 0], [3, 100]]);
  assert.equal(impliedSign(noise, new Map([[0, 0], [1, 0], [2, 100], [3, 100]])).sign, 0);   // r = 0
  assert.deepEqual(directionFromRepeats(ix, sceneB, script('B', true), []), []);
  assert.deepEqual(directionFromRepeats(null, sceneB, script('B', true), [A]), []);
});
