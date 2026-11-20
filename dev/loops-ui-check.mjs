// dev/loops-ui-check.mjs -- paw-llaa: the loops as one thing on the timeline, checked on what is PAINTED, in YOUR test instance
// (node dev/test-app.mjs start ...; the CDP_* env it prints). The clip (dev/make-loop-clip.mjs, every picture only its id):
//   node dev/make-loop-clip.mjs <clip> --secs 24 --segs '60:8:228:100;288:8:236:200;600:8:44:100;680:8:16:100'
// = loop A (8 pictures) 28.5 passes from frame 60 and loop B 29.5 passes from 288 in one shot, loop A again 5.5 passes at 600
// (another shot) and 2 passes at 680 (a third shot, no loop there). Shots are set by the check: [0, 530) [530, 590) [590, 670) [670, end).
// Asserts: no Loops row; each loop's ruler band and ticks in one colour, no second colour inside a loop; A and B differ, A's
// reuse shares A's colour; a tick drag moves every tick and the video frame (one undo step); the chain on the linked shots and
// its highlight; a caret at the 2 passes at 680 and its click highlight; right-click -> next / previous same frame steps with the
// readout; the solid-then-dashed band on the Shots strip with its "8 f × 28" words; remove (×) / mark (L) / Shift+L; a cut
// added inside loop B splits it at once and undo joins it again. Screenshots (--shots <dir>): the shot zoomed to ~450 frames on
// the timeline's width, and the whole video.
//   node dev/loops-ui-check.mjs <clip> [--shots dir]        exits 1 when anything is off
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
const argv = process.argv.slice(2), opt = (k, d = null) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const src = resolve(argv[0]), clip = src.replace(/(\.[a-z0-9]+)$/i, `.run${process.pid}$1`), shots = opt('shots');
if (shots) mkdirSync(shots, { recursive: true });
copyFileSync(src, clip);
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const fails = [], ok = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const FM = 1000 / +opt('fps', '30'), ms = (f) => Math.round(f * FM);

await ev(async (p) => {
  clearInterval(window.__noRecover);
  window.__noRecover = setInterval(() => { if (app.dialog) app.dialog.resolve('discard'); }, 150);
  app.settings.set('video.scrubCache', false); app.settings.set('lanes.hoverScrub', false); app.settings.set('timeline.frameCursor', 'off');
  await app.project.openVideo(p, { force: true });
}, clip);
const base = clip.split(/[\\/]/).pop();
await page.waitForFunction((base) => app.doc.media?.path?.endsWith(base) && app.player.ready && app.player.vw > 0, base, { timeout: 60000 });
await ev(() => { app.setMode('scenes'); app.player.pause(); });
await page.waitForFunction(() => (app.doc.loops || []).filter((l) => l.auto).length >= 3, null, { timeout: 120000, polling: 500 }).catch(() => {});
await wait(800);
const S = await ev((cuts) => {
  const end = app.durationMs, cut = [0, ...cuts, end];
  app.transact('Shots (check)', () => { app.doc.scenes = cut.slice(0, -1).map((t, i) => ({ start_ms: t, end_ms: cut[i + 1], join: i > 0 ? false : undefined })); });
  return { loops: app.doc.loops.map((l) => ({ id: l.id, t0: l.t0, t1: l.t1, n: l.auto?.n, end: l.auto?.end })), end };
}, [ms(530), ms(590), ms(670)]);
console.log(JSON.stringify(S));
ok(S.loops.length === 3, `three automatic loops (A, B, A again): ${S.loops.map((l) => `${l.t0}+${l.n}`).join(', ')}`);
ok(!(await ev(() => !!document.querySelector('[data-tl-lane="loops"]'))), 'no Loops row');

/** A lane's canvas pixels (CSS px grid) as {w, h, at(x, y) -> [r, g, b]}: a screenshot of it. */
async function pixels(lane) {
  await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await ev((lane) => { const e = document.querySelector(`[data-tl-lane="${lane}"]`).getBoundingClientRect(); return { x: e.left, y: e.top, w: e.width, h: e.height }; }, lane);
  const png = (await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h }, scale: 'css' })).toString('base64');
  const data = await ev(async (png) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, d: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, png);
  return { ...r, w: data.w, h: data.h, at: (x, y) => { const i = (Math.round(y) * data.w + Math.round(x)) * 4; return data.d.slice(i, i + 3); } };
}
const hue = ([r, g, b]) => { const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m || 1; const h = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const hueDiff = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return Math.min(d, 360 - d); };
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const near = (a, b, tol = 40) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= tol;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const X = (v, w, t) => ((t - v.start) / v.span) * w;
const REPEAT_CARET_Y = 8;   // repeats.js REPEAT_Y + 4: inside a caret's triangle

async function shot(name, lanes = ['ruler', 'scenes']) {
  if (!shots) return;
  const r = await ev((ls) => { const es = ls.map((l) => document.querySelector(`[data-tl-lane="${l}"]`).getBoundingClientRect()); return { x: Math.min(...es.map((e) => e.left)), y: Math.min(...es.map((e) => e.top)), r: Math.max(...es.map((e) => e.right)), b: Math.max(...es.map((e) => e.bottom)) }; }, lanes);
  await page.screenshot({ path: join(shots, name + '.png'), clip: { x: r.x, y: r.y, width: r.r - r.x, height: r.b - r.y } });
}

/** The picture id painted in the video (dev/loops-grid-check.mjs shown()). */
async function shown() {
  await ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await wait(150);
  const r = await ev(() => { const v = document.querySelector('video'), b = v.getBoundingClientRect(), s = Math.min(b.width / v.videoWidth, b.height / v.videoHeight), w = v.videoWidth * s, h = v.videoHeight * s; return { x: b.left + (b.width - w) / 2, y: b.top + (b.height - h) / 2, w, h }; });
  const png = (await page.screenshot({ clip: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.floor(r.w), height: Math.floor(r.h) }, scale: 'css' })).toString('base64');
  return ev(async (png) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const px = (i, row) => { const d = x.getImageData(Math.floor(((i + 0.5) * bmp.width) / 16), Math.floor(((row * 2 + 1) * bmp.height) / 4), 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
    if (px(0, 0) - px(15, 0) < 80) return -1;
    let n = 0;
    for (let i = 1; i <= 14; i++) { const a = px(i, 0) > 128, b2 = px(i, 1) > 128; if (a === b2) return -1; n = n * 2 + (a ? 1 : 0); }
    return n;
  }, png);
}
/** paw-1i15: what this machine's compositor shows for colour `h` painted in a canvas the size of the lane's, where the lane is (a
 *  canvas laid over it for one screenshot, filled by this check, then removed). With a GPU compositor that is `h` exactly; on a
 *  software one (the second PC) saturated orange in a lane-sized canvas comes out with its blue lifted ~45 (#E69F00 -> #e4a030)
 *  while a CSS swatch or a small canvas stays exact, so the lanes' colours are held to this, not to the raw hex. */
async function shownAs(lane, h) {
  const r = await ev(([lane, h]) => {
    const e = document.querySelector(`[data-tl-lane="${lane}"]`), src = e.querySelector('canvas') || e, b = src.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const c = Object.assign(document.createElement('canvas'), { id: 'calib-1i15', width: Math.round(b.width * d), height: Math.round(b.height * d) });
    Object.assign(c.style, { position: 'fixed', left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px', zIndex: 99999, pointerEvents: 'none' });
    const g = c.getContext('2d'); g.fillStyle = h; g.fillRect(0, 0, c.width, c.height);
    document.body.append(c);
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, [lane, h]);
  await ev(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  const png = (await page.screenshot({ clip: { x: r.x + r.w / 2 - 4, y: r.y + r.h / 2 - 4, width: 8, height: 8 }, scale: 'css' })).toString('base64');
  await ev(() => document.getElementById('calib-1i15')?.remove());
  return ev(async (png) => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return Array.from(x.getImageData(4, 4, 1, 1).data.slice(0, 3)); }, png);
}
const A_COL = await shownAs('scenes', '#E69F00'), B_COL = await shownAs('scenes', '#56B4E9');
console.log(`     lane canvases show #E69F00 as ${hex(A_COL)}, #56B4E9 as ${hex(B_COL)} here (paw-1i15)`);
const [LA, LB, LA2] = S.loops;
const view = () => ev(() => app.view);
const setView = async (f0, f1) => { await ev((v) => app.setView(v), { start: ms(f0), span: ms(f1 - f0) }); await wait(250); };
const lanePx = async (lane, t) => { const v = await view(), r = await ev((l) => document.querySelector(`[data-tl-lane="${l}"]`).getBoundingClientRect().width, lane); return X(v, r, t); };
/** The ruler's tick strip (y 5..7) across [x0, x1): the runs of colour near col, and every saturated pixel's nearest palette colour. */
function strip(P, x0, x1, col) {
  let runs = 0, inRun = false, other = 0;
  for (let x = Math.max(0, Math.ceil(x0)); x < Math.min(P.w, x1); x++) {
    const c = P.at(x, 6), hit = near(c, col, 60);
    if (hit && !inRun) runs++;
    inRun = hit;
    if (Math.max(...c) - Math.min(...c) > 60 && Math.abs(hueDiff(c, col)) > 30) other++;   // a saturated pixel of another hue (anti-aliased edges of its own ticks are the same hue)
  }
  return { runs, other };
}

// ---- 1. the ruler: one tint and one tick colour per loop; A and B differ ----
await setView(40, 540);
let R = await pixels('ruler');
const xa0 = await lanePx('ruler', LA.t0), xb0 = await lanePx('ruler', LB.t0), xb1 = await lanePx('ruler', ms(524));
const sa = strip(R, xa0, xb0 - 2, A_COL), sb = strip(R, xb0 + 1, xb1, B_COL);
ok(sa.runs >= 27 && sa.runs <= 29, `loop A: one orange tick per pass (${sa.runs} ticks for 28.5 passes)`);
ok(sa.other === 0, `loop A: no second colour inside it (${sa.other} px)`);
ok(sb.runs >= 25 && sb.other === 0, `loop B: its ticks in sky blue only (${sb.runs} ticks, ${sb.other} px of another colour)`);
const tintA = R.at(xa0 + 10, 2), tintB = R.at(xb0 + 10, 2);
ok(tintA[0] > tintA[2] + 8 && tintB[2] > tintB[0] + 8, `the tints: A warm ${hex(tintA)}, B cool ${hex(tintB)}`);
ok(near(R.at(Math.round(xa0) + 1, 6), A_COL, 60) && near(R.at(Math.round(xb0) + 1, 6), B_COL, 60), 'A orange, B sky blue: different colours');
await shot('ruler-shot-zoom', ['ruler', 'scenes']);

// ---- 2. the Shots strip: the first pass solid, a dash per repeat, the words ----
let SC = await pixels('scenes');
const H = SC.h, sh = Math.max(12, Math.round(H * 0.58)), y1 = sh + 1, bh = Math.max(5, Math.min(8, Math.round((H - y1) * 0.32))), by = y1 + 2 + Math.floor(bh / 2);
const sxa0 = await lanePx('scenes', LA.t0), sxa1 = await lanePx('scenes', LA.t1), sxb0 = await lanePx('scenes', LB.t0);
ok(near(SC.at((sxa0 + sxa1) / 2, by), A_COL, 70), `the first pass solid orange (${hex(SC.at((sxa0 + sxa1) / 2, by))})`);
let dashes = 0, on = false;
for (let x = Math.ceil(sxa1) + 1; x < sxb0 - 1; x++) { const c = SC.at(x, by), lit = c[0] > c[2] + 30 && c[0] > 70; if (lit && !on) dashes++; on = lit; }
ok(dashes >= 27 && dashes <= 28, `a dash per repeat (${dashes} for 27.5 repeats)`);
ok(!(await ev(() => !!document.querySelector('[data-tl-lane="loops"]'))), 'still no Loops row');

// ---- 3. the reused A shares A's colour; the chain on the linked shots ----
await setView(560, 720);
SC = await pixels('scenes'); R = await pixels('ruler');
const sx2 = await lanePx('scenes', LA2.t0), sx21 = await lanePx('scenes', LA2.t1);
ok(near(SC.at((sx2 + sx21) / 2, by), A_COL, 70), 'loop A again (another shot): orange as A');
const xc = await lanePx('ruler', ms(680));
ok(near(R.at(Math.round(xc), REPEAT_CARET_Y), A_COL, 90) || near(R.at(Math.round(xc) + 1, REPEAT_CARET_Y), A_COL, 90), `a caret at the 2 passes of A at 680 (no loop there), in A's colour (${hex(R.at(Math.round(xc), REPEAT_CARET_Y))})`);
await shot('reuse', ['ruler', 'scenes']);
// the chain: on shot 3's label (A again), orange pixels right of its number
const s3x = await lanePx('scenes', ms(590)), ly = Math.round((y1 + 2 + bh + H) / 2);
let chainX = -1;
for (let x = Math.ceil(s3x) + 8; x < s3x + 60; x++) if (near(SC.at(x, ly), A_COL, 90)) { chainX = x; break; }
ok(chainX > 0, `a chain on the linked shot's label (x ${chainX})`);
if (chainX > 0) {
  const box = await ev(() => { const e = document.querySelector('[data-tl-lane="scenes"]').getBoundingClientRect(); return { x: e.left, y: e.top }; });
  await page.mouse.move(box.x + chainX + 3, box.y + ly);
  await wait(250);
  const tip = await ev(() => document.querySelector('.k-tip .txt')?.textContent || '');
  ok(/^Same loop as shot 1 \(0:0\d\) and 4 \(0:2\d\)/.test(tip), `its tip: "${tip.slice(0, 70)}"`);
  await page.mouse.click(box.x + chainX + 3, box.y + ly);
  await wait(300);
  const t = await ev(() => app.player.timeMs);
  ok(Math.abs(t - ms(670)) <= 1, `click: the playhead goes to the next linked shot (${t} ms, want ${ms(670)})`);
  R = await pixels('ruler');
  const hx = await lanePx('ruler', ms(700));
  ok(near(R.at(hx, R.h - 3), A_COL, 90), `the linked shots highlighted on the ruler (A's colour; ${[14, 18, 22, 24, 25, 26, 27].map((y) => hex(R.at(hx, y))).join(' ')})`);
  await page.keyboard.press('Escape');
  await wait(200);
  R = await pixels('ruler');
  ok(!near(R.at(hx, R.h - 3), A_COL, 90), 'Esc: the highlight goes');
  // paw-hvbf: a crop link (tracking shotLinks, arriving after Detect): shots 2 and 3 the same animation re-framed. The
  // chain appears on shot 2 (no shared pictures) without a restart, and shot 3's chain names it
  await ev((sp) => { __pawDev.trackingFor(app).shotLinks = { links: [{ a: sp[0], b: sp[1], kind: 'crop', score: 0.95, scale: 1.8, tighter: 'b', box: { x: 0.2, y: 0.2, w: 0.55, h: 0.55 }, loops: [] }], inserts: [] }; },
    [{ start_ms: ms(530), end_ms: ms(590) }, { start_ms: ms(590), end_ms: ms(670) }]);
  await wait(300);
  await page.mouse.move(box.x + chainX + 3, box.y + ly);
  await wait(250);
  const tip3 = await ev(() => document.querySelector('.k-tip .txt')?.textContent || '');
  ok(/same footage as shot 2, this one cropped ×1\.8/.test(tip3), `shot 3's chain names the crop: "${tip3.slice(0, 110)}"`);
  const s2x = await lanePx('scenes', ms(530));
  let tip2 = '';
  for (let x = Math.max(0, Math.ceil(s2x)) + 8; x < Math.max(0, s2x) + 40 && !tip2.startsWith('Same footage'); x += 3) { await page.mouse.move(box.x + x, box.y + ly); await wait(250); tip2 = await ev(() => document.querySelector('.k-tip .txt')?.textContent || ''); }
  ok(tip2.startsWith('Same footage as shot 3, cropped ×1.8'), `the crop link's chain appears on shot 2 when it arrives: "${tip2.slice(0, 80)}"`);
  await shot('crop-chain', ['ruler', 'scenes']);
}
// the caret: click -> every place those pictures play
const rbox = await ev(() => { const e = document.querySelector('[data-tl-lane="ruler"]').getBoundingClientRect(); return { x: e.left, y: e.top }; });
await page.mouse.click(rbox.x + xc, rbox.y + 6);
await wait(250);
await setView(0, 720);
await page.mouse.move(rbox.x + 5, rbox.y - 200);   // the ruler's hover preview off the pixels read
await wait(250);
R = await pixels('ruler');
ok(near(R.at(await lanePx('ruler', ms(100)), R.h - 3), A_COL, 90) && near(R.at(await lanePx('ruler', ms(620)), R.h - 3), A_COL, 90) && !near(R.at(await lanePx('ruler', ms(400)), R.h - 3), A_COL, 90),
  'caret click: loop A, its reuse and the 2 passes highlighted; loop B not');
await shot('caret-highlight', ['ruler', 'scenes']);
await page.keyboard.press('Escape');

// ---- 4. drag a tick: every tick moves, the video shows the frame, one undo step ----
await setView(40, 540);
const fx = (f) => lanePx('ruler', ms(f));
const t10 = await fx(60 + 80), t10b = await fx(60 + 80 + 3);
await page.mouse.move(rbox.x + t10 + 1, rbox.y + 6);
await page.mouse.down();
await page.mouse.move(rbox.x + t10b + 2, rbox.y + 6, { steps: 6 });
const during = await shown();
await page.mouse.up();
await wait(200);
const pick = await ev((id) => app.doc.loops.find((l) => l.id === id)?.pick, LA.id);
ok(pick === 3, `the preferred frame: 3 frames into the cycle (${pick})`);
ok(during === 103, `the video showed the frame under the tick while dragging (picture ${during}, want 103)`);
R = await pixels('ruler');
const moved = [], stayed = [];
for (const k of [0, 5, 20, 27]) { (near(R.at(await fx(60 + 8 * k + 3) + 1, 6), A_COL, 60) ? moved : stayed).push(k); }
ok(stayed.length === 0, `every pass's tick moved (${moved.length} of 4 checked)`);
ok(near(R.at(await fx(288) + 1, 6), B_COL, 60) && !near(R.at(await fx(288 + 3) + 1, 6), A_COL, 60), 'loop B\'s ticks untouched');
const pick2 = await ev((id) => app.doc.loops.find((l) => l.id === id)?.pick, LA2.id);
ok(pick2 === 3, `the same footage in the other shot takes the same picture (${pick2})`);
await ev(() => app.undo());
ok((await ev((id) => app.doc.loops.find((l) => l.id === id)?.pick ?? 0, LA.id)) === 0, 'one undo: the preferred frame back to the first');
await ev(() => app.redo());

// ---- 5. right-click a tick: next / previous same frame, the readout ----
const tk = await fx(60 + 3 + 8 * 4);
await page.mouse.click(rbox.x + tk + 1, rbox.y + 6, { button: 'right' });
await wait(200);
await page.locator('.k-menu .k-item', { hasText: 'Next same frame' }).click();
await wait(300);
let t = await ev(() => app.player.timeMs), read = await ev(() => document.querySelector('.seek')?.textContent || '');
ok(t === ms(60 + 3 + 8 * 5), `next same frame: the next pass's preferred frame (${t} ms, want ${ms(60 + 3 + 40)})`);
ok(/^6 of 29 in shot 1 · \+8 in 2 other shots$/.test(read), `the readout: "${read}"`);
ok((await shown()) === 103, 'the same picture');
await page.keyboard.press('Alt+,');
await wait(250);
t = await ev(() => app.player.timeMs);
ok(t === ms(60 + 3 + 8 * 4), `Alt+, : back one (${t} ms)`);
await ev((t) => app.player.seek(t), ms(60 + 3 + 8 * 28));
await page.keyboard.press('Alt+.');
await wait(250);
t = await ev(() => app.player.timeMs);
ok(t === ms(600 + 3), `Alt+. from the last pass: on into the other shot (${t} ms, want ${ms(603)})`);
await shot('seek-readout', ['ruler', 'scenes']);

// ---- 6. select / remove (×) / undo; mark (L); loop playback (Shift+L) ----
await setView(260, 560);
SC = await pixels('scenes');
const sbox = await ev(() => { const e = document.querySelector('[data-tl-lane="scenes"]').getBoundingClientRect(); return { x: e.left, y: e.top }; });
const bmid = await lanePx('scenes', ms(400));
await page.mouse.click(sbox.x + bmid, sbox.y + by);
await wait(200);
const bEnd = await lanePx('scenes', ms(524));
await page.mouse.move(sbox.x + bEnd - 9, sbox.y + by);
await wait(150);
await page.mouse.click(sbox.x + bEnd - 9, sbox.y + by);
await wait(250);
ok(!(await ev((id) => app.doc.loops.some((l) => l.id === id), LB.id)), '× on the loop: removed');
await ev(() => app.undo());
ok(await ev((id) => app.doc.loops.some((l) => l.id === id), LB.id), 'undo: back');
// the keys on a loop selected on the Shots row: Alt+→ its preferred frame, Enter its options, Delete removes it
await page.mouse.click(sbox.x + bmid, sbox.y + by);
await wait(200);
await page.keyboard.press('Alt+ArrowRight');
await wait(200);
ok((await ev((id) => app.doc.loops.find((l) => l.id === id)?.pick, LB.id)) === 1, 'Alt+→ on the selected loop: its preferred frame one on');
await page.keyboard.press('Enter');
await wait(300);
ok(await ev(() => !!document.querySelector('.lp-pop')), 'Enter: the loop options (anchored on the Shots strip)');
await page.keyboard.press('Escape');
await wait(200);
await page.mouse.click(sbox.x + bmid, sbox.y + by);
await page.keyboard.press('Delete');
await wait(200);
ok(!(await ev((id) => app.doc.loops.some((l) => l.id === id), LB.id)) && (await ev(() => app.doc.scenes.length)) === 4, 'Delete: the loop removed, the shots untouched');
await ev(() => app.undo());
await ev((t) => { app.player.seek(t); }, ms(700)); await wait(300);
await page.keyboard.press('L'); await ev((t) => app.player.seek(t), ms(712)); await wait(300); await page.keyboard.press('L');
await wait(200);
const marked = await ev((t) => app.doc.loops.find((l) => Math.abs(l.t0 - t) <= 1 && !l.auto), ms(700));
if (!marked) console.log(JSON.stringify(await ev(() => app.doc.loops.map((l) => [l.t0, l.t1, !!l.auto]))));
ok(!!marked && Math.abs(marked.t1 - ms(712)) <= 1, `L, L: a loop marked by hand (${marked ? `${marked.t0}..${marked.t1}` : 'none'})`);
await setView(640, 720);
SC = await pixels('scenes');
const mc = SC.at((await lanePx('scenes', ms(706))), by);
ok(Math.max(...mc) - Math.min(...mc) > 60, `it is drawn on its shot (${hex(mc)})`);
ok(await ev(() => !!app.player.loop), 'the second L turns loop playback on');
await page.keyboard.press('Shift+L');
ok(!(await ev(() => !!app.player.loop)), 'Shift+L: off');
await ev((t) => app.player.seek(t), ms(400));
await page.keyboard.press('Shift+L');
const lp = await ev(() => app.player.loop && { t0: app.player.loop.t0, t1: app.player.loop.t1 });
ok(lp?.t0 === LB.t0, `Shift+L inside loop B: its cycle loops (${JSON.stringify(lp)})`);
await page.keyboard.press('Shift+L');

// ---- 7. a cut added inside loop B splits it at once; undo joins it again ----
await setView(260, 560);
const n0 = await ev(() => app.doc.loops.length);
await ev((t) => app.player.seek(t), ms(404));
await page.mouse.click(sbox.x + 5, sbox.y + H - 4);   // the Shots strip has the keys (K: cut at the playhead)
await ev((t) => app.player.seek(t), ms(404));
await page.keyboard.press('K');
await wait(250);
const after = await ev(() => app.doc.loops.filter((l) => l.auto).map((l) => [l.t0, l.auto.n]));
ok(await ev(() => app.doc.scenes.some((s) => Math.abs(s.start_ms - 13467) < 40)) && (await ev(() => app.doc.loops.length)) === n0 + 1, `K inside loop B: two loops, one per shot (${JSON.stringify(after)})`);
await shot('split', ['ruler', 'scenes']);
await ev(() => app.undo());
ok((await ev(() => app.doc.loops.length)) === n0, 'one undo: the cut and the split both gone');

// ---- the owner's zoom levels (screenshots) ----
await setView(40, 540);
await shot('shot-zoom');
await ev(() => app.setView({ start: 0, span: app.durationMs }));
await wait(400);
await shot('whole');
// ---- 8. paw-xclk item 4: automatic loops come back when the video is opened again (they were marked once per video path per
// session: undone / cleared, a reopen showed none until a restart) ----
// the same video as a new document (what an open / new project / recovery does: app.load, a new doc.media of the same path),
// its loops gone (a project saved without them; the marking undone)
await ev(() => app.load({ media: { ...app.doc.media }, scenes: app.doc.scenes, loops: [] }));
await page.waitForFunction(() => app.player.ready && (app.doc.loops || []).filter((l) => l.auto).length >= 3, null, { timeout: 60000, polling: 500 }).catch(() => {});
const again = await ev(() => app.doc.loops.filter((l) => l.auto).length);
ok(again >= 3, `the same video opened again: its automatic loops marked again, no restart (${again})`);
await ev(() => app.setMode('scenes'));

console.log(fails.length ? `${fails.length} failed` : 'all ok');
await b.close();
process.exit(fails.length ? 1 : 0);
