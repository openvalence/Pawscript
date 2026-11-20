// Machine panel: a layered body's layer opacities (src/features/machine/layers.js, paw-mr7f): the defaults (skin and
// skeleton shown, the skin see-through over inner layers), the migration from the first layered Human's booleans, the
// flip between off and the last opacity, reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateLayers, layerOpacities, setOpacity, flipLayer, SKIN_OVER, SKIN_ALONE } from '../src/features/machine/layers.js';

const LIST = [['skin', true], ['skeleton', true], ['colon', false], ['small', false], ['stomach', false], ['bladder', false], ['genitals', false], ['kidneys', false], ['liver', false], ['thorax', false]].map(([id, on]) => ({ id, on }));

test('defaults: skin and skeleton shown, the skin see-through while an inner layer shows', () => {
  const o = layerOpacities({}, LIST);
  assert.equal(o.skeleton, 1); assert.equal(o.colon, 0); assert.equal(o.thorax, 0);
  assert.equal(o.skin, SKIN_OVER);
  const alone = layerOpacities({ op: { skeleton: 0 } }, LIST);
  assert.equal(alone.skin, SKIN_ALONE, 'no inner layer: the usual x-ray opacity');
  assert.deepEqual(layerOpacities(undefined, LIST), o);
  assert.deepEqual(layerOpacities({}, []), {});
});

test('migration from {layer: boolean, skinAlpha}: the old groups split into the new layers', () => {
  const m = migrateLayers({ skin: true, skeleton: false, digestive: true, urogenital: false, organs: true, skinAlpha: 0.2 });
  assert.deepEqual(m.op, { skeleton: 0, colon: 1, small: 1, stomach: 1, bladder: 0, genitals: 0, kidneys: 0, liver: 1, thorax: 1, skin: 0.2 });
  const o = layerOpacities({ digestive: true }, LIST);
  assert.equal(o.colon, 1); assert.equal(o.small, 1); assert.equal(o.skeleton, 1); assert.equal(o.skin, SKIN_OVER);
  assert.equal(layerOpacities({ skin: false }, LIST).skin, 0, 'a hidden skin stays hidden');
  assert.deepEqual(migrateLayers({ op: { colon: 0.6 }, last: { skin: 0.3 } }), { op: { colon: 0.6 }, last: { skin: 0.3 } }, 'the current shape as it is');
});

test('opacity, flip (off and back to the last opacity), reset', () => {
  let s = setOpacity({}, 'colon', 0.6);
  assert.equal(layerOpacities(s, LIST).colon, 0.6);
  s = setOpacity(s, 'skin', 1.4);
  assert.equal(layerOpacities(s, LIST).skin, 1, 'clamped');
  s = flipLayer(s, 'colon', 0.6);
  assert.equal(layerOpacities(s, LIST).colon, 0);
  s = flipLayer(s, 'colon', 0);
  assert.equal(layerOpacities(s, LIST).colon, 0.6, 'back to its last opacity');
  assert.equal(layerOpacities(flipLayer({}, 'thorax', 0), LIST).thorax, 1, 'never set: fully on');
  assert.equal(layerOpacities(flipLayer({ op: { skin: 0 } }, 'skin', 0), LIST).skin, SKIN_OVER, 'the skin comes back see-through');
  assert.deepEqual(layerOpacities({}, LIST), layerOpacities(migrateLayers({}), LIST), 'reset = the defaults');
});
