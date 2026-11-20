// paw-56pz: a VP8 / WebM frame copy started by hover scrub was cancelled whenever its tab was hidden (the pane's detach aborted
// the scrubber, its last reader) and started again from 0 on the next hover. A detach (abort reason DETACHED) lets go without
// stopping it; a new source (any other abort) still stops it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrubber, DETACHED } from '../src/features/video/scrub.js';

globalThis.VideoDecoder ??= class {};   // createScrubber asks for WebCodecs first
const fakeBackend = () => {
  const b = { started: 0, cancelled: 0 };
  Object.assign(b, {
    mediaProbe: async () => ({ video: { codec: 'vp8' } }),
    mediaUrl: (p) => 'asset://' + p,
    remuxMp4: () => { b.started++; return { promise: new Promise(() => {}), cancel: () => { b.cancelled++; } }; },
  });
  return b;
};
const settle = () => new Promise((r) => setTimeout(r, 10));

test('paw-56pz: a hidden tab\'s detach keeps the frame copy; the next scrubber joins it', async () => {
  const be = fakeBackend(), ac = new AbortController();
  createScrubber({ url: 'x', path: 'clip-a.webm', backend: be, signal: ac.signal }).catch(() => {});
  await settle();
  assert.equal(be.started, 1, 'the copy started');
  ac.abort(DETACHED);
  await settle();
  assert.equal(be.cancelled, 0, 'not cancelled by the detach');
  const ac2 = new AbortController();
  createScrubber({ url: 'x', path: 'clip-a.webm', backend: be, signal: ac2.signal }).catch(() => {});
  await settle();
  assert.equal(be.started, 1, 'shown again: the same copy, not a new one from 0');
  ac2.abort();
  await settle();
  assert.equal(be.cancelled, 1, 'a new source (plain abort) stops it');
});
