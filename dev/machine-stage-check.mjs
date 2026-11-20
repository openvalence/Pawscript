// dev/machine-stage-check.mjs -- the Machine panel's layout in headless Edge on a running vite server:
//   node dev/machine-stage-check.mjs http://localhost:<port>/dev/shell.html [out-dir for screenshots]
// - the top bar stays one row at 300, 560 and 900 px panel widths;
// - scrubbing through a script (readouts changing every step) never changes the 3D stage's rect, with the readouts
//   expanded and folded; folding them is the only thing that resizes the stage (and gives it nearly the whole panel);
// - the depth map (canal / rectum / junction / sigmoid bars) keeps its rect while its bars change.
import { chromium } from 'playwright';
const [URL, OUT] = process.argv.slice(2);
if (!URL) { console.error('usage: node dev/machine-stage-check.mjs <shell.html url> [out dir]'); process.exit(2); }
const b = await chromium.launch({ channel: 'msedge', headless: true });
const page = await b.newPage({ viewport: { width: 2400, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// window.app is the <div id=app> (named access) until shell.js runs: on a cold vite under load that takes > 2.5 s (paw-zwgs)
await page.goto(URL); await page.waitForFunction(() => typeof window.app?.load === 'function', null, { timeout: 120000 }); await page.waitForTimeout(1000);
const fail = [];
const ok = (c, m) => { if (!c) fail.push(m); console.log(c ? 'ok  ' : 'FAIL', m); };
await page.evaluate(async () => {
  const app = window.app, s = [];
  for (let k = 0; k < 40; k++) s.push({ at: k * 1500, pos: 100 }, { at: k * 1500 + 700, pos: k % 3 ? 10 : 0 });
  app.load({ axes: { stroke: s }, activeAxis: 'stroke' });
  for (const [k, v] of Object.entries({ 'machine.toy': 'kahn', 'machine.size': 'large', 'machine.char': 'canine', 'machine.readouts': true, 'machine.cam': null })) app.settings.set(k, v);
  app.showPanel('machine.view'); app.layout.size('timeline', 150);
  await new Promise((r) => setTimeout(r, 1200));
});
const rect = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10); }, sel);
for (const w of [300, 560, 900]) {
  await page.evaluate((w) => window.app.layout.size('right', w), w);
  await page.waitForTimeout(700);
  const bar = await page.evaluate(() => { const kids = [...document.querySelector('.mc .bar').children].filter((e) => e.getBoundingClientRect().width > 0); const tops = new Set(kids.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))), edge = document.querySelector('.mc .bar').getBoundingClientRect().right; return { rows: tops.size + kids.filter((e) => e.getBoundingClientRect().right > edge + 0.5).length, w: document.querySelector('.mc').getBoundingClientRect().width, sw: document.querySelector('.mc .bar').scrollWidth, cw: document.querySelector('.mc .bar').clientWidth }; });
  ok(bar.rows === 1 && bar.sw <= bar.cw + 1, `top bar one row, nothing cut off, at ${w} px (panel ${bar.w}, rows ${bar.rows}, ${bar.sw}/${bar.cw})`);
  if (OUT) await page.locator('.mc .bar').first().screenshot({ path: `${OUT}/bar-${w}.png` });
}
await page.evaluate(() => window.app.layout.size('right', 560)); await page.waitForTimeout(600);
const scrub = async (tag) => {
  const r0 = await rect('.mc .stage'), seen = new Set(), strip = new Set(), bars = new Set();
  for (let t = 0; t <= 60000; t += 450) {
    await page.evaluate((t) => window.app.player.seek(t), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await rect('.mc .stage');
    seen.add(JSON.stringify(r));
    if (tag === 'readouts expanded') {   // the depth map (four bars): its rect fixed, its fills moving
      strip.add(JSON.stringify(await rect('.mc .dmap')));
      bars.add(await page.evaluate(() => [...document.querySelectorAll('.mc .dmap .df')].map((e) => e.style.width).join(' ')));
    }
  }
  if (tag === 'readouts expanded') ok(strip.size === 1 && bars.size > 1, `the depth map stays put while its bars move (${strip.size} rects, ${bars.size} bar states)`);
  ok(seen.size === 1 && JSON.stringify([...seen][0]) === JSON.stringify(JSON.stringify(r0)), `${tag}: the stage rect stays ${JSON.stringify(r0)} while scrubbing (${seen.size} distinct)`);
  return r0;
};
const open = await scrub('readouts expanded');
if (OUT) await page.locator('.mc').first().screenshot({ path: `${OUT}/readouts-open.png` });
await page.locator('.mc .ros .kit-section-trigger').click(); await page.waitForTimeout(700);
ok(await page.evaluate(() => window.app.settings.get('machine.readouts')) === false, 'folding the readouts is saved');
const shut = await scrub('readouts folded');
const mc = await rect('.mc');
ok(shut[3] > open[3] + 60 && shut[3] > 0.78 * mc[3], `folded, the stage grows to nearly the whole panel (${open[3]} -> ${shut[3]} of ${mc[3]} px)`);
ok(await page.locator('.mc .ros .rosum .k-badge').count() === 1, 'folded, the head keeps the knot badge and readiness');
if (OUT) await page.locator('.mc').first().screenshot({ path: `${OUT}/readouts-folded.png` });
await page.locator('.mc .ros .kit-section-trigger').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
ok(await page.evaluate(() => window.app.settings.get('machine.readouts')) === true, 'Enter on the head opens them again');
ok(!errors.length, `no page errors ${errors.join(' | ')}`);
await b.close();
process.exit(fail.length ? 1 : 0);
