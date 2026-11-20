// The inspector's glue to the UI kit: op params -> ParamForm schema, scope options, one undo entry per gesture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitSchema, FOLLOW, scopeOptions, SCOPES } from '../src/features/inspector/logic.js';
import { gesture } from '../src/features/inspector/actions.js';
import { normalizeValues } from '../src/ui/kit/params.js';
import { OPS } from '../src/lib/edit/index.js';

const op = (id) => OPS.find((o) => o.id === id);

test('kitSchema maps every catalogue param to a kit ParamForm type', () => {
  for (const o of OPS) {
    const s = kitSchema(o);
    assert.equal(s.length, (o.params ?? []).length, o.id);
    for (const p of s) {
      assert.ok(['int', 'float', 'bool', 'choice'].includes(p.type), `${o.id}.${p.key}: ${p.type}`);
      if (p.type === 'choice') assert.ok(p.choices.length > 0);
      if (p.control === 'slider') assert.ok(Number.isFinite(p.min) && Number.isFinite(p.max) && (p.max - p.min) / p.step <= 400);
    }
    // defaults survive the kit's own coercion unchanged
    const d = normalizeValues(s, {});
    for (const p of s) assert.deepEqual(d[p.key], p.default, `${o.id}.${p.key}`);
  }
});

test('kitSchema adds the follow switch after the playhead param, with the playhead as its default', () => {
  const o = op('stretch');
  const s = kitSchema(o, { follow: true, playheadMs: 4321 });
  const i = s.findIndex((p) => p.key === o.playhead);
  assert.equal(s[i].default, 4321);
  assert.equal(s[i + 1].key, FOLLOW);
  assert.equal(s[i + 1].type, 'bool');
  assert.equal(kitSchema(o).some((p) => p.key === FOLLOW), false);
});

test('scopeOptions mirrors SCOPES with tooltips', () => {
  const o = scopeOptions();
  assert.deepEqual(o.map((x) => x.value), SCOPES.map((s) => s.id));
  assert.ok(o.every((x) => x.label && x.tip));
});

test('gesture: many steps, one history group; a second gesture is a second group', () => {
  const groups = [];
  const app = { begin: (label) => { const g = { label, done: false, commit() { g.done = true; } }; groups.push(g); return g; } };
  const e = gesture(app), seen = [];
  for (let i = 0; i < 5; i++) e.step('Move point', (o) => seen.push(o.coalesce));
  assert.equal(groups.length, 1); assert.equal(e.open, true);
  e.end(); e.end(); // a second end (oncommit after pointerup) is harmless
  assert.equal(groups[0].done, true); assert.equal(e.open, false);
  e.step('Set point position', () => {}); e.end();
  assert.deepEqual(groups.map((g) => g.label), ['Move point', 'Set point position']);
  assert.ok(seen.every((c) => c === false));
  // without begin(): edits coalesce instead
  const flat = gesture({}); let c; flat.step('x', (o) => (c = o.coalesce)); assert.equal(c, true);
});

test('kitSchema: a parenthesised aside leaves the label and joins the hint', () => {
  const op = { id: 'x', params: [{ key: 'tol', label: 'Tolerance (simplify)', type: 'number', min: 0, max: 5, step: 0.1, default: 1, help: 'In position units' }, { key: 'n', label: 'Order', type: 'number', min: 1, max: 5, step: 1, default: 2 }] };
  const s = kitSchema(op);
  assert.equal(s[0].label, 'Tolerance'); assert.equal(s[0].hint, 'Simplify. In position units');
  assert.equal(s[1].label, 'Order'); assert.equal(s[1].hint, undefined);
  for (const o of OPS) for (const p of kitSchema(o)) assert.ok(!/\(/.test(p.label) || !/\)$/.test(p.label), `${o.id}: ${p.label}`);
});
