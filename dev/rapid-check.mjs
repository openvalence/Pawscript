// dev/rapid-check.mjs -- paw-5zpf, the owner's "adopt blenders RAPID system": the lane editor's selection modes (1 point, 2 segment,
// 3 stroke, 4 cycle), the active element, Alt+click loop, Ctrl+click path, B in a mode. Real key / pointer events over CDP in YOUR
// test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a copy of a generated clip >= 20 s.
//   node dev/rapid-check.mjs <clip.mp4> [--shots <dir>]
// Every page exception and console error fails it.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { posToY } from '../src/features/lanes/geom.js';

const src = process.argv[2], shotsAt = process.argv.indexOf('--shots'), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (!src) { console.error('usage: node dev/rapid-check.mjs <clip.mp4> [--shots <dir>]'); process.exit(2); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const settle = async (pred) => { for (let k = 0; k < 40; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
const VIEW = { start: 0, span: 21000 };
const LANE = 'canvas.over[aria-label^="stroke lane"]';
const rect = () => ev((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height, v: { ...app.view } }; }, LANE);
const sel = () => ev(() => (app.doc.selection.axis === 'stroke' ? [...app.doc.selection.ats].sort((a, b) => a - b) : []));
const active = () => ev(() => app.doc.selection.active ?? null);
const mode = () => ev(() => app.settings.get('lanes.selectMode', 'point'));
const J = (a) => JSON.stringify(a);
const blurAll = () => ev(() => document.activeElement?.blur?.());
let L;
const X = (t) => L.left + ((t - L.v.start) / L.v.span) * L.w, Y = (pos) => L.top + posToY(L.h, pos);
/** A click at (t, pos) with modifiers held. */
async function click(t, pos, mods = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(X(t), Y(pos)); await wait(60);
  await page.mouse.down(); await page.mouse.up();
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
  await wait(200);
}
/** The colour painted on the base canvas at (t, pos): [r, g, b]. */
const pixel = (t, pos) => ev(([sel, x, y]) => {
  const over = document.querySelector(sel), base = over.parentElement.querySelector('canvas.base'), r = over.getBoundingClientRect(), d = devicePixelRatio || 1;
  return [...base.getContext('2d').getImageData(Math.round((x - r.left) * d), Math.round((y - r.top) * d), 1, 1).data].slice(0, 3);
}, [LANE, X(t), Y(pos)]);
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name) }); };

try {
  const mine = join(dirname(src), 'rapid-' + basename(src));
  if (mine !== src) copyFileSync(src, mine);
  await ev(() => app.load({}));
  ev((p) => app.project.openVideo(p, { force: true }), mine).catch(() => {});
  ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), `the clip opened (${basename(mine)})`);
  // passage 1: 9 strokes of 1 s (0-9 s, low 20 / high 80), held high 9-13 s, passage 2: 7 strokes of 1 s (13-20 s)
  await ev(() => {
    app.setMode('refine'); app.player.pause(); app.setActiveAxis('stroke');
    app.settings.set('keys.preset', 'blender'); app.settings.set('lanes.selectMode', 'point');
    const p = Array.from({ length: 10 }, (_, i) => ({ at: i * 1000, pos: i % 2 ? 80 : 20 }));
    p.push({ at: 13000, pos: 80 });
    for (let j = 1; j <= 7; j++) p.push({ at: 13000 + j * 1000, pos: j % 2 ? 20 : 80 });
    app.transact('Seed', () => app.edit('Seed', 'stroke', p));
    app.select([], 'stroke');
  });
  await wait(500);
  await ev((v) => app.setView(v), VIEW); await wait(400);
  L = await rect();

  // ---- 3: Stroke mode; click, Shift+click, Ctrl+click path, Alt+click loop ----
  await blurAll();
  await page.keyboard.press('3'); await wait(200);
  ok((await mode()) === 'stroke', `3: Stroke select (${await mode()})`);
  ok(await ev(() => document.querySelector('[data-testid="lanes-selmode"] [aria-checked="true"]')?.getAttribute('aria-label') === 'Stroke select'), 'the toolbar shows Stroke select pressed');
  await page.mouse.move(X(2500), Y(50)); await wait(150);
  ok((await ev((s) => getComputedStyle(document.querySelector(s)).cursor, LANE)) === 'pointer', 'hovering a stroke: the pointer cursor (the stroke lit)');
  await click(2500, 50);
  ok(J(await sel()) === J([2000, 3000]) && J(await active()) === J([2000, 3000]), `click on the 2-3 s stroke: it is selected and active (${await sel()}, active ${J(await active())})`);
  await click(4500, 50, ['Shift']);
  ok(J(await sel()) === J([2000, 3000, 4000, 5000]) && J(await active()) === J([4000, 5000]), `Shift+click 4-5 s: added, the new one active (${await sel()})`);
  const pa = await pixel(4000, 20), pn = await pixel(2000, 20);
  ok(pa[0] > 190 && pa[1] > 190 && pa[2] > 190 && pn[1] < 170, `the active stroke's points are drawn light (${pa}), the other selected ones in the highlight (${pn})`);
  await click(7500, 50, ['Control']);
  ok(J(await sel()) === J([4000, 5000, 6000, 7000, 8000]) && J(await active()) === J([7000, 8000]), `Ctrl+click 7-8 s: the path from the active stroke (${await sel()})`);
  await click(1500, 50, ['Alt']);
  ok(J(await sel()) === J([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]), `Alt+click a down stroke: every down stroke of the passage, none past the hold (${await sel()})`);
  await click(16500, 50, ['Shift', 'Alt']);
  ok((await sel()).length === 8 + 6 && (await sel()).includes(17000), `Shift+Alt+click in passage 2: its up strokes added (${(await sel()).length} points)`);
  await shot('rapid-1-strokes.png');

  // ---- 4: Cycle mode: up-conversion keeps complete cycles; B box selects whole cycles by their centre ----
  await click(1500, 50, ['Alt']);
  await page.keyboard.press('4'); await wait(200);
  ok((await mode()) === 'cycle' && J(await sel()) === J([2000, 3000, 4000, 5000, 6000, 7000, 8000]), `4: Cycle mode keeps the three complete cycles (${await sel()})`);
  await page.keyboard.press('b'); await wait(150);
  await page.mouse.move(X(700), Y(95)); await page.mouse.down(); await page.mouse.move(X(1300), Y(60), { steps: 6 }); await page.mouse.up(); await wait(250);
  ok(J(await sel()) === J([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]), `B over the first cycle's peak: that cycle added (${await sel()})`);
  await page.keyboard.press('1'); await wait(200);
  ok((await mode()) === 'point' && (await sel()).length === 9, `1: Point mode keeps every point (${(await sel()).length})`);

  // ---- 1: Point mode: Alt+click a peak = every peak of the passage; Ctrl+click = path; Shift+click toggles ----
  await click(1000, 80, ['Alt']);
  ok(J(await sel()) === J([1000, 3000, 5000, 7000, 9000]) && J(await active()) === J([1000]), `Alt+click a peak: every peak of the passage (${await sel()})`);
  await click(4000, 20, ['Control']);
  ok(J(await sel()) === J([1000, 2000, 3000, 4000]), `Ctrl+click: the points from the active one (${await sel()})`);
  await click(2000, 20, ['Shift']);
  ok(J(await sel()) === J([1000, 3000, 4000]), `Shift+click a selected point: toggled off (${await sel()})`);
  await click(2000, 20, ['Shift']);
  ok(J(await sel()) === J([1000, 2000, 3000, 4000]) && J(await active()) === J([2000]), `Shift+click again: back on and active (${await sel()})`);
  await page.keyboard.press('Escape'); await wait(150);

  // ---- 2: Segment mode from the toolbar ----
  await page.click('[data-testid="lanes-selmode"] [aria-label="Segment select"]'); await wait(200);
  ok((await mode()) === 'segment', `the toolbar's Segment button: Segment mode (${await mode()})`);
  await click(15500, 50);
  ok(J(await sel()) === J([15000, 16000]), `a click on the 15-16 s line takes its two points (${await sel()})`);
  await click(16500, 50, ['Shift']);
  ok(J(await sel()) === J([15000, 16000, 17000]), `Shift+click the next segment: added (${await sel()})`);
  await click(15500, 50, ['Shift']);
  ok(J(await sel()) === J([16000, 17000]), `Shift+click the first again: removed, the shared point stays with the other (${await sel()})`);
  await shot('rapid-1-segments.png');
  await ev(() => app.settings.set('lanes.selectMode', 'point'));

  // ---- stage 2: the pivot menu on ., S on two axes with X / Y / first-move / middle-drag locks, R, Esc restores exactly ----
  await ev(() => { window.__rapidHint = null; addEventListener('pawscript:xform', (e) => { window.__rapidHint = e.detail?.hint ?? null; }); });
  const hintNow = () => ev(() => window.__rapidHint);
  const pts = () => ev(() => JSON.stringify(app.doc.axes.stroke));
  const at = (t) => ev((t) => app.doc.axes.stroke.find((p) => p.at === t)?.pos ?? null, t);
  const sel3 = () => ev(() => app.select([1000, 2000, 3000], 'stroke'));
  await sel3();
  await page.mouse.move(X(2500), Y(50)); await wait(100);
  await page.keyboard.press('.'); await wait(300);
  const menuItems = await ev(() => [...document.querySelectorAll('[role=menu] [role^=menuitem]')].map((e) => e.textContent.trim()));
  ok(['Start', 'Middle', 'End', 'Playhead', 'Active element', 'Individual origins'].every((w) => menuItems.some((t) => t.startsWith(w))), `.: the pivot choices at the pointer (${menuItems.join(' | ')})`);
  const box = await ev(() => { const e = [...document.querySelectorAll('[role=menu] [role^=menuitem]')].find((x) => x.textContent.trim().startsWith('Start')); const r = e?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
  if (box) { await page.mouse.move(box.x, box.y); await wait(80); await page.mouse.down(); await page.mouse.up(); }
  await wait(250);
  ok((await ev(() => app.settings.get('lanes.pivot'))) === 'start', 'picked Start');
  ok(await ev(() => /Start/.test(document.querySelector('[data-testid="lanes-pivot"]')?.textContent || '')), 'the toolbar shows the pivot: Start');
  const s0 = await pts();
  await page.mouse.move(X(2500), Y(50)); await wait(100);
  await page.keyboard.press('s'); await page.keyboard.press('y'); await page.keyboard.type('.5'); await wait(150);
  ok(/^Scale level: ×0\.50 · pivot Start/.test((await hintNow()) || ''), `S Y .5: the status line says level, the factor and the pivot ("${await hintNow()}")`);
  await page.keyboard.press('Enter'); await wait(200);
  ok((await at(1000)) === 80 && (await at(2000)) === 50 && (await at(3000)) === 80, `S Y .5 about the start: levels halved toward its level (${await at(1000)}, ${await at(2000)}, ${await at(3000)})`);
  await page.keyboard.press('Control+z'); await wait(200);
  ok((await pts()) === s0, 'Ctrl+Z: as it was');
  await sel3();
  await page.keyboard.press('s'); await page.keyboard.press('x'); await page.keyboard.type('1.25'); await page.keyboard.press('Enter'); await wait(200);
  ok(J(await sel()) === J([1000, 2250, 3500]), `S X 1.25 about the start: the duration ×1.25, the start stays (${await sel()})`);
  await page.keyboard.press('Control+z'); await wait(200);
  // bare S: the first sideways travel locks time; Esc puts everything back exactly
  await sel3();
  await page.mouse.move(X(4500), Y(50)); await wait(50);
  await page.keyboard.press('s'); await wait(80);
  for (let k = 1; k <= 6; k++) { await page.mouse.move(X(4500) + k * 12, Y(50) + k); await wait(30); }
  ok(/^Scale time/.test((await hintNow()) || ''), `bare S, moved sideways first: time locked ("${await hintNow()}")`);
  await page.keyboard.press('Escape'); await wait(200);
  ok((await pts()) === s0 && (await hintNow()) == null, 'Esc: every point exactly as before, the status line gone');
  // G with a middle-button drag up: the lock is the position
  await page.mouse.move(X(4500), Y(50)); await wait(50);
  await page.keyboard.press('g'); await wait(80);
  await page.mouse.down({ button: 'middle' });
  for (let k = 1; k <= 6; k++) { await page.mouse.move(X(4500) + 1, Y(50) - k * 6); await wait(30); }
  await page.mouse.up({ button: 'middle' }); await wait(80);
  ok(/position only/.test((await hintNow()) || ''), `G, middle-drag up: locked to the position ("${await hintNow()}")`);
  const v0 = await ev(() => ({ ...app.view }));
  await page.keyboard.press('Escape'); await wait(200);
  ok((await pts()) === s0 && J(await ev(() => ({ ...app.view }))) === J(v0), 'Esc: nothing moved, and the middle drag did not pan the lane');
  // R about the start: the far end rises 10, the middle 5; R 30: 3000 held at 100 (said), Esc restores
  await sel3();
  await page.keyboard.press('r'); await page.keyboard.type('10'); await wait(100);
  ok(/^Rotate: far end \+10 · pivot Start/.test((await hintNow()) || ''), `R 10: the status line ("${await hintNow()}")`);
  await page.keyboard.press('Enter'); await wait(200);
  ok((await at(1000)) === 80 && (await at(2000)) === 25 && (await at(3000)) === 90, `R 10 about the start: time stays, levels tilt (${await at(1000)}, ${await at(2000)}, ${await at(3000)})`);
  await page.keyboard.press('Control+z'); await wait(200);
  await sel3();
  await page.keyboard.press('r'); await page.keyboard.type('30'); await wait(150);
  ok(/1 clamped at 0 \/ 100/.test((await hintNow()) || ''), `R 30: the clamp is said ("${await hintNow()}")`);
  await shot('rapid-2-rotate-clamp.png');
  await page.keyboard.press('Escape'); await wait(200);
  ok((await pts()) === s0, 'Esc after a clamped preview: the shape exactly as before');
  // R with the mouse: an angle about the pivot tilts the far end up (counter-clockwise)
  await page.mouse.move(X(3000), Y(80)); await wait(50);
  await page.keyboard.press('r'); await wait(50);
  for (let k = 1; k <= 5; k++) { await page.mouse.move(X(3000), Y(80) - k * 4); await wait(30); }
  await page.keyboard.press('Enter'); await wait(200);
  ok((await at(3000)) > 80 && (await at(1000)) === 80, `R with the mouse moved up at the far end: it rose (${await at(3000)}), the pivot stayed`);
  await page.keyboard.press('Control+z'); await wait(200);
  await ev(() => app.settings.set('lanes.pivot', 'middle'));

  // ---- stage 3: E extrudes (a chain of three), Esc drops one; F flips in Refine; the keymap presets ----
  await ev(() => app.setView({ start: 15000, span: 10000 })); await wait(400);
  L = await rect();
  const n0 = (await ev(() => app.doc.axes.stroke.length)), h0 = await ev(() => app.history.index);
  await click(20000, 20);
  ok(J(await active()) === J([20000]), 'click the last point: it is active');
  const pull = async (t0, p0, t1, p1, end = 'click') => {
    await page.mouse.move(X(t0), Y(p0)); await wait(60);
    await page.keyboard.press('e'); await wait(80);
    for (let k = 1; k <= 5; k++) { await page.mouse.move(X(t0) + ((X(t1) - X(t0)) * k) / 5, Y(p0) + ((Y(p1) - Y(p0)) * k) / 5); await wait(30); }
    if (end === 'click') { await page.mouse.down(); await page.mouse.up(); } else await page.keyboard.press(end);
    await wait(200);
  };
  await pull(20000, 20, 20500, 80);
  await pull(20500, 80, 21000, 20);
  await pull(21000, 20, 21500, 80, 'Enter');
  const tail = await ev(() => app.doc.axes.stroke.filter((p) => p.at > 20000).map((p) => [p.at, p.pos]));
  ok(tail.length === 3 && tail.every(([t], k) => Math.abs(t - (20500 + 500 * k)) <= 34) && tail.every(([, p], k) => Math.abs(p - (k % 2 ? 20 : 80)) <= 3), `E, E, E: a chain of three points pulled out one after the other (${J(tail)})`);
  ok(J(await sel()) === J([tail[2]?.[0]]) && J(await active()) === J([tail[2]?.[0]]), 'the last one is selected and active (E again would chain on)');
  ok((await ev(() => app.history.index)) === h0 + 3 && (await ev(() => app.history.undoLabel)) === 'Extrude point', `one undo step each (history ${h0} -> ${await ev(() => app.history.index)})`);
  await pull(21500, 80, 22000, 20, 'Escape');
  ok((await ev(() => app.doc.axes.stroke.length)) === n0 + 3, 'E then Esc: no new point');
  await shot('rapid-3-extrude.png');
  // F flips in Refine too: its key reaches the flip in every tab
  ok(await ev(() => app.commands.keyOk('track.flipAtPlayhead')), 'in Refine the F key reaches the flip');
  await ev(() => { app.setMode('refine'); app.select([], 'stroke'); }); await wait(400);
  // the keymap presets: switch in the Shortcuts editor; an override survives both ways
  await ev(() => app.commands.setKeys('lanes.toggleSnap', ['Alt+N']));
  await ev(() => app.commands.run('palette.keys')); await wait(500);
  const seg = await ev(() => { const b = [...document.querySelectorAll('[data-testid="keys-preset"] [role=radio]')].find((x) => /OFS/.test(x.textContent)); const r = b?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
  ok(!!seg, 'the Shortcuts editor shows the keymap control');
  if (seg) { await page.mouse.click(seg.x, seg.y); await wait(250); }
  ok((await ev(() => app.settings.get('keys.preset'))) === 'ofs', 'picked OFS there');
  await page.keyboard.press('Escape'); await wait(300);
  ok(await ev(() => app.commands.keysFor('lanes.point5').includes('5') && !app.commands.keysFor('lanes.mode.point').length && app.commands.keysFor('lanes.record').includes('R')), 'OFS: 5 places, the number row picks no mode, R records');
  ok(J(await ev(() => app.commands.keysFor('lanes.toggleSnap'))) === J(['Alt+N']), 'the override survived the switch');
  await ev(() => { app.player.seek(22500, { exact: true }); app.setView({ start: 15000, span: 10000 }); }); await wait(500);
  await blurAll(); await page.keyboard.press('5'); await wait(300);
  ok((await ev(() => app.doc.axes.stroke.some((p) => Math.abs(p.at - 22500) <= 34 && p.pos === 50))), 'OFS: 5 put a point at 50 at the playhead');
  await page.keyboard.press('Control+z'); await wait(200);
  await ev(() => app.settings.set('keys.preset', 'blender')); await wait(100);
  await blurAll(); await page.keyboard.press('3'); await wait(200);
  ok((await mode()) === 'stroke' && J(await ev(() => app.commands.keysFor('lanes.toggleSnap'))) === J(['Alt+N']), 'back to Blender: 3 is Stroke select again, the override still there');
  await ev(() => { app.commands.setKeys('lanes.toggleSnap', null); app.settings.set('lanes.selectMode', 'point'); });
} catch (e) {
  fails++;
  console.log('FAIL [check]', e?.stack || e);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failure(s)` : 'all ok');
process.exit(fails ? 1 : 0);
