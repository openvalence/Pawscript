import assert from 'node:assert/strict';
import { parseLine, scoreRequest, groupParams, roiAccepts, probeRequest, loopRequest, describeRequest, trackRequest, trackCuts, defaultParams, coerceParam, roiOk, createBatcher, isShapePipe } from '../src/lib/protocol.js';
import { fitRect, stepTarget, frameMsFrom } from '../src/lib/video.js';

assert.deepEqual(parseLine('{"type":"progress","done":1,"total":2}'), { type: 'progress', done: 1, total: 2 });
assert.equal(parseLine('not json').type, 'bad');
assert.equal(parseLine('{"no":"type"}').type, 'bad');
assert.equal(parseLine('42').type, 'bad');

const r = trackRequest({ video: 'v.mp4', tracker: 'x', start_ms: 10.4, end_ms: 99.6, roi: undefined, params: { a: 1 } });
assert.deepEqual(r, { cmd: 'track', video: 'v.mp4', tracker: 'x', start_ms: 10, end_ms: 100, roi: null, params: { a: 1 } });

const schema = [{ key: 'a', type: 'float', default: 0.5, min: 0, max: 1 }, { key: 'n', type: 'int', default: 3 }, { key: 'b', type: 'bool', default: true }];
assert.deepEqual(defaultParams(schema), { a: 0.5, n: 3, b: true });
assert.equal(coerceParam(schema[0], '7'), 1);
assert.equal(coerceParam(schema[0], ''), 0.5);
assert.equal(coerceParam(schema[1], '4.9'), 4);

assert.ok(roiOk('none', null));
assert.ok(!roiOk('box', null));
assert.ok(roiOk('box', { kind: 'box', x: 0, y: 0, w: 0.2, h: 0.2 }));
assert.ok(!roiOk('box', { kind: 'box', x: 0, y: 0, w: 0, h: 0.2 }));
assert.ok(!roiOk('points', { kind: 'box', x: 0, y: 0, w: 1, h: 1 }));
assert.ok(roiOk('points', { kind: 'points', points: [[0.1, 0.1]] }));

assert.ok(roiOk('box_or_points', { kind: 'box', x: 0, y: 0, w: 0.2, h: 0.2 }));
assert.ok(roiOk('box_or_points', { kind: 'points', points: [[0.1, 0.1]] }));
assert.ok(!roiOk('box_or_points', null));
assert.ok(roiAccepts('box_or_points', 'points') && !roiAccepts('box', 'points') && !roiAccepts('none', 'box'));
assert.deepEqual(probeRequest('v'), { cmd: 'probe', video: 'v' });
assert.deepEqual(loopRequest('v', 1.4, 9.6, {}), { cmd: 'loop', video: 'v', start_ms: 1, end_ms: 10, params: {} });
assert.deepEqual(describeRequest('v', 0, 5, { a: 1 }), { cmd: 'describe', video: 'v', start_ms: 0, end_ms: 5, params: { a: 1 } });
// param groups: motion first and the only open one, rest collapsed, empty groups dropped
const gp = groupParams(['primary', 'pipe_smooth_ms', 'cut_enabled', 'loop_fold', 'held_retime', 'held_input', 'loop_min_confidence', 'chunk_frames', 'retire_ms', 'gap_ms', 'sem_groups', 'group_labels'].map((key) => ({ key })));
assert.deepEqual(gp.map((g) => [g.id, g.open, g.params.map((p) => p.key)]), [['motion', true, ['held_input', 'chunk_frames']], ['reseed', false, ['retire_ms']], ['signal', false, ['primary', 'gap_ms']],
  ['shape', false, ['pipe_smooth_ms', 'loop_fold', 'held_retime', 'loop_min_confidence']], ['parts', false, ['sem_groups', 'group_labels']], ['cut', false, ['cut_enabled']]]);
assert.deepEqual(groupParams([{ key: 'a' }]).map((g) => g.id), ['motion']);
// paw-t8z: the script-shaping pipe_* (shown under Runs > Adjust > Strokes > Advanced): not the gate or invert
assert.deepEqual(['pipe_smooth_ms', 'pipe_cadence_fill', 'pipe_max_speed', 'pipe_norm_floor', 'pipe_gate', 'pipe_gate_motion', 'pipe_invert', 'loop_fold', 'held_retime'].filter(isShapePipe),
  ['pipe_smooth_ms', 'pipe_cadence_fill', 'pipe_max_speed', 'pipe_norm_floor']);
assert.deepEqual(groupParams([]), []);
assert.ok(!groupParams([{ key: 'loop_min_confidence' }, { key: 'loop_fold' }], ['loop_min_confidence']).flatMap((g) => g.params).some((p) => p.key === 'loop_min_confidence'), 'excluded keys are left out');
// v3 request shapes: spans only when present; score needs no video
const sp3 = [{ start_ms: 0, end_ms: 10, state: 'idle' }];
assert.deepEqual(trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 9, params: {}, spans: sp3 }).spans, sp3);
assert.ok(!('spans' in trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 9, params: {}, spans: [] })));
// v3.1 cuts: sent when an array (even empty), absent otherwise; trackCuts per scenes mode
assert.deepEqual(trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 9, params: {}, cuts: [] }).cuts, []);
assert.ok(!('cuts' in trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 9, params: {}, cuts: undefined })));
const SC = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000 }, { start_ms: 2000, end_ms: 3000 }, { start_ms: 3000, end_ms: 4000 }];
const hard = (...ts) => ts.map((t) => ({ t_ms: t, kind: 'hard', why: 'scene' }));
assert.deepEqual(trackCuts('document', SC, 1000, 3500), hard(2000, 3000));   // strictly inside (t0, t1): a cut at t0 is the range start
assert.deepEqual(trackCuts(undefined, SC, 0, 4000), hard(1000, 2000, 3000));
// v4.9 soft cuts: the action continues (camera split, continues) and the scene's own camera moves; hard = a real cut
const CAM = [{ start_ms: 0, end_ms: 3000, camera: [{ t0: 0, t1: 1000, kind: 'static' }, { t0: 1000, t1: 2000, kind: 'reciprocal' }, { t0: 2000, t1: 2600, kind: 'pan' }, { t0: 2600, t1: 3000, kind: 'static' }] },
  { start_ms: 3000, end_ms: 4000, split: 'camera', continues: true }, { start_ms: 4000, end_ms: 5000, continues: true }, { start_ms: 5000, end_ms: 6000 }];
assert.deepEqual(trackCuts('document', CAM, 0, 6000), [
  { t_ms: 2000, kind: 'soft', why: 'camera: pan' }, { t_ms: 2600, kind: 'soft', why: 'camera: pan ends' },   // static <-> reciprocal: none
  { t_ms: 3000, kind: 'soft', why: 'camera split' }, { t_ms: 4000, kind: 'soft', why: 'continues' }, { t_ms: 5000, kind: 'hard', why: 'scene' }]);
assert.deepEqual(trackCuts('document', CAM, 2300, 4500).map((c) => c.t_ms), [2600, 3000, 4000]);
assert.deepEqual(trackCuts('document', SC.slice(0, 1), 0, 1000), []);   // one doc scene: one scene
assert.equal(trackCuts('document', [], 0, 4000), undefined);            // no doc scenes: the sidecar detects
assert.equal(trackCuts('detect', SC, 0, 4000), undefined);
assert.deepEqual(trackCuts('one', SC, 0, 4000), []);
assert.deepEqual(scoreRequest({ candidate: [{ at: 0, pos: 1 }], reference: [], start_ms: 0.4, end_ms: 99.6, scenes: [], fps: 24 }), { cmd: 'score', candidate: [{ at: 0, pos: 1 }], reference: [], start_ms: 0, end_ms: 100, fps: 24 });
assert.deepEqual(Object.keys(scoreRequest({ candidate: [], reference: [], start_ms: 0, end_ms: 1, scenes: [{ start_ms: 0, end_ms: 1 }] })), ['cmd', 'candidate', 'reference', 'start_ms', 'end_ms', 'scenes']);
// pipe_*: invert is the picked signal, gate its own section, the rest shaping
const g3 = groupParams(['pipe_invert', 'pipe_gate', 'pipe_gate_min_ms', 'pipe_hold_ms', 'pipe_norm_window_ms', 'x', 'axis_x0', 'min_points'].map((key) => ({ key })));
assert.deepEqual(g3.map((g) => [g.id, g.params.map((q) => q.key)]), [['motion', ['x']], ['reseed', ['min_points']], ['signal', ['pipe_invert', 'axis_x0']],
  ['shape', ['pipe_hold_ms', 'pipe_norm_window_ms']], ['gate', ['pipe_gate', 'pipe_gate_min_ms']]]);
// null min/max/choices (v2 schema) mean unset
assert.equal(coerceParam({ type: 'int', default: 3, min: null, max: null }, '42'), 42);

// batcher: 1000 pushes -> one batch per tick, flush drains early
const ticks = []; const batches = [];
const b = createBatcher((x) => batches.push(x.length), (f) => ticks.push(f));
for (let i = 0; i < 1000; i++) b.push({ i });
assert.equal(ticks.length, 1);
ticks.shift()();
assert.deepEqual(batches, [1000]);
b.push({}); b.flush(); assert.deepEqual(batches, [1000, 1]);
ticks.shift()(); assert.deepEqual(batches, [1000, 1]);   // stale tick is a no-op

// video helpers
assert.deepEqual(fitRect(200, 100, 100, 100), { x: 50, y: 0, w: 100, h: 100 });
assert.deepEqual(fitRect(100, 200, 200, 100), { x: 0, y: 75, w: 100, h: 50 });
assert.equal(stepTarget(1, 40, 1), 1.06);
assert.equal(stepTarget(0.01, 40, -1), 0);
assert.equal(frameMsFrom({ presentedFrames: 1, mediaTime: 0.04 }, { presentedFrames: 2, mediaTime: 0.08 }, null), 40);
assert.equal(frameMsFrom({ presentedFrames: 1, mediaTime: 0.04 }, { presentedFrames: 2, mediaTime: 0.2 }, 40), 40);   // a seek jump never grows it
assert.equal(frameMsFrom({ presentedFrames: 1, mediaTime: 0.04 }, { presentedFrames: 3, mediaTime: 0.12 }, 33), 33);
console.log('protocol ok');

// the fake sidecar (test/fake-pawtrack.mjs) takes v4.9 cuts like pawtrack/cli.py: hard / soft objects and numbers; a bad kind is an error
{
  const { spawnSync } = await import('node:child_process');
  const fake = new URL('./fake-pawtrack.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const send = (cuts) => spawnSync(process.execPath, [fake], { input: JSON.stringify({ cmd: 'track', video: 'none.mp4', tracker: 'fake.box', start_ms: 0, end_ms: 1000, roi: { kind: 'box', x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, params: {}, cuts }),
    env: { ...process.env, FAKE_DURATION_MS: '2000', FAKE_FPS: '25', FAKE_DELAY_MS: '0' }, encoding: 'utf8' });
  const last = (r) => JSON.parse(r.stdout.trim().split('\n').pop());
  const ok = send(trackCuts('document', [{ start_ms: 0, end_ms: 500 }, { start_ms: 500, end_ms: 1000, split: 'camera' }], 0, 1000).concat([300]));
  assert.equal(ok.status, 0, ok.stderr); assert.equal(last(ok).type, 'result');
  const bad = send([{ t_ms: 500, kind: 'fade' }]);
  assert.equal(bad.status, 1); assert.match(last(bad).message, /cuts/);
}
