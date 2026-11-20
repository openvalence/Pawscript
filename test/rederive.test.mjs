// src/lib/rederive.js: a finished run's projected channels recomputed from its stored centres / camera / point tracks (paw-a3n).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveChannels, deriveClean, deriveBlock, cameraPath, strokeProj, cameraAtT, hasPts } from '../src/lib/rederive.js';
import { channelOf } from '../src/lib/runs.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/rederive-run.json', import.meta.url)));
const runOf = (variant) => ({ id: 'run1', params: fx[variant].params, scenes: fx.scenes, frames: null,
  channels: Object.fromEntries(Object.entries(fx[variant].channels).map(([k, v]) => [k, channelOf(v)])) });
function close(a, b, tol, what) {
  assert.equal(a.length, b.length, what);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i] === a[i], b[i] === b[i], `${what}[${i}] gap ${a[i]} vs ${b[i]}`);
    if (a[i] === a[i]) assert.ok(Math.abs(a[i] - b[i]) <= tol, `${what}[${i}] ${a[i]} vs ${b[i]}`);
  }
}

test('parity: re-derived with the tracked options = the sidecar channels (auto and custom axis, gaps bridged / kept)', () => {
  for (const variant of ['auto', 'custom']) {
    const run = runOf(variant), { channels, changed } = deriveChannels(run, [], { aspect: fx.aspect, force: true });
    const names = ['proj', 'proj_cam', 'g1_proj', 'g2_proj', 'sem_hips_proj', ...(variant === 'custom' ? ['pair_proj'] : [])];
    for (const k of names) { assert.ok(changed.includes(k), `${variant} ${k} recomputed`); close(channels[k].v, run.channels[k].v, 2e-4, `${variant} ${k}`); }
  }
});

test('no derive anywhere: the stored channels, untouched', () => {
  const run = runOf('auto'), r = deriveChannels(run, [null, null], { aspect: fx.aspect });
  assert.equal(r.channels, run.channels);
  assert.deepEqual(r.changed, []);
});

test('a derive on one scene changes only that scene', () => {
  const run = runOf('auto'), { channels } = deriveChannels(run, [null, { axis: { mode: 'horizontal' } }], { aspect: fx.aspect });
  const t = run.channels.proj.t;
  let diff1 = 0;
  for (let j = 0; j < t.length; j++) {
    const a = channels.proj.v[j], b = run.channels.proj.v[j];
    if (t[j] < 8000) assert.ok(a === b || (a !== a && b !== b));
    else if (Math.abs(a - b) > 1e-3) diff1++;
  }
  assert.ok(diff1 > 10);
});

// a centroid moving x = sin, y = a slower sin: the axes read each one
function wobble(n = 300) {
  const t = [], x = [], y = [], z = [];
  for (let i = 0; i < n; i++) { const ms = Math.round((i * 1000) / 30); t.push([ms, null]); x.push([ms, 0.5 + 0.1 * Math.sin(ms / 200)]); y.push([ms, 0.5 + 0.05 * Math.sin(ms / 700)]); z.push([ms, 0]); }
  return { id: 'w', params: { axis: 'auto' }, scenes: [], frames: null,
    channels: { centroid_x: channelOf(x), centroid_y: channelOf(y), cam_x: channelOf(z), cam_y: channelOf(z), proj: channelOf(t), proj_cam: channelOf(t) } };
}
const norm = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return a.map((v) => (v - lo) / (hi - lo)); };

test('axis: horizontal reads x, vertical reads -y; a custom arrow turned 90° swaps them', () => {
  const run = wobble(), a = 16 / 9, xs = norm(Array.from(run.channels.centroid_x.v)), ys = norm(Array.from(run.channels.centroid_y.v, (v) => -v));
  const at = (axis) => deriveChannels(run, Object.assign([], { [-1]: { axis } }), { aspect: a }).channels.proj.v;
  close(at({ mode: 'horizontal' }), xs, 1e-4, 'horizontal');
  close(at({ mode: 'vertical' }), ys, 1e-4, 'vertical');
  // out end on the right, in end on the left: toward the left = lower = horizontal; turned 90°: out on top, in below = vertical
  close(at({ mode: 'custom', x0: 0.7, y0: 0.5, x1: 0.3, y1: 0.5 }), xs, 1e-4, 'custom 0°');
  close(at({ mode: 'custom', x0: 0.5, y0: 0.3, x1: 0.5, y1: 0.7 }), ys, 1e-4, 'custom 90°');
  // the arrow reversed: the signal mirrors
  close(at({ mode: 'custom', x0: 0.3, y0: 0.5, x1: 0.7, y1: 0.5 }), xs.map((v) => 1 - v), 1e-4, 'custom 180°');
});

test('camera strength: 0 = the image centroid (raw), 100 = the sidecar camera removed (proj_cam as tracked)', () => {
  const run = runOf('auto'), a = fx.aspect;
  const s0 = deriveChannels(run, [{ cam: { mode: 'auto', strength: 0 } }, null], { aspect: a }).channels;
  const s100 = deriveChannels(run, [{ cam: { mode: 'auto', strength: 100, smoothMs: 0 } }, null], { aspect: a });
  const raw = deriveChannels(run, [], { aspect: a, force: true }).channels;
  const sc0 = (c) => Array.from(c.v).slice(0, 240);
  close(sc0(s0.proj), sc0(raw.proj), 2e-4, 'strength 0 = raw proj');
  // the default derive is dropped by deriveClean: strength 100 / auto is "as tracked"
  assert.equal(deriveClean({ cam: { mode: 'auto', strength: 100 } }), null);
  const s50 = deriveChannels(run, [{ cam: { mode: 'auto', strength: 50 } }, null], { aspect: a }).channels;
  const full = deriveChannels(run, [{ cam: { mode: 'auto', strength: 100, source: 'all' } }, null], { aspect: a }).channels;   // an override with full removal
  close(sc0(full.proj), sc0(run.channels.proj_cam), 2e-4, 'strength 100 = proj_cam');
  close(sc0(full.proj_cam), sc0(run.channels.proj_cam), 2e-4, 'override: proj = proj_cam');
  close(sc0(full.g1_proj), sc0(run.channels.g1_proj), 2e-4, 'strength 100: groups as tracked');
  assert.ok(sc0(s50.proj).some((v, i) => Math.abs(v - sc0(full.proj)[i]) > 1e-3 && Math.abs(v - sc0(s0.proj)[i]) > 1e-3), 'half way differs from both');
});

// a zoom about the frame centre over a fixed background grid; the body strokes in the world
function zoomRun(n = 240) {
  const a = 16 / 9, cx = 0.5, cy = 0.5, t = [], C = [[], []], z = [], world = [], frames = { t: [], v: [], ov: [] };
  const bg = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) bg.push([0.1 + 0.08 * i, 0.15 + 0.1 * j]);
  for (let i = 0; i < n; i++) {
    const ms = Math.round((i * 1000) / 30), s = 1 + (0.4 * i) / n, w = [0.55, 0.5 + 0.04 * Math.sin(ms / 150)];
    const img = ([x, y]) => [cx + s * (x - cx), cy + s * (y - cy)];
    const b = img(w);
    t.push(ms); C[0].push([ms, b[0]]); C[1].push([ms, b[1]]); z.push([ms, 0]); world.push(w);
    frames.t.push(ms); frames.v.push(NaN); frames.ov.push({ pts: [...bg.map((p) => [...img(p), 1, 0]), [...b, 1, 1]] });
  }
  return { a, world, run: { id: 'z', params: { axis: 'vertical' }, scenes: [], frames,
    channels: { centroid_x: channelOf(C[0]), centroid_y: channelOf(C[1]), cam_x: channelOf(z), cam_y: channelOf(z), proj: channelOf(z), proj_cam: channelOf(z) } } };
}
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };

test('zoom removal: the background grid gives the scale; the body comes back to its world stroke', () => {
  const { a, world, run } = zoomRun();
  assert.ok(hasPts(run));
  const idx = run.channels.centroid_x.t.map((_, j) => j);
  const path = cameraPath(run, Array.from(idx), { mode: 'zoom' }, a);
  assert.ok(Math.abs(path.s[path.s.length - 1] - (1 + (0.4 * 239) / 240)) < 1e-3, 'scale recovered');
  const want = Array.from(strokeProj(run.channels.centroid_x.t, world.map((w) => w[0] * a), world.map((w) => w[1]), [0, -1]));
  const zoomed = Array.from(deriveChannels(run, Object.assign([], { [-1]: { cam: { mode: 'zoom' } } }), { aspect: a }).channels.proj_cam.v);
  const plain = Array.from(deriveChannels(run, Object.assign([], { [-1]: { cam: { mode: 'move' } } }), { aspect: a }).channels.proj_cam.v);
  assert.ok(corr(zoomed, want) > 0.999, 'zoom removed: ' + corr(zoomed, want));
  assert.ok(corr(plain, want) < corr(zoomed, want), 'translation only is worse');
  close(zoomed, want, 1e-3, 'zoom-removed stroke');
  // half strength: the scale is the square root
  assert.ok(Math.abs(cameraPath(run, Array.from(idx), { mode: 'zoom', strength: 50 }, a).s[239] - Math.sqrt(path.s[239])) < 1e-9);
  // the stabilised preview's camera at t
  const c = cameraAtT(run, { cam: { mode: 'zoom' } }, run.channels.centroid_x.t[239], a);
  assert.ok(Math.abs(c.s - path.s[239]) < 1e-9 && Math.abs(c.th) < 1e-9);
});

test('smoothing: the camera path is a moving average before removal', () => {
  const { a, run } = zoomRun();
  const idx = Array.from(run.channels.centroid_x.t, (_, j) => j);
  const p0 = cameraPath(run, idx, { mode: 'zoom' }, a), p1 = cameraPath(run, idx, { mode: 'zoom', smoothMs: 1000 }, a);
  assert.ok(Math.abs(p1.s[120] - p0.s[120]) < 1e-3, 'a linear zoom passes the average');
  assert.ok(p1.s[0] > p0.s[0], 'the edge averages forward');
});

test('old runs say why they cannot be re-derived (re-track)', () => {
  assert.match(deriveBlock({ restored: true, channels: {} }), /re-track/);
  assert.match(deriveBlock({ channels: { proj: channelOf([[0, 1]]) } }), /re-track/);
  assert.match(deriveBlock(runOf('auto'), { needPts: true }), /re-track/);
  assert.equal(deriveBlock(runOf('auto')), '');
  const r = deriveChannels({ restored: true, channels: runOf('auto').channels }, [{ axis: { mode: 'vertical' } }], {});
  assert.deepEqual(r.changed, []);
});

test('deriveClean keeps the overrides only, valid values', () => {
  assert.equal(deriveClean(null), null);
  assert.equal(deriveClean({ cam: { mode: 'auto' } }), null);
  assert.deepEqual(deriveClean({ cam: { mode: 'zoom', strength: 140 } }), { cam: { mode: 'zoom', strength: 100, source: 'background', smoothMs: 0 } });
  assert.deepEqual(deriveClean({ axis: { mode: 'custom', x0: 0.1, y0: 0.2, x1: 0.1, y1: 0.2 } }), null);
  assert.deepEqual(deriveClean({ axis: { mode: 'vertical' }, cam: { strength: 40 } }), { axis: { mode: 'vertical' }, cam: { mode: 'auto', strength: 40, source: 'background', smoothMs: 0 } });
});

test('channelPatch: a shot derive re-derives that run scene from the sidecar pick\'s channel; the stored channels stay', async () => {
  const { channelPatch } = await import('../src/lib/runs-channel.js');
  const { runDerives } = await import('../src/lib/rederive.js');
  const run = { ...runOf('auto'), range: { start: 0, end: 14000 }, channel: 'primary', notes: [{ code: 'primary', scene_index: 0, data: { chosen: 'proj' } }, { code: 'primary', scene_index: 1, data: { chosen: 'proj' } }],
    points0Primary: { at: Float64Array.from([0, 7000, 9000, 13000]), pos: Float64Array.from([0, 100, 0, 100]) } };
  run.points0 = run.points0Primary;
  const shots = [{ start_ms: 0, end_ms: 8000, derive: { axis: { mode: 'horizontal' } } }, { start_ms: 8000, end_ms: 14000 }];
  const dv = runDerives(run, shots);
  assert.equal(dv.length, 2); assert.ok(dv[0].axis && !dv[1].axis && dv[1].detail, 'scene 2: no derive, only the Detail over its time');
  const p = channelPatch(run, 'primary', {}, [], { aspect: fx.aspect, derives: dv });
  assert.equal(p.channels, undefined, 'derived channels are never handed back as the run\'s channels');
  assert.deepEqual(p.sceneChannels, ['primary', 'primary']);
  const s1 = [...p.points0.at].filter((t) => t >= 8000);
  assert.deepEqual(s1, [9000, 13000], 'scene 2 keeps the sidecar points');
  assert.ok([...p.points0.at].filter((t) => t < 8000).length > 6, 'scene 1 points from the re-derived proj');
  assert.ok(p.lane, 'the lane draws the re-derived trace');
  const none = channelPatch(run, 'primary', {}, [], { aspect: fx.aspect, derives: runDerives(run, [{ start_ms: 0, end_ms: 14000 }]) });
  assert.equal(none.points0, run.points0Primary);
  // a drag preview wins over the stored shot derive
  const pv = runDerives(run, shots, { t0: 0, t1: 8000, derive: null });
  assert.deepEqual(pv.map((d) => Object.keys(d)), [['detail'], ['detail']]);
});

test('stabilised preview matrix: translation = shifted; a zoom is taken out about the frame centre', async () => {
  const { stabilised, shifted, apply } = await import('../src/features/video/view.js');
  const m = { a: 0.5, b: 0, c: 0, d: 0.5, e: 10, f: 20, s: 0.5 };
  assert.deepEqual(stabilised(m, { x: 0.1, y: -0.05 }, 1920, 1080), shifted(m, -192, 54));
  assert.equal(stabilised(m, null, 1920, 1080), m);
  // camera zoomed 2x about the centre and moved right 0.1: a picture point P shows at c + 2 (P - c) + d; the stabilised
  // matrix maps that image point back to where P was
  const st = { x: 0.1, y: 0, s: 2, th: 0.3 }, W = 1920, H = 1080, P = [700, 300], c = [W / 2, H / 2];
  const co = Math.cos(0.3), si = Math.sin(0.3), q = [P[0] - c[0], P[1] - c[1]];
  const img = [c[0] + 2 * (co * q[0] - si * q[1]) + 0.1 * W, c[1] + 2 * (si * q[0] + co * q[1])];
  const a = apply(stabilised(m, st, W, H), ...img), b = apply(m, ...P);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6, `${a} vs ${b}`);
});

test('paw-woz5: a shot\'s compress range and its two handles are kept, clamped', () => {
  assert.deepEqual(deriveClean({ strokes: { range: 'compress', amount: 2, centreMs: 50 } }).strokes, { range: 'compress', amount: 0.9, centreMs: 1000 });
  assert.deepEqual(deriveClean({ strokes: { range: 'squash', amount: 0.5 } }).strokes, { amount: 0.5 });
});
