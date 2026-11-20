// paw-llaa: a loop as one thing on the timeline (loop-marks.js, pure): one colour per footage, the preferred frame once per
// pass, carets for the other matches, linked shots, stepping through the same picture, the merged drawing on the Shots
// strip, an automatic loop re-split at a cut; and the loop commands that moved from the Loops row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeClock, offGridTable } from '../src/features/video/frames.js';
import { frameTime, frameAt } from '../src/lib/lane.js';
import { indexRepeats, runEnd } from '../src/features/timeline/repeats.js';
import { shotPictures } from '../src/features/timeline/repeat-scenes.js';
import { LOOP_PALETTE, loopColorIndex, passGeom, pickOf, pickTicks, pickFromTime, pickStep, pickOfPicture, caretRuns, spansOf, linkedShots,
  sameTimes, stepTimes, seekWords, loopBand, splitAt, loopEnd } from '../src/features/timeline/loop-marks.js';

const FM = 1000 / 30;
// the owner's case, synthetic: loop A (8 pictures, 100..107) 28.5 passes from frame 60 (shot 1), loop B (200..207) 29.5 passes
// from 288 (shot 1 too), unique frames, loop A again 5.5 passes from 600 (shot 2), and 2 passes of A at 680 (no loop there)
const segs = [[60, 228, 100], [288, 236, 200], [600, 44, 100], [680, 16, 100]];
const pic = (n) => { for (const [a, f, b] of segs) if (n >= a && n < a + f) return b + ((n - a) % 8); return 2000 + n; };
const raw = (N) => { const m = new Map(); for (let n = 0; n < N; n++) { const p = pic(n); if (!m.has(p)) m.set(p, []); m.get(p).push({ f0: n, f1: n, t_ms: Math.round(n * FM) }); } return { frames: N, buckets: [...m.values()].filter((o) => o.length > 1) }; };
const ix = indexRepeats(raw(760), FM);
const ms = (f) => frameTime(f, FM);
const auto = (f0, n, key = '0:0') => ({ id: 'a' + f0, t0: ms(f0), t1: ms(f0 + 8), auto: { key, t0: ms(f0), t1: ms(f0 + 8), end: ms(f0 + 8 * n), n } });
const A1 = auto(60, 28), B1 = auto(288, 29, '8:0'), A2 = auto(600, 5, '0:35');

test('colours: Okabe-Ito, the footages in time order take it in turn; the same footage shares; neighbours differ; stable', () => {
  assert.equal(LOOP_PALETTE.dark[0], '#E69F00', 'the first loop is orange');
  assert.equal(LOOP_PALETTE.dark.length, LOOP_PALETTE.light.length);
  const fams = [0, 8], c = loopColorIndex([{ id: 'a', t0: 0, group: 0 }, { id: 'b', t0: 10, group: 8 }, { id: 'c', t0: 20, group: 0 }], fams);
  assert.deepEqual([c.get('a'), c.get('b'), c.get('c')], [0, 1, 0], 'A orange, B sky blue, A again orange');
  const again = loopColorIndex([{ id: 'c', t0: 20, group: 0 }, { id: 'b', t0: 10, group: 8 }], fams);
  assert.deepEqual([again.get('b'), again.get('c')], [1, 0], 'a footage keeps its colour whatever else is marked');
  const hand = loopColorIndex([{ id: 'a', t0: 0, group: 0 }, { id: 'h', t0: 5, group: -1 }, { id: 'b', t0: 10, group: 8 }], fams);
  assert.notEqual(hand.get('h'), hand.get('a'), 'a loop with no footage still differs from its neighbour');
  const N = LOOP_PALETTE.dark.length, many = Array.from({ length: N + 1 }, (_, k) => k * 4), wrap = loopColorIndex([{ id: 'x', t0: 0, group: many.at(-1) }, { id: 'y', t0: 5, group: 0 }], many);
  assert.notEqual(wrap.get('x'), wrap.get('y'), 'the palette wrapping round onto a neighbour: bumped');
});

test('passes and the preferred frame: same phase in every pass, a drag picks inside the cycle (clamped), the nudge wraps', () => {
  const g = passGeom(A1, FM);
  assert.deepEqual([g.f0, g.pf, g.n, g.frames, g.end], [60, 8, 28, 8, ms(284)]);
  assert.equal(pickOf(A1, g), 0, 'default: the first frame (the marked frame before paw-llaa)');
  assert.equal(pickOf({ ...A1, pick: 5 }, g), 5);
  assert.equal(pickOf({ ...A1, pick: 9 }, g, 3), 3, 'out of the cycle: the fallback (an old pick)');
  const t = pickTicks(A1, g, 3, FM);
  assert.equal(t.length, 28);
  assert.deepEqual(t.slice(0, 3).map((x) => frameAt(x.t, FM)), [63, 71, 79], 'every pass at the same phase');
  assert.ok(t.every((x) => pic(frameAt(x.t, FM)) === 103), 'the same picture in every pass');
  assert.equal(pickFromTime(A1, g, 10, ms(60 + 80 + 6) + 5, FM), 6, 'pass 10, the frame under the pointer');
  assert.equal(pickFromTime(A1, g, 10, ms(60 + 80 + 30), FM), 7, 'past the cycle: its last frame');
  assert.equal(pickFromTime(A1, g, 10, ms(60), FM), 0, 'before it: its first');
  assert.deepEqual([pickStep(g, 7, 1), pickStep(g, 0, -1), pickStep(g, 3, 1)], [0, 7, 4]);
  assert.equal(pickOfPicture(ix, A2, passGeom(A2, FM), ix.buckets.findIndex((b) => pic(b.occ[0].f0) === 105), FM), 5, 'the linked loop: where the same picture is');
});

test('the preferred frame on a frame table with a dropped frame: every tick on a real frame start', () => {
  const times = Array.from({ length: 900 }, (_, i) => Math.round((66.016 + (i + (i >= 100 ? 1 : 0)) * FM) * 1000) / 1000);
  const c = makeClock({ times: offGridTable(times, makeClock({ fps: 30 })), durationMs: 30100 });
  const l = { id: 'v', t0: frameTime(90, c), t1: frameTime(98, c), auto: { key: '0:0', t0: frameTime(90, c), t1: frameTime(98, c), end: frameTime(90 + 32, c), n: 4 } };
  const g = passGeom(l, c);
  assert.equal(g.pf, 8);
  const t = pickTicks(l, g, 2, c);
  assert.deepEqual(t.map((x) => x.t), [92, 100, 108, 116].map((f) => frameTime(f, c)), 'across the dropped frame (frame 100)');
  assert.equal(pickFromTime(l, g, 1, frameTime(102, c) + 3, c), 4, 'snapped to the frame containing the pointer');
});

test('carets: repeated pictures outside the loops, one per run, in the footage of their loop', () => {
  const spans = [A1, B1, A2].map((l) => ({ t0: l.t0, t1: loopEnd(l) }));
  const runs = caretRuns(ix, spans, (o) => runEnd(o, FM));
  const at = runs.map((r) => frameAt(r.t, FM));
  assert.ok(at.includes(680), 'the 2 passes of A at 680 (no loop there): a caret');
  assert.ok(at.includes(284), 'the half pass after loop A\'s last whole pass: a caret');
  assert.ok(runs.every((r) => !spans.some((s) => r.t >= s.t0 && r.t < s.t1)), 'none inside a loop');
  const r680 = runs.find((r) => frameAt(r.t, FM) === 680);
  assert.equal(r680.fam, ix.family.get(ix.loops[0].key), 'coloured as loop A');
  assert.equal(frameAt(r680.t1, FM), 696, 'its run: 16 frames');
  const sp = spansOf(ix, r680.ids, (o) => runEnd(o, FM));
  assert.deepEqual(sp.map((s) => [frameAt(s.t0, FM), frameAt(s.t1, FM)]), [[60, 288], [600, 644], [680, 696]], 'click: every place those pictures play');
});

test('linked shots: the same loop footage in two shots; a chain on each', () => {
  const shots = [{ start_ms: 0, end_ms: ms(530) }, { start_ms: ms(530), end_ms: ms(590) }, { start_ms: ms(590), end_ms: ms(670) }, { start_ms: ms(670), end_ms: ms(760) }];
  const fa = ix.family.get(ix.loops[0].key), fb = ix.family.get(ix.loops[2].key);
  const L = linkedShots(ix, shotPictures(ix, shots, FM), [fa, fb]);
  assert.deepEqual([...L.keys()].sort(), [0, 2, 3]);
  assert.deepEqual(L.get(0).others, [2, 3]);
  assert.deepEqual(L.get(2), { fams: [fa], others: [0, 3] });
  assert.equal(L.has(1), false, 'a shot without the footage');
  assert.equal(linkedShots(ix, shotPictures(ix, shots, FM), [fb]).size, 0, 'B plays in one shot only');
});

test('seek through the same picture: in time order, wrapping, across shots; the words', () => {
  const s = sameTimes(ix, ms(63), FM, [A1]);
  assert.equal(s.times.length, 29 + 6 + 2, 'picture 103 everywhere');
  assert.deepEqual(stepTimes(s.times, ms(63), 1, FM / 2), { t: ms(71), i: 1, n: 37 });
  assert.equal(stepTimes(s.times, ms(63), -1, FM / 2).t, s.times.at(-1), 'before the first: wraps to the last');
  assert.equal(stepTimes(s.times, s.times.at(-1), 1, FM / 2).t, s.times[0], 'after the last: the first');
  const shotOf = (t) => (t < ms(530) ? 0 : t < ms(670) ? 1 : 2), label = (i) => ['21.1', '22.1', '23.1'][i];
  assert.equal(seekWords(s.times, ms(79), shotOf, label), '3 of 29 in shot 21.1 · +8 in 2 other shots');
  const none = sameTimes(null, ms(13), FM, [{ id: 'h', t0: 0, t1: ms(10), tiledTo: ms(40) }]);
  assert.deepEqual(none.times.map((t) => frameAt(t, FM)), [3, 13, 23, 33], 'no repeats: the hand loop\'s passes at that phase');
  assert.deepEqual(sameTimes(null, ms(10), FM, [{ id: 'h', t0: 0, t1: ms(10), tiledTo: ms(40) }]).times.map((t) => frameAt(t, FM)), [0, 10, 20, 30], 'the first frame of a pass');
  assert.equal(stepTimes([], 0, 1), null);
});

test('the merged drawing: the first pass solid, one dash-box per repeat, a tint only under 3 px a pass', () => {
  const g = passGeom(A1, FM), near = loopBand(A1, g, { start: ms(40), span: ms(460) }, 2000);
  assert.ok(Math.abs((near.x1 - near.x0) - (8 * FM / ms(460)) * 2000) < 0.5, 'the cycle: one pass wide');
  assert.equal(near.passes[0].k, 1);
  assert.equal(near.passes.length, 27, 'every repeat its own box');
  assert.ok(near.passes.every((p, i) => i === 0 || Math.abs(p.x0 - near.passes[i - 1].x1) < 1e-6), 'back to back, countable');
  const far = loopBand(A1, g, { start: 0, span: 13 * 60000 }, 2000);
  assert.equal(far.passes, null, 'the whole 13-minute video: the repeats are a tint');
  assert.ok(far.xe > far.x0);
  const hand = loopBand({ id: 'h', t0: 1000, t1: 2000 }, passGeom({ id: 'h', t0: 1000, t1: 2000 }, FM), { start: 0, span: 4000 }, 400);
  assert.deepEqual([hand.x0, hand.x1, hand.xe, hand.passes], [100, 200, 200, []], 'a hand loop: its cycle only');
});

test('a cut added or moved inside an automatic loop: one loop per shot, whole passes, same phase; the owner\'s left alone', () => {
  const l = { ...auto(60, 28, '0:0'), pick: 3 }, cut = ms(60 + 8 * 10 + 3);
  const out = splitAt([l], [cut], FM);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].t0, out[0].auto.n, out[0].auto.end], [l.t0, 10, ms(140)]);
  assert.deepEqual([out[1].t0, out[1].t1, out[1].auto.n, out[1].auto.end, out[1].auto.key, out[1].pick], [ms(148), ms(156), 17, l.auto.end, '0:11', 3]);
  assert.equal(out[1].auto.t0, out[1].t0, 'still automatic (× removes it, the key keeps it removed)');
  assert.equal(splitAt(out, [cut], FM), out, 'idempotent');
  assert.equal(splitAt([l], [ms(10), ms(400)], FM)[0], l, 'cuts outside it: unchanged');
  const mine = { id: 'm', t0: l.t0, t1: l.t1, tiledTo: ms(140) };
  assert.equal(splitAt([mine], [cut], FM)[0], mine, 'the owner\'s loop is not split');
  const s = splitAt([{ ...auto(0, 4), auto: { key: 'search:0', t0: 0, t1: ms(8), end: ms(32), n: 4, approx: true } , t1: ms(8) }], [ms(16)], FM);
  assert.deepEqual(s.map((x) => x.auto.key), ['search:0', `search:${Math.round(ms(16))}`], 'the loop search\'s: the new shot\'s key');
});

test('the Loops row\'s gestures moved: no row; keys on the Shots row / ruler; Alt+arrows the preferred frame; Alt+. / Alt+, step', () => {
  const lanes = readFileSync(new URL('../src/features/timeline/lane.js', import.meta.url), 'utf8');
  assert.doesNotMatch(lanes, /LoopsLane|'timeline\.loops'/);
  const cmds = readFileSync(new URL('../src/features/timeline/commands-loops.js', import.meta.url), 'utf8');
  const keys = (id) => (cmds.match(new RegExp(`id: '${id.replace('.', '\\.')}'[^\\n]*?keys: \\[([^\\]]*)\\]`)) || [])[1];
  assert.equal(keys('loops.pickNext'), "'Alt+ArrowRight'");
  assert.equal(keys('loops.pickPrev'), "'Alt+ArrowLeft'");
  assert.equal(keys('loops.outPlus'), "'Alt+Shift+ArrowRight'");
  assert.equal(keys('loops.inMinus'), "'Ctrl+Alt+Shift+ArrowLeft'");
  assert.equal(keys('loops.nextSame'), "'Alt+.'");
  assert.equal(keys('loops.prevSame'), "'Alt+,'");
  assert.equal(keys('loops.delete'), "'Delete', 'Backspace'");
  assert.equal(keys('loops.open'), "'Enter'");
  assert.match(cmds, /const sel = \(app\) => \['scenes', 'ruler', 'loops'\]\.includes\(tl\.focus\)/, 'a loop selected on the Shots row takes the keys');
  const all = ['commands-drag', 'commands-loops', 'commands-scenes'].map((f) => readFileSync(new URL(`../src/features/timeline/${f}.js`, import.meta.url), 'utf8'));
  assert.ok(!all.some((s) => /keys: \['Space'\]/.test(s)), 'Space stays play / pause');
  assert.ok('commands-loops' < 'commands-scenes', 'loops sort first: a selected loop wins Delete over the shot keys');
});
