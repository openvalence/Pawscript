// paw-yhif: a drag on the decoded-frame path (an action region's edge, the ruler) released while the last frame's decode is still
// in flight: scrubEnd drops that decode and seeks the <video> there. Once it lands, the playhead time is the frame the <video>
// shows, not the earlier frame the overlay last drew (it stayed 9 frames back for good on an exact clock: actions-check on the
// owner-shaped VP9 index clip). The Player with a fake <video> and a fake scrub-cache decoder (scrub.js replaced).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (url.startsWith('file:') && url.endsWith('/features/video/scrub.js')) {
      return { format: 'module', shortCircuit: true, source: "export const UNREADABLE = 'u', DETACHED = 'd'; export const createScrubber = () => Promise.resolve({ frameAt: (t) => globalThis.__frameAt(t), dispose() {}, error: null });" };
    }
    if (url.startsWith('file:') && !url.includes('node_modules') && url.endsWith('.svelte.js')) {
      return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(fileURLToPath(url), 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code };
    }
    return next(url, ctx);
  },
});
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame ??= () => {};
globalThis.document ??= { hidden: false, addEventListener() {}, removeEventListener() {} };
const { Player } = await import('../src/features/video/player.svelte.js');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('a drag released while its last frame decodes: once the <video> lands, timeMs is the landed frame (paw-yhif)', async () => {
  const on = {};
  const el = { paused: true, playbackRate: 1, error: null, currentTime: 0, load() {}, removeAttribute() {}, pause() {},
    addEventListener(t, f) { on[t] = f; }, removeEventListener() {}, requestVideoFrameCallback(cb) { this.cb = cb; return 1; }, cancelVideoFrameCallback() {} };
  const app = { settings: { get: (_k, d) => d }, backend: { scrubCache: () => ({ promise: Promise.resolve('C:/c/scrub.mp4'), cancel() {} }), mediaUrl: (p) => 'asset:' + p } };
  const p = new Player(app);
  p.attach(el);
  p.load({ path: 'C:/v/a.mp4', url: 'blob:a', fps: 30, durationMs: 60000 });
  Object.assign(p, { ready: true, vw: 160, vh: 140, scrubCanvas: { width: 0, height: 0, getContext: () => ({ drawImage() {} }) } });
  for (let i = 0; i < 5; i++) await tick();   // the scrub cache's decoder is up
  globalThis.__frameAt = () => Promise.resolve({ close() {} });
  p.dragTo(14700, { snap: true });
  await tick();
  assert.equal(p.scrubbing, true, 'the decoded path draws');
  assert.equal(p.timeMs, 14700);
  globalThis.__frameAt = () => new Promise(() => {});   // the last frame's decode is still running at release
  p.dragTo(15000, { snap: true });
  p.scrubEnd();
  assert.ok(Math.abs(el.currentTime * 1000 - 15000) < p.frameMs, `the <video> is sent to 15000 (${el.currentTime})`);
  on.seeked();
  el.cb(0, { mediaTime: el.currentTime, presentedFrames: 2, expectedDisplayTime: 0 });   // it lands and presents frame 450
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(p.scrubbing, false, 'the overlay dropped');
  assert.equal(p.frame, 450);
  assert.equal(p.timeMs, 15000, 'the playhead time is the frame the <video> shows');
});

// 39b17ed put the strip's .then inside a comment: the strip was never used, and a strip refused (the cache's "busy": the same
// video opened again while its strip is made) was an unhandled rejection, the app's "Unexpected error" toast (seen in actions-check).
test('getFrame: the thumbnail strip is used once made; a refused strip is no unhandled rejection', async () => {
  const urls = [], missed = [], onMiss = (e) => missed.push(e);
  globalThis.Image = class { set src(u) { urls.push(u); } };
  const strip = { columns: 1, rows: 1, tile_w: 160, tile_h: 90, levels: [{ count: 1, sheets: ['C:/c/s0.jpg'], times_ms: [1000] }] };
  const mk = (promise) => new Player({ settings: { get: (_k, d) => d }, backend: { thumbnailStrip: () => ({ promise, cancel() {} }), mediaUrl: (x) => 'asset:' + x } });
  process.on('unhandledRejection', onMiss);
  try {
    const bad = mk(Promise.reject({ code: 'busy', message: 'thumbs-x is already being generated' }));
    bad.load({ path: 'C:/v/a.mp4', url: 'blob:a', fps: 30, durationMs: 10000 });
    bad.getFrame(1000, 90, { tolMs: 50 }).catch(() => {});
    const good = mk(Promise.resolve(strip));
    good.load({ path: 'C:/v/b.mp4', url: 'blob:b', fps: 30, durationMs: 10000 });
    good.getFrame(1000, 90, { tolMs: 50 }).catch(() => {});   // before the strip: the exact frame (no <video> here: null)
    for (let i = 0; i < 5; i++) await tick();
    good.getFrame(1000, 90, { tolMs: 50 }).catch(() => {});   // the strip is in: its sheet is read
    await tick();
    assert.deepEqual(urls, ['asset:C:/c/s0.jpg'], 'the tile comes from the strip\'s sheet');
    assert.deepEqual(missed, [], 'no unhandled rejection');
  } finally { process.off('unhandledRejection', onMiss); delete globalThis.Image; }
});
