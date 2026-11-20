import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenScore, initialsOf, itemScore, rank, highlights } from '../src/features/graph/editor/fuzzy.js';

const items = [
  { key: 'amp.remap', title: 'Remap depth', group: 'Amplitude', aliases: ['range', 'depth', 'stroke length'], params: ['Deep end', 'Out end'], help: 'Maps pos linearly onto Deep end..Out end per action.' },
  { key: 'edit.smooth', title: 'Smooth', group: 'Edit · density', aliases: ['savgol', 'blur'], params: ['Window', 'Method'], help: 'Smooths positions.' },
  { key: 'edit.removeMicroReversals', title: 'Remove micro-reversals', group: 'Edit · density', params: ['Min reversal'] },
  { key: 'sig.smooth', title: 'Smooth signal', group: 'Signal', params: ['Window'], help: 'Zero-phase low-pass filter.' },
  { key: 'spans.kindRange', title: 'Range by kind', group: 'Spans', help: 'Depth range per plan segment kind with crossfades.' },
];

test('tokenScore tiers: exact > prefix > word start > initials > substring > subsequence', () => {
  const s = (q, t) => tokenScore(q, t);
  assert.ok(s('smooth', 'smooth') > s('smo', 'smooth'));
  assert.ok(s('smo', 'smooth') > s('sig', 'Smooth signal'));
  assert.ok(s('sig', 'Smooth signal') > s('rmr', 'removeMicroReversals'));
  assert.ok(s('rmr', 'removeMicroReversals') > s('ooth', 'smooth'));
  assert.ok(s('ooth', 'smooth') > s('smth', 'smooth'));
  assert.ok(s('smth', 'smooth') > 0);
  assert.equal(s('xyz', 'smooth'), 0);
  assert.equal(s('x', 'xylophone wave') > 0, true);
});

test('initialsOf handles camelCase, dots and spaces', () => {
  assert.equal(initialsOf('removeMicroReversals'), 'rmr');
  assert.equal(initialsOf('edit.capSpeed'), 'ecs');
  assert.equal(initialsOf('Remap depth'), 'rd');
});

test('every token must match some field', () => {
  assert.ok(itemScore('smooth sig', items[3]) > 0);
  assert.equal(itemScore('smooth zzz', items[3]), 0);
  assert.ok(itemScore('deep', items[0]) > 0, 'param labels count');
  assert.ok(itemScore('crossfades', items[4]) > 0, 'help words count');
  assert.equal(itemScore('ross', items[4]), 0, 'help needs a word prefix');
});

test('rank orders by title first, then aliases, group, params, help', () => {
  const r = rank('smooth', items).map((i) => i.key);
  assert.deepEqual(r.slice(0, 2), ['edit.smooth', 'sig.smooth']);
  assert.equal(rank('depth', items)[0].key, 'amp.remap');
  assert.equal(rank('rmr', items)[0].key, 'edit.removeMicroReversals');
});

test('recent and favourites boost; empty query keeps order with boosts first', () => {
  assert.deepEqual(rank('', items, { favs: ['spans.kindRange'], recent: ['sig.smooth'] }).map((i) => i.key).slice(0, 2), ['spans.kindRange', 'sig.smooth']);
  assert.equal(rank('smo', items, { recent: ['sig.smooth'] })[0].key, 'sig.smooth');
  assert.equal(rank('smooth', items, { recent: ['sig.smooth'] })[0].key, 'edit.smooth', 'an exact title still wins');
  assert.equal(rank('', items).length, items.length);
  assert.equal(rank('', items, { limit: 2 }).length, 2);
});

test('highlights merges overlapping ranges', () => {
  assert.deepEqual(highlights('rem dep', 'Remap depth'), [[0, 3], [6, 9]]);
  assert.deepEqual(highlights('rema emap', 'Remap'), [[0, 5]]);
  assert.deepEqual(highlights('zz', 'Remap'), []);
});
