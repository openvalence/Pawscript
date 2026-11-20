// dev/tips-e2e.mjs -- tooltips in the REAL WebView2 (not headless Chromium): no native title= anywhere, and the kit
// tip goes away (and stops being painted) under real input from CDP's Input.dispatchMouseEvent.
//
// Needs the Tauri binary, so it is not part of `npm run check`. Start YOUR test instance (hidden desktop) first:
//   node dev/test-app.mjs start --dir <scratch dir> --target <your CARGO_TARGET_DIR>
// then, with the CDP_PORT / CDP_EXPECT_URL / CDP_TEST_ID it prints set (dev/cdp-connect.mjs refuses anything else):
//   node dev/tips-e2e.mjs <clip.mp4> [screenshot dir]
//   node dev/test-app.mjs stop --dir <scratch dir>
// Exit code 1 when any check fails. An OS-drawn native tooltip is invisible to CDP screenshots: for that class the
// [title] count (and no "native title= stripped" warning from the dev/test guard in tooltip.js) is the proof.
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out = '.'] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/tips-e2e.mjs <clip.mp4> [screenshot dir]'); process.exit(2); }
const { browser: b, page } = await connectTestApp();
const cdp = await page.context().newCDPSession(page);
const errors = [], stripped = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.text().includes('native title= stripped')) stripped.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const ev = (f, arg) => page.evaluate(f, arg);
const wait = (ms) => page.waitForTimeout(ms);
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, info); };
const move = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' });
const click = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse' });
};
/** #k-tip: open (top layer) and painted (checkVisibility) -- before the fix a closed tip stayed painted. */
const tip = () => ev(() => { const t = document.getElementById('k-tip'); return t ? { open: t.matches(':popover-open'), painted: t.checkVisibility(), text: t.textContent } : { open: false, painted: false, text: '' }; });
async function hiddenWithin(ms) {
  const t0 = Date.now();
  for (;;) { const s = await tip(); if (!s.open && !s.painted) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await wait(15); }
}
const center = (sel) => ev((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.checkVisibility()); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width, h: r.height }; }, sel);
async function hover(sel) {
  const c = await center(sel);
  if (!c) return null;
  await move(c.x - 2, c.y); await move(c.x, c.y);   // enter, like a real pointer
  await wait(700);
  return c;
}
const counts = () => ev(() => ({
  title: document.querySelectorAll('[title]').length,
  svgTitle: document.querySelectorAll('svg title').length,
  paintedClosed: [...document.querySelectorAll('[popover]:not(:popover-open)')].filter((e) => e.checkVisibility()).map((e) => e.className),
}));
let worst = { title: 0, svgTitle: 0, paintedClosed: [] }, where = [];
async function tally(label) {
  await wait(250);
  const c = await counts();
  if (c.title || c.svgTitle || c.paintedClosed.length) where.push(`${label}: ${JSON.stringify(c)}`);
  worst = { title: Math.max(worst.title, c.title), svgTitle: Math.max(worst.svgTitle, c.svgTitle), paintedClosed: [...new Set([...worst.paintedClosed, ...c.paintedClosed])] };
}

// ---- open the clip ----
await ev(() => app.project.close({ force: true }));
const opening = ev((p) => app.project.openVideo(p), clip);
for (let i = 0; i < 60; i++) {
  const d = await ev(() => app.dialog && app.dialog.choices.map((c) => c.id));
  if (d) await ev((id) => app.dialog.resolve(id), d[0]);
  await wait(150);
  if (await ev(() => !!app.doc.media && !app.dialog)) break;
}
await opening; await wait(1200);
check('clip opened', await ev(() => !!app.doc.media));

// ---- (a) every main view: no [title], no SVG <title>, no closed popover painted ----
await tally('opened');
for (const mode of ['scenes', 'track', 'refine', 'review']) {
  await ev((m) => app.setMode(m), mode); await tally(mode);
  for (const dock of ['left', 'right', 'bottom']) {
    const ids = await ev((d) => app.panelsIn(d).map((p) => p.id), dock);
    for (const id of ids) { await ev(([d, i]) => app.layout.tab(d, i), [dock, id]); await tally(`${mode}/${dock}/${id}`); }
    await ev((d) => app.layout.toggle(d, false), dock); await tally(`${mode}/${dock} collapsed (rail)`);
    await ev((d) => app.layout.toggle(d, true), dock);
  }
}
await ev(() => app.setMode('refine'));
// menus: open each top-level menu of the menu bar
const menus = await ev(() => [...document.querySelectorAll('[role=menubar] [role=menuitem]')].map((e) => e.textContent.trim()));
for (const name of menus) {
  const c = await ev((n) => { const e = [...document.querySelectorAll('[role=menubar] [role=menuitem]')].find((x) => x.textContent.trim() === n); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, name);
  await click(c.x, c.y); await tally(`menu ${name}`);
  await page.keyboard.press('Escape'); await wait(150);
}
// scenes (the Track tab has the Scenes lane) -> the scene quick bar (and its effect button), the effects lane
await ev(() => { app.setMode('track'); app.transact('tips-e2e scenes', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }]; }); app.setView({ start: 0, span: 12000 }); });
await wait(300);
// 213f413 (paw-hmn): the scene quick bar is no popover of its own any more: the lane toolbar's Scene chip opens it in a kit popover
await ev(() => app.player.seek(7000)); await wait(300);
const chipC = await center('button[data-chip="scene"]');
if (chipC) { await click(chipC.x, chipC.y); await tally('scene chip (quick bar)'); }
const qbOpen = () => ev(() => !!document.querySelector('[popover]:popover-open .qb') && document.querySelector('button[data-chip="scene"]')?.getAttribute('aria-expanded') === 'true');
check('scene quick bar shown', await qbOpen());
const fxBtn = await ev(() => { const e = [...document.querySelectorAll('[popover]:popover-open .qb button')].find((x) => /effect/i.test(x.textContent)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (fxBtn) { await click(fxBtn.x, fxBtn.y); await tally('effect button'); await page.keyboard.press('Escape'); await wait(150); }
await page.keyboard.press('Escape'); await ev(() => app.player.seek(0)); await click(5, 400); await tally('quick bar dismissed');
check('scene quick bar closed again and not painted', await ev(() => !document.querySelector('[popover]:popover-open .qb') && [...document.querySelectorAll('[popover]:not(:popover-open)')].every((p) => !p.querySelector('.qb') || !p.checkVisibility())));
await ev(() => app.setMode('refine'));
check('no [title] attribute in any main view', worst.title === 0, where.join(' | ') || `max ${worst.title}`);
check('no SVG <title> element in any main view', worst.svgTitle === 0);
check('the dev/test title guard stripped nothing (the source has none)', stripped.length === 0, stripped.slice(0, 3).join(' | '));
check('no closed popover stays painted (tooltip, quick bar, menus)', worst.paintedClosed.length === 0, worst.paintedClosed.join(', '));

// ---- (b) the kit tip under real input ----
await ev(() => app.layout.toggle('bottom', true));
await page.keyboard.press('Escape');
const empty = await ev(() => { const v = document.querySelector('video'); const r = (v?.parentElement || document.body).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
// 626bf75 (areas): an area's header menu is "Area options" (was the dock's "Dock options"); its fold button "Fold" (was "Collapse")
const TRIGGER = 'button[aria-label="Area options"]';
await move(empty.x, empty.y); await wait(500);

// 1. hover, then move to empty space
let c = await hover(TRIGGER), s = await tip();
check('hover shows the tip after the delay', !!c && s.open && s.painted, JSON.stringify(s));
await page.screenshot({ path: `${out}/tips-1-shown.png` });
await move(c.x, c.y + 30); await move(empty.x, empty.y);
let ms = await hiddenWithin(200);
check('moving to empty space hides it within 200 ms (and it is not painted)', ms >= 0, `${ms} ms`);
await wait(150);
await page.screenshot({ path: `${out}/tips-2-after-leave.png` });

// 2. the trigger is removed while hovered: a folded area's rail tab, replaced when the area opens (no input). 014f5cd (paw-idb5):
// the folded bottom tray has no rail (a Show button in the status bar): the right area's rail
await ev(() => app.layout.toggle('right', false)); await wait(300);
c = await hover('nav.rail.right button.rtab'); s = await tip();
check('rail tab tip shown', !!c && s.open && /^Show /.test(s.text), JSON.stringify(s));
await ev(() => app.layout.tab('right', app.panelsIn('right')[0].id));
ms = await hiddenWithin(200);
check('trigger removed under a still pointer: hidden within 200 ms', ms >= 0, `${ms} ms`);
await move(empty.x, empty.y); await wait(500);

// 3. window blur. A real OS focus change would mean focusing this window and stealing the owner's focus, so the
// blur is dispatched in the page (the handler is the same window 'blur' listener a real switch fires).
c = await hover(TRIGGER);
check('tip shown before blur', (await tip()).open);
await ev(() => window.dispatchEvent(new Event('blur')));
ms = await hiddenWithin(200);
check('window blur hides it within 200 ms', ms >= 0, `${ms} ms`);
await move(empty.x, empty.y); await wait(500);

// 4. a cursor jump (remote desktop): one event far away, no intermediate moves
c = await hover(TRIGGER);
check('tip shown before the jump', (await tip()).open);
await move(empty.x, empty.y);
ms = await hiddenWithin(200);
check('a single far jump hides it within 200 ms', ms >= 0, `${ms} ms`);
await wait(500);

// 5. leaving the window: a move outside the viewport, then no events at all for 2 s
c = await hover(TRIGGER);
check('tip shown before leaving the window', (await tip()).open);
await move(-40, -40);
await wait(2000);
s = await tip();
check('left the window, 2 s of silence: hidden', !s.open && !s.painted, JSON.stringify(s));
await move(empty.x, empty.y); await wait(500);

// 6. the hard cap: a still pointer on the trigger, no events for > 8 s
c = await hover(TRIGGER);
check('tip shown before the cap', (await tip()).open);
await wait(4000); await move(c.x + 1, c.y);   // a move inside re-arms the cap
await wait(5000);
check('re-armed by a move inside the trigger: still shown at 9 s', (await tip()).open);
await wait(3500);
s = await tip();
check('8 s after the last move inside: hidden', !s.open && !s.painted, JSON.stringify(s));
await move(empty.x, empty.y); await wait(500);

// 7. sweeping a toolbar stays warm: a second trigger right after the first shows at once
const pair = await ev((sel) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility()).slice(0, 2).map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }), 'button[aria-label="Area options"], button[aria-label="Fold"]');
if (pair.length === 2) {
  await move(pair[0].x - 2, pair[0].y); await move(pair[0].x, pair[0].y); await wait(700);
  const t1 = (await tip()).text;
  await move(pair[1].x, pair[1].y); await wait(60);
  s = await tip();
  check('warm: the next trigger shows at once', s.open && s.text !== t1, `${t1} -> ${s.text}`);
}
await move(empty.x, empty.y);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close().catch(() => {});
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
