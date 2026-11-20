// paw-33zi: a newly opened video starts at 0, never at the previous document's playhead: the previous source's rest time
// (restMs, read first by displayMs / playheadMs) is dropped on a new source, and a frame of the previous source presented
// just before the swap (a late requestVideoFrameCallback) does not move the new one's clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (url.startsWith('file:') && !url.includes('node_modules') && url.endsWith('.svelte.js')) {
      return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(fileURLToPath(url), 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code };
    }
    return next(url, ctx);
  },
});
globalThis.cancelAnimationFrame ??= () => {};
globalThis.document ??= { hidden: false, addEventListener() {}, removeEventListener() {} };
const { Player } = await import('../src/features/video/player.svelte.js');

const A = { path: 'C:/v/a.mp4', fps: 30, durationMs: 32000 }, B = { path: 'C:/v/b.mp4', fps: 30, durationMs: 24000 };
const fakeEl = () => ({ paused: true, playbackRate: 1, error: null, addEventListener() {}, removeEventListener() {}, load() {}, removeAttribute() {},
  requestVideoFrameCallback(cb) { this.cb = cb; return 1; }, cancelVideoFrameCallback() {} });

test('a new source drops the previous one\'s rest time: displayMs / playheadMs start at 0', async () => {
  const p = new Player(null);
  p.load(A);
  await p.seek(10367, { exact: true });   // no element: the timer clock moves at once
  assert.equal(Math.round(p.displayMs), 10367);
  p.load(B);
  assert.equal(p.restMs, null);
  assert.equal(p.displayMs, 0);
  assert.equal(p.playheadMs, 0);
});

test('a frame of the previous source presented after the swap does not move the new source\'s clock', () => {
  const p = new Player(null), el = fakeEl();
  p.attach(el);
  p.load(A);
  p.ready = true;   // A's metadata
  el.cb(0, { mediaTime: 10.367, presentedFrames: 1, expectedDisplayTime: 0 });
  assert.ok(Math.abs(p.timeMs - 10367) < 34, `A shows 10.367 s (${p.timeMs})`);
  p.load(B);
  el.cb(0, { mediaTime: 10.367, presentedFrames: 2, expectedDisplayTime: 0 });   // A's last frame, called back late
  assert.equal(p.timeMs, 0);
  p.ready = true;   // B's metadata: its own frames count
  el.cb(0, { mediaTime: 1.0, presentedFrames: 3, expectedDisplayTime: 0 });
  assert.ok(Math.abs(p.timeMs - 1000) < 34);
});
