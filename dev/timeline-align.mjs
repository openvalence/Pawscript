// dev/timeline-align.mjs -- in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), a video
// with scenes open: the Scenes tab, the playhead parked on a scene's first frame; at devicePixelRatio 1.5 and 2, three
// zoom levels and fractional pans, read where the scene line (Scenes row), the filmstrip line (from a screenshot: the
// filmstrip's frames make its canvas unreadable) and the playhead element are PAINTED and check they sit at the one
// time -> x mapping, together (paw-ef73.7). Exits 1 if any is off by more than 0.2 CSS px.
import { connectTestApp } from './cdp-connect.mjs';
const { browser: b, page } = await connectTestApp();
const cdp = await page.context().newCDPSession(page);
const ev = (f, a) => page.evaluate(f, a);
let worst = 0, n = 0;
await ev(() => { app.setMode('scenes'); const s = document.createElement('style'); s.id = 'align-nohead'; document.head.append(s); });
const cut = await ev(() => { const L = app.doc.scenes; const i = L.findIndex((s, k) => k > 3 && s.join !== true); app.player.pause(); app.player.seek(L[i].start_ms); return L[i].start_ms; });
for (const dpr of [1.5, 2]) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: dpr, mobile: false });
  await page.waitForTimeout(800);
  for (const span of [60000, 6000, 600]) {
    for (const k of [0, 1, 2, 3]) {
      // the playhead element where it is painted (its box), then hidden for the pixel reads of the lines under it
      const g = await ev(async ({ cut, span, k }) => {
        document.getElementById('align-nohead').textContent = '';
        app.setView({ start: cut - span * 0.4 + k * 0.37 * (span / 600), span });
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 80))));
        const v = app.view, sc = document.querySelector('[data-tl-lane=scenes] canvas').getBoundingClientRect(), fs = document.querySelector('[data-tl-lane=filmstrip] canvas').getBoundingClientRect();
        const hd = document.querySelector('[data-tl-lane=filmstrip] .head').getBoundingClientRect();
        document.getElementById('align-nohead').textContent = '.head { visibility: hidden !important }';
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const want = (r) => r.left + ((cut - v.start) / v.span) * r.width;
        return { left: Math.floor(sc.left), top: Math.floor(sc.top), w: Math.floor(sc.width), yS: sc.top + sc.height * 0.76, yF: fs.top + 4, wantS: want(sc), wantF: want(fs), head: hd.left + hd.width / 2, wantH: fs.left + ((app.player.timeMs - v.start) / v.span) * fs.width };
      }, { cut, span, k });
      const H = Math.ceil(g.yF - g.top) + 2;
      const png = (await page.screenshot({ clip: { x: g.left, y: g.top, width: g.w, height: H }, scale: 'device' })).toString('base64');
      const m = await ev(async ({ png, g, dpr: _ }) => {
        let dpr;
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
        dpr = bmp.width / g.w;   // the screenshot's own scale
        const at = (ycss, want) => {
          const y = Math.floor((ycss - g.top) * dpr), x0 = Math.max(0, Math.floor((want - 2.5 - g.left) * dpr)), x1 = Math.min(bmp.width - 1, Math.ceil((want + 2.5 - g.left) * dpr));
          const px = x.getImageData(x0, y, x1 - x0 + 1, 1).data, lum = [];
          for (let i = 0; i < px.length; i += 4) lum.push(px[i] + px[i + 1] + px[i + 2]);
          const lo = Math.min(...lum); let sw = 0, sx = 0;
          lum.forEach((l, i) => { const wt = l - lo; sw += wt; sx += wt * (x0 + i + 0.5); });
          return sw ? g.left + sx / sw / dpr : NaN;
        };
        return { scenes: at(g.yS, g.wantS), film: at(g.yF, g.wantF) };
      }, { png, g, dpr });
      const r = { scenes: [m.scenes, g.wantS], film: [m.film, g.wantF], playhead: [g.head, g.wantH] };
      const d = Math.max(...Object.values(r).map(([a, w]) => Math.abs(a - w)));
      worst = Math.max(worst, Number.isFinite(d) ? d : 99); n++;
      if (k === 0 || !(d <= 0.2)) console.log(`dpr ${dpr} span ${span / 1000} s pan ${k}: ` + Object.entries(r).map(([nm, [a, w]]) => `${nm} ${a.toFixed(2)} (want ${w.toFixed(2)})`).join(' · '));
    }
  }
}
await ev(() => document.getElementById('align-nohead')?.remove());
await cdp.send('Emulation.clearDeviceMetricsOverride');
console.log(`${n} views, worst offset ${worst.toFixed(3)} CSS px`);
await b.close();
process.exit(worst <= 0.2 ? 0 : 1);
