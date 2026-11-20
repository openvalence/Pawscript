// dev/shaft-source-check.mjs -- paw-4c48.10: "Shaft" as a shot's stroke source (lib/shaft-source.js: the position bar's hollow
// diamond IS the signal) in YOUR test instance, started with FAKE_SHAFT_STORY=strokes in its environment (node dev/test-app.mjs
// start ...; the CDP_* env it prints), on a generated clip (any 8 s video). One shot with c2_penis (the shaft) + c1_hips painted; T
// with the fake sidecar's fake.groups: its shaft strokes (0.9 s, 20..90 % visible, its points hidden past the entry) with a held
// stretch at 3-3.6 s (test/fake-pawtrack.mjs). It asserts, on what is painted / read:
//  0. (paw-4c48.11) with Shaft not picked the plain diamond draws the better-founded reading (the points here), confident, and
//     moves with the strokes;
//  1. the source chip's menu has "Shaft" (enabled, its tooltip says what it is); picking it on a shot flipped with F clears that
//     flip in the same undo step (the marker on the diamond); undo puts the old source back with its flip in force; the chip reads
//     "shaft N % · filled M %";
//  2. the trace the Tracker lane draws (the run's lane data) equals the diamond's reading where the shaft is measured (the canvas'
//     data-meas at those times), and inside the held stretches it is filled (no NaN, no jump at the joins);
//  3. the position bar on the shaft, Track tab (following the unapplied run): while playing, the script marker sits on the diamond;
//  4. F still flips it (the marker reads 100 - the diamond); F again restores (undo / redo of the pick checked in 1); on a bar
//     trimmed 20 % / 10 % the marker, drawn through the same trim, still sits on the diamond;
//  5. a run without a shaft pass: the menu's "Shaft" is there but disabled, its row says why (the kit shows no tooltip on a
//     disabled row).
// Every page exception and console error fails it.
//   node dev/shaft-source-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/shaft-source-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `shaftsrc-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const SQ = (x, y, w = 0.12, h = 0.12) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const grp = (who, part, x, y, extra = {}) => ({ name: `${who}_${part}`, who, part, poly: SQ(x, y), pinned: true, t_ms: 500, source: 'user', ...extra });
const chip = () => page.locator('button.chip.src');
const menuItem = (name) => page.locator('[role="menu"] [role="menuitemradio"]').filter({ hasText: new RegExp(`^\\s*${name}(\\s*$| — )`) });
const tipOf = async (loc) => {   // the kit's tip (.k-tip popover) after a real pointer rest on the row
  for (let n = 0; n < 3; n++) {   // (a row hovered while the menu still settles can miss its tip: off and back, up to three times)
    const b = await loc.boundingBox();
    if (n) { await page.mouse.move(b.x + b.width / 2, b.y - 3 * b.height, { steps: 3 }); await wait(400); }
    for (let k = 0; k < 8; k++) { await page.mouse.move(b.x + 10 + k * 5, b.y + b.height / 2); await wait(80); }
    await wait(1500);
    const t = await ev(() => { const t = document.querySelector('.k-tip'); return t?.matches(':popover-open') ? t.textContent : ''; });
    if (t) return t;
  }
  return '';
};
// (Track is a no-op until the store can track: the clip's path set, the store unlocked; right after another check's project it can lag)
// 823326a (paw-lji3): a new run arrives with Smart stroke on, which draws the stroke's shape over the reading (the marker then
// sits up to ~6 pos off the diamond by design); this check is about the Shaft source itself: Smart stroke off, as when it was written
const track = () => ev(async () => { const tr = window.__pawDev.trackingFor(app); app.settings.set('tracking.smartStroke', false); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(500); for (let k = 0; k < 75 && !tr.canTrack; k++) await new Promise((r) => setTimeout(r, 200)); await tr.track(); });

try {
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((g) => {
    app.devicePreview.toggle(false);
    app.player.setUi({ posBar: true });
    app.setMode('track'); app.player.pause();
    app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['anal', 'penetration'], groups: g }]; });
    app.settings.set('video.posbar.shaft:' + app.doc.media.path, { on: true, labels: false });
  }, [grp('c2', 'penis', 0.3, 0.45, { shaft: true }), grp('c1', 'hips', 0.6, 0.45)]);
  await track();
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  await ev(() => { const tr = window.__pawDev.trackingFor(app); window.TR = tr; tr.select(tr.runs.at(-1).id); app.player.seek(1500, { exact: true }); });
  await wait(800);

  const look = (t) => ev(async (t) => { app.player.seek(t, { exact: true }); await new Promise((r) => setTimeout(r, 350)); const cv = document.querySelector('canvas.pbar'); return { mode: cv.dataset.mode, pos: parseFloat(cv.dataset.pos), meas: parseFloat(cv.dataset.meas), src: cv.dataset.src, onbar: parseFloat(cv.dataset.onbar) }; }, t);

  // ---- 0. paw-4c48.11: the plain diamond (Shaft not picked) draws the better-founded reading and moves with the strokes ----
  const plain = [];
  for (const t of [600, 800, 1050, 1300, 1500, 1750]) plain.push(await look(t));
  const pm = plain.map((r) => r.meas).filter(Number.isFinite), read0 = await ev(() => TR.railFor(1500).reading);
  // (a frame deep in, with under 3 of the 10 points visible, has no fit of its own: held, drawn faint, honestly)
  ok(read0 === 'points' && pm.length >= plain.length - 1 && Math.max(...pm) - Math.min(...pm) > 40 && plain.filter((r) => r.mode === 'shaft').length >= plain.length - 1,
    `the plain diamond reads ${read0}, confident (${plain.map((r) => r.mode).join(' ')}), and moves with the strokes: ${pm.map((x) => x.toFixed(0)).join(' ')}`);

  // ---- 1. the menu entry (the shot flipped first: picking Shaft clears that flip, in the same undo step) ----
  await ev(() => { app.player.seek(1500, { exact: true }); TR.flipAtPlayhead(); }); await wait(900);
  const flips0 = await ev(() => TR.selected.flips || []);
  ok(flips0.includes(0), `the shot flipped (F) before the pick: run flips ${JSON.stringify(flips0)}`);
  await page.mouse.move(5, 5); await wait(200);
  await runCtl(page);   // paw-k8pe: the run's row is the lane toolbar's (its tail in a … popover)
  const before = await chip().textContent();
  const hint = await page.locator('[data-testid="shaft-hint"]').count();
  console.log(`info the hint mark beside "${before.trim()}": ${hint ? 'shown' : 'not shown'} (store: ${JSON.stringify(await ev(() => TR.shaftHint(TR.selected, TR.sceneOf(TR.selected))))})`);
  await chip().click(); await wait(400);
  const item = menuItem('Shaft');
  ok(await item.count() === 1, `the source menu lists "Shaft" (chip was "${before.trim()}")`);
  ok((await item.getAttribute('aria-disabled')) !== 'true', 'and it is enabled on a shot with a shaft pass');
  const tip = await tipOf(item);
  ok(/hollow diamond/.test(tip), `its tooltip says what it is ("${tip.slice(0, 110)}…")`);
  const undo0 = await ev(() => app._history.index);
  await item.click(); await wait(1200);
  await runCtl(page); const label = (await chip().textContent()).trim();
  ok(/^shaft \d+ % · filled \d+ %/.test(label), `the chip reads "${label}"`);
  const st = await ev(() => { const r = TR.selected, i = TR.sceneOf(r); return { src: TR.shotSource(r, i), sc: r.sceneChannels, info: r.shaftSrc?.[0] }; });
  ok(st.src === 'shaft' && st.sc?.[0] === 'shaft' && st.info?.ok, `the shot plays the shaft (${JSON.stringify(st)})`);
  const read1 = await ev(() => TR.railFor(1500).reading);
  ok(read1 === st.info.reading && read1 === read0, `the diamond draws the source's reading: ${read0} before, ${read1} with Shaft picked (the source reads ${st.info.reading})`);
  const cl = await ev(() => ({ unflip: TR.shotDerive(TR.sceneOf(TR.selected), TR.selected.id)?.unflip, whole: TR.selected.dir?.whole }));
  const c1 = await look(1200);
  ok(cl.unflip === true && !cl.whole?.includes(0) && Math.abs(c1.pos - c1.meas) < 6, `the pick cleared the flip: unflip ${cl.unflip}, applied flips ${JSON.stringify(cl.whole)}, marker ${c1.pos.toFixed(1)} on the diamond ${c1.meas.toFixed(1)}`);
  const undo1 = await ev(() => app._history.index);
  ok(undo1 === undo0 + 1, `one undo step (${undo0} -> ${undo1})`);
  await ev(() => app.undo()); await wait(900);
  const back = (await chip().textContent()).trim();
  const un = await ev(() => ({ unflip: TR.shotDerive(TR.sceneOf(TR.selected), TR.selected.id)?.unflip, flips: TR.selected.flips, whole: TR.selected.dir?.whole }));
  ok(!/shaft/i.test(back) && !un.unflip && un.flips?.includes(0) && un.whole?.includes(0), `undo: the old source back ("${back}") and its flip in force again (run flips ${JSON.stringify(un.flips)}, applied ${JSON.stringify(un.whole)})`);
  await ev(() => app.redo()); await wait(1200);
  ok(/^shaft/.test((await chip().textContent()).trim()), 'redo: the shaft again');

  // ---- 2. the lane's trace = the diamond where measured; filled (no NaN, no jump) where held ----
  const lane = (t) => ev((t) => { const L = TR.selected.lane; let j = 0; while (j + 1 < L.t.length && L.t[j + 1] <= t) j++; return 100 * L.v[j]; }, t);
  const rows = [];
  for (const t of [600, 1200, 1800, 2400, 2800, 4300, 5600, 6500]) { const L = await look(t); rows.push({ t, ...L, lane: await lane(t) }); }
  const measured = rows.filter((r) => Number.isFinite(r.meas));
  ok(measured.length >= 6, `the diamond is drawn at ${measured.length} of ${rows.length} sampled times (${rows.map((r) => r.mode).join(' ')})`);
  const dLane = measured.map((r) => Math.abs(r.lane - r.meas));
  ok(Math.max(...dLane) < 1.5, `the lane's trace on the diamond: lane - meas ${measured.map((r) => (r.lane - r.meas).toFixed(2)).join(' ')}`);
  const gap = await ev(() => { const L = TR.selected.lane, v = [], step = []; for (let j = 0; j < L.t.length; j++) if (L.t[j] >= 2900 && L.t[j] < 3700) { v.push(L.v[j]); if (v.length > 1) step.push(Math.abs(L.v[j] - v[v.length - 2])); } return { nan: v.filter((x) => !(x === x)).length, n: v.length, maxStep: Math.max(...step) }; });
  ok(gap.n > 15 && gap.nan === 0 && gap.maxStep < 0.2, `the held stretch 3-3.6 s is filled: ${gap.n} samples, ${gap.nan} NaN, largest frame step ${(100 * gap.maxStep).toFixed(1)} pos (one point of the reading: 0.1 over its 0.6 span = 16.7 pos)`);
  await page.screenshot({ path: join(out, 'shaft-source-track.png') });

  // ---- 3. playing (Track tab: the bar follows the unapplied run): the marker sits on the diamond ----
  await ev(() => app.player.seek(400, { exact: true })); await wait(300);
  const play = await ev(async () => {
    const cv = document.querySelector('canvas.pbar'), d = []; app.player.play(); const t0 = performance.now();
    while (performance.now() - t0 < 2400) { await new Promise((r) => requestAnimationFrame(r)); const p = parseFloat(cv.dataset.pos), m = parseFloat(cv.dataset.meas); if (Number.isFinite(p) && Number.isFinite(m)) d.push(p - m); }
    app.player.pause(); return d;
  });
  const ad = play.map(Math.abs).sort((a, b) => a - b), med = ad[ad.length >> 1] ?? NaN, p90 = ad[Math.floor(0.9 * (ad.length - 1))] ?? NaN;
  // (the points reading moves in steps of one point: 10 points on the fake's penis, its recurring span (0.6 of the
  //  points) made 0..100 by the depth scale: 16.7-pos steps; the script's points follow it within detailTol(8) = 3.4 pos between the turns, linear between)
  // (since 722459f the bar is drawn once per presented frame, at that frame's time: median 3.9 -> 4.5, p90 10.3 -> 11.8 on the same
  //  clip, over 12 under load; the limits keep under one 16.7-pos step of the reading)
  ok(play.length > 30 && med <= 6 && p90 <= 14, `playing: marker - diamond over ${play.length} painted frames: median ${med?.toFixed(2)} pos, p90 ${p90?.toFixed(2)} (the reading moves in 16.7-pos steps)`);

  // ---- 4. F flips it; F again restores ----
  await ev(() => app.player.seek(1200, { exact: true })); await wait(300);
  await ev(() => TR.flipAtPlayhead()); await wait(900);
  const f1 = await look(1200);
  ok(Math.abs(f1.pos - (100 - f1.meas)) < 2, `flipped: the marker reads 100 - the diamond (${f1.pos.toFixed(1)} vs ${(100 - f1.meas).toFixed(1)})`);
  await ev(() => TR.flipAtPlayhead()); await wait(900);
  const f2 = await look(1200);
  ok(Math.abs(f2.pos - f2.meas) < 2, `flipped back: on the diamond again (${f2.pos.toFixed(1)} vs ${f2.meas.toFixed(1)})`);

  // ---- 4b. a trimmed bar: the marker goes through the same trim as the diamond (they still meet; the trim is no calibration) ----
  await ev(() => app.settings.set('video.posbar.shaft:' + app.doc.media.path, { on: true, labels: false, trim0: 0.2, trim1: 0.1 })); await wait(400);
  const tr = [];
  for (const t of [700, 1200, 1700, 2300]) tr.push(await look(t));
  const trm = tr.filter((r) => Number.isFinite(r.meas));   // (a held frame draws no diamond)
  ok(trm.length >= 3 && trm.every((r) => Math.abs(r.onbar - r.meas) < 6) && tr.every((r) => Math.abs(r.onbar - (r.pos - 20) / 0.7) < 0.2), `trimmed 20 % / 10 %: marker along the drawn bar on the diamond (onbar - meas ${tr.map((r) => (r.onbar - r.meas).toFixed(1)).join(' ')}; pos ${tr.map((r) => r.pos.toFixed(0)).join(' ')})`);
  await ev(() => app.settings.set('video.posbar.shaft:' + app.doc.media.path, { on: true, labels: false })); await wait(300);

  // ---- 5. a run without a shaft pass: the entry disabled, with its reason ----
  await ev((g) => { app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['anal'], groups: g }]; }); }, [grp('c2', 'penis', 0.3, 0.45), grp('c1', 'hips', 0.6, 0.45)]);
  await track();
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  await ev(() => { TR.select(TR.runs.at(-1).id); app.player.seek(1500, { exact: true }); }); await wait(800);
  const noShaft = await ev(() => !Object.keys(TR.selected.channels).some((k) => /_in_conf$/.test(k)));
  await page.mouse.move(5, 5); await wait(200);
  await chip().click(); await wait(400);
  const it2 = menuItem('Shaft');
  ok(noShaft && await it2.count() === 1 && (await it2.getAttribute('aria-disabled')) === 'true', `no shaft pass: "Shaft" listed, disabled (run has a shaft: ${!noShaft})`);
  const lab2 = (await it2.textContent()).trim();
  ok(/^Shaft — not here: no shaft pass in this run/.test(lab2), `its row says why (the kit shows no tooltip on a disabled row): "${lab2}"`);
  await page.screenshot({ path: join(out, 'shaft-source-disabled.png') });
  await page.keyboard.press('Escape');
} catch (e) { fails++; console.log('FAIL', e.message); }
await ev(() => app.settings.set('tracking.smartStroke', true)).catch(() => {});   // the default back for the checks after this one
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
