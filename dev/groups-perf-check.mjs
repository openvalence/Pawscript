// dev/groups-perf-check.mjs -- paw-m2cg perf budget for the active-group highlight, in YOUR test instance (CDP_* env): on a GENERATED
// 1080p picture with a dozen groups it selects / assigns 60 groups in sequence (the picker open each time), idles 5 s, paints a
// stroke with a group highlighted, and reports frame time, script time per frame (rAF callbacks), live rAF callbacks / timers,
// long tasks and the JS heap before / after.
//   node dev/groups-perf-check.mjs <folder with the 1080p image> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  // (and the start-up tab restore done: a tab it reopens shows when it lands, window.app with it; check-all.mjs ready())
  await page.reload(); await page.waitForFunction(() => window.app?.commands && (!window.appTabs || window.appTabs.restored || !!window.app.dialog), null, { timeout: 60000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 20000 });
  await ev(() => { const G = app.labelling.G; for (let k = G.groups.length - 1; k >= 0; k--) G.remove(k); app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.brush', 0.05); app.settings.set('tracking.groups.compact', true); app.settings.set('tracking.groups.corner', 'tr'); });
  await wait(500);
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (fx, fy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + fx * r.iw * s, oy + fy * r.ih * s]; };
  const stroke = async (a, b) => { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); for (let k = 1; k <= 6; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 6, y0 + ((y1 - y0) * k) / 6); await page.mouse.up(); await wait(100); };
  await page.keyboard.press('1');
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) await stroke([(c + 0.43) / 4, (r + 0.5) / 3], [(c + 0.57) / 4, (r + 0.5) / 3]);
  ok((await ev(() => app.labelling.G.groups.length)) === 12, '12 groups painted');
  // instrumentation: live rAF callbacks / timers, script time inside rAF callbacks, long tasks, frame deltas
  await ev(() => {
    const T = (window.__perf = { liveRaf: new Set(), maxRaf: 0, script: 0, frames: [], long: [], timers: new Set(), maxTimers: 0, last: 0 });
    const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => { const id = raf((t) => { T.liveRaf.delete(id); const a = performance.now(); try { f(t); } finally { T.script += performance.now() - a; } }); T.liveRaf.add(id); T.maxRaf = Math.max(T.maxRaf, T.liveRaf.size); return id; };
    window.cancelAnimationFrame = (id) => { T.liveRaf.delete(id); cancel(id); };
    const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
    window.setInterval = (...a) => { const id = si(...a); T.timers.add(id); T.maxTimers = Math.max(T.maxTimers, T.timers.size); return id; };
    window.clearInterval = (id) => { T.timers.delete(id); ci(id); };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => T.long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
    const loop = (t) => { if (T.last) T.frames.push(t - T.last); T.last = t; raf(loop); };
    raf(loop);
  });
  // what stays: a full GC first (CDP; WebView2 has no window.gc), else the garbage not yet collected reads as growth or shrink
  // (-32.1 then +27.1 MB on two shard runs, paw-mawd)
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await wait(300); return ev(() => Math.round(performance.memory.usedJSHeapSize / 1e6 * 10) / 10); };
  const mark = () => ev(() => { const T = window.__perf; T.script = 0; T.frames = []; });
  const read = () => ev(() => { const T = window.__perf, f = T.frames.slice().sort((a, b) => a - b); return { frames: f.length, medianMs: +(f[f.length >> 1] || 0).toFixed(1), p95Ms: +(f[Math.floor(f.length * 0.95)] || 0).toFixed(1), scriptPerFrameMs: +(T.script / Math.max(1, f.length)).toFixed(2), liveRaf: T.liveRaf.size, maxRaf: T.maxRaf, timers: T.timers.size, long: T.long.slice() }; });
  const h0 = await heap();
  for (let round = 0; round < 5; round++) {   // 60 selections / picker passes
    for (let k = 0; k < 12; k++) {
      await ev((k) => { const G = app.labelling.G; G.pick(k); G.openPicker(k, null, false); }, k);
      await wait(40);
      await ev(() => app.labelling.G.closePicker());
    }
  }
  await ev(() => app.labelling.G.openPicker(3, null, false)); await wait(300);   // leave one open: the heaviest state
  await mark(); await wait(5000);
  const idle = await read();
  console.log('assigning, idle 5 s:', JSON.stringify(idle));
  ok(idle.liveRaf <= 1 && idle.timers <= 1, `live rAF callbacks ${idle.liveRaf} (max seen ${idle.maxRaf}), timers ${idle.timers}`);
  ok(idle.scriptPerFrameMs < 4, `script per frame ${idle.scriptPerFrameMs} ms while idle`);
  ok(idle.medianMs < 20, `frame time ${idle.medianMs} ms (p95 ${idle.p95Ms})`);
  await ev(() => app.labelling.G.closePicker()); await mark(); await wait(2000);
  console.log('selected, idle 2 s:', JSON.stringify(await read()));
  // painting with a highlighted group
  await ev(() => app.labelling.G.pick(5)); await mark();
  await stroke([0.2, 0.2], [0.35, 0.3]); await stroke([0.55, 0.5], [0.7, 0.55]);
  console.log('after two strokes:', JSON.stringify(await read()));
  await wait(500);
  const h1 = await heap();
  console.log(`heap ${h0} -> ${h1} MB`);
  const r = await read();
  ok(r.long.every((d) => d <= 50), `long tasks: ${JSON.stringify(r.long)}`);
  ok(h1 - h0 < 20, `heap growth ${(h1 - h0).toFixed(1)} MB over 60 selections`);
  await ev(() => app.labelling.leave());
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
