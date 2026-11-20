// dev/commit-check.mjs -- paw-up1r stage 2 in the REAL window (your test instance: node dev/test-app.mjs start ...; the CDP_*
// env it prints). A generated clip only. Points by keys; Ctrl+S opens the commit dialog (the changes listed), a note typed,
// Enter commits; one more point; Ctrl+Alt+S publishes (the funscript beside the clip: valid JSON, metadata.pawscript.publish
// version 1, the publish entry in the history); one more point: the funscript is unchanged and the status bar says
// "v1 published · 1 edit since"; the commit restored from the Commits panel's button: the points as committed, Ctrl+Z
// takes the restore back. No choice dialog at any point (the commit dialog is the owner's).
//   node dev/commit-check.mjs <clip.mp4>
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const clip = process.argv[2];
if (!clip) { console.error('usage: node dev/commit-check.mjs <clip.mp4>'); process.exit(2); }
const stem = clip.replace(/\.[^.]+$/, ''), proj = stem + '.pawproj', hist = stem + '.pawhistory', fun = stem + '.funscript';
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
const stroke = () => ev(() => (app.doc.axes.stroke || []).map((p) => p.at));
const index = () => JSON.parse(readFileSync(hist + '/index.json', 'utf8')).checkpoints;
async function keyPoint(ms, key) {
  await ev((t) => app.player.seek(t, { exact: true }), ms);
  await wait(150);
  await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Numpad' + key);   // paw-5zpf: NumPad digits place points (the number row picks the selection mode)
  await settle();
}

try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 120000 });
  await ev(() => app.project.close());
  for (const f of [proj, fun, stem + '.pawruns']) if (existsSync(f)) rmSync(f);
  if (existsSync(hist)) rmSync(hist, { recursive: true });
  await ev(() => { window.__asked = []; const c = app.choose.bind(app); app.choose = (o) => { window.__asked.push(o?.title || '?'); return c(o); }; });
  await ev((c) => app.project.openPaths([c]), clip);
  await page.waitForFunction((c) => app.doc.media?.path === c && app.player.ready, clip, { timeout: 60000 });
  await ev(() => app.setMode('refine'));
  await settle();
  for (const [ms, key] of [[1000, '0'], [1500, '9'], [2000, '1'], [2600, '8']]) await keyPoint(ms, key);
  ok((await stroke()).length === 4, `four points made by keys (${(await stroke()).length})`);

  // Ctrl+S: the commit dialog, the changes listed, a note, Enter
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.commit-dialog [data-testid="commit-note"]', { timeout: 15000 }).catch(() => {});
  const listed = await page.locator('[data-testid="commit-changes"]').innerText().catch(() => '');
  ok(/\+4 points on stroke/.test(listed), `the dialog lists the change (${JSON.stringify(listed)})`);
  const focused = await ev(() => !!document.activeElement?.matches?.('[data-testid="commit-note"]'));
  ok(focused, 'the note field has the focus');
  if (focused) await page.keyboard.type('first pass');
  else await page.locator('[data-testid="commit-note"]').fill('first pass');   // never type into the editor: letters are shortcuts
  await page.locator('[data-testid="commit-note"]').press('Enter');
  await page.waitForFunction(() => !app.project.commitDraft && !document.querySelector('.commit-dialog'), null, { timeout: 15000 }).catch(() => {});
  ok(!(await page.locator('.commit-dialog').count()), 'Enter committed and closed the dialog');
  await wait(300);
  const commit = existsSync(hist + '/index.json') ? index().find((c) => c.kind === 'commit') : null;
  ok(commit?.note === 'first pass', `a commit with the note in .pawhistory (${JSON.stringify(commit && { kind: commit.kind, note: commit.note })})`);

  // one more point, then Publish
  await keyPoint(3100, '5');
  await page.keyboard.press('Control+Alt+s');
  await page.waitForFunction(() => app.project.published?.version === 1 && !app.project.busy, null, { timeout: 15000 }).catch(() => {});
  let f = null;
  try { f = JSON.parse(readFileSync(fun, 'utf8')); } catch (e) { ok(false, 'the funscript is valid JSON: ' + e.message); }
  ok(f?.metadata?.pawscript?.publish?.version === 1, `published: metadata.pawscript.publish.version 1 (${JSON.stringify(f?.metadata?.pawscript?.publish)})`);
  ok(f?.actions?.length === 5, `the published file has the five points (${f?.actions?.length})`);
  ok(index().some((c) => c.kind === 'publish' && c.id === f?.metadata?.pawscript?.publish?.commit && c.version === 1), 'its commit id names the publish entry');
  const text = readFileSync(fun, 'utf8');

  // one more point: written to the project, not to the funscript; the status says ahead
  await keyPoint(3700, '2');
  await wait(1800);
  ok(JSON.parse(readFileSync(proj, 'utf8')).axes.stroke.length === 6, 'the project has the sixth point (continuous write)');
  ok(readFileSync(fun, 'utf8') === text, 'the funscript is unchanged');
  const chip = await page.locator('[data-testid="status-published"]').innerText().catch(() => '');
  ok(/v1 published · 1 edit since/.test(chip), `the status bar: ${JSON.stringify(chip)}`);

  // the commit restored from the Commits panel; Ctrl+Z takes it back
  await ev(() => app.commands.run('file.history'));
  await page.waitForSelector(`[data-testid="history-entry"][data-id="${commit?.id}"]`, { timeout: 15000 }).catch(() => {});
  const row = page.locator(`[data-testid="history-entry"][data-id="${commit?.id}"]`);
  ok(await row.count() === 1, 'the commit is listed in the Commits panel');
  await row.locator('[data-testid="history-restore"]').click();
  await page.waitForFunction(() => (app.doc.axes.stroke || []).length === 4, null, { timeout: 15000 }).catch(() => {});
  ok(JSON.stringify(await stroke()) === JSON.stringify([1000, 1500, 2000, 2600]), `restored: the four committed points (${JSON.stringify(await stroke())})`);
  await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await settle();
  ok((await stroke()).length === 6, `Ctrl+Z took the restore back (${(await stroke()).length} points)`);
  ok(readFileSync(fun, 'utf8') === text, 'the funscript is still v1');
  const asked = await ev(() => window.__asked);
  ok(asked.length === 0, `no choice dialog at any point (${JSON.stringify(asked)})`);
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exit(fails ? 1 : 0);
}
