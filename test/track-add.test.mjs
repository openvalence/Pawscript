// paw-o74b, the tracking store with the fake sidecar (test/fake-pawtrack.mjs fake.groups): T on a tracked shot tracks only the
// groups painted since (groups_only, from their own frame) and merges them into the run; a fresh Track seeds each group on its
// own frame; a changed outline or track.full makes a new run; a failed add leaves the run as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FAKE = fileURLToPath(new URL('./fake-pawtrack.mjs', import.meta.url));
const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const G = (who, part, t_ms, box) => ({ name: `${who}_${part}`, who, part, poly: SQ(...box), pinned: true, t_ms, source: 'user' });

/** A backend.sidecar running the fake as a process (one request each), its requests kept; fail(req) -> an error instead. */
function fakeSidecar(log, fail = () => false) {
  return (request, { onEvent, onFrames }) => new Promise((resolve) => {
    log.push(request);
    if (fail(request)) { resolve({ result: null, error: 'fake: the add failed', cancelled: false }); return; }
    const p = spawn(process.execPath, [FAKE], { env: { ...process.env, FAKE_DURATION_MS: '6000', FAKE_FPS: '30', FAKE_DELAY_MS: '0' }, windowsHide: true });
    let buf = '', result = null, error = null;
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'frame') onFrames?.([e]);
        else onEvent?.(e);
        if (e.type === 'result') result = e;
        if (e.type === 'error') error = e.message;
      }
    });
    p.on('close', () => resolve({ result: result && (({ type, ...r }) => r)(result), error, cancelled: false }));   // eslint-disable-line no-unused-vars
    p.stdin.end(JSON.stringify(request) + '\n');
  });
}

async function setup(groups, fail) {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 6000, groups }], ghosts: [], media: { ...M.sampleDoc().media, path: 'C:/v/clip.mp4', fps: 30, width: 640, height: 360 } };
  const log = [], backend = { ...M.mockBackend(), sidecar: fakeSidecar(log, fail), __log: log };
  const app = M.createMockApp({ doc, keys: false, backend });
  app.mode = 'track';
  const tr = T.trackingFor(app);
  app.tracking = tr;
  tr.path = doc.media.path;   // the store's video-change effect does not run under SSR
  await tr.list();
  tr.selectTracker('fake.groups');
  app.doc.range = { t0: 0, t1: 6000 };
  return { server, app, tr, log };
}
const tracks = (log) => log.filter((r) => r.cmd === 'track');

test('T on a tracked shot: only the new group, from its own frame, merged into the run; the run is the same run', async () => {
  const { server, app, tr, log } = await setup([G('c1', 'torso', 500, [0.3, 0.2, 0.5, 0.4])]);
  try {
    await tr.track();
    assert.equal(tr.runs.length, 1, tr.error);
    const run0 = tr.runs[0], torso = run0.channels.sem_c1_torso_x, bytes = Float32Array.from(torso.v);
    assert.deepEqual(run0.groupSeeds.map((s) => [s.name, s.t_ms]), [['c1_torso', 500]]);
    assert.ok(!tracks(log)[0].groups_only && tracks(log)[0].groups.length === 1);
    // the camera tilts: a part comes into view at 2.5 s; painted there, T
    app.doc.scenes = [{ ...app.doc.scenes[0], groups: [...app.doc.scenes[0].groups, G('c2', 'penis', 2500, [0.5, 0.6, 0.6, 0.8])] }];
    assert.deepEqual(tr.addPlan().items.map((x) => [x.run.id, x.groups.map((g) => g.name)]), [[run0.id, ['c2_penis']]]);
    await tr.track();
    const req = tracks(log).at(-1);
    assert.equal(req.groups_only, true);
    assert.deepEqual(req.groups.map((g) => [g.name, g.t_ms]), [['c2_penis', 2500]], 'only the new group, its own frame');
    assert.equal(req.roi.t_ms, 2500);
    assert.equal(tr.runs.length, 1, 'no new run');
    const run = tr.runs[0];
    assert.equal(run.id, run0.id);
    assert.equal(run.channels.sem_c1_torso_x, torso, 'the first group\'s channel: the same object');
    assert.deepEqual(Array.from(run.channels.sem_c1_torso_x.v), Array.from(bytes), '... bit for bit');
    const pen = run.channels.sem_c2_penis_x, T = Array.from(pen.t);
    assert.deepEqual(T, Array.from(torso.t), 'aligned to the run frames');
    T.forEach((t, j) => assert.equal(Number.isFinite(pen.v[j]), t >= 1000 && t < 4000, `${t}`));   // the fake loses it 1.5 s either side
    assert.equal(run.scenes[0].groups.sem_c2_penis.id, 5);
    assert.deepEqual(run.groupSeeds.map((s) => s.name), ['c1_torso', 'c2_penis']);
    const k = run.frames.t.findIndex((t) => t >= 2500);
    assert.deepEqual(run.frames.ov[k].pts.filter((q) => q.length === 6).map((q) => q[5]), [4, 4, 4, 5, 5, 5]);
    assert.match(tr.notice, /Added Top penis/);
    assert.equal(tr.addPlan(), null, 'nothing new any more: T makes a new run again');
    // a repainted outline is not new: Track tracks everything again (a new run); track.full too
    app.doc.scenes = [{ ...app.doc.scenes[0], groups: app.doc.scenes[0].groups.map((g) => (g.name === 'c1_torso' ? { ...g, poly: SQ(0.3, 0.2, 0.55, 0.45) } : g)) }];
    assert.equal(tr.addPlan(), null);
    await tr.track();
    assert.ok(tr.runs.length === 1 && tr.runs[0].id !== run0.id, 'changed: a new run, which replaces the earlier one (paw-l3ec)');
    const run2 = tr.runs[0].id;
    await tr.track({}, { full: true });
    assert.ok(tr.runs.length === 1 && tr.runs[0].id !== run2, 'track.full: a new run, replacing too');
    await tr.track({}, { beside: true });
    assert.equal(tr.runs.length, 2, 'Track as a new run: beside it');
  } finally { await server.close(); }
});

test('a fresh Track with groups on two frames seeds each on its own frame (the later one added to the run)', async () => {
  const { server, tr, log } = await setup([G('c1', 'torso', 500, [0.3, 0.2, 0.5, 0.4]), G('c2', 'penis', 3000, [0.5, 0.6, 0.6, 0.8])]);
  try {
    await tr.track();
    const [main, add] = tracks(log);
    assert.deepEqual(main.groups.map((g) => g.name), ['c1_torso'], 'the run seeds on the earliest frame');
    assert.ok(!main.groups_only);
    assert.deepEqual([add.groups_only, add.roi.t_ms, add.groups.map((g) => g.name)], [true, 3000, ['c2_penis']]);
    assert.equal(tr.runs.length, 1);
    assert.ok(tr.runs[0].channels.sem_c1_torso_x && tr.runs[0].channels.sem_c2_penis_x);
  } finally { await server.close(); }
});

test('paw-o74b.1: a take whose frames repeat a part (an older fill beside the owner\'s): the part seeded twice, one group, stitched', async () => {
  // an owner clip, shot 28: an auto-fill on one frame, a copy of 8 on a later frame, three parts on both
  const gs = [G('c2', 'balls', 500, [0.3, 0.2, 0.5, 0.4]), G('c1', 'tail', 500, [0.1, 0.1, 0.2, 0.2]), G('c2', 'balls', 2500, [0.32, 0.22, 0.52, 0.42]), G('c2', 'penis', 2500, [0.5, 0.6, 0.6, 0.8])];
  const { server, tr, log } = await setup(gs);
  try {
    await tr.track();
    const [main, add, more] = tracks(log);
    assert.deepEqual(main.groups.map((g) => [g.name, g.t_ms]), [['c2_balls', 500], ['c1_tail', 500]], 'the run seeds on the earliest frame');
    assert.deepEqual([add.groups_only, add.groups.map((g) => [g.name, g.t_ms])], [true, [['c2_balls', 2500], ['c2_penis', 2500]]], 'one groups-only call for the later frame');
    assert.equal(more, undefined);
    assert.equal(tr.runs.length, 1, tr.error);
    assert.equal(tr.error, '');
    const run = tr.runs[0];
    assert.deepEqual(run.groupSeeds.filter((s) => s.name === 'c2_balls').map((s) => [s.t_ms, !!s.track, Array.isArray(s.own)]), [[500, true, true], [2500, true, true]]);
    assert.ok(!Object.keys(run.channels).some((k) => k.startsWith('sem_c2_balls2')), 'one balls group');
    // the fake's two paintings sit 0.02 apart: the stitched centre has no step at the handover (1500 ms)
    const x = run.channels.sem_c2_balls_x.v, T = run.channels.sem_c2_balls_x.t, j = Array.from(T).findIndex((t) => t >= 1500);
    const d = (i) => Math.abs(x[i + 1] - x[i]);
    let rest = 0;
    for (let i = 0; i + 1 < x.length; i++) if (Math.abs(T[i] - 1500) > 600 && Number.isFinite(d(i))) rest = Math.max(rest, d(i));
    for (let i = j - 10; i < j + 10; i++) assert.ok(d(i) <= rest * 1.05 + 1e-6, `step at ${T[i]}: ${d(i)} vs ${rest}`);
    assert.ok(run.channels.sem_c2_penis_x);
  } finally { await server.close(); }
});

test('deleting a seed in the document re-stitches the run from its kept tracks, no tracking; undo brings it back', async () => {
  const gs = [G('c1', 'hips', 500, [0.3, 0.2, 0.5, 0.4])];
  const { server, app, tr, log } = await setup(gs);
  try {
    await tr.track();
    const single = Float32Array.from(tr.runs[0].channels.sem_c1_hips_x.v);
    app.doc.scenes = [{ ...app.doc.scenes[0], groups: [...gs, G('c1', 'hips', 4000, [0.33, 0.21, 0.52, 0.43])] }];
    assert.deepEqual(tr.addPlan().items.map((x) => x.groups.map((g) => [g.name, g.t_ms])), [[['c1_hips', 4000]]], 'the second seed is new for the run');
    await tr.track();
    assert.equal(tracks(log).length, 2, 'exactly one groups-only request for the seed');
    assert.equal(tracks(log)[1].groups_only, true);
    assert.equal(tr.runs.length, 1);
    assert.match(tr.notice, /re-anchored at frame 120/);
    const stitched = Float32Array.from(tr.runs[0].channels.sem_c1_hips_x.v);
    const own = () => tr.runs[0].groupSeeds.filter((s) => s.name === 'c1_hips').map((s) => s.own && s.own.map((r) => r.map((v) => Math.round(v / 100))));
    assert.deepEqual(own(), [[[0, 25], [55, 60]], [[25, 55]]], 'the second seed owns from half way (2.25 s) or where its track starts (2.5 s: the fake keeps 1.5 s either side), the first takes the end again');
    stitched.forEach((x, i) => assert.ok(Math.abs(x - single[i]) < 1e-5 || (x !== x && single[i] !== single[i]), 'the fake moves the part the same way from both seeds: the stitch removes the offset between the paintings'));
    const n = log.length;
    app.doc.scenes = [{ ...app.doc.scenes[0], groups: gs }];   // the second seed deleted
    tr.restitchSeeds();   // the store's scene effect (it does not run under SSR)
    tr.runs[0].channels.sem_c1_hips_x.v.forEach((x, i) => assert.ok(Math.abs(x - single[i]) < 1e-5 * Math.max(1, Math.abs(single[i])) || (x !== x && single[i] !== single[i]), `back to the single-seed signal at ${i}`));
    assert.equal(log.length, n, 'no sidecar call');
    assert.deepEqual(own(), [[[0, 60]], null], 'the deleted seed: not used, its track kept');
    app.doc.scenes = [{ ...app.doc.scenes[0], groups: [...gs, G('c1', 'hips', 4000, [0.33, 0.21, 0.52, 0.43])] }];   // undo
    tr.restitchSeeds();
    tr.runs[0].channels.sem_c1_hips_x.v.forEach((x, i) => assert.ok(Math.abs(x - stitched[i]) < 1e-5 || (x !== x && stitched[i] !== stitched[i])));
    assert.deepEqual(own(), [[[0, 25], [55, 60]], [[25, 55]]], 'undo: stitched again');
  } finally { await server.close(); }
});

test('a failed add leaves the run as it was', async () => {
  const { server, app, tr } = await setup([G('c1', 'torso', 500, [0.3, 0.2, 0.5, 0.4])], (r) => r.cmd === 'track' && r.groups_only);
  try {
    await tr.track();
    const run0 = tr.runs[0];
    app.doc.scenes = [{ ...app.doc.scenes[0], groups: [...app.doc.scenes[0].groups, G('c2', 'penis', 2500, [0.5, 0.6, 0.6, 0.8])] }];
    await tr.track();
    assert.equal(tr.runs.length, 1);
    assert.equal(tr.runs[0], run0, 'the very same record');
    assert.match(tr.error, /the run is as it was/);
  } finally { await server.close(); }
});
