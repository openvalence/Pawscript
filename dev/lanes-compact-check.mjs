// dev/lanes-compact-check.mjs -- paw-g56v: compact axis lanes and the overscroll / loop wrap, asserted on what is painted.
//  (1) six axes: no header bar, each lane's canvas fills its row, the name gutter painted (vertical name, colour square), the
//      buttons hidden until the lane is hovered, then lock / hide / solo / collapse (a strip, click opens it) work, a locked lane
//      keeps its lock showing; the gutter drag reorders; the header's words are drawn behind the curve; lane heights >= 36.
//  (2) time 0 panned to mid-lane: every timeline row on the time axis shows the hatched out-of-range band with a boundary line;
//      the lane's pixels there differ from inside; (3) loop playback on over the whole video: the wrap ghost and its label painted
//      on both sides, a click and a double-click there add no point and seek to the nearest end. No page error, no console error.
//   CDP_* env from `node dev/test-app.mjs start ...`;  node dev/lanes-compact-check.mjs <clip.mp4> [<screenshot dir>]
import { connectTestApp } from './cdp-connect.mjs';
const { browser, page: p } = await connectTestApp();
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const wait = (ms) => p.waitForTimeout(ms);
const shots = process.argv[3];
p.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
p.on('console', (m) => { if (m.type() === 'error') { fails++; console.log('FAIL [console]', m.text().slice(0, 300)); } });
const cdp = await p.context().newCDPSession(p);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
const AXES = ['stroke', 'surge', 'sway', 'twist', 'roll', 'pitch'];
const ev = (f, a) => p.evaluate(f, a);
const box = (sel) => ev((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
/** Mean luminance and the share of "coloured" pixels of a screen region (a PNG screenshot decoded in the page). */
async function region(r) {
  const png = await p.screenshot({ clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) } });
  return ev(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data;
    let lum = 0, col = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) col++; }
    return { lum: lum / n, col: col / n };
  }, png.toString('base64'));
}
/** Every text the lane canvases draw during the next repaint. */
const drawnTexts = (fn) => ev(async (fn) => {
  const P = CanvasRenderingContext2D.prototype, o = P.fillText, seen = [];
  P.fillText = function (t, ...r) { seen.push(String(t)); return o.call(this, t, ...r); };
  await (0, eval)(fn)();
  await new Promise((r) => setTimeout(r, 400));
  P.fillText = o;
  return seen;
}, fn.toString());

try {
  await p.waitForFunction(() => window.app?.project, null, { timeout: 30000 });
  let opened = false;
  const opening = p.evaluate((v) => window.app.project.openVideo(v), process.argv[2]).then(() => (opened = true));
  for (let k = 0; k < 40 && !opened; k++) { await ev(() => [...document.querySelectorAll('.k-dialog.choice button')].find((x) => x.offsetParent && /Discard/.test(x.textContent))?.click()); await wait(250); }
  await opening; await wait(1500);
  ok(await ev(() => !!window.app.doc.media), 'the clip is open');
  await ev((AXES) => {
    const a = window.app; a.layout.reset(); a.setMode('refine'); a.layout.toggle('bottom', false);
    a.settings.set('lanes.layout', { order: [], h: {}, collapsed: {}, hidden: {}, locked: {}, ghostsOff: {} });
    const dur = a.durationMs, pts = (k) => Array.from({ length: 41 }, (_, i) => ({ at: Math.round((i * dur) / 40), pos: (i + k) % 2 ? 85 : 15 }));
    a.doc.axes = Object.fromEntries(AXES.map((id, k) => [id, pts(k)]));
    a.setActiveAxis('stroke'); a.setView({ start: 0, span: dur });
  }, AXES);
  await wait(800);
  if (shots) await p.screenshot({ path: shots + '/lanes-1-six.png' });

  // ---- (1) compact lanes ----
  const L = await ev(() => [...document.querySelectorAll('[data-area=timeline] .lrow')].map((row) => {
    const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, c = row.querySelector('.canvas'), g = row.querySelector('.gutter'), n = g?.querySelector('.name'), sw = g?.querySelector('.sw'), base = row.querySelector('canvas.base');
    return { axis: g?.dataset.axis, row: R(row), canvas: R(c), base: R(base), gutter: R(g), name: R(n), nameText: n?.textContent, wm: n && getComputedStyle(n).writingMode, sw: R(sw), swBg: sw && getComputedStyle(sw).backgroundColor, hd: !!row.querySelector('.hd') };
  }));
  ok(L.length === 6 && L.every((l) => !l.hd), `six lanes, no header bar (${L.length})`);
  for (const l of L) {
    ok(l.base && Math.abs(l.base.h - l.canvas.h) < 1 && Math.abs(l.canvas.h - (l.row.h - 1)) <= 1.5, `${l.axis}: the curve takes the whole lane (row ${l.row.h.toFixed(0)}, canvas ${l.base?.h.toFixed(0)})`);
    ok(l.gutter && Math.abs(l.gutter.w - 18) < 1 && Math.abs(l.gutter.h - l.canvas.h) < 1 && Math.abs(l.gutter.x - l.canvas.x) < 1, `${l.axis}: gutter ${l.gutter?.w}x${l.gutter?.h?.toFixed(0)} at the left edge`);
    ok(l.nameText === l.axis && l.wm === 'vertical-rl' && l.name.h > 10 && l.name.w > 4 && l.name.h > l.name.w, `${l.axis}: name painted upright-vertical ${l.name?.w?.toFixed(0)}x${l.name?.h?.toFixed(0)}`);
    ok(l.sw && l.sw.w >= 7 && l.sw.y > l.name.y && l.swBg !== 'rgba(0, 0, 0, 0)', `${l.axis}: colour square under the name (${l.swBg})`);
    ok(l.canvas.h >= 36, `${l.axis}: lane height ${l.canvas.h.toFixed(0)} >= 36`);
  }
  const gp = await region({ ...L[0].gutter }), cp = await region({ x: L[0].canvas.x + 300, y: L[0].canvas.y, w: 18, h: L[0].canvas.h });
  ok(Math.abs(gp.lum - cp.lum) > 1, `gutter painted distinct from the lane (lum ${gp.lum.toFixed(1)} vs ${cp.lum.toFixed(1)})`);
  // the header's words behind the curve
  const words = await drawnTexts(() => { const a = window.app; a.select([a.doc.axes.stroke[3].at], 'stroke'); });
  ok(words.includes('41 points') && words.includes('1 selected'), `the header's words drawn in the lane (${words.filter((t) => /point|selected/.test(t)).slice(0, 4).join(' | ')})`);
  ok(!words.some((t) => t.startsWith('Empty lane')), 'no "Empty lane" hint');
  // buttons: hidden until the lane is hovered
  const vis = (axis, label) => ev(([axis, label]) => { const row = document.querySelector(`.gutter[data-axis=${axis}]`)?.closest('.lrow'); const b = row && [...row.querySelectorAll('.btns button')].find((x) => x.getAttribute('aria-label') === label); return b ? getComputedStyle(b).visibility : 'none'; }, [axis, label]);
  await p.mouse.move(800, 40); await wait(200);
  ok((await vis('sway', 'Lock lane')) === 'hidden', 'buttons hidden while the lane is not hovered');
  const sway = L.find((l) => l.axis === 'sway');
  await p.mouse.move(sway.canvas.x + 600, sway.canvas.y + sway.canvas.h / 2); await wait(250);
  ok((await vis('sway', 'Lock lane')) === 'visible' && (await vis('sway', 'Solo')) === 'visible', 'hover shows the buttons');
  const btnBox = (axis, label) => ev(([axis, label]) => { const row = document.querySelector(`.gutter[data-axis=${axis}]`)?.closest('.lrow'); const b = [...row.querySelectorAll('.btns button')].find((x) => x.getAttribute('aria-label') === label); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right, top: r.top }; }, [axis, label]);
  const lb = await btnBox('sway', 'Lock lane');
  ok(lb.right <= sway.canvas.x + sway.canvas.w && lb.right > sway.canvas.x + sway.canvas.w - 160 && lb.top < sway.canvas.y + 6, 'buttons sit at the lane\'s top-right edge');
  const flag = (name, axis) => ev(([n, a]) => !!window.app.settings.get('lanes.layout')?.[n]?.[a], [name, axis]);
  await p.mouse.click(lb.x, lb.y); await wait(200);
  ok(await flag('locked', 'sway'), 'lock button locks the lane');
  await p.mouse.move(800, 40); await wait(200);
  ok((await vis('sway', 'Lock lane')) === 'visible' && (await vis('sway', 'Solo')) === 'hidden', 'a locked lane keeps its lock icon showing (others hide)');
  await p.mouse.move(sway.canvas.x + 600, sway.canvas.y + 20); await wait(200);
  await p.mouse.click(lb.x, lb.y); await wait(200);
  ok(!(await flag('locked', 'sway')), 'unlock');
  let hb = await btnBox('sway', 'Hide lane'); await p.mouse.click(hb.x, hb.y); await wait(200);
  ok(await flag('hidden', 'sway'), 'eye hides the lane');
  hb = await btnBox('sway', 'Show lane'); await p.mouse.click(hb.x, hb.y); await wait(200);
  ok(!(await flag('hidden', 'sway')), 'eye shows it again');
  let sb = await btnBox('sway', 'Solo'); await p.mouse.click(sb.x, sb.y); await wait(200);
  await p.mouse.move(800, 40); await wait(200);
  ok((await vis('sway', 'Solo')) === 'visible' && (await vis('sway', 'Lock lane')) === 'hidden' && (await ev(() => document.querySelector('.gutter[data-axis=sway]').closest('.lrow').querySelector('.btns [aria-label=Solo]').getAttribute('aria-pressed'))) === 'true', 'solo pressed and kept showing');
  await p.mouse.move(sway.canvas.x + 600, sway.canvas.y + 20); await wait(200);
  sb = await btnBox('sway', 'Solo'); await p.mouse.click(sb.x, sb.y); await wait(200);
  const cb = await btnBox('sway', 'Collapse sway'); await p.mouse.click(cb.x, cb.y); await wait(300);
  const strip = await box('.strip[data-axis=sway]');
  ok(await flag('collapsed', 'sway') && strip && Math.abs(strip.h - 22) < 1, `collapse: a ${strip?.h} px strip`);
  await p.mouse.click(strip.x + 120, strip.y + strip.h / 2); await wait(300);
  ok(!(await flag('collapsed', 'sway')) && !!(await box('.gutter[data-axis=sway]')), 'a click on the strip opens the lane again');
  // reorder: drag the pitch gutter onto the top half of the stroke lane
  const g1 = await box('.gutter[data-axis=pitch]'), t1 = await box('.gutter[data-axis=stroke]');
  await p.mouse.move(g1.x + 9, g1.y + g1.h / 2); await p.mouse.down();
  for (let k = 1; k <= 10; k++) { await p.mouse.move(g1.x + 9 + k * 30, g1.y + g1.h / 2 + ((t1.y + 6 - g1.y - g1.h / 2) * k) / 10); await wait(30); }
  await p.mouse.up(); await wait(400);
  const order = await ev(() => [...document.querySelectorAll('[data-area=timeline] .lrow')].map((r) => r.querySelector('[data-axis]')?.dataset.axis));
  ok(order[0] === 'pitch', `gutter drag reorders: ${order.join(' ')}`);
  // the gutter click picks the lane
  const gs = await box('.gutter[data-axis=twist]');
  await p.mouse.click(gs.x + 9, gs.y + gs.h / 2); await wait(200);
  ok((await ev(() => window.app.doc.activeAxis)) === 'twist', 'a gutter click makes it the lane being edited');
  await ev(() => window.app.settings.set('lanes.layout', { ...window.app.settings.get('lanes.layout'), order: [] }));
  await ev(() => window.app.setActiveAxis('stroke'));
  await wait(300);

  // ---- (2) time 0 mid-lane ---- (the Scenes and Tracker rows unfolded too)
  // Refine: the Tracker row is a row there (on the Track tab it is the stroke lane itself since 84468ba, paw-unuy)
  await ev(() => { const a = window.app; a.setMode('refine'); a.layout.setRow('timeline.scenes', { collapsed: false }); a.layout.setRow('tracking', { collapsed: false }); });
  await wait(600);
  await ev(() => { const a = window.app; a.player.setLoop(null); a.select([], 'stroke'); a.setView({ start: -2000, span: 4000 }); });
  await wait(500);
  const view = await ev(() => window.app.view);
  ok(view.start === -2000, `the view pans past the start (start ${view.start})`);
  const rows = await ev(() => [...document.querySelectorAll('[data-area=timeline] .stack > .row')].map((r) => {
    const o = r.querySelector('[data-oob=pre]'), rr = r.getBoundingClientRect(), q = o?.getBoundingClientRect();
    return { name: r.querySelector('[data-tl-lane]')?.dataset.tlLane || (r.querySelector('.lrow') ? 'lanes' : r.querySelector('.tl .cv') ? 'tracker' : r.querySelector('.ov, canvas')?.className || '?'), n: r.querySelectorAll('[data-oob=pre]').length, w: rr.width, ow: q?.width, bg: o && getComputedStyle(o).backgroundImage, br: o && getComputedStyle(o).borderRightWidth };
  }));
  for (const r of rows) console.log(`     row ${r.name}: ${r.n} band(s), ${r.ow ? (r.ow / r.w * 100).toFixed(0) + '%' : '-'}`);
  for (const name of ['ruler', 'scenes', 'lanes', 'tracker']) {
    const r = rows.find((x) => x.name === name);
    ok(r && r.n >= 1 && Math.abs(r.ow / r.w - 0.5) < 0.02 && /repeating-linear-gradient/.test(r.bg) && parseFloat(r.br) > 0, `${name}: the hatched out-of-range band covers the half before 0, boundary line ${r?.br}`);
  }
  ok(rows.find((x) => x.name === 'lanes')?.n === 6, 'every axis lane has the band');
  const st0 = await box('.lrow .canvas');
  const outA = await region({ x: st0.x + 40, y: st0.y + 4, w: st0.w / 2 - 60, h: st0.h - 8 }), inA = await region({ x: st0.x + st0.w / 2 + 20, y: st0.y + 4, w: st0.w / 2 - 40, h: st0.h - 8 });
  ok(Math.abs(outA.lum - inA.lum) > 1, `the out-of-range looks different (lum ${outA.lum.toFixed(1)} vs ${inA.lum.toFixed(1)})`);
  if (shots) await p.screenshot({ path: shots + '/lanes-2-zero-mid.png' });

  // ---- (3) loop on: the wrap ghost ----
  const noLoopCol = (await region({ x: st0.x + 40, y: st0.y + 4, w: st0.w / 2 - 60, h: st0.h - 8 })).col;
  const said = await drawnTexts(() => { const a = window.app; a.player.setLoop({ t0: 0, t1: a.durationMs }); });
  ok(said.includes('↻ end of loop'), 'the "↻ end of loop" label is drawn before 0');
  const loopCol = (await region({ x: st0.x + 40, y: st0.y + 4, w: st0.w / 2 - 60, h: st0.h - 8 })).col;
  ok(loopCol > noLoopCol + 0.002, `the wrap ghost is painted in the out-of-range (coloured px ${(noLoopCol * 100).toFixed(2)}% -> ${(loopCol * 100).toFixed(2)}%)`);
  if (shots) await p.screenshot({ path: shots + '/lanes-3-loop-start.png' });
  const n0 = await ev(() => window.app.doc.axes.stroke.length);
  await ev(() => window.app.player.seek(1000));
  await p.mouse.click(st0.x + st0.w * 0.25, st0.y + st0.h / 2); await wait(300);
  const tAfter = await ev(() => window.app.player.timeMs);
  ok(tAfter >= 0 && tAfter < 40, `a click in the out-of-range seeks to the start (${tAfter.toFixed(1)} ms)`);
  await p.mouse.dblclick(st0.x + st0.w * 0.25, st0.y + st0.h / 3); await wait(300);
  ok((await ev(() => window.app.doc.axes.stroke.length)) === n0 && (await ev(() => window.app.doc.axes.stroke[0].at)) >= 0, `a double-click there adds no point (${n0})`);
  const said2 = await drawnTexts(() => { const a = window.app; a.setView({ start: a.durationMs - 2000, span: 4000 }); });
  ok(said2.includes('↻ start of loop'), 'past the end: the "↻ start of loop" label is drawn');
  const post = await ev(() => { const o = document.querySelector('.lrow [data-oob=post]'); return o && { x: o.getBoundingClientRect().x, bl: getComputedStyle(o).borderLeftWidth }; });
  ok(post && Math.abs(post.x - (st0.x + st0.w / 2)) < 2 && parseFloat(post.bl) > 0, 'the end sits mid-lane with its boundary line');
  await p.mouse.dblclick(st0.x + st0.w * 0.8, st0.y + st0.h / 3); await wait(300);
  ok((await ev(() => window.app.doc.axes.stroke.length)) === n0 && (await ev(() => window.app.doc.axes.stroke.at(-1).at <= window.app.durationMs)), 'no point past the end either');
  if (shots) await p.screenshot({ path: shots + '/lanes-4-loop-end.png' });
  // fit is still exactly 0..end
  await ev(() => window.app.commands.run('view.fit'));
  const fv = await ev(() => [window.app.view.start, window.app.view.span, window.app.durationMs]);
  ok(fv[0] === 0 && fv[1] === fv[2] && !(await box('.lrow [data-oob=pre]')) && !(await box('.lrow [data-oob=post]')), 'fit: exactly 0..end, no band');
  await ev(() => window.app.player.setLoop(null));
} catch (e) { fails++; console.log('ERR', e); }
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
