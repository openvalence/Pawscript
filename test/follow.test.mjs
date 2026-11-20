// paw-rtby: what the machine follows (lib/follow.js): spans put into a script, the span at a time, a running track's trace.
// paw-x7w7: the runs / fills are live in the script itself (test/script-of.test.mjs); followSpans went with Accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followBase, followAt, liveScript } from '../src/lib/follow.js';
import { posAt } from '../src/lib/core/script.js';

const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t <= t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const base = saw(0, 1800, 200, 10, 90);

test('a span equal to the script there changes nothing and is dropped', () => {
  const r = followBase(base, [{ t0: 0, t1: 1800, script: base, kind: 'run' }]);
  assert.equal(r.script, base);
  assert.deepEqual(r.spans, []);
});

test('the live trace of a running track goes in; followAt finds it', () => {
  const live = { t: [3200, 3300, 3400, 3500], v: [0.2, NaN, 0.8, 0.4] };
  const ls = liveScript(live);
  assert.deepEqual(ls, [{ at: 3200, pos: 20 }, { at: 3400, pos: 80 }, { at: 3500, pos: 40 }]);
  const r = followBase(base, [{ t0: 3200, t1: 3500, script: ls, kind: 'live' }]);
  assert.equal(posAt(r.script, 3400), 80);
  assert.equal(followAt(r.spans, 3300).kind, 'live');
  assert.equal(followAt(r.spans, 1000), null);
  for (const t of [100, 900, 1500]) assert.equal(posAt(r.script, t), posAt(base, t), 'the script elsewhere at ' + t);
});
