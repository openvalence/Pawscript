// paw-9qm: the signal row under the run in the real store and lane (Playwright + Edge headless, dev/shell.html on the mock
// backend): the source picker (Fused first, the old motion groups last), Pair by two clicks (one undo step), measured
// against, a range override added (paw-hiq5: drawn by a drag in the row's band) drawn as a segment (an end dragged, Delete removes it, undo brings it back);
// no g1..g4 chips anywhere (paw-57dw: the sidecar sends no motion-group channels). Own Vite server on a free port.
// Skipped unless SIGNAL_E2E=1:  SIGNAL_E2E=1 node --test test/signal-row-e2e.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runCtl } from '../dev/run-bar.mjs';   // paw-k8pe: on the Track tab the row is the lane toolbar's (its tail in a … popover)

const ON = process.env.SIGNAL_E2E === '1';
const root = fileURLToPath(new URL('..', import.meta.url));

describe('signal row e2e', { skip: !ON && 'set SIGNAL_E2E=1 to run the browser checks' }, () => {
  let server, browser, page;
  const errs = [], res = {};
  before(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ root, logLevel: 'error', cacheDir: process.env.VITE_CACHE_DIR || undefined, server: { port: Number(process.env.SIGNAL_E2E_PORT) || 20000 + Math.floor(Math.random() * 20000), strictPort: true, hmr: false, ws: false, watch: null } });
    await server.listen();
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
    page.on('pageerror', (e) => errs.push(e.message));
  });
  after(async () => { await browser?.close(); await server?.close(); });

  test('source, pair, against, a range override; undo; no g1..g4 chips', async () => {
      await page.goto(server.resolvedUrls.local[0] + 'dev/shell.html?mode=track');
      await page.waitForFunction(() => window.app?.doc);
      await page.evaluate(async () => {
        const R = await import('/src/lib/runs.js'), T = await import('/src/features/tracking/tracking.svelte.js'), S = await import('/src/features/timeline/state.svelte.js');
        const fx = await (await fetch('/test/fixtures/rederive-run.json')).json();
        const tr = T.trackingFor(window.app), c = fx.auto.channels;
        app.doc.media = { ...app.doc.media, width: 1920, height: 1080 };
        app.doc.scenes = [{ start_ms: 0, end_ms: 8000 }, { start_ms: 8000, end_ms: 14000 }];
        // painted parts for two characters (from the fixture's bodies)
        for (const [to, from, dy] of [['sem_c1_hips', 'who_c1', 0], ['sem_c2_hips', 'who_c2', 0], ['sem_c1_penis', 'who_c1', 0.03]]) {
          c[to + '_x'] = c[from + '_x'].map(([t, v]) => [t, v == null ? null : v + 0.01]);
          c[to + '_y'] = c[from + '_y'].map(([t, v]) => [t, v == null ? null : v + dy]);
          c[to + '_n'] = c[from + '_n'];
        }
        const notes = [0, 1].map((k) => ({ code: 'primary', scene_index: k, message: 'proj', data: { chosen: 'proj' } }));
        const run = R.makeRun({ n: 7, tracker: { id: 'cotracker_points', name: 'CoTracker3' }, params: fx.auto.params, range: { start: 0, end: 14000 }, roi: null,
          result: { samples: c.proj, points: [{ at: 100, pos: 0 }, { at: 7000, pos: 100 }], scenes: fx.scenes.map((s) => ({ ...s, sign: 1 })), channels: c, notes }, frames: R.newFrames(), runs: [] });
        const RC = await import('/src/lib/runs-channel.js');
        run.points = run.points0 = RC.pointsFromChannel(run, 'proj');
        tr.runs = [run];
        app.doc.ghosts = [...(app.doc.ghosts || []), tr.ghostOf(run)];
        tr.select(run.id);
        S.setSel?.({ active: 0, shots: [0] });
        window.TR = tr; window.RID = run.id;
        app.setView({ start: 0, span: 14000 });
        window.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
      });
      await runCtl(page);
      await page.waitForSelector('.pick .src', { timeout: 8000 });
      const lane = page.locator('[data-tracklane]').first();
      res.row = await page.locator('.pick').first().innerText();
      // 1. the source picker: sections, the old groups last; pick Fused
      await page.locator('.pick .src').click();
      await page.waitForSelector('[role=menu]');
      res.menu = await page.locator('[role=menu]').first().innerText();
        const n0 = await page.evaluate(() => app._history.index);
      await page.getByRole('menuitemradio', { name: /^Fused/ }).click();
      await page.waitForTimeout(200);
      res.fused = await page.evaluate((n0) => ({ derive: (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive), entries: app._history.index - n0, btn: document.querySelector('.pick .src').textContent, state: TR.signalState(3000)?.source, weights: Object.keys(TR.signalState(3000)?.fusion?.weightsAt || {}).length }), n0);
      // 2. Pair: two clicks in the popover
      await runCtl(page); await page.locator('.pick button', { hasText: /Pair/ }).click();   // (a string matches the depth chip pair too)
      await page.waitForSelector('.pairpop');
        await page.locator('.pairpop .chip', { hasText: 'Bottom penis' }).click();
      await page.locator('.pairpop .chip', { hasText: 'Top hips' }).click();
      await page.waitForTimeout(200);
      res.pair = await page.evaluate(() => ({ derive: (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive), derive1: (app.doc.scenes[1].derives?.[RID] ?? app.doc.scenes[1].derive) ?? null, row: document.querySelector('.pick').innerText, state: TR.signalState(3000)?.pair, ghost: (TR.ghost(RID).script || []).length }));
      await page.evaluate(() => app.undo()); await page.waitForTimeout(100);
      res.pairUndo = await page.evaluate(() => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.source ?? null);
    // the overlay's flow (paw-ufv): pairPick, then two tracker clicks
    res.pick = await page.evaluate(async () => { TR.pairPick = { first: '', span: null }; const one = TR.pickPairPart('sem_c2_hips'); TR.pickPairPart('sem_c1_hips'); await sleep(50); const out = { one, src: (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.source, pick: TR.pairPick }; app.undo(); await sleep(50); return out; });
      // 3. against: none
      await runCtl(page); await page.locator('.pick button', { hasText: /^vs / }).click();
      await page.getByRole('menuitemradio', { name: /^None/ }).click();
      await page.waitForTimeout(150);
      res.against = await page.evaluate(() => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive));
      // 4. a range inside the run: the picker sets an override there; the segment shows; Delete removes it
      await page.evaluate(() => { TR.addSignalSpan(2000, 5000); });   // paw-hiq5: the I-O range is no longer the target; the span is drawn / added
      await page.waitForTimeout(100);
      res.rangeLabel = await page.locator('[data-testid="run-chip"]').innerText();
      await runCtl(page); await page.locator('.pick .src').click();
      await page.getByRole('menuitemradio', { name: /^Fused/ }).click();
      await page.waitForTimeout(200);
      res.span = await page.evaluate(() => ({ fact: app.doc.scenes[0].signal, spans: TR.signalSpans, segs: document.querySelectorAll('.ovr').length }));
      await page.evaluate(() => { app.doc.range = null; });
      await page.waitForTimeout(100);
      // drag its right end to ~6 s
      const h = await lane.locator('.ovr .ovh.r').first().boundingBox(), cv = await lane.locator('canvas').first().boundingBox();
      const view = await page.evaluate(() => app.view), x6 = cv.x + ((6000 - view.start) / view.span) * cv.width;
      await page.mouse.move(h.x + 3, h.y + 5); await page.mouse.down(); await page.mouse.move(x6, h.y + 5, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(200);
      res.dragged = await page.evaluate(() => ({ spans: TR.signalSpans.map((s) => [s.t0, s.t1]), preview: TR.signalPreview, stored: app.doc.scenes[0].signal }));
      await lane.locator('.ovr .ovb').first().click();
      await page.keyboard.press('Delete');
      await page.waitForTimeout(150);
      res.deleted = await page.evaluate(() => ({ spans: TR.signalSpans.length, segs: document.querySelectorAll('.ovr').length }));
      await page.evaluate(() => app.undo()); await page.waitForTimeout(100);
      res.deleteUndo = await page.evaluate(() => TR.signalSpans.length);
      // 5. g1..g4: none in the Tracker panel legend or the Shot popover
      res.gChips = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^g[1-4]( \d+%)?$/.test(b.textContent.trim())).length);
      assert.deepEqual(errs, []);
    assert.match(res.menu, /Fused[\s\S]*PARTS/i, 'Fused first, then the parts');
    assert.doesNotMatch(res.menu, /OLD MOTION GROUPS/i, 'no old motion groups submenu');
    assert.deepEqual(res.fused, { derive: { source: 'fused' }, entries: 1, btn: 'Fused ▾', state: 'fused', weights: res.fused.weights });
    assert.ok(res.fused.weights > 0, 'the fusion weights at t (signalState)');
    assert.deepEqual(res.pair.derive, { source: 'rel:sem_c1_penis:sem_c2_hips' });
    assert.deepEqual(res.pair.state, { a: 'sem_c1_penis', b: 'sem_c2_hips' });
    assert.equal(res.pairUndo, 'fused', 'the pair is one undo step');
    assert.deepEqual(res.pick, { one: true, src: 'rel:sem_c2_hips:sem_c1_hips', pick: null });
    assert.deepEqual(res.against, { source: 'fused', against: 'none' });
    assert.match(res.rangeLabel, /0:02\.0.0:05\.0/);
    assert.deepEqual(res.span.fact, { spans: [{ t0: 2000, t1: 5000, source: 'fused' }] });
    assert.deepEqual(res.dragged, { spans: [[2000, 6000]], preview: null, stored: { spans: [{ t0: 2000, t1: 6000, source: 'fused' }] } });
    assert.equal(res.deleted.spans, 0);
    assert.equal(res.deleteUndo, 1);
    assert.equal(res.gChips, 0);
  });
});
