import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtRate, fmtFps, nextFmt, loopInfo, resolveTime, focusTimeField, setTimeFieldHook, proxyProgress } from '../src/features/video/transport.js';

test('readouts', () => {
  assert.equal(fmtRate(1), '1×');
  assert.equal(fmtRate(0.025), '0.025×');
  assert.equal(fmtRate(1, -2), '◂ 2×');
  assert.equal(fmtRate(0.05, 0.05), '0.05×');
  assert.equal(fmtFps(30000 / 1001), '29.97');
  assert.equal(fmtFps(24000 / 1001), '23.976');
  assert.equal(fmtFps(30), '30');
  assert.equal(nextFmt('ms'), 'frames');
  assert.equal(nextFmt('sec'), 'ms');
  assert.deepEqual(loopInfo({ t0: 1000, t1: 3400 }, 1000 / 30), { ms: 2400, frames: 72, text: '2.40 s' });
});

test('resolveTime', () => {
  const p = { timeMs: 10000, frame: 300, fps: 30, durationMs: 60000, last: 1799 };
  assert.deepEqual(resolveTime('0:42.317', p), { ms: 42317 });
  assert.deepEqual(resolveTime('1:02.5', p), { ms: 60000 });
  assert.deepEqual(resolveTime('#120', p), { frame: 120 });
  assert.deepEqual(resolveTime('120f', p), { frame: 120 });
  assert.deepEqual(resolveTime('+10f', p), { frame: 310 });
  assert.deepEqual(resolveTime('-2s', p), { ms: 8000 });
  assert.deepEqual(resolveTime('-20s', p), { ms: 0 });
  assert.deepEqual(resolveTime('#99999', p), { frame: 1799 });
  assert.deepEqual(resolveTime('00:00:01:15', p), { frame: 45 });
  assert.equal(resolveTime('nope', p), null);
});

test('time field hook', () => {
  assert.equal(focusTimeField(), false);
  let got;
  const off = setTimeFieldHook((t) => { got = t ?? 'open'; });
  assert.equal(focusTimeField('+1s'), true);
  assert.equal(got, '+1s');
  off();
  assert.equal(focusTimeField(), false);
});

test('proxyProgress', () => {
  assert.equal(proxyProgress({ message: 'Making a playable proxy… 42 %' }), 0.42);
  assert.equal(proxyProgress({ message: 'Making a playable proxy…' }), null);
  assert.equal(proxyProgress({ message: '… 42 %', progress: 0.5 }), 0.5);
  assert.equal(proxyProgress(null), null);
});

test('mediaError: missing, empty and unprobed files are told apart; a proxy only for a probed video stream', async () => {
  const { mediaError } = await import('../src/features/video/transport.js');
  const o = { path: 'C:/v/a.mp4', proxy: true, locate: true };
  assert.deepEqual(mediaError(4, { ...o, stat: { exists: false, size: 0 } }), { code: 'missing', message: 'File not found: C:/v/a.mp4', canProxy: false, canLocate: true });
  // paw-tjy6: a file that is there (empty, random bytes, truncated) is not offered "Locate video…"
  const empty = mediaError(4, { ...o, stat: { exists: true, size: 0 } });
  assert.equal(empty.code, 'empty'); assert.equal(empty.canLocate, false); assert.match(empty.message, /can't be read as a video/);
  const junk = mediaError(4, { ...o, probed: false, stat: { exists: true, size: 2000 } });
  assert.equal(junk.canProxy, false); assert.equal(junk.canLocate, false); assert.equal(junk.message, "This file can't be read as a video");
  assert.equal(mediaError(4, { ...o, probed: false, stat: null }).canLocate, true);   // not known to be there: it may have moved
  const hevc = mediaError(4, { ...o, probed: true, stat: { exists: true, size: 2000 } });
  assert.equal(hevc.canProxy, true); assert.equal(hevc.canLocate, false); assert.match(hevc.message, /codec or container/);
  assert.equal(mediaError(4, { probed: true, proxy: true }).canProxy, false);   // nothing to transcode (harness url)
  assert.equal(mediaError(4, { ...o, proxy: false }).canProxy, false);
});

test('paw-tjy6: the waveform does not decode in the webview a file ffmpeg read and failed on; it does when ffmpeg could not start', async () => {
  const { loadWaveform } = await import('../src/features/video/waveform.js');
  const fail = (message) => ({ waveformPeaks: () => ({ promise: Promise.reject(Object.assign(new Error(message), { code: 'ffmpeg_failed' })) }) });
  const was = globalThis.fetch, warn = console.warn;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new Error('no network here'); };
  console.warn = () => {};
  try {
    assert.deepEqual(await loadWaveform({ url: 'u', path: 'C:/v/junk.mp4', backend: fail('ffmpeg failed: Invalid data found') }), { error: "Audio can't be read" });
    assert.equal(fetched, 0);
    await loadWaveform({ url: 'u', path: 'C:/v/a.mp4', backend: fail('cannot start ffmpeg: denied') });
    assert.equal(fetched, 1);
  } finally { globalThis.fetch = was; console.warn = warn; }
});

test('paw-yh6y: sound but no picture (HEVC / ProRes without a decoder) offers the proxy like a decode error; audio only does not', async () => {
  const { noPicture } = await import('../src/features/video/transport.js');
  const hevc = noPicture({ path: 'C:/v/a.mp4', probed: true, proxy: true });
  assert.equal(hevc.canProxy, true); assert.equal(hevc.code, 0); assert.match(hevc.message, /proxy can be made/);
  assert.equal(noPicture({ path: 'C:/v/song.m4a', probed: false, proxy: true }).canProxy, false);   // ffprobe found no video stream
  assert.equal(noPicture({ path: 'C:/v/a.mp4', probed: true, proxy: false }).canProxy, false);   // no backend to make one
  assert.equal(noPicture({ probed: true, proxy: true }).canProxy, false);   // no file (harness url)
});
