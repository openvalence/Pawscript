import assert from 'node:assert/strict';
import { makeRun, newFrames } from '../src/lib/runs.js';
import { pointsFromChannel, channelPatch } from '../src/lib/runs-channel.js';

// two scenes, 30 fps; g2_proj = a clean 1 Hz sine in different real units per scene (peaks at 250 + 1000k ms)
const dt = 1000 / 30, pairs = [];
for (let t = 0; t < 4000; t += dt) {
  const s = Math.sin((2 * Math.PI * t) / 1000), ms = Math.round(t);
  const lost = (ms >= 900 && ms < 1100) || (ms >= 3000 && ms < 3600) || ms === 2000;   // 200 ms gap, 600 ms gap, the cut frame
  pairs.push([ms, lost ? null : ms < 2000 ? 0.4 + 0.2 * s : 20 + 10 * s]);
}
const primary = [{ at: 0, pos: 50 }, { at: 1000, pos: 10 }, { at: 3000, pos: 90 }];
const scenes = [{ start_ms: 0, end_ms: 2000, sign: 1 }, { start_ms: 2000, end_ms: 4000, sign: 1 }];
const run = makeRun({ n: 1, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: { primary: 'auto' }, range: { start: 0, end: 4000 }, roi: null,
  result: { samples: pairs.map(([t]) => [t, 0.5]), points: primary, scenes, channels: { g2_proj: pairs } }, frames: newFrames(), runs: [] });

// default fit = the channel's range over the run: scene 1 (0.2..0.6 of a 0.2..30 range) is a tiny ripple, kept as points but small
{
  const d = pointsFromChannel(run, 'g2_proj');
  const s1 = [...d.pos].filter((_, i) => d.at[i] < 2000);
  assert.ok(s1.length >= 3 && Math.max(...s1) < 5, `scene 1 stays small on the run's scale: ${s1.length} turns, max ${Math.max(...s1)}`);
}
const p = pointsFromChannel(run, 'g2_proj', { fit: 'scene' });
assert.ok(p.at instanceof Float64Array && p.pos instanceof Float64Array);
for (let i = 1; i < p.at.length; i++) assert.ok(p.at[i] > p.at[i - 1]);
for (const x of p.pos) assert.ok(x >= 0 && x <= 100);
// sig.smooth's gaussian is one-sided near a run end (scene edge, long gap), so extremes there move up to ~30 ms
const near = (t, tol = 30) => { for (let i = 0; i < p.at.length; i++) if (Math.abs(p.at[i] - t) <= tol) return p.pos[i]; return null; };
// turning points on the sine's extremes, larger value = out = 100, each scene fitted to its own 0..100
for (const t of [250, 1250, 2250]) assert.ok(near(t) >= 95, `peak at ${t}: ${near(t)}`);
for (const t of [750, 1750, 2750]) assert.ok(near(t) <= 5, `trough at ${t}: ${near(t)}`);
for (const [a, b] of [[0, 2000], [2000, 4000]]) {
  const ps = [...p.pos].filter((_, i) => p.at[i] >= a && p.at[i] < b);
  assert.equal(Math.max(...ps), 100); assert.equal(Math.min(...ps), 0);
}
// the 200 ms gap is bridged (no point there), the 600 ms one stays unknown: known data ends on each side of it
assert.ok(![...p.at].some((t) => t > 950 && t < 1050));
assert.ok(![...p.at].some((t) => t > 2967 && t < 3600));
assert.ok(p.at.includes(2967) && p.at.includes(3600));
// the trough at 3750 is only 150 ms past the long gap: the one-sided window pulls it furthest
assert.ok(near(3750, 60) <= 3);

// sidecar scene sign -1 (pipe_invert / auto): the channel is mirrored there like the primary is
const inv = pointsFromChannel({ ...run, scenes: [scenes[0], { ...scenes[1], sign: -1 }] }, 'g2_proj', { fit: 'scene' });
assert.ok(inv.pos[[...inv.at].findIndex((t) => Math.abs(t - 2250) <= 30)] <= 3);
assert.ok(inv.pos[[...inv.at].findIndex((t) => Math.abs(t - 250) <= 30)] >= 97);

// switch: points0 rebuilt, the sidecar's kept; a flip after the switch still inverts that scene (paw-vtec: composed with it); back = restored
const sw = { ...run, ...channelPatch(run, 'g2_proj', { fit: 'scene' }) };
assert.equal(sw.channel, 'g2_proj'); assert.equal(sw.points0Primary, run.points0);
assert.deepEqual([...sw.points0.at], [...p.at]);
const flipped = channelPatch({ ...sw, flips: [1] }, 'g2_proj', { fit: 'scene' }).points0;
for (let i = 0; i < p.at.length; i++) assert.equal(flipped.pos[i], p.at[i] >= 2000 ? 100 - p.pos[i] : p.pos[i]);
const back = { ...sw, ...channelPatch(sw, 'primary') };
assert.equal(back.points0, run.points0);
assert.deepEqual([...back.points0.pos], [50, 10, 90]);
// a channel that is the sidecar's own primary keeps the sidecar's points; a missing channel too
assert.equal(channelPatch({ ...run, params: { primary: 'g2_proj' } }, 'g2_proj').points0, run.points0);
assert.equal(channelPatch(run, 'nope').points0, run.points0);
assert.equal(pointsFromChannel(run, 'nope').at.length, 0);

console.log('runs-channel ok');

// the owner's case: 20 s of small 1 Hz strokes on a plateau, then the body leaves (a drop 20x the stroke). A whole-scene
// fit would make the strokes a 5 % ripple under the prominence; the rolling p5..p95 window keeps them full strokes.
{
  const pairs = [];
  for (let t = 0; t < 24000; t += dt) { const ms = Math.round(t); pairs.push([ms, ms < 20000 ? 0.8 + 0.02 * Math.sin((2 * Math.PI * t) / 1000) : 0.8 - 0.4 * Math.min(1, (ms - 20000) / 1000)]); }
  const r = makeRun({ n: 2, tracker: { id: 'tapnext_points', name: 'TAPNext' }, params: { primary: 'auto' }, range: { start: 0, end: 24000 }, roi: null,
    result: { samples: pairs.map(([t]) => [t, 0.5]), points: primary, scenes: [{ start_ms: 0, end_ms: 24000, sign: 1 }], channels: { g1_proj: pairs } }, frames: newFrames(), runs: [] });
  const d = pointsFromChannel(r, 'g1_proj');   // default: as tracked — the strokes are there, small, at the top
  const dm = [...d.at].map((t, i) => [t, d.pos[i]]).filter(([t]) => t >= 5000 && t < 15000);
  assert.ok(dm.length >= 18, `strokes kept as tracked: ${dm.length} turns in 10 s`);
  assert.ok(dm.every(([, v]) => v >= 85), 'as tracked they stay on the plateau');
  const q = pointsFromChannel(r, 'g1_proj', { fit: 'rolling' });
  const mid = [...q.at].map((t, i) => [t, q.pos[i]]).filter(([t]) => t >= 5000 && t < 15000);
  assert.ok(mid.length >= 18, `strokes kept on the plateau: ${mid.length} turns in 10 s`);
  const hi = mid.filter(([, v]) => v >= 90).length, lo = mid.filter(([, v]) => v <= 10).length;
  assert.ok(hi >= 8 && lo >= 8, `rolling fit, full strokes: ${hi} tops, ${lo} bottoms`);
}

// detail: extra points between turns from the tracked shape (Douglas-Peucker per stroke)
{
  const mk = (f) => { const pr = []; for (let t = 0; t < 4000; t += dt) pr.push([Math.round(t), f(t)]); return makeRun({ n: 2, tracker: { id: 'x', name: 'x' }, params: { primary: 'auto' }, range: { start: 0, end: 4000 }, roi: null,
    result: { samples: pr.map(([t]) => [t, 0.5]), points: [{ at: 0, pos: 50 }], scenes: [], channels: { g2_proj: pr } }, frames: newFrames(), runs: [] }); };
  const sine = (t) => Math.sin((2 * Math.PI * t) / 1000);
  const hold = mk((t) => { const s = sine(t), ph = t % 1000; return ph >= 600 && ph < 900 ? -1 : Math.max(s, ph > 500 && ph < 600 ? s : -1); });
  const base = pointsFromChannel(hold, 'g2_proj'), d0 = pointsFromChannel(hold, 'g2_proj', { detail: 0 });
  assert.deepEqual([...d0.at], [...base.at]); assert.deepEqual([...d0.pos], [...base.pos]);   // (1) 0 = today's output
  const d6 = pointsFromChannel(hold, 'g2_proj', { detail: 6 });
  assert.ok(d6.at.length >= base.at.length + 2, `hold: ${base.at.length} -> ${d6.at.length}`);   // (2)
  const sn = mk(sine), s0 = pointsFromChannel(sn, 'g2_proj'), s10 = pointsFromChannel(sn, 'g2_proj', { detail: 10 });
  assert.ok(s10.at.length > s0.at.length && s10.at.length <= Math.ceil(4000 / dt));   // (3)
  for (let i = 1; i < s10.at.length; i++) assert.ok(s10.at[i] > s10.at[i - 1]);
  for (const x of s10.pos) assert.ok(Number.isInteger(x) && x >= 0 && x <= 100);
  const tri = mk((t) => { const ph = (t % 1000) / 1000; return ph < 0.5 ? ph * 2 : 2 - ph * 2; });   // (4) straight segments
  const t0 = pointsFromChannel(tri, 'g2_proj');
  for (const d of [1, 5, 10]) assert.equal(pointsFromChannel(tri, 'g2_proj', { detail: d }).at.length, t0.at.length, `triangle detail ${d}`);
}

import { inputLine } from '../src/lib/runs-channel.js';
{   // inputLine: what the tracker was fed (sidecar v4.23)
  assert.equal(inputLine(undefined), '');
  assert.equal(inputLine({ mode: 'off', applied: false }), 'Tracker input: as decoded (levels off)');
  assert.equal(inputLine({ mode: 'auto', applied: false, why: 'unchanged' }), 'Tracker input: unchanged');
  assert.equal(inputLine({ mode: 'auto', applied: true, black: 12, white: 143, gamma: 0.8, saturation: 1.3, capped: [] }), 'Tracker input: levels 12–143 → full range, gamma 0.8, saturation ×1.3');
  assert.match(inputLine({ mode: 'auto', applied: true, black: 4, white: 60, gamma: 0.5, saturation: 1, capped: ['gain', 'gamma'] }), /^Tracker input: levels 4–60 → full range, gamma 0.5 · cap reached: gain, gamma$/);
}

import { modelLines } from '../src/lib/runs-channel.js';
{   // modelLines: TAPNext++'s auto input size per run scene (sidecar v4.55 note model_size), the Run details line
  const notes = [{ code: 'primary', message: 'x', scene_index: 0 },
    { code: 'model_size', message: 'auto: 256, no painted parts', scene_index: 0, data: { model: '256', auto: true } },
    { code: 'model_size', message: 'auto: 512, penis is 1.9 % of the frame across', scene_index: 2, data: { model: '512', auto: true } }];
  const L = modelLines(notes);
  assert.equal(L[0], 'Model input: auto: 256, no painted parts');
  assert.equal(L[1], undefined);
  assert.equal(L[2], 'Model input: auto: 512, penis is 1.9 % of the frame across');
  assert.deepEqual(modelLines([{ code: 'primary', message: 'x' }]), []);   // an explicit 256 / 512 run or an older sidecar: nothing
  assert.deepEqual(modelLines(undefined), []);
}
