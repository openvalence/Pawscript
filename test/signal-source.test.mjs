// signal-source.js (paw-9qm): a shot's source / against, range overrides spliced in without a jump, the pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spanClean, signalClean, signalSpans, setSignalSpan, spanAt, resolveSource, canSource, pairOf, fusionInput, splice, BLEND_MS } from '../src/lib/signal-source.js';
import { channelPatch, pointsFromChannel, relChannel } from '../src/lib/runs-channel.js';
import { deriveClean } from '../src/lib/rederive.js';
import { canFuse, fusedChannel } from '../src/lib/fusion.js';
import { channelOf } from '../src/lib/runs.js';
import { normScenes } from '../src/features/timeline/shots.js';

const FPS = 30, N = 600, A = 16 / 9;   // 20 s
const T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
const stroke = (ms) => Math.sin((2 * Math.PI * ms) / 1000);
/** Two characters: c1 hips strokes against c2 hips; c1 penis rides c1 hips; a camera drift on everything. */
function run() {
  const ch = {}, put = (name, f) => {
    ch[`sem_${name}_x`] = channelOf(T.map((ms) => [ms, f(ms)[0]]));
    ch[`sem_${name}_y`] = channelOf(T.map((ms) => [ms, f(ms)[1]]));
    ch[`sem_${name}_n`] = channelOf(T.map((ms) => [ms, 0.03]));
  };
  const cam = (ms) => [0.02 * Math.sin(ms / 3100), 0.02 * Math.cos(ms / 2300)];
  put('c1_hips', (ms) => [0.4 + cam(ms)[0], 0.45 - 0.03 * stroke(ms) + cam(ms)[1]]);
  put('c1_penis', (ms) => [0.42 + cam(ms)[0], 0.5 - 0.03 * stroke(ms) + cam(ms)[1]]);
  put('c2_hips', (ms) => [0.5 + cam(ms)[0], 0.6 + 0.02 * stroke(ms) + cam(ms)[1]]);
  ch.sem_c1_hips_proj = channelOf(T.map((ms) => [ms, 0.5 + 0.5 * stroke(ms)]));
  ch.who_pair_proj = channelOf(T.map((ms) => [ms, 0.5 + 0.5 * stroke(ms)]));
  const pts = pointsFromChannel({ channels: ch, scenes: [] }, 'sem_c1_hips_proj');
  return { id: 'r', params: { axis: 'auto' }, scenes: [], range: { start: 0, end: T[N - 1] + 1 }, channels: ch, notes: [], channel: 'primary', points0: pts, points0Primary: pts, samples: { t: Float64Array.from(T), v: Float32Array.from(T, (ms) => 0.5 + 0.5 * stroke(ms)) } };
}
const pts = (p) => Array.from(p.at, (a, k) => `${a}:${p.pos[k]}`);

test('range overrides: clean, set over a range, cut by a later one, move, remove; clipped to their scene', () => {
  assert.equal(spanClean({ t0: 5, t1: 5, source: 'fused' }), null);
  assert.equal(spanClean({ t0: 0, t1: 9 }), null, 'nothing to override');
  assert.deepEqual(spanClean({ t0: 0.4, t1: 9, source: 'fused', against: 'camera', cam: { mode: 'auto' } }), { t0: 0, t1: 9, source: 'fused', against: 'camera', cam: { mode: 'auto', strength: 100, source: 'background', smoothMs: 0 } });
  assert.equal(signalClean({ spans: [{ t0: 1, t1: 2, source: '<bad>' }] }), undefined);
  const shots = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000, join: true }, { start_ms: 2000, end_ms: 3000 }];
  let L = setSignalSpan(shots, { t0: 500, t1: 2500 }, { source: 'fused' });
  assert.deepEqual(signalSpans(L), [{ t0: 500, t1: 2000, source: 'fused' }, { t0: 2000, t1: 2500, source: 'fused' }], 'split at the scene edge');
  assert.deepEqual(L[0].signal, L[1].signal, 'a scene fact: on every shot of the scene');
  L = setSignalSpan(L, { t0: 800, t1: 1200 }, { against: 'none' });
  assert.deepEqual(signalSpans(L).map((s) => [s.t0, s.t1]), [[500, 800], [800, 1200], [1200, 2000], [2000, 2500]]);
  assert.equal(spanAt(signalSpans(L), 900).against, 'none');
  L = setSignalSpan(L, { t0: 700, t1: 1200 }, { against: 'none' }, { t0: 800, t1: 1200 });   // its start dragged left
  assert.deepEqual(signalSpans(L).map((s) => [s.t0, s.t1]), [[500, 700], [700, 1200], [1200, 2000], [2000, 2500]]);
  L = setSignalSpan(L, { t0: 700, t1: 1200 }, null, { t0: 700, t1: 1200 });
  assert.deepEqual(signalSpans(L).map((s) => [s.t0, s.t1]), [[500, 700], [1200, 2000], [2000, 2500]]);
  assert.equal(setSignalSpan(L, { t0: 5000, t1: 6000 }, { source: 'fused' }), L, 'outside every shot: the same list');
  // a merge of two scenes keeps both scenes' overrides
  const M = normScenes(L.map((s, k) => (k === 2 ? { ...s, join: true } : s)));
  assert.deepEqual(signalSpans(M).map((s) => [s.t0, s.t1]), [[500, 700], [1200, 2000], [2000, 2500]]);
});

test('a shot source / against survives deriveClean; against a part makes a single part a pair', () => {
  assert.deepEqual(deriveClean({ source: 'rel:sem_c1_penis:sem_c2_hips', against: 'sem_c2_hips' }), { source: 'rel:sem_c1_penis:sem_c2_hips', against: 'sem_c2_hips' });
  assert.equal(deriveClean({ against: 'camera' }), null, 'camera is the default');
  assert.equal(deriveClean({ source: 'x y' }), null);
  const r = run();
  assert.equal(resolveSource(r, 'sem_c1_hips_proj', 'sem_c2_hips'), 'rel:sem_c1_hips:sem_c2_hips');
  assert.equal(resolveSource(r, 'fused', 'sem_c2_hips'), 'fused');
  assert.equal(resolveSource(r, 'sem_c1_hips_proj', 'sem_nope'), 'sem_c1_hips_proj');
  assert.equal(resolveSource(r, 'sem_c2_hips_proj', 'sem_c2_hips'), 'sem_c2_hips_proj', 'not against itself');
  assert.deepEqual(pairOf('rel:sem_c1_penis:sem_c2_hips'), { a: 'sem_c1_penis', b: 'sem_c2_hips' });
  assert.equal(pairOf('rel:sem_a:sem_a'), null);
  assert.ok(canSource(r, 'rel:sem_c1_penis:sem_c2_hips') && !canSource(r, 'rel:sem_c1_penis:sem_x') && canSource(r, 'fused', canFuse));
});

test('channelPatch: no source / override = as before; a shot pair = that pair\'s points', () => {
  const r = run(), before = channelPatch(r, 'sem_c1_hips_proj', {}, [], { aspect: A });
  const same = channelPatch(r, 'sem_c1_hips_proj', {}, [], { aspect: A, derives: [], spans: [] });
  assert.deepEqual(pts(same.points0), pts(before.points0));
  const id = 'rel:sem_c1_penis:sem_c2_hips', p = channelPatch(r, 'sem_c1_hips_proj', {}, [], { aspect: A, derives: [{ source: id }] });
  const ref = pointsFromChannel({ ...r, channels: { ...r.channels, [id]: relChannel(r, 'sem_c1_penis', 'sem_c2_hips', { aspect: A }) } }, id);
  assert.deepEqual(pts(p.points0), pts(ref), 'the pair\'s own points');
  assert.equal(p.sceneChannels[0], id);
  assert.ok(p.channels[id], 'the pair channel is handed back (the lane draws it)');
  // against a part: the single part becomes the pair part:against
  const q = channelPatch(r, 'sem_c1_hips_proj', {}, [], { aspect: A, derives: [{ against: 'sem_c2_hips' }] });
  assert.equal(q.sceneChannels[0], 'rel:sem_c1_hips:sem_c2_hips');
});

test('a range override changes its span only and the joins do not jump', () => {
  const r = run(), base = channelPatch(r, 'sem_c1_hips_proj', {}, [], { aspect: A });
  // inside 6..12 s the base is wrong (flat); the override takes the pair there
  r.channels.sem_c1_hips_proj = channelOf(T.map((ms) => [ms, ms >= 6000 && ms < 12000 ? 0.5 : 0.5 + 0.5 * stroke(ms)]));
  const broken = channelPatch(r, 'sem_c1_hips_proj', {}, [], { aspect: A });
  const span = { t0: 6000, t1: 12000, source: 'rel:sem_c1_hips:sem_c2_hips' };
  const fixed = channelPatch(r, 'sem_c1_hips_proj', {}, [], { aspect: A, spans: [span] });
  const out = (p, f) => pts({ at: p.at.filter((a) => f(a)), pos: p.pos.filter((_, k) => f(p.at[k])) });
  const far = (a) => a < 6000 - BLEND_MS - 400 || a >= 12000 + BLEND_MS + 400;
  assert.deepEqual(out(fixed.points0, far), out(broken.points0, far), 'outside the span: the same points');
  const inside = (p) => Array.from(p.at).filter((a) => a >= 6500 && a < 11500).length;
  assert.ok(inside(broken.points0) < 3 && inside(fixed.points0) >= 9, `strokes come back inside (${inside(broken.points0)} -> ${inside(fixed.points0)})`);
  assert.ok(inside(base.points0) - inside(fixed.points0) <= 1);
  // the spliced signal has no jump at the span's ends: its largest step there is a stroke's, not a cut's
  const lane = fixed.lane, steps = [];
  for (let j = 1; j < lane.t.length; j++) if (Math.abs(lane.t[j] - 6000) < 400 || Math.abs(lane.t[j] - 12000) < 400) steps.push(Math.abs(lane.v[j] - lane.v[j - 1]));
  const strokeStep = (2 * Math.PI * 0.5) / FPS;   // the steepest step of a full 0..1 stroke at 1 Hz
  assert.ok(Math.max(...steps) < 1.5 * strokeStep, 'no jump at the joins: ' + Math.max(...steps));
});

test('splice maps the override onto the base range, aligns its sign and cross-fades', () => {
  const t = Float64Array.from({ length: 101 }, (_, i) => i * 10), base = { t, v: Float32Array.from(t, () => 5) };
  const alt = { t, v: Float32Array.from(t, (x) => -x) };
  base.v[0] = 0; base.v[100] = 10;   // the base's range 0..10
  const s = splice(base, [{ t0: 200, t1: 800, ch: alt }], { blendMs: 100 });
  assert.equal(s.v[10], 5, 'outside: the base');
  assert.ok(Math.abs(s.v[20] - 5) < 1e-6, 'at the start of the span: still the base (weight 0)');
  for (let j = 31; j < 70; j++) assert.ok(s.v[j] >= 0 && s.v[j] <= 10, 'mapped into the base range');
  let jump = 0;
  for (let j = 2; j < 100; j++) jump = Math.max(jump, Math.abs(s.v[j] - s.v[j - 1]));   // (the base's own steps at 0 and 100 aside)
  assert.ok(jump < 1.5, 'cross-faded: ' + jump);
});

test('fusionInput: nothing set = the same run; against a part = the others relative to it, that part gone there', () => {
  const r = run();
  assert.equal(fusionInput(r, [], A), r);
  const q = fusionInput(r, [{ against: 'sem_c2_hips' }], A);
  assert.ok(q.channels.sem_c2_hips_x.v.every((x) => x !== x), 'the reference part is absent');
  const j = 100, d = q.channels.sem_c1_hips_y.v[j] - 0.5, want = r.channels.sem_c1_hips_y.v[j] - r.channels.sem_c2_hips_y.v[j];
  assert.ok(Math.abs(d - want) < 1e-6, 'c1 hips relative to c2 hips');
  const f = fusedChannel(q, { aspect: A });
  assert.ok(f && f.info[0].candidates.every((c) => !c.parts.includes('c2_hips')), 'fused without the reference part');
});

test('Smart stroke with an explicit pair source takes the pair through the strokes step', () => {
  const r = run(), id = 'rel:sem_c1_penis:sem_c2_hips';
  const sm = channelPatch(r, 'primary', {}, [], { aspect: A, derives: [{ smart: true }] });
  const smPair = channelPatch(r, 'primary', {}, [], { aspect: A, derives: [{ smart: true, source: id }] });
  assert.equal(sm.sceneChannels[0], 'fused');
  assert.equal(smPair.sceneChannels[0], id);
  assert.ok(smPair.whys, 'the strokes step ran (its whys)');
});
