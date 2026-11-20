// Assist queue: generation, pairs, ordering, answer application, persistence, splits, suggestions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, pickPairs, directionSpans, flipHint, splitQuestion, blockOf, readBlock, decisionFor, agrees, scriptGaps, progress, LIFT, fmtClock, FALLBACK_CHOICES, RETRACK_CHOICES, coverRun, contactZone, snapPairs } from '../src/features/assist/model.js';
import { applyDirection, choiceFor, orientTo, applyActivity, applyDepth, applyFallback, cutPlan, invertSpan } from '../src/features/assist/apply.js';
import { suggest } from '../src/features/assist/learn.js';
import { isValid, normalize, posAt, slice } from '../src/lib/core/script.js';

// The synthetic video of dev/assets/make-assist-clip.sh: six 10 s scenes, depth d(t) (1 = deepest), still 54-58 s.
const F = [0.8, 1.0, 0.7, 0.9, 1.1, 0.8];
function depthAt(t) {
  const k = Math.min(5, Math.floor(t / 10000));
  let tl = (t - k * 10000) / 1000;
  if (k === 5) tl = tl < 4 ? tl : tl < 8 ? 4 : tl - 4;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * F[k] * tl);
}
const truthPos = (t) => 100 * (1 - depthAt(t));
/** Extremes (and hold ends) of the truth sampled per frame; flipped in the given [t0, t1) spans. */
function makeScript(flips = [], noise = 0, seed = 3) {
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const fr = 1000 / 30, pts = [];
  for (let k = 0; k * fr < 60000; k++) pts.push({ at: Math.round(k * fr), pos: truthPos(k * fr) });
  const keep = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = pts[i - 1].pos, b = pts[i + 1].pos;
    return (p.pos - a) * (b - p.pos) < 0 || (p.pos === a) !== (p.pos === b) || Math.floor(p.at / 10000) !== Math.floor(pts[i + 1].at / 10000) || Math.floor(p.at / 10000) !== Math.floor(pts[i - 1].at / 10000);
  });
  return normalize(keep.map((p) => {
    const f = flips.some(([a, b]) => p.at >= a && p.at < b);
    const v = Math.max(0, Math.min(100, p.pos + (noise ? (r() - 0.5) * noise : 0)));
    return { at: p.at, pos: f ? 100 - v : v };
  }));
}
const SCENES = Array.from({ length: 6 }, (_, k) => ({ t0: k * 10000, t1: (k + 1) * 10000 }));
const WRONG = [[10000, 20000], [35000, 40000], [40000, 50000]];
const input = (over = {}) => ({
  script: makeScript(WRONG), scenes: SCENES, frameMs: 1000 / 30,
  primary: { id: 'run1', name: '#1 sam2', overlays: true, scenes: SCENES.map((s, k) => ({ ...s, sign: k === 1 || k === 4 ? -1 : 1 })) },
  other: { id: 'run2', name: '#2 flow', script: makeScript([], 8) },
  events: [{ t0: 54000, t1: 58000, kind: 'still' }], plan: [], block: null, ...over,
});
/** Orientation of a script against the truth over [t0, t1): +1 right way round, -1 inverted. */
function orientation(script, t0, t1) {
  let s = 0;
  for (let t = t0 + 50; t < t1 - 50; t += 50) s += (posAt(script, t) - 50) * (truthPos(t) - 50);
  return Math.sign(s);
}
/** An oracle user: which frame of the pair is truly deeper. */
const oracle = (q, i = 0) => (depthAt(q.pairs[i].a.at) > depthAt(q.pairs[i].b.at) ? 'left' : 'right');

test('queue: direction per scene, scene 4 pre-split at the flip, ordered by value', () => {
  const qs = buildQueue(input());
  const dir = qs.filter((q) => q.kind === 'direction').sort((a, b) => a.t0 - b.t0);
  assert.equal(dir.length, 7);
  const cut = dir.find((q) => q.evidence.presplit)?.evidence.presplit;
  assert.ok(Math.abs(cut - 35000) < 800, 'pre-split near 35 s: ' + cut);
  for (let i = 1; i < qs.length; i++) assert.ok(qs[i - 1].value >= qs[i].value, 'sorted by value');
  assert.equal(qs[0].kind, 'direction');
  assert.ok(Math.abs(dir.reduce((s, q) => s + q.value, 0) - LIFT.direction) < 1e-9, 'direction values sum to the lift');
  for (const q of dir) {
    assert.ok(q.pairs.length >= 3, 'several pairs');
    for (const p of q.pairs) {
      assert.ok(p.a.at < p.b.at && p.a.at >= q.t0 && p.b.at < q.t1);
      assert.ok(Math.abs(p.a.pos - p.b.pos) > 60, 'large stroke');
    }
    assert.equal(q.state, 'open');
  }
  assert.equal(qs.filter((q) => q.kind === 'track').length, 6);
  assert.equal(qs.filter((q) => q.kind === 'activity').length, 1);
  assert.ok(qs.filter((q) => q.kind === 'depth').length >= 5);
  assert.equal(qs.at(-1).kind, 'depth');
});

test('pairs: consecutive opposite extremes, spread, best first', () => {
  const s = makeScript();
  const P = pickPairs(s, 0, 10000, { k: 5 });
  assert.equal(P.length, 5);
  for (let i = 1; i < P.length; i++) assert.ok(P[i - 1].score >= P[i].score);
  const bins = new Set(P.map((p) => Math.floor(p.a.at / 2000)));
  assert.ok(bins.size >= 4, 'spread over the span');
  assert.deepEqual(pickPairs([], 0, 1000), []);
});

test('oracle answers orient every span the right way; nothing outside a span changes', () => {
  let script = input().script;
  const qs = buildQueue(input()).filter((q) => q.kind === 'direction');
  assert.ok(SCENES.some((s) => orientation(script, s.t0, s.t1) < 0));
  for (const q of qs) {
    const before = script;
    const r = applyDirection(script, q, oracle(q));
    const outside = before.filter((a) => a.at < q.t0 || a.at >= q.t1);
    assert.ok(outside.every((a) => r.script.includes(a)), 'outside the span: same actions');
    if (r.flipped) for (const a of slice(before, q.t0, q.t1 - 1)) assert.equal(r.script.find((b) => b.at === a.at).pos, 100 - a.pos);
    else assert.equal(r.script, before);
    script = r.script;
    assert.ok(isValid(script));
    const again = applyDirection(script, q, oracle(q));
    assert.equal(again.script, script, 'idempotent');
    assert.equal(again.flipped, false);
  }
  for (const [t0, t1] of [[0, 10000], [10000, 20000], [20000, 30000], [30000, 35000], [36000, 40000], [40000, 50000], [50000, 60000]]) assert.equal(orientation(script, t0, t1), 1, `${t0}-${t1}`);
});

test('another pair of the same question gives the same result', () => {
  const q = buildQueue(input()).find((x) => x.kind === 'direction' && x.t0 === 10000);
  const s0 = input().script;
  const r0 = applyDirection(s0, q, oracle(q, 0), 0), r2 = applyDirection(s0, q, oracle(q, 2), 2);
  assert.deepEqual(r0.script, r2.script);
  assert.equal(r0.flipped, true);
});

test('decisions persist: re-asking finds them; a re-tracked (re-flipped) script gets a suggestion, not a silent re-apply', () => {
  let script = input().script;
  const qs = buildQueue(input());
  for (const q of qs.filter((x) => x.kind === 'direction')) {
    const r = applyDirection(script, q, oracle(q));
    script = r.script;
    Object.assign(q, { state: 'answered', answer: { choice: oracle(q), fact: r.fact, flipped: r.flipped } });
  }
  const block = readBlock(JSON.parse(JSON.stringify(blockOf(null, qs))));
  assert.equal(block.direction.length, 7);
  const again = buildQueue(input({ script, block }));
  const dir = again.filter((q) => q.kind === 'direction');
  assert.ok(dir.every((q) => q.state === 'answered' && q.memory), 'nothing asked again');
  // a new track with the old mistakes: the spans open again, with the remembered answer as suggestion
  const retracked = buildQueue(input({ block }));
  const open = retracked.filter((q) => q.kind === 'direction' && q.state === 'open');
  assert.equal(open.length, 3);
  assert.ok(open.every((q) => q.suggest?.flip === true && q.suggest.source === 'memory'));
  // the reapply command: orientTo puts every disagreeing span right
  const fixed = orientTo(input().script, block.direction);
  assert.equal(fixed.spans.length, 3);
  for (const s of SCENES) assert.ok(orientation(fixed.script, s.t0 + (s.t0 === 30000 ? 6000 : 0), s.t1) > 0);
  // an undone answer (live = false) is not persisted
  assert.equal(blockOf(null, qs, (q) => q.t0 !== 0).direction.length, 6);
});

test('readBlock drops broken entries', () => {
  const b = readBlock({ v: 1, direction: [{ t0: 0, t1: 10, deep: 1, shallow: 2 }, { t0: 5, t1: 1, deep: 1, shallow: 2 }, null], splits: [3, 'x'], track: [{ t0: 0, t1: 1, ghost: 'g', ok: 'yes' }] });
  assert.equal(b.direction.length, 1);
  assert.deepEqual(b.splits, [3]);
  assert.equal(b.track.length, 0);
  assert.deepEqual(readBlock(null).direction, []);
});

test('split: halves cover the span, a stored split cuts the scene, both halves are asked', () => {
  const script = input().script;
  const q = buildQueue(input({ other: null })).find((x) => x.kind === 'direction' && x.t0 === 30000);
  assert.equal(q.t1, 40000, 'no pre-split without a second run');
  const [a, b] = splitQuestion(q, 35100, script, 1000 / 30);
  assert.deepEqual([a.t0, a.t1, b.t0, b.t1], [30000, 35100, 35100, 40000]);
  assert.ok(a.pairs.length && b.pairs.length);
  assert.deepEqual(directionSpans({ scenes: SCENES, splits: [35100] }).map((s) => s.t0), [0, 10000, 20000, 30000, 35100, 40000, 50000]);
  const qs = buildQueue(input({ other: null, block: { v: 1, splits: [35100] } })).filter((x) => x.kind === 'direction');
  assert.equal(qs.length, 7);
  let s = script;
  for (const x of qs) s = applyDirection(s, x, oracle(x)).script;
  assert.equal(orientation(s, 36000, 40000), 1);
  assert.equal(orientation(s, 30000, 35000), 1);
});

test('flip hint needs a second signal that disagrees on one side only', () => {
  const s = input().script;
  assert.equal(flipHint(s, makeScript([], 8), 0, 10000), null);
  assert.equal(flipHint(s, makeScript([], 8), 10000, 20000), null, 'whole scene inverted: no change point');
  assert.ok(Math.abs(flipHint(s, makeScript([], 8), 30000, 40000) - 35000) < 800);
  assert.equal(flipHint(s, null, 30000, 40000), null);
});

test('activity: idle holds, carry keeps strokes, orgasm tremor; the plan gets one segment, overlaps trimmed', () => {
  const script = makeScript();
  const q = buildQueue(input({ script })).find((x) => x.kind === 'activity');
  assert.deepEqual([q.t0, q.t1, q.event], [54000, 58000, 'still']);
  const plan = [{ id: 'p', t0: 50000, t1: 56000, kind: 'penetration' }];
  const idle = applyActivity(script, plan, q, 'idle');
  const inside = slice(idle.script, 54001, 57999);
  assert.ok(new Set(inside.map((a) => a.pos)).size <= 1, 'a hold');
  assert.deepEqual(idle.plan.map((p) => [p.id, p.t0, p.t1]), [['p', 50000, 54000], ['assist-idle-54000', 54000, 58000]]);
  const carry = applyActivity(script, [], q, 'carry');
  const c = slice(carry.script, 54000, 58000);
  assert.ok(c.length >= 6, 'strokes carried: ' + c.length);
  assert.ok(Math.max(...c.map((a) => a.pos)) - Math.min(...c.map((a) => a.pos)) > 50);
  const climax = applyActivity(script, [], q, 'orgasm');
  assert.ok(slice(climax.script, 54000, 58000).length > 20, 'fast tremor');
  assert.ok(slice(climax.script, 54500, 57500).every((a) => a.pos <= 40), 'at the deep end');
  assert.equal(climax.segment.kind, 'orgasm');
  assert.equal(applyActivity(script, [], q, 'climax').segment.kind, 'orgasm', 'an old climax answer is an orgasm');
  for (const r of [idle, carry, climax]) {
    assert.ok(isValid(r.script));
    assert.deepEqual(r.script.filter((a) => a.at < 53000 || a.at > 59000), script.filter((a) => a.at < 53000 || a.at > 59000), 'outside untouched');
  }
  // planned spans are not asked again
  assert.equal(buildQueue(input({ script, plan: idle.plan })).filter((x) => x.kind === 'activity').length, 0);
  assert.deepEqual(cutPlan([{ id: 'a', t0: 0, t1: 100 }], 20, 30).map((p) => [p.id, p.t0, p.t1]), [['a', 0, 20], ['a-b', 30, 100]]);
});

test('gaps in the script become activity questions', () => {
  const s = normalize([...makeScript().filter((a) => a.at < 20000 || a.at > 26000)]);
  const g = scriptGaps(s);
  assert.equal(g.length, 2, 'the cut and the still hold');
  assert.ok(g[0].t0 < 20000 && g[0].t1 > 26000);
  const qs = buildQueue(input({ script: s, events: [] })).filter((q) => q.kind === 'activity');
  assert.deepEqual(qs.map((q) => q.event), ['gap', 'gap']);
  assert.ok(qs.some((q) => q.t0 < 20000 && q.t1 > 26000));
});

test('depth: remaps the span only', () => {
  const script = makeScript();
  const q = buildQueue(input({ script })).find((x) => x.kind === 'depth' && x.t0 === 0);
  const next = applyDepth(script, q, 'shallow');
  const inside = slice(next, 0, 9999);
  assert.ok(Math.min(...inside.map((a) => a.pos)) >= 60);
  assert.deepEqual(next.filter((a) => a.at >= 10000), script.filter((a) => a.at >= 10000));
  assert.equal(applyDepth(next, q, 'shallow'), next, 'already that range: the same array (no undo entry)');
});

test('track check: only with overlays; a stored answer is remembered per run', () => {
  assert.equal(buildQueue(input({ primary: { id: 'run1', overlays: false, scenes: [] } })).filter((q) => q.kind === 'track').length, 0);
  const block = { v: 1, track: [{ t0: 20000, t1: 30000, ghost: 'run1', ok: false }] };
  const qs = buildQueue(input({ block })).filter((q) => q.kind === 'track');
  assert.equal(qs.find((q) => q.t0 === 20000).state, 'answered');
  assert.equal(buildQueue(input({ block, primary: { id: 'run3', overlays: true, scenes: [] } })).filter((q) => q.kind === 'track' && q.state === 'open').length, 6);
});

test('fallback replaces the span with the other run', () => {
  const s = input().script, other = makeScript();
  const next = applyFallback(s, other, 20000, 30000);
  assert.deepEqual(slice(next, 20000, 29999), slice(other, 20000, 29999));
  assert.deepEqual(next.filter((a) => a.at < 20000), s.filter((a) => a.at < 20000));
});

test('suggestions: a cue that predicted 3 of 3 answers, or a look-alike scene; never from too few answers', () => {
  const qs = buildQueue(input()).filter((q) => q.kind === 'direction').sort((a, b) => a.t0 - b.t0);
  const samples = qs.slice(0, 3).map((q) => ({ flip: q.cues.sign < 0, cues: q.cues, thumb: null, label: q.label }));
  const s5 = suggest(qs[5], samples);   // 40-50 s, sign -1
  assert.equal(s5.flip, true);
  assert.equal(s5.source, 'sign');
  assert.equal(suggest(qs[6], samples).flip, false);
  assert.equal(suggest(qs[5], samples.slice(0, 2)), null);
  const thumb = new Uint8Array(48).fill(100);
  const look = suggest(qs[5], [{ flip: false, cues: {}, thumb: thumb.map((v) => v + 3), label: 'scene 1' }], thumb);
  assert.deepEqual([look.flip, look.source], [false, 'thumb']);
  // choiceFor maps a flip suggestion to the key for the pair on screen
  const q = qs[1], c = choiceFor(input().script, q, 0, true);
  assert.equal(c, oracle(q));
});

test('progress counts', () => {
  const qs = buildQueue(input());
  qs[0].state = 'answered'; qs[1].state = 'skipped';
  const p = progress(qs);
  assert.equal(p.total, qs.length);
  assert.equal(p.done, 2);
  assert.ok(Math.abs(p.gain - qs[0].value) < 1e-12);
  assert.ok(agrees([{ at: 0, pos: 0 }, { at: 100, pos: 100 }], { deep: 0, shallow: 100 }));
  assert.ok(decisionFor([{ t0: 0, t1: 100 }], 10, 90));
  assert.equal(invertSpan([{ at: 0, pos: 10 }, { at: 10, pos: 20 }], 0, 10)[1].pos, 20, 't1 is exclusive');
});

test('fmtClock: 2 decimals tell short-span frames apart; padding holds', () => {
  assert.equal(fmtClock(150), '0:00.1');   // 1 decimal: 50 / 150 ms both read 0:00.1 in a 0.6 s filmstrip
  const six = [50, 150, 250, 350, 450, 550].map((t) => fmtClock(t, 2));
  assert.deepEqual(six, ['0:00.05', '0:00.15', '0:00.25', '0:00.35', '0:00.45', '0:00.55']);
  assert.equal(fmtClock(65432, 2), '1:05.43');
});

test('a rejected track with no other run still has a way out: re-track or keep', () => {
  assert.deepEqual(RETRACK_CHOICES.map((c) => [c.id, c.key]), [['retrack', 'R'], ['keep', 'N']]);
  assert.ok(FALLBACK_CHOICES.some((c) => c.id === 'use'));
});

test('track check: per scene the run that covers it most; scenes no run covers get none; frames only where the run has data', () => {
  const run7 = { id: 'run7', name: '#7 sam2', overlays: true, range: { t0: 0, t1: 26500 }, scenes: [] };
  const run8 = { id: 'run8', name: '#8 sam2', overlays: true, range: { t0: 24000, t1: 45000 }, scenes: [] };
  const flow = { id: 'run9', name: '#9 flow', overlays: false, range: { t0: 0, t1: 60000 }, scenes: [] };
  const qs = buildQueue(input({ primary: run7, runs: [run7, run8, flow] })).filter((q) => q.kind === 'track').sort((a, b) => a.t0 - b.t0);
  assert.deepEqual(qs.map((q) => [q.t0, q.ghost]), [[0, 'run7'], [10000, 'run7'], [20000, 'run7'], [30000, 'run8'], [40000, 'run8']], 'no check for 50-60 s');
  const q20 = qs.find((q) => q.t0 === 20000);   // run7 covers 6.5 s of it, run8 6 s
  assert.ok(q20.times.every((t) => t >= 20000 && t < 26500), 'frames inside the run: ' + q20.times);
  assert.equal(q20.other, 'run9', 'fallback: the other run covering the scene most (the flow run)');
  assert.equal(qs.find((q) => q.t0 === 40000).times.every((t) => t < 45000), true);
  assert.equal(coverRun([run7, run8], 50000, 60000), null);
  assert.equal(coverRun([{ id: 'a', range: { t0: 0, t1: 10 } }, { id: 'b', range: { t0: 0, t1: 10 } }], 0, 10).id, 'b', 'a tie goes to the later run');
});

test('pairs never straddle a plan segment / event span boundary and prefer pairs away from it', () => {
  const script = makeScript();
  const cut = 44000;   // e.g. climax -> afterglow inside scene 5
  const P = pickPairs(script, 40000, 50000, { cuts: [cut] });
  assert.ok(P.length >= 3);
  for (const p of P) assert.ok(p.b.at + 250 <= cut || p.a.at - 250 >= cut, `pair ${p.a.at}-${p.b.at} straddles ${cut}`);
  const free = pickPairs(script, 40000, 50000);
  assert.ok(free.some((p) => p.a.at - 250 < cut && p.b.at + 250 > cut) || free.length > 0);
  // the best pair sits further from the boundaries than the worst one
  const dist = (p) => Math.min(...[40000, 50000, cut].map((e) => (e < p.a.at ? p.a.at - e : e > p.b.at ? e - p.b.at : 0)));
  assert.ok(dist(P[0]) >= dist(P.at(-1)));
  // through the queue: plan segment edges are boundaries for direction pairs, and splits keep them
  const plan = [{ id: 'c', t0: 38000, t1: cut, kind: 'climax' }, { id: 'a', t0: cut, t1: 52000, kind: 'afterglow' }];
  const q = buildQueue(input({ script, plan })).find((x) => x.kind === 'direction' && x.t0 === 40000);
  assert.deepEqual(q.cuts, [cut]);
  for (const p of q.pairs) assert.ok(p.b.at + 250 <= cut || p.a.at - 250 >= cut);
  for (const h of splitQuestion(q, 47000, script, 1000 / 30)) for (const p of h.pairs) assert.ok(p.b.at + 250 <= cut || p.a.at - 250 >= cut);
  // event spans (still / carry) count too
  const qe = buildQueue(input({ script, events: [{ t0: 42000, t1: 46000, kind: 'still' }] })).find((x) => x.kind === 'direction' && x.t0 === 40000);
  for (const p of qe.pairs) for (const c of [42000, 46000]) assert.ok(p.b.at + 250 <= c || p.a.at - 250 >= c);
});

test('contactZone: contact tags only, far box dropped, padded and clamped, null on nothing', () => {
  assert.equal(contactZone([{ tag: 'open_mouth', score: 0.9, box: [0.4, 0.4, 0.1, 0.1] }, { tag: 'penis', score: 0.2, box: [0.4, 0.4, 0.1, 0.1] }]), null);
  assert.equal(contactZone([]), null);
  const z = contactZone([{ tag: 'penetration', score: 0.9, box: [0.4, 0.4, 0.1, 0.1] }, { tag: 'face', score: 1, box: [0, 0, 0.1, 0.1] }]);
  assert.ok(Math.abs(z.x - 0.3) < 1e-9 && Math.abs(z.w - 0.3) < 1e-9);   // 0.15 padded -> min side 0.3
  const far = contactZone([{ tag: 'penis', score: 0.9, box: [0.4, 0.4, 0.2, 0.2] }, { tag: 'anus', score: 0.3, box: [0.9, 0.9, 0.1, 0.1] }]);
  assert.ok(far.x + far.w <= 1 && Math.abs(far.w - 0.3) < 1e-9);   // far box dropped
  const edge = contactZone([{ tag: 'vulva', score: 0.8, box: [0.8, 0.8, 0.2, 0.2] }]);
  assert.ok(edge.x >= 0 && edge.x + edge.w <= 1 && edge.y + edge.h <= 1);
});

test('snapPairs: times move to the raw turn within tol, never beyond; pos stays', () => {
  const raw = [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 1500, pos: 0 }, { at: 2000, pos: 100 }];
  const pairs = [{ a: { at: 1060, pos: 90 }, b: { at: 1700, pos: 5 } }];
  const [p] = snapPairs(pairs, raw, 120);
  assert.deepEqual([p.a.at, p.a.pos], [1000, 90]);
  assert.equal(p.b.at, 1700);   // nearest turn 200 ms away: unchanged
  assert.equal(snapPairs(pairs, null, 120), pairs);
});
