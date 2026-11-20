// dev/label-look.mjs -- paw-714j: the image-labelling workspace in YOUR test instance (node dev/test-app.mjs start ..., then the
// CDP_* env it prints) on a folder of GENERATED images (coloured shapes: a red square, a green disc, a bar; some gif / txt to be
// skipped). Opens a project-less app (or whatever is open), enters the workspace, paints two parts on the first image, goes
// next, "nothing here", leaves, checks the app document is untouched, re-enters and checks the labels are back; screenshots.
//   node dev/label-look.mjs <image folder> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';

const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  const snap = () => ev(() => JSON.stringify({ doc: { scenes: app.doc.scenes, media: app.doc.media, axes: app.doc.axes, dirty: app.doc.dirty }, undo: app.history.index, t: app.player.timeMs }));
  const before = await snap();
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  // the image's pixel (fx, fy as fractions) on screen (fit view)
  const at = async (fx, fy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + fx * r.iw * s, oy + fy * r.ih * s]; };
  const paint = async (a, b) => { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); for (let k = 1; k <= 8; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 8, y0 + ((y1 - y0) * k) / 8); await page.mouse.up(); await wait(200); };

  // a clean slate: open once, delete whatever labels the test instance already holds, leave
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 20000 });
  await ev(async () => { await app.labelling.leave(); const d = await app.labelling.labelsDir(); for (const e of await app.backend.listDir(d)) await app.backend.remove(e.path); });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 20000 });
  ok(true, 'the workspace opened');
  const n0 = await ev(() => app.labelling.images.map((i) => i.name));
  ok(n0.join() === 'shape01.png,shape02.jpg,shape03.png,shape04.webp,shape05.jpg,shape06.png', 'listed jpg / png / webp only: ' + n0.join(' '));
  ok((await page.locator('[data-testid="label-counter"]').innerText()) === '0 labelled · 6 left', 'the counter reads 0 labelled · 6 left');
  ok(await page.locator('[data-testid="groups-tools"]').isVisible(), 'the Groups toolbar (brush, part picker) is up on the image');
  ok(!(await page.getByRole('button', { name: 'Suggest' }).isVisible().catch(() => false)), 'no Suggest in the labelling workspace');
  await page.screenshot({ path: out + '/1-empty.png' });
  // paint the red square as C1 hips (armed part), the green disc as C2 knot (a new part)
  await page.keyboard.press('1');
  await page.locator('[data-testid="groups-parts"] button', { hasText: /^hips$/ }).click();
  await paint([0.2, 0.3], [0.4, 0.45]);
  await page.locator('[data-testid="groups-parts"] button', { hasText: /^knot$/ }).click();
  await page.keyboard.press('2');
  await paint([0.66, 0.6], [0.74, 0.62]);
  const g1 = await ev(() => app.labelling.groups.map((g) => g.name));
  ok(g1.join() === 'c1_hips,c2_knot', 'two parts painted: ' + g1);
  await page.screenshot({ path: out + '/2-painted.png' });
  await page.keyboard.press('ArrowRight'); await wait(900);
  ok((await ev(() => app.labelling.index)) === 1 && (await ev(() => app.labelling.groups.length)) === 0, 'next (ArrowRight): a new image, empty');
  ok((await page.locator('[data-testid="label-counter"]').innerText()) === '1 labelled · 5 left', 'counter: 1 labelled · 5 left');
  await page.keyboard.press('n'); await wait(900);
  ok((await ev(() => app.labelling.index)) === 2 && (await page.locator('[data-testid="label-counter"]').innerText()) === '2 labelled · 4 left', 'N: nothing here, stored, on to the next unlabelled');
  const strip = await page.locator('[data-testid="label-strip"] .th').count();
  const marks = await page.locator('[data-testid="label-strip"] .th .mark').allInnerTexts();
  ok(strip === 6 && marks.join('') === '✓∅', `thumbnail strip: ${strip} thumbs, marks ${marks.join(' ')}`);
  await page.screenshot({ path: out + '/3-strip.png' });
  const sb = await ev((f) => app.backend.listDir(f).then((l) => l.map((e) => e.name).sort().join()), folder);
  ok(sb === 'anim.gif,notes.txt,shape01.png,shape02.jpg,shape03.png,shape04.webp,shape05.jpg,shape06.png', 'nothing was written into the image folder');
  const labelsDir = await ev(() => app.labelling.labelsDir());
  const files = await ev((d) => app.backend.listDir(d).then((l) => l.map((e) => e.name)), labelsDir);
  ok(files.length === 2 && files.every((f) => /^i[0-9a-f]{14}\.json$/.test(f)), 'two small label files in the app data folder: ' + files.join(' '));
  await page.getByRole('button', { name: 'Back to project' }).click(); await wait(500);
  ok(!(await page.locator('[data-testid="label-workspace"]').isVisible().catch(() => false)), 'left the workspace');
  const after = await snap();
  ok(after === before, 'the app document, undo position, dirty flag and playhead are exactly as before');
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 20000 });
  ok((await page.locator('[data-testid="label-counter"]').innerText()) === '2 labelled · 4 left', 're-entered: the counter is back (2 labelled)');
  await ev(() => app.labelling.show(0)); await page.waitForFunction(() => app.labelling.ready && app.labelling.index === 0, null, { timeout: 10000 }); await wait(500);
  const g2 = await ev(() => app.labelling.groups.map((g) => g.name));
  ok(g2.join() === 'c1_hips,c2_knot', 'the painted parts are back: ' + g2);
  await page.screenshot({ path: out + '/4-reentered.png' });
  await ev(() => app.labelling.leave());
  ok(!errs.length, `no console errors (${errs.slice(0, 3).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
