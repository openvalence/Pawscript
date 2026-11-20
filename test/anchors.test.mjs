// paw-wg2d / paw-ze8n: anchors (lib/anchors.js). The shot's list edits (any number of each kind), the run scene's derive carrying
// them, and fusion taking them as LOCAL evidence: on a shot that "starts off then corrects" (experiments/anchors/measure.mjs)
// anchors on the bad part fix it and leave the good part exactly as it was; anchors on the good part change nothing at all;
// no step at a section's edge; a conflict stays in its section; autorange takes 0 / 100 around the anchors only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shotAnchors, anchorsOf, putAnchor, moveAnchor, anchorLocal, anchorsText, sectionText } from '../src/lib/anchors.js';
import { runDerives } from '../src/lib/rederive.js';
import { rangePlan } from '../src/lib/autorange.js';
import { channelPatch } from '../src/lib/runs-channel.js';
import { CASES, CUT, score, anchorsFor, fused } from '../experiments/anchors/measure.mjs';
import { ASPECT, T, N } from './fusion-synth.mjs';

const shots = () => [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 3000, anchors: [{ ms: 2000, pos: 100 }, { ms: 5000, pos: 0 }, { ms: 1500, pos: 7 }] }];
const same = (a, b, i0 = 0, i1 = a.length) => { for (let i = i0; i < i1; i++) if (!Object.is(a[i], b[i])) return i; return -1; };

test('a shot keeps only its own clean anchors; anchorsOf lists them all', () => {
  assert.deepEqual(shotAnchors(shots()[1]), [{ ms: 2000, pos: 100 }]);   // outside the shot / not 0, 50, 100: dropped
  assert.deepEqual(anchorsOf({ scenes: shots() }), [{ shot: 1, ms: 2000, pos: 100 }]);
});

test('any number of each kind: the key on the same frame takes it off, on any other frame adds one more', () => {
  let r = putAnchor(shots(), 1200, 0, 16);
  assert.equal(r.did, 'add');
  r = putAnchor(r.list, 1233, 0, 16);   // the next frame: another fully in
  assert.equal(r.did, 'add');
  r = putAnchor(r.list, 1300, 0, 16);
  assert.deepEqual(shotAnchors(r.list[1]).map((a) => [a.ms, a.pos]), [[1200, 0], [1233, 0], [1300, 0], [2000, 100]]);
  r = putAnchor(r.list, 1240, 50, 16);   // another kind on that frame: replaced
  assert.equal(r.did, 'replace');
  r = putAnchor(r.list, 1300, 0, 16);   // the same kind on its frame: off
  assert.equal(r.did, 'remove');
  assert.deepEqual(shotAnchors(r.list[1]).map((a) => a.pos), [0, 50, 100]);
  assert.equal(putAnchor(shots(), 9000, 0), null);
  assert.deepEqual(shotAnchors(moveAnchor(shots(), { ms: 2000, pos: 100 }, 9999)[1]), [{ ms: 2999, pos: 100 }]);
  assert.equal(moveAnchor(shots(), { ms: 2000, pos: 100 }, null)[1].anchors, undefined);
});

test('a run scene carries every anchor inside it (the shots of one tracked scene share them)', () => {
  const run = { id: 'r', scenes: [{ start_ms: 0, end_ms: 3000 }], range: { start: 0, end: 3000 } };
  const sc = [{ start_ms: 0, end_ms: 1500, anchors: [{ ms: 400, pos: 0 }] }, { start_ms: 1500, end_ms: 3000, anchors: [{ ms: 2000, pos: 100 }] }];
  assert.deepEqual(runDerives(run, sc)[0].anchors, [{ ms: 400, pos: 0 }, { ms: 2000, pos: 100 }]);
  assert.equal(runDerives(run, sc.map(({ anchors: _, ...s }) => s))[0].anchors, undefined);   // eslint-disable-line no-unused-vars
});

for (const id of ['flipStart', 'lagStart']) test(`starts off then corrects (${id}): anchors on the bad part fix it, the good part stays exactly as it was, no step at the edge`, () => {
  const run = CASES[id](), f0 = fused(run, null), f = fused(run, anchorsFor(2, 0, 0, CUT));
  const b0 = score(f0.v, 0, CUT), b1 = score(f.v, 0, CUT), g0 = score(f0.v, CUT, N), g1 = score(f.v, CUT, N);
  assert.ok(b1.frames <= 1.6 && b1.frames < b0.frames / 2 && b1.pos < b0.pos, `bad part: ${JSON.stringify(b0)} -> ${JSON.stringify(b1)}`);
  assert.ok(g1.frames <= g0.frames + 0.1 && g1.pos <= g0.pos + 0.5, `good part: ${JSON.stringify(g0)} -> ${JSON.stringify(g1)}`);
  const sc = f.info[0].anchors.sections, end = Math.max(...sc.map((s) => s.t1)), q1 = T.findIndex((t) => t > end);
  assert.ok(end < T[CUT] + 1200, `the anchors reach ${end} ms, the automatic solve corrects at ${T[CUT]}`);
  assert.equal(same(f.v, f0.v, q1), -1, 'past the anchored section: the automatic channel, sample for sample');
  assert.equal(same(f.timing, f0.timing, q1), -1);
  let dmax = 0, dedge = 0;
  for (let i = 1; i < N; i++) { const d = Math.abs(f0.v[i] - f0.v[i - 1]); if (d > dmax) dmax = d; }
  for (let i = Math.max(1, q1 - 45); i < Math.min(N, q1 + 15); i++) dedge = Math.max(dedge, Math.abs(f.v[i] - f.v[i - 1]));
  assert.ok(dedge <= 1.5 * dmax, `no jump at the section's edge: ${dedge.toFixed(3)} vs ${dmax.toFixed(3)}`);
  assert.ok(sectionText(sc[0]).length > 10 && anchorsText(f.info[0].anchors).includes('changed'));
});

test('anchors that agree with the automatic solve change nothing anywhere (byte for byte)', () => {
  for (const id of ['flipStart', 'lagStart']) {
    // (2 s clear of where the automatic solve corrects itself: right there its turns are still off, and an anchor pulls them in)
    const run = CASES[id](), f0 = fused(run, null), f = fused(run, anchorsFor(3, 0, CUT + 60, N));
    assert.equal(same(f.v, f0.v), -1, id);
    assert.equal(same(f.timing, f0.timing), -1, id);
    assert.ok(f.info[0].anchors.sections.every((s) => s.unchanged));
  }
});

test('an anchor placed 2 frames wrong degrades gently and never touches the good part', () => {
  for (const id of ['flipStart', 'lagStart']) for (const w of [2, -2]) {
    const run = CASES[id](), f0 = fused(run, null), f = fused(run, anchorsFor(2, w, 0, CUT)), b0 = score(f0.v, 0, CUT), b1 = score(f.v, 0, CUT);
    assert.ok(b1.frames <= 2 && b1.frames < b0.frames, `${id} ${w}: ${b1.frames}`);
    assert.ok(score(f.v, CUT, N).frames <= score(f0.v, CUT, N).frames + 0.1);
  }
});

test('anchors within a window that no single motion meets: a compromise in their section only, said so', () => {
  const run = CASES.flipStart(), f0 = fused(run, null), good = anchorsFor(2, 0, 0, CUT), ins = good.filter((a) => a.pos === 0);
  const clash = [...good, { ms: ins[0].ms + 300, pos: 0 }, { ms: ins[0].ms + 433, pos: 0 }];   // two more "fully in" half a stroke later
  const f = fused(run, clash), sc = f.info[0].anchors.sections;
  assert.ok(sc.some((s) => s.compromise), JSON.stringify(sc));
  assert.match(sectionText(sc.find((s) => s.compromise)), /disagree with each other/);
  const q1 = T.findIndex((t) => t > Math.max(...sc.map((s) => s.t1)));
  assert.equal(same(f.v, f0.v, q1), -1, 'the good part untouched');
});

test('which way up falls out locally: a scene played upside down is solved upside down there', () => {
  const run = CASES.flipStart(), f = fused(run, anchorsFor(2, 0, 0, CUT), { signs: () => -1 });
  assert.ok(score(Float32Array.from(f.v, (x) => -x), 0, CUT).frames <= 1, 'the bad part as it plays');
  const f0 = fused(run, null);
  assert.ok(score(Float32Array.from(f.v, (x) => -x), CUT, N).frames >= score(f0.v, CUT, N).frames, 'the good part as the automatic solve had it (upside down as played: untouched)');
});

test('no anchors = the automatic solution exactly', () => {
  const run = CASES.lag3(), a = fused(run, null), b = fused(run, []), c = fusedChannelOf(run);
  assert.equal(same(b.v, a.v), -1);
  assert.equal(same(c.v, a.v), -1);
  assert.equal(a.info[0].anchors, undefined);
  assert.equal(anchorLocal({ t: [0, 1], v: [0, 1] }, []), null);
});
const fusedChannelOf = (run) => fused(run, null, { derives: [{}] });

test('through the run compose: a flipped stretch over anchors and F are read the way the script plays', () => {
  const base = { ...CASES.flipStart(), points0: { at: new Float64Array(), pos: new Float64Array() }, scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }] };
  const cp = (r, an, flips) => channelPatch(r, 'fused', {}, [], { aspect: ASPECT, derives: [{ detail: [], ...(an ? { anchors: an } : {}) }], ...(flips ? { flips } : {}) });
  const an = anchorsFor(2, 0, 0, CUT);
  const a = cp(base), b = cp(base, an);
  assert.equal(a.channels.fused.info[0].anchors, undefined);
  assert.ok(b.channels.fused.info[0].anchors.sections.some((s) => !s.unchanged));
  assert.notDeepEqual(Array.from(b.points0.at), Array.from(a.points0.at));
  // the owner flipped the bad part himself (a stretch): his anchors there now agree with how it plays: nothing to change
  const st = cp(base, an, [[0, T[CUT]]]);
  assert.ok(st.channels.fused.info[0].anchors.sections.every((s) => s.unchanged), JSON.stringify(st.channels.fused.info[0].anchors.sections));
  // F: the anchored section still plays as the anchors say, the rest flips as F says
  const f = cp({ ...base, flips: [0] }, an), lane = (p, i) => p.lane.v[i];
  let agree = 0, n = 0;
  for (let i = 30; i < CUT - 40; i++) { agree += (lane(f, i) - 0.5) * (lane(b, i) - 0.5) > 0 ? 1 : 0; n++; }
  assert.ok(agree / n > 0.8, `the anchored section's played trace agrees with and without F: ${(agree / n).toFixed(2)}`);
});

test('autorange: fully in / fully out reach 0 / 100 around the anchors, the rest of the shot keeps its band', () => {
  const script = Array.from({ length: 80 }, (_, i) => ({ at: 100 + i * 240, pos: i % 2 ? 70 : 40 }));
  const sc = [{ start_ms: 0, end_ms: 20000, tags: ['penetration'] }], opt = { linked: () => true };
  const plain = rangePlan(sc, script, opt)[0];
  assert.ok(plain.lo > 0, 'the policy alone starts shallow');
  const row = rangePlan([{ ...sc[0], anchors: [{ ms: 2000, pos: 0 }, { ms: 2200, pos: 100 }] }], script, opt)[0];
  const inside = row.pieces.find((p) => p.t0 <= 2000 && p.t1 >= 2200), far = row.pieces.find((p) => p.t0 > 5000);
  assert.equal(inside.lo, 0); assert.equal(inside.hi, 100);
  assert.ok(far.lo > 0, `past the anchors' reach the policy band: ${JSON.stringify(row.pieces)}`);
  assert.match(row.reason, /anchored fully in/);
  const manual = rangePlan([{ ...sc[0], range: { lo: 30, hi: 80 }, anchors: [{ ms: 2000, pos: 0 }] }], script, opt)[0];
  assert.ok(manual.pieces.every((p) => p.lo >= 30), 'a hand-set band still wins');
});
