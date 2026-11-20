// dev/modrun-check.mjs -- paw-ef73.26: a modifier's own run in YOUR test instance (node dev/test-app.mjs start ...; the
// CDP_* env it prints; the fake sidecar's sam2_mask answers painted groups like v4.39). On a clip of flat shapes (an orange
// bar = the shaft sliding toward a blue box = the opening; make one with ffmpeg drawbox) with one Insertion modifier:
// right-click it › Track › SAM mask opens Groups in the modifier's mode on a frame inside it (shaft armed), two strokes
// paint its seed (the scene's own groups untouched), T tracks just its range (a 'modrun' run, assigned: the Source list
// marks it), its masks show on the video while selected, its thin trace + seed mark on the Tracker row; Correct its SAM
// mask here starts a correction from the run's masks, T re-tracks with it (the run replaced, the fix sent), Source ›
// Generated / back, deleting the run unassigns it.   node dev/modrun-check.mjs <clip.mp4> <out dir>
import { mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out = '.'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 250) => page.waitForTimeout(ms);
const shot = async (name, clipTo = null) => { await wait(350); await page.screenshot({ path: `${out}/${name}.png`, ...(clipTo ? { clip: clipTo } : {}) }); console.log('wrote', `${out}/${name}.png`); };
const rowAt = (t, frac = 0.5) => ev(([t, f]) => { const c = document.querySelector('[data-tl-lane="fx"] canvas').getBoundingClientRect(), v = window.app.view; return { x: c.left + ((t - v.start) / v.span) * c.width, y: c.top + c.height * f }; }, [t, frac]);
const menuItem = async (re) => { const it = page.locator('[role="menu"] .k-item-label').filter({ hasText: re }).first(); return (await it.count()) ? it : null; };
const openMenu = async () => { const a = await rowAt(3000); await page.mouse.click(a.x, a.y, { button: 'right' }); await wait(300); };
try {
  await ev((p) => { app.dialog?.resolve('discard'); app.project.openVideo(p, { force: true }); }, clip);
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready && app.player.vw > 0))); k++) {   // an earlier run's autosave: Discard
    const d = page.getByRole('button', { name: 'Discard' });
    if (await d.count()) await d.first().click().catch(() => {});
    await wait(500);
  }
  await page.waitForFunction(() => !app.project.busy, null, { timeout: 30000 });
  await wait(500);
  await page.waitForFunction(() => window.__pawDev, null, { timeout: 30000 });
  await ev(() => {
    window.TR = window.__pawDev.trackingFor(app);
    app.setMode('track');
    app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['anal', 'penetration'] }];
    app.doc.fx = [{ id: 'i', kind: 'insertion', t0: 2000, t1: 6000, params: {} }];
    app.player.pause(); app.player.seek(1000, { exact: true });
    app.setView({ start: 0, span: 8000 });
    app.settings.set('tracking.groups.corner', 'br');   // the Groups toolbar off the shapes
  });
  await page.waitForFunction(() => TR.listed || TR.trackers.length, null, { timeout: 30000 }).catch(() => ev(() => TR.list()));
  await wait(800);
  await shot('1-before');

  // ---- stage 1: Track ▸ SAM mask on a modifier with no seed: paint its own seed ----
  await openMenu();
  const tr = await menuItem(/^Track$/);
  ok(!!tr, 'the modifier\'s menu has Track');
  if (tr) { await tr.hover(); await wait(400); }
  await shot('2-track-menu');
  const sam = await menuItem(/SAM mask/);
  ok(!!sam, 'Track lists SAM mask');
  await sam?.click(); await wait(600);
  const g0 = await ev(() => { const G = document.querySelector('[data-testid="groups-tools"]'); return { tool: !!G, t: app.player.timeMs }; });
  ok(g0.tool && g0.t >= 2000 && g0.t < 6000, `Groups opens on a frame inside the modifier (playhead ${g0.t.toFixed(0)} ms)`);
  const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (px, py) => [box.x + (px / 1280) * box.w, box.y + (py / 720) * box.h];
  const barX = await ev(() => 300 + 200 * Math.sin((app.player.timeMs / 1000) * 1.5));
  const stroke = async (pts, mods = []) => { for (const m of mods) await page.keyboard.down(m); await page.mouse.move(...at(...pts[0])); await page.mouse.down(); for (const q of pts.slice(1)) await page.mouse.move(...at(...q), { steps: 3 }); await page.mouse.up(); for (const m of mods) await page.keyboard.up(m); await wait(300); };
  await stroke([[barX + 40, 360], [barX + 140, 358], [barX + 260, 362], [barX + 380, 360]]);
  const first = await ev(() => (app.doc.fx[0].seeds?.[0]?.groups || []).length);
  if (!first) { await shot('3a-first-stroke-lost'); console.log('NOTE the first stroke after the menu did not paint; again'); await stroke([[barX + 40, 360], [barX + 140, 358], [barX + 260, 362], [barX + 380, 360]]); }
  ok(first > 0, 'the first stroke after the menu paints');
  // (the opening: Bottom › anus on the palette; added to the seed below by the script, the palette is the Groups tool's own)
  const seed = await ev(() => ({ fx: app.doc.fx[0], scene: app.doc.scenes[0].groups || [], undo: app.history.undoLabel }));
  const names = (seed.fx.seeds?.[0]?.groups || []).map((q) => q.name);
  ok(names.includes('c2_penis'), `the seed is the modifier's: ${JSON.stringify(names)} on ${seed.fx.seeds?.[0]?.t_ms} ms`);
  if (!names.some((n) => /anus/.test(n))) await ev(() => { const s = app.doc.fx[0].seeds[0]; app.doc.fx = [{ ...app.doc.fx[0], seeds: [{ ...s, groups: [...s.groups, { name: 'c1_anus', who: 'c1', part: 'anus', poly: [[0.6, 0.3], [0.82, 0.3], [0.82, 0.68], [0.6, 0.68]], t_ms: s.t_ms, source: 'user' }] }] }]; });
  ok(!seed.scene.length, 'the shot\'s own groups are untouched');
  ok(/^Modifier seed: paint/.test(seed.undo || ''), `one undo step per stroke ("${seed.undo}")`);
  await shot('3-seed-painted', { x: box.x, y: box.y, width: box.w, height: box.h });

  // ---- T: its own run over just its range ----
  await page.keyboard.press('t');
  await page.waitForFunction(() => TR.runs.some((r) => r.mod === 'i'), null, { timeout: 60000 });
  await wait(600);
  const r1 = await ev(() => { const r = TR.runs.find((x) => x.mod === 'i'), g = TR.ghost(r.id); return { id: r.id, tag: r.tag, range: r.range, kind: g.source.kind, script: g.script.length, src: app.doc.fx[0].src, seeds: r.seeds, note: r.notes?.find((n) => n.code === 'fake_groups')?.message, sel: TR.selectedId, chans: Object.keys(r.channels).filter((k) => /_in$/.test(k)) }; });
  ok(r1.tag === 'mod' && r1.kind === 'modrun' && r1.script === 0, `an extra run of kind 'modrun' (no lane / shot takes it): ${r1.id} ${r1.tag} ${r1.kind} ${r1.script}`);
  ok(r1.range.start === 2000 && r1.range.end <= 6000, `over just the modifier's range (${r1.range.start}–${r1.range.end})`);
  ok(r1.src?.run === r1.id && r1.src?.ch === 'sem_c2_penis_in', `assigned to the modifier: ${JSON.stringify(r1.src)}`);
  ok(r1.sel === r1.id, 'selected (its masks on the video)');
  const ov = await ev(() => { app.player.seek(3000, { exact: true }); return null; });
  void ov; await wait(500);
  const ovr = await ev(() => { const f = TR.overlayFrame(app.player.timeMs); return f ? { run: f.run.id, masks: f.fr.ov[f.i]?.masks?.length } : null; });
  ok(ovr?.run === r1.id && ovr.masks >= 2, `the overlay draws its masks on the frame on show (${JSON.stringify(ovr)})`);
  await shot('4-masks-on-video', { x: box.x, y: box.y, width: box.w, height: box.h });
  await shot('5-tracker-row');
  await openMenu();
  const src = await menuItem(/^Source$/);
  if (src) { await src.hover(); await wait(400); }
  const radio = await ev(() => [...document.querySelectorAll('[role="menu"] [role="menuitemradio"]')].map((e) => ({ t: e.textContent.trim(), on: e.getAttribute('aria-checked') === 'true' })));
  ok(radio.some((x) => x.on && /SAM shaft · own run/.test(x.t)), `Source marks "SAM shaft · own run": ${JSON.stringify(radio)}`);
  await shot('6-source-menu');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

  // ---- stage 3: correct its SAM mask on a later frame, T re-tracks with the fix ----
  await ev(() => app.player.seek(5000, { exact: true })); await wait(400);
  await openMenu();
  const cor = await menuItem(/Correct its SAM mask here/);
  ok(!!cor, 'the menu offers Correct its SAM mask here');
  await cor?.click(); await wait(600);
  const c1 = await ev(() => ({ seeds: app.doc.fx[0].seeds.map((s) => [s.t_ms, s.groups.map((q) => q.name)]), undo: app.history.undoLabel, tool: !!document.querySelector('[data-testid="groups-tools"]') }));
  ok(c1.tool && c1.seeds.length === 2 && c1.seeds[1][1].length >= 1, `a correction entry started from the run's masks: ${JSON.stringify(c1.seeds)}`);
  ok(/correct the mask/.test(c1.undo || ''), `one undo step ("${c1.undo}")`);
  await shot('7-correction-start', { x: box.x, y: box.y, width: box.w, height: box.h });
  const bx5 = 300 + 200 * Math.sin(5 * 1.5);
  await stroke([[bx5 + 200, 345], [bx5 + 420, 375]], ['Shift']);   // erase the far end of the shaft
  await page.keyboard.press('t');
  await page.waitForFunction((old) => TR.runs.some((r) => r.mod === 'i' && r.id !== old) && !TR.run(old), r1.id, { timeout: 60000 });
  await wait(500);
  const r2 = await ev(() => { const r = TR.runs.find((x) => x.mod === 'i'); return { id: r.id, n: TR.runs.filter((x) => x.mod === 'i').length, src: app.doc.fx[0].src, note: r.notes?.find((n) => n.code === 'fake_groups')?.message, seeds: r.seeds }; });
  ok(r2.n === 1 && r2.src.run === r2.id, `re-tracked: the run replaced (${r1.id} -> ${r2.id}), still assigned`);
  ok(/"fixes":\[5000\]/.test(r2.note || ''), `the correction went as a SAM prompt on its frame: ${r2.note}`);
  ok(JSON.stringify(r2.seeds) === '[' + c1.seeds.map((s) => s[0]).join(',') + ']', `its seed marks: ${JSON.stringify(r2.seeds)}`);
  await shot('8-after-retrack');

  // ---- stage 2: Source › Generated, then back; deleting the run unassigns ----
  await openMenu();
  await (await menuItem(/^Source$/))?.hover(); await wait(400);
  await (await menuItem(/^Generated/))?.click(); await wait(300);
  ok(await ev(() => app.doc.fx[0].src === 'none'), 'Source › Generated: src none');
  await ev(() => app.undo()); await wait(200);
  ok(await ev((id) => app.doc.fx[0].src?.run === id, r2.id), 'undo: back to its own run');
  await ev((id) => TR.remove(id), r2.id); await wait(300);
  await openMenu();
  await (await menuItem(/^Source$/))?.hover(); await wait(400);
  const after = await ev(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"]')].map((e) => e.textContent.trim()));
  ok(after.some((t) => /Nothing tracked over it yet/.test(t)), 'its run deleted: nothing to drive it (generated)');
  await shot('9-after-delete');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

  // ---- stage 4: a shot run with a SAM shaft ("the original track") assigned: its points take the depth inside the
  //      modifier, the same outside ----
  await ev(() => {
    const D = window.__pawDev, t = [], v = [], inn = [];
    for (let x = 0; x < 8000; x += 40) { t.push(x); v.push(0.5 + 0.5 * Math.sin((x / 1000) * 2 * Math.PI)); inn.push(x < 2000 ? 0 : x > 5000 ? 1 : (x - 2000) / 3000); }
    const pts = []; for (let x = 250; x < 8000; x += 500) pts.push({ at: x, pos: Math.round(100 * (0.5 + 0.5 * Math.sin((x / 1000) * 2 * Math.PI))) });
    const run = D.makeRun({ n: 50, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: {}, range: { start: 0, end: 8000 }, roi: null,
      result: { samples: t.map((x, i) => [x, v[i]]), points: pts, scenes: [{ start_ms: 0, end_ms: 8000, sign: 1, shaft: { c2_penis: { source: 'sam', full: 'seen' } } }],
        channels: { sem_c2_penis_in: t.map((x, i) => [x, inn[i]]), sem_c2_penis_in_conf: t.map((x) => [x, 1]) } }, frames: D.newFrames(), runs: TR.runs });
    TR.runs = [...TR.runs, run]; app.doc.ghosts = [...app.doc.ghosts, TR.ghostOf(run)]; window.SH = run.id;
  });
  await wait(600);
  const pos = () => ev(() => { const r = TR.run(SH); return Array.from(r.points.at, (a, i) => [a, r.points.pos[i]]); });
  const pBefore = await pos();
  await ev(() => { app.doc.fx = [{ ...app.doc.fx[0], src: { run: SH, ch: 'sem_c2_penis_in' } }]; });
  await wait(800);
  const pAfter = await pos();
  const outside = (q) => JSON.stringify(q.filter(([a]) => a < 1500 || a > 6500));
  ok(outside(pBefore) === outside(pAfter), 'outside the modifier (and its cross-fades) the shot run points are unchanged');
  ok(JSON.stringify(pBefore) !== JSON.stringify(pAfter), `inside, its points follow the depth (${pBefore.filter(([a]) => a >= 2000 && a < 6000).length} -> ${pAfter.filter(([a]) => a >= 2000 && a < 6000).length} points in 2–6 s)`);
  await ev(() => TR.select(SH)); await shot('10-depth-blend');
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close();
}
