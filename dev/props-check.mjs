// dev/props-check.mjs -- a setting is a property (app/Prop.svelte, kit contextmenu.js property(); paw-m3b6) in YOUR test instance
// (node dev/test-app.mjs start ...; the CDP_* env it prints), real pointer and key presses over CDP, on what is painted:
//  1. the Machine panel's Tuning: right-click the Height slider: Reset to default (<the character's height>), Copy value, Paste
//     value, Show in Settings, Add to Quick menu; Reset takes machine.height out of the settings and the slider shows the default;
//  2. click the slider's number, type 190, Enter: machine.height is 190 and the readout says so; Escape while typing changes nothing;
//  3. Copy value, type 170, Paste value: 190 again (the system clipboard, or the last Copy value when it says no);
//  4. a tuning slider over machine.params (Tightness): right click resets to the experience preset (the override goes);
//  5. the lane toolbar's Recording latency: Show in Settings opens the Settings panel at that row; the row's own control answers
//     right click the same way, without Show in Settings.
// Screenshots: <out dir>/props-machine.png (the menu on the Height slider), props-typing.png, props-settings.png. Every page
// exception and console error fails it.
//   node dev/props-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/props-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `props-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource|WebGL|GPU stall/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const menuRows = () => ev(() => {
  const m = [...document.querySelectorAll('[role="menu"]')].filter((e) => e.matches(':popover-open')).at(-1);
  return m ? [...m.querySelectorAll(':scope > .k-item')].map((e) => e.querySelector('.k-item-label')?.textContent.trim() + (e.getAttribute('aria-disabled') === 'true' ? ' (off)' : '')) : null;
});
const pick = (label) => page.locator('[role="menu"]:popover-open > .k-item').filter({ hasText: label }).last().click();
const S = (k) => ev((k) => app.settings.values[k], k);
const box = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
async function rightClick(sel) {
  const c = await box(sel);
  if (!c) return null;
  await page.mouse.move(c.x, c.y); await page.mouse.click(c.x, c.y, { button: 'right' }); await wait(400);
  return menuRows();
}
const readout = (k) => ev((k) => document.querySelector(`[data-prop="${k}"] .kit-slider-value`)?.textContent.trim(), k);

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page.waitForFunction(() => window.app?.project && app.commands.get('settings.open'), null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev(() => { app.devicePreview?.toggle(false); app.settings.set('quick.lists', {}); app.settings.set('machine.mode', 'machine'); app.settings.set('machine.height', 182); app.setMode('refine'); app.player.pause(); app.showPanel('machine.view'); });
  await page.waitForSelector('.mc', { timeout: 30000 });
  await wait(1500);
  // the Tuning fold
  await page.locator('.mc .kit-section-title').filter({ hasText: /^Tuning$/ }).first().click();
  await page.waitForSelector('[data-prop="machine.height"] .kit-slider-value', { timeout: 10000 });
  await page.locator('[data-prop="machine.height"]').scrollIntoViewIfNeeded();
  await wait(300);

  // ---- 1. right-click the Height slider: the property's entries; Reset ----
  const own = await ev(() => { const el = document.querySelector('[data-prop="machine.height"]'); return el && el.querySelector('.kit-slider-value').textContent.trim(); });
  ok(/^182 cm/.test(own || ''), `the Height slider shows the stored 182 cm: "${own}"`);
  let rows = await rightClick('[data-prop="machine.height"] .k-slider-track');
  console.log('info right-click on Height: ' + (rows || []).join(' | '));
  ok(/^Reset to default \(\d+ cm \(\d+ ft \d+ in\)\)$/.test(rows?.[0] || '') && rows?.[1] === 'Copy value' && rows?.[2] === 'Paste value', 'Reset to default (<the character’s height>), Copy value, Paste value');
  ok(rows?.includes('Show in Settings') && rows?.includes('Add to Quick menu'), 'then Show in Settings and Add to Quick menu');
  await page.screenshot({ path: join(out, 'props-machine.png') });
  await pick('Reset to default'); await wait(400);
  const after = await readout('machine.height');
  ok((await S('machine.height')) === undefined, `Reset took machine.height out of the settings (${await S('machine.height')})`);
  ok(!!after && !/^182 /.test(after) && rows[0].includes(after.split(' (')[0]), `the slider shows the default: "${after}"`);

  // ---- 2. type into the slider ----
  await page.locator('[data-prop="machine.height"] .kit-slider-value').click(); await wait(200);
  const typing = await ev(() => document.activeElement?.classList.contains('kit-slider-input'));
  ok(typing, 'a click on the number opens a text field, focused');
  await page.keyboard.type('190');
  await page.screenshot({ path: join(out, 'props-typing.png') });
  await page.keyboard.press('Enter'); await wait(400);
  ok((await S('machine.height')) === 190 && /^190 cm/.test((await readout('machine.height')) || ''), `typed 190 + Enter: machine.height ${await S('machine.height')}, readout "${await readout('machine.height')}"`);
  await page.locator('[data-prop="machine.height"] .kit-slider-value').click(); await wait(200);
  await page.keyboard.type('150'); await page.keyboard.press('Escape'); await wait(300);
  ok((await S('machine.height')) === 190, `Escape while typing changes nothing (${await S('machine.height')})`);

  // ---- 3. copy, change, paste ----
  rows = await rightClick('[data-prop="machine.height"] .k-slider-track');
  await pick('Copy value'); await wait(200);
  await page.locator('[data-prop="machine.height"] .kit-slider-value').click(); await wait(150);
  await page.keyboard.type('170'); await page.keyboard.press('Enter'); await wait(300);
  ok((await S('machine.height')) === 170, `typed 170 (${await S('machine.height')})`);
  rows = await rightClick('[data-prop="machine.height"] .k-slider-track');
  await pick('Paste value');
  // (the system clipboard first; one that never answers, as on the hidden desktop, falls back to the last copy after 1.5 s)
  for (let k = 0; k < 20 && (await S('machine.height')) !== 190; k++) await wait(200);
  ok((await S('machine.height')) === 190, `Paste value: 190 again (${await S('machine.height')})`);

  // ---- 4. a tuning slider over machine.params: reset to the preset ----
  const tone = page.locator('.mc .tune .k-slider').filter({ has: page.locator('[aria-label="Tightness"]') }).first();
  if (await tone.count()) {
    await ev(() => app.settings.set('machine.params', { tone: 20 }));
    await wait(300);
    const tb = await tone.boundingBox();
    await page.mouse.move(tb.x + 10, tb.y + tb.height / 2); await page.mouse.click(tb.x + 10, tb.y + tb.height / 2, { button: 'right' }); await wait(400);
    rows = await menuRows();
    console.log('info right-click on Tightness: ' + (rows || []).join(' | '));
    ok(/^Reset to default \(60 mmHg\)/.test(rows?.[0] || ''), 'a preset slider (Tightness) offers Reset to default (60 mmHg, the Some experience preset)');
    await pick('Reset to default'); await wait(400);
    ok(!('tone' in ((await S('machine.params')) || {})), `Reset dropped the override: ${JSON.stringify(await S('machine.params'))}`);
  } else console.log('info no Tightness slider in Tuning (skipped)');

  // ---- 5. the lane toolbar's latency: Show in Settings; the row's control in Settings ----
  await page.keyboard.press('Escape');
  const lat = await box('[data-prop="lanes.latencyMs"]');
  if (lat) {
    rows = await rightClick('[data-prop="lanes.latencyMs"] input');
    console.log('info right-click on Recording latency: ' + (rows || []).join(' | '));
    ok(/^Reset to default \(0 ms\)/.test(rows?.[0] || '') && rows?.includes('Show in Settings'), 'the latency field: Reset to default (0 ms) … Show in Settings');
    await pick('Show in Settings'); await wait(800);
    const row = await ev(() => { const r = document.querySelector('[data-testid="settings-panel"] [data-key="lanes.latencyMs"]'); return r ? r.getBoundingClientRect().height > 0 : false; });
    ok(row, 'Show in Settings: the Settings panel shows the Recording latency row');
    rows = await rightClick('[data-testid="settings-panel"] [data-key="lanes.latencyMs"] [data-prop] input');
    console.log('info right-click in Settings: ' + (rows || []).join(' | '));
    ok(rows?.[0]?.startsWith('Reset to default') && !rows.includes('Show in Settings'), 'the row’s control answers the same, without Show in Settings');
    await page.screenshot({ path: join(out, 'props-settings.png') });
    await page.keyboard.press('Escape');
  } else ok(false, 'the lane toolbar shows the Recording latency field');
} catch (e) {
  fails++;
  console.log('FAIL ' + (e?.stack || e));
} finally {
  await ev(() => { app.settings.reset(['machine.height', 'machine.params', 'quick.lists']); }).catch(() => {});
  await browser.close().catch(() => {});
}
console.log(fails ? `FAIL props-check: ${fails} failed` : 'PASS props-check');
process.exit(fails ? 1 : 0);
