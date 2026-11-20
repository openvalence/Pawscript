// dev/positioning-check.mjs -- paw-2lp7.1 (the owner: "a character moving into position before starting the action ... tracking
// that kind of thing generally causes the range of motion elsewhere to falter") in YOUR test instance (node dev/test-app.mjs
// start ...; the CDP_* env it prints), on a copy of a generated clip in a folder of yours, by real pointer and key events,
// asserted on what is PAINTED (the Scenes and shots row's canvas text, the kit tooltip) and on the ghosts the lanes draw.
//   node dev/positioning-check.mjs <clip.mp4> [--shots <dir>]
// One 15 s shot, one main-line action over it, a synthetic tracked run linked to its g1_proj channel: 1 Hz strokes 0-3 s, a big
// slow move (up 4 stroke swings and back) 3-6 s, 1 Hz strokes 6-15 s. 1. unmarked: the run ghost's strokes after the move are
// squashed by it. 2. a drag on the positioning lane over 3-6 s: a positioning range (one undo step), the action untouched, its
// card painted "positioning · eased, out of range", its tooltip says what it does; the run ghost recomputes live: no point
// inside, the strokes after it at least twice as big; the bridge ghost eases inside it from the level before to the first
// stroke after. 3. the ease plays live (paw-x7w7: no "Accept the ease"); Bake over the range: its points written (one undo step). 4. undo; Delete on
// the selected range: the run ghost exactly as before marking, no ease. 3b. (paw-24b8) its end edge held and dragged in steps:
// the live script inside changes at each step, Esc restores it, a release keeps it (one undo step). 5. the owner's points inside, marked again: they stay,
// no ease over them. Every page exception and console error fails it.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { stripLayout, bandsIn } from '../src/features/timeline/actions-strip.js';

const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const src = args[0], shotsDir = opt('shots');
if (!src) { console.error('usage: node dev/positioning-check.mjs <clip.mp4> [--shots <dir>]'); process.exit(2); }
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
const shoot = async (name) => { if (!shotsDir) return; mkdirSync(shotsDir, { recursive: true }); const el = await page.$('[data-tl-lane="scenes"]'); await el.screenshot({ path: join(shotsDir, name + '-row.png') }); await page.screenshot({ path: join(shotsDir, name + '-window.png') }); };
const hookText = () => ev(() => {
  window.__ft = [];
  if (window.__ftHooked) return;
  const o = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { if (this.canvas?.closest?.('[data-tl-lane]')?.getAttribute('data-tl-lane') === 'scenes') window.__ft.push(String(t)); return o.call(this, t, ...a); };
  window.__ftHooked = true;
});
const painted = async () => { await ev(() => { const v = app.view; app.setView({ start: v.start, span: v.span + 1 }); }); await wait(250); await ev(() => { window.__ft = []; const v = app.view; app.setView({ start: v.start, span: v.span - 1 }); }); await wait(350); return ev(() => window.__ft.slice()); };
async function geo() {
  const g = await ev(() => { const c = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(); return { left: c.left, top: c.top, w: c.width, h: c.height, v: { ...app.view }, acts: app.doc.acts || [] }; });
  // befd421: the strip shows one empty band above the regions in view (ScenesLane nLayers = bandsIn), not just the used layers
  const L = stripLayout(g.h, bandsIn(g.acts, g.v.start, g.v.start + g.v.span));
  return { ...g, L, x: (t) => g.left + ((t - g.v.start) / g.v.span) * g.w, y: (b) => g.top + (b.y0 + b.y1) / 2 };
}
async function drag(x0, y0, x1, y1) { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, y0, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up(); await wait(400); }
const tip = async (x, y) => { await page.mouse.move(x - 3, y); await page.mouse.move(x, y, { steps: 2 }); await wait(500); return ev(() => [...document.querySelectorAll('.k-tip .txt')].map((e) => e.textContent).join(' / ')); };
const runGhost = () => ev(() => (TR.ghost(RID)?.script || []).map((p) => ({ at: p.at, pos: p.pos })));
const bridgeIn = (a, b) => ev(([a, b]) => window.__pawDev.trackingFor(app).bridges.flatMap((x) => x.script).filter((p) => p.at > a && p.at < b), [a, b]);   // paw-x7w7: live, no bridge ghost
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
/** Median turn-to-turn swing of the points from t on. */
const swing = (s, t) => { const q = s.filter((p) => p.at >= t); return med(q.slice(1).map((p, i) => Math.abs(p.pos - q[i].pos))); };

// the run: 30 fps, 1 Hz strokes (+-1) 0-3 s and 6-15 s, a slow move up 8 and back 3-6 s
const pairs = [];
for (let ms = 0; ms < 15000; ms = Math.round(ms + 1000 / 30)) pairs.push([ms, ms >= 3000 && ms < 6000 ? (8 * (1 - Math.cos((2 * Math.PI * (ms - 3000)) / 3000))) / 2 : Math.sin((2 * Math.PI * ms) / 1000)]);

try {
  const mine = join(dirname(src), 'pos-' + basename(src));
  if (mine !== src) copyFileSync(src, mine);
  await hookText();
  await ev(() => app.load({}));
  ev((p) => app.project.openVideo(p, { force: true }), mine).catch(() => {});
  ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), `the clip opened (${basename(mine)})`);
  await page.waitForFunction(() => window.__pawDev?.trackingFor, null, { timeout: 60000 });
  await ev((pairs) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    app.setMode('scenes'); app.player.pause();
    tr.runs = []; app.doc.ghosts = [];
    app.doc.scenes = [{ start_ms: 0, end_ms: 15000 }];
    app.doc.acts = [{ id: 'a1', kind: 'act', t0: 0, t1: 15000, layer: 0, tags: ['anal', 'penetration'] }];
    const run = D.makeRun({ n: 1, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: { axis: 'auto' }, range: { start: 0, end: 15000 }, roi: null,
      result: { samples: pairs.map(([t]) => [t, 0.5]), points: [{ at: 100, pos: 50 }], scenes: [{ start_ms: 0, end_ms: 15000, sign: 1 }], channels: { g1_proj: pairs }, notes: [] }, frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    tr.linkScene(0, run.id, 'g1_proj');
    app.setView({ start: 0, span: 15000 });
    app.player.seek(9000);
  }, pairs);
  await wait(800);

  // 1. unmarked: the move squashes the strokes after it (the run's range spans it)
  const G0 = await runGhost(), s0 = swing(G0, 6300);
  ok(G0.length > 20 && G0.some((p) => p.at > 3000 && p.at < 6000), `the run ghost: ${G0.length} points, some inside the move; strokes after it ${s0} pos`);
  ok(s0 < 50, `unmarked, the strokes after the move are squashed by it (${s0} of 100)`);
  await shoot('0-unmarked');

  // 2. a drag on the positioning lane over the move
  let g = await geo(), n = await steps();
  await drag(g.x(3000), g.y(g.L.pos), g.x(6000), g.y(g.L.pos));
  const acts = await ev(() => app.doc.acts.map((r) => ({ ...r })));
  const P = acts.find((r) => r.kind === 'positioning'), A = acts.find((r) => r.kind === 'act');
  ok(P && Math.abs(P.t0 - 3000) < 120 && Math.abs(P.t1 - 6000) < 120, `a positioning range drawn: ${P ? `${Math.round(P.t0)}-${Math.round(P.t1)}` : 'none'}`);
  ok(A && A.t0 === 0 && A.t1 === 15000 && A.layer === 0, `the action under it untouched (${A ? `${A.t0}-${A.t1}, layer ${A.layer}` : 'gone'})`);
  ok((await steps()) === n + 1, 'one undo step');
  ok(J(await ev(() => app.doc.scenes[0].positioning)) === J([[P.t0, P.t1]]), 'the shot carries it (derived)');
  const text = await painted();
  ok(text.some((t) => /^positioning · eased/.test(t)), `its card paints what it does (${text.filter((t) => /posit/.test(t)).join(' | ') || 'nothing'})`);
  g = await geo();
  const tt = await tip(g.x((P.t0 + P.t1) / 2), g.y(g.L.pos));
  ok(/kept out of the range of motion/.test(tt) && /slow move/.test(tt), `its tooltip says it: "${tt.slice(0, 120)}"`);
  ok(!(await ev(() => !!document.querySelector('[data-tl-lane="scenes"] [title]'))), 'no native title on the row');
  await page.mouse.move(g.x(9000), g.top - 30); await wait(200);
  ok(await settle(() => !(TR.ghost(RID)?.script || []).some((p) => p.at > app.doc.acts.find((r) => r.kind === 'positioning').t0 && p.at < app.doc.acts.find((r) => r.kind === 'positioning').t1)), 'the run ghost recomputes live: no point inside the range');
  const G1 = await runGhost(), s1 = swing(G1, 6300);
  ok(s1 >= 2 * s0 && s1 >= 80, `the strokes after the move are no longer squashed: ${s0} -> ${s1} pos`);
  const before = G1.filter((p) => p.at < P.t0).at(-1), after = G1.find((p) => p.at >= P.t1);
  const E = await bridgeIn(P.t0, P.t1);
  ok(E.length >= 3 && E[0].pos === before.pos && E.at(-1).pos === after.pos && E.every((p, i) => !i || (p.pos - E[i - 1].pos) * (after.pos - before.pos) >= 0),
    `the bridge ghost eases inside it: ${E.length} points ${E[0]?.pos} -> ${E.at(-1)?.pos} (level before ${before.pos}, first stroke after ${after.pos})`);
  await shoot('1-marked');

  // 3. the ease plays live (paw-x7w7); Bake over the range writes it
  n = await steps();
  ok(J(await ev(([a, b]) => (app.liveOf?.('stroke')?.script || []).filter((p) => p.at > a && p.at < b), [P.t0, P.t1])) === J(E), 'the ease is in the script (live)');
  await ev(([a, b]) => app.commands.run('tracking.bake', { range: { t0: a, t1: b } }), [P.t0, P.t1]); await wait(500);
  const axis = await ev(([a, b]) => app.doc.axes.stroke.filter((p) => p.at > a && p.at < b), [P.t0, P.t1]);
  ok(J(axis) === J(E) && (await steps()) === n + 1, `baked: the ease's ${axis.length} points written, one undo step`);
  ok((await bridgeIn(P.t0, P.t1)).length === 0, 'nothing live there now');
  await ev(() => app.undo()); await wait(400);
  ok((await ev(([a, b]) => app.doc.axes.stroke?.filter((p) => p.at > a && p.at < b).length ?? 0, [P.t0, P.t1])) === 0 && (await bridgeIn(P.t0, P.t1)).length === E.length, 'undo: no points, the ease live again');

  // 3b. paw-24b8 (the owner: "when adjusting the positioning ease, update fusion in realtime"): the range's end edge dragged in
  // steps, NOT released: the live script inside it changes at every step; Esc gives it back exactly; the drag again, released:
  // what the drag showed stays, one undo step; undo: as before
  const liveIn = (a, b) => ev(([a, b]) => (app.liveOf?.('stroke')?.script || []).filter((p) => p.at > a && p.at < b).map((p) => [p.at, p.pos]), [a, b]);
  const L0 = await liveIn(P.t0, 8500);
  const at = () => ev(() => app.history.index);   // (the undone Bake sits in the redo list: count by the index)
  let h = await at(); g = await geo();
  await page.mouse.move(g.x(P.t1) - 2, g.y(g.L.pos)); await page.mouse.down();
  let prev = L0, moved = 0, ms = [];
  for (const t of [6400, 6800, 7200, 7600, 8000]) {
    await page.mouse.move(g.x(t), g.y(g.L.pos), { steps: 2 }); await wait(60);
    const cur = await liveIn(P.t0, 8500);
    if (J(cur) !== J(prev)) moved++;
    prev = cur;
    // the cost of one step in the window: a pointermove on the row -> the draft -> the ease -> the composed live script
    ms.push(await ev(([x, y]) => { const c = document.querySelector('[data-tl-lane="scenes"] canvas'), t0 = performance.now(); c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1, buttons: 1 })); void app.liveOf('stroke'); return performance.now() - t0; }, [g.x(t) + 1, g.y(g.L.pos)]));
  }
  ok(moved === 5, `held, not released: the live script inside the range changed at ${moved} of 5 steps (one step ${ms.map((x) => x.toFixed(1)).join(' / ')} ms)`);
  ok((await at()) === h && (await ev(() => app.doc.acts.find((r) => r.kind === 'positioning').t1)) === P.t1, 'nothing written while held');
  await page.keyboard.press('Escape'); await page.mouse.up(); await wait(300);
  // settle() hands its predicate no arguments: poll the live script here
  const back = async (what) => {
    let now = null;
    for (let k = 0; k < 20 && J(now = await liveIn(P.t0, 8500)) !== J(L0); k++) await wait(250);
    if (J(now) !== J(L0)) console.log('     before', J(L0).slice(0, 400), '/ now', J(now).slice(0, 400));
    ok(J(now) === J(L0), what);
  };
  await back('Esc: the live script exactly as before the drag');
  ok((await at()) === h, 'Esc: no undo step');
  await page.mouse.move(g.x(P.t1) - 2, g.y(g.L.pos)); await page.mouse.down();
  await page.mouse.move(g.x(7000), g.y(g.L.pos), { steps: 6 }); await wait(500);
  const held = await liveIn(P.t0, 8500);
  await page.mouse.up(); await wait(500);
  const P2 = await ev(() => ({ ...app.doc.acts.find((r) => r.kind === 'positioning') }));
  ok(Math.abs(P2.t1 - 7000) < 120 && (await at()) === h + 1, `released: the range ends at ${Math.round(P2.t1)}, one undo step`);
  ok(J(await liveIn(P.t0, 8500)) === J(held), 'released: the live script is what the held drag showed');
  await ev(() => app.undo()); await wait(500);
  await back('undo: the range and the live script as before');

  // 4. Delete on the selected range: unmarked, everything back as it was
  g = await geo();
  await page.mouse.click(g.x((P.t0 + P.t1) / 2), g.y(g.L.pos)); await wait(300);
  // (the undone Bake is still in the history's redo list here: the Delete replaces it, so the step count stays; step 5's one
  // undo bringing the range back is the one-step check)
  await page.keyboard.press('Delete'); await wait(500);
  ok(!(await ev(() => app.doc.acts.some((r) => r.kind === 'positioning'))), 'Delete: the range removed');
  ok(await settle(() => !app.doc.scenes[0].positioning), 'the shot no longer carries it');
  await wait(400);
  ok(J(await runGhost()) === J(G0), 'the run ghost exactly as before marking');
  ok((await bridgeIn(0, 15000)).length === 0, 'no ease left');

  // 5. the owner's points inside: marked again, they never change and no ease covers them
  const own = [{ at: 3500, pos: 60 }, { at: 4500, pos: 20 }, { at: 5500, pos: 70 }];
  await ev(() => app.undo()); await wait(500);   // the Delete undone: the range is back
  ok(await ev(() => app.doc.acts.some((r) => r.kind === 'positioning') && !!app.doc.scenes[0].positioning), 'one undo: the range back');
  await ev((own) => app.edit('Points', 'stroke', own), own); await wait(500);
  ok(J(await ev(() => app.doc.axes.stroke)) === J(own) && (await bridgeIn(P.t0, P.t1)).length === 0, 'the owner\'s points inside stay exactly; no ease over them');
} catch (e) { fails++; console.log('FAIL', e?.message || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
