// dev/menu-look.mjs -- paw-ef73.11 in YOUR Tauri test instance (node dev/test-app.mjs start ...; the CDP_* env it prints):
// open a project, right-click the Scenes row on a scene block, a shot, a cut, a selection and a cutaway (Scenes tab),
// then a shot in the Track tab; for each: the menu's rows, whether it fits the window, a screenshot (one with a tip).
//   node dev/menu-look.mjs <project.pawproj> <out-dir>
import { mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [proj, out = '.'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let b, page;
for (let k = 0; ; k++) {
  try { ({ browser: b, page } = await connectTestApp()); break; } catch (e) { if (k > 90) throw e; await new Promise((r) => setTimeout(r, 2000)); }
}
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
if (!(await page.evaluate(() => window.app.doc.scenes?.length > 3))) {
  page.evaluate((p) => window.app.project.openProject(p, { force: true }), proj).catch(() => {});
  // a recover prompt (an earlier run's autosave): discard it, this is a look, not an edit
  for (let k = 0; k < 20 && !(await page.evaluate(() => window.app.doc.scenes?.length > 3)); k++) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Discard')?.click());
    await page.waitForTimeout(500);
  }
}
await page.evaluate(() => window.app.setMode?.('scenes'));
await page.waitForFunction(() => window.app.doc.media && window.app.doc.scenes?.length > 3, null, { timeout: 60000 });
const scenes = await page.evaluate(() => window.app.doc.scenes.map((s) => ({ a: s.start_ms, z: s.end_ms, join: s.join })));
console.log('shots:', scenes.length, 'scenes:', scenes.filter((s) => s.join !== true).length);
const dur = await page.evaluate(() => window.app.durationMs);
await page.evaluate((d) => window.app.setView({ start: 0, span: d }), dur);
await page.waitForTimeout(800);
const laneBox = async () => (await page.$('[data-tl-lane="scenes"]')).boundingBox();
let lane = await laneBox();
const view = async () => page.evaluate(() => window.app.view);
const px = async (t) => { const v = await view(); return lane.x + ((t - v.start) / v.span) * lane.width; };
const H = () => lane.height, modH = () => Math.max(8, Math.min(14, Math.round(H() * 0.2))), sh = () => Math.max(12, Math.round((H() - modH()) * 0.58));
const yScenes = () => lane.y + sh() * 0.5, yShots = () => lane.y + (sh() + H() - modH()) / 2;
const win = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
async function look(name, x, y, { tip } = {}) {
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await page.mouse.click(x, y, { button: 'right' });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role=menu]')].find((e) => e.matches(':popover-open') || e.checkVisibility?.());
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { rows: [...el.querySelectorAll(':scope > .k-item')].map((e) => e.querySelector('.k-item-label').textContent + (e.querySelector('.k-item-keys').textContent ? ` [${e.querySelector('.k-item-keys').textContent}]` : '') + (e.getAttribute('aria-checked') === 'true' ? ' ✓' : '') + (e.getAttribute('aria-haspopup') ? ' ▸' : '')),
      head: el.querySelector('.k-menu-sec')?.textContent, h: Math.round(r.height), scroll: el.scrollHeight > el.clientHeight + 1, box: [r.left, r.top, r.width, r.height].map(Math.round) };
  });
  if (!m) { console.log(name, ': no menu'); return null; }
  console.log(`${name} (${m.rows.length} rows, ${m.h}px${m.scroll ? ', SCROLLS' : ''}) ${m.head}: ${m.rows.join(' | ')}`);
  if (tip) {
    const row = (await page.$$('[role=menu] > .k-item'))[tip];
    if (row) { const rb = await row.boundingBox(); for (let k = 0; k < 6; k++) { await page.mouse.move(rb.x + 10 + k * 5, rb.y + rb.height / 2); await page.waitForTimeout(60); } await page.waitForTimeout(900); }
    console.log('  tip:', await page.evaluate(() => { const t = document.querySelector('.k-tip'), h = document.querySelector('[role=menu] > .k-item:hover'); return t?.matches(':popover-open') ? t.textContent : `none (tip el ${!!t}, hovered row ${h?.textContent?.trim() ?? '-'})`; }));
  }
  const [l, t, w, h] = m.box;
  const clip = { x: Math.max(0, Math.min(l, x) - 40), y: Math.max(0, Math.min(t, lane.y) - 40) };
  clip.width = Math.min(win.w - clip.x, Math.max(l + w + 380, x + 40) - clip.x); clip.height = Math.min(win.h - clip.y, Math.max(t + h, lane.y + lane.height) + 40 - clip.y);
  await page.screenshot({ path: `${out}/menu-${name}.png`, clip });
  return m;
}
// a scene with several shots, zoomed so its shots are wide
const runs = []; scenes.forEach((s, i) => { if (s.join !== true) runs.push([i, i]); else runs[runs.length - 1][1] = i; });
const multi = runs.find(([a, z]) => z > a) ?? runs[1];
const [a, z] = multi, ms = (k) => (scenes[k].a + scenes[k].z) / 2;
await page.evaluate(([s, e]) => window.app.setView({ start: s, span: e - s }), [scenes[Math.max(0, a - 1)].a, scenes[Math.min(scenes.length - 1, z + 1)].z]);
await page.waitForTimeout(500); lane = await laneBox();
await look('scene', await px(ms(a)), yScenes(), { tip: 1 });
await look('shot', await px(ms(a)), yShots(), { tip: 6 });
await look('cut', await px(scenes[a + 1 <= z ? a + 1 : z].a), yShots());
// a selection over two scenes: shift-click
await page.keyboard.press('Escape');
await page.mouse.click(await px(ms(a)), yShots()); await page.keyboard.down('Shift'); await page.mouse.click(await px(ms(z + 1)), yShots()); await page.keyboard.up('Shift');
await page.waitForTimeout(300);
console.log('selection range:', JSON.stringify(await page.evaluate(() => window.app.doc.range)));
await look('selection', await px(ms(a)), yShots());
// a cutaway: the middle shot of the scene onto the layer (C), then right-click its card
await page.keyboard.press('Escape');
const c = a + 1 <= z ? a + 1 : a;
await page.mouse.click(await px(ms(c)), yShots()); await page.waitForTimeout(200);
await page.evaluate((k) => window.app.commands.run('timeline.shot.cutaway', { shots: [k] }), c);
await page.waitForTimeout(400); lane = await laneBox();
await look('cutaway', await px(ms(c)), yShots(), { tip: 0 });
await page.evaluate(() => window.app.undo?.());
// Track: the same shot, effects come back as one submenu
await page.keyboard.press('Escape');
await page.evaluate(() => window.app.setMode('track')); await page.waitForTimeout(800); lane = await laneBox();
await look('track-shot', await px(ms(a)), yShots());
// the View menu has the guide lines toggle
await page.keyboard.press('Escape');
console.log('View menu has guide lines:', await page.evaluate(() => window.app.commands.list().some((c) => c.id === 'timeline.view.sceneGuides' && c.menu === 'View')));
await b.close().catch(() => {});
