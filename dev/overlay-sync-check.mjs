// dev/overlay-sync-check.mjs -- paw-osat "tracker data and frames are drawn independently, rather than simultaneously, so they can
// drift or have a small delay", in YOUR test instance (node dev/test-app.mjs start ...). On the numbered clips of dev/assets
// (make-clips.sh: every frame carries its index as a 12-bit code, 20 px squares along the top of a 640 x 360 picture, LSB left),
// a probe drawer on the shared overlay layer (app.player.overlays, the layer every overlay over the video draws on: tracked
// points, group markers, painted groups, the shaft) paints the index of the frame IT draws for as the same code, red on black,
// one row lower. While the video plays, the page's compositor frames are recorded (CDP Page.startScreencast: every frame the
// window shows, nothing skipped while acked) and both codes are read back from each: offset = overlay frame - picture frame.
// Also counted: overlay draws per second and the cost of a draw (every drawer, timed), and the position bar's clock (the
// time it evaluates, as frames from the frame presented). Asserts every recorded frame has offset 0 and the position bar
// evaluates the presented frame.
//   node dev/overlay-sync-check.mjs <dir with cfr24.mp4 cfr30.mp4 cfr60.mp4> [--clips cfr24,cfr30,cfr60] [--rates 0.5,1,2] [--secs 3]
//     [--proxy (each on its 240p proxy)] [--zoom (timeline zoomed in: it scrolls)] [--track (Track tab)] [--report <json>] [--dump <dir>]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const args = process.argv.slice(2), dir = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (!dir) { console.error('usage: node dev/overlay-sync-check.mjs <clip dir> [--rates 0.5,1,2] [--proxy] [--report <json>]'); process.exit(2); }
const RATES = opt('rates', '0.5,1,2').split(',').map(Number), CLIPS = opt('clips', 'cfr24,cfr30,cfr60').split(','), PROXY = args.includes('--proxy'), SECS = +opt('secs', 3);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.[0]?.id ?? null); });
const cdp = await page.context().newCDPSession(page);
const report = [];

// the probe drawer: the code of env.frame, red on a black strip (stage px through env.map); timing of every drawer; the position bar's t
async function install() {
  await ev(() => {
    const L = app.player.overlays, P = (window.__sync = { draws: 0, ms: 0, posbar: [] });
    const sq = (ctx, env, b, on) => { const [x0, y0] = env.map((12 + b * 25) / 640, 48 / 360), [x1, y1] = env.map((32 + b * 25) / 640, 68 / 360); ctx.fillStyle = on ? '#ff0000' : '#000000'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); };
    L.add({ id: 'sync.probe', order: 99999, draw: (ctx, env) => {
      const t0 = performance.now();
      const [a0, b0] = env.map(8 / 640, 44 / 360), [a1, b1] = env.map(312 / 640, 72 / 360);
      ctx.fillStyle = '#000000'; ctx.fillRect(a0, b0, a1 - a0, b1 - b0);
      for (let b = 0; b < 12; b++) sq(ctx, env, b, (env.frame >> b) & 1);
      P.draws++; P.ms += performance.now() - t0;
      P.map = [env.map(0, 0), env.map(1, 1)];
    } });
    // time every drawer: the cost of a draw
    for (const d of L.drawers) if (!d.__timed && d.id !== 'sync.probe') { const f = d.draw; d.draw = (ctx, env) => { const t = performance.now(); try { return f(ctx, env); } finally { P.ms += performance.now() - t; } }; d.__timed = true; }
    // the position bar: the time it draws for, against the frame presented (its canvas' data-pos encodes t: a ramp script 0..100 over the video)
  });
}

// record the window while playing: screencast frames (jpeg) with the probe's counters
async function record(ms) {
  const frames = [];
  const on = (f) => { frames.push(f.data); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); };
  cdp.on('Page.screencastFrame', on);
  await ev(() => { __sync.draws = 0; __sync.ms = 0; __sync.t0 = performance.now(); __sync.rvfc = 0; const el = app.player.el, f = () => { __sync.rvfc++; if (__sync.live) el.requestVideoFrameCallback(f); }; __sync.live = true; el.requestVideoFrameCallback(f); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
  await wait(ms);
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', on);
  const c = await ev(() => { __sync.live = false; const s = (performance.now() - __sync.t0) / 1000; return { drawsPerS: __sync.draws / s, msPerDraw: __sync.draws ? __sync.ms / __sync.draws : 0, rvfcPerS: __sync.rvfc / s, dropped: app.player.stats.dropped, total: app.player.stats.total }; });
  return { frames, ...c };
}

// read both codes from each recorded frame (decoded in the page once playback stopped)
async function decode(frames) {
  const out = [];
  for (let i = 0; i < frames.length; i += 20) {
    out.push(...await ev(async (chunk) => {
      const [p0, p1] = __sync.map, st = document.querySelector('[data-testid="video-stage"]').getBoundingClientRect();
      const res = [];
      for (const b64 of chunk) {
        const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob());
        const k = bmp.width / window.innerWidth, c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const px = (nx, ny) => { const x = (st.left + p0[0] + nx * (p1[0] - p0[0])) * k, y = (st.top + p0[1] + ny * (p1[1] - p0[1])) * k; return g.getImageData(Math.round(x), Math.round(y), 1, 1).data; };
        let pic = 0, ov = 0, okPic = true, okOv = true;
        for (let b = 0; b < 12; b++) {
          const a = px((22 + b * 25) / 640, 18 / 360), r = px((22 + b * 25) / 640, 58 / 360);
          const white = a[0] > 150 && a[1] > 150 && a[2] > 150, black = a[0] < 90 && a[1] < 90 && a[2] < 90;
          if (white) pic |= 1 << b; else if (!black) okPic = false;
          const red = r[0] > 150 && r[1] < 90 && r[2] < 90, dark = r[0] < 90 && r[1] < 90 && r[2] < 90;
          if (red) ov |= 1 << b; else if (!dark) okOv = false;
        }
        res.push(okPic && okOv ? { pic, ov } : null);
      }
      return res;
    }, frames.slice(i, i + 20)));
  }
  return out;
}

const hist = (xs) => { const h = {}; for (const x of xs) h[x] = (h[x] || 0) + 1; return h; };
try {
  await page.waitForFunction(() => window.app && app.player, null, { timeout: 60000 });
  await ev(() => app.player.setUi({ hud: false }));   // the HUD's rate badge sits on the picture's code
  // ... and the first-run hint line (710c7ab, paw-kxwz: on in a fresh profile, over the top of the picture) covers the code band
  await ev(() => app.settings.set('onboard.hints', false));
  for (const name of CLIPS) {
    const clip = join(dir, name + '.mp4');
    const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
    for (let k = 0; k < 6; k++) { await wait(400); await answer(); }
    await p.catch(() => {});
    await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
    if (PROXY) {
      await ev(() => app.player.makeProxy(240));
      await page.waitForFunction(() => app.player.proxyH === 240 && app.player.ready, null, { timeout: 120000 });
    }
    if (args.includes('--zoom')) for (let k = 0; k < 6; k++) await ev(() => app.commands.run('view.zoomIn'));   // a short span: the timeline scrolls while it plays
    if (args.includes('--track')) await ev(() => app.setMode('track'));
    await install();
    if (name === CLIPS[0]) {   // the position bar draws on an animation frame asked for from the video frame callback: the same display frame?
      const same = await ev(() => new Promise((res) => { const el = app.player.el, out = []; const f = (now) => { requestAnimationFrame((ts) => { out.push(ts === now); if (out.length < 20) el.requestVideoFrameCallback(f); else { app.player.pause(); res(out); } }); }; el.requestVideoFrameCallback(f); app.player.play(); }));
      await wait(300);
      ok(same.every(Boolean), `an animation frame asked for in a video frame callback runs in that display frame (${same.filter(Boolean).length}/${same.length})`);
    }
    // paused / stepping: exact today, must stay exact
    for (const k of [10, 11, 37]) {
      await ev((k) => app.player.seekFrame(k), k); await page.waitForFunction(() => !app.player.seeking, null, { timeout: 10000 }); await wait(250);
      const r = await record(250), d = (await decode(r.frames.slice(-2))).filter(Boolean);
      ok(d.length && d.every((x) => x.pic === k && x.ov === k), `${name}${PROXY ? ' proxy' : ''} paused on frame ${k}: picture and overlay ${JSON.stringify(d)}`);
    }
    for (const rate of RATES) {
      await ev((r) => { app.player.setRate(r); app.player.seekFrame(0); }, rate);
      await page.waitForFunction(() => !app.player.seeking, null, { timeout: 10000 }); await wait(200);
      await ev(() => app.player.setLoop({ t0: 0, t1: app.durationMs }));   // a short clip at 2x: never ends while recorded
      await ev(() => app.player.play());
      await wait(300);
      const v0 = await ev(() => app.view?.start);
      const r = await record(SECS * 1000);
      const paint = await ev(() => new Promise((res) => {   // the cost of copying the frame on screen to a canvas, as the player now does per frame playing
        const el = app.player.el, c = Object.assign(document.createElement('canvas'), { width: app.player.vw, height: app.player.vh }), g = c.getContext('2d'), ts = [];
        const f = () => { const t = performance.now(); g.drawImage(el, 0, 0, c.width, c.height); ts.push(performance.now() - t); if (ts.length < 30 && !el.paused) el.requestVideoFrameCallback(f); else res(ts.sort((a, b) => a - b)[ts.length >> 1]); };
        el.requestVideoFrameCallback(f); setTimeout(() => res(ts.length ? ts.sort((a, b) => a - b)[ts.length >> 1] : NaN), 2000);   // the clip may end first
      }));
      const view = await ev(() => app.view?.start);
      await ev(() => app.player.pause()); await wait(300);
      const d = await decode(r.frames), good = d.filter(Boolean), off = good.map((x) => x.ov - x.pic);
      if (opt('dump', null) && r.frames.length) writeFileSync(join(opt('dump'), `${name}${PROXY ? '-proxy' : ''}-${rate}x.jpg`), Buffer.from(r.frames[Math.floor(r.frames.length / 2)], 'base64'));
      const row = { clip: name, proxy: PROXY, rate, recorded: r.frames.length, read: good.length, offsets: hist(off), drawsPerS: +r.drawsPerS.toFixed(1), rvfcPerS: +r.rvfcPerS.toFixed(1), msPerDraw: +r.msPerDraw.toFixed(3), copyMs: +(+paint).toFixed(3), scrolled: view !== v0, dropped: `${r.dropped}/${r.total}` };
      report.push(row);
      console.log('     ' + JSON.stringify(row));
      ok(good.length >= 10 && off.every((x) => x === 0), `${name}${PROXY ? ' proxy' : ''} ${rate}x: overlay frame = picture frame on every recorded frame (${good.length} read, offsets ${JSON.stringify(hist(off))})`);
    }
    await ev(() => { app.player.setRate(1); app.player.setLoop(null); app.player.overlays.remove('sync.probe'); });
  }
} catch (e) { fails++; console.log('FAIL', e.message); }
const rep = opt('report', null);
if (rep) writeFileSync(rep, JSON.stringify(report, null, 1));
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
