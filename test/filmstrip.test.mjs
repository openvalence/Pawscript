// paw-ef73.7: the Scenes tab's filmstrip layout (filmstrip.js, pure). paw-3fal: the frames either side of a cut, by index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmCells, shotFrames, stillQueue, COMPACT, LIFT, PAD, MIN_TILE, EDGE_GAP, FILL_GUT } from '../src/features/timeline/filmstrip.js';
import { frameAt, frameTime } from '../src/lib/lane.js';

const shots = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 1100 }, { start_ms: 1100, end_ms: 4000 }, { start_ms: 4000, end_ms: 9000 }];
const x = (t) => t / 10;   // 1 px = 10 ms
const fh = 100 - LIFT - 2 * PAD, fw = fh * 16 / 9;

test('wide: the whole first frame at the left, the whole last at the right', () => {
  const c = filmCells(shots, x, { w: 1000, h: 100, aspect: 16 / 9 });
  assert.deepEqual(c.map((k) => k.i), [0, 1, 2, 3], 'the shots on screen');
  const d = c[3];
  assert.deepEqual(d.frames.map((f) => f.side), ['first', 'last']);
  assert.ok(Math.abs(d.frames[0].x - (400 + PAD)) < 1e-9 && Math.abs(d.frames[1].x + d.frames[1].w - (900 - PAD)) < 1e-9, 'each against its cut');
  assert.ok(Math.abs(d.frames[1].w - fw) < 1e-9 && d.frames[1].crop === 1);
});

test('narrow: both ends kept, each half the cell, cropped; the pair at a cut is the same size', () => {
  const two = filmCells([{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 6000 }], x, { w: 1000, h: 100, aspect: 16 / 9 });
  assert.equal(two[0].frames.length, 2, 'a shot narrower than two pictures still shows both of its ends');
  assert.ok(two[0].frames.every((f) => f.crop < 1 && Math.abs(f.w - (200 - 3 * PAD) / 2) < 1e-9), 'halves, cropped');
  assert.equal(two[1].frames[0].w, two[0].frames[1].w, 'the wide shot\'s first frame matches the narrow one\'s last at their cut');
  const c = filmCells(shots, x, { w: 1000, h: 100, aspect: 16 / 9 });
  const [a, b, cc] = c;
  // the cut at 1000 ms: shot 0's last | shot 1's first (shot 1 is 10 px: under MIN_TILE a half, so it shows no tile)
  assert.equal(b.frames.length, 0, '10 px shot: halves under MIN_TILE, the cut line alone');
  assert.equal(a.frames.find((f) => f.side === 'last').w, a.frames[0].w, 'no pair to match there: shot 0 keeps its own half');
  // the cut at 4000 ms: shot 2's last (290 px shot, narrow) | shot 3's first (500 px, wide): the smaller wins
  const L = cc.frames.find((f) => f.side === 'last'), F = c[3].frames.find((f) => f.side === 'first');
  assert.ok(Math.abs(L.w - F.w) < 1e-9 && Math.abs(L.crop - F.crop) < 1e-9, `same size at the cut (${L.w} vs ${F.w})`);
  assert.ok(L.w >= MIN_TILE);
});

test('the frames: first = the frame the start falls in, last = the frame before the next shot\'s first, every residue at 45 fps', () => {
  const fm = 1000 / 45, at = (t) => frameAt(t, fm);
  for (let c = 1188; c <= 1197; c++) {   // n % 9 = 0..8 (1192 % 9 = 4: the owner's cut), stored as frame starts in integer ms
    const list = [{ start_ms: 0, end_ms: frameTime(c, fm) }, { start_ms: frameTime(c, fm), end_ms: frameTime(c + 300, fm) }];
    const cells = filmCells(list, (t) => (t - frameTime(c, fm)) / 20 + 500, { w: 1000, h: 100, frameAt: at, last: 4679 });
    const last = cells[0].frames.find((f) => f.side === 'last'), first = cells[1].frames.find((f) => f.side === 'first');
    assert.equal(last.n, c - 1, `cut ${c}: last of the shot before`);
    assert.equal(first.n, c, `cut ${c}: first of the shot after`);
  }
  // the video's ends: frame 0, and the last frame (the end_ms past it is clamped to `last`)
  const list = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 104500 }];
  const all = filmCells(list, (t) => t / 20, { w: 6000, h: 100, frameAt: at, last: 4679 });
  assert.equal(all[0].frames[0].n, 0);
  assert.equal(all[1].frames.at(-1).n, 4679);
  // the player clock clamps past the end (frameAt(duration) = the last frame): still the last frame, not the one before
  const clamped = (t) => Math.min(4679, at(t));
  assert.equal(filmCells([list[0], { start_ms: 1000, end_ms: 104008 }], (t) => t / 20, { w: 6000, h: 100, frameAt: clamped, last: 4679 })[1].frames.at(-1).n, 4679);
  assert.deepEqual(shotFrames([{ start_ms: 0, end_ms: 26489 }, { start_ms: 26489, end_ms: 104008 }], 0, clamped, 4679), [0, 1191], 'a shot ending at a cut: the frame before it');
});

test('a cutaway is a raised card; a short row is the compact labelled strip; off-screen shots and tiles are left out', () => {
  const c = filmCells(shots, x, { w: 500, h: 100, cut: (i) => i === 2 });
  assert.deepEqual([c[2].y0, c[2].y1, c[0].y0, c[0].y1], [0, 100 - LIFT, LIFT, 100]);
  const s = filmCells(shots, x, { w: 500, h: COMPACT - 1 });
  assert.ok(s.every((k) => !k.frames.length && k.y0 === 0));
  const off = filmCells(shots, (t) => t / 10 - 450, { w: 200, h: 100 });
  assert.deepEqual(off.map((k) => k.i), [3]);
  assert.deepEqual(off[0].frames.map((f) => f.side), ['first'], 'its last frame is past the right edge: not asked for');
});

// paw-rw84: fillers through a long shot, the edge tiles first
test('fillers: whole pictures between the edge tiles, FILL_GUT apart, centred, a wider gap each side, each the frame at its centre', () => {
  const list = [{ start_ms: 0, end_ms: 9000 }];   // 900 px at 1 px = 10 ms
  const c = filmCells(list, x, { w: 1000, h: 100, aspect: 16 / 9 })[0];
  const [F, L] = c.frames;
  assert.deepEqual([F.side, L.side, F.w, L.w], ['first', 'last', fw, fw], 'the edge tiles exactly as before');
  const a = F.x + F.w + EDGE_GAP, b = L.x - EDGE_GAP, k = Math.floor((b - a + FILL_GUT) / (fw + FILL_GUT));
  assert.equal(c.fills.length, k);
  assert.ok(k >= 3, `${k} fillers in a 900 px shot`);
  for (let j = 0; j < k; j++) {
    const f = c.fills[j];
    assert.equal(f.w, fw); assert.equal(f.crop, 1); assert.equal(f.side, 'fill');
    assert.ok(f.x >= a - 1e-9 && f.x + f.w <= b + 1e-9, 'inside the gaps');
    if (j) assert.ok(Math.abs(f.x - (c.fills[j - 1].x + fw) - FILL_GUT) < 1e-9, 'FILL_GUT between fillers');
    const cx = f.x + fw / 2;
    assert.equal(f.n, Math.floor(cx * 10 * 0.03 + 1e-6), 'the frame at its own centre time');
  }
  const [g0, g1] = c.gaps, fl = c.fills.at(-1);
  assert.ok(Math.abs(g0.x - (F.x + F.w)) < 1e-9 && Math.abs(g0.x + g0.w - c.fills[0].x) < 1e-9, 'the left gap: edge tile to the first filler');
  assert.ok(Math.abs(g1.x - (fl.x + fw)) < 1e-9 && Math.abs(g1.x + g1.w - L.x) < 1e-9, 'the right gap: the last filler to the edge tile');
  assert.ok(Math.abs(g0.w - g1.w) < 1e-9 && g0.w >= EDGE_GAP && g0.w > FILL_GUT, `the gaps are equal and wider than the gutters (${g0.w})`);
  // a pan moves them with the shot: the same frames
  const panned = filmCells(list, (t) => t / 10 - 37, { w: 1000, h: 100, aspect: 16 / 9 })[0];
  assert.deepEqual(panned.fills.map((f) => f.n), c.fills.map((f) => f.n));
});

test('fillers: none in a shot without room for one whole picture; never shrink an edge tile; only the ones on screen', () => {
  const room = 2 * (PAD + fw + EDGE_GAP) + fw;   // exactly one filler's room (ms = px * 10)
  assert.equal(filmCells([{ start_ms: 0, end_ms: room * 10 + 1 }], x, { w: 2000, h: 100 })[0].fills.length, 1);
  const tight = filmCells([{ start_ms: 0, end_ms: room * 10 - 20 }], x, { w: 2000, h: 100 })[0];
  assert.equal(tight.fills.length, 0); assert.equal(tight.gaps.length, 0);
  assert.ok(tight.frames.every((f) => f.w === fw), 'the edge tiles whole');
  const narrow = filmCells([{ start_ms: 0, end_ms: 2000 }], x, { w: 2000, h: 100 })[0];
  assert.ok(narrow.fills.length === 0 && narrow.frames.length === 2, 'halves: no fillers, today\'s rule');
  // zoomed in: a 10-minute shot, 1 px = 1 ms, the view inside it: a handful made, all on screen
  const long = [{ start_ms: 0, end_ms: 600000 }];
  const z = filmCells(long, (t) => t - 300000, { w: 1200, h: 100 })[0];
  assert.equal(z.frames.length, 0, 'both edges off screen');
  assert.ok(z.fills.length > 0 && z.fills.length <= Math.ceil(1200 / fw) + 1);
  assert.ok(z.fills.every((f) => f.x + f.w > 0 && f.x < 1200));
  assert.ok(z.fills.every((f) => f.n === Math.floor((f.x + fw / 2 + 300000) * 0.03 + 1e-6)), 'still the frame at each centre');
});

test('fillers: a non-CFR frame table (the clock\'s frameAt): the frame whose span holds the centre time, inside the shot', () => {
  const starts = [0, 30, 50, 100, 105, 160, 230, 300, 310, 400, 470, 500, 650, 700, 760, 900];   // ms, irregular
  for (let t = 1000; t <= 9000; t += 50 + (t % 7)) starts.push(t);
  const fa = (t) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= t) lo = m; else hi = m - 1; } return lo; };
  const list = [{ start_ms: 0, end_ms: 9000 }];
  const c = filmCells(list, x, { w: 1000, h: 100, frameAt: fa, last: starts.length - 1 })[0];
  assert.ok(c.fills.length >= 3);
  for (const f of c.fills) {
    const t = (f.x + fw / 2) * 10;
    assert.ok(starts[f.n] <= t && (starts[f.n + 1] ?? Infinity) > t, `frame ${f.n} holds ${t} ms`);
    assert.ok(f.n >= f.lo && f.n <= f.hi);
  }
});

test('the still queue: edge tiles before fillers; a pan drops the stale asks; fillers wait while the video plays', async () => {
  const order = [], waits = [];
  let release = null;
  const decode = (r) => { order.push(r.key); return new Promise((ok) => { release = () => ok({ k: r.key }); }); };
  let playing = false;
  const q = stillQueue({ decode, done: () => true, gapMs: () => (playing ? 120 : 0), sleep: async (ms) => { waits.push(ms); } });
  const step = async () => { await new Promise((r) => setImmediate(r)); release?.(); release = null; await new Promise((r) => setImmediate(r)); };
  q.want([{ key: 'f1', fill: true }, { key: 'e1' }, { key: 'f2', fill: true }, { key: 'e2' }, { key: 'e1' }]);
  await step(); await step(); await step(); await step(); await step();
  assert.deepEqual(order, ['e1', 'e2', 'f1', 'f2'], 'edges first, each key once');
  assert.deepEqual(waits, [], 'paused: no wait');
  // a pan while e3 decodes: e4 and f9 replace e5 / f5; e3 finishes
  order.length = 0;
  q.want([{ key: 'e3' }, { key: 'e5' }, { key: 'f5', fill: true }]);
  await new Promise((r) => setImmediate(r));
  q.want([{ key: 'f9', fill: true }, { key: 'e4' }]);
  await step(); await step(); await step(); await step();
  assert.deepEqual(order, ['e3', 'e4', 'f9']);
  // playing: a wait before each filler, none before an edge
  order.length = 0; playing = true;
  q.want([{ key: 'f10', fill: true }, { key: 'e10' }]);
  await step(); await step(); await step();
  assert.deepEqual(order, ['e10', 'f10']);
  assert.deepEqual(waits, [120]);
  assert.equal(q.waiting, 0);
});
