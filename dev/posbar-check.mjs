// dev/posbar-check.mjs -- paw-rtby in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a
// generated clip. Two shots: hand points on the first, a run whose range plays the second (paw-x7w7: no Accept, the run is
// live in the script).
//  1. Track tab: the machine preview's readout and the position bar's marker follow the script: the points on shot 1, the
//     run on shot 2; nothing says "unapplied"; the marker is PAINTED where the value says;
//  1b. Track tab with a box tracker (the pick tool 'tracking.roi' idle): the bar wins over it where the pointer is on the bar:
//     real drags of the body and an end move it, no ROI is made, the undo history gains nothing; a click away makes no ROI either
//     (paw-x8we: nothing draws one on the video);
//  2. the playback bar's ruler button: click off / on; double-click = back to the default place;
//  3. Refine tab (no overlay tool): real pointer drags of the body (moves), an end (scales / turns), Shift (fine), Esc
//     (cancels): the stored placement and what is painted;
//  4. Track tab with the Groups tool on: a click on the bar paints a group and the bar does not move.
//   node dev/posbar-check.mjs <clip> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [clip, out] = process.argv.slice(2);
if (!clip || !out) { console.error('usage: node dev/posbar-check.mjs <clip> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });

const saw = (t0, t1, per, lo, hi) => { const s = []; for (let t = t0, i = 0; t <= t1; t += per, i++) s.push({ at: t, pos: i % 2 ? hi : lo }); return s; };
const posAt = (s, t) => { if (t <= s[0].at) return s[0].pos; for (let i = 1; i < s.length; i++) if (s[i].at >= t) { const a = s[i - 1], c = s[i]; return a.pos + (c.pos - a.pos) * (t - a.at) / (c.at - a.at); } return s.at(-1).pos; };
const SCRIPT = saw(0, 3900, 300, 10, 90), RUN = saw(4000, 7900, 200, 35, 65);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const hex = (h) => [1, 3, 5].map((i) => parseInt(String(h).trim().slice(i, i + 2), 16));
const close = (px, c, tol = 48) => px && c && px.every((v, i) => i > 2 || Math.abs(v - c[i]) <= tol);

try {
  await ev((p) => { app.project.openVideo(p, { force: true }); }, clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve('restore'); }); }
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__pawDev?.groupsFor, null, { timeout: 30000 });
  const key = await ev(() => 'video.posbar:' + app.doc.media.path);
  await ev(([S, R, key]) => {
    const tr = __pawDev.trackingFor(app);
    app.devicePreview.toggle(false);   // the plan path is unit-tested (machinePos); here the raw follow
    app.settings.set(key, null); app.player.setUi({ posBar: false, sim: true, simFold: false });
    app.setMode('track'); app.player.pause();
    app.doc.scenes = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000 }];
    app.doc.axes = { ...app.doc.axes, stroke: S };
    const run = __pawDev.makeRun({ n: 9, tracker: { id: 'lk_box', name: 'test run' }, params: {}, range: { start: 4000, end: 8000 }, roi: null,
      result: { samples: R.map((p) => [p.at, p.pos / 100]), points: R, scenes: [{ start_ms: 4000, end_ms: 8000, sign: 1 }], channels: {}, notes: [] }, frames: __pawDev.newFrames(), runs: [] });
    tr.runs = [run]; app.doc.ghosts = [tr.ghostOf(run)];
    app.doc.runRanges = [{ id: 'rr9', run: run.id, t0: 4000, t1: 8000, layer: 0 }];   // paw-1ysd: the run plays shot 2
    tr.select(run.id);
  }, [SCRIPT, RUN, key]);
  await wait(500);

  // ---- 2a. the playback bar's toggle: on ----
  const btn = page.locator('button[aria-label="Position bar"]');
  await btn.click(); await wait(400);
  ok(await ev(() => !!app.player.ui.posBar && !!document.querySelector('canvas.pbar')), 'ruler button: the bar is on');

  const read = () => ev(() => {
    const cv = document.querySelector('canvas.pbar'), v = document.querySelector('.vsim'), un = v?.querySelector('.unap');
    return { t: app.player.displayMs, sim: parseFloat(v?.querySelector('.sub .pv')?.textContent), simUn: v?.dataset.unapplied || '', unShown: !!un && getComputedStyle(un).display !== 'none',
      bar: parseFloat(cv?.dataset.pos), src: cv?.dataset.src };
  });
  // the hit strip's ends (stage px of the page) and what the canvas painted at a point
  const geo = () => ev(() => {
    const h = document.querySelector('[data-testid="posbar-hit"]'), r = h.getBoundingClientRect(), cs = getComputedStyle(h);
    const m = /rotate\(([-\d.e]+)rad\)/.exec(h.style.transform), a = m ? +m[1] : 0, L = parseFloat(h.style.width) - 28;
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2, ux = Math.cos(a), uy = Math.sin(a);
    return { D: [cx - ux * L / 2, cy - uy * L / 2], O: [cx + ux * L / 2, cy + uy * L / 2], c: [cx, cy], pe: cs.pointerEvents };
  });
  const pixel = (x, y) => ev(([x, y]) => {
    const cv = document.querySelector('canvas.pbar'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
    return [...cv.getContext('2d').getImageData(Math.round((x - r.x) * k), Math.round((y - r.y) * k), 1, 1).data];
  }, [x, y]);
  const colors = await ev(() => { const cv = document.querySelector('canvas.pbar'), s = getComputedStyle(cv); return { mark: s.getPropertyValue('--accent'), unap: s.getPropertyValue('--warn-ink') }; });
  const markAt = (g, pos) => [g.D[0] + (g.O[0] - g.D[0]) * pos / 100, g.D[1] + (g.O[1] - g.D[1]) * pos / 100];

  // ---- 1. the source: the script, i.e. the points on shot 1 and the run live on shot 2 ----
  for (const [t, want, what] of [[1000, SCRIPT, 'points'], [2150, SCRIPT, 'points'], [5100, RUN, 'run'], [6950, RUN, 'run']]) {
    await ev((t) => app.player.seek(t, { exact: true }), t); await wait(700);
    const r = await read(), exp = posAt(want, r.t), g = await geo();
    ok(near(r.sim, exp, 0.15) && near(r.bar, exp, 0.15) && r.src === 'script',
      `t ${Math.round(r.t)}: machine preview ${r.sim}, bar ${r.bar} (${r.src}) = the ${what} ${exp.toFixed(1)}`);
    ok(!r.simUn && !r.unShown, `t ${Math.round(r.t)}: nothing "unapplied" in the preview`);
    const [mx, my] = markAt(g, r.bar), px = await pixel(mx, my), off = await pixel(...markAt(g, r.bar > 50 ? r.bar - 35 : r.bar + 35));
    const col = hex(colors.mark);
    ok(close(px, col) && !close(off, col, 24), `t ${Math.round(r.t)}: the marker is painted at ${r.bar} (${px.slice(0, 3)} ~ ${col}), not 35 away (${off.slice(0, 3)})`);
  }
  await page.screenshot({ path: `${out}/1-track-run.png` });

  const drag = async (from, dx, dy, { shift = false, esc = false } = {}) => {
    await page.mouse.move(from[0], from[1]); await wait(80);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.down();
    for (let k = 1; k <= 12; k++) await page.mouse.move(from[0] + dx * k / 12, from[1] + dy * k / 12);
    if (esc) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    await wait(400);
  };
  const stored = () => ev((k) => app.settings.get(k, null), key);

  // ---- 1b. Track tab, box tracker: the bar over the idle ROI tool ----
  const roiOf = () => ev(() => JSON.stringify(__pawDev.trackingFor(app).roi ?? null));
  const hist = () => ev(() => app._history?.index ?? app.history?.index ?? -1);
  ok(await ev(() => app.player.overlays.tool === 'tracking.roi' && ['box', 'box_or_points', 'points'].includes(__pawDev.trackingFor(app).tracker?.roi)),
    'Track: a box tracker is selected, the ROI tool is the active tool (' + await ev(() => __pawDev.trackingFor(app).tracker?.roi) + ')');
  await ev(() => { __pawDev.trackingFor(app).roi = null; }); await wait(200);
  const t0g = await geo(), h0 = await hist();
  ok(t0g.pe === 'auto', 'Track: the hit strip takes the pointer over the idle ROI tool');
  await page.mouse.move(t0g.c[0] - 40, t0g.c[1]); await page.mouse.move(t0g.c[0], t0g.c[1]); await wait(150);
  const tcur = await ev(() => getComputedStyle(document.querySelector('[data-testid="posbar-hit"]')).cursor);
  ok(tcur === 'move', 'Track: hover over the body shows cursor ' + tcur);
  await page.mouse.move(t0g.O[0], t0g.O[1]); await wait(150);
  const ecur = await ev(() => getComputedStyle(document.querySelector('[data-testid="posbar-hit"]')).cursor);
  ok(ecur === 'crosshair', 'Track: hover over an end shows cursor ' + ecur);
  await drag(t0g.c, -200, 40);
  const t1g = await geo();
  ok(near(t1g.c[0], t0g.c[0] - 200, 3) && near(t1g.c[1], t0g.c[1] + 40, 3), `Track: body drag moved the bar by (${(t1g.c[0] - t0g.c[0]).toFixed(0)}, ${(t1g.c[1] - t0g.c[1]).toFixed(0)})`);
  await drag(t1g.O, 120, 60);
  const t2g = await geo();
  ok(near(t2g.O[0], t1g.O[0] + 120, 3) && near(t2g.O[1], t1g.O[1] + 60, 3) && near(t2g.D[1], t1g.D[1], 2), 'Track: end drag scaled / turned it');
  ok((await roiOf()) === 'null' && (await hist()) === h0 && (await stored()) != null, `Track: no ROI made (${await roiOf()}), undo history unchanged (${h0} -> ${await hist()}), placement stored`);
  const away = [t2g.D[0] - 250, t2g.D[1] - 120];
  await page.mouse.move(away[0], away[1]); await page.mouse.down(); await page.mouse.up(); await wait(300);
  const r1b = await roiOf();
  ok(r1b === 'null', 'Track: a click away from the bar makes no ROI (paw-x8we: nothing draws one on the video): ' + r1b.slice(0, 80));
  await ev((k) => { __pawDev.trackingFor(app).roi = null; app.settings.set(k, null); }, key); await wait(400);

  // ---- 2b. off / on again ----
  await btn.click(); await wait(300);
  ok(await ev(() => !app.player.ui.posBar && !document.querySelector('canvas.pbar')), 'ruler button: off');
  await btn.click(); await wait(400);
  ok(await ev(() => !!app.player.ui.posBar && !!document.querySelector('canvas.pbar')), 'ruler button: on again');

  // ---- 3. drags in the Refine tab (no overlay tool owns the pointer) ----
  await ev(() => app.setMode('refine')); await wait(800);
  ok(await ev(() => !app.player.overlays.activeTool && !!document.querySelector('canvas.pbar')), 'Refine: the bar is there, no tool active');
  let g0 = await geo();
  ok(g0.pe === 'auto', 'the hit strip takes the pointer');
  await page.mouse.move(g0.c[0] - 40, g0.c[1]); await page.mouse.move(g0.c[0], g0.c[1]); await wait(150);
  const cur = await ev(() => getComputedStyle(document.querySelector('[data-testid="posbar-hit"]')).cursor);
  ok(cur === 'move', 'hover over the body: cursor ' + cur);
  await drag(g0.c, -300, 60);
  let g1 = await geo(), s1 = await stored();
  ok(near(g1.c[0], g0.c[0] - 300, 3) && near(g1.c[1], g0.c[1] + 60, 3) && near(g1.O[1] - g1.D[1], g0.O[1] - g0.D[1], 2),
    `body drag moved the bar by (${(g1.c[0] - g0.c[0]).toFixed(0)}, ${(g1.c[1] - g0.c[1]).toFixed(0)}), same length`);
  ok(s1 && s1.x0 === s1.x1 && s1.x0 < 0.9, 'stored placement: ' + JSON.stringify(s1));
  const r1 = await read(), p1 = await pixel(...markAt(g1, r1.bar));
  ok(close(p1, hex(colors.mark)), `painted at the new place (${p1.slice(0, 3)})`);
  const pOld = await pixel(...markAt(g0, r1.bar));
  ok(pOld[3] === 0, `nothing left at the old place (alpha ${pOld[3]})`);

  await drag(g1.O, 200, 100);   // the out end: scale and turn
  const g2 = await geo(), s2 = await stored();
  ok(near(g2.O[0], g1.O[0] + 200, 3) && near(g2.O[1], g1.O[1] + 100, 3) && near(g2.D[0], g1.D[0], 2) && near(g2.D[1], g1.D[1], 2),
    `end drag: the out end followed (${g2.O.map(Math.round)}), the deep end stayed (${g2.D.map(Math.round)})`);
  ok(s2.x1 > s2.x0 && s2.x0 === s1.x0 && s2.y0 === s1.y0, 'stored: turned, the deep end unchanged ' + JSON.stringify(s2));

  await drag(g2.c, 200, 0, { shift: true });
  const g3 = await geo();
  ok(near(g3.c[0], g2.c[0] + 50, 3), `Shift = fine: 200 px of pointer moved it ${(g3.c[0] - g2.c[0]).toFixed(1)} px`);
  const s3 = await stored();
  await drag(g3.c, -150, -40, { esc: true });
  ok(JSON.stringify(await stored()) === JSON.stringify(s3) && near((await geo()).c[0], g3.c[0], 1), 'Esc cancelled the drag: stored and drawn as before');

  // ---- 2c. double-click the ruler button: back to the default place ----
  await btn.dblclick(); await wait(500);
  const gd = await geo();
  ok((await stored()) == null && (await ev(() => !!app.player.ui.posBar)) && near(gd.c[0], g0.c[0], 2) && near(gd.c[1], g0.c[1], 2),
    `double-click: default place again (${gd.c.map(Math.round)} vs ${g0.c.map(Math.round)}), on`);
  await page.screenshot({ path: `${out}/2-refine-reset.png` });

  // ---- 4. Groups tool on: a click on the bar paints ----
  await ev(() => { app.setMode('track'); app.player.seek(1000, { exact: true }); app.settings.set('tracking.groups.grow', false); app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.brush', 0.03); });
  await wait(1200);
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); }); await wait(700);
  const n0 = await ev(() => __pawDev.groupsFor(app).groups.length), gg = await geo();
  ok(gg.pe === 'none' && (await ev(() => app.player.overlays.tool)) === 'tracking.groups', `Groups on: the bar is display only (pointer-events ${gg.pe})`);
  const at = markAt(gg, 20);
  await page.mouse.move(at[0], at[1]); await page.mouse.down(); await page.mouse.up(); await wait(800);
  const n1 = await ev(() => __pawDev.groupsFor(app).groups.length);
  ok(n1 === n0 + 1 && (await stored()) == null && near((await geo()).c[1], gg.c[1], 1), `a click on the bar painted a group (${n0} -> ${n1}); the bar did not move`);
  await page.screenshot({ path: `${out}/3-groups.png` });
  await ev(() => { const G = __pawDev.groupsFor(app); if (G.on) app.commands.run('tracking.groups'); });
} catch (e) { fails++; console.log('ERR', e); }
await b.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
