// Regression: a param scrub released on its start value must not leave an undo group open (editor/paramgesture.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParamGesture, endOnRelease } from '../src/features/graph/editor/paramgesture.js';

function fakeCtl() {
  const log = [];
  let n = 0;
  return {
    log,
    gesture(label) {
      const id = ++n;
      log.push(['begin', id, label]);
      return { update: () => log.push(['update', id]), commit: () => log.push(['commit', id]), cancel: () => log.push(['cancel', id]) };
    },
    mutate(label) { log.push(['mutate', label]); return ''; },
  };
}
const fn = (g) => g;

test('scrub away and back to the start value, release: the gesture closes (cancelled, nothing recorded)', () => {
  const ctl = fakeCtl(), pg = createParamGesture(ctl);
  pg.change('n1:tol', 'set Tolerance', fn, 4.5, false, 1);
  pg.change('n1:tol', 'set Tolerance', fn, 1, false, 1);
  assert.equal(pg.open, true);
  pg.end();   // pointerup: NumberField sent no commit (value === from)
  assert.equal(pg.open, false);
  assert.deepEqual(ctl.log.filter((e) => e[0] !== 'update'), [['begin', 1, 'set Tolerance'], ['cancel', 1]]);
});

test('scrub that commits closes once; a later release is a no-op', () => {
  const ctl = fakeCtl(), pg = createParamGesture(ctl);
  pg.change('n1:lo', 'set Deep end', fn, 10, false, 0);
  pg.change('n1:lo', 'set Deep end', fn, 29, true, 0);
  pg.end();
  assert.deepEqual(ctl.log.filter((e) => e[0] !== 'update'), [['begin', 1, 'set Deep end'], ['commit', 1]]);
});

test('release off the start value without a commit still commits (key-hold edge)', () => {
  const ctl = fakeCtl(), pg = createParamGesture(ctl);
  pg.change('n1:lo', 'set Deep end', fn, 12, false, 0);
  pg.end();
  assert.deepEqual(ctl.log.at(-1), ['commit', 1]);
});

test('switching field closes the previous gesture; a plain commit is one mutate; pairs compare by value', () => {
  const ctl = fakeCtl(), pg = createParamGesture(ctl);
  pg.change('n1:range', 'set Range', fn, [10, 90], false, [10, 90]);
  pg.change('n2:lo', 'set Deep end', fn, 5, false, 0);
  assert.deepEqual(ctl.log.filter((e) => e[0] === 'cancel' || e[0] === 'commit'), [['cancel', 1]]);
  pg.end();
  pg.change('n1:on', 'set On', fn, true, true, false);
  assert.deepEqual(ctl.log.at(-1), ['mutate', 'set On']);
});

test('endOnRelease closes after pointerup (after the field\'s own handler), and on cleanup', async () => {
  const ctl = fakeCtl(), pg = createParamGesture(ctl), target = new EventTarget();
  const off = endOnRelease(pg, target);
  pg.change('n1:tol', 'set Tolerance', fn, 1, false, 1);
  target.dispatchEvent(new Event('pointerup'));
  assert.equal(pg.open, true, 'deferred: the field commits first');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(pg.open, false);
  pg.change('n1:tol', 'set Tolerance', fn, 3, false, 1);
  off();
  assert.equal(pg.open, false);
  assert.deepEqual(ctl.log.at(-1), ['commit', 2]);
});
