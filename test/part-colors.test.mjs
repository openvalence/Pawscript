// The part palette (paw-kqpn): character = hue family, up / down from the crotch = lightness (lighter up, deeper down), side = hue leaning away from the centre; neighbours and L / R pairs stay apart,
// also to a red-green colour-blind eye; repeats are lighter; the colours are legible on the dark panels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { partHex, groupColor, semColor, deltaE, oklab, oklch, FAMILY, POS, L_CEIL, HUE_SPAN, L_FLOOR, MIN_DE, MIN_DE_SIDE, MIN_DE_CROTCH, CROTCH_C, WHO_BASE } from '../src/features/tracking/colors.js';
import { PARTS, PAIRED, WHOS } from '../src/features/tracking/groups.js';

// pairs of parts that sit on one another or touch on a body (groups.js ON_PART, plus the neighbours it leaves out)
export const ADJ = [['penis', 'knot'], ['penis', 'sheath'], ['penis', 'balls'], ['sheath', 'balls'], ['sheath', 'hips'], ['balls', 'hips'], ['penis', 'hips'], ['knot', 'sheath'],
  ['hips', 'thighs'], ['hips', 'anus'], ['hips', 'slit'], ['hips', 'torso'], ['hips', 'tail'], ['hips', 'hand'], ['thighs', 'paws'], ['thighs', 'balls'], ['thighs', 'tail'], ['thighs', 'penis'],
  ['torso', 'head'], ['torso', 'hand'], ['torso', 'stomachbulge'], ['torso', 'neckbulge'], ['torso', 'body'], ['head', 'tongue'], ['head', 'neckbulge'], ['hips', 'stomachbulge'], ['anus', 'slit'],
  ['anus', 'balls'], ['anus', 'thighs'], ['head', 'hand'], ['hand', 'thighs'], ['body', 'head'], ['body', 'hips'], ['knot', 'thighs'],
  // paw-5r1: the limb chains
  ['shoulder', 'torso'], ['shoulder', 'head'], ['shoulder', 'forearm'], ['forearm', 'hand'], ['forearm', 'torso'], ['shoulder', 'neckbulge'],
  ['thighs', 'shin'], ['shin', 'paws'], ['shin', 'tail'], ['shin', 'balls'], ['shin', 'anus']];
const CVD_SIDE = 0.05;   // L / R of a paired part under simulated protan / deutan (hand, the widest, has the hue span but only the lightness step survives)
const side = (p, s) => (PAIRED.includes(p) ? s : null);
const hexOf = (who, part, s = 'l', rep = 1) => partHex({ who, part, side: side(part, s), rep });
// Machado et al. 2009, severity 1: protanopia and deuteranopia on linear sRGB
const CVD = { prot: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]], deut: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]] };
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), gam = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const sim = (hex, m) => { const n = parseInt(hex.slice(1), 16), c = [16, 8, 0].map((s) => lin(((n >> s) & 255) / 255)); return '#' + m.map((r) => Math.round(255 * gam(Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2])))).toString(16).padStart(2, '0')).join(''); };
const PAIRS = [];
for (const w of WHOS) for (const [a, b] of ADJ) for (const s of ['l', 'r']) PAIRS.push([w, a, b, s]);

test('adjacent parts of every character are at least MIN_DE apart (same side), and a repeat is lighter than its first', () => {
  const bad = PAIRS.filter(([w, a, b, s]) => deltaE(hexOf(w, a, s), hexOf(w, b, s)) < MIN_DE).map(([w, a, b, s]) => `${w} ${a}/${b} ${s} ${deltaE(hexOf(w, a, s), hexOf(w, b, s)).toFixed(3)}`);
  assert.deepEqual(bad, []);
  for (const w of WHOS) for (const p of PARTS) assert.ok(oklab(hexOf(w, p, 'l', 2))[0] > oklab(hexOf(w, p, 'l'))[0], `${w} ${p} repeat lighter`);
  assert.equal(groupColor('c1_thighs_r2'), partHex({ who: 'c1', part: 'thighs', side: 'r', rep: 2 }));
  assert.equal(semColor('c2_balls'), groupColor('c2_balls'));
});

test('the left and right of one part differ by at least MIN_DE_SIDE, also to a protan / deutan eye (>= CVD_SIDE)', () => {
  for (const w of WHOS) for (const p of PAIRED) {
    const l = hexOf(w, p, 'l'), r = hexOf(w, p, 'r');
    assert.ok(deltaE(l, r) >= MIN_DE_SIDE, `${w} ${p} L/R ${deltaE(l, r).toFixed(3)}`);
    for (const [k, m] of Object.entries(CVD)) assert.ok(deltaE(sim(l, m), sim(r, m)) >= CVD_SIDE, `${w} ${p} L/R under ${k}: ${deltaE(sim(l, m), sim(r, m)).toFixed(3)}`);
  }
});

test('character stays the hue family: no part of one character is nearer another character\'s colour than its own family (also colour-blind)', () => {
  assert.equal(new Set(Object.values(WHO_BASE)).size, 3);
  for (const [k, m] of [['normal', null], ...Object.entries(CVD)]) {
    const c = (h) => (m ? sim(h, m) : h);
    for (const a of WHOS) for (const b of WHOS) if (a < b) assert.ok(deltaE(c(WHO_BASE[a]), c(WHO_BASE[b])) >= 0.08, `${a}/${b} families under ${k}`);
    // each part of a character is closer (hue angle) to its own family than to either other
    const ang = (h) => { const [, x, y] = oklab(c(h)); return (Math.atan2(y, x) * 180) / Math.PI; };
    const dist = (p, q) => Math.abs(((p - q + 540) % 360) - 180);
    if (!m) for (const w of WHOS) for (const p of PARTS) for (const s of ['l', 'r']) {
      const own = dist(ang(hexOf(w, p, s)), FAMILY[w].h), other = WHOS.filter((x) => x !== w).map((x) => dist(ang(hexOf(w, p, s)), FAMILY[x].h));
      assert.ok(own < Math.min(...other), `${w} ${p} ${s} reads as ${w}`);
    }
  }
});

test('every part has a place (POS), the midline parts at u = 0, hands out furthest then paws then thighs', () => {
  for (const p of PARTS) assert.ok(POS[p], `${p} has a POS`);
  for (const p of ['penis', 'balls', 'sheath', 'knot', 'torso', 'head', 'tail', 'tongue', 'hips']) assert.ok(Math.abs(POS[p][0]) <= 0.5, `${p} near the midline`);
  assert.ok(POS.hand[0] > POS.paws[0] && POS.paws[0] > POS.thighs[0]);
  assert.ok(POS.head[1] > POS.torso[1] && POS.torso[1] > POS.hips[1] && POS.hips[1] > 0 && POS.thighs[1] < 0 && POS.paws[1] < POS.thighs[1]);
  // paw-5r1: a limb is a chain: each segment between its neighbours up / down (lighter toward the shoulder, deeper toward the paws)
  assert.ok(POS.shoulder[1] > POS.forearm[1] && POS.forearm[1] > POS.hand[1] && POS.thighs[1] > POS.shin[1] && POS.shin[1] > POS.paws[1]);
});

test('side to side: further left (L) is further along the warm end of the family, further right the cool end, strictly, for every family', () => {
  const hue = (h) => { const [, a, b] = oklab(h); return (Math.atan2(b, a) * 180) / Math.PI; };
  const dist = (h, ref) => ((hue(h) - hue(ref) + 540) % 360) - 180;   // signed hue offset from the part's midline colour
  for (const w of WHOS) {
    const warm = FAMILY[w].warm, mid = hexOf(w, 'hips');
    const ladder = ['hand', 'paws', 'thighs'].map((p) => [POS[p][0], dist(hexOf(w, p, 'l'), mid) * warm, dist(hexOf(w, p, 'r'), mid) * warm]).sort((a, b) => a[0] - b[0]);
    for (const [u, l, r] of ladder) { assert.ok(l > 0 && r < 0, `${w} u=${u}: L warm-ward, R cool-ward`); }
    // the further out the stronger (hue offset grows with |u|)
    for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i][1] > ladder[i - 1][1] - 6 && ladder[i][2] < ladder[i - 1][2] + 6, `${w} stronger further out`);
  }
  assert.ok(HUE_SPAN >= 35);
});

test('up / down from the crotch: higher is lighter, lower is deeper, for every family and side; chroma eases off with distance', () => {
  const L = (h) => oklab(h)[0], C = (h) => Math.hypot(oklab(h)[1], oklab(h)[2]);
  for (const w of WHOS) {
    for (const s of ['l', 'r']) {
      const up = ['hips', 'torso', 'head'].map((p) => L(hexOf(w, p, s)));   // v 0.3, 0.75, 1
      assert.ok(up[0] < up[1] && up[1] < up[2], `${w} lighter going up: ${up.map((x) => x.toFixed(2))}`);
      for (const p of ['hips', 'torso', 'head']) assert.ok(L(hexOf(w, p, s)) > L(hexOf(w, 'knot', s)), `${w} ${p} above the crotch is lighter than it`);
      for (const p of ['thighs', 'paws']) assert.ok(L(hexOf(w, p, s)) < L(hexOf(w, 'penis', s)), `${w} ${p} below the crotch is deeper than it`);
      assert.ok(L(hexOf(w, 'paws', s)) < L(hexOf(w, 'thighs', s)) + 1e-9, `${w} paws deeper than thighs`);
    }
    assert.ok(C(hexOf(w, 'penis')) > C(hexOf(w, 'head')) && C(hexOf(w, 'penis')) > C(hexOf(w, 'paws', 'l')), `${w} the crotch is the most saturated`);
  }
});

// the crotch cluster: the pairs painted on top of / against one another (shaft, knot, sheath, balls; anus, slit, tail behind)
export const CROTCH_ADJ = [['penis', 'knot'], ['penis', 'sheath'], ['penis', 'balls'], ['knot', 'sheath'], ['knot', 'balls'], ['sheath', 'balls'], ['balls', 'anus'], ['balls', 'slit'],
  ['balls', 'tail'], ['anus', 'slit'], ['anus', 'tail'], ['slit', 'tail'], ['penis', 'slit']];
test('the crotch cluster: every overlapping pair at least MIN_DE_CROTCH apart (0.075, was 0.010), its own cue only there', () => {
  assert.ok(MIN_DE_CROTCH >= 0.075);
  const bad = [];
  for (const w of WHOS) for (const [a, b] of CROTCH_ADJ) { const d = deltaE(hexOf(w, a), hexOf(w, b)); if (d < MIN_DE_CROTCH) bad.push(`${w} ${a}/${b} ${d.toFixed(3)}`); }
  assert.deepEqual(bad, []);
  assert.ok(Object.keys(CROTCH_C).every((p) => ['penis', 'knot', 'sheath', 'balls', 'anus', 'slit', 'tail'].includes(p)), 'the muted-chroma cue is reserved for the crotch');
  const C = (h) => Math.hypot(oklab(h)[1], oklab(h)[2]);
  for (const w of WHOS) for (const p of ['balls', 'sheath']) assert.ok(C(hexOf(w, p)) < C(hexOf(w, 'penis')) - 0.04, `${w} the ${p} around the shaft is muted`);
});

test('every colour reads on the dark lane: lightness >= L_FLOOR (clamped), and none paler than L_CEIL + 0.12 repeat steps', () => {
  for (const w of WHOS) for (const p of PARTS) for (const s of ['l', 'r']) {
    const l = oklab(hexOf(w, p, s))[0];
    assert.ok(l >= L_FLOOR - 0.005 && l <= L_CEIL + 0.121, `${w} ${p} ${s} lightness ${l.toFixed(2)}`);
  }
  assert.ok(Math.abs(oklch(0.7, 0.3, 140).length - 7) === 0);
});
