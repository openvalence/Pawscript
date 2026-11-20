import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptGhost } from '../src/features/tracking/accept.js';
import { isValid } from '../src/lib/core/script.js';

const S = [{ at: 0, pos: 10 }, { at: 1000, pos: 90 }, { at: 2000, pos: 10 }, { at: 3000, pos: 90 }, { at: 4000, pos: 10 }];
const G = [{ at: 990, pos: 80 }, { at: 1500, pos: 20 }, { at: 2500, pos: 70 }, { at: 3010, pos: 30 }];

test('replace: whole ghost clears its own first..last span', () => {
  const { script, ats } = acceptGhost(S, G, { mode: 'replace' });
  assert.ok(isValid(script));
  assert.deepEqual(ats, [990, 1500, 2500, 3010]);
  // 1000, 2000, 3000 were inside 990..3010: gone; 0 and 4000 stay
  assert.deepEqual(script.map((a) => a.at), [0, 990, 1500, 2500, 3010, 4000]);
  assert.equal(S.length, 5, 'input not mutated');
});

test('replace: range clips the ghost and clears exactly the range', () => {
  const { script, ats } = acceptGhost(S, G, { mode: 'replace', range: { t0: 1200, t1: 2800 } });
  assert.ok(isValid(script));
  assert.deepEqual(ats, [1500, 2500]);
  assert.deepEqual(script.map((a) => a.at), [0, 1000, 1500, 2500, 3000, 4000]);
});

test('merge: keeps existing actions, skips ghost actions within tol', () => {
  const { script, ats } = acceptGhost(S, G, { mode: 'merge', tol: 1000 / 30 / 2 });   // ~16.7 ms
  assert.ok(isValid(script));
  assert.deepEqual(ats, [1500, 2500]);                  // 990 / 3010 are 10 ms from 1000 / 3000
  assert.deepEqual(script.map((a) => a.at), [0, 1000, 1500, 2000, 2500, 3000, 4000]);
  assert.equal(script.find((a) => a.at === 1000).pos, 90, 'existing action wins');
  const wide = acceptGhost(S, G, { mode: 'merge', tol: 5 });
  assert.deepEqual(wide.ats, [990, 1500, 2500, 3010]);
});

test('merge with range', () => {
  const { script, ats } = acceptGhost(S, G, { mode: 'merge', range: { t0: 2000, t1: 4000 }, tol: 16 });
  assert.deepEqual(ats, [2500]);
  assert.ok(isValid(script));
});

test('empty ghost, or nothing inside the range: unchanged, same array', () => {
  for (const [g, o] of [[[], {}], [G, { range: { t0: 5000, t1: 6000 } }], [null, { mode: 'merge' }]]) {
    const r = acceptGhost(S, g, o);
    assert.equal(r.script, S);
    assert.deepEqual(r.ats, []);
  }
  const merged = acceptGhost(S, [{ at: 1000, pos: 50 }], { mode: 'merge' });   // exact duplicate at tol 0
  assert.equal(merged.script, S);
});

test('into an empty axis; sloppy ghost input is normalised', () => {
  const { script, ats } = acceptGhost([], [{ at: 10.4, pos: 120 }, { at: 5, pos: -3 }, { at: 5, pos: 40 }, { at: NaN, pos: 1 }], {});
  assert.ok(isValid(script));
  assert.deepEqual(script, [{ at: 5, pos: 40 }, { at: 10, pos: 100 }]);
  assert.deepEqual(ats, [5, 10]);
});

test('large: 100k actions merge stays valid', () => {
  const big = Array.from({ length: 100000 }, (_, i) => ({ at: i * 100, pos: i % 2 ? 90 : 10 }));
  const g = Array.from({ length: 50000 }, (_, i) => ({ at: i * 200 + 50, pos: 50 }));
  const { script, ats } = acceptGhost(big, g, { mode: 'merge', tol: 16 });
  assert.equal(ats.length, 50000);
  assert.ok(isValid(script));
});

test('clean: the accepted span joins clean (replace edges, merge span, fx joins / keep); null = as before', async () => {
  const { cleanMicro } = await import('../src/lib/core/script.js');
  const C = { gapMs: 60, posTol: 6 };
  // the base rises into the range edge at 337 400; the ghost starts 3 units back 30 ms later: the owner screenshot
  const base = [{ at: 336900, pos: 90 }, { at: 337150, pos: 2 }, { at: 337400, pos: 20 }, { at: 338400, pos: 5 }];
  const ghost = [{ at: 337430, pos: 17 }, { at: 337900, pos: 95 }];
  const range = { t0: 337401, t1: 338000 };
  const raw = acceptGhost(base, ghost, { range, mode: 'replace' });
  assert.ok(raw.ats.includes(337430) && raw.script.some((a) => a.at === 337430));
  const r = acceptGhost(base, ghost, { range, mode: 'replace', clean: C });
  assert.deepEqual(r.script.map((a) => a.at), [336900, 337150, 337400, 337900, 338400]);
  assert.deepEqual(r.ats, [337900], 'a removed point is not reported as accepted');
  assert.deepEqual(cleanMicro(r.script), r.script, 'the join is clean');
  const m = acceptGhost(base, ghost, { mode: 'merge', clean: C });
  assert.ok(!m.script.some((a) => a.at === 337430));
  // a kept range (a live effect's span) is never cleaned
  assert.ok(acceptGhost(base, ghost, { range, mode: 'replace', clean: { ...C, keep: [[337420, 337440]] } }).script.some((a) => a.at === 337430));
  // far from the edges the ghost's own wiggles stay (raw tracker output is not cleaned)
  const long = [{ at: 337420, pos: 0 }, { at: 339000, pos: 60 }, { at: 339030, pos: 57 }, { at: 340000, pos: 99 }];
  assert.ok(acceptGhost(base, long, { range: { t0: 337401, t1: 341000 }, clean: C }).script.some((a) => a.at === 339030));
});
