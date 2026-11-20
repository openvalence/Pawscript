// paw-vdb3.3: the runtime choice in the models store: the GPU probe's pick, the user's override (models.runtime), an
// unpublished runtime refused, the chosen one fetched. The store is a .svelte.js module, loaded through vite's SSR transform.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, S, Settings;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  S = await server.ssrLoadModule('/src/features/models/store.svelte.js');
  Settings = (await server.ssrLoadModule('/src/app/settings.svelte.js')).Settings;
});
after(() => server?.close());

// the shipped manifest publishes runtime-rocm (uploaded 2026-11-19); these tests set it unpublished while they run
const unpublished = (fn) => async () => { const e = S.EMBEDDED.models.find((m) => m.id === 'runtime-rocm'), was = e.hosted; e.hosted = false; try { await fn(); } finally { e.hosted = was; } };
const RT = (id, o = {}) => ({ id, installed: null, python: false, zip: false, ...o });
const AMD = { adapters: [], runtime: 'runtime-rocm', name: 'AMD Radeon RX 9070 XT', vram: 16e9 };
const NV = { adapters: [], runtime: 'runtime', name: 'NVIDIA GeForce RTX 4090', vram: 24e9 };
function boot({ probe, runtimes }) {
  const mem = {};
  const calls = { download: [], unpack: 0, removed: [], changed: 0 };
  const backend = {
    gpuProbe: async () => probe,
    modelsInfo: async () => ({ defaultDir: 'C:/app/trackers', exists: false, free: 9e12 }),
    runtimeStatus: async () => ({ portable: true, dir: 'C:/app', runtimes }),
    modelsScan: async () => [],
    modelsDownload: async (id, base, dir, files) => { calls.download.push({ dir, files: files.map((f) => f.path) }); },
    runtimeUnpack: async () => { calls.unpack++; },
    portableStatus: async () => ({ state: 'ready' }),
    runtimeRemove: async (id) => { calls.removed.push(id); },
    modelsChanged: async () => { calls.changed++; },
  };
  const app = { backend, settings: new Settings({ getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } }) };
  S.models.gpu = null; S.models.error = ''; S.models.job = null;
  return { app, calls };
}

test('an AMD card with the AMD runtime unpublished: the CUDA runtime is the pick, and is the one to download', unpublished(async () => {
  const { app } = boot({ probe: AMD, runtimes: [RT('runtime'), RT('runtime-rocm')] });
  await S.refresh(app);
  const c = S.choice(app);
  assert.deepEqual([c.id, c.why, c.note], ['runtime', 'AMD Radeon RX 9070 XT found', 'AMD (ROCm) runtime not published yet']);
  assert.equal(S.needsRuntime(app), true);
}));

test('an AMD card with the AMD runtime published: the AMD runtime is the pick, and is the one to download', async () => {
  const { app } = boot({ probe: AMD, runtimes: [RT('runtime'), RT('runtime-rocm')] });
  await S.refresh(app);
  assert.equal(S.choice(app).id, 'runtime-rocm');
  assert.equal(S.needsRuntime(app), true);
});

test('an AMD runtime that is on the disk is the pick for an AMD card, and nothing is downloaded', unpublished(async () => {
  const { app } = boot({ probe: AMD, runtimes: [RT('runtime'), RT('runtime-rocm', { python: true, installed: 'runtime-rocm pending' })] });
  await S.refresh(app);
  assert.equal(S.choice(app).id, 'runtime-rocm');
  assert.equal(S.needsRuntime(app), false, 'unpublished: never needed');
}));

test('choosing an unpublished runtime that is not on the disk is refused and the setting goes back', unpublished(async () => {
  const { app, calls } = boot({ probe: NV, runtimes: [RT('runtime', { python: true, installed: 'x' }), RT('runtime-rocm')] });
  await S.refresh(app);
  app.settings.set('models.runtime', 'runtime-rocm');
  assert.equal(await S.runtimeChosen(app), false);
  assert.equal(app.settings.get('models.runtime'), '');
  assert.match(S.models.error, /AMD \(ROCm\) runtime is not published yet/);
  assert.deepEqual(calls.download, []);
}));

test('choosing the CUDA runtime on an AMD PC downloads runtime.zip beside the exe and unpacks it', async () => {
  const { app, calls } = boot({ probe: AMD, runtimes: [RT('runtime-rocm', { python: true }), RT('runtime')] });
  await S.refresh(app);
  app.settings.set('models.runtime', 'runtime');
  assert.equal(await S.runtimeChosen(app), true);
  assert.deepEqual(calls.download, [{ dir: 'C:/app', files: ['runtime.zip'] }]);
  assert.equal(calls.unpack, 1);
  assert.ok(calls.changed >= 1, 'the shell drops its idle tracker');
  assert.equal(S.models.job, null);
});

test('the first-start screen only records the choice (fetch: false), and the other runtime on disk can be removed', async () => {
  const { app, calls } = boot({ probe: NV, runtimes: [RT('runtime'), RT('runtime-rocm', { python: true })] });
  await S.refresh(app);
  assert.equal(await S.runtimeChosen(app, { fetch: false }), true);
  assert.deepEqual(calls.download, []);
  assert.equal(await S.removeRuntime(app, 'runtime'), false, 'never the chosen one');
  assert.equal(await S.removeRuntime(app, 'runtime-rocm'), true);
  assert.deepEqual(calls.removed, ['runtime-rocm']);
});
