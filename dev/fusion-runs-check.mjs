// dev/fusion-runs-check.mjs -- paw-orm2 in the REAL window (your test instance: node dev/test-app.mjs start ...; CDP_* env). The
// owner: "the fused behaviour is buggy when a second run is done, or when multiple shots exist for the same scene". Synthetic
// painted-part tracks (test/fusion-synth.mjs) come back from Track through the store's own runTrack (only the sidecar's job is
// stood in for: its answer carries the tracks), over one take of three shots split by camera moves (the sidecar's ONE run scene
// over them, as his "S16–S22 · #1"). Asserted on what is painted: the Tracker row (its trace, the source chip, the pad chip),
// the Fusion panel (its header, its presence), the run's ghost on the lane.
//   1. several shots in one tracked scene: the pad dragged on shot 1 re-fuses the trace (it went to shot 1 only; the run scene is
//      fused with the shot under its middle, shot 3); shot 3 shows the same pad; the panel says it edits shots 1–3; one undo step;
//      a cut added later inside the take: the new shot shows the same setting;
//   2. discard + Track again (the same tracks): the same trace, the source chip and the panel as before (it came back unfused:
//      the old run's links met the new run1 and nothing composed it, while the chip said Fused);
//   3. a second run beside the first (other parts painted): it is fused too, its panel shows; the shots keep playing the first.
//   SHOT_DIR=<dir> node dev/fusion-runs-check.mjs
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';
import { CASES } from '../test/fusion-synth.mjs';

const shots = process.env.SHOT_DIR || null;
const chansOf = (id) => { const sc = CASES.find((c) => c.id === id).make(); return Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])])); };
const A = chansOf('handjob'), B = chansOf('fellatio-head');
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
// the trace as painted: the Tracker row's canvas pixels (the chips around it change with the settings), luminance on a 2 px
// grid; two paints are the same when under 0.2 % of the samples differ by more than 48 (the GPU's anti-aliasing varies a bit)
const laneImg = () => ev(() => { const c = document.querySelector('canvas[aria-label="Tracker signals"]'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, out = []; for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const k = 4 * (y * c.width + x); out.push((d[k] + d[k + 1] + d[k + 2]) / 3); } return out; });
const samePaint = (a, b) => a.length === b.length && a.filter((v, k) => Math.abs(v - b[k]) > 48).length < 0.002 * a.length;
// paw-k8pe: the run's row is the lane toolbar's on the Track tab (its tail in a … popover): reach it first
const chip = async (sel) => { await runCtl(page); return (await page.locator(sel).count()) ? await page.locator(sel).first().getAttribute('aria-label') : null; };
// 145370e (paw-p8o2): the Fusion panel (in the shot's Adjust strip) lives only in the band under the stroke lane: unfold it
// (its ▾, disabled until the band has a run) before reading it; the band stays open (the store's bandOpen) once unfolded
const openBand = async () => {
  await page.waitForSelector('[data-testid="inspector-more"]:not([disabled])', { timeout: 15000 });
  await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); });
  await page.waitForSelector('[data-testid="derive-strip"]', { timeout: 10000 });
};
const panel = async () => {
  await openBand().catch((e) => console.log('     (band: ' + String(e.message).split('\n')[0] + ')'));
  await page.locator('[data-testid="fuse-panel"]').waitFor({ timeout: 10000 }).catch(() => {});
  return (await page.locator('[data-testid="fuse-panel"]').count()) ? await page.locator('[data-testid="fuse-where"]').first().innerText() : null;
};
const seek = async (t) => { await ev((t) => app.player.seek(t), t); await wait(400); };
const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 30000 });
  await ev(({ A, B }) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    tr.runs = []; app.doc.ghosts = []; tr.links = []; tr.select('');
    app.setMode('track');
    app.doc.media = { ...app.doc.media, width: 1920, height: 1080, hash: { algo: 'q1', value: 'fusionruns001' } };
    app.doc.project = { ...(app.doc.project || {}), path: 'C:\\pawtest\\fusion-runs.pawproj' };
    // one take, three shots split by camera moves (joined: one scene; soft cuts: the sidecar keeps one run scene)
    app.doc.scenes = [{ start_ms: 0, end_ms: 4000, tags: ['handjob'] }, { start_ms: 4000, end_ms: 9000, join: true, split: 'camera', tags: ['handjob'] }, { start_ms: 9000, end_ms: 20000, join: true, split: 'camera', tags: ['handjob'] }];
    const T0 = A.who_pair_proj.map(([t]) => t);
    window.answer = (ch) => ({ samples: T0.map((t) => [t, 0.5 + 0.4 * Math.sin(t / 300)]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: ch, notes: [] });
    window.NEXT = A;
    tr.job = async (label) => (label === 'track' ? { result: window.answer(window.NEXT) } : { cancelled: true });   // the sidecar's answer (score / camera jobs: none)
    window.trackNow = async () => { const r = await tr.runTrack({ id: 'tapnext_points', name: 'TAPNext++', params: [] }, { start: 0, end: 20000 }, { axis: 'auto' }, null, [], { check: false }); if (r.run) tr.select(r.run.id); return r.run?.id || JSON.stringify(r); };
    window.sig = (id) => JSON.stringify((TR.ghost(id)?.script || []).map((p) => [p.at, p.pos]));
    window.hist = () => app._history.index;
    app.setView({ start: 0, span: 20000 });
    window.__A = A; window.__B = B;
  }, { A, B });
  const id1 = await ev(() => trackNow());
  await seek(2000);
  await page.locator('[data-testid="fuse-panel"]').waitFor({ timeout: 10000 }).catch(() => {});

  // ---- 1. several shots in one tracked scene ----
  const where1 = await panel();
  ok(where1 !== null, `shot 1: the fusion panel shows (${where1})`);
  ok(/shots 1–3/.test(where1 || ''), `the panel says it edits the whole tracked scene: "${where1}"`);
  const img0 = await laneImg(), s0 = await ev((id) => sig(id), id1), h0 = await ev(() => hist());
  const pad = page.locator('[data-testid="fuse-pad"]');
  await runCtl(page);
  const b = await pad.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(b.x + b.width / 2 + k * 9, b.y + b.height / 2 - k * 4); await wait(40); }
  await page.mouse.up(); await wait(600);
  const padTxt1 = await chip('[data-testid="fuse-pad"]');
  ok((await ev(() => hist())) - h0 === 1, `the drag on shot 1 is one undo step (${padTxt1})`);
  const s1 = await ev((id) => sig(id), id1), img1 = await laneImg();
  ok(s1 !== s0, 'the pad on shot 1 re-fused the run (its ghost points changed)');
  ok(!samePaint(img1, img0), 'the Tracker row\'s trace changed');
  await shot('1-pad-shot1');
  // the same pad set on shot 3 (the shot under the run scene's middle) must paint the same trace
  const pv = await ev((id) => TR.fuseControls(0, null, id).pad, id1);
  await ev(() => app.undo()); await wait(500);
  ok(samePaint(await laneImg(), img0), 'undo: the trace as it was');
  await ev(({ id, pv }) => TR.setFuse(2, { pad: pv }, { run: id, label: 'Fusion pad' }), { id: id1, pv }); await wait(500);   // what the panel on shot 3 writes
  ok((await ev((id) => sig(id), id1)) === s1 && samePaint(await laneImg(), img1), `the pad ${JSON.stringify(pv)} on shot 3 paints the same trace as on shot 1`);
  await ev(() => app.undo()); await wait(300);
  await ev(({ id, pv }) => TR.setFuse(0, { pad: pv }, { run: id, label: 'Fusion pad' }), { id: id1, pv }); await wait(500);   // back to the drag's result, one step
  await seek(12000);
  const padTxt3 = await chip('[data-testid="fuse-pad"]');
  ok(padTxt3 === padTxt1, `shot 3 (the same tracked scene) shows the same pad: "${padTxt3}" vs "${padTxt1}"`);
  await seek(6000);
  ok((await chip('[data-testid="fuse-pad"]')) === padTxt1, 'and shot 2');
  // a cut added later inside the take (a hard cut: not joined): the new shot shows the run scene's setting
  await ev(() => { const L = app.doc.scenes; app.transact('Split shot', () => { app.doc.scenes = [...L.slice(0, 2), { ...L[2], end_ms: 15000 }, { start_ms: 15000, end_ms: 20000, tags: ['handjob'] }]; }); });
  await seek(17000);
  ok((await chip('[data-testid="fuse-pad"]')) === padTxt1, `a cut added after tracking: the new shot 4 shows the same pad (${await chip('[data-testid="fuse-pad"]')})`);
  await ev(() => app.undo()); await wait(300);   // the cut
  await ev(() => app.undo()); await wait(500);   // the pad
  ok((await ev((id) => sig(id), id1)) === s0, 'undo brings the trace back');
  await seek(12000);
  ok(/nudge/.test((await chip('[data-testid="fuse-pad"]')) || ''), `and the pad on shot 3 back to the centre (${await chip('[data-testid="fuse-pad"]')})`);

  // ---- 2. discard + Track again ----
  await ev((id) => TR.setSource('fused', null, id), id1); await wait(400);   // as the owner had it: Fused picked on the scene
  await seek(2000);
  const before = { src: await chip('.pick .src'), panel: await panel(), img: await laneImg(), sig: await ev((id) => sig(id), id1) };
  ok(/Fused/i.test(before.src || ''), `before: the source chip says ${before.src}`);
  await ev((id) => TR.remove(id), id1); await wait(300);
  const id2 = await ev(() => trackNow());
  await seek(2500); await seek(2000);
  const after = { src: await chip('.pick .src'), panel: await panel(), img: await laneImg(), sig: await ev((id) => sig(id), id2) };
  // 3fdebe3 (paw-1fd3): run numbers are never reused within a project: the new run takes the next number, not the freed one
  const num = (id) => +String(id).replace(/^\D+/, '');
  ok(id2 !== id1 && num(id2) > num(id1), `Track again after the discard: ${id2} (a new number after ${id1})`);
  ok(after.src === before.src, `the source chip: "${after.src}" (before "${before.src}")`);
  ok(after.sig === before.sig, 'the same tracks give the same script (fused)');
  ok(samePaint(after.img, before.img), 'the Tracker row\'s trace is the same');
  ok(after.panel !== null, `the fusion panel shows (${after.panel})`);
  ok(await ev((id) => (TR.run(id).sceneChannels || []).join() === 'fused' && !!TR.run(id).lane, id2), 'the run is composed fused, with its lane trace');
  await shot('2-retrack');

  // ---- 3. a second run beside the first, other parts painted ----
  const first = await ev((id) => sig(id), id2);
  await ev(() => { window.NEXT = window.__B; });
  const id3 = await ev(() => trackNow());
  await seek(2500); await seek(2000);
  ok(id3 !== id2, `a second run: ${id3}`);
  const src3 = await chip('.pick .src'), panel3 = await panel();
  ok(/Fused/i.test(src3 || ''), `the second run (selected) is fused: the source chip says ${src3}`);
  ok(panel3 !== null, `its fusion panel shows (${panel3})`);
  ok(await ev((id) => (TR.run(id).sceneChannels || []).join() === 'fused' && !!TR.run(id).lane, id3), 'it is composed fused, with its lane trace');
  ok(await ev((id) => TR.links.length > 0 && TR.links.every((l) => l.run === id), id2), 'the shots keep playing the first run (no link moved)');
  ok((await ev((id) => sig(id), id2)) === first, 'the first run\'s script is untouched');
  await shot('3-second-run');
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
