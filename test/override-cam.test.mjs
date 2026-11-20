// paw-hiq5: camera precedence (a range override's cam > the shot's Adjust cam > the camera tag's default > as tracked, an
// explicit off / on at each level winning) and the range overrides of the Tracker row in the store: add, resize, move,
// clear, edit through the strip's setters; a pair now follows the camera setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveCam, camTagDefault, runDerives, deriveClean, userReprojects, reprojects, CAM_DEFAULT } from '../src/lib/rederive.js';
import { relChannel } from '../src/lib/runs-channel.js';
import { channelOf } from '../src/lib/runs.js';

const TT = camTagDefault({ start_ms: 0, end_ms: 1000, tags: ['orbit'] });
const cam = (mode, extra = {}) => ({ ...CAM_DEFAULT, mode, ...extra });

test('camTagDefault: turntable and rides-the-stroke default to off, the other camera tags leave it alone', () => {
  assert.equal(TT.tag, 'orbit'); assert.equal(TT.label, 'turntable'); assert.equal(TT.cam.mode, 'off');
  assert.equal(camTagDefault({ start_ms: 0, end_ms: 1, tags: ['reciprocal'] }).cam.mode, 'off');
  for (const t of ['pan', 'zoom', 'handheld', 'static']) assert.equal(camTagDefault({ start_ms: 0, end_ms: 1, tags: [t] }), null);
  assert.equal(camTagDefault({ start_ms: 0, end_ms: 1 }), null);
});

test('effectiveCam: override > Adjust > tag default > tracked; an explicit off and an explicit on win at every level', () => {
  const on = cam('full'), off = cam('off'), auto = cam('auto', { explicit: true });
  // nothing set
  assert.deepEqual(effectiveCam(null, null, null), { cam: CAM_DEFAULT, from: 'tracked', tag: null });
  // the tag default alone
  const t = effectiveCam(TT, null, null);
  assert.equal(t.from, 'tag'); assert.equal(t.cam.mode, 'off'); assert.equal(t.tag, TT);
  // Adjust beats the tag, either way (on over a default off; an explicit auto too; and off over nothing)
  assert.equal(effectiveCam(TT, { cam: on }, null).cam.mode, 'full');
  assert.equal(effectiveCam(TT, { cam: auto }, null).from, 'adjust');
  assert.equal(effectiveCam(TT, { cam: auto }, null).cam.mode, 'auto');
  assert.deepEqual([effectiveCam(null, { cam: off }, null).from, effectiveCam(null, { cam: off }, null).cam.mode], ['adjust', 'off']);
  // the override beats Adjust and the tag, either way
  assert.deepEqual([effectiveCam(TT, { cam: off }, { cam: on }).from, effectiveCam(TT, { cam: off }, { cam: on }).cam.mode], ['override', 'full']);
  assert.equal(effectiveCam(TT, { cam: on }, { cam: off }).cam.mode, 'off');
  assert.equal(effectiveCam(TT, null, { cam: on }).cam.mode, 'full');
  assert.equal(effectiveCam(TT, null, { cam: auto }).cam.mode, 'auto');
  // a span with no cam of its own inherits: Adjust, else the tag
  assert.equal(effectiveCam(TT, { cam: on }, { source: 'fused' }).cam.mode, 'full');
  assert.equal(effectiveCam(TT, null, { source: 'fused' }).from, 'tag');
  // the tag-default marker runDerives adds is never a choice
  assert.equal(effectiveCam(TT, { cam: { ...cam('off'), tag: true } }, null).from, 'tag');
});

test('deriveClean keeps a chosen auto (explicit); runDerives puts the tag default under every untouched shot of a tagged run', () => {
  assert.equal(deriveClean({ cam: cam('auto') }), null, 'a plain auto is still "as tracked"');
  assert.deepEqual(deriveClean({ cam: cam('auto', { explicit: true }) }), { cam: { ...CAM_DEFAULT, explicit: true } });
  assert.ok(reprojects(deriveClean({ cam: cam('auto', { explicit: true }) })), 'a chosen auto re-derives');
  const run = { id: 'R', range: { start: 0, end: 2000 }, scenes: [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000 }] };
  const shots = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000, tags: ['orbit'] }];
  const d = runDerives(run, shots);
  assert.equal(d[0].cam, undefined, 'the untagged shot: nothing');
  assert.deepEqual([d[1].cam.mode, d[1].cam.tag], ['off', true]);
  assert.ok(!userReprojects(d[1]) && reprojects(d[1]), 'the default alone never swaps the sidecar\'s points, but pairs and fusion read it');
  const own = runDerives(run, [shots[0], { ...shots[1], derive: { cam: cam('full') } }]);
  assert.equal(own[1].cam.mode, 'full'); assert.ok(!own[1].cam.tag && userReprojects(own[1]), 'a choice beats it');
  const auto = runDerives(run, [shots[0], { ...shots[1], derive: { cam: cam('auto', { explicit: true }) } }]);
  assert.equal(auto[1].cam.mode, 'auto'); assert.ok(userReprojects(auto[1]));
});

test('a pair built with a camera derive still builds (translation cancels in a pair; zoom / rot reach it through the camera setting)', () => {
  const T = Array.from({ length: 90 }, (_, i) => Math.round((i * 1000) / 30)), ch = {};
  const put = (name, f) => { ch[`sem_${name}_x`] = channelOf(T.map((ms) => [ms, f(ms)[0]])); ch[`sem_${name}_y`] = channelOf(T.map((ms) => [ms, f(ms)[1]])); };
  put('c1_hips', () => [0.3, 0.5]); put('c2_hips', () => [0.7, 0.5]);   // still bodies, the camera pushes them (cam_x shifts both)
  ch.cam_x = channelOf(T.map((ms) => [ms, 0.1 * (ms / 3000)])); ch.cam_y = channelOf(T.map((ms) => [ms, 0]));
  ch.centroid_x = ch.cam_x; ch.centroid_y = ch.cam_y;
  const run = { id: 'r', params: {}, scenes: [], range: { start: 0, end: 3000 }, channels: ch };
  const a = relChannel(run, 'sem_c1_hips', 'sem_c2_hips'), none = relChannel(run, 'sem_c1_hips', 'sem_c2_hips', { derives: [{ cam: cam('off') }] });
  assert.ok(a && none);
  assert.equal(a.v.length, none.v.length);
  assert.ok(Array.from(none.v).filter(Number.isFinite).length > 80, 'the camera-handled centres give a finite pair signal');
});

test('the Tracker row in the store: add / resize / move / clear a range override, the strip edits it, the camera precedence through the setters', async () => {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js'), R = await server.ssrLoadModule('/src/lib/runs.js');
    const doc = { ...M.sampleDoc(), ghosts: [], scenes: [{ start_ms: 0, end_ms: 8000 }, { start_ms: 8000, end_ms: 14000, tags: ['orbit'] }] };
    const app = M.createMockApp({ doc, keys: false }), tr = T.trackingFor(app);
    const ch = {}, t = Array.from({ length: 420 }, (_, i) => Math.round((i * 1000) / 30));
    for (const k of ['proj', 'proj_cam', 'g1_proj']) ch[k] = channelOf(t.map((ms) => [ms, 0.5 + 0.4 * Math.sin(ms / 160)]));
    const run = R.makeRun({ n: 1, tracker: { id: 'cotracker_points', name: 'CoTracker3' }, params: {}, range: { start: 0, end: 14000 }, roi: null,
      result: { samples: ch.proj, points: [{ at: 100, pos: 0 }, { at: 9000, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 8000, sign: 1 }, { start_ms: 8000, end_ms: 14000, sign: 1 }], channels: ch, notes: [] }, frames: R.newFrames(), runs: [] });
    tr.runs = [run]; app.doc.ghosts = [tr.ghostOf(run)]; tr.select(run.id);
    const spans = () => tr.signalSpans.map((s) => [s.t0, s.t1]);
    const frame = app.player.frameMs;
    // outside any override: nothing is active (the strip edits the shot)
    app.player.timeMs = 2000;
    assert.equal(tr.activeSpan, null);
    // add: frame-snapped, inside the run, a copy of the shot's source, selected, one undo step
    const n0 = app._history.index, sp = tr.addSignalSpan(2010, 5003);
    assert.deepEqual([sp.t0, sp.t1], [app.player.snap(2010), app.player.snap(5003)]);
    assert.ok(Math.abs(sp.t0 / frame - Math.round(sp.t0 / frame)) < 1e-6 || sp.t0 % 1 === 0);
    assert.equal(sp.source, tr.shotSource(tr.run(run.id), 0));
    assert.deepEqual(tr.sigSel, { t0: sp.t0, t1: sp.t1 });
    assert.equal(app._history.index - n0, 1);
    assert.equal(tr.addSignalSpan(3000, 3000), null, 'an empty range makes nothing');
    // the playhead inside it: it is the active one, with or without a click
    tr.sigSel = null; app.player.timeMs = 3000;
    assert.deepEqual([tr.activeSpan.t0, tr.activeSpan.t1], [sp.t0, sp.t1]);
    app.player.timeMs = 6000;
    assert.equal(tr.activeSpan, null, 'playhead outside: the shot\'s own setting');
    // editing through the strip's setters reaches the override, not the shot
    app.player.timeMs = 3000;
    const act = tr.activeSpan;
    tr.setSource('g1_proj', act, run.id);
    tr.setSignalCam({ mode: 'off' }, act);
    assert.equal(tr.signalSpans[0].source, 'g1_proj'); assert.equal(tr.signalSpans[0].cam.mode, 'off');
    assert.equal(app.doc.scenes[0].derive ?? app.doc.scenes[0].derives, undefined, 'shot A has no setting of its own');
    assert.equal(tr.camState(0, tr.signalSpans[0], run.id).from, 'override');
    tr.setSignalCam(null, tr.signalSpans[0]);
    assert.equal(tr.signalSpans[0].cam, undefined, 'Default clears the range camera'); assert.equal(tr.signalSpans[0].source, 'g1_proj');
    // resize (an end dragged) and move: one undo step each, the extent follows and the selection too
    tr.sigSel = { t0: sp.t0, t1: sp.t1 };
    const n1 = app._history.index;
    tr.setSpan(tr.signalSpans[0], {}, { to: { t0: sp.t0, t1: sp.t1 + 1000 }, label: 'resize' });
    assert.deepEqual(spans(), [[sp.t0, sp.t1 + 1000]]); assert.equal(app._history.index - n1, 1); assert.equal(tr.sigSel.t1, sp.t1 + 1000);
    tr.setSpan(tr.signalSpans[0], {}, { to: { t0: sp.t0 + 500, t1: sp.t1 + 1500 }, label: 'move' });
    assert.deepEqual(spans(), [[sp.t0 + 500, sp.t1 + 1500]]); assert.equal(tr.signalSpans[0].source, 'g1_proj', 'a move keeps what it overrides with');
    // whole shot (the right-click item): stretched to the shot's extent
    tr.setSpan(tr.signalSpans[0], {}, { to: { t0: 0, t1: 8000 } });
    assert.deepEqual(spans(), [[0, 8000]]);
    // the command over the shot at the playhead (no I-O range), then clear = one undo step, undo brings it back
    tr.setSpan(tr.signalSpans[0], null);
    assert.deepEqual(spans(), []);
    app.player.timeMs = 9000; app.doc.range = null;
    const here = tr.addSignalSpanHere();
    assert.deepEqual([here.t0, here.t1], [8000, 14000]);
    const n2 = app._history.index;
    tr.setSpan(tr.signalSpans[0], null);
    assert.equal(app._history.index - n2, 1); assert.deepEqual(spans(), []);
    app.undo();
    assert.equal(spans().length, 1);
    // the turntable shot: off by default, a choice turns it on (explicit auto too), Default brings it back
    assert.deepEqual([tr.camState(1).from, tr.camState(1).cam.mode], ['tag', 'off']);
    tr.setSignalCam({ mode: 'full' });   // the row's shot: shot B is under the playhead
    assert.deepEqual([tr.camState(1, null, run.id).from, tr.camState(1, null, run.id).cam.mode], ['adjust', 'full']);
    tr.setSignalCam({ mode: 'auto' });
    assert.deepEqual([tr.camState(1, null, run.id).from, tr.camState(1, null, run.id).cam.mode], ['adjust', 'auto'], 'a chosen auto is kept (it used to fall back to the tag)');
    tr.setSignalCam(null);
    assert.equal(tr.camState(1, null, run.id).from, 'tag');
    // an override's explicit camera beats Adjust and the tag
    const o = tr.signalSpans.find((s) => s.t0 >= 8000);
    tr.setSignalCam({ mode: 'full' }, o);
    assert.equal(tr.camState(1, tr.signalSpans.find((s) => s.t0 >= 8000), run.id).cam.mode, 'full');
  } finally { await server.close(); }
});
