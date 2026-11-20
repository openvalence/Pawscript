import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, match, rank, segments, isWordStart } from '../src/features/palette/fuzzy.js';

const tier = (r) => (r.score >= 300 ? 'contiguous' : r.score >= 200 ? 'word' : 'scattered');

test('tiers: contiguous > word starts > scattered, case-insensitive', () => {
  assert.equal(tier(score('ZOOM', 'Zoom in')), 'contiguous');
  assert.deepEqual(score('pla', 'Play / pause').hits, [0, 1, 2]);
  assert.equal(tier(score('zi', 'Zoom in')), 'word');
  assert.deepEqual(score('zi', 'Zoom in').hits, [0, 5]);
  assert.equal(tier(score('plpa', 'Play / pause')), 'word');
  assert.deepEqual(score('plpa', 'Play / pause').hits, [0, 1, 7, 8]);
  assert.equal(tier(score('zmn', 'Zoom in')), 'scattered');
  assert.equal(score('xyz', 'Zoom in'), null);
  assert.equal(score('zoom in please', 'Zoom in'), null);
  assert.ok(score('pla', 'Play / pause').score > score('pl', 'aPpLy').score);   // word start beats a mid-word hit
});

test('contiguous: word start, earlier and shorter text score higher', () => {
  assert.ok(score('pla', 'Play / pause').score > score('pla', 'Paste points at playhead').score);
  assert.ok(score('in', 'Range in at playhead').score > score('in', 'Pointing').score);
  assert.ok(score('undo', 'Undo').score > score('undo', 'Undo all').score);
});

test('word starts: camelCase ids count as words', () => {
  assert.ok(isWordStart('player.stepBack', 11));
  assert.ok(isWordStart('player.stepBack', 7));
  assert.ok(!isWordStart('player.stepBack', 8));
  assert.equal(tier(score('sb', 'player.stepBack')), 'word');
});

test('word-start backtracking finds a later word when the first choice dead-ends', () => {
  // 'nxt': the first 'n' (Nudge) leaves no 'x' to continue or start a word, so it must use "Nx Tab"
  assert.deepEqual(score('nxt', 'Nudge, Nx Tab').hits, [7, 8, 10]);
  assert.ok(score('nxt', 'Nudge, Nx Tab').score >= 200);
});

test('match: every query word must hit some field; hits are reported per field', () => {
  const r = match('edit und', ['Undo', 'Edit', 'edit.undo']);
  assert.ok(r);
  assert.deepEqual(r.hits[0], [0, 1, 2]);
  assert.deepEqual(r.hits[1], [0, 1, 2, 3]);
  assert.equal(match('edit xyz', ['Undo', 'Edit', 'edit.undo']), null);
  assert.deepEqual(match('  ', ['a']).hits, [[]]);
});

test('rank: best first, ties by recency, then input order', () => {
  const items = [{ id: 'a', t: 'Abc one' }, { id: 'b', t: 'Abc two' }, { id: 'c', t: 'Zoom' }, { id: 'd', t: 'xaxbxc' }];
  const f = { fields: (x) => [x.t] };
  assert.deepEqual(rank(items, 'abc', f).map((r) => r.item.id), ['a', 'b', 'd']);
  assert.deepEqual(rank(items, 'abc', { ...f, recent: ['b'] }).map((r) => r.item.id), ['b', 'a', 'd']);
  assert.deepEqual(rank(items, '', { ...f, recent: ['c'] }).map((r) => r.item.id), ['c', 'a', 'b', 'd']);
});

test('rank: a contiguous match outranks a recent scattered one', () => {
  const items = [{ id: 'undo', t: 'Undo' }, { id: 'x', t: 'Un-do-able' }, { id: 'y', t: 'unused node' }];
  const out = rank(items, 'undo', { fields: (x) => [x.t], recent: ['y', 'x'] }).map((r) => r.item.id);
  assert.equal(out[0], 'undo');
});

test('segments split text into highlighted runs', () => {
  assert.deepEqual(segments('Play', [0, 1]), [{ t: 'Pl', on: true }, { t: 'ay', on: false }]);
  assert.deepEqual(segments('ab', []), [{ t: 'ab', on: false }]);
  assert.deepEqual(segments('', [0]), []);
});
