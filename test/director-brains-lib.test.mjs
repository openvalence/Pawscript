// src/lib/director pure parts: digest, calibration, viterbi, validation, policy, checks, trace records.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { digest, requestDigest, stable } from '../src/lib/director/digest.js';
import { calibrate } from '../src/lib/director/calib.js';
import { viterbi, segmentsFrom } from '../src/lib/director/viterbi.js';
import { KINDS, POLICY, PRESETS, chainFor, tauFor, DEFAULTS, validate, idOf, makeRequest, probeId, channelOk } from '../src/lib/director/decisions.js';
import { verifyChecks, planChecks, REDO_OF } from '../src/lib/director/checks.js';
import { toRecord, toTrace2, fromTrace2, STAGE_OF, factsLine } from '../src/lib/director/trace.js';
import '../src/features/director/brains/index.js';   // installs draft's RULES as the story default
import { SCENES, VIDEO, RUNS_S0, PAIRS_S0, sc, R } from './director-brains-fixtures.mjs';

test('digest: stable over key order, 14 hex chars, sensitive to values', () => {
  assert.equal(digest({ a: 1, b: [1, { y: 2, x: 1 }] }), digest({ b: [1, { x: 1, y: 2 }], a: 1 }));
  assert.match(digest({ a: 1 }), /^[0-9a-f]{14}$/);
  assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
  assert.equal(stable({ b: undefined, a: NaN }), '{"a":null}');
});

test('requestDigest ignores evidence and round, follows facts, deps and brain version', () => {
  const req = R('camera', sc(0), { scene: SCENES[0] });
  const d = requestDigest(req, {}, 'v1');
  assert.equal(requestDigest({ ...req, round: 2, evidence: [{ id: 'e' }] }, {}, 'v1'), d);
  assert.notEqual(requestDigest(req, {}, 'v2'), d);
  assert.notEqual(requestDigest(req, { 'climax:v': { window: null } }, 'v1'), d);
  assert.notEqual(requestDigest({ ...req, attempt: 1 }, {}, 'v1'), d);
});

test('calibrate: Platt from the table, raw through when missing', () => {
  assert.deepEqual(calibrate(null, 'rules', 'story', 0.7), { conf: 0.7, n: 0, calibrated: false });
  const t = { rules: { story: { a: 1, b: 0, n: 29 } } };
  assert.ok(Math.abs(calibrate(t, 'rules', 'story', 0.7).conf - 0.7) < 1e-9);
  const c = calibrate({ rules: { story: { a: 2, b: -1, n: 29 } } }, 'rules', 'story', 0.7);
  assert.equal(c.calibrated, true); assert.equal(c.n, 29);
  assert.ok(Math.abs(c.conf - 1 / (1 + Math.exp(-(2 * Math.log(0.7 / 0.3) - 1)))) < 1e-9);
});

test('viterbi: switch penalty smooths single-step blips; segmentsFrom ends at t1', () => {
  const A = [0, -3], B = [-3, 0];
  assert.deepEqual(viterbi([A, A, B, A, A], 4), [0, 0, 0, 0, 0]);
  assert.deepEqual(viterbi([A, A, B, B, B, B], 4), [0, 0, 1, 1, 1, 1]);
  assert.deepEqual(segmentsFrom([0, 0, 1, 1], ['x', 'y'], 1000, 1000, 4500), [{ t0: 1000, t1: 3000, label: 'x' }, { t0: 3000, t1: 4500, label: 'y' }]);
  assert.deepEqual(viterbi([]), []);
});

test('policy: presets filter chains, user unless askUser false, replay only when named', () => {
  assert.deepEqual(chainFor('story', { preset: 'rules', askUser: true }), ['rules', 'user']);
  assert.deepEqual(chainFor('story', { preset: 'rules+vlm', askUser: false }), ['rules', 'vlm']);
  assert.deepEqual(chainFor('direction', { preset: 'ask' }), ['rules', 'agent', 'user']);   // no vlm on direction
  assert.deepEqual(chainFor('depth', { preset: 'ask' }), ['rules']);
  assert.deepEqual(chainFor('track', { preset: 'rules', askUser: false, override: { track: { chain: ['replay'] } } }), ['replay']);
  assert.equal(tauFor('direction', {}), 0.9);
  assert.equal(tauFor('direction', { override: { direction: { tau: 0.5 } } }), 0.5);
  assert.equal(KINDS.length, 8); assert.ok(KINDS.every((k) => POLICY[k] && DEFAULTS[k])); assert.ok(PRESETS.ask.includes('user'));
});

test('ids and requests', () => {
  assert.equal(idOf('camera', sc(1)), 'camera:s1');
  assert.equal(idOf('track', { scene: 0, t0: 4500, t1: 9000 }), 'track:s0@4500');
  assert.equal(idOf('climax', { scene: null, t0: 0, t1: 1 }), 'climax:v');
  const r = makeRequest('story', sc(0), { scene: SCENES[0] }, { deps: ['camera:s0'] });
  assert.equal(r.schema, 'pawscript.director/1'); assert.equal(r.round, 0); assert.equal(r.maxRounds, 3);
  assert.match(r.question, /scene 0/); assert.equal('prior' in r, false);
  assert.equal(probeId({ tracker: 'lk_box', roi: null, params: {} }, 0, 1), probeId({ params: {}, roi: null, tracker: 'lk_box' }, 0, 1));
});

test('every default validates', () => {
  const facts = { scene: SCENES[0], segment: { t0: 0, t1: 26489, kind: 'penetration', recipe: 'penetration', visible: true, action: 'continues', intensity: 1, name: '' }, runs: [] };
  for (const k of KINDS) {
    const req = R(k, k === 'climax' ? { scene: null, t0: 0, t1: VIDEO.dur } : sc(0), facts);
    assert.equal(validate(k, DEFAULTS[k](req), req), null, k);
  }
  const story = DEFAULTS.story(R('story', sc(0), { scene: SCENES[0] }));
  assert.equal(story.segments[0].kind, 'penetration');   // draft RULES on the describe tags
  assert.equal(DEFAULTS.depth(R('depth', sc(0), facts)).hi, 85);
});

test('validate: the contract checks', () => {
  const s = sc(0), req = R('story', s, {});
  const seg = (t0, t1, o) => ({ t0, t1, kind: 'penetration', visible: true, action: 'continues', intensity: 1, name: '', ...o });
  assert.equal(validate('story', { segments: [seg(0, 10000), seg(10000, 26489)] }, req), null);
  assert.match(validate('story', { segments: [seg(0, 10000), seg(10500, 26489)] }, req), /gap/);
  assert.match(validate('story', { segments: [seg(0, 26300), seg(26300, 26489)] }, req), /250/);
  assert.match(validate('story', { segments: [seg(0, 20000)] }, req), /tile/);
  assert.match(validate('story', { segments: [seg(0, 26489, { kind: 'dance' })] }, req), /kind/);
  assert.match(validate('story', { segments: [seg(0, 26489, { recipe: 'nope' })] }, req), /recipe/);
  const tr = R('track', s, { runs: RUNS_S0, camera: { valid: ['relative', 'rate'] } });
  assert.match(validate('track', { keep: 'run99', agree: [], reject: {} }, tr), /not among/);
  assert.match(validate('track', { keep: 'run25', agree: [], reject: {} }, tr), /camera.valid/);   // proj is single-body
  assert.equal(validate('track', { keep: null, agree: [], reject: { run25: 'x' }, fallback: { recipe: 'penetration-strokes', params: { rate: 3 } } }, tr), null);
  assert.match(validate('roi', { probes: new Array(6).fill({ id: 'p', tracker: 'lk_box', roi: null, params: {}, role: 'subject', part: 'x' }) }), /at most 5/);
  assert.match(validate('roi', { probes: [] }), /none/);
  assert.equal(validate('roi', { probes: [], none: 'offscreen' }), null);
  assert.match(validate('direction', { sign: 1, pairs: [{ deep: 30000, shallow: 1000 }] }, R('direction', s, {})), /scope/);
  assert.match(validate('direction', { sign: 2, pairs: [] }), /sign/);
  assert.match(validate('depth', { lo: 90, hi: 10, intensity: 1 }), /lo/);
  assert.match(validate('verify', { verdict: 'redo', checks: [], note: '' }), /redo/);
  assert.match(validate('climax', { window: { t0: 5, t1: 4 }, afterglowTo: null }), /window/);
  assert.match(validate('camera', { mode: 'static', p95Px: 1, rateHz: null, phaseMs: null, moveSpans: [], valid: [] }), /valid/);
  assert.ok(channelOk('dist01', ['relative']) && !channelOk('proj', ['relative', 'rate']) && channelOk(undefined, ['rate']));
});

test('verifyChecks: independent checks, n/a as null', () => {
  const keep = RUNS_S0[0], script = [];
  for (let t = 0; t < 26489; t += 466) script.push({ at: t, pos: (t / 466) % 2 ? 90 : 0 });
  const c = verifyChecks({ seg: { t0: 0, t1: 26489 }, keep, others: RUNS_S0, pairs: PAIRS_S0, script, loopPeriodMs: 932, prominence: 0.5, review: { errors: 0 } });
  assert.deepEqual(c.map((x) => x.id), ['agree', 'camera', 'rate', 'review']);
  assert.equal(c[0].value, 1); assert.ok(c.every((x) => x.ok), JSON.stringify(c));
  assert.ok(Math.abs(c[2].value - 1) < 0.05);
  const bad = verifyChecks({ seg: { t0: 0, t1: 26489 }, keep: { ...keep, cameraShare: 0.9, cameraOffsetMs: 20 }, others: [], pairs: [], script, loopPeriodMs: 466 * 4, prominence: 0.5, review: { errors: 2 } });
  assert.deepEqual(bad.map((x) => x.ok), [true, false, false, false]);
  assert.equal(bad[0].value, null);
  assert.equal(REDO_OF.camera, 'track'); assert.equal(REDO_OF.review, 'depth');
});

test('planChecks: gaps, overlaps, unknown recipes, orgasm count', () => {
  assert.deepEqual(planChecks([{ t0: 0, t1: 10, kind: 'idle', recipe: 'hold' }, { t0: 10, t1: 20, kind: 'orgasm', recipe: 'orgasm' }, { t0: 20, t1: 30, kind: 'orgasm', recipe: 'orgasm' }], 30), []);
  const p = planChecks([{ t0: 5, t1: 10, kind: 'orgasm', recipe: 'x' }, { t0: 9, t1: 20, kind: 'idle' }, { t0: 25, t1: 26, kind: 'orgasm' }], 30);
  assert.deepEqual(p, ['gap 0-5 ms', 'overlap 9-10 ms', 'gap 20-25 ms', 'gap 26-30 ms', 'unknown recipe "x" at 5 ms', '2 orgasm windows']);
});

test('trace: toRecord supersedes, replays keep identity, toTrace2 / fromTrace2 round trip', () => {
  const req = R('camera', sc(1), { scene: SCENES[1] });
  const d = { req, value: { mode: 'rides', p95Px: 34, rateHz: 1.27, phaseMs: 177, moveSpans: [], valid: ['relative', 'rate'] }, conf: 0.88, calibrated: false, brain: 'rules', status: 'decided', chain: [{ brain: 'rules', raw: 0.88, conf: 0.88, ms: 1 }], rationale: 'r', tools: [], digest: 'abc', ms: 3 };
  const rec = toRecord(d, { session: 'dr-1' });
  assert.equal(rec.id, 'camera:s1'); assert.equal(rec.provisional, false); assert.equal(rec.supersedes, null);
  assert.match(rec.inputs.facts, /cam rides 34 px/);
  assert.equal(toRecord({ ...d, status: 'replayed' }, { session: 'dr-2', prev: rec }), rec);
  const next = toRecord({ ...d, value: { ...d.value, mode: 'sway' }, status: 'provisional' }, { session: 'dr-2', prev: rec });
  assert.equal(next.supersedes.id, rec.id); assert.equal(next.provisional, true);
  const t2 = toTrace2(VIDEO.path, [next]);
  assert.equal(t2.trace[0].stage, `${STAGE_OF.camera}.s1`);
  const { replay } = fromTrace2(JSON.parse(JSON.stringify(t2)));
  assert.deepEqual(replay['camera:s1'].value, next.value);
  assert.equal(JSON.stringify(rec).includes('base64'), false);
  assert.match(factsLine(R('track', sc(0), { runs: RUNS_S0 })), /run25 cotracker_points\/proj/);
});

// the hand-written trace 2 (an excerpt of its stages, same text; the real file is used too when present)
const TRACE2 = { video: 'C:/Videos/clip.mp4', trace: [
  { stage: 'survey.base_and_camera', decision: { s0: 'camera STATIC: wall moves <2 px over the whole scene', s1: 'frame bumps at the stroke rhythm: bench dy ~34 px p5-p95, 2.54 turns/s CV 0.18 -> camera rides with every thrust',
    s2: 'camera push-in 40.5-50 s (head leaves the top of the frame)', s3: 'the bob of the dangling penis is camera sway (bench leg dy ~7 px, dx 0), not thrusts' }, confidence: 0.85 },
  { stage: 'tracking.compare.s0', decision: { keep: 'run25 (covers the whole scene incl. 0-6 s)', agree: ['run23', 'run7 (owner TAPNext, independent tracker)'], reject: ['run10 lk_box (loses points)', 'run8 whole frame'] }, confidence: 0.8 },
  { stage: 'tracking.scene2', decision: { tracked: 'none', kind: 'offscreen, recipe penetration-strokes (constant rate), rate 3.0 turns/s = 90 strokes/min', reject: ['run16 lk_box back'] }, confidence: 0.5 },
  { stage: 'story.climax', decision: { climax: [56222, 66300], afterglow: [66300, 80400] }, confidence: 0.75 },
  { stage: 'story.plan', inputs: { rows: [{ start_ms: 0, end_ms: 4500, kind: 'penetration', recipe: 'penetration', intensity: 0.75, params: { lo: 0, hi: 85 }, name: 'standing grind' },
    { start_ms: 4500, end_ms: 26489, kind: 'penetration', recipe: 'penetration', intensity: 1, params: { lo: 0, hi: 90 } }, { start_ms: 26489, end_ms: 40444, kind: 'knotting', recipe: 'knot-pop-stroke', intensity: 1 }] }, decision: {}, confidence: 0.7 },
  { stage: 'direction', decision: { s0: 'run25 sign +1 (as tracked)', s2: 'not observable (off-screen)' }, confidence: 0.9 },
  { stage: 'generate', decision: { points: 357 } },
] };

test('fromTrace2 reads the hand-written trace 2 into scene-level replay answers', () => {
  const live = join(homedir(), 'Documents/Pawscript-live/DIRECTOR-TRACE-2.json');
  for (const json of [TRACE2, ...(existsSync(live) ? [JSON.parse(readFileSync(live, 'utf8'))] : [])]) {
    const { replay, warnings } = fromTrace2(json);
    assert.deepEqual(['s0', 's1', 's2', 's3'].map((s) => replay[`camera:${s}`].value.mode), ['static', 'rides', 'move', 'sway']);
    assert.deepEqual(replay['camera:s2'].value.moveSpans, [[40500, 50000]]);
    assert.equal(replay['track:s0'].value.keep, 'run25');
    assert.deepEqual(replay['track:s0'].value.agree, ['run23', 'run7']);
    assert.deepEqual(replay['track:s2'].value.fallback, { recipe: 'penetration-strokes', params: { rate: 3 } });
    assert.deepEqual(replay['climax:v'].value, { window: { t0: 56222, t1: 66300 }, afterglowTo: 80400 });
    assert.equal(replay['story:v'].value.segments[0].intensity, 0.75);
    assert.equal(replay['direction:s0'].value.sign, 1); assert.equal(replay['direction:s2'].value.sign, 0);
    assert.ok(warnings.some((w) => /generate/.test(w)));
    for (const [id, r] of Object.entries(replay)) if (id !== 'story:v') assert.equal(validate(id.split(':')[0], r.value), null, id);
  }
});
