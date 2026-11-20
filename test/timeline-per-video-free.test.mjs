// paw-gw8y: the repeated-frames and fades results were kept per video path for the whole session (closing a tab freed nothing),
// and the selected / hovered fade was one module-level value shared by every tab.
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
const R = await import('../src/features/timeline/repeats.svelte.js');
const T = await import('../src/features/timeline/transitions.svelte.js');

const raw = { frames: 300, buckets: [], transitions: [{ kind: 'fade-in', ts: 1000, tm: 1100, t1: 1300, f0: 30, f1: 39 }] };
const tabs = { apps: [] };
const backend = { frameRepeats: () => ({ promise: Promise.resolve(raw), cancel() {} }) };
const mkApp = (path) => {
  const a = { tabs, backend, cleanups: [], doc: { media: { path, durationMs: 10000 }, repeats: {} }, durationMs: 10000, player: { frameMs: 1000 / 30, snap: (t) => t, seek() {} },
    settings: { get: (k, d) => d }, transact(l, f) { f(); }, toast() {}, usage: null };
  tabs.apps.push(a);
  return a;
};
const close = (a) => { tabs.apps = tabs.apps.filter((x) => x !== a); for (const f of a.cleanups.splice(0)) f(); };
const settle = () => new Promise((r) => setTimeout(r, 0));

test('paw-gw8y: a closed tab\'s video results go; a video another tab still holds keeps them', async () => {
  const A = mkApp('a.mp4'), B = mkApp('b.mp4'), B2 = mkApp('b.mp4');
  R.loadRepeats(A); await settle();
  R.loadRepeats(B); await settle();
  assert.ok(R.repeatsOf(A) && R.repeatsOf(B), 'both videos read');
  assert.equal(T.transitionsOf(A).length, 1);
  close(A);
  const again = mkApp('a.mp4');
  assert.equal(R.repeatsOf(again), null, 'a.mp4 freed when the only tab holding it closed');
  assert.equal(T.transitionsOf(again).length, 0, 'its fades too');
  close(B);
  assert.ok(R.repeatsOf(B2), 'b.mp4 kept: another tab holds it');
  close(again); close(B2);
});

test('paw-gw8y: the selected fade is each tab\'s own', async () => {
  const A = mkApp('c.mp4'), B = mkApp('c.mp4');
  R.loadRepeats(A); await settle();
  const shots = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }];
  assert.ok(T.addFade(A, shots, 1, 'out'), 'a fade made (and selected) in tab A');
  assert.equal(T.fadeSelected(A), true);
  assert.equal(T.fadeSelected(B), false, 'tab B has nothing selected');
  close(A); close(B);
});
