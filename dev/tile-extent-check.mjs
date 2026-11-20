// dev/tile-extent-check.mjs -- paw-j3to (tiles end where the loop ends) in YOUR test instance (node dev/test-app.mjs start ...;
// the CDP_* env it prints), on a loop clip whose loop goes on one frame late and redrawn:
//   node dev/make-loop-clip.mjs <dir>/tilestop.mp4 --secs 16 --segs '60:20:100:100;160:1:1:119;161:20:100:100' --redraw 160:24
// = 20 pictures 5 passes from frame 60 (exact), frame 160 holds the last picture (the slip), frames 161-260 the same cycle one
// frame late with a quarter of its cells redrawn (+24 grey: never an exact repeat), then pictures shown once.
// By real pointer events on the Shots strip and the app's commands, asserted on the loop and the script:
//   Tile loop stops at the 5th pass (frame 160) and offers the shifted continuation on the tiles' end (its tip); a click there
//   continues one frame later to frame 260; a spurt marker inside stops the tiles there; dragging the end by hand goes past it
//   (to frame 140: the redrawn passes are a loop of their own, which a drag never crosses).
// Every page exception and console error fails it. Use a fresh copy of the clip each run: an autosave of an earlier run asks
// "Recover unsaved work?", which a script may not discard.   node dev/tile-extent-check.mjs <clip.mp4>
import { connectTestApp } from './cdp-connect.mjs';

const [clip] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/tile-extent-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id); }).catch(() => {});
const settle = async (pred, n = 60) => { for (let k = 0; k < n; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
const FM = 1000 / 30, ms = (f) => Math.round(f * FM);
const loop = () => ev(() => { const l = (app.doc.loops || []).find((x) => x.auto && x.t0 < 2100 && x.t0 > 1900); return l ? JSON.parse(JSON.stringify(l)) : null; });
const near = (a, b, tol = 40) => Math.abs(a - b) <= tol;
const laneBox = () => ev(() => { const r = document.querySelector('[data-tl-lane="scenes"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const xOf = async (t) => { const v = await ev(() => app.view), b = await laneBox(); return b.x + ((t - v.start) / v.span) * b.w; };
/** Tile loop on the loop (the command acts on the loop under the playhead / selected: the playhead goes into its cycle) */
const tile = async (l) => { await ev((t) => app.player.seek(t), l.t0 + 10); for (let k = 0; k < 20 && !(await ev((t) => Math.abs(app.player.timeMs - t) < 40, l.t0 + 10)); k++) await wait(200); return ev((id) => app.commands.run('loops.tile', { id }), l.id); };
const toasts = () => ev(() => window.__toasts || []);
const tip = () => ev(() => document.querySelector('.k-tip .txt')?.textContent || '');
/** The y on the Shots strip where the tiles' end of the loop answers at time t (its tip names it). */
async function endY(t) {
  const b = await laneBox(), x = await xOf(t);
  for (let y = 2; y < b.h - 1; y += 2) { await page.mouse.move(x, b.y + y); await wait(120); if (/^Tiles' end/.test(await tip())) return { x, y: b.y + y, text: await tip() }; }
  return null;
}

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ev(() => { window.__toasts = []; const o = app.toast.bind(app); app.toast = (m, ...a) => { window.__toasts.push(String(m)); return o(m, ...a); }; });
  await ev(() => app.load({}));
  ev((p) => app.project.openVideo(p, { force: true }), clip).catch(() => {});
  ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), 'the clip opened');
  ok(await settle(() => (app.doc.loops || []).some((l) => l.auto && Math.abs(l.t0 - 2000) < 40), 120), 'the repeats marked the loop at frame 60');
  const L0 = await loop();
  ok(L0 && near(L0.t1 - L0.t0, ms(20), 2), `its cycle is 20 frames (${L0 && L0.t1 - L0.t0} ms)`);
  await ev(({ end }) => {
    app.transact('Shot (check)', () => { app.doc.scenes = [{ start_ms: 0, end_ms: end }]; });
    app.setMode('track'); app.player.pause(); app.setView({ start: 0, span: 14000 });
  }, { end: ms(480) });
  // the cycle scripted: two points inside [t0, t1)
  await ev((l) => app.transact('Cycle (check)', () => app.edit('Cycle (check)', 'stroke', [{ at: l.t0, pos: 10 }, { at: l.t0 + 300, pos: 90 }])), L0);
  await wait(300);
  // 1. Tile loop: stops at the 5th pass, the shifted continuation offered
  await tile(L0);
  await settle(() => app.doc.loops.some((l) => l.tiledTo > l.t1), 60);
  let L = await loop();
  ok(L && near(L.tiledTo, ms(160)), `Tile loop stops at the 5th pass: tiled to ${L?.tiledTo} ms (frame 160 = ${ms(160)})`);
  ok(L?.cont?.shift === 1, `the same cycle one frame later is offered (${JSON.stringify(L?.cont)})`);
  console.log('     toasts:', JSON.stringify((await toasts()).slice(-3)));
  ok(await ev((t) => !app.doc.axes.stroke.some((a) => a.at > t + 1), L.tiledTo), 'no tile point past the tiles\' end');
  // its tip on the tiles' end, and a click there continues
  const h = await endY(L.tiledTo);
  ok(h && /click to continue from here, shifted/.test(h.text), `the tiles' end says so: "${(h?.text || '').slice(0, 140)}"`);
  if (h) { await page.mouse.click(h.x, h.y); await wait(300); }
  ok(await settle(() => app.doc.loops.some((l) => l.shifted), 60), 'a click on the tiles\' end continued it');
  L = await loop();
  ok(L && near(L.tiledTo, ms(260)), `continued one frame later to ${L?.tiledTo} ms (frame 260 = ${ms(260)}), not past the redrawn passes`);
  ok(L?.shifted && near(L.shifted.ms, FM, 1), `shifted by one frame (${JSON.stringify(L?.shifted)})`);
  // 2. a spurt marker inside stops the tiles there
  await ev((id) => app.commands.run('loops.removeTiles', { id }), L0.id);
  await wait(200);
  await ev(() => app.transact('Spurt (check)', () => { app.doc.fx = [...(app.doc.fx || []), { id: 'chk-spurt', kind: 'spurt', t0: 3000, t1: 3000, params: {} }]; }));
  await tile(L0);
  await settle(() => app.doc.loops.some((l) => l.tiledTo > l.t1), 60);
  L = await loop();
  ok(L && L.tiledTo === 3000, `a spurt marker at 3000 ms stops the tiles there (${L?.tiledTo})`);
  // 3. by hand: drag the tiles' end past the marker and the pictures
  const g = await endY(L.tiledTo);
  ok(!!g, 'the tiles\' end found on the Shots strip');
  if (g) {
    const x2 = await xOf(4700);   // (up to the next loop: the repeats marked the redrawn passes as one)
    await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(x2, g.y, { steps: 8 }); await page.mouse.up();
    await wait(400);
  }
  L = await loop();
  ok(L && near(L.tiledTo, ms(140), 40) && L.tiledHand === true, `dragged by hand: tiled to ${L?.tiledTo} ms (by hand ${L?.tiledHand})`);
  ok(await ev(() => !app.dialog), 'no dialog');
} catch (e) { fails++; console.log('FAIL', e.stack || e); }
console.log(fails ? `${fails} failed` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
