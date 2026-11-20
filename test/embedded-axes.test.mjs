// paw-2pcf: multi-axis funscripts (funlib 1.1 axes[], 2.0 channels{}) load their embedded axes as document axes; a save
// writes them as sibling files and the stroke file drops the copies it gave away (no stale duplicate), keeping the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFunscript } from '../src/lib/io/funscript.js';
import { buildOpenDoc, saveItems } from '../src/app/project-logic.js';

const VIDEO = 'D:\\v\\clip.mp4', A = (at, pos) => ({ at, pos });
const found = (doc, extra = {}) => ({ stroke: { path: 'D:\\v\\clip.funscript', text: JSON.stringify(doc), sha256: 'x', parsed: parseFunscript(doc) }, ...extra });

test('1.1 axes[] by T-code and name: loaded, inverted per axis, unknown and stroke ids left alone', () => {
  const doc = { version: '1.1', actions: [A(0, 0), A(500, 100)], axes: [{ id: 'R1', actions: [A(0, 40), A(500, 60)] }, { id: 'pitch', inverted: true, actions: [A(0, 10)] }, { id: 'Z9', actions: [A(0, 5)] }, { id: 'L0', actions: [A(0, 1)] }] };
  const p = parseFunscript(doc);
  assert.deepEqual(Object.keys(p.embedded).sort(), ['pitch', 'roll']);
  assert.deepEqual(p.embedded.roll, [A(0, 40), A(500, 60)]);
  assert.deepEqual(p.embedded.pitch, [A(0, 90)]);
  const d = buildOpenDoc({ found: found(doc) });
  assert.deepEqual(Object.keys(d.axes).sort(), ['pitch', 'roll', 'stroke']);
  const { items } = saveItems({ ...d, axes: { ...d.axes } }, VIDEO);
  const byAxis = Object.fromEntries(items.map((it) => [it.axis, it]));
  assert.equal(byAxis.roll.path, 'D:\\v\\clip.roll.funscript');
  assert.equal(byAxis.pitch.path, 'D:\\v\\clip.pitch.funscript');
  assert.deepEqual(byAxis.roll.raw.actions, [A(0, 40), A(500, 60)]);
  assert.equal(byAxis.stroke.unchanged, false, 'the stroke file is rewritten once to drop the copies');
  assert.deepEqual(byAxis.stroke.raw.axes.map((x) => x.id), ['Z9', 'L0'], 'unknown entries survive');
});

test('2.0 channels{}: loaded; a sibling file of the same axis wins and the embedded copy stays in the file', () => {
  const doc = { version: '2.0', channels: { stroke: { actions: [A(0, 0), A(400, 100)] }, twist: { actions: [A(0, 20), A(400, 80)] }, sway: { actions: [A(0, 30)] } } };
  const sib = { path: 'D:\\v\\clip.sway.funscript', text: '', sha256: 'y', parsed: parseFunscript({ actions: [A(0, 70)] }) };
  const d = buildOpenDoc({ found: found(doc, { sway: sib }) });
  assert.deepEqual(d.axes.twist, [A(0, 20), A(400, 80)]);
  assert.deepEqual(d.axes.sway, [A(0, 70)], 'the sibling file wins');
  const st = saveItems(d, VIDEO).items.find((it) => it.axis === 'stroke');
  assert.deepEqual(Object.keys(st.raw.channels).sort(), ['stroke', 'sway']);
  assert.ok(st.raw.channels.stroke.actions.length);
});

test('reference mode and a plain file: nothing embedded is loaded, saves unchanged', () => {
  const doc = { actions: [A(0, 0), A(400, 100)], axes: [{ id: 'roll', actions: [A(0, 40)] }] };
  assert.deepEqual(buildOpenDoc({ found: found(doc), mode: 'reference' }).axes, {});
  const plain = buildOpenDoc({ found: found({ actions: [A(0, 0), A(400, 100)] }) });
  assert.deepEqual(Object.keys(plain.axes), ['stroke']);
  assert.equal(saveItems(plain, VIDEO).items[0].unchanged, true);
  assert.deepEqual(parseFunscript({ actions: [A(0, 1)], axes: [{ id: 'roll', actions: 'x' }] }).embedded, {});
});
