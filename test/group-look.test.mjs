// paw-c1m1: the Groups tool's look (src/features/tracking/group-look.js): the label spot inside the mask, the hatch direction
// along each limb chain, the pattern scheme (neighbours differ, L / R differ), fitting a label, never upside down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskStats, chainDirs, hatchOf, ditherOf, ditherOn, ditherGeom, PARENT, fitLabel, readable, nextFill, FILL_STYLES } from '../src/features/tracking/group-look.js';
import { rasterPoly, PAIRED } from '../src/features/tracking/groups.js';

const SIZE = { w: 320, h: 180 };
const N = (x, y) => [x / SIZE.w, y / SIZE.h];
const box = (x, y, w, h) => [N(x, y), N(x + w, y), N(x + w, y + h), N(x, y + h)];
const at = (m, x, y) => m.a[Math.round(y) * m.w + Math.round(x)];

test('the label spot is inside the mask, at its widest, deterministic', () => {
  // an L shape: a thick vertical bar and a thin foot; the spot must be in the thick bar, not the bbox centre (outside the shape)
  const m = rasterPoly([N(40, 20), N(80, 20), N(80, 120), N(200, 120), N(200, 140), N(40, 140)], SIZE);
  const s = maskStats(m), t = maskStats(m);
  assert.deepEqual(s, t, 'the same mask, the same result');
  assert.ok(at(m, s.spot.x, s.spot.y) >= 0.5, 'the spot is inside');
  assert.ok(s.spot.x >= 40 && s.spot.x <= 80 && s.spot.r >= 15, `in the thick bar (${s.spot.x}, ${s.spot.y}, r ${s.spot.r.toFixed(1)})`);
  const bx = (s.x0 + s.x1) / 2, by = (s.y0 + s.y1) / 2;
  assert.ok(at(m, bx, by) < 0.5, 'the box centre is outside (the case a centre label gets wrong)');
  // a ring: the spot inside the ring, never its hole
  const ring = rasterPoly(box(100, 40, 120, 100), SIZE), hole = rasterPoly(box(130, 70, 60, 40), SIZE);
  for (let i = 0; i < ring.a.length; i++) if (hole.a[i]) ring.a[i] = 0;
  const r = maskStats(ring);
  assert.ok(at(ring, r.spot.x, r.spot.y) >= 0.5, `a ring: the spot on the ring (${r.spot.x}, ${r.spot.y})`);
  assert.equal(maskStats({ ...SIZE, a: new Float32Array(SIZE.w * SIZE.h) }).n, 0, 'an empty mask: nothing');
});

test('the label spot is stable under small edits (a dab elsewhere, a trimmed edge)', () => {
  const base = rasterPoly([N(60, 30), N(140, 40), N(150, 110), N(70, 120)], SIZE), s0 = maskStats(base).spot;
  const dab = { ...base, a: base.a.slice() };
  for (let y = 100; y < 104; y++) for (let x = 150; x < 155; x++) dab.a[y * SIZE.w + x] = 1;   // a little paint off its corner
  const trim = { ...base, a: base.a.slice() };
  for (let y = 0; y < SIZE.h; y++) for (let x = 60; x < 63; x++) trim.a[y * SIZE.w + x] = 0;    // its left edge trimmed by up to 3 px
  for (const [what, m] of [['a dab', dab], ['a trim', trim]]) {
    const s = maskStats(m).spot, d = Math.hypot(s.x - s0.x, s.y - s0.y);
    assert.ok(d <= 3, `${what}: the spot moved ${d.toFixed(1)} px`);
  }
});

test('the long axis and the room along it: a thin bar at 30 deg', () => {
  const c = [160, 90], L = 70, W = 8, a = Math.PI / 6, ux = Math.cos(a), uy = Math.sin(a);
  const p = [[-L, -W], [L, -W], [L, W], [-L, W]].map(([s, t]) => N(c[0] + s * ux - t * uy, c[1] + s * uy + t * ux));
  const st = maskStats(rasterPoly(p, SIZE));
  assert.ok(Math.abs(Math.atan2(st.ay, st.ax) - a) < 0.03, `axis ${(Math.atan2(st.ay, st.ax) * 180 / Math.PI).toFixed(1)} deg`);
  assert.ok(st.elong > 5, `elongated (${st.elong.toFixed(1)})`);
  assert.ok(st.spot.along > 100 && st.spot.along < 150, `room along the bar ${st.spot.along.toFixed(0)} px (it is 140)`);
  assert.ok(st.spot.r >= 6 && st.spot.r <= 9, `inscribed radius ${st.spot.r.toFixed(1)} (half width 8)`);
});

// a character standing in the frame (mask px), its limbs where a body has them; the expected direction of each, outward
const BODY = {
  c1_head: box(150, 4, 20, 20), c1_torso: box(144, 26, 32, 50), c1_hips: box(144, 76, 32, 22),
  c1_shoulder_l: box(178, 28, 10, 26), c1_forearm_l: box(178, 56, 10, 24), c1_hand_l: box(176, 82, 14, 12),   // the arm hangs down
  c1_shoulder_r: [N(140, 30), N(146, 36), N(118, 52), N(112, 46)], c1_forearm_r: [N(112, 46), N(118, 52), N(96, 70), N(90, 64)], c1_hand_r: box(80, 66, 12, 12),   // raised out to the side
  c1_thighs_l: box(164, 98, 12, 30), c1_shin_l: box(164, 130, 10, 28), c1_paws_l: box(162, 160, 16, 10),
  c1_thighs_r: box(144, 98, 12, 30), c1_shin_r: box(146, 130, 10, 28), c1_paws_r: box(140, 160, 16, 10),
  c1_tail: box(178, 84, 50, 8),
};
const WANT = { c1_head: [0, -1], c1_shoulder_l: [0, 1], c1_forearm_l: [0, 1], c1_hand_l: [0, 1], c1_shoulder_r: [-1, 0.6], c1_forearm_r: [-1, 0.8], c1_hand_r: [-1, 0.3],
  c1_thighs_l: [0, 1], c1_shin_l: [0, 1], c1_thighs_r: [0, 1], c1_shin_r: [0, 1], c1_tail: [1, 0], c1_torso: [0, -1], c1_hips: [0, 1] };
const ALONG = { c1_paws_l: [1, 0], c1_paws_r: [1, 0] };   // a foot lies across the shin: its own long axis (either sense)

test('the hatch runs from the body outward along each limb chain', () => {
  const names = Object.keys(BODY), items = names.map((name) => ({ name, st: maskStats(rasterPoly(BODY[name], SIZE)) })), dirs = chainDirs(items);
  names.forEach((name, i) => {
    const [wx, wy] = WANT[name] || ALONG[name], L = Math.hypot(wx, wy), d = dirs[i], dot = (ALONG[name] ? Math.abs : Number)((d.ux * wx + d.uy * wy) / L);
    assert.ok(dot > 0.7, `${name}: direction (${d.ux.toFixed(2)}, ${d.uy.toFixed(2)}) against (${(wx / L).toFixed(2)}, ${(wy / L).toFixed(2)}): ${dot.toFixed(2)}`);
    assert.ok(d.ramp, `${name}: its sense is known`);
  });
  // a link missing (no forearm painted): the hand still points away from the shoulder; no body at all: the long axis, no ramp
  const noFore = names.filter((n) => n !== 'c1_forearm_l').map((name) => ({ name, st: maskStats(rasterPoly(BODY[name], SIZE)) }));
  const h = chainDirs(noFore)[noFore.findIndex((q) => q.name === 'c1_hand_l')];
  assert.ok(h.uy > 0.7, `no forearm: the hand from the shoulder (${h.uy.toFixed(2)})`);
  const [lone] = chainDirs([{ name: 'c1_tail', st: maskStats(rasterPoly(BODY.c1_tail, SIZE)) }]);
  assert.ok(Math.abs(lone.ux) > 0.95 && !lone.ramp, 'alone: along its long axis, no ramp');
  // the other side's limb is never the anchor: R hand with only the L forearm painted -> from the body
  const cross = ['c1_torso', 'c1_hips', 'c1_forearm_l', 'c1_hand_r'].map((name) => ({ name, st: maskStats(rasterPoly(BODY[name], SIZE)) }));
  const hr = chainDirs(cross)[3];
  assert.ok(hr.ux < -0.7, `R hand anchored on the body, not the L forearm (${hr.ux.toFixed(2)})`);
});

test('the pattern scheme: a part and the one it hangs from never share a pattern; L and R differ; unassigned has none', () => {
  const sides = (p) => (PAIRED.includes(p) ? ['_l', '_r'] : ['']);
  for (const [child, parent] of Object.entries(PARENT)) {
    for (const cs of sides(child)) for (const ps of sides(parent)) {
      const a = hatchOf(`c1_${child}${cs}`), b = hatchOf(`c1_${parent}${ps}`);
      assert.ok(a && b, `${child}${cs} / ${parent}${ps}: both hatched`);
      assert.notEqual(a.style, b.style, `${child}${cs} vs ${parent}${ps}: ${a.style} / ${b.style}`);
    }
  }
  for (const p of PAIRED) assert.notEqual(hatchOf(`c1_${p}_l`).key, hatchOf(`c1_${p}_r`).key, `${p}: L and R differ`);
  assert.ok(hatchOf('c1_hand_l').dash && !hatchOf('c1_hand_r').dash && !hatchOf('c1_torso').dash, 'L dashed, R and midline solid');
  assert.equal(hatchOf('c1_thighs_l2').key, hatchOf('c1_thighs_l').key, 'a repeat: the same pattern');
  assert.equal(hatchOf('c1_penis').key === hatchOf('c1_balls').key, false, 'the shaft and the balls (they overlap) differ');
  for (const n of ['unassigned_2', 'ignore', 'c1_other']) assert.equal(hatchOf(n), null, `${n}: no hatch`);
});

test('a label fits: full, else the tag, else none; tagOnly skips the full name', () => {
  const measure = (t, px) => t.length * px * 0.55;
  assert.deepEqual(fitLabel({ along: 200, thick: 30 }, 'R shoulder', 'RS', measure), { text: 'R shoulder', px: 12, full: true });
  const mid = fitLabel({ along: 40, thick: 30 }, 'R shoulder', 'RS', measure);
  assert.ok(mid && !mid.full && mid.text === 'RS', 'short room: the tag');
  assert.equal(fitLabel({ along: 8, thick: 30 }, 'R shoulder', 'RS', measure), null, 'no room: none');
  assert.equal(fitLabel({ along: 200, thick: 8 }, 'R shoulder', 'RS', measure), null, 'too thin: none');
  assert.equal(fitLabel({ along: 200, thick: 30 }, 'R shoulder', 'RS', measure, { tagOnly: true }).text, 'RS');
});

test('a text is never upside down; the fill style cycles', () => {
  for (let d = -360; d <= 360; d += 15) {
    const a = readable((d * Math.PI) / 180);
    assert.ok(a > -Math.PI / 2 - 1e-9 && a <= Math.PI / 2 + 1e-9, `${d} deg -> ${(a * 180 / Math.PI).toFixed(0)}`);
    assert.ok(Math.abs(Math.sin(a - (d * Math.PI) / 180)) < 1e-9, `${d} deg: the same line`);
  }
  assert.deepEqual(FILL_STYLES.map(nextFill), ['hatch', 'gradient', 'flat', 'dither']);
});

test('the dither scheme: L and R differ; coverage is ordered (one cell size for every part: the setting)', () => {
  for (const p of PAIRED) { const l = ditherOf(`c1_${p}_l`), r = ditherOf(`c1_${p}_r`); assert.ok(l.mirror && !r.mirror && l.key !== r.key, `${p}: L mirrored`); }
  assert.ok(Object.values({ a: ditherOf('c1_thighs_r'), b: ditherOf('c1_torso') }).every((d) => d.hi > d.lo), 'dense at the joint, sparse at the far end');
  assert.equal(ditherOf('unassigned_1'), null);
  const on = (c, m = false) => { let n = 0; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) n += ditherOn(i, j, c, m) ? 1 : 0; return n / 64; };
  for (const c of [0, 0.125, 0.25, 0.5, 0.75, 1]) { assert.ok(Math.abs(on(c) - c) <= 1 / 16, `coverage ${c}: ${on(c)} on`); assert.equal(on(c, true), on(c), 'mirrored: the same share'); }
  const checker = [0, 1, 2, 3].map((j) => [0, 1, 2, 3].map((i) => (ditherOn(i, j, 0.5) ? 1 : 0)));
  assert.ok(checker.every((row, j) => row.every((v, i) => v !== row[(i + 1) % 4] || v !== checker[(j + 1) % 4][i])), 'mid tone: an even, regular pattern');
  const mid = (m) => [0, 1, 2, 3].map((j) => [0, 1, 2, 3].map((i) => (ditherOn(i, j, 0.25, m) ? 'x' : '.')).join('')).join('/');
  assert.notEqual(mid(true), mid(false), `L and R read different at 25 % (${mid(false)} vs ${mid(true)})`);
  assert.ok(ditherOn(-1, -5, 0.99) && !ditherOn(-3, 7, 0.01), 'any cell index (the grid anchored on the part)');
});
test('busyCells: a centred disc, thresholds rise from the centre out', async () => {
  const { busyCells } = await import('../src/features/tracking/group-look.js');
  const c = busyCells(8, 4);
  assert.ok(c.length > 40 && c.length < 64);
  assert.ok(c.every((q) => q.t >= 0 && q.t <= 1));
  const mean = (a) => a.reduce((s, q) => s + q.t, 0) / a.length;
  const r = (q) => Math.hypot(q.x + 2, q.y + 2);
  assert.ok(mean(c.filter((q) => r(q) < 8)) < mean(c.filter((q) => r(q) > 12)));
  assert.equal(Math.min(...c.map((q) => q.x)), -16);   // symmetric about 0: the mark sits on the point
});

test('ditherGeom: pitch scales with the setting, the dot is its own share of the pitch (paw-zviq)', () => {
  assert.deepEqual(ditherGeom(4, 100, 1), { cd: 4, s: 4, off: 0 });   // the default
  assert.deepEqual(ditherGeom(8, 100, 2), { cd: 16, s: 16, off: 0 });
  assert.deepEqual(ditherGeom(4, 50, 1), { cd: 4, s: 2, off: 1 });
  assert.deepEqual(ditherGeom(6, 30, 1), { cd: 6, s: 2, off: 2 });
  assert.equal(ditherGeom(1, 100, 1).cd, 2);   // never below 2 px
  assert.equal(ditherGeom(3, 1, 1).s, 1);     // a dot is at least 1 px
});
