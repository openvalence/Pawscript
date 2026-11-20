// dev/groups-erase-check.mjs -- paw-1co9 in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a
// generated clip. A grow dab makes a group that "grew too far": the page's segment answer is a body with a spill joined by a thin
// neck. Real pointer events then erase the neck (Shift+drag) and the script counts the pieces of the STORED mask and of what the
// overlay PAINTS where the group was:
//  1. grow off (the plain eraser): one piece, the spill gone (nothing painted there), one undo step; Ctrl+Z brings the spill back;
//  2. grow on (the erase goes to SAM as negatives; the answer comes back cut in two): one piece again.
//   node dev/groups-erase-check.mjs <clip.mp4> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [clip, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
// the shape, in frame fractions: body disc, spill disc, the neck between them
const S = { bx: 0.13, by: 0.5, br: 0.13, sx: 0.36, sy: 0.5, sr: 0.08, neck: 0.03 };   // a neck SAM's own clean-up (smoothing) keeps
try {
  await ev((p) => { app.project.openVideo(p, { force: true }); }, clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve('restore'); }); }
  await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
  await page.waitForFunction(() => window.__pawDev?.groupsFor, null, { timeout: 30000 });
  await ev(() => { app.setMode('track'); app.doc.scenes = [{ start_ms: 0, end_ms: 4000 }]; app.player.pause(); app.player.seek(1000, { exact: true }); });
  await wait(1500);
  await ev(() => { app.settings.set('tracking.groups.corner', 'br'); app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.circle', false); app.settings.set('tracking.groups.grow', true); });
  // the paint counts below need a solid fill: Dither (the default) leaves cells of a painted part empty
  await ev(() => app.settings.set('tracking.groups.fill', 'flat'));
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); }); await wait(600);
  ok(await ev(() => !!document.querySelector('[data-testid="groups-tools"]')), 'Groups tool is on');
  // the page's SAM: a positive-only prompt -> body + neck + spill; a prompt with negatives -> the same cut through the neck (two pieces)
  await ev((S) => {
    const tr = __pawDev.trackingFor(app), job = tr.job.bind(tr);
    window.__segReqs = [];
    tr.job = (label, req, o) => {
      if (label !== 'segment') return job(label, req, o);
      window.__segReqs.push(req);
      const mw = req.mask_w || 320, mh = Math.round(mw * 9 / 16), a = new Float32Array(mw * mh), cut = !!req.neg?.length;
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
        const X = (x + 0.5) / mw, Y = (y + 0.5) / mh, A = 16 / 9;
        const on = Math.hypot((X - S.bx) * A, Y - S.by) < S.br || Math.hypot((X - S.sx) * A, Y - S.sy) < S.sr || (Math.abs(Y - S.by) < S.neck && X > S.bx && X < S.sx);
        if (on && !(cut && X > 0.23 && X < 0.26)) a[y * mw + x] = 1;
      }
      const rle = []; let v = -1, c = 0; for (const f of a) { const q = Math.round(f * 15); if (q === v) c++; else { if (c) rle.push(v, c); v = q; c = 1; } } if (c) rle.push(v, c);
      return Promise.resolve({ result: { frame_wh: [1280, 720], mask_wh: [mw, mh], cached: true, ms: { embed: 0, decode: 1 }, masks: [{ mask: { w: mw, h: mh, rle }, score: 0.9 }] } });
    };
  }, S);
  const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
  // pieces of the stored mask (8-connected at 0.5) and the history position
  const stored = () => ev(() => {
    const G = __pawDev.groupsFor(app), g = G.groups[0];
    if (!g) return { n: 0, pieces: 0, spill: 0, hist: app._history.index };
    const m = G.maskFor(g), { w, h, a } = m, seen = new Uint8Array(w * h); let pieces = 0;
    for (let i = 0; i < w * h; i++) { if (a[i] < 0.5 || seen[i]) continue; pieces++; const st = [i]; seen[i] = 1; while (st.length) { const j = st.pop(), x = j % w, y = (j - x) / w; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, k = Y * w + X; if (X >= 0 && Y >= 0 && X < w && Y < h && !seen[k] && a[k] >= 0.5) { seen[k] = 1; st.push(k); } } } }
    const spill = a[Math.floor(0.5 * h) * w + Math.floor(0.36 * w)];
    return { n: G.groups.length, pieces, spill: +spill.toFixed(2), hist: app._history.index, patches: G.fitFor(g).blobs };
  });
  // pieces of what the overlay paints inside the shape's box (alpha > 40; specks under 25 canvas px ignored), and paint at the spill's centre
  const painted = () => ev(([S, box]) => {
    const cv = document.querySelector('canvas.ov'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
    const A = 16 / 9, x0 = Math.floor((box.x - r.x + (S.bx - S.br / A - 0.02) * box.w) * k), x1 = Math.ceil((box.x - r.x + (S.sx + S.sr / A + 0.02) * box.w) * k);
    const y0 = Math.floor((box.y - r.y + (S.by - S.br - 0.03) * box.h) * k), y1 = Math.ceil((box.y - r.y + (S.by + S.br + 0.03) * box.h) * k);
    const W = x1 - x0, H = y1 - y0, d = cv.getContext('2d').getImageData(x0, y0, W, H).data, on = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) on[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    const seen = new Uint8Array(W * H), sizes = [];
    for (let i = 0; i < W * H; i++) { if (!on[i] || seen[i]) continue; let n = 0; const st = [i]; seen[i] = 1; while (st.length) { const j = st.pop(), x = j % W, y = (j - x) / W; n++; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, q = Y * W + X; if (X >= 0 && Y >= 0 && X < W && Y < H && !seen[q] && on[q]) { seen[q] = 1; st.push(q); } } } sizes.push(n); }
    const sx = Math.round((box.x - r.x + S.sx * box.w) * k) - x0, sy = Math.round((box.y - r.y + S.sy * box.h) * k) - y0;
    let spill = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) spill += on[(sy + dy) * W + sx + dx];
    return { pieces: sizes.filter((n) => n >= 25).length, all: sizes.length, spill };
  }, [S, box]);
  const shot = (tag) => page.screenshot({ path: `${out}/${tag}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const eraseNeck = async () => {
    await page.mouse.move(...at(0.245, 0.36));
    await page.keyboard.down('Shift'); await page.mouse.down();
    for (let k = 1; k <= 14; k++) await page.mouse.move(...at(0.245, 0.36 + k * 0.02));
    await page.mouse.up(); await page.keyboard.up('Shift'); await wait(400);
  };
  await ev(() => app.settings.set('tracking.groups.brush', 0.03));
  // the grow dab on the body
  await page.mouse.move(...at(S.bx, S.by)); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => __pawDev.groupsFor(app).groups.length === 1 && !__pawDev.groupsFor(app).growBusy, null, { timeout: 10000 });
  await page.mouse.move(...at(0.9, 0.1)); await wait(500);   // the pointer off the group (hover chrome)
  const g0 = await stored(), p0 = await painted(); await shot('grown');
  ok(g0.pieces === 1 && g0.spill >= 0.5, `grew too far: stored ${g0.pieces} piece with the spill (${g0.spill}); painted ${p0.pieces} pieces (${p0.all} with specks), spill painted ${p0.spill}/49`);
  // 1. the plain eraser (grow off)
  await ev(() => app.settings.set('tracking.groups.grow', false));
  await eraseNeck();
  await page.mouse.move(...at(0.9, 0.1)); await wait(500);
  const g1 = await stored(), p1 = await painted(); await shot('erased-plain');
  ok(g1.n === 1 && g1.pieces === 1 && g1.patches === 1 && g1.spill === 0, `plain erase across the neck: stored ${g1.pieces} piece (${g1.patches} patch), spill ${g1.spill}`);
  ok(p1.pieces === 1 && p1.spill === 0, `painted: ${p1.pieces} piece (${p1.all} with specks), nothing at the spill (${p1.spill}/49)`);
  ok(g1.hist === g0.hist + 1, `one undo step (${g0.hist} -> ${g1.hist})`);
  await page.keyboard.press('Control+z'); await wait(500);
  const g2 = await stored(), p2 = await painted();
  ok(g2.pieces === 1 && g2.spill >= 0.5 && p2.spill > 40, `Ctrl+Z: the spill is back in one step (stored spill ${g2.spill}, painted ${p2.spill}/49)`);
  // 2. grow on: the erase goes to SAM as negatives, its answer comes back in two pieces
  await ev(() => app.settings.set('tracking.groups.grow', true));
  const nreq = await ev(() => window.__segReqs.length);
  await eraseNeck();
  await page.waitForFunction(() => !__pawDev.groupsFor(app).growBusy && !__pawDev.groupsFor(app).draft, null, { timeout: 10000 });
  await page.mouse.move(...at(0.9, 0.1)); await wait(500);
  const req = await ev((n) => window.__segReqs[n] || null, nreq), g3 = await stored(), p3 = await painted(); await shot('erased-sam');
  ok(!!req?.neg?.length, `the erase went to SAM: ${req?.neg?.length || 0} negative points, ${req?.pos?.length || 0} positive`);
  ok(g3.pieces === 1 && g3.spill === 0 && p3.pieces === 1 && p3.spill === 0, `SAM erase: stored ${g3.pieces} piece, painted ${p3.pieces} (${p3.all} with specks), spill ${g3.spill} / ${p3.spill}`);
} finally { await b.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
