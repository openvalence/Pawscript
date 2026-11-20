// paw-dy3t probe (not a check): in YOUR test instance with the REAL sidecar (dev/test-app.mjs start ... --real-tracker),
// for each fresh VP8 WebM: open it, Ctrl+2, click the video, T (real CDP keys / mouse); record the job (stages, time), the
// runs, their points, toasts and console errors. A first T that ends with no run and no message is the bug.
//   node dev/dy3t-first-t.mjs <clip.webm> [<clip2.webm> ...]
import { resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const clips = process.argv.slice(2).map((p) => resolve(p));
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + String(e.message).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ` + m.text().slice(0, 200)); });
let silent = 0;
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 60000 });
  await ev(() => {
    window.__toasts = [];
    const t = app.toast.bind(app);
    app.toast = (msg, kind, o) => { window.__toasts.push({ msg: String(msg), kind }); return t(msg, kind, o); };
    clearInterval(window.__noDlg);
    window.__noDlg = setInterval(() => { const d = app.dialog; if (d) d.resolve(/^Recover|Save changes/.test(d.title || '') ? 'discard' : d.choices?.[0]?.id ?? null); }, 200);
  });
  for (const [k, clip] of clips.entries()) {
    errs.length = 0;
    await ev(() => { window.__toasts.length = 0; });
    await ev((p) => app.project.openVideo(p, { force: true }), clip).catch((e) => console.log('open:', String(e).slice(0, 120)));
    await page.waitForFunction(() => (app.doc.media?.durationMs || 0) > 20000 && app.player.ready, null, { timeout: 90000 });
    await ev(() => app.player.pause());
    await wait(1500);
    const before = await ev(() => ({ scenes: app.doc.scenes.length, mode: app.mode, runs: __pawDev.trackingFor(app).runs.length }));
    await page.keyboard.press('Control+Digit2'); await wait(600);
    const vb = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] canvas.ov, [data-testid="video-stage"] video').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(...vb); await wait(400);
    const mode = await ev(() => app.mode);
    console.log('   at T: ' + JSON.stringify(await ev(() => { const tr = __pawDev.trackingFor(app); return { busy: tr.busy, trackers: tr.trackers.length, grid: tr.gridTracker?.id ?? null, canGrid: tr.canGrid, videoPath: !!tr.videoPath, locked: !!tr.locked, winner: app.commands.winner?.('T') ?? null, media: app.doc.media?.path?.split(/[\\/]/).pop() }; })));
    const t0 = Date.now();
    await page.keyboard.press('KeyT');
    const stages = [];
    let started = false, last = '';
    for (;;) {
      const s = await ev(() => { const tr = __pawDev.trackingFor(app); return { busy: tr.busy, stage: tr.progress?.stage || '' }; });
      if (s.busy) started = true;
      const tag = `${s.busy}/${s.stage}`;
      if (s.busy && tag !== last) { stages.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${tag}`); last = tag; }
      if ((started && !s.busy) || Date.now() - t0 > (started ? 300000 : 8000)) break;
      await wait(250);
    }
    await wait(1500);
    const after = await ev(() => {
      const tr = __pawDev.trackingFor(app);
      return { runs: tr.runs.length, pts: tr.runs.map((r) => r.points?.length ?? null), scenes: app.doc.scenes.length, docPts: app.doc.points?.length ?? null,
        toasts: window.__toasts.map((t) => `${t.kind}: ${t.msg.slice(0, 120)}`) };
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const bad = started && after.runs === before.runs && after.toasts.length === 0;
    if (bad) silent++;
    console.log(`#${k + 1} ${clip.split(/[\\/]/).pop()}: before ${JSON.stringify(before)}, mode after Ctrl+2 ${mode}, job ${started ? secs + ' s' : 'never started'}`);
    console.log(`   stages: ${stages.join(' | ')}`);
    console.log(`   after: ${JSON.stringify(after)}`);
    if (errs.length) console.log(`   console: ${JSON.stringify(errs.slice(0, 8))}`);
    console.log(bad ? '   SILENT: no run, no message' : '   ok: a run or a message');
  }
} finally { await browser.close(); }
console.log(silent ? `${silent} silent first T` : 'no silent first T');
process.exit(silent ? 1 : 0);
