// dev/scrub-linear-check.mjs -- paw-bf4o: is the hover scrub linear with the pointer on a long video, and does everything the owner
// sees name the same frame? In YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a clip whose frames
// carry their own index as 16 big cells along the top of the picture (col 0 white, col 15 black, cols 1..14 = bits 13..0, the
// second row the inverse; dev/make-index-clip.mjs builds one), real pointer moves over the Scenes filmstrip (lanes.hoverScrub on),
// 1 px at a time forward then back, at several zooms and places along the video. Each step records the pointer's time and the
// frame named by: the player clock, the lanes' grid (lane.js frameAt), the hover tip ("f123"), the grey frame cursor, the frame the
// scrub holds (frame-hold.js), the scrub canvas's PIXELS (moving: read on every draw), and with --rest, after the pointer rests,
// a screenshot of what is painted (the <video> by then) and of the hover tip's thumbnail.
//   node dev/scrub-linear-check.mjs <clip> [--rest] [--building] [--json out.json]     (--building: no scrub cache; use with --rest)
//   node dev/scrub-linear-check.mjs --analyze out.json          (re-judge stored rows, no app)
// Exits 1 when a sequence has a disagreement or crawling forward skips a frame where a frame is at least a pixel wide.
import { writeFileSync, readFileSync } from 'node:fs';
const argv = process.argv.slice(2), opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);

/** One crawl's rows -> counts. Moving: the frame shown is the scrub canvas's; at rest: the painted picture. */
export function judge(seq, { fps, ppf, pxMs }) {
  const fms = 1000 / fps, margin = Math.max(pxMs, 0.1 * fms) + 0.7;   // the widest margin either version holds by
  const o = { steps: seq.length, shownVsHeld: 0, heldOff: 0, tipVsShown: 0, cursorVsShown: 0, thumbVsTip: 0, restVsDrawn: 0, laneVsClock: 0, noDraw: 0, skipped: [], byRes: {} };
  for (const r of seq) {
    const shown = r.rest ?? (r.held >= 0 ? r.drawn : r.frame), B = (o.byRes[shown % 9] ??= { n: 0, bad: 0 });
    let bad = false;
    const add = (k, c) => { if (c) { o[k]++; bad = true; } };
    if (r.rest == null) add('shownVsHeld', r.drawn != null && r.held >= 0 && r.drawn !== r.held);
    add('heldOff', r.held >= 0 && !(r.t >= r.held * fms - margin && r.t < (r.held + 1) * fms + margin));
    add('tipVsShown', r.tip != null && r.tip !== shown);
    add('cursorVsShown', r.cursorF != null && r.cursorF !== shown);
    add('thumbVsTip', ppf >= 1 && r.thumb != null && r.thumb >= 0 && r.thumb !== r.tip);
    add('restVsDrawn', r.rest != null && r.drawn != null && r.drawnAfterMove && r.rest !== r.drawn);
    if (r.laneF !== r.clockF) o.laneVsClock++;
    if (r.rest == null && r.newDraw === false) o.noDraw++;
    B.n++; if (bad) B.bad++;
  }
  if (ppf >= 1) {   // frames never shown while crawling forward one pixel at a time
    const fw = seq.filter((r) => r.dir === 'fwd'), seen = new Set(fw.map((r) => r.rest ?? r.drawn));
    const lo = Math.min(...fw.map((r) => r.clockF)) + 1, hi = Math.max(...fw.map((r) => r.clockF)) - 1;
    for (let n = lo; n <= hi; n++) if (!seen.has(n)) o.skipped.push(n);
  }
  o.fails = o.shownVsHeld + o.heldOff + o.tipVsShown + o.cursorVsShown + o.thumbVsTip + o.restVsDrawn + o.skipped.length;
  return o;
}
const line = (label, j) => `${label.padEnd(18)} steps ${String(j.steps).padStart(3)}  shown!=held ${j.shownVsHeld}  held-off ${j.heldOff}  tip!=shown ${j.tipVsShown}  cursor!=shown ${j.cursorVsShown}  thumb!=tip ${j.thumbVsTip}  rest!=overlay ${j.restVsDrawn}  old grid!=clock ${j.laneVsClock}  skipped ${j.skipped.length ? '[' + j.skipped.join(',') + ']' : 0}\n   by shown % 9 (steps/bad): ` + Object.entries(j.byRes).map(([k, v]) => `${k}:${v.n}/${v.bad}`).join(' ');

if (opt('--analyze')) {
  const d = JSON.parse(readFileSync(opt('--analyze'), 'utf8'));
  let bad = 0;
  for (const s of d.seqs) { const j = judge(d.rows.filter((r) => r.label === s.label), { fps: d.info.fps, ...s }); if (j.fails) bad++; console.log(line(s.label, j)); }
  console.log(bad ? `${bad} sequences FAILED` : 'all sequences ok');
  process.exit(bad ? 1 : 0);
}

const { connectTestApp } = await import('./cdp-connect.mjs');
const clip = argv[0], REST = argv.includes('--rest'), BUILDING = argv.includes('--building'), jsonOut = opt('--json');
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);

// ---- the index from pixels (in the page: two rgba rows across the picture) ----
const DECODE = `(row0, row1, w) => {
  const at = (row, i) => { const k = Math.floor(((i + 0.5) * w) / 16) * 4; return (row[k] + row[k + 1] + row[k + 2]) / 3; };
  const hi = at(row0, 0), lo = at(row0, 15), mid = (hi + lo) / 2;
  if (hi - lo < 80) return -1;
  let n = 0;
  for (let i = 1; i <= 14; i++) { const a = at(row0, i) > mid, c = at(row1, i) > mid; if (a === c) return -1; n = n * 2 + (a ? 1 : 0); }
  return n;
}`;
await ev(async ([p, decode, building]) => {
  window.__decodeIdx = eval(decode);
  app.dialog?.resolve?.('discard');
  app.settings.set('video.scrubCache', !building);   // --building: no cache, as while it builds (a Matroska source has no WebCodecs scrubber: every move is a <video> seek)
  app.settings.set('lanes.hoverScrub', true);
  app.settings.set('timeline.frameCursor', 'full');
  await app.project.openVideo(p, { force: true });
}, [clip, DECODE, BUILDING]);
for (let k = 0; k < 6; k++) { await wait(400); await ev(() => { if (app.dialog) app.dialog.resolve('discard'); }); }
await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
await ev((building) => { app.setMode('scenes'); app.player.pause(); if (!building) app.player.buildScrubCache?.(true); }, BUILDING);
if (!BUILDING) await page.waitForFunction(() => app.player.scrubCache?.state === 'ready', null, { timeout: 600000, polling: 1000 });
await wait(1500);
await ev(() => {   // every scrub draw: the index painted on the scrub canvas right then
  window.__draws = [];
  globalThis.__pawScrubLog = (e) => {
    const c = app.player.scrubCanvas, x = c.getContext('2d', { willReadFrequently: true }), row = (y) => x.getImageData(0, Math.round((c.height * y) / 1400), c.width, 1).data;
    window.__draws.push({ idx: window.__decodeIdx(row(50), row(150), c.width), t: e.t });
  };
});
const info = await ev(() => ({ path: app.player.media.path.split(/[\\/]/).pop(), fps: app.player.media.fps, count: app.player.clock.count, dur: app.durationMs, cache: app.player.scrubCache?.state }));
console.log(JSON.stringify(info));

/** The index painted inside element `sel`'s box (a screenshot: whatever is on screen there). */
async function paintedIn(sel) {
  const r = await ev((s) => { const e = document.querySelector(s); if (!e) return null; const q = e.getBoundingClientRect(); return q.width > 4 ? { x: q.left, y: q.top, w: q.width, h: q.height } : null; }, sel);
  if (!r) return null;
  const y0 = Math.max(0, Math.floor(r.y)), h = Math.max(2, Math.ceil((r.h * 200) / 1400) + 1);
  const png = (await page.screenshot({ clip: { x: Math.floor(r.x), y: y0, width: Math.floor(r.w), height: h }, scale: 'css' })).toString('base64');
  return ev(async ([png, ry, rh, y0]) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const row = (yy) => x.getImageData(0, Math.max(0, Math.min(bmp.height - 1, Math.floor(ry - y0 + (rh * yy) / 1400))), bmp.width, 1).data;
    return window.__decodeIdx(row(50), row(150), bmp.width);
  }, [png, r.y, r.h, y0]);
}
const state = () => ev(() => {
  const p = app.player, tip = document.querySelector('.k-tip .f')?.textContent, fc = document.querySelector('[data-tl-lane="filmstrip"] [data-frame-cursor]');
  const d = window.__draws[window.__draws.length - 1];
  return { held: p.heldFrame, frame: p.frame, scrubbing: p.scrubbing, tip: tip ? +tip.slice(1) : null, fcx: fc ? +fc.dataset.x : null, drawn: d ? d.idx : null, draws: window.__draws.length, clockKind: p.clock.kind, cache: p.scrubCache?.state };
});

const rows = [], seqs = [];
let bad = 0;
async function crawl(label, centre, ppf, nPx) {
  const L = await (await page.$('[data-tl-lane="filmstrip"] canvas')).boundingBox(), fms = 1000 / info.fps;
  const span = ppf > 0 ? (L.width * fms) / ppf : info.dur, start = ppf > 0 ? Math.max(0, centre * fms - span / 2) : 0;
  await ev(([s, w]) => app.setView({ start: s, span: w }), [start, span]);
  await wait(400);
  const view = await ev(() => ({ ...app.view })), W = await ev(() => document.querySelector('[data-tl-lane="filmstrip"]').clientWidth);
  const y = L.y + L.height / 2, tFrom = ppf > 0 ? (centre - nPx / 2 / ppf) * fms : centre * fms;
  // a fractional start, as a real view is never aligned to the frame grid
  const x0 = Math.round(L.x + ((tFrom - view.start) / view.span) * L.width) - (ppf > 0 ? 0 : Math.round(nPx / 2));
  const xs = [...Array(nPx + 1).keys()].map((i) => x0 + i).concat([...Array(nPx).keys()].reverse().map((i) => x0 + i));
  await page.mouse.move(xs[0] - 3, y); await wait(REST ? 700 : 300);
  for (const [si, x] of xs.entries()) {
    const n0 = await ev(() => window.__draws.length);
    await page.mouse.move(x, y);
    let st, rest = null, thumb = null, newDraw;
    if (REST) {
      await wait(150);   // past the 120 ms rest timer: the <video> seek goes out; the overlay drops once it presents
      const pre = await state();
      await wait(550); st = await state(); rest = await paintedIn('[data-testid="video-stage"] video'); thumb = await paintedIn('.k-tip canvas.th');
      st.drawn = pre.draws > n0 ? pre.drawn : null; st.drawnAfterMove = pre.draws > n0;
    } else {
      for (let k = 0; k < 8; k++) { await wait(10); if ((await ev(() => window.__draws.length)) > n0) break; }
      await wait(15);
      st = await state(); newDraw = st.draws > n0;
    }
    const t = view.start + ((x - L.x) / L.width) * view.span;
    const g = await ev(([t, fcx, view, W]) => {
      const fm = app.player.frameMs;
      return { clockF: app.player.clock.frameAt(t), laneF: window.__oldLaneAt(t, fm), cursorF: fcx == null ? null : Math.round((view.start + (fcx / W) * view.span) / fm) };
    }, [t, st.fcx, view, W]);
    rows.push({ label, si, dir: si <= nPx ? 'fwd' : 'back', x: +(x - L.x).toFixed(2), t: +t.toFixed(3), ...g, ...st, rest, thumb, newDraw });
  }
  const s = { label, ppf, pxMs: view.span / L.width };
  seqs.push(s);
  return s;
}
// the integer-ms grid the lanes used before paw-bf4o (frameTime(n) = round(n * frameMs) <= t): informative column "old grid != clock"
// (the build's own grid is unit-tested against the clock); the grey cursor is read back from its x, which sits on a stored start
// round(n * frameMs): the nearest n.
await ev(() => { window.__oldLaneAt = (u, f) => { const fr = (n) => Math.round(n * f); u += 1e-6; let n = Math.floor(u / f); if (fr(n + 1) <= u) n++; else if (fr(n) > u) n--; return n; }; });

const plans = REST
  ? [['rest 11px/f @705', 705, 11, 11 * 11], ['rest 4px/f @705', 705, 4, 21 * 4], ['rest 1.5px/f @705', 705, 1.5, 30], ['rest whole @705', 705, 0, 12]]
  : [['11px/f @30', 30, 11, 15 * 11], ['11px/f @705', 705, 11, 21 * 11], ['11px/f @2340', 2340, 11, 15 * 11], ['11px/f @4600', Math.min(4600, info.count - 20), 11, 15 * 11],
     ['4px/f @705', 705, 4, 30 * 4], ['4px/f @4600', Math.min(4600, info.count - 20), 4, 30 * 4],
     ['1.5px/f @705', 705, 1.5, 60], ['1px/f @705', 705, 1, 60], ['1px/f @4000', Math.min(4000, info.count - 40), 1, 60],
     ['whole @705', 705, 0, 30], ['whole @3500', Math.min(3500, info.count - 100), 0, 30]];
for (const [label, c0, ppf, n] of plans) {
  const c = Math.max(Math.ceil(n / 2 / Math.max(ppf, 1)) + 2, Math.min(c0, info.count - Math.ceil(n / 2 / Math.max(ppf, 1)) - 3));   // a short clip: inside it
  const s = await crawl(label, c, ppf, n), j = judge(rows.filter((r) => r.label === label), { fps: info.fps, ...s });
  if (j.fails) bad++;
  console.log(line(label, j));
}
const L0 = await (await page.$('[data-tl-lane="filmstrip"] canvas')).boundingBox();
await page.mouse.move(L0.x + 10, L0.y - 200);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ info, seqs, rows }, null, 1));
await b.close();
console.log(bad ? `${bad} sequences FAILED` : 'all sequences ok');
process.exit(bad ? 1 : 0);
