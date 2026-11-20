// The overlays family's pure part: the toast store (src/ui/kit/toast.svelte.js). It is a runes module, so it is
// compiled here with Svelte's server target ($state becomes a plain array) and imported from a data: URL.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';

const src = readFileSync(new URL('../src/ui/kit/toast.svelte.js', import.meta.url), 'utf8');
const { code } = compileModule(src, { filename: 'toast.svelte.js', generate: 'server' }).js;
const url = (n) => 'data:text/javascript,' + encodeURIComponent(
  code.replace(/from 'svelte\/internal\/server'/, `from '${import.meta.resolve('svelte/internal/server')}'`) + `\n//${n}`);
let n = 0;
const fresh = () => import(url(++n)); // a new module instance (its own list and timers) per test

test('toast: info times out, bad lives BAD_MS (paw-ky2g: never for ever), timeout 0 stays', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const t = await fresh();
    const a = t.toast('Saved', { kind: 'ok' });
    t.toast('Tracker crashed', { kind: 'bad' });
    t.toast('Pinned', { timeout: 0 });
    assert.equal(t.toasts.length, 3);
    assert.equal(t.toasts[0].id, a);
    mock.timers.tick(3999);
    assert.equal(t.toasts.length, 3);
    mock.timers.tick(1);
    assert.deepEqual(t.toasts.map((x) => x.message), ['Tracker crashed', 'Pinned']);
    mock.timers.tick(t.BAD_MS - 4000 - 1);
    assert.equal(t.toasts.length, 2);
    mock.timers.tick(1);
    assert.deepEqual(t.toasts.map((x) => x.message), ['Pinned']);
  } finally { mock.timers.reset(); }
});

test('toast: pause freezes the countdown and resumes with what was left (at least RESUME_MS)', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const t = await fresh();
    t.toast('a', { timeout: 4000 });
    t.toast('b', { timeout: 2000 });
    mock.timers.tick(1000);
    t.pauseToasts(true);
    t.toast('c', { timeout: 1000 }); // added while paused: not counting yet
    mock.timers.tick(10_000);
    assert.equal(t.toasts.length, 3);
    t.pauseToasts(false);
    mock.timers.tick(1000);  // c never started: its whole 1000; b had 1000 left -> raised to RESUME_MS
    assert.deepEqual(t.toasts.map((x) => x.message), ['a', 'b']);
    mock.timers.tick(t.RESUME_MS - 1000);
    assert.deepEqual(t.toasts.map((x) => x.message), ['a']);
    mock.timers.tick(3000 - t.RESUME_MS);
    assert.equal(t.toasts.length, 0);
  } finally { mock.timers.reset(); }
});

test('toast: over MAX_TOASTS the oldest timed one goes, else the oldest', async () => {
  const t = await fresh();
  t.toast('e1', { timeout: 0 });
  t.toast('i1');
  t.toast('e2', { timeout: 0 });
  t.toast('i2');
  t.toast('i3');
  assert.deepEqual(t.toasts.map((x) => x.message), ['e1', 'e2', 'i2', 'i3']);
  for (const m of ['e3', 'e4', 'e5']) t.toast(m, { timeout: 0 });
  // i2 and i3 went; with only persistent ones left the oldest goes (paw-ky2g: the stack never grows past MAX_TOASTS)
  assert.deepEqual(t.toasts.map((x) => x.message), ['e2', 'e3', 'e4', 'e5']);
  for (const x of [...t.toasts]) t.dismissToast(x.id);
  assert.equal(t.toasts.length, 0);
  t.dismissToast(12345); // unknown id: no-op
});

test('paw-ky2g: the same toast again is counted on the one showing, its countdown from the start; dismissAll empties the stack', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const t = await fresh();
    const a = t.toast('a.pawproj is not a usable project', { kind: 'bad', timeout: 60_000 });
    t.toast('Video not found', { kind: 'info' });
    mock.timers.tick(50_000);
    assert.equal(t.toast('a.pawproj is not a usable project', { kind: 'bad', timeout: 60_000 }), a);
    assert.equal(t.toast('a.pawproj is not a usable project', { kind: 'bad', timeout: 60_000 }), a);
    assert.deepEqual(t.toasts.map((x) => [x.message, x.count]), [['a.pawproj is not a usable project', 3]]);   // the info timed out
    mock.timers.tick(59_999);
    assert.equal(t.toasts.length, 1);
    mock.timers.tick(1);
    assert.equal(t.toasts.length, 0, 'an error with a life goes at its end');
    t.toast('x'); t.toast('y', { kind: 'bad' });
    t.dismissAll();
    assert.equal(t.toasts.length, 0);
  } finally { mock.timers.reset(); }
});

test('toast: keeps the action and returns increasing ids', async () => {
  const t = await fresh();
  const run = () => {};
  const a = t.toast('x', { kind: 'bad', action: { label: 'Show log', run } });
  const b = t.toast('y');
  assert.ok(b > a);
  assert.equal(t.toasts[0].action.run, run);
  assert.equal(t.toasts[1].action, null);
});

test('toast: a tip rides with the message (paw-p8o2: a saved file named, its full path in the tooltip)', async () => {
  const t = await fresh();
  t.toast('Saved clip.png', { kind: 'ok', tip: 'D:/frames/clip.png' });
  assert.equal(t.toasts[0].tip, 'D:/frames/clip.png');
  t.toast('Undo: move', {});
  assert.equal(t.toasts[1].tip, '');
  const host = readFileSync(new URL('../src/ui/kit/ToastHost.svelte', import.meta.url), 'utf8');
  assert.match(host, /class="kit-toast-host-msg" \{@attach tooltip\(t\.tip\)\}/);
  const proj = readFileSync(new URL('../src/app/project.svelte.js', import.meta.url), 'utf8');
  assert.match(proj, /app\.toast\(`Kept as \$\{L\.fileName\(p\)\}[^`]*`, 'quiet', \{ timeout: 6000, tip: p \}\)/);
});
