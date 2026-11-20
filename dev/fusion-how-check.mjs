// dev/fusion-how-check.mjs -- paw-t11b in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env).
// A synthetic run (test/how-synth.mjs: impact strokes, the Top's balls swinging after each deep turn, a wandering head)
// linked to 'fused' with Smart stroke on. It asserts
//   1. the fusion panel draws the HOW strip over the shot: a cell per half-stroke, a tick per turn, impact dots, the playhead;
//   2. the line under it reads the stroke under the playhead: its type, its shape, the deep turn's rest and the parts that
//      say so, the impact and the ringing balls, the hold score;
//   3. the ghost carries holds and midpoints (the Detail read HOW), its turns where they are without it;
//   4. a run with only the stroking parts says HOW is not used there.
//   SHOT_DIR=<dir> node dev/fusion-how-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { track, howRun } from '../test/how-synth.mjs';

const shots = process.env.SHOT_DIR || null;
const tr0 = track(Array.from({ length: 24 }, () => ({ kind: 'impact', T: 700, rest: 0.45 })));
const chansOf = (run) => Object.fromEntries(Object.entries(run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
const full = chansOf(howRun(tr0, { seed: 2 })), plain = chansOf(howRun(tr0, { seed: 2, parts: ['c2_hips', 'c2_penis', 'c1_hips'] }));
const END = tr0.t[tr0.N - 1] + 1;
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const shot = async (name, loc) => { if (shots) await (loc || page).screenshot({ path: `${shots}/${name}.png` }); };
const load = (chans) => page.evaluate(({ chans, END }) => {
  const D = window.__pawDev, tr = D.trackingFor(app);
  window.TR = tr;
  tr.runs = []; app.doc.ghosts = []; tr.select('');
  app.setMode('track');
  app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'fusionhow0001' } };
  app.doc.project = { ...(app.doc.project || {}), path: 'C:\\pawtest\\fusion-how.pawproj' };
  app.doc.scenes = [{ start_ms: 0, end_ms: END, tags: ['penetration'] }];
  const T = chans.who_pair_proj.map(([t]) => t);
  const run = D.makeRun({ n: 3, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: END }, roi: null,
    result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: END - 100, pos: 100 }], scenes: [{ start_ms: 0, end_ms: END, sign: 1 }], channels: chans, notes: [] },
    frames: D.newFrames(), runs: [] });
  tr.runs = [run];
  app.doc.ghosts = [tr.ghostOf(run)];
  tr.select(run.id);
  window.RID = run.id;
  app.setView({ start: 0, span: END });
  tr.linkScene(0, run.id, 'fused');
  tr.setSmart(0, true);
  tr.setDetailAt(0, 'scene', { shape: 'hold', sens: 50 });   // paw-na9u: the old Detail (By render is the default now) reads HOW's holds / midpoints
  window.whys = () => { const g = TR.ghost(RID); return (g.script || []).map((p) => TR.whyAt(TR.runs[0], p.at) || ''); };
}, { chans, END });
// 145370e (paw-p8o2): the shot's Adjust strip (and its fusion panel) lives only in the band under the stroke lane: unfold it (its ▾)
const openBand = async () => {
  await page.waitForSelector('[data-testid="inspector-more"]:not([disabled])', { timeout: 15000 });
  await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); });
  await page.waitForSelector('[data-testid="derive-strip"]', { timeout: 10000 });
};
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await page.evaluate(() => app.settings.set('tracking.panel.open', { fusion: true, camera: true, strokes: true, run: true }));   // paw-r73w: the folds this check reads, open
  await load(full);
  // the playhead on an in-move that lands with an impact (the 6th stroke's in-move)
  await page.evaluate(() => app.player.seek(300 + 5 * 700 + 315 + 150));
  await openBand();
  const panel = page.locator('[data-testid="fuse-panel"]');
  await panel.waitFor({ timeout: 15000 });
  const strip = panel.locator('[data-testid="fuse-how"]');
  await strip.waitFor({ timeout: 15000 });
  await strip.scrollIntoViewIfNeeded();
  const geo = await strip.evaluate((s) => ({ cells: s.querySelectorAll('rect:not(.dw)').length, ticks: s.querySelectorAll('rect.dw').length, hits: s.querySelectorAll('circle.hit').length, head: !!s.querySelector('line.head'), w: s.getBoundingClientRect().width, h: s.getBoundingClientRect().height }));
  ok(geo.cells >= 40 && geo.ticks >= 40 && geo.head && geo.w > 100 && geo.h >= 12, `the strip: ${geo.cells} half-strokes, ${geo.ticks} turn ticks, playhead ${geo.head}, ${Math.round(geo.w)}x${Math.round(geo.h)} px`);
  ok(geo.hits >= 18, `impact dots on the deep turns: ${geo.hits}`);
  await page.evaluate(() => app.player.seek(300 + 5 * 700 + 315 + 150));
  await page.waitForFunction(() => /^Type /.test(document.querySelector('[data-testid="fuse-how-now"]')?.innerText || ''), null, { timeout: 5000 }).catch(() => {});
  const now = await panel.locator('[data-testid="fuse-how-now"]').innerText();
  ok(/^Type [A-Z] \(\d+\)/.test(now) && /slow then fast/.test(now), `the stroke under the playhead: its type and shape ("${now}")`);
  ok(/deep turn: rests \d+ %/.test(now) && /impact/.test(now) && /balls[^)]* ring/.test(now) && /hold score/.test(now), 'its deep turn: the rest, the impact, the ringing balls, the hold score');
  await shot('how-panel', panel);
  await shot('how-strip', strip);
  const w = await page.evaluate(() => whys());
  const holds = w.filter((x) => x === 'hold').length, mids = w.filter((x) => x === 'mid').length;
  ok(holds >= 18 && mids >= 18, `the ghost: ${holds} holds, ${mids} midpoints on 24 impact strokes`);
  // a plain run (only the stroking parts): HOW described, not used
  await load(plain);
  await page.evaluate(() => app.player.seek(2000));
  await openBand();
  await strip.waitFor({ timeout: 15000 });
  const t2 = await panel.locator('[data-testid="fuse-how-now"]').innerText();
  ok(/not used here/i.test(await panel.innerText()) && /reads the signal alone/.test(t2), `a run with only the stroking parts: "${t2}"`);
  await shot('how-panel-not-used', panel);
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failed` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
