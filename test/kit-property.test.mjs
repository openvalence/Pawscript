// paw-m3b6 step 5: a property (NumberField / Slider with a default, a ParamForm row, the app's Prop) answers right click with
// Reset to default (<default>), Copy value, Paste value (ui/kit/contextmenu.js property()); a Slider's readout types
// (fields.js typedValue); ParamForm's reset dot and the menu's reset are one function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    const file = fileURLToPath(url), src = () => readFileSync(file, 'utf8');
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: compileModule(src(), { filename: file, generate: 'server' }).js.code };
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: compile(src(), { filename: file, generate: 'server' }).js.code };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    return next(url, ctx);
  },
});
const { propertyEntries, parseValue } = await import('../src/ui/kit/contextmenu.js');
const { typedValue } = await import('../src/ui/kit/fields.js');

// the system clipboard, faked (the app's WebView2 has one; a refusal falls back to the last Copy value)
let board = '', refuse = false;
Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: {
  writeText: async (t) => { if (refuse) throw new Error('no'); board = t; },
  readText: async () => { if (refuse) throw new Error('no'); return board; },
} });

function handle(init) {
  const h = { value: init.value, default: init.default, sets: [], resets: 0, format: init.format, disabled: init.disabled,
    set(v) { h.sets.push(v); h.value = v; } };
  if (init.reset) h.reset = () => { h.resets++; h.value = h.default; };
  return h;
}
const labels = (items) => items.map((i) => i.label + (i.disabled ? ' (off)' : ''));
const run = async (items, label) => items.find((i) => i.label.startsWith(label)).run();

test('entries: Reset to default (<default>) off at the default, Copy value, Paste value; none without a handle', () => {
  assert.deepEqual(propertyEntries(null), []);
  assert.deepEqual(labels(propertyEntries(handle({ value: 60, default: 60, format: (v) => `${v} ms` }))), ['Reset to default (60 ms) (off)', 'Copy value', 'Paste value']);
  assert.deepEqual(labels(propertyEntries(handle({ value: 80, default: 60, format: (v) => `${v} ms` }))), ['Reset to default (60 ms)', 'Copy value', 'Paste value']);
  assert.deepEqual(labels(propertyEntries(handle({ value: 80 }))), ['Copy value', 'Paste value'], 'no default: no reset');
  assert.deepEqual(labels(propertyEntries(handle({ value: 80, default: 60, disabled: true }))), ['Reset to default (60) (off)', 'Copy value', 'Paste value (off)']);
  const more = { ...handle({ value: true, default: false }), more: () => [{ label: 'Show in Settings' }] };
  assert.deepEqual(labels(propertyEntries(more)), ['Reset to default (false)', 'Copy value', 'Paste value', 'Show in Settings']);
});

test('reset: the handle’s own reset when it has one (ParamForm, Prop), else set(default)', async () => {
  const a = handle({ value: 80, default: 60 });
  await run(propertyEntries(a), 'Reset');
  assert.deepEqual(a.sets, [60]);
  const b = handle({ value: 80, default: 60, reset: true });
  await run(propertyEntries(b), 'Reset');
  assert.equal(b.resets, 1);
  assert.deepEqual(b.sets, []);
});

test('copy then paste: through the system clipboard, parsed to the kind of value; refused: the last copied value', async () => {
  refuse = false;
  const a = handle({ value: 42.5, default: 0 }), b = handle({ value: 3, default: 0 });
  await run(propertyEntries(a), 'Copy');
  assert.equal(board, '42.5');
  await run(propertyEntries(b), 'Paste');
  assert.deepEqual(b.sets, [42.5]);
  board = '40 ms';
  await run(propertyEntries(b), 'Paste');
  assert.deepEqual(b.sets, [42.5, 40], 'a unit after the number is dropped');
  board = 'nonsense';
  await run(propertyEntries(b), 'Paste');
  assert.deepEqual(b.sets, [42.5, 40, 42.5], 'unreadable text: the last value copied');
  refuse = true;
  const c = handle({ value: 1, default: 0 });
  await run(propertyEntries(c), 'Paste');
  assert.deepEqual(c.sets, [42.5], 'no clipboard permission: the last value copied');
  refuse = false;
  const sw = handle({ value: false, default: true });
  board = 'true';
  await run(propertyEntries(sw), 'Paste');
  assert.deepEqual(sw.sets, [true]);
  const same = handle({ value: 7, default: 0 });
  board = '7';
  await run(propertyEntries(same), 'Paste');
  assert.deepEqual(same.sets, [], 'pasting the same value is no gesture');
});

test('parseValue: numbers (comma, unit), booleans, strings, JSON; a parse of the field’s own wins', () => {
  assert.equal(parseValue('1,5', 0), 1.5);
  assert.equal(parseValue('-2', 0), -2);
  assert.equal(parseValue('x', 0), undefined);
  assert.equal(parseValue('', 0), undefined, 'an empty clipboard is no value, not 0');
  assert.equal(parseValue('  ', 'box'), undefined);
  assert.equal(parseValue('on', false), true);
  assert.equal(parseValue('off', true), false);
  assert.equal(parseValue('maybe', true), undefined);
  assert.equal(parseValue(' pan ', 'box'), 'pan');
  assert.deepEqual(parseValue('[0,100]', [1, 2]), [0, 100]);
  assert.equal(parseValue('12', 0, (t) => Number(t) * 2), 24);
});

test('a Slider’s typed readout: parsed, clamped, snapped; unreadable text changes nothing (NaN)', () => {
  const b = { min: 0, max: 100, step: 5 };
  assert.equal(typedValue('42', b), 40);
  assert.equal(typedValue('43', b), 45);
  assert.equal(typedValue('250', b), 100);
  assert.equal(typedValue('-3', b), 0);
  assert.equal(typedValue('62,5 %', { min: 0, max: 100, step: 0.5 }), 62.5);
  assert.ok(Number.isNaN(typedValue('abc', b)));
  assert.equal(typedValue('170 cm', { min: 120, max: 220, step: 1 }), 170);
});

test('ParamForm: the reset dot and the right click run one reset; NumberField and Slider take a default; Slider types', () => {
  const pf = readFileSync(new URL('../src/ui/kit/ParamForm.svelte', import.meta.url), 'utf8');
  assert.match(pf, /onclick=\{resetOf\(p\)\}/);
  assert.match(pf, /reset: resetOf\(p\)/);
  for (const f of ['NumberField', 'Slider']) {
    const s = readFileSync(new URL(`../src/ui/kit/${f}.svelte`, import.meta.url), 'utf8');
    assert.match(s, /default: dflt/, f);
    assert.match(s, /property\(\(\) => \(\{/, f);
  }
  const sl = readFileSync(new URL('../src/ui/kit/Slider.svelte', import.meta.url), 'utf8');
  assert.match(sl, /onclick=\{startTyping\}/);
  assert.match(sl, /typedValue\(text/);
});
