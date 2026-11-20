import assert from 'node:assert/strict';
import test from 'node:test';
import * as gen from '../src/lib/gen/loops.js';
import { isValid } from '../src/lib/core/script.js';
import { periodOf, cycleEnd, repAt, tileTarget, tiledEndAt, nudgeEdge, snapToFrames, buildTiles, withoutTiles, needsRetile, srcKey, loopLabel, regionAt, roomOf } from '../src/features/timeline/loops.js';

const fm2997 = 1001 / 30;   // 29.97 fps
const cycleScript = (t0, P) => [{ at: t0, pos: 10 }, { at: t0 + Math.round(P * 0.4), pos: 90 }, { at: t0 + Math.round(P * 0.8), pos: 30 }];

test('period: exact frames win over the integer region length', () => {
  const loop = { t0: 1001, t1: 1001 + 2402 };   // 72 frames at 29.97 = 2402.4 ms
  assert.equal(periodOf(loop, fm2997), 72 * fm2997);
  assert.equal(periodOf({ t0: 0, t1: 2410 }, fm2997), 2410);   // not frame-exact: as marked
  assert.equal(loopLabel(loop, fm2997), '72 f · 2402.4 ms');
  assert.equal(loopLabel({ t0: 0, t1: 2410 }, fm2997), '~72 f · 2410.0 ms');
});

test('tiling: exact repetitions, no drift over 150 reps, idempotent re-tile, one source untouched', () => {
  const loop = { id: 'a', t0: 1001, t1: 1001 + 2402 }, P = periodOf(loop, fm2997);
  const src = cycleScript(loop.t0, P), end = Math.round(loop.t0 + 150.5 * P);
  const r = buildTiles(src, loop, end, gen, { frameMs: fm2997 });
  assert.ok(!r.error && isValid(r.script));
  assert.equal(r.tiles.length, 150);   // reps 1..150 (150 partial)
  for (let k = 1; k <= 150; k++) {
    const start = Math.round(loop.t0 + k * P);
    const at = r.script.find((a) => a.at === start);
    assert.ok(at && at.pos === 10, `rep ${k} starts at ${start}`);
    assert.ok(r.script.some((a) => a.at === start + Math.round(P * 0.4) && a.pos === 90));
  }
  assert.equal(r.script.at(-1).at, end);
  assert.deepEqual(r.script.slice(0, 3), src);   // source cycle unchanged
  const L = { ...loop, tiledTo: r.end, srcKey: r.key };
  assert.equal(needsRetile(r.script, L, P), false);
  // re-tile on its own output changes nothing
  assert.deepEqual(buildTiles(r.script, L, end, gen, { frameMs: fm2997 }).script, r.script);
  // shrink: tiles past the new end go away
  const r2 = buildTiles(r.script, L, Math.round(loop.t0 + 3 * P), gen, { frameMs: fm2997 });
  assert.equal(r2.script.at(-1).at, Math.round(loop.t0 + 3 * P));
  assert.equal(withoutTiles(r.script, L, P).length, 3);
});

test('re-tile after editing the source cycle: stale, then tiles follow the edit', () => {
  const loop = { id: 'a', t0: 0, t1: 1000 }, P = 1000;
  const r = buildTiles(cycleScript(0, P), loop, 5000, gen, { frameMs: 1000 / 30 });
  const L = { ...loop, tiledTo: r.end, srcKey: r.key };
  const edited = r.script.map((a) => (a.at === 400 ? { at: 400, pos: 70 } : a));
  assert.equal(needsRetile(edited, L, P), true);
  const r2 = buildTiles(edited, L, L.tiledTo, gen, { frameMs: 1000 / 30 });
  for (let k = 1; k < 5; k++) assert.equal(r2.script.find((a) => a.at === k * 1000 + 400).pos, 70);
  assert.equal(needsRetile(r2.script, { ...L, srcKey: r2.key }, P), false);
  // a changed period is stale too
  assert.notEqual(srcKey(edited, { t0: 0, t1: 1001 }, 1001), L.srcKey);
});

test('seam warning, join meet, variation is seeded and leaves the source alone', () => {
  const loop = { id: 'a', t0: 0, t1: 1000 };
  const bad = [{ at: 0, pos: 0 }, { at: 500, pos: 50 }, { at: 980, pos: 100 }];
  const r = buildTiles(bad, loop, 4000, gen, { frameMs: 10 });
  assert.ok(r.warn && r.seam.spike);
  const m = buildTiles(bad, loop, 4000, gen, { frameMs: 10, join: 'meet' });
  assert.equal(m.warn, null);
  assert.equal(m.script.find((a) => a.at === 980).pos, 0);   // source closes too
  assert.equal(m.script.find((a) => a.at === 2980).pos, 0);
  const v1 = buildTiles(cycleScript(0, 1000), loop, 6000, gen, { frameMs: 10, vary: { seed: 3, amp: 0.2, timeMs: 30 } });
  const v2 = buildTiles(cycleScript(0, 1000), loop, 6000, gen, { frameMs: 10, vary: { seed: 3, amp: 0.2, timeMs: 30 } });
  assert.deepEqual(v1.script, v2.script);
  assert.deepEqual(v1.script.slice(0, 3), cycleScript(0, 1000));
  for (let k = 1; k < 6; k++) assert.ok(v1.script.some((a) => a.at === k * 1000), 'tile starts stay exact');
  assert.ok(buildTiles([{ at: 0, pos: 5 }], loop, 3000, gen, {}).error);
});

test('handles, targets, nudges, rep lookup', () => {
  const loop = { id: 'a', t0: 1000, t1: 3000 }, P = 2000;
  assert.equal(tiledEndAt(loop, 8100, { P }), 9000);
  assert.equal(tiledEndAt(loop, 7900, { P, snap: false }), 7900);
  assert.equal(tiledEndAt(loop, 2000, { P }), 3000);           // can't go inside the cycle: no tiles
  assert.equal(tiledEndAt(loop, 99999, { P, max: 10000 }), 9000);   // snaps down to a boundary that fits
  assert.equal(tiledEndAt(loop, 99999, { P, snap: false, max: 10000 }), 10000);
  // fractional periods: boundaries are anchored at t0
  const f = { t0: 0, t1: 2402 }, Pf = periodOf(f, fm2997);
  assert.equal(tiledEndAt(f, 100 * Pf + 300, { P: Pf }), Math.round(100 * Pf));
  assert.equal(cycleEnd(f, Pf), 2402);

  const loops = [loop, { id: 'b', t0: 20000, t1: 22000 }];
  const scenes = [{ start_ms: 0, end_ms: 15000 }, { start_ms: 15000, end_ms: 40000 }];
  assert.deepEqual(tileTarget(loop, { range: { t0: 0, t1: 12000 }, scenes, loops }), { end: 12000, why: 'range' });
  assert.deepEqual(tileTarget(loop, { range: { t0: 0, t1: 2000 }, scenes, loops }), { end: 15000, why: 'scene' });
  assert.deepEqual(tileTarget(loop, { range: { t0: 0, t1: 30000 }, scenes, loops }), { end: 20000, why: 'range' });   // capped at the next loop
  assert.equal(tileTarget(loop, { scenes: [], loops }), null);
  assert.deepEqual(roomOf(loops, loops[1], 60000), { lo: 3000, hi: 60000 });
  assert.deepEqual(roomOf([{ ...loop, tiledTo: 9000 }, loops[1]], loops[1], 60000), { lo: 9000, hi: 60000 });

  const fm = 1000 / 30, l = { t0: 1000, t1: 3400 };
  assert.deepEqual(nudgeEdge(l, 't1', 1, fm), { t0: 1000, t1: 3433 });
  assert.deepEqual(nudgeEdge(l, 't0', -1, fm), { t0: 967, t1: 3400 });
  assert.equal(nudgeEdge({ t0: 0, t1: 33 }, 't0', -1, fm, { lo: 0 }), null);
  assert.equal(nudgeEdge({ t0: 0, t1: 33 }, 't1', -1, fm), null);   // keeps one frame
  assert.deepEqual(snapToFrames({ t0: 1010, t1: 3390 }, fm), { t0: 1000, t1: 3400 });
  assert.deepEqual(regionAt(1010, 72 * fm, fm), { t0: 1000, t1: 3400 });

  assert.equal(repAt({ ...f, tiledTo: 30000 }, 0, Pf), 0);
  assert.equal(repAt({ ...f, tiledTo: 30000 }, Math.round(5 * Pf), Pf), 5);
  assert.equal(repAt({ ...f, tiledTo: 30000 }, Math.round(5 * Pf) - 1, Pf), 4);
  assert.equal(repAt({ ...f, tiledTo: 30000 }, 30000, Pf), -1);
});
