// dev/dataset-check.mjs -- paw-855t: seeder datasets and ignore regions in YOUR test instance (fake sidecar, no GPU, generated pictures).
//   phase "old":   node dev/dataset-check.mjs old   <image folder> <out dir>   label two pictures, leave the pre-dataset files in the data folder
//   (then, by hand: stop, put the labels back where the old layout kept them (the script's printed command), start --id <same id>)
//   phase "check": node dev/dataset-check.mjs check <image folder> <out dir>   the migrated layout: v1 + v2, picker, start from, ignore, Train x2, comparison
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [phase, folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const readJson = (p) => ev(async (f) => JSON.parse(await app.backend.readText(f)), p).catch(() => null);
const names = (d) => ev(async (f) => (await app.backend.listDir(f)).map((e) => e.name).sort(), d).catch(() => null);
const open = async () => { await ev((f) => app.commands.run('labelling.open', { folder: f }), folder); await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 }); };
const paint = (part, x, y, force = false) => ev(({ part, x, y, force }) => { const G = app.labelling.G; G.pickPart(part); G.begin(x, y, false, 1, force); G.move(x + 0.04, y + 0.01); G.end(); }, { part, x, y, force });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  const data = (await ev(() => app.backend.appPaths())).data_dir, seed = data + '\\seeder';
  if (phase === 'old') {
    await open();
    const reg = await readJson(seed + '\\datasets.json');
    ok(reg?.active === 'v2' && reg.datasets.length === 1, 'a fresh start: the registry has only v2, active: ' + JSON.stringify(reg?.datasets?.map((d) => d.id)));
    await paint('hips', 0.3, 0.55); await ev(() => app.labelling.flush());
    await page.keyboard.press('ArrowRight'); await wait(900);
    await paint('head', 0.55, 0.3); await ev(() => app.labelling.flush());
    await ev(async (s) => { await app.backend.writeText(s + '\\head.json', JSON.stringify({ frames: 2, videos: 2, fingerprint: 'old-head', parts: {} })); await app.backend.writeText(s + '\\score.json', JSON.stringify({ latest: { fingerprint: 'old-head', overall: { found: 0.4 } }, history: [] })); }, seed);
    ok((await names(seed + '\\datasets\\v2\\labels'))?.length === 2, 'two pictures labelled (in v2 of this fresh instance)');
    await ev(() => app.labelling.leave());
    console.log('DATA_DIR=' + data);
  } else {
    // ---- the migrated layout ----
    const reg = await readJson(seed + '\\datasets.json');
    ok(reg?.active === 'v2' && reg.datasets.map((d) => d.id).join() === 'v1,v2' && reg.datasets[0].projects === true && reg.datasets[1].projects === false, 'the old layout migrated: registry v1 (projects on) + v2 (off), v2 active');
    ok((await names(seed + '\\datasets\\v1\\labels'))?.length === 2 && (await names(seed + '\\datasets\\v1'))?.includes('head.json') && (await names(seed + '\\datasets\\v1'))?.includes('score.json'), 'v1 holds the old labels, head and score, nothing lost');
    const left = await names(seed);
    ok(!left.includes('labels') && !left.includes('head.json') && left.includes('thumbs') !== undefined, 'the flat files are gone from the seeder folder (moved, not copied): ' + left.join(','));
    ok((await names(seed + '\\datasets\\v2')) === null || !(await names(seed + '\\datasets\\v2')).includes('labels'), 'v2 starts empty');
    await open();
    const btn = page.getByTestId('dataset-button');
    ok((await btn.innerText()).trim() === 'v2 · 0 labelled', 'the picker shows "v2 · 0 labelled": ' + (await btn.innerText()).trim());
    await btn.click(); await wait(200);
    ok(await page.getByTestId('dataset-row-v1').isVisible(), 'the menu lists v1');
    await page.screenshot({ path: out + '/d1-picker.png' });
    await btn.click(); await wait(100);
    await page.waitForFunction(() => app.labelling.otherNames(app.labelling.images[app.labelling.index]).length || app.labelling.images.some((im) => app.labelling.otherNames(im).length), null, { timeout: 5000 });
    // show the first image labelled in v1
    const idx = await ev(() => app.labelling.images.findIndex((im) => app.labelling.otherNames(im).length > 0));
    await ev((i) => app.labelling.show(i), idx); await wait(500);
    const start = page.getByTestId('label-start-from').first();
    ok(await start.isVisible(), 'an image labelled in v1 but not here offers "Start from the v1 label" (and the strip marks it faint)');
    await page.screenshot({ path: out + '/d2-start-from.png' });
    await start.click(); await wait(500);
    ok((await ev(() => app.labelling.groups.length)) === 1 && (await ev(() => app.labelling.pendingCopy)), 'started from the v1 label: its group is in the tool, not yet a v2 label');
    ok(((await names(seed + '\\datasets\\v2\\labels')) || []).length === 0, 'nothing written to v2 yet');
    await page.getByRole('button', { name: /Done, next/ }).click(); await wait(900);
    ok(((await names(seed + '\\datasets\\v2\\labels')) || []).length === 1, 'Done keeps it: one v2 label now, v1 still has two');
    // ---- a picture with an ignore region and a part (two-character style pictures: the inset is in the top right) ----
    const free = await ev(() => app.labelling.images.findIndex((im) => !app.labelling.labelled.has(im.key) && app.labelling.otherNames(im).length === 0));
    await ev((i) => app.labelling.show(i), free); await wait(600);
    await paint('hips', 0.3, 0.6);
    await page.keyboard.press('v'); await wait(100);
    await ev(() => { const G = app.labelling.G; G.begin(0.82, 0.22, false); G.move(0.86, 0.25); G.move(0.9, 0.3); G.end(); });
    await ev(() => app.labelling.flush()); await wait(300);
    const lbl = await names(seed + '\\datasets\\v2\\labels');
    const cur = await ev(() => app.labelling.current.key);
    const lab = await readJson(seed + '\\datasets\\v2\\labels\\' + cur + '.json');
    ok(lab?.ignore?.length === 1 && lab.groups.length === 1 && lab.groups[0].name === 'c1_hips', `the label has one part and its own ignore list (${lab?.groups?.map((g) => g.name)}, ignore ${lab?.ignore?.length})`);
    await page.screenshot({ path: out + '/d3-ignore-veil.png' });
    // ---- Train on v2 (fake sidecar) ----
    await page.getByTestId('label-train').click();
    await page.waitForFunction(() => !app.labelling.training, null, { timeout: 30000 }); await wait(800);
    ok((await names(seed + '\\datasets\\v2'))?.includes('head.json') && !(await names(seed + '\\datasets\\v1')).includes('cross.json'), 'Train wrote v2\'s head and score beside v2\'s labels');
    ok((await readJson(seed + '\\datasets\\v1\\head.json'))?.fingerprint === 'old-head', 'v1\'s head is untouched');
    ok((await page.getByTestId('label-seeder-dataset').innerText()).includes('Seeder (v2)'), 'the seeder row names the dataset: ' + (await page.getByTestId('label-seeder-dataset').innerText()).slice(0, 60));
    // ---- switch to v1 through the picker, Train there ----
    await btn.click(); await page.getByTestId('dataset-row-v1').click(); await wait(900);
    ok((await btn.innerText()).trim() === 'v1 · 2 labelled' && (await ev(() => app.labelling.counter)) === '2 labelled · 3 left', 'switched to v1: ' + (await btn.innerText()).trim());
    await page.screenshot({ path: out + '/d4-v1.png' });
    await page.getByTestId('label-train').click();
    await page.waitForFunction(() => !app.labelling.training, null, { timeout: 30000 }); await wait(1500);
    ok((await readJson(seed + '\\datasets\\v1\\head.json'))?.frames === 2, 'Train on v1 wrote v1\'s head (its 2 labels)');
    // ---- the comparison ----
    await page.waitForFunction(() => document.querySelector('[data-testid="label-datasets"]'), null, { timeout: 15000 });
    const ov = await page.getByTestId('label-datasets').innerText(), cr = await page.getByTestId('label-cross').innerText();
    ok(/v1.*held-out found/.test(ov) && /v2.*held-out found/.test(ov), 'the side-by-side line: ' + ov.replace(/\s+/g, ' ').slice(0, 160));
    ok(/on v1's labels/.test(cr) && /v2 head found/.test(cr) && /v1 head found/.test(cr), 'the cross line: ' + cr.replace(/\s+/g, ' ').slice(0, 200));
    await page.screenshot({ path: out + '/d5-comparison.png' });
    // ---- back to v2 ----
    await btn.click(); await page.getByTestId('dataset-row-v2').click(); await wait(900);
    ok((await btn.innerText()).trim() === 'v2 · 2 labelled', 'back on v2: ' + (await btn.innerText()).trim());
    ok((await readJson(seed + '\\datasets.json')).active === 'v2', 'the active dataset is stored');
    // a new dataset named inline
    await btn.click(); await page.getByTestId('dataset-new-input').fill('duos'); await page.getByTestId('dataset-create').click(); await wait(900);
    ok((await btn.innerText()).trim() === 'duos · 0 labelled', 'a new dataset made inline, empty and active: ' + (await btn.innerText()).trim());
    await page.screenshot({ path: out + '/d6-new.png' });
    await btn.click(); await page.getByTestId('dataset-row-v2').click(); await wait(500);
    await ev(() => app.labelling.leave());
  }
  ok(!errs.length, `no console errors (${errs.slice(0, 3).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
