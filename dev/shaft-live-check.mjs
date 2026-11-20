// dev/shaft-live-check.mjs -- paw-rxr3 in YOUR test instance (node dev/test-app.mjs start ... with FAKE_SHAFT_MS=30 in the
// environment, so the fake sidecar plays a shaft pass after the frames; the CDP_* env it prints), on a generated clip.
// A box track on the Track tab; while stage "shaft" runs: the page's label reads "NN % · shaft pass" and moves, the video
// steps through the scene (the playhead follows the pass), the outline is PAINTED on the overlay over the frame it was
// made for (its centre in the live colour, a point well outside it not), and afterwards the playhead is back where it was.
//   node dev/shaft-live-check.mjs <clip> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [clip, out] = process.argv.slice(2);
if (!clip || !out) { console.error('usage: node dev/shaft-live-check.mjs <clip> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });

try {
  await ev((p) => { app.project.openVideo(p, { force: true }); }, clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve('restore'); }); }
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__pawDev?.trackingFor && __pawDev.trackingFor(app).trackers?.length, null, { timeout: 60000 });
  await ev(() => { app.setMode('track'); app.player.pause(); app.player.seek(500, { exact: true }); });
  await wait(800);
  // the track runs in the page (not awaited here); the samples below read what is on screen while it goes
  await ev(() => {
    const tr = __pawDev.trackingFor(app), t = tr.trackers.find((x) => x.id === 'fake.box');
    window.__shaftRun = tr.runTrack(t, { start: 0, end: 4000 }, {}, { kind: 'box', x: 0.35, y: 0.35, w: 0.3, h: 0.3, t_ms: 500 }, [], { check: false });
  });
  await page.waitForFunction(() => __pawDev.trackingFor(app).progress.stage === 'shaft', null, { timeout: 60000 });
  const samples = [];
  for (let k = 0; k < 40; k++) {
    const s = await ev(() => {
      const tr = __pawDev.trackingFor(app), p = tr.progress, cv = document.querySelector('[data-testid="video-stage"] canvas.ov');
      if (p.stage !== 'shaft' || !p.outline || !tr.axisMap || !cv) return { stage: p.stage };
      const d = window.devicePixelRatio || 1, ctx = cv.getContext('2d');
      const cx = p.outline.reduce((a, q) => a + q[0], 0) / p.outline.length, cy = p.outline.reduce((a, q) => a + q[1], 0) / p.outline.length;
      const px = (nx, ny) => { const [x, y] = tr.axisMap(nx, ny); return [...ctx.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data]; };
      const label = [...document.querySelectorAll('body *')].map((e) => e.childElementCount ? '' : e.textContent).find((x) => /shaft pass/.test(x)) || '';
      return { stage: p.stage, at: p.at, t: app.player.timeMs, fm: app.player.frameMs, inside: px(cx, cy), outside: px(Math.min(0.98, cx + 0.3), Math.min(0.98, cy + 0.3)), label };
    });
    if (s.stage !== 'shaft') break;
    samples.push(s);
    if (samples.length === 6) await page.screenshot({ path: `${out}/shaft-pass.png` });
    await wait(120);
  }
  const onFrame = samples.filter((s) => s.inside && Math.abs(s.t - s.at) <= 1.5 * s.fm);
  ok(samples.length >= 5, `${samples.length} samples while the shaft pass ran`);
  const labels = [...new Set(samples.map((s) => (/(\d+) % · shaft pass/.exec(s.label) || [])[1]).filter(Boolean))];
  ok(labels.length >= 3, `the label moves: ${labels.slice(0, 8).join(', ')} % · shaft pass`);
  const ts = [...new Set(samples.map((s) => Math.round(s.t)))];
  ok(ts.length >= 3, `the video follows the pass: frames at ${ts.slice(0, 8).join(', ')} ms`);
  ok(onFrame.length >= 3, `${onFrame.length} samples show the frame the outline was made for`);
  const painted = onFrame.filter((s) => s.inside[3] > 40 && s.outside[3] < 20);
  ok(painted.length >= Math.max(3, 0.7 * onFrame.length), `the outline is painted (alpha inside ${onFrame.slice(0, 4).map((s) => s.inside[3]).join('/')}, outside ${onFrame.slice(0, 4).map((s) => s.outside[3]).join('/')}) on ${painted.length} / ${onFrame.length}`);
  const r = await ev(async () => { const r = await window.__shaftRun; return { run: !!r?.run, error: r?.error || null }; });
  ok(r.run, 'the track finished with a run ' + (r.error || ''));
  await wait(800);
  const back = await ev(() => ({ t: app.player.timeMs, stage: __pawDev.trackingFor(app).progress.stage, outline: __pawDev.trackingFor(app).progress.outline }));
  // since 4d350ff (paw-d8eo) the playhead goes back where it was parked before the track (500 ms), not to the last tracked frame
  ok(Math.abs(back.t - 500) <= 40, `the playhead is back where it was parked (${Math.round(back.t)} ms, parked at 500 ms)`);
} catch (e) { fails++; console.log('ERR', e); }
await b.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
