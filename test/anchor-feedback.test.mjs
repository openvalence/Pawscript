// paw-tymw: an anchor (Alt+0 / Alt+Shift+0 / Alt+M) is confirmed by a toast; since paw-ze8n it changes nothing where fusion's
// automatic mix already agrees, and only steers a shot that plays Fused. The toast says so when it changed nothing, and why.
// dev/anchors-check.mjs's setup (experiments/anchors/measure.mjs flipStart: fusion is upside down for the first 40 %).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeRun, newFrames } from '../src/lib/runs.js';
import { anchorEffect } from '../src/lib/anchors.js';
import { CASES, CUT, anchorsFor } from '../experiments/anchors/measure.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

const run0 = CASES.flipStart();
const chans = Object.fromEntries(Object.entries(run0.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));

function open(signal = 'fused') {
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 20000, tags: ['penetration'] }], ghosts: [] }, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  tr.openVideo(app.doc.media?.path || null);
  const ts = Object.values(chans)[0].map(([t]) => t);
  const run = makeRun({ n: 7, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: 20000 }, roi: null,
    result: { samples: ts.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: chans, notes: [] }, frames: newFrames(), runs: [] });
  tr.runs = [run]; app.doc.ghosts = [tr.ghostOf(run)]; tr.select(run.id);
  tr.setDerive(0, { smart: false }, { run: run.id });
  tr.linkScene(0, run.id, signal);
  const toasts = [];
  app.toast = (m) => toasts.push(String(m));
  return { app, tr, id: run.id, toasts, fz: () => Array.from(tr.run(run.id).channels.fused?.v || []) };
}

test('anchorEffect: changed, agreed, off the data', () => {
  const a = { list: [{ ms: 1000, section: 0 }, { ms: 5000, section: 1 }], sections: [{ unchanged: false }, { unchanged: true }] };
  assert.equal(anchorEffect(a, 1000), '');
  assert.match(anchorEffect(a, 5010), /already fits/);
  assert.match(anchorEffect(a, 9000), /no data/);
});

test('anchors where the automatic mix agrees change nothing, and the toast says so; where it is wrong they move the trace', async () => {
  const a = open();
  assert.equal(a.tr.shotSource(a.tr.run(a.id), 0), 'fused');
  const v0 = a.fz();
  const good = anchorsFor(1, 0, CUT + 50, 10 ** 6)[0];
  a.tr.anchorAt(good.pos, good.ms);
  assert.match(a.toasts.at(-1), /already fits these frames best/, a.toasts.at(-1));
  assert.deepEqual(a.fz(), v0, 'nothing changed');
  const bad = anchorsFor(2, 0, 0, CUT);
  for (const x of bad) a.tr.anchorAt(x.pos, x.ms);
  assert.doesNotMatch(a.toasts.at(-1), /already fits|not playing Fused/, a.toasts.at(-1));
  assert.notDeepEqual(a.fz(), v0, 'the trace moved in the wrong part');
});

test('a shot that does not play Fused: the toast says anchors only set its depth', () => {
  const a = open('pair_proj');
  a.tr.anchorAt(0, 3000);
  assert.match(a.toasts.at(-1), /not playing Fused: anchors only set its depth/, a.toasts.at(-1));
});
