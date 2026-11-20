// dev/shot-land-check.mjs -- paw-p52k in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints): a click on a
// shot (the Shots strip), a seek to a cut / frame start and a frame step must end with the frame that STARTS there painted,
// player.frame equal to it and the playhead inside that shot. Clips carry their frame number as 12 bars (bit i = bar i, white =
// 1): ffmpeg -f lavfi -i "color=c=black:s=320x180:r=<fps>,format=yuv420p,geq=lum='255*bitand(1,floor(N/pow(2,floor(X*12/W))))':cb=128:cr=128" -frames:v 2300 ...
//   node dev/shot-land-check.mjs <clip> [<clip> ...]      exits 1 on a mismatch (clips the webview cannot play are reported and skipped)
import { connectTestApp } from './cdp-connect.mjs';
const clips = process.argv.slice(2);
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
let bad = 0, n = 0;
async function painted() {
  const r = await ev(() => { const v = document.querySelector('[data-testid="video-stage"] video'); const q = v.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  const png = (await page.screenshot({ clip: { x: Math.floor(r.x), y: Math.floor(r.y + r.h / 2) - 2, width: Math.floor(r.w), height: 4 }, scale: 'css' })).toString('base64');
  return ev(async ({ png }) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const row = x.getImageData(0, 2, bmp.width, 1).data; let v = 0;
    for (let i = 0; i < 12; i++) { const k = Math.floor((i + 0.5) * bmp.width / 12) * 4; if (row[k] > 128) v |= 1 << i; }
    return v;
  }, { png });
}
const read = () => ev(() => { const p = app.player, s = app.doc.scenes || []; const t = p.playheadMs; const at = (x) => s.findIndex((q) => x >= q.start_ms && x < q.end_ms);
  return { frame: p.frame, timeMs: p.timeMs, head: t, shot: at(t), shotTime: at(p.timeMs) }; });
for (const clip of clips) {
  await ev(async (p) => { app.dialog?.resolve('discard'); await app.project.openVideo(p, { force: true }); }, clip);
  await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
  if (await ev(() => !!app.player.error)) { console.log('SKIP ' + clip + ': the webview cannot play it (' + (await ev(() => app.player.error.message)) + ')'); continue; }
  await ev(() => { app.setMode?.('scenes'); app.player.pause(); });
  const info = await ev(() => ({ fms: app.player.frameMs, count: app.player.clock.count, t0: app.player.startMs }));
  const cuts = [300, 777, 1001, 2043, 2150, 2201].filter((k) => k < info.count - 5);   // frame indices; starts like 2043 -> 68100 ms at 30 fps
  const starts = await ev((cuts) => cuts.map((k) => Math.round(app.player.timeOfFrame(k))), cuts);
  await ev(([st, dur]) => { app.doc.scenes = [0, ...st].map((s, i, a) => ({ start_ms: s, end_ms: i + 1 < a.length ? a[i + 1] : dur })); }, [starts, await ev(() => app.player.durationMs)]);
  await page.waitForTimeout(500);
  console.log(JSON.stringify({ clip: clip.split(/[\/]/).pop(), fps: +(1000 / info.fms).toFixed(3), cuts, starts }));
  let clipBad = 0;
  const check = async (what, k, shot) => {
    await page.waitForTimeout(450);
    const [pa, r] = [await painted(), await read()];
    const ok = pa === k && r.frame === k && r.shot === shot && r.shotTime === shot;
    n++; if (!ok) { bad++; clipBad++; console.log(`  FAIL ${what}: wanted frame ${k} in shot ${shot}; painted ${pa}, frame ${r.frame}, timeMs ${r.timeMs.toFixed(3)}, playhead ${r.head.toFixed(3)}, shot@playhead ${r.shot}, shot@timeMs ${r.shotTime}`); }
  };
  // 1. the Shots strip: click inside the shot after each cut
  const lane = await (await page.$('[data-tl-lane="scenes"]')).boundingBox();
  const H = lane.height, y = lane.y + H - Math.max(8, Math.min(14, Math.round(H * 0.2))) - 3;
  for (let i = 1; i <= cuts.length; i++) {
    const s0 = starts[i - 1], e0 = i < starts.length ? starts[i] : info.fms * info.count;
    await ev(([a, s]) => app.setView({ start: a, span: s }), [Math.max(0, s0 - 4000), Math.min(e0 - s0 + 8000, 20000)]);
    await page.waitForTimeout(300);
    const v = await ev(() => app.view), px = (t) => lane.x + ((t - v.start) / v.span) * lane.width;
    await page.mouse.click(px(s0 + Math.min(e0 - s0, 2000) / 2), y);
    await check('click shot ' + i + ' (frame ' + cuts[i - 1] + ')', cuts[i - 1], i);
  }
  // 2. seeks: to the cut time, its frame, the frame before / after by steps, a go-to-frame
  for (let i = 0; i < cuts.length; i++) {
    const k = cuts[i];
    await ev((t) => app.player.seek(t), starts[i]); await check('seek(cut ' + k + ')', k, i + 1);
    await ev((t) => app.player.seek(t, { exact: true }), starts[i]); await check('seek(cut ' + k + ', exact)', k, i + 1);
    await ev((k) => app.player.seekFrame(k), k); await check('seekFrame(' + k + ')', k, i + 1);
    await ev(() => app.player.step(-1)); await check('step(-1) from ' + k, k - 1, i);
    await ev(() => app.player.step(1)); await check('step(+1) back onto ' + k, k, i + 1);
    await ev((k) => app.player.seekFrame(k), k); await ev(() => app.player.seek(app.player.timeOfFrame(app.player.frame))); await check('seek to where it is (' + k + ')', k, i + 1);
  }
  console.log(`${clipBad ? 'FAIL' : 'ok  '} ${clip.split(/[\/]/).pop()}: ${clipBad} wrong of the readings so far`);
}
console.log(`${bad} wrong of ${n} readings`);
await b.close();
process.exit(bad ? 1 : 0);
