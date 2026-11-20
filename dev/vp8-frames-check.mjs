// dev/vp8-frames-check.mjs -- paw-b88b in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints): the
// frames of a WebM / VP8 video (ffmpeg's MP4 muxer has no tag for VP8: the stream copy the frame reader used failed, and Copy
// from… compared only the frame on screen). The scrub cache is turned off, so the reader has nothing cached to fall back on.
//   patched shell (dev/patches/paw-b88b-remux.patch): hover scrub decodes frames (an H.264 transcode, avc1); Groups, paint
//     two shots, C on the third: both painted frames read and compared, many frames of the shot, no warning.
//   --unpatched (a shell without the patch): hover scrub falls back to seeks; C says "Frames of this video cannot be read yet:
//     make a proxy" (strip and one toast with "Make a proxy"), never ffmpeg's words; a 360p proxy made, C again: read and compared.
//   node dev/vp8-frames-check.mjs --make <clip.webm>
//   node dev/vp8-frames-check.mjs <clip.webm> <out dir> [--reload] [--unpatched]
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv[2] === '--make') {   // three 5 s shots, 640x360 25 fps VP8
  const src = 'testsrc=s=640x360:r=25:d=5[a];smptebars=s=640x360:r=25:d=5[b];testsrc2=s=640x360:r=25:d=5[c];[a][b][c]concat=n=3:v=1,format=yuv420p';
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-threads', '4', process.argv[3]], { stdio: 'inherit', windowsHide: true });
  process.exit(r.status);
}
const { connectTestApp } = await import('./cdp-connect.mjs');
const [clip, out] = process.argv.slice(2), unpatched = process.argv.includes('--unpatched');
const UNREADABLE = 'Frames of this video cannot be read yet: make a proxy';
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
if (process.argv.includes('--reload')) {   // a dist rebuilt from a scratch copy after start
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
}
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const logs = [];
page.on('console', (m) => { if (/\[frames\]|\[groups\]|\[video\]/.test(m.text())) logs.push(m.text()); });
try {
  await ev(async (p) => {
    clearInterval(window.__noRecover);
    window.__noRecover = setInterval(() => { if (app.dialog) app.dialog.resolve('discard'); }, 150);
    app.settings.set('video.scrubCache', false);
    window.__toasts = [];
    const t = app.toast.bind(app);
    app.toast = (msg, kind, o) => { window.__toasts.push({ msg: String(msg), kind, label: o?.action?.label || '' }); return t(msg, kind, o); };
    await app.project.openVideo(p, { force: true });
    window.__tr = window.__pawDev.trackingFor(app);
  }, clip);
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  ok(await ev(() => app.player.scrubCache == null), 'scrub cache off: nothing cached to read');
  // ---- hover scrub ----
  await ev(() => app.player.pause());
  for (const ms of [1000, 3000, 6000, 11000]) { await ev((t) => app.player.scrub(t), ms); await wait(250); }
  await page.waitForFunction(() => { const s = app.player.scrubStats; return s && (s.error || s.served > 0); }, null, { timeout: 120000, polling: 300 }).catch(() => {});
  for (const ms of [2000, 4000, 8000]) { await ev((t) => app.player.scrub(t), ms); await wait(300); }
  const ss = await ev(() => app.player.scrubStats);
  console.log('     hover scrub:', JSON.stringify(ss));
  if (unpatched) ok(!!ss?.error, 'hover scrub: no reader without the patch, it seeks');
  else ok(ss && !ss.error && ss.served > 0 && /^avc1/.test(ss.codec), 'hover scrub decodes the frames (an H.264 copy of the VP8)');
  // ---- Groups: paint shot 1 and shot 2, C on shot 3 ----
  await ev(() => { app.setMode('scenes'); app.player.pause(); });
  const det = await ev(async () => { const r = await __tr.detectScenes(); return { error: r?.error ?? null, cuts: app.doc.scenes.map((s) => s.start_ms) }; });
  ok(det.cuts.join() === '0,5000,10000', `Detect: three shots ${JSON.stringify(det)}`);
  await ev(() => { for (const [k, v] of Object.entries({ autoFromRepeats: false, brush: 0.03, grow: false, snap: false, circle: false, askAfter: false, corner: 'tl', compact: true })) app.settings.set('tracking.groups.' + k, v); });
  await ev(() => { app.setMode('track'); app.player.pause(); app.player.seek(2500, { exact: true }); });
  await wait(1500);
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); }); await wait(600);
  ok(await ev(() => !!document.querySelector('[data-testid="groups-tools"]')), 'Groups tool is on');
  const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
  const scribble = async (cx, cy, rx, ry) => { await page.mouse.move(...at(cx - rx, cy)); await page.mouse.down(); for (let k = 0; k <= 12; k++) await page.mouse.move(...at(cx - rx + (2 * rx * k) / 12, cy + (k % 2 ? ry : -ry))); await page.mouse.up(); await wait(300); };
  await scribble(0.42, 0.55, 0.025, 0.06);
  await ev(() => __pawDev.groupsFor(app).assign(0, { who: 'c1', part: 'hips' })); await wait(300);
  await ev(() => app.player.seek(7500, { exact: true })); await wait(1200);
  await scribble(0.5, 0.5, 0.04, 0.06);
  await ev(() => __pawDev.groupsFor(app).assign(0, { who: 'c2', part: 'head' })); await wait(300);
  const openC = async () => {
    await ev(() => app.player.seek(12500, { exact: true })); await wait(1200);
    await page.mouse.move(...at(0.5, 0.05));
    await page.keyboard.press('c');
    await page.waitForFunction(() => { const c = __pawDev.groupsFor(app).copy; return c && !c.busy; }, null, { timeout: 180000, polling: 300 }).catch(() => {});
    await wait(300);
    const st = await ev(() => __pawDev.groupsFor(app).copyStats), warn = await ev(() => document.querySelector('[data-testid="groups-copy-warn"]')?.textContent || '');
    const tiles = await ev(() => [...document.querySelectorAll('[data-testid="groups-copy-item"]')].map((e) => `${e.dataset.kind} ${e.querySelector('[data-testid="groups-copy-crop"]')?.textContent || ''}`));
    console.log('     search:', JSON.stringify(st), 'warn:', JSON.stringify(warn), 'tiles:', JSON.stringify(tiles));
    return { st, warn, tiles };
  };
  const good = (r, what) => ok(r.st && r.st.unread === 0 && r.st.sources >= 2 && r.st.frames > 10 && !r.st.warn && !r.warn, `${what}: both painted frames read and compared, ${r.st?.frames} frames of the shot, no warning`);
  let r = await openC();
  await page.screenshot({ path: `${out}/${unpatched ? 'unpatched' : 'patched'}-strip.png` });
  if (!unpatched) good(r, 'Copy from… on the VP8');
  else {
    ok(r.warn === UNREADABLE, 'the strip says it plainly: ' + JSON.stringify(r.warn));
    const ts = await ev(() => __toasts.filter((t) => t.msg === 'Frames of this video cannot be read yet: make a proxy'));
    ok(ts.length === 1 && ts[0].label === 'Make a proxy', 'one toast, with "Make a proxy" ' + JSON.stringify(ts));
    await page.keyboard.press('Escape'); await wait(300);
    r = await openC();
    ok(r.warn === UNREADABLE && (await ev(() => __toasts.filter((t) => t.msg.startsWith('Frames of this video')).length)) === 1, 'C again: the same line, no second toast');
    await page.keyboard.press('Escape'); await wait(300);
    await ev(() => app.player.makeProxy(360));
    await page.waitForFunction(() => app.player.proxyH === 360 && app.player.ready, null, { timeout: 180000, polling: 500 }).catch(() => {});
    ok(await ev(() => app.player.proxyH === 360), 'the 360p proxy plays');
    good(await openC(), 'Copy from… after the proxy (it reads the proxy)');
  }
  const seen = await ev(() => [document.body.innerText, ...__toasts.map((t) => t.msg)].join('\n'));
  ok(!/Could not find tag|\[mp4 @|ffmpeg failed/.test(seen), 'ffmpeg\'s words reach no toast and no strip');
  console.log('     console:', JSON.stringify(logs.slice(0, 6)));
  await page.keyboard.press('Escape'); await wait(300);
} finally { await b.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
