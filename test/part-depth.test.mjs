// paw-4c48.19 (PROTOCOL v4.52): the SAM depth measurement on any part the owner turns on. A part is never "the shaft": the
// penis keeps every default; a part is read only by name (shaftOf / railContext / shaftScene / shaftChannel / shaftDepth with
// { part }, the source 'part:<name>', the fusion depth 'part:<name>'). The synthetic shot of shaft-source.test.mjs, its channels
// written under a second name whose scene record says role 'part'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shaftNames, partNames, shaftOf, partOf, partSource, partWord, isShaftSource, shaftDepth, railContext } from '../src/lib/shaft.js';
import { shaftScene, shaftChannel, shaftChipText } from '../src/lib/shaft-source.js';
import { canSource } from '../src/lib/signal-source.js';
import { depthRef, depthWord } from '../src/lib/depth-seat.js';
import { channelPatch } from '../src/lib/runs-channel.js';
import { deriveClean } from '../src/lib/rederive.js';
import { trackGroups, canDepth, isDepth, toggleDepth } from '../src/features/tracking/groups.js';
import { channelOf } from '../src/lib/runs.js';

const A = 16 / 9, N = 120, T = Array.from({ length: N }, (_, i) => Math.round((i * 1000) / 30));
const ANG = (-40 * Math.PI) / 180, U = [Math.cos(ANG), Math.sin(ANG)], LF = 0.3, E = [0.62 * A, 0.38];
const vis = (t) => 0.6 + 0.3 * Math.cos((2 * Math.PI * t) / 1000);
const base = (t) => [E[0] - vis(t) * LF * U[0], E[1] - vis(t) * LF * U[1]];
const ch = (f) => channelOf(T.map((t, i) => { const v = f(t, i); return [t, v === v && v != null ? v : null]; }));
const shaftCh = (P, v = vis) => ({
  [P + 'len']: ch((t) => v(t)), [P + 'in']: ch((t) => 1 - v(t)), [P + 'in_conf']: ch(() => 1),
  [P + 'bx']: ch((t) => (E[0] - v(t) * LF * U[0]) / A), [P + 'by']: ch((t) => E[1] - v(t) * LF * U[1]),
  [P + 'ex']: ch(() => E[0] / A), [P + 'ey']: ch(() => E[1]), [P + 'w']: ch(() => 0.05) });

/** A run with the penis and / or the forearm measured (the forearm's strokes at another depth). */
function run({ penis = true, arm = true } = {}) {
  const rec = { ...(penis ? { c2_penis: { source: 'sam', full: 'seen', l_full_w: 5 } } : {}), ...(arm ? { c2_forearm_r: { source: 'sam', full: 'relative', l_full_w: 4, role: 'part', receiver: ['c1_anus'], receiver_from: 'parts' } } : {}) };
  return { id: 'r', range: { start: 0, end: 4000 }, flips: [], scenes: [{ start_ms: 0, end_ms: 4000, sign: 1, shaft: rec }],
    points0: { at: Float64Array.from([0, 4000]), pos: Float64Array.from([50, 50]) },
    channels: { ...(penis ? shaftCh('sem_c2_penis_') : {}), ...(arm ? shaftCh('sem_c2_forearm_r_', (t) => 0.5 + 0.2 * Math.cos((2 * Math.PI * t) / 1000)) : {}), proj: ch((t) => vis(t)) } };
}

test('a depth part is never the shaft: names, shaftOf and every default leave it out; by name it reads', () => {
  const R = run();
  assert.deepEqual(shaftNames(R), ['c2_penis']);
  assert.deepEqual(partNames(R), ['c2_forearm_r']);
  assert.equal(shaftOf(R, 0).name, 'c2_penis');
  assert.equal(shaftOf(R, 0, { part: 'c2_forearm_r' }).name, 'c2_forearm_r');
  assert.equal(shaftOf(R, 0, { part: 'c2_penis' }), null, 'the penis is no part');
  // only the part measured: no shaft at all (the defaults: no shaft source, no shaft depth), the part by name
  const P = run({ penis: false });
  assert.deepEqual(shaftNames(P), []);
  assert.equal(shaftOf(P, 0), null);
  assert.equal(shaftDepth(P, 0, T), null);
  assert.equal(canSource(P, 'shaft'), false);
  assert.equal(canSource(P, 'part:c2_forearm_r'), true);
  assert.equal(canSource(P, 'part:c1_tail'), false);
  assert.ok(shaftDepth(P, 0, T, null, { aspect: A, part: 'c2_forearm_r' }).share > 0.9);
});

test('the part reads through the same functions: rail, source scene and channel, chip words; the names round-trip', () => {
  const R = run({ penis: false }), part = 'c2_forearm_r';
  assert.equal(partOf(partSource(part)), part);
  assert.equal(partOf('shaft'), null);
  assert.ok(isShaftSource('shaft') && isShaftSource('part:x') && !isShaftSource('fused'));
  assert.equal(partWord(part), 'forearm R');
  const ctx = railContext(R, 0, null, { aspect: A, part });
  assert.equal(ctx.name, part);
  assert.equal(ctx.part, part);
  const s = shaftScene(R, 0, { aspect: A, part });
  assert.equal(s.name, part);
  assert.equal(s.share, 1);
  assert.ok(Math.abs(s.v[15] - 0) < 0.02 && Math.abs(s.v[0] - 1) < 0.02, 'its own extremes: deepest 0, fully out 1');
  const c = shaftChannel(R, { aspect: A, part });
  assert.ok(c.t.length === N && c.absolute && c.info[0].ok);
  assert.equal(shaftChipText(c.info[0], part), 'forearm R 100 %');
  assert.equal(shaftChipText(null), 'Shaft');
  assert.match(shaftScene(run({ arm: false }), 0, { aspect: A, part }).why, /no forearm R read in this shot/);
});

test('the source part:<name> plays the part (absolute, its own direction, a cleared flip kept); fusion depth reads it', () => {
  const R = run();
  const p = channelPatch(R, 'proj', {}, [], { derives: [{ source: 'part:c2_forearm_r' }], aspect: A });
  assert.equal(p.sceneChannels[0], 'part:c2_forearm_r');
  assert.ok(p.partSrc?.c2_forearm_r?.[0]?.ok);
  assert.equal(p.shaftSrc, null, 'the penis channel is not built for a part');
  const pos = Array.from(p.points0.pos), lo = Math.min(...pos), hi = Math.max(...pos);
  assert.ok(lo < 10 && hi > 90, `its own depth scale: ${lo.toFixed(1)} .. ${hi.toFixed(1)}`);
  // nothing set: as before (no part channel built)
  const q = channelPatch(R, 'proj', {}, [], { aspect: A });
  assert.equal(q.partSrc, null);
  assert.equal(q.sceneChannels[0], 'proj');
  // the owner's cleared flip is kept for a part, as for Shaft (rederive.deriveClean)
  assert.equal(deriveClean({ source: 'part:c2_forearm_r', unflip: true }).unflip, true);
  assert.equal(deriveClean({ source: 'proj', unflip: true }).unflip, undefined);
  assert.equal(deriveClean({ fuse: { depth: 'part:c2_forearm_r' } }).fuse.depth, 'part:c2_forearm_r', 'the fusion depth part is kept');
  assert.equal(deriveClean({ fuse: { depth: 'part:Bad Name' } })?.fuse?.depth, undefined);
  // the fusion depth reference 'part:<name>'
  const idx = T.map((_, i) => i), ref = depthRef(R, 0, idx, T, 'part:c2_forearm_r', { aspect: A });
  assert.ok(ref.x && ref.name === 'sem_c2_forearm_r_len');
  assert.match(depthRef(run({ arm: false }), 0, idx, T, 'part:c2_forearm_r', { aspect: A }).why, /no forearm R measured/);
  assert.equal(depthWord('part:c2_forearm_r'), 'the forearm R');
  assert.equal(depthWord('shaft'), 'the shaft');
});

test('the Groups tool flag: off unless turned on, remembered, sent to Track only for that group; the penis keeps its own', () => {
  const sc = { start_ms: 0, end_ms: 1000, groups: [
    { name: 'c2_forearm_r', who: 'c2', part: 'forearm', side: 'r', poly: [[0, 0], [1, 0], [1, 1]], t_ms: 10 },
    { name: 'c1_anus', who: 'c1', part: 'anus', poly: [[0, 0], [1, 0], [1, 1]], t_ms: 10 },
    { name: 'c2_penis', who: 'c2', part: 'penis', poly: [[0, 0], [1, 0], [1, 1]], t_ms: 10 }] };
  const before = trackGroups([sc], 0, 1000);
  assert.ok(before.every((g) => !('depth' in g)), 'nothing turned on: no depth key anywhere (the request as before)');
  const arm = sc.groups[0];
  assert.ok(canDepth(arm) && !isDepth(arm));
  assert.ok(!canDepth(sc.groups[2]), 'the penis has its own shaft toggle');
  const on = toggleDepth(arm);
  assert.ok(isDepth(on));
  assert.deepEqual(toggleDepth(on), arm, 'off again: the key gone');
  const after = trackGroups([{ ...sc, groups: [on, sc.groups[1], sc.groups[2]] }], 0, 1000);
  assert.equal(after.find((g) => g.name === 'c2_forearm_r').depth, true);
  assert.ok(!('depth' in after.find((g) => g.name === 'c1_anus')));
  assert.deepEqual(after.filter((g) => g.name !== 'c2_forearm_r'), before.filter((g) => g.name !== 'c2_forearm_r'));
});
