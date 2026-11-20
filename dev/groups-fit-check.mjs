// dev/groups-fit-check.mjs -- paw-q3ad: on a stage shorter than the Groups bar the bar wraps into more columns (no hidden scroll,
// every button inside the stage), and the first-run hint, the bar and the notes card never overlap (the hint goes to the
// stage's foot while the tool is open). In YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env), a 30 s video
// open, first-run hints on (a new profile):   node dev/groups-fit-check.mjs [shots dir]      exits 1 when a check fails
import { connectTestApp } from './cdp-connect.mjs';
const [out] = process.argv.slice(2);
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const cdp = await page.context().newCDPSession(page);
const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const meet = (a, c) => !!a && !!c && a.x < c.x + c.w - 0.5 && c.x < a.x + a.w - 0.5 && a.y < c.y + c.h - 0.5 && c.y < a.y + a.h - 0.5;
const geo = () => ev(() => {
  const R = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return q.width ? { x: q.x, y: q.y, w: q.width, h: q.height } : null; };
  const d = document.querySelector('[data-testid="groups-tools"]'), st = R(document.querySelector('[data-testid="video-stage"]'));
  const kids = d ? [...d.children].map(R).filter(Boolean) : [];
  return { st, dock: R(d), scroll: d ? d.scrollHeight - d.clientHeight : 0, outside: kids.filter((k) => k.y + k.h > st.y + st.h + 0.5 || k.x + k.w > st.x + st.w + 0.5).length,
    notes: R(document.querySelector('[data-testid="groups-notes-card"]')), hint: R(document.querySelector('[data-testid="onboard-hint"]')) };
});
await ev(() => { app.settings.set('onboard.hints', true); app.doc.scenes = [{ start_ms: 0, end_ms: 15000, tags: ['anal'] }, { start_ms: 15000, end_ms: 30000, tags: ['anal'] }]; app.setMode('track'); app.player.seek(3000, { exact: true }); });
for (const [w, h] of [[1100, 700], [1600, 1000]]) {
  const { windowId } = await cdp.send('Browser.getWindowForTarget'); await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: w, height: h } }); await wait(800);
  await ev(() => { app.player.seek(3000, { exact: true }); window.__pawDev.groupsFor(app).toggle(true); }); await wait(1000);
  if (!(await ev(() => window.__pawDev.groupsFor(app).groups.length))) {   // one stroke: a take, so leaving its frame brings the notes card
    const r = await ev(() => { const q = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
    const px = (nx, ny) => [r.x + nx * r.w, r.y + ny * r.h];
    let [x, y] = px(0.6, 0.5); await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    for (let k = 1; k <= 12; k++) { [x, y] = px(0.6 + k * 0.01, 0.5 + k * 0.005); await mouse('mouseMoved', x, y, { button: 'left', buttons: 1 }); await wait(14); }
    await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 }); await wait(1200);
  }
  let g = await geo();
  ok(g.scroll <= 1 && !g.outside, `${w}x${h}: stage ${Math.round(g.st.h)} px tall, bar ${Math.round(g.dock.w)} x ${Math.round(g.dock.h)} px, no hidden scroll (${g.scroll}), every button inside the stage (${g.outside} out)`);
  await ev(() => app.player.seek(6000, { exact: true })); await wait(900);
  g = await geo();
  ok(!!g.notes, `${w}x${h}: off the groups' frame the notes card is up`);
  ok(!g.hint || (!meet(g.hint, g.notes) && !meet(g.hint, g.dock)), `${w}x${h}: the hint ${g.hint ? `(${Math.round(g.hint.y)}..${Math.round(g.hint.y + g.hint.h)})` : '(not shown)'} meets neither the notes card nor the bar`);
  ok(!meet(g.notes, g.dock), `${w}x${h}: the notes card is clear of the bar`);
  if (out) await page.screenshot({ path: `${out}/groups-fit-${w}x${h}.png` });
  await ev(() => window.__pawDev.groupsFor(app).toggle(false)); await wait(400);
}
await b.close();
process.exit(fails ? 1 : 0);
