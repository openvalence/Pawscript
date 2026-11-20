// dev/lod-check.mjs -- paw-tog0 (owner: "you have to zoom in far to get to handles and names and markers to appear"): at an
// ordinary zoom the Actions and shots row draws every boundary's grip and every shot's number, and each grip is hittable where
// it is drawn; zoomed out (the whole clip, a 300-shot 20-minute project) no label overlaps another; the row's paint time.
// In YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on generated clips:
//   node dev/lod-check.mjs <clip ~140 s> <clip 20 min> <shots dir> <tag: before | after>
// Writes <shots dir>/lod-<tag>.png (20 px/s) and, for 'after', lod-zoomed-out.png (the 300-shot project, whole video); prints
// JSON; exits 1 when a check fails.
import { connectTestApp } from './cdp-connect.mjs';
const [clip, clip20, shotsDir, tag = 'after'] = process.argv.slice(2);
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const frames = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const fails = [], out = { tag };
const fail = (m) => { fails.push(m); console.log('FAIL', m); };

async function open(p) {
  await ev(async (p) => {
    clearInterval(window.__noRecover);
    window.__noRecover = setInterval(() => { if (app.dialog) app.dialog.resolve('discard'); }, 150);
    app.settings.set('lanes.hoverScrub', false);
    app.settings.set('timeline.frameCursor', 'off');
    await app.project.openVideo(p, { force: true });
  }, p);
  await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
  for (let k = 0; k < 6; k++) { await wait(250); await ev(() => { if (app.dialog) app.dialog.resolve('discard'); }); }
  await ev(() => { app.player.pause(); app.setMode('track'); });
  await wait(300);
}
/** n shots over the video (frame starts), durations varied; tiny: shot indices 0.2 s long; moves: boundaries that are camera moves. */
async function setProject({ n, tiny = [], moves = [], fx = [], acts = [] }) {
  await ev(([n, tiny, moves, fx, acts]) => {
    const fm = app.player.frameMs, D = app.durationMs, w = Array.from({ length: n }, (_, i) => (tiny.includes(i) ? 0 : 3 + ((i * 7) % 6)));
    const tinyMs = 6 * fm, free = D - tiny.length * tinyMs, sum = w.reduce((a, b) => a + b, 0);
    let t = 0;
    const list = w.map((x, i) => {
      const len = tiny.includes(i) ? tinyMs : (free * x) / sum, s = { start_ms: Math.round(t / fm) * Math.round(fm), end_ms: 0 };
      t += len; s.end_ms = i === n - 1 ? D : Math.round(t / fm) * Math.round(fm);
      if (i > 0) { s.join = i % 5 !== 0; if (moves.includes(i)) { s.join = true; s.split = 'camera'; } }
      return s;
    });
    for (let i = 1; i < list.length; i++) list[i].start_ms = list[i - 1].end_ms;
    app.transact('lod check', () => { app.doc.scenes = list; app.doc.fx = fx; app.doc.acts = acts; });
  }, [n, tiny, moves, fx, acts]);
  await wait(400);
}
const laneOf = (id) => ev((id) => { const e = document.querySelector(`[data-tl-lane="${id}"]`); if (!e) return null; const c = e.querySelector('canvas'), r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: c.clientWidth, h: c.clientHeight, view: { ...app.view } }; }, id);
const setView = async (start, span) => { await ev(([s, p]) => app.setView({ start: s, span: p }), [start, span]); await wait(150); await frames(); };
/** The row's strips (actions-strip.js stripLayout with n secondary bands). */
function strips(H, n) {
  const l0 = !n ? 0 : H - n * 13 >= 40 ? 13 : Math.max(7, Math.floor((H - 40) / n));
  const sh = Math.max(20, Math.round((H - n * l0) * 0.58)) + n * l0;
  return { sh, y1: sh + 1 };
}
/** Luminance grid of a lane from one screenshot (what is painted); grey: coloured pixels (a picture, a kind's colour) read 0,
 *  so only the grips' and labels' neutral inks count. -> (x, y) => lum | -1 */
async function grab(L, grey = false) {
  const png = (await page.screenshot({ clip: { x: Math.floor(L.x), y: Math.floor(L.y), width: Math.floor(L.w), height: Math.floor(L.h) }, scale: 'css' })).toString('base64');
  const g = await ev(async ([png, grey]) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data, lum = [];
    for (let i = 0; i < d.length; i += 4) lum.push(grey && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30 ? 0 : Math.round((d[i] + d[i + 1] + d[i + 2]) / 3));
    return { w: bmp.width, h: bmp.height, lum };
  }, [png, grey]);
  return (x, y) => { x = Math.round(x); y = Math.round(y); return x < 0 || y < 0 || x >= g.w || y >= g.h ? -1 : g.lum[y * g.w + x]; };
}
const count = (P, x0, x1, y0, y1, min) => { let n = 0; for (let x = Math.round(x0); x <= x1; x++) for (let y = Math.round(y0); y <= y1; y++) if (P(x, y) > min) n++; return n; };
/** The fillText calls of one repaint of a lane: [{t, x0, x1, y0, y1}] (boxes from the context's own font and alignment). */
async function texts(id) {
  await ev((id) => {
    const ctx = document.querySelector(`[data-tl-lane="${id}"] canvas`).getContext('2d');
    window.__lodTexts = [];
    if (!ctx.__lodWrapped) {
      const f = ctx.fillText, cr = ctx.clearRect;
      ctx.clearRect = function (...a) { if (window.__lodTexts && a[0] === 0 && a[1] === 0) window.__lodTexts = []; return cr.apply(this, a); };   // one paint: the last
      ctx.fillText = function (t, x, y, ...r) {
        if (window.__lodTexts) {
          const w = this.measureText(t).width, fs = +(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10), al = this.textAlign;
          const a = al === 'right' || al === 'end' ? x - w : al === 'center' ? x - w / 2 : x, mid = this.textBaseline === 'middle' ? y : this.textBaseline === 'top' ? y + fs / 2 : y - fs / 2;
          window.__lodTexts.push({ t: String(t), x0: a, x1: a + w, y0: mid - fs * 0.4, y1: mid + fs * 0.4 });
        }
        return f.call(this, t, x, y, ...r);
      };
      ctx.__lodWrapped = true;
    }
    app.setView({ start: app.view.start + 0.001, span: app.view.span });
  }, id);
  await frames();
  return ev(() => { const t = window.__lodTexts; window.__lodTexts = null; return t; });
}
const overlaps = (T) => { const o = []; for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) { const a = T[i], c = T[j]; if (Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0) > 0.5 && Math.min(a.y1, c.y1) - Math.max(a.y0, c.y0) > 1) o.push(`${a.t}@${a.x0.toFixed(0)} / ${c.t}@${c.x0.toFixed(0)}`); } return o; };
/** The row's paint time: clearRect(0, 0, ..) to the 'SHOTS' plate word (the last text paint draws), over n repaints. -> median ms */
async function paintMs(n = 40) {
  return ev(async (n) => {
    const ctx = document.querySelector('[data-tl-lane="scenes"] canvas').getContext('2d'), ms = [];
    let t0 = 0;
    const cr = ctx.clearRect, ft = ctx.fillText;
    ctx.clearRect = function (...a) { if (a[0] === 0 && a[1] === 0) t0 = performance.now(); return cr.apply(this, a); };
    ctx.fillText = function (t, ...a) { const r = ft.call(this, t, ...a); if (t === 'SHOTS' && t0) { ms.push(performance.now() - t0); t0 = 0; } return r; };
    const v = { ...app.view };
    for (let k = 0; k < n; k++) { app.setView({ start: v.start + (k % 2 ? 0.5 : 0), span: v.span }); await new Promise((r) => requestAnimationFrame(r)); }
    ctx.clearRect = cr; ctx.fillText = ft;
    app.setView(v);
    ms.sort((a, b) => a - b);
    return { n: ms.length, median: +ms[Math.floor(ms.length / 2)].toFixed(3), p90: +ms[Math.floor(ms.length * 0.9)].toFixed(3) };
  }, n);
}

// ---- 1. the owner's zoom: a 140 s clip, 32 shots (one of them 6 frames, two camera moves), ~20 px/s ----
await open(clip);
const D = await ev(() => app.durationMs);
const FX = [
  { id: 'f1', kind: 'orgasm', t0: 60000, t1: 70000, params: {} },
  ...[61000, 62500, 64000, 65500, 67000].map((t, k) => ({ id: 's' + k, kind: 'spurt', t0: t, t1: t, params: {} })),
  { id: 'f2', kind: 'knotting', t0: 76000, t1: 82000, params: { mode: 'single' } },
  { id: 'f3', kind: 'throbbing', t0: 85000, t1: 87500, params: {} },
];
const ACTS = [{ id: 'r1', kind: 'act', t0: 30000, t1: 90000, layer: 0, tags: [] }];
await setProject({ n: 32, tiny: [27], moves: [7, 15], fx: FX, acts: ACTS });
let L = await laneOf('scenes');
const pxs = 20, span = (L.w / pxs) * 1000, start = 24000;
await setView(start, span);
L = await laneOf('scenes');
const sc = await ev(() => app.doc.scenes.map((s) => ({ t: s.start_ms, mv: s.join === true && s.split === 'camera' })));
const nBands = ACTS.some((r) => r.t1 > start && r.t0 < start + span) ? 1 : 0, S = strips(L.h, nBands), ym = (S.y1 + L.h) / 2;
const X = (t) => ((t - start) / span) * L.w;
let P = await grab(L, true);
const bounds = sc.slice(1).map((s, k) => ({ i: k + 1, x: X(s.t), mv: s.mv })).filter((c) => c.x > 6 && c.x < L.w - 80);
const noGrip = [], noNum = [], noHit = [];
for (const c of bounds) {
  if (count(P, Math.round(c.x + 1.5), Math.round(c.x + 1.5) + 1, ym - 3, ym + 3, 60) < 3) noGrip.push(c.i);   // a pill's right half (filled) or rim (hollow), clear of the cut's 1 px line
  if (count(P, c.x + 4, c.x + 14, ym - 4, ym + 4, 110) < 4) noNum.push(c.i);
}
for (const c of bounds) {
  await page.mouse.move(L.x + c.x, L.y + ym);
  await frames();
  const cur = await ev(() => document.querySelector('[data-tl-lane="scenes"] canvas').style.cursor);
  if (cur !== 'col-resize') noHit.push(`${c.i}:${cur}`);
}
await page.mouse.move(L.x + 5, L.y + 2); await frames();
out.owner = { laneW: L.w, pxPerSec: pxs, boundaries: bounds.length, moves: bounds.filter((c) => c.mv).length, noGrip, noNum, noHit };
if (noGrip.length) fail(`20 px/s: ${noGrip.length} of ${bounds.length} boundaries have no grip painted: ${noGrip.join(',')}`);
if (noNum.length) fail(`20 px/s: ${noNum.length} of ${bounds.length} shots have no number painted: ${noNum.join(',')}`);
if (noHit.length) fail(`20 px/s: ${noHit.length} grips not hittable where drawn: ${noHit.join(',')}`);
// the Modifiers row (Refine: spurts are edited there): each block's edge handles and (>= 40 px) name, each spurt's marker; hittable where drawn
await ev(() => app.setMode('refine')); await wait(400); await setView(start, span);
const F = await laneOf('fx'), PF = await grab(F), fxRows = 2, rh = F.h / fxRows, fxMiss = [];
const fxBg = PF(3, 3);
for (const e of FX) {
  const x0 = ((e.t0 - start) / span) * F.w, x1 = ((e.t1 - start) / span) * F.w, row = e.kind === 'spurt' ? 1 : 0, cy = row * rh + rh / 2;
  if (x1 < 0 || x0 > F.w) continue;
  if (e.kind === 'spurt') { if (Math.abs(PF(x0, cy) - fxBg) < 30) fxMiss.push(`${e.id}: no marker`); }
  else {
    if (Math.abs(PF(x0 + 1, cy) - fxBg) < 30) fxMiss.push(`${e.id}: no start handle`);
    if (Math.abs(PF(x1 - 1, cy) - fxBg) < 30) fxMiss.push(`${e.id}: no end handle`);
    if (x1 - x0 >= 40 && count(PF, x0 + 6, x0 + 30, cy - 4, cy + 4, 120) < 4) fxMiss.push(`${e.id}: no name`);
  }
  await page.mouse.move(F.x + x0 + (e.kind === 'spurt' ? 0 : 1), F.y + cy); await frames();
  const cur = await ev(() => document.querySelector('[data-tl-lane="fx"] canvas').style.cursor);
  if (cur !== (e.kind === 'spurt' ? 'grab' : 'ew-resize')) fxMiss.push(`${e.id}: not hittable (${cur})`);
}
await page.mouse.move(L.x + 5, L.y + 2); await frames();
out.fx = fxMiss;
if (fxMiss.length) fail(`20 px/s, Modifiers: ${fxMiss.join('; ')}`);
// the filmstrip (Scenes tab): every cut's grip
await ev(() => app.setMode('scenes')); await wait(400); await setView(start, span);
const FS = await laneOf('filmstrip');
if (FS) {
  const PS = await grab(FS, true), gy = FS.h / 2, miss = [];
  const PC = await grab(FS), dark = (x0, x1, y0, y1) => { let n = 0; for (let x = x0; x <= x1; x++) for (let y = Math.round(y0); y <= y1; y++) if (PC(x, y) >= 0 && PC(x, y) < 25) n++; return n; };
  // a cut: its filled pill's light grey; a camera move: its hollow pill's dark inside over the picture (its 1 px rim blends into it)
  for (const c of bounds) { const x = ((sc[c.i].t - start) / span) * FS.w; if (c.mv ? dark(Math.round(x) - 1, Math.round(x) + 1, gy - 5, gy + 5) < 20 : count(PS, Math.round(x + 1.5), Math.round(x + 1.5) + 1, gy - 3, gy + 3, 60) < 3) miss.push(c.i); }
  out.filmstrip = { boundaries: bounds.length, noGrip: miss };
  if (miss.length) { const x = FS.x + ((sc[miss[0]].t - start) / span) * FS.w; await page.screenshot({ path: `${shotsDir}/lod-film-miss-${tag}.png`, clip: { x: Math.max(0, x - 40), y: FS.y, width: 80, height: FS.h } }); }
  if (miss.length) fail(`20 px/s, filmstrip: ${miss.length} of ${bounds.length} cuts have no grip: ${miss.join(',')}`);
}
await ev(() => app.setMode('track')); await wait(400); await setView(start, span);
const shot = async (name) => { const a = await laneOf('scenes'), f = await laneOf('fx'); await page.screenshot({ path: `${shotsDir}/${name}`, clip: { x: 0, y: Math.max(0, Math.floor(Math.min(a.y, f.y)) - 60), width: Math.floor(a.x + a.w + 4), height: Math.floor(Math.max(a.y + a.h, f.y + f.h) - Math.min(a.y, f.y) + 70) } }); };
await shot(`lod-${tag}.png`);
out.paint = { owner: await paintMs() };
// ---- 2. the whole 140 s clip ----
await setView(0, D);
let T = await texts('scenes'), ov = overlaps(T);
out.whole = { texts: T.length, overlaps: ov };
if (ov.length) fail(`whole clip: ${ov.length} labels overlap: ${ov.slice(0, 6).join('; ')}`);
out.paint.whole = await paintMs();
// ---- 3. a 300-shot 20-minute project, whole video ----
await open(clip20);
const D20 = await ev(() => app.durationMs);
await setProject({ n: 300, tiny: [40, 41, 150], moves: Array.from({ length: 30 }, (_, k) => 5 + k * 10), fx: [], acts: [{ id: 'r1', kind: 'act', t0: 0, t1: D20 / 2, layer: 0, tags: [] }] });
await setView(0, D20);
T = await texts('scenes'); ov = overlaps(T);
out.big = { texts: T.length, numbers: T.filter((t) => /^\d+$/.test(t.t)).length, overlaps: ov };
if (ov.length) fail(`300 shots, whole video: ${ov.length} labels overlap: ${ov.slice(0, 6).join('; ')}`);
out.paint.big = await paintMs();
await shot(`lod-zoomed-out-${tag}.png`);
console.log(JSON.stringify(out, null, 1));
await b.close().catch(() => {});
process.exit(fails.length ? 1 : 0);
