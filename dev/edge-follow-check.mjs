// dev/edge-follow-check.mjs -- paw-cp8k "when dragging things on the timeline a follow would be nice": a drag held near the left /
// right edge of a row pans the view (lib/edge-scroll.js) and the dragged thing keeps the pointer's time with NO pointer movement;
// the release stops it; Esc cancels the drag and puts the item AND the view back. Real pointer / key events over CDP in YOUR test
// instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a copy of a generated clip >= 40 s.
//   node dev/edge-follow-check.mjs <clip.mp4>
// Zoomed to 10 s of the clip: (1) an action region's end held at the right edge: the view's start and the frame under the edge
// (the playhead: the region drag shows it) keep growing; released: the view stops, the committed end is the pointer's time
// under the moved view. (2) its start held at the left edge: the view goes down to exactly 0, never below, and stays. (3) the same
// end, Esc while held: the region and the view as before the press, no undo step. (4) a cut (its grip on the Shots band) and
// (5) one lane point (Refine; the point drag scrubs: lanes.dragScrub) held at the right edge: as (1). (6) paw-cp8k, the owner's
// "when dragging modifiers to follow position scrub thingy": a modifier's end dragged on the Modifiers row shows the frame
// under it, as an action region's edge does, and follows the edge as (1). Every page exception and console error fails it.
import { copyFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { stripLayout, bandsIn } from '../src/features/timeline/actions-strip.js';
import { posToY } from '../src/features/lanes/geom.js';

const src = process.argv[2];
if (!src) { console.error('usage: node dev/edge-follow-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const settle = async (pred) => { for (let k = 0; k < 40; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
const r1 = (v) => Math.round(v);
const steps = () => ev(() => app._history.entries.length);
const now = () => ev(() => ({ vs: app.view.start, span: app.view.span, tm: app.player.timeMs, st: app.player.scrubTime }));
const VIEW = { start: 8000, span: 10000 };
const setView = async (v = VIEW) => { await ev((v) => app.setView(v), v); await wait(300); };
/** A row's canvas rect and x(t) under the view now. */
const rect = (sel) => ev((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height, v: { ...app.view } }; }, sel);
const xOf = (g, t) => g.left + ((t - g.v.start) / g.v.span) * g.w;
const tAt = (g, v, x) => v.start + ((x - g.left) / g.w) * v.span;
const SCENES = '[data-tl-lane="scenes"] canvas', FX = '[data-tl-lane="fx"] canvas', LANE = 'canvas.over[aria-label^="stroke lane"]';
const cursorOf = (sel) => ev((sel) => document.querySelector(sel).style.cursor, sel);

/** Press at (x, y), go to the row's edge (right: w - 6 px, left: 6 px), hold: samples at the start of the hold and every 300 ms. */
async function holdAtEdge(g, x, y, side, { holds = 2, release = true } = {}) {
  const xe = side === 'right' ? g.left + g.w - 6 : g.left + 6;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + (xe - x) / 2, y, { steps: 4 }); await page.mouse.move(xe, y, { steps: 6 });
  const s = [await now()];
  for (let k = 0; k < holds; k++) { await wait(300); s.push(await now()); }
  if (release) await page.mouse.up();
  return { s, xe };
}
const rising = (a, k) => a.every((q, i) => i === 0 || q[k] > a[i - 1][k]);
async function stops(label) {
  const a = (await now()).vs; await wait(400); const b = (await now()).vs;
  ok(a === b, `${label}: released, the view stops (${r1(a)} -> ${r1(b)})`);
  return b;
}

try {
  const mine = join(dirname(src), 'edge-' + basename(src));
  if (mine !== src) copyFileSync(src, mine);
  await ev(() => app.load({}));
  ev((p) => app.project.openVideo(p, { force: true }), mine).catch(() => {});
  ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), `the clip opened (${basename(mine)})`);
  const dur = await ev(() => app.durationMs), fm = await ev(() => app.player.frameMs);
  ok(dur >= 39000, `the clip is long enough (${r1(dur)} ms)`);
  await ev((dur) => {
    app.setMode('scenes'); app.player.pause(); app.settings.set('player.follow', true);
    app.doc.scenes = [{ start_ms: 0, end_ms: 15000 }, { start_ms: 15000, end_ms: dur }];
    app.doc.acts = [{ id: 'ef1', kind: 'act', t0: 10000, t1: 14000, layer: 0, tags: [] }];
    app.doc.fx = [];
  }, dur);
  await wait(600);
  const snapPx = (g) => (10 / g.w) * g.v.span + 2 * fm;   // the drags' snap reach (7-8 px) and the frame grid

  // (1) an action region's end held at the right edge
  await setView();
  let g = await rect(SCENES), L = stripLayout(g.h, bandsIn(await ev(() => app.doc.acts), g.v.start, g.v.start + g.v.span));
  const yMain = g.top + (L.main.y0 + L.main.y1) / 2;
  let n0 = await steps();
  // the video's first seeks after the open can lag the drag (seen: the playhead still 0 for 600 ms on the rig): warm it first, and
  // judge the frame from the second sample on (the region itself is judged by its committed end below)
  for (const t of [5000, 12000]) { await ev((t) => app.player.seek(t, { exact: true }), t); for (let k = 0; k < 20 && Math.abs((await now()).tm - t) > 50; k++) await wait(250); }
  let h = await holdAtEdge(g, xOf(g, 14000) - 1, yMain, 'right', { holds: 3 });
  console.log('     held:', h.s.map((q) => `view ${r1(q.vs)} frame ${r1(q.tm)}`).join(' | '));
  ok(rising(h.s, 'vs'), 'region end at the right edge: the view keeps moving later with the pointer still');
  ok(rising(h.s.slice(1), 'tm'), 'and the frame under the dragged end keeps growing (no pointer movement)');
  let vEnd = await stops('region end');
  let a = await ev(() => app.doc.acts[0]), want = tAt(g, { start: vEnd, span: VIEW.span }, h.xe);
  ok(Math.abs(a.t1 - want) <= snapPx(g) && a.t1 > 18000, `the committed end is the pointer's time under the moved view (${r1(a.t1)} vs ${r1(want)})`);
  ok((await steps()) === n0 + 1, 'one undo step');

  // (2) its start held at the left edge: down to 0, never below
  await setView();
  g = await rect(SCENES); n0 = await steps();
  a = await ev(() => app.doc.acts[0]);
  const x0 = xOf(g, a.t0) + 1, xl = g.left + 6;
  await page.mouse.move(x0, yMain); await page.mouse.down();
  await page.mouse.move((x0 + xl) / 2, yMain, { steps: 4 }); await page.mouse.move(xl, yMain, { steps: 6 });
  const seen = [];
  for (let k = 0; k < 30; k++) { const q = await now(); seen.push(q.vs); if (q.vs === 0) break; await wait(100); }
  await wait(400); seen.push((await now()).vs);
  ok(Math.min(...seen) === 0 && seen.at(-1) === 0, `region start at the left edge: the view goes down to exactly 0 and stays (${seen.map(r1).join(' ')})`);
  await page.mouse.up();
  await stops('region start');
  a = await ev(() => app.doc.acts[0]);
  ok(a.t0 >= 0 && a.t0 <= tAt(g, { start: 0, span: VIEW.span }, xl) + snapPx(g), `the start lands at the pointer near 0, never negative (${r1(a.t0)})`);
  ok((await steps()) === n0 + 1, 'one undo step');

  // (3) Esc while held: the region and the view as before the press (the end ~6 s into the view)
  const V3 = { start: r1((await ev(() => app.doc.acts[0].t1)) - 6000), span: VIEW.span };
  await setView(V3);
  g = await rect(SCENES); n0 = await steps();
  const before = JSON.stringify(await ev(() => app.doc.acts)), tm0 = (await now()).tm;
  a = await ev(() => app.doc.acts[0]);
  h = await holdAtEdge(g, xOf(g, a.t1) - 1, yMain, 'right', { holds: 2, release: false });
  ok(h.s.at(-1).vs > V3.start, `held: the view moved (${r1(h.s.at(-1).vs)})`);
  await page.keyboard.press('Escape'); await wait(150);
  const afterEsc = await now(); await wait(400); const later = await now();
  await page.mouse.move(h.xe - 20, yMain, { steps: 2 }); await page.mouse.up(); await wait(250);
  ok(afterEsc.vs === V3.start && later.vs === V3.start, `Esc: the view back where the drag began and still (${r1(afterEsc.vs)}, ${r1(later.vs)})`);
  ok(JSON.stringify(await ev(() => app.doc.acts)) === before, 'Esc: the region unchanged');
  ok((await steps()) === n0, 'Esc: no undo step');
  console.log(`     (Esc: the playhead stays where the drag showed it, as before this change: ${r1(tm0)} -> ${r1((await now()).tm)})`);

  // (4) a cut on the Shots band (its grip) held at the right edge
  await setView();
  g = await rect(SCENES); n0 = await steps();
  const xc = xOf(g, 15000);
  let gy = null;
  for (let y = g.top + 2; y < g.top + g.h - 1 && gy == null; y += 2) { await page.mouse.move(xc, y); if ((await cursorOf(SCENES)) === 'col-resize') gy = y; }
  if (ok(gy != null, `the cut's grip found (y ${gy && r1(gy - g.top)} of ${r1(g.h)})`)) {
    h = await holdAtEdge(g, xc, gy, 'right');
    ok(rising(h.s, 'vs'), `cut at the right edge: the view keeps moving (${h.s.map((q) => r1(q.vs)).join(' ')})`);
    vEnd = await stops('cut');
    const cut = await ev(() => app.doc.scenes[1]?.start_ms);
    want = tAt(g, { start: vEnd, span: VIEW.span }, h.xe);
    ok(Math.abs(cut - want) <= snapPx(g) && cut > 18000, `the committed cut is the pointer's time under the moved view (${r1(cut)} vs ${r1(want)})`);
    ok((await steps()) === n0 + 1, 'one undo step');
  }

  // (6) a modifier: its end dragged shows the frame under it; held at the right edge it follows
  await setView();
  g = await rect(FX);
  const yFx = g.top + g.h / 2;
  await page.mouse.move(xOf(g, 9000), yFx); await page.mouse.down(); await page.mouse.move(xOf(g, 10000), yFx, { steps: 4 }); await page.mouse.move(xOf(g, 11000), yFx, { steps: 4 }); await page.mouse.up();
  await wait(300); await page.keyboard.press('Escape'); await wait(200);   // the kind picker at the release
  const ranged = () => ev(() => (app.doc.fx || []).filter((f) => f.t1 - f.t0 > 500));
  let fx = await ranged();
  if (ok(fx.length === 1, `a modifier marked on the row (${fx.map((f) => `${f.kind} ${r1(f.t0)}-${r1(f.t1)}`).join(', ')})`)) {
    n0 = await steps();
    const t1 = fx[0].t1;
    await page.mouse.move(xOf(g, t1) - 1, yFx); await page.mouse.down();
    await page.mouse.move(xOf(g, t1) + 60, yFx, { steps: 4 }); await page.mouse.move(xOf(g, t1) + 120, yFx, { steps: 4 }); await wait(200);
    const mid = await now(), wantMid = tAt(g, g.v, xOf(g, t1) + 120);
    ok(Math.abs(mid.tm - wantMid) <= snapPx(g), `modifier end dragged: the picture shows the frame under it (${r1(mid.tm)} vs the pointer ${r1(wantMid)})`);
    await page.mouse.up(); await wait(300);
    fx = await ranged();
    const tmUp = (await now()).tm;
    ok(Math.abs(tmUp - fx[0].t1) < fm + 1, `released: the playhead stays on the moved end (${r1(tmUp)} vs end ${r1(fx[0].t1)})`);
    await setView();
    g = await rect(FX); n0 = await steps();
    h = await holdAtEdge(g, xOf(g, fx[0].t1) - 1, yFx, 'right');
    ok(rising(h.s, 'vs') && rising(h.s, 'tm'), `modifier end at the right edge: the view and the frame under it keep moving (${h.s.map((q) => `${r1(q.vs)}/${r1(q.tm)}`).join(' ')})`);
    vEnd = await stops('modifier end');
    fx = await ranged();
    want = tAt(g, { start: vEnd, span: VIEW.span }, h.xe);
    ok(Math.abs(fx[0].t1 - want) <= snapPx(g), `the committed modifier end is the pointer's time under the moved view (${r1(fx[0].t1)} vs ${r1(want)})`);
    ok((await steps()) === n0 + 1, 'one undo step');
  }

  // (5) one lane point (Refine): the last point held at the right edge
  await ev(() => {
    app.setMode('refine'); app.setActiveAxis('stroke');
    const pts = Array.from({ length: 16 }, (_, i) => ({ at: i * 1000, pos: i === 15 ? 50 : i % 2 ? 80 : 20 }));
    app.transact('Seed', () => app.edit('Seed', 'stroke', pts));
    app.select([15000], 'stroke');
  });
  await wait(700);
  await setView();
  g = await rect(LANE); n0 = await steps();
  const xp = xOf(g, 15000);
  let yp = g.top + posToY(g.h, 50);
  await page.mouse.move(xp, yp); await wait(100);
  if ((await cursorOf(LANE)) !== 'grab') for (const d of [-4, 4, -8, 8, -12, 12]) { await page.mouse.move(xp, g.top + posToY(g.h, 50) + d); if ((await cursorOf(LANE)) === 'grab') { yp = g.top + posToY(g.h, 50) + d; break; } }
  if (ok((await cursorOf(LANE)) === 'grab', `the point at 15 s is under the pointer (cursor ${await cursorOf(LANE)})`)) {
    h = await holdAtEdge(g, xp, yp, 'right');
    ok(rising(h.s, 'vs'), `lane point at the right edge: the view keeps moving (${h.s.map((q) => r1(q.vs)).join(' ')})`);
    ok(rising(h.s, 'tm'), `and the dragged point's frame keeps growing (drag scrub: ${h.s.map((q) => r1(q.tm)).join(' ')})`);
    vEnd = await stops('lane point');
    const last = await ev(() => app.doc.axes.stroke.at(-1));
    want = tAt(g, { start: vEnd, span: VIEW.span }, h.xe);
    ok(Math.abs(last.at - want) <= snapPx(g) && last.at > 18000, `the committed point is the pointer's time under the moved view (${r1(last.at)} vs ${r1(want)}, pos ${last.pos})`);
    ok((await steps()) === n0 + 1, 'one undo step');
  }

  // a drag that never reaches the bands: the view never moves
  await setView();
  g = await rect(LANE);
  const v0 = (await now()).vs;
  await page.mouse.move(xOf(g, 12000), g.top + g.h / 2); await page.mouse.down(); await page.mouse.move(xOf(g, 15000), g.top + g.h / 2 + 10, { steps: 8 }); await wait(500);
  ok((await now()).vs === v0, 'a box drag in the middle of the lane: the view stays');
  await page.mouse.up(); await wait(200);
} catch (e) {
  fails++;
  console.log('FAIL [check]', e?.stack || e);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failure(s)` : 'all ok');
process.exit(fails ? 1 : 0);
