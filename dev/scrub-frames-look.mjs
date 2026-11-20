// dev/scrub-frames-look.mjs -- paw-ef73.22: the frame shown while the smooth scrub moves and after it stops must be the frame
// whose span CONTAINS the playhead time. Frames carry their own number as 10 bars (see dev/proxy-scrub-look.mjs); in YOUR
// test instance, for each clip: times 0 / 25 / 50 / 75 / 99 % into frames, by the two scrub paths (the ruler: seek exact; the
// hover / drag scrub: player.scrub), read the painted number while moving and after the stop; all must equal the frame index.
//   node dev/scrub-frames-look.mjs <clip> [<clip> ...]      exits 1 on a mismatch
import { connectTestApp } from './cdp-connect.mjs';
const clips = process.argv.slice(2);
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
let bad = 0;
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
for (const clip of clips) {
  await ev(async (p) => { app.dialog?.resolve('discard'); await app.project.openVideo(p, { force: true }); }, clip);
  await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
  if (await ev(() => !!app.player.error?.canProxy)) { await ev(() => app.player.makeProxy()); await page.waitForFunction(() => !app.player.error && app.player.ready && app.player.vw > 0 && !!app.player.media?.proxyOf, null, { timeout: 180000 }); }
  await ev(() => app.player.buildScrubCache?.(true));
  await page.waitForFunction(() => app.player.scrubCache?.state === 'ready', null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(800);
  const info = await ev(() => ({ path: app.player.media?.path.split(/[\\/]/).pop(), proxy: !!app.player.media?.proxyOf, fms: app.player.frameMs, t0: app.player.clock.timeOf(0), count: app.player.clock.count }));
  console.log(JSON.stringify(info));
  const fm = info.fms;
  for (const path of ['ruler (seek exact)', 'scrub (decoded frames)']) {
    let n = 0, mism = 0;
    for (const k of [6, 31, 47, 62, 90]) for (const frac of [0, 0.25, 0.5, 0.75, 0.96]) {
      const t = (k + frac) * fm + info.t0;   // inside frame k
      await ev(([t, p]) => { app.player.pause(); p.startsWith('ruler') ? app.player.seek(t, { exact: true }) : app.player.scrub(t); }, [t, path]);
      await page.waitForTimeout(path.startsWith('scrub') ? 350 : 250);
      const during = await painted();
      await page.waitForTimeout(path.startsWith('scrub') ? 1000 : 400);
      const after = await painted();
      const frame = await ev(() => app.player.frame);
      n++;
      const good = during === k && after === k && frame === k;
      if (!good) { mism++; bad++; console.log(`  FAIL ${path} frame ${k} +${Math.round(frac * 100)}%: moving ${during}, still ${after}, player.frame ${frame}`); }
    }
    console.log(`${mism ? 'FAIL' : 'ok  '} ${path}: ${n - mism}/${n} readings are the frame containing the time (moving = still)`);
  }
  // hysteresis through the real ruler: 4 px per frame, jitter of +-1 px around a boundary, then release
  {
    const lane = await (await page.$('[data-tl-lane="ruler"]')).boundingBox(), span = (fm * lane.width) / 4, k = 300, t1 = k * fm + info.t0;
    await ev(([a, s]) => { app.player.pause(); app.setView({ start: a, span: s }); }, [t1 - span / 2, span]);
    await page.waitForTimeout(500);
    const y = lane.y + 10, xAt = (t) => lane.x + ((t - (t1 - span / 2)) / span) * lane.width;
    await page.mouse.move(xAt(t1 - fm * 0.6), y); await page.mouse.down();
    await page.mouse.move(xAt(t1 + fm * 0.1), y, { steps: 6 }); await page.waitForTimeout(300);
    const seq = [await painted()];
    for (const dx of [1, -1, 1, -1, 0, 1, -1]) { await page.mouse.move(xAt(t1 + fm * 0.1) + dx, y); await page.waitForTimeout(200); seq.push(await painted()); }
    const flips = seq.filter((n, i) => i && n !== seq[i - 1]).length;
    await page.mouse.up(); await page.waitForTimeout(500);
    const rel = await painted(), st = await ev(() => ({ frame: app.player.frame, rest: app.player.playheadMs, held: app.player.heldFrame }));
    const good = rel === seq[seq.length - 1] && flips <= 1 && st.held === -1;
    if (!good) bad++;
    console.log(`${good ? 'ok  ' : 'FAIL'} hysteresis (4 px per frame, +-1 px jitter at a boundary): shown ${seq.join(',')} (${flips} flips), after the release ${rel}, playhead ${st.rest.toFixed(2)} in frame ${st.frame}`);
  }
}
await b.close();
process.exit(bad ? 1 : 0);
