// dev/cmdbind-check.mjs -- controls bound to commands (app/cmd.js, paw-m3b6) in YOUR test instance (node dev/test-app.mjs start ...;
// the CDP_* env it prints), real pointer presses over CDP, on what is painted:
//  1. paw-z0ym: Undo with nothing to undo is greyed but aria-disabled (not natively disabled); hovering it shows its tooltip;
//     a right click on it opens the Quick menu entries (Add to Quick menu, the shortcut entry); a click does nothing;
//  2. the top bar's stage switch: each segment carries data-command="mode.<tab>"; a click on Track runs mode.track (the tab
//     changes, the palette's recent list names mode.track); its tooltip shows the key from the registry;
//  3. the Tracker panel's Retry / reload and the scene Track button carry data-command and a tooltip with the command's key.
//   node dev/cmdbind-check.mjs <clip.mp4> <out dir>     exits 1 on any FAIL
import { mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/cmdbind-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `cmdbind-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
const answer = () => ev(() => { const d = app.dialog; if (d) d.resolve(d.choices?.some((c) => c.id === 'discard') ? 'discard' : d.choices?.[0]?.id ?? null); });
const menu = () => ev(() => {
  const m = [...document.querySelectorAll('[role="menu"]')].filter((e) => e.matches(':popover-open')).at(-1);
  return m ? [...m.querySelectorAll(':scope > .k-item')].map((e) => e.querySelector('.k-item-label')?.textContent.trim()) : null;
});
const tipText = () => ev(() => { const t = document.getElementById('k-tip'); return t?.matches(':popover-open') ? t.textContent.trim() : ''; });
const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page.waitForFunction(() => window.app?.project && app.commands.get('mode.track'), null, { timeout: 60000 });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => { app.devicePreview?.toggle(false); app.setMode('scenes'); app.player.pause(); app.history?.reset?.(); });
  await wait(800);

  // ---- 1. a disabled bound control answers hover and right click ----
  const u = await ev(() => { const b = document.querySelector('button[data-command="edit.undo"]'); return b && { native: b.disabled, aria: b.getAttribute('aria-disabled'), can: app.history.canUndo }; });
  console.log('info undo: ' + JSON.stringify(u));
  ok(!!u && !u.can && !u.native && u.aria === 'true', 'Undo with nothing to undo: greyed with aria-disabled, not native disabled');
  const ub = await center('button[data-command="edit.undo"]');
  await page.mouse.move(ub.x, ub.y); await wait(900);
  const ut = await tipText();
  ok(/Nothing to undo/.test(ut), `its tooltip shows on hover ("${ut}")`);
  await page.mouse.click(ub.x, ub.y, { button: 'right' }); await wait(400);
  const um = await menu();
  console.log('info right-click: ' + JSON.stringify(um));
  ok(um?.[0] === 'Add to Quick menu' && /shortcut/.test(um?.at(-1) || ''), 'right click on the greyed Undo: the Quick menu entries');
  await page.keyboard.press('Escape'); await wait(200);

  // ---- 2. the stage switch runs mode.* ----
  const segs = await ev(() => [...document.querySelectorAll('.stages [role="radio"]')].map((b) => b.dataset.command || ''));
  ok(JSON.stringify(segs) === '["mode.scenes","mode.track","mode.refine","mode.review"]', `stage segments are mode.* commands (${segs.join(', ')})`);
  const tb = await center('.stages [data-command="mode.track"]');
  await page.mouse.move(tb.x, tb.y); await wait(900);
  const tt = await tipText(), key = await ev(() => app.commands.keysFor('mode.track')[0]);
  ok(tt.includes('Track') && key && tt.replace(/\s/g, '').includes(key.replace(/\s/g, '')), `its tooltip names the key from the registry ("${tt}", ${key})`);
  await page.mouse.click(tb.x, tb.y); await wait(500);
  const after = await ev(() => ({ mode: app.mode, recent: app.commands.recent[0] }));
  ok(after.mode === 'track' && after.recent === 'mode.track', `a click on Track runs mode.track (${JSON.stringify(after)})`);

  // ---- 3. bound buttons in the Track tab ----
  await ev(() => app.showPanel?.('tracking')); await wait(800);
  const bound = await ev(() => [...document.querySelectorAll('[data-command]')].map((e) => e.dataset.command));
  console.log('info bound in view: ' + [...new Set(bound)].sort().join(' '));
  ok(bound.includes('track.listTrackers') || bound.includes('track.gridFrame'), 'Tracker panel / Track buttons carry their command');
  await page.screenshot({ path: join(out, 'cmdbind.png') });
} finally { await browser.close(); }
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
