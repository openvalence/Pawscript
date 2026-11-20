// Re-derive after tracking (paw-a3n) in the real store and panel (Playwright + Edge, dev/shell.html on the mock backend):
// a shot derive is one undo step and recomposes the run's ghost; a drag previews without history; accepted points change
// only through Apply; a run without stored tracks says re-track. Own Vite server on a free port.
// Skipped unless REDERIVE_E2E=1:  REDERIVE_E2E=1 node --test test/rederive-e2e.test.mjs   (optional SHOT_DIR=... screenshots)
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ON = process.env.REDERIVE_E2E === '1';
const root = fileURLToPath(new URL('..', import.meta.url));

describe('rederive e2e', { skip: !ON && 'set REDERIVE_E2E=1 to run the browser checks' }, () => {
  let server, browser, page;
  before(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ root, logLevel: 'error', cacheDir: process.env.VITE_CACHE_DIR || undefined, server: { port: Number(process.env.REDERIVE_E2E_PORT) || 20000 + Math.floor(Math.random() * 20000), strictPort: true, hmr: false, ws: false, watch: null } });
    await server.listen();
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    page.on('console', (m) => { if (m.text().startsWith('DBG')) console.log(m.text().slice(0, 1500)); });
    // a cold dev server transforms the whole app on this first load: well over 30 s on a busy machine
    await page.goto(server.resolvedUrls.local[0] + 'dev/shell.html?mode=track', { timeout: 240000 });
    await page.waitForFunction(() => window.app?.doc, null, { timeout: 240000 });
    await page.evaluate(async () => {
      const R = await import('/src/lib/runs.js'), T = await import('/src/features/tracking/tracking.svelte.js'), S = await import('/src/features/timeline/state.svelte.js');
      const fx = await (await fetch('/test/fixtures/rederive-run.json')).json();
      const tr = T.trackingFor(window.app);
      app.doc.media = { ...app.doc.media, width: 1920, height: 1080 };
      app.doc.scenes = [{ start_ms: 0, end_ms: 8000 }, { start_ms: 8000, end_ms: 14000 }];
      const notes = [0, 1].map((k) => ({ code: 'primary', scene_index: k, message: 'proj', data: { chosen: 'proj' } }));
      const run = R.makeRun({ n: 7, tracker: { id: 'cotracker_points', name: 'CoTracker3' }, params: fx.auto.params, range: { start: 0, end: 14000 }, roi: null,
        result: { samples: fx.auto.channels.proj, points: [{ at: 100, pos: 0 }, { at: 7000, pos: 100 }, { at: 9000, pos: 0 }, { at: 13000, pos: 100 }], scenes: fx.scenes.map((s) => ({ ...s, sign: 1 })), channels: fx.auto.channels, notes },
        frames: R.newFrames(), runs: [] });
      const RC = await import('/src/lib/runs-channel.js'), sp = RC.pointsFromChannel(run, 'proj');   // realistic sidecar points
      run.points = run.points0 = sp;
      tr.runs = [run];
      app.doc.ghosts = [...(app.doc.ghosts || []), tr.ghostOf(run)];
      tr.select(run.id);
      app.doc.runRanges = [{ id: 'rr7', run: run.id, t0: 0, t1: 14000, layer: 0 }];   // paw-1ysd: the run plays where its range is; Adjust edits that run (deriveRun)
      S.selectShot?.(app, 0, true);
      S.setSel?.({ active: 0, shots: [0] });
      window.TR = tr; window.RID = run.id;
      window.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
      // scene 2 away from the cut (a composed run's cut is stitched)
      window.inScene = (k) => (TR.ghost(RID).script || []).filter((a) => (k === 0 ? a.at < 8000 : a.at >= 8600)).map((a) => a.at + ':' + a.pos).join(',');
      // the ghost as the store derives it today (Detail By render, holds: paw-na9u) before anything is compared: a run made here
      // starts with its raw points, and the first re-derive, whatever starts it, would otherwise show up as a change
      app.doc.scenes = [...app.doc.scenes]; await sleep(300);
    });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  test('a shot derive is one undo step and recomposes only that shot of the ghost', async () => {
    const r = await page.evaluate(async () => {
      const s0 = inScene(0), s1 = inScene(1), n0 = app._history.index;
      TR.setDerive(0, { axis: { mode: 'horizontal' } });
      await sleep(50);
      const after = { s0: inScene(0) !== s0, s1: inScene(1) === s1, derive: (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive), entries: app._history.index - n0 };
      app.undo(); await sleep(50);
      return { after, undone: { s0: inScene(0) === s0, derive: (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive) ?? null } };
    });
    // match: every derive written since paw-s80k (55133e5) records that the shot plays the way up of its own channel
    assert.deepEqual(r, { after: { s0: true, s1: true, derive: { axis: { mode: 'horizontal' }, match: true }, entries: 1 }, undone: { s0: true, derive: null } });
  });

  test('a drag previews without history; its release is one step', async () => {
    const r = await page.evaluate(async () => {
      const s0 = inScene(0), n0 = app._history.index;
      TR.camPeek = true;
      TR.setDerive(0, { cam: { strength: 20 } }, { commit: false }); await sleep(30);
      TR.setDerive(0, { cam: { strength: 20 } }, { commit: false }); await sleep(30);
      const mid = { changed: inScene(0) !== s0, stored: (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive) ?? null, entries: app._history.index - n0, compare: !!TR.camCompare };
      TR.setDerive(0, { cam: { strength: 20 } }); TR.camPeek = false; await sleep(30);
      const done = { stored: (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.cam?.strength, entries: app._history.index - n0, preview: TR.derivePreview };
      app.undo(); await sleep(30);
      return { mid, done, back: inScene(0) === s0 };
    });
    assert.deepEqual(r, { mid: { changed: true, stored: null, entries: 0, compare: true }, done: { stored: 20, entries: 1, preview: null }, back: true });
  });

  test('paw-x7w7: a live shot follows Adjust at once; a baked one never changes; Bake is undoable', async () => {
    const r = await page.evaluate(async () => {
      const ax = () => (app.doc.axes[app.doc.activeAxis] || []).filter((a) => a.at < 8000).map((a) => a.at + ':' + a.pos).join(',');
      const live = () => app.script.filter((a) => a.at < 8000).map((a) => a.at + ':' + a.pos).join(',');
      // the shot starts live: no baked points under it (earlier steps in this file may have left some)
      app.doc.axes = { ...app.doc.axes, [app.doc.activeAxis]: (app.doc.axes[app.doc.activeAxis] || []).filter((a) => a.at >= 8000) };
      const l0 = live();
      TR.setDerive(0, { axis: { mode: 'vertical' } }); await sleep(50);
      const follows = live() !== l0 && ax() === '';
      TR.bake({ shots: [0] }); await sleep(30);
      const baked = ax();
      TR.setDerive(0, { axis: { mode: 'horizontal' } }); await sleep(50);
      const untouched = ax() === baked;
      app.undo(); await sleep(30);   // the derive change
      app.undo(); await sleep(30);   // the Bake
      const unbaked = ax() === '';
      app.undo(); await sleep(30);
      return { follows, bakedSome: baked.length > 0, untouched, unbaked };
    });
    assert.deepEqual(r, { follows: true, bakedSome: true, untouched: true, unbaked: true });
  });

  test('panel: the Adjust strip acts on the selected shot (keyboard on the strength slider = one step); an old run says re-track', async () => {
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/derive-before.png' });
    // paw-p8o2: the Adjust strip lives only in the band under the stroke lane: unfold it
    await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); });
    await page.waitForSelector('[data-testid="derive-strip"]', { timeout: 5000 });
    if (process.env.SHOT_DIR) await page.locator('[data-testid="derive-strip"]').screenshot({ path: process.env.SHOT_DIR + '/derive-strip.png' });
    // the camera removal is a fold of the Adjust strip since paw-r73w (9e2e723)
    await page.evaluate(() => app.settings.set('tracking.panel.open', { ...(app.settings.get('tracking.panel.open', {}) || {}), camera: true })); await page.waitForTimeout(200);
    const thumb = page.locator('[data-testid="derive-strip"]').getByRole('slider', { name: 'Camera removal strength' });
    // the arrows go to the key map, not a focused slider, since a08921c (paw-ks21); PageDown still steps it (x10)
    await thumb.focus(); await page.keyboard.press('PageDown'); await page.waitForTimeout(100);
    const strength = await page.evaluate(() => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.cam?.strength);
    assert.ok(strength >= 0 && strength < 100, `strength stepped down: ${strength}`);
    if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/derive-app.png' });
    const txt = await page.evaluate(async () => {
      const r = TR.run(RID);
      TR.runs = [{ ...r, restored: true }]; await sleep(80);
      return document.querySelector('[data-testid="derive-block"]')?.textContent || '';
    });
    assert.match(txt, /Re-track needed/);
  });

  test('paw-bh2: Track backward from the first frame of a shot goes on to the previous hard cut, through the cut, seed marked; the cut is offered as a camera move', async () => {
    const r = await page.evaluate(async () => {
      const S = await import('/src/features/timeline/state.svelte.js');
      app.doc.scenes = [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 8000, join: true, split: 'camera' }, { start_ms: 8000, end_ms: 12000 }, { start_ms: 12000, end_ms: 20000, join: true }, { start_ms: 20000, end_ms: 30000 }];
      S.setSel({ active: 3, shots: [3] });
      app.doc.range = null;
      TR.trackers = [{ id: 'cotracker_points', name: 'CoTracker3', roi: 'box', params: [{ key: 'seed_frame', label: 'Seed frame', type: 'choice', default: 'first', choices: ['first', 'auto'] }] }];
      TR.trackerId = 'cotracker_points'; TR.paramsBy = { cotracker_points: { seed_frame: 'first' } }; TR.listed = true;
      TR.roi = { kind: 'box', x: 0.2, y: 0.2, w: 0.4, h: 0.4, t_ms: 12000 };
      let req = null, bandSeen = null;
      app.player.missing = false;   // the mock's video is not on disk: a Track asks to locate it first (paw-xfg6)
      app.backend.sidecar = async (q, h) => {
        if (q.cmd !== 'track') return { result: null, error: null, cancelled: true };   // the score / camera check that follow
        req = q;
        h.onEvent?.({ type: 'progress', done: 30, total: 120 }); await sleep(30);
        bandSeen = TR.trackJob && { ...TR.trackJob, frac: TR.progressFrac };
        const t = []; for (let ms = 9000; ms <= 12000; ms += 40) t.push(ms);
        h.onFrames?.(t.map((ms) => ({ t_ms: ms, value: 0.5, overlay: null })));
        return { result: { samples: t.map((ms) => [ms, 0.5 + 0.4 * Math.sin(ms / 200)]), points: [{ at: 9000, pos: 10 }, { at: 12000, pos: 90 }], scenes: [{ start_ms: 9000, end_ms: 12040, sign: 1 }],
          notes: [{ code: 'lost', message: 'points lost before 9000 ms', data: { t_ms: 9000, dropped: 30 } }], channels: {} }, error: null, cancelled: false };
      };
      TR.setDirection('backward');
      await TR.track(); await sleep(50);
      const run = TR.selected, toasts = [...document.querySelectorAll('.k-toast, [role=status], [role=alert]')].map((e) => e.textContent).join(' | ');
      const moved = TR.markCameraMoves([3]), after = { join: app.doc.scenes[3].join, split: app.doc.scenes[3].split };
      app.undo(); await sleep(20);
      TR.setDirection('both');
      return { req: { direction: req.direction, seed: req.seed_ms, start: req.start_ms, end: req.end_ms, soft: req.cuts.every((c) => c.kind === 'soft'), cut12: req.cuts.some((c) => c.t_ms === 12000) },
        band: bandSeen, range: run.range, seedMs: run.seedMs, dir: run.direction, job: TR.trackJob, offered: /camera move/i.test(toasts), moved, after, undone: app.doc.scenes[3].split ?? null };
    });
    assert.deepEqual(r.req, { direction: 'backward', seed: 12000, start: 8000, end: 12001, soft: true, cut12: true });
    assert.deepEqual(r.band, { dir: 'backward', seed: 12000, t0: 8000, t1: 12001, frac: 0.25 });
    assert.equal(r.range.start, 9000, 'the run covers what the sidecar tracked (stopped where the points were lost)');
    assert.equal(r.seedMs, 12000); assert.equal(r.dir, 'backward'); assert.equal(r.job, null);
    assert.ok(r.offered, 'the crossed cut is offered as a camera move');
    assert.deepEqual([r.moved, r.after, r.undone], [true, { join: true, split: 'camera' }, null]);
  });

  test('paw-e3i: the fused signal is a chip; its parts list pins / excludes (one undo step each) and the lane strip draws', async () => {
    const r = await page.evaluate(async () => {
      const R = await import('/src/lib/runs.js'), S = await import('/src/features/timeline/state.svelte.js');
      const T0 = Array.from({ length: 300 }, (_, i) => Math.round((i * 1000) / 30) + 20000), st = (ms) => Math.sin((2 * Math.PI * ms) / 1000);
      const ch = {}, put = (n, f) => { ch[`sem_${n}_x`] = T0.map((ms) => [ms, f(ms)[0]]); ch[`sem_${n}_y`] = T0.map((ms) => [ms, f(ms)[1]]); ch[`sem_${n}_n`] = T0.map((ms) => [ms, 0.03]); };
      put('c1_hips', (ms) => [0.4, 0.45 - 0.03 * st(ms)]); put('c1_tail', (ms) => [0.3, 0.4 - 0.03 * st(ms - 250)]);
      put('c2_hips', (ms) => [0.5, 0.6 + 0.02 * st(ms)]); put('c2_paws_r', (ms) => [0.6, 0.7 + 0.02 * st(ms)]);
      for (const k of ['centroid_x', 'centroid_y', 'cam_x', 'cam_y', 'proj']) ch[k] = T0.map((ms) => [ms, 0.5]);
      const run = R.makeRun({ n: 9, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 20000, end: 30000 }, roi: null,
        result: { samples: T0.map((ms) => [ms, 0.5]), points: [{ at: 20100, pos: 0 }, { at: 29900, pos: 100 }], scenes: [{ start_ms: 20000, end_ms: 30000, sign: 1 }], channels: ch, notes: [] }, frames: R.newFrames(), runs: [] });
      TR.runs = [...TR.runs.filter((x) => x.id !== run.id), run]; app.doc.ghosts = [...app.doc.ghosts, TR.ghostOf(run)];
      app.doc.scenes = [{ start_ms: 0, end_ms: 20000 }, { start_ms: 20000, end_ms: 30000 }, { start_ms: 30000, end_ms: 600000 }];
      TR.select(run.id); S.setSel({ active: 1, shots: [1] });
      const linked = TR.linkScene(1, run.id, 'fused'); await sleep(80);
      const inf = TR.fuseInfo(1), n0 = app._history.index;
      TR.toggleFusePart(1, 'c1:core~c2:core', 'exclude'); await sleep(50);
      const excluded = (app.doc.scenes[1].derives?.[run.id] ?? app.doc.scenes[1].derive)?.fuse?.exclude, after = TR.fuseInfo(1).candidates.find((c) => c.id === 'c1:core~c2:core'), steps = app._history.index - n0;
      app.undo(); await sleep(50);
      return { linked, chips: (await import('/src/lib/runs-channel.js')).pickerChannels(TR.run(run.id)).slice(0, 2), n: inf?.candidates.length, tail: inf?.candidates.find((c) => c.id === 'c1_tail~cam')?.lagging,
        excluded, share: after.share, steps, undone: (app.doc.scenes[1].derives?.[run.id] ?? app.doc.scenes[1].derive) ?? null, partsShown: !!document.querySelector('[data-testid="fuse-panel"]') };
    });
    if (process.env.SHOT_DIR) { await page.waitForTimeout(200); await page.locator('[data-testid="derive-strip"]').screenshot({ path: process.env.SHOT_DIR + '/fuse-parts.png' }); }
    // 7 candidates since the act rows went per painted limb part (c606604): c1:core~c2:core, c2:paws~c1:penis|core, c1:core~cam,
    // c2:core~cam, c2_hips~cam, c2_paws_r~cam, c1_tail~cam
    assert.deepEqual(r, { linked: true, chips: ['primary', 'fused'], n: 7, tail: true, excluded: ['c1:core~c2:core'], share: 0, steps: 1, undone: null, partsShown: true });
  });

  test('paw-e3i part 2: Smart stroke is one click (one undo step), the old points stay drawn as an A/B ghost, Strokes sliders preview live', async () => {
    const r = await page.evaluate(async () => {
      const run = TR.runs.find((x) => x.n === 9), g0 = TR.ghost(run.id).script.length, n0 = app._history.index;
      TR.setSmart(1, true); await sleep(80);
      const ab = app.doc.ghosts.find((g) => g.id === 'smart-ab'), whys = TR.run(run.id).whys, smartPts = TR.ghost(run.id).script.length;
      TR.setDerive(1, { strokes: { detail: 4 } }, { commit: false }); await sleep(50);
      const live = TR.ghost(run.id).script.length, stored = (app.doc.scenes[1].derives?.[RID] ?? app.doc.scenes[1].derive)?.strokes ?? null;
      TR.setDerive(1, { strokes: { detail: 4 } }); await sleep(50);
      const steps = app._history.index - n0, listed = TR.ghosts.some((g) => g.id === 'smart-ab');
      app.undo(); app.undo(); await sleep(80);
      return { abOn: !!ab?.script?.length, whys: !!whys?.why?.length, kinds: [...new Set(whys?.why || [])].sort(), changed: smartPts > 0, live: live >= smartPts, stored, steps, listed,
        abOff: !app.doc.ghosts.some((g) => g.id === 'smart-ab'), back: TR.ghost(run.id).script.length === g0, ui: !!document.querySelector('[data-testid="strokes"]') };
    });
    if (process.env.SHOT_DIR) {
      await page.evaluate(async () => { TR.setSmart(1, true); await sleep(80); });
      await page.locator('[data-testid="derive-strip"]').screenshot({ path: process.env.SHOT_DIR + '/smart-strip.png' });
      await page.screenshot({ path: process.env.SHOT_DIR + '/smart-app.png' });
      await page.evaluate(async () => { app.undo(); await sleep(50); });
    }
    assert.equal(r.abOn, true, 'the A/B ghost is drawn'); assert.equal(r.whys, true); assert.ok(r.kinds.includes('turn'));
    assert.equal(r.changed, true); assert.equal(r.live, true, 'detail adds points while dragging'); assert.equal(r.stored, null, 'a drag stores nothing');
    assert.equal(r.steps, 2, 'smart on + the slider release'); assert.equal(r.listed, false, 'the A/B ghost is not a run');
    assert.equal(r.abOff, true); assert.equal(r.back, true); assert.equal(r.ui, true);
  });
});
