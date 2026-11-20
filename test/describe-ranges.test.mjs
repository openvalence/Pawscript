// paw-2lp7.3: Describe by ranges (src/features/timeline/describe-ranges.js): grid samples -> proposed action regions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeRanges, refineTimes, gridRequest, refineRequest, withRangeProposals, VOCAB, DEFAULTS } from '../src/features/timeline/describe-ranges.js';
import { makeClock } from '../src/features/video/frames.js';
import { normActs } from '../src/features/timeline/regions.js';

const STEP = 500;   // ms between samples (12 frames at 24 fps)
// the mechanics, not the shipped DEFAULTS (those are tuned on the owner's projects: RESULTS.md)
const M = { on: 0.5, off: 0.35, bridge: 2, carryMs: 8000, cover: 0.5, mergeMs: 0, snapMs: 0 };
const O = { ...M, step: 12, grid: 1000 / 24, minMs: 1000 };
/** Samples every STEP ms over [t0, t1) with tags(t) -> {name: score}. */
const grid = (t0, t1, tags) => { const out = []; for (let t = t0; t < t1; t += STEP) out.push({ t_ms: t, tags: tags(t) }); return out; };
const shot = (start_ms, end_ms, x = {}) => ({ start_ms, end_ms, ...x });
const pen = (s = 0.9) => ({ anal_penetration: s });
const brief = (r) => ({ tags: r.tags, t0: r.t0, t1: r.t1, layer: r.layer });
/** The frame start (24 fps) of the midpoint x between two samples. */
const mid = (x) => Math.round(Math.floor((x + 0.6) / (1000 / 24)) * (1000 / 24));

test('first and last contiguous detection, with hysteresis', () => {
  const S = [0.1, 0.4, 0.6, 0.4, 0.37, 0.4, 0.6, 0.1, 0.1, 0.1, 0.1, 0.45, 0.4, 0.3, 0.1, 0.1];   // 0.45 / 0.4 alone never reach `on`
  const smp = S.map((s, i) => ({ t_ms: i * STEP, tags: pen(s) }));
  const { regions } = proposeRanges(smp, { ...O, shots: [shot(0, 8000)], bridge: 0 });
  assert.deepEqual(regions.map(brief), [{ tags: ['anal', 'penetration'], t0: 250, t1: 3250, layer: 0 }]);   // samples 1..6, edges in the middle
  assert.equal(regions[0].auto, true);
  assert.deepEqual(regions[0].evidence, { samples: 6, positives: 6, mean: 0.462 });
  // a higher off-threshold breaks it at 0.37
  assert.equal(proposeRanges(smp, { ...O, shots: [shot(0, 8000)], bridge: 0, off: 0.38 }).regions.length, 2);   // 1..3 and 5..6
});

test('bridging: up to `bridge` missed samples', () => {
  const miss = (n) => grid(0, 10000, (t) => (t >= 4000 && t < 4000 + n * STEP ? {} : pen()));
  const one = (n, bridge) => proposeRanges(miss(n), { ...O, shots: [shot(0, 10000)], bridge }).regions.length;
  assert.equal(one(1, 1), 1);
  assert.equal(one(2, 1), 2);
  assert.equal(one(2, 2), 1);
  assert.equal(one(3, 2), 2);
});

test('a cutaway, a blank or an off-screen shot inside an action carries it; a long act-less shot does not', () => {
  const shots = [shot(0, 10000), shot(10000, 13000), shot(13000, 20000)];
  const smp = (mid) => [...grid(0, 10000, () => pen()), ...grid(10000, 13000, () => mid), ...grid(13000, 20000, () => pen())];
  assert.deepEqual(proposeRanges(smp({}), { ...O, shots, bridge: 0 }).regions.map(brief), [{ tags: ['anal', 'penetration'], t0: 0, t1: 20000, layer: 0 }]);
  // the cutaway shows another act (a kiss): not a carry shot, the range ends at the cut
  assert.equal(proposeRanges(smp({ kissing: 0.9 }), { ...O, shots, bridge: 0 }).regions.filter((r) => r.tags.includes('anal')).length, 2);
  // blank / off-screen / filled are carried whatever they show, a plain act-less shot only up to carryMs
  assert.equal(proposeRanges(smp({ kissing: 0.9 }), { ...O, shots: [shots[0], shot(10000, 13000, { kind: 'blank' }), shots[2]], bridge: 0 }).regions.filter((r) => r.tags.includes('anal')).length, 1);
  assert.equal(proposeRanges(smp({ kissing: 0.9 }), { ...O, shots: [shots[0], shot(10000, 13000, { tags: ['offscreen'] }), shots[2]], bridge: 0 }).regions.filter((r) => r.tags.includes('anal')).length, 1);
  assert.equal(proposeRanges(smp({}), { ...O, shots, bridge: 0, carryMs: 2000 }).regions.length, 2);
});

test('edges: on the cut when the detection starts / ends there, else between the samples on a frame start', () => {
  const shots = [shot(0, 5000), shot(5000, 15000), shot(15000, 20000)];
  const smp = [...grid(0, 5000, () => ({})), ...grid(5000, 15000, (t) => (t < 12000 ? pen() : {})), ...grid(15000, 20000, () => ({}))];
  const r = proposeRanges(smp, { ...O, shots }).regions[0];
  assert.equal(r.t0, 5000);                                  // the shot's first sample saw it: the cut
  assert.equal(r.t1, mid(11750));   // between 11500 and 12000, on a frame start
  // the shot's first frame was seen without it: not snapped, even within one step
  const late = [...grid(0, 5000, () => ({})), { t_ms: 5000, tags: {} }, ...grid(5300, 15000, () => pen())];
  assert.notEqual(proposeRanges(late, { ...O, shots, stepMs: 500 }).regions[0].t0, 5000);
});

test('refine: one request of at most 4 frames an edge, then the edge between the refined frames', () => {
  const shots = [shot(0, 20000)];
  const truth = 7100;   // the act starts here
  const smp = grid(0, 20000, (t) => (t >= truth ? pen() : {}));
  const first = proposeRanges(smp, { ...O, shots });
  assert.equal(first.regions[0].t0, mid(7250));
  assert.ok(first.refine.length <= 4 && first.refine.every((t) => t > 7000 && t < 7500 + 1));
  // the frames the sidecar tags at those times (the frame at or before each)
  const fr = (t) => Math.floor(t / (1000 / 24)) * (1000 / 24);
  const refined = first.refine.map((t) => ({ t_ms: Math.round(fr(t)), tags: fr(t) >= truth ? pen() : {} }));
  const second = proposeRanges(smp, { ...O, shots, refined });
  assert.ok(Math.abs(second.regions[0].t0 - truth) < Math.abs(first.regions[0].t0 - truth));
  assert.deepEqual(second.refine, []);
});

test('refineTimes: frame starts strictly between, at most `per`, none for adjacent frames; no grid: evenly in ms', () => {
  const g = 1000 / 24;
  const t = refineTimes([[0, 500]], g);
  assert.equal(t.length, 4);
  assert.ok(t.every((x) => x > 0 && x < 500 && Math.abs((x - 1) / g - Math.round((x - 1) / g)) < 0.02));
  assert.deepEqual(refineTimes([[0, g * 2]], g), [Math.round(g) + 1]);
  assert.deepEqual(refineTimes([[0, g]], g), []);
  assert.deepEqual(refineTimes([[0, 500]], 0), [100, 200, 300, 400]);
});

test('minimum length drops short ranges', () => {
  const smp = grid(0, 10000, (t) => (t >= 2000 && t < 3000 ? pen() : {}));
  assert.equal(proposeRanges(smp, { ...O, shots: [shot(0, 10000)], minMs: 1000 }).regions.length, 1);
  assert.equal(proposeRanges(smp, { ...O, shots: [shot(0, 10000)], minMs: 1500 }).regions.length, 0);
});

test('where + what as one action, other whats their own; the penetration family suggested for the main line', () => {
  const shots = [shot(0, 30000)];
  const smp = grid(0, 30000, (t) => ({ ...(t < 20000 ? { fellatio: 0.9 } : { rimming: 0.9 }), ...(t >= 5000 && t < 25000 ? { handjob: 0.9 } : {}) }));
  const { regions } = proposeRanges(smp, { ...O, shots });
  assert.deepEqual(regions.map(brief), [
    { tags: ['oral', 'penetration'], t0: 0, t1: mid(19750), layer: 0 },
    { tags: ['anal', 'licking'], t0: mid(19750), t1: 30000, layer: 0 },
    { tags: ['handjob'], t0: mid(4750), t1: mid(24750), layer: 1 },   // longer than the rimming, but not the penetration family
  ]);
  assert.equal(regions[2].mix, 'mix');
  assert.equal(regions[0].mix, undefined);
  // no penetration: the longest goes first
  const two = proposeRanges(grid(0, 30000, (t) => ({ kissing: 0.9, ...(t < 10000 ? { handjob: 0.9 } : {}) })), { ...O, shots }).regions;
  assert.deepEqual(two.map((r) => [r.tags[0], r.layer]), [['kissing', 0], ['handjob', 1]]);
  // licking and penetration seen together in a where: one action with both (as a scene tagged with both converts); a short
  // flicker of licking inside a long penetration is absorbed
  assert.deepEqual(proposeRanges(grid(0, 10000, () => ({ fellatio: 0.9, penis_lick: 0.9 })), { ...O, shots }).regions.map((r) => r.tags), [['oral', 'penetration', 'licking']]);
  assert.deepEqual(proposeRanges(grid(0, 30000, (t) => ({ fellatio: 0.9, ...(t >= 8000 && t < 8500 ? { penis_lick: 0.9 } : {}) })), { ...O, shots }).regions.map(brief),
    [{ tags: ['oral', 'penetration'], t0: 0, t1: 30000, layer: 0 }]);
  // a where with no in-where what is an action by itself; a what needing a where with none stays alone
  assert.deepEqual(proposeRanges(grid(0, 5000, () => ({ anal: 0.9 })), { ...O, shots }).regions.map((r) => r.tags), [['anal']]);
  assert.deepEqual(proposeRanges(grid(0, 5000, () => ({ fingering: 0.9 })), { ...O, shots }).regions.map((r) => r.tags), [['fingering']]);
});

test('accepted regions: never overlapped on their layer, same tags dropped where they are', () => {
  const shots = [shot(0, 30000)];
  const smp = grid(0, 30000, (t) => ({ fellatio: 0.9, ...(t >= 5000 && t < 10000 ? { handjob: 0.9 } : {}) }));
  const accepted = normActs([{ id: 'a', kind: 'act', t0: 0, t1: 12000, layer: 0, tags: ['oral', 'penetration'] }, { id: 'b', kind: 'intro', t0: 20000, t1: 30000, layer: 0, tags: [] }]);
  const { regions } = proposeRanges(smp, { ...O, shots, accepted });
  assert.deepEqual(regions.map(brief), [
    { tags: ['oral', 'penetration'], t0: 12000, t1: 20000, layer: 0 },   // the accepted fellatio cut out, the intro cut around
    { tags: ['handjob'], t0: mid(4750), t1: mid(9750), layer: 1 },   // inside the accepted fellatio on layer 0: moves up
  ]);
  for (const L of [0, 1]) {
    const on = [...accepted, ...regions].filter((r) => r.layer === L).sort((a, b) => a.t0 - b.t0);
    on.forEach((r, i) => assert.ok(!on[i + 1] || r.t1 <= on[i + 1].t0, `layer ${L} overlaps`));
  }
});

test('modifiers: ranges from the same samples, only where none of the kind is', () => {
  const smp = grid(0, 20000, (t) => ({ anal_penetration: 0.9, ...(t >= 12000 ? { cumshot: 0.8 } : {}) }));
  const a = proposeRanges(smp, { ...O, shots: [shot(0, 20000)] });
  assert.deepEqual(a.mods.map((m) => [m.kind, m.t1]), [['orgasm', 20000]]);
  assert.ok(Math.abs(a.mods[0].t0 - 11750) < 50);
  assert.ok(a.regions.every((r) => !r.tags.includes('orgasm')));
  assert.deepEqual(proposeRanges(smp, { ...O, shots: [shot(0, 20000)], fx: [{ id: 'x', kind: 'orgasm', t0: 15000, t1: 16000 }] }).mods, []);
});

test('a frame table clock (non-CFR): edges on its real frame starts', () => {
  const times = [];
  for (let k = 0, t = 0; k < 600; k++) { times.push(Math.round(t)); t += k % 7 === 3 ? 66.7 : 33.3; }   // dropped frames
  const clock = makeClock({ times, durationMs: times[599] + 33 });
  const smp = times.filter((_, k) => k % 12 === 0).map((t) => ({ t_ms: t, tags: t >= 8000 ? pen() : {} }));
  const r = proposeRanges(smp, { ...M, shots: [shot(0, times[599] + 33)], grid: clock, step: 12, minMs: 1000 }).regions[0];
  assert.ok(times.includes(r.t0), `t0 ${r.t0} is a frame start`);
  const ref = proposeRanges(smp, { ...M, shots: [shot(0, times[599] + 33)], grid: clock, step: 12, minMs: 1000 }).refine;
  assert.ok(ref.length && ref.every((t) => times.includes(t - 1)));
});

test('calibrated scores: a tag counts against its own threshold', () => {
  const smp = grid(0, 5000, () => ({ handjob: 0.3 }));
  assert.equal(proposeRanges(smp, { ...O, shots: [shot(0, 5000)] }).regions.length, 0);
  assert.equal(proposeRanges(smp, { ...O, shots: [shot(0, 5000)], calibrated: true, thresholds: { handjob: 0.25 } }).regions.length, 1);
});

test('requests: the grid with the vocabulary and the shots; refine by times', () => {
  const g = gridRequest('v.mp4', { shots: [[0, 1000], [1000, 2000]] });   // the default step: DEFAULTS.step
  assert.deepEqual(g, { cmd: 'describe', video: 'v.mp4', params: {}, grid: { step: DEFAULTS.step, only: VOCAB, shots: [[0, 1000], [1000, 2000]] } });
  assert.ok(VOCAB.includes('anal_*') && VOCAB.includes('cumshot') && VOCAB.includes('first_person_view'));
  assert.deepEqual(refineRequest('v.mp4', [5, 9]).grid, { times: [5, 9], only: VOCAB });
});

test('the fake sidecar (test/fake-pawtrack.mjs) answers the grid and the refine requests: stage 2 can be tested on it', async () => {
  const { spawnSync } = await import('node:child_process');
  const fake = new URL('./fake-pawtrack.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const send = (req) => {
    const r = spawnSync(process.execPath, [fake], { input: JSON.stringify(req), env: { ...process.env, FAKE_DURATION_MS: '30000', FAKE_FPS: '24' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  };
  const shots = [[0, 9000], [9000, 30000]];
  const ev = send(gridRequest('none.mp4', { shots, step: O.step }));
  const res = ev.at(-1);
  assert.equal(res.type, 'result');
  assert.deepEqual(ev.filter((e) => e.type === 'samples').flatMap((e) => e.samples), res.samples);
  const sh = shots.map(([a, b]) => shot(a, b)), first = proposeRanges(res.samples, { ...O, shots: sh });
  const ref = send(refineRequest('none.mp4', first.refine)).at(-1).samples;
  const { regions, mods } = proposeRanges(res.samples, { ...O, shots: sh, refined: ref });
  assert.deepEqual(regions.map((r) => [r.tags.join('+'), r.layer]), [['anal+penetration', 0], ['handjob', 1]]);
  assert.ok(Math.abs(regions[0].t0 - 3000) <= 60 && Math.abs(regions[0].t1 - 21000) <= 60, `${regions[0].t0} ${regions[0].t1}`);
  assert.deepEqual(mods.map((m) => m.kind), ['orgasm']);
  // the shipped defaults find the same on it (the fake's scores are above their 0.9)
  const d = send(gridRequest('none.mp4', { shots })).at(-1).samples;
  assert.deepEqual(proposeRanges(d, { shots: sh, grid: 1000 / 24 }).regions.map((r) => [r.tags.join('+'), r.layer]), [['anal+penetration', 0], ['handjob', 1]]);
});

test('withRangeProposals: the proposals replace the earlier ones in doc.acts, accepted regions untouched (stage 2 contract)', () => {
  const acts = normActs([{ id: 'a', kind: 'act', t0: 0, t1: 5000, layer: 0, tags: ['anal', 'penetration'] }, { id: 'old', kind: 'act', t0: 6000, t1: 9000, layer: 0, tags: ['handjob'], auto: true }]);
  const smp = grid(0, 20000, (t) => (t >= 10000 ? { fellatio: 0.9 } : t < 5000 ? pen() : {}));
  const { regions } = proposeRanges(smp, { ...O, shots: [shot(0, 20000)], accepted: acts.filter((r) => !r.auto) });
  const out = withRangeProposals(acts, regions);
  assert.deepEqual(out.filter((r) => !r.auto), acts.filter((r) => !r.auto));
  assert.deepEqual(out.filter((r) => r.auto).map((r) => [r.tags.join('+'), r.layer, r.t1]), [['oral+penetration', 0, 20000]]);
  assert.ok(out.every((r) => !('confidence' in r)));
});
