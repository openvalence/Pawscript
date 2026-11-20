// dev/label-suggest.mjs -- paw-714j: Suggest on a still image in YOUR test instance (fake sidecar, no GPU, no model). Opens the labelling
// workspace on a folder of generated images, presses Suggest, checks the suggestions are drawn but NOT saved as labels, accepts one (saved as
// source user, from suggest), paints one stroke on another image and compares.
//   node dev/label-suggest.mjs <image folder> <out dir>
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
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(async () => { const d = await app.labelling.labelsDir(); for (const e of await app.backend.listDir(d).catch(() => [])) await app.backend.remove(e.path); await app.labelling.leave(); });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  const labelFiles = () => ev(async () => app.backend.listDir(await app.labelling.labelsDir()).then((l) => l.map((e) => e.name), () => []));
  await page.getByTestId('groups-tools').getByRole('button', { name: 'Suggest', exact: true }).click();
  await page.waitForFunction(() => app.labelling.suggestionCount > 0, null, { timeout: 20000 });
  const n = await ev(() => app.labelling.suggestionCount);
  ok(n === 3 && await page.locator('[data-testid="label-suggest"]').isVisible(), `Suggest drew ${n} suggestions and the readout row`);
  ok((await page.locator('[data-testid="label-suggest"]').innerText()).includes('learned head'), 'the readout names the model: ' + (await page.locator('[data-testid="label-suggest"]').innerText()).replace(/\s+/g, ' ').slice(0, 90));
  await page.screenshot({ path: out + '/s1-suggested.png' });
  await wait(900);
  ok((await labelFiles()).length === 0, 'shown suggestions were not saved as labels');
  await page.keyboard.press('ArrowRight'); await wait(900);
  await page.keyboard.press('ArrowLeft'); await wait(900);
  ok((await ev(() => app.labelling.suggestionCount)) === 0 && (await labelFiles()).length === 0, 'moving on and back: the unaccepted suggestions are gone and nothing was saved');
  await page.getByTestId('groups-tools').getByRole('button', { name: 'Suggest', exact: true }).click();
  await page.waitForFunction(() => app.labelling.suggestionCount > 0, null, { timeout: 20000 });
  await page.locator('[aria-label^="Accept"]').first().click(); await wait(900);
  const files = await labelFiles();
  const lab = files.length ? JSON.parse(await ev(async (f) => await app.backend.readText((await app.labelling.labelsDir()) + '/' + f), files[0])) : null;
  ok(files.length === 1 && lab.groups.length === 1 && lab.groups[0].source === 'user' && lab.groups[0].from === 'suggest', `one accepted group saved: ${lab?.groups.map((g) => g.name + ':' + g.source + ':' + g.from)}`);
  ok((await ev(() => app.labelling.suggestionCount)) === 2, 'the other two are still only on offer');
  await page.getByTestId('groups-tools').getByRole('button', { name: 'Suggest', exact: true }).click(); await wait(1500);
  const txt = await page.locator('[data-testid="label-suggest"]').innerText();
  ok(/vs your labels/.test(txt) && /found|extra/.test(txt), 'on a labelled image the readout compares: ' + txt.replace(/\s+/g, ' ').slice(0, 140));
  await page.locator('[data-testid="label-compare"]').click(); await wait(300);
  ok((await ev(() => app.labelling.suggestionCount)) === 0 && (await ev(() => app.labelling.painted.length)) === 1, 'Hide suggestions: only the owner\'s label shows');
  await page.screenshot({ path: out + '/s2-compare.png' });
  await ev(() => app.labelling.leave());
  ok(!errs.length, `no console errors (${errs.slice(0, 2).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
