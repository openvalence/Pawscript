// paw-5r1: L / R = the character's own left / right. The side is the owner's word; a proposal only suggests one: L when nothing is
// known (the owner: "I always do the character's left"), R when that character's L of the part is already there, the owner's F first;
// never from where a blob sits in the picture. Suggest's sides are proposals too: a second hand is the R one, never an L repeat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairSide, suggestedGroups, assignGroup, PAIRED } from '../src/features/tracking/groups.js';
import { proposedSides, planConfirm, sideText, proposedName } from '../src/features/tracking/autoname.js';

const sq = (x, y, r = 0.05) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
const U = (n, x) => ({ name: 'unassigned_' + n, poly: sq(x, 0.5) });
const prop = (part, auto = true) => ({ parts: [{ part, p: 0.95 }], conf: 0.95, auto, who: null, whoConf: 0 });

test('pairSide: L by default, R when the L is there and the R is not', () => {
  assert.equal(pairSide(new Set(), 'c1', 'forearm'), 'l');
  assert.equal(pairSide(new Set(['c1_forearm_l']), 'c1', 'forearm'), 'r');
  assert.equal(pairSide(new Set(['c2_forearm_l']), 'c1', 'forearm'), 'l', 'another character\'s limb says nothing');
  assert.equal(pairSide(new Set(['c1_forearm_l', 'c1_forearm_r']), 'c1', 'forearm'), 'l', 'both there: a repeat of the asked side');
  assert.equal(pairSide(new Set(['c1_shin_r']), 'c1', 'shin', 'r'), 'l');
  for (const p of ['shoulder', 'forearm', 'shin']) assert.ok(PAIRED.includes(p));
});

test('proposed sides: the first L (default), the second R (pair), the owner\'s flip first; the same whatever the picture shows', () => {
  for (const xs of [[0.2, 0.8], [0.8, 0.2], [0.5, 0.5]]) {
    const gs = [U(1, xs[0]), U(2, xs[1])], props = new Map(gs.map((g) => [g, prop('shin')]));
    assert.deepEqual([...proposedSides(gs, props, 'c1').values()], [{ side: 'l', how: 'default' }, { side: 'r', how: 'pair' }], `blobs at ${xs}`);
    assert.deepEqual(planConfirm(gs, props, 'c1').map((e) => e.side), ['l', 'r']);
    const mine = { whos: new Map(), sides: new Map([[gs[1], 'l']]) };
    assert.deepEqual([...proposedSides(gs, props, 'c1', mine).entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]), [{ side: 'r', how: 'pair' }, { side: 'l', how: 'own' }]);
  }
  // a painted L of that character: the blob is proposed R; of the other character: still L
  const done = { name: 'c1_hand_l', who: 'c1', part: 'hand', side: 'l', poly: sq(0.3, 0.5) }, u = U(1, 0.7);
  assert.deepEqual(proposedSides([done, u], new Map([[u, prop('hand')]]), 'c1').get(1), { side: 'r', how: 'pair' });
  assert.deepEqual(proposedSides([done, u], new Map([[u, prop('hand')]]), 'c2').get(1), { side: 'l', how: 'default' });
  // a doubtful proposal shows a side but does not take it from a sure one
  const a = U(1, 0.2), b = U(2, 0.8), pr = new Map([[a, prop('forearm', false)], [b, prop('forearm')]]);
  assert.deepEqual([...proposedSides([a, b], pr, 'c1').values()].map((x) => x.side), ['l', 'l']);
  assert.equal(planConfirm([a, b], pr, 'c1')[0].side, 'l');
  assert.equal(proposedName(prop('forearm'), 'c2', 'r'), 'c2_forearm_r');
});

test('the chip says when the side is only the default', () => {
  assert.equal(sideText({ side: 'l', how: 'default' }), 'L (default)');
  assert.equal(sideText({ side: 'r', how: 'pair' }), 'R');
  assert.equal(sideText({ side: 'l', how: 'own' }), 'L');
  assert.equal(sideText(null), '');
});

test('Suggest: a paired part whose side is painted here takes the other one; a re-found identity keeps its name; nothing painted: as proposed', () => {
  const mask = () => ({ w: 1, h: 1, rle: [15, 1] }), painted = [{ name: 'c1_hand_l', who: 'c1', part: 'hand', side: 'l', poly: sq(0.3, 0.5) }];
  const res = { groups: [{ name: 'c1_hand_l', poly: sq(0.7, 0.5), score: 0.9 }, { name: 'c1_forearm_l', poly: sq(0.6, 0.4), score: 0.9 }] };
  const out = suggestedGroups(res, 1000, painted, mask);
  assert.deepEqual(out.map((g) => [g.name, g.side]), [['c1_hand_r', 'r'], ['c1_forearm_l', 'l']]);
  const again = suggestedGroups({ groups: [{ name: 'c1_hand_l', poly: sq(0.7, 0.5), unconfirmed: true, prior: 'c1_hand_l' }] }, 1000, painted, mask);
  assert.equal(again[0].name, 'c1_hand_l', 'a re-found identity is the owner\'s: kept');
  assert.equal(suggestedGroups(res, 1000, [], mask)[0].name, 'c1_hand_l');
});

test('stored sides are what the owner gave: assigning keeps the asked side, the default only when none is given', () => {
  const l = [{ name: 'unassigned_1', poly: sq(0.9, 0.5) }];
  assert.equal(assignGroup(l, 0, { who: 'c1', part: 'forearm', side: 'r' })[0].name, 'c1_forearm_r', 'R on the picture\'s right or left: R');
  assert.equal(assignGroup(l, 0, { who: 'c1', part: 'forearm' })[0].side, 'l');
});
