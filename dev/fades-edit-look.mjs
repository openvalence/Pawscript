// dev/fades-edit-look.mjs -- paw-ef73.13 in YOUR Tauri test instance (node dev/test-app.mjs start ...; the CDP_* env it
// prints): open a project, wait for the fades pass, then on the Shots strip: click a shot dissolved into (the playhead
// lands on its first clean frame), drag that dissolve's clean-frame handle (screenshot mid-drag), nudge it with Alt+→,
// draw a fade in from a hard cut, drag it back off (removed), undo everything. Prints what the document holds each step.
//   node dev/fades-edit-look.mjs <project.pawproj> <out-dir> <ms inside a dissolve> <ms of a hard cut>
import { mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [proj, out = '.', atD = '80424', atCut = '98632'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let b, page;
for (let k = 0; ; k++) {
  try { ({ browser: b, page } = await connectTestApp()); break; } catch (e) { if (k > 400) throw e; await new Promise((r) => setTimeout(r, 2000)); }
}
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
const wait = (ms) => page.waitForTimeout(ms);
await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
await page.evaluate((p) => window.app.project.openProject(p, { force: true }), proj);
await page.waitForFunction(() => window.app.doc.media && window.app.doc.scenes?.length, null, { timeout: 60000 });
await page.evaluate(() => window.app.setMode?.('scenes'));   // the Scenes tab, where the owner works
await page.waitForFunction(() => window.app.saveBlocks?.().transitions?.list?.length > 0, null, { timeout: 180000, polling: 1000 });
const list = await page.evaluate(() => window.app.saveBlocks().transitions.list);
const x = list.find((t) => +atD >= t.ts && +atD <= t.t1);
console.log('mode', await page.evaluate(() => window.app.mode), '| the dissolve', x.ts, x.tm, x.t1);
await page.evaluate(([a, s]) => window.app.setView({ start: a, span: s }), [x.ts - 1200, 3200]);
await wait(600);
const lane = await (await page.$('[data-tl-lane="scenes"]')).boundingBox();
const view = await page.evaluate(() => window.app.view);
const px = (t) => lane.x + ((t - view.start) / view.span) * lane.width;
const H = lane.height, modH = Math.max(8, Math.min(14, Math.round(H * 0.2))), y1 = Math.max(12, Math.round((H - modH) * 0.58)) + 1, ym = H - modH;
const yBand = lane.y + y1 + 4, yShot = lane.y + ym - 3;
const tl = { x: 0, y: Math.max(0, lane.y - 110), width: 1600, height: 240 };
const state = () => page.evaluate(() => ({ t: Math.round(window.app.player.timeMs), fades: (window.app.doc.repeats?.fades || []).map((f) => (f.none ? `none ${f.ts}-${f.t1}` : `${f.kind} ${f.ts}-${f.t1}`)) }));
await page.screenshot({ path: `${out}/edit-0-strip.png`, clip: tl });
// 1. a click on the shot dissolved into: the playhead lands on its first clean frame
await page.mouse.click(px(x.t1 + 600), yShot);
await wait(400);
console.log('click the shot after the dissolve ->', await state(), '(first clean frame', x.t1 + ')');
// 2. drag the clean-frame handle 8 frames later
await page.mouse.move(px(x.t1), yBand); await wait(200);
await page.mouse.down();
for (let k = 1; k <= 6; k++) { await page.mouse.move(px(x.t1) + (px(x.t1 + 333) - px(x.t1)) * k / 6, yBand); await wait(60); }
await wait(500);
await page.screenshot({ path: `${out}/edit-1-dragging.png`, clip: tl });
await page.mouse.up(); await wait(300);
console.log('dragged the clean frame ->', await state());
// 3. select it (click its handle) and nudge a frame later
const s1 = await state(), t1 = +s1.fades[0].split('-').pop();
await page.mouse.click(px(t1), yBand); await wait(200);
await page.keyboard.press('Alt+ArrowRight'); await wait(300);
console.log('Alt+→ ->', await state());
await page.screenshot({ path: `${out}/edit-2-nudged.png`, clip: tl });
// 4. a fade in drawn from a hard cut, then dragged back off
await page.evaluate(([a, s]) => window.app.setView({ start: a, span: s }), [+atCut - 1500, 3000]);
await wait(500);
const v2 = await page.evaluate(() => window.app.view), qx = (t) => lane.x + ((t - v2.start) / v2.span) * lane.width;
await page.mouse.move(qx(+atCut) + 1, yBand); await page.mouse.down();
for (let k = 1; k <= 6; k++) { await page.mouse.move(qx(+atCut) + 1 + (qx(+atCut + 500) - qx(+atCut)) * k / 6, yBand); await wait(60); }
await page.mouse.up(); await wait(300);
const s2 = await state();
console.log('drawn from the cut ->', s2);
await page.screenshot({ path: `${out}/edit-3-added.png`, clip: tl });
const added = s2.fades.find((f) => f.startsWith('fade-in')), c = +added.split('-').pop();
await page.mouse.move(qx(c), yBand); await page.mouse.down();
for (let k = 1; k <= 6; k++) { await page.mouse.move(qx(c) + (qx(+atCut) - qx(c)) * k / 6, yBand); await wait(60); }
await page.mouse.up(); await wait(300);
console.log('dragged back onto the edge ->', await state());
for (let k = 0; k < 4; k++) await page.evaluate(() => window.app.undo());
console.log('undone ->', await state());
await b.close().catch(() => {});
