// The Groups tool's pure side (src/features/tracking/groups.js): brush, live polygon fit, mask storage, the request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSize, newMask, dab, stroke, rasterPoly, fitPoly, encodeMask, decodeMask, maskOf, freeName, isPinned, setGroups, trackGroups, seedFrameOf, POLY_MAX, THRESHOLD } from '../src/features/tracking/groups.js';
import { trackRequest, suggestGroupsRequest } from '../src/lib/protocol.js';
import { groupOfChannel, pickerChannels, labelOf, whoLabel, chipVariants, camChannel, primaryHow } from '../src/lib/runs-channel.js';
import { groupName, splitName, partLabel, swapWho, PARTS, SOFT, splitMask, transformMask, groupsAt, maskAt, isUnassigned, freeUnassigned, assignGroup, swapAssign, unassignedIn } from '../src/features/tracking/groups.js';
import { groupColor, semColor } from '../src/features/tracking/colors.js';
import { semNames, semOf, frameBodies, primaryTarget, anchoredPath, CENTRE_KEYS } from '../src/features/tracking/blobs.js';

const size = maskSize(16 / 9);
const area = (m) => m.a.reduce((s, v) => s + (v >= THRESHOLD), 0);
const polyArea = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;

test('a soft dab: full in the middle, soft edge, nothing outside; erase takes it back', () => {
  const m = newMask(size);
  for (let k = 0; k < 6; k++) dab(m, 100, 90, 20);
  const at = (x, y) => m.a[y * m.w + x];
  assert.ok(at(100, 90) > 0.95 && at(100 + 15, 90) > 0 && at(100 + 15, 90) < at(100 + 5, 90) && at(100 + 25, 90) === 0);
  for (let k = 0; k < 12; k++) dab(m, 100, 90, 20, { erase: true });
  assert.ok(at(100, 90) < 0.05);
});

test('the fitted polygon follows a painted disc (area, vertex cap) and a stroke', () => {
  const m = newMask(size);
  for (let k = 0; k < 8; k++) dab(m, 160, 90, 40);
  const { poly, blobs } = fitPoly(m);
  assert.equal(blobs, 1);
  assert.ok(poly.length >= 8 && poly.length <= POLY_MAX);
  const a = polyArea(poly) * m.w * m.h;
  assert.ok(Math.abs(a - area(m)) / area(m) < 0.1, `${a} vs ${area(m)}`);
  const s = newMask(size);
  for (let k = 0; k < 4; k++) stroke(s, [40, 40], [280, 140], 12);
  const f = fitPoly(s), xs = f.poly.map((q) => q[0]);
  assert.ok(Math.min(...xs) < 50 / 320 && Math.max(...xs) > 270 / 320 && f.poly.length <= POLY_MAX);
});

test('two patches: the largest is the polygon, the count is reported; a ring keeps its outer edge; empty -> null', () => {
  const m = rasterPoly([[0.05, 0.1], [0.2, 0.1], [0.2, 0.3], [0.05, 0.3]], size);
  const big = rasterPoly([[0.5, 0.2], [0.9, 0.2], [0.9, 0.8], [0.5, 0.8]], size);
  for (let i = 0; i < m.a.length; i++) m.a[i] = Math.max(m.a[i], big.a[i]);
  const f = fitPoly(m);
  assert.equal(f.blobs, 2);
  assert.ok(f.poly.every(([x, y]) => x >= 0.49 && x <= 0.91 && y >= 0.19 && y <= 0.81));
  assert.ok(Math.abs(polyArea(f.poly) - 0.24) < 0.02);
  const ring = rasterPoly([[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], size), hole = rasterPoly([[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]], size);
  for (let i = 0; i < ring.a.length; i++) if (hole.a[i]) ring.a[i] = 0;
  assert.ok(Math.abs(polyArea(fitPoly(ring).poly) - 0.36) < 0.03);
  const L = rasterPoly([[0.1, 0.1], [0.3, 0.1], [0.3, 0.7], [0.7, 0.7], [0.7, 0.9], [0.1, 0.9]], size);
  assert.ok(Math.abs(polyArea(fitPoly(L).poly) - (0.2 * 0.8 + 0.4 * 0.2)) < 0.02);
  assert.deepEqual(fitPoly(newMask(size)), { poly: null, blobs: 0, islands: [] });
});

test('mask storage: RLE round trip at 16 levels, small for a brushed mask; maskOf falls back to the polygon', () => {
  const m = newMask(size);
  stroke(m, [50, 50], [250, 120], 18);
  const e = encodeMask(m), d = decodeMask(JSON.parse(JSON.stringify(e)));
  assert.equal(d.a.length, m.a.length);
  assert.ok(d.a.every((v, i) => Math.abs(v - m.a[i]) <= 1 / 30 + 1e-6));
  assert.ok(e.rle.length < m.a.length / 4, `${e.rle.length}`);
  const g = { poly: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]] };
  assert.ok(area(maskOf(g, size)) > 0 && maskOf({ ...g, mask: e }, size).a[0] === d.a[0]);
});

test('names, scene storage, and the track request (on, painted inside its scene and the range)', () => {
  assert.equal(freeName([{ name: 'tail' }, { name: 'tail2' }], 'tail'), 'tail3');
  assert.ok(isPinned('tail') && !isPinned('body') && !isPinned('body2'));
  const sq = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]];
  const scenes = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 3000 }];
  let list = setGroups(scenes, 1, [{ name: 'hips', poly: sq, pinned: true, t_ms: 1500.4, mask: { w: 1, h: 1, rle: [0, 1] } },
    { name: 'tail', poly: sq, pinned: true, t_ms: 1500, off: true }, { name: 'body', poly: sq, pinned: false, t_ms: 1500 },
    { name: 'paws', poly: sq, pinned: true, t_ms: 500 }]);
  assert.equal(list[0], scenes[0]);
  assert.deepEqual(trackGroups(list, 0, 3000), [{ name: 'hips', poly: sq, pinned: true, t_ms: 1500 }, { name: 'body', poly: sq, pinned: false, t_ms: 1500 }]);
  assert.deepEqual(trackGroups(list, 0, 1000), []);
  assert.equal(seedFrameOf(list[1]), 1500.4);
  assert.equal(seedFrameOf(scenes[1], { t_ms: 2000 }), 2000);
  assert.equal(seedFrameOf(scenes[1], { t_ms: 200 }), 1000);
  list = setGroups(list, 1, []);
  assert.ok(!('groups' in list[1]));
  const r = trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 1, roi: null, params: {}, groups: trackGroups(setGroups(scenes, 0, [{ name: 'tail', poly: sq, t_ms: 10 }]), 0, 1000) });
  assert.deepEqual(r.groups, [{ name: 'tail', poly: sq, pinned: true, t_ms: 10 }]);
  assert.ok(!('groups' in trackRequest({ video: 'v', tracker: 'x', start_ms: 0, end_ms: 1, roi: null, params: {}, groups: [] })));
  assert.deepEqual(suggestGroupsRequest({ video: 'v', t_ms: 12.6, params: { sem_shape: 'sam' } }), { cmd: 'suggest_groups', video: 'v', t_ms: 13, params: { sem_shape: 'sam' } });
  assert.deepEqual(suggestGroupsRequest({ video: 'v', start_ms: 0, end_ms: 99.5, roi: { kind: 'points' } }), { cmd: 'suggest_groups', video: 'v', start_ms: 0, end_ms: 100, params: {} });
});

test('any user group name flows through the channel helpers', () => {
  assert.deepEqual(groupOfChannel('sem_tail2_proj'), { key: 'sem_tail2', body: 0, part: 0, sem: 'tail2', kind: 'proj' });
  const run = { channels: { sem_tail_proj: {}, sem_tail_rel: {}, sem_hips_proj: {}, g1_proj: {} } };
  assert.deepEqual(pickerChannels(run), ['primary', 'g1_proj', 'sem_hips_proj', 'sem_tail_proj']);
  assert.equal(labelOf({ sem_tail: { label: 'tail', source: 'user' } }, 'sem_tail_proj'), 'tail (drawn)');
});

// ---- two characters (paw-emy, PROTOCOL v4.12) ----
test('characters: names, labels, swap, the track request', () => {
  assert.equal(groupName({ who: 'c1', part: 'penis' }), 'c1_penis');
  assert.equal(groupName({ who: 'c2', part: 'hand', side: 'l' }), 'c2_hand_l');
  assert.equal(groupName({ who: 'c2', part: 'tail', side: 'l' }), 'c2_tail', 'side only on paired parts');
  assert.deepEqual(splitName('c2_hand_l2'), { who: 'c2', part: 'hand', side: 'l' });
  assert.deepEqual(splitName('c1_sheath'), { who: 'c1', part: 'sheath', side: null });
  assert.deepEqual(splitName('tail2'), { who: null, part: 'tail', side: null });
  assert.deepEqual([partLabel('c1_penis'), partLabel('c2_paws_r'), partLabel('c1_tail2'), partLabel('hips')], ['Bottom penis', 'Top R paws', 'Bottom tail 2', 'hips']);
  assert.ok(PARTS.includes('sheath') && PARTS.includes('slit'));
  assert.ok(!isPinned('c1_body') && isPinned('c1_balls'));
  const sq = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]];
  const gs = [{ name: 'c1_penis', who: 'c1', part: 'penis', poly: sq, t_ms: 5 }, { name: 'c2_hand_r', who: 'c2', part: 'hand', side: 'r', poly: sq, t_ms: 5 }, { name: 'hips', poly: sq, t_ms: 5 }];
  assert.deepEqual(swapWho(gs).map((g) => [g.name, g.who]), [['c2_penis', 'c2'], ['c1_hand_r', 'c1'], ['hips', undefined]]);
  assert.deepEqual(trackGroups(setGroups([{ start_ms: 0, end_ms: 10 }], 0, gs), 0, 10), [
    { name: 'c1_penis', poly: sq, pinned: true, t_ms: 5, who: 'c1', part: 'penis' },
    { name: 'c2_hand_r', poly: sq, pinned: true, t_ms: 5, who: 'c2', part: 'hand', side: 'r' },
    { name: 'hips', poly: sq, pinned: true, t_ms: 5 }]);
});

test('characters: colour families (Bottom and Top apart, parts within a family apart)', () => {
  // paw-cnfg: the colours are generated (colors.js partHex, test/part-colors.test.mjs), no longer series tokens: Bottom blue, Top orange
  const hueOf = (c) => { const n = parseInt(c.slice(1), 16), [r, g, b] = [16, 8, 0].map((s) => (n >> s) & 255); return r > b && g > b ? 'warm' : b > r ? 'cool' : 'other'; };
  assert.equal(hueOf(groupColor('c1_penis')), 'cool'); assert.equal(hueOf(groupColor('c2_penis')), 'warm');
  assert.equal(hueOf(groupColor('c1_hips')), 'cool'); assert.equal(hueOf(groupColor('c2_hips')), 'warm');
  const c1 = PARTS.map((p) => groupColor('c1_' + p)), c2 = PARTS.map((p) => groupColor('c2_' + p));
  assert.equal(new Set(c1).size, PARTS.length, 'every Bottom part its own shade');
  assert.ok(c1.every((c) => !c2.includes(c)), 'no colour shared between the characters');
  assert.equal(semColor('c2_balls'), groupColor('c2_balls'));
  assert.equal(groupColor('tail'), 'var(--series-green)', 'plain v4.11 names keep their colours');
});

test('characters: channels in the picker, labels, variants', () => {
  assert.deepEqual(groupOfChannel('sem_c2_hand_l_proj'), { key: 'sem_c2_hand_l', body: 0, part: 0, sem: 'c2_hand_l', kind: 'proj' });
  assert.deepEqual(groupOfChannel('sem_c1_balls_area'), { key: 'sem_c1_balls', body: 0, part: 0, sem: 'c1_balls', kind: 'area' });
  const ch = Object.fromEntries(['g1_proj', 'sem_hips_proj', 'sem_c2_hips_proj', 'sem_c1_penis_proj', 'sem_c1_balls_scale', 'sem_c1_balls_proj', 'pair_proj',
    'who_c1_proj', 'who_c2_proj', 'who_pair_proj', 'who_pair_dist', 'who_p1h2_proj', 'who_c1_x'].map((k) => [k, { t: [0], v: [0] }]));
  const run = { channels: ch };
  assert.deepEqual(pickerChannels(run), ['primary', 'g1_proj', 'sem_hips_proj', 'sem_c1_balls_scale', 'sem_c1_penis_proj', 'sem_c2_hips_proj', 'pair_proj', 'who_c1_proj', 'who_c2_proj', 'who_pair_proj', 'who_p1h2_proj']);
  assert.deepEqual(chipVariants(run, 'sem_c1_balls_scale'), ['sem_c1_balls_scale', 'sem_c1_balls_proj'], 'a character\'s balls default to _scale like the seeded ones');
  assert.deepEqual([whoLabel('who_c1_proj'), whoLabel('who_pair_proj'), whoLabel('who_p1h2_proj'), whoLabel('who_p2h1_dist'), whoLabel('pair_proj')], ['Bottom center', 'Bottom ↔ Top', 'Bottom penis ↔ Top hips', 'Top penis ↔ Bottom hips dist', '']);
  assert.equal(labelOf({ sem_c2_hand_l: { label: 'c2_hand_l', source: 'user' } }, 'sem_c2_hand_l_proj'), 'Top L hand (drawn)');
  assert.ok(camChannel('sem_c1_penis_rel') && camChannel('who_c2_proj') && !camChannel('who_pair_dist'));
  assert.match(primaryHow('who_p1h2_proj'), /Bottom penis ↔ Top hips/);
  assert.match(primaryHow('sem_c2_hips_proj'), /Top hips/);
});

test('characters: the Parts layer names pinned groups of any id from the run (paw-dux)', () => {
  const run = { channels: {}, scenes: [{ start_ms: 0, end_ms: 1000, groups: { sem_c1_penis: { label: 'c1_penis', source: 'user', id: 4 }, sem_c2_hips: { label: 'c2_hips', source: 'user', id: 5 } } }] };
  assert.deepEqual(semNames(run).slice(0, 5), ['penis', 'balls', 'hips', 'c1_penis', 'c2_hips']);
  assert.equal(semOf([0, 0, 1, -1, 0, 5]), 5);
  const pts = [[0.2, 0.2, 1, -1, 0, 4], [0.3, 0.2, 1, -1, 0, 4], [0.25, 0.3, 1, -1, 0, 4], [0.7, 0.6, 1, -1, 0, 5], [0.8, 0.6, 1, -1, 0, 5], [0.75, 0.7, 1, -1, 0, 5]];
  const fr = { t: [0], ov: [{ pts }] };
  const F = frameBodies(fr, 0, { run });
  assert.equal(F.S[3].name, 'c1_penis'); assert.equal(F.S[4].name, 'c2_hips'); assert.equal(F.S[3].n, 3);
  assert.ok(Math.abs(F.S[4].c[0] - 0.75) < 1e-9, 'its anchored centre (pts, no channel)');
  assert.deepEqual(primaryTarget('sem_c2_hips_proj', run), { kind: 'sem', s: 5 });
  assert.deepEqual(primaryTarget('sem_c2_hips_proj'), { kind: 'cloud' }, 'unknown without the run');
  // with the run's channel the centre is the sidecar's (camera-removed + cam)
  const r2 = { ...run, channels: { sem_c2_hips_x: { t: [0], v: [0.5] }, sem_c2_hips_y: { t: [0], v: [0.4] }, cam_x: { t: [0], v: [0.1] }, cam_y: { t: [0], v: [0] } } };
  const P = anchoredPath(fr, r2, CENTRE_KEYS.indexOf('sem#5'));
  assert.ok(Math.abs(P.x[0] - 0.6) < 1e-9 && Math.abs(P.y[0] - 0.4) < 1e-9);
});

// ---- the brush and the outline (paw-1mo) ----
const halfH = (p) => { const ys = p.map((q) => q[1]); return (Math.max(...ys) - Math.min(...ys)) / 2; };
test('brush: the painted edge lands on the ring (a click: a disc of radius r; a stroke: r either side), however often', () => {
  const r = 12, m = newMask(size);
  dab(m, 160, 90, r);
  const f = fitPoly(m);
  assert.ok(f.poly, 'a single click paints a group (it used to stay under the threshold)');
  assert.ok(Math.abs(halfH(f.poly) * m.h - r) < 0.6, `click radius ${halfH(f.poly) * m.h} px vs ${r}`);
  const s = newMask(size);
  stroke(s, [60, 90], [260, 90], r);
  assert.ok(Math.abs(halfH(fitPoly(s).poly) * s.h - r) < 0.6, 'a stroke paints r either side of its path');
  const once = s.a.slice();
  for (let k = 0; k < 5; k++) stroke(s, [60, 90], [260, 90], r);
  assert.deepEqual(s.a, once, 'painting the same path again changes nothing (max, never adds up)');
  // soft edge: full inside r (1 - SOFT), none past r (1 + SOFT), 0.5 at r
  const at = (x, y) => m.a[y * m.w + x];
  assert.equal(at(160, 90), 1);
  assert.ok(at(160 + Math.floor(r * (1 + SOFT)) + 1, 90) === 0 && at(160 + r - 1, 90) > 0.5 && at(160 + r, 90) < 0.5);
  // a fast stroke between two far samples is continuous (one capsule, no gaps)
  const fast = newMask(size);
  stroke(fast, [10, 10], [300, 170], 3);
  assert.equal(fitPoly(fast).blobs, 1);
  // erase: the same footprint taken away
  stroke(s, [60, 90], [160, 90], r, { erase: true });
  assert.ok(maskAt(s, (160 + r - 1) / s.w, 90.5 / s.h) < 0.5 && maskAt(s, (160 + r + 1) / s.w, 90.5 / s.h) > 0.5, 'erased exactly up to the ring');
});

test('outline: sub-pixel edge (no staircase), islands reported, split into patches, move / scale, pick by point', () => {
  const m = newMask(size);
  dab(m, 100, 90, 30.3);
  const f = fitPoly(m);
  assert.ok(f.poly.every(([x, y]) => Math.abs(Math.hypot(x * m.w - 100, y * m.h - 90) - 30.3) < 0.35), 'every vertex on the 0.5 edge, to a third of a mask pixel');
  dab(m, 250, 40, 10);
  const g = fitPoly(m);
  assert.equal(g.blobs, 2); assert.equal(g.islands.length, 1);
  assert.ok(g.islands[0].every(([x]) => x * m.w > 235), 'the island is the small patch');
  const parts = splitMask(m);
  assert.equal(parts.length, 2);
  assert.ok(fitPoly(parts[0]).poly.every(([x]) => x * m.w < 140) && fitPoly(parts[1]).poly.every(([x]) => x * m.w > 235), 'largest first, each with its own soft edge');
  const sum = (mm) => mm.a.reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(sum(parts[0]) + sum(parts[1]) - sum(m)) < 1e-3, 'nothing lost, nothing doubled');
  const moved = transformMask(parts[1], { dx: -100 });
  assert.ok(fitPoly(moved).poly.every(([x]) => x * m.w > 135 && x * m.w < 165));
  const big = transformMask(parts[0], { s: 2, cx: 100, cy: 90 });
  assert.ok(Math.abs(halfH(fitPoly(big).poly) * m.h - 60.6) < 1.5, 'scaled x2 about its centre');
  assert.ok(maskAt(parts[0], 100 / m.w, 90 / m.h) === 1 && maskAt(parts[0], 0, 0) === 0);
  const sq = (x0, y0, w) => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + w], [x0, y0 + w]];
  assert.deepEqual(groupsAt([{ poly: sq(0.1, 0.1, 0.5) }, { poly: sq(0.2, 0.2, 0.1) }, { poly: sq(0.7, 0.7, 0.1) }], 0.25, 0.25), [1, 0], 'smallest first (the one on top)');
});

// ---- paint first, assign after (paw-1mo) ----
test('unassigned groups: names, labels, never tracked, counted for the warning', () => {
  assert.equal(freeUnassigned([{ name: 'unassigned_1' }, { name: 'unassigned_3' }]), 'unassigned_2');
  assert.ok(isUnassigned('unassigned_12') && isUnassigned({ name: 'unassigned_1' }) && !isUnassigned('c1_penis') && !isUnassigned('unassigned'));
  assert.equal(partLabel('unassigned_4'), '? 4');
  assert.match(groupColor('unassigned_1'), /var\(--tx\)/, 'neutral until assigned');
  const sq = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]];
  const scenes = setGroups([{ start_ms: 0, end_ms: 1000 }], 0, [{ name: 'unassigned_1', poly: sq, t_ms: 5 }, { name: 'c1_penis', who: 'c1', part: 'penis', poly: sq, t_ms: 5 }, { name: 'unassigned_2', poly: sq, t_ms: 5, off: true }]);
  assert.deepEqual(trackGroups(scenes, 0, 1000).map((g) => g.name), ['c1_penis']);
  assert.equal(unassignedIn(scenes, 0, 1000), 1, 'hidden ones are not counted');
  assert.equal(unassignedIn(scenes, 10, 1000), 0);
});

test('assign / reassign / swap: names, characters, sides, repeats; nothing else changes', () => {
  const m = { w: 1, h: 1, rle: [0, 1] };
  let l = [{ name: 'unassigned_1', poly: [[0, 0]], t_ms: 5, mask: m }, { name: 'unassigned_2', t_ms: 5 }, { name: 'c1_penis', who: 'c1', part: 'penis', pinned: true, t_ms: 5 }];
  l = assignGroup(l, 0, { who: 'c2', part: 'hand' });
  assert.deepEqual(l[0], { name: 'c2_hand_l', poly: [[0, 0]], t_ms: 5, mask: m, pinned: true, who: 'c2', part: 'hand', side: 'l' }, 'paired parts default to L');
  l = assignGroup(l, 1, { who: 'c1', part: 'penis' });
  assert.equal(l[1].name, 'c1_penis2', 'a second Bottom penis: a repeat name (the sidecar does the same)');
  l = assignGroup(l, 1, { who: 'c1', part: 'body' });
  assert.ok(l[1].name === 'c1_body' && l[1].pinned === false, 'reassigning: body is not pinned');
  assert.equal(assignGroup(l, 1, { who: 'c1', part: 'body' }), l, 'the same assignment: no change (no undo step)');
  const sw = swapAssign(l, 0, 2);
  assert.deepEqual([sw[0].name, sw[0].who, sw[0].side, sw[2].name, sw[2].side], ['c1_penis', 'c1', undefined, 'c2_hand_l', 'l']);
  assert.equal(sw[0].mask, m, 'masks / outlines stay with their group');
  const un = swapAssign([{ name: 'unassigned_1' }, { name: 'c2_hips', who: 'c2', part: 'hips' }], 0, 1);
  assert.deepEqual(un.map((g) => [g.name, g.who]), [['c2_hips', 'c2'], ['unassigned_1', undefined]], 'onto an unassigned group: the label moves');
});
