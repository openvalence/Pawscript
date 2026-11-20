// node dev/tracking-drive.mjs <outDir>  -- drives dev/tracking.html (vite on :5200): ROI, track, flip, bake, undo,
// scenes + describe; screenshots at each step; prints the state it checks.
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto('http://localhost:5200/dev/tracking.html');
await p.waitForTimeout(1500);
const st = () => p.evaluate(() => { const { app, tr } = H; return { trackers: tr.trackers.length, tracker: tr.trackerId, roi: tr.roi, busy: tr.busy, runs: tr.runs.map((r) => r.id), ghosts: app.doc.ghosts.map((g) => `${g.id}:${g.script.length}:${g.visible}`), sel: tr.selectedId, axis: app.script.length, selN: app.doc.selection.ats.size, undo: app.history.undoLabel, score: JSON.stringify(tr.scores[tr.selectedId]?.overall?.f1), error: tr.error, notice: tr.notice }; });
const shot = async (n) => { await p.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n, JSON.stringify(await st())); };
await shot('01-initial');

// ROI: a box set by code (paw-x8we: nothing draws one on the video any more); range 5 s .. 20 s
await p.evaluate(() => { H.tr.roi = { kind: 'box', x: 0.42, y: 0.3, w: 0.13, h: 0.4 }; H.app.doc.range = { t0: 5000, t1: 20000 }; H.app.setView({ start: 3000, span: 20000 }); });
await shot('02-roi');

await p.evaluate(() => (H.FAKE.delay = 40));
await p.keyboard.press('t');
await p.waitForTimeout(1500);
await shot('03-tracking');
await p.waitForFunction(() => !H.tr.busy, null, { timeout: 30000 });
await p.waitForTimeout(600);
await shot('04-tracked');

// flip the scene at the playhead (put playhead at 7 s)
await p.evaluate(() => H.app.player.seek(7000));
await p.keyboard.press('f');
await p.waitForTimeout(800);
await shot('05-flipped');

// paw-x7w7: the run plays live (no Accept); Bake the run, then undo
const before = await p.evaluate(() => H.app.doc.axes.stroke?.length ?? 0);
await p.getByRole('button', { name: 'Bake', exact: true }).first().click();
await p.waitForTimeout(400);
await shot('06-baked');
const after = await p.evaluate(() => H.app.doc.axes.stroke?.length ?? 0);
await p.keyboard.press('Control+z');
await p.waitForTimeout(300);
const undone = await p.evaluate(() => H.app.doc.axes.stroke?.length ?? 0);
console.log('bake: before', before, 'after', after, 'undone', undone, 'live', await p.evaluate(() => H.app.script.length));
await shot('07-undone');

// scenes + describe + tag box
await p.getByRole('button', { name: 'Detect', exact: true }).click();
await p.waitForFunction(() => H.tr.scenes.length > 0 && !H.tr.busy, null, { timeout: 10000 });
await p.locator('.scene').nth(1).getByRole('button', { name: 'describe' }).click();
await p.waitForFunction(() => H.tr.sceneInfo[1]?.describe, null, { timeout: 10000 });
await p.locator('.scene').nth(1).getByRole('button', { name: 'show' }).first().click();
await p.locator('.scene').nth(1).getByRole('button', { name: 'loop' }).click();
await p.waitForFunction(() => H.tr.sceneInfo[1]?.loop, null, { timeout: 10000 });
await p.evaluate(() => H.app.player.seek(6500));
await p.waitForTimeout(400);
await shot('08-scenes');
await p.locator('#panel .tk').evaluate((el) => (el.scrollTop = el.scrollHeight));
await p.waitForTimeout(200);
await shot('09-panel-bottom');

// mask tracker with points, failure path, export
await p.evaluate(() => { H.tr.selectTracker('fake.mask'); H.tr.roi = { kind: 'points', points: [[0.5, 0.5]] }; H.app.doc.range = { t0: 0, t1: 4000 }; H.FAKE.fail = true; });
await p.keyboard.press('t');
await p.waitForFunction(() => !H.tr.busy && H.tr.error, null, { timeout: 10000 });
await p.locator('#panel .tk').evaluate((el) => (el.scrollTop = 0));
await shot('10-failed');
await p.keyboard.press('t');
await p.waitForTimeout(300);
await p.keyboard.press('Escape');
await p.waitForFunction(() => !H.tr.busy, null, { timeout: 10000 });
console.log('after cancel', JSON.stringify(await st()));
await p.keyboard.press('t');
await p.waitForFunction(() => !H.tr.busy && H.tr.runs.filter((r) => r.tag !== 'camera').length === 2 && !H.tr.live, null, { timeout: 20000 });
await p.evaluate(() => H.app.player.seek(1300));
await p.waitForTimeout(500);
await shot('11-mask');
const exp = await p.evaluate(async () => { const f = await H.tr.exportGhost(); const g = await H.tr.exportGhost(); return [f, g, [...H.app.backend.files.keys()]]; });
console.log('export', JSON.stringify(exp));
await b.close();
