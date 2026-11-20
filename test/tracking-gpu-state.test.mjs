// paw-k97q / paw-eeod (sidecar v4.56): an unsupported graphics card is said in plain words and greys the GPU trackers (an older
// sidecar's list changes nothing); a Track on the CPU says "running on CPU: slow"; a Track that sends nothing for
// tracking.stallTimeoutS fails in words and frees the tracker, while a Track that keeps sending is never stopped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackerOptions } from '../src/features/timeline/quickbar.js';

const TRACKERS = [{ id: 'lk_box', name: 'LK box', roi: 'box', params: [], gpu: false }, { id: 'tapnext_points', name: 'TAPNext++', roi: 'box_or_points', params: [], gpu: true }];

async function store(fn) {
  const { fileURLToPath } = await import('node:url');
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const app = M.createMockApp({ doc: { ...M.sampleDoc(), ghosts: [], scenes: [] }, keys: false });
    await fn(app, T.trackingFor(app), T);
  } finally { await server.close(); }
}

test('the GPU state in plain words: unsupported (new / old), none, ok and an older sidecar', async () => {
  await store(async (app, tr, T) => {
    assert.equal(T.gpuNote({ state: 'unsupported', name: 'NVIDIA GeForce RTX 5070', capability: '12.0', reason: 'new' }),
      'This graphics card (RTX 5070) is not supported by this build yet. Trackers that need a GPU are off; the CPU trackers still work.');
    assert.match(T.gpuNote({ state: 'unsupported', name: 'NVIDIA GeForce GTX 780', reason: 'old' }), /GTX 780\) is too old for this build/);
    assert.match(T.gpuNote({ state: 'none' }), /^No graphics card/);
    // paw-1dt4: a torch whose DLLs do not load
    assert.equal(T.gpuNote({ state: 'none', reason: 'torch', probe: 'OSError: [WinError 126] The specified module could not be found. Error loading c10.dll' }),
      "The tracker's PyTorch could not load ([WinError 126] The specified module could not be found. Error loading c10.dll). Trackers that need a GPU are off; the CPU trackers still work. Install the Microsoft Visual C++ Redistributable or check your antivirus quarantine, then restart Pawscript.");
    assert.match(T.gpuNote({ state: 'none', reason: 'torch' }), /^The tracker's PyTorch could not load\. Trackers/);
    for (const g of [{ state: 'ok', name: 'X' }, { state: 'unknown' }, null, undefined]) assert.equal(T.gpuNote(g), '');

    app.settings.set('tracking.lastTracker', 'tapnext_points');
    let list = { type: 'result', trackers: TRACKERS, scene_params: [], loop_params: [], describe_params: null, gpu: { state: 'unsupported', name: 'NVIDIA GeForce RTX 5070', reason: 'new' } };
    app.backend.sidecar = async (q) => (q.cmd === 'list' ? { result: list, error: null, cancelled: false } : { result: null, error: null, cancelled: true });
    await tr.list();
    assert.match(tr.gpuNote, /RTX 5070/);
    assert.equal(tr.trackerId, 'lk_box', 'the remembered tracker is greyed: a CPU one is picked');
    assert.deepEqual(tr.trackerChoices, [{ value: 'lk_box', label: 'LK box' }, { value: 'tapnext_points', label: 'TAPNext++', disabled: true, hint: 'needs a GPU' }]);
    assert.deepEqual(trackerOptions(tr.trackers, (t) => tr.gpuOff(t)).find((o) => o.value === 'tapnext_points'), { value: 'tapnext_points', label: 'TAPNext++', disabled: true, hint: 'needs a GPU' });

    list = { type: 'result', trackers: TRACKERS.map(({ gpu, ...t }) => t), scene_params: [], loop_params: [], describe_params: null };   // an older sidecar
    app.backend = { ...app.backend };   // another backend: the list is asked again (it is kept per backend, paw-shgb)
    tr.trackerId = '';
    await tr.list();
    assert.equal(tr.gpu, null); assert.equal(tr.gpuNote, '');
    assert.equal(tr.trackerId, 'tapnext_points');
    assert.ok(tr.trackerChoices.every((o) => !o.disabled));
  });
});

test('a Track on the CPU says so; a stalled Track fails in words and is cancelled; a talking one is never stopped', async () => {
  await store(async (app, tr) => {
    tr.path = tr.videoPath;
    const T = { id: 'tapnext_points', name: 'TAPNext++', params: [], gpu: true }, ROI = { kind: 'box', x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    let cancels = 0, seen = '';
    app.backend.cancelSidecar = () => { cancels++; };
    app.settings.set('tracking.stallTimeoutS', 0.15);
    app.backend.sidecar = async (q, h) => {
      h.onEvent({ type: 'progress', done: 0, total: 90, stage: 'starting', device: 'cpu' });
      h.onEvent({ type: 'progress', done: 10, total: 90, stage: 'tracking' });
      seen = tr.progressLabel;
      return new Promise(() => {});   // a hung kernel: nothing more, ever
    };
    const t0 = Date.now();
    const r = await tr.job('track', { cmd: 'track' });
    assert.match(seen, /^running on CPU: slow · /);
    assert.ok(Date.now() - t0 >= 4 * 150 - 20, 'on the CPU the limit is 4x longer');
    assert.equal(r.cancelled, false);
    assert.match(r.error, /^Tracking made no progress for 1 second, so it was stopped\. Try again, or track a shorter range\./);
    assert.equal(cancels, 1);
    assert.ok(!tr.busy && !tr.cpu, 'the tracker is free again');

    // a GPU Track that keeps sending events for longer than the limit runs to its end
    app.backend.sidecar = async (q, h) => {
      for (let i = 0; i < 6; i++) { await new Promise((res) => setTimeout(res, 60)); h.onEvent({ type: 'progress', done: i, total: 6, stage: 'tracking' }); }
      return { result: { type: 'result' }, error: null, cancelled: false };
    };
    const ok = await tr.job('track', { cmd: 'track' });
    assert.equal(ok.error, null); assert.equal(cancels, 1);
    // another job kind gets no watchdog of its own
    app.backend.sidecar = async () => { await new Promise((res) => setTimeout(res, 300)); return { result: { type: 'result' }, error: null, cancelled: false }; };
    assert.equal((await tr.job('loop', { cmd: 'loop' })).error, null);
  });
});
