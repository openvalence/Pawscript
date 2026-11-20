// paw-o60v.2: "dragging the pad is laggy". A pad move re-weighs only the scene it moves (fusion.js: the analysis, the automatic
// mix and the windows' data-only parts cached; the exact results per controls kept), and between rests the run composes for
// the trace only (runs-channel.js ctx.live: no HOW, no Detail, no points). What lands must be what a direct set gives: the
// drag path (live steps at many pad positions, a rest, the release) against the same compose on a cold copy of the run, bit
// for bit; the live trace is the true mix at each position. The store side: fuseLive while the pointer moves, cleared by a
// rest of REST_MS, the release or a cancel (effects do not run under SSR: the state the composes read is asserted).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { channelPatch } from '../src/lib/runs-channel.js';
import { fusedChannel } from '../src/lib/fusion.js';
import { CASES } from './fusion-synth.mjs';

/** Equal, NaN = NaN, typed arrays element by element; -> the first difference's path or null. */
function diff(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b ? null : `${path}: ${a} vs ${b}`;
  if (typeof a === 'function' && typeof b === 'function') return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return `${path}: ${a} vs ${b}`;
  if (ArrayBuffer.isView(a) || Array.isArray(a)) {
    if (a.length !== b.length) return `${path}.length`;
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined).sort(), kb = Object.keys(b).filter((k) => b[k] !== undefined).sort();
  if (ka.join() !== kb.join()) return `${path} keys ${ka} vs ${kb}`;
  for (const k of ka) { const d = diff(a[k], b[k], `${path}.${k}`); if (d) return d; }
  return null;
}
/** The run with every channel a new object (new arrays): no cache keyed on the old ones applies. */
const cold = (run) => ({ ...run, channels: Object.fromEntries(Object.entries(run.channels).map(([k, c]) => [k, { ...c, t: Float64Array.from(c.t), v: Float64Array.from(c.v) }])) });
const sceneOf = (id) => { const s = CASES.find((c) => c.id === id).make(); return { ...s, run: { ...s.run, channel: 'primary', points0: { at: new Float64Array(0), pos: new Float64Array(0) } } }; };
const path = Array.from({ length: 24 }, (_, k) => ({ x: +(0.8 * Math.cos(k / 3)).toFixed(3), y: +(0.8 * Math.sin(k / 2)).toFixed(3) }));

for (const [id, extra] of [['handjob', { source: 'fused' }], ['fellatio-head', { smart: true, detail: [{ t0: -1e9, t1: 1e9, shape: 'auto', sens: 60 }] }], ['halves', { source: 'fused', detail: [{ t0: -1e9, t1: 1e9, shape: 'auto', sens: 40 }] }]]) {
  test(`${id} ${Object.keys(extra).join(' + ')}: a drag lands on what a direct set composes, bit for bit; the live trace is the true mix`, () => {
    const s = sceneOf(id), d0 = s.derives?.[0] || {}, dv = (pad) => [{ ...d0, ...extra, match: true, fuse: { ...(d0.fuse || {}), pad } }];
    const ctx = (pad, live) => ({ aspect: s.aspect, derives: dv(pad), ...(live ? { live: true } : {}) });
    for (const [k, pad] of path.entries()) {
      const live = channelPatch(s.run, 'primary', {}, [], ctx(pad, true));
      if (k % 6 === 5) {   // a rest now and then (exact, kept), and back on an earlier position
        channelPatch(s.run, 'primary', {}, [], ctx(pad, false));
        channelPatch(s.run, 'primary', {}, [], ctx(path[k - 3], true));
      }
      if (k % 8) continue;
      // the trace under the pad during the drag: the exact mix at that position (only HOW, the Detail and the points wait)
      const exact = channelPatch(cold(s.run), 'primary', {}, [], ctx(pad, false));
      assert.equal(diff(live.lane, exact.lane), null, `the live trace at ${JSON.stringify(pad)} is the exact one`);
      const { how: _a, ...li } = live.channels.fused.info[0], { how: _b, ...ei } = exact.channels.fused.info[0];
      assert.equal(diff([live.channels.fused.v, live.channels.fused.timing, li], [exact.channels.fused.v, exact.channels.fused.timing, ei]), null, 'the fused signal and its record');
      assert.equal(live.points0.at.length, 0, 'no points made between rests');
    }
    const end = path[path.length - 1], release = channelPatch(s.run, 'primary', {}, [], ctx(end, false)), direct = channelPatch(cold(s.run), 'primary', {}, [], ctx(end, false));
    assert.equal(diff(release, direct), null, 'the release: everything (points, HOW, Detail, the record) as a direct set');
    assert.ok(release.points0.at.length > 3);
  });
}

test('the fusion record and the automatic mix do not move with the pad; another scene of the run is not re-fused', () => {
  const s = sceneOf('rimming-head'), base = fusedChannel(s.run, { aspect: s.aspect, derives: s.derives });
  const at = (pad) => fusedChannel(s.run, { aspect: s.aspect, derives: [{ ...(s.derives[0] || {}), fuse: { ...(s.derives[0]?.fuse || {}), pad } }] });
  const a = at({ x: 0.6, y: 0 }), b = at({ x: -0.6, y: 0.5 });
  assert.deepEqual(a.info[0].auto, base.info[0].auto, 'where the automatic weights sit: the same at any pad position');
  assert.deepEqual(b.info[0].auto, base.info[0].auto);
  assert.notDeepEqual(a.info[0].mix, b.info[0].mix, 'the mix follows the pad');
  assert.equal(at({ x: 0.6, y: 0 }).info[0], a.info[0], 'the same controls again: the kept result');
  assert.equal(diff(at({ x: 0.6, y: 0 }), fusedChannel(cold(s.run), { aspect: s.aspect, derives: [{ ...(s.derives[0] || {}), fuse: { ...(s.derives[0]?.fuse || {}), pad: { x: 0.6, y: 0 } } }] })), null, 'and it is what a cold compose gives');
});

// ---- the store: fuseLive between rests ----
const root = fileURLToPath(new URL('..', import.meta.url));
let server, M, T;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  M = await server.ssrLoadModule('/dev/mock-app.js');
  T = await server.ssrLoadModule('/src/features/tracking/tracking.svelte.js');
});
after(() => server?.close());

test('the store: a drag is live until the pointer rests, is released or cancelled; one undo step on release', async () => {
  const sc = CASES.find((c) => c.id === 'handjob').make();
  const CH = Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
  const TS = CH.who_pair_proj.map(([t]) => t);
  const app = M.createMockApp({ doc: { ...M.sampleDoc(), scenes: [{ start_ms: 0, end_ms: 20000, tags: ['handjob'] }], ghosts: [] }, keys: false }), tr = T.trackingFor(app);
  app.loadBlocks({});
  tr.openVideo(app.doc.media?.path || null);
  tr.job = async (label) => (label === 'track' ? { result: { samples: TS.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: CH, notes: [] } } : { cancelled: true });
  const id = (await tr.runTrack({ id: 'tapnext_points', name: 'TAPNext++', params: [] }, { start: 0, end: 20000 }, { axis: 'auto' }, null, [], { check: false })).run.id;
  const n0 = app.history.index, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  assert.equal(tr.fuseLive, null);
  for (const x of [0.1, 0.3, 0.5]) tr.setFuse(0, { pad: { x, y: 0 } }, { commit: false, run: id });
  assert.deepEqual(tr.fuseLive, { run: id }, 'live while it moves');
  assert.equal(app.history.index, n0, 'nothing written while dragging');
  await wait(220);
  assert.equal(tr.fuseLive, null, 'a rest: composed exactly');
  tr.setFuse(0, { pad: { x: 0.6, y: 0 } }, { commit: false, run: id });
  assert.ok(tr.fuseLive);
  tr.setFuse(0, { pad: { x: 0.6, y: 0 } }, { run: id, label: 'Fusion: pad' });
  assert.equal(tr.fuseLive, null, 'the release: exact at once');
  assert.equal(app.history.index, n0 + 1, 'one undo step');
  tr.setFuse(0, { pad: { x: 0.2, y: 0 } }, { commit: false, run: id });
  tr.cancelDerive();
  assert.equal(tr.fuseLive, null, 'a cancel: exact at once');
});
