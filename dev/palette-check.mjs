// dev/palette-check.mjs -- the command palette's context, reasons, settings and panels (paw-m3b6) in YOUR test instance
// (node dev/test-app.mjs start ...; the CDP_* env it prints), real key presses over CDP, on what is painted:
//  1. Refine, Ctrl+K with nothing typed: a "Here" section first, holding this tab's points keys, then the menus;
//  2. Scenes, Ctrl+K: its own Here (the cut keys), a different first row;
//  3. typed "nudge selected" with nothing selected: the row is greyed with its reason inline ("Select points first");
//  4. "snap to frames": a "Setting: Snap to frames (On)" row; Enter toggles it, the palette closes;
//  5. "setting theme": Enter opens the Settings panel searched to Theme, its row on screen;
//  6. "panel problems": Enter shows the Problems panel (the Review tab).
// Screenshots: <out dir>/palette-refine.png, palette-scenes.png, palette-why.png, palette-settings.png. Every page exception and
// console error fails it.
//   node dev/palette-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/palette-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `palette-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
/** The palette as painted: [{head} | {id, label, hint, off}] in order, null when closed. */
const pal = () => ev(() => {
  const l = document.querySelector('dialog[open] #pp-list');
  if (!l) return null;
  return [...l.children].map((e) => (e.classList.contains('sec') ? { head: e.textContent.trim() }
    : { id: e.dataset.command || '', label: e.querySelector('.k-item-label')?.firstChild?.textContent?.trim() ?? '', text: e.querySelector('.k-item-label')?.textContent.trim(), hint: e.querySelector('.hint')?.textContent.trim() || '', off: e.getAttribute('aria-disabled') === 'true' }));
});
const open = async (q = '') => {
  await page.mouse.move(800, 300);
  await page.keyboard.press('Control+K');
  await page.waitForSelector('dialog[open] #pp-list', { timeout: 5000 });
  if (q) { await page.keyboard.type(q); await wait(250); }
  return pal();
};
const close = async () => { await page.keyboard.press('Escape'); await wait(300); };
const hereRows = (rows) => { const out = []; let on = false; for (const r of rows) { if (r.head) { on = r.head === 'Here'; continue; } if (on) out.push(r); } return out; };

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page.waitForFunction(() => window.app?.project && app.commands.get('palette.open'), null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev(() => { app.devicePreview?.toggle(false); app.setMode('refine'); app.player.pause(); app.select([]); app.settings.set('edit.snapFrames', true); });
  await wait(800);

  // ---- 1. Refine: Here first ----
  let rows = await open();
  await page.screenshot({ path: join(out, 'palette-refine.png') });
  ok(rows?.[0]?.head === 'Here', `Refine: the first section is Here (${rows?.find((r) => r.head)?.head})`);
  const hr = hereRows(rows || []);
  // paw-qbvj: the selection keys (B box, C circle) are the timeline's commands, listed with the point keys
  ok(hr.length >= 5 && hr.every((r) => r.id.startsWith('lanes.') || r.id.startsWith('tool.') || r.id.startsWith('timeline.select.')), `Refine Here: the point keys (${hr.map((r) => r.id).join(', ')})`);
  ok(['lanes.selectToggle', 'timeline.select.box', 'timeline.select.circle'].every((id) => hr.some((r) => r.id === id)), 'Refine Here: A (select all / none), B (box) and C (circle) are listed');
  ok(rows.some((r) => r.head === 'Edit'), 'the menus follow');
  await close();

  // ---- 2. Scenes: its own Here ----
  await ev(() => app.setMode('scenes')); await wait(600);
  rows = await open();
  await page.screenshot({ path: join(out, 'palette-scenes.png') });
  const hs = hereRows(rows || []);
  ok(rows?.[0]?.head === 'Here' && hs.length >= 3 && hs.every((r) => r.id.startsWith('timeline.')), `Scenes Here: the cut keys (${hs.map((r) => r.id).join(', ')})`);
  ok(hs[0]?.id !== hr[0]?.id, `a different first row per tab (${hr[0]?.id} / ${hs[0]?.id})`);
  await close();

  // ---- 3. a disabled command says why, inline ----
  await ev(() => app.setMode('refine')); await wait(600);
  rows = await open('nudge selected');
  await page.screenshot({ path: join(out, 'palette-why.png') });
  const n = rows.find((r) => r.id && /nudge/i.test(r.id));
  ok(n?.off && /select points first/i.test(n.hint), `a greyed nudge row with its reason: ${JSON.stringify(n)}`);
  await close();

  // ---- 4. a boolean setting toggles from the palette ----
  rows = await open('snap to frames');
  const si = rows.findIndex((r) => /^Setting: Snap to frames \(On\)/.test(r.text || ''));
  ok(si >= 0, `a "Setting: Snap to frames (On)" row (${rows.filter((r) => !r.head).slice(0, 4).map((r) => r.text).join(' | ')})`);
  const firstCmd = rows.findIndex((r) => r.id), firstSetting = rows.findIndex((r) => /^Setting:|^Panel:/.test(r.text || ''));
  ok(firstCmd < 0 || firstCmd < firstSetting, 'commands above settings');
  await page.locator('dialog[open] #pp-list li[role=option]').nth(rows.filter((r, i) => i < si && !r.head).length).click();
  await wait(400);
  ok(await ev(() => app.settings.get('edit.snapFrames')) === false && !(await pal()), 'Enter / click toggled it off and closed the palette');
  await ev(() => app.settings.set('edit.snapFrames', true));

  // ---- 5. another setting opens the Settings panel at its row ----
  rows = await open('setting theme');
  ok(/^Setting: Theme \(/.test(rows.find((r) => !r.head)?.text || ''), `the Theme setting first (${rows.find((r) => !r.head)?.text})`);
  await page.keyboard.press('Enter');
  await wait(800);
  const sp = await ev(() => { const q = document.querySelector('[data-testid="settings-search"] input, input[data-testid="settings-search"]'); const r = document.querySelector('[data-testid="setting"][data-key="ui.theme"]')?.getBoundingClientRect(); return { q: q?.value, row: !!r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight }; });
  await page.screenshot({ path: join(out, 'palette-settings.png') });
  ok(sp.q === 'Theme' && sp.row, `the Settings panel searched to Theme, its row on screen (${JSON.stringify(sp)})`);

  // ---- 6. a panel ----
  rows = await open('panel problems');
  ok(/^Panel: Problems/.test(rows.find((r) => !r.head)?.text || ''), `Panel: Problems first (${rows.find((r) => !r.head)?.text})`);
  await page.keyboard.press('Enter');
  await wait(800);
  ok(await ev(() => app.mode === 'review' && app.layout.shows('review.problems')), 'Enter showed the Problems panel (Review tab)');
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
