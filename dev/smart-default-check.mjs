// dev/smart-default-check.mjs -- paw-lji3 / paw-83sq in the REAL window (your test instance: node dev/test-app.mjs start ...;
// CDP_* env). Track (the store's own runTrack; only the sidecar's answer stood in for: painted-part tracks from
// test/fusion-synth.mjs) a shot in a new project: the Adjust strip's Smart stroke button reads on and the shot plays Smart
// stroke (fused through the strokes step), tracking made no undo step. A click turns it off (one step, "Smart stroke off");
// Track again: the new run's button still reads off.   node dev/smart-default-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { CASES } from '../test/fusion-synth.mjs';

const sc = CASES.find((c) => c.id === 'handjob').make();
const A = Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
for (const k of ['centroid_x', 'centroid_y', 'cam_x', 'cam_y']) A[k] = A.who_pair_proj.map(([t]) => [t, 0.5]);   // a points run's stored centroid / camera (the Adjust strip needs them)
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const btn = () => page.locator('[data-testid="derive-strip"] button', { hasText: 'Smart stroke' }).first();
// paw-p8o2: the shot's Adjust strip lives only in the band under the stroke lane: unfold it (its ▾) when it is folded
const openBand = async () => { await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); }); await page.waitForTimeout(300); };
const btnState = async () => ({ text: (await btn().innerText()).trim(), pressed: await btn().getAttribute('aria-pressed') });
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await ev((A) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.links = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'smartdefault01' } };
    app.doc.scenes = [{ start_ms: 0, end_ms: 20000, tags: ['handjob'] }];
    const T0 = A.who_pair_proj.map(([t]) => t);
    tr.job = async (label) => (label === 'track' ? { result: { samples: T0.map((t) => [t, 0.5 + 0.4 * Math.sin(t / 300)]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: A, notes: [] } } : { cancelled: true });
    window.trackNow = async () => { const r = await tr.runTrack({ id: 'tapnext_points', name: 'TAPNext++', params: [] }, { start: 0, end: 20000 }, { axis: 'auto' }, null, [], { check: false }); if (r.run) tr.select(r.run.id); return r.run?.id || JSON.stringify(r); };
    window.S = (s) => (s ? JSON.stringify(s.map((p) => [p.at, p.pos])) : null);
    app.setView({ start: 0, span: 20000 });
    app.player.seek(5000);
    // the shown tab may be a restored project with its own history: at its cap (500 entries / 4M actions) a new entry drops the
    // oldest and the index stays, and its entries describe a document this check just replaced. Start the count from nothing.
    app._history.reset();
    app.doc.runRanges = null;   // no ranges left from that project: the track below takes the shot
  }, A);
  const h0 = await ev(() => app._history.index);
  const id1 = await ev(() => trackNow());
  await wait(800);
  await openBand();
  await btn().waitFor({ timeout: 10000 });
  const s1 = await btnState();
  ok(s1.text === 'Smart stroke: on' && s1.pressed === 'true', `new run ${id1}: the button reads "${s1.text}" (pressed ${s1.pressed})`);
  const play1 = await ev((id) => ({ src: TR.sceneSignal(TR.run(id), 0), pts: S(TR.ghost(id).script), ab: S(app.doc.ghosts.find((g) => g.id === 'smart-ab')?.script) }), id1);
  ok(play1.src === 'fused' && !play1.ab, `the shot plays Smart stroke: signal ${play1.src}, no grey "Without Smart stroke" ghost on an arrival (paw-89bd)`);
  ok((await ev(() => app._history.index)) === h0, 'tracking made no undo step (no fix-log entry)');
  await btn().click(); await wait(600);
  const s2 = await btnState();
  ok(s2.text !== 'Smart stroke: on' && s2.pressed === 'false', `a click: the button reads "${s2.text}"`);
  const h2 = await ev(() => ({ n: app._history.index, label: app.history.undoLabel }));
  ok(h2.n === h0 + 1 && h2.label === 'Smart stroke off', `one undo step, "${h2.label}"`);
  const play2 = await ev((id) => ({ pts: S(TR.ghost(id).script), ab: !!app.doc.ghosts.find((g) => g.id === 'smart-ab'), smart: TR.shotDerive(0, id)?.smart }), id1);
  ok(play2.smart === false && play2.pts !== play1.pts && !play2.ab, `the classic path: other points, the grey A/B ghost gone (smart ${play2.smart})`);
  const id2 = await ev(() => trackNow());
  await wait(800);
  const s3 = await btnState(), d2 = await ev((id) => ({ smart: TR.shotDerive(0, id)?.smart, adjust: TR.deriveRun(0)?.id, pts: S(TR.ghost(id).script) }), id2);
  ok(id2 !== id1 && d2.adjust === id2, `Track again: ${id2}, the strip shows it`);
  ok(s3.text !== 'Smart stroke: on' && s3.pressed === 'false' && d2.smart === false && d2.pts === play2.pts, `still off on the new run: "${s3.text}", smart ${d2.smart}, the same (classic) points as run 1 off`);
  await btn().click(); await wait(600);
  const s4 = await btnState(), p4 = await ev((id) => S(TR.ghost(id).script), id2), ab4 = await ev(() => S(app.doc.ghosts.find((g) => g.id === 'smart-ab')?.script));
  ok(s4.text === 'Smart stroke: on' && p4 === play1.pts, `a click on the new run: "${s4.text}", the same Smart stroke points as run 1 had`);
  ok(!!ab4 && ab4 !== p4, 'switched on by hand: the grey "Without Smart stroke" ghost shows, other points than Smart stroke');
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/smart-default.png' });
} catch (e) { fails++; console.log('FAIL [threw]', String(e?.message || e).slice(0, 400)); } finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
