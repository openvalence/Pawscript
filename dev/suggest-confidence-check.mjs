// dev/suggest-confidence-check.mjs -- paw-r6t0: the shown-confidence control of Suggest in YOUR test instance (fake sidecar, generated images "many-*.png").
//   node dev/suggest-confidence-check.mjs <image folder> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  await ev(() => app.settings.set('tracking.suggest.confidence', 0.8));
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await page.getByTestId('groups-tools').getByRole('button', { name: 'Suggest', exact: true }).click();
  await page.waitForFunction(() => app.labelling.suggestionCount > 0, null, { timeout: 20000 });
  const n0 = await ev(() => app.labelling.suggestionCount), held0 = await ev(() => app.labelling.G.heldCount);
  // the shown-confidence control and the count line live in the Groups list popover since 6543984 (paw-i5qx: the slim bar)
  await page.getByTestId('groups-list-open').first().click();
  await page.locator('[data-testid="groups-conf-v"]').waitFor({ timeout: 5000 });
  const v = () => page.locator('[data-testid="groups-conf-v"]').innerText();
  ok(n0 < 18 && n0 >= 5 && held0 > 0 && n0 + held0 === 18, `default ${await v()} %: ${n0} shown, ${held0} held of 18 returned`);
  const line = await page.getByText(/shown · \d+ more below/).first().innerText().catch(() => '');
  ok(/^\d+ shown · \d+ more below 80 %/.test(line), `count line: ${line}`);
  ok(/labeled pictures?: suggestions will be rough until about 30\+/.test(await page.locator('[data-testid="label-suggest"]').innerText()), 'the young-seeder note is on the Suggest line');   // American 'labeled' since 79288c5 (paw-nh6o)
  await page.screenshot({ path: out + '/c1-default.png' });
  // drag the control down: more shown at once
  const box = await page.locator('[data-testid="groups-conf"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 8 }); await page.mouse.up(); await wait(300);
  const n1 = await ev(() => app.labelling.suggestionCount);
  ok(n1 > n0 && Number(await v()) < 80, `dragged down to ${await v()} %: ${n1} shown (was ${n0})`);
  await page.screenshot({ path: out + '/c2-lower.png' });
  await page.locator('[data-testid="groups-conf"]').hover(); await page.mouse.wheel(0, -300); await wait(300);
  const n2 = await ev(() => app.labelling.suggestionCount);
  ok(n2 < n1, `scrolled up to ${await v()} %: ${n2} shown`);
  await page.keyboard.press('Shift+BracketLeft'); await wait(200);   // {
  ok(Number(await v()) < Number(await ev(() => Math.round(app.labelling.G.suggestConf * 100 + 5))), 'the { key steps it down (a registered key)');
  // Accept all applies only to what is shown
  await ev(() => app.settings.set('tracking.suggest.confidence', 0.8)); await ev(() => app.labelling.G.setSuggestConf(0.8)); await wait(200);
  const shown = await ev(() => app.labelling.suggestionCount), held = await ev(() => app.labelling.G.heldCount);
  await page.getByRole('button', { name: 'Accept all' }).first().click(); await wait(500);
  ok((await ev(() => app.labelling.painted.length)) === shown && (await ev(() => app.labelling.G.heldCount)) === held, `Accept all took the ${shown} shown, the ${held} held ones stay held`);
  await page.screenshot({ path: out + '/c3-accepted.png' });
  await ev(() => app.labelling.leave());
  ok(!errs.length, `no console errors (${errs.slice(0, 2).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
