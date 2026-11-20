import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidIntervals, gapAt, itemAt, neighbour, create, move, resize, split, merge, duplicate, remove, snapTime, snapDelta, snapTargets } from '../src/features/timeline/intervals.js';

const D = 100000;
const L = [{ id: 'a', t0: 0, t1: 1000 }, { id: 'b', t0: 1000, t1: 3000 }, { id: 'c', t0: 5000, t1: 6000 }];
const ids = (l) => l.map((x) => `${x.id}:${x.t0}-${x.t1}`).join(' ');

test('queries', () => {
  assert.ok(isValidIntervals(L, D));
  assert.equal(itemAt(L, 1000).id, 'b');
  assert.deepEqual(gapAt(L, 4000, D), { t0: 3000, t1: 5000 });
  assert.deepEqual(gapAt(L, 7000, D), { t0: 6000, t1: D });
  assert.equal(gapAt(L, 500, D), null);
  assert.equal(neighbour(L, 1000, 1).id, 'c');
  assert.equal(neighbour(L, 1000, -1).id, 'a');
});

test('snapping', () => {
  const T = snapTargets([3000, { t: 1000, label: 'cut' }, 3000]);
  assert.equal(T.length, 2);
  assert.deepEqual(snapTime(1040, T, 50), { t: 1000, target: T[0] });
  assert.equal(snapTime(1100, T, 50, 1000 / 30).t, 1100);   // frame 33 = 1100 ms
  assert.equal(snapTime(1110, T, 50, 1000 / 30).t, 1100);
  assert.equal(snapDelta([200, 700], 280, T, 30).dt, 300);  // right edge 700+280 -> 1000
});

test('create confines to the gap at the anchor', () => {
  assert.equal(ids(create(L, { id: 'n', t0: 3500, t1: 9000 }, { dur: D })), 'a:0-1000 b:1000-3000 n:3500-5000 c:5000-6000');
  assert.equal(ids(create(L, { id: 'n', t0: 4500, t1: 2000 }, { dur: D })), 'a:0-1000 b:1000-3000 n:3000-4500 c:5000-6000');
  assert.equal(create(L, { id: 'n', t0: 500, t1: 900 }, { dur: D }), null);
  assert.equal(create(L, { id: 'n', t0: 3500, t1: 3550 }, { dur: D, minLen: 100 }), null);
});

test('move clamps, snaps, pushes', () => {
  assert.equal(ids(move(L, ['c'], -5000, { dur: D }).list), 'a:0-1000 b:1000-3000 c:3000-4000');
  const r = move(L, ['c'], 1990, { dur: D, targets: snapTargets([8000]), tol: 50 });
  assert.equal(r.dt, 2000); assert.equal(r.snap.t, 8000);
  assert.equal(ids(move(L, ['b'], 2500, { dur: D, push: true }).list), 'a:0-1000 b:3500-5500 c:5500-6500');
  assert.equal(ids(move(L, ['c'], -1500, { dur: D, push: true }).list), 'a:0-1000 b:1000-3000 c:3500-4500');
  const L2 = [{ id: 'a', t0: 1000, t1: 2000 }, { id: 'b', t0: 2000, t1: 3000 }, { id: 'c', t0: 5000, t1: 6000 }];
  assert.equal(ids(move(L2, ['c'], -4500, { dur: D, push: true }).list), 'a:0-1000 b:1000-2000 c:2000-3000');
  const far = move(L2, ['b'], -9999, { dur: D, push: true });   // can only push a back to 0
  assert.equal(far.dt, -1000);
  assert.equal(ids(move(L, ['a', 'c'], 300, { dur: D }).list), ids(L));   // a is blocked by b
});

test('resize: roll, clamp, push, min length', () => {
  assert.equal(ids(resize(L, 'b', 't0', 600, { dur: D, minLen: 100 }).list), 'a:0-600 b:600-3000 c:5000-6000');
  assert.equal(ids(resize(L, 'b', 't0', 600, { dur: D, mode: 'clamp' }).list), ids(L));
  assert.equal(ids(resize(L, 'b', 't0', 20, { dur: D, minLen: 100 }).list), 'a:0-100 b:100-3000 c:5000-6000');
  assert.equal(ids(resize(L, 'b', 't1', 9000, { dur: D }).list), 'a:0-1000 b:1000-5000 c:5000-6000');
  assert.equal(ids(resize(L, 'b', 't1', 5500, { dur: D, mode: 'push' }).list), 'a:0-1000 b:1000-5500 c:5500-6500');
  assert.equal(ids(resize(L, 'c', 't1', 5010, { dur: D, minLen: 100 }).list), 'a:0-1000 b:1000-3000 c:5000-5100');
});

test('split, merge, duplicate, remove', () => {
  assert.equal(ids(split(L, 'b', 2000, { newId: 'b2' })), 'a:0-1000 b:1000-2000 b2:2000-3000 c:5000-6000');
  assert.equal(split(L, 'b', 1010, { minLen: 100, newId: 'x' }), null);
  assert.equal(ids(merge(L, ['b', 'c']).list), 'a:0-1000 b:1000-6000');
  assert.equal(merge(L, ['a', 'c']), null);   // b sits between them
  let n = 0;
  const d = duplicate(L, ['a', 'b'], { dur: D, newId: () => 'd' + n++ });
  assert.equal(ids(d.list), 'a:0-1000 b:1000-3000 d0:3000-4000 d1:4000-6000 c:6000-7000');
  assert.equal(duplicate(L, ['c'], { dur: 6500, newId: () => 'z' }), null);
  assert.equal(ids(remove(L, ['b'])), 'a:0-1000 c:5000-6000');
});

// property test: any sequence of random edits keeps the invariant
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }
test('random edit sequences keep sorted, non-overlapping, in-bounds, min-length intervals', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed), dur = 20000 + Math.floor(r() * 50000), minLen = 1 + Math.floor(r() * 300);
    let list = [], k = 0;
    const T = snapTargets(Array.from({ length: 10 }, () => Math.floor(r() * dur)));
    for (let step = 0; step < 60; step++) {
      const op = Math.floor(r() * 8), pick = () => list[Math.floor(r() * list.length)]?.id, t = Math.floor(r() * dur);
      let next = null;
      if (op === 0 || !list.length) next = create(list, { id: 'i' + k++, t0: t, t1: t + (r() - 0.3) * 10000 }, { dur, minLen });
      else if (op === 1) next = move(list, [pick(), pick()], (r() - 0.5) * 20000, { dur, push: r() < 0.5, targets: T, tol: 200, frameMs: r() < 0.5 ? 1000 / 30 : 0 }).list;
      else if (op === 2) next = resize(list, pick(), r() < 0.5 ? 't0' : 't1', t, { dur, minLen, mode: ['roll', 'clamp', 'push'][Math.floor(r() * 3)], targets: T, tol: 200, frameMs: 1000 / 24 }).list;
      else if (op === 3) next = split(list, pick(), t, { minLen, newId: 'i' + k++ });
      else if (op === 4) next = merge(list, [pick(), pick(), pick()])?.list;
      else if (op === 5) next = duplicate(list, [pick()], { dur, newId: () => 'i' + k++ })?.list;
      else if (op === 6) next = remove(list, [pick()]);
      else next = move(list, [pick()], (r() - 0.5) * 3000, { dur }).list;
      if (next) {
        // moves/resizes never shrink below minLen; merges and creates respect it too
        assert.ok(isValidIntervals(next, dur, 1), `seed ${seed} step ${step} op ${op}: ${ids(next)}`);
        assert.ok(next.every((x) => x.t1 - x.t0 >= minLen), `seed ${seed} step ${step} op ${op} minLen ${minLen}: ${ids(next)}`);
        list = next;
      }
    }
  }
});

test('repairIntervals restores the invariant on loaded lists (zero-length, overlap, order)', async () => {
  const { repairIntervals } = await import('../src/features/timeline/intervals.js');
  const ok = [{ id: 'a', t0: 0, t1: 10 }, { id: 'b', t0: 10, t1: 20 }];
  assert.equal(repairIntervals(ok).list, ok, 'valid input comes back untouched');
  const bad = [{ id: 'z', t0: 1000, t1: 1000 }, { id: 'p', t0: 500, t1: 4000 }, { id: 'o', t0: 2000, t1: 6000 }, { id: 'in', t0: 2500, t1: 3000 }, { id: 'w', t0: 7000, t1: 7000 }, { id: 'n', t0: NaN, t1: 5 }];
  const r = repairIntervals(bad);
  assert.equal(ids(r.list), 'p:500-4000 o:4000-6000');
  assert.equal(r.dropped, 4); assert.equal(r.trimmed, 1);
  assert.ok(isValidIntervals(r.list));
  assert.deepEqual(repairIntervals(null), { list: [], dropped: 0, trimmed: 0 });
});
