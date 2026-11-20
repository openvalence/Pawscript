// The .pawruns codec (src/lib/runs-file.js): round trips of a grid run, a sam2 run (masks omitted), a run without frames,
// corrupt files, and the size of a 256-point x 1800-frame grid run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRun, newFrames, appendFrames } from '../src/lib/runs.js';
import { encodeRuns, decodeRuns, runsPath, RunsFileError } from '../src/lib/runs-file.js';

const r4 = (x) => Math.round(x * 1e4) / 1e4 || 0;   // no -0: the file has none either
const close = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)) || (a !== a && b !== b), `${a} vs ${b}`);

/** A grid frame as cotracker_points.py emits it: pts + the points / boxes derived from them. */
function gridOverlay(np, i) {
  const pts = Array.from({ length: np }, (_, j) => {
    const x = r4((j % 16) / 16 + 0.01 * Math.sin(i / 7 + j)), y = r4(Math.floor(j / 16) / 16 + 0.01 * Math.cos(i / 5 + j));
    return [x, y, (i + j) % 9 ? 1 : 0, (j % 6) - 1];
  });
  return {
    points: pts.filter((p) => p[2]).map((p) => [p[0], p[1]]),
    boxes: pts.filter((p) => !p[2]).map((p) => [r4(p[0] - 0.006), r4(p[1] - 0.006), 0.012, 0.012]),
    pts,
  };
}
function gridRun(np = 64, nf = 120) {
  const frames = newFrames(), samples = [], g1 = [];
  appendFrames(frames, Array.from({ length: nf }, (_, i) => ({ t_ms: Math.round(i * 1000 / 30), value: i % 50 === 7 ? null : (i % 30) / 30, overlay: gridOverlay(np, i) })));
  for (let i = 0; i < nf; i++) { const t = Math.round(i * 1000 / 30); samples.push([t, i === 7 ? null : 0.5 + 0.4 * Math.sin(i / 4)]); g1.push([t, 0.123456789 * i]); }
  const run = makeRun({ n: 4, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { box_seed: 'grid', box_points: np }, range: { start: 0, end: 4000 },
    roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 }, frames, runs: [],
    result: { samples, points: [{ at: 0, pos: 10 }, { at: 500, pos: 90.5 }], scenes: [{ start_ms: 0, end_ms: 4000, sign: -1 }], channels: { g1_proj: g1, raw_px: samples },
      confidence: samples, events: [{ kind: 'knot', t_ms: 100 }], notes: [{ code: 'held_input', message: 'x' }] } });
  run.flips = [0]; run.points = { at: Float64Array.of(0, 500), pos: Float64Array.of(90, 9.5) };
  run.points0Primary = run.points0;
  run.cameraMotion = { flag: false, score: 0.2, together: 0.1, n: 30, refId: 'run1' };
  run.lowMotion = { px: 12.5, low: false, source: 'raw_px' };
  run.sceneChannels = ['g1_proj']; run.channel = 'g1_proj'; run.lane = { t: Float64Array.of(1), v: Float32Array.of(1) };
  return run;
}

test('grid run: frames (pts with labels, derived points / boxes), signals, points and metadata round-trip', () => {
  const run = gridRun();
  const [back] = decodeRuns(encodeRuns([run]));
  for (const k of ['id', 'n', 'color', 'visible', 'tracker', 'name', 'params', 'range', 'roi', 'scenes', 'flips', 'channel', 'sceneChannels', 'events', 'notes', 'cameraMotion', 'lowMotion'])
    assert.deepEqual(back[k], run[k], k);
  assert.equal(back.lane, undefined);   // derived: the store recomposes it
  assert.deepEqual(back.frames.t, run.frames.t);
  back.frames.v.forEach((v, i) => close(v, run.frames.v[i]));
  assert.deepEqual(back.frames.ov, run.frames.ov);   // pts exact at 4 dp; points / boxes rebuilt from pts
  assert.ok(back.samples.t instanceof Float64Array && back.samples.v instanceof Float32Array);
  assert.deepEqual(back.samples.t, run.samples.t);
  back.samples.v.forEach((v, i) => close(v, run.samples.v[i]));
  assert.ok(Number.isNaN(back.samples.v[7]));
  close(back.channels.g1_proj.max, run.channels.g1_proj.max);
  back.channels.g1_proj.scaled.forEach((v, i) => close(v, run.channels.g1_proj.scaled[i]));
  assert.equal(back.confidence.t.length, run.confidence.t.length);
  assert.ok(back.points.at instanceof Float64Array);
  assert.deepEqual([...back.points.pos], [90, 9.5]);
  assert.deepEqual([...back.points0.pos], [10, 90.5]);
  assert.equal(back.points0Primary, back.points0);   // same object, as before
});

test('sam2 run: masks are omitted (counted), boxes and points kept; a run without frames; an empty list', () => {
  const frames = newFrames();
  appendFrames(frames, [
    { t_ms: 0, value: 0.5, overlay: { points: [], boxes: [[0.1, 0.2, 0.3, 0.4]], masks: [[[0.1, 0.2], [0.3, 0.2], [0.2, 0.5]]] } },
    { t_ms: 33, value: null, overlay: null },
    { t_ms: 67, value: 0.25, overlay: { points: [[0.5, 0.5]], boxes: [] } },
  ]);
  const sam = makeRun({ n: 1, tracker: { id: 'sam2_mask', name: 'SAM2' }, params: {}, range: { start: 0, end: 100 }, roi: { kind: 'box', x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, frames, runs: [], result: { samples: [[0, 0.5]], points: [] } });
  const bare = { ...makeRun({ n: 2, tracker: { id: 'lk_box', name: 'LK' }, params: {}, range: { start: 0, end: 10 }, roi: null, frames: null, runs: [], result: { points: [{ at: 1, pos: 2 }] } }), restored: true, tag: 'camera' };
  const [a, b] = decodeRuns(encodeRuns([sam, bare]));
  assert.equal(a.masksOmitted, 1);
  assert.deepEqual(a.frames.ov, [{ points: [], boxes: [[0.1, 0.2, 0.3, 0.4]] }, null, { points: [[0.5, 0.5]], boxes: [] }]);
  assert.ok(Number.isNaN(a.frames.v[1]));
  assert.equal(b.frames, null);
  assert.equal(b.restored, true); assert.equal(b.tag, 'camera');
  assert.deepEqual([...b.points.at], [1]);
  assert.deepEqual(decodeRuns(encodeRuns([])), []);
});

test('non-derivable grid overlays keep their points / boxes verbatim', () => {
  const frames = newFrames();
  appendFrames(frames, [{ t_ms: 5, value: 1, overlay: { points: [[0.9, 0.9]], boxes: [], pts: [[0.1, 0.2, 1, 3], [0.3, 0.4, 0, -1]], extra: 'k' } },
    { t_ms: 10, value: 1, overlay: { pts: [[0.5, 0.5, 1]] } }]);
  const run = makeRun({ n: 1, tracker: { id: 'x', name: 'x' }, params: {}, range: { start: 0, end: 10 }, roi: null, frames, runs: [], result: { points: [] } });
  assert.deepEqual(decodeRuns(encodeRuns([run]))[0].frames.ov, frames.ov);
});

test('corrupt or foreign bytes throw a RunsFileError (code corrupt)', () => {
  const good = encodeRuns([gridRun(8, 10)]);
  const bads = [new Uint8Array(0), new TextEncoder().encode('{"format":"pawruns"}'), good.slice(0, 20), good.slice(0, good.length - 3),
    (() => { const b = good.slice(); b[14] = 0xff; return b; })(),
    (() => { const b = good.slice(); new DataView(b.buffer).setUint32(8, 1e9, true); return b; })()];
  for (const b of bads) assert.throws(() => decodeRuns(b), (e) => e instanceof RunsFileError && e.code === 'corrupt', String(b.length));
  const head = new TextEncoder().encode(JSON.stringify({ format: 'pawruns', version: 99, runs: [] }));
  const newer = new Uint8Array(12 + head.length); newer.set(new TextEncoder().encode('PAWRUNS1')); new DataView(newer.buffer).setUint32(8, head.length, true); newer.set(head, 12);
  assert.throws(() => decodeRuns(newer), /newer/);
  assert.equal(decodeRuns(good.buffer.slice(0)).length, 1);   // an ArrayBuffer (what invoke returns) works too
});

test('size: 256 points x 1800 frames is about 2.8 MB', () => {
  const run = gridRun(256, 1800);
  const t = Date.now(), bytes = encodeRuns([run]), back = decodeRuns(bytes), ms = Date.now() - t;
  assert.ok(bytes.length > 2.7e6 && bytes.length < 3.3e6, `${bytes.length} bytes`);
  assert.equal(back[0].frames.ov[1799].pts.length, 256);
  console.log(`# 256 x 1800 grid run: ${(bytes.length / 1e6).toFixed(2)} MB, encode + decode ${ms} ms`);
});

test('runsPath: same stem as the project', () => {
  assert.equal(runsPath('C:/v/clip.pawproj'), 'C:/v/clip.pawruns');
  assert.equal(runsPath('C:\\a.b\\show.v2.pawproj'), 'C:\\a.b\\show.v2.pawruns');
});

test('part and pinned group ids (pts[4], pts[5]) round-trip; a reader that predates them still loads the file (paw-u4q)', () => {
  const manifest = (b) => { const n = new DataView(b.buffer, b.byteOffset).getUint32(8, true); return [JSON.parse(new TextDecoder().decode(b.subarray(12, 12 + n))), b.subarray(12 + n)]; };
  const run = gridRun(32, 20);
  for (const ov of run.frames.ov) ov.pts = ov.pts.map((q, j) => (j % 5 === 0 ? [...q, 0, 1 + (j % 3)] : j % 7 === 0 ? [...q, 2] : q));
  const bytes = encodeRuns([run]);
  assert.deepEqual(decodeRuns(bytes)[0].frames.ov, run.frames.ov);
  // what an older reader sees: the manifest without the ext key (it ignores unknown keys) -> the frames as before
  const [man, blob] = manifest(bytes);
  assert.equal(man.version, 1);
  assert.equal(man.runs[0].frames.ext.len, 2 * 32 * 20);
  delete man.runs[0].frames.ext;
  const json = new TextEncoder().encode(JSON.stringify(man)), out = new Uint8Array(12 + json.length + blob.length);
  out.set(bytes.subarray(0, 8)); new DataView(out.buffer).setUint32(8, json.length, true); out.set(json, 12); out.set(blob, 12 + json.length);
  const [plain] = decodeRuns(out);
  assert.deepEqual(plain.frames.ov[3].pts, run.frames.ov[3].pts.map((q) => q.slice(0, 4)));
  // a run without ids writes no extra section
  assert.equal(manifest(encodeRuns([gridRun(8, 4)]))[0].runs[0].frames.ext, undefined);
});

test('paw-o60v.3: kept encodings (per run, per frames, from the file read) give the bytes of an encode from scratch; an unchanged file is not encoded again', async () => {
  const { encodeRunsAsync } = await import('../src/lib/runs-file.js');
  const eq = (a, b, m) => assert.ok(a.length === b.length && a.every((x, i) => x === b[i]), m);
  const fresh = (runs) => runs.map((r) => ({ ...r, frames: r.frames && { ...r.frames } }));   // new objects: nothing kept applies
  const one = (n, ovs, extra = {}) => { const frames = newFrames(); appendFrames(frames, ovs.map((overlay, i) => ({ t_ms: i * 33, value: i % 3 ? i / 10 : null, overlay }))); return { ...makeRun({ n, tracker: { id: 'x', name: 'x' }, params: {}, range: { start: 0, end: 100 }, roi: null, frames, runs: [], result: { points: [] } }), ...extra }; };
  const ext = gridRun(16, 12);
  for (const ov of ext.frames.ov) ov.pts = ov.pts.map((q, j) => (j % 3 ? [...q, 1, j % 2] : q));
  const noLabel = one(2, [{ pts: [[0.1, 0.2, 1, null, 2, 1], [0.3, 0.4, 0]] }]);   // no label + a part: re-encoded as label -1
  const zeros = one(3, [{ pts: [[0.1, 0.2, 1, -1, 0, 0]] }]);                       // an ids section of zeros only: not written again
  const sam = one(4, [{ points: [], boxes: [[0.1, 0.2, 0.3, 0.4]], masks: [[[0.1, 0.2]]] }, null, {}]);
  const mod = one(5, [{ points: [], boxes: [[0.1, 0.2, 0.3, 0.4]], masks: [[[0.1, 0.2]]] }], { mod: 'fx1' });
  const runs = [gridRun(32, 40), ext, noLabel, zeros, sam, mod, { ...one(6, []), frames: null }];
  const first = encodeRuns(runs);
  eq(encodeRuns(runs), first, 'again, from the kept encodings');
  eq(encodeRuns(fresh(runs)), first, 'from scratch');
  const back = decodeRuns(first);
  eq(encodeRuns(back), encodeRuns(fresh(back)), 'a file just read: its own bytes where they re-encode the same');
  const { key } = await encodeRunsAsync(back);
  assert.equal(key.secs[0].buffer, first.buffer, 'the grid run\'s frames are the file\'s bytes, not encoded again');
  assert.ok(key.secs.some((s) => s.buffer !== first.buffer), 'the ones that would re-encode differently are encoded');
  const edited = back.map((r, i) => (i === 1 ? { ...r, flips: [0], name: 'renamed' } : r));
  const a = await encodeRunsAsync(edited, key, { budget: 0 });
  eq(a.bytes, encodeRuns(fresh(edited)), 'one run changed: sliced, same bytes');
  assert.equal((await encodeRunsAsync([...edited], a.key)).bytes, null, 'the same runs again: nothing to write');
  assert.ok((await encodeRunsAsync(edited.slice(1), a.key)).bytes, 'a run gone: written');
});
