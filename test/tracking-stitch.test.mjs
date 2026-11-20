// Stitching a composed run's scenes (runs-channel.js stitchPoints): level carry in a continuing action, clean joins at
// real cuts, turn merges at the cut, off = untouched; the cutaway bridge lands on the carried level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stitchPoints } from '../src/lib/runs-channel.js';
import { bridgeScript } from '../src/lib/scenes-continue.js';

/** Turns every `half` ms between t0 and t1 alternating lo / hi (first = `first`), plus the scene's data ends at the cut
 *  (what scenePoints emits: a point on the first and last frame). */
function strokes(t0, t1, lo, hi, { half = 500, first = 'top', ends = true } = {}) {
  const out = [], mid = (lo + hi) / 2;
  if (ends) out.push({ at: t0, pos: Math.round(mid) });
  for (let t = t0 + half / 2, k = 0; t < t1 - 40; t += half, k++) out.push({ at: Math.round(t), pos: (k % 2 === 0) === (first === 'top') ? hi : lo });
  if (ends) out.push({ at: t1 - 33, pos: Math.round(mid) });
  return out;
}
const P = (...parts) => { const a = parts.flat(); return { at: Float64Array.from(a, (q) => q.at), pos: Float64Array.from(a, (q) => q.pos) }; };
const rows = (p) => Array.from(p.at, (at, i) => ({ at, pos: p.pos[i] }));
const inSpan = (p, a, b) => rows(p).filter((q) => q.at >= a && q.at < b);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const run = (cuts) => ({ scenes: cuts.slice(0, -1).map((t, i) => ({ start_ms: t, end_ms: cuts[i + 1] })), channels: {} });
const minStep = (p) => { let m = Infinity; for (let i = 1; i < p.at.length; i++) m = Math.min(m, p.at[i] - p.at[i - 1]); return m; };

test('level carry: an internal view and the continuing scene start on the level the action ended on (env: the size too)', () => {
  const r = run([0, 5000, 8000, 13000]);
  const doc = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 8000, tags: ['internal'] }, { start_ms: 8000, end_ms: 13000, continues: true }];
  const pts = P(strokes(0, 5000, 10, 50), strokes(5000, 8000, 60, 80), strokes(8000, 13000, 20, 80));
  const { points, stitches } = stitchPoints(pts, r, [], {}, { scenes: doc });
  const lvl = (a, b) => mean(inSpan(points, a, b).map((q) => q.pos));
  assert.ok(Math.abs(lvl(5300, 8000) - 30) < 4, `internal view on the action's level: ${lvl(5300, 8000)}`);
  assert.ok(Math.abs(lvl(8300, 13000) - 30) < 4, `continuing scene too: ${lvl(8300, 13000)}`);
  const amp = (a, b) => { const s = inSpan(points, a, b).map((q) => q.pos); return Math.max(...s) - Math.min(...s); };
  assert.ok(amp(8300, 13000) >= 55, 'without an envelope the size stays');
  assert.equal(stitches.length, 2); assert.ok(stitches.every((s) => s.carry));
  // envelope on both: the size step goes too
  const links = [{ t0: 5000, t1: 8000, run: 'r', channel: 'g1_proj', envelope: { mode: 'auto' } }, { t0: 8000, t1: 13000, run: 'r', channel: 'g1_proj', envelope: { mode: 'auto' } }];
  const re = { ...r, id: 'r', channels: { g1_proj: { t: Float64Array.from([0, 33]), v: Float32Array.from([0, 0]) } }, channel: 'primary', range: { start: 0, end: 13000 } };
  const e = stitchPoints(pts, re, links, {}, { scenes: doc }).points;
  const ampE = (() => { const s = inSpan(e, 8300, 13000).map((q) => q.pos); return Math.max(...s) - Math.min(...s); })();
  assert.ok(ampE <= 25, `env: the continuing scene takes the internal view's size: ${ampE}`);
  // no scenes known (or none continuing): real cuts, every centre kept
  const cut = stitchPoints(pts, r, [], {}, { scenes: doc.map(({ view, continues, ...s }) => s) }).points;   // eslint-disable-line no-unused-vars
  assert.ok(Math.abs(mean(inSpan(cut, 8300, 13000).map((q) => q.pos)) - 50) < 4);
});

test('real cut: each scene keeps its centre; the join is one stroke-long move, never a jump or two points under the min gap', () => {
  const r = run([0, 5000, 10000]), doc = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }];
  const pts = P(strokes(0, 5000, 10, 40), strokes(5000, 10000, 60, 95, { first: 'bottom' }));
  const { points, stitches } = stitchPoints(pts, r, [], {}, { scenes: doc });
  assert.ok(Math.abs(mean(inSpan(points, 5300, 10000).map((q) => q.pos)) - 77.5) < 3, 'the incoming centre stays');
  assert.ok(!rows(points).some((q) => q.at === 4967 || q.at === 5000), 'the data ends at the cut are gone');
  assert.ok(minStep(points) >= 60);
  assert.equal(stitches.length, 1);
  const s = stitches[0];
  assert.ok(s.t1 - s.t0 >= 250 && !s.carry, `join over a half-stroke: ${JSON.stringify(s)}`);
  // turns keep alternating across the cut
  const near = inSpan(points, 4000, 6000);
  for (let i = 2; i < near.length; i++) assert.ok((near[i].pos - near[i - 1].pos) * (near[i - 1].pos - near[i - 2].pos) < 0, 'alternating turns at ' + near[i].at);
});

test('phase: turns either side of the cut the same way merge into one; a stroke cut by the boundary is completed', () => {
  const r = run([0, 5000, 10000]), doc = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }];
  // a top 10 ms before the cut and one 10 ms after
  const A = [...strokes(0, 4800, 10, 90, { ends: false }), { at: 4990, pos: 92 }], B = [{ at: 5010, pos: 88 }, ...strokes(5000, 10000, 10, 90, { first: 'bottom', ends: false }).filter((q) => q.at > 5100)];
  const m = stitchPoints(P(A, B), r, [], {}, { scenes: doc }).points;
  const tops = inSpan(m, 4800, 5200).filter((q) => q.pos >= 85);
  assert.equal(tops.length, 1, 'one top at the cut: ' + JSON.stringify(inSpan(m, 4500, 5800)));
  assert.equal(tops[0].pos, 92, 'the more extreme one');
  assert.ok(minStep(m) >= 60);
  // the last turn before is a bottom at 4750, the first after a bottom at 5750: the top between them is put back
  const C = strokes(0, 5000, 10, 90, { ends: false }), D = strokes(5500, 10000, 10, 90, { first: 'bottom', ends: false });
  const c = stitchPoints(P(C, D), run([0, 5500, 10000]), [], {}, { scenes: [] }).points;
  const mid = inSpan(c, 4700, 5800);
  assert.equal(mid.length, 3, 'bottom, the completed top, bottom: ' + JSON.stringify(mid));
  assert.ok(mid[1].pos > 80 && mid[1].at > mid[0].at && mid[1].at < mid[2].at);
});

test('stitch off, one scene, or a single point: untouched', () => {
  const r = run([0, 5000, 10000]), pts = P(strokes(0, 5000, 10, 40), strokes(5000, 10000, 60, 95));
  assert.equal(stitchPoints(pts, r, [], { stitch: 'off' }).points, pts);
  assert.equal(stitchPoints(pts, run([0, 10000])).points, pts);
  assert.deepEqual(stitchPoints(pts, r, [], { stitch: 'off' }).stitches, []);
});

test('a cutaway between two parts of one action: the continuing scene is carried, so the bridge lands on that level', () => {
  const r = run([0, 5000, 7000, 12000]);
  const doc = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 7000, tags: ['offscreen'] }, { start_ms: 7000, end_ms: 12000, continues: true }];
  const pts = P(strokes(0, 5000, 20, 60), strokes(7000, 12000, 55, 95));   // nothing tracked in the cutaway
  const { points } = stitchPoints(pts, r, [], {}, { scenes: doc });
  const C = inSpan(points, 7300, 12000).map((q) => q.pos);
  assert.ok(Math.abs(mean(C) - 40) < 4, `carried over the cutaway: ${mean(C)}`);
  const br = bridgeScript(inSpan(points, 0, 5000), inSpan(points, 7000, 12000), 5000, 7000);
  assert.ok(br.length >= 2);
  assert.ok(br.every((q) => q.pos >= 15 && q.pos <= 65), 'bridge strokes on the carried level: ' + JSON.stringify(br));
});

test('on real composed points (channelPatch, two scenes on two scales): no point pair under the min gap, turns alternate at the cut', async () => {
  const { makeRun, newFrames } = await import('../src/lib/runs.js');
  const { channelPatch } = await import('../src/lib/runs-channel.js');
  const dt = 1000 / 30, pr = [];
  for (let t = 0; t < 8000; t += dt) pr.push([Math.round(t), t < 4000 ? 0.4 + 0.2 * Math.sin((2 * Math.PI * t) / 900) : 20 + 10 * Math.sin((2 * Math.PI * t) / 700)]);
  const scenes = [{ start_ms: 0, end_ms: 4000, sign: 1 }, { start_ms: 4000, end_ms: 8000, sign: 1 }];
  const r = makeRun({ n: 1, tracker: { id: 'x', name: 'x' }, params: {}, range: { start: 0, end: 8000 }, roi: null,
    result: { samples: pr.map(([t]) => [t, 0.5]), points: [{ at: 0, pos: 50 }], scenes, channels: { g2_proj: pr } }, frames: newFrames(), runs: [] });
  const c = channelPatch(r, 'g2_proj', { fit: 'scene' });
  const { points, stitches } = stitchPoints(c.points0, { ...r, ...c }, [], { fit: 'scene' }, { scenes: scenes.map(({ sign, ...s }) => s) });   // eslint-disable-line no-unused-vars
  assert.ok(minStep(points) >= 60, 'min gap ' + minStep(points));
  assert.equal(stitches.length, 1);
  const near = inSpan(points, 3000, 5000);
  for (let i = 2; i < near.length; i++) assert.ok((near[i].pos - near[i - 1].pos) * (near[i - 1].pos - near[i - 2].pos) < 0, 'alternating at ' + near[i].at + ' ' + JSON.stringify(near));
});

test('ctx.clean: a micro back-step the stitch leaves at the join goes (the owner screenshot); off / no clean = as before', () => {
  const r = run([0, 337300, 340000]), doc = r.scenes;
  const L = [[335900, 95], [336400, 5], [336900, 90], [337150, 2]], R = [[337400, 20], [337430, 17], [337900, 95], [338400, 5], [338900, 95], [339400, 5]];
  const pts = P([...L, ...R].map(([at, pos]) => ({ at, pos })));
  const raw = stitchPoints(pts, r, [], {}, { scenes: doc });
  assert.ok(rows(raw.points).some((q) => q.at === 337430), 'without the cleanup the glitch is there');
  const { points, stitches } = stitchPoints(pts, r, [], {}, { scenes: doc, clean: { gapMs: 60, posTol: 6 } });
  assert.deepEqual(rows(points).map((q) => q.at), [335900, 336400, 336900, 337150, 337400, 337900, 338400, 338900, 339400]);
  assert.deepEqual(stitches, raw.stitches);
  // away from the join (beyond blendMs) the same wiggle is the tracker's own and stays
  const far = P([...L, ...R, [339700, 20], [339730, 17], [339990, 60]].map(([at, pos]) => ({ at, pos })));
  assert.ok(rows(stitchPoints(far, r, [], {}, { scenes: doc, clean: { gapMs: 60, posTol: 6 } }).points).some((q) => q.at === 339730));
});
