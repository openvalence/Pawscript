// dev/proxy-scrub-look.mjs -- in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints): open a
// clip whose frames carry their own number as 10 bars (bit i = bar i, white = 1; ffmpeg geq, see paw-ef73.15), make the
// app's proxy when the webview can't play it, wait for the scrub cache, then scrub to frame starts and mid-frame times:
// read the number PAINTED while scrubbing (the scrub canvas) and after the scrub stops (the <video>), assert they match.
//   node dev/proxy-scrub-look.mjs <clip> [fps]      exits 1 on a mismatch
import { connectTestApp } from './cdp-connect.mjs';
const [clip, fpsArg] = process.argv.slice(2);
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
await ev(async (p) => { app.dialog?.resolve('discard'); await app.project.openVideo(p, { force: true }); }, clip);
await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
if (await ev(() => !!app.player.error?.canProxy)) {
  console.log('the webview cannot play it: making the proxy');
  await ev(() => app.player.makeProxy());
  await page.waitForFunction(() => !app.player.error && app.player.ready && app.player.vw > 0 && !!app.player.media?.proxyOf, null, { timeout: 180000 });
}
await ev(() => app.player.buildScrubCache?.(true));
await page.waitForFunction(() => app.player.scrubCache?.state === 'ready', null, { timeout: 180000 }).catch(() => console.log('scrub cache not ready: the source scrubber'));
await page.waitForTimeout(1000);
const info = await ev(() => ({ path: app.player.media?.path, proxyOf: app.player.media?.proxyOf || null, fms: app.player.frameMs, fps: app.player.fps, cache: app.player.scrubCache?.state }));
console.log(JSON.stringify(info));
const fm = fpsArg ? 1000 / eval(fpsArg) : info.fms;
async function painted() {
  const r = await ev(() => { const v = document.querySelector('[data-testid="video-stage"] video'); const q = v.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  const png = (await page.screenshot({ clip: { x: Math.floor(r.x), y: Math.floor(r.y + r.h / 2) - 2, width: Math.floor(r.w), height: 4 }, scale: 'css' })).toString('base64');
  return ev(async ({ png }) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const row = x.getImageData(0, 2, bmp.width, 1).data; let n = 0;
    for (let i = 0; i < 10; i++) { const k = Math.floor((i + 0.5) * bmp.width / 10) * 4; if (row[k] > 128) n |= 1 << i; }
    return n;
  }, { png });
}
let bad = 0;
for (const k of [5, 30, 47, 61, 90, 151]) {
  for (const [what, t] of [['start', k * fm], ['start-0.3ms', k * fm - 0.3], ['mid', (k + 0.5) * fm], ['rounded start', Math.round(k * fm)]]) {
    await ev((t) => { app.player.pause(); app.player.scrub(t); }, t);
    await page.waitForTimeout(90);
    const during = await painted();
    await page.waitForTimeout(900);   // the scrub's idle end: one real seek, the overlay drops
    const after = await painted();
    const st = await ev(() => ({ frame: app.player.frame, scrubbing: app.player.scrubbing, rest: app.player.playheadMs }));
    const ok = during === after;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} t ${t.toFixed(2)} (${what} of frame ${k}): painted during scrub ${during}, after it stops ${after} (player frame ${st.frame}, overlay ${st.scrubbing ? 'still up' : 'down'})`);
  }
}
await b.close();
process.exit(bad ? 1 : 0);
