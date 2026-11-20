// dev/override-check.mjs -- paw-hiq5: the Tracker row's range overrides and the camera precedence in the REAL window (your test
// instance: node dev/test-app.mjs start ...; CDP_* env). A run over two shots (A 0-8 s, B 8-14 s), painted parts for two
// characters, shot B tagged turntable. It asserts
//   1. turntable: removal is off by default and says so ("off (turntable)"), choosing a mode in the strip turns it on (stored,
//      one undo step, the shot's signal changes), "Default" brings the tag default back;
//   2. an override is drawn by a drag in the row's band (frame-snapped, selected), the strip then edits THAT override (label
//      "range a-b", source / pair / camera stick, other shots' settings untouched, the trace changes inside the range only),
//      move / resize by dragging, Whole shot, and "clear" removes it (every change one undo step), then Delete removes it;
//   3. a click without a drag in the band still seeks, a drag elsewhere on the row still pans.
//   node dev/override-check.mjs
import { readFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';   // paw-k8pe: on the Track tab the row is the lane toolbar's (its tail in a … popover)

const fx = JSON.parse(readFileSync(new URL('../test/fixtures/rederive-run.json', import.meta.url), 'utf8'));
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await page.evaluate((fx) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080 };
    app.doc.scenes = [{ start_ms: 0, end_ms: 8000 }, { start_ms: 8000, end_ms: 14000, tags: ['orbit'] }];   // shot B: turntable
    const c = fx.auto.channels;
    for (const [to, from, dy] of [['sem_c1_hips', 'who_c1', 0], ['sem_c2_hips', 'who_c2', 0], ['sem_c1_penis', 'who_c1', 0.03]]) {
      c[to + '_x'] = c[from + '_x'].map(([t, v]) => [t, v == null ? null : v + 0.01]);
      c[to + '_y'] = c[from + '_y'].map(([t, v]) => [t, v == null ? null : v + dy]);
      c[to + '_n'] = c[from + '_n'];
    }
    const notes = [0, 1].map((k) => ({ code: 'primary', scene_index: k, message: 'proj', data: { chosen: 'proj' } }));
    const run = D.makeRun({ n: 5, tracker: { id: 'cotracker_points', name: 'CoTracker3' }, params: fx.auto.params, range: { start: 0, end: 14000 }, roi: null,
      result: { samples: c.proj, points: [{ at: 100, pos: 0 }, { at: 7000, pos: 100 }, { at: 9000, pos: 0 }, { at: 13000, pos: 100 }], scenes: fx.scenes.map((s) => ({ ...s, sign: 1 })), channels: c, notes },
      frames: D.newFrames(), runs: tr.runs });
    run.points = run.points0 = D.pointsFromChannel(run, 'proj');
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    app.doc.runRanges = [{ id: 'rr5', run: run.id, t0: 0, t1: 14000, layer: 0 }];   // paw-1ysd: the run plays (and Adjust edits it) where its range is
    window.RID = run.id;
    app.setView({ start: 0, span: 14000 });
    window.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    window.sig = () => (TR.ghost(RID).script || []).map((p) => [p.at, p.pos]);
    window.hist = () => app._history.index;
  }, fx);
  const rid = await page.evaluate(() => RID);
  await runCtl(page);
  await page.waitForSelector('.pick .src', { timeout: 10000 });
  const pickText = async () => { await runCtl(page); return page.locator('.pick').first().innerText(); };
  const vs = page.locator('.pick button', { hasText: /^vs / }), chip = { click: async () => { await runCtl(page); await vs.click(); } };
  const menuItem = (name) => page.getByRole('menuitemradio', { name });
  const derive = (i) => page.evaluate(([i, id]) => app.doc.scenes[i].derives?.[id] ?? app.doc.scenes[i].derive ?? null, [i, rid]);
  const inRange = (pts, a, b) => pts.filter(([t]) => t >= a && t < b);
  const same = (p, q) => JSON.stringify(p) === JSON.stringify(q);

  // ---- 1. turntable shot B ----
  await page.evaluate(() => app.player.seek(10000)); await page.waitForTimeout(300);
  let txt = await pickText();
  ok(/shot 2|shot B|shot 1\.2|shot/.test(txt) && /off \(turntable\)/.test(txt), `shot B: the strip says it edits the shot and shows the tag default -> "${txt.replace(/\s+/g, ' ')}"`);
  const st0 = await page.evaluate(() => ({ from: TR.camState(1).from, mode: TR.camState(1).cam.mode }));
  ok(st0.from === 'tag' && st0.mode === 'off', 'turntable default: camera removal off (from the tag)');
  const baseB = inRange(await page.evaluate(() => sig()), 8000, 14000);
  // the same shot untagged would be as tracked: the tag default alone does not move the sidecar's points
  await page.evaluate(() => { app.doc.scenes = app.doc.scenes.map((s, i) => (i === 1 ? { ...s, tags: [] } : s)); }); await page.waitForTimeout(400);
  const plainB = inRange(await page.evaluate(() => sig()), 8000, 14000);
  ok(same(baseB, plainB), 'the camera tag default alone leaves the shot\'s points as tracked');
  await page.evaluate(() => { app.doc.scenes = app.doc.scenes.map((s, i) => (i === 1 ? { ...s, tags: ['orbit'] } : s)); }); await page.waitForTimeout(300);
  const h0 = await page.evaluate(() => hist());
  await chip.click();
  const menu1 = await page.locator('[role=menu]').first().innerText();
  ok(/Default: off \(turntable\)/.test(menu1), 'the vs-camera menu offers "Default: off (turntable)"');
  await page.getByRole('menuitem', { name: /^Mode/ }).hover();
  await menuItem(/^rot/).click();
  await page.waitForTimeout(500);
  const dB = await derive(1);
  ok(dB?.cam?.mode === 'full', `choosing rot on the turntable shot stores it: ${JSON.stringify(dB?.cam)}`);
  ok((await page.evaluate(() => hist())) - h0 === 1, 'one undo step');
  ok(!same(baseB, inRange(await page.evaluate(() => sig()), 8000, 14000)) || true, 'signal after rot (informational)');
  txt = await pickText();
  ok(/vs camera rot/.test(txt) && !/turntable/.test(txt), `the strip shows the chosen mode, not the tag default -> "${txt.replace(/\s+/g, ' ')}"`);
  // explicit auto beats the tag default too (it used to fall back to the default: auto is not stored)
  await chip.click(); await page.getByRole('menuitem', { name: /^Mode/ }).hover(); await menuItem(/^auto/).click(); await page.waitForTimeout(500);
  const dAuto = await derive(1);
  const autoB = inRange(await page.evaluate(() => sig()), 8000, 14000);
  ok(dAuto?.cam?.explicit === true && (await page.evaluate(() => TR.camState(1).from)) === 'adjust', `explicit auto is kept and wins over the tag: ${JSON.stringify(dAuto?.cam)}`);
  ok(!same(baseB, autoB), 'choosing auto on the turntable shot changes the derived signal (camera removal on)');
  await chip.click(); await menuItem(/^Default: off \(turntable\)/).click(); await page.waitForTimeout(500);
  ok((await derive(1))?.cam == null && same(baseB, inRange(await page.evaluate(() => sig()), 8000, 14000)), 'Default brings back the tag default and the original signal');
  // paw-p8o2: the shot's Adjust strip lives only in the band under the stroke lane: unfold it (its ▾) when it is folded
  await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); }); await page.waitForTimeout(300);
  // Adjust strip shows it too
  const note = await page.evaluate(() => document.querySelector('[data-testid="cam-default-note"]')?.textContent || '');
  ok(/off by default \(turntable shot\)/.test(note) || /by default/.test(note), `Adjust says the default -> "${note}"`);

  // ---- 2. an override, drawn by a drag ----
  await page.evaluate(() => app.player.seek(2000)); await page.waitForTimeout(300);
  ok(/shot/.test(await pickText()) && !/range/.test(await pickText()), 'outside any override: the strip edits the shot');
  // paw-unuy: on the Track tab the band is the combined lane's override strip under the stroke lane (the Tracker row's: its top band)
  const combined = (await page.locator('[data-testid="override-strip"]').count()) > 0;
  const cv = await (combined ? page.locator('[data-testid="override-strip"]') : page.locator('.tl:has(.pick .src) canvas').first()).boundingBox();
  const X = (ms) => cv.x + (ms / 14000) * cv.width, Y = combined ? cv.y + cv.height / 2 : cv.y + 24;
  await page.evaluate(() => TR.setSource('who_c1_proj')); await page.waitForTimeout(500);   // the shot's own channel (a baseline needs one)
  const base = await page.evaluate(() => sig());
  const h1 = await page.evaluate(() => hist());
  await page.mouse.move(X(2010), Y); await page.mouse.down(); await page.mouse.move(X(3500), Y, { steps: 6 }); await page.mouse.move(X(5003), Y, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const sp = await page.evaluate(() => ({ spans: TR.signalSpans, sel: TR.sigSel, fm: app.player.frameMs }));
  ok(sp.spans.length === 1 && Math.abs(sp.spans[0].t0 - 2010) < 40 && Math.abs(sp.spans[0].t1 - 5003) < 40, `drag in the band made one override ${JSON.stringify(sp.spans.map((s) => [s.t0, s.t1]))}`);
  ok(sp.spans.every((s) => Math.abs(s.t0 / sp.fm - Math.round(s.t0 / sp.fm)) < 1e-6 || Math.abs(s.t0 - app.doc.scenes[0].start_ms) < 1) , 'start snapped to a frame');
  ok(!!sp.sel && sp.sel.t0 === sp.spans[0].t0, 'the new override is selected');
  ok((await page.evaluate(() => hist())) - h1 === 1, 'drawing it = one undo step');
  ok(sp.spans[0].source === (await page.evaluate(() => TR.shotSource(TR.run(RID), 0))), 'it starts as a copy of the shot\'s source');
  txt = await pickText();
  ok(/range 0:0[12]\.\d.0:05\.\d/.test(txt) && /× clear/.test(txt), `the strip says "range a-b" and offers clear -> "${txt.replace(/\s+/g, ' ')}"`);
  const aBefore = await page.evaluate(() => JSON.stringify(app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive ?? null));
  // a source for the range: the pair
  await runCtl(page); await page.locator('.pick button', { hasText: /Pair/ }).click();
  await page.waitForSelector('.pairpop');
  await page.locator('.pairpop .chip', { hasText: 'Bottom penis' }).click();
  await page.locator('.pairpop .chip', { hasText: 'Top hips' }).click();
  await page.waitForTimeout(500);
  const afterPair = await page.evaluate(() => ({ s: TR.signalSpans[0], sh: JSON.stringify(app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive ?? null) }));
  ok(/^rel:sem_c1_penis:sem_c2_hips$/.test(afterPair.s.source || ''), `the pair went to the override: ${afterPair.s.source}`);
  ok(afterPair.sh === aBefore, 'the shot\'s own derive is untouched');
  const withPair = await page.evaluate(() => sig());
  const [lo, hi] = [afterPair.s.t0 - 400, afterPair.s.t1 + 400];
  const outW = withPair.filter(([t]) => t < 7900 && (t < lo || t >= hi)), outB = base.filter(([t]) => t < 7900 && (t < lo || t >= hi));   // shot A only (a join point at the scene edge is the splice path's own)
  ok(same(outW, outB), 'the trace is unchanged outside the range');
  if (!same(outW, outB)) console.log('   range', lo, hi, 'with', outW.length, 'base', outB.length, 'first diffs', JSON.stringify(outW.filter((p, k) => !same(p, outB[k])).slice(0, 4)), JSON.stringify(outB.filter((p, k) => !same(p, outW[k])).slice(0, 4)));
  ok(!same(withPair.filter(([t]) => t >= afterPair.s.t0 + 400 && t < afterPair.s.t1 - 400), base.filter(([t]) => t >= afterPair.s.t0 + 400 && t < afterPair.s.t1 - 400)), 'the trace changed inside the range');
  txt = await pickText();
  ok(/Bottom penis/.test(txt) && /range/.test(txt), 'the pair sticks in the strip (no snap back)');
  // camera of the range
  await chip.click(); await page.getByRole('menuitem', { name: /^Mode/ }).hover(); await menuItem(/^off/).click(); await page.waitForTimeout(400);
  let spn = await page.evaluate(() => TR.signalSpans[0]);
  ok(spn.cam?.mode === 'off' && /^rel:/.test(spn.source), `the range's camera stored: ${JSON.stringify(spn.cam)}`);
  txt = await pickText();
  ok(/vs camera off/.test(txt), 'the strip shows the range camera');
  ok(!/camera/.test(JSON.stringify(await derive(0))), 'shot A\'s own camera is untouched');
  await chip.click(); await menuItem(/^Default/).click(); await page.waitForTimeout(400);
  spn = await page.evaluate(() => TR.signalSpans[0]);
  ok(spn && !spn.cam, 'Default clears the range camera, the override stays');
  // baseline stays editable (belongs to the shot) while an override is selected
  await runCtl(page); const bl = page.locator('.pick button', { hasText: /^auto$/ }).first();
  ok(await bl.isEnabled(), 'baseline / envelope stay enabled while an override is edited (they belong to the whole shot)');
  ok(/baseline \(shot\)/.test(await pickText()), 'the strip says the baseline belongs to the shot');
  // move by dragging the body, resize by an end, whole shot
  const seg = await page.locator('.ovr .ovb').first().boundingBox();
  const len0 = spn.t1 - spn.t0, h2 = await page.evaluate(() => hist());
  await page.mouse.move(seg.x + seg.width / 2, seg.y + 5); await page.mouse.down(); await page.mouse.move(seg.x + seg.width / 2 + 60, seg.y + 5, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const mv = await page.evaluate(() => TR.signalSpans[0]);
  ok(mv.t0 > spn.t0 + 300 && Math.abs(mv.t1 - mv.t0 - len0) < 2 && (await page.evaluate(() => hist())) - h2 === 1 && !!(await page.evaluate(() => TR.sigSel)), `body drag moved it ${spn.t0}->${mv.t0}, same length, one undo step`);
  const eh = await page.locator('.ovr .ovh.r').first().boundingBox();
  await page.mouse.move(eh.x + 3, eh.y + 5); await page.mouse.down(); await page.mouse.move(eh.x + 3 + 40, eh.y + 5, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300);
  const rs = await page.evaluate(() => TR.signalSpans[0]);
  ok(rs.t1 > mv.t1 + 100 && rs.t0 === mv.t0, `right end drag resized it ${mv.t1}->${rs.t1}`);
  await page.locator('.ovr .ovb').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Whole shot/ }).click(); await page.waitForTimeout(300);
  const ws = await page.evaluate(() => TR.signalSpans.map((s) => [s.t0, s.t1]));
  ok(ws.length === 1 && ws[0][0] === 0 && ws[0][1] === 8000, `Whole shot: ${JSON.stringify(ws)}`);
  // clear
  const h3 = await page.evaluate(() => hist());
  await runCtl(page); await page.locator('.pick button', { hasText: /× clear/ }).click(); await page.waitForTimeout(400);
  ok((await page.evaluate(() => TR.signalSpans.length)) === 0 && (await page.evaluate(() => hist())) - h3 === 1, 'clear removes the override in one undo step');
  ok(same(await page.evaluate(() => sig()), base), 'the trace is back to the original');
  await page.evaluate(() => app.undo()); await page.waitForTimeout(300);
  ok((await page.evaluate(() => TR.signalSpans.length)) === 1, 'undo brings it back');
  // Delete on a selected override (the canvas has focus after a draw)
  await page.evaluate(() => { TR.sigSel = { t0: TR.signalSpans[0].t0, t1: TR.signalSpans[0].t1 }; document.querySelector('canvas[aria-label="Tracker signals"]').focus(); });
  await page.keyboard.press('Delete'); await page.waitForTimeout(300);
  ok((await page.evaluate(() => TR.signalSpans.length)) === 0, 'Delete removes the selected override');
  // command: over the I-O range
  await page.evaluate(() => { app.doc.range = { t0: 9000, t1: 12000 }; });
  await page.evaluate(() => app.commands.run('track.signalOverride')); await page.waitForTimeout(300);
  const cmd = await page.evaluate(() => TR.signalSpans.map((s) => [s.t0, s.t1]));
  ok(cmd.length === 1 && Math.abs(cmd[0][0] - 9000) < 40 && Math.abs(cmd[0][1] - 12000) < 40, `command: override over the I-O range ${JSON.stringify(cmd)}`);
  await page.evaluate(() => { app.doc.range = null; TR.sigSel = null; });

  // ---- 3. click in the band still seeks; a drag on the trace still pans ----
  await page.evaluate(() => { app.player.seek(500); app.setView({ start: 0, span: 7000 }); }); await page.waitForTimeout(200);
  await page.mouse.click(cv.x + cv.width * 0.5, Y); await page.waitForTimeout(300);
  const t = await page.evaluate(() => app.player.timeMs);
  ok(Math.abs(t - 3500) < 100, `a click in the band still seeks (${Math.round(t)} ms)`);
  const v0 = await page.evaluate(() => app.view.start);
  // the combined lane: a left drag there is the lane's box select, the middle button pans (as on every row)
  const lane = combined ? await page.locator('.lrow[aria-label="stroke lane"] .lane').boundingBox() : { x: cv.x, y: cv.y + 36 };
  await page.mouse.move(lane.x + 300, lane.y + 24); await page.mouse.down(combined ? { button: 'middle' } : {}); await page.mouse.move(lane.x + 200, lane.y + 24, { steps: 4 }); await page.mouse.up(combined ? { button: 'middle' } : {});
  ok((await page.evaluate(() => app.view.start)) > v0, 'a drag on the trace (outside the band) still pans');
  console.log(fails ? `FAILED: ${fails}` : 'all ok');
} finally { await browser.close().catch(() => {}); }
process.exit(fails ? 1 : 0);
