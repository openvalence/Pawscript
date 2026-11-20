// Blobs view (features/tracking/blobs.js): options, geometry, decimation lattice, velocity, series sampling, HUD rows,
// point info, per-frame bodies (cache, smoothing, decimation), anchored centres, heat splats, pinned part outlines, the
// primary / camera layers and a cost check of drawBlobsView on a 60 s / 500-point run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partAt, partOf, semOf, semAt, primaryNote, BLOB_SCHEMA, blobOpts, polyArea, clipLine, ptsCentres, anchoredPath, heatSplats, slotOf, primaryTarget, cameraAt, HEAT_FULL, HEAT_TOP, HEAT_R_MIN, HEAT_R_MAX, medianNN, heatRadius, pcaAxis, lattice, velocity, sampleAt, sparkSeries, primaryName, hudRows, pointInfo, frameBodies, bodyAt, runAxis, drawBlobsView, valueColor, carriedPoly } from '../src/features/tracking/blobs.js';
import { SCHEMA } from '../src/app/settings.svelte.js';
import { series, channelOf } from '../src/lib/runs.js';
import { budget } from './perf.mjs';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test('options: every form key is a documented setting; defaults = every layer and the fusion view, no hulls, no Info card', () => {
  for (const p of BLOB_SCHEMA) assert.ok(SCHEMA['tracking.blobs.' + p.key]?.doc, p.key);
  const o = blobOpts((k, d) => d);
  assert.deepEqual([o.heat, o.points, o.seeded, o.bodies, o.camera, o.primary, o.axis, o.trails, o.fusion], new Array(9).fill(true));
  assert.deepEqual([o.hulls, o.occluded, o.hud, o.smoothMs, o.decim], [false, false, false, 0, 1]);
  const o2 = blobOpts((k, d) => ({ 'tracking.blobs.smooth': '0.5 s', 'tracking.blobs.decimate': '1 in 9' })[k] ?? d);
  assert.deepEqual([o2.smoothMs, o2.decim], [500, 9]);
});

test('polygon area, line clip, PCA axis', () => {
  const sq = [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]];
  near(polyArea(sq), 0.25);
  assert.deepEqual(clipLine(0.5, 0.5, 0, 1), [0.5, 0, 0.5, 1]);
  assert.deepEqual(clipLine(0.5, 0.5, 1, 1), [0, 0, 1, 1]);
  assert.equal(clipLine(2, 0.5, 0, 1), null);
  const xs = [0.4, 0.45, 0.5, 0.55, 0.6], ys = [0.3, 0.4, 0.5, 0.6, 0.7];   // along (0.1, 0.2) in frame coords
  const a = pcaAxis(xs, ys, 1);
  near(a.x, 0.5); near(Math.abs(a.dy / a.dx), 2, 1e-9);
  const b = pcaAxis(xs, ys, 2);   // 2:1 picture: the same points are 1:1 in pixels; direction comes back in frame coords
  near(Math.abs(b.dy / b.dx), 2, 1e-9);
  assert.equal(pcaAxis([0.1, NaN], [0.1, 0.2]), null);
});

test('lattice: about 1 in k of the seeds, spread over the whole area', () => {
  const seeds = [];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) seeds.push([x / 11, y / 11]);
  seeds.push(null);
  for (const k of [4, 9]) {
    const keep = lattice(seeds, k), n = keep.reduce((s, v) => s + v, 0);
    assert.ok(n >= 144 / k * 0.6 && n <= 144 / k * 1.6, `k ${k}: ${n}`);
    const kept = seeds.filter((s, j) => keep[j]);
    assert.ok(Math.min(...kept.map((s) => s[0])) < 0.25 && Math.max(...kept.map((s) => s[0])) > 0.75);   // corners covered
    assert.equal(keep[144], 0);
  }
  assert.equal(lattice([null, null], 4).reduce((s, v) => s + v, 0), 0);
});

test('velocity: from the last ms of the path, stops at gaps and jumps', () => {
  const t = [0, 33, 67, 100, 133, 167], X = [0.1, 0.11, 0.12, 0.13, 0.14, 0.15], Y = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const v = velocity(X, Y, t, 5, 150);
  near(v[0], (0.15 - 0.11) / 0.134, 1e-9);   // frames within 150 ms: 33..167 near(v[1], 0);
  assert.equal(velocity([NaN], [NaN], [0], 0), null);
  assert.equal(velocity([0.1, 0.5], [0.5, 0.5], [0, 33], 1), null);   // a jump is a re-seed
  assert.equal(velocity([NaN, 0.5], [0.5, 0.5], [0, 33], 1), null);
});

test('sampleAt / sparkSeries: at or just before t, NaN past a gap', () => {
  const s = series([[0, 0], [100, 1], [200, 0.5], [1000, 0.2]]);
  assert.equal(sampleAt(s, 150), 1);
  assert.ok(Number.isNaN(sampleAt(s, 600)));
  assert.ok(Number.isNaN(sampleAt(s, -10)));
  const sp = sparkSeries(s, 0, 200, 3);
  assert.deepEqual([...sp], [0, 1, 0.5]);
});

// a small run with groups: 3 frames, 6 points
const run = () => ({
  name: 'run1', params: { primary: 'auto' }, samples: series([[0, 0.2], [33, 0.4], [67, 0.6]]),
  confidence: series([[0, 0.9], [33, 0.8], [67, 0.7]]),
  channels: Object.fromEntries(Object.entries({
    primary_used: [[0, 0], [33, 0], [67, 0]], proj: [[0, 0.2], [33, 0.4], [67, 0.6]], pair_dist: [[0, 0.3], [33, 0.25], [67, 0.2]], n_groups: [[0, 2], [33, 2], [67, 2]],
    g1_n: [[0, 0.5], [33, 0.5], [67, 0.5]], g1_x: [[0, 0.3], [33, 0.31], [67, 0.32]], g1_y: [[0, 0.5], [33, 0.5], [67, 0.5]], g1_proj: [[0, 0.1], [33, 0.5], [67, 0.9]],
    g1_scale: [[0, 1], [33, 1.1], [67, 1.2]], weird_metric: [[0, 7], [33, 8], [67, 9]], centroid_x: [[0, 0.4], [33, 0.41], [67, 0.42]], centroid_y: [[0, 0.5], [33, 0.6], [67, 0.7]],
  }).map(([k, v]) => [k, channelOf(v)])),
});
const frames = () => {
  const ov = [0, 1, 2].map((f) => ({ pts: [
    [0.2 + f * 0.01, 0.2, 1, 1], [0.4 + f * 0.01, 0.2, 1, 1], [0.3 + f * 0.01, 0.4, 1, 1],   // g1 triangle, moving right
    [0.8, 0.8, 1, 0], [0.9, 0.1, f === 1 ? 0 : 1, -1], [0.6, 0.6, 1, 2, ...(f === 2 ? [1, 0, 0.7] : [])],   // static, unassigned (occluded on 1), g2 (part 1 + an extra element on 2)
  ] }));
  return { t: [0, 33, 67], v: [0, 0, 0], ov };
};

test('primaryName: requested, else what auto resolved to', () => {
  assert.equal(primaryName(run(), 33), 'proj');
  assert.equal(primaryName({ ...run(), params: { primary: 'g2_proj' } }, 33), 'g2_proj');
  assert.equal(primaryName({ params: {}, channels: {} }, 0), 'primary');
});

test('hudRows: frame numbers; hovered group / point; unknown channels under other', () => {
  const r = run(), fr = frames();
  const rows = hudRows({ run: r, t: 33 }), by = Object.fromEntries(rows.map((x) => [x.k, x.v]));
  assert.equal(by.primary, 'proj 0.400');
  assert.ok(!('pair distance' in by) && !('moving groups' in by), 'paw-57dw: no motion-group rows');
  assert.equal(by['tracker confidence'], '0.80');
  assert.ok(!('other' in by) && !('lane' in by));
  assert.equal(hudRows({ run: r, t: 33, lane: 'g1_proj' }).find((x) => x.k === 'lane').v, 'g1_proj 0.500');
  const F = frameBodies(fr, 2, {});
  const g = hudRows({ run: r, t: 67, hover: { g: 1 }, body: F.G[0], aspect: 1 }), gb = Object.fromEntries(g.map((x) => [x.k, x.v]));
  assert.equal(gb.g1, '3 pts');
  assert.ok(!('cam-free' in gb), 'a moving group has no channels of its own');
  assert.equal(gb.stroke, '0.600');   // proj, under its plain name
  assert.equal(gb.g1_scale, '1.200');   // a new per-group channel shows generically
  assert.equal(gb.weird_metric, '9.000');   // unknown channel: 'other'
  assert.match(gb.speed, /h\/s$/);
  const pi = pointInfo(fr, 2, 5);
  const p = hudRows({ run: r, t: 67, hover: { j: 5 }, point: pi }), pb = Object.fromEntries(p.map((x) => [x.k, x.v]));
  assert.equal(pb['point 5'], 'g2 · p1');   // pts[4] is the part (v3.4)
  assert.equal(pb['pts[6]'], '0.700');   // pts[5] is the pinned group (v4.6), 0 = none
  assert.deepEqual(hudRows({ run: null, t: 0 }), []);
});

test('pointInfo: visibility run length and group history in the scene', () => {
  const fr = frames();
  const a = pointInfo(fr, 2, 4);
  assert.deepEqual([a.v, a.runFrames, a.runMs, a.g], [true, 1, 0, -1]);
  const b = pointInfo(fr, 2, 0);
  assert.deepEqual([b.runFrames, b.runMs, b.hist], [3, 67, 'g1×3']);
  assert.equal(pointInfo(fr, 1, 99), null);
  assert.equal(pointInfo(fr, 2, 0, 33).runFrames, 2);   // the scene starts at 33 ms
});

test('frameBodies: hull, area, centroid, velocity; cached; smoothing and decimation; bodyAt', () => {
  const fr = frames();
  const F = frameBodies(fr, 2, {});
  assert.equal(F, frameBodies(fr, 2, {}));   // cached
  const b = F.G[0];
  assert.equal(b.n, 3); assert.equal(b.hull.length, 3);
  near(b.area, 0.5 * 0.2 * 0.2);
  near(b.c[0], 0.32); near(b.c[1], 0.8 / 3);
  near(b.vel[0], 0.02 / 0.067, 1e-9);
  assert.equal(F.G[1].n, 1); assert.equal(F.G[2], null);
  assert.equal(bodyAt(F, 0.32, 0.27), 1);
  assert.equal(bodyAt(F, 0.9, 0.9), 0);
  const S = frameBodies(fr, 1, { smoothMs: 1000 });   // centred mean of frames 0..2
  assert.notEqual(S, frameBodies(fr, 1, {}));
  near(S.G[0].pts[0][0], 0.21); near(S.G[0].c[0], 0.31);
  const D = frameBodies(fr, 0, { decim: 4 });
  assert.ok(D.keep && D.keep.length === 6);
  assert.ok(D.G[0].n === 3 && D.G[0].pts.length <= 3);   // n counts every member; pts only the kept ones
});

test('runAxis: custom from the params, else a PCA estimate of the centroid over the scene', () => {
  const r = run();
  assert.equal(runAxis({ ...r, params: { axis: 'custom', axis_x0: 0.5, axis_y0: 0.2, axis_x1: 0.5, axis_y1: 0.8 } }).kind, 'custom');
  const a = runAxis(r, -Infinity, Infinity, 1);
  assert.equal(a.kind, 'PCA est.');
  near(Math.abs(a.dy / a.dx), 10, 1e-4);   // float32 channels
  assert.equal(runAxis({ ...r, params: { axis: 'vertical' } }, 0, Infinity).dx, 0);
});

test('v3.2 primary note: chosen name, rule and sign rows, the sidecar axis direction', () => {
  const data = { chosen: 'proj_cam', rule: 'auto: 1 click → proj', axis: { mode: 'auto', deg: 90 }, sign: { mode: 'auto', applied: -1, score: 0.42 } };
  const r = { ...run(), scenes: [{ start_ms: 0, end_ms: 50 }, { start_ms: 50, end_ms: 100 }], notes: [{ code: 'primary', message: '', scene_index: 1, data }] };
  assert.equal(primaryNote(r, 10), null);
  assert.equal(primaryNote(r, 67), data);
  assert.equal(primaryName(r, 10), 'proj');   // scene 0 has no note: primary_used
  assert.equal(primaryName(r, 67), 'proj_cam');
  const by = Object.fromEntries(hudRows({ run: r, t: 67 }).map((x) => [x.k, x]));
  assert.equal(by.why.v, 'auto: 1 click → proj'); assert.ok(by.why.wide);
  assert.equal(by.direction.v, '−1 · auto · score 0.42');
  const a = runAxis(r, 50, 100, 16 / 9);
  assert.equal(a.kind, 'auto 90°');
  near(a.dx, 0, 1e-12); near(a.dy, -1);   // 90 = up
});

test('valueColor: 0..1 ramps blue -> red, other numbers by value', () => {
  assert.equal(valueColor(0), 'hsl(210 90% 60%)');
  assert.equal(valueColor(1), 'hsl(0 90% 60%)');
  assert.match(valueColor(3), /^hsl\(\d+ 90% 60%\)$/);
});

// a canvas stand-in that only counts calls
const stubCtx = () => new Proxy({ calls: 0 }, { get: (o, k) => (k in o ? o[k] : () => { o.calls++; }), set: (o, k, v) => { o[k] = v; return true; } });
test('drawBlobsView: every element on, 60 s x 30 fps x 500 points stays cheap per frame', () => {
  const N = 500, F = 1800, ov = [], t = [];
  for (let f = 0; f < F; f++) {
    t.push(Math.round(f * 33.37));
    const s = Math.sin(f / 10) * 0.05, pts = [];
    for (let j = 0; j < N; j++) {
      const x = (j % 25) / 25, y = Math.floor(j / 25) / 20, g = x > 0.3 && x < 0.7 && y > 0.3 && y < 0.7 ? (y < 0.5 ? 1 : 2) : x < 0.1 ? -1 : 0;
      pts.push([x + (g > 0 ? s * g : 0), y, j % 37 === f % 37 ? 0 : 1, g, j % 50 === 0 ? 0.5 : 0]);
    }
    ov.push({ pts });
  }
  const fr = { t, v: new Array(F).fill(0), ov }, r = run();
  const env = { map: (x, y) => [x * 1280, y * 720] };
  const opts = { ...blobOpts((k, d) => d), hulls: true, occluded: true, smoothMs: 500, decim: 4 };
  const o = { colors: ['a', 'b', 'c', 'd', 'e'], ink: { text: 'w', axis: 'o', pair: 'p', grid: 'g' }, opts, run: r, lane: 'g1_proj', aspect: 16 / 9 };
  const ctx = stubCtx(), t0 = performance.now();
  for (let i = 0; i < 300; i++) drawBlobsView(ctx, env, fr, i * 6, o);   // first visit of 300 frames: no cache
  const first = (performance.now() - t0) / 300, t1 = performance.now();
  for (let i = 0; i < 300; i++) drawBlobsView(ctx, env, fr, i * 6, o);   // scrubbing back over them: cached bodies
  const again = (performance.now() - t1) / 300;
  assert.ok(ctx.calls > 0);
  budget(first < 12 && again < 6, `ms per frame: first ${first.toFixed(2)}, cached ${again.toFixed(2)}`);
});

test('v3.4 parts: nested in their body, hit-tested, named in the HUD; pts[4] is the part, not an extra ring', () => {
  // g1: a big square of 4 points + a part (id 1) of 3 points inside it; one point with an unknown 6th element
  const pts = [[0.1, 0.1, 1, 1], [0.5, 0.1, 1, 1], [0.5, 0.5, 1, 1], [0.1, 0.5, 1, 1], [0.2, 0.2, 1, 1, 1], [0.3, 0.2, 1, 1, 1], [0.25, 0.3, 1, 1, 1, 0, 0.4], [0.9, 0.9, 1, 0]];
  const fr = { t: [0], v: [0], ov: [{ pts }] };
  assert.deepEqual([partOf(pts[0]), partOf(pts[4]), partOf([0, 0, 1, -1, 1])], [0, 1, 0]);
  const F = frameBodies(fr, 0, {}), b = F.G[0];
  assert.equal(b.n, 7);   // the part's points are still its body's members
  assert.equal(b.parts[0].n, 3); assert.equal(b.parts[1], null);
  near(b.parts[0].c[0], 0.25); near(b.parts[0].c[1], 0.7 / 3);
  assert.deepEqual(partAt(F, 0.25, 0.23), { g: 1, p: 1 });
  assert.equal(partAt(F, 0.45, 0.45), null); assert.equal(bodyAt(F, 0.45, 0.45), 1);
  const ch = (v) => channelOf([[0, v]]);
  const r = { name: 'r', params: {}, samples: series([[0, 0.5]]), scenes: [{ start_ms: 0, end_ms: 100, groups: { g1: { label: 'body' }, g1p1: { label: 'balls' } } }],
    channels: { g1_n: ch(0.6), g1p1_n: ch(0.05), g1p1_rel: ch(0.3), g1p1_scale: ch(-0.02), g1p1_proj: ch(0.7), g1_scale: ch(0.01), g1_rot: ch(0.02) } };
  const rows = hudRows({ run: r, t: 0, hover: { g: 1, p: 1 }, body: b }), by = Object.fromEntries(rows.map((x) => [x.k, x.v]));
  assert.equal(by.g1p1, '3 pts');
  assert.ok(hudRows({ run: r, t: 0, hover: { g: 1 }, body: b }).some((x) => x.k === 'g1'));
  // drawing: labels carry the numbers (no tagger names for motion groups, paw-57dw); the extra-ring path draws only the 7th element (one ring)
  const texts = [], arcs = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'fillText' ? (t) => texts.push(t) : k === 'arc' ? (...a) => arcs.push(a) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const opts = { ...blobOpts((k, d) => d), hulls: true, points: false, extra: true, axis: false, camera: false, trails: false };
  drawBlobsView(ctx, { map: (x, y) => [x * 100, y * 100] }, fr, 0, { colors: ['#1FC3FA', 'b', 'c', 'd', 'e'], ink: { text: 'w', axis: 'o', pair: 'p', grid: 'g' }, opts, run: r, aspect: 1 });
  texts.length = 0;   // labels need room (a low-priority one with no clear place hides): a 400 px picture
  drawBlobsView(ctx, { map: (x, y) => [x * 400, y * 400] }, fr, 0, { colors: ['#1FC3FA', 'b', 'c', 'd', 'e'], ink: { text: 'w', axis: 'o', pair: 'p', grid: 'g' }, opts, run: r, aspect: 1 });
  assert.ok(texts.includes('g1') && texts.includes('p1'), texts.join('|'));   // short by default
  arcs.length = 0;
  drawBlobsView(ctx, { map: (x, y) => [x * 100, y * 100] }, fr, 0, { colors: ['#1FC3FA', 'b', 'c', 'd', 'e'], ink: { text: 'w', axis: 'o', pair: 'p', grid: 'g' }, opts, run: r, aspect: 1 });
  assert.deepEqual(arcs.filter((a) => a[2] === 5).map((a) => [a[0], a[1]]), [[25, 30]], 'one extra ring (pts[6]); none for the part ids');
  assert.equal(arcs.filter((a) => (a[0] === 20 || a[0] === 30) && a[1] === 20).length, 0, 'part points without a 7th element: no ring');
});

test('v4.6 pinned groups: pts[5] is the seeded group (hull, label, HUD), not a ring; rings only from pts[6]', () => {
  // g1: a square; hips: 3 pinned points (g -1, part 0, s 3) inside it; balls: 1 pinned point; one hips point occluded
  const pts = [[0.1, 0.1, 1, 1], [0.5, 0.1, 1, 1], [0.5, 0.5, 1, 1], [0.1, 0.5, 1, 1],
    [0.2, 0.3, 1, -1, 0, 3], [0.4, 0.3, 1, -1, 0, 3], [0.3, 0.45, 1, -1, 0, 3], [0.3, 0.2, 0, -1, 0, 3], [0.7, 0.7, 1, -1, 0, 2], [0.8, 0.8, 1, 0, 0, 0, 0.5]];
  const fr = { t: [0], v: [0], ov: [{ pts }] };
  assert.deepEqual(pts.map(semOf), [0, 0, 0, 0, 3, 3, 3, 3, 2, 0]);
  assert.equal(semOf([0, 0, 1, -1, 0, 0.4]), 0, 'not 1..3: no group');
  const F = frameBodies(fr, 0, {});
  assert.equal(F.G[0].n, 4);   // pinned points stay out of the bodies
  const h = F.S[2];
  assert.deepEqual([h.s, h.name, h.n, h.hull.length], [3, 'hips', 3, 3]);   // the occluded member is not in it
  near(h.c[0], 0.3); near(h.c[1], 0.35);
  assert.equal(F.S[1].n, 1); assert.equal(F.S[0], null);
  assert.equal(semAt(F, 0.3, 0.35), 3); assert.equal(semAt(F, 0.7, 0.7), 0, 'one point: no hull'); assert.equal(semAt(F, 0.45, 0.15), 0);
  const pi = pointInfo(fr, 0, 4);
  assert.deepEqual([pi.sem, pi.extra], [3, []]);
  assert.deepEqual(pointInfo(fr, 0, 9).extra, [0.5]);
  const ch = (v) => channelOf([[0, v]]);
  const r = { name: 'r', params: {}, samples: series([[0, 0.5]]), scenes: [{ start_ms: 0, end_ms: 100, groups: { sem_hips: { label: 'hips', source: 'cam' } } }],
    channels: { sem_hips_n: ch(0.03), sem_hips_proj: ch(0.6), sem_hips_scale: ch(-0.01), sem_hips_rel: ch(0.2), sem_hips_x: ch(0.3) } };
  const rows = hudRows({ run: r, t: 0, hover: { s: 3 }, sem: h }), by = Object.fromEntries(rows.map((x) => [x.k, x.v]));
  assert.equal(by['hips (seeded)'], '3 pts');
  assert.deepEqual([by.sem_hips_proj, by.sem_hips_scale, by.sem_hips_n], ['0.600', '-0.010', '3.0 %']);
  assert.ok(!rows.some((x) => x.k === 'other'), 'sem channels are not "other"');
  assert.equal(Object.fromEntries(hudRows({ run: r, t: 0, hover: { j: 4 }, point: pi }).map((x) => [x.k, x.v]))['point 4'], 'hips (seeded)');
  // drawing: the hull dash-dot with its label; no generic ring for pts[5]; the 7th element still rings
  const texts = [], arcs = [], dashes = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'fillText' ? (t) => texts.push(t) : k === 'arc' ? (...a) => arcs.push(a) : k === 'setLineDash' ? (d) => dashes.push(d.join(',')) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const opts = { ...blobOpts((k, d) => d), hulls: true, points: false, extra: true, axis: false, camera: false, trails: false };
  assert.equal(opts.seeded, true, 'seeded groups on by default');
  const draw = (o) => drawBlobsView(ctx, { map: (x, y) => [x * 100, y * 100] }, fr, 0, { colors: ['#1FC3FA', 'b', 'c', 'd', 'e'], ink: { text: 'w', axis: 'o', pair: 'p', grid: 'g' }, opts: o, run: r, aspect: 1 });
  draw(opts);
  assert.ok(texts.includes('hips') && texts.includes('balls'), texts.join('|'));   // short labels by default
  assert.ok(dashes.includes('7,3,2,3'), 'dash-dot outline');
  assert.equal(arcs.filter((a) => a[2] >= 3 && pts.slice(4, 9).some((p) => a[0] === p[0] * 100 && a[1] === p[1] * 100)).length, 0, 'no generic ring for pts[5]');
  assert.ok(arcs.some((a) => a[0] === 80 && a[1] === 80 && a[2] === 5));
  texts.length = 0; dashes.length = 0;
  draw({ ...opts, seeded: false });
  assert.ok(!texts.some((t) => t.startsWith('hips')) && !dashes.includes('7,3,2,3'), 'toggle off: not drawn');
});

// a rigid body (g1, 30 points, part 1 = its top-right 2 x 2) and pinned hips (10 points) translating on their own; the
// left two columns of each hidden on frames 10..19 (a thumb behind a shaft), and one part member
const rigid = () => {
  const T = 40, t = [], ov = [], truth = { g1: [], p1: [], hips: [] };
  const body = [], hips = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) body.push([0.2 + c * 0.03, 0.3 + r * 0.03, c, r]);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) hips.push([0.6 + c * 0.03, 0.6 + r * 0.03, c, r]);
  const mean = (a) => [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
  const inPart = (b) => b[2] >= 4 && b[3] <= 1;
  for (let f = 0; f < T; f++) {
    t.push(f * 40);
    const bx = 0.05 * Math.sin(f / 4), by = 0.02 * Math.cos(f / 4), hx = 0.03 * Math.cos(f / 3), hy = 0.04 * Math.sin(f / 3), hide = f >= 10 && f < 20;
    const B = body.map((b) => [b[0] + bx, b[1] + by, hide && (b[2] < 2 || (b[2] === 5 && b[3] === 0)) ? 0 : 1, 1, ...(inPart(b) ? [1] : [])]);
    const H = hips.map((b) => [b[0] + hx, b[1] + hy, hide && b[2] < 2 ? 0 : 1, -1, 0, 3]);
    ov.push({ pts: [...B, ...H] });
    truth.g1.push(mean(B)); truth.p1.push(mean(B.filter((p) => p[4] === 1))); truth.hips.push(mean(H));
  }
  return { fr: { t, v: new Array(T).fill(0), ov }, truth };
};

test('anchored centres (pts): a body / part / pinned group whose points drop out does not move; the hull centroid would', () => {
  const { fr, truth } = rigid(), P = ptsCentres(fr);
  assert.equal(ptsCentres(fr), P);   // cached
  for (const [k, tr] of [[0, truth.g1], [4, truth.p1], [14, truth.hips]]) {
    for (let f = 0; f < fr.t.length; f++) { near(P.x[k][f], tr[f][0], 1e-9); near(P.y[k][f], tr[f][1], 1e-9); }
  }
  const vis = fr.ov[15].pts.slice(0, 30).filter((p) => p[2]), plain = vis.reduce((s, p) => s + p[0], 0) / vis.length;
  assert.ok(plain - truth.g1[15][0] > 0.01, 'the visible-only mean jumps right while the left columns hide');
  // frameBodies draws these centres (no run: the pts anchoring), and the velocity follows the true motion through the drop
  const F = frameBodies(fr, 15, {});
  near(F.G[0].c[0], truth.g1[15][0], 1e-9); near(F.G[0].parts[0].c[1], truth.p1[15][1], 1e-9); near(F.S[2].c[0], truth.hips[15][0], 1e-9);
  near(F.G[0].vel[0], (truth.g1[15][0] - truth.g1[12][0]) / 0.12, 1e-6);
  assert.equal(anchoredPath(fr, null, 'centroid'), null);
  // live: frames grow, the path extends in place
  fr.ov.push(fr.ov[39]); fr.t.push(1600);
  assert.equal(ptsCentres(fr).x[0].length, 41);
});

test('anchored centres (run): the channel + cam wins over the pts; centroid_x / _y are image space', () => {
  const { fr } = rigid(), pairs = (f) => fr.t.map((t, i) => [t, f(i)]);
  const run = { channels: Object.fromEntries(Object.entries({
    g1_x: pairs((i) => 0.4 + i * 0.001), g1_y: pairs(() => 0.5), cam_x: pairs((i) => i * 0.002), cam_y: pairs(() => -0.1),
    centroid_x: pairs(() => 0.7), centroid_y: pairs(() => 0.2),
  }).map(([k, v]) => [k, channelOf(v)])) };
  const F = frameBodies(fr, 15, { run });
  near(F.G[0].c[0], 0.4 + 15 * 0.001 + 15 * 0.002, 1e-6); near(F.G[0].c[1], 0.4, 1e-6);   // float32 channels
  assert.notEqual(F, frameBodies(fr, 15, {}), 'cache is per run');
  const c = anchoredPath(fr, run, 'centroid');
  near(c.x[3], 0.7, 1e-6); near(c.y[3], 0.2, 1e-6);   // no cam added
  near(F.S[2].c[0], frameBodies(fr, 15, {}).S[2].c[0], 1e-12);   // no sem_hips_x channel: the pts anchoring
});

test('heatSplats: one per visible point, slot by group; brightness from density / speed / both; decimated above the cap', () => {
  const fr = { t: [0, 100], ov: [
    { pts: [[0.5, 0.5, 1, 1], [0.2, 0.2, 1, 0], [0.7, 0.7, 1, -1, 0, 3], [0.1, 0.1, 0, 2]] },
    { pts: [[0.55, 0.5, 1, 1], [0.2, 0.2, 1, 0], [0.7, 0.7, 1, -1, 0, 3], [0.1, 0.1, 0, 2]] },
  ] };
  const a = heatSplats(fr, 0), b = heatSplats(fr, 1);
  assert.deepEqual(a.map((s) => s.c).sort(), [0, 4, 8]);
  const by = (l) => Object.fromEntries(l.map((s) => [s.c, s]));
  near(by(a)[0].a, HEAT_TOP); near(by(a)[4].a, HEAT_TOP * 0.4);   // one point, no previous frame: full, the background dimmer
  assert.equal(by(a)[0].r, HEAT_R_MAX, 'one point: no spacing, the largest blob');
  near(by(b)[0].a, HEAT_TOP * (0.35 + 0.65 * Math.min(1, 0.5 / HEAT_FULL)));   // both: 0.5 h/s over the floor
  near(by(b)[4].a, HEAT_TOP * 0.4 * 0.35, 1e-12);   // still: the floor
  near(by(heatSplats(fr, 1, 1, { shows: 'density' }))[4].a, HEAT_TOP * 0.4);
  near(by(heatSplats(fr, 1, 1, { shows: 'speed' }))[4].a, HEAT_TOP * 0.4 * 0.05, 1e-12);
  assert.deepEqual([slotOf([0, 0, 1, 3]), slotOf([0, 0, 1, -1]), slotOf([0, 0, 1, -1, 0, 1])], [2, 5, 6]);
  const many = { t: [0], ov: [{ pts: Array.from({ length: 5000 }, (_, j) => [(j % 100) / 100, Math.floor(j / 100) / 50, 1, 1]) }] };
  assert.equal(heatSplats(many, 0).length, 1667);   // every 3rd
  assert.equal(heatSplats(many, 0, 1, { max: 8000 }).length, 5000);
});

test('heat radius follows the point spacing: dense grid small, sparse large, clamped; the field plateau is the same', () => {
  const grid = (n, x0, y0, w) => { const pts = []; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) pts.push([x0 + (c * w) / (n - 1), y0 + (r * w) / (n - 1), 1, 1]); return pts; };
  const one = (pts) => heatSplats({ t: [0], ov: [{ pts }] }, 0, 1)[0];
  const dense = one(grid(32, 0.2, 0.2, 0.6)), sparse = one(grid(4, 0.3, 0.3, 0.12));   // spacing 0.019 vs 0.04
  near(medianNN([0, 0.1, 0.3], [0, 0, 0]), 0.1);
  near(dense.r, 1.6 * 0.6 / 31, 1e-9); near(sparse.r, 1.6 * 0.04, 1e-9);
  assert.ok(sparse.r > dense.r);
  assert.equal(heatRadius(0.001), HEAT_R_MIN); assert.equal(heatRadius(0.2), HEAT_R_MAX); assert.equal(heatRadius(NaN), HEAT_R_MAX);
  near(heatRadius(0.02, 3), 0.06);   // Heat size = k
  near(one(grid(32, 0.2, 0.2, 0.6)).r, heatSplats({ t: [0], ov: [{ pts: grid(32, 0.2, 0.2, 0.6) }] }, 0, 1, { k: 1.6 })[0].r);
  // normalisation: ~pi r^2 / nn^2 splats over a spot add up (source-over) to HEAT_TOP for either group, never to white
  for (const s of [dense, sparse]) {
    const nn = s.r / 1.6, over = (Math.PI * s.r * s.r) / (nn * nn);
    near(1 - (1 - s.a) ** over, HEAT_TOP, 1e-9);
  }
  assert.ok(dense.a < HEAT_TOP && sparse.a < HEAT_TOP);
  const clamped = one(grid(32, 0.45, 0.45, 0.031)), nn = 0.031 / 31;   // spacing 0.001: the radius clamps at the floor
  assert.equal(clamped.r, HEAT_R_MIN);
  near(1 - (1 - clamped.a) ** ((Math.PI * HEAT_R_MIN ** 2) / nn ** 2), HEAT_TOP, 1e-9);
});

test('opacity: each layer\'s slider x the overlay\'s multiplies every alpha that layer sets', () => {
  const o = blobOpts((k, d) => d);
  assert.deepEqual(o.alpha, { other: 1, heat: 0.7, points: 0.9, seeded: 1, bodies: 1, camera: 0.8, hulls: 0.4 });
  for (const k of ['opacity', 'heatOpacity', 'pointsOpacity', 'seededOpacity', 'bodiesOpacity', 'cameraOpacity', 'hullsOpacity'])
    assert.equal(BLOB_SCHEMA.find((p) => p.key === k)?.control, 'slider', k);
  const keys = BLOB_SCHEMA.map((p) => p.key);
  for (const k of ['heat', 'points', 'seeded', 'bodies', 'camera', 'hulls']) assert.equal(keys[keys.indexOf(k) + 1], k + 'Opacity', 'the slider sits under its switch');
  const half = blobOpts((k, d) => ({ 'tracking.blobs.opacity': 50, 'tracking.blobs.pointsOpacity': 40 })[k] ?? d);
  near(half.alpha.points, 0.2); near(half.alpha.bodies, 0.5); near(half.alpha.other, 0.5);
  // drawn: the points layer's fills at 0.9 x its opacity, the bodies' labels at their own
  const fr = frames(), log = [], ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => log.push([k, t.globalAlpha, ...a])), set: (t, k, v) => { t[k] = v; return true; } });
  drawBlobsView(ctx, { map: (x, y) => [x * 100, y * 100] }, fr, 2, { colors: ['a', 'b', 'c', 'd', 'e'], ink: { text: 'w', axis: 'o', pair: 'p', grid: 'g' }, opts: { ...half, heat: false, camera: false, axis: false, primary: false }, run: null, aspect: 1 });
  const fills = log.filter((c) => c[0] === 'fill').map((c) => c[1]);
  assert.ok(fills.some((a) => Math.abs(a - 0.9 * 0.2) < 1e-9), fills.join(','));
  const label = log.find((c) => c[0] === 'fillText' && /^g1( |$)/.test(c[2]));
  near(label[1], 0.5);
});
// a canvas stand-in that records the calls it is asked for
const recCtx = (log) => new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => log.push([k, ...a])), set: (o, k, v) => { o[k] = v; return true; } });
const ENV = { map: (x, y) => [x * 100, y * 100] }, INK = { text: 'w', axis: 'o', pair: 'p', grid: 'g' };

test('pinned parts layer: outline of the members, crosshair on the anchored centre, count label, _proj gauge', () => {
  const pts = [[0.2, 0.2, 1, -1, 0, 3], [0.4, 0.2, 1, -1, 0, 3], [0.4, 0.4, 1, -1, 0, 3], [0.2, 0.4, 1, -1, 0, 3]];
  const fr = { t: [0], v: [0], ov: [{ pts }] };
  const r = { name: 'r', params: {}, samples: series([[0, 0.5]]), channels: { sem_hips_proj: channelOf([[0, 0.75]]) } };
  const log = [], opts = { ...blobOpts((k, d) => d), heat: false, points: false, camera: false, axis: false, primary: false };
  drawBlobsView(recCtx(log), ENV, fr, 0, { colors: ['a', 'b', 'c', 'd', 'e'], ink: INK, opts, run: r, aspect: 1 });
  const F = frameBodies(fr, 0, { run: r });
  assert.equal(F.S[2].hull.length, 4);
  near(F.S[2].c[0], 0.3); near(F.S[2].c[1], 0.3);
  assert.ok(log.some((c) => c[0] === 'setLineDash' && c[1].join(',') === '7,3,2,3'), 'dash-dot outline');
  assert.ok(log.some((c) => c[0] === 'moveTo' && Math.abs(c[1] - 23) < 1e-9 && Math.abs(c[2] - 30) < 1e-9), 'crosshair at the anchored centre');
  assert.ok(log.some((c) => c[0] === 'fillText' && c[1] === 'hips'));
  const bar = log.find((c) => c[0] === 'fillRect' && c[3] === 5);   // (the first one is its dark backing)
  near(bar[4], 26 * 0.75);   // the gauge's fill = _proj
});

test('primary / camera: the picked source on the picture, the camera arrow and kind', () => {
  assert.deepEqual(primaryTarget('g3_proj'), { kind: 'cloud' });   // paw-57dw: no motion-group primaries
  assert.deepEqual(primaryTarget('sem_hips_proj'), { kind: 'sem', s: 3 });
  assert.deepEqual(primaryTarget('sem_balls_area'), { kind: 'sem', s: 2 });
  assert.deepEqual([primaryTarget('dist01').kind, primaryTarget('p1_y').kind, primaryTarget('proj_cam').kind], ['clicks', 'clicks', 'cloud']);
  const cam = { scenes: [{ start_ms: 0, end_ms: 300, camera: [{ t0: 0, t1: 300, kind: 'pan', dir: 'left', amount: 0.1 }] }],
    channels: { cam_x: channelOf([[0, 0], [100, 0.01], [200, 0.02]]), cam_y: channelOf([[0, 0], [100, 0], [200, 0]]), cam_conf: channelOf([[0, 0.8], [100, 0.8], [200, 0.8]]) } };
  const c = cameraAt(cam, 200);
  assert.equal(c.kind, 'pan left');
  near(c.vx, 0.02 / 0.15, 1e-6); near(c.vy, 0); near(c.conf, 0.8, 1e-6);
  assert.equal(cameraAt({ channels: {} }, 0), null);
  assert.equal(cameraAt({ scenes: cam.scenes, channels: {} }, 50).kind, 'pan left', 'the kind alone (no camera path)');
});

test('points layer: dots per group, a ring on pinned members and on just-lost points; hover readout has the speed', () => {
  const fr = frames(), log = [];
  const opts = { ...blobOpts((k, d) => d), heat: false, bodies: false, trails: false, axis: false, camera: false, primary: false, seeded: false, extra: false };
  drawBlobsView(recCtx(log), ENV, fr, 1, { colors: ['a', 'b', 'c', 'd', 'e'], ink: INK, opts, run: null, aspect: 1 });
  const arcs = log.filter((c) => c[0] === 'arc');
  assert.equal(arcs.filter((a) => a[3] === 1.8).length, 5, 'the 5 visible points');
  assert.deepEqual(arcs.filter((a) => a[3] === 3.5).map((a) => [a[1], a[2]]), [[90, 10]], 'point 4 went occluded on this frame: hollow');
  const pi = pointInfo(fr, 2, 0, -Infinity, Infinity, 1);
  near(pi.speed, 0.01 / 0.034, 1e-9);
  assert.equal(pointInfo(fr, 2, 4).speed !== pointInfo(fr, 2, 4).speed, true, 'occluded on the previous frame: NaN');
  assert.equal(Object.fromEntries(hudRows({ run: run(), t: 67, hover: { j: 0 }, point: pi }).map((x) => [x.k, x.v])).speed, `${(0.01 / 0.034).toFixed(2)} h/s`);
});

test('paw-9qim: a pinned group is drawn as its painting carried by its points (similarity), not their shrinking hull', () => {
  const asp = 16 / 9, poly = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]];
  // members seeded inside the painting with an inset (their hull is about a third of it); then the part turns 0.3 rad,
  // grows 1.2 x and moves; two members are lost and one slid onto the background (an outlier)
  const seed = [[0.45, 0.45], [0.55, 0.45], [0.55, 0.55], [0.45, 0.55], [0.5, 0.5], [0.47, 0.52], [0.53, 0.48]];
  const th = 0.3, s = 1.2, move = ([x, y]) => { const p = (x - 0.5) * asp, q = y - 0.5; return [(s * (Math.cos(th) * p - Math.sin(th) * q)) / asp + 0.55, s * (Math.sin(th) * p + Math.cos(th) * q) + 0.52]; };
  const now = seed.map(move);
  now[6] = [0.9, 0.1];
  const pt = (p, v = 1) => [p[0], p[1], v, 1, 0, 4];
  const fr = { t: [0, 40, 80], v: [0, 0, 0], ov: [{ pts: seed.map((p) => pt(p)) }, { pts: seed.map((p) => pt(p)) }, { pts: now.map((p, j) => pt(p, j === 0 || j === 1 ? 0 : 1)) }] };
  const want = poly.map(move), got = carriedPoly(fr, 2, 4, poly, 0, asp);
  got.forEach((p, k) => { near(p[0], want[k][0], 1e-3); near(p[1], want[k][1], 1e-3); });
  near(polyArea(got) / polyArea(poly), s * s, 1e-3);   // the painted size times the part's own growth, whatever the points left
  assert.equal(carriedPoly(fr, 2, 4, poly, 500, asp), null, 'no run frame at the seed time: no outline');
  assert.equal(carriedPoly(fr, 2, 5, poly, 0, asp), null, 'no members: no outline');
  const run = { scenes: [{ start_ms: 0, end_ms: 120, groups: { sem_c1_hips: { label: 'c1_hips', source: 'user', id: 4 } } }] };
  const F = frameBodies(fr, 2, { run, paint: [{ name: 'c1_hips', poly, t_ms: 0 }], aspect: asp });
  near(polyArea(F.S[3].outline), polyArea(got));   // the carried painting (the hull would hold the slid point)
  assert.equal(semAt(F, ...move([0.41, 0.41])), 4, 'its outline is its hit area');
  assert.equal(frameBodies(fr, 2, { run }).S[3].outline, undefined, 'no painting: the hull as before');
});
