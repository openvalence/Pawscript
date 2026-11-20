// dev/seeder-app-check.mjs -- the learned seeder's Groups toolbar in YOUR test instance (node dev/test-app.mjs start ...,
// then the CDP_* env it prints; the fake sidecar answers suggest_groups / seed_train as v4.18). Opens <video>, makes two
// scenes, opens the Groups tool near the start, Suggest (the third candidate wins: the groups land there, the toolbar
// says so), checks what is painted (confidence bars, a tentative suggestion), ✓ / ✕ / Enter, Retrain.
//   node dev/seeder-app-check.mjs <video> [out.png]
import { connectTestApp } from './cdp-connect.mjs';

const [video, shot] = process.argv.slice(2);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
  await ev((v) => app.project.openVideo(v), video);
  await page.waitForFunction(() => app.doc.media && app.player.durationMs > 0, null, { timeout: 30000 });
  // 231f888 (paw-r6t0): suggestions under the shown confidence (default 0.8) are held back: at its minimum all three are listed as before
  await ev(() => { app.setMode('track'); app.doc.scenes = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: app.player.durationMs }]; app.player.seek(4500); app.settings.set('tracking.seeder.folders', ['C:/nowhere']); app.settings.set('tracking.suggest.confidence', 0.3); });
  await wait(800);
  await page.keyboard.press('Tab'); await wait(600);
  ok(await page.locator('[data-testid="groups-tools"]').isVisible(), 'Tab opens the Groups toolbar in the real window');
  // 6543984: the Seeder line is in the bar's options popover; 1c58a39: its numbers are in the line's hover / click-open text
  // (textContent: the folded <details> too)
  const seeder = async () => { if (!(await page.locator('[data-testid="groups-seeder"]').count())) { await page.click('[data-testid="groups-options"]'); await wait(300); } return (await page.locator('[data-testid="groups-seeder"]').textContent()).replace(/\s+/g, ' '); };
  const closePop = async () => { await page.keyboard.press('Escape'); await wait(200); };
  const seedRow = await seeder(); await closePop();
  ok(/not trained yet/.test(seedRow), `the Seeder line before any training: "${seedRow.trim().slice(0, 120)}"`);
  const t0 = await ev(() => app.player.timeMs);
  await page.getByRole('button', { name: 'Suggest' }).click();
  await page.waitForFunction(() => (app.doc.scenes[1].groups || []).length > 0, null, { timeout: 20000 });
  await wait(500);
  ok(Math.abs((await ev(() => app.player.timeMs)) - t0) < 1, 'Suggest did not move the playhead');
  // 6543984: the frame notice lives in the notes card beside the bar (it opens by itself)
  const notice = (await page.locator('[data-testid="groups-frame"]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok(/Suggest picked/.test(notice) && /5 parts vs 3/.test(notice), `the toolbar names the picked frame: "${notice}"`);
  ok(/learned from 29 painted frames/.test(await seeder()), 'the Seeder line takes Suggest\'s record'); await closePop();
  await page.locator('[data-testid="groups-frame"]').getByRole('button', { name: 'Go there' }).click(); await wait(600);
  ok(!(await page.locator('[data-testid="groups-frame"]').isVisible().catch(() => false)), 'Go there: the playhead stands on the picked frame (the off-frame notice is gone)');
  // paw-o74b (351c001): the list is the frame on screen's groups (the picked frame's now); 6543984: a popover on the bar
  await page.click('[data-testid="groups-list-open"]'); await wait(400);
  const n = await page.locator('[data-testid="groups-list"] .grp.sug').count(), bars = await page.locator('[data-testid="groups-list"] .conf').count(), tent = await page.locator('[data-testid="groups-list"] .conf.tent').count();
  ok(n === 3 && bars === 3 && tent === 1, `3 suggestions with confidence bars, 1 tentative (${n} / ${bars} / ${tent})`);
  if (shot) await page.screenshot({ path: shot });
  await page.getByRole('button', { name: 'Accept Bottom head' }).click(); await wait();
  await page.getByRole('button', { name: 'Delete Top tail' }).click(); await wait();
  await closePop();
  const gs = await ev(() => { const s = app.doc.scenes[1]; return (s.groups || []).map((g) => g.name + ':' + g.source); });
  ok(gs.includes('c1_head:user') && !gs.some((x) => x.startsWith('c2_tail')) && gs.includes('c1_penis:tagger'), `✓ / ✕ in the real window (${gs})`);
  // d30130c (paw-855t): Retrain trains the active seeder dataset (v2 for a new profile) on its labelled pictures, projects only
  // when it learns from them: that on, and two (synthetic) labels in this test instance's dataset; the fake sidecar answers
  // the dataset's record from its label count (head.json), as the real one does
  const labels = await ev(async () => {
    const D = window.__pawDev.groupsFor(app).datasets; await D.ready(); await D.setProjects(D.reg.active, true);
    const i = D.infoOf(D.reg.active); await app.backend.makeDir(i.labels);
    for (const n of ['a', 'b']) await app.backend.writeText(i.labels + '/' + n + '.json', '{}');
    return i.labels;
  });
  await seeder();
  await page.getByRole('button', { name: /Retrain the seeder/ }).click();
  await page.waitForFunction(() => /2 painted/.test(document.querySelector('[data-testid="groups-seeder"]')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  const after = await seeder();
  ok(/learned from 2 painted frames/.test(after), `Retrain through the real sidecar bridge updates the Seeder line (labels in ${labels}): "${after.slice(0, 140)}"`);
  ok(!errs.length, `no console errors (${errs.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
