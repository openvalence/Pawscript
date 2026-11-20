// dev/commit-scope-check.mjs -- the owner's "if they are only changes in a section, only that commit is for section", in the REAL
// window (your test instance: node dev/test-app.mjs start ...; the CDP_* env it prints). A generated clip (>= 14 s) only; a project
// beside it with three shots [0, 4) [4, 8) [8, 14) s. Asserts, on what is painted:
//   1. points by keys in shot 2 only, Ctrl+S: the dialog's title reads "Commit: Shot 2", its list "Shot 2: +2 points on stroke";
//      Enter commits; the Commits panel row names "Shot 2" and has the "Go back in Shot 2 only" button;
//   2. points in shots 1, 2 and 3, Ctrl+S: the title is plain "Commit", the list has the three shots; the row has no section and
//      no section button;
//   3. the same over an automatic checkpoint of that very state (the commit takes the entry over): still no section (paw-es11);
//   4. the Shot 2 row's section button: shot 2 back as committed, shots 1 and 3 untouched; Ctrl+Z takes it back.
//   node dev/commit-scope-check.mjs <clip.mp4>
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const clip = process.argv[2];
if (!clip) { console.error('usage: node dev/commit-scope-check.mjs <clip.mp4>'); process.exit(2); }
const stem = clip.replace(/\.[^.]+$/, ''), proj = stem + '.pawproj', hist = stem + '.pawhistory';
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
  await page.keyboard.press(key);
  await settle();
}
/** Ctrl+S, read the dialog as painted, Enter (with a note). -> {title, listed} */
async function commitByKeys(note) {
  await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.commit-dialog [data-testid="commit-note"]', { timeout: 15000 }).catch(() => {});
  const title = (await page.locator('.commit-dialog .kit-dialog-title').innerText().catch(() => '')).trim();
  const listed = await page.locator('[data-testid="commit-changes"]').innerText().catch(() => '');
  await page.locator('[data-testid="commit-note"]').fill(note);   // never type into the editor: letters are shortcuts
  await page.locator('[data-testid="commit-note"]').press('Enter');
  await page.waitForFunction(() => !app.project.commitDraft && !document.querySelector('.commit-dialog'), null, { timeout: 15000 }).catch(() => {});
  await wait(400);
  return { title, listed, entry: index().at(-1) };
}
/** The Commits panel row of an entry, as painted: its section text and whether the section button is there. */
async function row(id) {
  await page.waitForSelector(`[data-testid="history-entry"][data-id="${id}"]`, { timeout: 15000 }).catch(() => {});
  const r = page.locator(`[data-testid="history-entry"][data-id="${id}"]`);
  return { r, scope: (await r.locator('.scope').count()) ? (await r.locator('.scope').innerText()).trim() : '', section: await r.locator('[data-testid="history-restore-section"]').count() };
}

try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 120000 });
  await ev(() => app.project.close());
  for (const f of [proj, stem + '.funscript', stem + '.pawruns']) if (existsSync(f)) rmSync(f);
  if (existsSync(hist)) rmSync(hist, { recursive: true });
  const shots = [[0, 4000], [4000, 8000], [8000, 14000]].map(([s, e]) => ({ start_ms: s, end_ms: e, shots: [{ start_ms: s, end_ms: e }] }));
  writeFileSync(proj, JSON.stringify({ format: 'pawproj', version: 3, media: { path: clip, name: clip.split(/[\\/]/).pop(), durationMs: 14000, fps: 30 }, axes: { stroke: [] }, scenes: shots }));
  await ev(() => { window.__asked = []; const c = app.choose.bind(app); app.choose = (o) => { window.__asked.push(o?.title || '?'); return c(o); }; });
  await ev((p) => app.project.openPaths([p]), proj);
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.doc.scenes?.length === 3, null, { timeout: 60000 });
  await ev(() => app.setMode('refine'));
  await settle();
  // a first commit: the base the next ones are compared with
  const base = await commitByKeys('base');
  ok(base.entry?.kind === 'commit', 'a base commit');

  // 1. shot 2 only
  await keyPoint(4500, '0'); await keyPoint(5000, '9');
  const c1 = await commitByKeys('shot two');
  ok(c1.title === 'Commit: Shot 2', `changes in shot 2 only: the dialog's title "${c1.title}"`);
  ok(/Shot 2:?\s*\+2 points on stroke/.test(c1.listed) && !/Shot [13]|Project/.test(c1.listed), `its list: ${JSON.stringify(c1.listed)}`);
  ok(c1.entry?.kind === 'commit' && c1.entry.scope?.label === 'Shot 2', `the commit's scope in .pawhistory: ${JSON.stringify(c1.entry?.scope)}`);
  await ev(() => app.commands.run('file.history'));
  const r1 = await row(c1.entry?.id);
  ok(r1.scope === 'Shot 2' && r1.section === 1, `the Commits panel row: section "${r1.scope}", the section button ${r1.section ? 'there' : 'missing'}`);

  // 2. three shots
  await keyPoint(1000, '1'); await keyPoint(5500, '5'); await keyPoint(9000, '1');
  const c2 = await commitByKeys('all three');
  ok(c2.title === 'Commit', `changes in three shots: the dialog's title "${c2.title}"`);
  ok(/Shot 1/.test(c2.listed) && /Shot 2/.test(c2.listed) && /Shot 3/.test(c2.listed), `its list: ${JSON.stringify(c2.listed)}`);
  const r2 = await row(c2.entry?.id);
  ok(!c2.entry?.scope && r2.scope === '' && r2.section === 0, `no section on the entry (${JSON.stringify(c2.entry?.scope)}) nor on its row ("${r2.scope}", ${r2.section} section buttons)`);

  // 3. the same over an automatic checkpoint of that state (shots 1 and 3 changed)
  await keyPoint(1200, '2'); await keyPoint(9500, '2');
  const auto = await ev(async () => (await app.project.checkpoint('Before clean'))?.id);
  const c3 = await commitByKeys('over an auto entry');
  ok(c3.entry?.id === auto && c3.entry.kind === 'commit', 'the commit took the automatic entry over');
  const r3 = await row(c3.entry?.id);
  ok(c3.title === 'Commit' && !c3.entry?.scope && r3.scope === '' && r3.section === 0, `no section there either (title "${c3.title}", entry ${JSON.stringify(c3.entry?.scope)}, row "${r3.scope}", ${r3.section} section buttons)`);

  // 4. go back in shot 2 only
  const before = await stroke();
  const out = before.filter((t) => t < 4000 || t >= 8000);
  await (await row(c1.entry?.id)).r.locator('[data-testid="history-restore-section"]').click();
  await page.waitForFunction(() => (app.doc.axes.stroke || []).filter((p) => p.at >= 4000 && p.at < 8000).length === 2, null, { timeout: 15000 }).catch(() => {});
  const now = await stroke();
  ok(JSON.stringify(now.filter((t) => t >= 4000 && t < 8000)) === '[4500,5000]', `shot 2 as committed: ${JSON.stringify(now.filter((t) => t >= 4000 && t < 8000))}`);
  ok(JSON.stringify(now.filter((t) => t < 4000 || t >= 8000)) === JSON.stringify(out), `shots 1 and 3 untouched: ${JSON.stringify(out)}`);
  await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Control+z');
  await settle();
  ok(JSON.stringify(await stroke()) === JSON.stringify(before), `Ctrl+Z took it back (${JSON.stringify(await stroke())})`);
  const asked = await ev(() => window.__asked);
  ok(asked.length === 0, `no choice dialog at any point (${JSON.stringify(asked)})`);
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exit(fails ? 1 : 0);
}
