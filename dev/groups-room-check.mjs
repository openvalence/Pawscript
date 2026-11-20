// dev/groups-room-check.mjs -- paw-8ehz in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints): with the
// Groups tool open on a generated clip, the first-run hint on and the notes card open, nothing of the tool covers the picture
// at the minimum window (900 x 600) and at 1280 x 720 (the bar, the notes card, the context line, the hint); at 1707 x 913 it is
// measured and must hold too. Closing the tool brings back the side docks it folded.
//   node dev/groups-room-check.mjs <clip.mp4> [<screenshot dir>]
import { connectTestApp } from './cdp-connect.mjs';

const [clip, shots] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/groups-room-check.mjs <clip.mp4> [<screenshot dir>]'); process.exit(2); }
const { browser, page } = await connectTestApp();
const cdp = await page.context().newCDPSession(page);
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const { windowId } = await cdp.send('Browser.getWindowForTarget');
async function size(w, h) {
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: w, height: h } });
  await wait(900);
  const [iw, ih] = await ev(() => [innerWidth, innerHeight]);   // the window's frame: make the page itself that size
  if (iw !== w || ih !== h) { await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 2 * w - iw, height: 2 * h - ih } }); await wait(900); }
}
for (let k = 0; k < 40 && !(await ev(() => !!app.doc.media && app.player.ready)); k++) {
  if (k === 0) ev((c) => app.project.openVideo(c, { force: true }), clip).catch(() => {});
  await wait(500);
  await ev(() => { const d = app.dialog; if (d) d.resolve(/^Recover/.test(d.title || '') ? 'restore' : d.choices?.[0]?.id ?? null); });
}
const measure = () => ev(() => {
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; };
  const stage = document.querySelector('[data-testid="video-stage"]');
  const video = R(stage.querySelector('video'));
  const S = R(stage), pic = video && S ? (() => { const x0 = Math.max(video.x, S.x), y0 = Math.max(video.y, S.y), x1 = Math.min(video.x + video.w, S.x + S.w), y1 = Math.min(video.y + video.h, S.y + S.h); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; })() : null;
  const parts = { bar: R(stage.querySelector('[data-testid="groups-tools"]')), card: R(stage.querySelector('.gside .card')), ctx: R(stage.querySelector('.ctx')), hint: R(stage.querySelector('[data-testid="onboard-hint"]')) };
  const cut = (a, b) => (a && b ? Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) : 0);
  const over = Object.fromEntries(Object.entries(parts).map(([k, r]) => [k, Math.round(cut(r, pic))]));
  const inStage = Object.fromEntries(Object.entries(parts).map(([k, r]) => [k, !r || (r.x >= S.x - 1 && r.y >= S.y - 1 && r.x + r.w <= S.x + S.w + 1 && r.y + r.h <= S.y + S.h + 1)]));
  return { stage: S, pic, parts, over, inStage, hintCard: Math.round(cut(parts.hint, parts.card)) };
});
const docks = () => ev(() => Object.fromEntries(['left', 'right'].map((d) => [d, !!document.querySelector(`.rail.${d}`)])));
for (const [w, h] of [[900, 600], [1280, 720], [1707, 913]]) {
  await size(w, h);
  await ev(() => {
    const G = window.__pawDev.groupsFor(app);
    if (G.on) G.toggle();
    app.layout.reset(); app.setMode('track');
    app.doc.scenes = [{ start_ms: 0, end_ms: 15000, tags: ['handjob'] }, { start_ms: 15000, end_ms: 40000 }];
    app.settings.set('onboard.hints', true); app.player.pause(); app.player.seek(5000);
  });
  await wait(700);
  const before = await docks();
  await ev(() => window.__pawDev.groupsFor(app).toggle());
  await wait(1500);
  await ev(() => { const b = document.querySelector('[data-testid="groups-notes"], .gdock [aria-label^="Notes"]'); if (b && !document.querySelector('.gside .card')) b.click(); });
  await wait(700);
  const m = await measure();
  const shown = Object.entries(m.parts).filter(([, r]) => r).map(([k]) => k).join(', ');
  ok(m.pic && m.pic.w > 100 && m.pic.h > 56, `${w}x${h}: the picture ${m.pic ? `${Math.round(m.pic.w)} x ${Math.round(m.pic.h)}` : 'not found'} in a ${Math.round(m.stage.w)} x ${Math.round(m.stage.h)} stage`);
  ok(Object.values(m.over).every((a) => a === 0), `${w}x${h}: nothing over the picture (${shown} shown; px2 over it ${JSON.stringify(m.over)})`);
  ok(Object.values(m.inStage).every(Boolean), `${w}x${h}: all of it inside the stage ${JSON.stringify(m.inStage)}`);
  ok(m.hintCard === 0, `${w}x${h}: the hint and the notes card apart (${m.hintCard} px2)`);
  if (shots) await page.screenshot({ path: `${shots}/groups-room-${w}x${h}.png` });
  await ev(() => window.__pawDev.groupsFor(app).toggle());
  await wait(900);
  const after = await docks();
  ok(JSON.stringify(after) === JSON.stringify(before), `${w}x${h}: the tool closed, the side docks as they were (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
