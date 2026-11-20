// Fuzz tests for lib/core (posAt, speeds) and lib/analyze (heatmap, findProblems, planner profile, sweepStroke).
// Seeded (mulberry32). FUZZ_SEEDS=n scales the seed count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posAt, speeds, isValid } from '../src/lib/core/script.js';
import { mulberry32, hashSeed } from '../src/lib/gen/util.js';
import { GENERATORS } from '../src/lib/gen/generators.js';
import { heatmap, findProblems, BUILTIN_PROFILES, getProfile, sweepStroke, withStroke, strokeShortfalls, toUnits } from '../src/lib/analyze/index.js';

const SEEDS = Number(process.env.FUZZ_SEEDS) || 100;
const J = (x) => JSON.stringify(x);
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

function randScript(rng, n = 2 + Math.floor(rng() * 60)) {
  const k = rng(), out = []; let t = Math.floor(rng() * 500);
  for (let i = 0; i < n; i++) {
    out.push({ at: t, pos: Math.floor(rng() * 101) });
    t += k < 0.3 ? 1 + Math.floor(rng() * 40) : k < 0.8 ? 30 + Math.floor(rng() * 600) : 1 + Math.floor(rng() * 9000);
  }
  return out;
}

test('fuzz posAt/speeds: exact at actions, bounded, linear between, continuous, held outside', () => {
  for (let seed = 0; seed < SEEDS * 5; seed++) {
    const rng = mulberry32(hashSeed('pos', seed)), s = randScript(rng, 1 + Math.floor(rng() * 40));
    const tag = `seed ${seed} script ${J(s)}`;
    const lo = Math.min(...s.map((a) => a.pos)), hi = Math.max(...s.map((a) => a.pos));
    for (const a of s) assert.equal(posAt(s, a.at), a.pos, tag);
    assert.equal(posAt(s, -1e9), s[0].pos, tag);
    assert.equal(posAt(s, 1e12), s.at(-1).pos, tag);
    const sp = speeds(s);
    assert.equal(sp.length, s.length, tag);
    assert.equal(sp[0], 0, tag);
    assert.ok(sp.every((v) => Number.isFinite(v) && v >= 0), tag);
    for (let q = 0; q < 20; q++) {
      const t = s[0].at + rng() * (s.at(-1).at - s[0].at), v = posAt(s, t);
      assert.ok(Number.isFinite(v) && v >= lo - 1e-9 && v <= hi + 1e-9, `${v} outside [${lo},${hi}] at ${t}: ${tag}`);
      // |posAt(t+d) - posAt(t)| <= maxSpeed * d (continuity / Lipschitz)
      const d = 0.5 + rng() * 50, mx = Math.max(...sp);
      assert.ok(Math.abs(posAt(s, t + d) - v) <= (mx * d) / 1000 + 1e-9, `jump at ${t}: ${tag}`);
    }
  }
});

test('fuzz heatmap: finite, non-negative, bounded by the script speed, no throw on odd windows', () => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = mulberry32(hashSeed('heat', seed)), s = randScript(rng, Math.floor(rng() * 120));
    const end = s.length ? s.at(-1).at : 1000;
    const win = { t0: Math.floor(rng() * end) - 100, t1: Math.floor(rng() * end * 1.2), width: pick(rng, [0, 1, 7, 100, 513]) };
    const tag = `seed ${seed} win ${J(win)} script ${J(s.slice(0, 12))}... (${s.length})`;
    const h = heatmap(s, rng() < 0.2 ? {} : win);
    const mx = Math.max(0, ...speeds(s));
    for (const key of ['mean', 'peak', 'rate', 'activity']) {
      assert.equal(h[key].length, h.width, `${key} length ${tag}`);
      for (const v of h[key]) assert.ok(Number.isFinite(v) && v >= 0, `${key}=${v} ${tag}`);
    }
    for (const v of h.activity) assert.ok(v <= 1 + 1e-6, `activity ${v} ${tag}`);
    for (let i = 0; i < h.width; i++) {
      assert.ok(h.peak[i] <= mx * 1.0001 + 1e-3, `peak ${h.peak[i]} > script max ${mx} ${tag}`);
      assert.ok(h.mean[i] <= h.peak[i] * 1.0001 + 1e-3, `mean ${h.mean[i]} > peak ${h.peak[i]} at bin ${i} ${tag}`);
    }
  }
});

// ---- findProblems
const FALSE_POSITIVE_KINDS = new Set(['speed-limit', 'too-close', 'out-of-order', 'duplicate-time', 'negative-time', 'invalid-position', 'invalid-action']);
test('fuzz findProblems: no speed/spacing/hygiene false positives on generator output under the profile limit', () => {
  const ids = Object.keys(GENERATORS).filter((g) => g !== 'beats' && g !== 'knot-stroke'); // knot-stroke: see the todo test below
  for (let seed = 0; seed < SEEDS * 2; seed++) {
    const rng = mulberry32(hashSeed('fp', seed)), prof = pick(rng, BUILTIN_PROFILES.filter((p) => p.limits !== 'planner'));
    const id = pick(rng, ids), t0 = Math.floor(rng() * 20000), t1 = t0 + 2000 + Math.floor(rng() * 60000);
    const ctx = { seed, maxSpeed: Math.floor(prof.maxSpeed * (0.3 + 0.65 * rng())), minGapMs: Math.max(20, prof.minIntervalMs) };
    const s = GENERATORS[id].gen(t0, t1, {}, ctx);
    if (!s.length) continue;
    const bad = findProblems(s, prof).filter((p) => FALSE_POSITIVE_KINDS.has(p.kind));
    assert.deepEqual(bad.map((p) => `${p.kind}@${p.t0}: ${p.message}`), [], `${id} seed ${seed} profile ${prof.id} ctx ${J(ctx)} span ${t0}..${t1}`);
  }
});

// BY DESIGN: knot-stroke pops run at popSpeed (600 pos/s, fitted to the reference) even when ctx.maxSpeed is lower, so a
// slow device gets speed-limit findings (signal, not a blocker: the planner profile reshapes them; capSpeed fixes them).
test('fuzz knot-stroke: pops exceed a slow device limit and are reported, everything else stays under it', () => {
  for (let seed = 0; seed < 20; seed++) {
    const s = GENERATORS['knot-stroke'].gen(0, 30000, {}, { seed, maxSpeed: 135, minGapMs: 80 });
    const over = findProblems(s, getProfile('generic')).filter((p) => p.kind === 'speed-limit');
    assert.ok(over.length > 0, `seed ${seed}: pops should be flagged on a 135 pos/s device`);
    const steps = s.map((a, i) => (i ? Math.abs(a.pos - s[i - 1].pos) * 1000 / (a.at - s[i - 1].at) : 0));
    assert.ok(steps.every((v) => v <= 600 + 1e-6), `seed ${seed}: nothing above popSpeed`);
  }
});

test('fuzz findProblems(nucleus-capstan, planner limits): over-limit is never an error/warn and never carries a fix', () => {
  const base = getProfile('nucleus-capstan');
  assert.equal(base.limits, 'planner');
  for (let seed = 0; seed < SEEDS * 2; seed++) {
    const rng = mulberry32(hashSeed('planner', seed)), s = randScript(rng, 2 + Math.floor(rng() * 150));
    const prof = withStroke(base, 100 + Math.floor(rng() * 201));
    const probs = findProblems(s, prof);
    const tag = `seed ${seed} stroke ${prof.kinematics.strokeMm} script ${J(s)}`;
    for (const p of probs) {
      assert.notEqual(p.kind, 'kinematic-limit', `kinematic-limit leaked under planner (should be planner-reshaped): ${tag}`);
      if (p.kind === 'speed-limit') assert.ok(p.planner && p.severity === 'info', `speed-limit ${p.severity} under planner: ${tag}`);
      if (p.planner || p.kind === 'planner-reshaped') {
        assert.equal(p.severity, 'info', `${p.kind}@${p.t0} severity ${p.severity}: ${tag}`);
        assert.equal(p.fix, undefined, `${p.kind}@${p.t0} has a fix: ${tag}`);
      }
      if (p.kind === 'too-close') assert.equal(p.severity, 'info', tag);
    }
  }
});

test('fuzz findProblems: hostile raw input never throws, ids unique, sorted by t0', () => {
  for (let seed = 0; seed < SEEDS * 2; seed++) {
    const rng = mulberry32(hashSeed('raw', seed)), s = randScript(rng, Math.floor(rng() * 50)).map((a) => ({ ...a }));
    for (const a of s) { const k = rng(); if (k < 0.05) a.at = NaN; else if (k < 0.1) a.pos = 250; else if (k < 0.15) a.at = -a.at; else if (k < 0.2) a.pos = -5.5; else if (k < 0.25) a.at = s[0].at; }
    if (rng() < 0.3) s.reverse();
    if (rng() < 0.05) s.push(null);
    const prof = pick(rng, BUILTIN_PROFILES), tag = `seed ${seed} profile ${prof.id} script ${J(s)}`;
    let probs; try { probs = findProblems(s, prof, rng() < 0.5 ? { mediaDurationMs: 100000 } : {}); } catch (e) { assert.fail(`${e.message}: ${tag}`); }
    assert.equal(new Set(probs.map((p) => p.id)).size, probs.length, `duplicate ids ${tag}`);
    for (let i = 1; i < probs.length; i++) assert.ok(probs[i].t0 >= probs[i - 1].t0, `unsorted ${tag}`);
    for (const p of probs) assert.ok(Number.isFinite(p.t0) && Number.isFinite(p.t1), `non-finite span ${p.kind} ${tag}`);
  }
});

// ---- sweepStroke: a longer window means lower unit limits, so strokes can only get worse (monotone non-decreasing)
test('fuzz sweepStroke: shortfalls and reshaped share are monotone non-decreasing in strokeMm', () => {
  const prof = getProfile('nucleus-capstan'), lengths = [100, 125, 150, 200, 250, 300];
  for (let seed = 0; seed < SEEDS; seed++) {
    const rng = mulberry32(hashSeed('sweep', seed)), s = randScript(rng, 2 + Math.floor(rng() * 80));
    const rows = sweepStroke(s, prof, lengths, { tracking: false });
    const tag = `seed ${seed} script ${J(s)}`;
    assert.equal(rows.length, lengths.length);
    for (let i = 1; i < rows.length; i++) {
      assert.equal(rows[i].strokes, rows[0].strokes, `total strokes changed ${tag}`);
      assert.ok(rows[i].reshaped >= rows[i - 1].reshaped, `reshaped ${rows[i - 1].reshaped} -> ${rows[i].reshaped} at ${rows[i].strokeMm} mm: ${tag}`);
      assert.ok(rows[i].worstShortfallMs >= rows[i - 1].worstShortfallMs - 1e-6, `worstShortfallMs fell at ${rows[i].strokeMm} mm: ${tag}`);
      assert.ok(rows[i].share >= rows[i - 1].share - 1e-12, tag);
    }
    for (const r of rows) assert.ok(r.share >= 0 && r.share <= 1 && r.reshaped <= r.strokes && Number.isFinite(r.worstShortfallUnits), `${J(r)} ${tag}`);
    // consistent with strokeShortfalls directly
    const direct = strokeShortfalls(s, toUnits(withStroke(prof, lengths[2])), { minProm: 3 });
    assert.equal(rows[2].reshaped, direct.length, tag);
  }
});

test('fuzz generator output is always valid input for every analyzer (smoke)', () => {
  for (let seed = 0; seed < SEEDS / 2; seed++) {
    const rng = mulberry32(hashSeed('smoke', seed)), id = pick(rng, Object.keys(GENERATORS));
    const s = GENERATORS[id].gen(0, 1000 + Math.floor(rng() * 60000), {}, { seed });
    assert.ok(isValid(s));
    for (const prof of BUILTIN_PROFILES) findProblems(s, prof);
    heatmap(s, { width: 200 });
  }
});
