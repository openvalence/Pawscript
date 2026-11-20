// paw-2pcf, the tracking store with the fake sidecar (test/fake-pawtrack.mjs fake.groups: c1_hips sways and turns): after a
// Track every secondary axis with data has a ghost on its axis; the shot's angle decides which axes get data; Accept all axes
// of the shot is one undo step; Shift+A on a secondary lane takes the selected run's ghost for that axis; a flip negates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FAKE = fileURLToPath(new URL('./fake-pawtrack.mjs', import.meta.url));
const SQ = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const G = (who, part, t_ms, box) => ({ name: `${who}_${part}`, who, part, poly: SQ(...box), pinned: true, t_ms, source: 'user' });

function fakeSidecar() {
  return (request, { onEvent, onFrames }) => new Promise((resolve) => {
    const p = spawn(process.execPath, [FAKE], { env: { ...process.env, FAKE_DURATION_MS: '6000', FAKE_FPS: '30', FAKE_DELAY_MS: '0' }, windowsHide: true });
    let buf = '', result = null, error = null;
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'frame') onFrames?.([e]); else onEvent?.(e);
        if (e.type === 'result') result = e;
        if (e.type === 'error') error = e.message;
      }
    });
    p.on('close', () => resolve({ result: result && (({ type, ...r }) => r)(result), error, cancelled: false }));   // eslint-disable-line no-unused-vars
    p.stdin.end(JSON.stringify(request) + '\n');
  });
}

async function setup(tags, gs = null) {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
  const X = await server.ssrLoadModule('/src/features/tracking/axes-derive.js');
  const groups = gs || [G('c1', 'hips', 500, [0.3, 0.5, 0.45, 0.65]), G('c2', 'hips', 500, [0.55, 0.3, 0.7, 0.45])];
  const doc = { ...M.sampleDoc(), axes: { stroke: [] }, scenes: [{ start_ms: 0, end_ms: 6000, groups, ...(tags ? { tags } : {}) }], ghosts: [], media: { ...M.sampleDoc().media, path: 'C:/v/clip.mp4', fps: 30, width: 640, height: 360 } };
  const backend = { ...M.mockBackend(), sidecar: fakeSidecar() };
  const app = M.createMockApp({ doc, keys: false, backend });
  app.mode = 'track';
  const tr = T.trackingFor(app);
  app.tracking = tr;
  tr.path = doc.media.path;
  await tr.list();
  tr.selectTracker('fake.groups');
  app.doc.range = { t0: 0, t1: 6000 };
  await tr.track();
  assert.equal(tr.runs.length, 1, tr.error);
  return { server, app, tr, X };
}
const axesGhosts = (app) => app.doc.ghosts.filter((g) => g.source?.kind === 'axes');

test('after Track: one ghost per axis with data; a rear angle measures sway and twist; a lane plays its axis live, Bake is one undo step', async () => {
  const { server, app, tr, X } = await setup(['rear']);
  try {
    const gs = axesGhosts(app), run = tr.runs[0];
    const by = Object.fromEntries(gs.map((g) => [g.axis, g]));
    assert.ok(by.sway && by.twist, `axes: ${gs.map((g) => g.axis + ':' + g.source.label)}`);
    assert.equal(by.sway.source.label, 'measured'); assert.equal(by.twist.source.label, 'measured');
    assert.equal(by.roll, undefined, 'roll is not seen from behind');
    assert.ok(gs.every((g) => g.source.runId === run.id && g.id === `${run.id}~${g.axis}` && g.script.length > 4));
    assert.ok(!tr.runs.some((r) => r.id.includes('~')), 'not runs');
    const info = X.shotAxes(app, tr, 0);
    assert.equal(info.view, 'rear');
    assert.deepEqual(info.missing.sort(), gs.map((g) => g.axis).sort(), 'no lanes yet');
    // paw-x7w7: a lane plays its axis live (no Accept); Bake makes every axis of the shot permanent: one undo step
    X.addAxisLanes(app);
    assert.ok(gs.every((g) => g.axis in app.doc.axes));
    const S = await server.ssrLoadModule('/src/lib/script-of.js');
    for (const g of gs) { const s = S.scriptOf(app, g.axis); assert.ok(s.length > 4 && s.every((p) => p.pos >= 35 && p.pos <= 65), g.axis); }
    const before = { ...app.doc.axes };
    assert.ok(tr.bake({ shots: [0] }) > 0);
    for (const g of gs) assert.ok(app.doc.axes[g.axis].length > 4, g.axis + ' baked');
    app.undo();
    assert.deepEqual(app.doc.axes, before, 'one undo step');
  } finally { await server.close(); }
});

test('the angle decides the lanes: no angle = guessed side (estimates only); side measures pitch, a flip negates', async () => {
  const { server, app, tr, X } = await setup(null);
  try {
    const gs = axesGhosts(app);
    assert.ok(gs.length > 0);
    assert.ok(gs.every((g) => g.source.label !== 'measured'), 'a guessed view is never measured');
    app.doc.scenes = [{ ...app.doc.scenes[0], tags: ['side'] }];
    X.refreshAxes(app, tr);   // the store's scene effect (does not run under SSR)
    const pitch = axesGhosts(app).find((g) => g.axis === 'pitch');
    assert.equal(pitch?.source.label, 'measured');
    assert.ok(!axesGhosts(app).some((g) => g.axis === 'twist' && g.source.label === 'measured'));
    const y0 = pitch.script.map((p) => p.pos - 50);
    app.setActiveAxis('pitch');
    assert.ok(X.flipAxisCommand(app, tr, 'pitch', 0));
    assert.deepEqual(app.doc.scenes[0].axflip, ['pitch']);
    X.refreshAxes(app, tr);
    const y1 = axesGhosts(app).find((g) => g.axis === 'pitch').script.map((p) => p.pos - 50);
    assert.deepEqual(y1, y0.map((v) => (v ? -v : 0)));
    app.undo();
    assert.equal(app.doc.scenes[0].axflip, undefined);
    // removing the run takes its axes with it; the saved project leaves them out
    const L = await server.ssrLoadModule('/src/app/project-logic.js');
    assert.equal(L.savedGhosts(app.doc.ghosts).filter((g) => g.source?.kind === 'axes').length, 0);
    tr.remove(tr.runs[0].id);
    assert.equal(axesGhosts(app).length, 0);
  } finally { await server.close(); }
});

test('paw-jyde.11: one character (hips + torso, a dancing rear shot): hips vs frame, sway and roll measured, Bake one undo step', async () => {
  const { server, app, tr, X } = await setup(['rear', 'dancing'], [G('c1', 'hips', 500, [0.4, 0.5, 0.55, 0.65]), G('c1', 'torso', 500, [0.42, 0.2, 0.53, 0.4])]);
  try {
    const gs = axesGhosts(app), by = Object.fromEntries(gs.map((g) => [g.axis, g]));
    assert.equal(by.sway?.source.label, 'measured', `axes: ${gs.map((g) => g.axis + ':' + g.source.label)}`);
    assert.equal(by.roll?.source.label, 'measured', 'the in-plane turn seen from behind is roll for a lone body');
    assert.ok(!by.twist || by.twist.source.label !== 'measured');
    assert.ok(by.sway.name.endsWith('(hips vs frame)'));
    const info = X.shotAxes(app, tr, 0);
    assert.equal(info.frame.who, 'c1'); assert.equal(info.frame.ref, 'torso'); assert.equal(info.frame.removed, true); assert.equal(info.frame.camLeak, false);
    assert.match(X.frameWords(info.frame), /Bottom's hips vs frame.*hips → torso.*camera removed/);
    X.addAxisLanes(app);
    const before = { ...app.doc.axes };
    assert.ok(tr.bake({ shots: [0] }) > 0);
    for (const g of gs) assert.ok(app.doc.axes[g.axis].length > 4, g.axis + ' baked');
    app.undo();
    assert.deepEqual(app.doc.axes, before, 'one undo step');
    // camera removal off on a pan-tagged shot: weaker, and the words say so
    app.doc.scenes = [{ ...app.doc.scenes[0], tags: ['rear', 'dancing', 'pan'], derives: { [tr.runs[0].id]: { cam: { mode: 'off', strength: 100, source: 'background', smoothMs: 0 } } } }];   // the run's own entry (paw-lji3: a new run has one)
    X.refreshAxes(app, tr);
    const f2 = X.shotAxes(app, tr, 0).frame;
    assert.equal(f2.removed, false); assert.equal(f2.camLeak, true); assert.equal(f2.tag, 'pan');
    assert.match(X.frameWords(f2), /camera NOT removed on a pan shot/);
  } finally { await server.close(); }
});
