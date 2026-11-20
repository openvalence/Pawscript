// paw-zhn4: an exact loop holding several strokes (an owner clip, shot 44: 51 frames x 5 passes, 4 quick thrusts a pass). On an
// exact loop every row repeats at the loop length, so rhythm read there (rhythmOf) is ~1 for every row, clean or jagged, and
// the act tag's gain hands the mix to a jagged row (the penis mostly hidden each thrust: its visible points' centre jumps).
// With the loop known (fusedChannel loops: the period per run scene) the rows' rhythm is read at loop / k, k from the rows'
// own motion: the clean row wins for every k; one stroke per loop (k = 1) is today's result bit for bit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusedChannel, rhythmOf } from '../src/lib/fusion.js';
import { channelOf } from '../src/lib/runs.js';

const FPS = 30, LF = 64, PASSES = 5, N = LF * PASSES, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS)), LOOP = (LF * 1000) / FPS;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** One pass of k strokes (uneven sizes and timing, as real thrusts), repeated exactly: + = out. */
const strokeOf = (k) => (i) => {
  const ph = (i % LF) / LF, u = ph * k, j = Math.floor(u), f = u - j, size = [1, 0.75, 0.9, 0.65, 0.85, 0.7][j % 6];
  return size * Math.sin(2 * Math.PI * (f + 0.08 * Math.sin(2 * Math.PI * f)));
};
/** The scene: the Top torso carries the stroke (clean), the Top penis rides it but its visible centre jumps (several jumps a
 *  stroke, the same every pass: an exact loop), the Bottom hips / thighs nearly still; tagged penetration (x3 on Top penis
 *  <-> Bottom hips / thighs). Every pass identical, tracker jitter included (the frames repeat, so do the tracks). */
function loopScene(k) {
  const s = strokeOf(k), r = rng(7 + k), jit = Array.from({ length: LF }, () => [0.0015 * (r() - 0.5), 0.0015 * (r() - 0.5)]);
  const steps = Array.from({ length: Math.ceil(LF / 3) }, () => 0.08 * (r() - 0.5)), jumps = Array.from({ length: LF }, (_, q) => steps[Math.floor(q / 3)]);   // a new visible centre every 3 frames
  const parts = {
    c2_torso: (i) => [0.6, 0.4 + 0.04 * s(i)],
    c2_penis: (i) => [0.5 + 0.4 * jumps[i % LF], 0.5 + 0.012 * s(i) + jumps[i % LF]],
    c1_hips: (i) => [0.45, 0.6 + 0.002 * Math.sin((2 * Math.PI * (i % LF)) / LF)],
    c1_thighs: (i) => [0.4, 0.68 + 0.002 * Math.cos((2 * Math.PI * (i % LF)) / LF)],
  };
  const ch = {};
  for (const [name, at] of Object.entries(parts)) {
    ch[`sem_${name}_x`] = channelOf(T.map((ms, i) => [ms, at(i)[0] + jit[i % LF][0]]));
    ch[`sem_${name}_y`] = channelOf(T.map((ms, i) => [ms, at(i)[1] + jit[i % LF][1]]));
    ch[`sem_${name}_n`] = channelOf(T.map((ms) => [ms, 0.03]));
  }
  ch.who_pair_proj = channelOf(T.map((ms, i) => [ms, 0.5 + 0.5 * s(i)]));
  return { run: { id: 'r', params: { axis: 'auto' }, scenes: [], channels: ch, notes: [], flips: [], range: { start: 0, end: T[N - 1] + 1 } }, truth: T.map((_, i) => s(i)) };
}
const corr = (a, b) => { let n = 0, sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) if (a[i] === a[i] && b[i] === b[i]) { n++; sa += a[i]; sb += b[i]; sab += a[i] * b[i]; saa += a[i] ** 2; sbb += b[i] ** 2; } return (sab - (sa * sb) / n) / Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n)); };
const D = [{ acts: ['penetration'] }];

test('an exact loop: every row\'s rhythm read at the loop length is ~1 (why the gate cannot tell clean from jagged)', () => {
  const { run } = loopScene(4), f = fusedChannel(run, { aspect: 16 / 9, derives: D });
  const rel = f.info[0].relations;
  assert.ok(rel.filter((x) => x.present > 0.5).every((x) => x.rhythm > 0.6), `rhythm at the loop for all: ${rel.map((x) => x.rhythm).join(' ')}`);
  assert.ok(Math.abs(f.info[0].periodMs - LOOP) < 80, `today's period is the loop (${f.info[0].periodMs} ms)`);
  assert.ok(rhythmOf([1, 2], 33).r === 0);
});

for (const k of [2, 3, 4]) {
  test(`${k} strokes per loop pass: read at loop / ${k}, the clean row carries the stroke, not the jagged tagged one`, () => {
    const { run, truth } = loopScene(k), today = fusedChannel(run, { aspect: 16 / 9, derives: D }), f = fusedChannel(run, { aspect: 16 / 9, derives: D, loops: [LOOP] });
    const inf = f.info[0], top = inf.relations[0];
    assert.equal(inf.loop?.k, k, `k found from the rows: ${JSON.stringify(inf.loop)}`);
    assert.ok(Math.abs(inf.periodMs - LOOP / k) < 0.2 * (LOOP / k), `the scene's period is the stroke: ${inf.periodMs} ms`);
    assert.ok(!/penis/.test(top.label), `the clean row leads: ${top.label} ${top.share} (today: ${today.info[0].relations[0].label} ${today.info[0].relations[0].share})`);
    const jag = inf.relations.find((x) => /penis/.test(x.label) && x.acts), jag0 = today.info[0].relations.find((x) => x.id === jag?.id);
    assert.ok(jag && jag.share < top.share && jag.share < jag0.share - 0.2, `the jagged tagged row loses its lead: ${jag?.share} (today ${jag0?.share})`);
    const r = Math.abs(corr(Array.from(f.v), truth)), r0 = Math.abs(corr(Array.from(today.v), truth));
    assert.ok(r > 0.9 && r >= r0, `fused vs the stroke r ${r.toFixed(3)} (today ${r0.toFixed(3)})`);
  });
}

test('one stroke per loop pass (k = 1): bit for bit today\'s result', () => {
  const { run } = loopScene(1), a = fusedChannel(run, { aspect: 16 / 9, derives: D }), b = fusedChannel({ ...run, channels: { ...run.channels } }, { aspect: 16 / 9, derives: D, loops: [LOOP] });
  assert.equal(b.info[0].loop, undefined, 'no stroke shorter than the loop');
  assert.deepEqual(Array.from(b.v), Array.from(a.v));
  assert.deepEqual(JSON.stringify(b.info), JSON.stringify(a.info));
});
