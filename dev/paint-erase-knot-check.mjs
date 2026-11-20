// dev/paint-erase-knot-check.mjs -- paw-yx6q / paw-njnf in YOUR test instance (CDP_* env; dist built with VITE_TEST_ID), the
// fake sidecar's SAM (a disc round the dab; a refinement answers discs up to 1.7 x round the mask it is sent: it grows back).
// Real pointer input over CDP, the Groups tool on, grow on:
//   a dab grows a group; a Shift stroke erases a piece of it; another dab on it (a refinement that grows) -> the painted
//   overlay canvas shows nothing at the erased piece and the group still there; the stored mask agrees.
//   the group named the penis; K; a knot stroke on it -> no new group, the section stored inside the penis, and drawn a
//   darker shade of the penis colour on the overlay canvas.
//   node dev/paint-erase-knot-check.mjs <clip.mp4>
import { resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const clip = process.argv[2];
if (!clip) { console.error('usage: node dev/paint-erase-knot-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const s = await page.context().newCDPSession(page);
const mouse = (type, x, y, extra = {}) => s.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
const V = () => ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
/** A stroke through frame points [[nx, ny], ...] (one point = a dab); mods 8 = Shift. Waits for SAM to answer. */
async function strokeAt(pts, mods = 0) {
  const r = await V(), px = ([nx, ny]) => [r.x + nx * r.w, r.y + ny * r.h], [x0, y0] = px(pts[0]);
  await mouse('mouseMoved', x0, y0, { modifiers: mods });
  await mouse('mousePressed', x0, y0, { button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
  for (const q of pts.slice(1)) { const [x, y] = px(q); await mouse('mouseMoved', x, y, { button: 'left', buttons: 1, modifiers: mods }); await wait(12); }
  const [x1, y1] = px(pts.at(-1));
  await mouse('mouseReleased', x1, y1, { button: 'left', buttons: 0, clickCount: 1, modifiers: mods });
  await page.waitForFunction(() => { const G = __pawDev.groupsFor(app); return !G.draft && !G.growBusy; }, null, { timeout: 15000 }).catch(() => {});
  await mouse('mouseMoved', r.x + 5, r.y + 5);   // the ring off the picture
  await wait(350);
}
const line = (a, b, n = 16) => Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
/** What the overlay canvas painted at frame point (nx, ny): {a: max alpha in a small box, rgb at the centre}. */
const painted = ([nx, ny]) => ev(([nx, ny]) => {
  const cv = document.querySelector('[data-testid="video-stage"] canvas.ov'), v = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect();
  if (!cv) return null;
  const r = cv.getBoundingClientRect(), k = cv.width / r.width, X = Math.round((v.x + nx * v.width - r.left) * k), Y = Math.round((v.y + ny * v.height - r.top) * k), h = Math.max(1, Math.round(2 * k));
  const d = cv.getContext('2d').getImageData(X - h, Y - h, 2 * h + 1, 2 * h + 1).data, c = cv.getContext('2d').getImageData(X, Y, 1, 1).data;
  let a = 0; for (let i = 3; i < d.length; i += 4) a = Math.max(a, d[i]);
  return { a, rgb: [c[0], c[1], c[2]], lum: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] };
}, [nx, ny]);
const stored = ([nx, ny], k = 0) => ev(([nx, ny, k]) => { const G = __pawDev.groupsFor(app), g = G.groups[k], m = g && G.maskFor(g); return m ? m.a[Math.floor(ny * m.h) * m.w + Math.floor(nx * m.w)] : -1; }, [nx, ny, k]);

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.groupsFor, null, { timeout: 60000 });
  await ev(async () => { for (const c of (await app.backend.autosaveList()) || []) await app.backend.autosaveClear(c.id); });   // a fresh open, no recovery offer
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev(() => { app.setMode('track'); app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 4900 }]; }); app.player.pause(); app.player.seek(1000, { exact: true }); });
  await wait(800);
  await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); });
  await ev(() => { app.settings.set('tracking.groups.grow', true); app.settings.set('tracking.groups.snap', false); __pawDev.groupsFor(app).toggle(true); });
  await page.waitForFunction(() => __pawDev.groupsFor(app).on && __pawDev.groupsFor(app).onFrame, null, { timeout: 10000 });
  await wait(500);

  // ---- part 1: an erased piece stays erased
  const C = [0.45, 0.5], E = [0.485, 0.5], L = [0.425, 0.5];   // the dab, the erased piece (its right cap), a point left on it
  await strokeAt([C]);
  ok(await ev(() => __pawDev.groupsFor(app).groups.length) === 1, 'a grow dab: one group');
  ok((await stored(E)) >= 0.5 && (await painted(E)).a > 20, `SAM took the piece in (stored ${(await stored(E)).toFixed(2)}, painted alpha ${(await painted(E)).a})`);
  await strokeAt(line([0.485, 0.40], [0.485, 0.60]), 8);   // Shift: erase a band through the right cap
  const e1 = await painted(E);
  ok((await stored(E)) === 0 && e1.a === 0, `erased: stored 0, nothing painted there (alpha ${e1.a})`);
  await strokeAt([[0.43, 0.5]]);   // another dab on the group: a refinement, the fake SAM answers discs up to 1.7 x round the mask
  const e2 = await painted(E), l2 = await painted(L), n2 = await ev(() => __pawDev.groupsFor(app).groups.length);
  ok(n2 === 1 && l2.a > 20, `the dab landed on the group (groups ${n2}, painted alpha at its left ${l2.a})`);
  ok((await stored(E)) === 0 && e2.a === 0, `after the regrow the erased piece is still empty: stored ${await stored(E)}, painted alpha ${e2.a}`);
  ok(await ev(() => !!__pawDev.groupsFor(app).groups[0].erased), 'the erase record is on the group (saved with it)');
  // paw-i5qx: the bar's eraser: a plain stroke erases (no Shift), and it says so on the button
  await ev(() => app.settings.set('tracking.groups.grow', false));
  await page.click('[data-testid="groups-erase"]'); await wait(150);
  ok(await ev(() => document.querySelector('[data-testid="groups-erase"]').getAttribute('aria-pressed') === 'true'), 'the bar\'s eraser is on');
  const W = [0.43, 0.5];
  const w0 = await stored(W);
  await strokeAt(line([0.43, 0.42], [0.43, 0.58]));
  ok(w0 >= 0.5 && (await stored(W)) === 0 && (await ev(() => __pawDev.groupsFor(app).groups.length)) === 1, `the eraser on: a plain stroke erased (stored ${w0} -> ${await stored(W)})`);
  await page.click('[data-testid="groups-erase"]'); await wait(150);
  // from the nearest painted pixel of the group back over the erased band (a stroke that starts on the group adds to it)
  const on = await ev(([wx, wy]) => { const G = __pawDev.groupsFor(app), m = G.maskFor(G.groups[0]); let best = null; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { if (m.a[y * m.w + x] < 0.9) continue; const d = Math.hypot(x / m.w - wx, (y / m.h - wy) * m.h / m.w); if (!best || d < best[2]) best = [(x + 0.5) / m.w, (y + 0.5) / m.h, d]; } return best; }, W);
  await strokeAt(line([on[0], on[1]], W, 6));
  ok((await stored(W)) >= 0.5 && (await ev(() => __pawDev.groupsFor(app).groups.length)) === 1, 'off again: a plain stroke paints');
  await ev(() => app.settings.set('tracking.groups.grow', true));

  // ---- part 3: the knot is a section painted on the penis, no group of its own
  await ev(() => { const G = __pawDev.groupsFor(app); G.assign(0, { who: 'c2', part: 'penis' }); app.settings.set('tracking.groups.grow', false); });
  await wait(300);
  const n3 = await ev(() => __pawDev.groupsFor(app).groups.length), before = await painted(L);
  await page.keyboard.press('k');
  await wait(200);
  ok(await ev(() => __pawDev.groupsFor(app).knotBrush), 'K: the knot brush is on');
  await strokeAt(line([0.415, 0.5], [0.44, 0.5], 6));
  const st = await ev(() => { const G = __pawDev.groupsFor(app); return { n: G.groups.length, names: G.groups.map((g) => g.name), knot: !!G.groups[0].knot }; });
  ok(st.n === n3 && !st.names.some((x) => /knot|unassigned/.test(x)), `no new group (${st.names.join(', ')})`);
  ok(st.knot, 'the penis carries the knot section');
  const inside = await ev(() => { const G = __pawDev.groupsFor(app), g = G.groups[0], k = G.knotFor(g), m = G.maskFor(g); if (!k) return false; for (let i = 0; i < k.a.length; i++) if (k.a[i] > 0 && m.a[i] < 0.5) return false; return true; });
  ok(inside, 'the section lies inside the penis');
  const after = await painted(L), body = await painted([0.46, 0.45]);
  ok(after.a > 0 && after.lum < before.lum - 8 && after.lum < body.lum - 8, `drawn darker on the penis: luminance ${before.lum.toFixed(0)} -> ${after.lum.toFixed(0)} (the penis elsewhere ${body.lum.toFixed(0)})`);
  await page.keyboard.press('k');
  ok(!(await ev(() => __pawDev.groupsFor(app).knotBrush)), 'K again: back to the brush');
} catch (e) {
  fails++; console.log('FAIL [threw]', String(e?.stack || e).slice(0, 600));
} finally {
  console.log(fails ? `${fails} failed` : 'all ok');
  await browser.close().catch(() => {});
  process.exit(fails ? 1 : 0);
}
