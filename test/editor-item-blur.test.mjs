// The editor selection (ui/kit/editor-item.svelte.js) is written from an editor item's focus / blur listeners. A focused item
// removed by an {#if} block (the bottom tray folding away a focused splitter, a panel closing on a focused pad) blurs
// synchronously inside Svelte's block effect: when the selection was $state that write threw state_unsafe_mutation (a page
// error in dev/bottom-check.mjs). It is read only at key time (app/editor-commands.js), so it is no reactive state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules') || !url.endsWith('editor-item.svelte.js')) return next(url, ctx);
    const file = fileURLToPath(url);
    return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(file, 'utf8'), { filename: file, generate: 'client' }).js.code };
  },
});
const $ = await import('svelte/internal/client');
const { holdEditorItem, editorSelection } = await import('../src/ui/kit/editor-item.svelte.js');

test('a blur inside a Svelte derived / block effect may drop the editor selection', () => {
  const release = holdEditorItem({ nudge() {} });
  assert.ok(editorSelection({}));
  const d = $.derived(() => { release(); return 1; });   // what a blur during an {#if} teardown does
  assert.doesNotThrow(() => $.get(d));
  assert.equal(editorSelection({}), null);
  const r2 = holdEditorItem({ nudge() {} });
  assert.doesNotThrow(() => $.get($.derived(() => { holdEditorItem({ nudge() {} }); return 2; })), 'a focus there may take it too');
  r2();
});
