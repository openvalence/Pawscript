// Autorange's finer controls (src/lib/autorange.js policy fields, range-edit.js handle models), the live pass (rangePass)
// and the dead-gap tease (gapRows / gapScript kind 'tease', gen 'tease-top').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangePlan, applyRangePlan, rangePass, pieceMaps, gapRows, gapScript, gapText, ladderOf, LADDERS, POLICY, isAuto } from '../src/lib/autorange.js';
import { applyFx } from '../src/lib/fx.js';
import { withMods } from '../src/features/timeline/mods.js';
import { dragBand, policyModel, knobsModel, policyWith } from '../src/features/timeline/range-edit.js';

const strokes = (t0, t1, half = 400, lo = 0, hi = 100) => { const s = []; let k = 0; for (let t = t0; t < t1; t += half) s.push({ at: t, pos: k++ % 2 ? hi : lo }); return s; };
const sc = (a, b, tags, extra = {}) => ({ start_ms: a, end_ms: b, tags, ...extra });
const PEN = ['anal', 'penetration'];
const run = (n, len = 20000, tags = PEN) => Array.from({ length: n }, (_, i) => sc(i * len, (i + 1) * len, tags));
const pen = (policy) => rangePlan(run(4), strokes(0, 80000), { policy });

test('defaults leave the plan as it was (every new control off)', () => {
  const base = pen({}), same = pen({ width: 1, offset: 0, ease: 0, orgasmLo: 0, orgasmHi: 45, tie: null, ladders: null });
  assert.deepEqual(same, base);
  assert.deepEqual(ladderOf('penetration', POLICY), LADDERS.penetration);
});

test('ladder handles move the bands: start band, full band, the build-up share per family', () => {
  const base = pen({});
  const start = pen({ ladders: { penetration: { lo0: 40 } } });
  assert.ok(start[0].lo < base[0].lo, `a deeper start band: ${start[0].lo} < ${base[0].lo}`);
  assert.equal(start[3].lo1, base[3].lo1, 'the full band is untouched');
  const full = pen({ ladders: { penetration: { lo1: 20 } } });
  assert.equal(full[3].lo1, 20, 'full depth stops at the full band');
  assert.equal(full[0].lo, base[0].lo, 'the start band is untouched');
  const fast = pen({ ladders: { penetration: { at: 0.25 } } });
  assert.equal(fast[1].lo1, 0, 'full depth arrives after a quarter of the run');
  assert.ok(base[1].lo1 > 0);
  // another family's ladder leaves penetration alone; a single-rung ladder (foreplay) gets a full band
  assert.deepEqual(pen({ ladders: { oral: { lo0: 10 } } }), base);
  const L = ladderOf('foreplay', { ladders: { foreplay: { lo1: 30 } } });
  assert.deepEqual(L.map((r) => r[1]), [55, 30]);
});

test('band width scales the amplitude from the deep end; the offset slides every band (clamped to 0..100)', () => {
  const base = pen({}), narrow = pen({ width: 0.5 }), up = pen({ offset: 10 }), down = pen({ offset: -10 });
  for (let k = 0; k < 4; k++) {
    assert.equal(narrow[k].hi1, base[k].hi1, 'the out end stays');
    assert.ok(Math.abs((narrow[k].hi1 - narrow[k].lo1) - 0.5 * (base[k].hi1 - base[k].lo1)) <= 1, 'half as wide');
    for (const e of ['lo', 'hi', 'lo1', 'hi1']) {
      assert.equal(down[k][e], Math.max(0, base[k][e] - 10), `S${k + 1} ${e} slid down`);
      assert.equal(up[k][e], Math.min(100, base[k][e] + 10), `S${k + 1} ${e} slid up`);
    }
    if (k) assert.equal(down[k].lo, down[k - 1].lo1, 'still continuous across the cut');
  }
});

test('ease between runs: a new run slides in from the band before over N strokes', () => {
  const scenes = [sc(0, 20000, ['oral']), sc(20000, 40000, PEN)];
  const script = strokes(0, 40000, 500);
  const off = rangePlan(scenes, script, { policy: { buildUp: 0 } }), on = rangePlan(scenes, script, { policy: { buildUp: 0, ease: 2 } });
  assert.equal(off[1].pieces.length, 1);
  const [e, rest] = on[1].pieces;
  assert.ok(e.ease && e.t0 === 20000 && e.t1 === 22000, `2 strokes of 1000 ms: ${e.t0}..${e.t1}`);
  assert.equal(e.lo, on[0].lo1, 'starts at the band before');
  assert.equal(e.lo1, on[1].lo, 'arrives at its own band');
  assert.equal(rest.t0, e.t1 + 1);
  assert.match(on[1].reason, /eases in from S1 over 2 strokes/);
  assert.equal(on[0].pieces.length, 1, 'the first run has nothing before it');
});

test('orgasm band and tie level handles', () => {
  const scenes = withMods([...run(2), sc(40000, 60000, PEN)], [{ id: 'o', kind: 'orgasm', t0: 40000, t1: 60000 }]);   // the Orgasm modifier (paw-8b4h: never a scene tag)
  const o = rangePlan(scenes, strokes(0, 60000), { policy: { orgasmLo: 10, orgasmHi: 60 } });
  assert.deepEqual([o[2].lo, o[2].hi], [10, 60]);
  const one = [{ id: 'k1', kind: 'knotting', t0: 34000, t1: 38000, params: { mode: 'single' } }];
  const tie = rangePlan(run(2), strokes(0, 40000), { fx: one, policy: { tie: 30 } });
  assert.ok(tie[1].pieces.some((p) => p.tie && p.lo === 0 && p.hi === 30), 'the tie held at the tie level');
});

test('a scene left as it is ({off: true}) keeps its points; the run and its ladder are unchanged', () => {
  const scenes = run(3), script = strokes(0, 60000, 400, 20, 80), plan = rangePlan(scenes, script);
  const off = rangePlan(scenes.map((x, i) => (i === 1 ? { ...x, range: { off: true } } : x)), script);
  assert.equal(off[1].source, 'none');
  assert.ok(off[1].off && off[1].reason.includes('as it is'));
  const out = rangePass(script, off);
  assert.deepEqual(out.filter((p) => p.at >= 20000 && p.at < 40000), script.filter((p) => p.at >= 20000 && p.at < 40000), 'S2 untouched');
  assert.notDeepEqual(out.filter((p) => p.at < 19000), script.filter((p) => p.at < 19000), 'S1 ranged');
  assert.deepEqual(off[2].lo1, plan[2].lo1, 'a scene left alone still counts in its run');
});

// depth-aware pass: one manual band so the numbers are plain
const one = (script, range = { lo: 0, hi: 100 }, extra = {}, policy = {}) => rangePlan([sc(0, 20000, PEN, { range, ...extra })], script, { policy });
const turnsOf = (s, a = 500, z = 19000) => s.filter((p, k) => k > 0 && k < s.length - 1 && p.at > a && p.at < z && (p.pos - s[k - 1].pos) * (s[k + 1].pos - p.pos) < 0);

test('depth-aware: one map per scene, a shallow stroke stays proportionally shallow, an outlier does not set the scale', () => {
  // deep strokes 30..70 and shallow ones 30..50, one outlier dip to 0
  const s = []; for (let t = 0, k = 0; t < 20000; t += 400, k++) s.push({ at: t, pos: k % 2 ? (k % 4 === 1 ? 70 : 50) : 30 });
  s[25] = { ...s[25], pos: 0 };
  const plan = one(s), [m] = pieceMaps(s, plan);
  assert.equal(m.b, 30); assert.equal(m.T, 70);   // robust envelopes: the dip is ignored
  const out = rangePass(s, plan);
  const deep = out.filter((p, k) => s[k].pos === 70).map((p) => p.pos), shallow = out.filter((p, k) => s[k].pos === 50).map((p) => p.pos), bottom = out.filter((p, k) => s[k].pos === 30).map((p) => p.pos);
  assert.ok(Math.min(...deep) > Math.max(...shallow) && Math.min(...shallow) > Math.max(...bottom), 'order kept');
  const r = (shallow[0] - bottom[0]) / (deep[0] - bottom[0]);
  assert.ok(Math.abs(r - 0.5) < 0.03, `the shallow stroke keeps its share of the deep one: ${r.toFixed(2)}`);
  assert.ok(out[25].pos >= 0 && out[25].pos <= bottom[0], 'the outlier stays the deepest, softly kneed (never past 0)');
});

test('depth-aware: a base already sitting well in its band changes little; a narrow one is stretched; strength 0 = the base', () => {
  const wide = strokes(0, 20000, 400, 8, 92), narrow = strokes(0, 20000, 400, 40, 60);
  const dW = rangePass(wide, one(wide)).map((p, k) => Math.abs(p.pos - wide[k].pos));
  assert.ok(Math.max(...dW) <= 3, `kept: max change ${Math.max(...dW)}`);
  const n = rangePass(narrow, one(narrow)), tn = turnsOf(n);
  assert.ok(Math.min(...tn.map((p) => p.pos)) <= 2 && Math.max(...tn.map((p) => p.pos)) >= 98, 'stretched to the band');
  assert.equal(rangePass(narrow, one(narrow, { lo: 0, hi: 100, strength: 0 })), narrow, 'scene strength 0');
  assert.equal(rangePass(narrow, one(narrow, undefined, {}, { strength: 0 })), narrow, 'policy strength 0');
  // keep 0 (or a filled scene: its depth is not tracked) = the full remap even when the base already fits
  const f = rangePass(wide, one(wide, undefined, { fill: 'before' })), tf = turnsOf(f);
  assert.ok(Math.min(...tf.map((p) => p.pos)) <= 1 && Math.max(...tf.map((p) => p.pos)) >= 99, 'a fill leans on the band');
  assert.equal(pieceMaps(wide, one(wide, undefined, { fill: 'before' }))[0].keep, 0);
});

test('depth-aware: top and bottom envelopes apart, a band below the base, never an inverted order', () => {
  // bottoms all at 20, tops wander 50..90: the bottom stays put, the tops keep their spread
  const s = []; for (let t = 0, k = 0; t < 20000; t += 400, k++) s.push({ at: t, pos: k % 2 ? 50 + ((k * 7) % 41) : 20 });
  const out = rangePass(s, one(s, { lo: 10, hi: 60 })), t = turnsOf(out);
  const bots = t.filter((p) => p.pos < 30).map((p) => p.pos), tops = t.filter((p) => p.pos >= 30).map((p) => p.pos);
  assert.ok(Math.max(...bots) - Math.min(...bots) <= 1, 'one bottom level');
  assert.ok(Math.max(...tops) - Math.min(...tops) >= 15, 'the tops keep varying');
  for (let i = 0; i < s.length; i++) for (let j = 0; j < s.length; j++) if (s[i].pos < s[j].pos) assert.ok(out[i].pos <= out[j].pos, 'monotonic');
});

test('depth-aware: no step where two touching scenes meet on a continuous base', () => {
  // S1 strokes 20..80, S2 strokes 30..50, and a level hold at 45 from 19 s to 21 s across the cut
  const s = [];
  for (let t = 0, k = 0; t < 40000; t += 200, k++) s.push({ at: t, pos: t >= 19000 && t <= 21000 ? 45 : (k % 2 ? (t < 20000 ? 80 : 50) : (t < 20000 ? 20 : 30)) });
  const plan = rangePlan([sc(0, 20000, PEN, { range: { lo: 0, hi: 100 } }), sc(20000, 40000, PEN, { range: { lo: 0, hi: 100 } })], s);
  const [mA, mB] = pieceMaps(s, plan), jump = Math.abs(mA.at(45, 20000) - mB.at(45, 20000));
  assert.ok(jump > 20, `the two maps differ by ${jump.toFixed(0)} at the cut`);
  const hold = rangePass(s, plan).filter((p) => p.at >= 19000 && p.at <= 21000).map((p) => p.pos);
  const steps = hold.slice(1).map((v, k) => Math.abs(v - hold[k]));
  assert.ok(Math.max(...steps) <= jump / 2, `the hold glides from one map to the other (steps ${Math.max(...steps)} vs ${jump.toFixed(1)} at once)`);
});

test('tease: a dead gap (no act) gets slow shallow strokes at the top of the band, jittered, capped, deterministic', () => {
  const scenes = [sc(0, 20000, PEN), sc(20000, 50000, []), sc(50000, 70000, PEN)];
  const script = [...strokes(0, 20000), ...strokes(50000, 70000)];
  const plan = rangePlan(scenes, script);
  assert.equal(plan[1].tease.length, 1);
  const rows = gapRows(plan), g = rows.find((r) => r.kind === 'tease');
  assert.equal(g.i, 1);
  assert.equal(gapText(g), 'gap: S2 (no act) — tease at 80–100');
  const s = gapScript(g, script, { maxSpeed: 400, seed: 7 });
  assert.ok(s.length > 10, `${s.length} points`);
  assert.ok(s.every((p) => p.at > 20000 && p.at < 50000 && p.pos >= 80 && p.pos <= 100), 'inside the scene, inside the top band');
  for (let k = 1; k < s.length; k++) assert.ok(Math.abs(s[k].pos - s[k - 1].pos) / Math.max(1, s[k].at - s[k - 1].at) * 1000 <= 400, 'under the speed cap');
  // a stroke = its deepest point and the time since the one before: never two alike in a row
  const deep = s.filter((p, k) => k > 0 && k < s.length - 1 && p.pos < s[k - 1].pos && p.pos <= s[k + 1].pos);
  assert.ok(deep.length >= 4, `${deep.length} strokes`);
  for (let k = 2; k < deep.length; k++) {
    const a = [deep[k - 1].pos, deep[k - 1].at - deep[k - 2].at], b = [deep[k].pos, deep[k].at - deep[k - 1].at];
    assert.notDeepEqual(b, a, 'no two strokes alike');
  }
  assert.ok(new Set(deep.map((p) => p.pos)).size >= deep.length / 3, 'the depth varies');
  assert.deepEqual(gapScript(g, script, { maxSpeed: 400, seed: 7 }), s, 'deterministic');
  assert.notDeepEqual(gapScript(g, script, { maxSpeed: 400, seed: 8 }), s);
  // the policy's tease handles: reach and pace
  const reach = gapRows(rangePlan(scenes, script, { policy: { teaseShare: 0.4 } })).find((r) => r.kind === 'tease');
  assert.deepEqual([reach.lo, reach.hi], [60, 100]);
  const slow = gapScript(gapRows(rangePlan(scenes, script, { policy: { teasePeriod: 5000 } })).find((r) => r.kind === 'tease'), script, { seed: 7 });
  assert.ok(slow.length < s.length, 'slower pace, fewer points');
  // act gaps keep their act recipe
  const act = rangePlan([sc(0, 20000, PEN), sc(20000, 40000, PEN)], strokes(0, 20000));
  assert.deepEqual(gapRows(act).map((r) => r.kind), ['penetration']);
});

test('tease: low-motion runs and long spans with no points; a teased scene is not offered again nor reshaped', () => {
  const scenes = [sc(0, 20000, PEN), sc(20000, 40000, PEN)];
  const lm = rangePlan(scenes, strokes(0, 40000), { lowMotion: (i) => i === 1 });
  const g = gapRows(lm);
  assert.deepEqual(g.map((r) => [r.i, r.kind, r.why, r.whole]), [[1, 'tease', 'almost no motion', true]]);
  assert.ok(g[0].hi <= lm[1].hi1 && g[0].lo >= Math.min(lm[1].lo, lm[1].lo1), 'inside the scene\'s band');
  // a 10 s hole in a tracked scene
  const holey = [...strokes(0, 5000), ...strokes(15000, 40000)];
  const h = gapRows(rangePlan(scenes, holey));
  assert.equal(h.length, 1);
  assert.ok(h[0].t0 > 4600 && h[0].t1 < 15000 && /s without points/.test(h[0].why));
  // filled whole: scene.tease -> no act, no gap, no autorange effect
  const done = rangePlan([scenes[0], { ...scenes[1], tease: true }], strokes(0, 40000), { lowMotion: (i) => i === 1 });
  assert.equal(gapRows(done).length, 0);
  assert.equal(applyRangePlan([], done).filter((e) => e.t0 >= 20000).length, 0);
});

test('Range row: Alt-drag tilts the band (scene-end values only); policy handles round-trip', () => {
  const b = { lo: 20, hi: 80, lo1: 10, hi1: 90 };
  assert.deepEqual(dragBand(b, 'hi', -20, { slope: true }), { lo: 20, hi: 80, lo1: 10, hi1: 70 });
  assert.deepEqual(dragBand(b, 'lo', 100, { slope: true }), { lo: 20, hi: 80, lo1: 90, hi1: 90 }, 'never past the other edge');
  assert.deepEqual(dragBand(b, 'body', 30, { slope: true }), { lo: 20, hi: 80, lo1: 20, hi1: 100 });
  for (const fam of ['penetration', 'oral', 'foreplay']) {
    const m = policyModel({}, fam);
    assert.equal(m.lines.filter((l) => l.kind === 'curve').length, 2, 'the picked family solid');
    assert.equal(m.lines.filter((l) => l.kind === 'ghost').length, 4, 'the other two faint');
    for (const h of m.handles) assert.ok(Math.abs(h.toValue(h.x, h.y) - h.value) <= Math.max(0.6, h.step), `${fam} ${h.key} round-trips`);
    assert.ok(m.handles.some((h) => h.key === `ladders.${fam}.lo0`));
  }
  assert.ok(policyModel({ device: 'machine', floor: 20 }).handles.some((h) => h.key === 'floor'));
  for (const h of knobsModel({ width: 0.8, ease: 1.5 }).handles) assert.ok(Math.abs(h.toValue(h.x, h.y) - h.value) < 1e-6, h.key);
  assert.deepEqual(policyWith({ ladders: { oral: { lo0: 50 } } }, 'ladders.oral.hi0', 90).ladders, { oral: { lo0: 50, hi0: 90 } });
  assert.equal(policyWith({}, 'width', 0.7).width, 0.7);
  // a ladder handle drag changes the plan
  const m = policyModel({}), h = m.handles.find((x) => x.key === 'ladders.penetration.lo0');
  const P = policyWith(POLICY, h.key, h.toValue(h.x, h.y + 20));
  assert.ok(pen(P)[0].lo < pen({})[0].lo, 'dragging the start band deeper deepens the first scene');
});
