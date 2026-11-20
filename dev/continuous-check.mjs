// dev/continuous-check.mjs -- paw-up1r stage 1 / paw-bztd in the REAL window (your test instance: node dev/test-app.mjs start ...;
// the CDP_* env it prints). A generated clip only. Opens it, edits points (keys), moves the playhead, zooms, selects; waits for the
// continuous write (no save); Publish once (Ctrl+Alt+S: the funscript beside it; Ctrl+S is Commit since paw-up1r stage 2),
// then one more point that is NOT published (the project runs
// ahead of its funscript: paw-kdck); closes with the tab's x; reopens from the project page card; asserts the playhead, view,
// tab, selection are as they were, Ctrl+Z undoes the last edit, and no dialog was asked at any point (the reopen included).
//   node dev/continuous-check.mjs <clip.mp4>
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const clip = process.argv[2];
if (!clip) { console.error('usage: node dev/continuous-check.mjs <clip.mp4>'); process.exit(2); }
const proj = clip.replace(/\.[^.]+$/, '.pawproj'), hist = clip.replace(/\.[^.]+$/, '.pawhistory'), fun = clip.replace(/\.[^.]+$/, '.funscript');
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
const state = () => ev(() => ({ t: Math.round(app.player.displayMs ?? app.player.timeMs), view: { ...app.view }, mode: app.mode, axis: app.doc.activeAxis,
  sel: [...app.doc.selection.ats].sort((a, b) => a - b), stroke: (app.doc.axes.stroke || []).map((p) => [p.at, p.pos]), dirty: app.doc.dirty }));

try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
  for (const f of [proj, fun, clip.replace(/\.[^.]+$/, '.pawruns')]) if (existsSync(f)) rmSync(f);
  if (existsSync(hist)) rmSync(hist, { recursive: true });
  await ev(() => app.project.close());
  // every question the app could ask is counted (app.confirm goes through app.choose)
  await ev(() => { window.__asked = []; const c = app.choose.bind(app); app.choose = (o) => { window.__asked.push(o?.title || '?'); return c(o); }; });
  await ev((c) => app.project.openPaths([c]), clip);
  await page.waitForFunction((c) => app.doc.media?.path === c && app.player.ready, clip, { timeout: 60000 });
  await ev(() => app.setMode('refine'));
  await settle();
  // points by the number keys at the playhead (the owner's way), then a nudge
  for (const [ms, key] of [[1000, '0'], [1500, '9'], [2000, '1'], [2600, '8']]) {
    await ev((ms) => app.player.seek(ms, { exact: true }), ms);
    await wait(150);
    await page.keyboard.press('Numpad' + key);   // paw-5zpf: NumPad digits place points (the number row picks the selection mode)
  }
  await settle();
  const pts = await ev(() => (app.doc.axes.stroke || []).length);
  ok(pts === 4, `four points made by keys (${pts})`);
  await wait(1500);
  await page.keyboard.press('Control+Alt+s');   // Publish (Ctrl+S opens the commit dialog: a key typed after it lands in its note)
  await wait(1000);
  ok(existsSync(fun), 'Ctrl+Alt+S (Publish) wrote the funscript beside the clip');
  await ev(() => app.player.seek(3100, { exact: true }));
  await wait(150);
  await page.keyboard.press('Numpad5');   // not published: only the project has it
  await settle();
  await ev(() => { app.select([(app.doc.axes.stroke || [])[1].at, (app.doc.axes.stroke || [])[2].at]); });
  await ev(() => app.player.seek(3456, { exact: true }));
  await ev(() => app.setView({ start: 800, span: 4200 }));
  await settle();
  await wait(1600);   // the continuous write: about a second after the change, no save
  ok(existsSync(proj), `${proj.split(/[\\/]/).pop()} written beside the clip without a save`);
  const onDisk = existsSync(proj) ? JSON.parse(readFileSync(proj, 'utf8')).axes?.stroke?.length : 0;
  ok(onDisk === 5, `the project holds the five points (${onDisk})`);
  ok(JSON.parse(readFileSync(fun, 'utf8')).actions.length === 4, 'the funscript still has the four published');
  ok(!(await ev(() => app.doc.dirty)), 'nothing left to write');
  ok(await page.locator('[data-testid="tab-doc"] .dot').count() === 0 && !/•/.test(await page.title()), 'no unsaved mark on the tab or the title');
  const was = await state();

  // close with the tab's x: no question, the project page shows
  await page.locator('[data-testid="tab-close"]').click();
  await page.waitForFunction(() => !app.doc.media, null, { timeout: 15000 });
  await settle();
  ok(await page.locator('.home h1').count() === 1, 'closed: the project page shows');
  ok(existsSync(hist + '/index.json') && JSON.parse(readFileSync(hist + '/index.json', 'utf8')).checkpoints.some((c) => c.label === 'On close'), 'a checkpoint was taken on close');
  ok(existsSync(hist + '/undo.json'), 'the undo history was written beside the project');

  // reopen from its card
  const card = page.locator(`[data-testid="project-card"][data-path="${proj.replace(/\\/g, '\\\\')}"] .card-open`);
  ok(await card.count() === 1, 'the project has a card');
  await card.click();
  await page.waitForFunction((c) => app.doc.media?.path === c && app.player.ready, clip, { timeout: 60000 });
  await page.waitForFunction((t) => Math.abs((app.player.displayMs ?? app.player.timeMs) - t) < 40, was.t, { timeout: 10000 }).catch(() => {});
  await settle();
  const now = await state();
  ok(Math.abs(now.t - was.t) < 40, `playhead back at ${was.t} ms (${now.t})`);
  ok(Math.abs(now.view.start - was.view.start) < 1 && Math.abs(now.view.span - was.view.span) < 1, `view back (${JSON.stringify(now.view)} vs ${JSON.stringify(was.view)})`);
  ok(now.mode === was.mode, `tab back (${now.mode})`);
  ok(JSON.stringify(now.sel) === JSON.stringify(was.sel), `selection back (${JSON.stringify(now.sel)})`);
  ok(JSON.stringify(now.stroke) === JSON.stringify(was.stroke), 'the points are the same');
  // Ctrl+Z undoes the last edit made before the close
  await page.locator('[data-testid="editor"]').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
  await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await settle();
  const after = await state();
  ok(JSON.stringify(after.stroke) === JSON.stringify(was.stroke.slice(0, -1)), `Ctrl+Z took the last point away (${after.stroke.length} left)`);
  ok(!(await ev(() => app.doc.ghosts.some((g) => /^disk/.test(g.id)))), 'no changed-outside ghost on the reopen');
  const asked = await ev(() => window.__asked);
  ok(asked.length === 0, `no dialog at any point (${JSON.stringify(asked)})`);
  ok(await ev(() => !app.dialog && ![...document.querySelectorAll('dialog')].some((d) => d.open)), 'no dialog painted');
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exit(fails ? 1 : 0);
}
