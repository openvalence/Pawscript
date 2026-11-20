// The rules brain on a trace-2-shaped fact sheet: one test per decision kind. Targets from DESIGN §7 (trace-2
// regression with the rules brain): camera 4/4; track s0/s1 keep run25/run21, reject lk_box and the whole frame;
// s2 offscreen and the climax not settled by rules alone (below tau).
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Ru from '../src/features/director/brains/rules.js';
import { POLICY, validate } from '../src/lib/director/decisions.js';
import { SCENES, VIDEO, DUR, RUNS_S0, PAIRS_S0, RUNS_S1, PAIRS_S1, RUNS_S2, CANDS_S0, CANDS_S1, PICK_S0, sc, R } from './director-brains-fixtures.mjs';

const ok = (req, a) => { assert.ok(a.value !== undefined, a.abstain); assert.equal(validate(req.kind, a.value, req), null); return a; };
const cams = SCENES.map((s, i) => Ru.camera(R('camera', sc(i), { scene: s })).value);
const climaxV = Ru.climax(R('climax', { scene: null, t0: 0, t1: DUR }, { video: VIDEO, scenes: SCENES })).value;
const storyReq = (i, o = {}) => R('story', sc(i), { scene: SCENES[i], video: VIDEO, scenes: SCENES, camera: cams[i], climax: climaxV, ...o });
const SEG = { t0: 0, t1: 26489, kind: 'penetration', recipe: 'penetration', visible: true, action: 'continues', intensity: 1, name: 'p' };

test('camera: static / rides / move / sway as trace 2', () => {
  const modes = SCENES.map((s, i) => { const req = R('camera', sc(i), { scene: s }); return ok(req, Ru.camera(req)); });
  assert.deepEqual(modes.map((a) => a.value.mode), ['static', 'rides', 'move', 'sway']);
  assert.deepEqual(modes[0].value.valid, ['single', 'relative', 'rate']);
  assert.deepEqual(modes[1].value.valid, ['relative', 'rate']);
  assert.equal(modes[1].value.phaseMs, 177);
  assert.deepEqual(modes[2].value.moveSpans, [[40500, 50000]]);
  assert.ok(modes[1].raw >= POLICY.camera.tau && modes[2].raw >= POLICY.camera.tau);
  assert.ok(modes[3].raw < POLICY.camera.tau);   // sway: routed on
  assert.equal(Ru.camera(R('camera', sc(0), { scene: { ...SCENES[0], camera: null } })).abstain, 'no motion.stats for this scene');
});

test('climax: cum-tag onset snapped to the cut, energy decay, afterglow', () => {
  const req = R('climax', { scene: null, t0: 0, t1: DUR }, { video: VIDEO, scenes: SCENES }), a = ok(req, Ru.climax(req));
  assert.equal(a.value.window.t0, 56222);   // first spurt 0.6 s after the cut
  assert.ok(Math.abs(a.value.window.t1 - 66300) <= 1000, String(a.value.window.t1));
  assert.ok(a.value.afterglowTo > a.value.window.t1 && a.value.afterglowTo <= 80400);
  assert.match(a.rationale, /snapped to the cut/);
  // no cum tag, flat energy: no climax, unsure
  const flat = SCENES.map((s) => ({ ...s, describe: s.describe && { ...s.describe, cumOnsetMs: null }, energy: { t: s.energy.t, v: s.energy.t.map(() => 0.05) } }));
  const b = Ru.climax(R('climax', { scene: null, t0: 0, t1: DUR }, { video: VIDEO, scenes: flat }));
  assert.equal(b.value.window, null); assert.ok(b.raw < POLICY.climax.tau);
  // onset before 40% of the video is ignored; an energy burst then decay still proposes one, weakly
  const early = flat.map((s, i) => (i === 3 ? { ...s, energy: SCENES[3].energy } : s));
  early[0] = { ...early[0], describe: { ...early[0].describe, cumOnsetMs: 3000 } };
  const c = Ru.climax(R('climax', { scene: null, t0: 0, t1: DUR }, { video: VIDEO, scenes: early }));
  assert.match(c.rationale, /energy burst/); assert.ok(c.value.window.t0 >= 0.4 * DUR); assert.ok(c.raw < 0.6);
});

test('story: tags, energy split, offscreen with the wobble rate, climax run-in / orgasm / afterglow / idle / outro', () => {
  const s0 = ok(storyReq(0), Ru.story(storyReq(0))).value.segments;
  assert.deepEqual(s0.map((s) => [s.kind, s.intensity]), [['penetration', 0.75], ['penetration', 1]]);   // 0.043 / 0.057
  assert.ok(Math.abs(s0[0].t1 - 4500) <= 1000);
  assert.match(s0[0].name, /from behind · cam static/);
  const s2 = ok(storyReq(2), Ru.story(storyReq(2)));
  // offscreen, then the fast climax run-in (6.5 s, the reference fit) right before the orgasm window at 56.2 s
  assert.deepEqual(s2.value.segments.map((s) => [s.kind, s.visible, s.recipe, s.params?.rate]), [['offscreen', false, 'penetration-strokes', 3], ['climax', true, undefined, undefined]]);
  assert.deepEqual([s2.value.segments[1].t0, s2.value.segments[1].t1], [56222 - 6500, 56222]);
  assert.ok(s2.raw < POLICY.story.tau);   // tags say sex, the camera says offscreen: not settled by rules
  const s3 = ok(storyReq(3), Ru.story(storyReq(3))).value.segments;
  assert.deepEqual(s3.map((s) => s.kind), ['orgasm', 'afterglow', 'idle', 'outro']);
  assert.equal(s3[0].t0, 56222); assert.equal(s3[0].recipe, 'orgasm');
  assert.ok(Math.abs(s3[2].t0 - 80400) <= 1200 && Math.abs(s3[3].t0 - 84800) <= 1000, JSON.stringify(s3.map((s) => s.t0)));
  // the per-second evidence decide() combines with the VLM's
  const ev = Ru.story(storyReq(1)).value.evidence;
  assert.equal(ev.logp.length, Math.ceil((40444 - 26489) / 1000)); assert.equal(ev.names.length, ev.logp[0].length);
  // black frames at the head -> idle
  const blackHead = { ...SCENES[0], seconds: SCENES[0].seconds.map((x) => (x.t < 3000 ? { ...x, black: true } : x)) };
  assert.equal(Ru.story(storyReq(0, { scene: blackHead })).value.segments[0].kind, 'idle');
  // no describe, no loop, no energy: nothing to go on -> still answers with the motion kind, unsure
  const bare = { ...SCENES[0], describe: null, loop: null, energy: { t: [], v: [] } };
  assert.ok(Ru.story(storyReq(0, { scene: bare, scenes: [bare] })).raw < 0.5);
  assert.equal(Ru.story(R('story', sc(0), {})).abstain, 'no scene facts');
});

test('roi: reference tile + proposed axis (static), anti-phase pair + sam2 part (rides), none when offscreen', () => {
  const r0 = R('roi', sc(0), { scene: SCENES[0], camera: cams[0], segment: SEG, candidates: CANDS_S0 }), a0 = ok(r0, Ru.roi(r0)).value.probes;
  assert.deepEqual(a0.map((p) => [p.role, p.tracker, p.channel ?? null]), [['reference', 'lk_box', null], ['subject', 'tapnext_points', 'proj']]);
  assert.deepEqual([a0[1].params.axis_x0, a0[1].params.axis_x1], [0.78, 0.6]);   // right -> left = in, as run25
  const r1 = R('roi', sc(1), { scene: SCENES[1], camera: cams[1], segment: { ...SEG, kind: 'knotting' }, candidates: CANDS_S1 }), a1 = ok(r1, Ru.roi(r1)).value.probes;
  assert.deepEqual(a1.filter((p) => p.role === 'subject').map((p) => [p.tracker, p.channel]), [['tapnext_points', 'dist01'], ['sam2_mask', 'area']]);
  const r2 = R('roi', sc(2), { scene: SCENES[2], camera: cams[2], segment: { ...SEG, kind: 'offscreen', visible: false } });
  assert.deepEqual(Ru.roi(r2).value, { probes: [], none: 'offscreen' });
  const r3 = R('roi', sc(0), { scene: SCENES[0], camera: cams[0], segment: SEG, candidates: [] }), a3 = ok(r3, Ru.roi(r3));
  assert.equal(a3.value.probes[1].tracker, 'lk_box'); assert.equal(a3.value.probes[1].part, 'sex'); assert.equal(a3.raw, 0.5);
  assert.ok(a0.every((p) => /^[0-9a-f]{14}$/.test(p.id)));
});

test('track: keep run25 / run21, reject lk_box, whole frame, camera; none with the wobble rate', () => {
  const t0 = R('track', sc(0), { scene: SCENES[0], camera: cams[0], segment: SEG, runs: RUNS_S0, pairs: PAIRS_S0 }), a0 = ok(t0, Ru.track(t0));
  assert.equal(a0.value.keep, 'run25'); assert.deepEqual(a0.value.agree, ['run23', 'run7']);
  assert.ok(a0.value.reject.run10 && a0.value.reject.run8); assert.equal(a0.value.reject.run9, undefined);
  assert.ok(a0.raw >= POLICY.track.tau);
  const t1 = R('track', sc(1), { scene: SCENES[1], camera: cams[1], segment: SEG, runs: RUNS_S1, pairs: PAIRS_S1 }), a1 = ok(t1, Ru.track(t1));
  assert.equal(a1.value.keep, 'run21'); assert.equal(a1.value.channel, 'dist01'); assert.deepEqual(a1.value.agree, ['run22']);
  assert.match(a1.value.reject.run13, /rate/);
  const t2 = R('track', sc(2), { scene: SCENES[2], camera: cams[2], segment: { ...SEG, kind: 'offscreen' }, runs: RUNS_S2, pairs: [] }), a2 = ok(t2, Ru.track(t2));
  assert.equal(a2.value.keep, null); assert.deepEqual(a2.value.fallback, { recipe: 'penetration-strokes', params: { rate: 3 } });
  assert.match(a2.value.reject.run16, /camera/);
  // one survivor, nobody agrees: below tau
  const lone = Ru.track(R('track', sc(0), { scene: SCENES[0], camera: cams[0], segment: SEG, runs: [RUNS_S0[0]], pairs: [] }));
  assert.equal(lone.value.keep, 'run25'); assert.ok(lone.raw < POLICY.track.tau);
  // a single-body channel under a riding camera is rejected
  const rides = Ru.track(R('track', sc(1), { scene: SCENES[1], camera: cams[1], segment: SEG, runs: [{ ...RUNS_S1[0], id: 'runP', channel: 'proj' }], pairs: [] }));
  assert.equal(rides.value.keep, null); assert.match(rides.value.reject.runP, /channel proj/);
});

test('direction: dist01 geometry, proj prior, assist facts, pairs mapped by sign', () => {
  const d1 = R('direction', sc(1), { keep: 'run21', runs: RUNS_S1, pickPairs: [] }), a1 = ok(d1, Ru.direction(d1));
  assert.equal(a1.value.sign, 1); assert.ok(a1.raw >= POLICY.direction.tau);
  const d0 = R('direction', sc(0), { keep: 'run25', runs: RUNS_S0, pickPairs: PICK_S0 }), a0 = ok(d0, Ru.direction(d0));
  assert.equal(a0.value.sign, 1); assert.ok(a0.raw < POLICY.direction.tau);
  assert.deepEqual(a0.value.pairs[2], { deep: 10320, shallow: 9860 });   // lower pos = deeper
  const f = ok(d0, Ru.direction(R('direction', sc(0), { keep: 'run25', runs: RUNS_S0, pickPairs: PICK_S0, assist: [{ deep: 5670, shallow: 5100, agrees: false }] })));
  assert.equal(f.value.sign, -1); assert.equal(f.raw, 0.98); assert.deepEqual(f.value.pairs[0], { deep: 5670, shallow: 5100 });
  assert.deepEqual(Ru.pairsForSign(PICK_S0, 0), []);
  assert.equal(Ru.direction(R('direction', sc(0), { keep: 'runX', runs: RUNS_S0 })).abstain, 'no kept run');
  assert.match(Ru.direction(R('direction', sc(0), { keep: 'run7', runs: RUNS_S0 })).abstain, /centroid_x/);
});

test('depth: recipe range, intensity from the excursion or the story', () => {
  const a = ok(R('depth', sc(0), {}), Ru.depth(R('depth', sc(0), { segment: { ...SEG, intensity: 0.75 } })));
  assert.deepEqual(a.value, { lo: 0, hi: 85, intensity: 0.75 }); assert.ok(a.raw >= POLICY.depth.tau);
  assert.deepEqual(Ru.depth(R('depth', sc(1), { segment: { ...SEG, kind: 'knotting', recipe: 'knot-pop-stroke' }, excursion: { median2s: 0.043, max2s: 0.057 } })).value, { lo: 0, hi: 80, intensity: 0.75 });
  assert.deepEqual(Ru.depth(R('depth', sc(0), { segment: { ...SEG, params: { lo: 0, hi: 90 } } })).value.hi, 90);
});

test('verify: ok only when every applicable check passes; redo names the target; abstain without evidence', () => {
  const C = (id, ok2, value) => ({ id, ok: ok2, value, limit: '' });
  const req = (checks) => R('verify', sc(0), { checks });
  assert.equal(ok(req([]), Ru.verify(req([C('agree', true, 0.9), C('camera', true, 0.1), C('rate', true, null)]))).value.verdict, 'ok');
  const bad = Ru.verify(req([C('agree', true, 0.9), C('review', false, 3)]));
  assert.deepEqual([bad.value.verdict, bad.value.redo], ['redo', 'depth']);
  assert.match(Ru.verify(req([C('agree', true, null)])).abstain, /frame check/);
  assert.ok(Ru.verify(req([C('agree', true, 0.9)])).raw < POLICY.verify.tau);   // one check alone: routed on
});

test('rulesBrain: batched, same order, never throws', async () => {
  const reqs = [R('camera', sc(1), { scene: SCENES[1] }), R('nope', sc(0), {}), R('story', sc(0), {})];
  const out = await Ru.rulesBrain.decide(reqs);
  assert.deepEqual(out.map((a) => a.id), reqs.map((r) => r.id));
  assert.equal(out[0].value.mode, 'rides'); assert.match(out[1].abstain, /unknown kind/); assert.ok(out[2].abstain);
});
