// The fields family's pure parts: slider ticks and pixel mapping, range constraints, reserved widths, grid keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickValues, thumbLeft, valueAt, setRange, nearestThumb, numberChars, displayDecimals, gridMove } from '../src/ui/kit/fields.js';

test('tickValues: array, count, every step, too dense', () => {
  assert.deepEqual(tickValues([0, 50, 120], { min: 0, max: 100 }), [0, 50]);
  assert.deepEqual(tickValues(5, { min: 0, max: 1 }), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(tickValues(true, { min: 0, max: 1, step: 0.25 }), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(tickValues(true, { min: 0, max: 1000, step: 1 }), [0, 1000]);
  assert.deepEqual(tickValues(false), []);
});

test('thumbLeft / valueAt: the thumb travels inside the track, whole pixels, round trip', () => {
  assert.equal(thumbLeft(0, 209, 9), 0);
  assert.equal(thumbLeft(1, 209, 9), 200);
  assert.equal(thumbLeft(0.333, 209, 9), 67);
  assert.equal(valueAt(4.5, 209, 9, { min: 0, max: 100 }), 0);
  assert.equal(valueAt(204.5, 209, 9, { min: 0, max: 100 }), 100);
  assert.equal(valueAt(104.5, 209, 9, { min: 0, max: 100 }), 50);
  assert.equal(valueAt(-50, 209, 9, { min: 0, max: 100 }), 0);
  assert.equal(valueAt(999, 209, 9, { min: 0, max: 100, step: 5 }), 100);
});

test('setRange: thumbs never cross and keep minGap', () => {
  const o = { min: 0, max: 100, minGap: 10 };
  assert.deepEqual(setRange([20, 60], 0, 55, o), [50, 60]);
  assert.deepEqual(setRange([20, 60], 1, 5, o), [20, 30]);
  assert.deepEqual(setRange([20, 60], 1, 500, o), [20, 100]);
  assert.deepEqual(setRange([20, 60], 0, -5, o), [0, 60]);
});

test('nearestThumb: nearer wins; ties go by side', () => {
  assert.equal(nearestThumb([20, 60], 30), 0);
  assert.equal(nearestThumb([20, 60], 50), 1);
  assert.equal(nearestThumb([40, 40], 30), 0);
  assert.equal(nearestThumb([40, 40], 50), 1);
});

test('numberChars and displayDecimals', () => {
  assert.equal(numberChars({ min: -1000, max: 1000, step: 1 }), 5);
  assert.equal(numberChars({ min: 0, max: 4, step: 0.05 }), 4);
  assert.equal(numberChars({ min: 0 }), 6);
  assert.equal(displayDecimals(12, 1), 0);
  assert.equal(displayDecimals(12.1, 1), 1);
  assert.equal(displayDecimals(12.123, 0.1), 2);
  assert.equal(displayDecimals(12.1, 1, 3), 3);
});

test('gridMove: 2D arrows inside the grid, Home/End in the row, others pass', () => {
  assert.equal(gridMove(0, 'ArrowRight', 5, 10), 1);
  assert.equal(gridMove(0, 'ArrowLeft', 5, 10), 0);
  assert.equal(gridMove(2, 'ArrowDown', 5, 10), 7);
  assert.equal(gridMove(7, 'ArrowDown', 5, 10), 7);
  assert.equal(gridMove(7, 'ArrowUp', 5, 10), 2);
  assert.equal(gridMove(7, 'Home', 5, 10), 5);
  assert.equal(gridMove(6, 'End', 5, 8), 7);
  assert.equal(gridMove(3, 'a', 5, 10), null);
});

test('tidy: trims the float noise of a fine step, keeps a min-offset grid', async () => {
  const { tidy } = await import('../src/ui/kit/fields.js');
  assert.equal(tidy(3.4550000000000005, { min: 0.05, step: 0.05 }), 3.455);
  assert.equal(tidy(1.05, { min: 0.05, step: 1 }), 1.05);
  assert.equal(tidy(NaN), NaN);
});
