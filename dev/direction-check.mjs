// dev/direction-check.mjs -- paw-vtec: a whole-scene flip acts on the run's SIGNAL, in the REAL window (your test
// instance: node dev/test-app.mjs start ...; CDP_* env). Two synthetic runs over two shots (0-4 s, 4-8 s) on their own
// channel, an asymmetric stroke (a rest at the deep turn, fast in / slow out) with the default Detail (+ Midpoint + Hold):
// run A tracked the right way up (its points kept, the run removed: only B painted), run B upside down in shot 2. It asserts, with a real key press (F at the playhead):
//   1. before: B's holds in shot 2 sit at the out end; after F: at the deep end (pos < 50), B's ghost = A's ghost point
//      for point, B's Tracker-row trace (painted pixels) changed over shot 2 only (the flipped signal is drawn);
//   2. F again: B's points and trace as tracked; a click on the strip's scene does the same as F.
//   node dev/direction-check.mjs [clip.mp4, default: a copy of dev/assets/cfr30.mp4 in SHOT_DIR or the temp folder]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { connectTestApp } from './cdp-connect.mjs';

// 0d33bfa (paw-3cbm): F needs a video open (and flips the run that PLAYS at the playhead: its run range, paw-1ysd), so the
// synthetic runs sit on a real clip (a fake media path set over the runs recomposes them without their Detail)
const dir = process.env.SHOT_DIR || join(tmpdir(), 'paw-direction-check');
mkdirSync(dir, { recursive: true });
const clip = resolve(process.argv[2] || join(dir, `direction-${Date.now()}.mp4`));
if (!process.argv[2]) copyFileSync(new URL('./assets/cfr30.mp4', import.meta.url), clip);
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  const opening = page.evaluate((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 40 && !(await page.evaluate(() => !!(app.doc.media?.path && app.player.ready))); k++) {
    await page.waitForTimeout(500);
    await page.evaluate(() => { const d = app.dialog; if (d) d.resolve(d.choices?.some((c) => c.id === 'discard') ? 'discard' : d.choices?.[0]?.id ?? null); });
  }
  await opening.catch(() => {});
  await page.waitForFunction(() => app.doc.media?.path && app.player.ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080 };
    app.doc.scenes = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000 }];
    const T = Array.from({ length: 240 }, (_, i) => Math.round((i * 1000) / 30));
    const shape = (t) => { const u = (t % 1000) / 1000; return u < 0.35 ? 0 : u < 0.8 ? ((u - 0.35) / 0.45) ** 0.5 : 1 - ((u - 0.8) / 0.2) ** 2; };
    const mk = (n, inv) => D.makeRun({ n, tracker: { id: 'lk_box', name: 'LK box' }, params: {}, range: { start: 0, end: 8000 }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 7900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 4000, sign: 1 }, { start_ms: 4000, end_ms: 8000, sign: 1 }],
        channels: { sig: T.map((t) => [t, inv && t >= 4000 ? 1 - shape(t) : shape(t)]) }, notes: [] }, frames: D.newFrames(), runs: [] });
    const A = mk(4, false), B = mk(5, true);
    tr.runs = [A, B];
    app.doc.runRanges = [{ id: 'rrB', run: B.id, t0: 0, t1: 8000, layer: 0 }];   // before its channel is set: B composes where it plays
    app.doc.ghosts = [tr.ghostOf(A), tr.ghostOf(B)];
    tr.setChannel(A.id, 'sig'); tr.setChannel(B.id, 'sig');
    tr.select(B.id);
    window.GOOD = (tr.ghost(A.id).script || []).map((p) => [p.at, p.pos]);   // A's points, then A gone: only B painted
    tr.runs = tr.runs.filter((r) => r.id !== A.id); app.doc.ghosts = app.doc.ghosts.filter((g) => g.id !== A.id);
    window.A = A.id; window.B = B.id;
    app.player.seek(5500);
    app.setView({ start: 0, span: 8000 });
    window.sig = (id) => (TR.ghost(id).script || []).map((p) => [p.at, p.pos]);
    window.holds = (id) => { const r = TR.run(id), w = r.whys; if (!w) return []; const at = new Map(Array.from(r.points.at, (t, k) => [t, r.points.pos[k]])); return w.at.filter((t, k) => w.why[k] === 'hold' && t >= 4000).map((t) => at.get(t)); };
    window.snap = () => { const c = document.querySelector('canvas[aria-label="Tracker signals"]'); window.P0 = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return c.width; };
    window.changedCols = () => { const c = document.querySelector('canvas[aria-label="Tracker signals"]'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, out = [];
      for (let x = 0; x < c.width; x++) { let n = 0; for (let y = 0; y < c.height && !n; y++) { const k = (y * c.width + x) * 4; if (Math.abs(d[k] - P0[k]) + Math.abs(d[k + 1] - P0[k + 1]) + Math.abs(d[k + 2] - P0[k + 2]) > 40) n = 1; } out.push(n); } return out; };
  });
  // d9fdc1e (paw-1ysd stages 4-5): the Track tab's combined lane draws the trace under the points and has no direction row (its
  // run strip inverts whole ranges); the trace alone and the per-scene strip are the Refine / Review Tracker row's: the pictures
  // and the strip click are taken there, F (a Track-tab key) is pressed on the Track tab
  const refine = async () => { await page.evaluate(() => { app.setMode('refine'); app.layout.setRow('tracking', { collapsed: false }); }); await page.waitForSelector('canvas[aria-label="Tracker signals"]', { timeout: 10000 }); await page.waitForTimeout(800); };
  const pressF = async () => { await page.evaluate(() => { app.setMode('track'); document.activeElement?.blur(); }); await page.waitForTimeout(600); await page.keyboard.press('f'); await page.waitForTimeout(600); await refine(); };
  const scored = await page.waitForFunction(() => TR.run(B)?.whys, null, { timeout: 10000 }).then(() => true, () => false);   // B composed (its holds known) before anything is read
  if (!scored) console.log('info B has no whys yet: ' + JSON.stringify(await page.evaluate(() => { const r = TR.run(B); return { pts: r?.points?.at?.length, ranges: app.doc.runRanges, link: TR.sceneLink?.(1) }; })));
  await refine();
  const same = (p, q) => JSON.stringify(p) === JSON.stringify(q);
  const good = await page.evaluate(() => GOOD), base = await page.evaluate(() => sig(B)), W = await page.evaluate(() => snap());
  const h0 = await page.evaluate(() => holds(B));
  ok(h0.length >= 3 && h0.every((p) => p > 50), `before: B's holds in shot 2 at the out end (${h0})`);
  ok(!same(base, good), 'before: B differs from A');

  // ---- 1. F at the playhead (shot 2) ----
  await page.evaluate(() => app.player.seek(5500)); await page.waitForTimeout(1500);   // (settled: the first paints after the setup)
  ok(Math.abs((await page.evaluate(() => app.player.timeMs)) - 5500) < 50, 'the playhead in shot 2');
  // the app's key map (a lane canvas has keys of its own); a focus change repaints the points a little: before the picture
  await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(800);
  await page.evaluate(() => snap());
  await pressF();
  ok(same(await page.evaluate(() => TR.run(B).flips), [1]), 'F flipped scene 2 of B');
  const h1 = await page.evaluate(() => holds(B));
  ok(h1.length >= 3 && h1.every((p) => p < 50), `after F: the holds at the deep end (${h1})`);
  ok(same(await page.evaluate(() => sig(B)), good), 'after F: B\'s ghost = A\'s (tracked the right way up), point for point');
  const c1 = await page.evaluate(() => changedCols()), px = (ms) => Math.round((ms / 8000) * W);
  // (the point markers repaint a little once the ghost is rescored after any change: their columns are left out)
  const marks = new Set(base.flatMap(([t]) => { const o = []; for (let x = px(t - 25); x <= px(t + 25); x++) o.push(x); return o; }));
  const changed = (lo, hi, c = c1) => { let n = 0; for (let x = Math.max(0, px(lo)); x < Math.min(W, px(hi)); x++) if (!marks.has(x)) n += c[x]; return n; };
  ok(changed(4300, 7700) > 0.5 * (px(7700) - px(4300)), `painted: B's trace changed over shot 2 (${changed(4300, 7700)} of ${px(7700) - px(4300)} columns)`);
  ok(changed(0, 3700) === 0, `painted: the trace unchanged over shot 1 (${changed(0, 3700)} columns)`);

  // ---- 2. F again; the strip click ----
  await pressF();
  ok(same(await page.evaluate(() => sig(B)), base) && (await page.evaluate(() => TR.run(B).flips.length)) === 0, 'F again: as tracked');
  const c2 = await page.evaluate(() => changedCols());
  ok(changed(0, 3700, c2) === 0 && changed(4300, 7700, c2) < 0.05 * (px(7700) - px(4300)), `painted: the trace as before (${changed(0, 8000, c2)} columns differ off the points)`);
  await page.waitForSelector('.strip .seg.sign', { timeout: 10000 });
  const strip = await page.locator('.strip:has(.seg.sign)').boundingBox();
  await page.mouse.click(strip.x + (6000 / 8000) * strip.width, strip.y + strip.height / 2);
  await page.waitForTimeout(600);
  ok(same(await page.evaluate(() => sig(B)), good), 'a click on scene 2 of the strip: the same as F');
  console.log(fails ? `FAILED: ${fails}` : 'all ok');
} finally { await browser.close().catch(() => {}); }
process.exit(fails ? 1 : 0);
