// Label plates on the video canvas follow the theme's ground (src/features/tracking/plate.js, paw-098).
import test from 'node:test';
import assert from 'node:assert/strict';
import { plate, brightness } from '../src/features/tracking/plate.js';

test('a light ground gets a light plate, a dark one (or an unreadable one) the dark plate', () => {
  assert.equal(plate(0.8, '#F4F5F7'), 'rgba(246, 247, 249, 0.8)');
  assert.equal(plate(0.5, 'rgb(250, 250, 250)'), 'rgba(246, 247, 249, 0.5)');
  assert.equal(plate(0.8, '#08090B'), 'rgba(8, 9, 11, 0.8)');
  assert.equal(plate(0.8, '#fff'), 'rgba(246, 247, 249, 0.8)');
  assert.ok(Number.isNaN(brightness('var(--bg)')));   // no document here: the token stays unresolved
  assert.equal(plate(), 'rgba(8, 9, 11, 0.8)');
});
