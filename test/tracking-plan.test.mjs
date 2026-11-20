// Track tagged scenes in the tracking store: Run tracks the action pieces only (never the off-screen scene), links each
// run to its scenes (camera default signal), the bridge appears over the cutaway, re-plan says done, cancel stops after
// the running piece; manual T over an off-screen scene leaves it out; scenes mode 'one' tracks the range as drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('tracking store: Track tagged scenes and the manual-T split', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const scenes = [{ start_ms: 0, end_ms: 10100, tags: ['pan'], camera: [{ t0: 0, t1: 4000, kind: 'static' }, { t0: 4000, t1: 10100, kind: 'pan' }] }, { start_ms: 10100, end_ms: 13900, tags: ['offscreen'] }, { start_ms: 13900, end_ms: 24500, continues: true },
      { start_ms: 24500, end_ms: 30000, tags: ['internal'] }];
    const doc = { ...M.sampleDoc(), axes: { stroke: [] }, activeAxis: 'stroke', ghosts: [], scenes };
    const be = M.mockBackend(), sent = [];
    let hold = null;   // a promise the next track waits on (cancel test)
    be.sidecar = async (req) => {
      sent.push(req);
      if (req.cmd !== 'track') return { result: null, error: 'no', cancelled: false };
      if (hold) await hold;
      const pairs = [], points = [];
      for (let t = req.start_ms, k = 0; t < req.end_ms; t += 200, k++) { pairs.push([t, 0.5 + 0.4 * Math.sin(t / 150)]); if (k % 2 === 0) points.push({ at: t, pos: (k / 2) % 2 ? 90 : 10 }); }
      return { result: { samples: pairs, points, scenes: [], channels: { proj_cam: pairs } }, error: null, cancelled: false };
    };
    const app = M.createMockApp({ doc, keys: false, backend: be }), tr = T.trackingFor(app);
    const toasts = []; const toast = app.toast.bind(app); app.toast = (m, ...r) => { toasts.push(m); return toast(m, ...r); };
    tr.openVideo(app.doc.media.path);   // the effect that does this does not run under SSR
    tr.trackers = [{ id: 'tapnext_points', name: 'TAPNext', roi: 'box_or_points', params: [] }, { id: 'sam2_mask', name: 'SAM', roi: 'box', params: [] }];
    tr.listed = true; tr.trackerId = 'tapnext_points'; tr.paramsBy = { tapnext_points: { box_points: 1024 }, sam2_mask: {} };
    tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.3, h: 0.3, t_ms: 5000 };
    const own = () => sent.filter((r) => r.cmd === 'track' && r.roi?.w < 0.9);   // not the camera checks (whole frame)

    const plan = tr.plan();
    assert.deepEqual(plan.map((x) => [x.label, x.action]), [['S1 + S3', 'track'], ['S2', 'skip'], ['S4', 'track']]);
    assert.ok(plan[2].grid && plan[2].roi.w === 1 && plan[2].params.box_points === 512 && plan[2].tracker === 'tapnext_points');   // no box on the internal view: the whole-frame grid
    assert.equal(tr.bridges.length, 0);                                     // no points around the cutaway yet
    await tr.runPlanned(plan);
    assert.deepEqual(own().map((r) => [r.start_ms, r.end_ms, r.params.box_points]), [[0, 10100, 1024], [13900, 24500, 1024]]);   // never across S2
    assert.ok(!sent.some((r) => r.cmd === 'track' && r.start_ms < 13900 && r.end_ms > 10100));
    assert.deepEqual(own()[0].cuts, [{ t_ms: 4000, kind: 'soft', why: 'camera: pan' }]);   // v4.9: the pan inside S1 is a soft cut (re-seed, own normalisation)
    assert.deepEqual(own()[1].cuts, []);
    const runs = tr.runs.filter((r) => !r.tag);
    assert.deepEqual(tr.links.map((l) => [l.t0, l.run, l.channel]), [[0, runs[0].id, 'proj_cam'], [13900, runs[1].id, 'primary'], [24500, runs[2].id, 'primary']]);   // pan -> proj_cam; S2 unlinked
    assert.deepEqual(sent.filter((r) => r.cmd === 'track' && r.start_ms === 24500).map((r) => [r.roi.w, r.params.box_points, r.params.box_seed]), [[1, 512, 'grid']]);
    assert.equal(tr.bridges.length, 1);                                     // the bridge reads the linked runs around S2
    assert.deepEqual([tr.bridges[0].t0, tr.bridges[0].t1], [10100, 13900]);
    assert.ok(toasts.some((m) => /Track tagged scenes: 3 runs · 1 skipped · 2 done/.test(m)));
    assert.equal(tr.planOpen, false);                                       // nothing needs a box: the grid covered S4
    assert.equal(tr.roi, null);                                             // the drawn box went to its runs
    // re-plan: done; force: track again
    assert.deepEqual(tr.plan().map((x) => x.action), ['done', 'skip', 'done']);
    assert.deepEqual(tr.plan({ force: true }).map((x) => x.action), ['track', 'skip', 'track']);
    // Go there: Track mode, range = S4, playhead in its middle; a box drawn there makes S4 a SAM area item (forced: it is done)
    tr.goToItem(tr.plan()[2]);
    assert.deepEqual(app.doc.range, { t0: 24500, t1: 30000 });
    assert.equal(tr.planOpen, false);
    tr.roi = { kind: 'box', x: 0.4, y: 0.4, w: 0.2, h: 0.2, t_ms: 27000 };
    const p2 = tr.plan({ force: true }).filter((x) => x.label === 'S4');
    assert.deepEqual(p2.map((x) => [x.action, x.tracker]), [['track', 'sam2_mask']]);
    sent.length = 0;
    await tr.runPlanned(p2);
    assert.deepEqual(own().map((r) => [r.tracker, r.start_ms, r.params.primary, r.params.pipe_invert]), [['sam2_mask', 24500, 'area', true]]);
    assert.equal(tr.planOpen, false);

    // cancel: the first press lets the running piece finish, the rest does not start
    tr.links = []; sent.length = 0;
    tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.3, h: 0.3, t_ms: 5000 };
    let release; hold = new Promise((r) => { release = r; });
    const running = tr.runPlanned(tr.plan({ force: true }));
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(tr.locked && tr.planBusy);
    tr.cancel();
    assert.equal(tr.planBusy.stop, true);
    hold = null; release();
    await running;
    assert.equal(own().length, 1);
    assert.ok(toasts.some((m) => /Track tagged scenes: stopped after 1 of 3/.test(m)));

    // manual T over S1..S3: S2 is left out, two pieces with the panel's tracker
    sent.length = 0; app.setMode?.('track');
    app.doc.range = { t0: 0, t1: 24500 };
    tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.3, h: 0.3, t_ms: 5000 };
    await tr.track();
    assert.deepEqual(own().map((r) => [r.tracker, r.start_ms, r.end_ms]), [['tapnext_points', 0, 10100], ['tapnext_points', 13900, 24500]]);
    assert.ok(toasts.some((m) => /Left out S2 \(off-screen\)/.test(m)));
    assert.match(tr.notice, /2 of 2 pieces tracked/);
    // scenes mode 'one': the range as drawn, no cuts
    sent.length = 0;
    app.settings.set('tracking.scenes', 'one');
    tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.3, h: 0.3, t_ms: 5000 };   // paw-x8we: no remembered box any more (a track takes it)
    await tr.track();
    assert.deepEqual(own().map((r) => [r.start_ms, r.end_ms, r.cuts]), [[0, 24500, []]]);
  } finally { await server.close(); }
});
