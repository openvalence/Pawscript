import assert from 'node:assert/strict';
import test from 'node:test';
import { FP, alignPrints, likeness, IDENTITY, paintedSources, runsHere, trackedSources, bestPairs, coarseFrames, aroundFrames, shotFrames, landCopies, moveGroups, refitGroups, priorOf, namedIoU, sourceGroups } from '../src/features/tracking/copy-from.js';
import { maskSize, maskOf, newMask, stroke, encodeMask, fitPoly, acceptGroup, isCopy } from '../src/features/tracking/groups.js';
import { budget } from './perf.mjs';

// a synthetic picture (0..1 coords): a grey ramp, a bright disc and a dark one; `xf` moves it like a cut to a closer camera
const pic = (x, y) => 0.3 + 0.2 * x + (Math.hypot(x - 0.4, y - 0.5) < 0.12 ? 0.5 : 0) - (Math.hypot(x - 0.66, y - 0.38) < 0.08 ? 0.25 : 0);
function print(xf = IDENTITY, n = FP) {
  const a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0;
    for (let v = 0; v < 4; v++) for (let u = 0; u < 4; u++) { const x = (i + (u + 0.5) / 4) / n, y = (j + (v + 0.5) / 4) / n; s += pic((x - 0.5 - xf.dx) / xf.s + 0.5, (y - 0.5 - xf.dy) / xf.s + 0.5); }
    a[j * n + i] = s / 16;
  }
  return a;
}

test('alignPrints finds the move between two prints of one picture (zoom + pan), and likeness keeps a still picture still', () => {
  const xf = { s: 1.12, dx: 0.08, dy: -0.05 }, r = alignPrints(print(), print(xf));
  assert.ok(Math.abs(r.s - xf.s) < 0.04 && Math.abs(r.dx - xf.dx) < 0.02 && Math.abs(r.dy - xf.dy) < 0.02, JSON.stringify(r));
  assert.ok(r.d < 0.02, 'the residual is small: ' + r.d);
  const same = likeness(print(), print());
  assert.equal(same.d, 0); assert.equal(same.xf, IDENTITY);
  const moved = likeness(print(), print(xf));
  assert.ok(moved.d > 0.02 && moved.xf !== IDENTITY, 'a moved picture: unmoved distance ' + moved.d);
  const t0 = performance.now(); for (let k = 0; k < 20; k++) alignPrints(print(), print(xf)); const ms = (performance.now() - t0) / 20;
  budget(ms < 60, `one alignment is cheap: ${ms.toFixed(1)} ms (prints included)`);
});

const SIZE = maskSize(16 / 9);
const disc = (cx, cy, r) => { const m = newMask(SIZE); stroke(m, [cx * m.w, cy * m.h], [cx * m.w, cy * m.h], r * m.h); return m; };
const grp = (name, t, cx, cy, r = 0.08, extra = {}) => { const m = disc(cx, cy, r); return { name, poly: fitPoly(m).poly, pinned: true, t_ms: t, source: 'user', mask: encodeMask(m), who: name.split('_')[0], part: name.split('_')[1], ...extra }; };
const shots = () => [0, 1, 2, 3].map((k) => ({ start_ms: k * 1000, end_ms: (k + 1) * 1000 }));

test('painted sources: other takes only, one per frame, no suggestions / unassigned / all-copy frames', () => {
  const sc = shots();
  sc[0].groups = [grp('c1_hips', 200, 0.4, 0.5)];                                                  // the take on screen: never its own source
  sc[1].groups = [grp('c1_hips', 1300, 0.4, 0.5), grp('c1_head', 1300, 0.3, 0.2), { ...grp('c2_hips', 1300, 0.6, 0.5), source: 'seeder', score: 0.9 }];
  sc[2].groups = [{ ...grp('unassigned_1', 2100, 0.5, 0.5), name: 'unassigned_1' }];               // unassigned only: nothing to copy
  sc[3].groups = [{ ...grp('c1_hips', 3100, 0.4, 0.5), source: 'repeat', from: 1300 }];            // an untouched fill: its original is listed already
  const p = paintedSources(sc, 0);
  assert.deepEqual(p.map((c) => [c.kind, c.t, c.shot, c.groups.map((g) => g.name)]), [['painted', 1300, 1, ['c1_hips', 'c1_head']]]);
});

// a run over shots 1-2 that seeded the owner's c1_hips (pinned id 4); its frames at 1200 / 1240 / 2200
const pts = (cx, cy) => [[cx - 0.02, cy, 1, -1, 0, 4], [cx + 0.02, cy, 1, -1, 0, 4], [cx, cy + 0.03, 1, -1, 0, 4], [cx, cy - 0.03, 1, -1, 0, 4]];
const RUN = { id: 'r1', scenes: [{ start_ms: 1000, groups: { sem_c1_hips: { source: 'user', id: 4 } } }],
  frames: { t: [1200, 1240, 2200], v: [0, 0, 0], ov: [{ pts: pts(0.4, 0.5) }, { pts: pts(0.42, 0.5) }, { pts: pts(0.5, 0.5) }] } };

test('from tracking: a run covering the frame gives its points there; other frames of runs are sampled outside the take', () => {
  const h = runsHere([RUN], 1240, 40);
  assert.equal(h.length, 1); assert.equal(h[0].kind, 'here'); assert.equal(h[0].seeds.c1_hips.length, 4);
  assert.deepEqual(runsHere([RUN], 3500, 40), []);
  assert.deepEqual(runsHere([{ ...RUN, restored: true }], 1240, 40), []);   // a ghost-rebuilt run has no points
  const g = sourceGroups(h[0], SIZE);
  assert.equal(g[0].name, 'c1_hips'); assert.equal(g[0].source, 'run'); assert.equal(g[0].points.length, 4);
  const tr = trackedSources([RUN], 1000, 2000, 40);   // the take on screen is 1000..2000: only 2200 is outside
  assert.deepEqual(tr.map((c) => c.t), [2200]);
  assert.deepEqual(trackedSources([RUN], 3000, 4000, 40, { every: 500 }).map((c) => c.t), [1200, 2200]);   // one per 500 ms at most
});

test('two-way search (paw-55la): each source at the frame of the shot it matches best, one tile per take, ties to the playhead', () => {
  const P = (v) => new Float32Array(FP * FP).fill(v);
  const targets = new Map([[10, P(0.1)], [11, P(0.5)], [12, P(0.52)], [20, P(0.9)]]);
  const src = [
    { key: 'a', src: 's1', kind: 'painted', t: 100, print: P(0.5) },     // matches f 11 exactly (f 12 is 0.02 off: not a tie)
    { key: 'b', src: 's1', kind: 'tracked', t: 140, print: P(0.12) },    // same take, f 10 at 0.02: the take's tile is a's
    { key: 'c', src: 's2', kind: 'painted', t: 900, print: P(0.905) },   // f 20
    { key: 'd', src: 's3', kind: 'tracked', t: 1500 },                    // no print yet: left out
  ];
  const r = bestPairs(src, targets, 10);
  assert.deepEqual(r.map((c) => [c.key, c.k]), [['a', 11], ['c', 20]]);
  assert.equal(r[0].d, 0); assert.equal(r[1].d, 0.005);
  // a near-tie (within NEAR) goes to the frame nearest the playhead
  const tie = bestPairs([{ key: 'e', src: 's4', print: P(0.508) }], targets, 20);
  assert.equal(tie[0].k, 12, 'f 11 (0.008) and f 12 (0.012) tie: the one nearer the playhead (f 20) wins');
  assert.equal(bestPairs([{ key: 'e', src: 's4', print: P(0.508) }], targets, 20, { near: 0.001 })[0].k, 11);
  // the cache hook: what dist says is what ranks
  let calls = 0;
  bestPairs(src, targets, 10, { dist: () => { calls++; return 0.3; } });
  assert.equal(calls, 3 * 4);
});

test('coarse to fine: a stride over long shots, every frame of short ones, then every frame around the best pairs', () => {
  assert.deepEqual([...coarseFrames(5, 9)], [5, 6, 7, 8, 9]);
  assert.equal(coarseFrames(0, 299).length, 300, 'every frame of a 10 s shot at 30 fps');
  const c = coarseFrames(0, 449);   // a 10 s shot at 45 fps
  assert.equal(c.stride, 2); assert.equal(c[0], 0); assert.equal(c[c.length - 1], 449); assert.ok(c.length <= 301);
  assert.deepEqual(aroundFrames([20, 449], 2, 0, 449, new Set([20])), [18, 19, 21, 22, 447, 448, 449]);
  // the shot's frames: their middles inside it, 120 ms in from the cuts (a quarter of a short shot)
  assert.deepEqual(shotFrames(1000, 3000, 40), [28, 71]);
  assert.deepEqual(shotFrames(1000, 1200, 40), [26, 28]);
});

test('landing copies: they replace that frame\'s groups; a part the take has elsewhere becomes another seed of it (paw-o74b.1)', () => {
  const on = (t) => (g) => g.t_ms === t;
  const take = [grp('c1_hips', 200, 0.4, 0.5), grp('c1_head', 200, 0.3, 0.2), { ...grp('ignore', 200, 0.9, 0.9), name: 'ignore' }];
  const add = landCopies(take, [grp('c2_penis', 600, 0.5, 0.5), grp('c2_balls', 600, 0.5, 0.6)], on(600));
  assert.deepEqual(add.groups.map((g) => `${g.name}@${g.t_ms}`), ['c1_hips@200', 'c1_head@200', 'ignore@200', 'c2_penis@600', 'c2_balls@600']);
  const seed = landCopies(take, [grp('c1_hips', 600, 0.5, 0.5), grp('c2_balls', 600, 0.5, 0.6)], on(600));
  assert.deepEqual(seed.groups.map((g) => `${g.name}@${g.t_ms}`), ['c1_hips@200', 'c1_head@200', 'ignore@200', 'c1_hips@600', 'c2_balls@600'], 'hips seeded again at 600, nothing of 200 lost');
  const here = landCopies([...take, grp('c1_hips', 600, 0.5, 0.5)], [grp('c1_hips', 200, 0.5, 0.5)], on(200));   // onto a seed frame: that frame's groups replaced
  assert.deepEqual(here.groups.map((g) => `${g.name}@${g.t_ms}`), ['c1_hips@600', 'c1_hips@200']);
  for (const r of [add, seed, here]) {   // never one part twice on one frame
    const keys = r.groups.map((g) => `${g.name}@${g.t_ms}`);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test('a run inside a painted take carries the painted shapes along with its points', () => {
  const sc = shots();
  sc[1].groups = [grp('c1_hips', 1200, 0.4, 0.5)];
  const painted = paintedSources(sc, 3);
  const [c] = trackedSources([RUN], 3000, 4000, 40, { scenes: sc, painted, every: 1 }).filter((x) => x.t === 1240);
  assert.equal(c.src, 's1'); assert.ok(c.carry);
  const [g] = sourceGroups(c, SIZE);
  assert.equal(g.source, 'repeat'); assert.equal(g.from, 1200); assert.equal(g.t_ms, 1240);
  assert.ok(namedIoU([g], [grp('c1_hips', 1240, 0.42, 0.5)], SIZE) > 0.85, 'the painted disc moved 0.02 right with the points');
  assert.ok(!trackedSources([RUN], 3000, 4000, 40, { scenes: sc, painted, every: 1 }).some((x) => x.t === 2200 && x.carry), 'shot 2 has no painting: rebuilt from points');
});

test('lining up: masks move with the print move; a run here keeps its points; groups off the picture are counted, not kept', () => {
  const g = grp('c1_hips', 1300, 0.4, 0.5), mf = (x) => maskOf(x, SIZE);
  const xf = { s: 1.1, dx: 0.1, dy: 0.05 };
  const [m] = moveGroups([g], xf, 200, mf), want = grp('c1_hips', 200, (0.4 - 0.5) * 1.1 + 0.6, 0.55, 0.088);
  assert.ok(namedIoU([m], [want], SIZE) > 0.8, 'moved onto the place it should be: IoU ' + namedIoU([m], [want], SIZE).toFixed(2));
  assert.equal(m.t_ms, 200); assert.equal(m.source, 'repeat'); assert.equal(m.from, 1300); assert.equal(m.lined, 'moved'); assert.ok(isCopy(m));
  const r = { ...grp('c1_hips', 1240, 0.4, 0.5), source: 'run', points: [[0.4, 0.5]], from: 1240 };
  const [same] = moveGroups([r], IDENTITY, 1240, mf);
  assert.deepEqual(same.points, [[0.4, 0.5]]); assert.equal(same.lined, undefined);
  const out = moveGroups([grp('c1_tail', 1300, 0.05, 0.5, 0.03)], { s: 1, dx: -0.2, dy: 0 }, 200, mf);
  assert.equal(out.length, 0); assert.equal(out.lost, 1);
  assert.deepEqual(priorOf([m]).map((p) => [p.name, p.who, p.part, p.poly.length > 2]), [['c1_hips', 'c1', 'hips', true]]);
});

test('re-found: each copy moves onto its re-found centre, shape kept; not found or found too far = kept, dotted, never dropped', () => {
  const mf = (x) => maskOf(x, SIZE);
  const moved = [grp('c1_hips', 200, 0.4, 0.5, 0.08, { source: 'repeat', from: 1300, lined: 'moved' }), grp('c1_head', 200, 0.3, 0.2, 0.06, { source: 'repeat', from: 1300, lined: 'moved' }), grp('c2_hips', 200, 0.7, 0.5, 0.06, { source: 'repeat', from: 1300, lined: 'moved' })];
  const sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  const found = [{ name: 'c1_hips', prior: 'c1_hips', unconfirmed: true, poly: sq(0.45, 0.52, 0.05) }, { name: 'c1_head', prior: 'c1_head', unconfirmed: true, poly: sq(0.9, 0.9, 0.04) }, { name: 'c1_tail', poly: sq(0.1, 0.8, 0.04) }];
  const out = refitGroups(moved, found, SIZE, mf);
  assert.equal(out.length, 3);
  assert.equal(out[0].lined, 'refound'); assert.ok(!out[0].unconfirmed);
  assert.ok(namedIoU([out[0]], [grp('c1_hips', 200, 0.45, 0.52)], SIZE) > 0.8, 'moved onto the re-found centre, its painted disc kept');
  assert.ok(out[1].unconfirmed && out[1].lined === 'moved', 'the head was "found" across the picture: kept where the move put it, dotted');
  assert.ok(out[2].unconfirmed, 'c2_hips not re-found: kept, dotted');
  assert.equal(acceptGroup(out[1]).source, 'user'); assert.ok(!acceptGroup(out[1]).unconfirmed);   // Accept (or an edit) makes it the owner's
});
