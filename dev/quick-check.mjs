// dev/quick-check.mjs -- the Quick menu and the one right-click contract (features/palette/quick.js) in YOUR test instance
// (node dev/test-app.mjs start ...; the CDP_* env it prints), real pointer and key presses over CDP, on what is painted:
//  1. right-click the transport's Next frame button: a menu with Add to Quick menu and its shortcut entry; Add puts
//     player.stepFwd in the Track tab's list (settings quick.lists);
//  2. Shift+Q with the pointer somewhere else: the Quick menu opens at the pointer, its row reads "Next frame" with its key;
//     Enter runs it (one frame on), the menu closes;
//  3. Shift+Q again, right-click that row: Remove from Quick menu, Move up / down greyed (one row); Remove empties the list and
//     the menu opens again where it was, saying how to add;
//  4. the same entries end a menu that was there already (a collapsed lane's own menu, right-click on its Expand button), answer a
//     menu-bar row and a palette row (the menu inside the palette's dialog);
//  5. the project page: Shift+Q opens its own (empty) list.
// Screenshots: <out dir>/quick-rightclick.png, quick-menu.png, quick-row.png, quick-lane.png. Every page exception and
// console error fails it.
//   node dev/quick-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/quick-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `quick-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
/** The last open menu panel: its label, box, section titles and own rows. */
const menu = () => ev(() => {
  const m = [...document.querySelectorAll('[role="menu"]')].filter((e) => e.matches(':popover-open')).at(-1);
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return { label: m.getAttribute('aria-label'), x: r.left, y: r.top, w: r.width, h: r.height, inDialog: !!m.closest('dialog'),
    secs: [...m.querySelectorAll(':scope > .k-menu-sec')].map((e) => e.textContent.trim()),
    rows: [...m.querySelectorAll(':scope > .k-item')].map((e) => ({ label: e.querySelector('.k-item-label')?.textContent.trim(), keys: e.querySelector('.k-item-keys')?.textContent.trim(), off: e.getAttribute('aria-disabled') === 'true', cmd: e.dataset.command || '' })) };
});
const pick = (label) => page.locator('[role="menu"]:popover-open > .k-item').filter({ hasText: label }).last().click();
const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const list = () => ev(() => app.settings.get('quick.lists'));
/** A corner of the menu at the pointer (it flips up / left near an edge). */
const atPointer = (m, p) => !!m && [m.x, m.x + m.w].some((x) => Math.abs(x - p.x) <= 4) && [m.y, m.y + m.h].some((y) => Math.abs(y - p.y) <= 4);
const labels = (m) => (m?.rows || []).map((r) => r.label + (r.off ? ' (off)' : '')).join(' | ');

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page.waitForFunction(() => window.app?.project && app.commands.get('quick.open'), null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev(() => { app.devicePreview?.toggle(false); app.settings.set('quick.lists', {}); app.setMode('track'); app.player.pause(); app.player.seekFrame(10); });
  await wait(800);

  // ---- 1. right-click a toolbar button, Add ----
  const btn = await center('button[data-command="player.stepFwd"]');
  ok(!!btn, 'the transport\'s Next frame button carries data-command="player.stepFwd"');
  await page.mouse.move(btn.x, btn.y); await page.mouse.click(btn.x, btn.y, { button: 'right' }); await wait(400);
  let m = await menu();
  console.log('info right-click: ' + labels(m));
  ok(m?.rows[0]?.label === 'Add to Quick menu' && /^(Assign shortcut…|Change shortcut \(currently .+\)…)$/.test(m?.rows.at(-1)?.label || ''), 'right-click on the button: Add to Quick menu, then its shortcut entry');
  ok(atPointer(m, btn), `it opens at the pointer (${m && Math.round(m.x)},${m && Math.round(m.y)} vs ${Math.round(btn.x)},${Math.round(btn.y)})`);
  await page.screenshot({ path: join(out, 'quick-rightclick.png') });
  await pick('Add to Quick menu'); await wait(300);
  ok(JSON.stringify((await list()).track) === '["player.stepFwd"]', `added to the Track tab's list: ${JSON.stringify(await list())}`);
  ok(!(await menu()), 'the menu closed');

  // ---- 2. Shift+Q at the pointer, Enter runs ----
  const at = { x: 700, y: 380 };
  await page.mouse.move(at.x, at.y); await wait(100);
  await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Shift+Q'); await wait(400);
  m = await menu();
  console.log('info Quick menu: ' + (m?.secs || []).join(' / ') + ' : ' + labels(m) + ` at ${m && Math.round(m.x)},${m && Math.round(m.y)}`);
  ok(m?.label === 'Quick menu' && m.secs[0] === 'Quick menu · Track', `Shift+Q opens the Quick menu of the Track tab (${m?.label}, ${m?.secs})`);
  ok(atPointer(m, at), `at the pointer (${m && Math.round(m.x)},${m && Math.round(m.y)} vs ${at.x},${at.y})`);
  ok(m?.rows.length === 1 && m.rows[0].label === 'Next frame' && !!m.rows[0].keys && !m.rows[0].off, `its row: "${m?.rows[0]?.label}" with key "${m?.rows[0]?.keys}"`);
  await page.screenshot({ path: join(out, 'quick-menu.png') });
  const f0 = await ev(() => app.player.frame);
  await page.keyboard.press('Enter'); await wait(500);
  const f1 = await ev(() => app.player.frame);
  ok(f1 === f0 + 1 && !(await menu()), `Enter ran it: frame ${f0} -> ${f1}, the menu closed`);

  // ---- 3. right-click the row: Remove (the menu stays) ----
  await page.mouse.move(at.x, at.y); await page.keyboard.press('Shift+Q'); await wait(400);
  const row = await center('[role="menu"][aria-label="Quick menu"] > .k-item[data-command="player.stepFwd"]');
  await page.mouse.move(row.x, row.y); await page.mouse.click(row.x, row.y, { button: 'right' }); await wait(400);
  m = await menu();
  console.log('info row right-click: ' + labels(m));
  ok(labels(m).startsWith('Remove from Quick menu | Move up (off) | Move down (off) | '), 'right-click on the row: Remove, Move up / down (greyed: one row), its shortcut');
  await page.screenshot({ path: join(out, 'quick-row.png') });
  await pick('Remove from Quick menu'); await wait(400);
  m = await menu();
  ok(JSON.stringify((await list()).track) === '[]', `removed: ${JSON.stringify(await list())}`);
  ok(m?.label === 'Quick menu' && atPointer(m, at) && m.rows.length === 1 && m.rows[0].off && /right-click any button or menu item/.test(m.rows[0].label), `the Quick menu opened again where it was, empty: "${m?.rows[0]?.label}"`);
  await page.keyboard.press('Escape'); await wait(200);

  // ---- 4. an element's own menu keeps its items, these end it; a menu-bar row; a palette row ----
  await ev(() => { app.setMode('refine'); const a = []; for (let t = 0; t < 8000; t += 250) a.push({ at: t, pos: a.length % 2 ? 90 : 10 }); app.transact('points', () => { app.doc.axes = { ...app.doc.axes, stroke: a }; }); });
  await wait(500);
  // a collapsed lane's strip has its own menu (lane commands) and holds the Expand button (lanes.toggleCollapse)
  await ev(() => app.commands.run('lanes.toggleCollapse', { axis: 'stroke' })); await wait(500);
  const solo = await center('button[data-command="lanes.toggleCollapse"][aria-expanded="false"]');
  if (solo) {
    await page.mouse.move(solo.x, solo.y); await page.mouse.click(solo.x, solo.y, { button: 'right' }); await wait(500);
    m = await menu();
    console.log('info collapsed lane right-click: ' + labels(m));
    const i = (m?.rows || []).findIndex((r) => r.label === 'Add to Quick menu');
    ok(i > 0 && m.rows.some((r) => r.label === 'Locked') && /shortcut/.test(m.rows.at(-1).label), `the collapsed lane's own menu (${i} rows of its own) ends with Add to Quick menu and the shortcut entry`);
    await page.screenshot({ path: join(out, 'quick-lane.png') });
    await page.keyboard.press('Escape'); await wait(200);
  } else ok(false, "a collapsed lane's Expand button to right-click");
  await ev(() => app.commands.run('lanes.toggleCollapse', { axis: 'stroke' })); await wait(300);
  await page.locator('[role="menubar"] [role="menuitem"]').filter({ hasText: /^\s*Play\s*$/ }).click(); await wait(400);
  const mrow = await center('[role="menu"]:popover-open > .k-item[data-command="player.stepFwd"]');
  await page.mouse.move(mrow.x, mrow.y); await page.mouse.click(mrow.x, mrow.y, { button: 'right' }); await wait(400);
  m = await menu();
  ok(m?.rows[0]?.label === 'Add to Quick menu', `a menu-bar row (Play > Next frame) answers right-click: ${labels(m)}`);
  await pick('Add to Quick menu'); await wait(300);
  ok(JSON.stringify((await list()).refine) === '["player.stepFwd"]', `added from the menu bar to the Refine tab's list: ${JSON.stringify(await list())}`);
  await page.keyboard.press('Escape'); await wait(200);
  await page.keyboard.press('Control+K'); await wait(500);
  await page.keyboard.type('next frame'); await wait(300);
  const prow = await center('dialog[open] li[data-command="player.stepFwd"]');
  const bolt = await ev(() => !!document.querySelector('dialog[open] li[data-command="player.stepFwd"] .quick svg'));
  ok(bolt, 'the palette marks the row in this tab\'s Quick menu');
  await page.mouse.move(prow.x, prow.y); await page.mouse.click(prow.x, prow.y, { button: 'right' }); await wait(400);
  m = await menu();
  ok(m?.inDialog && m.rows[0]?.label === 'Remove from Quick menu', `a palette row answers right-click, its menu inside the palette's dialog: ${labels(m)}`);
  await pick('Remove from Quick menu'); await wait(300);
  ok(JSON.stringify((await list()).refine) === '[]' && await ev(() => !!document.querySelector('dialog[open]')), 'removed from the palette, which stays open');
  await page.keyboard.press('Escape'); await wait(300);

  // ---- 5. the project page has its own list ----
  await ev(() => app.tabs.show('home')); await wait(600);
  await page.mouse.move(800, 500); await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Shift+Q'); await wait(400);
  m = await menu();
  ok(m?.label === 'Quick menu' && m.secs[0] === 'Quick menu · Projects' && m.rows[0]?.off, `the project page: Shift+Q opens its own list (${m?.secs}: ${labels(m)})`);
  await page.keyboard.press('Escape'); await wait(200);
  await ev(() => app.tabs.show(app.tabs.list[0]?.id)); await wait(300);
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
