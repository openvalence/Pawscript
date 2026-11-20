// dev/fusion-pad-check.mjs -- paw-iasp: the fusion pad on the Tracker row and the fusion panel in the REAL window (your test
// instance: node dev/test-app.mjs start ...; CDP_* env). A synthetic fellatio run (test/fusion-synth.mjs: the Bottom head
// bobs on the Top penis while both bodies rock) linked to 'fused'. It asserts
//   1. the pad shows beside the source chip while the signal is fused; a drag from it re-fuses live (the trace changes, no
//      history while dragging, the large labelled view shows), the release is one undo step and stores derive.fuse.pad;
//      double-click = centre (one step); the cost of one drag step (compute until the run is recomposed, and until painted);
//   2. inside a range override the pad edits the override, not the shot;
//   3. the panel (Adjust) lists bodies and relationships; dragging a weight re-fuses; reset brings it back.
//   SHOT_DIR=<dir> node dev/fusion-pad-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';   // paw-k8pe: on the Track tab the row is the lane toolbar's (its tail in a … popover)
import { CASES } from '../test/fusion-synth.mjs';

const shots = process.env.SHOT_DIR || null;
const sc = CASES.find((c) => c.id === 'fellatio-head').make();
const chans = Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await page.evaluate((chans) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080 };
    app.doc.scenes = [{ start_ms: 0, end_ms: 20000, tags: ['oral', 'penetration'] }];
    const T = chans.who_pair_proj.map(([t]) => t);
    const run = D.makeRun({ n: 7, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: 20000 }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: chans, notes: [] },
      frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    app.setView({ start: 0, span: 20000 });
    window.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    window.sig = () => JSON.stringify((TR.ghost(RID).script || []).map((p) => [p.at, p.pos]));
    window.trace = () => JSON.stringify(Array.from(TR.run(RID)?.lane?.v || [], (x) => (x === x ? Math.round(x * 1e6) : null)));   // the Tracker row's trace (paw-o60v.2: live while dragging; the points follow at a rest)
    window.hist = () => app._history.index;
    tr.linkScene(0, run.id, 'fused');
  }, chans);
  await page.evaluate(() => app.player.seek(5000));
  await runCtl(page);
  await page.waitForSelector('[data-testid="fuse-pad"]', { timeout: 10000 });
  ok(true, 'the pad shows beside the source chip (signal fused)');
  ok(/nudge/.test(await page.locator('[data-testid="fuse-pad"]').innerText()), 'at rest it says "nudge" (centre = the automatic choice)');
  const auto = await page.evaluate(() => TR.fuseInfo(0)?.auto);
  ok(!!auto && (await page.locator('[data-testid="fuse-pad"] .auto').count()) === 1, `the faint ring marks the automatic choice ${JSON.stringify(auto)}`);

  // ---- the cost of one drag step: until the run is recomposed (applyRunPatch), and until the next paint ----
  const cost = await page.evaluate(async () => {
    const out = [], paint = [];
    let done = 0;
    const orig = TR.applyRunPatch.bind(TR);
    TR.applyRunPatch = (...a) => { const x = orig(...a); done = performance.now(); return x; };
    for (let k = 0; k < 24; k++) {
      done = 0;
      const t0 = performance.now();
      TR.setFuse(0, { pad: { x: Math.round(60 * Math.sin(k / 3)) / 100, y: Math.round(60 * Math.cos(k / 4)) / 100 } }, { commit: false, run: RID });
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      out.push(done ? done - t0 : NaN); paint.push(performance.now() - t0);
    }
    TR.applyRunPatch = orig; TR.derivePreview = null;
    const med = (a) => a.filter((x) => x === x).sort((x, y) => x - y)[a.length >> 1];
    return { compute: med(out), computeMax: Math.max(...out.filter((x) => x === x)), toPaint: med(paint), n: out.filter((x) => x === x).length };
  });
  console.log(`info one drag step: ${cost.compute.toFixed(1)} ms to recompose (max ${cost.computeMax.toFixed(1)}), ${cost.toPaint.toFixed(1)} ms to the second frame after it (${cost.n} steps)`);
  ok(cost.n >= 20 && cost.compute < 30, 'a drag step recomposes the run in well under a frame budget');
  await page.waitForTimeout(300);

  // ---- 1. a real drag ----
  const pad = page.locator('[data-testid="fuse-pad"]');
  await runCtl(page);
  const b = await pad.boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const s0 = await page.evaluate(() => sig()), h0 = await page.evaluate(() => hist()), tr0 = await page.evaluate(() => trace());
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(cx + k * 9, cy - k * 4); await page.waitForTimeout(40); }
  ok((await page.evaluate(() => trace())) !== tr0, 'the trace re-fuses live while the pointer moves');
  await page.waitForTimeout(250);
  const mid = await page.evaluate(() => ({ sig: sig(), hist: hist(), view: !!document.querySelector('.padview'), pv: TR.derivePreview?.derive?.fuse?.pad || null }));
  ok(mid.view, 'while dragging the large labelled view shows');
  ok(mid.hist === h0 && !!mid.pv, `no history while dragging, the preview carries the pad ${JSON.stringify(mid.pv)}`);
  ok(mid.sig !== s0, 'the pointer resting: the points follow (the ghost changed before the release)');
  if (shots) await page.screenshot({ path: shots + '/pad-drag.png' });
  if (shots) await page.locator('.padview').screenshot({ path: shots + '/pad-view.png' });
  await page.mouse.up(); await page.waitForTimeout(400);
  const d1 = await page.evaluate(() => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.fuse || null);
  ok((await page.evaluate(() => hist())) - h0 === 1, 'the release is one undo step');
  ok(d1?.pad && d1.pad.x > 0.4 && d1.pad.y > 0.15, `stored on the shot for this run: ${JSON.stringify(d1)}`);
  ok(/abs 0\.\d · ext 0\.\d/.test(await pad.innerText()), `the chip reads it: "${await pad.innerText()}"`);
  const mix = await page.evaluate(() => TR.fuseInfo(0)?.mix);
  ok(mix && mix.x > auto.x, `the mix moved toward absolute (auto ${auto.x} -> ${mix?.x})`);
  if (shots) await page.locator('.pick').first().screenshot({ path: shots + '/pad-strip.png' });
  await page.evaluate(() => app.undo()); await page.waitForTimeout(300);
  ok((await page.evaluate(() => sig())) === s0, 'undo brings the trace back exactly');
  await page.evaluate(() => app.redo()); await page.waitForTimeout(300);
  const h1 = await page.evaluate(() => hist());
  await runCtl(page); await pad.dblclick(); await page.waitForTimeout(400);
  const d2 = await page.evaluate(() => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.fuse?.pad || null);
  ok(d2 === null && /nudge/.test(await pad.innerText()), 'double-click = back to centre');
  ok((await page.evaluate(() => hist())) - h1 >= 1, 'centre is undoable');
  ok((await page.evaluate(() => sig())) === s0, 'centre = the automatic trace again');

  // ---- 2. inside a range override the pad edits the override ----
  await page.evaluate(() => { TR.addSignalSpan(8000, 14000); app.player.seek(10000); }); await page.waitForTimeout(400);
  await runCtl(page);
  ok(/range/.test(await page.locator('.pick').first().innerText()), 'the row says it edits the range override');
  await runCtl(page);
  const b2 = await pad.boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.mouse.down();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(b2.x + b2.width / 2 - k * 10, b2.y + b2.height / 2 + k * 5); await page.waitForTimeout(30); }
  await page.mouse.up(); await page.waitForTimeout(400);
  const ov = await page.evaluate(() => ({ spans: TR.signalSpans, shot: (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.fuse?.pad || null }));
  ok(ov.spans.length === 1 && ov.spans[0].fuse?.pad?.x < -0.3 && ov.shot === null, `the override got the pad, the shot did not: ${JSON.stringify(ov)}`);
  if (shots) await page.locator('.stack').first().screenshot({ path: shots + '/pad-override.png' });   // the lane stack: the run's row (toolbar) and the lane
  await page.evaluate(() => { TR.setSpan(TR.signalSpans[0], null); TR.sigSel = null; app.player.seek(5000); }); await page.waitForTimeout(300);

  // ---- 3. the panel ----
  const panel = page.locator('[data-testid="fuse-panel"]');
  if (await panel.count()) {
    await panel.scrollIntoViewIfNeeded();
    const txt = await panel.innerText();
    ok(/Bottom/.test(txt) && /Top/.test(txt) && /head/.test(txt), 'the panel lists the bodies and their parts');
    ok(/oral\+penetration|fellatio|scene/i.test(txt), 'the scene type\'s contribution is shown');
    if (shots) await panel.screenshot({ path: shots + '/fuse-panel.png' });
    const row = panel.locator('[data-testid="fuse-rel"]').first(), wb = await row.locator('.wt').boundingBox();
    const s1 = await page.evaluate(() => sig()), h2 = await page.evaluate(() => hist()), t1 = await page.evaluate(() => trace());
    await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await page.mouse.down();
    for (let k = 1; k <= 6; k++) { await page.mouse.move(wb.x + wb.width / 2 - k * 12, wb.y + wb.height / 2); await page.waitForTimeout(30); }
    const midSig = await page.evaluate(() => trace());
    await page.mouse.up(); await page.waitForTimeout(400);
    const w = await page.evaluate(() => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.fuse?.w || null);
    ok(midSig !== t1, 'dragging a relationship\'s weight re-fuses live (the trace)');
    ok((await page.evaluate(() => sig())) !== s1, '... and the points follow on release');
    ok(w && Object.values(w)[0] < 1 && (await page.evaluate(() => hist())) - h2 === 1, `stored as its own weight, one undo step: ${JSON.stringify(w)}`);
    const changed = panel.locator('[data-testid="fuse-rel"]:has(.wt.changed)');   // (the rows re-sort by share: find it again)
    ok((await changed.count()) === 1, 'the changed value is marked');
    if (shots) await panel.screenshot({ path: shots + '/fuse-panel-changed.png' });
    await changed.locator('button.reset').click(); await page.waitForTimeout(400);
    ok((await page.evaluate(() => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.fuse?.w || null)) === null && (await page.evaluate(() => sig())) === s1, 'its reset brings it and the trace back');
  } else console.log('info no panel (stage 3 not in this build)');
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exit(fails ? 1 : 0);
}
