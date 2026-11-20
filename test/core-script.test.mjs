import assert from 'node:assert/strict';
import * as S from '../src/lib/core/script.js';

const s = S.normalize([{ at: 300.4, pos: 120 }, { at: 100, pos: 10 }, { at: 100, pos: 20 }, { at: -5, pos: 1 }, { at: 200, pos: NaN }]);
assert.deepEqual(s, [{ at: 100, pos: 20 }, { at: 300, pos: 100 }]); // sorted, later wins, clamped, bad dropped
assert.ok(S.isValid(s) && !S.isValid([{ at: 1, pos: 1 }, { at: 1, pos: 2 }]));

const a = [{ at: 0, pos: 0 }, { at: 100, pos: 100 }, { at: 200, pos: 50 }];
assert.equal(S.lowerBound(a, 100), 1); assert.equal(S.lowerBound(a, 101), 2); assert.equal(S.lowerBound(a, 999), 3);
assert.equal(S.indexAt(a, 100), 1); assert.equal(S.indexAt(a, 99), -1);
assert.equal(S.nearest(a, 120, 30), 1); assert.equal(S.nearest(a, 150, 10), -1); assert.equal(S.nearest([], 5), -1);
assert.equal(S.posAt(a, 50), 50); assert.equal(S.posAt(a, -10), 0); assert.equal(S.posAt(a, 500), 50); assert.ok(Number.isNaN(S.posAt([], 0)));
assert.deepEqual(S.slice(a, 100, 200).map((x) => x.at), [100, 200]);
assert.deepEqual(S.rangeIndices(a, 50, 150), [1, 2]);
assert.deepEqual(S.upsert(a, [{ at: 100, pos: 5 }, { at: 150, pos: 7 }]).map((x) => x.pos), [0, 5, 7, 50]);
assert.deepEqual(S.removeAt(a, [100]).length, 2); assert.deepEqual(S.removeRange(a, 50, 250).length, 1);
assert.deepEqual(S.replaceRange(a, 50, 250, [{ at: 120, pos: 9 }]), [{ at: 0, pos: 0 }, { at: 120, pos: 9 }]);
assert.deepEqual(S.speeds(a), [0, 1000, 500]);
assert.equal(a.length, 3); // inputs never mutated
console.log('core-script ok');
