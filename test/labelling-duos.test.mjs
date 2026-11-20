// paw-9p1h: duos first in the labelling workspace: the count guess from tagger scores, the tiered order (only ahead of the cursor), the lazy rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countGuess, tierOf, arrangeAhead, pickAhead, mayTag, progressTip, parseTag, tagJson } from '../src/features/labelling/duos.js';

const im = (k) => ({ key: k, name: k });
const G = (count) => ({ count, conf: 0.9, tags: [] });

test('count guess: the count tags decide', () => {
  assert.equal(countGuess({ duo: 0.9, solo: 0.05, trio: 0.02 }).count, 'duo');
  assert.equal(countGuess({ solo: 0.8, duo: 0.1 }).count, 'solo');
  assert.equal(countGuess({ trio: 0.7, group: 0.2 }).count, 'trio');
  assert.equal(countGuess({ group: 0.6 }).count, 'group');
  assert.equal(countGuess({ duo: 0.9, 'male/male': 0.95 }).tags.includes('male/male'), true);
});
test('count guess: a pairing tips an undecided picture to duo, never against solo; nothing is unknown', () => {
  assert.equal(countGuess({ duo: 0.2, 'male/female': 0.9 }).count, 'duo');
  assert.equal(countGuess({ duo: 0.2, solo: 0.4, 'male/female': 0.9 }).count, 'solo');
  assert.equal(countGuess({ duo: 0.1, solo: 0.1 }).count, 'unknown');
  assert.equal(countGuess({}).count, 'unknown');
  assert.equal(countGuess(null).count, 'unknown');
});
test('tiers: duo, then trio / group, then solo, then unknown', () => {
  assert.deepEqual(['duo', 'group', 'trio', 'solo', 'unknown'].map((c) => tierOf(G(c))), [0, 1, 1, 2, 3]);
  assert.equal(tierOf(undefined), 3);
});

test('order: duos first, stable inside a tier, unknowns keep their order', () => {
  const base = 'abcdefgh'.split('').map(im);
  const g = new Map([['b', G('solo')], ['d', G('duo')], ['f', G('duo')], ['g', G('trio')], ['c', G('solo')]]);
  assert.deepEqual(arrangeAhead(base, base, 0, g).map((x) => x.key), ['d', 'f', 'g', 'b', 'c', 'a', 'e', 'h']);
});
test('order: only ahead of the cursor; what was passed and the picture on screen never move', () => {
  const base = 'abcdefgh'.split('').map(im);
  const g = new Map([['h', G('duo')], ['b', G('duo')]]);
  // the owner is on c (index 2): a, b, c stay, even though b is a duo
  const out = arrangeAhead(base, base, 3, g).map((x) => x.key);
  assert.deepEqual(out.slice(0, 3), ['a', 'b', 'c']);
  assert.equal(out[3], 'h');
  // re-sorting again later with the cursor further on keeps the earlier head exactly (previous still goes back)
  const cur = arrangeAhead(base, base, 3, g);
  const g2 = new Map([...g, ['e', G('duo')]]);
  const again = arrangeAhead(base, cur, 5, g2).map((x) => x.key);
  assert.deepEqual(again.slice(0, 5), cur.slice(0, 5).map((x) => x.key));
  assert.equal(new Set(again).size, 8);
});
test('order: off puts the tail back in the base order but keeps the head', () => {
  const base = 'abcdef'.split('').map(im);
  const g = new Map([['f', G('duo')]]);
  const on = arrangeAhead(base, base, 2, g);
  assert.deepEqual(on.map((x) => x.key), ['a', 'b', 'f', 'c', 'd', 'e']);
  assert.deepEqual(arrangeAhead(base, on, 2, g, false).map((x) => x.key), ['a', 'b', 'c', 'd', 'e', 'f']);
});
test('order: images that arrive later (a listing in progress) are placed by their tier ahead, the head stays', () => {
  const cur = ['a', 'b', 'c'].map(im);
  const base = ['a', 'b', 'c', 'n', 'm'].map(im);
  const out = arrangeAhead(base, cur, 3, new Map([['m', G('duo')]])).map((x) => x.key);
  assert.deepEqual(out, ['a', 'b', 'c', 'm', 'n']);
});

test('lazy queue: the next unlooked-at pictures after the cursor, not the ones guessed, busy or behind', () => {
  const imgs = 'abcdefg'.split('').map(im);
  const guesses = new Map([['d', G('solo')]]);
  assert.deepEqual(pickAhead(imgs, 2, guesses, new Set(['e']), 2).map((x) => x.key), ['f', 'g']);
  assert.deepEqual(pickAhead(imgs, 6, guesses, new Set(), 3), []);
  assert.deepEqual(pickAhead(imgs, -1, new Map(), new Set(), 2).map((x) => x.key), ['a', 'b']);
});
test('lazy queue: pauses while a job runs or the owner paints, off when disabled or closed, resumes after', () => {
  const ok = { on: true, enabled: true, ready: true, trackerBusy: false, painting: false };
  assert.equal(mayTag(ok), true);
  assert.equal(mayTag({ ...ok, trackerBusy: true }), false);   // a Track or Suggest
  assert.equal(mayTag({ ...ok, painting: true }), false);
  assert.equal(mayTag({ ...ok, enabled: false }), false);
  assert.equal(mayTag({ ...ok, on: false }), false);          // left the workspace: cancel
  assert.equal(mayTag({ ...ok, ready: false }), false);
  assert.equal(mayTag({ ...ok, painting: false }), true);
});

test('progress tip and the cache file round trip', () => {
  assert.equal(progressTip(412, 3547), '412 of 3,547 looked at');
  const g = { count: 'duo', conf: 0.81, tags: ['duo', 'male/male'] };
  assert.deepEqual(parseTag(tagJson('i123', g)), g);
  assert.equal(parseTag('not json'), null);
  assert.equal(parseTag('{}'), null);
});
