// paw-oben: the kit Splitter (timeline row splitters, the machine preview width, Areas borders) is an editor item: a press
// selects it and the plain arrows, which the key guard keeps from its keydown, reach it through the key map
// (app/editor-commands.js -> ui/kit/editor-item.svelte.js). Without it the arrows never resize a splitter (paw-oben: rowsplit
// aria-valuenow 44 -> 44).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules') || !url.endsWith('.svelte.js')) return next(url, ctx);
    const file = fileURLToPath(url);
    return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(file, 'utf8'), { filename: file, generate: 'server' }).js.code };
  },
});
const { editorItem, editorSelection } = await import('../src/ui/kit/editor-item.svelte.js');
const src = readFileSync(new URL('../src/ui/kit/Splitter.svelte', import.meta.url), 'utf8');

test('paw-oben: the Splitter attaches editorItem and a press focuses it (prevented, the press alone would not)', () => {
  assert.match(src, /\{@attach editorItem\(nudge\)\}/);
  const down = src.slice(src.indexOf('function down('), src.indexOf('function move('));
  assert.match(down, /preventDefault\(\)/);
  assert.match(down, /\.focus\(\{ preventScroll: true \}\)/, 'the press makes it the editor selection');
  const up = src.slice(src.indexOf('function up('), src.indexOf('function stepBy('));
  assert.match(up, /if \(moved\) \{[^}]*\.blur\?\.\(\)/, 'a resize drag lets go of it again (the arrows step frames after a drag)');
});

test('paw-oben: the Splitter nudge maps the key map\'s dx / dy onto its own axis', () => {
  // the nudge factory as written in the component, run against a stub stepBy
  const body = src.match(/const nudge = \(\) => (\(\{[^\n]+\}\));/)?.[1];
  assert.ok(body, 'nudge() is declared');
  const make = (vertical) => { const steps = []; const stepBy = (dir, big) => steps.push([dir, big]); const disabled = false;
    return { item: new Function('vertical', 'disabled', 'stepBy', `return ${body}`)(vertical, disabled, stepBy), steps }; };
  const v = make(true); v.item.nudge(1, 0, false); v.item.nudge(-1, 0, true); v.item.nudge(0, 1, false);
  assert.deepEqual(v.steps, [[1, false], [-1, true]], 'between columns: left / right only');
  const h = make(false); h.item.nudge(0, -1, false); h.item.nudge(0, 1, false); h.item.nudge(1, 0, false);
  assert.deepEqual(h.steps, [[1, false], [-1, false]], 'between rows: ArrowDown (dy -1) grows the pane above, ArrowUp shrinks it');
});

test('paw-oben: a focused editorItem element is the editor selection until blurred; Esc (drop) blurs it', () => {
  const ls = {}, el = { dataset: {}, ownerDocument: { activeElement: null }, addEventListener: (k, f) => (ls[k] = f), removeEventListener: () => {}, blur() { this.blurred = true; ls.blur?.(); } };
  const got = [];
  const off = editorItem(() => ({ nudge: (dx, dy) => got.push([dx, dy]) }))(el);
  assert.equal(editorSelection({}), null);
  ls.focus();
  editorSelection({}).nudge(0, -1, false);
  assert.deepEqual(got, [[0, -1]]);
  editorSelection({}).drop();
  assert.ok(el.blurred && editorSelection({}) === null);
  off();
});
