// dev/fades-look.mjs -- paw-ef73.3 in YOUR Tauri test instance (node dev/test-app.mjs start ...; the CDP_* env it prints):
// open a project, wait for the fades / dissolves pass, screenshot the timeline at the video's scale and zoomed on one
// transition with its hover tip, then put that transition's cut at its darkest frame with the command and check it moved.
//   node dev/fades-look.mjs <project.pawproj> <out-dir> <transition ms (one inside it)>
import { mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [proj, out = '.', at = '360000'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let b, page;
for (let k = 0; ; k++) {
  try { ({ browser: b, page } = await connectTestApp()); break; } catch (e) { if (k > 90) throw e; await new Promise((r) => setTimeout(r, 2000)); }
}
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
await page.evaluate((p) => window.app.project.openProject(p), proj);
await page.evaluate(() => window.app.setMode?.('track'));   // the Scenes row
await page.waitForFunction(() => window.app.doc.media && window.app.doc.scenes?.length, null, { timeout: 60000 });
// the pass: the project block appears once the list is in (saveBlocks: the transitions block)
await page.waitForFunction(() => window.app.saveBlocks?.().transitions?.list?.length > 0, null, { timeout: 180000, polling: 1000 });
const list = await page.evaluate(() => window.app.saveBlocks().transitions.list);
console.log('transitions:', list.length, list.map((x) => `${x.kind} ${Math.round(x.ts)}-${Math.round(x.t1 ?? -1)}`).join(', '));
const dur = await page.evaluate(() => window.app.durationMs);
await page.evaluate((d) => window.app.setView({ start: 0, span: d }), dur);
await page.waitForTimeout(800);
const ruler = await page.$('[data-tl-lane="timeline.ruler"]') || await page.$('[data-tl-lane="ruler"]');
const box = await ruler.boundingBox();
const tl = { x: 0, y: Math.max(0, box.y - 60), width: 1600, height: Math.min(1000 - Math.max(0, box.y - 60), 340) };
await page.screenshot({ path: `${out}/fades-whole.png`, clip: tl });
const x = list.find((t) => +at >= t.ts && +at <= (t.t1 ?? dur)) || list[0];
const pad = Math.max(400, ((x.t1 ?? dur) - x.ts) * 0.4);
await page.evaluate(([a, s]) => window.app.setView({ start: a, span: s }), [x.ts - pad, (x.t1 ?? dur) - x.ts + 2 * pad]);
await page.waitForTimeout(600);
const view = await page.evaluate(() => window.app.view);
const px = (t) => box.x + ((t - view.start) / view.span) * box.width;
await page.mouse.move(px(x.tm), box.y + box.height - 6);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/fades-zoom-hover.png`, clip: tl });
const tip = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => /frames \(\d+ ms\)/.test(e.textContent || '') && e.children.length === 0).map((e) => e.textContent)[0] || null);
console.log('hover tip:', tip);
// the command: the transition's cut to its darkest frame
const before = await page.evaluate(() => window.app.doc.scenes.map((s) => s.start_ms));
await page.evaluate((t) => window.app.player.seek(t), x.ts + 300);
await page.waitForTimeout(300);
const ran = await page.evaluate(() => String(window.app.commands.run('timeline.cut.fadeMiddle')));
await page.waitForTimeout(500);
const after = await page.evaluate(() => window.app.doc.scenes.map((s) => s.start_ms));
console.log('command:', ran, 'moved:', before.filter((t) => !after.includes(t)), '->', after.filter((t) => !before.includes(t)), 'darkest frame', Math.round(x.tm));
await page.screenshot({ path: `${out}/fades-after-snap.png`, clip: tl });
await page.evaluate(() => window.app.undo?.());
// direct manipulation: drag that cut on the Shots strip to 4 px past the darkest frame; it snaps onto it
const lane = await (await page.$('[data-tl-lane="scenes"]')).boundingBox();
const c0 = before.filter((t) => t >= x.ts - 50 && t <= (x.t1 ?? dur) + 100)[0];
if (c0 != null) {
  const y = lane.y + lane.height * 0.62;
  await page.mouse.move(px(c0), y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(px(c0) + ((px(x.tm) + 4 - px(c0)) * k) / 8, y); await page.waitForTimeout(40); }
  await page.screenshot({ path: `${out}/fades-drag-snap.png`, clip: tl });
  await page.mouse.up(); await page.waitForTimeout(400);
  const dragged = await page.evaluate(() => window.app.doc.scenes.map((s) => s.start_ms));
  console.log('drag:', c0, '->', dragged.filter((t) => !before.includes(t)), 'darkest frame', Math.round(x.tm));
  await page.evaluate(() => window.app.undo?.());
}
await b.close().catch(() => {});
