// paw-bsyo: part proposals on a VIDEO seed frame. A project never saved has no media.hash (it is stored by the first save), so the request
// had no key and nothing was asked, silently. The key is the file's fingerprint computed on demand; a failed round says why, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

test('video seed frame: an unsaved project (no media.hash) still asks for proposals, with the video fingerprint as the key; a failure toasts once', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  try {
    const M = await server.ssrLoadModule('/dev/mock-app.js'), GS = await server.ssrLoadModule('/src/features/tracking/groups.svelte.js'), T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
    const be = Object.assign(M.mockBackend(), { async appPaths() { return { data_dir: 'C:\data' }; }, async fileFingerprint(p) { return { fingerprint: 'q1-' + p.length, size: 1 }; } });
    const doc = { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 60000 }], ghosts: [] };
    assert.equal(doc.media.hash, undefined, 'no fingerprint yet');
    const app = M.createMockApp({ doc, keys: false, backend: be });
    app.tracking = T.trackingFor(app); app.mode = 'track';
    const toasts = []; app.toast = (m) => toasts.push(m);
    app.player.seek?.(2000); if (app.player.timeMs !== 2000) app.player.timeMs = 2000;
    const reqs = []; let answer = (req) => ({ result: { blobs: req.masks.map(() => ({ part: [{ part: 'thighs', p: 0.97 }], conf: 0.97, auto: true })) } });
    app.tracking.job = async (label, req) => { reqs.push([label, req]); return answer(req); };
    const G = GS.groupsFor(app);
    G.toggle(true);
    assert.ok(G.begin(0.5, 0.5, false)); G.move(0.55, 0.5); G.end();
    await G.proposalsSettled();
    assert.equal(reqs.length, 1, 'asked');
    assert.deepEqual([reqs[0][0], reqs[0][1].cmd, reqs[0][1].video, reqs[0][1].seed.key], ['name', 'name_groups', doc.media.path, 'q1-' + doc.media.path.length]);
    assert.equal(G.proposalFor(G.groups[0])?.parts[0].part, 'thighs');
    answer = () => ({ error: 'boom\nstack' });
    assert.ok(G.begin(0.2, 0.2, false)); G.move(0.25, 0.2); G.end();
    await G.proposalsSettled(); G.proposeSoon(0); await G.proposalsSettled();
    assert.deepEqual(toasts, ['Part proposals failed: boom'], 'said once, first line');
  } finally { await server.close(); }
});
