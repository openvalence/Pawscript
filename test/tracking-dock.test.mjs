// Tracker dock + fusion view (paw-ufv): features/tracking/dock.js (channels, hidden slots, per-channel facts) and
// features/tracking/fusion-view.js (weights at t, per-part say, hit-testing a part on the video).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockChannels, hiddenSlots, slotKey, lostShares, channelStats, axisUnit, SLOTS } from '../src/features/tracking/dock.js';
import { fuseWeightsAt, partWeights, partNear, weightById, frameParts } from '../src/features/tracking/fusion-view.js';
import { semNames, drawBlobsView, blobOpts } from '../src/features/tracking/blobs.js';
import { series } from '../src/lib/runs.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

// a run with two pinned user groups (ids 4, 5 = c1_penis, c2_hips), one motion group and still points, 60 frames
function fixture() {
  const n = 60, t = Array.from({ length: n }, (_, k) => k * 33), ov = [];
  for (let k = 0; k < n; k++) {
    const y = 0.5 + 0.05 * Math.sin(k / 3);
    ov.push({ pts: [
      [0.4, y, 1, 1, 0, 4], [0.42, y, k % 2 ? 0 : 1, 1, 0, 4],   // c1_penis: one member hidden every other frame
      [0.6, 0.5, 1, 2, 0, 5],                                     // c2_hips: still
      [0.1, 0.1, 1, 3],                                           // g3
      [0.9, 0.9, 1, 0],                                           // still
    ] });
  }
  const run = { id: 'r1', params: {}, scenes: [{ start_ms: 0, end_ms: 2000, groups: { sem_c1_penis: { id: 4, label: 'c1_penis' }, sem_c2_hips: { id: 5, label: 'c2_hips' } } }],
    channels: {
      sem_c1_penis_x: series(t.map((x) => [x, 0.4])), sem_c1_penis_y: series(t.map((x, k) => [x, 0.5 + 0.05 * Math.sin(k / 3)])),
      sem_c2_hips_x: series(t.map((x) => [x, 0.6])), sem_c2_hips_y: series(t.map((x, k) => [x, 0.5 + 0.001 * ((k * 7919) % 13) / 13])),
    },
    samples: series(t.map((x, k) => [x, 0.5 + 0.5 * Math.sin(k / 3)])) };
  return { run, fr: { t, ov } };
}

test('dock channels: pinned parts by name, then groups, still; keys stable by name', () => {
  const { run, fr } = fixture();
  const ch = dockChannels(run, fr);
  assert.deepEqual(ch.map((c) => c.key), ['sem:c1_penis', 'sem:c2_hips', 'g3', 'still']);
  assert.deepEqual(ch.map((c) => c.label), ['Bottom penis', 'Top hips', 'g3', 'Still']);
  assert.equal(ch[0].stem, 'sem_c1_penis');
  assert.equal(slotKey(5 + 4, semNames(run)), 'sem:c1_penis');
  assert.deepEqual(dockChannels(run, { t: [], ov: [] }), []);
});

test('hidden slots: keys -> a flag per slot; nothing hidden = null', () => {
  const { run } = fixture(), sn = semNames(run);
  assert.equal(hiddenSlots([], sn), null);
  assert.equal(hiddenSlots(['sem:nope'], sn), null);
  const h = hiddenSlots(['sem:c2_hips', 'still'], sn);
  assert.equal(h.length, SLOTS);
  assert.deepEqual([h[5 + 5], h[4], h[5 + 4], h[2]], [1, 1, 0, 0]);
});

test('facts: the moving part moves and follows the stroke, the still one does not; lost share', () => {
  const { run, fr } = fixture(), ch = dockChannels(run, fr);
  const [pen, hips, g3] = ch.map((c) => channelStats(run, fr, c, 0, 2000, { aspect: 1, ref: run.samples }));
  assert.ok(pen.moves > 0.02 && hips.moves < 0.005, `${pen.moves} ${hips.moves}`);
  assert.ok(pen.agree > 0.95, String(pen.agree));
  near(pen.lost, 0.25, 0.01);   // one of two members hidden on half the frames
  near(hips.lost, 0);
  assert.ok(Number.isNaN(g3.moves), 'no centre channel: no motion figure');
  assert.equal(channelStats(run, fr, ch[0], 0, 2000, { aspect: 1, ref: run.samples }), pen, 'cached');
});

test('lost shares: live frames (growing) continue the pass', () => {
  const { fr } = fixture(), live = { t: fr.t.slice(0, 10), ov: fr.ov.slice(0, 10) };
  const a = lostShares(live, -Infinity, Infinity)[9];
  live.t.push(...fr.t.slice(10)); live.ov.push(...fr.ov.slice(10));
  const b = lostShares(live, -Infinity, Infinity)[9];
  near(a, 0.25); near(b, 0.25);
  near(lostShares(fr, -Infinity, Infinity)[9], b);
});

test('axis unit: square units, up / right positive like fusion.js', () => {
  assert.deepEqual(axisUnit(null, 0, 1), [0, -1]);
  const r = { params: { axis: 'custom', axis_x0: 0.5, axis_y0: 0.2, axis_x1: 0.5, axis_y1: 0.8 }, channels: {} };
  const u = axisUnit(r, 0, 1, 16 / 9);
  near(u[0], 0); near(u[1], -1);
  const h = axisUnit({ params: { axis: 'custom', axis_x0: 0.8, axis_y0: 0.5, axis_x1: 0.2, axis_y1: 0.5 }, channels: {} }, 0, 1, 2);
  near(h[0], 1); near(h[1], 0);
});

const info = {
  candidates: [
    { id: 'c1_penis', parts: ['c1_penis'], kind: 'single', sign: 1 },
    { id: 'c1_penis~c2_hips', parts: ['c1_penis', 'c2_hips'], kind: 'pair', sign: -1 },
    { id: 'c1_tail', parts: ['c1_tail'], kind: 'single', sign: 1 },
  ],
  windows: [
    { t: 0, t1: 2000, w: { c1_penis: 0.25, 'c1_penis~c2_hips': 0.75 } },
    { t: 500, t1: 2500, w: { c1_tail: 1 } },
  ],
};

test('fusion weights at t: windows cross-faded, normalised', () => {
  const w0 = fuseWeightsAt(info, 100);   // only the first window
  near(w0.c1_penis, 0.25); near(w0['c1_penis~c2_hips'], 0.75);
  const w = fuseWeightsAt(info, 1500);   // both: tri 0.5 (first) and 1 (second, centre)
  near(w.c1_tail, 1 / 1.5, 1e-3); near(w.c1_penis + w['c1_penis~c2_hips'] + w.c1_tail, 1);
  assert.deepEqual(fuseWeightsAt(info, 9000), {});
  assert.deepEqual(fuseWeightsAt(null, 0), {});
});

test('part weights: a pair splits its say, its second part counts against it', () => {
  const P = partWeights(info, 100);
  near(P.c1_penis.w, 0.25 + 0.375); near(P.c2_hips.w, 0.375);
  near(P.c1_penis.sign, (0.25 - 0.375) / 0.625);   // single +, pair first part - (pair sign -1)
  near(P.c2_hips.sign, 1);
  const buf = new Float64Array(33), sn = []; sn[3] = 'c1_penis'; sn[4] = 'c2_hips';
  const W = weightById(P, sn, buf);
  near(W[4], 1); near(W[5], 0.375 / 0.625); assert.equal(W[1], 0);
  assert.equal(weightById({}, sn, buf), null);
});

test('part under the pointer: inside its hull, else the nearest centre within r px', () => {
  const env = { map: (x, y) => [x * 1000, y * 1000], unmap: (x, y) => [x / 1000, y / 1000] };
  const F = { S: [null, { name: 'c1_penis', c: [0.2, 0.2], hull: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]] }, { name: 'c2_hips', c: [0.5, 0.5], hull: [] }] };
  assert.equal(partNear(F.S, env, 150, 250), 'c1_penis');
  assert.equal(partNear(F.S, env, 510, 515), 'c2_hips');
  assert.equal(partNear(F.S, env, 540, 540), null, 'beyond 24 px');
  assert.equal(partNear(F.S, env, 540, 540, 60), 'c2_hips');
  assert.equal(partNear(null, env, 0, 0), null);
});

test('a run read back from a .pawruns file (pts without pinned ids): parts from their centre channels', () => {
  const { run, fr } = fixture();
  const bare = { t: fr.t, ov: fr.ov.map((o) => ({ pts: o.pts.map((p) => p.slice(0, 4)) })) };
  const ch = dockChannels(run, bare);
  assert.deepEqual(ch.map((c) => c.key), ['sem:c1_penis', 'sem:c2_hips', 'g1', 'g2', 'g3', 'still']);
  assert.equal(ch[0].slot, 5 + 4, 'its id from the scene groups');
  const st = channelStats(run, bare, ch[0], 0, 2000, { aspect: 1, ref: run.samples });
  assert.ok(st.agree > 0.95);
  const parts = frameParts(bare, 10, run, { S: [] });
  assert.deepEqual(parts.map((p) => p.name).sort(), ['c1_penis', 'c2_hips']);
  near(parts.find((p) => p.name === 'c1_penis').c[0], 0.4);
});

test('drawBlobsView: hidden slots draw no points; fusion weights size the pinned points', () => {
  const { run, fr } = fixture(), arcs = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'arc' ? (...a) => arcs.push(a) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const opts = { ...blobOpts((k, d) => d), heat: false, seeded: false, bodies: false, camera: false, axis: false, trails: false, labels: 'off' };
  const o = { colors: ['a', 'b', 'c', 'd', 'e'], ink: { text: 'w', axis: 'o', pair: 'p', grid: 'g' }, opts, run, aspect: 1 };
  const env = { map: (x, y) => [x * 100, y * 100] }, at = (x) => arcs.filter((a) => Math.abs(a[0] - x) < 1e-6);
  drawBlobsView(ctx, env, fr, 0, o);
  assert.ok(at(40).length && at(90).length, 'all drawn');
  arcs.length = 0;
  drawBlobsView(ctx, env, fr, 0, { ...o, hide: hiddenSlots(['sem:c1_penis', 'still'], semNames(run)) });
  assert.equal(at(40).length + at(42).length + at(90).length, 0, 'hidden');
  assert.ok(at(60).length && at(10).length, 'the rest stays');
  arcs.length = 0;
  const w = new Float64Array(33); w[4] = 1; w[5] = 0;
  drawBlobsView(ctx, env, fr, 0, { ...o, weight: w });
  assert.ok(at(40)[0][2] > at(60)[0][2], `${at(40)[0][2]} > ${at(60)[0][2]}: the part with the say is bigger`);
});
