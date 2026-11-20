// paw-ef73.31: a selected modifier run's Tracker row shows only what applies to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowControls, measureText } from '../src/features/tracking/row-controls.js';

const ch = (v) => ({ t: v.map((_, i) => i * 33), v });

test('a shot run keeps the shot controls; a modifier run gets its own', () => {
  const shot = rowControls({ id: 'r1', tracker: 'sam2_mask' });
  for (const c of ['source', 'pair', 'against', 'baseline', 'flips']) assert.ok(shot.includes(c), c);
  assert.ok(!shot.includes('retrack'));
  assert.deepEqual(rowControls({ id: 'r2', mod: 'fx1', tracker: 'sam2_mask' }), ['modifier', 'measure', 'correct', 'retrack', 'delete']);
  assert.deepEqual(rowControls({ id: 'r3', mod: 'fx1', tracker: 'tapnext_points' }), ['modifier', 'measure', 'retrack', 'delete']);
  assert.ok(rowControls(null).includes('source'));
});

test('the measure in words: inside, else area, else nothing', () => {
  assert.equal(measureText({ modGroups: ['shaft'], channels: { sem_shaft_in: ch([0.2, 0.5]), sem_shaft_in_conf: ch([0.9, 0.9]) } }), 'inside · shaft');
  assert.equal(measureText({ modGroups: ['balls'], channels: { sem_balls_vis: ch([1, 2]) } }), 'area · balls');
  assert.equal(measureText({ modGroups: ['x'], channels: {} }), 'no measure');
});
