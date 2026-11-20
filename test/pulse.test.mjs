// Spurts from contractions (paw-ol3, PROTOCOL v4.16): the anus part and pulse groups (tracking/groups.js), what detect
// cumshots sends and says (lib/cum.js pulsePlan / planText / cumRequest), the evidence on a proposal (why, cumTipText),
// the pulse lane channel (pulseChannels, runs-channel pickerChannels), and a character's balls (paw-x99, balls.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, PULSE_PARTS, isPulse, canPulse, togglePulse, cumGroups, trackGroups } from '../src/features/tracking/groups.js';
import { cumProposals, cumTipText, pulsePlan, planText, pulseChannels, cueText } from '../src/lib/cum.js';
import { cumRequest } from '../src/lib/protocol.js';
import { pickerChannels, chipVariants, groupOfChannel } from '../src/lib/runs-channel.js';
import { ballsReason, ballsChannel } from '../src/features/timeline/balls.js';

const SQ = [[0.4, 0.4], [0.5, 0.4], [0.5, 0.5]];
const anus = { name: 'c2_anus', who: 'c2', part: 'anus', poly: SQ, t_ms: 1000, pinned: true };
const balls = { name: 'c1_balls', who: 'c1', part: 'balls', poly: SQ, t_ms: 1000, pinned: true };
const hand = { name: 'c1_hand_l', who: 'c1', part: 'hand', side: 'l', poly: SQ, t_ms: 1000, pinned: true };

test('anus is a part; it is a pulse group by default, balls / sheath / penis when flagged', () => {
  assert.ok(PARTS.includes('anus') && PARTS.indexOf('anus') < PARTS.indexOf('hips'));
  assert.deepEqual(PULSE_PARTS, ['anus', 'balls', 'sheath', 'penis']);
  assert.equal(isPulse(anus), true); assert.equal(isPulse(balls), false); assert.equal(isPulse({ name: 'anus' }), true);
  assert.equal(canPulse(balls), true); assert.equal(canPulse(hand), false); assert.equal(canPulse({ name: 'unassigned_1' }), false);
  const b2 = togglePulse(balls);
  assert.equal(b2.pulse, true); assert.equal(isPulse(b2), true);
  assert.equal('pulse' in togglePulse(b2), false, 'back to the default: no key');
  assert.equal(togglePulse(anus).pulse, false);
  assert.deepEqual(trackGroups([{ start_ms: 0, end_ms: 5000, groups: [b2] }], 0, 5000)[0].pulse, undefined, 'Track is not sent the flag');
});

test('cumGroups: the scene\'s groups with their pulse flag, only when one is a pulse group', () => {
  const shots = [{ start_ms: 0, end_ms: 3000, groups: [anus, balls] }, { start_ms: 3000, end_ms: 6000, join: true, groups: [hand, { ...hand, name: 'c1_hand_r', off: true }] }];
  const g = cumGroups(shots);
  assert.deepEqual(g.map((x) => [x.name, x.pulse]), [['c2_anus', true], ['c1_balls', false], ['c1_hand_l', false]]);
  assert.deepEqual(g[0], { name: 'c2_anus', poly: SQ, t_ms: 1000, pulse: true, who: 'c2', part: 'anus' });
  assert.deepEqual(cumGroups([{ groups: [balls, hand] }]), [], 'no pulse group: nothing to track');
  assert.deepEqual(cumGroups({ groups: [{ ...anus, off: true }] }), []);
  assert.deepEqual(cumGroups(null), []);
});

test('pulsePlan / planText: what detect uses and how long SAM runs (the orgasm span + 1 s, clipped)', () => {
  const span = { t0: 10000, t1: 40000 }, groups = cumGroups([{ groups: [anus, togglePulse(balls)] }]);
  const p = pulsePlan(groups, span, { t0: 20000, t1: 30000 }, 'sem_c1_balls_scale');
  assert.deepEqual(p.range, [20000, 30000]);
  assert.deepEqual(p.uses, ['anus (Top)', 'balls (Bottom)']);
  assert.equal(p.samS, 2 * 12);
  assert.equal(planText(p), 'uses anus (Top), balls (Bottom) · SAM on 24 s');
  const whole = pulsePlan(groups.slice(0, 1), span, null, '');
  assert.deepEqual([whole.range, whole.samS], [[10000, 40000], 32], 'the margin reaches past the span');
  const none = pulsePlan([], span, { t0: 20000, t1: 30000 }, 'sem_balls_scale');
  assert.deepEqual([none.range, none.samS, planText(none)], [null, 0, 'uses balls']);
  assert.equal(planText(pulsePlan([], span)), '');
});

test('cumRequest sends groups and the pulse range only with groups', () => {
  const g = cumGroups([{ groups: [anus] }]);
  assert.deepEqual(cumRequest('v', 0, 9, {}, null, g, [100.4, 900.6]), { cmd: 'cum', video: 'v', start_ms: 0, end_ms: 9, params: {}, groups: g, pulse_range: [100, 901] });
  assert.equal('groups' in cumRequest('v', 0, 9, {}, null, [], [1, 2]), false);
  assert.equal('pulse_range' in cumRequest('v', 0, 9, {}, null, g, null), false);
});

test('proposals keep their evidence and the tip shows it', () => {
  const res = { spurts: [{ t_ms: 1500, score: 0.79, source: 'anus (Top)', why: [{ cue: 'anus (Top)', score: 0.7 }, { cue: 'fluid', score: 0.3049 }, { cue: 'balls pulse' }, { nope: 1 }] },
    { t_ms: 2500, score: 0.4, source: 'tag', why: [] }] };
  const l = cumProposals(res, { start_ms: 1000, end_ms: 3000 }, 40);
  assert.deepEqual(l[0].why, [{ cue: 'anus (Top)', score: 0.7 }, { cue: 'fluid', score: 0.3 }, { cue: 'balls pulse' }]);
  assert.equal('why' in l[1], false);
  const tip = cumTipText(l[0]);
  assert.match(tip, /score 0\.79 \(strong\)\nevidence: anus \(Top\) contraction 0\.70 · new fluid 0\.30 · balls pulse \(tracker run\)\nnot placed yet/);
  assert.doesNotMatch(cumTipText(l[1]), /evidence/);
  assert.equal(cueText('tag'), 'spurt tags');
});

test('pulse channels become run channels and the anus chip shows its pulse first', () => {
  const ch = pulseChannels({ channels: { sem_c2_anus_pulse: [[0, 0.5], [40, null], [80, 3.2]], other: [[0, 1]] } });
  assert.deepEqual(Object.keys(ch), ['sem_c2_anus_pulse']);
  assert.deepEqual(ch.sem_c2_anus_pulse.t, [0, 40, 80]); assert.ok(Number.isNaN(ch.sem_c2_anus_pulse.v[1]));
  assert.deepEqual(pulseChannels(null), {});
  assert.deepEqual([ch.sem_c2_anus_pulse.min, ch.sem_c2_anus_pulse.max], [0.5, 3.2], 'paw-wzxu: a run channel carries its range (the panel reads c.min.toFixed)');
  const none = pulseChannels({ channels: { sem_c1_balls_pulse: [[0, null], [40, null]] } }).sem_c1_balls_pulse;   // the points fallback with nothing found
  assert.deepEqual([none.min, none.max], [0, 0]);
  const T = [0, 40, 80], c = { t: T, v: [0, 1, 0] };
  const run = { channels: { sem_c2_anus_proj: c, sem_c2_anus_scale: c, sem_c2_anus_pulse: c, sem_c1_balls_scale: c, sem_c1_balls_pulse: c } };
  assert.equal(groupOfChannel('sem_c2_anus_pulse').kind, 'pulse');
  const chips = pickerChannels(run);
  assert.ok(chips.includes('sem_c2_anus_pulse') && !chips.includes('sem_c2_anus_proj'));
  assert.deepEqual(chipVariants(run, 'sem_c2_anus_pulse'), ['sem_c2_anus_pulse', 'sem_c2_anus_proj', 'sem_c2_anus_scale']);
  assert.ok(chips.includes('sem_c1_balls_scale') && chipVariants(run, 'sem_c1_balls_scale').includes('sem_c1_balls_pulse'));
});

test('paw-x99: a character\'s balls group gives the spurt suggestion (the one present longest)', () => {
  const T = Array.from({ length: 100 }, (_, i) => i * 100), ch = (f) => ({ t: T, v: T.map(f) });
  const run = { scenes: [{ start_ms: 0, end_ms: 10000 }], notes: [], channels: {
    sem_c1_balls_scale: ch((t) => Math.sin(t / 300)), sem_c1_balls_n: ch((t) => (t < 2000 ? 0.05 : 0)),
    sem_c2_balls_scale: ch((t) => Math.cos(t / 300)), sem_c2_balls_n: ch(() => 0.05) } };
  assert.equal(ballsChannel(run, 0, 0, 10000), 'sem_c2_balls_scale');
  const app = { doc: { scenes: [{ start_ms: 0, end_ms: 10000 }], ghosts: [{ id: 'r1', visible: true, script: [{ at: 0, pos: 50 }, { at: 9900, pos: 50 }], source: { kind: 'tracker', range: { t0: 0, t1: 10000 } } }] } };
  const on = ballsReason(app, 5000, { runOf: () => run });
  assert.deepEqual([on.enabled, on.ch], [true, 'sem_c2_balls_scale']);
  const rare = { ...run, channels: { sem_c1_balls_scale: run.channels.sem_c1_balls_scale, sem_c1_balls_n: run.channels.sem_c1_balls_n } };
  assert.deepEqual(ballsReason(app, 5000, { runOf: () => rare }).short, 'balls 20 %');
  const plain = { ...run, channels: { ...run.channels, sem_balls_scale: ch(() => 1), sem_balls_n: ch(() => 0.1) } };
  assert.equal(ballsChannel(plain, 0, 0, 10000), 'sem_balls_scale', 'the plain group still wins');
});
