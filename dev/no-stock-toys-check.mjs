// dev/no-stock-toys-check.mjs -- the public build's Machine panel (paw-zqxu) in YOUR test instance, whose dist was built
// from a tree with the stock toy library emptied as dev/share/build-nas.ps1 does (node dev/test-app.mjs start ..., then
// the CDP_* env it prints):
// - a saved stock toy key ('kahn') falls back to a generic toy; the picker offers only the generic toys (Taper, Knot);
// - the 3D stage draws, and scrubbing / playing a script moves the readouts;
// - no console errors, no page errors, no broken images.
//   node dev/no-stock-toys-check.mjs [out.png]
import { connectTestApp } from './cdp-connect.mjs';

const { browser, page } = await connectTestApp();
const errors = [], fail = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const ok = (c, m) => { if (!c) fail.push(m); console.log(c ? 'ok  ' : 'FAIL', m); };
try {
  await page.waitForFunction(() => window.app?.settings, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const s = [];
    for (let k = 0; k < 40; k++) s.push({ at: k * 1500, pos: 100 }, { at: k * 1500 + 700, pos: k % 3 ? 10 : 0 });
    app.load({ axes: { stroke: s }, activeAxis: 'stroke' });
    app.settings.set('machine.toy', 'kahn');   // a stock toy a private build saved
    app.showPanel('machine.view');
    await new Promise((r) => setTimeout(r, 1500));
  });
  ok(await page.locator('.mc').count() === 1, 'the Machine panel is open');
  const cur = await page.locator('.mc button.cur').getAttribute('aria-label');
  ok(/Toy: (Taper|Knot)$/.test(cur || ''), `the saved stock toy falls back to a generic one (${cur})`);
  await page.locator('.mc button.cur').click(); await page.waitForTimeout(500);
  const tiles = await page.locator('[role=listbox][aria-label=Toys] button.tile .lbl').allTextContents();
  ok(tiles.length === 2 && tiles.includes('Taper') && tiles.includes('Knot'), `the picker offers only the generic toys: ${tiles.join(', ')}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const canvas = await page.evaluate(() => { const c = document.querySelector('.mc .stage canvas'); return c ? [c.width, c.height] : null; });
  ok(canvas && canvas[0] > 50 && canvas[1] > 50, `the stage draws (${canvas})`);
  const seen = new Set();
  for (let t = 0; t <= 6000; t += 350) {
    await page.evaluate((t) => app.player.seek(t), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    seen.add(await page.evaluate(() => document.querySelector('.mc .ros')?.textContent || ''));
  }
  ok(seen.size > 3, `scrubbing the script moves the readouts (${seen.size} states)`);
  await page.evaluate(() => app.player.seek(0));
  await page.evaluate(() => app.commands.run('player.toggle')); await page.waitForTimeout(2000);
  const playing = await page.evaluate(() => [app.player.playing, app.player.timeMs]);
  await page.evaluate(() => { if (app.player.playing) app.commands.run('player.toggle'); });
  console.log('play for 2 s:', JSON.stringify(playing));
  const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.style.display !== 'none').map((i) => i.src));
  ok(!broken.length, `no broken images ${broken.join(' ')}`);
  if (process.argv[2]) await page.locator('.mc').first().screenshot({ path: process.argv[2] });
  ok(!errors.length, `no console or page errors ${errors.join(' | ')}`);
} finally {
  await browser.close();
}
process.exit(fail.length ? 1 : 0);
