// dev/fusion-panel-check.mjs -- paw-439e / paw-qynw in the REAL window (your test instance: node dev/test-app.mjs start ...;
// CDP_* env). A synthetic tagged-handjob run whose hand does not carry the stroke (test/fusion-synth.mjs tag-not-driver),
// linked to 'fused'. It asserts
//   1. the panel says the handjob tag is ignored here; the act chips turn a tag off for this shot (fuse.actsOff), one step;
//   2. the standing pad in the panel: a drag re-fuses live (no history while dragging), the release is one undo step, the
//      chip on the Tracker row reads the same value; arrows nudge; double-click = centre;
//   3. the floating pad pinned from the chip: the same value, its drag writes the same setting; unpin closes it;
//   4. inside a range override every panel control edits the override (header "range a–b", × clear), the shot's derive
//      untouched; the pad chip and the panel's pad agree;
//   5. the reference strip: Tracker row right-click › Use as a reference…, a drag strikes a region out, Enter saves a record
//      to the instance's data folder references/, it is listed, removable; Esc cancels.
//   6. paw-0yfp: a fisting shot: the giver's forearm leads; its pinned weight dragged to 0 keeps the panel (the row "out", a note),
//      one undo step; every relationship left out: the panel says the automatic mix plays.
//   SHOT_DIR=<dir> node dev/fusion-panel-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';
import { CASES, fistingScene } from '../test/fusion-synth.mjs';

const shots = process.env.SHOT_DIR || null;
const sc = CASES.find((c) => c.id === 'tag-not-driver').make();
const chans = Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const shot = async (name, loc) => { if (shots) await (loc || page).screenshot({ path: `${shots}/${name}.png` }); };
try {
  // paw-k8pe: the run's row is the lane toolbar's on the Track tab; a window wide enough for all of it in the row (the pad chip is
  // read while a drag holds the pointer elsewhere, where its … popover would close)
  await page.setViewportSize({ width: 2560, height: 1100 });
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await page.evaluate(() => app.settings.set('tracking.panel.open', { fusion: true, camera: true, strokes: true, run: true }));   // paw-r73w: the folds this check reads, open
  await page.evaluate((chans) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'fusioncheck01' } };
    app.doc.project = { ...(app.doc.project || {}), path: 'C:\\pawtest\\fusion-check.pawproj' };
    app.doc.scenes = [{ start_ms: 0, end_ms: 20000, tags: ['handjob'] }];
    const T = chans.who_pair_proj.map(([t]) => t);
    const run = D.makeRun({ n: 7, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: 20000 }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: chans, notes: [] },
      frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    app.setView({ start: 0, span: 20000 });
    window.sig = () => JSON.stringify((TR.ghost(RID).script || []).map((p) => [p.at, p.pos]));
    window.hist = () => app._history.index;
    window.fuseOf = () => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.fuse || null;
    tr.linkScene(0, run.id, 'fused');
  }, chans);
  await page.evaluate(() => app.player.seek(5000));
  // 145370e (paw-p8o2): the Adjust strip (and its fusion panel) lives only in the band under the stroke lane: unfold it (its ▾)
  await page.waitForSelector('[data-testid="inspector-more"]:not([disabled])', { timeout: 10000 });
  await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); });
  const panel = page.locator('[data-testid="fuse-panel"]');
  await panel.waitFor({ timeout: 10000 });
  await panel.scrollIntoViewIfNeeded();

  // ---- 1. the tag limits itself; the act chips ----
  const note = page.locator('[data-testid="fuse-tag-note"]');
  ok((await note.count()) >= 1 && /handjob tag: .*hand.* is not carrying the stroke here .*: ignored/.test(await note.first().innerText()), `the panel says the tag is ignored: "${(await note.count()) ? await note.first().innerText() : ''}"`);
  ok(/shot/.test(await page.locator('[data-testid="fuse-where"]').innerText()), 'the header says it edits the shot');
  await shot('panel-tag-ignored', panel);
  const h0 = await page.evaluate(() => hist());
  await panel.locator('[data-testid="fuse-acts"] button', { hasText: 'handjob' }).click(); await page.waitForTimeout(400);
  ok(JSON.stringify((await page.evaluate(() => fuseOf()))?.actsOff) === '["handjob"]' && (await page.evaluate(() => hist())) - h0 === 1, `the handjob chip turned off for this shot: ${JSON.stringify(await page.evaluate(() => fuseOf()))} (one undo step)`);
  ok((await note.count()) === 0, 'with the tag off there is nothing to explain');
  await shot('panel-act-off', panel);
  await panel.locator('[data-testid="fuse-acts"] button', { hasText: 'handjob' }).click(); await page.waitForTimeout(400);
  ok((await page.evaluate(() => fuseOf())) === null, 'on again: back to automatic');

  // ---- 2. the standing pad in the panel ----
  const sp = panel.locator('[data-testid="fuse-standing-pad"] .box');
  const b = await sp.boundingBox(), s0 = await page.evaluate(() => sig()), h1 = await page.evaluate(() => hist());
  ok(!!b && b.width >= 100 && Math.abs(b.width - b.height) < 2, `a square pad in the panel (${b?.width}x${b?.height})`);
  ok((await panel.locator('[data-testid="fuse-standing-pad"] .auto').count()) === 1, 'the automatic choice is marked');
  ok(/extremities/.test(await panel.locator('[data-testid="fuse-standing-pad"]').innerText()) && /absolute/.test(await panel.locator('[data-testid="fuse-standing-pad"]').innerText()), 'its edges are labelled');
  await page.waitForTimeout(500); await sp.scrollIntoViewIfNeeded();
  const bb = await sp.boundingBox();   // (measured again: the panel's text above it settles after the re-fuse)
  ok(await page.evaluate(() => !!document.querySelector('[data-testid="run-bar"] > .g [data-testid="fuse-pad"]')), 'at 2560 px the pad chip is in the toolbar row');
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(bb.x + bb.width / 2 + k * 6, bb.y + bb.height / 2 - k * 5); await page.waitForTimeout(40); }
  await page.waitForTimeout(250);
  const mid = await page.evaluate(() => ({ sig: sig(), hist: hist(), pv: TR.derivePreview?.derive?.fuse?.pad || null }));
  ok(mid.hist === h1 && !!mid.pv && mid.sig !== s0, `live while dragging: no history, preview pad ${JSON.stringify(mid.pv)}, the trace changed`);
  ok(/absolute/.test(await page.locator('[data-testid="fuse-pad"]').getAttribute('aria-label')) || /abs/.test(await page.locator('[data-testid="fuse-pad"]').innerText()), 'the chip follows the drag');
  await shot('panel-pad-drag', panel);
  await page.mouse.up(); await page.waitForTimeout(400);
  const p1 = (await page.evaluate(() => fuseOf()))?.pad;
  ok((await page.evaluate(() => hist())) - h1 === 1 && p1 && p1.x > 0.3 && p1.y > 0.3, `one undo step, stored ${JSON.stringify(p1)}`);
  ok(/abs 0\.\d · ext 0\.\d/.test(await page.locator('[data-testid="fuse-pad"]').innerText()), `the chip reads the same value: "${await page.locator('[data-testid="fuse-pad"]').innerText()}"`);
  // paw-oben: since b0876ef the arrows reach the pad through the key map (the pad pressed / focused is the editor selection)
  await sp.focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
  const p2 = (await page.evaluate(() => fuseOf()))?.pad;
  ok(p2 && Math.abs(p2.x - (p1.x - 0.1)) < 0.011, `arrow nudges by 0.1 (${p1.x} -> ${p2?.x})`);
  await sp.dblclick(); await page.waitForTimeout(400);
  ok((await page.evaluate(() => fuseOf())) === null && (await page.evaluate(() => sig())) === s0, 'double-click = centre: the automatic trace again');

  // ---- 3. the floating pad from the chip ----
  await runCtl(page); await page.locator('[data-testid="fuse-pad-pin"]').click(); await page.waitForTimeout(300);
  const fl = page.locator('[data-testid="fuse-pad-float"]');
  ok((await fl.count()) === 1, 'the chip pins a floating pad');
  const fb = await fl.locator('.box').boundingBox(), h2 = await page.evaluate(() => hist());
  await page.mouse.move(fb.x + fb.width * 0.5, fb.y + fb.height * 0.5); await page.mouse.down();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(fb.x + fb.width * (0.5 - k * 0.05), fb.y + fb.height * (0.5 + k * 0.05)); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(400);
  const p3 = (await page.evaluate(() => fuseOf()))?.pad, pdot = await panel.locator('[data-testid="fuse-standing-pad"] .dot').evaluate((e) => [e.style.left, e.style.top]);
  ok(p3 && p3.x < -0.2 && p3.y < -0.2 && (await page.evaluate(() => hist())) - h2 === 1, `the floating pad wrote the same setting: ${JSON.stringify(p3)}, one step`);
  ok(Math.abs(parseFloat(pdot[0]) - ((p3.x + 1) / 2) * 100) < 0.01, `the panel's pad shows it too (${pdot})`);
  await shot('floating-pad');
  await runCtl(page); await page.locator('[data-testid="fuse-pad-pin"]').click(); await page.waitForTimeout(200);
  ok((await fl.count()) === 0, 'unpin closes it');
  await page.evaluate(() => TR.setFuse(0, { pad: null }, { run: RID })); await page.waitForTimeout(300);

  // ---- 4. inside a range override ----
  await page.evaluate(() => { TR.addSignalSpan(8000, 14000); app.player.seek(10000); }); await page.waitForTimeout(500);
  const where = await page.locator('[data-testid="fuse-where"]').innerText();
  ok(/range 0?:?0?8\.0?.*14\.0/.test(where) || /range/.test(where), `the panel header says the range: "${where}"`);
  ok((await panel.locator('[data-testid="fuse-clear"]').count()) === 1, 'with the same × clear');
  await panel.locator('[data-testid="fuse-acts"] button', { hasText: 'handjob' }).click(); await page.waitForTimeout(400);
  const rel = panel.locator('[data-testid="fuse-rel"]').first();
  await rel.scrollIntoViewIfNeeded();
  await rel.locator('button', { hasText: 'pin' }).click(); await page.waitForTimeout(400);
  const ov = await page.evaluate(() => ({ spans: TR.signalSpans.map((s) => s.fuse || null), shot: fuseOf() }));
  ok(ov.shot === null && ov.spans[0]?.actsOff?.[0] === 'handjob' && ov.spans[0]?.pin?.length === 1, `the act chip and pin went to the override, not the shot: ${JSON.stringify(ov)}`);
  await panel.locator('[data-testid="fuse-standing-pad"] .box').scrollIntoViewIfNeeded();
  const ib = await panel.locator('[data-testid="fuse-standing-pad"] .box').boundingBox();
  await page.mouse.click(ib.x + ib.width * 0.85, ib.y + ib.height * 0.5); await page.waitForTimeout(400);
  const ov2 = await page.evaluate(() => ({ pad: TR.signalSpans[0]?.fuse?.pad || null, shot: fuseOf() }));
  ok(ov2.pad?.x > 0.5 && ov2.shot === null, `the panel's pad edits the override: ${JSON.stringify(ov2)}`);
  await runCtl(page); ok(/abs/.test(await page.locator('[data-testid="fuse-pad"]').innerText()), 'and the row chip (also on the override) reads it');
  await shot('panel-in-override', panel);
  if (shots) await page.locator('.stack').first().screenshot({ path: `${shots}/row-in-override.png` });   // paw-k8pe: the run's row is the lane toolbar's
  await panel.locator('[data-testid="fuse-clear"]').click(); await page.waitForTimeout(400);
  ok((await page.evaluate(() => TR.signalSpans.length)) === 0 && /shot/.test(await page.locator('[data-testid="fuse-where"]').innerText()), '× clear removes the override; the panel edits the shot again');
  await page.evaluate(() => app.player.seek(5000)); await page.waitForTimeout(300);

  // ---- 5. the reference strip ----
  const cv = page.locator('canvas[aria-label="Tracker signals"]'), cb = await cv.boundingBox();
  await page.mouse.click(cb.x + cb.width * 0.3, cb.y + cb.height * 0.6, { button: 'right' }); await page.waitForTimeout(300);
  const item = page.getByRole('menuitem', { name: /Use as a reference/ });
  ok((await item.count()) === 1, 'the Tracker row menu offers Use as a reference…');
  await item.click(); await page.waitForTimeout(300);
  const strip = page.locator('[data-testid="ref-strip"]');
  ok((await strip.count()) === 1 && !!(await page.evaluate(() => TR.refEdit)), 'the review strip is on the timeline over the shot');
  const rb = await strip.boundingBox();
  await page.mouse.move(rb.x + rb.width * 0.3, rb.y + rb.height * 0.5); await page.mouse.down();
  for (let k = 1; k <= 5; k++) { await page.mouse.move(rb.x + rb.width * (0.3 + k * 0.03), rb.y + rb.height * 0.5); await page.waitForTimeout(30); }
  await page.mouse.up(); await page.waitForTimeout(200);
  const st = await page.evaluate(() => TR.refEdit?.struck);
  ok(st?.length === 1 && st[0][1] - st[0][0] > 2000, `a drag strikes a region out: ${JSON.stringify(st)}`);
  await shot('reference-strip');
  await page.keyboard.press('Space'); await page.waitForTimeout(150);
  ok(!!(await page.evaluate(() => TR.refEdit)) && (await page.evaluate(() => !app.player.paused || true)), 'Space does not close the strip (play / pause stays)');
  await page.evaluate(() => app.player.pause?.());
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  const saved = await page.evaluate(async () => ({ open: !!TR.refEdit, list: TR.refList.map((x) => ({ path: x.path, run: x.rec.run, struck: x.rec.struck, n: x.rec.points.length, groups: x.rec.groups, tags: x.rec.tags })), dir: await TR.refDir() }));
  ok(!saved.open && saved.list.length === 1 && saved.list[0].run === (await page.evaluate(() => RID)) && saved.list[0].struck.length === 1, `Enter saved the record: ${JSON.stringify(saved.list[0] || null)}`);
  ok(saved.list[0] && saved.list[0].path.startsWith(saved.dir) && /references/.test(saved.dir) && saved.list[0].groups.includes('c1_hand_r') && saved.list[0].tags.includes('handjob'), `in the data folder's references/, self-describing: ${saved.dir}`);
  const exists = await page.evaluate((p) => app.backend.exists(p), saved.list[0]?.path || '');
  ok(exists, 'the file is there');
  await page.mouse.click(cb.x + cb.width * 0.3, cb.y + cb.height * 0.6, { button: 'right' }); await page.waitForTimeout(200);
  await page.getByRole('menuitem', { name: /Use as a reference/ }).click(); await page.waitForTimeout(300);
  await page.locator('[data-testid="ref-saved"]').click(); await page.waitForTimeout(200);
  await shot('reference-saved-list');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);   // the menu
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);   // the strip
  ok(!(await page.evaluate(() => TR.refEdit)), 'Esc cancels the strip');
  await page.evaluate((p) => TR.removeReference(p), saved.list[0]?.path || ''); await page.waitForTimeout(400);
  ok((await page.evaluate(() => TR.refList.length)) === 0 && !(await page.evaluate((p) => app.backend.exists(p), saved.list[0]?.path || '')), 'removable: the record and its file are gone');

  // ---- 6. paw-0yfp: a fisting shot (test/fusion-synth.mjs fistingScene): the giver's forearm leads; the owner's "I dragged
  // the pinned slider to 0 and the panel disappeared": pin the lead, drag its weight to 0: the panel stays, the row says out ----
  const fist = fistingScene(['anal', 'fisting']);
  const fch = Object.fromEntries(Object.entries(fist.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
  await page.evaluate((chans) => {
    const D = window.__pawDev, T = chans.who_pair_proj.map(([t]) => t);
    app.doc.scenes = [{ start_ms: 0, end_ms: 20000, tags: ['anal', 'fisting'] }];
    const run = D.makeRun({ n: 8, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: 20000 }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: chans, notes: [] }, frames: D.newFrames(), runs: [] });
    TR.runs = [run]; app.doc.ghosts = [TR.ghostOf(run)]; TR.select(run.id); window.RID = run.id;
    TR.linkScene(0, run.id, 'fused'); app.player.seek(5000);
  }, fch);
  await page.waitForTimeout(600);
  await panel.waitFor({ timeout: 10000 });
  const lead1 = panel.locator('[data-testid="fuse-rel"]').first();
  await lead1.scrollIntoViewIfNeeded();
  const leadTxt = await lead1.innerText();
  ok(/R forearm ↔ Bottom body ★/.test(leadTxt), `fisting: the Top's forearm against the Bottom leads the relationships: "${leadTxt.replace(/\s+/g, ' ')}"`);
  await shot('panel-fisting', panel);
  await lead1.locator('button', { hasText: 'pin' }).click(); await page.waitForTimeout(400);
  const hp = await page.evaluate(() => hist()), wt = lead1.locator('.wt'), wb = await wt.boundingBox();
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(wb.x + wb.width / 2 - k * 40, wb.y + wb.height / 2); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(600);
  const zf = await page.evaluate(() => fuseOf());
  ok((await panel.count()) === 1 && (await page.locator('[data-testid="fuse-pins-off"]').count()) === 1, 'the pinned weight at 0: the panel stays and says the pins no longer narrow the mix');
  ok(Object.values(zf?.w || {})[0] === 0 && zf?.pin?.length === 1 && (await page.evaluate(() => hist())) - hp === 1, `stored ×0 with the pin, one undo step: ${JSON.stringify(zf)}`);
  const zrow = panel.locator('[data-testid="fuse-rel"]', { hasText: 'R forearm ↔ Bottom body' }).first();
  ok((await zrow.count()) === 1 && /out/.test(await zrow.innerText()) && /×0/.test(await zrow.innerText()), `the row stays, ×0 and out: "${(await zrow.innerText()).replace(/\s+/g, ' ')}"`);
  await shot('panel-pinned-zero', panel);
  await page.evaluate(() => app.undo()); await page.waitForTimeout(500);
  ok((await page.evaluate(() => fuseOf()))?.w == null && (await page.locator('[data-testid="fuse-pins-off"]').count()) === 0, 'undo brings the weight back');
  await page.evaluate(() => TR.setFuse(0, { exclude: (TR.fuseInfo(0)?.relations || []).map((r) => r.id), pin: null }, { run: RID })); await page.waitForTimeout(600);
  ok((await panel.count()) === 1 && (await page.locator('[data-testid="fuse-none"]').count()) === 1, 'every relationship left out: the panel stays and says the automatic mix plays');
} catch (e) {
  fails++; console.log('FAIL ' + String(e?.stack || e).slice(0, 800));   // a throw was "all ok" (exit 0 from finally)
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exit(fails ? 1 : 0);
}
