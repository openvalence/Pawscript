// paw-0zfa: Shift+Z's "view before" was one module-level value for every tab: Shift+Z in tab A, then twice in tab B, took B
// back to A's view (possibly past B's end). Each app (tab) keeps its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';

const noGlob = (s) => s.replace(/import\.meta\.glob\(/g, '((..._) => ({}))(');
registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    const file = fileURLToPath(url), src = () => readFileSync(file, 'utf8');
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: noGlob(compileModule(src(), { filename: file, generate: 'server' }).js.code) };
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: noGlob(compile(src(), { filename: file, generate: 'server' }).js.code) };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (url.endsWith('.json')) return { format: 'module', shortCircuit: true, source: 'export default ' + src() };
    if (url.endsWith('.js') && src().includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: noGlob(src()) };
    return next(url, ctx);
  },
});
const { zoomFrames } = await import('../src/features/timeline/commands-view.js');

const mkApp = (view) => ({ view, player: { frameMs: 1000 / 30, timeMs: view.start + view.span / 2 }, setView(v) { this.view = v; } });

test('paw-0zfa: each tab returns to its own view', () => {
  const A = mkApp({ start: 0, span: 600000 }), B = mkApp({ start: 5000, span: 20000 });
  zoomFrames(A);   // A zoomed in to frames
  zoomFrames(B);   // B zoomed in to frames
  zoomFrames(B);   // B back
  assert.deepEqual(B.view, { start: 5000, span: 20000 }, 'B returns to its own view, not A\'s');
  zoomFrames(A);
  assert.deepEqual(A.view, { start: 0, span: 600000 });
});
