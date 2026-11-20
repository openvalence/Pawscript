// The Blender-style modal transform state machine (src/lib/xform.js): G -> X/Y -> typed number -> Enter / Esc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { begin, key, amounts, hint, typedValue } from '../src/lib/xform.js';

const feed = (m, ...keys) => { let done = null; for (const k of keys) ({ m, done } = key(m, k)); return { m, done }; };

test('grab: the mouse moves both ways; X / Y constrain (again frees); Enter confirms', () => {
  let m = { ...begin('grab'), mouse: { dt: 120, dp: 8 } };
  assert.deepEqual(amounts(m), { dt: 120, dp: 8 });
  m = feed(m, 'X').m;
  assert.deepEqual(amounts(m), { dt: 120, dp: 0 });
  m = feed(m, 'Y').m;
  assert.deepEqual(amounts(m), { dt: 0, dp: 8 });
  m = feed(m, 'Y').m;
  assert.equal(m.con, null);
  assert.equal(feed(m, 'Enter').done, 'confirm');
  assert.match(hint(m), /^Grab: dx \+120 ms, dy \+8 \| X\/Y constrain/);
});

test('grab: typed values are exact offsets along the constraint (none = time); minus toggles; Backspace edits', () => {
  const m0 = { ...begin('grab'), mouse: { dt: 33, dp: -4 } };
  assert.deepEqual(amounts(feed(m0, 'Y', '1', '0').m), { dt: 0, dp: 10 }, 'G Y 10 = +10 pos');
  assert.deepEqual(amounts(feed(m0, 'X', '-', '5', '0').m), { dt: -50, dp: 0 }, 'G X -50 = -50 ms');
  assert.deepEqual(amounts(feed(m0, '2', '5').m), { dt: 25, dp: 0 }, 'no constraint: time first, like Blender X');
  const m = feed(m0, 'Y', '1', '2', 'Backspace', '-').m;
  assert.equal(m.typed, '-1');
  assert.deepEqual(amounts(m), { dt: 0, dp: -1 });
  assert.match(hint(m), /\(position only\)  \[-1\]/);
  assert.equal(typedValue(feed(m0, '-').m), null, 'a lone minus is not a value: the mouse still drives');
  assert.deepEqual(amounts(feed(m0, '-').m), { dt: 33, dp: -4 });
  assert.equal(feed(m0, '1', '.', '.', '5').m.typed, '1.5', 'one decimal point');
});

test('Esc cancels from any state; unknown keys change nothing', () => {
  const m = feed(begin('grab'), 'X', '4').m;
  assert.equal(feed(m, 'Escape').done, 'cancel');
  assert.equal(key(m, 'Q').m, m);
  assert.equal(key(m, 'Space').done, null);
});

test('scale: mouse factor, typed factor wins, X does nothing (positions only); intervals grab time only', () => {
  let m = { ...begin('scale'), mouse: { f: 0.5 } };
  assert.deepEqual(amounts(m), { f: 0.5 });
  m = feed(m, 'X', '1', '.', '5').m;
  assert.equal(m.con, 'y');
  assert.deepEqual(amounts(m), { f: 1.5 });
  assert.match(hint(m), /^Scale: ×1\.50  \[1\.5\]/);
  const g = feed({ ...begin('grab', { axes: 'x' }), mouse: { dt: 200, dp: 30 } }, 'Y').m;
  assert.equal(g.con, 'x');
  assert.deepEqual(amounts(g), { dt: 200, dp: 0 });
  assert.match(hint(g, { dt: -40 }), /^Grab: dt −40 ms/);
});
