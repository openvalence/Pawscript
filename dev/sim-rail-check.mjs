// dev/sim-rail-check.mjs -- paw-gwmd, the machine preview's rail in YOUR test instance (node dev/test-app.mjs start ...; the CDP_*
// env it prints), on a generated clip of at least 14 s at 30 fps (ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 -t 16 ...).
// A known script on stroke (0 <-> 100: 300 ms half strokes to 8 s, then 400 ms), read from the painted canvas:
//  1. paused on frames: the meteor's light core is at the script position of the frame shown (its rows' centroid);
//  2. on a turn's own frame a light pulse is painted beside the rail at the turn (absent one frame before), drawn state too;
//  3. the incoming trace moves leftward over time: a peak 100 ms later sits 100 ms worth of px closer to the rail;
//  4. playing: every drawn frame is the frame shown (simDebug.t = player.shownMs) and its head = posAt there; pulses seen.
// Screenshots of the video and the panel into <out dir>. Every page exception and console error fails it.
//   node dev/sim-rail-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { simGeometry, GLOW_FAST } from '../src/features/video/simdraw.js';

const [clip, out] = process.argv.slice(2);
if (!clip || !out) { console.error('usage: node dev/sim-rail-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });

const SCRIPT = [];
for (let t = 0, up = true; t <= 15600; up = !up) { SCRIPT.push({ at: t, pos: up ? 0 : 100 }); t += t < 8000 ? 300 : 400; }
const posAt = (s, t) => { let i = s.findIndex((a) => a.at >= t); if (i < 0) return s.at(-1).pos; if (i === 0) return s[0].pos; const a = s[i - 1], b = s[i]; return a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at); };

/** Seek (paused) and wait for that frame to be on screen and drawn; then the panel's geometry and a pixel reader. */
async function at(ms) {
  await ev((m) => app.player.seek(m, { exact: true }), ms);
  await page.waitForFunction((m) => Math.abs(app.player.shownMs - m) < 20 && Math.abs(window.__pawDev.simDebug.t - app.player.shownMs) < 0.01, ms, { timeout: 10000 });
  await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const p = await ev(() => {
    const cv = document.querySelector('.vsim .graph canvas'), r = cv.getBoundingClientRect(), d = cv.width / r.width;
    const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    window.__img = { img, d };
    return { t: app.player.shownMs, d, w: r.width, h: r.height, lead: app.player.ui.simLead, dbg: { ...window.__pawDev.simDebug } };
  });
  // the rail's geometry as the app lays it out (simdraw.js simGeometry: the head 2x wider since 863533f, the owner's ask)
  const g = simGeometry({}, p.w, p.h, p.lead, 'right');
  return { ...p, hw: g.hw, nowX: g.nowX, top: g.top, bot: g.bot, ppm: g.ppm };
}
/** [r, g, b, a] at css (x, y) of the last read frame. */
const px = (x, y) => ev(([x, y]) => { const { img, d } = window.__img, i = (Math.floor(y * d) * img.width + Math.floor(x * d)) * 4; return [...img.data.slice(i, i + 4)]; }, [x, y]);
/** The light core's centre row (css px) in the column at css x: rows where every channel is > 200. */
const coreY = (g, x) => ev(([x, y0, y1]) => {
  const { img, d } = window.__img, cx = Math.floor(x * d); let s = 0, n = 0;
  for (let y = Math.floor(y0 * d); y < Math.ceil(y1 * d); y++) { const i = (y * img.width + cx) * 4; if (Math.min(img.data[i], img.data[i + 1], img.data[i + 2]) > 200) { s += y + 0.5; n++; } }
  return n ? s / n / d : NaN;
}, [x, g.top - 3, g.bot + 3]);
/** The x (css) of the first peak of the trace right of the head: the column whose topmost lit pixel is highest. */
const peakX = (g) => ev(([x0, x1, y0, y1]) => {
  const { img, d } = window.__img; let best = Infinity, bx = NaN;
  for (let x = Math.ceil(x0 * d); x < Math.floor(x1 * d); x++) {
    let yt = Infinity;
    for (let y = Math.floor(y0 * d); y < Math.ceil(y1 * d); y++) { const i = (y * img.width + x) * 4; if (Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) > 70) { yt = y; break; } }
    if (yt < best - 0.5) { best = yt; bx = x; } else if (yt > best + 3 && Number.isFinite(bx)) break;   // past the first peak
  }
  return bx / d;
}, [g.nowX + GLOW_FAST + 2, g.w - 8, g.top - 1, g.bot + 2]);   // right of the head's glow (radius up to GLOW_FAST; 2.2 hw was that before 863533f)

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.simDebug, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((s) => { app.transact('script', () => { app.doc.axes = { ...app.doc.axes, stroke: s }; }); app.doc.activeAxis = 'stroke'; app.player.setUi({ sim: true, simSide: 'right', simFold: false, simWidth: 200 }); app.project.stopAutosave?.(); }, SCRIPT);
  ok(await ev(() => app.durationMs >= 14000), `clip ${await ev(() => app.durationMs)} ms`);

  // 1. the head at the script position of the frame shown
  let worst = 0;
  for (const ms of [1000, 1100, 1167, 2533, 4000, 8233, 9100, 12367]) {
    const g = await at(ms), y = await coreY(g, g.nowX + 0.4 * g.hw), pos = ((g.bot - y) / (g.bot - g.top)) * 100, want = posAt(SCRIPT, g.t);
    const errPx = Math.abs(pos - want) * (g.bot - g.top) / 100;
    worst = Math.max(worst, errPx);
    if (errPx > 1.5) console.log(`     t ${g.t.toFixed(1)}: painted ${pos.toFixed(2)} want ${want.toFixed(2)} (${errPx.toFixed(2)} px)`);
  }
  ok(worst <= 1.5, `the painted head is on the script at the frame shown (worst ${worst.toFixed(2)} px over 8 frames)`);

  // 2. a pulse on the turn's own frame (and not the frame before), beside the rail where the head's bar does not reach
  for (const turn of [2100, 3000, 9300]) {
    const tp = posAt(SCRIPT, turn);
    const before = await at(turn - 33.4), y = before.top + (1 - tp / 100) * (before.bot - before.top), xs = Math.max(1, before.nowX - 1.35 * before.hw);   // (the pulse spans the head +-1.6 hw, cut by the canvas edge on the rail's side)
    const b0 = await px(xs, y);
    const on = await at(turn), b1 = await px(xs, y);
    ok(on.dbg.pulse > 0.3 && before.dbg.pulse === 0 && b1[2] - b0[2] > 25,
      `turn at ${turn} ms (pos ${tp}): pulse drawn ${on.dbg.pulse.toFixed(2)} (frame before ${before.dbg.pulse}), painted beside the rail blue ${b0[2]} -> ${b1[2]}`);
    if (turn === 3000) await page.screenshot({ path: join(out, 'rail-turn-pulse.png'), clip: await ev(() => { const r = document.querySelector('.vsim').parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  }

  // 3. the trace moves leftward: 100 ms later the next peak is 100 ms worth closer to the rail
  const g1 = await at(1700), x1 = await peakX(g1);
  await page.screenshot({ path: join(out, 'rail-mid-stroke.png'), clip: await ev(() => { const r = document.querySelector('.vsim').parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  const g2 = await at(1800), x2 = await peakX(g2);
  const want = (g2.t - g1.t) * g1.ppm;
  ok(Math.abs((x1 - x2) - want) <= 2, `the peak at 2100 ms: x ${x1.toFixed(1)} -> ${x2.toFixed(1)} css px (moved ${(x1 - x2).toFixed(1)} left, ${want.toFixed(1)} expected)`);
  ok(Math.abs(x1 - (g1.nowX + (2100 - g1.t) * g1.ppm)) <= 3, `and it sits where its time puts it (${x1.toFixed(1)} vs ${(g1.nowX + (2100 - g1.t) * g1.ppm).toFixed(1)})`);

  // 4. playing: every drawn frame is the frame shown, its head on the script; pulses seen
  await at(9000);
  const play = await ev(async (s) => {
    const posAt = (s, t) => { let i = s.findIndex((a) => a.at >= t); if (i < 0) return s.at(-1).pos; if (i === 0) return s[0].pos; const a = s[i - 1], b = s[i]; return a.pos + ((b.pos - a.pos) * (t - a.at)) / (b.at - a.at); };
    const D = window.__pawDev.simDebug, r = { frames: 0, offFrame: 0, worst: 0, pulses: 0, last: NaN, inRaf: 0 };
    let on = true;
    // read once the frame's rendering is done (a task after this rAF): the rail draws in its own rAF, queued after this loop's in
    // the frame where the video presented a new picture, so a read inside this rAF sees the previous draw against the new frame
    // (the shown time only moves in the video's frame callback, part of the rendering, so it cannot move before the read)
    const read = () => { if (D.t !== r.last) { r.last = D.t; r.frames++; if (Math.abs(D.t - app.player.shownMs) > 0.01) r.offFrame++; r.worst = Math.max(r.worst, Math.abs(D.drawnPos - posAt(s, D.t))); if (D.pulse > 0) r.pulses++; } };
    const loop = () => { if (!on) return; if (Math.abs(D.t - app.player.shownMs) > 0.01) r.inRaf++; setTimeout(read, 0); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    app.player.play();
    await new Promise((x) => setTimeout(x, 2500));
    app.player.pause(); on = false;
    return r;
  }, SCRIPT);
  ok(play.frames > 40 && play.offFrame <= 1 && play.worst < 1e-6 && play.pulses >= 6,
    `playing 2.5 s: ${play.frames} drawn frames, ${play.offFrame} not the frame shown, head off the script by ${play.worst.toExponential(1)}, ${play.pulses} frames with a pulse (read inside the rAF: ${play.inRaf} rAFs before the rail's draw)`);
  await at(10233);
  await page.screenshot({ path: join(out, 'rail-slower-section.png'), clip: await ev(() => { const r = document.querySelector('.vsim').parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });

  // 5. the panel on the left of the video with the machine preview on: mirrored, the head follows the planner
  await ev(() => { app.player.setUi({ simSide: 'left' }); app.settings.set('review.profile', 'nucleus-capstan'); app.setView({ start: 6000, span: 10000 }); app.devicePreview?.toggle(true); });
  await page.waitForFunction(() => app.devicePreview?.ghost, null, { timeout: 30000 }).catch(() => {});
  const gm = await at(10233);
  ok(gm.dbg.src === 'machine' && Number.isFinite(gm.dbg.drawnPos), `left side, machine preview: the head follows the ${gm.dbg.src} (drawn ${gm.dbg.drawnPos.toFixed(1)}, script ${gm.dbg.raw.toFixed(1)})`);
  await page.screenshot({ path: join(out, 'rail-machine-left.png'), clip: await ev(() => { const r = document.querySelector('.vsim').parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  await ev(() => { app.devicePreview?.toggle(false); app.player.setUi({ simSide: 'right' }); });
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exitCode = fails ? 1 : 0;
}
