// dev/selkeys-check.mjs -- paw-qbvj, the owner's "a toggles, so the same a to toggle selection logic, ... b for box select, c for
// brush select": Blender's selection keys on the timeline (lib/selmodal.js). Real key / pointer / wheel events over CDP in YOUR
// test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a copy of a generated clip >= 20 s.
//   node dev/selkeys-check.mjs <clip.mp4>
// For the stroke lane's points and for the Modifiers row: A toggles all / none; B then a drag selects what the box covers and
// adds to the selection, Shift+drag takes out, Esc mid-drag leaves the selection as it was; C paints in and (Shift) out, the
// wheel changes the brush and neither zooms nor scrolls the timeline while C is on, and zooms again after it ends. Also: B and
// C show their status line and the crosshair; bookmarks are gone (B adds none, no command); the cutaway is Alt+C (C is circle
// select in the Scenes tab too). Every page exception and console error fails it.
import { copyFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { posToY } from '../src/features/lanes/geom.js';

const src = process.argv[2];
if (!src) { console.error('usage: node dev/selkeys-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const settle = async (pred) => { for (let k = 0; k < 40; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
const VIEW = { start: 8000, span: 10000 };
const setView = async (v = VIEW) => { await ev((v) => app.setView(v), v); await wait(300); };
const rect = (sel) => ev((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height, v: { ...app.view } }; }, sel);
const xOf = (g, t) => g.left + ((t - g.v.start) / g.v.span) * g.w;
const FX = '[data-tl-lane="fx"] canvas', LANE = 'canvas.over[aria-label^="stroke lane"]';
const pts = () => ev(() => (app.doc.selection.axis === 'stroke' ? [...app.doc.selection.ats].sort((a, b) => a - b) : []));
const fxSel = () => ev(() => { const tl = window.__pawDev.tlFor ? window.__pawDev.tlFor(app) : window.__pawDev.tl; return [...tl.fxSel].sort(); });
const modal = () => ev(() => ({ on: document.documentElement.classList.contains('sel-modal'), el: document.querySelector('[data-sel-modal]')?.dataset.selModal ?? null, hint: window.__selHint ?? null }));
const radius = () => ev(() => app.settings.get('timeline.circleRadius', 24));
const view = () => ev(() => ({ ...app.view }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blurAll = () => ev(() => document.activeElement?.blur?.());
const focusFx = () => ev(() => document.querySelector('[data-tl-lane="fx"]').focus());
/** A left drag from (x0, y0) to (x1, y1); shift: held through it. */
async function drag(x0, y0, x1, y1, { shift = false, steps = 8 } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps }); await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await wait(200);
}

try {
  const mine = join(dirname(src), 'selkeys-' + basename(src));
  if (mine !== src) copyFileSync(src, mine);
  await ev(() => app.load({}));
  ev((p) => app.project.openVideo(p, { force: true }), mine).catch(() => {});
  ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), `the clip opened (${basename(mine)})`);
  await ev(() => {
    window.__selHint = null;
    addEventListener('pawscript:xform', (e) => { window.__selHint = e.detail?.hint ?? null; });
    app.setMode('refine'); app.player.pause(); app.setActiveAxis('stroke');
    const p = Array.from({ length: 20 }, (_, i) => ({ at: i * 1000, pos: i % 2 ? 80 : 20 }));
    app.transact('Seed', () => {
      app.edit('Seed', 'stroke', p);
      app.doc.fx = [{ id: 'sk1', kind: 'orgasm', t0: 9000, t1: 10000 }, { id: 'sk2', kind: 'knotting', t0: 12000, t1: 13000 }, { id: 'sk3', kind: 'throbbing', t0: 15000, t1: 16000 }];
    });
    app.select([], 'stroke');
  });
  await wait(600);
  await setView();
  let L = await rect(LANE);
  const yOf = (pos) => L.top + posToY(L.h, pos);
  const inView = (await ev(() => app.doc.axes.stroke.filter((a) => a.at >= 8000 && a.at <= 18000).length));

  // ---- lane points ----
  // A: nothing selected -> all; again -> none; a partial selection -> none
  await blurAll();
  await page.keyboard.press('a'); await wait(200);
  ok((await pts()).length === 20, `A with nothing selected: every point on the lane (${(await pts()).length})`);
  await page.keyboard.press('a'); await wait(200);
  ok((await pts()).length === 0, 'A again: none');
  await ev(() => app.select([3000, 4000], 'stroke'));
  await page.keyboard.press('a'); await wait(200);
  ok((await pts()).length === 0, 'A with two selected: none (Blender 2.7x)');
  ok(inView === 11, `the view shows 8-18 s (${inView} points)`);

  // B: the box adds to the selection; the hint and the crosshair while it is on; it ends on release
  await ev(() => app.select([10000], 'stroke'));
  await page.keyboard.press('b'); await wait(150);
  let m = await modal();
  ok(m.on && m.el === 'box' && /^Box select/.test(m.hint || ''), `B: box mode on, the status line says so ("${m.hint}")`);
  ok((await ev((sel) => getComputedStyle(document.querySelector(sel)).cursor, LANE)) === 'crosshair', 'and the cursor is the crosshair');
  await drag(xOf(L, 11500), L.top + 3, xOf(L, 13500), L.top + L.h - 3);
  ok(same(await pts(), [10000, 12000, 13000]), `B, drag over 12-13 s: those two added to the one selected (${await pts()})`);
  m = await modal();
  ok(!m.on && !m.el && m.hint == null, 'released: the mode ended, its status line and box gone');
  // B starting ON a point (a plain drag there would move it): still a box
  const s0 = JSON.stringify(await ev(() => app.doc.axes.stroke));
  await page.keyboard.press('b'); await wait(150);
  await drag(xOf(L, 14000), yOf(20) + 4, xOf(L, 15500), L.top + 3);   // 4 px under the point: still its grab reach
  ok(same(await pts(), [10000, 12000, 13000, 14000, 15000]), `B from a point: a box, not a move (${await pts()})`);
  ok(JSON.stringify(await ev(() => app.doc.axes.stroke)) === s0, 'no point moved');
  // Shift+drag takes out
  await page.keyboard.press('b'); await wait(150);
  await drag(xOf(L, 11800), L.top + 3, xOf(L, 12200), L.top + L.h - 3, { shift: true });
  ok(same(await pts(), [10000, 13000, 14000, 15000]), `B, Shift+drag over 12 s: taken out (${await pts()})`);
  // Esc mid-drag: as it was
  await page.keyboard.press('b'); await wait(150);
  await page.mouse.move(xOf(L, 15800), L.top + 3); await page.mouse.down(); await page.mouse.move(xOf(L, 17500), L.top + L.h - 3, { steps: 8 });
  await page.keyboard.press('Escape'); await wait(100); await page.mouse.up(); await wait(200);
  ok(same(await pts(), [10000, 13000, 14000, 15000]) && !(await modal()).on, `B, Esc while dragging: the selection as it was, the mode over (${await pts()})`);

  // C: paint in, Shift paints out, the wheel sizes the brush and leaves the view alone; after it ends the wheel zooms again
  await ev(() => app.select([], 'stroke'));
  await page.mouse.move(xOf(L, 11000), yOf(80));
  const r0 = await radius();
  await page.keyboard.press('c'); await wait(150);
  m = await modal();
  ok(m.on && m.el === 'circle' && /^Circle select/.test(m.hint || '') && /wheel/.test(m.hint || ''), `C: circle mode on, a circle at the pointer ("${m.hint}")`);
  await drag(xOf(L, 11000), yOf(80), xOf(L, 12000), yOf(20));
  ok(same(await pts(), [11000, 12000]), `C, a drag from 11 s to 12 s: both painted in (${await pts()})`);
  ok((await modal()).on, 'released: C stays on (more strokes)');
  await drag(xOf(L, 12000), yOf(20), xOf(L, 12000) + 2, yOf(20), { shift: true });
  ok(same(await pts(), [11000]), `C, Shift+drag over 12 s: painted out (${await pts()})`);
  let v0 = await view();
  await page.mouse.move(xOf(L, 14000), L.top + L.h / 2);
  for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, -100); await wait(80); }
  const r1 = await radius();
  ok(r1 > r0, `C: the wheel grows the brush (${r0} -> ${r1} px)`);
  ok(same(await view(), v0), 'and the timeline neither zooms nor scrolls while C is on');
  for (let k = 0; k < 2; k++) { await page.mouse.wheel(0, 100); await wait(80); }
  ok((await radius()) < r1, `wheel down: smaller (${await radius()} px)`);
  await page.keyboard.press(']'); await wait(80);
  ok((await radius()) > r0 - 50 && /r \d+ px/.test((await modal()).hint || ''), `] steps it too, the status line shows the radius ("${(await modal()).hint}")`);
  await page.keyboard.press('Escape'); await wait(150);
  ok(!(await modal()).on && same(await pts(), [11000]), 'Esc: C ends, the painted selection kept');
  v0 = await view();
  await page.mouse.move(xOf(L, 14000), L.top + L.h / 2);
  await page.mouse.wheel(0, -100); await wait(300);
  ok(!same(await view(), v0), `after C ends the wheel zooms the timeline again (span ${Math.round(v0.span)} -> ${Math.round((await view()).span)})`);
  await setView(); L = await rect(LANE);

  // ---- the Modifiers row ----
  let g = await rect(FX);
  const yFx = g.top + g.h / 2;
  await ev(() => { const tl = window.__pawDev.tlFor ? window.__pawDev.tlFor(app) : window.__pawDev.tl; tl.fx = null; tl.fxSel = []; });
  await focusFx(); await wait(100);
  await page.keyboard.press('a'); await wait(200);
  ok(same(await fxSel(), ['sk1', 'sk2', 'sk3']), `Modifiers row, A with none selected: every modifier (${await fxSel()})`);
  await page.keyboard.press('a'); await wait(200);
  ok(same(await fxSel(), []), 'A again: none');
  ok((await pts()).length === 1, 'the points kept their own selection (A went to the row that has the keyboard)');
  // B: adds
  await ev(() => { const tl = window.__pawDev.tlFor ? window.__pawDev.tlFor(app) : window.__pawDev.tl; tl.fx = 'sk1'; tl.fxSel = ['sk1']; });
  await page.keyboard.press('b'); await wait(150);
  await drag(xOf(g, 11000), yFx, xOf(g, 14000), yFx);
  ok(same(await fxSel(), ['sk1', 'sk2']), `Modifiers row, B over 11-14 s: the knotting added to the orgasm (${await fxSel()})`);
  ok((await ev(() => app.doc.fx.length)) === 3, 'no modifier was drawn by that drag');
  await page.keyboard.press('b'); await wait(150);
  await drag(xOf(g, 8500), yFx, xOf(g, 10500), yFx, { shift: true });
  ok(same(await fxSel(), ['sk2']), `B, Shift+drag over the orgasm: taken out (${await fxSel()})`);
  await page.keyboard.press('b'); await wait(150);
  await page.mouse.move(xOf(g, 14500), yFx); await page.mouse.down(); await page.mouse.move(xOf(g, 16500), yFx, { steps: 8 });
  await page.keyboard.press('Escape'); await wait(100); await page.mouse.up(); await wait(200);
  ok(same(await fxSel(), ['sk2']) && (await ev(() => app.doc.fx.length)) === 3, `B, Esc while dragging: as it was (${await fxSel()})`);
  // C: paints in what it touches, Shift paints out
  await page.mouse.move(xOf(g, 15500), yFx);
  await page.keyboard.press('c'); await wait(150);
  await drag(xOf(g, 15500), yFx, xOf(g, 15600), yFx);
  ok(same(await fxSel(), ['sk2', 'sk3']), `Modifiers row, C over the throbbing: painted in (${await fxSel()})`);
  await drag(xOf(g, 12500), yFx, xOf(g, 12600), yFx, { shift: true });
  ok(same(await fxSel(), ['sk3']), `C, Shift over the knotting: painted out (${await fxSel()})`);
  v0 = await view();
  for (let k = 0; k < 2; k++) { await page.mouse.wheel(0, -100); await wait(80); }
  ok(same(await view(), v0), 'C on the Modifiers row: the wheel leaves the view alone');
  await page.keyboard.press('Enter'); await wait(150);
  ok(!(await modal()).on && same(await fxSel(), ['sk3']), 'Enter: C ends, the selection kept');
  v0 = await view();
  await page.mouse.move(xOf(g, 13000), yFx); await page.mouse.wheel(0, -100); await wait(300);
  ok(!same(await view(), v0), 'after C ends the wheel over the Modifiers row zooms again');
  await setView();

  // ---- bookmarks are gone; the cutaway is Alt+C ----
  await blurAll();
  const nb = await ev(() => (app.doc.bookmarks || []).length);
  await ev(() => app.player.seek(12000, { exact: true })); await wait(200);
  await page.keyboard.press('b'); await wait(150); await page.keyboard.press('Escape'); await wait(150);
  ok((await ev(() => (app.doc.bookmarks || []).length)) === nb, 'B adds no bookmark (it is box select)');
  ok(await ev(() => ['bookmarks.add', 'bookmarks.next', 'bookmarks.prev', 'bookmarks.delete', 'palette.marks'].every((id) => !app.commands.get(id))), 'no bookmark command is left');
  await ev(() => { app.setMode('scenes'); app.transact('Shots', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 6000 }, { start_ms: 6000, end_ms: 12000 }, { start_ms: 12000, end_ms: app.durationMs }]; }); app.player.seek(8000, { exact: true }); });
  await wait(500); await blurAll();
  await page.keyboard.press('c'); await wait(150);
  m = await modal();
  ok(m.on && m.el === 'circle', 'Scenes tab: C is circle select');
  await page.keyboard.press('Escape'); await wait(150);
  ok(!(await ev(() => (app.doc.scenes[1].tags || []).includes('cutaway'))), 'and C marked no cutaway');
  await page.keyboard.press('Alt+c'); await wait(400);
  ok(await ev(() => (app.doc.scenes[1].tags || []).includes('cutaway')), 'Alt+C marks the shot at the playhead a cutaway');

  // ---- paw-evlj: B and C, ended every way, leave nothing behind: the Groups tool's dial (Alt + wheel, Alt+Up) still works after,
  // after closing and reopening the tool, and B / C pressed with the tool open start no mode ----
  await ev(() => { for (const [k, v] of Object.entries({ grow: false, snap: false, circle: false, autoFromRepeats: false, askAfter: false })) app.settings.set('tracking.groups.' + k, v); app.setMode('refine'); app.player.pause(); });
  await wait(400); await setView(); L = await rect(LANE);
  const away = await ev(() => { const r = document.querySelector('[data-testid="video-stage"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  for (const [k, how] of [['b', 'release'], ['c', 'Esc'], ['b', 'a right click'], ['c', 'a press outside every row'], ['c', 'Enter'], ['b', 'Esc']]) {
    await blurAll(); await page.mouse.move(xOf(L, 12500), L.top + L.h / 2);
    await page.keyboard.press(k); await wait(150);
    if (how === 'release') await drag(xOf(L, 12500), L.top + 3, xOf(L, 13500), L.top + L.h - 3);
    else if (how === 'Esc') await page.keyboard.press('Escape');
    else if (how === 'Enter') await page.keyboard.press('Enter');
    else if (how === 'a right click') await page.mouse.click(xOf(L, 12500), L.top + L.h / 2, { button: 'right' });
    else await page.mouse.click(...away);
    await wait(250);
    ok(!(await modal()).on, `${k.toUpperCase()} ended by ${how}: no mode left on`);
  }
  await wait(1600);   // the right click's context-menu guard (1.5 s) is gone too
  const gpx = () => ev(() => { const g = __pawDev.groupsFor(app), q = g.groups[g.active]; if (!q) return 0; const a = g.maskFor(q).a; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) n++; return n; });
  const landed = () => page.waitForFunction(() => !__pawDev.groupsFor(app).dial, null, { timeout: 20000 });   // the dial's gesture committed
  const tool = async (on) => {
    await ev((on) => { const g = __pawDev.groupsFor(app); if (g.on !== on) g.toggle(on); }, on);
    if (on) await page.waitForFunction(() => __pawDev.groupsFor(app).on && __pawDev.groupsFor(app).onFrame, null, { timeout: 15000 });
    await wait(400);
  };
  await ev(() => { app.setMode('track'); app.player.pause(); app.player.seek(14000, { exact: true }); });
  await page.waitForFunction(() => Math.abs(app.player.timeMs - 14000) < 40 && !app.player.el?.seeking, null, { timeout: 15000 }); await wait(500);
  await ev(() => { const g = __pawDev.groupsFor(app); for (let k = g.groups.length - 1; k >= 0; k--) g.remove(k); });
  await tool(true);
  const vb = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const vat = (nx, ny) => [vb.x + nx * vb.w, vb.y + ny * vb.h];
  await page.mouse.move(...vat(0.42, 0.5)); await page.mouse.down();
  for (let k = 0; k <= 10; k++) await page.mouse.move(...vat(0.42 + 0.016 * k, 0.5 + (k % 2 ? 0.05 : -0.05)));
  await page.mouse.up(); await wait(500);
  const dial = async (tag) => {
    await page.mouse.move(...vat(0.5, 0.5)); await wait(150);
    const a = await gpx();
    await page.keyboard.down('Alt'); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await wait(120); } await page.keyboard.up('Alt'); await landed();
    const b = await gpx();
    await page.keyboard.press('Alt+ArrowUp'); await landed();
    const c = await gpx();
    ok(a > 0 && b > a && c > b, `${tag}: Alt + wheel up loosens (${a} -> ${b} px) and Alt+Up one more notch (${c} px)`);
  };
  await dial('Groups after B and C ended every way');
  await page.mouse.move(...vat(0.5, 0.5));
  for (const k of ['b', 'c']) { await page.keyboard.press(k); await wait(150); ok(!(await modal()).on, `${k.toUpperCase()} with the Groups tool open starts no select mode`); }
  await ev(() => { const g = __pawDev.groupsFor(app); if (g.copy) g.closeCopy?.(); });   // C in the tool is its own "copy from a frame": put it away
  await wait(300);
  await dial('and after B and C pressed inside the tool');
  await tool(false);
  await blurAll(); await page.mouse.move(xOf(L, 12500), L.top + L.h / 2);
  await page.keyboard.press('c'); await wait(150); ok((await modal()).on, 'tool closed: C is circle select again'); await page.keyboard.press('Escape'); await wait(200);
  await tool(true);
  await dial('the tool closed and reopened');
  await tool(false);
} catch (e) {
  fails++;
  console.log('FAIL [check]', e?.stack || e);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failure(s)` : 'all ok');
process.exit(fails ? 1 : 0);
