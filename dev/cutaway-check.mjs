// dev/cutaway-check.mjs -- paw-2lp7.4 (the owner: "cutaway is to something not action; off screen is not on screen but
// continuing") in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a copy of a generated clip
// (dev/assets/assist60.mp4) in a folder of yours, by real pointer and key events, asserted on what is PAINTED (the Scenes and
// shots row's canvas text) and on the bridge the live script plays there.
//   node dev/cutaway-check.mjs <clip.mp4> [--shots <dir>]
// Shots A 0-10 s | insert 10-14 | A' 14-24 | D 24-30 | E 30-40 | F 40-60; the action on A, on A' (the same) and on E-F; strokes
// on A, A', E, F. 1. the fingerprint stage's proposal for A [insert] A' (injected: the footage of a generated clip is no
// test of the matcher, dev/crop-scene-check does that): a dashed "off-screen?" card; a click on it: the insert off-screen,
// one action across A..A', one undo step; the card says "off-screen · bridged"; the ghost bridges the insert with the
// neighbours' rhythm (turn spacing within 60 ms of their 400 ms) and joins both sides. 2. D selected, C: a cutaway with no
// action over it: "intermission", no ghost point across it. 3. the card's "carry ↔" button: the action drawn across D, the
// card flips to "action continues" by itself, the ghost bridges D. 4. the cut after the insert one frame later (.): the
// bridge follows the new span. Every step one undo step; undo takes each back. Every page exception and console error fails it.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { stripLayout, bandsIn } from '../src/features/timeline/actions-strip.js';
import { layerRects } from '../src/features/timeline/shots.js';
import { shotButtons, shotsGrip } from '../src/features/timeline/scenes-hit.js';

const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const src = args[0], shotsDir = opt('shots');
if (!src) { console.error('usage: node dev/cutaway-check.mjs <clip.mp4> [--shots <dir>]'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const settle = async (pred) => { for (let k = 0; k < 40; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
const J = JSON.stringify;
const steps = () => ev(() => app._history.entries.length);
const shoot = async (name) => { if (!shotsDir) return; mkdirSync(shotsDir, { recursive: true }); const el = await page.$('[data-tl-lane="scenes"]'); await el.screenshot({ path: join(shotsDir, name + '-row.png') }); };
const hookText = () => ev(() => {
  window.__ft = [];
  if (window.__ftHooked) return;
  const o = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { if (this.canvas?.closest?.('[data-tl-lane]')?.getAttribute('data-tl-lane') === 'scenes') window.__ft.push(String(t)); return o.call(this, t, ...a); };
  window.__ftHooked = true;
});
/** What the row paints now (its canvas text), after a forced repaint. */
const painted = async () => { await ev(() => { const v = app.view; app.setView({ start: v.start, span: v.span + 1 }); }); await wait(250); await ev(() => { window.__ft = []; const v = app.view; app.setView({ start: v.start, span: v.span - 1 }); }); await wait(350); return ev(() => window.__ft.slice()); };
/** The row's geometry now: canvas rect, the strip layout, x(t), and the cards (shots.js layerRects, as ScenesLane draws them). */
async function geo() {
  const g = await ev(() => { const c = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(); return { left: c.left, top: c.top, w: c.width, h: c.height, v: { ...app.view }, acts: app.doc.acts || [], list: app.doc.scenes }; });
  // (bandsIn: the bands the strip shows, the empty one above those in use included since befd421)
  const L = stripLayout(g.h, bandsIn(g.acts, g.v.start, g.v.start + g.v.span)), xl = (t) => ((t - g.v.start) / g.v.span) * g.w;
  const R = layerRects(g.list, xl, { sh: L.sh, y1: L.y1, h: g.h, gap: 2 });
  return { ...g, L, R, x: (t) => g.left + xl(t), yShots: g.top + (L.y1 + g.h) / 2 };
}
/** The bridge's points over (t0, t1): live in the script since 2e31f7a (paw-x7w7: no 'scene-bridge' preview ghost any more; a
 *  shot with no baked points plays its bridge, what the lanes draw and a publish writes). */
const ghostIn = (t0, t1) => ev(([a, b]) => (app.liveOf?.('stroke')?.script || []).filter((p) => p.at > a && p.at < b), [t0, t1]);
const strokes = (t0, t1, half) => { const o = []; for (let t = t0 + 100, k = 0; t < t1 - 100; t += half, k++) o.push({ at: t, pos: k % 2 ? 85 : 15 }); return o; };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
/** Turn spacing of a script: the gaps between its alternating extremes (midpoints a dressing adds are skipped). */
const turnGaps = (s) => { const t = s.filter((p, i) => i === 0 || i === s.length - 1 || (p.pos - s[i - 1].pos) * (s[i + 1].pos - p.pos) < 0); return t.slice(1).map((p, i) => p.at - t[i].at); };

try {
  const mine = join(dirname(src), 'cut-' + basename(src));
  if (mine !== src) copyFileSync(src, mine);
  await hookText();
  await ev(() => app.load({}));
  ev((p) => app.project.openVideo(p, { force: true }), mine).catch(() => {});
  ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), `the clip opened (${basename(mine)})`);
  await page.waitForFunction(() => window.__pawDev?.trackingFor, null, { timeout: 60000 });
  const P = ['anal', 'penetration'], O = ['oral', 'penetration'];
  const pts = [...strokes(0, 10000, 400), ...strokes(14000, 24000, 400), ...strokes(30000, 60000, 300)];
  await ev(([pts, P, O]) => {
    window.__tr = window.__pawDev.trackingFor(app);
    app.setMode('scenes'); app.player.pause();
    app.doc.scenes = [[0, 10000], [10000, 14000], [14000, 24000], [24000, 30000], [30000, 40000], [40000, 60000]].map(([a, b]) => ({ start_ms: a, end_ms: b }));
    app.doc.acts = [{ id: 'a1', kind: 'act', t0: 0, t1: 10000, layer: 0, tags: P }, { id: 'a2', kind: 'act', t0: 14000, t1: 24000, layer: 0, tags: P }, { id: 'a3', kind: 'act', t0: 30000, t1: 60000, layer: 0, tags: O }];
    app.edit('Strokes', 'stroke', pts);
    app.setView({ start: 8000, span: 30000 });   // the cards wide enough for their words and buttons
  }, [pts, P, O]);
  await wait(600);

  // 1. the proposal: a dashed "off-screen?" card over the insert; a click on its raised part takes it
  // the fingerprint pass after the scene edit runs first (frames decoded in the background): let it finish, then inject
  // (done = its scanInfo for these six shots: the first shotLinks change came before its proposals on a loaded PC, and its
  // proposals then replaced the injected one; paw-mawd)
  await ev(() => { window.__scan0 = __tr.scanInfo; });
  await page.waitForFunction(() => __tr.scanInfo !== window.__scan0 && __tr.scanInfo?.shots === 6, null, { timeout: 120000 }).catch(() => console.log('     (the shot scan had not finished after 120 s)'));
  await ev(() => { __tr.proposed = new Map([[14000, 0]]); });
  await wait(400);
  ok((await painted()).includes('off-screen?'), 'the insert between the same footage is proposed as OFF-SCREEN ("off-screen?" painted)');
  let g = await geo(), n = await steps();
  await page.mouse.click(g.x(12000), g.top + (g.R.top + g.L.sh) / 2);
  await wait(500);
  const s1 = await ev(() => ({ tags: app.doc.scenes[1].tags || [], main: (app.doc.acts || []).filter((r) => r.layer === 0).map((r) => [r.t0, r.t1]) }));
  ok(s1.tags.includes('offscreen') && J(s1.main.slice(0, 1)) === J([[0, 24000]]), `taken: the insert off-screen, one action across A..A' (${J(s1)})`);
  ok((await steps()) === n + 1, 'one undo step');
  let text = await painted();
  ok(text.includes('off-screen') && text.includes('bridged'), `the card paints "off-screen · bridged" (${text.filter((t) => /off|bridg|cutaway|interm|continu/.test(t)).join(' | ')})`);
  const b1 = await ghostIn(10000, 14000), gaps = turnGaps(b1);
  ok(b1.length >= 6 && Math.abs(med(gaps) - 400) <= 60, `the ghost bridges the insert with the neighbours' rhythm: ${b1.length} points, median turn spacing ${med(gaps)} ms (theirs 400)`);
  ok(b1[0].at - 10000 <= 500 && 14000 - b1.at(-1).at <= 500, `it joins both sides (first ${b1[0].at}, last ${b1.at(-1).at})`);
  await shoot('1-offscreen');

  // 2. D selected on the Shots strip, Alt+C (paw-qbvj: C is circle select): a cutaway with no action over it = an intermission, nothing across it
  g = await geo();
  await page.mouse.click(g.x(27000), g.yShots); await wait(300);
  n = await steps();
  await page.keyboard.press('Alt+c'); await wait(500);
  ok((await ev(() => app.doc.scenes[3].tags || [])).includes('cutaway') && (await steps()) === n + 1, 'Alt+C marks D a cutaway, one undo step');
  text = await painted();
  ok(text.includes('intermission'), `the card paints "intermission" (${text.filter((t) => /interm|continu|cutaway/.test(t)).join(' | ')})`);
  ok((await ghostIn(24000, 30000)).length === 0, 'no ghost point across the intermission');
  await shoot('2-intermission');

  // 3. the card's "carry ↔": the action drawn across D; the card flips by itself and D is bridged like off-screen
  g = await geo();
  const r3 = g.R.shots[3], cy = g.top + (r3.y0 + r3.y1) / 2;
  await page.mouse.move(g.x(26000), cy); await page.mouse.move(g.x(27000), cy, { steps: 3 }); await wait(400);
  const bt = shotButtons(r3, shotsGrip(g.L.sh + 1, g.h), { extend: true }).find((b) => b.id === 'extend');
  ok(!!bt, 'the card has its "carry ↔" button');
  n = await steps();
  await page.mouse.click(g.left + (bt.x0 + bt.x1) / 2, g.top + (bt.y0 + bt.y1) / 2); await wait(500);
  const a3 = await ev(() => (app.doc.acts || []).filter((r) => r.layer === 0).map((r) => [r.t0, r.t1]));
  ok(a3.some(([t0, t1]) => t0 <= 24000 && t1 >= 30000) && (await steps()) === n + 1, `the action drawn across D, one undo step (${J(a3)})`);
  text = await painted();
  ok(text.includes('action continues') && !text.includes('intermission'), `the card flipped: "action continues" (${text.filter((t) => /interm|continu/.test(t)).join(' | ')})`);
  const b3 = await ghostIn(24000, 30000);
  ok(b3.length >= 6, `D is bridged like off-screen (${b3.length} ghost points)`);
  await shoot('3-carried');
  await ev(() => app.undo()); await wait(400);
  ok((await painted()).includes('intermission') && (await ghostIn(24000, 30000)).length === 0, 'undo: an intermission again, nothing across it');
  await ev(() => app.redo()); await wait(400);

  // 4. the cut after the insert one frame later: the bridge follows the new span (nothing stale)
  const fm = await ev(() => app.player.frameMs);
  await ev(() => { app.player.seek(14000, { exact: true }); }); await wait(400);
  g = await geo();
  await page.mouse.click(g.x(35000), g.yShots); await wait(200);   // the keyboard on the row (a shot click), then the playhead back at the cut
  await ev(() => { app.player.seek(14000, { exact: true }); }); await wait(400);
  n = await steps();
  await page.keyboard.press('.'); await wait(500);
  const cut = await ev(() => app.doc.scenes[2].start_ms);
  ok(Math.abs(cut - 14000 - fm) < 1 && (await steps()) === n + 1, `the cut one frame later (${cut}), one undo step`);
  const br = await ev(() => __tr.bridges.find((b) => b.t0 === 10000));
  const b4 = await ghostIn(10000, cut + 1);
  ok(br && Math.abs(br.t1 - cut) < 1 && b4.every((p) => p.at < cut), `the bridge follows the new span (to ${br?.t1})`);
  await ev(() => app.undo()); await wait(400);
  ok((await ev(() => app.doc.scenes[2].start_ms)) === 14000 && (await ev(() => __tr.bridges.find((b) => b.t0 === 10000)?.t1)) === 14000, 'undo: the cut and the bridge back');
} catch (e) { fails++; console.log('FAIL', e?.message || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
