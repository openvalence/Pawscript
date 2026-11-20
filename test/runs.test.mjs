import assert from 'node:assert/strict';
import { makeRun, nextColor, PALETTE, newFrames, appendFrames, overlayAt, exportTarget, funscriptDoc, layerOf, channelOf, series, makeReference, cycleMarks, REF_COLOR, sceneAt, effSign, flipPatch, addSpan, spansForRequest, pointsList, SPAN_STATES } from '../src/lib/runs.js';
import { parseFunscript } from '../src/lib/funscript.js';
import { channelPatch } from '../src/lib/runs-channel.js';

const tr = { id: 'fake.box', name: 'Fake box' };
const result = { samples: [[0, 0], [40, 0.5], [80, 1]], points: [{ at: 0, pos: 0 }, { at: 80, pos: 100 }] };
const runs = [];
const r1 = makeRun({ n: 1, tracker: tr, params: { a: 1 }, range: { start: 0, end: 80 }, roi: { kind: 'box', x: 0, y: 0, w: 1, h: 1 }, result, frames: newFrames(), runs });
runs.push(r1);
const r2 = makeRun({ n: 2, tracker: tr, params: {}, range: { start: 0, end: 80 }, roi: null, result, frames: newFrames(), runs });
assert.equal(r1.color, PALETTE[0]); assert.equal(r2.color, PALETTE[1]);
assert.equal(nextColor(PALETTE.map((color) => ({ color }))), PALETTE[0]);   // all used: cycles
assert.equal(r1.samples.t.length, 3); assert.equal(layerOf(r1).ppos[1], 100);

const fr = newFrames();
appendFrames(fr, [{ t_ms: 0, value: 0.1, overlay: { points: [[0.5, 0.5]] } }, { t_ms: 40, value: null }, { t_ms: 80, value: 1, overlay: { boxes: [[0, 0, 1, 1]] } }]);
assert.ok(Number.isNaN(fr.v[1]));
assert.deepEqual(overlayAt(fr, 10).points, [[0.5, 0.5]]);
assert.equal(overlayAt(fr, 45), null);                       // frame 40 has no overlay
assert.ok(overlayAt(fr, 80).boxes);
assert.equal(overlayAt(fr, 2000), null);                     // too far past the last frame
assert.equal(overlayAt(fr, -5), null);

assert.deepEqual(exportTarget('C:\v\clip.one.mp4', false, false), { script: 'C:\v\clip.one.funscript', bak: 'C:\v\clip.one.funscript.bak', orig: 'C:\v\clip.one.funscript', alt: false });
// a same-name funscript is never the default target; explicit overwrite is
assert.equal(exportTarget('/a.b/clip.mp4', true, false).script, '/a.b/clip.pawscript.funscript');
assert.equal(exportTarget('/a.b/clip.mp4', true, true).script, '/a.b/clip.funscript');
assert.equal(exportTarget('/a.b/clip', false, false).script, '/a.b/clip.funscript');   // dot in a folder is not an extension

// export keeps unknown keys, replaces actions only
const existing = { version: '1.0', inverted: false, range: 90, metadata: { title: 'x', chapters: [1] }, axes: [{ id: 'roll' }], actions: [{ at: 1, pos: 1 }] };
const doc = funscriptDoc(existing, r1.points);
assert.deepEqual(doc.metadata, existing.metadata); assert.deepEqual(doc.axes, existing.axes); assert.equal(doc.range, 90);
assert.deepEqual(doc.actions, [{ at: 0, pos: 0 }, { at: 80, pos: 100 }]);
assert.equal(existing.actions.length, 1);   // input untouched
// inverted file keeps its flag; positions flip so playback matches
assert.deepEqual(funscriptDoc({ inverted: true, actions: [] }, r1.points).actions, [{ at: 0, pos: 100 }, { at: 80, pos: 0 }]);
// fresh doc round-trips through the reused parser
const fresh = funscriptDoc(null, { at: [0, 500, 1000], pos: [0, 100.4, -3] });
const p = parseFunscript(JSON.stringify(fresh));
assert.deepEqual(Array.from(p.at), [0, 500, 1000]);
assert.deepEqual(Array.from(p.pos, (x) => Math.round(x * 100)), [0, 100, 0]);

// null samples are gaps, not zeros
const g = series([[0, 0.5], [40, null], [80, 1]]);
assert.ok(Number.isNaN(g.v[1])); assert.equal(g.v[2], 1);
// channels: real min/max kept, scaled copy fills 0..1
const ch = channelOf([[0, 10], [40, null], [80, 30], [120, 20]]);
assert.equal(ch.min, 10); assert.equal(ch.max, 30); assert.deepEqual(Array.from(ch.scaled).map((x) => (x === x ? x : 'nan')), [0, 'nan', 1, 0.5]);
assert.equal(channelOf([[0, null]]).max, 0);   // all-null channel does not blow up
const rc = makeRun({ n: 3, tracker: tr, params: {}, range: { start: 0, end: 120 }, roi: null, runs: [], frames: newFrames(),
  result: { samples: [[0, 0.1], [40, null]], points: [], channels: { area: [[0, 1], [40, 3]] }, confidence: [[0, 0.9], [40, 0]], events: [{ t_ms: 0, kind: 'cycle', label: 'cycle 1' }] } });
assert.equal(layerOf(rc).pat.length, 0); rc.channel = 'area';
assert.deepEqual(Array.from(layerOf(rc).v), [0, 1]); assert.equal(layerOf(rc).pat, undefined);
assert.equal(rc.confidence.v[1], 0); assert.equal(rc.events.length, 1);
// reference run: points from a parsed funscript, pinned style
const ref = makeReference(parseFunscript(JSON.stringify({ actions: [{ at: 0, pos: 0 }, { at: 500, pos: 100 }] })), 'clip');
assert.ok(ref.ref && ref.color === REF_COLOR); assert.deepEqual(Array.from(ref.points.pos), [0, 100]); assert.ok(layerOf(ref).ref);
// loop cycle marks
assert.deepEqual(cycleMarks([{ start_ms: 1000, end_ms: 4000 }], [{ loop: { period_ms: 1000, cycles: 3 } }]).map((m) => m.t), [1000, 2000, 3000]);
assert.deepEqual(cycleMarks([{ start_ms: 0, end_ms: 1 }], [{ loop: { period_ms: null, cycles: 0 } }]), []);

// ---- direction: flipping mirrors one scene's points, never the others, and is its own inverse (paw-vtec: the patch is the
//      flips; the points come from composing with them, runs-channel.js channelPatch) ----
const scn = [{ start_ms: 0, end_ms: 1000, sign: 1 }, { start_ms: 1000, end_ms: 2000, sign: -1 }, { start_ms: 2000, end_ms: 3000, sign: 1 }];
assert.equal(sceneAt(scn, 0), 0); assert.equal(sceneAt(scn, 999), 0); assert.equal(sceneAt(scn, 1000), 1); assert.equal(sceneAt(scn, 99999), 2); assert.equal(sceneAt(scn, -5), 0); assert.equal(sceneAt([], 5), -1);
const frun = makeRun({ n: 9, tracker: tr, params: {}, range: { start: 0, end: 3000 }, roi: null, runs: [], frames: newFrames(),
  result: { samples: [], points: [{ at: 100, pos: 0 }, { at: 600, pos: 100 }, { at: 1100, pos: 20 }, { at: 1600, pos: 80 }, { at: 2500, pos: 50 }], scenes: scn } });
assert.deepEqual(Array.from(frun.points.pos), [0, 100, 20, 80, 50]);
let patch = flipPatch(frun, 1);
assert.deepEqual(patch, { flips: [1] }); assert.deepEqual(Array.from(channelPatch({ ...frun, ...patch }, 'primary').points0.pos), [0, 100, 80, 20, 50]);   // only scene 2 mirrored
assert.deepEqual(Array.from(frun.points0.pos), [0, 100, 20, 80, 50]);                                         // original untouched
const fl2 = { ...frun, ...patch };
assert.equal(effSign(fl2, 1), 1); assert.equal(effSign(fl2, 0), 1); assert.equal(effSign(frun, 1), -1);       // sidecar sign x client flip
assert.deepEqual(Array.from(channelPatch({ ...fl2, ...flipPatch(fl2, 1) }, 'primary').points0.pos), [0, 100, 20, 80, 50]);   // flip again = back
assert.deepEqual(flipPatch(frun, null).flips, [0, 1, 2]);                                                       // whole run
assert.deepEqual(flipPatch({ ...frun, flips: [0, 1, 2] }, null).flips, []);
assert.deepEqual(Array.from(channelPatch({ ...frun, flips: [0, 2] }, 'primary').points0.pos), [100, 0, 20, 80, 50]);
assert.deepEqual(pointsList({ at: [1, 2], pos: [3, 4] }), [{ at: 1, pos: 3 }, { at: 2, pos: 4 }]);

// ---- span labels: new labels replace overlaps (trimming partly covered ones); request carries only touching spans ----
let sp = addSpan([], { start_ms: 1000, end_ms: 5000, state: 'idle' });
sp = addSpan(sp, { start_ms: 2000, end_ms: 3000, state: 'climax' });
assert.deepEqual(sp, [{ start_ms: 1000, end_ms: 2000, state: 'idle' }, { start_ms: 2000, end_ms: 3000, state: 'climax' }, { start_ms: 3000, end_ms: 5000, state: 'idle' }]);
sp = addSpan(sp, { start_ms: 500, end_ms: 2500, state: 'carry' });
assert.deepEqual(sp.map((x) => [x.start_ms, x.end_ms, x.state]), [[500, 2500, 'carry'], [2500, 3000, 'climax'], [3000, 5000, 'idle']]);
assert.deepEqual(spansForRequest(sp, 0, 500), []); assert.equal(spansForRequest(sp, 2400, 3100).length, 3);
assert.ok(spansForRequest(sp, 0, 9999).every((x) => SPAN_STATES.includes(x.state) && Object.keys(x).length === 3));
console.log('runs ok');
