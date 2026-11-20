// dev/polarity-check.mjs -- paw-57ve: flipped stretches on the Tracker row's direction strip in the REAL window (your test
// instance: node dev/test-app.mjs start ...; CDP_* env). A synthetic run over two shots (0-4 s, 4-8 s) on its own channel,
// a stroke every 0.8 s whose measured sense flops at 6 s. It asserts, with real pointer events:
//   1. a drag along shot 2 of the strip flips that stretch: live while dragging (preview, no history), one undo step on
//      release, frame-snapped, kept on the shot; the lane trace (painted pixels) and the ghost points change inside only;
//   2. Ctrl+Z takes it back in one step; redo; an end dragged trims it; double-click an end = to the shot's edge;
//      click selects, Delete removes; right-click > Remove;
//   3. a plain click on the strip still flips the whole scene; the command "flip from the playhead to the end of the shot".
//   node dev/polarity-check.mjs
import { connectTestApp } from './cdp-connect.mjs';

const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await page.evaluate(() => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    // the Tracker row (and its direction strip) is a row of Refine / Review; on the Track tab the combined lane has no direction
    // row since 0d4d3ae / d9fdc1e (a range's ± and its stretches on the run strip: dev/runranges-check.mjs)
    app.setMode('refine'); app.layout.setRow('tracking', { collapsed: false });   // hidden there by default (tracking/lane.js)
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080 };
    app.doc.scenes = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000 }];
    const T = Array.from({ length: 240 }, (_, i) => Math.round((i * 1000) / 30)), flop = (t) => (t < 6000 ? 1 : -1) * Math.sin((2 * Math.PI * t) / 800);
    const run = D.makeRun({ n: 3, tracker: { id: 'lk_box', name: 'LK box' }, params: {}, range: { start: 0, end: 8000 }, roi: null,
      result: { samples: T.map((t) => [t, 0.5 + 0.5 * flop(t)]), points: [{ at: 100, pos: 0 }, { at: 7900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 4000, sign: 1 }, { start_ms: 4000, end_ms: 8000, sign: 1 }], channels: { sig: T.map((t) => [t, flop(t)]) }, notes: [] },
      frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    tr.setChannel(run.id, 'sig');
    window.RID = run.id;
    app.player.seek(500);
    app.setView({ start: 0, span: 8000 });
    window.sig = () => (TR.ghost(RID).script || []).map((p) => [p.at, p.pos]);
    window.lane = () => { const L = TR.run(RID).lane; return Array.from(L.t, (t, i) => [t, L.v[i]]); };
    window.flips = () => TR.flipsOf(TR.run(RID));
    window.hist = () => app._history.index;
    // the Tracker row's canvas as painted: snap() keeps a picture, changedCols() = per x column, does any pixel differ from it by more than antialiasing (> 40 levels)
    window.snap = () => { const c = document.querySelector('.tl .cv canvas'); window.P0 = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return c.width; };
    window.changedCols = () => { const c = document.querySelector('.tl .cv canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, out = [];
      for (let x = 0; x < c.width; x++) { let n = 0; for (let y = 0; y < c.height && !n; y++) { const k = (y * c.width + x) * 4; if (Math.abs(d[k] - P0[k]) + Math.abs(d[k + 1] - P0[k + 1]) + Math.abs(d[k + 2] - P0[k + 2]) > 40) n = 1; } out.push(n); } return out; };
  });
  await page.waitForSelector('.strip .seg.sign', { timeout: 10000 });
  await page.waitForTimeout(400);
  const strip = await page.locator('.strip:has(.seg.sign)').boundingBox();
  const X = (ms) => strip.x + (ms / 8000) * strip.width, Y = strip.y + strip.height / 2;
  const fm = await page.evaluate(() => app.player.frameMs);
  const same = (p, q) => JSON.stringify(p) === JSON.stringify(q);
  const base = await page.evaluate(() => sig()), baseLane = await page.evaluate(() => lane()), W = await page.evaluate(() => snap());
  const pol = () => page.evaluate(() => app.doc.scenes.map((s) => s.polarity?.[RID] || null));

  // ---- 1. a drag along shot 2 ----
  const h0 = await page.evaluate(() => hist());
  await page.mouse.move(X(6000), Y); await page.mouse.down();
  await page.mouse.move(X(6800), Y, { steps: 6 }); await page.mouse.move(X(7500), Y, { steps: 6 });
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => ({ prev: TR.flipPreview, h: hist(), s: sig() }));
  ok(!!mid.prev && mid.h === h0, `live while dragging: a preview ${JSON.stringify(mid.prev?.list)}, no history yet`);
  ok(!same(mid.s, base), 'the ghost points already changed under the pointer');
  await page.mouse.up();
  await page.waitForTimeout(500);
  const f1 = await page.evaluate(() => flips());
  ok(f1.length === 1 && Math.abs(f1[0][0] - 6000) <= fm && Math.abs(f1[0][1] - 7500) <= fm, `one stretch over the drag ${JSON.stringify(f1)}`);
  ok(f1.flat().every((t) => Math.abs(t / fm - Math.round(t / fm)) < 0.02 || [4000, 8000].includes(t)), 'frame-snapped');
  ok((await page.evaluate(() => hist())) - h0 === 1 && !(await page.evaluate(() => TR.flipPreview)), 'the release: one undo step, the preview gone');
  ok(same(await pol(), [null, f1]), `kept on shot 2 for this run ${JSON.stringify(await pol())}`);
  ok((await page.evaluate(() => TR.run(RID).flips.length)) === 0, 'a drag did not flip the scene');
  const [a, b] = f1[0], s1 = await page.evaluate(() => sig()), l1 = await page.evaluate(() => lane());
  const out = (p) => p.filter(([t]) => t < a - 700 || t >= b + 700);
  ok(same(out(s1), out(base)), 'ghost points: the same outside the stretch (+ its joins)');
  ok(!same(s1.filter(([t]) => t >= a + 300 && t < b - 300), base.filter(([t]) => t >= a + 300 && t < b - 300)), 'ghost points: flipped inside');
  ok(same(l1.filter(([t]) => t < a), baseLane.filter(([t]) => t < a)) && same(l1.filter(([t]) => t >= b), baseLane.filter(([t]) => t >= b)), 'lane trace data: unchanged outside');
  const c1 = await page.evaluate(() => changedCols()), px = (ms) => Math.round((ms / 8000) * W);
  const changed = (lo, hi) => { let n = 0; for (let x = Math.max(0, px(lo)); x < Math.min(W, px(hi)); x++) n += c1[x]; return n; };
  ok(changed(a + 100, b - 100) > 0.5 * (px(b - 100) - px(a + 100)), `painted: the trace changed inside (${changed(a + 100, b - 100)} of ${px(b - 100) - px(a + 100)} columns)`);
  ok(changed(0, 3500) === 0, `painted: nothing changed in shot 1 (${changed(0, 3500)} columns)`);
  const seg = page.locator('[data-testid="flip-stretch"]');
  const sb = await seg.first().boundingBox();
  ok((await seg.count()) === 1 && Math.abs(sb.x - X(a)) < 3 && Math.abs(sb.x + sb.width - X(b)) < 3, 'the stretch is drawn on the strip where it is');
  ok(/−/.test(await seg.first().innerText()), 'it shows the flipped direction (−)');

  // ---- 2. undo / redo, trim, double-click an end, select + Delete, right-click > Remove ----
  await page.locator('.tl .cv canvas').first().focus();
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
  ok(same(await page.evaluate(() => flips()), []) && same(await page.evaluate(() => sig()), base), 'Ctrl+Z: gone in one step, the points as before');
  await page.keyboard.press('Control+y'); await page.waitForTimeout(500);
  if (!(await page.evaluate(() => flips())).length) { await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(500); }
  ok(same(await page.evaluate(() => flips()), f1), 'redo: back');
  const rh = await page.locator('[data-testid="flip-stretch"] .polh.r').first().boundingBox();
  const h1 = await page.evaluate(() => hist());
  await page.mouse.move(rh.x + rh.width / 2, rh.y + rh.height / 2); await page.mouse.down();
  await page.mouse.move(X(7000), rh.y + rh.height / 2, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(400);
  const f2 = await page.evaluate(() => flips());
  ok(f2.length === 1 && f2[0][0] === a && Math.abs(f2[0][1] - 7000) <= fm && (await page.evaluate(() => hist())) - h1 === 1, `the right end trimmed ${JSON.stringify(f2)}, one undo step`);
  const cur2 = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="flip-stretch"] .polh.r')).cursor);
  const curB = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="flip-stretch"] .polb')).cursor);
  const curS = await page.evaluate(() => getComputedStyle(document.querySelector('.strip .seg.sign')).cursor);
  ok(cur2 === 'ew-resize' && curB === 'grab' && curS === 'cell', `cursors: ends ${cur2}, body ${curB}, empty strip ${curS}`);
  const lh = await page.locator('[data-testid="flip-stretch"] .polh.l').first().boundingBox();
  await page.mouse.dblclick(lh.x + lh.width / 2, lh.y + lh.height / 2); await page.waitForTimeout(400);
  const f3 = await page.evaluate(() => flips());
  ok(f3.length === 1 && f3[0][0] === 4000 && f3[0][1] === f2[0][1], `double-click the left end: to the shot's start ${JSON.stringify(f3)}`);
  // body drag = move (inside its shot)
  const bb = await page.locator('[data-testid="flip-stretch"] .polb').first().boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, Y); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 30, Y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(400);
  const f4 = await page.evaluate(() => flips());
  ok(f4.length === 1 && f4[0][0] > 4000 && Math.abs(f4[0][1] - f4[0][0] - (f3[0][1] - f3[0][0])) <= 1, `body drag moved it, same length ${JSON.stringify(f4)}`);
  // a drag over part of it from outside: that part un-flips (xor)
  await page.mouse.move(X(7600), Y); await page.mouse.down(); await page.mouse.move(X(f4[0][1] - 500), Y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
  const f5 = await page.evaluate(() => flips());
  ok(f5.length === 2 && Math.abs(f5[0][1] - (f4[0][1] - 500)) <= fm && Math.abs(f5[1][0] - f4[0][1]) <= fm, `a drag over its end from outside un-flips that part and flips the rest (xor) ${JSON.stringify(f5)}`);
  await page.locator('[data-testid="flip-stretch"] .polb').first().click(); await page.waitForTimeout(200);
  ok((await page.locator('[data-testid="flip-stretch"].on').count()) === 1, 'click selects it');
  await page.keyboard.press('Delete'); await page.waitForTimeout(400);
  ok((await page.evaluate(() => flips())).length === 1, 'Delete removes the selected one');
  await page.locator('[data-testid="flip-stretch"] .polb').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Remove/ }).click(); await page.waitForTimeout(400);
  ok((await page.evaluate(() => flips())).length === 0 && (await page.locator('[data-testid="flip-stretch"]').count()) === 0, 'right-click > Remove: none left');
  ok(same(await page.evaluate(() => sig()), base), 'the points are the original again');

  // ---- 3. a plain click still flips the scene; the to-the-end command ----
  await page.mouse.click(X(2000), Y); await page.waitForTimeout(400);
  ok(same(await page.evaluate(() => TR.run(RID).flips), [0]) && (await page.evaluate(() => flips())).length === 0, 'a click (no drag) flips the whole scene, as before');
  await page.mouse.click(X(2000), Y); await page.waitForTimeout(300);
  ok((await page.evaluate(() => TR.run(RID).flips.length)) === 0, 'click again: back');
  await page.evaluate(() => app.player.seek(6000)); await page.waitForTimeout(200);
  const h2 = await page.evaluate(() => hist());
  await page.evaluate(() => app.commands.run('track.flipToEnd')); await page.waitForTimeout(500);
  const f6 = await page.evaluate(() => flips());
  ok(f6.length === 1 && Math.abs(f6[0][0] - 6000) <= fm && f6[0][1] === 8000 && (await page.evaluate(() => hist())) - h2 === 1, `"flip from the playhead to the end of the shot": ${JSON.stringify(f6)}, one undo step`);
  await page.mouse.move(X(2000), strip.y - 60); await page.waitForTimeout(400);
  await page.mouse.move(X(2000), Y, { steps: 3 }); await page.waitForTimeout(1500);
  const tipText = await page.evaluate(() => [...document.querySelectorAll('[role=tooltip]')].map((e) => e.textContent).join(' | '));
  // the copy pass (31c75a5) shortened it to "Click or F flips it, drag flips a stretch"; the to-the-end command is in the Track menu
  ok(/flips it, drag flips a stretch/.test(tipText), `the strip's tooltip says so -> "${tipText.slice(0, 160)}…"`);
  console.log(fails ? `FAILED: ${fails}` : 'all ok');
} finally { await browser.close().catch(() => {}); }
process.exit(fails ? 1 : 0);
