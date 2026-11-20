// dev/head-look.mjs -- paw-ef73.22: after a smooth scrub rests between frames, step / jump / click / play: the painted pink
// line must sit on the current frame start (and on the grey frame cursor). node dev/head-look.mjs <project.pawproj> <out-dir>
import { mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
const [proj, out = '.'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { page } = await connectTestApp();
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
const wait = (ms) => page.waitForTimeout(ms);
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
if (!(await page.evaluate(() => /d162/.test(window.app.doc.media?.path || '')))) {
  await page.evaluate((p) => window.app.project.openProject(p, { force: true }), proj);
  await page.waitForFunction(() => window.app.doc.media && window.app.doc.scenes?.length, null, { timeout: 60000 });
}
await page.evaluate(() => { window.app.setMode?.('scenes'); window.app.player.pause(); window.app.setView({ start: 20000, span: 4000 }); });
await wait(800);
const read = () => page.evaluate(() => {
  const p = window.app.player, v = window.app.view;
  const lane = document.querySelector('[data-tl-lane="ruler"]'), r = lane.getBoundingClientRect(), w = lane.clientWidth;
  const head = lane.querySelector('.head'), m = head && /translateX\(([-\d.]+)px\)/.exec(head.style.transform);
  const fm = p.frameMs, f0 = Math.round(p.timeOfFrame(p.frame));
  const grey = lane.querySelector('[data-frame-cursor]') || document.querySelector('[data-frame-cursor]');
  const gx = grey ? +grey.dataset.x : null;
  return { t: Math.round(p.timeMs), rest: p.restMs, ph: p.playheadMs, headX: m ? +m[1] + 0.5 : null, wantX: ((f0 - v.start) / v.span) * w, greyX: gx, fm };
});
const ruler = await (await page.$('[data-tl-lane="ruler"]')).boundingBox();
const scrub = async (f0, f1) => { const y = ruler.y + 10; await page.mouse.move(ruler.x + ruler.width * f0, y); await page.mouse.down(); await page.mouse.move(ruler.x + ruler.width * f1, y, { steps: 8 }); await page.mouse.up(); await wait(500); };
const check = async (what, restWas) => {
  await wait(250); const s = await read();
  const good = s.headX != null && Math.abs(s.headX - s.wantX) < 0.6;
  ok(good, `${what}: t=${s.t} rest=${s.rest} headX=${s.headX?.toFixed(2)} want=${s.wantX.toFixed(2)}${s.greyX != null ? ' grey=' + (+s.greyX).toFixed(2) : ''}`);
  if (s.greyX != null) ok(Math.abs(s.greyX - s.wantX) < 0.6, `   the grey frame cursor is on the frame start too (${(+s.greyX).toFixed(2)})`);
  return s;
};
await scrub(0.30, 0.5133);
let s = await read(); console.log('after scrub', JSON.stringify(s));
ok(s.rest != null && Math.abs(s.headX - s.wantX) > 0.3, 'the scrub rests between frames (pink off the frame start)');
await page.screenshot({ path: `${out}/after-scrub.png`, clip: { x: 0, y: Math.max(0, ruler.y - 4), width: 1600, height: 200 } });
await page.mouse.move(ruler.x + 300, ruler.y + 400);   // pointer off the timeline
const key = async (k, what) => { await scrub(0.30, 0.5133); await page.keyboard.press(k); await check(`${what} (${k})`); };
await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
await key('ArrowRight', 'frame step right'); await key('ArrowLeft', 'frame step left');
await key('PageDown', 'PageDown'); await key('PageUp', 'PageUp');
await key('Shift+ArrowRight', 'Shift+Right (jump)');
await scrub(0.30, 0.5133);
await page.mouse.click(ruler.x + 200, ruler.y + 200 > 0 ? (await (await page.$('[data-tl-lane="scenes"]')).boundingBox()).y + 30 : 0);
await page.evaluate(() => window.app.setView({ start: window.app.player.timeMs - 2000, span: 4000 })); await wait(300);
await page.evaluate(() => window.app.setView({ start: window.app.player.timeMs - 2000, span: 4000 })); await wait(400);
await check('click a shot');
await page.evaluate(() => { window.app.player.seek(22000); window.app.setView({ start: 20000, span: 4000 }); }); await wait(500);
{   // the owner's repro: hover the filmstrip (hover scrub), then press Right with the pointer still there
  const fl = await (await page.$('[data-tl-lane="filmstrip"]')).boundingBox();
  await page.mouse.move(fl.x + fl.width * 0.4, fl.y + fl.height / 2); await wait(100);
  await page.mouse.move(fl.x + fl.width * 0.4 + 3, fl.y + fl.height / 2); await wait(600);
  await page.keyboard.press('ArrowRight'); await check('hover the filmstrip, then ArrowRight with the pointer still on it');
  await page.keyboard.press('ArrowRight'); await check('... and once more');
}
await scrub(0.30, 0.5133); await page.evaluate(() => window.app.player.play()); await wait(700); await page.evaluate(() => window.app.player.pause()); await check('play briefly and stop');
process.exit(bad ? 1 : 0);
