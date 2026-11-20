// dev/runsel-check.mjs -- paw-xyu9: selecting runs and editing a run's settings in the REAL window (your test instance:
// node dev/test-app.mjs start ...; CDP_* env). Three runs on a 2-shot doc: run1 + run3 both cover shot A (a re-track,
// same tracker), run2 (another tracker) covers it too. Run ranges (paw-1ysd, a10024d): run1 plays 0-4 s, run3 4-8 s, run2
// 8-14 s. For every entry point to a selection (the Runs list, the store's select, the playhead moving to another shot) it
// asserts  selected = highlighted in Runs = the run the Tracker row's picker is about, and that Adjust (its header names the
// run) edits the run whose RANGE plays there whatever is selected ("selecting a run in Runs only selects"); then it picks
// each range on shot A, edits that run's camera mode / stroke axis in the Adjust strip and diffs every other run's stored
// settings and drawn points before / after (nothing may move).
//   node dev/runsel-check.mjs
import { readFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const fx = JSON.parse(readFileSync(new URL('../test/fixtures/rederive-run.json', import.meta.url), 'utf8'));
const { browser, page } = await connectTestApp();
// paw-p8o2: the shot's Adjust strip lives only in the band under the stroke lane: unfold it (its ▾) when it is folded
// (its ▾ is disabled until the band has a run to show: wait for it, else the click is lost and the strip never opens)
const openBand = async () => {
  await page.waitForSelector('[data-testid="inspector-more"]:not([disabled])', { timeout: 15000 });
  await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); });
  await page.waitForSelector('[data-testid="derive-strip"]', { timeout: 10000 });
};
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
try {
  await page.reload();   // clean state on every run
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await page.evaluate((fx) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');   // a rerun starts clean
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080 };
    app.doc.scenes = [{ start_ms: 0, end_ms: 8000 }, { start_ms: 8000, end_ms: 14000 }];
    for (const k of ['g3_n', 'g4_n']) fx.auto.channels[k] = fx.auto.channels.g1_n.map(([t]) => [t, 0]);
    const mk = (n, name) => {
      const notes = [0, 1].map((k) => ({ code: 'primary', scene_index: k, message: 'proj', data: { chosen: 'proj' } }));
      const run = D.makeRun({ n, tracker: { id: name === 'CoTracker3' ? 'cotracker_points' : 'tapnext_points', name }, params: fx.auto.params, range: { start: 0, end: 14000 }, roi: null,
        result: { samples: fx.auto.channels.proj, points: [{ at: 100, pos: 0 }, { at: 7000, pos: 100 }, { at: 9000, pos: 0 }, { at: 13000, pos: 100 }], scenes: fx.scenes.map((s) => ({ ...s, sign: 1 })), channels: fx.auto.channels, notes },
        frames: D.newFrames(), runs: tr.runs });
      run.points = run.points0 = D.pointsFromChannel(run, 'proj');
      tr.runs = [...tr.runs, run];
      app.doc.ghosts = [...(app.doc.ghosts || []), tr.ghostOf(run)];
      return run.id;
    };
    window.IDS = [mk(1, 'CoTracker3'), mk(2, 'TAPNext'), mk(3, 'CoTracker3')];
    app.doc.runRanges = [{ id: 'rr1', run: IDS[0], t0: 0, t1: 4000, layer: 0 }, { id: 'rr3', run: IDS[2], t0: 4000, t1: 8000, layer: 0 }, { id: 'rr2', run: IDS[1], t0: 8000, t1: 14000, layer: 0 }];
    window.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    window.sig = (id) => JSON.stringify((TR.ghost(id).script || []).map((p) => [p.at, p.pos]));
  }, fx);
  const ids = await page.evaluate(() => IDS);
  await page.evaluate(() => app.player.seek(2000));
  await page.waitForSelector('.ghost', { timeout: 10000 });
  await page.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if (/^all runs/.test(b.textContent.trim()) && b.getAttribute('aria-pressed') !== 'true') b.click(); }); });
  await page.waitForTimeout(300);
  await openBand();

  const state = () => page.evaluate(() => {
    const sel = document.querySelectorAll('.ghost.sel');
    const head = document.querySelector('[data-testid="derive-strip"] .head .k-caps')?.textContent || '';
    const r = TR.deriveRun(TR.currentScene);
    return { selectedId: TR.selectedId, highlighted: [...sel].map((e) => e.querySelector('.nm')?.textContent), head, edits: r?.id, signalRun: TR.signalRun?.id };
  });
  const titleOf = (id) => page.evaluate((i) => TR.titleOf(TR.run(i)), id);
  // adj = the run whose range plays at the playhead: Adjust follows the ranges, not the selection
  const agree = async (id, via, adj = ids[0]) => {
    const s = await state(), title = await titleOf(id), adjTitle = await titleOf(adj);
    ok(s.selectedId === id && s.highlighted.length === 1 && s.highlighted[0] === title && s.signalRun === id,
      `${via}: selected ${s.selectedId} = highlighted ${JSON.stringify(s.highlighted)} = row run ${s.signalRun}`);
    ok(s.edits === adj && s.head.includes(adjTitle), `${via}: Adjust edits the range's run ${adj}: ${s.edits} ("${s.head.trim()}")`);
  };

  // ---- selection from each entry point, in an order that crosses runs both ways ----
  for (const id of [ids[0], ids[2], ids[1], ids[2], ids[0]]) {
    const title = await titleOf(id);
    await page.locator('.ghost', { has: page.locator('.nm', { hasText: title }) }).locator('.gname').first().click();
    await page.waitForTimeout(150);
    await agree(id, 'list click ' + id);
  }
  for (const id of [ids[2], ids[0]]) { await page.evaluate((i) => TR.select(i), id); await page.waitForTimeout(100); await agree(id, 'store select ' + id); }
  // the playhead moves to shot B and back: the selection stays, Adjust edits the run whose range plays there
  await page.evaluate((i) => TR.select(i), ids[2]);
  await page.evaluate(() => app.player.seek(9000)); await page.waitForTimeout(250);
  await agree(ids[2], 'playhead in shot B', ids[1]);
  await page.evaluate(() => app.player.seek(2000)); await page.waitForTimeout(250);
  await agree(ids[2], 'playhead back in shot A');

  // ---- editing: each run's own settings, nothing else moves ----
  const pts = () => page.evaluate((ids) => Object.fromEntries(ids.map((i) => [i, sig(i)])), ids);
  const strip = page.locator('[data-testid="derive-strip"]');
  await page.evaluate(() => app.settings.set('tracking.panel.open', { ...(app.settings.get('tracking.panel.open', {}) || {}), camera: true }));   // paw-r73w: the camera mode is in its fold
  for (const id of [ids[0], ids[2]]) {
    await page.evaluate((i) => { TR.select(i); TR.rangeSel = app.doc.runRanges.find((r) => r.run === i).id; }, id); await page.waitForTimeout(200);
    ok((await page.evaluate(() => TR.deriveRun(0)?.id)) === id, `run ${id}: its range picked, Adjust edits it`);
    const other = ids.filter((i) => i !== id), before = await pts(), dv = () => page.evaluate((other) => other.map((i) => JSON.stringify(TR.shotDerive(0, i))), other), dv0 = await dv();
    await strip.getByRole('radio', { name: 'off', exact: true }).first().click();            // camera removal: off
    await page.waitForTimeout(400);
    const after = await pts(), own = await page.evaluate((i) => TR.shotDerive(0, i)?.cam?.mode, id);
    ok(own === 'off', `run ${id}: camera mode off stored on its own entry`);
    ok(other.every((i) => after[i] === before[i]), `run ${id}: camera mode left ${other.join(', ')} drawn points untouched`);
    ok(JSON.stringify(await dv()) === JSON.stringify(dv0), `run ${id}: camera mode did not change ${other.join(', ')}'s settings`);
    await strip.getByRole('radio', { name: 'vert', exact: true }).first().click();       // stroke axis vertical
    await page.waitForTimeout(400);
    ok(JSON.stringify(await dv()) === JSON.stringify(dv0), `run ${id}: stroke axis did not change ${other.join(', ')}'s settings`);
  }
  ok(await page.evaluate(() => Object.keys(app.doc.scenes[0].derives || {}).sort().join() === [IDS[0], IDS[2]].sort().join() && !app.doc.scenes[0].derive), 'only the two edited runs have an entry on shot A');
  console.log(fails ? `FAILED: ${fails}` : 'all ok');
} finally { await browser.close().catch(() => {}); }
process.exit(fails ? 1 : 0);
