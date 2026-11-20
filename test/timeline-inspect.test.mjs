// The Inspector panel's selection -> body mapping (src/features/timeline/inspect.js): the last touched selection
// wins while it is set, else priority effect > plan > loop > action region > scene > run; nothing set -> null (the hint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORDER, LANE_KIND, setKinds, touched, inspectKind } from '../src/features/timeline/inspect.js';

const none = { fx: null, plan: [], loop: null, act: null, scene: -1, run: null };
const all = { fx: 'fx1', plan: ['s1'], loop: 'lp1', act: 'ar1', scene: 2, run: 'r1' };   // act: paw-2lp7.5, an action region

test('priority when several are set and nothing was touched', () => {
  assert.equal(inspectKind(none, null), null);
  assert.equal(inspectKind(all, null), 'fx');
  assert.equal(inspectKind({ ...all, fx: null }, null), 'plan');
  assert.equal(inspectKind({ ...all, fx: null, plan: [] }, null), 'loop');
  assert.equal(inspectKind({ ...none, marker: 'bm1', scene: 0, run: 'r1' }, null), 'scene', 'paw-qbvj: no bookmark kind (bookmarks have no UI)');
  assert.equal(inspectKind({ ...none, scene: 0, run: 'r1' }, null), 'scene');
  assert.equal(inspectKind({ ...none, act: 'ar1', scene: 0 }, null), 'act', 'a selected action region before a shot');
  assert.equal(inspectKind({ ...none, run: 'r1' }, null), 'run');
  assert.deepEqual(setKinds(all), ORDER);
  assert.deepEqual(setKinds({ ...none, scene: 0 }), ['scene'], 'scene 0 counts');
});

test('the last touched selection wins while it is still set', () => {
  assert.equal(inspectKind(all, 'scene'), 'scene');
  assert.equal(inspectKind({ ...all, scene: -1 }, 'scene'), 'fx', 'cleared -> back to priority');
  assert.equal(inspectKind(none, 'fx'), null);
});

test('touched: the kinds that changed to a set value, by priority', () => {
  assert.deepEqual(touched(null, { ...none, scene: 1, run: 'r1' }), ['scene', 'run'], 'first look = priority');
  const a = { ...none, fx: 'fx1', scene: 1 };
  assert.deepEqual(touched(a, { ...a }), [], 'same values, new object');
  assert.deepEqual(touched(a, { ...a, scene: 3 }), ['scene'], 'a scene click after an effect');
  assert.deepEqual(touched(a, { ...a, fx: null }), [], 'clearing is not a touch');
  assert.deepEqual(touched({ ...a, plan: ['s1'] }, { ...a, plan: ['s1', 's2'] }), ['plan'], 'a grown plan selection');
  assert.deepEqual(touched(a, { ...a, scene: 2, fx: 'fx2' }), ['fx', 'scene'], 'same tick: priority');
});

test('a press in a lane names its kind', () => {
  assert.deepEqual(Object.values(LANE_KIND).filter((k) => !ORDER.includes(k)), []);
  assert.equal(LANE_KIND.chapters, undefined, 'no Chapters row (paw-1w0x)');
  assert.equal(LANE_KIND.ruler, undefined);
});
