// dev/label-load.mjs -- paw-cbw2: how fast the labelling workspace loads images, in YOUR test instance (node dev/test-app.mjs start ...,
// then the CDP_* env it prints) on a folder of GENERATED images (e.g. 4000x3000 jpg / png). Measures where the time goes (bytes over IPC,
// asset-protocol fetch, decode, draw), next-image latency (cold / after read-ahead), the longest main-thread block (long tasks) and a
// fast run of 20 "next" presses; with a delay (arg 3, ms) every file read waits that long first (test builds only: globalThis.__labelReadDelay).
//   node dev/label-load.mjs <image folder> <out json> [delay ms]
import { connectTestApp } from './cdp-connect.mjs';
import { writeFileSync } from 'node:fs';

const [folder, out, delay = '0'] = process.argv.slice(2);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const R = { delay: +delay };
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  await ev((d) => { globalThis.__labelReadDelay = d; window.__lt = []; { let last = performance.now(); const tick = () => { const n = performance.now(); window.__lt.push(Math.max(0, n - last - 4)); last = n; setTimeout(tick, 4); }; tick(); } }, +delay);   // event-loop lag probe: the longtask observer reports nothing in this WebView2, so the longest gap between 4 ms timers is the longest block
  const longest = () => ev(() => { const m = Math.max(0, ...window.__lt); window.__lt = []; return Math.round(m); });
  const raf2 = `await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));`;

  // ---- opening: until the first image is on screen ----
  const open = await ev(async (f) => {
    const t0 = performance.now();
    await app.commands.run('labelling.open', { folder: f });
    let tListed = null;
    while (!(app.labelling?.on && app.labelling.ready)) await new Promise((r) => setTimeout(r, 5));
    const tReady = performance.now() - t0;
    while (app.labelling.listing) await new Promise((r) => setTimeout(r, 5));
    return { readyMs: Math.round(tReady), listedMs: Math.round(performance.now() - t0), n: app.labelling.images.length };
  }, folder);
  R.open = open; R.openLongestBlock = await longest();
  console.log('open', JSON.stringify(open), 'longest block', R.openLongestBlock);
  ok(open.n >= 100, `${open.n} images listed`);

  // ---- where the time goes for one uncached picture (a late one, so nothing has touched it) ----
  R.cost = await ev(async () => {
    const im = app.labelling.images[150], be = app.backend, o = {};
    const lt = () => { const m = Math.max(0, ...window.__lt); window.__lt = []; return Math.round(m); };
    window.__lt = [];
    let t = performance.now(); const bytes = await be.readBytes(im.path); o.ipcReadMs = Math.round(performance.now() - t); o.bytesMB = +(bytes.byteLength / 1e6).toFixed(1); o.ipcLongest = lt();
    t = performance.now(); const b1 = await createImageBitmap(new Blob([bytes])); o.decodeMs = Math.round(performance.now() - t); o.decodeLongest = lt(); b1.close();
    const im2 = app.labelling.images[151];
    t = performance.now(); const blob = await (await fetch(be.mediaUrl(im2.path))).blob(); o.assetFetchMs = Math.round(performance.now() - t); o.assetLongest = lt();
    t = performance.now(); const b2 = await createImageBitmap(blob); o.assetDecodeMs = Math.round(performance.now() - t);
    const cv = document.createElement('canvas'); cv.width = b2.width; cv.height = b2.height;
    t = performance.now(); cv.getContext('2d').drawImage(b2, 0, 0); o.drawMs = Math.round(performance.now() - t); o.drawLongest = lt(); b2.close();
    t = performance.now(); await be.listDir(app.labelling.folder); o.listDirMs = Math.round(performance.now() - t);
    return o;
  });
  console.log('cost', JSON.stringify(R.cost));

  // ---- next-image latency ----
  const next = () => ev(async () => {
    const ws = app.labelling, target = ws.index + 1, t0 = performance.now();
    app.commands.run('labelling.next');
    while (!(ws.ready && ws.index === target)) await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  });
  const idle = (ms) => page.waitForTimeout(ms);
  await ev(() => app.labelling.show(20)); await page.waitForFunction(() => app.labelling.ready && app.labelling.index === 20); await longest();
  R.coldNext = await next(); R.coldLongest = await longest();   // right after arriving: nothing ahead guaranteed loaded
  await idle(4000 + 4 * +delay);                                 // time for the read-ahead
  R.warmNext = []; for (let k = 0; k < 3; k++) { R.warmNext.push(await next()); await idle(2500 + 3 * +delay); }
  R.warmLongest = await longest();
  console.log('next: cold', R.coldNext, 'ms (longest block', R.coldLongest, '), after read-ahead', R.warmNext, 'ms (longest block', R.warmLongest, ')');

  // ---- 20 fast presses end on the right image, no stale picture ----
  const fast = await ev(async () => {
    const ws = app.labelling, start = ws.index;
    for (let k = 0; k < 20; k++) { app.commands.run('labelling.next'); await new Promise((r) => setTimeout(r, 25)); }
    const t0 = performance.now();
    while (!(ws.ready && ws.index === start + 20)) { await new Promise((r) => requestAnimationFrame(r)); if (performance.now() - t0 > 60000) break; }
    await new Promise((r) => setTimeout(r, 500));
    return { start, end: ws.index, ready: ws.ready, shown: ws.doc.media?.name, want: ws.images[start + 20]?.name, settleMs: Math.round(performance.now() - t0) };
  });
  R.fast = fast; R.fastLongest = await longest();
  console.log('fast', JSON.stringify(fast), 'longest block', R.fastLongest);
  ok(fast.end === fast.start + 20 && fast.ready && fast.shown === fast.want, 'fast run of 20 nexts ends on the right image');
  const blocks = [R.openLongestBlock, R.coldLongest, R.warmLongest, R.fastLongest];
  ok(Math.max(...blocks) <= 50, 'the UI thread never blocked longer than 50 ms (longest event-loop gaps: ' + blocks.join(', ') + ')');
  ok(R.warmNext.every((n) => n <= 50), 'next image after read-ahead within ~3 frames: ' + R.warmNext.join(', ') + ' ms');
  await page.waitForTimeout(3000);
  R.thumbs = await ev(async () => { const l = await app.backend.listDir(app.labelling.thumbsDir).catch(() => []); return { n: l.length, bytes: l.reduce((a, e) => a + e.size, 0), tilesWithImg: document.querySelectorAll('[data-testid="label-strip"] .th img').length, tiles: document.querySelectorAll('[data-testid="label-strip"] .th').length }; });
  console.log('thumbs', JSON.stringify(R.thumbs));
  ok(R.thumbs.n > 0 && R.thumbs.tilesWithImg > 0, 'thumbnails exist in the local cache and the strip shows them');
  await ev(() => app.labelling.leave());
} finally { await browser.close(); }
writeFileSync(out, JSON.stringify(R, null, 1));
console.log(fails ? `${fails} FAILED` : 'done');
process.exit(fails ? 1 : 0);
