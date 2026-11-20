// paw-6m6o: the Groups tool's labels (src/features/tracking/group-labels.js): short tags, the shared character.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shortTag, sharedWho, dropWho, nextLabelMode, LABEL_MODES } from '../src/features/tracking/group-labels.js';
import { PARTS, PAIRED, WHOS, groupName } from '../src/features/tracking/groups.js';

test('short tags: RS, LT2, ?3; unique among every name of a character, and across characters with the who letter', () => {
  assert.equal(shortTag('c1_shoulder_r'), 'RS');
  assert.equal(shortTag('c1_thighs_l2'), 'LT2');
  assert.equal(shortTag('c1_shin_r'), 'RSn');
  assert.equal(shortTag('c1_tail'), 'Ta');
  assert.equal(shortTag('unassigned_3'), '?3');
  assert.equal(shortTag('ignore2'), 'Ig2');
  assert.equal(shortTag('c2_penis', true), 'TP');
  const names = (who) => PARTS.flatMap((part) => (PAIRED.includes(part) ? ['l', 'r'] : [null]).map((side) => groupName({ who, part, side })));
  for (const who of WHOS) {
    const tags = names(who).map((n) => shortTag(n));
    assert.equal(new Set(tags).size, tags.length, `${who}: ${tags.join(' ')}`);
  }
  const all = WHOS.flatMap(names).map((n) => shortTag(n, true));
  assert.equal(new Set(all).size, all.length, 'with the who letter: unique across characters');
  assert.ok(all.every((t) => t.length <= 4), 'at most 4 characters');
});

test('the shared character: dropped from a label only when every assigned group is theirs', () => {
  assert.equal(sharedWho(['c1_shoulder_r', 'c1_tail', 'unassigned_2', 'ignore']), 'c1');
  assert.equal(sharedWho(['c1_shoulder_r', 'c2_penis']), null);
  assert.equal(sharedWho(['penis', 'c1_tail']), null, 'a group with no character');
  assert.equal(sharedWho([]), null);
  assert.equal(dropWho('Bottom R shoulder', 'c1'), 'R shoulder');
  assert.equal(dropWho('? 2', 'c1'), '? 2');
  assert.equal(dropWho('Bottom R shoulder', null), 'Bottom R shoulder');
});

test('the mode cycles smart -> all -> none -> smart', () => {
  assert.deepEqual(LABEL_MODES.map(nextLabelMode), ['all', 'none', 'smart']);
  assert.equal(nextLabelMode(undefined), 'smart');
});

test('chipTag: the character letter, a dash, the part tag (the toolbar chips)', async () => {
  const { chipTag } = await import('../src/features/tracking/group-labels.js');
  assert.equal(chipTag('c1_hand_l'), 'B-LH');
  assert.equal(chipTag('c2_thighs_l'), 'T-LT');
  assert.equal(chipTag('c1_penis'), 'B-P');
  assert.equal(chipTag('c1_tail2'), 'B-Ta2');
});
