// paw-ef73.7: a loop's footage group (its colour: loop-marks.js, paw-llaa) and its words (loop-info.js, pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { loopGroup, firstSeen, loopWords, passesOf } from '../src/features/timeline/loop-info.js';

const FM = 1000 / 30;
// footage A: pictures a0..a3 (one per 30 frames), 4 passes back to back at 1:00 (frame 1800) and 2 passes at 2:00;
// footage B: pictures b0..b2, 3 passes at 0:10; a one-off repeated picture c at 0:05 and 0:50
const run = (f0, n, pics, per) => Array.from({ length: n }, (_, k) => pics.map((_, j) => f0 + k * per + j * (per / pics.length)));
const A = run(1800, 4, [0, 1, 2, 3], 120).concat(run(3600, 2, [0, 1, 2, 3], 120)), B = run(300, 3, [0, 1, 2], 90);
const bucket = (fs) => fs.map((f) => ({ f0: f, f1: f, t_ms: f * FM }));
const raw = { frames: 5000, buckets: [
  ...[0, 1, 2, 3].map((j) => bucket(A.map((pass) => pass[j]))),
  ...[0, 1, 2].map((j) => bucket(B.map((pass) => pass[j]))),
  bucket([150, 1500]),
] };
const ix = indexRepeats(raw);
const ms = (f) => f * FM;

test('same footage -> same group, wherever it plays; different footage -> a different one; none -> -1', () => {
  const at1 = loopGroup(ix, { t0: ms(1800), t1: ms(1920) }, FM), at2 = loopGroup(ix, { t0: ms(3630), t1: ms(3750) }, FM);
  const b = loopGroup(ix, { t0: ms(300), t1: ms(390) }, FM);
  assert.ok(at1 >= 0);
  assert.equal(at1, at2, 'the same pictures at 2:00 (another phase) are the same footage');
  assert.notEqual(at1, b);
  assert.equal(loopGroup(ix, { t0: ms(4500), t1: ms(4600) }, FM), -1, 'no repeated picture under it');
  assert.equal(loopGroup(null, { t0: 0, t1: 1000 }, FM), -1, 'no repeats index');
  assert.equal(loopGroup(ix, { t0: 0, t1: 1, auto: { key: '42:3' } }, FM), 42, 'an automatic loop names its own');
  assert.equal(loopGroup(ix, { t0: ms(140), t1: ms(160) }, FM), 7, 'a lone repeated picture: its bucket');
});

test('words: short on the loop, long in the tip; the same loop first seen in an earlier shot, and where else it plays', () => {
  const shotAt = (t) => (t < 30000 ? '1' : t < 90000 ? '7' : '9');   // paw-2lp7.5: shots numbered through the video
  const g = loopGroup(ix, { t0: ms(1800), t1: ms(1920) }, FM);
  const auto = { t0: ms(1800), t1: ms(1920), auto: { key: `${g}:0`, t0: ms(1800), t1: ms(1920), end: ms(2280), n: 4 } };
  const w = loopWords(auto, { frameMs: FM, auto: true, group: g, others: [{ t0: ms(3630), group: g }, { t0: ms(300), group: 99 }], seen: firstSeen(ix, g), shotAt });
  assert.equal(w.short, '120 f × 4', 'paw-llaa: the compact words on the Shots strip');
  assert.equal(w.long, 'Automatic loop of 120 frames, 4 passes, found from the repeated frames in shot 7. The same loop also plays at 2:01. × removes it; move, resize or tile it to make it yours.');
  assert.equal(w.origin, null, 'first seen here');
  const later = loopWords({ t0: ms(3630), t1: ms(3750), tiledTo: ms(3870) }, { frameMs: FM, group: g, others: [{ t0: ms(1800), group: g }], seen: firstSeen(ix, g), shotAt });
  assert.equal(later.short, '120 f × 2');
  assert.equal(later.origin.shot, '7', 'the chain on the shot says where else (no "same as" in the words)');
  assert.match(later.long, /^Loop of 120 frames, 2 passes in shot 9\. Same loop as shot 7 \(1:00\)\. The same loop also plays at 1:00\.$/);
  const hand = loopWords({ t0: 1000, t1: 2000 }, { frameMs: FM, group: -1, shotAt: () => '' });
  assert.deepEqual([hand.short, hand.long], ['30 f × 1', 'Loop of 30 frames, 1 pass.']);
  assert.match(loopWords({ t0: 1000, t1: 2000 }, { frameMs: FM, group: -1, pick: 4 }).long, /Preferred frame: 5 of 30 \(drag its tick on the ruler\)\.$/, 'paw-llaa: its preferred frame');
  assert.equal(passesOf({ t0: 0, t1: 100, tiledTo: 450 }), 5);
});
