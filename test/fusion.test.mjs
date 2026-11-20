// fusion.js: many tracked parts -> one stroke signal (paw-e3i, redesigned paw-iasp). Synthetic scenes with a known stroke
// (here and test/fusion-synth.mjs: one per design point; experiments/fusion/RESULTS.md has the old fusion failing them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusedChannel, fuseScene, canFuse, padGain, FUSE, ROLE_BODY, TWO_ACTS } from '../src/lib/fusion.js';
import { fuseClean } from '../src/lib/rederive.js';
import { spanClean } from '../src/lib/signal-source.js';
import { channelOf } from '../src/lib/runs.js';
import { pointsFromChannel, defaultSignal, channelPatch } from '../src/lib/runs-channel.js';
import { CASES, tailScene, tailHipsScene, dancingScene, lapDanceScene, tailjobScene, tailPenScene, selfPenScene, facesittingScene, fistingScene, restingArmScene, T as ST, stroke as sStroke } from './fusion-synth.mjs';

const FPS = 30, N = 600, A = 16 / 9;   // 20 s
const T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / FPS));
// the stroke (depth, + = out): 1 Hz strokes, a double pump at 6-7 s, a shallow section (30 %) at 12-15 s
function stroke(ms) {
  const s = ms / 1000;
  if (s >= 12 && s < 15) return 0.3 * Math.sin(2 * Math.PI * s);
  if (s >= 6 && s < 7) return Math.sin(2 * Math.PI * 2 * s) * 0.5 + 0.5 * Math.sin(2 * Math.PI * s);
  return Math.sin(2 * Math.PI * s);
}
function run({ drift = 0.02, occlude = true, tailLagMs = 250 } = {}) {
  const ch = {}, put = (name, f, gaps = () => false) => {
    ch[`sem_${name}_x`] = channelOf(T.map((ms) => [ms, gaps(ms) ? null : f(ms)[0]]));
    ch[`sem_${name}_y`] = channelOf(T.map((ms) => [ms, gaps(ms) ? null : f(ms)[1]]));
    ch[`sem_${name}_n`] = channelOf(T.map((ms) => [ms, gaps(ms) ? 0 : 0.03]));
  };
  const amp = 0.04, cam = (ms) => [drift * Math.sin(ms / 3100), drift * Math.cos(ms / 2300)];   // camera residue: common to all parts
  const body = (k, ms) => { const s = stroke(ms), c = cam(ms); return k === 1 ? [0.4 + c[0], 0.45 - 0.6 * amp * s + c[1]] : [0.5 + c[0], 0.6 + 0.4 * amp * s + c[1]]; };
  put('c1_hips', (ms) => body(1, ms));
  put('c1_balls', (ms) => { const b = body(1, ms); return [b[0] + 0.02, b[1] + 0.05]; }, (ms) => occlude && ms >= 8000 && ms < 11000);
  put('c1_tail', (ms) => { const b = body(1, ms - tailLagMs), c0 = body(1, ms); return [c0[0] - 0.08, b[1] - 0.04 + 0.01 * Math.sin(ms / 90)]; });
  put('c2_hips', (ms) => body(2, ms));
  put('c2_paws_r', (ms) => { const b = body(2, ms); return [b[0] + 0.1, b[1] + 0.08]; });
  ch.who_pair_proj = channelOf(T.map((ms) => [ms, 0.5 + 0.5 * stroke(ms)]));   // orientation reference: farther apart = out
  return { id: 'r', params: { axis: 'auto' }, scenes: [], channels: ch, notes: [] };
}
const corr = (a, b) => { const k = a.map((_, i) => i).filter((i) => a[i] === a[i] && b[i] === b[i]); const ma = k.reduce((s, i) => s + a[i], 0) / k.length, mb = k.reduce((s, i) => s + b[i], 0) / k.length; let x = 0, y = 0, z = 0; for (const i of k) { x += (a[i] - ma) * (b[i] - mb); y += (a[i] - ma) ** 2; z += (b[i] - mb) ** 2; } return x / Math.sqrt(y * z); };
const truth = T.map(stroke);
const sTruth = ST.map((_, i) => sStroke(i));
const fuse = (s, extra = null) => fusedChannel(s.run, { aspect: s.aspect, derives: extra ? [{ ...(s.derives[0] || {}), ...extra }] : s.derives });
const shareOf = (info, pred) => info.relations.filter(pred).reduce((a, r) => a + r.share, 0);

test('fusion recovers the relative stroke through camera residue, an occluded part and a lagging tail', () => {
  const r = run(), f = fusedChannel(r, { aspect: A });
  assert.ok(canFuse(r));
  const v = Array.from(f.v);
  assert.ok(corr(v, truth) > 0.98, 'fused vs truth r = ' + corr(v, truth));
  const occ = T.map((ms, i) => (ms >= 8000 && ms < 11000 ? i : -1)).filter((i) => i >= 0);
  assert.ok(corr(occ.map((i) => v[i]), occ.map((i) => truth[i])) > 0.97, 'the occluded span hands over');
  const info = f.info[0], tail = info.candidates.find((c) => c.id === 'c1_tail~cam');
  assert.ok(tail.lagging && Math.abs(tail.lagMs - 250) <= 40, `the tail is found lagging (${tail.lagMs} ms)`);
  const pairShare = info.candidates.filter((c) => c.kind === 'pair').reduce((s, c) => s + c.share, 0);
  assert.ok(pairShare > 0.6, 'relationships between the two characters carry most of the weight: ' + pairShare);
  assert.ok(info.bodies.find((b) => b.who === 'c1').parts.find((p) => p.id === 'c1_tail').say < 0.02, 'the tail barely counts');
  assert.ok(info.windows.length > 20 && info.windows.every((w) => Math.abs(Object.values(w.w).reduce((s, x) => s + x, 0) - 1) < 1e-6 || !Object.keys(w.w).length));
  assert.ok(f.conf.every((c, i) => !(v[i] === v[i]) || (c >= 0 && c <= 1)));
});

test('knot / bulge / tongue groups are tracked but off the fused stroke by default (paw-714j); a pin brings one in', () => {
  const r = run(), base = fusedChannel(r, { aspect: A });
  for (const part of ['knot', 'tongue', 'stomachbulge']) {
    const nm = 'c1_' + part;
    r.channels[`sem_${nm}_x`] = channelOf(T.map((ms) => [ms, 0.3 + 0.05 * Math.sin(ms / 170)]));
    r.channels[`sem_${nm}_y`] = channelOf(T.map((ms) => [ms, 0.7 + 0.05 * Math.cos(ms / 130)]));
  }
  const f = fusedChannel(r, { aspect: A }), cs = f.info[0].candidates;
  const offs = cs.filter((c) => c.parts.some((p) => /_(knot|tongue|stomachbulge)$/.test(p)));
  assert.ok(offs.length >= 3 && offs.every((c) => c.off && c.share === 0), 'listed (the owner can pin them), weighing nothing: ' + JSON.stringify(offs.map((c) => [c.id, c.off, c.share])));
  assert.ok(Array.from(f.v).every((x, i) => x === base.v[i] || (x !== x && base.v[i] !== base.v[i])), 'the fused stroke is exactly what it was without them');
  const pin = fusedChannel(r, { aspect: A, derives: [{ fuse: { pin: ['c1_knot'] } }] }).info[0].candidates;
  assert.ok(pin.find((c) => c.id === 'c1_knot~cam').share > 0 && pin.find((c) => c.id === 'c1_knot~cam').pinned, 'pinned: it counts');
});

test('the bodies against each other under drift; pins and excludes are hard overrides', () => {
  const r = run({ drift: 0.06 }), f = fusedChannel(r, { aspect: A });
  const single = fusedChannel(r, { aspect: A, derives: [{ fuse: { pin: ['c1_hips'] } }] });
  assert.ok(corr(Array.from(f.v), truth) > 0.99 && corr(Array.from(f.v), truth) >= corr(Array.from(single.v), truth), `fused ${corr(Array.from(f.v), truth)} vs hips alone ${corr(Array.from(single.v), truth)}`);   // (a slow drift is gone from both; a camera near the stroke tempo: fusion-synth camera-bob)
  assert.deepEqual(single.info[0].candidates.filter((c) => c.share > 0).map((c) => [c.kind, c.parts]), [['single', ['c1_hips']]], 'a pinned part: only its own row (against the camera)');
  const ex = fusedChannel(r, { aspect: A, derives: [{ fuse: { exclude: ['c1:core~c2:core'] } }] });
  assert.equal(ex.info[0].candidates.find((c) => c.id === 'c1:core~c2:core').share, 0, 'an excluded relationship weighs nothing');
  const exPart = fusedChannel(r, { aspect: A, derives: [{ fuse: { exclude: ['c2_hips'] } }] }).info[0];
  assert.ok(!exPart.relations.some((x) => x.split.some((s) => s.part === 'c2_hips')), 'an excluded part is in no relationship');
});

test('orientation follows the scene reference; the direction keypress still decides in the channel path', () => {
  const r = run(), f = fusedChannel(r, { aspect: A });
  assert.ok(corr(Array.from(f.v), Array.from(r.channels.who_pair_proj.v)) > 0.9);
});

test('the channel path keeps the shallow section shallow and puts turns within a frame', () => {
  const r = { ...run(), range: { start: 0, end: 20000 } }, f = fusedChannel(r, { aspect: A });
  r.channels.fused = f;
  const p = pointsFromChannel(r, 'fused');
  const at = Array.from(p.at), pos = Array.from(p.pos);
  const amp = (a, b) => { const q = pos.filter((_, i) => at[i] >= a && at[i] < b); return Math.max(...q) - Math.min(...q); };
  const ratio = amp(12300, 14700) / amp(1300, 5700);
  assert.ok(ratio > 0.22 && ratio < 0.4, 'shallow ratio ' + ratio);
  const turns = at.filter((t) => t > 600 && t < 5900);
  for (const t of turns) { const ph = ((t / 1000) % 1 + 1) % 1, d = Math.min(Math.abs(ph - 0.25), Math.abs(ph - 0.75)) * 1000; assert.ok(d <= 1000 / FPS + 1, `turn at ${t} is ${d.toFixed(0)} ms off`); }
  assert.ok(turns.length >= 9);
});

test('nothing to fuse: one group, or too short', () => {
  const r = run(), one = { ...r, channels: { sem_c1_hips_x: r.channels.sem_c1_hips_x, sem_c1_hips_y: r.channels.sem_c1_hips_y } };
  assert.equal(fusedChannel(one, { aspect: A }), null);
  assert.equal(fuseScene(r, [0, 1, 2], { aspect: A }), null);
});

test('an Extra part pairs with Bottom parts, never with Top parts (paw-uzzr)', () => {
  const r = run({ drift: 0 });
  r.channels.sem_x_penis_x = channelOf(T.map((ms) => [ms, 0.5]));
  r.channels.sem_x_penis_y = channelOf(T.map((ms) => [ms, 0.6 + 0.4 * 0.04 * stroke(ms)]));
  const f = fusedChannel(r, { aspect: A }), rel = f.info[0].relations;
  assert.ok(rel.some((x) => x.id === 'x_penis~cam'), 'a row on its own');
  const xr = rel.find((x) => x.id === 'x:penis~c1:core');
  assert.ok(xr && xr.label === 'Extra penis ↔ Bottom hips', 'against the Bottom body: ' + rel.map((x) => x.id).join(' '));
  assert.ok(!rel.some((x) => x.sideB && [...x.sideA, ...x.sideB].includes('x_penis') && [...x.sideA, ...x.sideB].some((p) => p.startsWith('c2_'))), 'never with Top parts');
  assert.equal(rel.find((x) => x.id === 'c1:core~c2:core').label, 'Bottom hips ↔ Top hips');
  assert.ok(corr(Array.from(f.v), truth) > 0.97, 'the stroke is still found: ' + corr(Array.from(f.v), truth));
});

// ---- paw-iasp design points ----
test('every synthetic design case: the new fusion finds the stroke (r > 0.9)', () => {
  for (const c of CASES) { const f = fuse(c.make()); const r = corr(Array.from(f.v), sTruth); assert.ok(r > 0.9, `${c.id}: r = ${r.toFixed(3)} (${c.point})`); }
});

test('scene type: fellatio puts the Bottom head on the Top penis in front; strength 0 ignores the tags (the bodies rock lead then)', () => {
  const s = CASES.find((c) => c.id === 'fellatio-head').make(), f = fuse(s), inf = f.info[0];
  assert.deepEqual(inf.scene.acts, ['oral+penetration']);
  assert.ok(/^c1:head~/.test(inf.relations[0].id) && inf.relations[0].gain === 3, 'the head row leads: ' + inf.relations[0].id);
  const off = fuse(s, { fuse: { prior: 0 } });
  assert.ok(shareOf(off.info[0], (r) => r.sideA.includes('c1_head')) < shareOf(inf, (r) => r.sideA.includes('c1_head')), 'without the tags the head has less say');
  assert.ok(corr(Array.from(off.v), sTruth) < corr(Array.from(f.v), sTruth) - 0.05, 'and the stroke is found worse');
});

test('a wrong act tag does not win over the data: the tags say rimming, the Top head only wanders', () => {
  const f = fuse(CASES.find((c) => c.id === 'wrong-prior').make()), inf = f.info[0];
  assert.ok(!inf.relations[0].sideA.includes('c2_head'), 'the head row does not lead: ' + inf.relations[0].id);
  assert.ok(corr(Array.from(f.v), sTruth) > 0.95);
});

test('a lagging part fades by degree: its say falls smoothly with its lag, never in a step', () => {
  const say = [0, 33, 67, 100, 150, 200].map((lag) => fuse(tailScene(lag)).info[0].bodies.find((b) => b.who === 'c1').parts.find((p) => p.id === 'c1_tail').say);
  for (let k = 1; k < say.length; k++) assert.ok(say[k] <= say[k - 1] + 1e-9, 'monotone: ' + say.join(' '));
  for (let k = 1; k < 4; k++) assert.ok(say[k] > 0.3 * say[k - 1], `no cliff at ${[0, 33, 67, 100][k]} ms: ${say.join(' ')}`);
});

test('a body as a whole: pieces of one part merge; more parts of a body never change who carries the stroke', () => {
  const h = fuse(CASES.find((c) => c.id === 'halves').make()).info[0];
  assert.deepEqual(h.bodies.find((b) => b.who === 'c1').parts.find((p) => p.id === 'c1_thighs_r').names, ['c1_thighs_r', 'c1_thighs_r2', 'c1_thighs_r3']);
  const more = CASES.find((c) => c.id === 'more-parts').make(), m = fuse(more).info[0];
  assert.equal(m.relations[0].kind, 'relative', 'the two bodies against each other lead: ' + m.relations[0].id);
  const few = { ...more, run: { ...more.run, channels: Object.fromEntries(Object.entries(more.run.channels).filter(([k]) => !/^sem_/.test(k) || /^sem_(c1_hips|c1_thighs_r|c2_hips|c2_penis)_/.test(k))) } };
  assert.ok(Math.abs(corr(Array.from(fuse(more).v), sTruth) - corr(Array.from(fuse(few).v), sTruth)) < 0.03, 'ten swaying parts more change nothing');
});

test('a single character: the extremity nearest the genitals against them, said so', () => {
  assert.equal(fuse(CASES.find((c) => c.id === 'solo-untagged').make()).info[0].solo.rule, 'near');
  const s = fuse(CASES.find((c) => c.id === 'solo-hand').make()).info[0];
  assert.ok(['near', 'own'].includes(s.solo.rule) && /hand/.test(s.solo.label), JSON.stringify(s.solo));
});

test('paw-n00h dancing: the hips against the frame lead and a swinging penis does not, solo and in a lap dance', () => {
  const penis = (inf) => shareOf(inf, (r) => [...r.sideA, ...(r.sideB || [])].includes('c1_penis') || [...r.sideA, ...(r.sideB || [])].includes('c2_penis'));
  const hipsCam = (inf) => inf.relations[0].sideA.length === 1 && inf.relations[0].sideA[0] === 'c1_hips' && !inf.relations[0].sideB;
  const r = (f) => corr(Array.from(f.v), sTruth);
  // solo: untagged the body against the camera already leads (SOLO_ROWS), the head against the genitals / body takes ~10 %
  const solo = fuse(dancingScene(['dancing'])), solo0 = fuse(dancingScene(null));
  assert.deepEqual(solo.info[0].scene.acts, ['dancing']);
  assert.ok(hipsCam(solo.info[0]) && solo.info[0].relations[0].gain === 3, 'the hips row leads: ' + solo.info[0].relations[0].id);
  assert.ok(penis(solo.info[0]) < 0.02 && r(solo) > 0.94 && r(solo) >= r(solo0), `solo: penis ${penis(solo.info[0])}, r ${r(solo)} (untagged ${r(solo0)})`);
  assert.equal(solo0.info[0].relations[0].id, 'c1:core~cam', 'untagged: the body against the camera');
  // lap dance: untagged the Top penis against the dancer wins (ROWS T:penis ~ B:core) and follows the swing
  const lap = fuse(lapDanceScene(['dancing'])), lap0 = fuse(lapDanceScene(null));
  assert.ok(lap0.info[0].relations[0].id === 'c2:penis~c1:core' && r(lap0) < 0.8, `untagged: the penis leads (${lap0.info[0].relations[0].id}, r ${r(lap0)})`);
  assert.ok(hipsCam(lap.info[0]) && penis(lap.info[0]) < 0.02 && r(lap) > 0.94, `tagged: ${lap.info[0].relations[0].id}, penis ${penis(lap.info[0])}, r ${r(lap)}`);
});

test('paw-210e tailjob / tail penetration / facesitting: the tag\'s row leads where an untagged decoy wins; facesitting reads its sideways rock', () => {
  const r = (f) => corr(Array.from(f.v), sTruth), lead = (f) => f.info[0].relations[0].id;
  const cases = [
    [tailjobScene(['tailjob']), tailjobScene(null), 'c2:tail~c1:penis|balls|hips', 0.5],
    [tailjobScene(['tailjob'], { solo: true }), tailjobScene(null, { solo: true }), 'c1:tail~c1:penis|balls', 0.9],
    [tailPenScene(['anal', 'tailpen']), tailPenScene(null), 'c2:tail~c1:hips|thighs', 0.5],
    [facesittingScene(['facesitting']), facesittingScene(null), 'c2:hips~c1:head', 0.7],
  ];
  for (const [s, s0, id, max0] of cases) {
    const f = fuse(s), f0 = fuse(s0);
    assert.ok(lead(f) === id && r(f) > 0.95, `tagged: ${lead(f)}, r ${r(f).toFixed(3)}`);
    assert.ok(lead(f0) !== id && r(f0) < max0, `untagged: ${lead(f0)}, r ${r(f0).toFixed(3)}`);
  }
  // one's own tail in oneself: the nearest extremity already carries it, with or without the tag
  const self = fuse(tailPenScene(['anal', 'tailpen'], { solo: true }));
  assert.ok(lead(self) === 'c1_tail~c1:gen|core' && r(self) > 0.95, `${lead(self)} ${r(self)}`);
  // facesitting: either one sits; the row reads sideways (the direction shown is the rock's)
  const bs = fuse(facesittingScene(['facesitting'], { sitter: 'c1' })), fsi = fuse(facesittingScene(['facesitting'])).info[0];
  assert.ok(lead(bs) === 'c1:hips~c2:head' && r(bs) > 0.95, `${lead(bs)} ${r(bs)}`);
  assert.ok(Math.abs(fsi.dir.u[0]) > 0.95, 'sideways: ' + JSON.stringify(fsi.dir.u));
  const dir = fuse(facesittingScene(['facesitting']), { fuse: { jit: { dir: true } } });
  assert.ok(r(dir) > 0.95 && Math.abs(dir.info[0].dir.u[0]) > 0.95, 'jit.dir on: still the rock');
});

test('self penetration: plain penetration with one character painted follows its sway; the selfpen tag follows its penis against its own opening; a lone Bottom of a pair keeps its body', () => {
  const r = (f) => Math.abs(corr(Array.from(f.v), sTruth)), lead = (f) => f.info[0].relations[0].id;
  const plain = fuse(selfPenScene(['anal', 'penetration'])), tagged = fuse(selfPenScene(['anal', 'penetration', 'selfpen']));
  assert.ok(r(plain) < 0.5, `plain penetration, one character: the body against the frame (${lead(plain)}, r ${r(plain).toFixed(3)})`);
  assert.ok(lead(tagged) === 'c1:penis~c1:anus|slit|hips|thighs' && r(tagged) > 0.95, `selfpen: ${lead(tagged)}, r ${r(tagged).toFixed(3)}`);
  // painted as two characters (the penis as Top) it already works, with or without the tag
  for (const acts of [['anal', 'penetration'], ['anal', 'penetration', 'selfpen']]) assert.ok(r(fuse(selfPenScene(acts, { penis: 'c2' }))) > 0.95, acts.join('+'));
  // why it is a tag and not a plain-penetration fallback: a lone painted Bottom of a pair swings its own penis against its own hips
  const decoy = fuse(selfPenScene(['anal', 'penetration'], { decoy: true }));
  assert.ok(r(decoy) > 0.95 && !lead(decoy).includes('penis'), `decoy: ${lead(decoy)}, r ${r(decoy).toFixed(3)}`);
  assert.ok(!TWO_ACTS.includes('selfpen'));
});

test('the pad nudges: relative <-> absolute, core <-> extremities, smoothly and never to zero; the auto mark stays', () => {
  const s = CASES.find((c) => c.id === 'fellatio-head').make(), c = fuse(s).info[0];
  const abs = fuse(s, { fuse: { pad: { x: 1, y: 0 } } }).info[0], rel = fuse(s, { fuse: { pad: { x: -1, y: 0 } } }).info[0];
  assert.ok(shareOf(abs, (r) => r.abs) > shareOf(rel, (r) => r.abs), 'x to absolute raises the rows against the camera');
  const ext = fuse(s, { fuse: { pad: { x: 0, y: 1 } } }).info[0], core = fuse(s, { fuse: { pad: { x: 0, y: -1 } } }).info[0];
  assert.ok(ext.mix.y > core.mix.y, 'y to extremities raises the extremity rows');
  assert.ok(abs.relations.every((r) => r.pad > 0) && Math.max(...abs.relations.map((r) => r.pad)) <= 4 + 1e-9, 'scaled, never off');
  assert.deepEqual(abs.auto, c.auto, 'the automatic choice is where it was');
  assert.deepEqual(c.mix, c.auto, 'centre = the automatic choice');
  assert.equal(padGain({ abs: 1, ext: 0.5 }, { x: 0.5, y: 0.3 }), 4 ** 0.5);
});

test('the full panel\'s own weights: 0 takes a row out, more raises it; the explanation is complete', () => {
  const s = CASES.find((c) => c.id === 'rimming-head').make(), base = fuse(s).info[0], top = base.relations[0].id;
  assert.equal(fuse(s, { fuse: { w: { [top]: 0 } } }).info[0].relations.find((r) => r.id === top).share, 0);
  const second = base.relations[1].id;
  assert.ok(fuse(s, { fuse: { w: { [second]: 4 } } }).info[0].relations.find((r) => r.id === second).share > base.relations[1].share);
  for (const k of ['bodies', 'relations', 'scene', 'auto', 'mix', 'conf', 'windows', 'candidates', 'motion']) assert.ok(k in base, k);
  const r0 = base.relations[0];
  for (const k of ['prior', 'gain', 'pad', 'user', 'rhythm', 'quality', 'lagMs', 'coh', 'phase', 'sign', 'share', 'split']) assert.ok(k in r0, k);
  assert.equal(base.motion.bodies.c1.x.length, ST.length, 'the 2-D body motions are kept');
});

test('fuseClean: controls kept, defaults dropped', () => {
  assert.equal(fuseClean({ pad: { x: 0, y: 0 }, prior: 1, w: { a: 1 } }), null);
  assert.deepEqual(fuseClean({ exclude: ['b', 'a', 'a'], pad: { x: 2, y: -0.333 }, prior: 0.456, w: { r: 9, s: 1, t: 0 } }), { exclude: ['a', 'b'], pad: { x: 1, y: -0.33 }, prior: 0.46, w: { r: 8, t: 0 } });
});

test('a new run defaults to fused where two painted parts or more have data', () => {
  const r = run();
  assert.equal(defaultSignal('static', r, 0, 20000), 'fused');
  const one = { ...r, channels: { sem_c1_hips_x: r.channels.sem_c1_hips_x, sem_c1_hips_y: r.channels.sem_c1_hips_y } };
  assert.equal(defaultSignal('static', one, 0, 20000), null);
  assert.equal(defaultSignal('pan', { ...one, channels: { ...one.channels, proj_cam: channelOf([[0, 1], [10, 2]]) } }, 0, 20000), 'proj_cam');
});

test('a range override carries its own fusion controls (the pad inside it edits it)', () => {
  assert.deepEqual(spanClean({ t0: 0, t1: 10, fuse: { pad: { x: -0.5, y: 0.25 } } }), { t0: 0, t1: 10, fuse: { pad: { x: -0.5, y: 0.25 } } });
  assert.equal(spanClean({ t0: 0, t1: 10, fuse: { pad: { x: 0, y: 0 } } }), null, 'a centred pad alone overrides nothing');
});

// ---- paw-439e: the scene type limits itself; per-shot acts; extremities earn say ----
test('a tagged relationship that does not carry the stroke loses its lift by degree, and the explanation says so', () => {
  const s = CASES.find((c) => c.id === 'tag-not-driver').make(), f = fuse(s), inf = f.info[0];
  const hand = inf.relations.find((r) => r.limit != null && r.sideA.includes('c1_hand_r'));
  assert.ok(hand && hand.lift > 1 && hand.limit < FUSE.TAG_IGNORED, 'the handjob row keeps (almost) none of its lift: ' + JSON.stringify(hand && { lift: hand.lift, limit: hand.limit, contra: hand.contra }));
  assert.ok(hand.contra > 0.5 && /Bottom .*↔ Top/.test(hand.against), 'contradicted by a cleaner relationship: ' + hand.against);
  assert.ok(inf.scene.notes.some((n) => /^handjob tag: .*hand.* is not carrying the stroke here .*: ignored$/.test(n.text)), JSON.stringify(inf.scene.notes));
  assert.ok(corr(Array.from(f.v), sTruth) > 0.95, 'the bodies carry it: ' + corr(Array.from(f.v), sTruth));
  assert.equal(inf.relations[0].kind, 'relative');
});

test('a tagged relationship that behaves keeps its lift: fellatio head (nothing contradicts it), handjob hand (it is the stroke)', () => {
  for (const id of ['fellatio-head', 'handjob', 'rimming-head']) {
    const inf = fuse(CASES.find((c) => c.id === id).make()).info[0], top = inf.relations.find((r) => r.limit != null && r.share === Math.max(...inf.relations.filter((x) => x.limit != null).map((x) => x.share)));
    assert.ok(top.limit >= FUSE.TAG_ALONE - 0.1, `${id}: limit ${top.limit} (behave ${top.behave}, confirmed ${top.confirmed}, contra ${top.contra})`);
    assert.equal(inf.relations[0].id, top.id, `${id}: the tagged row still leads`);
  }
});

test('the limit is smooth: a hand that more and more carries the stroke gets more and more of its lift back', () => {
  // the same scene, the hand's motion a blend of its own fidget (1 - k) and the stroke (k)
  const base = CASES.find((c) => c.id === 'tag-not-driver').make();
  const lim = [0, 0.25, 0.5, 0.75, 1].map((k) => {
    const run = structuredClone(base.run), hx = run.channels.sem_c1_hand_r_x, hy = run.channels.sem_c1_hand_r_y, hip = run.channels.sem_c2_hips_y;
    for (let i = 0; i < hy.v.length; i++) { hy.v[i] = (1 - k) * hy.v[i] + k * (0.55 + 3 * (hip.v[i] - 0.5)); hx.v[i] = (1 - k) * hx.v[i] + k * 0.48; }
    const inf = fusedChannel(run, { aspect: base.aspect, derives: base.derives }).info[0];
    return inf.relations.find((r) => r.limit != null && r.sideA.includes('c1_hand_r')).limit;
  });
  for (let i = 1; i < lim.length; i++) assert.ok(lim[i] >= lim[i - 1] - 0.05, 'rises with k: ' + lim.join(' '));
  assert.ok(lim[0] < 0.25 && lim[4] > 0.6, 'from ignored to kept: ' + lim.join(' '));
});

test('strength 0 = the untagged priors (a row only an act names falls back to TAG_BASE)', () => {
  const s = CASES.find((c) => c.id === 'fellatio-head').make(), off = fuse(s, { fuse: { prior: 0 } }).info[0];
  const head = off.relations.find((r) => r.acts && r.sideA.includes('c1_head'));
  assert.ok(head.lift > 1 && off.relations.every((r) => r.share >= 0));
  assert.ok(off.relations[0].id !== head.id || off.relations[0].share < fuse(s).info[0].relations[0].share);
});

test('per-shot act override: an act turned off for this shot / run drops its rows; the chips list every tag', () => {
  const s = CASES.find((c) => c.id === 'fellatio-head').make(), offAct = fuse(s, { fuse: { actsOff: ['oral'] } }).info[0];
  assert.deepEqual(offAct.scene.tags, ['oral', 'penetration']);
  assert.deepEqual(offAct.scene.off, ['oral']);
  assert.deepEqual(offAct.scene.acts, ['penetration'], 'plain penetration is what is left');
  assert.ok(!offAct.relations.some((r) => r.acts?.some((a) => a.includes('oral'))));
  assert.deepEqual(fuseClean({ actsOff: ['oral', 'oral', 3] }), { actsOff: ['oral'] });
});

test('an extremity in step with its body earns say there (up to EXT_CEIL) and stands in for occluded hips', () => {
  const s = tailHipsScene(), inf = fuse(s).info[0], tail = inf.bodies.find((b) => b.who === 'c1').parts.find((p) => p.id === 'c1_tail');
  assert.ok(tail.earned > 0 && tail.inBody > ROLE_BODY.ext && tail.inBody <= FUSE.EXT_CEIL + 1e-9, JSON.stringify(tail));
  const hips = inf.bodies.find((b) => b.who === 'c1').parts.find((p) => p.id === 'c1_hips');
  assert.ok(tail.inBody < hips.inBody, 'never more than a core part');
  const body = inf.relations.find((r) => r.id === 'c1:core~c2:core');
  assert.ok(body.sideA.includes('c1_tail') && body.label === 'Bottom hips ↔ Top hips', 'the tail joined the Bottom body (not named in it): ' + JSON.stringify(body.sideA));
  assert.ok(corr(Array.from(fuse(s).v), sTruth) > 0.95, 'the stroke through the occlusions');
  const saved = FUSE.EARN; FUSE.EARN = [2, 3];
  try { const off = fuse(tailHipsScene()); assert.ok(corr(Array.from(off.v), sTruth) < 0.9, 'without earning the tail is wasted: ' + corr(Array.from(off.v), sTruth)); } finally { FUSE.EARN = saved; }   // (a fresh scene: the analysis is cached per run)
  const lag = fuse(tailScene(200)).info[0].bodies.find((b) => b.who === 'c1').parts.find((p) => p.id === 'c1_tail');
  assert.ok(!lag.earned, 'a lagging tail earns nothing');
});

test('a fused range override keeps its own fusion record (the panel and the pad inside it read it); none without one', () => {
  const s = CASES.find((c) => c.id === 'tag-not-driver').make(), ch = s.run.channels.who_pair_proj;
  const run = { ...s.run, points0: { at: new Float64Array([0, 19000]), pos: new Float64Array([0, 100]) }, samples: { t: Float64Array.from(ch.t), v: Float64Array.from(ch.v) } };
  const p = channelPatch(run, 'fused', {}, [], { aspect: s.aspect, derives: [{ acts: ['handjob'] }], spans: [{ t0: 5000, t1: 9000, source: 'fused', fuse: { pad: { x: 1, y: 0 }, actsOff: ['handjob'] } }] });
  assert.equal(p.fuseSpans.length, 1);
  assert.deepEqual([p.fuseSpans[0].t0, p.fuseSpans[0].t1, p.fuseSpans[0].info.pad, p.fuseSpans[0].info.scene.off], [5000, 9000, { x: 1, y: 0 }, ['handjob']]);
  assert.equal(channelPatch(run, 'fused', {}, [], { aspect: s.aspect, derives: [{ acts: ['handjob'] }] }).fuseSpans, null, 'cleared when there is none (the run keeps no stale record)');
});

test('paw-0yfp fisting / fingering: the giver\'s forearm (fingering: hand) against the receiver leads where an untagged decoy wins; either character gives; one\'s own arm', () => {
  const r = (f) => corr(Array.from(f.v), sTruth), inf = (f) => f.info[0], lead = (f) => inf(f).relations[0].id;
  const share = (f, re) => shareOf(inf(f), (x) => re.test(x.id));
  const F = ['anal', 'fisting'];
  // [tagged, untagged, the rows that may lead, untagged r below]
  const cases = [
    ['Top gives', fistingScene(F), fistingScene(null), /^c2_(forearm|shoulder)_r~c1:hips\|thighs$/, 0.3],
    ['Bottom gives', fistingScene(F, { giver: 'c1', receiver: 'c2' }), fistingScene(null, { giver: 'c1', receiver: 'c2' }), /^c1_(forearm|shoulder)_r~c2:hips\|thighs$/, 0.3],
    ['the other arm idle on the thigh', fistingScene(F, { idle: true }), fistingScene(null, { idle: true }), /^c2_(forearm|shoulder)_r~c1:hips\|thighs$/, 0.3],
    ['forearm lost half the time', fistingScene(F, { lost: true }), fistingScene(null, { lost: true }), /^c2_(forearm|shoulder)_r~c1:hips\|thighs$/, 0.3],
    ['fingering', fistingScene(['anal', 'fingering'], { fingering: true }), fistingScene(null, { fingering: true }), /^c2_(hand|forearm|shoulder)_r~c1:hips\|thighs$/, 0.3],
  ];
  for (const [what, s, s0, re, max0] of cases) {
    const f = fuse(s), f0 = fuse(s0);
    assert.ok(re.test(lead(f)) && r(f) > 0.95, `${what} tagged: ${lead(f)}, r ${r(f).toFixed(3)}`);
    assert.ok(!re.test(lead(f0)) && r(f0) < max0, `${what} untagged: ${lead(f0)}, r ${r(f0).toFixed(3)}`);
  }
  const a = fuse(fistingScene(F)), idle = fuse(fistingScene(F, { idle: true }));
  assert.ok(share(a, /^c2_forearm_r~c1:/) > 0.3 && share(a, /^c1:penis|~c1:penis/) < 0.02, `the forearm carries it (${share(a, /^c2_forearm_r~c1:/).toFixed(2)}), the swinging penis does not`);
  assert.ok(share(idle, /_l~/) < 0.1, 'the idle arm stays a minor voice: ' + share(idle, /_l~/).toFixed(3));
  assert.ok(share(fuse(fistingScene(F, { lost: true })), /^c2_shoulder_r~c1:/) > 0.2, 'the upper arm carries it where the forearm is lost');
  // fisting + penetration: the arm, not a penis, goes in (the specific entry hides plain penetration)
  const fp = fuse(fistingScene(['anal', 'fisting', 'penetration']));
  assert.deepEqual(inf(fp).scene.acts, ['fisting+penetration']);
  assert.ok(/^c2_forearm_r~/.test(lead(fp)) && r(fp) > 0.95, `${lead(fp)} ${r(fp)}`);
  // one's own arm in oneself: the self row (S), not cut by the two-character rule; before (T:hand x TWO_ACTS) 0.23
  const self = fuse(fistingScene(F, { giver: 'c1', receiver: 'c1' }));
  assert.ok(/^c1_(forearm|shoulder)_r~c1:hips\|thighs$/.test(lead(self)) && r(self) > 0.95, `self: ${lead(self)} ${r(self)}`);
  // the visible forearm as a depth reading: its visible share of the points (sem_*_n) rises as it comes out (+ = out)
  const ch = fistingScene(F).run.channels.sem_c2_forearm_r_n;
  assert.ok(corr(Array.from(ch.v), sTruth) > 0.95, 'visible forearm share vs depth: ' + corr(Array.from(ch.v), sTruth));
});

test('paw-0yfp an arm merely resting on the hips in a penetration scene does not take over (tagged or not)', () => {
  for (const acts of [['anal', 'penetration'], null]) {
    const f = fuse(restingArmScene(acts)), arm = shareOf(f.info[0], (x) => /forearm|hand|shoulder/.test(x.id));
    assert.ok(arm < 0.05 && corr(Array.from(f.v), sTruth) > 0.95, `${acts}: arm rows ${arm.toFixed(3)}, r ${corr(Array.from(f.v), sTruth).toFixed(3)}`);
  }
});

test('paw-0yfp a fusion control at its extreme never takes fusion away: a pinned row at x0, every row out, every part out', () => {
  const s = fistingScene(['anal', 'fisting']), base = fuse(s).info[0], lead = base.relations[0].id;
  // the owner's case: one row pinned, its weight dragged to 0 (fuseClean keeps the 0)
  const fz = fuseClean({ pin: [lead], w: { [lead]: 0 } });
  assert.deepEqual(fz.w, { [lead]: 0 });
  const z = fuse(s, { fuse: fz });
  assert.ok(z && z.info[0], 'still fused');
  const zi = z.info[0], zr = zi.relations.find((x) => x.id === lead);
  assert.ok(zi.pinsOff && !zi.none && zr.pinned && zr.user === 0 && zr.share === 0, `the pinned row listed at x0 contributing nothing: ${JSON.stringify({ pinsOff: zi.pinsOff, share: zr.share, user: zr.user })}`);
  assert.ok(Array.from(z.v).some((x) => x === x) && zi.relations.some((x) => x.share > 0.1), 'the others count');
  // excluding the only pinned row: the same
  assert.ok(fuse(s, { fuse: { pin: [lead], exclude: [lead] } }).info[0].pinsOff);
  // a pin still narrows while one pinned row is on (unchanged)
  const two = fuse(s, { fuse: { pin: [lead, 'c1:core~c2:core'], w: { [lead]: 0 } } }).info[0];
  assert.ok(!two.pinsOff && two.relations.filter((x) => x.share > 0).every((x) => x.id === 'c1:core~c2:core'), 'the other pin alone');
  // every relationship out / at x0, every part out: the automatic mix plays and says so
  const allOut = fuse(s, { fuse: { exclude: base.relations.map((x) => x.id) } }), allZero = fuse(s, { fuse: { w: Object.fromEntries(base.relations.map((x) => [x.id, 0])) } });
  const parts = base.bodies.flatMap((b) => b.parts.map((p) => p.id)), noParts = fuse(s, { fuse: { exclude: parts } });
  for (const [what, f] of [['every row out', allOut], ['every row x0', allZero], ['every part out', noParts]]) {
    assert.ok(f?.info[0]?.none && corr(Array.from(f.v), Array.from(fuse(s).v)) > 0.999, `${what}: ${JSON.stringify(f?.info[0]?.none)}`);
  }
  assert.ok(allOut.info[0].relations.every((x) => x.excluded), 'every row still listed as out (the owner brings one back there)');
});
