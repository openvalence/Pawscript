// paw-nydn: a proxy of any video. The sizes offered, and the Player's proxy flow on a fake backend: make one at a size (the
// source path, the height asked), play it, stay on it when the document's media comes again, back to the original, the choice
// remembered per video and played again on reopening without re-encoding, a proxy gone from the cache or a replaced video ->
// the original (and the offer to make it again), cancel leaves the original playing, one usage line each.
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
globalThis.cancelAnimationFrame ??= () => {};   // the Player stops its shuttle on load (no element here)
const { proxySizes, defaultProxy, proxyKey } = await import('../src/features/video/transport.js');
const { Player } = await import('../src/features/video/player.svelte.js');

test('sizes: the source height and 1080 / 720 / 480, none above the source, tallest first; the default', () => {
  assert.deepEqual(proxySizes(2160), [2160, 1080, 720, 480]);
  assert.deepEqual(proxySizes(1080), [1080, 720, 480]);
  assert.deepEqual(proxySizes(1081), [1080, 720, 480]);   // even, what media.rs's scale makes of it
  assert.deepEqual(proxySizes(1400), [1400, 1080, 720, 480]);
  assert.deepEqual(proxySizes(4320), [2160, 1080, 720, 480]);   // media.rs clamps to 2160
  assert.deepEqual(proxySizes(360), [360]);
  assert.deepEqual(proxySizes(0), [1080, 720, 480]);   // not probed
  assert.equal(defaultProxy([1080, 720, 480]), 720);
  assert.equal(defaultProxy([1400, 1080]), 1080);
  assert.equal(defaultProxy([360]), 360);
  assert.equal(proxyKey('C:/v/a.mp4'), 'video.proxy:C:/v/a.mp4');
  assert.equal(proxyKey(''), '');
});

const SRC = 'C:/v/clip.mp4';
const tick = () => new Promise((r) => setTimeout(r, 0));
function fakeApp({ store = new Map(), files = {}, transcode, scrubName = (p) => p + '.intra.mp4' } = {}) {
  const calls = [], notes = [], scrubs = [], opens = [], evq = [{ kind: 'thumbs', bytes: 3 * 2 ** 20, age_s: 7200 }];
  const fs = { [SRC]: { exists: true, size: 1000, mtime_ms: 5 }, ...files };
  const backend = {
    stat: async (p) => fs[p] || { exists: false },
    frameTimes: async () => [0, 40, 80],
    mediaProbe: async () => ({ video: { codec: 'hevc' } }),
    scrubCache: (path) => { scrubs.push(path); return { promise: Promise.resolve(scrubName(path)), cancel() {} }; },
    mediaCacheOpen: (paths) => { opens.push(paths); },
    mediaCacheEvicted: async () => evq.splice(0),
    transcodePreview: (path, o) => {
      calls.push({ path, height: o.height });
      if (transcode) return transcode(path, o);
      const p = `C:/cache/proxy-${o.height}/proxy.mp4`;
      fs[p] = fs[`C:/cache/proxy-${o.height}/done`] = { exists: true };
      return { promise: Promise.resolve(p), cancel() {} };
    },
  };
  const app = {
    backend, doc: { media: { path: SRC, name: 'clip.mp4', height: 1080, fps: 25, durationMs: 3000 } },
    settings: { get: (k, d = null) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, v) },
    usage: { note: (kind, d) => notes.push({ kind, ...d }) },
    task: () => ({ update() {}, end() {} }), toast() {},
  };
  return { app, calls, notes, store, fs, scrubs, opens };
}
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

test('make a 480p proxy of a playable video: plays it, stays on it, back to the original, remembered', async () => {
  const f = fakeApp(), p = new Player(f.app);
  p.load(f.app.doc.media);
  await settle();
  assert.equal(p.proxyH, 0);
  assert.deepEqual(p.proxySizes, [1080, 720, 480]);
  await p.makeProxy(480);
  assert.deepEqual(f.calls, [{ path: SRC, height: 480 }], 'the original is transcoded at the size asked');
  assert.equal(p.proxyH, 480);
  assert.equal(p.media.proxyOf, SRC);
  assert.equal(p.media.path, 'C:/cache/proxy-480/proxy.mp4');
  assert.deepEqual(f.store.get(proxyKey(SRC)), { of: '1000:5', made: { 480: 'C:/cache/proxy-480/proxy.mp4' }, use: 480 });
  p.load(f.app.doc.media);   // the pane re-mounting / a re-probe hands the document's media again
  assert.equal(p.proxyH, 480, 'stays on the chosen proxy');
  await p.useProxy(0);
  assert.equal(p.proxyH, 0);
  assert.equal(p.media.path, SRC);
  assert.equal(f.store.get(proxyKey(SRC)).use, 0);
  await p.useProxy(480);   // made already: no new transcode
  assert.equal(f.calls.length, 1);
  assert.equal(p.proxyH, 480);
  await settle();
  // paw-mh1a: the scrub cache is the playing file's: the original's, the proxy's, and each one fetched again on a switch
  const P480 = 'C:/cache/proxy-480/proxy.mp4';
  assert.deepEqual(f.scrubs, [SRC, P480, P480, SRC, P480]);   // (the media handed again asks once more: instant while cached)
  assert.deepEqual(p.scrubCache, { src: P480, state: 'ready', path: P480 + '.intra.mp4' });
  // paw-mh1a: the media cache is told which files are open; an eviction is one usage line (kind, MB, hours; no path)
  assert.deepEqual(f.opens.slice(0, 2), [[SRC], [SRC, P480]]);
  assert.deepEqual(f.notes.filter((n) => n.kind === 'media:evicted'), [{ kind: 'media:evicted', what: 'thumbs', mb: 3, ageH: 2 }]);
  assert.deepEqual(f.notes.filter((n) => n.kind === 'video:proxy').map((n) => [n.act, n.h, n.codec]), [['made', 480, 'hevc'], ['use', 480, 'hevc'], ['use', 0, 'hevc'], ['use', 480, 'hevc']]);
  assert.ok(f.notes.every((n) => !JSON.stringify(n).includes('C:/')), 'no paths in the log');
});

test('reopening plays the chosen proxy without re-encoding; gone from the cache or a replaced video -> the original', async () => {
  const rec = { of: '1000:5', made: { 480: 'C:/cache/proxy-480/proxy.mp4', 720: 'C:/cache/proxy-720/proxy.mp4' }, use: 480 };
  const done = { 'C:/cache/proxy-480/done': { exists: true }, 'C:/cache/proxy-720/done': { exists: true } };

  let f = fakeApp({ store: new Map([[proxyKey(SRC), rec]]), files: done }), p = new Player(f.app);
  p.load(f.app.doc.media);
  await settle();
  assert.equal(p.proxyH, 480);
  assert.deepEqual(Object.keys(p.proxies), ['480', '720']);
  assert.deepEqual(f.calls, [{ path: SRC, height: 480 }], 'asked through the cache once (a hit: marks it used), no transcode');

  f = fakeApp({ store: new Map([[proxyKey(SRC), rec]]), files: { 'C:/cache/proxy-720/done': { exists: true } } }); p = new Player(f.app);
  p.load(f.app.doc.media);
  await settle();
  assert.equal(p.proxyH, 0, 'the 480 proxy was evicted: the original plays');
  assert.equal(p.proxyLost, 480, 'and the control offers it again');
  assert.deepEqual(Object.keys(p.proxies), ['720']);
  assert.deepEqual(f.store.get(proxyKey(SRC)).made, { 720: 'C:/cache/proxy-720/proxy.mp4' });
  assert.equal(f.calls.length, 0);

  f = fakeApp({ store: new Map([[proxyKey(SRC), rec]]), files: { ...done, [SRC]: { exists: true, size: 2000, mtime_ms: 9 } } }); p = new Player(f.app);
  p.load(f.app.doc.media);
  await settle();
  assert.equal(p.proxyH, 0, 'a replaced video never plays its old proxies');
  assert.deepEqual(p.proxies, {});
});

test('reopening: a proxy the cache would have to make again (progress) is cancelled, the original plays', async () => {
  const rec = { of: '1000:5', made: { 480: 'C:/cache/proxy-480/proxy.mp4' }, use: 480 };
  let cancelled = 0;
  const f = fakeApp({ store: new Map([[proxyKey(SRC), rec]]), files: { 'C:/cache/proxy-480/done': { exists: true } },
    transcode: (_p, o) => { let rej; const promise = new Promise((_, r) => { rej = r; }); setTimeout(() => o.onProgress?.(0.01)); return { promise, cancel: () => { cancelled++; rej(Object.assign(new Error('cancelled'), { code: 'cancelled' })); } }; } });
  const p = new Player(f.app);
  p.load(f.app.doc.media);
  await settle(); await settle();
  assert.equal(cancelled, 1);
  assert.equal(p.proxyH, 0);
  assert.equal(p.proxyLost, 480);
});

test('a scrub cache the backend had to make smaller: its height is known (for the dialog text)', async () => {
  const f = fakeApp({ scrubName: () => 'C:/cache/scrub-x/scrub-720.mp4' }), p = new Player(f.app);
  p.load(f.app.doc.media);
  await settle();
  assert.equal(p.scrubCache.state, 'ready');
  assert.equal(p.scrubCache.h, 720);
});

test('cancel mid-way: the original keeps playing, nothing remembered', async () => {
  let reject;
  const f = fakeApp({ transcode: (_p, o) => { o.onProgress?.(0.3); return { promise: new Promise((_, r) => { reject = r; }), cancel: () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })) }; } });
  const p = new Player(f.app);
  p.load(f.app.doc.media);
  await settle();
  const run = p.makeProxy(720);
  assert.deepEqual(p.proxyJob, { h: 720, fraction: 0 });
  p.cancelProxy();
  await run;
  await settle();
  assert.equal(p.proxyJob, null);
  assert.equal(p.proxyH, 0);
  assert.equal(p.media.path, SRC);
  assert.equal(p.error, null, 'a playable original shows no card');
  assert.equal(f.store.get(proxyKey(SRC)), undefined);
  assert.deepEqual(f.notes.filter((n) => n.kind === 'video:proxy').map((n) => n.act), ['cancelled']);
});

// paw-b88b: the files a frame reader may read instead of a source it cannot take (a WebM / VP8): the scrub cache once ready,
// the proxies tallest first; none for another video. No reader at all: one warning per video, the proxy offered.
test('frameFiles: the ready scrub cache, then the proxies; framesUnreadable says it once with "Make a proxy"', async () => {
  const toasts = [], f = fakeApp({ store: new Map([[proxyKey(SRC), { of: '1000:5', made: { 480: 'C:/cache/proxy-480/proxy.mp4', 720: 'C:/cache/proxy-720/proxy.mp4' }, use: 0 }]]),
    files: { 'C:/cache/proxy-480/done': { exists: true }, 'C:/cache/proxy-720/done': { exists: true } } });
  f.app.toast = (msg, kind, o) => toasts.push({ msg, kind, label: o?.action?.label });
  const p = new Player(f.app);
  p.load(f.app.doc.media);
  await settle();
  assert.deepEqual(p.frameFiles(SRC), [SRC + '.intra.mp4', 'C:/cache/proxy-720/proxy.mp4', 'C:/cache/proxy-480/proxy.mp4']);
  assert.deepEqual(p.frameFiles(), p.frameFiles(SRC));
  assert.deepEqual(p.frameFiles('C:/v/other.webm'), [], 'another video: none');
  p.scrubCache = { src: SRC, state: 'building', fraction: 0.5 };
  assert.deepEqual(p.frameFiles(SRC), ['C:/cache/proxy-720/proxy.mp4', 'C:/cache/proxy-480/proxy.mp4'], 'a scrub cache still being made: not yet');
  p.framesUnreadable(); p.framesUnreadable();
  assert.equal(toasts.length, 1, 'once per video');
  assert.ok(toasts[0].kind === 'warn' && toasts[0].label === 'Make a proxy' && toasts[0].msg.length <= 60 && !/ffmpeg|\[/.test(toasts[0].msg), JSON.stringify(toasts[0]));
});
