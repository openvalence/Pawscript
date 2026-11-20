// paw-o60v.6: the shot-list memos keyed on the cut structure (shots.js cutsOf), and the repeats' occurrences found by binary
// search (repeat-scenes.js shotPictures): the same results as the linear scan it replaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutsOf } from '../src/features/timeline/shots.js';
import { indexRepeats } from '../src/features/timeline/repeats.js';
import { shotPictures } from '../src/features/timeline/repeat-scenes.js';

const S = (a, b, x = {}) => ({ start_ms: a, end_ms: b, ...x });

test('cutsOf keeps its identity across edits that leave the cuts alone, and changes with any cut field', () => {
  const l = [S(0, 1000), S(1000, 2000, { join: true, split: 'camera', groups: [{ name: 'c1_hips' }] }), S(2000, 3000)];
  const c = cutsOf(l);
  assert.equal(cutsOf(l), c, 'the same list');
  assert.equal(cutsOf(l.map((s, i) => (i === 1 ? { ...s, groups: [{ name: 'c2_hips' }], tags: ['oral'] } : s))), c, 'groups / tags edited: the same cuts');
  assert.equal(cutsOf(l.map((s) => ({ ...s }))), c, 'every shot a new object: the same cuts');
  for (const [k, v] of [['start_ms', 1001], ['end_ms', 1999], ['join', false], ['split', undefined]]) {
    assert.notEqual(cutsOf(l.map((s, i) => (i === 1 ? { ...s, [k]: v } : s))), c, `${k} changed`);
  }
  assert.notEqual(cutsOf(l.slice(0, 2)), c, 'a shot fewer');
  assert.notEqual(cutsOf(l.map((s, i) => (i === 2 ? { ...s, join: false } : s))), c, 'join absent vs false');
});

// a random picture sequence -> repeats index (one letter a picture, runs held), and random shots over it
function rnd(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
function repeatsOf(r, n = 600, FM = 100) {
  const occ = new Map();
  let prev = '';
  for (let f = 0; f < n; f++) {
    const c = r() < 0.15 ? prev : String.fromCharCode(65 + Math.floor(r() * 20));
    const list = occ.get(c) || [];
    if (c === prev && list.length) list.at(-1).f1 = f; else list.push({ f0: f, f1: f, t_ms: f * FM });
    occ.set(c, list); prev = c;
  }
  return indexRepeats({ frames: n, exact: 1, buckets: [...occ.values()].filter((l) => l.length > 1) });
}
const linearPictures = (ix, list, fm, edge = 0) => list.map((s) => {
  const a = s.start_ms + edge * fm - fm / 2, b = s.end_ms - edge * fm - fm / 2, ids = new Set();
  for (const x of ix.occ) { if (x.t >= b) break; if (x.t >= a) ids.add(x.id); }
  return ids;
});

test('shotPictures by binary search = the scan from the start, on random pictures and shots', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = rnd(seed), ix = repeatsOf(r), cuts = [0];
    while (cuts.at(-1) < 60000) cuts.push(cuts.at(-1) + 100 * (1 + Math.floor(r() * 80)));
    const list = cuts.slice(1).map((t, i) => S(cuts[i], t));
    for (const edge of [0, 2]) assert.deepEqual(shotPictures(ix, list, 100, edge).map((x) => [...x]), linearPictures(ix, list, 100, edge).map((x) => [...x]), `seed ${seed} edge ${edge}`);
  }
});

test('groupsAside: the same token while only the painted groups changed, a new one on any other field', async () => {
  const { groupsAside } = await import('../src/features/timeline/shots.js');
  const tags = ['oral'], l = [S(0, 1000, { tags, groups: [{ name: 'a' }] }), S(1000, 2000, { tags })];
  const t = groupsAside(l);
  assert.equal(groupsAside(l), t);
  const g = l.map((s, i) => (i === 0 ? { ...s, groups: [{ name: 'b' }] } : s));
  assert.equal(groupsAside(g), t, 'a group renamed');
  assert.equal(groupsAside(g.map((s, i) => (i === 1 ? { ...s, groups: [] } : s))), t, 'groups added to a shot');
  assert.notEqual(groupsAside(g.map((s, i) => (i === 1 ? { ...s, tags: ['side'] } : s))), t, 'a tag changed');
});
