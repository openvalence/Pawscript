// dev/pov-check.mjs -- paw-2vd5 in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a
// generated clip. Two shots, shot B detected "rides the stroke". It asserts
//   1. the POV chip sets POV by hand on shot B (stored as a shot tag, pressed, one undo step) over the detected kind;
//   2. it survives save / close / reopen (the .pawproj beside the clip);
//   3. with a run on the shots, camera removal on shot B is off from the tag, and the derive strip says so (POV as the reason).
//   node dev/pov-check.mjs <clip>
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [clip] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/pov-check.mjs <clip>'); process.exit(2); }
const proj = clip.replace(/\.[^.]+$/, '.pawproj');
for (const f of [proj, clip.replace(/\.[^.]+$/, '.funscript')]) if (existsSync(f)) rmSync(f);
const fx = JSON.parse(readFileSync(new URL('../test/fixtures/rederive-run.json', import.meta.url), 'utf8'));
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const open = async (project) => {
  const p = project ? ev((f) => app.project.openProject(f, { force: true }), project) : ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
};
/** Answer whatever the app asks while opening / saving: no recovery (it was saved), keep the project, replace. */
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; console.log('dialog', t, JSON.stringify(d.choices?.map((c) => c.id))); (window.__asked ||= []).push(t + ' ' + JSON.stringify(d.choices?.map((c) => c.id))); d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : d.choices?.[0]?.id ?? null); });
const povBtn = () => page.locator('.qb button:visible', { hasText: /^\s*POV\s*$/ }).first();
const shotChip = () => page.locator('button[data-chip="shot"]:visible').first();
/** The lane toolbar's Shot chip opens the shot's quick bar (view / camera chips). */
const shotBar = async () => { if (!(await povBtn().count())) { await shotChip().click(); await wait(400); } };

try {
  await page.waitForFunction(() => window.app && window.__pawDev, null, { timeout: 30000 });
  await open();
  await ev(() => {
    app.setMode('track'); app.player.pause();
    app.doc.scenes = [{ start_ms: 0, end_ms: 8000 }, { start_ms: 8000, end_ms: 14000, camera: [{ t0: 8000, t1: 14000, kind: 'reciprocal' }] }];
  });
  await ev(() => app.player.seek(10000, { exact: true })); await wait(600);
  await shotBar();
  ok(await povBtn().count() === 1, 'a POV chip beside the camera chips (Shot 2 quick bar)');
  const tip0 = await povBtn().getAttribute('title');
  ok(tip0 == null, 'no native title on the chip');
  const h0 = await ev(() => app._history.index);
  await povBtn().click(); await wait(400);
  const s1 = await ev(() => app.doc.scenes[1].tags || []);
  ok(s1.includes('pov'), `POV set by hand on shot B: tags ${JSON.stringify(s1)}`);
  ok(await povBtn().getAttribute('aria-pressed') === 'true', 'the chip shows pressed');
  ok((await ev(() => app._history.index)) - h0 === 1, 'one undo step');
  ok(/^Shot 2 · POV/.test((await shotChip().textContent()).trim()), `the lane toolbar names it: "${(await shotChip().textContent()).trim()}"`);
  const rp = page.locator('.qb button:visible', { hasText: /^\s*rides the stroke\s*$/ }).first();
  ok(await rp.getAttribute('aria-pressed') !== 'true', 'the detected "rides the stroke" is no longer the camera tag');

  // ---- 2. save / reopen ----
  const sp = ev(() => app.project.save());
  for (let k = 0; k < 4; k++) { await wait(400); await answer(); }
  const saved = await sp;
  const onDisk = existsSync(proj) ? JSON.parse(readFileSync(proj, 'utf8')) : null;
  ok(saved !== false && !!onDisk, `saved: ${proj} ${onDisk ? 'written' : 'missing'}`);
  const diskShots = (onDisk?.scenes || []).flatMap((s) => s.shots || [s]);
  ok(JSON.stringify(diskShots[1]?.tags || []).includes('"pov"'), `the .pawproj holds shot B's pov: ${JSON.stringify(diskShots[1]?.tags)}`);
  await ev(() => app.project.close()); await wait(500);
  await open(proj); await wait(500);
  console.log('     asked:', JSON.stringify(await ev(() => window.__asked || [])));
  const s2 = await ev(() => (app.doc.scenes || []).map((s) => s.tags || []));
  ok(JSON.stringify(s2[1] || []).includes('pov'), `after reopen shot B still has pov: ${JSON.stringify(s2)}`);
  await ev(() => { app.setMode('track'); app.player.seek(10000, { exact: true }); }); await wait(600);
  ok(/^Shot 2 · POV/.test((await shotChip().textContent()).trim()), 'after reopen the lane toolbar names it');
  await shotBar();
  ok(await povBtn().getAttribute('aria-pressed') === 'true', 'after reopen the chip shows pressed');

  // ---- 3. a run on the shots: camera removal off from the tag, the derive strip names POV ----
  await ev((fx) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    const c = fx.auto.channels;
    const notes = [0, 1].map((k) => ({ code: 'primary', scene_index: k, message: 'proj', data: { chosen: 'proj' } }));
    const run = D.makeRun({ n: 5, tracker: { id: 'cotracker_points', name: 'CoTracker3' }, params: fx.auto.params, range: { start: 0, end: 14000 }, roi: null,
      result: { samples: c.proj, points: [{ at: 100, pos: 0 }, { at: 7000, pos: 100 }, { at: 9000, pos: 0 }, { at: 13000, pos: 100 }], scenes: fx.scenes.map((s) => ({ ...s, sign: 1 })), channels: c, notes },
      frames: D.newFrames(), runs: tr.runs });
    run.points = run.points0 = D.pointsFromChannel(run, 'proj');
    tr.runs = [run]; app.doc.ghosts = [tr.ghostOf(run)]; tr.select(run.id);
    app.doc.runRanges = [{ id: 'rr5', run: run.id, t0: 0, t1: 14000, layer: 0 }];   // paw-1ysd: the run plays (and Adjust edits it) where its range is
    app.player.seek(10000);   // Adjust shows the shot under the playhead: shot B
    app.showPanel?.('tracking');
  }, fx);
  await wait(800);
  const st = await ev(() => { const c = TR.camState(1); return { from: c.from, mode: c.cam.mode, tag: c.tag?.tag, label: c.tag?.label }; });
  ok(st.from === 'tag' && st.mode === 'off' && st.tag === 'pov' && st.label === 'POV', `shot B camera removal: ${JSON.stringify(st)}`);
  const st0 = await ev(() => TR.camState(0).from);
  ok(st0 !== 'tag', `shot A (untagged) is not touched: ${st0}`);
  // paw-p8o2: the shot's Adjust strip lives only in the band under the stroke lane: unfold it (its ▾) when it is folded
  await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); }); await page.waitForTimeout(300);
  const note = await ev(() => [...document.querySelectorAll('[data-testid="cam-default-note"]')].map((e) => e.textContent).join(' | '));
  ok(/off by default \(POV shot\)/.test(note), `the derive strip says why -> "${note}"`);
  const pick = await ev(() => [...document.querySelectorAll('.pick')].map((e) => e.innerText.replace(/\s+/g, ' ')).join(' | '));
  console.log('     strip:', pick.slice(0, 200));
} catch (e) { fails++; console.log('FAIL threw', e?.message || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
