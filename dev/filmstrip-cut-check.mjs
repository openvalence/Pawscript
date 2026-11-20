// dev/filmstrip-cut-check.mjs -- paw-3fal: do the Scenes filmstrip's tiles either side of a cut show the frames either side of it?
// In YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on an index clip whose frames carry their own
// index as 16 x 2 cells across the MIDDLE of the picture (node dev/make-index-clip.mjs <out.mp4> 104 45 600), cuts at frames of
// every residue mod 9 (1192 + 100 k: the owner's 1192 first) and three frames (or more: see END) from each end of the video. For each cut the tiles
// are read out of a screenshot of the row (what is painted): the tile left of the cut must be the cut's frame - 1, the tile right
// of it the cut's frame; the first tile of the video frame 0, the last tile the last frame. Then a cut dragged by one frame (the
// tiles while the pointer is still down, and after the release), nudged by the . key, and (--perf) 30 cuts on screen: the time
// until every tile is exact, and the frame times of a pan and a zoom.
//   node dev/filmstrip-cut-check.mjs <clip> [--no-cache] [--perf] [--json out.json]
// Exits 1 when any tile is not the expected frame.
import { writeFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
const argv = process.argv.slice(2), opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const clip = argv[0], NOCACHE = argv.includes('--no-cache'), PERF = argv.includes('--perf'), jsonOut = opt('--json');
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const LIFT = 10, PAD = 2, BAND = [650 / 1400, 750 / 1400];   // filmstrip.js geometry; the clip's index rows

await ev(async ([p, cache]) => {
  clearInterval(window.__noRecover);   // "Recover unsaved work?" (an earlier run's autosave) can come late: always discard
  window.__noRecover = setInterval(() => { if (app.dialog) app.dialog.resolve('discard'); }, 150);
  window.__filmLast = null; globalThis.__pawFilmLog = (e) => { window.__filmLast = e; };   // the row's own word (none before paw-3fal)
  app.settings.set('video.scrubCache', cache);
  app.settings.set('lanes.hoverScrub', false);
  app.settings.set('timeline.frameCursor', 'off');
  await app.project.openVideo(p, { force: true });
}, [clip, !NOCACHE]);
for (let k = 0; k < 6; k++) { await wait(400); await ev(() => { if (app.dialog) app.dialog.resolve('discard'); }); }
await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
for (let k = 0; k < 8; k++) { await wait(250); await ev(() => { if (app.dialog) app.dialog.resolve('discard'); }); }
await ev(() => { app.setMode('scenes'); app.player.pause(); });
if (!NOCACHE) await page.waitForFunction(() => app.player.scrubCache?.state === 'ready', null, { timeout: 600000, polling: 1000 });
const info = await ev(() => ({ fps: app.player.media.fps, frameMs: app.player.frameMs, count: app.player.clock.count, dur: app.durationMs, cache: app.player.scrubCache?.state ?? null, aspect: app.doc.media.width / app.doc.media.height }));
console.log(JSON.stringify(info));
const fms = info.frameMs, at = (n) => Math.round(n * fms);   // where a cut at frame n is stored (lane.js frameTime)

/** Scenes with cuts at these frames (the stored shape: frame starts in integer ms). */
async function setCuts(cuts) {
  const B = [0, ...cuts, info.count];
  const list = B.slice(0, -1).map((n, i) => ({ start_ms: at(n), end_ms: i === B.length - 2 ? info.dur : at(B[i + 1]) }));
  await ev((l) => { app.transact('check cuts', () => { app.doc.scenes = l; }); app.player.seek(0); }, list);
  await wait(300);
}
const lane = () => ev(() => { const e = document.querySelector('[data-tl-lane="filmstrip"]'), r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: e.clientWidth, h: e.clientHeight, view: { ...app.view } }; });
const X = (L, t) => ((t - L.view.start) / L.view.span) * L.w;

/** The index painted in each tile rect ([{x, w}] in lane px, full pictures), from one screenshot of the row. */
async function readTiles(L, rects) {
  const fh = L.h - LIFT - 2 * PAD, y0 = LIFT + PAD;
  const png = (await page.screenshot({ clip: { x: Math.floor(L.x), y: Math.floor(L.y), width: Math.floor(L.w), height: Math.floor(L.h) }, scale: 'css' })).toString('base64');
  return ev(async ([png, rects, ys]) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    return rects.map((r) => {
      const px = (i, y) => { const d = x.getImageData(Math.floor(r.x + ((i + 0.5) * r.w) / 16), Math.round(y), 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
      const hi = px(0, ys[0]), lo = px(15, ys[0]);
      if (hi - lo < 80) return -1;
      const mid = (hi + lo) / 2;
      let n = 0;
      for (let i = 1; i <= 14; i++) { const a = px(i, ys[0]) > mid, b2 = px(i, ys[1]) > mid; if (a === b2) return -1; n = n * 2 + (a ? 1 : 0); }
      return n;
    });
  }, [png, rects, BAND.map((f) => y0 + fh * f)]);
}
/** The two tiles at the cut at x (each a full picture wide) plus, when on screen, the video's first / last tile. */
function rectsAt(L, xs, { first = false, last = false } = {}) {
  const fw = (L.h - LIFT - 2 * PAD) * info.aspect, out = [];
  for (const x of xs) out.push({ x: x - PAD - fw, w: fw, want: 'before' }, { x: x + PAD, w: fw, want: 'after' });
  if (first) out.push({ x: X(L, 0) + PAD, w: fw, want: 'first' });
  if (last) out.push({ x: X(L, info.dur) - PAD - fw, w: fw, want: 'last' });
  return out;
}
/** Read until the row says every tile on screen is its exact frame (__pawFilmLog; a build without it: two reads agree) and
 *  nothing is unreadable, or the time runs out: {got, ms}. A neighbour standing in while a frame decodes is not the answer. */
async function settle(L, rects, maxMs = 15000) {
  const t0 = Date.now();
  let prev = null, got = null;
  for (;;) {
    const idle = await ev(() => { if (app.dialog) app.dialog.resolve('discard'); return window.__filmLast ? window.__filmLast.idle : null; });
    got = await readTiles(L, rects);
    const ok = got.every((n) => n >= 0) && prev && got.every((n, i) => n === prev[i]) && idle !== false;
    if (ok || Date.now() - t0 > maxMs) break;
    prev = got; await wait(120);
  }
  // an unreadable tile: the row as painted, for a look (SHOT_DIR, set by dev/check-all.mjs)
  if (process.env.SHOT_DIR && got.some((n) => n < 0)) await page.screenshot({ path: `${process.env.SHOT_DIR}/unread-${Math.round(L.view.start)}-${Date.now() % 100000}.png`, clip: { x: Math.floor(L.x), y: Math.floor(L.y), width: Math.floor(L.w), height: Math.floor(L.h) } }).catch(() => {});
  return { got, ms: Date.now() - t0 };
}

const rows = [];
let bad = 0;
function judge(label, cut, rect, got) {
  const want = rect.want === 'before' ? cut - 1 : rect.want === 'after' ? cut : rect.want === 'first' ? 0 : info.count - 1;
  const ok = got === want;
  if (!ok) bad++;
  rows.push({ label, cut, side: rect.want, want, got, res: want % 9, ok });
  return ok;
}

// ---- the cuts: every residue mod 9, and END frames from each end ----
// the end shots: at least three frames, and enough that at the closest zoom (200 ms) the shot holds its two edge tiles as whole
// pictures (filmstrip.js: a narrower shot shows each end cropped to the picture's middle, its code cut off; the filmstrip takes
// the leftover height, so a tall window with a low DPI scale, the second PC's, makes the tiles wider than three frames hold)
const L0 = await lane(), fw0 = (L0.h - LIFT - 2 * PAD) * info.aspect, END = Math.max(3, Math.ceil(((2 * fw0 + 8 + 4 * PAD + 2) * 200) / (fms * L0.w)));
if (END > 3) console.log(`the end shots ${END} frames (a tile ${fw0.toFixed(0)} px wide on a ${L0.w} px row)`);
const cuts = [END, ...Array.from({ length: 9 }, (_, k) => 1192 + 100 * k), info.count - END];
await setCuts(cuts);
const span = 2400;   // ~108 frames: every tile a full picture (the three-frame shots at the ends: the closest zoom, 200 ms)
for (const c of cuts) {
  const sp = c <= END || c >= info.count - END ? 200 : span;
  // (an end shot's view starts at 0 / ends at the end: the first / last tile whole on screen)
  await ev(([s, w]) => app.setView({ start: s, span: w }), [c <= END ? 0 : c >= info.count - END ? info.dur - sp : at(c) - sp / 2, sp]);
  await wait(250);
  const L = await lane(), rects = rectsAt(L, [X(L, at(c))], { first: c === END, last: c === info.count - END }), r = await settle(L, rects);
  rects.forEach((q, i) => judge('static', c, q, r.got[i]));
}
const line = (r) => `  cut ${String(r.cut).padStart(4)} (n%9 ${r.res}) ${r.side.padEnd(6)} want ${String(r.want).padStart(4)} got ${String(r.got).padStart(4)} ${r.ok ? 'ok' : 'WRONG'}`;
console.log('static:'); for (const r of rows.filter((r) => r.label === 'static')) console.log(line(r));

// ---- drag the 1192 cut by a frame (tiles read while the pointer is down: the draft), release; then the . key ----
{
  const c = 1192;
  await ev(([s, w]) => app.setView({ start: s, span: w }), [at(c) - span / 2, span]);
  await wait(300);
  let L = await lane();
  const gy = L.y + L.h * 0.9, gx = L.x + X(L, at(c)), ppf = (fms / L.view.span) * L.w;
  await page.mouse.move(gx, gy); await wait(100); await page.mouse.down(); await wait(50);
  for (const k of [1, 2]) {
    await page.mouse.move(gx + (k + 0.5) * ppf, gy, { steps: 4 }); await wait(80);
    L = await lane();
    const rects = rectsAt(L, [X(L, at(c + k))]), r = await settle(L, rects);
    rects.forEach((q, i) => judge(`dragging +${k}`, c + k, q, r.got[i]));
  }
  await page.mouse.move(gx + 1.5 * ppf, gy, { steps: 3 }); await wait(80);
  await page.mouse.up(); await wait(200);
  await page.mouse.move(L.x + 10, L.y - 150); await wait(150);   // off the row: its hover tip (thumbnail + shot line) sits over the tiles
  L = await lane();
  const moved = await ev(() => app.doc.scenes.map((s) => s.start_ms));
  const nc = Math.round(moved.find((t) => Math.abs(t - at(c + 1)) <= 1) / fms);
  let rects = rectsAt(L, [X(L, at(c + 1))]), r = await settle(L, rects);
  rects.forEach((q, i) => judge('dropped +1', nc === c + 1 ? c + 1 : NaN, q, r.got[i]));
  // the cut is selected (a moved cut is): . moves it one more frame
  await page.mouse.move(L.x + 10, L.y - 150);
  await ev(() => document.querySelector('[data-tl-lane="filmstrip"]').focus());
  await page.keyboard.press('.'); await wait(250);
  L = await lane();
  rects = rectsAt(L, [X(L, at(c + 2))]); r = await settle(L, rects);
  rects.forEach((q, i) => judge('nudged . (+2)', c + 2, q, r.got[i]));
  console.log('drag / nudge:'); for (const x of rows.filter((x) => x.label !== 'static')) console.log(`  ${x.label.padEnd(13)}` + line(x).slice(1));
}

// ---- 30 cuts on screen: time to every tile exact; pan / zoom frame times ----
let perf = null;
if (PERF) {
  const base = 2300 + (Date.now() % 997);   // frames no earlier run of this instance has decoded: a cold start
  const many = Array.from({ length: 30 }, (_, k) => base + 45 * k + (k % 9));
  await setCuts(many);
  await ev(() => { globalThis.__pawFilmLog = (e) => { (window.__film ??= []).push({ ...e, t: performance.now() }); }; window.__film = []; });
  const t0 = await ev(([s, w]) => { const t = performance.now(); app.setView({ start: s, span: w }); return t; }, [at(base) - 500, 45 * 30 * fms + 1000]);
  await page.waitForFunction((t0) => (window.__film || []).some((e) => e.t > t0 && e.idle && e.tiles > 0), t0, { timeout: 60000, polling: 50 }).catch(() => {});
  const done = await ev((t0) => (window.__film || []).find((x) => x.t > t0 && x.idle && x.tiles > 0) || null, t0);
  const frameTimes = (kind) => ev(async (kind) => {
    const v0 = { ...app.view }, d = [];
    await new Promise((res) => {
      let k = 0, last = performance.now();
      const f = () => {
        const now = performance.now(); if (k) d.push(now - last); last = now;
        if (kind === 'pan') app.setView({ start: v0.start + k * v0.span * 0.004, span: v0.span });
        else app.setView({ start: v0.start, span: v0.span * (k < 60 ? 0.985 ** k : 0.985 ** (120 - k)) });
        if (++k > 120) return res(); requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    app.setView(v0);
    d.sort((a, b) => a - b);
    return { frames: d.length, p50: +d[d.length >> 1].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) };
  }, kind);
  await wait(500);
  perf = { cuts: many.length, msToAllExact: done ? +(done.t - t0).toFixed(0) : null, tiles: done?.tiles ?? null, pan: await frameTimes('pan'), zoom: await frameTimes('zoom') };
  console.log('perf: ' + JSON.stringify(perf));
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ info, rows, perf }, null, 1));
await page.mouse.move(10, 10);
await b.close();
console.log(bad ? `${bad} tiles WRONG of ${rows.length}` : `all ${rows.length} tiles ok`);
process.exit(bad ? 1 : 0);
