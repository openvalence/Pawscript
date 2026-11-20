import assert from 'node:assert/strict';
import test from 'node:test';
import { indexRepeats, bucketOf, occurrencesOf, bucketColor, findLoops, loopOfBucket, loopFamilies, familyMembers, familyOf } from '../src/features/timeline/repeats.js';
// paw-llaa: the ruler's per-bucket tick strip is gone (loops: one tint + one preferred-frame tick per pass; the rest carets:
// test/loop-marks.test.mjs)

// 3 buckets at 10 fps (100 ms a frame): bucket 0 at frames 0-1 and 20-21, bucket 1 at 4 and 26 (not a loop with bucket 0: another spacing), bucket 2 at 40, 60, 80
const R = { frames: 100, exact: 3, buckets: [
  [{ f0: 0, f1: 1, t_ms: 0 }, { f0: 20, f1: 21, t_ms: 2000 }],
  [{ f0: 4, f1: 4, t_ms: 400 }, { f0: 26, f1: 26, t_ms: 2600 }],
  [{ f0: 40, f1: 40, t_ms: 4000 }, { f0: 60, f1: 60, t_ms: 6000 }, { f0: 80, f1: 80, t_ms: 8000 }],
] };
const ix = indexRepeats(R);

test('frames -> bucket id, held runs included; bucket -> occurrences', () => {
  assert.deepEqual([0, 1, 2, 4, 20, 21, 22, 26, 60, 99].map((f) => bucketOf(ix, f)), [0, 0, -1, 1, 0, 0, -1, 1, 2, -1]);
  assert.deepEqual(occurrencesOf(ix, 2).map((o) => o.t), [4000, 6000, 8000]);
  assert.deepEqual(occurrencesOf(ix, 9), []);
  assert.equal(bucketOf(indexRepeats(null), 3), -1);
});

test('bucket colours: stable per id, neighbours far apart on the hue circle, a darker ink on the light theme', () => {
  assert.equal(bucketColor(5), bucketColor(5));
  const hue = (c) => +c.match(/hsl\(([\d.]+)/)[1];
  for (let i = 0; i < 40; i++) {
    const d = Math.abs(hue(bucketColor(i)) - hue(bucketColor(i + 1))) % 360;
    assert.ok(Math.min(d, 360 - d) > 100, `${i}: ${d}`);
  }
  assert.notEqual(bucketColor(3, true), bucketColor(3, false));
  assert.match(bucketColor(3, true), / 38%\)$/);
});

// a 4-picture loop played 3 times at 10 fps (frames 10-13, 20-23, 30-33; frame 12 held twice), plus a lone repeat
const L = { frames: 50, buckets: [
  [{ f0: 10, f1: 10, t_ms: 1000 }, { f0: 20, f1: 20, t_ms: 2000 }, { f0: 30, f1: 30, t_ms: 3000 }],
  [{ f0: 11, f1: 11, t_ms: 1100 }, { f0: 21, f1: 21, t_ms: 2100 }, { f0: 31, f1: 31, t_ms: 3100 }],
  [{ f0: 12, f1: 13, t_ms: 1200 }, { f0: 22, f1: 23, t_ms: 2200 }, { f0: 32, f1: 33, t_ms: 3200 }],
  [{ f0: 14, f1: 14, t_ms: 1400 }, { f0: 24, f1: 24, t_ms: 2400 }, { f0: 35, f1: 35, t_ms: 3500 }],   // its 3rd one a frame late: still the loop
  [{ f0: 15, f1: 15, t_ms: 1500 }, { f0: 45, f1: 45, t_ms: 4500 }],                                   // a lone repeat
] };
const lx = indexRepeats(L);

test('loops: buckets with one occurrence pattern shifted by a few frames are one loop, in phase order', () => {
  assert.deepEqual(findLoops(lx.buckets), [{ key: 0, members: [0, 1, 2, 3], n: 3 }]);
  assert.equal(loopOfBucket(lx, 2).key, 0);
  assert.equal(loopOfBucket(lx, 4), null);
});

test('a loop is its own family', () => {
  assert.deepEqual([...lx.family], [[0, 0]]);
});

// paw-llaa: the owner's "second purple": an 8-picture loop whose last pass stops half-way (28.5 passes), the same footage
// again in a later shot (5.5 passes): its first 4 pictures play once more than its last 4, so findLoops (same count) splits
// the cycle in two loops, each drawing its own colour of ticks between the other's. One family.
const pic = (n) => (n >= 60 && n < 288 ? 100 + ((n - 60) % 8) : n >= 600 && n < 644 ? 100 + ((n - 600) % 8) : n >= 288 && n < 524 ? 200 + ((n - 288) % 8) : 2000 + n);
const occ = new Map();
for (let n = 0; n < 720; n++) { const p = pic(n); if (!occ.has(p)) occ.set(p, []); occ.get(p).push({ f0: n, f1: n, t_ms: Math.round((n * 1000) / 30) }); }
const px = indexRepeats({ frames: 720, buckets: [...occ.values()].filter((o) => o.length > 1) }, 1000 / 30);

test('a cycle cut mid-pass: findLoops splits it in two loops (the purple ticks); loopFamilies makes them one footage', () => {
  const pics = (L) => L.members.map((m) => pic(px.buckets[m].occ[0].f0));
  assert.deepEqual(px.loops.map((L) => [pics(L), L.n]), [[[100, 101, 102, 103], 35], [[104, 105, 106, 107], 33], [[200, 201, 202, 203], 30], [[204, 205, 206, 207], 29]]);
  const [a, b, c, d] = px.loops.map((L) => L.key);
  assert.deepEqual([...px.family], [[a, a], [b, a], [c, c], [d, c]], 'two footages, each one family');
  assert.deepEqual(familyMembers(px, a).map((m) => pic(px.buckets[m].occ[0].f0)), [100, 101, 102, 103, 104, 105, 106, 107]);
  assert.equal(familyOf(px, px.loops[1].members[2]), a);
  assert.equal(familyOf(px, 999), -1, 'no such picture');
  assert.equal(familyOf(lx, 4), -1, 'a lone repeated picture: no loop');
  assert.deepEqual([...loopFamilies(px.buckets, [])], []);
});