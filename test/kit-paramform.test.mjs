// ParamForm's pure rules: which widget a param gets, and the value comparison behind write-back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlOf, sameValues, numberColumnChars } from '../src/ui/kit/paramform.js';

test('numberColumnChars: widest slider value + unit (+1 gap), sliders only, 0 without sliders', () => {
  assert.equal(numberColumnChars([]), 0);
  assert.equal(numberColumnChars([{ type: 'int', min: -5000, max: 5000 }]), 0); // a plain number field: own column
  assert.equal(numberColumnChars([{ type: 'int', min: 0, max: 100, control: 'slider' }]), 3);
  assert.equal(numberColumnChars([{ type: 'int', min: 0, max: 100, unit: '%', control: 'slider' }]), 5);
  assert.equal(numberColumnChars([{ type: 'float', min: 0, max: 1, step: 0.01, control: 'slider' }]), 4);
  // the widest of the form wins, unit included: 0.00 (4) vs 300.0 bpm (5 + 4)
  assert.equal(numberColumnChars([
    { type: 'float', min: 0, max: 1, step: 0.01, control: 'slider' },
    { type: 'float', min: 20, max: 300, step: 0.5, unit: 'bpm', control: 'slider' },
  ]), 9);
  // no min/max: the NumberField's own fallback width (numberChars: 6)
  assert.equal(numberColumnChars([{ type: 'float', control: 'slider' }]), 6);
});

test('controlOf: numbers, bools, explicit controls', () => {
  assert.equal(controlOf({ type: 'float' }), 'number');
  assert.equal(controlOf({ type: 'int', control: 'slider' }), 'slider');
  assert.equal(controlOf({ type: 'bool' }), 'switch');
  assert.equal(controlOf({ type: 'choice', choices: ['a', 'b'], control: 'select' }), 'select');
  assert.equal(controlOf({ type: 'choice', choices: ['a', 'b', 'c', 'd', 'e'], control: 'segmented' }), 'segmented');
});

test('controlOf: 2-3 choices with choices x longest label <= 10 auto-segment, anything else is a Select', () => {
  assert.equal(controlOf({ type: 'choice', choices: ['L0', 'R0', 'R1'] }), 'segmented');
  assert.equal(controlOf({ type: 'choice', choices: ['off', 'low', 'high'] }), 'select');
  assert.equal(controlOf({ type: 'choice', choices: [{ value: 0, label: 'Left' }, { value: 1, label: 'Right' }] }), 'segmented');
  assert.equal(controlOf({ type: 'choice', choices: ['off', 'light', 'strong'] }), 'select');
  assert.equal(controlOf({ type: 'choice', choices: ['sine', 'saw', 'square', 'bounce'] }), 'select');
  assert.equal(controlOf({ type: 'choice', choices: [{ value: 1, label: 'Whole script' }, { value: 2, label: 'Selection' }] }), 'select');
  assert.equal(controlOf({ type: 'choice', choices: ['only'] }), 'select');
});

test('sameValues: keys and values, by identity', () => {
  assert.ok(sameValues({ a: 1, b: NaN }, { b: NaN, a: 1 }));
  assert.ok(!sameValues({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!sameValues({ a: 0 }, { a: -0 }));
});
