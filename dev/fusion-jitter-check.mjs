// dev/fusion-jitter-check.mjs -- paw-0sn8 in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env).
//   node dev/fusion-jitter-check.mjs panel          a synthetic run (test/fusion-synth.mjs j-chain: Top sheath / balls / knot
//                                                    over a noisy Top hips) linked to 'fused': the panel's Signal chips
//                                                    (smooth on, direction off; each click one undo step, the points change,
//                                                    fuse.jit holds only what differs), each part's read (↔ what / abs) and
//                                                    its direction bar, the Top sheath / knot row
//   node dev/fusion-jitter-check.mjs video [SHOT_DIR] on the project open now (e.g. dev/smoke-check.mjs's, tracked by the fake
//                                                    sidecar): its shot linked to 'fused', the blobs view with the Fusion view:
//                                                    info.dir is there, its contact parts are on the frame, and the Fusion view
//                                                    paints the direction ink at the contact (pixels read back from the canvas)
import { connectTestApp } from './cdp-connect.mjs';
import { JIT_CASES } from '../test/fusion-synth.mjs';

const [phase, shots] = process.argv.slice(2);
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
try {
  if (phase === 'panel') {
    const sc = JIT_CASES.find((c) => c.id === 'j-chain').make();
    const chans = Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
    await page.reload();
    await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
    await page.evaluate(() => app.settings.set('tracking.panel.open', { fusion: true, camera: true, strokes: true, run: true }));   // paw-r73w: the folds this check reads, open
    await page.evaluate((chans) => {
      const D = window.__pawDev, tr = D.trackingFor(app);
      window.TR = tr;
      tr.runs = []; app.doc.ghosts = []; tr.select('');
      app.setMode('track');
      app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'fusionjit01' } };
      app.doc.scenes = [{ start_ms: 0, end_ms: 20000, tags: ['anal', 'penetration'] }];
      const T = chans.who_pair_proj.map(([t]) => t);
      const run = D.makeRun({ n: 3, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: 20000 }, roi: null,
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
    const panel = page.locator('[data-testid="fuse-panel"]');
    await panel.waitFor({ timeout: 10000 });
    await panel.scrollIntoViewIfNeeded();
    const smooth = panel.locator('[data-testid="fuse-smooth"]'), dir = panel.locator('[data-testid="fuse-direction"]');
    ok((await smooth.getAttribute('aria-pressed')) === 'true' && (await dir.getAttribute('aria-pressed')) === 'false', 'Signal chips: smooth on, direction off by default');
    const rels = await panel.locator('[data-testid="fuse-rel"]').allInnerTexts();
    ok(rels.some((x) => /Top sheath \/ knot ↔ Bottom body/.test(x)), `the Top sheath / knot are read against the Bottom: ${rels[0]?.split('\n')[0]}`);
    const vs = await panel.locator('[data-testid="fuse-part-vs"]').allInnerTexts();
    ok(vs.filter((x) => /↔ body/.test(x)).length >= 3, `each part says what it is read against: ${vs.join(' | ')}`);
    ok((await panel.locator('.part .dc').count()) >= 3, 'each part has its direction bar');
    // direction on: one undo step, fuse.jit = {dir: true}, the points change; off again: back to automatic
    let s0 = await page.evaluate(() => sig()), h0 = await page.evaluate(() => hist());
    await dir.click(); await page.waitForTimeout(500);
    ok(JSON.stringify((await page.evaluate(() => fuseOf()))?.jit) === '{"dir":true}' && (await page.evaluate(() => hist())) - h0 === 1, `direction on: ${JSON.stringify(await page.evaluate(() => fuseOf()))}, one undo step`);
    ok((await dir.getAttribute('aria-pressed')) === 'true', 'the chip reads on');
    ok((await page.evaluate(() => sig())) !== s0, 'the points follow');
    await dir.click(); await page.waitForTimeout(500);
    ok((await page.evaluate(() => fuseOf())) === null && (await page.evaluate(() => sig())) === s0, 'off again: automatic, the same points');
    // smooth off: fuse.jit = {refine: 0}; undo brings it back
    h0 = await page.evaluate(() => hist());
    await smooth.click(); await page.waitForTimeout(500);
    ok(JSON.stringify((await page.evaluate(() => fuseOf()))?.jit) === '{"refine":0}' && (await page.evaluate(() => hist())) - h0 === 1, `smooth off: ${JSON.stringify(await page.evaluate(() => fuseOf()))}`);
    ok((await smooth.getAttribute('aria-pressed')) === 'false', 'the chip reads off (marked as changed)');
    await page.evaluate(() => app.undo()); await page.waitForTimeout(500);
    ok((await page.evaluate(() => fuseOf())) === null && (await page.evaluate(() => sig())) === s0, 'undo: smoothing on again, the same points');
  } else if (phase === 'video') {
    const st = await page.evaluate(() => {
      const tr = window.__pawDev.trackingFor(app), run = tr.runs.find((r) => r.frames?.ov?.some((o) => o?.pts?.[0]?.length > 3) && Object.keys(r.channels || {}).filter((k) => /^sem_.+_x$/.test(k)).length >= 2);
      if (!run) return null;
      window.TR = tr;
      const k = tr.scenes.findIndex((s) => s.start_ms < run.range.end && s.end_ms > run.range.start);
      tr.select(run.id); tr.linkScene(k, run.id, 'fused');
      app.settings.set('tracking.trails', 'blobs');
      for (const [key, v] of Object.entries({ fusion: true, heat: false, points: false, labels: 'off', hud: false, trails: false, hulls: false, axis: false })) app.settings.set('tracking.blobs.' + key, v);
      const s = tr.scenes[k], t = Math.round((Math.max(s.start_ms, run.range.start) + Math.min(s.end_ms, run.range.end)) / 2);
      app.player.seek(t);
      return { id: run.id, k, t };
    });
    ok(!!st, `a tracked run with pinned groups is open: ${JSON.stringify(st)}`);
    await page.waitForTimeout(1500);
    const info = await page.evaluate(({ id, k }) => { const tr = window.TR, run = tr.runs.find((r) => r.id === id); return { dir: tr.fuseInfo(k)?.dir || null, names: Object.keys(run.channels).filter((k) => /^sem_.+_x$/.test(k)).map((k) => k.slice(4, -2)) }; }, st);
    ok(!!info.dir?.u && info.dir.contact, `info.dir: ${JSON.stringify(info.dir)}`);
    ok([...(info.dir?.contact?.a || []), ...(info.dir?.contact?.b || [])].every((n) => info.names.includes(n)), 'its contact parts are tracked parts of the run');
    // pixels: the overlay canvas with the Fusion view on has the direction ink; off it does not
    const inkCount = () => page.evaluate(() => {
      const cs = [...document.querySelectorAll('canvas')].filter((c) => c.width > 200 && c.getContext && c.getBoundingClientRect().width > 200);
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--highlight').trim();
      let n = 0;
      for (const c of cs) {
        let ctx = null; try { ctx = c.getContext('2d'); } catch { ctx = null; }
        if (!ctx) continue;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]) > 60) n++;
      }
      return { n, ink, canvases: cs.length };
    });
    const on = await inkCount();
    if (shots) await page.screenshot({ path: `${shots}/fusion-view-dir.png` });
    await page.evaluate(() => app.settings.set('tracking.blobs.fusion', false)); await page.waitForTimeout(800);
    const off = await inkCount();
    ok(on.n > off.n + 200, `the Fusion view paints (coloured pixels on ${on.n} vs off ${off.n}, ${on.canvases} canvases)`);
    await page.evaluate(() => app.settings.set('tracking.blobs.fusion', true));
  } else { console.log('usage: node dev/fusion-jitter-check.mjs panel | video [SHOT_DIR]'); fails++; }
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
