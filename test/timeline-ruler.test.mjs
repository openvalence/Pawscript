import assert from 'node:assert/strict';
import test from 'node:test';
import { hitRuler, dragRange, markAt } from '../src/features/timeline/ruler.js';

const view = { start: 0, span: 10000 }, w = 1000, range = { t0: 2000, t1: 4000 };   // x 200..400
const none = { targets: [], tol: 0, frameMs: 0 };

test('hit testing', () => {
  const h = (x, y, r = range, shift) => hitRuler({ view, w, x, y, range: r, shift });
  assert.equal(h(300, 5), 'scrub');
  assert.equal(h(300, 5, range, true), 'new');
  assert.equal(h(300, 20), 'move');
  assert.equal(h(203, 20), 't0');
  assert.equal(h(398, 20), 't1');
  assert.equal(h(600, 20), 'new');
  assert.equal(h(300, 20, null), 'new');
});

test('range drags', () => {
  assert.deepEqual(dragRange('new', null, 5000, 3000, none, 10000).range, { t0: 3000, t1: 5000 });
  assert.deepEqual(dragRange('t0', range, 0, 5000, none, 10000).range, { t0: 4000, t1: 5000 });
  assert.deepEqual(dragRange('move', range, 3000, 1000, none, 10000).range, { t0: 0, t1: 2000 });   // clamped at 0
  const sc = { targets: [{ t: 3010, label: 'cut' }], tol: 50, frameMs: 40 };
  const r = dragRange('t1', range, 0, 3000, sc, 10000);
  assert.equal(r.range.t1, 3010); assert.equal(r.snap.label, 'cut');
});

test('markAt', () => {
  assert.equal(markAt(1005, 20, [1000], []), 'Cut');
  assert.equal(markAt(1005, 20, [{ t: 1000, text: 'camera move (zoom), not a cut' }], []), 'Camera move (zoom), not a cut', 'paw-p2p0');
  assert.equal(markAt(500, 20, [1000], [{ at: 500, note: 'x' }]), null, 'paw-qbvj: bookmarks have no UI: the hover never names one');
  assert.equal(markAt(700, 20, [1000], []), null);
});
