// dev/anchor-strokes-check.mjs -- paw-2ntn in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env).
// Track (the store's own runTrack; only the sidecar's answer stood in for: two painted hips, 10 s of full strokes then 10 s of
// half strokes, test/fusion-synth.mjs runOf) a shot: it plays Smart stroke (fused). The run row's anchor chips: middle = the
// points as they were (the half strokes round the middle); in = every bottom at 0, the half strokes top out near 50; out = every
// top at 100, the half strokes bottom out near 50; full = stretched; each in / out / middle click one undo step, and Undo puts the
// points back; the cycle command (tracking.cycleStrokeAnchor, no default key) walks middle -> in; the shots as an older project has
// them (no anchor) read middle.   node dev/anchor-strokes-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';
import { runOf, T } from '../test/fusion-synth.mjs';

const wave = (i) => (T[i] < 10000 ? 1 : 0.5) * Math.sin((2 * Math.PI * 1.2 * T[i]) / 1000);
const sc = runOf({ c1_hips: { at: () => [0.4, 0.6] }, c2_hips: { at: (i) => [0.5, 0.45 + 0.05 * wave(i)] } }, { pair: (i) => 0.5 + 0.5 * wave(i) });
const A = Object.fromEntries(Object.entries(sc.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
for (const k of ['centroid_x', 'centroid_y', 'cam_x', 'cam_y']) A[k] = A.who_pair_proj.map(([t]) => [t, 0.5]);
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
/** the live points' turns over the half strokes (11.5..19 s) and the full ones (1.5..9.5 s): mean bottom / top */
const turns = (s) => {
  const out = {};
  for (const [k, a, b] of [['full', 1500, 9500], ['half', 11500, 19000]]) {
    const tops = [], bots = [];
    for (let j = 1; j + 1 < s.length; j++) {
      if (s[j][0] < a || s[j][0] >= b || s[j - 1][1] === s[j][1]) continue;
      let e = j + 1; while (e < s.length - 1 && s[e][1] === s[j][1]) e++;
      if (s[j][1] > s[j - 1][1] && s[j][1] > s[e][1]) tops.push(s[j][1]); else if (s[j][1] < s[j - 1][1] && s[j][1] < s[e][1]) bots.push(s[j][1]);
    }
    const m = (x) => (x.length ? Math.round((10 * x.reduce((p, q) => p + q, 0)) / x.length) / 10 : NaN);
    out[k] = { bot: m(bots), top: m(tops), n: bots.length + tops.length, maxBot: Math.max(...bots), minTop: Math.min(...tops) };
  }
  return out;
};
// a visible chip is clicked for real (the Tracker row, or the lane toolbar); folded into the toolbar's … popover only: its element
const click = async (m) => { await runCtl(page); const v = page.locator(`[data-testid="anchor-${m}"]:visible`); if (await v.count()) await v.first().click(); else await ev((m) => document.querySelector(`[data-testid="anchor-${m}"]`).click(), m); await wait(700); };
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await ev((A) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.links = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'anchorstrokes1' } };
    app.doc.scenes = [{ start_ms: 0, end_ms: 20000, tags: ['penetration'] }];
    const T0 = A.who_pair_proj.map(([t]) => t);
    tr.job = async (label) => (label === 'track' ? { result: { samples: T0.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: A, notes: [] } } : { cancelled: true });
    window.trackNow = async () => { const r = await tr.runTrack({ id: 'tapnext_points', name: 'TAPNext++', params: [] }, { start: 0, end: 20000 }, { axis: 'auto' }, null, [], { check: false }); if (r.run) tr.select(r.run.id); return r.run?.id || JSON.stringify(r); };
    window.PTS = (id) => (TR.ghost(id)?.script || []).map((p) => [p.at, p.pos]);
    app.setView({ start: 0, span: 20000 });
    app.player.seek(5000);
    app._history.reset();
    app.doc.runRanges = null;
  }, A);
  const id = await ev(() => trackNow());
  await wait(1000);
  await runCtl(page);   // paw-k8pe: the run's controls are the lane toolbar's, the tail folded into its … popover
  await page.waitForFunction(() => !!document.querySelector('[data-testid="anchor-middle"]'), null, { timeout: 10000 });
  const st = await ev((id) => ({ src: TR.sceneSignal(TR.run(id), 0), anchor: TR.anchorOf(0, id), scenes: JSON.parse(JSON.stringify(app.doc.scenes)), h: app._history.index }), id);
  const P0 = await ev((id) => PTS(id), id), t0 = turns(P0);
  const pressed = async () => (await runCtl(page), ev)(() => [...new Set([...document.querySelectorAll('[data-testid^="anchor-"][aria-pressed="true"]')].map((b) => b.dataset.testid.slice(7)))]);
  ok(st.src === 'fused' && st.anchor === 'middle' && (await pressed()).join() === 'middle', `new run ${id}: plays ${st.src}, anchor ${st.anchor}, pressed ${await pressed()}`);
  ok(Math.abs(t0.half.bot + t0.half.top - 100) <= 12 && t0.half.n >= 10, `middle: the half strokes sit round the middle ${t0.half.bot}..${t0.half.top} (full ${t0.full.bot}..${t0.full.top})`);

  await click('in');
  const P1 = await ev((id) => PTS(id), id), t1 = turns(P1), h1 = await ev(() => ({ n: app._history.index, label: app.history.undoLabel }));
  ok(t1.half.maxBot === 0 && t1.full.maxBot === 0 && Math.abs(t1.half.top - 50) <= 8 && t1.full.top >= 88, `in: every bottom 0, half strokes 0..${t1.half.top}, full 0..${t1.full.top}`);
  ok(h1.n === st.h + 1 && h1.label === 'Anchor strokes: in' && (await pressed()).join() === 'in', `in: one undo step "${h1.label}", the chip pressed`);
  await ev(() => app.undo()); await wait(700);
  const Pu = await ev((id) => PTS(id), id);
  ok(JSON.stringify(Pu) === JSON.stringify(P0) && (await ev((id) => TR.anchorOf(0, id), id)) === 'middle', 'Undo: the middle points back exactly, anchor middle');
  await ev(() => app.redo()); await wait(700);
  ok(JSON.stringify(await ev((id) => PTS(id), id)) === JSON.stringify(P1), 'Redo: the in points again');

  await click('out');
  const t2 = turns(await ev((id) => PTS(id), id));
  ok(t2.half.minTop === 100 && t2.full.minTop === 100 && Math.abs(t2.half.bot - 50) <= 8 && t2.full.bot <= 12, `out: every top 100, half strokes ${t2.half.bot}..100, full ${t2.full.bot}..100`);
  await click('full');
  const t3 = turns(await ev((id) => PTS(id), id));
  ok(t3.half.top >= 85 && t3.half.bot <= 15 && (await pressed()).join() === 'full', `full: half strokes stretched ${t3.half.bot}..${t3.half.top}`);
  await click('middle');
  const P4 = await ev((id) => PTS(id), id);
  ok(JSON.stringify(P4) === JSON.stringify(P0) && (await pressed()).join() === 'middle', 'middle again: the points as at first');

  // the cycle command at the playhead (no default key: run as the palette / Quick menu does)
  const keys = await ev(() => app.commands.keysFor('tracking.cycleStrokeAnchor'));
  await ev(() => app.commands.run('tracking.cycleStrokeAnchor')); await wait(700);
  ok(keys.length === 0 && (await ev((id) => TR.anchorOf(0, id), id)) === 'in' && JSON.stringify(await ev((id) => PTS(id), id)) === JSON.stringify(P1), `tracking.cycleStrokeAnchor (keys: ${keys.join() || 'none'}): middle -> in, the in points`);

  // an older project's shots (no anchor): middle, the points as at first
  await ev((s) => { app.doc.scenes = s; }, st.scenes); await wait(900);
  ok((await ev((id) => TR.anchorOf(0, id), id)) === 'middle' && JSON.stringify(await ev((id) => PTS(id), id)) === JSON.stringify(P0) && (await pressed()).join() === 'middle', 'the shots as saved before the anchor: middle, the same points');
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/anchor-strokes.png' });
} catch (e) { fails++; console.log('FAIL [threw]', String(e?.message || e).slice(0, 400)); } finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
