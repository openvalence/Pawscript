// The Machine panel's Stroker mode (paw-un2p, paw-n2ms; src/features/machine/stroker.js): zone coverage from the
// anatomy (glans, corona band, upper shaft, base), the stimulation measure (the owner's example: an open-ended short
// sleeve used at the base scores low on the glans, the same sleeve stroked at the tip scores high; monotonic in speed
// and tightness; zero without contact), the pubic pad (pressing it exposes up to its depth of shaft, continuous over
// the hilt), the skin's drag, and the size setting never leaving the settings (not in the usage log, not in a project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';
import * as K from '../src/features/machine/stroker.js';

const strokes = (n, periodMs, lo = 0, hi = 100) => { const s = []; for (let k = 0; k < n; k++) s.push({ at: k * periodMs, pos: hi }, { at: k * periodMs + periodMs / 2, pos: lo }); return s; };
// [glans, upper, base, corona] in contact
const zonesAt = (geo, e) => K.zonePressure(geo, e).map((p) => p > 0);
const glansShare = (t) => t.share[0] + t.share[3];   // the glans with its corona band
const body = K.BODY_DEFAULT;   // 140 mm long, 120 mm girth, 30 mm glans, 15 mm pad

test('stroker: the anatomy: a corona that flares over the shaft, the sulcus behind it, a rounded tip, the root under the pad', () => {
  const p = K.penisProfile(body).profile, r = (s) => p[s][1], g = body.glansMm;
  assert.ok(r(g - 1) > r(g + 8) * 1.03, 'the corona is wider than the shaft behind it');
  assert.ok(r(g + 3) < r(g - 1) && r(g + 3) < r(g + 10), 'the sulcus dips behind the corona');
  assert.ok(r(0) > 2 && r(0) < 0.4 * r(g - 1), 'a rounded tip, not a point and not flat');
  assert.equal(p.length, body.lengthMm + body.padMm + 1, 'the root (the pad depth) beyond the visible base');
  assert.deepEqual(['glans', 'corona', 'corona', 'upper', 'base'].map((z, i) => K.zoneOf([5, g - 2, g + 3, g + 20, body.lengthMm + 5][i], body)), ['glans', 'corona', 'corona', 'upper', 'base']);
});

test('stroker: which zones are inside, by sleeve position x size x sleeve type', () => {
  const open = K.geometry(body, K.sleeveFor('open-short'));   // 90 mm, open at both ends
  assert.deepEqual(zonesAt(open, 0), [false, true, true, false], 'down at the base: the glans pokes out of the far end');
  assert.deepEqual(zonesAt(open, 60), [true, true, false, true], 'pushed up to the tip: glans, corona and upper shaft, the base out');
  assert.deepEqual(zonesAt(open, 145), [false, false, false, false], 'off the tip: nothing');
  const big = K.geometry({ ...body, lengthMm: 200, glansMm: 40 }, K.sleeveFor('open-short'));
  assert.equal(K.zonePressure(big, 0)[0] + K.zonePressure(big, 0)[3], 0, 'a longer penis: the short sleeve at the base never reaches the glans');
  const ring = K.geometry(body, K.sleeveFor('ring'));   // 25 mm
  assert.deepEqual(zonesAt(ring, 120), [true, false, false, false], 'a ring at the tip: the glans only');
  assert.ok(zonesAt(ring, 98)[3] && !zonesAt(ring, 98)[2], 'a ring over the corona: the corona band');
  // a closed sleeve meets the tip at its end: a 130 mm sleeve on a 140 mm penis is pressed in below 10 mm from the base
  const closed = K.geometry(body, K.sleeveFor('closed-short'));
  assert.deepEqual([K.overrun(closed, 10).endMm, K.overrun(closed, 4).endMm, K.overrun(closed, -5).pastMm], [0, 6, 5]);
  assert.equal(K.overrun(K.geometry(body, K.sleeveFor('closed-long')), 0).endMm, 0);
  assert.deepEqual([K.overrun(open, 0).endMm, K.overrun(open, 0).out, K.overrun(open, 60).out], [0, true, false]);
  // a thicker penis presses harder in the same sleeve
  const thick = K.geometry({ ...body, girthMm: 150 }, K.sleeveFor('open-short'));
  assert.ok(K.zonePressure(thick, 30)[1] > K.zonePressure(open, 30)[1]);
});

test('stroker: the owner example: the open-ended short sleeve at the base scores low on the glans, at the tip high', () => {
  const geo = K.geometry(body, K.sleeveFor('open-short')), sc = strokes(30, 1000);
  const base = K.totals(K.integrateAll(sc, { downMm: 0, upMm: 20 }, geo));
  const tip = K.totals(K.integrateAll(sc, { downMm: 50, upMm: 125 }, geo));
  assert.ok(glansShare(base) < 0.1, `at the base the glans share is small (${glansShare(base).toFixed(3)})`);
  assert.ok(glansShare(tip) > 0.5, `at the tip the glans share is most of it (${glansShare(tip).toFixed(3)})`);
  assert.ok(tip.sum[0] > 10 * Math.max(base.sum[0], 1e-6), `glans total: tip ${tip.sum[0].toFixed(2)} vs base ${base.sum[0].toFixed(2)}`);
  assert.ok(tip.sum[3] > 10 * Math.max(base.sum[3], 1e-3), 'and the corona band');
  assert.ok(base.sum[2] > tip.sum[2], 'and the base gets more at the base');
  assert.ok(tip.glansStrokes > 0.9 && tip.strokes >= 50);
  assert.match(K.totalsText(tip), /^glans \d+ %, corona \d+ %, shaft \d+ %, base \d+ %; glans-time \d+ % of strokes$/);
});

test('stroker: monotonic in speed and in tightness; zero when not in contact or not moving', () => {
  const sl = K.sleeveFor('closed-long'), geo = K.geometry(body, sl), rig = K.rigDefault(body);
  const slow = K.totals(K.integrateAll(strokes(10, 2000), rig, geo)), fast = K.totals(K.integrateAll(strokes(20, 1000), rig, geo));
  assert.ok(fast.mean[0] > 1.5 * slow.mean[0], `faster strokes, more per second (${fast.mean[0].toFixed(2)} vs ${slow.mean[0].toFixed(2)})`);
  const tighter = K.geometry(body, { ...sl, profile: sl.profile.map(([x, r]) => [x, r - 2]) });
  const t2 = K.totals(K.integrateAll(strokes(20, 1000), rig, tighter));
  assert.ok(t2.sum[0] > fast.sum[0] && t2.sum[1] > fast.sum[1] && t2.sum[3] > fast.sum[3], 'a narrower channel, more on every zone');
  // a channel wider than the penis: no contact; a still sleeve: no sliding; a sleeve held above the tip: nothing
  const loose = K.geometry(body, { ...sl, profile: sl.profile.map(([x]) => [x, 30]) });
  // (kept off the hilt: an overshoot past it would press the case on the base, soft contact)
  assert.deepEqual(K.totals(K.integrateAll(strokes(10, 1000), { ...rig, downMm: 10 }, loose)).sum, [0, 0, 0, 0]);
  assert.deepEqual(K.totals(K.integrateAll([{ at: 0, pos: 50 }, { at: 10000, pos: 50 }], rig, geo)).sum, [0, 0, 0, 0]);
  assert.deepEqual(K.totals(K.integrateAll(strokes(10, 1000), { downMm: 200, upMm: 260 }, geo)).sum, [0, 0, 0, 0]);
  assert.equal(K.totalsText(K.totals(null)), 'no sliding contact');
});

test('stroker: the soft sleeve lags the drive (jiggle) and the live state matches the whole-script pass', () => {
  const sc = strokes(10, 600), rig = K.rigDefault(body);
  const firm = K.geometry(body, { ...K.sleeveFor('closed-long'), soft: 0 }), soft = K.geometry(body, { ...K.sleeveFor('closed-long'), soft: 1 });
  let lf = 0, ls = 0;
  for (let t = 2000; t < 5000; t += 37) { const a = K.stateAt(sc, t, rig, firm), b = K.stateAt(sc, t, rig, soft); lf = Math.max(lf, Math.abs(a.e - a.drive)); ls = Math.max(ls, Math.abs(b.e - b.drive)); }
  assert.ok(ls > lf && ls > 2, `soft lags more (${ls.toFixed(1)} mm vs ${lf.toFixed(1)} mm)`);
  assert.ok(ls < 25, 'and stays bounded');
  // at the playhead, the live zone signal and the whole-script bucket agree (same solver, same steps)
  const res = K.integrateAll(sc, rig, firm), t = 3210, s = K.stateAt(sc, t, rig, firm), b = Math.floor((t - res.t0) / res.bucket);
  const near = Math.max(res.z[0][b - 1], res.z[0][b], res.z[0][b + 1]);
  assert.ok(Math.abs(s.zone[0] - near) < 0.35 * Math.max(near, 0.2), `live ${s.zone[0].toFixed(2)} vs pass ${near.toFixed(2)}`);
  assert.equal(s.heat.length, body.lengthMm + body.padMm + 1);
});

test('stroker: the skin is dragged with the sleeve: taut toward the base going down, bunched going up; none at rest', () => {
  const geo = K.geometry(body, K.sleeveFor('closed-long'));
  assert.ok(K.skinOf(geo, 30, -300) < -1 && K.skinOf(geo, 30, 300) > 1, 'with the motion, both ways');
  assert.equal(K.skinOf(geo, 30, 0), 0);
  assert.ok(Math.abs(K.skinOf(geo, 30, 1e6)) <= K.SKIN_MM + 1e-9, 'bounded');
  assert.equal(K.skinOf(geo, 200, 300), 0, 'no grip, no drag');
  // it moves where the shaft zones are read, not the glans
  const a = K.zonePressure(geo, 30, 0), b = K.zonePressure(geo, 30, 4);
  assert.equal(a[0], b[0]); assert.equal(a[3], b[3]);
  assert.notEqual(a[1], b[1]);
});

test('stroker: the pubic pad: pressing exposes up to its depth of shaft, nothing when not pressing, continuous over the hilt', () => {
  const qs = K.geometry(body, K.sleeveFor('fl-quickshot')), cl = K.geometry(body, K.sleeveFor('closed-long'));
  // the Quickshot's case stands 11.5 mm in front of its channel: it meets the body before the channel does
  assert.equal(K.sleeveFor('fl-quickshot').frontMm, 11.5);
  assert.equal(K.exposedMm(qs, 20), body.lengthMm);
  assert.equal(K.exposedMm(cl, 0), body.lengthMm, 'at the hilt, not pressing');
  let prev = body.lengthMm;
  for (let e = -1; e >= -60; e -= 1) {
    const x = K.exposedMm(cl, e);
    assert.ok(x >= prev - 1e-9 && x <= body.lengthMm + body.padMm + 1e-9, `exposed ${x.toFixed(2)} at ${e}`);
    prev = x;
  }
  assert.ok(prev > body.lengthMm + 0.9 * body.padMm, 'pressed hard: nearly the whole pad');
  assert.equal(K.exposedMm(K.geometry({ ...body, padMm: 0 }, K.sleeveFor('closed-long')), -30), body.lengthMm, 'no pad: nothing more');
  assert.ok(K.seated(cl, -60) >= -body.padMm - 1e-9, 'the channel goes no deeper than the compressed pad');
  // the base zone's pressure rises as it presses, and every zone is continuous over the hilt
  const baseAt = (e) => K.zonePressure(cl, e)[2];
  assert.ok(baseAt(-5) > baseAt(0) && baseAt(-20) > baseAt(-5) && baseAt(-60) >= baseAt(-20) - 1e-6);
  for (const g of [cl, qs]) {
    const f = K.frontOf ? 0 : 0, at = (g.sleeve.frontMm || 0) + f;
    const a = K.zonePressure(g, at + 0.01), b = K.zonePressure(g, at - 0.01);
    a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 0.15, `zone ${i} jumps at the hilt (${x.toFixed(3)} vs ${b[i].toFixed(3)})`));
  }
  const sc = strokes(20, 1000), tAt = (d) => K.totals(K.integrateAll(sc, { downMm: d, upMm: 100 }, cl)).sum.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(tAt(1) - tAt(0)) < 0.05 * tAt(0) && Math.abs(tAt(-1) - tAt(0)) < 0.05 * tAt(0), 'totals continuous as the marker crosses the hilt');
});

test('stroker: stored body and sleeves are sanitised; old three-zone weights still valid', () => {
  assert.deepEqual(K.validBody(null), { ...K.BODY_DEFAULT });
  const b = K.validBody({ lengthMm: 9999, girthMm: 'x', glansMm: 80, knot: 'yes', padMm: 99 });
  assert.deepEqual([b.lengthMm, b.girthMm, b.knot, b.padMm], [300, 120, false, 40]);
  assert.ok(b.glansMm <= 60);
  assert.equal(K.validSleeve({ profile: [[0, 1]], lengthMm: 50 }), null);
  const s = K.sleeveFor('open-short', { 'open-short': { lengthMm: 100, soft: 3 } });
  assert.deepEqual([s.lengthMm, s.soft, s.name, s.open], [100, 1, 'Open-ended short sleeve', true]);
  assert.equal(K.sleeveFor('nope').id, 'closed-long');
  const imp = K.sleeveFromToy({ id: 'u-1', name: 'Mine', length_mm: 120, profile: [[0, 5], [120, 12]] });
  assert.equal(K.sleeveFor('u-1', {}, [imp]).name, 'Mine');
  // generic ids; the named presets (the owner's request) from one table, flagged when not verified
  for (const p of K.SLEEVES) assert.match(p.id, /^(closed-long|closed-short|open-short|ring|fl-quickshot|fl-pilot|fl-go|fl-standard)$/);
  for (const id of ['fl-quickshot', 'fl-pilot', 'fl-go', 'fl-standard']) assert.match(K.sleeveFor(id).tip, /approx\./i);
  assert.deepEqual(['fl-quickshot', 'fl-pilot', 'fl-go', 'fl-standard'].map((id) => K.sleeveFor(id).open), [true, false, false, false]);
  // short to long, after the generic ones
  assert.deepEqual(K.SLEEVES.slice(-4).map((x) => x.id), ['fl-quickshot', 'fl-pilot', 'fl-go', 'fl-standard']);
  assert.deepEqual([K.SLEEVE_SPECS['fl-standard'].caseMm, K.SLEEVE_SPECS['fl-standard'].channelMm, K.SLEEVE_SPECS['fl-standard'].verified], [248, 216, ['caseMm', 'channelMm']]);
  const qs = K.SLEEVE_SPECS['fl-quickshot'];
  assert.deepEqual([qs.caseMm, qs.channelMm, qs.verified], [112, 89, ['caseMm', 'channelMm']]);
  assert.match(qs.source, /owner/);
  // GO and Pilot: the maker's stated depth (not verified); their totals from the pictures, a little longer (end wall, cap)
  for (const [id, depth] of [['fl-pilot', 178], ['fl-go', 203]]) {
    const sp = K.SLEEVE_SPECS[id];
    assert.deepEqual([sp.verified, sp.stated, sp.channelMm], [[], ['channelMm'], depth]);
    assert.ok(sp.caseMm >= depth + 4 && sp.caseMm <= depth + 32, `${id}: total ${sp.caseMm} vs depth ${depth}`);
    assert.match(sp.source, /up to/);
    assert.match(K.sleeveFor(id).tip, /maker states/);
  }
  assert.equal(K.sleeveFor('fl-quickshot').lengthMm, 89);
  // a user's copy overrides the preset
  assert.equal(K.sleeveFor('fl-pilot', { 'fl-pilot': { lengthMm: 160 } }).lengthMm, 160);
  // saved weights from before the corona band: the band gets its default
  const g = K.geometry(body, K.sleeveFor('ring'), { glans: 0.8, upper: 0.5, base: 0.2 });
  assert.deepEqual(g.w, [0.8, 0.5, 0.2, K.WEIGHTS_DEFAULT.corona]);
});

// (paw-iaai: the closed sleeves' glans totals rose with the closed end's suction, 28.783 -> 28.785 and 19.284 -> 19.468;
// the open sleeves did not move: the channel lookup was rewritten without allocation, to the same arithmetic)
test('stroker: the anatomical model, frozen (rigs inside the old limits; suction moved the closed sleeves on purpose)', () => {
  const was = { 'open-short 0-20': [0, 4.438002, 2.259614, 0.07579], 'open-short 50-125': [20.060053, 8.102623, 0.005302, 6.911126], 'closed-long 0-125': [28.784651, 20.135838, 3.767506, 11.109806], 'ring 60-130': [7.619894, 4.955854, 0, 3.325064], 'closed-short 10-100': [19.468164, 16.91414, 2.337966, 8.458436] };
  for (const [k, v] of Object.entries(was)) {
    const [id, r] = k.split(' '), [downMm, upMm] = r.split('-').map(Number);
    const t = K.totals(K.integrateAll(strokes(20, 900), { downMm, upMm }, K.geometry(body, K.sleeveFor(id))));
    assert.deepEqual(t.sum.map((x) => +x.toFixed(6)), v, k);
  }
});

test('stroker: the Quickshot (89 mm insertable, 112 mm case): at the base low on the glans, at the tip high', () => {
  const geo = K.geometry(body, K.sleeveFor('fl-quickshot')), sc = strokes(30, 1000);
  const base = K.totals(K.integrateAll(sc, { downMm: -5, upMm: 5 }, geo)), tip = K.totals(K.integrateAll(sc, { downMm: 35, upMm: 125 }, geo));
  assert.ok(glansShare(base) < 0.1 && glansShare(tip) > 0.5, `glans share base ${glansShare(base).toFixed(3)} tip ${glansShare(tip).toFixed(3)}`);
  assert.ok(tip.sum[0] > 10 * Math.max(base.sum[0], 1e-6));
});

test('stroker: the Quickshot channel: four ridges make four pressure peaks along the shaft at rest; the corona pulses past each', () => {
  const geo = K.geometry(body, K.sleeveFor('fl-quickshot')), e = 30;   // the channel over z 30 .. 119
  const p = Array.from({ length: body.lengthMm + 1 }, (_, s) => K.pressureAt(geo, s, e));
  const peaks = [];
  for (let s = 2; s < p.length - 2; s++) if (p[s] > 0 && p[s] >= p[s - 1] && p[s] > p[s + 1] && p[s] > p[s - 2] + 0.03 && p[s] > p[s + 2] - 1e-9) peaks.push(body.lengthMm - s);
  assert.equal(peaks.length, 4, `peaks at z ${peaks.join(', ')}`);
  [20.6, 36.5, 52.5, 68.4].forEach((x, i) => assert.ok(Math.abs(peaks.slice().reverse()[i] - (e + x)) <= 2, `ridge ${i + 1} at ${e + x}`));
  // the corona band's pressure as the sleeve slides: it rises and falls once per ridge crossed
  const cor = []; for (let x = 20; x <= 125; x += 2.5) cor.push(K.zonePressure(geo, x)[3]);
  let ups = 0; for (let i = 1; i < cor.length - 1; i++) if (cor[i] > cor[i - 1] && cor[i] >= cor[i + 1] && cor[i] > Math.min(...cor.slice(Math.max(0, i - 3), i)) + 0.3 && cor[i] > Math.min(...cor.slice(i + 1, i + 4)) + 0.3) ups++;   // a peak standing 0.3 above both sides
  assert.equal(ups, 4, `the corona pulses past each ridge (${ups} peaks)`);
  // picking it sets a short window over the upper shaft and the glans; a long closed sleeve gets nearly full travel
  const rq = K.rigFor(body, K.sleeveFor('fl-quickshot')), rs = K.rigFor(body, K.sleeveFor('fl-standard'));
  assert.ok(rq.downMm >= 0.3 * body.lengthMm && rq.upMm - rq.downMm < 80);
  assert.deepEqual(rs, K.rigDefault(body));
});

test('stroker: the soft sleeve: suction on withdrawal, the grip, the wall keeping its cross-section', () => {
  const cs = K.geometry(body, K.sleeveFor('closed-short')), op = K.geometry(body, K.sleeveFor('open-short'));
  // suction: only a closed end, only drawn off, only with a seal; stronger the closer the end is to the tip; bounded
  assert.equal(K.suctionOf(op, 10, 300), 0);
  assert.equal(K.suctionOf(cs, 10, -300), 0);
  assert.equal(K.suctionOf(K.geometry(body, { ...K.sleeveFor('closed-short'), profile: [[0, 30], [130, 30]] }), 10, 300), 0, 'no seal, no suction');
  assert.ok(K.suctionOf(cs, 10, 300) > K.suctionOf(cs, 30, 300) && K.suctionOf(cs, 30, 300) > 0);
  assert.ok(K.suctionOf(cs, 10, 300) > K.suctionOf(cs, 10, 60));
  assert.ok(K.suctionOf(cs, -40, 1e6) <= K.SUCK.p + 1e-9);
  const sc = strokes(10, 1000), s1 = K.stateAt(sc, 5600, { downMm: 10, upMm: 100 }, cs);   // drawn off, just past pos 0 (at 5500)
  assert.ok(s1.suction > 0 && s1.v > 0, `suction while withdrawing (${s1.suction.toFixed(2)})`);
  // the grip narrows a caseless channel (more pressure, monotonic) and does nothing to a cased product
  const sl = K.sleeveFor('closed-long'), z = (g) => K.zonePressure(K.geometry(body, K.applyGrip(sl, g)), 40)[1];
  assert.ok(z(0) < z(0.5) && z(0.5) < z(1));
  assert.equal(K.applyGrip(sl, 0), sl);
  const qs = K.sleeveFor('fl-quickshot');
  assert.equal(K.applyGrip(qs, 1), qs, 'a hard case takes the squeeze');
  // the wall keeps its cross-section: stretched, it thins (outer grows less than the channel)
  const ro = K.wallOuter(8, 19, 21);
  assert.ok(ro > 21 && ro - 21 < 19 - 8);
  assert.ok(Math.abs((ro * ro - 19 * 19) - (21 * 21 - 8 * 8)) < 1e-9);
  assert.equal(K.wallOuter(8, 8, 21), 21);
});

test('stroker: past a closed end: soft, smooth, monotonic, finite; an open end lets the glans out', () => {
  const closed = K.geometry(body, K.sleeveFor('closed-short'));   // 130 mm: the tip meets its end at e = 10
  const glansAt = (e) => K.zonePressure(closed, e)[0];
  let prev = glansAt(10), prevStep = 0;
  for (let e = 9.5; e >= -60; e -= 0.5) {
    const g = glansAt(e);
    assert.ok(Number.isFinite(g) && g >= prev - 1e-9, `end pressure rises as the end is pressed in (e ${e})`);
    const step = g - prev;
    if (e < 9) assert.ok(step < 3 * prevStep + 0.5, `no jump at e ${e}`);   // smooth: no step change
    prev = g; prevStep = step;
  }
  assert.ok(glansAt(-60) > glansAt(10) + 3, 'well pressed in, more on the glans');
  const open = K.geometry(body, K.sleeveFor('fl-quickshot'));
  // open end: down at the base the glans is out of the far end, no glans contact
  assert.equal(K.zonePressure(open, -10)[0], 0);
  assert.equal(K.overrun(open, -10).out, true);
  // past the tip: nothing
  assert.deepEqual(K.zonePressure(open, 200), [0, 0, 0, 0]);
  // extreme markers, whole script: nothing NaN, end contact and past-hilt time reported
  for (const rig of [{ downMm: -60, upMm: 200 }, { downMm: 200, upMm: -60 }, { downMm: -60, upMm: -60 }, { downMm: 200, upMm: 200 }]) {
    for (const g of [closed, open, K.geometry({ ...body, padMm: 0 }, K.sleeveFor('fl-quickshot'))]) {
      const t = K.totals(K.integrateAll(strokes(6, 800), rig, g));
      assert.ok([...t.sum, ...t.share, t.endFrac, t.pastFrac].every(Number.isFinite), JSON.stringify(rig));
      const s = K.stateAt(strokes(6, 800), 2100, rig, g);
      assert.ok([s.e, s.v, s.skin, ...s.zone, ...s.heat].every(Number.isFinite));
    }
  }
  const t = K.totals(K.integrateAll(strokes(10, 1000), { downMm: -20, upMm: 100 }, closed));
  assert.ok(t.endFrac > 0.05 && t.pastFrac > 0.05);
  assert.match(K.totalsText(t), /; end contact \d+ % of the time, past hilt \d+ %$/);
});

test('stroker: the stroke window and the camera are stored as fractions of the length; older stored mm still read', async () => {
  const { camOf, camToStore, strokerCam } = await import('../src/features/machine/stroker3d.js');
  const b = K.validBody({ lengthMm: 187.37 }), r = { downMm: -20, upMm: 140 };
  assert.deepEqual(K.rigOf(K.rigToStore(r, b), b), r);
  assert.deepEqual(K.rigOf(null, b, K.sleeveFor('fl-quickshot')), K.rigFor(b, K.sleeveFor('fl-quickshot')), 'null: the sleeve\'s own window');
  assert.deepEqual(K.rigOf({ downMm: 3, upMm: 90 }, b), { downMm: 3, upMm: 90 }, 'an older {downMm, upMm}');
  const c = { ...strokerCam('side', b.lengthMm), pan: [4, 103.05, -2] };
  assert.deepEqual(camOf(camToStore(c, b.lengthMm), b.lengthMm).pan.map((v) => +v.toFixed(6)), [4, 103.05, -2]);
  assert.deepEqual(camOf({ az: 10, el: 20, zoom: 1, pan: [0, 50, 0], shift: 0 }, b.lengthMm).pan, [0, 50, 0], 'an older pan in mm');
  assert.deepEqual(camOf(null, b.lengthMm), strokerCam('quarter', b.lengthMm));
});

// paw-garg: a recognisable size, every setting the Stroker writes from it, then every place the app writes things out
test('stroker: the size and what is drawn from it stay in the settings: no log, project, pack, funscript, history, resume, report', async () => {
  registerHooks({
    load(url, ctx, next) {
      if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
      if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(fileURLToPath(url), 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code };
      if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: 'export default function Stub() {}' };
      if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
      return next(url, ctx);
    },
  });
  const { createApp } = await import('../src/app/app.svelte.js');
  const { projectDoc, saveItems } = await import('../src/app/project-logic.js');
  const { exportHistory } = await import('../src/app/project-history.js');
  const { reportText, privateNames, keepConsoleErrors, keptErrors } = await import('../src/app/bug-report.js');
  const { camToStore, strokerCam } = await import('../src/features/machine/stroker3d.js');
  keepConsoleErrors();
  const mem = new Map(), storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const app = createApp({ storage, commands: [] });
  app.load({ axes: { stroke: strokes(3, 1000) }, activeAxis: 'stroke' });
  app.settings.set('machine.units', 'mm');   // an ordinary setting is logged (the log is on)
  // the size (every number recognisable) and what StrokerView writes from it: a sleeve picked (its own window: the rig
  // cleared), a marker dragged, the camera framed on the penis (pan = length x 0.55 = 103.05)
  const body = { lengthMm: 187.37, girthMm: 133.71, glansMm: 39.13, taper: 0.07, knot: false };
  app.settings.set('stroker.body', body);
  app.settings.set('stroker.sleeve', 'fl-quickshot');
  app.settings.set('stroker.rig', null);
  const rig = K.rigOf(null, body, K.sleeveFor('fl-quickshot'));   // {downMm: 75, upMm: 162.37}
  app.settings.set('stroker.rig', K.rigToStore({ ...rig, downMm: 40 }, body));
  app.settings.set('stroker.cam', camToStore(strokerCam('quarter', body.lengthMm), body.lengthMm));
  console.error('[stroker] a console error for the report');
  app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at: 3500, pos: 40 }]);
  app.usage.flushAll?.();
  const SIZE = /187\.37|172\.37|162\.37|179\.37|103\.05|133\.71|39\.13/;   // the size, length - 15 / 25 / 8, the pan, girth, glans
  assert.match(JSON.stringify(app.settings.get('stroker.body')), SIZE, 'the size itself stays in the settings');
  assert.doesNotMatch(JSON.stringify([app.settings.get('stroker.rig'), app.settings.get('stroker.cam')]), SIZE, 'rig / cam as stored do not give it back');
  const outputs = {
    usage: JSON.stringify([app.usage.log, app.usage.lines || []]),
    storage: JSON.stringify([...mem].filter(([k]) => k !== 'pawscript.settings')),   // the usage ring, the resume store
    project: JSON.stringify([projectDoc(app.doc), app.saveBlocks?.()]),   // a pack carries this project (pack.js)
    funscript: JSON.stringify(saveItems(app.doc, 'C:/x/clip').items.map((x) => x.text)),
    history: exportHistory(app._history, app.doc.read()).json,
    report: reportText({ m: { windows: 'w', gpus: ['g'], runtime: 'r' }, errs: keptErrors(), names: privateNames(app) }),
  };
  assert.match(outputs.usage, /machine\.units/);
  assert.match(outputs.usage, /edit:commit/);
  for (const [where, text] of Object.entries(outputs)) {
    assert.doesNotMatch(text, SIZE, where);
    assert.doesNotMatch(text, /stroker\.(body|rig|cam)/, where);
  }
  // the frame's state on window (dev/stroker-check.mjs) only in dev and test builds
  const src = readFileSync(new URL('../src/features/machine/StrokerView.svelte', import.meta.url), 'utf8');
  assert.match(src, /const DEBUG = [^\n]*import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_TEST_ID/);
  assert.equal(src.match(/globalThis\.__strokerView =/g).length, 1);
  assert.match(src, /if \(DEBUG\) globalThis\.__strokerView =/);
});